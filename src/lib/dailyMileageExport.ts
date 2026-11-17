/**
 * Daily Mileage → Export: a formatted Excel workbook (exceljs) instead of a
 * plain CSV, so the colours carry over.
 *
 *   Grid  — technicians down, days across. Colour bands over the header:
 *           the technician block, each Sunday–Saturday week, the totals and
 *           the long-day counts. Days over 200 / 300 / 400 miles are shaded
 *           the same as on the page; Car IQ status is coloured; a SUM row at
 *           the bottom.
 *   Trips — one row per trip, laid out like the workbook's Daily Entry tab,
 *           with the header grouped (trip · miles · pay · review · proof),
 *           approval status and the entry check coloured, map links clickable.
 *
 * The page hands in plain rows; this file only lays them out.
 */
import type { Cell, Fill, Worksheet } from "exceljs";

export interface MileageGridExportRow {
  name: string;
  branch: string;
  /** true / false / null = not set */
  carIq: boolean | null;
  /** Eligible miles per day, in the same order as `days`; null = no trip that day. */
  days: (number | null)[];
  total: number;
  excluded: number;
  eligible: number;
  /** One rate, or several when it changed in the range. */
  rates: number[];
  pay: number;
  approvedPay: number;
  over200: number;
  over300: number;
  over400: number;
}

export interface MileageTripExportRow {
  date: string;
  technician: string;
  branch: string;
  vehicle: string;
  total: number;
  excluded: number;
  reason: string;
  carIq: boolean | null;
  eligible: number;
  rate: number | null;
  pay: number | null;
  status: string;
  approvedBy: string;
  ticketRefs: string;
  totalMapUrl: string;
  eligibleMapUrl: string;
  notes: string;
  check: string;
}

// ── Palette (ARGB) ─────────────────────────────────────────────────────────
const C = {
  title: "FF0F1E3D",
  titleText: "FFFFFFFF",
  sub: "FF5B6B85",
  identity: "FF1E3A8A", identityLight: "FFDBE5FF",
  weekA: "FF0E7490", weekALight: "FFD5F3F8",
  weekB: "FF4338CA", weekBLight: "FFE2E0FF",
  totals: "FF7C3AED", totalsLight: "FFEDE4FF",
  pay: "FF047857", payLight: "FFD7F5E8",
  long: "FFB91C1C", longLight: "FFFDE2E2",
  miles: "FFB45309", milesLight: "FFFFEBC9",
  review: "FF6D28D9", reviewLight: "FFEDE4FF",
  proof: "FF0F766E", proofLight: "FFD3F2EE",
  zebra: "FFF6F8FC",
  border: "FFD5DCE8",
  over200: "FFFFF2CC", over300: "FFFFDDB8", over400: "FFFFC7CE",
  over200Text: "FF8A6100", over300Text: "FF9A4A00", over400Text: "FF9B1C1C",
  yes: "FFDBEAFE", yesText: "FF1D4ED8",
  no: "FFEEF0F4", noText: "FF475569",
  unset: "FFFEF3C7", unsetText: "FF92400E",
  green: "FF047857", amber: "FFB45309", red: "FFB91C1C",
};
const solid = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin = { style: "thin" as const, color: { argb: C.border } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
/** A logged 0 shows as 0.0; a day without a trip is an empty cell. */
const MILES = "#,##0.0";
const MONEY = "$#,##0.00";
const RATE = "$0.00";

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const colName = (n: number) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function title(sheet: Worksheet, text: string, sub: string, width: number) {
  sheet.mergeCells(1, 1, 1, width);
  const t = sheet.getCell(1, 1);
  t.value = text;
  t.font = { name: "Calibri", size: 15, bold: true, color: { argb: C.titleText } };
  t.fill = solid(C.title);
  t.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 28;
  sheet.mergeCells(2, 1, 2, width);
  const s = sheet.getCell(2, 1);
  s.value = sub;
  s.font = { name: "Calibri", size: 10, italic: true, color: { argb: C.sub } };
  s.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(2).height = 18;
}

/** A coloured band over columns [from, to] on `row`, with the column headers under it in the light shade. */
function band(sheet: Worksheet, row: number, from: number, to: number, label: string, dark: string, light: string) {
  if (to > from) sheet.mergeCells(row, from, row, to);
  const c = sheet.getCell(row, from);
  c.value = label;
  c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  c.fill = solid(dark);
  c.alignment = { horizontal: "center", vertical: "middle" };
  for (let col = from; col <= to; col++) {
    sheet.getCell(row, col).border = box;
    const h = sheet.getCell(row + 1, col);
    h.fill = solid(light);
    h.font = { bold: true, size: 10, color: { argb: dark } };
    h.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    h.border = { ...box, bottom: { style: "medium", color: { argb: dark } } };
  }
}

function carIqCell(cell: Cell, v: boolean | null) {
  cell.value = v == null ? "Not set" : v ? "Yes" : "No";
  cell.fill = solid(v == null ? C.unset : v ? C.yes : C.no);
  cell.font = { bold: true, color: { argb: v == null ? C.unsetText : v ? C.yesText : C.noText } };
  cell.alignment = { horizontal: "center" };
}

async function save(workbook: import("exceljs").Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Splits the days into Sunday–Saturday weeks (a range can start or end mid-week). */
function weeks(days: string[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  days.forEach((d, i) => {
    if (i === 0 || weekday(d) === "Sun") out.push({ from: i, to: i });
    else out[out.length - 1].to = i;
  });
  return out;
}

export async function downloadMileageGridWorkbook(opts: {
  rangeLabel: string;
  filterNote: string;
  days: string[];
  rows: MileageGridExportRow[];
  fileName: string;
}) {
  const { days, rows } = opts;
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const sheet = wb.addWorksheet("Daily Mileage", { views: [{ state: "frozen", xSplit: 3, ySplit: 4, showGridLines: false }] });

  const ID = 3; // Technician, Branch, Car IQ
  const firstDay = ID + 1;
  const lastDay = ID + days.length;
  const totalsFrom = lastDay + 1; // Total, Excluded, Eligible
  const payFrom = totalsFrom + 3; // Rate, Pay, Approved Pay
  const longFrom = payFrom + 3; // >200, >300, >400
  const width = longFrom + 2;

  title(sheet, `Daily Mileage · ${opts.rangeLabel}`, `Eligible miles per day (total − excluded). ${opts.filterNote} Exported ${new Date().toLocaleString("en-US")}.`, width);

  // Row 3: colour bands; row 4: column headers.
  band(sheet, 3, 1, ID, "Technician", C.identity, C.identityLight);
  weeks(days).forEach((w, i) => {
    const dark = i % 2 === 0 ? C.weekA : C.weekB;
    const light = i % 2 === 0 ? C.weekALight : C.weekBLight;
    band(sheet, 3, firstDay + w.from, firstDay + w.to, `Week ${i + 1} · ${fmtDay(days[w.from])} – ${fmtDay(days[w.to])}`, dark, light);
  });
  band(sheet, 3, totalsFrom, totalsFrom + 2, "Miles", C.totals, C.totalsLight);
  band(sheet, 3, payFrom, payFrom + 2, "Pay", C.pay, C.payLight);
  band(sheet, 3, longFrom, longFrom + 2, "Long days", C.long, C.longLight);
  sheet.getRow(3).height = 20;

  const headers = ["Technician", "Branch", "Car IQ", ...days.map((d) => `${weekday(d)}\n${fmtDay(d)}`), "Total", "Excluded", "Eligible", "Rate", "Pay", "Approved", ">200", ">300", ">400"];
  headers.forEach((h, i) => { sheet.getCell(4, i + 1).value = h; });
  sheet.getRow(4).height = 32;
  sheet.getCell(4, 1).alignment = { horizontal: "left", vertical: "middle", indent: 1 };

  // Data.
  rows.forEach((r, i) => {
    const rowNo = 5 + i;
    const row = sheet.getRow(rowNo);
    const zebra = i % 2 === 1 ? solid(C.zebra) : undefined;
    row.getCell(1).value = r.name;
    row.getCell(1).font = { bold: true, color: { argb: "FF0F1E3D" } };
    row.getCell(2).value = r.branch || "—";
    row.getCell(2).font = { color: { argb: C.sub } };
    carIqCell(row.getCell(3), r.carIq);
    r.days.forEach((m, d) => {
      const cell = row.getCell(firstDay + d);
      cell.value = m;
      cell.numFmt = MILES;
      cell.alignment = { horizontal: "right" };
      if (m != null && m > 400) { cell.fill = solid(C.over400); cell.font = { bold: true, color: { argb: C.over400Text } }; }
      else if (m != null && m > 300) { cell.fill = solid(C.over300); cell.font = { bold: true, color: { argb: C.over300Text } }; }
      else if (m != null && m > 200) { cell.fill = solid(C.over200); cell.font = { color: { argb: C.over200Text } }; }
      else if (zebra) cell.fill = zebra;
    });
    const set = (col: number, v: number | string | null, numFmt?: string, color?: string, bold = false) => {
      const cell = row.getCell(col);
      cell.value = v;
      if (numFmt) cell.numFmt = numFmt;
      cell.font = { bold, color: color ? { argb: color } : undefined };
      cell.alignment = { horizontal: "right" };
      if (zebra) cell.fill = zebra;
    };
    set(totalsFrom, r.total, MILES);
    set(totalsFrom + 1, r.excluded || null, MILES, C.amber);
    set(totalsFrom + 2, r.eligible, MILES, undefined, true);
    set(payFrom, r.rates.length === 1 ? r.rates[0] : r.rates.length ? r.rates.map((x) => `$${x.toFixed(2)}`).join(" / ") : r.carIq == null ? "not set" : null, r.rates.length === 1 ? RATE : undefined, r.rates.length ? undefined : C.unsetText);
    set(payFrom + 1, r.pay, MONEY, C.green, true);
    set(payFrom + 2, r.approvedPay, MONEY, C.green);
    set(longFrom, r.over200 || null, "0", C.over200Text);
    set(longFrom + 1, r.over300 || null, "0", C.over300Text);
    set(longFrom + 2, r.over400 || null, "0", C.over400Text, true);
    for (let col = 1; col <= width; col++) {
      const cell = row.getCell(col);
      cell.border = { bottom: thin, left: col === firstDay || col === totalsFrom || col === payFrom || col === longFrom ? { style: "thin", color: { argb: "FF9AA8C0" } } : undefined };
      if (zebra && (col <= 2)) cell.fill = zebra;
    }
  });

  // Totals row (formulas, so edits in Excel add up).
  const last = 4 + rows.length;
  const tRow = sheet.getRow(last + 1);
  tRow.getCell(1).value = `Total · ${rows.length} technician${rows.length === 1 ? "" : "s"}`;
  for (let col = firstDay; col <= width; col++) {
    if (col === payFrom) continue; // rates don't add up
    const letter = colName(col);
    const cell = tRow.getCell(col);
    cell.value = rows.length ? { formula: `SUM(${letter}5:${letter}${last})` } : 0;
    cell.numFmt = col === payFrom + 1 || col === payFrom + 2 ? MONEY : col >= longFrom ? "0" : MILES;
    cell.alignment = { horizontal: "right" };
  }
  for (let col = 1; col <= width; col++) {
    const cell = tRow.getCell(col);
    cell.fill = solid(C.title);
    cell.font = { bold: true, color: { argb: col === payFrom + 1 || col === payFrom + 2 ? "FF6EE7B7" : "FFFFFFFF" } };
    cell.border = { top: { style: "medium", color: { argb: C.title } } };
  }
  tRow.height = 20;

  // Legend.
  const legendRow = last + 3;
  const legend: [string, string, string][] = [
    ["Over 200 mi", C.over200, C.over200Text],
    ["Over 300 mi", C.over300, C.over300Text],
    ["Over 400 mi", C.over400, C.over400Text],
    ["Car IQ: Yes", C.yes, C.yesText],
    ["Car IQ: No", C.no, C.noText],
    ["Car IQ: Not set", C.unset, C.unsetText],
  ];
  sheet.getCell(legendRow, 1).value = "Legend";
  sheet.getCell(legendRow, 1).font = { bold: true, color: { argb: C.sub } };
  legend.forEach(([label, fill, text], i) => {
    const cell = sheet.getCell(legendRow + 1 + i, 1);
    cell.value = label;
    cell.fill = solid(fill);
    cell.font = { bold: true, color: { argb: text } };
    cell.border = box;
  });

  // Widths.
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 9;
  for (let col = firstDay; col <= lastDay; col++) sheet.getColumn(col).width = 8.5;
  [10, 10, 10, 9, 12, 12, 6, 6, 6].forEach((w, i) => { sheet.getColumn(totalsFrom + i).width = w; });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: width } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  await save(wb, opts.fileName);
}

const STATUS_STYLE: Record<string, [string, string]> = {
  Approved: [C.payLight, C.green],
  Rejected: [C.longLight, C.red],
  "Needs review": [C.over200, C.amber],
  Pending: [C.no, C.noText],
};

export async function downloadMileageTripsWorkbook(opts: { rangeLabel: string; filterNote: string; rows: MileageTripExportRow[]; fileName: string }) {
  const { rows } = opts;
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const sheet = wb.addWorksheet("Mileage Trips", { views: [{ state: "frozen", xSplit: 2, ySplit: 4, showGridLines: false }] });

  const headers = ["Date", "Technician", "Branch", "Vehicle", "Total Miles", "Excluded", "Exclusion Reason", "Eligible Miles", "Car IQ", "Rate / Mile", "Compensation", "Status", "Approved By", "Entry Check", "Ticket #", "Total Mile Map", "Eligible Mile Map", "Notes"];
  const width = headers.length;
  title(sheet, `Mileage Trips · ${opts.rangeLabel}`, `One row per trip. Car IQ, rate and compensation come from AHS for each date. ${opts.filterNote} Exported ${new Date().toLocaleString("en-US")}.`, width);
  band(sheet, 3, 1, 4, "Trip", C.identity, C.identityLight);
  band(sheet, 3, 5, 8, "Miles", C.miles, C.milesLight);
  band(sheet, 3, 9, 11, "Pay", C.pay, C.payLight);
  band(sheet, 3, 12, 14, "Review", C.review, C.reviewLight);
  band(sheet, 3, 15, 18, "Proof", C.proof, C.proofLight);
  sheet.getRow(3).height = 20;
  headers.forEach((h, i) => { sheet.getCell(4, i + 1).value = h; });
  sheet.getRow(4).height = 30;

  rows.forEach((t, i) => {
    const row = sheet.getRow(5 + i);
    const zebra = i % 2 === 1 ? solid(C.zebra) : undefined;
    const values: (string | number | null)[] = [
      new Date(`${t.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", year: "numeric" }),
      t.technician, t.branch, t.vehicle, t.total, t.excluded || null, t.reason, t.eligible, null, t.rate, t.pay, t.status, t.approvedBy, t.check || "OK",
      t.ticketRefs, null, null, t.notes,
    ];
    values.forEach((v, c) => { row.getCell(c + 1).value = v; if (zebra) row.getCell(c + 1).fill = zebra; row.getCell(c + 1).border = { bottom: thin }; });
    row.getCell(2).font = { bold: true, color: { argb: "FF0F1E3D" } };
    [5, 6, 8].forEach((c) => { row.getCell(c).numFmt = MILES; });
    row.getCell(6).font = { color: { argb: C.amber } };
    row.getCell(8).font = { bold: true };
    carIqCell(row.getCell(9), t.carIq);
    row.getCell(10).numFmt = RATE;
    row.getCell(11).numFmt = MONEY;
    row.getCell(11).font = { bold: true, color: { argb: C.green } };
    const [sFill, sText] = STATUS_STYLE[t.status] ?? STATUS_STYLE.Pending;
    row.getCell(12).fill = solid(sFill);
    row.getCell(12).font = { bold: true, color: { argb: sText } };
    row.getCell(12).alignment = { horizontal: "center" };
    const check = row.getCell(14);
    check.fill = solid(t.check ? C.over200 : C.payLight);
    check.font = { bold: true, color: { argb: t.check ? C.amber : C.green } };
    check.alignment = { horizontal: "center" };
    ([[16, t.totalMapUrl], [17, t.eligibleMapUrl]] as const).forEach(([c, url]) => {
      if (/^https?:\/\//i.test(url)) {
        row.getCell(c).value = { text: url, hyperlink: url };
        row.getCell(c).font = { color: { argb: "FF2563EB" }, underline: true };
      }
    });
    if (t.status === "Rejected") [5, 8, 11].forEach((c) => { row.getCell(c).font = { strike: true, color: { argb: C.noText } }; });
  });

  const last = 4 + rows.length;
  const tRow = sheet.getRow(last + 1);
  tRow.getCell(1).value = `Total · ${rows.length} trip${rows.length === 1 ? "" : "s"}`;
  ([[5, MILES], [6, MILES], [8, MILES], [11, MONEY]] as const).forEach(([c, f]) => {
    const letter = colName(c);
    tRow.getCell(c).value = rows.length ? { formula: `SUM(${letter}5:${letter}${last})` } : 0;
    tRow.getCell(c).numFmt = f;
  });
  for (let col = 1; col <= width; col++) {
    const cell = tRow.getCell(col);
    cell.fill = solid(C.title);
    cell.font = { bold: true, color: { argb: col === 11 ? "FF6EE7B7" : "FFFFFFFF" } };
  }
  tRow.height = 20;

  [16, 22, 18, 15, 10, 10, 20, 11, 8, 9, 13, 13, 18, 13, 26, 28, 28, 40].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: width } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  await save(wb, opts.fileName);
}
