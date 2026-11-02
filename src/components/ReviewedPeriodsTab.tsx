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
 * when Finance clicks Done in the Tech Activity Report; every amount is
 * editable, and technicians can be added by hand (migration 0392).
 */
export function ReviewedPeriodsTab({
  periodStart: dashboardStart,
  periodEnd: dashboardEnd,
  people,
  myProfileId,
  myName,
  actualTotals,
  actualBreakdowns,
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

  const totals = useMemo(() => {
    const t: PayrollReviewAmounts = { ...ZERO };
    for (const r of visible) for (const c of COLUMNS) t[c.key] += r[c.key];
    return t;
  }, [visible]);

  const saveCell = async (row: PayrollReviewBreakdown, key: keyof PayrollReviewAmounts, raw: string) => {
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

  const downloadExcel = async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Reviewed Period", { properties: { tabColor: { argb: "FF0F766E" } } });
    const lastCol = COLUMNS.length + 6; // A name, B branch, C..K amounts, L not in columns, M gross, N taxes, O total (net)
    const colLetter = (i: number) => String.fromCharCode(64 + i);
    const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
    const thin = { style: "thin" as const, color: { argb: "FFD9E1EC" } };
    const moneyFmt = '"$"#,##0.00;[Red]-"$"#,##0.00;"–"';
    // Header colour per column group: earnings / deductions / reimbursements / salary / total.
    const groupColor = (key: keyof PayrollReviewAmounts | "notInColumns" | "gross" | "taxes" | "total" | "name") =>
      key === "deduction" || key === "pretaxInsurance" || key === "taxes" ? "FFB91C1C"
        : key === "mileageOtherReimb" ? "FF6D28D9"
        : key === "salaryMatch" || key === "notInColumns" ? "FFB45309"
        : key === "total" ? "FF15803D"
        : key === "gross" ? "FF334155"
        : key === "name" ? "FF1E3A5F"
        : "FF0F766E";

    // Title banner
    ws.mergeCells(1, 1, 1, lastCol);
    const title = ws.getCell(1, 1);
    title.value = "REVIEWED PERIOD  •  TECHNICIAN PAYROLL SUMMARY";
    title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    title.fill = fill("FF1E3A5F");
    title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, lastCol);
    const sub = ws.getCell(2, 1);
    sub.value = `Pay period ${formatISODate(periodStart)} – ${formatISODate(periodEnd)}   •   ${visible.length} technician${visible.length === 1 ? "" : "s"}   •   Generated ${new Date().toLocaleString()}`;
    sub.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF1E3A5F" } };
    sub.fill = fill("FFE0F2F1");
    sub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(2).height = 20;
    ws.getRow(3).height = 6;

    // Column headers (label + its "Including …" notes in one wrapped cell)
    const headerRow = 4;
    const headers: { text: string; key: keyof PayrollReviewAmounts | "notInColumns" | "gross" | "taxes" | "total" | "name" }[] = [
      { text: "Technician", key: "name" },
      { text: "Branch", key: "name" },
      ...COLUMNS.map((c) => ({ text: [c.label, ...(c.sub ?? [])].join("\n"), key: c.key })),
      { text: "Not in Columns\nGross − columns", key: "notInColumns" },
      { text: "Gross Pay\nTimecard + Tech Activity Report", key: "gross" },
      { text: "(−) Taxes\nMCWH · SSWH · FITW · SITW", key: "taxes" },
      { text: "Total\nNet pay (gross − taxes)", key: "total" },
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h.text;
      cell.fill = fill(groupColor(h.key));
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: i < 2 ? "left" : "center", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: "FF0B1F33" } }, right: { style: "thin", color: { argb: "FFFFFFFF" } } };
    });
    ws.getRow(headerRow).height = 50;

    // Rows
    const first = headerRow + 1;
    visible.forEach((r, i) => {
      const n = first + i;
      const row = ws.getRow(n);
      // Gross = the technician's actual pay; Total = net after the report's tax lines, as on the tab.
      row.values = [nameOf(r), r.branch ?? "", ...COLUMNS.map((c) => r[c.key]), notInColumns(r) ?? 0, Math.round(totalOf(r) * 100) / 100, taxesOf(r), netOf(r)];
      row.height = 18;
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        cell.fill = fill(i % 2 ? "FFF5F8FC" : "FFFFFFFF");
        cell.border = { bottom: thin };
        cell.font = { name: "Calibri", size: 11, color: { argb: "FF1F2937" }, bold: c === 1 || c === lastCol };
        if (c >= 3) { cell.numFmt = moneyFmt; cell.alignment = { horizontal: "right" }; }
      }
      // Subtracted columns in red, Total in green.
      for (const key of ["deduction", "pretaxInsurance"] as const) {
        const cell = row.getCell(COLUMNS.findIndex((c) => c.key === key) + 3);
        cell.font = { name: "Calibri", size: 11, color: { argb: "FFB91C1C" } };
      }
      row.getCell(lastCol - 1).font = { name: "Calibri", size: 11, color: { argb: "FFB91C1C" } };
      row.getCell(lastCol).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF15803D" } };
      row.getCell(lastCol).fill = fill(i % 2 ? "FFE8F5EC" : "FFF0FAF3");
    });
    const last = first + visible.length - 1;

    // Totals
    const totalRow = ws.getRow(last + 1);
    totalRow.getCell(1).value = `TOTAL  (${visible.length})`;
    for (let c = 3; c <= lastCol; c++) {
      const col = colLetter(c);
      totalRow.getCell(c).value = visible.length ? { formula: `SUM(${col}${first}:${col}${last})`, result: 0 } : 0;
      totalRow.getCell(c).numFmt = moneyFmt;
      totalRow.getCell(c).alignment = { horizontal: "right" };
    }
    for (let c = 1; c <= lastCol; c++) {
      const cell = totalRow.getCell(c);
      cell.fill = fill(c === lastCol ? "FF15803D" : "FF1E3A5F");
      cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
      cell.border = { top: { style: "double", color: { argb: "FF0B1F33" } } };
    }
    totalRow.height = 24;

    ws.columns.forEach((col, i) => { col.width = i === 0 ? 30 : i === 1 ? 18 : i === lastCol - 1 ? 16 : 17; });
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false, zoomScale: 90 }];
    if (visible.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: lastCol } };
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerRow}:${headerRow}` };
    const buffer = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `reviewed_period_${periodStart}_to_${periodEnd}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

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
  }, [visible.length, loading]);
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
            Filled in when a technician's Tech Activity Report is marked Done (Payroll tab); every amount can be edited. Clicking Done again refreshes that technician's row.
            PTO $ isn't split out automatically — paid leave hours are inside Regular Hours $.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => void downloadExcel()}
            disabled={visible.length === 0}
            className="px-3 py-1.5 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1.5"
          >
            <Download className="h-4 w-4" /> Download Excel
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div
        ref={tableBoxRef}
        onScroll={() => syncScroll(tableBoxRef.current, floatBarRef.current)}
        className="overflow-x-auto rounded-t-lg border border-white/10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <table className="w-full text-[11px]">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-900 text-left px-2 py-1.5 font-semibold align-top">Technician</th>
              <th className="text-left px-2 py-1.5 font-semibold align-top">Branch</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="text-right px-1 py-1.5 font-semibold align-top leading-tight max-w-[92px]">
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
              <tr><td colSpan={COLUMNS.length + 7} className="px-3 py-6 text-center text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={COLUMNS.length + 7} className="px-3 py-6 text-center text-slate-400">No technicians reviewed for this period yet. Mark one Done in the Payroll tab, or add one above.</td></tr>
            ) : visible.map((r) => (
              <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-white whitespace-nowrap">
                  {nameOf(r)}
                  <span
                    title={r.source === "review" ? "Saved when the Tech Activity Report was marked Done" : "Added or imported by hand"}
                    className={`ml-1.5 inline-block px-1 rounded text-[8px] font-bold border align-middle ${r.source === "review" ? "border-emerald-500/40 text-emerald-300" : "border-white/15 text-slate-500"}`}
                  >
                    {r.source === "review" ? "R" : "M"}
                  </span>
                </td>
                <td className="px-2 py-1 text-slate-300 whitespace-nowrap max-w-[110px] truncate" title={r.branch ?? ""}>{r.branch ?? "—"}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-1 py-1 text-right">
                    <input
                      key={`${r.id}:${c.key}:${r[c.key]}`}
                      type="number" step={0.01} min={0}
                      defaultValue={r[c.key] ? r[c.key].toFixed(2) : ""}
                      placeholder="0.00"
                      disabled={savingKey === `${r.id}:${c.key}`}
                      onBlur={(e) => void saveCell(r, c.key, e.target.value)}
                      className={`${cellClass} ${c.subtract ? "text-red-300" : ""}`}
                    />
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
                {COLUMNS.map((c) => <td key={c.key} className="bg-slate-900 px-1 py-1.5 text-right tabular-nums whitespace-nowrap">{money(totals[c.key])}</td>)}
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
  );
}
