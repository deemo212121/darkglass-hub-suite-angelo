/**
 * Styled workbook for the Attendance Monitoring Report's Download (same look
 * as Attendance Monitoring's PTO History export): a navy title banner with
 * the period, coloured header rows, striped rows, colour-coded counts,
 * totals rows, numbers kept as numbers. A sheet holds one table, or several
 * stacked sections (the Overview), each with its own heading.
 */
export type AttendanceCell = string | number | null;

export interface AttendanceSheetRow {
  cells: AttendanceCell[];
  /** "left" = a deactivated / resigned person (red name); "group" = a section band row. */
  tone?: "left" | "group";
}

export interface AttendanceTable {
  /** Section heading above the table (stacked sections only). */
  heading?: string;
  headers: string[];
  rows: AttendanceSheetRow[];
  /** Leading columns that are text (left-aligned); the rest are centered numbers. */
  textCols: number;
  /** Excel number formats by column index, e.g. "0.00". */
  formats?: Record<number, string>;
  /** Columns whose non-zero values are a problem (red) / a heads-up (amber) / good (green). */
  redCols?: number[];
  amberCols?: number[];
  greenCols?: number[];
  /** Columns summed in a TOTAL row at the bottom. */
  totalCols?: number[];
  /** Header fill per column (ARGB), e.g. green over "Present". */
  headerFills?: Record<number, string>;
}

export interface AttendanceSheetSpec extends Partial<AttendanceTable> {
  name: string;
  title: string;
  note?: string;
  /** Several tables stacked on one sheet; otherwise the spec itself is the table. */
  sections?: AttendanceTable[];
  widths?: Record<number, number>;
}

const FONT = "Arial";
const NAVY = "FF1F3864";
const HEADER = "FF2F5597";
const STRIPE = "FFF3F6FB";
const PALE = "FFDCE6F4";
const INK = "FF1F2937";
export const FILL_GREEN = "FF2E7D32";
export const FILL_RED = "FFB91C1C";
export const FILL_AMBER = "FFB45309";
const BORDER = { style: "thin" as const, color: { argb: "FFD9DEE7" } };
const BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

export async function writeAttendanceWorkbook(fileName: string, subtitle: string, sheets: AttendanceSheetSpec[]): Promise<void> {
  const ExcelJS = await import("exceljs");
  type Ws = import("exceljs").Worksheet;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Admin Hub Solutions";
  const generated = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  /** Writes one table starting at `top`; returns the next free row. */
  const writeTable = (ws: Ws, top: number, width: number, t: AttendanceTable, stacked: boolean): number => {
    let rowNo = top;
    if (t.heading) {
      ws.mergeCells(rowNo, 1, rowNo, width);
      const h = ws.getCell(rowNo, 1);
      h.value = t.heading;
      h.font = { name: FONT, size: 12, bold: true, color: { argb: NAVY } };
      h.alignment = { vertical: "bottom" };
      h.border = { bottom: { style: "medium", color: { argb: NAVY } } };
      ws.getRow(rowNo).height = 22;
      rowNo++;
    }
    const headerRowNo = rowNo;
    const hr = ws.getRow(rowNo);
    t.headers.forEach((label, i) => {
      const c = hr.getCell(i + 1);
      c.value = label;
      c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = solid(t.headerFills?.[i] ?? HEADER);
      c.alignment = { vertical: "middle", horizontal: i < t.textCols ? "left" : "center", wrapText: true };
      c.border = BORDERS;
    });
    hr.height = 30;
    rowNo++;

    const firstBody = rowNo;
    let stripe = 0;
    for (const row of t.rows) {
      const xr = ws.getRow(rowNo);
      if (row.tone === "group") {
        ws.mergeCells(rowNo, 1, rowNo, t.headers.length);
        const c = xr.getCell(1);
        c.value = row.cells[0];
        c.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
        c.fill = solid(PALE);
        c.alignment = { vertical: "middle", indent: 1 };
        c.border = BORDERS;
        xr.height = 20;
        stripe = 0;
        rowNo++;
        continue;
      }
      const striped = stripe++ % 2 === 1;
      row.cells.forEach((v, i) => {
        const c = xr.getCell(i + 1);
        c.value = v ?? "";
        const num = typeof v === "number" ? v : 0;
        let color = INK;
        if (t.redCols?.includes(i) && num > 0) color = FILL_RED;
        else if (t.amberCols?.includes(i) && num > 0) color = FILL_AMBER;
        else if (t.greenCols?.includes(i) && num > 0) color = FILL_GREEN;
        if (i === 0 && row.tone === "left") color = FILL_RED;
        c.font = { name: FONT, size: 10, bold: i === 0 || color !== INK, italic: i === 0 && row.tone === "left", color: { argb: color } };
        c.alignment = { vertical: "middle", horizontal: i < t.textCols ? "left" : "center" };
        if (typeof v === "number") c.numFmt = t.formats?.[i] ?? '#,##0;-#,##0;"–"';
        c.border = BORDERS;
        if (striped) c.fill = solid(STRIPE);
      });
      xr.height = 18;
      rowNo++;
    }
    const lastBody = rowNo - 1;

    if (t.totalCols && t.rows.length > 0) {
      const tr = ws.getRow(rowNo);
      t.headers.forEach((_, i) => {
        const c = tr.getCell(i + 1);
        if (i === 0) c.value = "TOTAL";
        else if (t.totalCols!.includes(i)) {
          const col = ws.getColumn(i + 1).letter;
          c.value = { formula: `SUM(${col}${firstBody}:${col}${lastBody})` };
          c.numFmt = t.formats?.[i] ?? '#,##0;-#,##0;"–"';
        }
        c.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
        c.fill = solid(PALE);
        c.alignment = { vertical: "middle", horizontal: i < t.textCols ? "left" : "center" };
        c.border = { ...BORDERS, top: { style: "medium", color: { argb: NAVY } } };
      });
      tr.height = 20;
      rowNo++;
    }
    if (!stacked && t.rows.length > 0 && !t.rows.some((r) => r.tone === "group")) {
      ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: lastBody, column: t.headers.length } };
    }
    return rowNo;
  };

  for (const spec of sheets) {
    const tables: AttendanceTable[] = spec.sections ?? [spec as AttendanceTable];
    const stacked = !!spec.sections;
    const width = Math.max(...tables.map((t) => t.headers.length));
    const ws = wb.addWorksheet(spec.name, stacked ? {} : { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });

    // Banner: title / period line / note
    ws.mergeCells(1, 1, 1, width);
    const title = ws.getCell(1, 1);
    title.value = spec.title;
    title.font = { name: FONT, size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    title.fill = solid(NAVY);
    title.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, width);
    const sub = ws.getCell(2, 1);
    sub.value = `${subtitle}   •   Generated ${generated}`;
    sub.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
    sub.fill = solid(PALE);
    sub.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(2).height = 20;
    ws.mergeCells(3, 1, 3, width);
    const note = ws.getCell(3, 1);
    note.value = spec.note ?? "";
    note.font = { name: FONT, size: 9, italic: true, color: { argb: "FF6B7280" } };
    note.alignment = { vertical: "middle", indent: 1, wrapText: true };
    ws.getRow(3).height = spec.note ? 18 : 6;

    let next = 5;
    tables.forEach((t, i) => {
      next = writeTable(ws, next, width, t, stacked) + (i < tables.length - 1 ? 1 : 0);
    });

    for (let i = 0; i < width; i++) {
      const header = tables.map((t) => t.headers[i] ?? "").reduce((a, b) => (b.length > a.length ? b : a), "");
      const textCols = Math.max(...tables.map((t) => t.textCols));
      ws.getColumn(i + 1).width = spec.widths?.[i] ?? (i === 0 ? 30 : i < textCols ? 20 : Math.max(13, Math.min(20, header.length + 3)));
    }
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
