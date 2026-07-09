import * as XLSX from "xlsx";

import workbookUrl from "../../report_sheet/CSR DAILY REPORT.xlsx?url";

export type CsrCell = string | number | boolean | Date | null;

export interface CsrWorkbookColumn {
  index: number;
  label: string;
}

export interface CsrWorkbookRow {
  values: CsrCell[];
  lookup: Record<string, CsrCell>;
  searchText: string;
}

export interface CsrWorkbookBlock {
  teamName: string;
  columns: CsrWorkbookColumn[];
  rows: CsrWorkbookRow[];
  totals: {
    rows: number;
    schedule: number;
    attempt: number;
    update: number;
    mistakeCount: number;
  };
}

export interface CsrWorkbookSheet {
  sheetName: string;
  label: string;
  sortKey: number;
  blocks: CsrWorkbookBlock[];
}

export interface CsrWorkbookData {
  sheets: CsrWorkbookSheet[];
  teamNames: string[];
  memberNames: string[];
}

let workbookPromise: Promise<CsrWorkbookData> | null = null;

function normalizeText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString("en-US");
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isMeaningful(value: unknown): boolean {
  return value != null && normalizeText(value) !== "";
}

function isTeamRow(value: unknown): value is string {
  return typeof value === "string" && value.trim().toUpperCase().startsWith("TEAM ");
}

function getSheetSortKey(sheetName: string): number {
  const digits = sheetName.replace(/\D/g, "");
  if (!digits) return 0;
  if (digits.length === 3) {
    return Number(digits.slice(0, 1)) * 100 + Number(digits.slice(1));
  }
  if (digits.length === 4) {
    return Number(digits.slice(0, 2)) * 100 + Number(digits.slice(2));
  }
  return Number(digits);
}

export function formatSheetLabel(sheetName: string): string {
  const digits = sheetName.replace(/\D/g, "");
  if (digits.length === 3) {
    return `${digits.slice(0, 1)}/${digits.slice(1).padStart(2, "0")}`;
  }
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return sheetName;
}

function parseNumber(value: CsrCell): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildColumns(headerRow: unknown[], rows: unknown[][]): CsrWorkbookColumn[] {
  const maxColumns = Math.max(headerRow.length, ...rows.map((row) => row.length));
  const columns: CsrWorkbookColumn[] = [];

  for (let index = 0; index < maxColumns; index += 1) {
    const label = normalizeText(headerRow[index]);
    const hasData = rows.some((row) => isMeaningful(row[index]));
    if (!label && !hasData) continue;
    columns.push({ index, label: label || `Column ${index + 1}` });
  }

  return columns;
}

function buildRow(row: unknown[], columns: CsrWorkbookColumn[]): CsrWorkbookRow {
  const values = columns.map((column) => (row[column.index] as CsrCell) ?? null);
  const lookup = Object.fromEntries(columns.map((column, index) => [column.label, values[index]]));
  const searchText = values.map((value) => normalizeText(value).toLowerCase()).join(" ");

  return { values, lookup, searchText };
}

function computeTotals(rows: CsrWorkbookRow[], columns: CsrWorkbookColumn[]) {
  const scheduleIndex = columns.findIndex((column) => normalizeKey(column.label) === "schedule");
  const attemptIndex = columns.findIndex((column) => normalizeKey(column.label) === "attempt");
  const updateIndex = columns.findIndex((column) => normalizeKey(column.label) === "update");
  const mistakeIndex = columns.findIndex((column) => normalizeKey(column.label) === "mistake");

  return {
    rows: rows.length,
    schedule: scheduleIndex === -1 ? 0 : rows.reduce((sum, row) => sum + parseNumber(row.values[scheduleIndex]), 0),
    attempt: attemptIndex === -1 ? 0 : rows.reduce((sum, row) => sum + parseNumber(row.values[attemptIndex]), 0),
    update: updateIndex === -1 ? 0 : rows.reduce((sum, row) => sum + parseNumber(row.values[updateIndex]), 0),
    mistakeCount:
      mistakeIndex === -1
        ? 0
        : rows.reduce((sum, row) => (normalizeText(row.values[mistakeIndex]) ? sum + 1 : sum), 0),
  };
}

function parseSheet(sheetName: string, sheet: XLSX.WorkSheet): CsrWorkbookSheet {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null });
  const blocks: CsrWorkbookBlock[] = [];
  let index = 0;

  while (index < rawRows.length) {
    const row = rawRows[index] ?? [];
    const firstCell = row[0];

    if (!isTeamRow(firstCell)) {
      index += 1;
      continue;
    }

    const teamName = normalizeText(firstCell);
    const headerRow = rawRows[index + 1] ?? [];
    let blockEnd = index + 2;

    while (blockEnd < rawRows.length && !isTeamRow((rawRows[blockEnd] ?? [])[0])) {
      blockEnd += 1;
    }

    const blockRowsRaw = rawRows.slice(index + 2, blockEnd).filter((candidate) => candidate.some(isMeaningful));
    const columns = buildColumns(headerRow, blockRowsRaw);
    const rows = blockRowsRaw.map((candidate) => buildRow(candidate, columns));

    blocks.push({
      teamName,
      columns,
      rows,
      totals: computeTotals(rows, columns),
    });

    index = blockEnd;
  }

  return {
    sheetName,
    label: formatSheetLabel(sheetName),
    sortKey: getSheetSortKey(sheetName),
    blocks,
  };
}

export async function loadCsrWorkbook(): Promise<CsrWorkbookData> {
  if (!workbookPromise) {
    workbookPromise = fetch(workbookUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load CSR workbook: ${response.status} ${response.statusText}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        const sheets = workbook.SheetNames.map((sheetName) => parseSheet(sheetName, workbook.Sheets[sheetName]))
          .filter((sheet) => sheet.blocks.length > 0)
          .sort((left, right) => right.sortKey - left.sortKey || left.sheetName.localeCompare(right.sheetName));

        const teamNames = Array.from(new Set(sheets.flatMap((sheet) => sheet.blocks.map((block) => block.teamName)))).sort();
        const memberNames = Array.from(
          new Set(
            sheets.flatMap((sheet) => sheet.blocks.flatMap((block) => block.rows.map((row) => normalizeText(row.values[0])))),
          ),
        ).filter(Boolean).sort();

        return { sheets, teamNames, memberNames } satisfies CsrWorkbookData;
      });
  }

  return workbookPromise;
}

export function formatCsrCell(value: CsrCell): string {
  if (value instanceof Date) return value.toLocaleDateString("en-US");
  if (value == null) return "—";
  const normalized = normalizeText(value);
  return normalized === "" ? "—" : normalized;
}

export function getColumnValue(row: CsrWorkbookRow, label: string): CsrCell {
  return row.lookup[label] ?? null;
}

export function getColumnIndex(columns: CsrWorkbookColumn[], labelCandidates: string[]): number {
  const candidateKeys = labelCandidates.map(normalizeKey);
  return columns.findIndex((column) => candidateKeys.includes(normalizeKey(column.label)));
}
