/**
 * No-Coverage Tickets — Tickets module (custom: "no-coverage-tickets"), the
 * AHS version of the legacy USAPP screen of the same name. Lists every open
 * ticket whose customer ZIP isn't in AHS's coverage: lookupZip, i.e.
 * Location Management's coverage table merged over the built-in map — the
 * same check that picks a ticket's branch when it syncs. Such a ticket can't
 * be routed to a branch by ZIP, and one with no branch never shows up for
 * branch-limited staff on Ticket List, so this is where they get noticed:
 * add the ZIP in Location Management, or cancel the ticket ("OUT OF
 * COVERAGE" / "NOT COVERED").
 *
 * Same location access rule as Ticket List (allowedLocations). Coverage is
 * re-read on every load so a ZIP just added in Location Management drops off
 * on Refresh — the copy loaded at sign-in can be stale.
 *
 * Each row can be fixed right here: Add ZIP puts the ticket's ZIP in a
 * branch's coverage (same location_mgmt_coverage row Location Management
 * adds — so only people who can open Location Management get it), and gives
 * open tickets with that ZIP and no branch yet that branch. Status is a
 * dropdown (same codes and CL-Cancelled rule as Work Planner / the ticket
 * page; CL-Cancelled asks for the reason).
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import { ChevronLeft, Download, MapPin, Printer, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useSmartBack } from "@/hooks/useSmartBack";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getCompanyTickets, invalidateCompanyTicketsCache, updateTicketFields, updateTicketsLocation, updateTicketStatus } from "@/lib/supabase/tickets";
import { getLocations, upsertCoverage } from "@/lib/supabase/locationManagement";
import { isZipCovered, registerZipCoverage } from "@/lib/zipCoverage";
import { ensureCompanyZipCoverage } from "@/lib/zipCoverageLoader";
import { isPendingStatus, REPAIR_STATUS_CODES, type Ticket } from "@/lib/ticketData";
import { formatISODate, todayISO } from "@/lib/localDate";
import { ACTIVE_LOCATIONS, normalizeLocationName } from "@/lib/locations";
import { CANCEL_REASONS } from "@/lib/operationsBranchMetrics";
import { canSetCancelledStatus } from "@/lib/roleLabels";
import { useOnClCancelList } from "@/lib/supabase/clCancelPeople";
import { canAccessSubmodule } from "@/lib/submoduleAccess";

const PAGE_SIZES = [10, 20, 50, 100, 500];

// Same normalizing as zipCoverage.ts's lookup (ZIP+4 and a dropped leading zero).
const zip5 = (zip: string | null | undefined) => String(zip ?? "").replace(/\D/g, "").padStart(5, "0").slice(0, 5);
const hasZip = (zip: string | null | undefined) => /\d/.test(String(zip ?? ""));

const COLUMNS: { label: string; value: (t: Ticket) => string; align?: "right" }[] = [
  { label: "Ticket No", value: (t) => t.ticketNo },
  { label: "Src/Acct", value: (t) => t.ticketSource || t.account || t.manufacturer || "" },
  { label: "Cx Name", value: (t) => t.customer },
  { label: "City", value: (t) => t.city },
  { label: "State", value: (t) => t.state || "" },
  { label: "Zip", value: (t) => t.zip || "" },
  { label: "Phone", value: (t) => t.phone },
  { label: "Job Date", value: (t) => (t.schedule ? formatISODate(t.schedule) : "") },
  { label: "Product", value: (t) => t.productType || "" },
  { label: "Models", value: (t) => t.model },
  { label: "Aging", value: (t) => String(t.aging ?? ""), align: "right" },
  { label: "Created", value: (t) => (t.created ? formatISODate(t.created) : "") },
  { label: "Location", value: (t) => t.location || "" },
  { label: "Status", value: (t) => t.status },
];

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function NoCoverageTicketsPage({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { allowedLocations, role, extraRoles, isTrainee, isFrozen } = useAuth();
  const onClCancelList = useOnClCancelList();
  const canCancel = canSetCancelledStatus(role, extraRoles, isTrainee, onClCancelList);
  const canAddZip = canAccessSubmodule(role, extraRoles, "admin", { slug: "location-management", custom: "location-management" }, isTrainee, isFrozen);
  const statusOptions: string[] = canCancel ? ["CL-Cancelled", ...REPAIR_STATUS_CODES] : [...REPAIR_STATUS_CODES];

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // Branches for Add ZIP: the active roster plus any branch added in Location Management.
  const [branchOptions, setBranchOptions] = useState<string[]>(() => ACTIVE_LOCATIONS.filter((l) => l !== "Philippines"));
  const [addZipFor, setAddZipFor] = useState<Ticket | null>(null);
  const [addZipBranch, setAddZipBranch] = useState("");
  const [addZipCity, setAddZipCity] = useState("");
  const [addZipBusy, setAddZipBusy] = useState(false);
  const [addZipError, setAddZipError] = useState<string | null>(null);

  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<Ticket | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAddZip) return;
    getLocations()
      .then((rows) => {
        setBranchOptions((current) => {
          const names = new Set(current);
          for (const r of rows) {
            const name = normalizeLocationName(r.location);
            // Same clean-name check as Location Management's coverage branch list.
            if (/[A-Za-z]/.test(name) && !/^\d{3,}/.test(name) && name.length <= 40 && name !== "Philippines" && name !== "Mexico") names.add(name);
          }
          return Array.from(names).sort((a, b) => a.localeCompare(b));
        });
      })
      .catch((err) => console.warn("No-Coverage Tickets: branch list from Location Management skipped:", err));
  }, [canAddZip]);

  const load = async (fresh = false) => {
    try {
      setLoading(true);
      setError(null);
      if (fresh) invalidateCompanyTicketsCache();
      const [rows] = await Promise.all([
        getCompanyTickets(),
        // Best-effort: without it the lookup still has the built-in map plus
        // whatever coverage was loaded at sign-in.
        ensureCompanyZipCoverage(true).catch((err) => {
          console.warn("No-Coverage Tickets: coverage reload skipped:", err);
        }),
      ]);
      setTickets(rows);
      setLastLoadedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Newest first, like the legacy screen.
  const noCoverage = useMemo(
    () =>
      tickets
        .filter((t) => isPendingStatus(t.status) && !isZipCovered(t.zip))
        .filter((t) => allowedLocations === null || allowedLocations.includes(t.location))
        .sort((a, b) => (b.created || "").localeCompare(a.created || "") || a.ticketNo.localeCompare(b.ticketNo)),
    // lastLoadedAt: coverage is re-registered on each load, which this memo can't see otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, allowedLocations, lastLoadedAt],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return noCoverage;
    return noCoverage.filter((t) => COLUMNS.some((c) => c.value(t).toLowerCase().includes(q)));
  }, [noCoverage, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pagedRows = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const openAddZip = (t: Ticket) => {
    setAddZipFor(t);
    setAddZipBranch(branchOptions.includes(t.location) ? t.location : "");
    setAddZipCity(t.city || "");
    setAddZipError(null);
  };

  const saveAddZip = async () => {
    if (!addZipFor) return;
    const zip = zip5(addZipFor.zip);
    const branch = addZipBranch.trim();
    if (!branch) { setAddZipError("Pick the branch this ZIP belongs to."); return; }
    setAddZipBusy(true);
    setAddZipError(null);
    try {
      // Someone may have added it since this list loaded — don't add it twice.
      await ensureCompanyZipCoverage(true);
      const alreadyAdded = isZipCovered(zip);
      const city = addZipCity.trim();
      if (!alreadyAdded) {
        await upsertCoverage({ id: "", location: branch, zipCode: zip, city, selfSchedule: "", daysLater: "", tierCode: "" });
        registerZipCoverage([{ zipCode: zip, location: branch, city }]);
      }
      // Open tickets with this ZIP and no branch yet get the branch, so branch-limited staff see them.
      const noBranch = tickets.filter((t) => isPendingStatus(t.status) && hasZip(t.zip) && zip5(t.zip) === zip && !t.location).map((t) => t.ticketNo);
      let branchNote = "";
      let filled = new Set<string>();
      try {
        await updateTicketsLocation(noBranch, branch);
        filled = new Set(noBranch);
        if (noBranch.length) branchNote = ` ${noBranch.length} ticket${noBranch.length === 1 ? "" : "s"} with no branch now ${noBranch.length === 1 ? "has" : "have"} ${branch}.`;
      } catch (err) {
        branchNote = ` Couldn't set the branch on ${noBranch.join(", ")}: ${err instanceof Error ? err.message : "unknown error"}.`;
      }
      // New array either way — the list re-checks coverage on it.
      setTickets((prev) => prev.map((t) => (filled.has(t.ticketNo) ? { ...t, location: branch } : t)));
      setNotice(alreadyAdded ? `ZIP ${zip} was already in coverage (added since this list loaded).${branchNote}` : `ZIP ${zip} added to ${branch} in Location Management.${branchNote}`);
      setAddZipFor(null);
    } catch (err) {
      setAddZipError(err instanceof Error ? err.message : "Couldn't add the ZIP.");
    } finally {
      setAddZipBusy(false);
    }
  };

  const setStatus = (ticketNo: string, status: string) =>
    setTickets((prev) => prev.map((t) => (t.ticketNo === ticketNo ? { ...t, status } : t)));

  const droppedNote = (status: string) => (isPendingStatus(status) ? "" : " It's no longer open, so it's off this list.");

  const changeStatus = async (t: Ticket, next: string) => {
    if (!next || next === t.status) return;
    if (next === "CL-Cancelled") {
      setCancelFor(t);
      setCancelReason("");
      setCancelError(null);
      return;
    }
    setStatusBusy(t.ticketNo);
    try {
      await updateTicketStatus(t.ticketNo, next);
      setStatus(t.ticketNo, next);
      window.dispatchEvent(new CustomEvent("ticket-data-updated", { detail: { ticketNo: t.ticketNo } }));
      setNotice(`${t.ticketNo} is now ${next}.${droppedNote(next)}`);
    } catch (err) {
      alert(`Failed to save status: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setStatusBusy(null);
    }
  };

  const saveCancel = async () => {
    if (!cancelFor) return;
    if (!cancelReason) { setCancelError("Pick the cancellation reason."); return; }
    setCancelBusy(true);
    setCancelError(null);
    try {
      await updateTicketStatus(cancelFor.ticketNo, "CL-Cancelled");
      setStatus(cancelFor.ticketNo, "CL-Cancelled");
      // Same as the ticket page: the reason goes in its own column.
      await updateTicketFields(cancelFor.ticketNo, { cancellationReason: cancelReason }).catch((e) => {
        alert(`${cancelFor.ticketNo} is cancelled, but its reason didn't save: ${e instanceof Error ? e.message : "Unknown error"}`);
      });
      window.dispatchEvent(new CustomEvent("ticket-data-updated", { detail: { ticketNo: cancelFor.ticketNo } }));
      setNotice(`${cancelFor.ticketNo} is now CL-Cancelled (${cancelReason}).${droppedNote("CL-Cancelled")}`);
      setCancelFor(null);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Couldn't cancel the ticket.");
    } finally {
      setCancelBusy(false);
    }
  };

  const exportToXlsx = () => {
    const data = filtered.map((t) => Object.fromEntries(COLUMNS.map((c) => [c.label, c.value(t)])));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "No-Coverage Tickets");
    XLSX.writeFile(workbook, `no-coverage-tickets_${todayISO()}.xlsx`);
  };

  const printList = () => {
    const th = (s: string) => `<th style="background:#1e40af;color:white;border:1px solid #1e40af;padding:5px;font-size:10px;text-align:left;">${escapeHtml(s)}</th>`;
    const td = (s: string) => `<td style="border:1px solid #e5e7eb;padding:5px;font-size:10px;">${escapeHtml(s)}</td>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>No-Coverage Tickets</title></head>
<body style="font-family:Arial,sans-serif;margin:16px;color:#111827;">
<h2 style="margin:0 0 4px;">No-Coverage Tickets</h2>
<p style="margin:0 0 12px;font-size:11px;color:#4b5563;">${filtered.length} records · printed ${escapeHtml(new Date().toLocaleString())}</p>
<table style="border-collapse:collapse;width:100%;"><thead><tr>${COLUMNS.map((c) => th(c.label)).join("")}</tr></thead>
<tbody>${filtered.map((t) => `<tr>${COLUMNS.map((c) => td(c.value(t))).join("")}</tr>`).join("")}</tbody></table>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
    win.onafterprint = () => win.close();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-white">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700">
            <ChevronLeft className="h-3.5 w-3.5" /> {mod.label}
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">No-Coverage Tickets</h1>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Open tickets whose ZIP isn&apos;t in our coverage (Location Management). Add the ZIP to a branch, or change the status (cancel as Out of Coverage / Not Covered).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && <p className="mb-2 text-xs text-rose-400">Error: {error}</p>}
        {notice && (
          <div className="mb-2 flex items-start justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-emerald-300 hover:text-emerald-100" aria-label="Dismiss">✕</button>
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
            <span className="text-sm">
              <span className="font-semibold text-blue-300">{filtered.length}</span> records found
              {lastLoadedAt && !loading && <span className="ml-2 text-[10px] text-slate-500">Loaded {lastLoadedAt.toLocaleTimeString()}</span>}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={printList} disabled={filtered.length === 0} title="Print" className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                <Printer className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={exportToXlsx} disabled={filtered.length === 0} title="Download Excel" className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                <Download className="h-3.5 w-3.5" />
              </button>
              <input
                type="search"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="search in result"
                className="w-56 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {loading && tickets.length === 0 ? (
            <div className="py-12"><BrandedLoader label="Loading tickets…" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    {COLUMNS.map((c) => (
                      <th key={c.label} className={`px-2 py-2 font-semibold text-slate-400 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
                    ))}
                    <th className="px-2 py-2 font-semibold text-slate-400 whitespace-nowrap text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} className="px-4 py-12 text-center text-slate-400">
                        {search.trim() ? "No tickets match this search." : "Every open ticket's ZIP is covered."}
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((t, i) => (
                      <tr key={t.ticketNo} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                        {COLUMNS.map((c, ci) => (
                          <td key={c.label} className={`px-2 py-1.5 whitespace-nowrap ${c.align === "right" ? "text-right" : ""} ${ci === 0 ? "" : "text-slate-300"}`}>
                            {ci === 0 ? (
                              <Link to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} className="font-mono text-blue-400 hover:underline">
                                {t.ticketNo}
                              </Link>
                            ) : c.label === "Status" ? (
                              <select
                                value={t.status}
                                disabled={statusBusy === t.ticketNo}
                                onChange={(e) => void changeStatus(t, e.target.value)}
                                title="Change this ticket's status"
                                className="max-w-[190px] rounded border border-white/15 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                              >
                                {/* Keep the current value selectable even if this list doesn't offer it. */}
                                {!statusOptions.includes(t.status) && <option value={t.status}>{t.status || "—"}</option>}
                                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            ) : (
                              c.value(t) || "—"
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openAddZip(t)}
                            disabled={!canAddZip || !hasZip(t.zip)}
                            title={
                              !hasZip(t.zip)
                                ? "This ticket has no ZIP — fix the customer's address on the ticket first"
                                : canAddZip
                                  ? `Add ZIP ${zip5(t.zip)} to a branch's coverage`
                                  : "Only people who can open Admin → Location Management can add ZIPs"
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-blue-400/40 bg-blue-600/20 px-2 py-0.5 text-xs font-semibold text-blue-200 hover:bg-blue-600/40 disabled:opacity-40 disabled:hover:bg-blue-600/20"
                          >
                            <MapPin className="h-3 w-3" /> Add ZIP
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-white/10 text-xs text-slate-400">
            <div className="flex items-center gap-1">
              {PAGE_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { setPageSize(n); setPage(1); }}
                  className={`rounded px-2 py-0.5 ${pageSize === n ? "bg-blue-600 text-white" : "text-blue-300 hover:bg-white/5"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <span>Page {pageSafe} of {pageCount}</span>
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} className="rounded border border-white/15 px-2 py-0.5 disabled:opacity-40">Prev</button>
                <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={pageSafe >= pageCount} className="rounded border border-white/15 px-2 py-0.5 disabled:opacity-40">Next</button>
              </div>
            )}
          </div>
        </div>
      </main>

      {addZipFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => { if (!addZipBusy) setAddZipFor(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-slate-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold">Add ZIP {zip5(addZipFor.zip)} to coverage</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              From ticket {addZipFor.ticketNo}{addZipFor.city ? ` · ${addZipFor.city}` : ""}{addZipFor.state ? `, ${addZipFor.state}` : ""}. Saved in Location Management → Covered Zip Codes.
            </p>
            <label className="mt-3 block text-[11px] uppercase tracking-wide text-slate-400">
              Branch <span className="text-rose-400">*</span>
              <select
                value={addZipBranch}
                onChange={(e) => setAddZipBranch(e.target.value)}
                className={`mt-1 w-full rounded-md border bg-slate-950 px-2 py-1.5 text-sm normal-case tracking-normal text-white focus:outline-none focus:border-blue-500 ${addZipBranch ? "border-white/15" : "border-rose-400/40"}`}
              >
                <option value="">— select branch —</option>
                {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className="mt-2 block text-[11px] uppercase tracking-wide text-slate-400">
              City
              <input
                value={addZipCity}
                onChange={(e) => setAddZipCity(e.target.value)}
                placeholder="City"
                className="mt-1 w-full rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-sm normal-case tracking-normal text-white focus:outline-none focus:border-blue-500"
              />
            </label>
            <p className="mt-2 text-[11px] text-slate-500">Open tickets with this ZIP and no branch get the branch too. Self-schedule and tier code can be set later in Location Management.</p>
            {addZipError && <p className="mt-2 text-xs text-rose-400">{addZipError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setAddZipFor(null)} disabled={addZipBusy} className="rounded-md border border-white/15 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void saveAddZip()} disabled={addZipBusy || !addZipBranch} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                {addZipBusy ? "Adding…" : "Add ZIP"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => { if (!cancelBusy) setCancelFor(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-slate-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold">Cancel ticket {cancelFor.ticketNo}</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Sets the status to CL-Cancelled. Currently {cancelFor.status || "—"}.</p>
            <label className="mt-3 block text-[11px] uppercase tracking-wide text-slate-400">
              Cancellation Reason <span className="text-rose-400">*</span>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className={`mt-1 w-full rounded-md border bg-slate-950 px-2 py-1.5 text-sm normal-case tracking-normal text-white focus:outline-none focus:border-blue-500 ${cancelReason ? "border-white/15" : "border-rose-400/40"}`}
              >
                <option value="">— select —</option>
                {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {cancelError && <p className="mt-2 text-xs text-rose-400">{cancelError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setCancelFor(null)} disabled={cancelBusy} className="rounded-md border border-white/15 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50">Back</button>
              <button type="button" onClick={() => void saveCancel()} disabled={cancelBusy || !cancelReason} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50">
                {cancelBusy ? "Cancelling…" : "Cancel ticket"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
