/**
 * Styled Excel report writer (exceljs) — one look for downloadable reports:
 * navy title banner + subtitle line, coloured header row, striped rows,
 * thin borders, frozen header + first column, filters on, optional totals
 * row and colour-coded status cells. Used by Attendance Monitoring's
 * Date Range Attendance Report.
 */
import type { Worksheet } from "exceljs";

export interface ReportColumn {
  header: string;
  width?: number;
  align?: "left" | "center" | "right";
  /** Excel number format, e.g. '0.00' or '0;-0;"–"'. */
  numFmt?: string;
  /** Sum this column in the totals row. */
  total?: boolean;
  /** Header fill override (ARGB). */
  headerFill?: string;
  wrap?: boolean;
}

export interface ReportSheet {
  name: string;
  title: string;
  subtitle: string;
  note?: string;
  columns: ReportColumn[];
  rows: (string | number | null)[][];
  /** Column index whose text value picks a cell colour from `statusStyles`. */
  statusColumn?: number;
  statusStyles?: Record<string, { fill: string; font: string }>;
  /** Adds a TOTAL row summing every column marked `total`. */
  totalsRow?: boolean;
}

const FONT = "Arial";
const NAVY = "FF1F3864";
const HEADER = "FF2F5597";
const STRIPE = "FFF3F6FB";
const BORDER = { style: "thin" as const, color: { argb: "FFD9DEE7" } };
const BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

function writeSheet(ws: Worksheet, sheet: ReportSheet) {
  const cols = sheet.columns.length;
  const firstDataRow = 6;

  // Banner: title, subtitle, note.
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = sheet.title;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, cols);
  const st = ws.getCell(2, 1);
  st.value = sheet.subtitle;
  st.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
  st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } };
  st.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 20;
  ws.mergeCells(3, 1, 3, cols);
  const n = ws.getCell(3, 1);
  n.value = sheet.note ?? "";
  n.font = { name: FONT, size: 9, italic: true, color: { argb: "FF6B7280" } };
  n.alignment = { vertical: "middle", indent: 1, wrapText: true };
  ws.getRow(3).height = sheet.note ? 18 : 6;

  // Header row (row 5; row 4 is a spacer).
  const hr = ws.getRow(5);
  sheet.columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.headerFill ?? HEADER } };
    cell.alignment = { vertical: "middle", horizontal: c.align === "left" || (!c.align && i === 0) ? "left" : "center", wrapText: true };
    cell.border = BORDERS;
    ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 3);
  });
  hr.height = 32;

  // Data rows.
  sheet.rows.forEach((vals, r) => {
    const row = ws.getRow(firstDataRow + r);
    sheet.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = vals[i];
      cell.value = v === null || v === undefined ? "" : v;
      cell.font = { name: FONT, size: 10, bold: i === 0, color: { argb: "FF1F2937" } };
      cell.alignment = { vertical: "top", horizontal: c.align ?? (i === 0 ? "left" : "center"), wrapText: !!c.wrap };
      if (c.numFmt && typeof v === "number") cell.numFmt = c.numFmt;
      cell.border = BORDERS;
      if (r % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE } };
      if (i === sheet.statusColumn && sheet.statusStyles?.[String(v)]) {
        const s = sheet.statusStyles[String(v)];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } };
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: s.font } };
      }
    });
  });

  // Totals row.
  if (sheet.totalsRow && sheet.rows.length > 0) {
    const rowNo = firstDataRow + sheet.rows.length;
    const tr = ws.getRow(rowNo);
    sheet.columns.forEach((c, i) => {
      const cell = tr.getCell(i + 1);
      if (i === 0) cell.value = "TOTAL";
      else if (c.total) {
        const col = ws.getColumn(i + 1).letter;
        cell.value = { formula: `SUM(${col}${firstDataRow}:${col}${rowNo - 1})` };
        if (c.numFmt) cell.numFmt = c.numFmt;
      }
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } };
      cell.alignment = { vertical: "middle", horizontal: c.align ?? (i === 0 ? "left" : "center") };
      cell.border = { ...BORDERS, top: { style: "medium", color: { argb: NAVY } } };
    });
    tr.height = 20;
  }

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + sheet.rows.length, column: cols } };
}

/** Builds the workbook and starts the browser download. */
export async function downloadStyledReport(fileName: string, sheets: ReportSheet[]): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Admin Hub Solutions";
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
    writeSheet(ws, sheet);
  }
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
