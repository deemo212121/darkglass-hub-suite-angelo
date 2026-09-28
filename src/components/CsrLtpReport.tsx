/**
 * CSR module's "LTP Report" tile — a live, read-only per-branch snapshot of
 * how many pending tickets have aged 7+ days, following the pasted formula:
 *   1st column: 7+ days pending, excluding RTC and Need Cancel
 *   2nd column: 7+ days pending, all statuses
 *   3rd column: Total Pending Tickets
 *   4th column: Month Total (tickets entered this month, any status)
 *   Today's LTP = 2nd column / 3rd column
 *   Monthly LTP = average of each day-to-date-this-month's daily LTP%
 * All computation lives in computeLtpReportRows (operationsBranchMetrics.ts)
 * — this component is just fetch + table. There's a single "as of" date
 * picker (not a range) since every count is a live snapshot combined with
 * that day's Month Total/Monthly LTP/Scheduled figures (see
 * computeLtpReportRows' own doc comment for exactly what's live vs.
 * date-scoped). Branch is the first column; the table uses a compact
 * (text-[11px], tight padding) layout so a full region fits without much
 * scrolling. The filter bar and summary tiles are removed for now per
 * request — re-add once the base columns are confirmed correct.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useSmartBack } from "@/hooks/useSmartBack";
import { BrandedLoader } from "@/components/BrandedLoader";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { normalizeRole } from "@/lib/roleLabels";
import { REGIONS, REGION_LOCATIONS } from "@/lib/locations";
import { computeLtpReportRows } from "@/lib/operationsBranchMetrics";
import { getLtpReportNotesForDate, upsertLtpReportField, type CsrLtpReportNote } from "@/lib/supabase/csrLtpReportNotes";

// Same three-tier CSR roster used elsewhere (see ReportOperationsDaily.tsx's
// isBizOpsProfile) — checks primary role AND extra_roles for dual-role users.
const CSR_ROLES = new Set(["CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"]);
function isCsrProfile(p: ProfileRow): boolean {
  if (CSR_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => CSR_ROLES.has(normalizeRole(r)));
}

const ltpCls = (v: number | null) => (v === null ? "" : v >= 50 ? "text-green-400" : v >= 40 ? "text-yellow-400" : "text-red-400");
const TD = "px-2 py-1 text-center";

/**
 * Compact freeform-or-pick input for the CSR column — a native
 * `<input list>` + `<datalist>` renders each browser's own bulky default
 * dropdown (large rows, big font, no way to restyle it), so this is a small
 * custom one matching the rest of the table instead. Still plain free text
 * underneath (onBlur always saves whatever's typed, list or not) — the
 * dropdown is just a filtered suggestion list, not a constraint.
 */
function CsrComboBox({ value, options, onSave }: { value: string; options: string[]; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setText(value), [value]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return list.slice(0, 30);
  }, [options, text]);

  const openList = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 140) });
    setOpen(true);
  };

  const commit = (v: string) => {
    setText(v);
    setOpen(false);
    onSave(v);
  };

  return (
    <span className="relative inline-block w-full">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => { setText(e.target.value); openList(); }}
        onFocus={openList}
        onBlur={() => { setOpen(false); onSave(text); }}
        placeholder="—"
        className="bg-transparent border-0 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/20 rounded px-1 py-0.5 w-full min-w-28"
      />
      {open && pos && filtered.length > 0 && createPortal(
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-900 shadow-2xl py-1"
        >
          {filtered.map((o) => (
            <div
              key={o}
              onClick={() => commit(o)}
              className="px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 cursor-pointer truncate"
            >
              {o}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

export function CsrLtpReport({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [tickets, setTickets] = useState<Awaited<ReturnType<typeof getCompanyTickets>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(todayIso);
  const [notes, setNotes] = useState<Map<string, CsrLtpReportNote>>(new Map());
  const [csrProfiles, setCsrProfiles] = useState<ProfileRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [data, profiles] = await Promise.all([getCompanyTickets(), getCompanyUsers()]);
        if (!cancelled) {
          setTickets(data);
          setCsrProfiles(profiles.filter((p) => p.is_active && isCsrProfile(p)));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load LTP Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await getLtpReportNotesForDate(asOfDate);
        if (!cancelled) setNotes(rows);
      } catch (err) {
        console.error("Failed to load LTP Report notes:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [asOfDate]);

  const handleFieldSave = async (branch: string, field: "csr" | "note", value: string) => {
    const prev = notes.get(branch)?.[field] ?? "";
    if (value === prev) return;
    try {
      await upsertLtpReportField(branch, asOfDate, field, value || null);
      setNotes((m) => {
        const next = new Map(m);
        const existing = next.get(branch);
        next.set(branch, {
          id: existing?.id ?? "",
          branch,
          noteDate: asOfDate,
          csr: existing?.csr ?? null,
          note: existing?.note ?? null,
          [field]: value || null,
          updatedAt: new Date().toISOString(),
        });
        return next;
      });
    } catch (err) {
      console.error("Failed to save LTP Report field:", err);
    }
  };

  const csrOptions = useMemo(
    () => Array.from(new Set(csrProfiles.map((p) => p.display_name || p.username || p.email).filter(Boolean))).sort(),
    [csrProfiles],
  );

  const rows = useMemo(
    () => REGIONS.flatMap((region) => computeLtpReportRows(tickets, REGION_LOCATIONS[region], asOfDate)),
    [tickets, asOfDate],
  );

  const totals = useMemo(() => {
    const lateAll = rows.reduce((s, r) => s + r.lateAll, 0);
    const totalPending = rows.reduce((s, r) => s + r.totalPending, 0);
    const scheduled = rows.reduce((s, r) => s + r.scheduled, 0);
    const withMonthly = rows.filter((r) => r.monthlyLTP !== null);
    return {
      lateExclRtcNeedCancel: rows.reduce((s, r) => s + r.lateExclRtcNeedCancel, 0),
      lateAll,
      totalPending,
      monthTotal: rows.reduce((s, r) => s + r.monthTotal, 0),
      todayLTP: totalPending > 0 ? Math.round((lateAll / totalPending) * 10000) / 100 : null,
      monthlyLTP: withMonthly.length > 0 ? Math.round((withMonthly.reduce((s, r) => s + (r.monthlyLTP as number), 0) / withMonthly.length) * 100) / 100 : null,
      scheduled,
      totalExclRtcNeedCancel: rows.reduce((s, r) => s + r.totalExclRtcNeedCancel, 0),
      twentyPercentPct: totalPending > 0 ? Math.round((scheduled / totalPending) * 10000) / 100 : null,
      seal: rows.reduce((s, r) => s + r.seal, 0),
    };
  }, [rows]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-bold">{sub.title}</h1>
        </div>

        <div className="flex flex-col gap-1 mb-3 w-fit">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <input
            type="date"
            value={asOfDate}
            max={todayIso}
            onChange={(e) => setAsOfDate(e.target.value || todayIso)}
            className="glass-input text-xs py-1 px-2 rounded-md"
          />
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        ) : loading ? (
          <div className="panel p-8">
            <BrandedLoader label="Loading LTP Report…" />
          </div>
        ) : (
          <div className="panel overflow-x-auto p-0">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 divide-x divide-white/10">
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase whitespace-nowrap">Branch</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="7+ days pending, RTC and Need Cancel excluded">7+ Excl. RTC/Cancel</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="7+ days pending, all statuses">7+ All Status</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="Total open tickets, any age">Total Pending</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap">Month Total</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap">Today's LTP</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap">Monthly LTP</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="Tickets entered on the selected date, scheduled for the correct next business day">Scheduled</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="Total open tickets, any age, RTC and Need Cancel excluded">Total Tickets (RTC/Cancel Excl.)</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="Scheduled ÷ Total Pending Tickets">20% Percentage</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="Visits scheduled for this date with a sealed-system repair type">Seal</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="Who's assigned to this branch/task today — pick a CSR or type a name">CSR</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase whitespace-nowrap" title="Freeform notes for this branch/date, typed in by any CSR">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={13} className="px-4 py-8 text-center text-muted-foreground">No data.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.branch} className="border-b border-white/5 hover:bg-white/5 divide-x divide-white/5">
                    <td className="px-2 py-1 font-medium whitespace-nowrap">{r.branch}</td>
                    <td className={TD}>{r.lateExclRtcNeedCancel || "—"}</td>
                    <td className={TD}>{r.lateAll || "—"}</td>
                    <td className={TD}>{r.totalPending || "—"}</td>
                    <td className={TD}>{r.monthTotal || "—"}</td>
                    <td className={`${TD} font-semibold ${ltpCls(r.todayLTP)}`}>{r.todayLTP !== null ? `${r.todayLTP}%` : "—"}</td>
                    <td className={`${TD} font-semibold ${ltpCls(r.monthlyLTP)}`}>{r.monthlyLTP !== null ? `${r.monthlyLTP}%` : "—"}</td>
                    <td className={TD}>{r.scheduled || "—"}</td>
                    <td className={TD}>{r.totalExclRtcNeedCancel || "—"}</td>
                    <td className={`${TD} font-semibold`}>{r.twentyPercentPct !== null ? `${r.twentyPercentPct}%` : "—"}</td>
                    <td className={TD}>{r.seal || "—"}</td>
                    <td className="px-2 py-1">
                      <CsrComboBox
                        key={`csr-${r.branch}-${notes.get(r.branch)?.id ?? "empty"}`}
                        value={notes.get(r.branch)?.csr ?? ""}
                        options={csrOptions}
                        onSave={(v) => void handleFieldSave(r.branch, "csr", v)}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        key={`note-${r.branch}-${notes.get(r.branch)?.id ?? "empty"}`}
                        type="text"
                        defaultValue={notes.get(r.branch)?.note ?? ""}
                        onBlur={(e) => void handleFieldSave(r.branch, "note", e.target.value)}
                        placeholder="—"
                        className="bg-transparent border-0 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/20 rounded px-1 py-0.5 w-full min-w-32"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-white/10 bg-white/5 font-semibold divide-x divide-white/10">
                    <td className="px-2 py-1">Total</td>
                    <td className={TD}>{totals.lateExclRtcNeedCancel}</td>
                    <td className={TD}>{totals.lateAll}</td>
                    <td className={TD}>{totals.totalPending}</td>
                    <td className={TD}>{totals.monthTotal}</td>
                    <td className={`${TD} ${ltpCls(totals.todayLTP)}`}>{totals.todayLTP !== null ? `${totals.todayLTP}%` : "—"}</td>
                    <td className={`${TD} ${ltpCls(totals.monthlyLTP)}`}>{totals.monthlyLTP !== null ? `${totals.monthlyLTP}%` : "—"}</td>
                    <td className={TD}>{totals.scheduled}</td>
                    <td className={TD}>{totals.totalExclRtcNeedCancel}</td>
                    <td className={TD}>{totals.twentyPercentPct !== null ? `${totals.twentyPercentPct}%` : "—"}</td>
                    <td className={TD}>{totals.seal}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
