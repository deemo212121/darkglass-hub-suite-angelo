/**
 * Reports Library (see src/lib/supabase/executiveReports.ts) — turns an
 * uploaded spreadsheet into what the page shows:
 *
 *   readReportFile  .xlsx / .xls / .csv → every sheet's cells as display
 *                   text, exactly as the spreadsheet shows them (CSV values
 *                   are kept verbatim — never re-parsed into dates/numbers).
 *   analyzeSheet    one sheet's cells → dashboard blocks: the title, notes,
 *                   headline-number tiles (an ALL-CAPS label row with values
 *                   under it), and titled tables (a short heading row
 *                   followed by a header row and data rows) — the layout the
 *                   HR dashboards are built with.
 *
 * Pure apart from readReportFile's file reading; the page renders blocks.
 */

export interface ReportSheet {
  name: string;
  rows: string[][];
}

export type ReportBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "kpis"; items: { label: string; value: string; caption: string }[] }
  | {
      kind: "table";
      title: string | null;
      header: string[];
      rows: string[][];
      /** Per column: right-aligned number column. */
      numeric: boolean[];
      /** Per row: a "Total" row (bold, left out of the bars' scale). */
      totals: boolean[];
      /** Column drawn with in-cell bars (a label column plus a count), or null. */
      barColumn: number | null;
    };

/** Excel formula errors that arrive as text (#REF! etc.). */
export const SPREADSHEET_ERROR = /^#(REF!|N\/A|DIV\/0!|VALUE!|NAME\?|NUM!|NULL!|SPILL!|CALC!)$/;

const NUMBER = /^[-+]?\$?\d[\d,]*(\.\d+)?%?$/;

export function parseNumber(cell: string): number | null {
  if (!NUMBER.test(cell.trim())) return null;
  const n = Number(cell.replace(/[$,%+]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cleanRows(raw: unknown[][]): string[][] {
  const rows = raw.map((r) => (r ?? []).map((c) => (c == null ? "" : String(c).trim())));
  for (const r of rows) while (r.length && r[r.length - 1] === "") r.pop();
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

/** "PH OFFICE STAFFS - Dashboard.csv" → "Dashboard" (a CSV is one sheet, named after its export). */
function csvSheetName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const dash = base.lastIndexOf(" - ");
  return dash >= 0 ? base.slice(dash + 3).trim() || "Sheet" : "Sheet";
}

/** "PH OFFICE STAFFS - Dashboard.csv" → "PH OFFICE STAFFS". */
export function defaultReportTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const dash = base.lastIndexOf(" - ");
  return (dash >= 0 ? base.slice(0, dash) : base).trim() || base;
}

export async function readReportFile(file: File): Promise<ReportSheet[]> {
  const XLSX = await import("xlsx");
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  // CSV: read as UTF-8 text with value parsing off, so "09/23/2025" or
  // "13.3%" stay exactly as written (and "•"/"–" don't turn into mojibake).
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: "string", raw: true })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  return workbook.SheetNames.map((name) => {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "", blankrows: true });
    return { name: isCsv ? csvSheetName(file.name) : name, rows: cleanRows(raw as unknown[][]) };
  }).filter((s) => s.rows.length > 0);
}

const filled = (row: string[] | undefined) => (row ?? []).map((c, i) => ({ c, i })).filter((x) => x.c !== "");
/** A tile label: written in capitals, ignoring a bracketed aside — "UNPAID LEAVE DAYS (incl. sick)" is one. */
const isCapsLabel = (s: string) => {
  if (NUMBER.test(s)) return false;
  const letters = s.replace(/\([^)]*\)/g, "").replace(/[^A-Za-z]/g, "");
  return letters.length > 0 && letters === letters.toUpperCase();
};
const isTotalRow = (row: string[]) => /^(grand\s+)?total$/i.test(row.find((c) => c !== "") ?? "");

/** Headline tiles: a 2–3 row block whose first row is all ALL-CAPS labels with a value under most of them. */
function asKpis(grid: string[][]): ReportBlock | null {
  if (grid.length < 2 || grid.length > 3) return null;
  const labels = grid[0].map((c, k) => ({ c, k })).filter((x) => x.c);
  if (labels.length < 2 || !labels.every((x) => isCapsLabel(x.c))) return null;
  const withValue = labels.filter((x) => grid[1][x.k] !== "");
  if (withValue.length < Math.ceil(labels.length / 2)) return null;
  return { kind: "kpis", items: labels.map((x) => ({ label: x.c, value: grid[1][x.k] ?? "", caption: grid[2]?.[x.k] ?? "" })) };
}

function asTable(grid: string[][], title: string | null): ReportBlock {
  const [header, ...rows] = grid;
  const totals = rows.map(isTotalRow);
  const body = rows.filter((_, r) => !totals[r]);
  const numeric = header.map((_, k) => {
    const cells = body.map((r) => r[k]).filter((c) => c && !SPREADSHEET_ERROR.test(c));
    return cells.length > 0 && cells.filter((c) => NUMBER.test(c)).length / cells.length >= 0.6;
  });
  // Bars: a text label column (a leading Rank column is fine), a handful of
  // rows, and the first count column after it — not a rank, rate,
  // percentage or date.
  let barColumn: number | null = null;
  const labelColumn = numeric.findIndex((n) => !n);
  if (labelColumn >= 0 && body.length >= 2 && body.length <= 40) {
    const candidates: number[] = [];
    for (let k = labelColumn + 1; k < header.length; k++) {
      if (!numeric[k] || /\b(rank|#|no\.?|rate|%|date|year)\b/i.test(header[k])) continue;
      const values = body.map((r) => parseNumber(r[k] ?? "")).filter((n): n is number => n != null);
      if (values.some((n) => n < 0) || !values.some((n) => n > 0)) continue;
      if (body.some((r) => (r[k] ?? "").includes("%"))) continue;
      candidates.push(k);
    }
    // The column these reports are about (days absent / on leave) when there is one.
    barColumn = candidates.find((k) => /\b(days?|absen\w*|leave)\b/i.test(header[k])) ?? candidates[0] ?? null;
  }
  return { kind: "table", title, header, rows, numeric, totals, barColumn };
}

export function analyzeSheet(rows: string[][]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let pendingTitle: string | null = null;
  let first = true;
  let i = 0;
  while (i < rows.length) {
    const cells = filled(rows[i]);
    if (cells.length === 0) {
      if (pendingTitle) blocks.push({ kind: "heading", text: pendingTitle });
      pendingTitle = null;
      i++;
      continue;
    }
    if (cells.length === 1) {
      const text = cells[0].c;
      if (pendingTitle) blocks.push({ kind: "heading", text: pendingTitle });
      pendingTitle = null;
      if (first) blocks.push({ kind: "title", text });
      else if (filled(rows[i + 1]).length >= 2) pendingTitle = text;
      else if (text.length <= 60 && !/^[•\-*]/.test(text) && !/[.;:]$/.test(text)) blocks.push({ kind: "heading", text });
      else blocks.push({ kind: "text", text });
      first = false;
      i++;
      continue;
    }
    // A run of multi-cell rows: tiles or a table.
    let j = i;
    while (j < rows.length && filled(rows[j]).length >= 2) j++;
    const block = rows.slice(i, j);
    const used = Array.from(new Set(block.flatMap((r) => filled(r).map((x) => x.i)))).sort((a, b) => a - b);
    const grid = block.map((r) => used.map((k) => r[k] ?? ""));
    blocks.push(asKpis(grid) ?? asTable(grid, pendingTitle));
    pendingTitle = null;
    first = false;
    i = j;
  }
  if (pendingTitle) blocks.push({ kind: "heading", text: pendingTitle });
  return blocks;
}

/** How many cells in the report are spreadsheet formula errors (#REF! etc.). */
export function countSpreadsheetErrors(sheets: ReportSheet[]): number {
  let n = 0;
  for (const s of sheets) for (const r of s.rows) for (const c of r) if (SPREADSHEET_ERROR.test(c)) n++;
  return n;
}
