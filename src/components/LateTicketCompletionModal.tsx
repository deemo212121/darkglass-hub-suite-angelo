/**
 * Blocking "please confirm this late completion" pop-up for Claims-role
 * users (primary or secondary role) — mounted once in __root.tsx alongside
 * FrozenAccountModal.tsx, whose per-profile-gated, root-mounted shape this
 * follows. Unlike FrozenAccountModal, there's no "Got it"/dismiss-for-session
 * escape hatch: every row here needs a real Confirm/Reject decision, so the
 * popup only closes as rows are actually resolved (or if the list was empty
 * to begin with).
 *
 * Confirm flags the ticket for the technician's next payroll (techPayroll.ts's
 * getCarryoverRepairCounts picks it up) and alerts Accounting; Reject just
 * drops it, no payroll impact, no alert.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import {
  getPendingLateTicketCompletions,
  resolveLateTicketCompletion,
  resolveLateTicketCompletions,
  AlreadyResolvedError,
  type LateTicketCompletion,
} from "@/lib/supabase/lateTicketCompletions";
import { notifyRequestReviewers } from "@/lib/supabase/employeeRequests";

const CLAIMS_ROLES = ["CLAIMS", "CLAIMS_MANAGER", "CLAIMS_TEAM_LEADER"];

function isClaimsRole(role: string | null, extraRoles: string[]): boolean {
  return [role, ...extraRoles].some((r) => CLAIMS_ROLES.includes((r || "").toUpperCase()));
}

function formatPeriod(row: LateTicketCompletion): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(row.periodStart)}–${fmt(row.periodEnd)}`;
}

export function LateTicketCompletionModal() {
  const { uid, role, extraRoles, displayName } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [rows, setRows] = useState<LateTicketCompletion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Row ids ticked for Confirm / Reject selected.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const eligible = isClaimsRole(role, extraRoles);

  useEffect(() => {
    if (!uid || !eligible) return;
    let cancelled = false;
    getMyProfileId(uid).then((id) => { if (!cancelled) setProfileId(id); });
    getPendingLateTicketCompletions()
      .then((list) => { if (!cancelled) setRows(list); })
      .catch((err) => {
        console.error("LateTicketCompletionModal: failed to load pending rows", err);
        if (!cancelled) setRows([]);
      });
    return () => { cancelled = true; };
  }, [uid, eligible]);

  if (!eligible || !rows || rows.length === 0) return null;

  const handleResolve = async (row: LateTicketCompletion, status: "confirmed" | "rejected") => {
    setBusyId(row.id);
    try {
      await resolveLateTicketCompletion(row.id, status, profileId, displayName);
      if (status === "confirmed") {
        await notifyRequestReviewers({
          body: `Ticket ${row.ticketNo} under ${row.technicianName || "(unknown technician)"} (${formatPeriod(row)}) has been marked Claimed/Completed after the fact. Please verify and add to the next payroll.`,
          linkTo: "/accounting-dashboard?tab=payroll",
          senderId: profileId,
          senderName: displayName || "Claims",
        });
      }
      setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
      setSelected((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
    } catch (err) {
      if (err instanceof AlreadyResolvedError) {
        // Someone else on the Claims team already acted on this exact
        // ticket (the popup has no live sync between reviewers) — just
        // drop it from this view instead of letting a second click
        // silently override their decision.
        alert(`Ticket ${row.ticketNo}: ${err.message}`);
        setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
      } else {
        console.error("LateTicketCompletionModal: failed to resolve", err);
        alert("Something went wrong — please try again.");
      }
    } finally {
      setBusyId(null);
    }
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleRow = (id: string, on: boolean) =>
    setSelected((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());

  const handleResolveSelected = async (status: "confirmed" | "rejected") => {
    const picked = rows.filter((r) => selected.has(r.id));
    if (picked.length === 0) return;
    const verb = status === "confirmed" ? "Confirm" : "Reject";
    if (!window.confirm(`${verb} ${picked.length} ticket${picked.length === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    try {
      const resolvedIds = new Set(await resolveLateTicketCompletions(picked.map((r) => r.id), status, profileId, displayName));
      const resolvedRows = picked.filter((r) => resolvedIds.has(r.id));
      if (status === "confirmed" && resolvedRows.length > 0) {
        // One summary alert for the batch, not one per ticket.
        const preview = resolvedRows.slice(0, 10).map((r) => r.ticketNo).join(", ");
        await notifyRequestReviewers({
          body:
            resolvedRows.length === 1
              ? `Ticket ${resolvedRows[0].ticketNo} under ${resolvedRows[0].technicianName || "(unknown technician)"} (${formatPeriod(resolvedRows[0])}) has been marked Claimed/Completed after the fact. Please verify and add to the next payroll.`
              : `${resolvedRows.length} tickets were marked Claimed/Completed after the fact (${preview}${resolvedRows.length > 10 ? ", …" : ""}). Please verify and add them to the next payroll.`,
          linkTo: "/accounting-dashboard?tab=payroll",
          senderId: profileId,
          senderName: displayName || "Claims",
        });
      }
      // Rows someone else already reviewed drop out too — they're no longer pending.
      const pickedIds = new Set(picked.map((r) => r.id));
      setRows((prev) => (prev ?? []).filter((r) => !pickedIds.has(r.id)));
      setSelected(new Set());
      const skipped = picked.length - resolvedRows.length;
      if (skipped > 0) alert(`${skipped} of the selected tickets were already reviewed by someone else and were left as they were.`);
    } catch (err) {
      console.error("LateTicketCompletionModal: failed to resolve selected", err);
      alert("Something went wrong — please try again.");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-slate-950 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-white">Late ticket completion{rows.length > 1 ? "s" : ""} need review</h2>
            <p className="mt-1 text-sm leading-5 text-slate-400">
              {rows.length === 1 ? "This ticket was" : `These ${rows.length} tickets were`} marked Claimed/Completed after
              their scheduled week already ended. Confirm to add {rows.length === 1 ? "it" : "them"} to the technician's
              next payroll, or reject if this isn't legitimate.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2">
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-slate-300">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={bulkBusy}
              onChange={(e) => toggleAll(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={bulkBusy || selected.size === 0}
              onClick={() => handleResolveSelected("rejected")}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40"
            >
              Reject selected
            </button>
            <button
              type="button"
              disabled={bulkBusy || selected.size === 0}
              onClick={() => handleResolveSelected("confirmed")}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
            >
              {bulkBusy ? "Saving…" : "Confirm selected"}
            </button>
          </div>
        </div>

        <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-slate-900/50">
          <ul className="divide-y divide-white/5">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  disabled={bulkBusy}
                  onChange={(e) => toggleRow(row.id, e.target.checked)}
                  aria-label={`Select ticket ${row.ticketNo}`}
                  className="h-4 w-4 shrink-0 accent-emerald-500"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/ticket/$ticketNo"
                    params={{ ticketNo: row.ticketNo }}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sm font-semibold text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {row.ticketNo}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {row.technicianName || "(unknown technician)"} · {formatPeriod(row)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => handleResolve(row, "rejected")}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => handleResolve(row, "confirmed")}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
