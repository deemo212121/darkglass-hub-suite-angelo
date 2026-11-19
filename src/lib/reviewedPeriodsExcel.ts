/**
 * Accounting → Reviewed Periods Excel export, for any set of technicians
 * and pay periods: either one list (a row per technician per period,
 * grouped by name) or one tab per technician (a row per period, with the
 * person's own totals). Same columns and styling as the single-period
 * export it replaced.
 */
import type { PayrollReviewAmounts } from "@/lib/supabase/payrollReviewBreakdowns";
import { excelColumnLetter, type ReviewedPeriodDetail } from "@/lib/reviewedPeriodDetails";
import { formatISODate } from "@/lib/localDate";

export interface ReviewedExportEntry {
  profileId: string;
  name: string;
  branch: string;
  periodStart: string;
  periodEnd: string;
  amounts: PayrollReviewAmounts;
  details: ReviewedPeriodDetail[];
  /** Actual gross − saved columns; null when the actual gross isn't loaded (other periods). */
  notInColumns: number | null;
  gross: number;
  taxes: number;
  net: number;
}

export type ReviewedExportLayout = "list" | "tabs";

// Finance's payroll-summary format, in column order.
export const REVIEW_EXPORT_COLUMNS: { key: keyof PayrollReviewAmounts; label: string; sub?: string[]; subtract?: boolean }[] = [
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

type HeaderKey = keyof PayrollReviewAmounts | "notInColumns" | "gross" | "taxes" | "total" | "name";
interface ExportColumn { key: string; label: string; sub?: string[]; group: keyof PayrollReviewAmounts; subtract: boolean; value: (e: ReviewedExportEntry) => number }

/** The money columns: the summary columns, or (full breakdown) bonuses / reimbursements / deductions itemized. */
export function reviewExportColumns(entries: ReviewedExportEntry[], fullBreakdown: boolean): ExportColumn[] {
  const plain = (c: (typeof REVIEW_EXPORT_COLUMNS)[number]): ExportColumn => ({
    key: c.key, label: c.label, sub: c.sub, group: c.key, subtract: !!c.subtract, value: (e) => e.amounts[c.key],
  });
  if (!fullBreakdown) return REVIEW_EXPORT_COLUMNS.map(plain);
  const detailColumns = new Map<string, ReviewedPeriodDetail>();
  for (const e of entries) for (const d of e.details) detailColumns.set(d.key, d);
  return REVIEW_EXPORT_COLUMNS.flatMap((c) => {
    if (c.key !== "bonus" && c.key !== "mileageOtherReimb" && c.key !== "deduction" && c.key !== "pretaxInsurance") return [plain(c)];
    return [...detailColumns.values()]
      .filter((d) => d.group === c.key)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((d) => ({
        key: d.key, label: `${c.subtract ? "(-)" : "(+)"} ${d.label}`, group: d.group, subtract: !!c.subtract,
        value: (e: ReviewedExportEntry) => e.details.find((l) => l.key === d.key)?.amount ?? 0,
      }));
  });
}

const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const thin = { style: "thin" as const, color: { argb: "FFD9E1EC" } };
const moneyFmt = '"$"#,##0.00;[Red]-"$"#,##0.00;"–"';
const groupColor = (key: HeaderKey) =>
  key === "deduction" || key === "pretaxInsurance" || key === "taxes" ? "FFB91C1C"
    : key === "mileageOtherReimb" ? "FF6D28D9"
    : key === "salaryMatch" || key === "notInColumns" ? "FFB45309"
    : key === "total" ? "FF15803D"
    : key === "gross" ? "FF334155"
    : key === "name" ? "FF1E3A5F"
    : "FF0F766E";
const periodLabel = (e: Pick<ReviewedExportEntry, "periodStart" | "periodEnd">) => `${formatISODate(e.periodStart)} – ${formatISODate(e.periodEnd)}`;

/** Excel sheet names: ≤31 chars, none of : \ / ? * [ ], unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim() || "Technician").slice(0, 31);
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Worksheet = any;

/** One styled table: title, subtitle, headers, the rows, a totals row. */
function writeTable(ws: Worksheet, opts: {
  title: string;
  subtitle: string;
  leadHeaders: string[];
  lead: (e: ReviewedExportEntry) => string[];
  entries: ReviewedExportEntry[];
  columns: ExportColumn[];
  /** Bold separator above an entry (first row of a new person in the list layout). */
  groupStart?: (e: ReviewedExportEntry, i: number) => boolean;
}) {
  const { columns, entries } = opts;
  const leadCount = opts.leadHeaders.length;
  const lastCol = leadCount + columns.length + 4;
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = opts.title;
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = fill("FF1E3A5F");
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = opts.subtitle;
  sub.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF1E3A5F" } };
  sub.fill = fill("FFE0F2F1");
  sub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 6;

  const headerRow = 4;
  const headers: { text: string; key: HeaderKey }[] = [
    ...opts.leadHeaders.map((text) => ({ text, key: "name" as const })),
    ...columns.map((c) => ({ text: [c.label, ...(c.sub ?? [])].join("\n"), key: c.group as HeaderKey })),
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
    cell.alignment = { vertical: "middle", horizontal: i < leadCount ? "left" : "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF0B1F33" } }, right: { style: "thin", color: { argb: "FFFFFFFF" } } };
  });
  ws.getRow(headerRow).height = 50;

  const first = headerRow + 1;
  entries.forEach((e, i) => {
    const row = ws.getRow(first + i);
    row.values = [...opts.lead(e), ...columns.map((c) => c.value(e)), e.notInColumns ?? 0, e.gross, e.taxes, e.net];
    row.height = 18;
    const startsGroup = i > 0 && !!opts.groupStart?.(e, i);
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cell.fill = fill(i % 2 ? "FFF5F8FC" : "FFFFFFFF");
      cell.border = { bottom: thin, ...(startsGroup ? { top: { style: "medium" as const, color: { argb: "FF94A3B8" } } } : {}) };
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF1F2937" }, bold: c === 1 || c === lastCol };
      if (c > leadCount) { cell.numFmt = moneyFmt; cell.alignment = { horizontal: "right" }; }
    }
    columns.forEach((column, index) => {
      if (column.subtract) row.getCell(index + leadCount + 1).font = { name: "Calibri", size: 11, color: { argb: "FFB91C1C" } };
    });
    row.getCell(lastCol - 1).font = { name: "Calibri", size: 11, color: { argb: "FFB91C1C" } };
    row.getCell(lastCol).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF15803D" } };
    row.getCell(lastCol).fill = fill(i % 2 ? "FFE8F5EC" : "FFF0FAF3");
  });
  const last = first + entries.length - 1;

  const totalRow = ws.getRow(last + 1);
  totalRow.getCell(1).value = `TOTAL  (${entries.length})`;
  for (let c = leadCount + 1; c <= lastCol; c++) {
    const col = excelColumnLetter(c);
    const result = entries.reduce((sum, _, index) => sum + Number(ws.getRow(first + index).getCell(c).value || 0), 0);
    totalRow.getCell(c).value = entries.length ? { formula: `SUM(${col}${first}:${col}${last})`, result } : 0;
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

  ws.columns.forEach((col: { width: number }, i: number) => {
    col.width = i < leadCount ? (i === 0 ? 30 : i === 1 ? 18 : 24) : i === lastCol - 2 ? 16 : 17;
  });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false, zoomScale: 90 }];
  if (entries.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: lastCol } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerRow}:${headerRow}` };
}

export async function downloadReviewedPeriodsWorkbook(entries: ReviewedExportEntry[], opts: { layout: ReviewedExportLayout; fullBreakdown: boolean }): Promise<void> {
  const excelModule = await import("exceljs");
  const ExcelJS = excelModule.default ?? excelModule;
  const wb = new ExcelJS.Workbook();
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name) || a.periodStart.localeCompare(b.periodStart));
  const columns = reviewExportColumns(sorted, opts.fullBreakdown);
  const people = [...new Map(sorted.map((e) => [e.profileId, e])).values()];
  const periods = [...new Map(sorted.map((e) => [`${e.periodStart}|${e.periodEnd}`, e])).values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const generated = `Generated ${new Date().toLocaleString()}`;
  const periodSummary = periods.length === 1 ? `Pay period ${periodLabel(periods[0])}` : `${periods.length} pay periods (${periodLabel({ periodStart: periods[0].periodStart, periodEnd: periods[periods.length - 1].periodEnd })})`;

  if (opts.layout === "list" || people.length === 1 && periods.length === 1) {
    const ws = wb.addWorksheet("Reviewed Periods", { properties: { tabColor: { argb: "FF0F766E" } } });
    const multi = periods.length > 1;
    writeTable(ws, {
      title: "REVIEWED PERIODS  •  TECHNICIAN PAYROLL SUMMARY",
      subtitle: `${periodSummary}   •   ${people.length} technician${people.length === 1 ? "" : "s"}   •   ${generated}`,
      leadHeaders: multi ? ["Technician", "Branch", "Pay Period"] : ["Technician", "Branch"],
      lead: (e) => (multi ? [e.name, e.branch, periodLabel(e)] : [e.name, e.branch]),
      entries: sorted,
      columns,
      groupStart: (e, i) => sorted[i - 1].profileId !== e.profileId,
    });
  } else {
    const used = new Set<string>();
    for (const person of people) {
      const mine = sorted.filter((e) => e.profileId === person.profileId);
      const ws = wb.addWorksheet(sheetName(person.name, used), { properties: { tabColor: { argb: "FF0F766E" } } });
      writeTable(ws, {
        title: person.name.toUpperCase(),
        subtitle: `${person.branch || "No branch"}   •   ${mine.length} pay period${mine.length === 1 ? "" : "s"}   •   ${generated}`,
        leadHeaders: ["Pay Period", "Branch"],
        lead: (e) => [periodLabel(e), e.branch],
        entries: mine,
        columns,
      });
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = periods.length === 1
    ? `reviewed_period_${periods[0].periodStart}_to_${periods[0].periodEnd}.xlsx`
    : `reviewed_periods_${periods[0].periodStart}_to_${periods[periods.length - 1].periodEnd}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
