/**
 * Import / Export files for Parts → Truck Stock.
 *
 * Import understands two layouts:
 *  - a list with one Part # header row — this page's own export (Branch,
 *    Part No, Stored At, Description, Brand, Qty, Status, Notes) or any
 *    similar sheet;
 *  - the PROJECT A USAPP inventory workbook (.xlsx, one tab per branch code)
 *    or one tab of it saved as CSV ("… - AV.csv"). Only the Truck Stock
 *    section is read — the RETURN / LIVE columns beside it are ignored — using
 *    the same column rules scripts/parse-truck-stock-xlsx.py used for the
 *    original seed. Rows whose Status says the part has left the shelf (Used,
 *    Sold, Returned, Shipped …) aren't counted.
 *
 * Reading and planning are plain functions: TruckStockPage shows the plan as
 * a preview and only saves it (bulkUpsertTruckStock) when the user confirms.
 */
import { parseCsv } from "@/lib/csvParse";
import { todayISO } from "@/lib/localDate";
import { TRUCK_STOCK_BRANCH_CODE_MAP, resolveTruckStockBranch } from "@/lib/truckStockBranchMap";
import type { TruckStockRow, TruckStockStatus } from "@/lib/supabase/truckStock";

/** One sheet of the file: a CSV, or one tab of an .xlsx. */
export type ImportTable = { name: string; rows: string[][] };

/** One part as the file has it, its rows for the same branch already added together. */
export type ImportPart = {
  /** "" when the file doesn't say (a CSV whose name has no branch code). */
  branch: string;
  partNo: string;
  quantity: number;
  storageLocation: string;
  description: string;
  manufacturer: string;
  notes: string;
  /** null = the file doesn't say, keep what the app has. */
  status: TruckStockStatus | null;
  /** False when every row for it was Used / Sold / Returned …: that zeroes a part the app has, but never adds one. */
  canAdd: boolean;
  /** "workbook" notes are pieced together from the sheet's side columns, so they only fill empty Notes. */
  source: "list" | "workbook";
};

export type ParsedImport = {
  parts: ImportPart[];
  /** Rows not counted, by why ("Used" → 12, "Not a part number" → 2). */
  skipped: Record<string, number>;
  /** Tabs parts came from, and tabs passed over (no Truck Stock section or Part # column, or not a branch code). */
  read: string[];
  ignored: string[];
};

export type StockFields = Omit<TruckStockRow, "id" | "createdAt" | "updatedAt">;

export type StockChange = {
  kind: "add" | "update" | "remove";
  before?: TruckStockRow;
  after: StockFields;
  /** Labels of the fields an update changes. */
  changed: string[];
};

export type ImportPlan = {
  /** Adds and updates carry the full row to save, spelled the way the app's row is (so the upsert hits it). */
  changes: StockChange[];
  unchanged: number;
  /** Parts the app has at the file's branches that the file doesn't list. */
  missing: number;
  branches: string[];
};

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const upper = (v: unknown) => clean(v).toUpperCase();
/** Branch + part number, ignoring case. */
const partKey = (branch: string, partNo: string) => `${branch.trim().toLowerCase()}\u0000${partNo.trim().toLowerCase()}`;
/** Same, also ignoring runs of spaces: a workbook tab's "WE1M300 BEARING" is the app's "WE1M300  BEARING" (tab cells are tidied). */
const looseKey = (branch: string, partNo: string) => partKey(clean(branch), clean(partNo));

const PART_HEADERS = new Set(["PART", "PART #", "PART NO", "PART NUMBER", "PARTNUMBER", "PARTNO", "PART#"]);
const isPartHeader = (v: unknown) => PART_HEADERS.has(upper(v).replace(/[._]/g, "").replace(/-/g, " "));

/** Row-2 label over a Truck Stock section: TS, Truck Stock, TRUCK STOP, Truck-Stock, "TS UPDATED 6/8/2026". */
function isTruckStockLabel(v: unknown): boolean {
  const s = upper(v);
  return s === "TS" || s.startsWith("TS ") || s.includes("TRUCK STOCK") || s.includes("TRUCK STOP") || s.includes("TRUCK-STOCK");
}

/** Row-2 label that starts another section, so a Truck Stock section ends before it. */
const isSectionLabel = (v: unknown) => isTruckStockLabel(v) || /^(RETURN|RESTOCK|LIVE)/.test(upper(v));

type Kind = "location" | "status" | "quantity" | "description" | "branch" | "brand" | "notes";
const HEADER_KINDS: Record<string, Kind> = {
  LOCATION: "location", BIN: "location", SHELF: "location", "STORED AT": "location", "STORAGE LOCATION": "location",
  STATUS: "status", "STATUS 1": "status", CONDITION: "status", STATE: "status", STOCK: "status", "IN STOCK": "status",
  QUANTITY: "quantity", QTY: "quantity",
  DESCRIPTION: "description", DESC: "description", "PART NAME": "description",
  BRANCH: "branch",
  BRAND: "brand", MANUFACTURER: "brand", MFR: "brand",
  NOTE: "notes", NOTES: "notes",
};
const headerKind = (v: unknown): Kind | undefined => HEADER_KINDS[upper(v).replace(/[._]/g, "")];

/** Status words meaning the part has left the shelf (used on a job, sold, sent back, shipped …). */
const GONE = /^(used|sold|return|rma|core return|not needed|ship|sent|lost|defective|picked|in house ticket|branch to branch|b2b|transfer)/i;
const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** "2EA", "2ea NEW", "QTY 2", "x2", "set of 4", "Pack of 8" → the count and what's left; n is null when the text isn't a count. */
function splitCount(text: string): { n: number | null; rest: string } {
  const s = clean(text);
  const m = s.match(/^(?:x\s*(\d{1,3})|(\d{1,3})\s*(?:ea|pcs?)\b|qty\s*(\d{1,3})|(?:set|pack) of\s*(\d{1,3}))/i);
  if (!m) return { n: null, rest: s };
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return { n: n > 0 ? n : null, rest: s.slice(m[0].length).trim() };
}

/** The branch a tab or file name stands for (AV → Asheville), or "" when it isn't a branch code. */
const branchForTab = (name: string) => TRUCK_STOCK_BRANCH_CODE_MAP[upper(name)] ?? "";

/** A Branch cell: a code (AV) or a branch name as written. */
const branchFromCell = (v: string) => resolveTruckStockBranch(clean(v));

/** Google Sheets names a downloaded tab "<workbook> - <tab>.csv"; anything else is just the file name. */
function tabNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const i = base.lastIndexOf(" - ");
  return i >= 0 ? base.slice(i + 3) : base;
}

/** Excel cell → text. Long part numbers stored as numbers come back whole (140156010054, not 1.40156E+11). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}

/** Reads a .csv (one sheet) or .xlsx / .xls (every tab). */
export async function readTruckStockFile(file: File): Promise<ImportTable[]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return [{ name: tabNameFromFileName(file.name), rows: parseCsv(await file.text()) }];
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "", blankrows: true })
      .map((r) => r.map(cellText)),
  }));
}

type Line = Omit<ImportPart, "notes" | "canAdd" | "source"> & { notes: string[]; counted: boolean };

/** Adds rows for the same branch + part together. */
class PartCollector {
  constructor(private source: ImportPart["source"]) {}
  private parts = new Map<string, { part: ImportPart; shelf: Set<string>; anyLocation: string; notes: Set<string> }>();

  add(line: Line) {
    const key = partKey(line.branch, line.partNo);
    let entry = this.parts.get(key);
    if (!entry) {
      entry = {
        part: { ...line, quantity: 0, storageLocation: "", description: "", manufacturer: "", notes: "", status: null, canAdd: false, source: this.source },
        shelf: new Set(),
        anyLocation: "",
        notes: new Set(),
      };
      this.parts.set(key, entry);
    }
    const p = entry.part;
    entry.anyLocation ||= line.storageLocation;
    p.description ||= line.description;
    p.manufacturer ||= line.manufacturer;
    if (!line.counted) return;
    p.canAdd = true;
    p.quantity += line.quantity;
    if (line.storageLocation) entry.shelf.add(line.storageLocation);
    line.notes.forEach((n) => entry.notes.add(n));
    if (line.status === "in_use" || (line.status && !p.status)) p.status = line.status;
  }

  result(): ImportPart[] {
    return [...this.parts.values()].map(({ part, shelf, anyLocation, notes }) => ({
      ...part,
      // Bins of the rows still on the shelf; a part that's all used / returned keeps where it was.
      storageLocation: (shelf.size ? [...shelf].join(", ") : anyLocation).slice(0, 120),
      notes: [...notes].join(" · ").slice(0, 500),
    }));
  }
}

/** Part # columns of the workbook's Truck Stock sections (row 2 holds the section labels, row 1 the column names). */
function truckStockPartColumns(rows: string[][]): number[] {
  const h1 = rows[0] ?? [];
  const h2 = rows[1] ?? [];
  const cols = new Set<number>();
  h2.forEach((label, c) => {
    if (!isTruckStockLabel(label)) return;
    // Some tabs put the label a column or two before PART # (CG: label @13, PART # @15).
    let p = -1;
    for (let j = c; j < c + 8 && j < h1.length; j++) {
      if (isPartHeader(h1[j])) {
        p = j;
        break;
      }
    }
    if (p < 0) for (let j = Math.max(0, c - 1); j < c + 2; j++) if (isPartHeader(h1[j])) { p = j; break; }
    cols.add(p < 0 ? c : p);
  });
  return [...cols].sort((a, b) => a - b);
}

/**
 * The column holding the part's name. A Description header wins; otherwise an
 * unlabeled column whose cells are mostly different words (the AV tab keeps
 * "GASKET ASSEMBLY,DOOR", "MOTOR" … there). Other tabs use that unlabeled
 * column for a repeated tag (OOW, Ebay (warehouse_101)) or ticket numbers,
 * which stay in Notes.
 */
function descriptionColumn(h1: string[], cols: number[], partRows: string[][]): number | null {
  for (const c of cols) if (headerKind(h1[c]) === "description") return c;
  for (const c of cols) {
    if (clean(h1[c])) continue;
    const vals = partRows.map((r) => clean(r[c])).filter(Boolean);
    if (vals.length < Math.max(5, partRows.length * 0.25)) continue;
    const wordy = vals.filter((v) => /[a-z]{3}/i.test(v) && (/[\s,]/.test(v) || !/\d/.test(v))).length;
    if (new Set(vals.map((v) => v.toUpperCase())).size >= vals.length * 0.5 && wordy >= vals.length * 0.6) return c;
  }
  return null;
}

function readTruckStockSection(t: ImportTable, p: number, branch: string, out: PartCollector, skipped: Record<string, number>) {
  const h1 = t.rows[0] ?? [];
  const h2 = t.rows[1] ?? [];
  const width = t.rows.reduce((w, r) => Math.max(w, r.length), 0);
  const bound: { location?: number; status?: number; quantity?: number } = {};
  const bind = (k: Kind | undefined, c: number) => {
    if ((k === "location" || k === "status" || k === "quantity") && bound[k] === undefined) {
      bound[k] = c;
      return true;
    }
    return false;
  };
  // Columns to the right, up to the next section; whatever isn't Location / Status / Qty becomes notes.
  const extra: number[] = [];
  for (let c = p + 1; c < Math.min(p + 8, width); c++) {
    if (isPartHeader(h1[c]) || isSectionLabel(h2[c])) break;
    if (!bind(headerKind(h1[c]), c)) extra.push(c);
  }
  // A few tabs (CG, CT, MP) put Location / Status left of PART #. The unlabeled
  // column right before it holds counts or condition ("2EA", "NEW") on the AV tab.
  let lead: number | null = null;
  for (let c = p - 1; c >= Math.max(0, p - 4); c--) {
    if (bind(headerKind(h1[c]), c)) continue;
    if (c === p - 1 && !clean(h1[c])) lead = c;
    else break;
  }

  const dataRows = t.rows.slice(2);
  const descCol = descriptionColumn(h1, extra, dataRows.filter((r) => clean(r[p])));
  let lastLocation = "";
  for (const row of dataRows) {
    const cell = (c: number | null | undefined) => (c == null ? "" : clean(row[c]));
    const partNo = cell(p);
    if (!partNo || isPartHeader(partNo) || isSectionLabel(partNo)) continue;
    if (!/\d/.test(partNo)) {
      skipped["Not a part number"] = (skipped["Not a part number"] ?? 0) + 1;
      continue;
    }
    let location = cell(bound.location);
    if (/^\.?["”']{1,2}$/.test(location)) location = lastLocation; // ditto mark: same bin as the row above
    else if (location) lastLocation = location;

    const status = cell(bound.status);
    if (GONE.test(status)) {
      const label = statusLabel(status);
      skipped[label] = (skipped[label] ?? 0) + 1;
      out.add({ branch, partNo, quantity: 0, storageLocation: location, description: cell(descCol), manufacturer: "", notes: [], status: null, counted: false });
      continue;
    }

    let qty: number | null = null;
    const notes: string[] = [];
    if (status && !/^in stock$/i.test(status)) notes.push(status);
    if (bound.quantity !== undefined) {
      const q = cell(bound.quantity);
      const { n, rest } = /^\d{1,3}$/.test(q) ? { n: Number(q) || null, rest: "" } : splitCount(q);
      qty = n;
      if (rest) notes.push(rest);
    }
    for (const c of lead === null ? extra : [lead, ...extra]) {
      if (c === descCol) continue;
      const { n, rest } = splitCount(cell(c));
      if (n !== null && qty === null) qty = n;
      // Bare numbers beside PART # are bin slots or stray counts, not notes.
      if (rest && !(c === lead && /^\d+$/.test(rest))) notes.push(rest);
    }
    out.add({ branch, partNo, quantity: qty ?? 1, storageLocation: location, description: cell(descCol), manufacturer: "", notes, status: null, counted: true });
  }
}

/** Index of a header row with exactly one Part # column (several = side-by-side sections we can't tell apart). */
function listHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const n = rows[i].filter(isPartHeader).length;
    if (n === 1) return i;
    if (n > 1) return -1;
  }
  return -1;
}

function readList(t: ImportTable, hr: number, branch: string, out: PartCollector, skipped: Record<string, number>) {
  const col: Partial<Record<Kind | "part", number>> = {};
  t.rows[hr].forEach((h, c) => {
    const k = isPartHeader(h) ? "part" : headerKind(h);
    if (k && col[k] === undefined) col[k] = c;
  });
  for (const row of t.rows.slice(hr + 1)) {
    // Cells as typed (only trimmed), so an exported file comes back exactly as it went out.
    const cell = (c: number | undefined) => (c === undefined ? "" : String(row[c] ?? "").trim());
    const partNo = cell(col.part);
    if (!partNo || isPartHeader(partNo)) continue;
    const rowBranch = col.branch !== undefined && cell(col.branch) ? branchFromCell(cell(col.branch)) : branch;
    const status = cell(col.status);
    const base = { branch: rowBranch, partNo, storageLocation: cell(col.location), description: cell(col.description), manufacturer: cell(col.brand) };
    if (GONE.test(status)) {
      const label = statusLabel(status);
      skipped[label] = (skipped[label] ?? 0) + 1;
      out.add({ ...base, quantity: 0, notes: [], status: null, counted: false });
      continue;
    }
    const q = cell(col.quantity).replace(/,/g, "");
    const qty = q === "" ? 1 : /^\d+(\.\d+)?$/.test(q) ? Math.trunc(Number(q)) : (splitCount(q).n ?? 1);
    out.add({
      ...base,
      quantity: qty,
      notes: cell(col.notes) ? [cell(col.notes)] : [],
      status: col.status === undefined ? null : /in use/i.test(status) ? "in_use" : "in_stock",
      counted: true,
    });
  }
}

/** Every part the file lists, from whichever layout each tab has. */
export function parseTruckStockTables(tables: ImportTable[]): ParsedImport {
  const sheet = new PartCollector("workbook");
  const list = new PartCollector("list");
  const skipped: Record<string, number> = {};
  const read: string[] = [];
  const ignored: string[] = [];
  for (const t of tables) {
    const branch = branchForTab(t.name);
    const sections = truckStockPartColumns(t.rows);
    if (sections.length > 0) {
      // In a whole workbook only branch-code tabs count (FORM, "Copy of RL" … are skipped);
      // a lone CSV may be renamed, so the user picks its branch instead.
      if (!branch && tables.length > 1) {
        ignored.push(t.name);
        continue;
      }
      sections.forEach((p) => readTruckStockSection(t, p, branch, sheet, skipped));
      read.push(t.name);
      continue;
    }
    const hr = listHeaderRow(t.rows);
    // Same for a list tab in a workbook: it needs a branch-code name or a Branch column (NEED RETURN, Sheet17 … have neither).
    if (hr >= 0 && (branch || tables.length === 1 || t.rows[hr].some((h) => headerKind(h) === "branch"))) {
      readList(t, hr, branch, list, skipped);
      read.push(t.name);
    } else ignored.push(t.name);
  }
  return { parts: [...sheet.result(), ...list.result()], skipped, read, ignored };
}

const FIELDS: [keyof StockFields, string][] = [
  ["quantity", "Qty"],
  ["storageLocation", "Stored At"],
  ["description", "Description"],
  ["manufacturer", "Brand"],
  ["notes", "Notes"],
  ["status", "Status"],
];

/**
 * What importing `parts` would do to `existing`. Parts match by branch + part
 * number ignoring case (then ignoring spacing, for a row nothing else
 * matched). The file's Qty always wins; its blank cells keep what the app has
 * (and workbook notes only fill empty Notes). `fallbackBranch` is used for
 * parts the file gives no branch.
 */
export function planTruckStockImport(
  parts: ImportPart[],
  existing: TruckStockRow[],
  opts: { fallbackBranch: string; removeMissing: boolean },
): ImportPlan {
  const exact = new Map(existing.map((r) => [partKey(r.branch, r.partNo), r]));
  const loose = new Map<string, TruckStockRow[]>();
  existing.forEach((r) => {
    const k = looseKey(r.branch, r.partNo);
    loose.set(k, [...(loose.get(k) ?? []), r]);
  });
  const spelling = new Map(existing.map((r) => [r.branch.toLowerCase(), r.branch]));

  // Re-key with the branch the app spells it with; parts that only now share a key are added together.
  const merged = new Map<string, ImportPart>();
  for (const p of parts) {
    const raw = p.branch || opts.fallbackBranch.trim();
    if (!raw) continue;
    const branch = spelling.get(raw.toLowerCase()) ?? raw;
    const k = partKey(branch, p.partNo);
    const m = merged.get(k);
    if (!m) merged.set(k, { ...p, branch });
    else {
      m.quantity += p.quantity;
      m.canAdd ||= p.canAdd;
      m.storageLocation ||= p.storageLocation;
      m.description ||= p.description;
      m.manufacturer ||= p.manufacturer;
      m.notes ||= p.notes;
      m.status ??= p.status;
    }
  }

  // Exact spelling first; a part whose spacing differs only takes a row nothing else matched.
  const matched = new Map<ImportPart, TruckStockRow>();
  const used = new Set<string>();
  for (const [k, p] of merged) {
    const r = exact.get(k);
    if (r) {
      matched.set(p, r);
      used.add(r.id);
    }
  }
  for (const p of merged.values()) {
    if (matched.has(p)) continue;
    const r = loose.get(looseKey(p.branch, p.partNo))?.find((x) => !used.has(x.id));
    if (r) {
      matched.set(p, r);
      used.add(r.id);
    }
  }

  const changes: StockChange[] = [];
  let unchanged = 0;
  for (const p of merged.values()) {
    const before = matched.get(p);
    if (!before) {
      if (!p.canAdd) continue;
      const after: StockFields = {
        branch: p.branch,
        partNo: p.partNo,
        quantity: p.quantity,
        storageLocation: p.storageLocation,
        description: p.description,
        manufacturer: p.manufacturer,
        notes: p.notes,
        status: p.status ?? "in_stock",
      };
      changes.push({ kind: "add", after, changed: [] });
      continue;
    }
    const after: StockFields = {
      branch: before.branch,
      partNo: before.partNo,
      quantity: p.quantity,
      storageLocation: p.storageLocation || before.storageLocation,
      description: p.description || before.description,
      manufacturer: p.manufacturer || before.manufacturer,
      notes: p.source === "list" ? p.notes || before.notes : before.notes || p.notes,
      status: p.status ?? before.status,
    };
    const changed = FIELDS.filter(([f]) => clean(after[f]) !== clean(before[f])).map(([, label]) => label);
    if (changed.length === 0) {
      unchanged++;
      continue;
    }
    changes.push({ kind: "update", before, after, changed });
  }

  const branches = new Set([...merged.values()].map((p) => p.branch.toLowerCase()));
  const missing = existing.filter((r) => branches.has(r.branch.toLowerCase()) && !used.has(r.id));
  if (opts.removeMissing) missing.forEach((r) => changes.push({ kind: "remove", before: r, after: r, changed: [] }));
  return {
    changes,
    unchanged,
    missing: missing.length,
    branches: [...new Set([...merged.values()].map((p) => p.branch))].sort((a, b) => a.localeCompare(b)),
  };
}

export const TRUCK_STOCK_EXPORT_HEADERS = ["Branch", "Part No", "Stored At", "Description", "Brand", "Qty", "Status", "Notes", "Date Added"];

/** Excel download with Part No kept as text, so 140225820228 and 00010664460001 survive a round trip through Excel. */
export async function downloadTruckStockXlsx(filename: string, rows: (string | number)[][]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([TRUCK_STOCK_EXPORT_HEADERS, ...rows]);
  ws["!cols"] = TRUCK_STOCK_EXPORT_HEADERS.map((h, i) => ({
    wch: Math.min(40, rows.slice(0, 500).reduce((w, r) => Math.max(w, String(r[i] ?? "").length), h.length) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Truck Stock");
  XLSX.writeFile(wb, `${filename}_${todayISO()}.xlsx`);
}
