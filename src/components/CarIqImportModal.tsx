/**
 * Other Expenses → Import Car IQ. Pick Car IQ's transaction report (.xlsx);
 * every transaction's TOTAL (USD) is summed by the driver's branch and saved
 * as one CarIQ Transactions bill per branch per month — a report that
 * crosses months is split by each transaction's date (Oct 14–31 → October,
 * Nov 1–13 → November), with the report attached. Each driver's branch is
 * shown first — from their profile, or guessed from where they fueled — and
 * can be changed before saving. See lib/carIqImport.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, MapPin, X } from "lucide-react";
import { getCompanyUsersLite } from "@/lib/supabase/users";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { uploadExpenseReceipt } from "@/lib/firebase/storage";
import type { BranchExpense, BranchExpenseFile } from "@/lib/branchExpenses";
import { addBranchExpense, deleteBranchExpense, setBranchExpenseReceipts } from "@/lib/supabase/branchExpenses";
import {
  groupByDriver,
  looksLikeCarIqReport,
  parseCarIqReport,
  titleCase,
  totalsByBranchAndMonth,
  type CarIqDriverRow,
  type CarIqPerson,
  type CarIqReport,
} from "@/lib/carIqImport";

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDay = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** "2026-10" → "October 2026". */
const monthName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

const PLACES = LOCATIONS_DATA.map((l) => ({ branch: l.location, city: l.city, state: l.state }));

export function CarIqImportModal({
  companyId,
  existing,
  branchSuggestions,
  onClose,
  onSaved,
}: {
  companyId: string | null;
  /** Every saved bill — to spot a report already imported for the same period. */
  existing: BranchExpense[];
  branchSuggestions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<CarIqReport | null>(null);
  const [people, setPeople] = useState<CarIqPerson[] | null>(null);
  const [drivers, setDrivers] = useState<CarIqDriverRow[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getCompanyUsersLite()
      .then((rows) => setPeople(rows.map((p) => ({ name: p.display_name || p.username || p.email || "", branch: p.assigned_branch || "", isActive: p.is_active !== false }))))
      .catch(() => setPeople([]));
  }, []);

  const read = async (f: File) => {
    setFile(f);
    setReport(null);
    setDrivers([]);
    setReadError(null);
    setReading(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const allName = wb.SheetNames.find((n) => n.trim().toUpperCase() === "ALL") ?? wb.SheetNames.find((n) => n.trim().toUpperCase() === "FUEL");
      const all = allName ? wb.Sheets[allName] : null;
      const header = all ? (XLSX.utils.sheet_to_json<unknown[]>(all, { header: 1, defval: "" })[0] ?? []) : [];
      if (!all || !looksLikeCarIqReport(header)) throw new Error("This doesn't look like Car IQ's transaction report — it needs an ALL sheet with DRIVER and TOTAL columns.");
      const summaryName = wb.SheetNames.find((n) => n.trim().toUpperCase() === "SUMMARY");
      const summary = summaryName ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[summaryName], { header: 1, defval: "" }) : [];
      const r = parseCarIqReport(summary, XLSX.utils.sheet_to_json<Record<string, unknown>>(all, { defval: "" }));
      if (r.transactions.length === 0) throw new Error("No USD transactions found in the report.");
      setReport(r);
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  // Match drivers once both the report and the people list are in.
  useEffect(() => {
    if (report && people) setDrivers(groupByDriver(report, people, PLACES));
  }, [report, people]);

  // One bill per branch per month — Oct 14–31 goes to October, Nov 1–13 to November.
  const totals = useMemo(() => {
    if (!report) return [];
    const branchOf = new Map(drivers.map((d) => [d.driver, d.branch]));
    return totalsByBranchAndMonth(report, (driver) => branchOf.get(driver) ?? "");
  }, [report, drivers]);
  const months = Array.from(new Set(totals.map((t) => t.month)));
  const grandTotal = drivers.reduce((s, d) => s + d.total, 0);
  const txCount = drivers.reduce((s, d) => s + d.count, 0);
  const missingBranch = drivers.filter((d) => !d.branch);
  // Car IQ bills already saved for any part of this report's dates.
  const already = report
    ? existing.filter((e) =>
        e.category === "cariq_transactions" &&
        !!e.periodStart && !!e.periodEnd &&
        (!report.periodEnd || e.periodStart <= report.periodEnd) &&
        (!report.periodStart || e.periodEnd >= report.periodStart))
    : [];

  const problem =
    !report ? null
    : missingBranch.length ? `Pick a branch for ${missingBranch.length} driver${missingBranch.length === 1 ? "" : "s"} first.`
    : already.length && !replace ? `Part of these dates was already imported (${already.length} bill${already.length === 1 ? "" : "s"}). Tick "Replace" to import it again.`
    : null;

  const setBranch = (driver: string, branch: string) =>
    setDrivers((prev) => prev.map((d) => (d.driver === driver ? { ...d, branch, source: branch ? "manual" : "none" } : d)));

  const save = async () => {
    if (!report || problem || saving || !file) return;
    if (!companyId) { setSaveError("No company — sign in again."); return; }
    setSaveError(null);
    setSaving({ done: 0, total: totals.length });
    const ids: string[] = [];
    try {
      if (replace) for (const e of already) await deleteBranchExpense(e.id);
      for (const t of totals) {
        const who = t.drivers.map((d) => `${titleCase(d.driver)} ${fmtMoney(d.total)} (${d.count})`).join(", ");
        ids.push(await addBranchExpense({
          branch: t.branch,
          category: "cariq_transactions",
          otherLabel: "",
          vendor: "Car IQ",
          amount: t.total,
          // The month the transactions were made in (saved as its 1st, like every bill).
          expenseDate: `${t.month}-01`,
          periodStart: t.periodStart,
          periodEnd: t.periodEnd,
          notes: `Car IQ fuel card ${fmtDay(t.periodStart)} – ${fmtDay(t.periodEnd)} · ${t.count} transaction${t.count === 1 ? "" : "s"} · ${who}`,
          receipts: [],
        }, t.transactions.map((x) => ({
          date: x.date,
          time: x.time,
          driver: titleCase(x.driver),
          vehicle: x.vehicle,
          service: x.service,
          merchant: x.merchant,
          address: x.address,
          amount: x.total,
        }))));
        setSaving({ done: ids.length, total: totals.length });
      }
      // The report itself, attached to every bill it made.
      const r = await uploadExpenseReceipt(companyId, `branch-${ids[0]}`, file);
      const attached: BranchExpenseFile[] = [{ url: r.url, path: r.fullPath, name: file.name }];
      for (const id of ids) await setBranchExpenseReceipts(id, attached);
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(ids.length ? `Saved ${ids.length} of ${totals.length} bills, then: ${msg}. Close and check the list before importing again.` : msg);
      setSaving(null);
    }
  };

  const SOURCE: Record<CarIqDriverRow["source"], { text: string; cls: string }> = {
    profile: { text: "From profile", cls: "text-green-300" },
    station: { text: "Guessed from fuel stations", cls: "text-amber-300" },
    manual: { text: "Picked here", cls: "text-blue-300" },
    none: { text: "Pick a branch", cls: "text-red-300" },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="cariq-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col rounded-lg border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 id="cariq-title" className="text-lg font-bold text-white">Import Car IQ</h3>
            <p className="text-xs text-slate-400">Car IQ's transaction report (.xlsx). Each transaction's TOTAL (USD) is added up per branch and saved under <span className="text-slate-200">CarIQ Transactions</span>.</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!saving} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/20 bg-white/[0.02] px-4 py-3 hover:border-blue-500/60">
            <FileSpreadsheet className="h-6 w-6 shrink-0 text-emerald-300" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-white">{file ? file.name : "Choose the Car IQ report"}</span>
              <span className="block text-xs text-slate-500">e.g. US_APPLIANCE,_INC._.TRX.20261014_20261113.xlsx</span>
            </span>
            <span className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white">{file ? "Change file" : "Choose file"}</span>
            <input type="file" accept=".xlsx,.xls" className="sr-only" disabled={!!saving} onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
          </label>

          {reading && <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Reading the report…</p>}
          {readError && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{readError}</p>}

          {report && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Period", `${fmtDay(report.periodStart)} – ${fmtDay(report.periodEnd)}`],
                  ["Transactions", txCount.toLocaleString()],
                  ["Drivers", drivers.length.toLocaleString()],
                  ["Total (USD)", fmtMoney(grandTotal)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-white/10 bg-slate-800/40 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</p>
                    <p className="text-sm font-semibold tabular-nums text-white">{v}</p>
                  </div>
                ))}
              </div>
              {report.skipped > 0 && <p className="text-xs text-slate-500">{report.skipped} row{report.skipped === 1 ? "" : "s"} skipped (not USD or no TOTAL).</p>}

              {/* Drivers → branch */}
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Driver</th>
                      <th className="px-3 py-2 text-right font-semibold">Transactions</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      <th className="px-3 py-2 font-semibold">Branch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!people ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin" /> Matching drivers…</td></tr>
                    ) : drivers.map((d) => (
                      <tr key={d.driver} className={`border-t border-white/5 ${d.branch ? "" : "bg-red-500/[0.06]"}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-white">{titleCase(d.driver)}</p>
                          {d.matchedName && titleCase(d.matchedName) !== titleCase(d.driver) && <p className="text-[11px] text-slate-500">Matched to {d.matchedName}</p>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-300">{d.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">{fmtMoney(d.total)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={d.branch}
                              onChange={(e) => setBranch(d.driver, e.target.value)}
                              aria-label={`Branch for ${titleCase(d.driver)}`}
                              className="rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                            >
                              <option value="">Pick a branch…</option>
                              {Array.from(new Set([...branchSuggestions, ...(d.branch ? [d.branch] : [])])).sort((a, b) => a.localeCompare(b)).map((b) => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <span className={`inline-flex items-center gap-1 text-[11px] ${SOURCE[d.source].cls}`}>
                              {d.source === "station" ? <MapPin className="h-3 w-3" /> : d.source === "none" ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                              {SOURCE[d.source].text}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* What will be saved — one block per month the transactions fall in */}
              {totals.length > 0 && (
                <div className="space-y-3 rounded-lg border border-white/10 bg-slate-800/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Will be saved under CarIQ Transactions{months.length > 1 ? ` — split into ${months.length} months by each transaction's date` : ""}
                  </p>
                  {months.map((m) => {
                    const list = totals.filter((t) => t.month === m);
                    const first = list[0];
                    return (
                      <div key={m}>
                        <p className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span className="font-semibold text-white">{monthName(m)}</span>
                          <span className="text-xs text-slate-400">
                            {fmtDay(first.periodStart)} – {fmtDay(first.periodEnd)} · <span className="font-semibold tabular-nums text-white">{fmtMoney(list.reduce((s, t) => s + t.total, 0))}</span>
                          </span>
                        </p>
                        <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                          {list.map((t) => (
                            <div key={t.branch} className="flex justify-between text-sm tabular-nums">
                              <span className="text-slate-300">{t.branch} <span className="text-slate-500">· {t.count}</span></span>
                              <span className="text-white">{fmtMoney(t.total)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {already.length > 0 && (
                <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <input type="checkbox" className="mt-0.5" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                  <span>Part of these dates ({fmtDay(report.periodStart)} – {fmtDay(report.periodEnd)}) was already imported — {already.length} CarIQ Transactions bill{already.length === 1 ? "" : "s"}. <strong>Replace</strong> them with this report.</span>
                </label>
              )}
            </>
          )}

          {(saveError || problem) && <p className={`text-xs ${saveError ? "text-red-300" : "text-slate-400"}`}>{saveError ?? problem}</p>}
        </div>

        <div className="flex gap-3 border-t border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={save}
            disabled={!report || !people || !!problem || !!saving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving {saving.done} of {saving.total}…</> : totals.length ? `Save ${fmtMoney(grandTotal)} — ${totals.length} bill${totals.length === 1 ? "" : "s"}${months.length > 1 ? ` across ${months.length} months` : ""}` : "Save"}
          </button>
          <button type="button" onClick={onClose} disabled={!!saving} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
        </div>
      </div>
    </div>
  );
}
