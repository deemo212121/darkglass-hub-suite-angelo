/**
 * Overall Expenses → "What's new": what the automatic Expense Records sync did
 * (lib/supabase/expenseRecordSync.ts), in three tabs —
 *   Synced          the bills it made or added to, newest first (NEW / UPDATED since
 *                   this viewer last looked); click a bill to see its records.
 *   Can't place     records whose destination (or employee's branch) isn't a branch,
 *                   grouped by that place, each with where to fix it (the Flash Tech
 *                   Calendar trip opens straight to its edit form).
 *   Typed by hand   lines the sync left alone because a bill was typed in already.
 */

import { Fragment, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { BRANCH_EXPENSE_LABEL, type BranchExpense } from "@/lib/branchExpenses";
import { EXPENSE_RECORDS_VENDOR, strayReason } from "@/lib/branchAutoFill";
import type { AutoSyncResult } from "@/lib/supabase/expenseRecordSync";
import { DAILY_MILEAGE_VENDOR, tripAmount } from "@/lib/mileageExpenseSync";
import type { MileageSyncResult } from "@/lib/supabase/mileageExpenseSync";

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ymd;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const PENDING = /\(pending\)$/;

/** Bills the syncs own (vendor "AHS Expense Records" / "AHS Daily Mileage"). */
export const syncedBills = (rows: BranchExpense[]) => rows.filter((b) => b.vendor === EXPENSE_RECORDS_VENDOR || b.vendor === DAILY_MILEAGE_VENDOR);
/** Synced bills changed after `since` (ISO). */
export const newSyncedBills = (rows: BranchExpense[], since: string) => syncedBills(rows).filter((b) => b.updatedAt > since);

type Tab = "synced" | "stray" | "mileage" | "manual";

const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const td = "whitespace-nowrap px-3 py-2";

export function ExpenseRecordsSyncModal({
  rows,
  since,
  result,
  mileage,
  syncing,
  syncError,
  onSyncNow,
  onClose,
  view,
  onEditRecord,
}: {
  rows: BranchExpense[];
  /** This viewer's last look (ISO) — newer bills are marked NEW. */
  since: string;
  result: AutoSyncResult | null;
  /** The Daily Mileage sync (approved trips → CarIQ / NON CarIQ Mileage Reimbursement). */
  mileage?: MileageSyncResult | null;
  syncing: boolean;
  syncError: string | null;
  onSyncNow: () => void;
  onClose: () => void;
  /** "synced" = the Synced button (bills only); "fix" = the Needs fixing button (Can't place + Typed by hand). */
  view: "synced" | "fix";
  /** Jump to the record in Expense Records (its tab), highlighted, with its edit form open. */
  onEditRecord?: (id: string, tab: "flashTech" | "employeeRequests") => void;
}) {
  const [tab, setTab] = useState<Tab>(() =>
    view === "synced" ? "synced"
    : (result?.stray.length ?? 0) > 0 ? "stray"
    : (mileage?.stray.length ?? 0) > 0 ? "mileage"
    : (result?.manual.length ?? 0) + (mileage?.manual.length ?? 0) > 0 ? "manual"
    : "stray");
  /** Synced bills opened to show their records. */
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  /** Can't-place groups folded shut (all open by default). */
  const [shutPlaces, setShutPlaces] = useState<Set<string>>(() => new Set());
  const flip = (set: Set<string>, key: string) => { const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); return next; };

  const bills = useMemo(() => syncedBills(rows).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [rows]);
  const fresh = bills.filter((b) => b.updatedAt > since);
  const list = bills;

  const stray = result?.stray ?? [];
  const mileageStray = mileage?.stray ?? [];
  /** Typed-by-hand lines from both syncs, in one list. */
  const manual = [
    ...(result?.manual ?? []).map((g) => ({ month: g.month, branch: g.branch, category: g.category, count: g.records.length, unit: "record", total: g.total, billAmounts: g.billAmounts })),
    ...(mileage?.manual ?? []).map((g) => ({ month: g.month, branch: g.branch, category: g.category, count: g.trips.length, unit: "approved trip", total: g.total, billAmounts: g.billAmounts })),
  ];
  /** Can't-place records grouped by the place that isn't a branch, biggest group first. */
  const strayGroups = useMemo(() => {
    const m = new Map<string, AutoSyncResult["stray"]>();
    for (const r of stray) {
      const k = strayReason(r).text;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [stray]);

  // Synced has no tabs; Needs fixing has its two.
  const tabs: { key: Tab; label: string; count: number; warn?: boolean }[] = view === "synced" ? [] : [
    { key: "stray", label: "Can't place", count: stray.length, warn: true },
    { key: "mileage", label: "Mileage", count: mileageStray.length, warn: true },
    { key: "manual", label: "Typed by hand", count: manual.length, warn: true },
  ];

  const syncedTab = (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-3 py-2 text-xs">
        <span className="text-slate-300">
          {plural(bills.length, "synced bill")}
          {fresh.length > 0 && <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">{fresh.length} NEW</span>}
        </span>
        {list.length > 0 && (
          <button type="button" onClick={() => setOpenIds(openIds.size ? new Set() : new Set(list.map((b) => b.id)))} className="ml-auto font-semibold text-sky-300 hover:underline">
            {openIds.size ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>
      {!list.length ? (
        <p className="p-8 text-center text-sm text-slate-400">No synced bills yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr>
              <th className={th}>Synced</th>
              <th className={th}>Month</th>
              <th className={th}>Branch</th>
              <th className={th}>Line</th>
              <th className={th}>Records</th>
              <th className={`${th} text-right`}>Bill amount</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => {
              const isNew = b.updatedAt > since;
              const open = openIds.has(b.id);
              const lines = [...b.lineItems].sort((x, y) => x.date.localeCompare(y.date) || x.driver.localeCompare(y.driver));
              const records = lines.filter((l) => l.sourceId).length;
              return (
                <Fragment key={b.id}>
                  <tr onClick={() => setOpenIds(flip(openIds, b.id))} aria-expanded={open} className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${open ? "bg-white/[0.04]" : ""}`}>
                    <td className={`${td} text-slate-400`}>
                      {open ? <ChevronDown className="mr-1.5 inline h-3.5 w-3.5 text-slate-300" /> : <ChevronRight className="mr-1.5 inline h-3.5 w-3.5 text-slate-500" />}
                      {isNew && (
                        <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${b.createdAt > since ? "bg-emerald-500/20 text-emerald-300" : "bg-sky-500/20 text-sky-300"}`}>
                          {b.createdAt > since ? "NEW" : "UPDATED"}
                        </span>
                      )}
                      {when(b.updatedAt)}
                    </td>
                    <td className={`${td} text-slate-300`}>{monthLabel(b.expenseDate.slice(0, 7))}</td>
                    <td className={`${td} font-medium text-white`}>{b.branch}</td>
                    <td className={`${td} text-slate-300`}>{BRANCH_EXPENSE_LABEL[b.category] ?? b.category}</td>
                    <td className={`${td} text-slate-400`}>{plural(records, "record")}</td>
                    <td className={`${td} text-right font-mono text-emerald-300`}>{fmtMoney(b.amount)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} className="bg-slate-950/50 px-4 pb-3 pt-1">
                        {!lines.length ? (
                          <p className="py-2 text-[11px] text-slate-500">No transactions saved on this bill.</p>
                        ) : (
                          <table className="w-full overflow-hidden rounded-md border border-white/10 text-[11px]">
                            <thead className="bg-slate-800/60">
                              <tr>
                                <th className={th}>Date</th>
                                <th className={th}>Employee</th>
                                <th className={th}>Type</th>
                                <th className={th}>Description</th>
                                <th className={th}>Trip / dates</th>
                                <th className={`${th} text-right`}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((l, i) => (
                                <tr key={l.sourceId ?? i} className="border-t border-white/5">
                                  <td className={`${td} py-1.5 text-slate-300`}>{shortDate(l.date)}</td>
                                  <td className={`${td} py-1.5 font-medium text-white`}>{l.driver || "—"}</td>
                                  <td className={`${td} py-1.5 text-slate-300`}>
                                    {l.service.replace(/ \(pending\)$/, "") || "—"}
                                    {PENDING.test(l.service) && <span className="ml-1.5 rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-300">Pending</span>}
                                  </td>
                                  <td className="max-w-[22rem] truncate px-3 py-1.5 text-slate-400" title={l.merchant}>{l.merchant || "—"}</td>
                                  <td className="max-w-[22rem] truncate px-3 py-1.5 text-slate-400" title={l.address}>{l.address || "—"}</td>
                                  <td className={`${td} py-1.5 text-right font-mono text-emerald-300`}>{fmtMoney(l.amount)}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-white/10 bg-slate-800/40 font-semibold">
                                <td colSpan={5} className="px-3 py-1.5 text-right text-slate-400">Total · {plural(lines.length, "record")}</td>
                                <td className={`${td} py-1.5 text-right font-mono text-emerald-300`}>{fmtMoney(lines.reduce((t, l) => t + l.amount, 0))}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );

  const strayTab = !stray.length ? (
    <p className="p-8 text-center text-sm text-slate-400">Every record has a branch. Nothing to fix.</p>
  ) : (
    <>
      <p className="flex items-start gap-2 border-b border-white/10 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
        <span>
          These {plural(stray.length, "record")} ({fmtMoney(stray.reduce((s, r) => s + r.amount, 0))}) aren't in any bill yet. Each group says what's wrong; fix it where the last column says and the next sync picks them up.
          (Spacing and small typos are matched on their own — "Jackson, MS" = Jackson,MS, "Talahasse" = Tallahassee.)
        </span>
      </p>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-slate-900">
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Employee</th>
            <th className={th}>Type</th>
            <th className={th}>Employee's branch</th>
            <th className={th}>Destination</th>
            <th className={`${th} text-right`}>Amount</th>
            <th className={th}>Where to fix</th>
          </tr>
        </thead>
        <tbody>
          {strayGroups.map(([place, recs]) => {
            const shut = shutPlaces.has(place);
            return (
              <Fragment key={place}>
                <tr onClick={() => setShutPlaces(flip(shutPlaces, place))} aria-expanded={!shut} className="cursor-pointer border-t border-white/10 bg-amber-500/[0.07] hover:bg-amber-500/10">
                  <td colSpan={5} className="px-3 py-2">
                    {shut ? <ChevronRight className="mr-1.5 inline h-3.5 w-3.5 text-amber-300" /> : <ChevronDown className="mr-1.5 inline h-3.5 w-3.5 text-amber-300" />}
                    <span className="font-semibold text-amber-200">{place}</span>
                    <span className="ml-2 text-slate-400">{plural(recs.length, "record")}</span>
                  </td>
                  <td className={`${td} text-right font-mono font-semibold text-emerald-300`}>{fmtMoney(recs.reduce((s, r) => s + r.amount, 0))}</td>
                  <td />
                </tr>
                {!shut && recs.map((r) => {
                  const bad = strayReason(r).field;
                  return (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className={`${td} pl-9 text-slate-300`}>{shortDate(r.expenseDate)}</td>
                    <td className={`${td} font-medium text-white`}>{r.person}</td>
                    <td className={`${td} text-slate-300`}>{r.reimbursementType || r.category}</td>
                    <td className={`${td} ${bad === "branch" ? "font-semibold text-red-300" : "text-slate-400"}`}>{r.branch || "— none —"}</td>
                    <td className={`${td} ${bad === "destination" ? "font-semibold text-red-300" : "text-slate-500"}`}>{r.destination?.trim() || "—"}</td>
                    <td className={`${td} text-right font-mono text-emerald-300`}>{fmtMoney(r.amount)}</td>
                    <td className={`${td} flex items-center gap-2`}>
                      {onEditRecord && bad === "destination" && (
                        <button
                          type="button"
                          onClick={() => onEditRecord(r.id, r.recordTab ?? "employeeRequests")}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 font-semibold text-amber-200 hover:bg-amber-500/30"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      )}
                      {r.flashTechTripId ? (
                        <a
                          href={`/m/dashboard/flash-tech-calendar?trip=${r.flashTechTripId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-1 font-semibold text-sky-300 hover:bg-sky-500/25"
                        >
                          Open trip on Flash Tech Calendar <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : bad === "destination" ? (
                        onEditRecord ? null : <span className="text-slate-400">Expense Records → this record's destination</span>
                      ) : (
                        <span className="text-slate-400">User Management → {r.person}'s branch</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );

  const mileageTab = !mileageStray.length ? (
    <p className="p-8 text-center text-sm text-slate-400">Every approved mileage trip is in a bill. Nothing to fix.</p>
  ) : (
    <>
      <p className="flex items-start gap-2 border-b border-white/10 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
        <span>
          These {plural(mileageStray.length, "approved Daily Mileage trip")} aren't in a CarIQ / NON CarIQ Mileage bill yet. The red column is what's missing; fix it where the last column says and the next sync picks them up.
        </span>
      </p>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-slate-900">
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Technician</th>
            <th className={th}>Car IQ</th>
            <th className={`${th} text-right`}>Miles</th>
            <th className={th}>Trip branch</th>
            <th className={th}>Tech's branch</th>
            <th className={`${th} text-right`}>Amount</th>
            <th className={th}>What's wrong · where to fix</th>
          </tr>
        </thead>
        <tbody>
          {mileageStray.map(({ trip: t, reason, fix }) => (
            <tr key={t.id} className="border-t border-white/5">
              <td className={`${td} text-slate-300`}>{shortDate(t.workDate)}</td>
              <td className={`${td} font-medium text-white`}>{t.person}</td>
              <td className={`${td} ${fix === "carIq" ? "font-semibold text-red-300" : "text-slate-400"}`}>{t.hasCarIq == null ? "— not set —" : t.hasCarIq ? "CarIQ" : "NON CarIQ"}</td>
              <td className={`${td} text-right font-mono text-slate-300`}>{t.eligibleMiles}</td>
              <td className={`${td} ${fix === "trip" && t.tripBranch ? "font-semibold text-red-300" : "text-slate-400"}`}>{t.tripBranch || "—"}</td>
              <td className={`${td} ${fix === "branch" ? "font-semibold text-red-300" : "text-slate-400"}`}>{t.homeBranch || "— none —"}</td>
              <td className={`${td} text-right font-mono text-emerald-300`}>{t.rate == null ? "—" : fmtMoney(tripAmount(t))}</td>
              <td className="px-3 py-2">
                <div className="font-semibold text-amber-200">{reason}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-slate-400">
                  {fix === "carIq" ? (
                    <span>Accounting → Car IQ → set {t.person}'s Car IQ</span>
                  ) : fix === "branch" ? (
                    <span>User Management → {t.person}'s branch, or type the branch on the trip</span>
                  ) : null}
                  <a
                    href={`/m/accounting/daily-mileage`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-300 hover:bg-sky-500/25"
                  >
                    Open Daily Mileage <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const manualTab = !manual.length ? (
    <p className="p-8 text-center text-sm text-slate-400">Nothing left alone.</p>
  ) : (
    <>
      <p className="flex items-start gap-2 border-b border-white/10 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
        <span>A bill was typed in by hand for these, so the records / trips weren't added (no double count). If they should be used instead, delete the typed bill — the next sync adds them.</span>
      </p>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-slate-900">
          <tr>
            <th className={th}>Month</th>
            <th className={th}>Branch</th>
            <th className={th}>Line</th>
            <th className={th}>Records</th>
            <th className={`${th} text-right`}>Records total</th>
            <th className={`${th} text-right`}>Typed bill</th>
          </tr>
        </thead>
        <tbody>
          {manual.map((g) => (
            <tr key={`${g.month}|${g.branch}|${g.category}`} className="border-t border-white/5">
              <td className={`${td} text-slate-300`}>{monthLabel(g.month)}</td>
              <td className={`${td} font-medium text-white`}>{g.branch}</td>
              <td className={`${td} text-slate-300`}>{BRANCH_EXPENSE_LABEL[g.category]}</td>
              <td className={`${td} text-slate-400`}>{plural(g.count, g.unit)}</td>
              <td className={`${td} text-right font-mono text-emerald-300`}>{fmtMoney(g.total)}</td>
              <td className={`${td} text-right font-mono text-amber-300`}>{g.billAmounts.map(fmtMoney).join(" + ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="whatsnew-title" className="flex h-[90vh] w-full max-w-6xl flex-col rounded-lg border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            {view === "synced" ? (
              <>
                <h3 id="whatsnew-title" className="flex items-center gap-2 text-lg font-bold text-white"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Synced from Expense Records &amp; Daily Mileage</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Syncs into Branch Bills automatically when this page opens — Hotel, Food, Car Rental, Gas and Office Supplies from Expense Records, and approved Daily Mileage trips
                  as CarIQ / NON CarIQ Mileage Reimbursement (Car IQ and rate from that day, like payroll). One bill per branch, month and line; nothing is added twice. Click a bill to see what's in it.
                </p>
              </>
            ) : (
              <>
                <h3 id="whatsnew-title" className="flex items-center gap-2 text-lg font-bold text-white"><AlertTriangle className="h-4 w-4 text-red-400" /> Needs fixing</h3>
                <p className="mt-0.5 text-xs text-slate-400">Expense Records and approved mileage trips the sync couldn't put in a bill, and why. Fix them at the source — the next sync picks them up.</p>
              </>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {/* Status + Sync now */}
        <div className="flex flex-wrap items-center gap-3 px-6 pt-3 text-xs">
          {syncing ? (
            <span className="text-slate-300"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Syncing…</span>
          ) : syncError ? (
            <span className="text-red-300">Sync failed: {syncError}</span>
          ) : result || mileage ? (
            <span className="text-emerald-300">
              {[
                result?.saved ? `Expense Records: ${plural(result.records, "record")} into ${plural(result.saved, "bill")}` : "",
                mileage?.saved ? `Daily Mileage: ${plural(mileage.saved, "mileage bill")} made or updated` : "",
              ].filter(Boolean).join(" · ") || "Up to date — nothing new."}
            </span>
          ) : null}
          <button type="button" onClick={onSyncNow} disabled={syncing} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
            <RefreshCw className="h-3 w-3" /> Sync now
          </button>
        </div>

        {/* Tabs (Needs fixing only) */}
        {tabs.length > 0 && (
        <div role="tablist" className="mt-3 flex gap-1 border-b border-white/10 px-6">
          {tabs.map((t) => {
            const active = tab === t.key;
            const badge = t.count > 0 ? (t.warn ? "bg-red-500 text-white" : "bg-emerald-500/20 text-emerald-300") : "bg-slate-700/60 text-slate-400";
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${active ? "border-emerald-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
              >
                {t.warn && t.count > 0 && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                {t.label}
                <span className={`rounded-full px-1.5 text-[11px] leading-5 ${badge}`}>{t.count}</span>
              </button>
            );
          })}
        </div>
        )}

        {/* Tab body — takes the rest of the height and scrolls on its own */}
        <div className={`min-h-0 flex-1 overflow-auto px-6 py-4 ${tabs.length ? "" : "mt-1"}`}>
          {/* No overflow-hidden here — it would stop the sticky table headers. */}
          <div className="rounded-lg border border-white/10">
            {tab === "synced" ? syncedTab : tab === "stray" ? strayTab : tab === "mileage" ? mileageTab : manualTab}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
