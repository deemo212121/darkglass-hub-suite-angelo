/**
 * Styled workbook for the Attendance Monitoring Report's Download (same look
 * as Attendance Monitoring's PTO History export): one sheet per section, a
 * navy title banner with the period, a coloured header row, striped rows,
 * frozen header, filters on, numbers kept as numbers, optional totals row.
 */
export type AttendanceCell = string | number | null;

export interface AttendanceSheetRow {
  cells: AttendanceCell[];
  /** "left" = a deactivated / resigned person (red name); "group" = a section band row. */
  tone?: "left" | "group";
}

export interface AttendanceSheetSpec {
  name: string;
  title: string;
  note?: string;
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
  widths?: Record<number, number>;
}

const FONT = "Arial";
const NAVY = "FF1F3864";
const HEADER = "FF2F5597";
const STRIPE = "FFF3F6FB";
const INK = "FF1F2937";
const BORDER = { style: "thin" as const, color: { argb: "FFD9DEE7" } };
const BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

export async function writeAttendanceWorkbook(fileName: string, subtitle: string, sheets: AttendanceSheetSpec[]): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Admin Hub Solutions";
  const generated = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  for (const spec of sheets) {
    const cols = spec.headers.length;
    const ws = wb.addWorksheet(spec.name, { views: [{ state: "frozen", xSplit: Math.min(1, cols), ySplit: 5 }] });

    // Banner: title / period line / note
    ws.mergeCells(1, 1, 1, cols);
    const t = ws.getCell(1, 1);
    t.value = spec.title;
    t.font = { name: FONT, size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    t.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, cols);
    const st = ws.getCell(2, 1);
    st.value = `${subtitle}   •   Generated ${generated}`;
    st.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
    st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } };
    st.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(2).height = 20;
    ws.mergeCells(3, 1, 3, cols);
    const n = ws.getCell(3, 1);
    n.value = spec.note ?? "";
    n.font = { name: FONT, size: 9, italic: true, color: { argb: "FF6B7280" } };
    n.alignment = { vertical: "middle", indent: 1, wrapText: true };
    ws.getRow(3).height = spec.note ? 18 : 6;

    // Header row
    const hr = ws.getRow(5);
    spec.headers.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
      c.alignment = { vertical: "middle", horizontal: i < spec.textCols ? "left" : "center", wrapText: true };
      c.border = BORDERS;
    });
    hr.height = 32;

    // Body
    let stripe = 0;
    spec.rows.forEach((row, r) => {
      const xr = ws.getRow(6 + r);
      if (row.tone === "group") {
        ws.mergeCells(6 + r, 1, 6 + r, cols);
        const c = xr.getCell(1);
        c.value = row.cells[0];
        c.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } };
        c.alignment = { vertical: "middle", indent: 1 };
        c.border = BORDERS;
        xr.height = 20;
        stripe = 0;
        return;
      }
      const striped = stripe++ % 2 === 1;
      row.cells.forEach((v, i) => {
        const c = xr.getCell(i + 1);
        c.value = v ?? "";
        const num = typeof v === "number" ? v : 0;
        let color = INK;
        if (spec.redCols?.includes(i) && num > 0) color = "FFB91C1C";
        else if (spec.amberCols?.includes(i) && num > 0) color = "FFB45309";
        else if (spec.greenCols?.includes(i) && num > 0) color = "FF2E7D32";
        if (i === 0 && row.tone === "left") color = "FFB91C1C";
        c.font = { name: FONT, size: 10, bold: i === 0 || color !== INK, italic: i === 0 && row.tone === "left", color: { argb: color } };
        c.alignment = { vertical: "middle", horizontal: i < spec.textCols ? "left" : "center" };
        if (typeof v === "number") c.numFmt = spec.formats?.[i] ?? '0;-0;"–"';
        c.border = BORDERS;
        if (striped) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE } };
      });
      xr.height = 18;
    });

    // Totals
    const lastBody = 5 + spec.rows.length;
    if (spec.totalCols && spec.rows.length > 0) {
      const tr = ws.getRow(lastBody + 1);
      spec.headers.forEach((_, i) => {
        const c = tr.getCell(i + 1);
        if (i === 0) c.value = "TOTAL";
        else if (spec.totalCols!.includes(i)) {
          const col = ws.getColumn(i + 1).letter;
          c.value = { formula: `SUM(${col}6:${col}${lastBody})` };
          c.numFmt = spec.formats?.[i] ?? '0;-0;"–"';
        }
        c.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } };
        c.alignment = { vertical: "middle", horizontal: i < spec.textCols ? "left" : "center" };
        c.border = { ...BORDERS, top: { style: "medium", color: { argb: NAVY } } };
      });
      tr.height = 20;
    }

    if (spec.rows.length > 0 && !spec.rows.some((r) => r.tone === "group")) {
      ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: lastBody, column: cols } };
    }
    spec.headers.forEach((h, i) => {
      ws.getColumn(i + 1).width = spec.widths?.[i] ?? (i === 0 ? 30 : i < spec.textCols ? 20 : Math.max(11, Math.min(18, h.length + 3)));
    });
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
