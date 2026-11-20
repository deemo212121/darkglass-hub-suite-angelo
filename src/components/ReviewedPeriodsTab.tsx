import { reviewedPeriodSyncAmounts } from "@/lib/reviewedPeriodSync";
import { ReviewedWeeklyBreakdown } from "./ReviewedWeeklyBreakdown";
import type { ReviewedWeeklySource } from "@/lib/reviewedWeeklyBreakdown";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deletePayrollReviewBreakdown,
  getPayrollReviewBreakdowns,
  getPayrollReviewPeriods,
  reviewBreakdownTotal,
  updatePayrollReviewBreakdown,
  upsertPayrollReviewBreakdown,
  type PayrollReviewAmounts,
  type PayrollReviewBreakdown,
} from "@/lib/supabase/payrollReviewBreakdowns";
import { reviewedPeriodDetails, type ReviewedPeriodDetailSource } from "@/lib/reviewedPeriodDetails";
import { ReviewedPeriodsExportDialog } from "./ReviewedPeriodsExportDialog";
import type { ReviewedExportEntry } from "@/lib/reviewedPeriodsExcel";
import { formatISODate } from "@/lib/localDate";
import { getTechTaxLinesForPeriod, taxLineAmount, type TechTaxLine } from "@/lib/supabase/techTaxLines";

/** A technician who can be added to the period by hand. */
export interface ReviewedPeriodPerson {
  id: string;
  name: string;
  branch: string;
}

// Finance's payroll-summary format, in column order. `sub` is the
// "Including …" line under each header.
const COLUMNS: { key: keyof PayrollReviewAmounts; label: string; sub?: string[]; subtract?: boolean }[] = [
  { key: "regularPay", label: "Regular Hours $", sub: ["Including State reg match $"] },
  { key: "otPay", label: "OT Hours $", sub: ["Including OT premium match $"] },
  { key: "bonus", label: "Bonus (Commission)", sub: ["Including LTP", "Including Performance"] },
  { key: "commission", label: "Commission" },
  { key: "ptoPay", label: "PTO $" },
  { key: "deduction", label: "(−) Deduction", subtract: true },
  { key: "mileageOtherReimb", label: "(+) Mileage + Other reim", sub: ["Including FT mileage"] },
  { key: "pretaxInsurance", label: "(−) Pre-Tax Ins", subtract: true },
  { key: "salaryMatch", label: "Salary Match Needed $" },
];

const ZERO: PayrollReviewAmounts = {
  regularPay: 0, otPay: 0, bonus: 0, commission: 0, ptoPay: 0, deduction: 0, mileageOtherReimb: 0, pretaxInsurance: 0, salaryMatch: 0,
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Accounting Dashboard → Reviewed Periods: one row per technician for the
 * selected pay period, in Finance's summary format. Rows are snapshotted
 * when Finance clicks Done in the Tech Activity Report, then synchronized
 * from actual payroll. Manually added rows remain editable (migration 0392).
 */
export function ReviewedPeriodsTab({
  periodStart: dashboardStart,
  periodEnd: dashboardEnd,
  people,
  myProfileId,
  myName,
  actualTotals,
  actualBreakdowns,
  actualDetails,
  actualWeeklySources,
  onOpenEmployee,
  actualTotalsLoading,
  onPeriodChange,
}: {
  periodStart: string;
  periodEnd: string;
  people: ReviewedPeriodPerson[];
  myProfileId: string | null;
  myName: string | null;
  /** Each technician's actual Gross Pay from the Payroll page, for the dashboard's current period. */
  actualTotals: Map<string, number>;
  /** The same actual pay split into this tab's columns, live from the timecard and Tech Activity Report. */
  actualBreakdowns: Map<string, PayrollReviewAmounts>;
  /** Individual reimbursement/deduction lines for the dashboard period. */
  actualDetails: Map<string, ReviewedPeriodDetailSource>;
  actualWeeklySources: Map<string, ReviewedWeeklySource>;
  /** Opens the existing Payroll review wizard, for this exact employee and cutoff. */
  onOpenEmployee: (profileId: string, start: string, end: string) => void;
  actualTotalsLoading: boolean;
  /** Switches the dashboard's period so actualTotals covers the period picked here. */
  onPeriodChange: (start: string, end: string) => void;
}) {
  // Periods that have saved rows, plus the dashboard's current period —
  // picked here so a reviewed period is reachable without changing the
  // Payroll tab's own period.
  const [periods, setPeriods] = useState<{ periodStart: string; periodEnd: string; count: number }[]>([]);
  const [selected, setSelected] = useState<string>("");
  const selectedRef = useRef("");
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const dashboardKey = dashboardStart && dashboardEnd ? `${dashboardStart}|${dashboardEnd}` : "";
  const loadPeriods = useCallback(async () => {
    try {
      const list = await getPayrollReviewPeriods();
      setPeriods(list);
      if (!selectedRef.current) {
        const pick = list.some((p) => `${p.periodStart}|${p.periodEnd}` === dashboardKey) ? dashboardKey : list[0] ? `${list[0].periodStart}|${list[0].periodEnd}` : dashboardKey;
        selectedRef.current = pick;
        setSelected(pick);
        // Bring the Payroll page to the same period so its actual totals load.
        if (pick && pick !== dashboardKey) { const [s0, e0] = pick.split("|"); onPeriodChange(s0, e0); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reviewed periods.");
      setSelected((cur) => cur || dashboardKey);
    }
  }, [dashboardKey]);
  useEffect(() => { void loadPeriods(); }, [loadPeriods]);
  const periodOptions = useMemo(() => {
    const opts = periods.map((p) => ({ key: `${p.periodStart}|${p.periodEnd}`, start: p.periodStart, end: p.periodEnd, count: p.count }));
    if (dashboardKey && !opts.some((o) => o.key === dashboardKey)) opts.unshift({ key: dashboardKey, start: dashboardStart, end: dashboardEnd, count: 0 });
    return opts;
  }, [periods, dashboardKey, dashboardStart, dashboardEnd]);
  const [periodStart, periodEnd] = (selected || dashboardKey || "|").split("|");
  // Total = the technician's ACTUAL pay (Payroll page Gross Pay), not just
  // the sum of the summary columns — available once the dashboard is on the
  // same period and finished loading. Until then the columns' sum is shown.
  const actualReady = !!selected && selected === dashboardKey && !actualTotalsLoading;
  const totalOf = (r: PayrollReviewBreakdown) => {
    const actual = actualReady ? actualTotals.get(r.profileId) : undefined;
    return actual ?? reviewBreakdownTotal(r);
  };
  const isActual = (r: PayrollReviewBreakdown) => actualReady && actualTotals.has(r.profileId);
  // Total is NET pay — the Tech Activity Report's Net Pay After Tax: gross
  // (totalOf) less the report's tax lines (MCWH / SSWH / FITW / SITW,
  // migration 0395), each worked out the same way the report does.
  const [taxLinesByProfile, setTaxLinesByProfile] = useState<Map<string, Pick<TechTaxLine, "label" | "mode" | "amount">[]>>(new Map());
  const taxLinesOf = (r: PayrollReviewBreakdown) => {
    const gross = totalOf(r);
    return (taxLinesByProfile.get(r.profileId) ?? []).map((l) => ({ label: l.label || "Tax", amount: taxLineAmount(l, gross) }));
  };
  const taxesOf = (r: PayrollReviewBreakdown) => Math.round(taxLinesOf(r).reduce((s0, l) => s0 + l.amount, 0) * 100) / 100;
  const netOf = (r: PayrollReviewBreakdown) => Math.round((totalOf(r) - taxesOf(r)) * 100) / 100;
  /** Actual total − what the saved columns add up to; null until the actual total is known. */
  const notInColumns = (r: PayrollReviewBreakdown): number | null => {
    if (!isActual(r)) return null;
    const d = Math.round((totalOf(r) - reviewBreakdownTotal(r)) * 100) / 100;
    return Math.abs(d) < 0.01 ? 0 : d;
  };
  /** Live column values rounded to the cent — what Update writes into the row. */
  const liveAmounts = (r: PayrollReviewBreakdown): PayrollReviewAmounts | null => {
    const live = actualReady ? actualBreakdowns.get(r.profileId) : undefined;
    if (!live) return null;
    const out = { ...ZERO };
    for (const c of COLUMNS) out[c.key] = Math.round(live[c.key] * 100) / 100;
    return out;
  };
  /** Which columns moved since the row was saved, e.g. "Regular Hours $: $442.64 → $635.28". */
  const changedColumns = (r: PayrollReviewBreakdown): string[] => {
    const live = liveAmounts(r);
    if (!live) return [];
    return COLUMNS.filter((c) => Math.abs(live[c.key] - r[c.key]) >= 0.01).map((c) => `${c.label}: ${money(r[c.key])} → ${money(live[c.key])}`);
  };
  const syncRow = async (row: PayrollReviewBreakdown) => {
    const live = liveAmounts(row);
    if (!live) return;
    setSavingKey(`${row.id}:sync`);
    try {
      await updatePayrollReviewBreakdown(row.id, live, myProfileId, myName);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...live, updatedByName: myName } : r)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setSavingKey(null);
    }
  };

  const [rows, setRows] = useState<PayrollReviewBreakdown[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [addId, setAddId] = useState("");
  const [search, setSearch] = useState("");
  const validPeriod = !!periodStart && !!periodEnd && periodStart <= periodEnd;

  const load = useCallback(async () => {
    if (!validPeriod) { setRows([]); return; }
    setLoading(true);
    try {
      const [list, taxes] = await Promise.all([getPayrollReviewBreakdowns(periodStart, periodEnd), getTechTaxLinesForPeriod(periodStart, periodEnd)]);
      if (selectedRef.current !== `${periodStart}|${periodEnd}`) return;
      setRows(list);
      setTaxLinesByProfile(taxes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reviewed periods.");
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd, validPeriod]);
  useEffect(() => { void load(); }, [load]);

  const syncingRef = useRef(false);
  const failedSyncs = useRef(new Set<string>());
  const [payrollSyncing, setPayrollSyncing] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  useEffect(() => {
    if (!actualReady || loading || error || syncingRef.current) return;
    const pending = rows.flatMap((row) => {
      if (row.source !== "review" || row.periodStart !== periodStart || row.periodEnd !== periodEnd) return [];
      const amounts = reviewedPeriodSyncAmounts(row, actualBreakdowns.get(row.profileId), actualTotals.get(row.profileId));
      if (!amounts) return [];
      const key = JSON.stringify([row.id, amounts]);
      return failedSyncs.current.has(key) ? [] : [{ row, amounts, key }];
    });
    if (!pending.length) return;
    syncingRef.current = true;
    setPayrollSyncing(true);
    const cutoff = selected;
    void (async () => {
      for (const { row, amounts, key } of pending) {
        if (selectedRef.current !== cutoff) break;
        try {
          await updatePayrollReviewBreakdown(row.id, amounts, myProfileId, myName);
          if (selectedRef.current === cutoff) {
            setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, ...amounts, updatedByName: myName } : r));
          }
        } catch (err) {
          failedSyncs.current.add(key);
          toast.error(err instanceof Error ? err.message : "Automatic payroll sync failed. Use Update to retry.");
        }
      }
    })().finally(() => {
      syncingRef.current = false;
      setPayrollSyncing(false);
      setSyncRevision((value) => value + 1);
    });
  }, [actualReady, loading, error, rows, actualBreakdowns, actualTotals, periodStart, periodEnd, selected, myProfileId, myName, syncRevision]);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const nameOf = (r: PayrollReviewBreakdown) => r.technicianName || personById.get(r.profileId)?.name || "(unknown technician)";
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => !q || nameOf(r).toLowerCase().includes(q) || (r.branch ?? "").toLowerCase().includes(q))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, personById]);
  const addable = useMemo(() => {
    const have = new Set(rows.map((r) => r.profileId));
    return people.filter((p) => !have.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [people, rows]);

  const saveCell = async (row: PayrollReviewBreakdown, key: keyof PayrollReviewAmounts, raw: string) => {
    if (row.source === "review") return;
    const value = Math.abs(Number(raw.replace(/[$,\s]/g, "")) || 0);
    if (Math.abs(value - row[key]) < 0.005) return;
    setSavingKey(`${row.id}:${key}`);
    try {
      await updatePayrollReviewBreakdown(row.id, { [key]: value }, myProfileId, myName);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [key]: value, updatedByName: myName } : r)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  const addPerson = async () => {
    const person = personById.get(addId);
    if (!person || !validPeriod) return;
    setSavingKey("add");
    try {
      await upsertPayrollReviewBreakdown(person.id, periodStart, periodEnd, ZERO, {
        branch: person.branch || null, source: "manual", updatedBy: myProfileId, updatedByName: myName,
      });
      setAddId("");
      await load();
      await loadPeriods();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add technician.");
    } finally {
      setSavingKey(null);
    }
  };

  const removeRow = async (row: PayrollReviewBreakdown) => {
    if (!window.confirm(`Remove ${nameOf(row)} from this period's summary?`)) return;
    setSavingKey(`${row.id}:delete`);
    try {
      await deletePayrollReviewBreakdown(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove.");
    } finally {
      setSavingKey(null);
    }
  };

  const [fullBreakdown, setFullBreakdown] = useState(true);
  const [weeklyView, setWeeklyView] = useState(false);
    const detailRows = new Map(visible.map((r) => [r.id, reviewedPeriodDetails(r, actualReady ? actualDetails.get(r.profileId) : undefined)]));
    const detailColumns = new Map<string, { key: string; label: string; group: "bonus" | "mileageOtherReimb" | "deduction" | "pretaxInsurance" }>();
    for (const lines of detailRows.values()) for (const line of lines) detailColumns.set(line.key, line);
    // Itemize bonuses, reimbursements and deductions without changing saved totals.
    const exportColumns = COLUMNS.flatMap<{
      key: string; label: string; sub: string[] | undefined; group: keyof PayrollReviewAmounts;
      subtract: boolean; value: (r: PayrollReviewBreakdown) => number;
    }>((c) => {
      if (c.key !== "bonus" && c.key !== "mileageOtherReimb" && c.key !== "deduction" && c.key !== "pretaxInsurance") {
        return [{ key: c.key as string, label: c.label, sub: c.sub, group: c.key, subtract: !!c.subtract,
          value: (r: PayrollReviewBreakdown) => r[c.key] }];
      }
      return [...detailColumns.values()].filter((d) => d.group === c.key)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((d) => ({ key: d.key, label: `${c.subtract ? "(-)" : "(+)"} ${d.label}`, sub: undefined, group: d.group, subtract: !!c.subtract,
          value: (r: PayrollReviewBreakdown) => detailRows.get(r.id)?.find((l) => l.key === d.key)?.amount ?? 0 }));
    });
  const displayColumns = fullBreakdown ? exportColumns : COLUMNS.map((c) => ({
    ...c, group: c.key, value: (r: PayrollReviewBreakdown) => r[c.key],
  }));

  // Download Excel opens a picker (periods × technicians, list or one tab
  // per person). The open period exports exactly what this tab shows.
  const [exportOpen, setExportOpen] = useState(false);
  const exportPendingSync = rows.some((r) => r.source === "review" && !!reviewedPeriodSyncAmounts(r, actualBreakdowns.get(r.profileId), actualTotals.get(r.profileId)));
  const currentExport = useMemo((): { key: string; entries: ReviewedExportEntry[] } | null => {
    if (!exportOpen || !actualReady || loading || exportPendingSync || !selected) return null;
    return {
      key: selected,
      entries: rows.map((r) => ({
        profileId: r.profileId,
        name: nameOf(r),
        branch: r.branch ?? "",
        periodStart,
        periodEnd,
        amounts: r,
        details: reviewedPeriodDetails(r, actualDetails.get(r.profileId)),
        notInColumns: notInColumns(r),
        gross: Math.round(totalOf(r) * 100) / 100,
        taxes: taxesOf(r),
        net: netOf(r),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportOpen]);

  const cellClass = "w-[74px] bg-slate-800/50 border border-white/10 rounded px-1 py-0.5 text-[11px] text-right tabular-nums text-white focus:border-blue-500 focus:outline-none disabled:opacity-50";

  // Floating sideways scrollbar: pinned to the bottom of the screen while
  // the table is wider than its box, kept in sync with the table's own
  // scroll position (whose native bar is hidden — it sits below every row).
  const tableBoxRef = useRef<HTMLDivElement>(null);
  const floatBarRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const box = tableBoxRef.current;
    if (!box) return;
    const measure = () => { setScrollWidth(box.scrollWidth); setBoxWidth(box.clientWidth); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    return () => ro.disconnect();
  }, [visible.length, loading, weeklyView]);
  const syncing = useRef(false);
  const syncScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { syncing.current = false; });
  };
  const overflowing = scrollWidth > boxWidth + 1;

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-white">Reviewed Period</h3>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const [s0, e0] = e.target.value.split("|");
                if (s0 && e0) onPeriodChange(s0, e0);
              }}
              className="glass-input text-sm py-1 px-2 rounded-md"
              title="Pay periods with saved rows, plus the period picked on the Payroll tab"
            >
              {periodOptions.length === 0 && <option value="">No periods yet</option>}
              {periodOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {formatISODate(o.start)} to {formatISODate(o.end)}{o.count ? ` (${o.count})` : o.key === dashboardKey ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reviewed rows automatically sync from actual payroll when this cutoff finishes loading. Make pay corrections in the Payroll tab; manually added rows remain editable.
            PTO $ is split out automatically — paid leave hours are inside Regular Hours $.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWeeklyView((value) => !value)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">
            {weeklyView ? "Show Payroll Breakdown" : "Show Weekly Breakdown"}
          </button>
          <label className={`${weeklyView ? "hidden" : "flex"} items-center gap-2 text-sm text-slate-300`}>
            <input type="checkbox" checked={fullBreakdown} onChange={(e) => setFullBreakdown(e.target.checked)} />
            Full breakdown
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search technician or branch…"
            className="glass-input text-sm py-1.5 px-3 rounded-md w-56"
          />
          <select
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            disabled={!validPeriod || savingKey === "add"}
            className="glass-input text-sm py-1.5 px-2 rounded-md w-56"
          >
            <option value="">Add technician…</option>
            {addable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void addPerson()}
            disabled={!addId || savingKey === "add"}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1.5"
          >
            {savingKey === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={payrollSyncing || periodOptions.length === 0}
            title="Pick technicians and pay periods to download"
            className={`${weeklyView ? "hidden" : "flex"} px-3 py-1.5 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-semibold items-center gap-1.5`}
          >
            <Download className="h-4 w-4" /> {payrollSyncing ? "Syncing payroll..." : "Download Excel"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {exportOpen && (
        <ReviewedPeriodsExportDialog
          periodOptions={periodOptions}
          current={currentExport}
          defaultIncluded={new Set(visible.map((r) => r.profileId))}
          nameFallback={new Map(people.map((p) => [p.id, p.name]))}
          fullBreakdown={fullBreakdown}
          onClose={() => setExportOpen(false)}
        />
      )}

      {weeklyView && <ReviewedWeeklyBreakdown
        people={visible.map((r) => ({ id: r.profileId, name: nameOf(r), branch: r.branch ?? "" }))}
        sources={actualWeeklySources} start={periodStart} end={periodEnd} ready={actualReady && !loading}
        onOpenEmployee={(id) => onOpenEmployee(id, periodStart, periodEnd)}
      />}
      <div className={weeklyView ? "hidden" : ""}>
      <div
        ref={tableBoxRef}
        onScroll={() => syncScroll(tableBoxRef.current, floatBarRef.current)}
        className="max-h-[70vh] overflow-auto rounded-t-lg border border-white/10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-20 bg-slate-900 text-slate-300">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-900 text-left px-2 py-1.5 font-semibold align-top">Technician</th>
              <th className="text-left px-2 py-1.5 font-semibold align-top">Branch</th>
              {displayColumns.map((c) => (
                <th key={c.key} className="text-right px-2 py-1.5 font-semibold align-top leading-tight min-w-[110px] max-w-[150px]">
                  {c.label}
                  {c.sub?.map((sub) => <div key={sub} className="font-normal text-[9px] text-slate-500">{sub}</div>)}
                </th>
              ))}
              <th className="text-right px-2 py-1.5 font-semibold align-top leading-tight max-w-[92px]">
                Not in Columns
                <div className="font-normal text-[9px] text-slate-500">Gross − columns</div>
              </th>
              <th className="text-right px-2 py-1.5 font-semibold align-top leading-tight">
                Gross Pay
                <div className="font-normal text-[9px] text-slate-500">Timecard + Tech Activity Report</div>
              </th>
              <th className="text-right px-2 py-1.5 font-semibold align-top leading-tight">
                (−) Taxes
                <div className="font-normal text-[9px] text-slate-500">MCWH · SSWH · FITW · SITW</div>
              </th>
              <th className="text-right px-2 py-1.5 font-semibold align-top leading-tight">
                Total
                <div className="font-normal text-[9px] text-slate-500">Net pay (gross − taxes)</div>
              </th>
              <th className="px-1 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={displayColumns.length + 7} className="px-3 py-6 text-center text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={displayColumns.length + 7} className="px-3 py-6 text-center text-slate-400">No technicians reviewed for this period yet. Mark one Done in the Payroll tab, or add one above.</td></tr>
            ) : visible.map((r) => (
              <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-white whitespace-nowrap">
                  <button type="button"
                    disabled={!actualReady || loading || !actualTotals.has(r.profileId)}
                    onClick={() => onOpenEmployee(r.profileId, periodStart, periodEnd)}
                    title="Open attendance and Tech Activity Report for this cutoff"
                    className="text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed">
                    {nameOf(r)}
                  </button>
                  <span
                    title={r.source === "review" ? "Saved when the Tech Activity Report was marked Done" : "Added or imported by hand"}
                    className={`ml-1.5 inline-block px-1 rounded text-[8px] font-bold border align-middle ${r.source === "review" ? "border-emerald-500/40 text-emerald-300" : "border-white/15 text-slate-500"}`}
                  >
                    {r.source === "review" ? "R" : "M"}
                  </span>
                </td>
                <td className="px-2 py-1 text-slate-300 whitespace-nowrap max-w-[110px] truncate" title={r.branch ?? ""}>{r.branch ?? "—"}</td>
                {displayColumns.map((c) => (
                  <td key={c.key} className="px-1 py-1 text-right">
                    {fullBreakdown ? (
                      <span className={`block px-1 tabular-nums whitespace-nowrap ${c.subtract ? "text-red-300" : "text-slate-200"}`}>
                        {c.value(r) ? money(c.value(r)) : "—"}
                      </span>
                    ) : (
                    <input
                      key={`${r.id}:${c.key}:${c.value(r)}`}
                      type="number" step={0.01} min={0}
                      defaultValue={c.value(r) ? c.value(r).toFixed(2) : ""}
                      placeholder="0.00"
                      readOnly={r.source === "review"}
                      title={r.source === "review" ? "Automatically synced from payroll. Edit the Timecard or Tech Activity Report to change pay." : undefined}
                      disabled={savingKey === `${r.id}:${c.key}`}
                      onBlur={(e) => void saveCell(r, c.group, e.target.value)}
                      className={`${cellClass} ${c.subtract ? "text-red-300" : ""}`}
                    />
                    )}
                  </td>
                ))}
                {(() => {
                  const diff = notInColumns(r);
                  const changed = changedColumns(r);
                  const canSync = changed.length > 0 && !!liveAmounts(r);
                  return (
                    <td
                      className="px-2 py-1 text-right tabular-nums whitespace-nowrap"
                      title={
                        diff == null
                          ? "Shows once this period's actual pay finishes loading on the Payroll page."
                          : changed.length
                          ? `The columns were saved at Done; the timecard / Tech Activity Report has changed since:\n${changed.join("\n")}${canSync ? "\n\nClick ↻ to update the columns to these amounts." : ""}`
                          : diff !== 0
                          ? "Pay that has no column of its own."
                          : "The columns add up to the gross pay."
                      }
                    >
                      {diff == null ? (
                        <span className="text-slate-600">—</span>
                      ) : diff === 0 ? (
                        <span className="text-slate-500">$0.00</span>
                      ) : (
                        <span className="font-semibold text-amber-300">{money(diff)}</span>
                      )}
                      {canSync && (
                        <button
                          type="button"
                          onClick={() => void syncRow(r)}
                          disabled={savingKey === `${r.id}:sync`}
                          aria-label={`Update ${nameOf(r)}'s columns to the actual pay`}
                          className="ml-1 align-middle text-sky-400 hover:text-sky-300 disabled:opacity-40"
                        >
                          <RefreshCw className={`inline h-3 w-3 ${savingKey === `${r.id}:sync` ? "animate-spin" : ""}`} />
                        </button>
                      )}
                    </td>
                  );
                })()}
                <td
                  className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${isActual(r) ? "text-slate-200" : "text-slate-400 italic"}`}
                  title={
                    isActual(r)
                      ? "Actual gross pay from the timecard and Tech Activity Report (its Total Payment)."
                      : "Sum of the columns — the actual gross loads once this period finishes loading on the Payroll page."
                  }
                >
                  {money(totalOf(r))}
                </td>
                {(() => {
                  const lines = taxLinesOf(r);
                  const taxes = taxesOf(r);
                  return (
                    <td
                      className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${taxes > 0 ? "text-red-300" : "text-slate-500"}`}
                      title={lines.length ? lines.map((l) => `${l.label}: ${money(l.amount)}`).join("\n") : "No tax lines on this technician's Tech Activity Report."}
                    >
                      {money(taxes)}
                    </td>
                  );
                })()}
                <td
                  className={`px-2 py-1 text-right font-semibold tabular-nums whitespace-nowrap ${isActual(r) ? "text-emerald-300" : "text-slate-400 italic"}`}
                  title="Net pay: gross pay − taxes — the Tech Activity Report's Net Pay After Tax."
                >
                  {money(netOf(r))}
                </td>
                <td className="px-1 py-1 text-right">
                  <button
                    type="button"
                    onClick={() => void removeRow(r)}
                    disabled={savingKey === `${r.id}:delete`}
                    title="Remove from this period's summary"
                    className="text-slate-500 hover:text-red-400 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot className="border-t border-white/10 font-semibold text-white">
              <tr>
                <td className="sticky left-0 z-10 bg-slate-900 px-2 py-1.5">Total ({visible.length})</td>
                <td className="bg-slate-900" />
                {displayColumns.map((c) => <td key={c.key} className="bg-slate-900 px-1 py-1.5 text-right tabular-nums whitespace-nowrap">{money(visible.reduce((sum, r) => sum + c.value(r), 0))}</td>)}
                <td className="bg-slate-900 px-2 py-1.5 text-right tabular-nums text-amber-300 whitespace-nowrap">{money(visible.reduce((s0, r) => s0 + (notInColumns(r) ?? 0), 0))}</td>
                <td className="bg-slate-900 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{money(visible.reduce((s0, r) => s0 + totalOf(r), 0))}</td>
                <td className="bg-slate-900 px-2 py-1.5 text-right tabular-nums text-red-300 whitespace-nowrap">{money(visible.reduce((s0, r) => s0 + taxesOf(r), 0))}</td>
                <td className="bg-slate-900 px-2 py-1.5 text-right tabular-nums text-emerald-300 whitespace-nowrap">{money(visible.reduce((s0, r) => s0 + netOf(r), 0))}</td>
                <td className="bg-slate-900" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div
        ref={floatBarRef}
        onScroll={() => syncScroll(floatBarRef.current, tableBoxRef.current)}
        aria-label="Scroll the table sideways"
        className={`!mt-0 sticky bottom-0 z-20 overflow-x-auto overflow-y-hidden rounded-b-lg border border-t-0 border-white/10 bg-slate-950/95 backdrop-blur ${overflowing ? "" : "hidden"}`}
        style={{ height: 16 }}
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      </div>
    </div>
  );
}
