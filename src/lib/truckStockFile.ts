/**
 * Import / Export files for Parts → Truck Stock.
 *
 * Import understands two layouts:
 *  - a list with one Part # header row — this page's own export (Branch,
 *    Part No, Stored At, Description, Brand, Qty, Status, Notes; or the Used
 *    list's Ticket #, Date Used, Tech) or any similar sheet;
 *  - the PROJECT A USAPP inventory workbook (.xlsx, one tab per branch code)
 *    or one tab of it saved as CSV ("… - AV.csv"). Stock comes from the Truck
 *    Stock section only, using the same column rules
 *    scripts/parse-truck-stock-xlsx.py used for the original seed; rows whose
 *    Status says the part has left the shelf (Used, Sold, Returned, Shipped …)
 *    aren't counted. Used rows — there and in the LIVE section (parts ordered
 *    for a ticket) — become used parts with their ticket number
 *    (truck_stock_used). LIVE's other rows and the RETURN section are ignored.
 *
 * Reading and planning are plain functions: TruckStockPage shows the plan as
 * a preview and only saves it (bulkUpsertTruckStock / bulkUpsertTruckStockUsed)
 * when the user confirms.
 */
import { parseCsv } from "@/lib/csvParse";
import { todayISO } from "@/lib/localDate";
import { TRUCK_STOCK_BRANCH_CODE_MAP, resolveTruckStockBranch } from "@/lib/truckStockBranchMap";
import type { TruckStockRow, TruckStockStatus, TruckStockUsedRow } from "@/lib/supabase/truckStock";

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

export type UsedFields = Omit<TruckStockUsedRow, "id" | "createdAt">;

/** A part the file marks Used, its rows for the same branch + ticket added together. */
export type UsedLine = UsedFields & { from: "truck stock" | "live" | "list" };

export type ParsedImport = {
  parts: ImportPart[];
  used: UsedLine[];
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

/**
 * How parts Truck Stock already has are treated: "update" gives them the
 * file's values, "addOnly" leaves them alone, "clear" makes the file's
 * branches hold exactly what the file lists (everything else there is removed).
 */
export type ImportMode = "update" | "addOnly" | "clear";

/** A part the import would add that looks like one already there. */
export type PossibleDuplicate = {
  /** Stable id for the checklist tick box. */
  key: string;
  /** "ours": looks like a part Truck Stock has; "file": the file lists it twice, spelled differently. */
  kind: "ours" | "file";
  branch: string;
  part: { partNo: string; quantity: number; storageLocation: string };
  like: { partNo: string; quantity: number; storageLocation: string };
};

export type ImportPlan = {
  /** Adds and updates carry the full row to save, spelled the way the app's row is (so the upsert hits it). */
  changes: StockChange[];
  unchanged: number;
  /** Parts the file lists that Truck Stock has, left as they are ("addOnly"). */
  kept: number;
  /** Parts the app has at the file's branches that the file doesn't list. */
  missing: number;
  /** Parts the app has at the file's branches, all told. */
  atBranches: number;
  branches: string[];
  /** Ticked (not in `separate`) = same part: it updates / joins the one it looks like instead of being added. */
  duplicates: PossibleDuplicate[];
};

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const upper = (v: unknown) => clean(v).toUpperCase();
/** Branch + part number, ignoring case. */
const partKey = (branch: string, partNo: string) => `${branch.trim().toLowerCase()}\u0000${partNo.trim().toLowerCase()}`;
/** Same, also ignoring runs of spaces: a workbook tab's "WE1M300 BEARING" is the app's "WE1M300  BEARING" (tab cells are tidied). */
const looseKey = (branch: string, partNo: string) => partKey(clean(branch), clean(partNo));

/** A part number without spaces, punctuation or leading zeros. */
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");

/**
 * Keys under which two part numbers are probably the same part: the whole
 * number, and the first word with a digit in it, both squashed.
 * "DA81-06403A (4)" ~ "da8106403a", "WR55X31994-REED SWITCH *" ~
 * "WR55X31994 REED SWITCH", "00010664460001" ~ "10664460001" (Excel drops the
 * zeros). Short ones ("BOX 5") aren't compared.
 */
function lookAlikeKeys(branch: string, partNo: string): string[] {
  const first = partNo.split(/[\s(,]+/).find((t) => /\d/.test(t));
  const b = clean(branch).toLowerCase();
  return [...new Set([squash(partNo), first ? squash(first) : ""])].filter((k) => k.length >= 5).map((k) => `${b}\u0000${k}`);
}

const PART_HEADERS = new Set(["PART", "PART #", "PART NO", "PART NUMBER", "PARTNUMBER", "PARTNO", "PART#"]);
const isPartHeader = (v: unknown) => PART_HEADERS.has(upper(v).replace(/[._]/g, "").replace(/-/g, " "));

/** Row-2 label over a Truck Stock section: TS, Truck Stock, TRUCK STOP, Truck-Stock, "TS UPDATED 6/8/2026". */
function isTruckStockLabel(v: unknown): boolean {
  const s = upper(v);
  return s === "TS" || s.startsWith("TS ") || s.includes("TRUCK STOCK") || s.includes("TRUCK STOP") || s.includes("TRUCK-STOCK");
}

/** Row-2 label over a LIVE section: parts ordered for a ticket (TICKET #, DATE PICKED, TECH). */
const isLiveLabel = (v: unknown) => /^LIVE\b/.test(upper(v));

/** Row-2 label that starts another section, so a Truck Stock section ends before it. */
const isSectionLabel = (v: unknown) => isTruckStockLabel(v) || /^(RETURN|RESTOCK|LIVE)/.test(upper(v));

type Kind = "location" | "status" | "quantity" | "description" | "branch" | "brand" | "notes" | "ticket" | "date" | "tech" | "tracking";
const HEADER_KINDS: Record<string, Kind> = {
  LOCATION: "location", BIN: "location", SHELF: "location", "STORED AT": "location", "STORAGE LOCATION": "location",
  STATUS: "status", "STATUS 1": "status", CONDITION: "status", STATE: "status", STOCK: "status", "IN STOCK": "status",
  QUANTITY: "quantity", QTY: "quantity",
  DESCRIPTION: "description", DESC: "description", "PART NAME": "description",
  BRANCH: "branch",
  BRAND: "brand", MANUFACTURER: "brand", MFR: "brand",
  NOTE: "notes", NOTES: "notes",
  TICKET: "ticket", "TICKET #": "ticket", "TICKET#": "ticket", "TICKET NO": "ticket", "TICKET NUMBER": "ticket",
  DATE: "date", "DATE PICKED": "date", "DATE USED": "date",
  TECH: "tech", TECHNICIAN: "tech",
  TRACKING: "tracking", "TRACKING #": "tracking",
};
const headerKind = (v: unknown): Kind | undefined => HEADER_KINDS[upper(v).replace(/[._]/g, "")];

/** Status words meaning the part has left the shelf (used on a job, sold, sent back, shipped …). */
const GONE = /^(used|sold|return|rma|core return|not needed|ship|sent|lost|defective|picked|in house ticket|branch to branch|b2b|transfer)/i;
/** The ones meaning it went on a ticket: these are kept as used parts with the ticket number. */
const USED = /^(used|in house ticket)/i;
const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * A ticket number in a note: "TICKET#: 25000901872DF", "Added to Ticket#
 * 26000510701DF", or a cell that is just one ("SA-3723963", "1007810474-10",
 * "26000774644DF"); "" otherwise (dates like "4/29", "HOLD FOR SV", UPS 1Z…).
 */
function ticketIn(text: string): string {
  const s = clean(text);
  const m = s.match(/ticket\s*(?:#|no\.?|number)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,})/i);
  if (m) return m[1];
  return /^[A-Z0-9][A-Z0-9-]*$/i.test(s) && (s.match(/\d/g)?.length ?? 0) >= 6 && !/^1Z/i.test(s) ? s : "";
}

/** "4/7/2026", "4/7/26", "2026-04-07" or an Excel day number (46119) → "2026-04-07"; "" when it isn't a date. */
function isoDate(text: string): string {
  const s = clean(text);
  const ymd = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y < 2100 ? dt.toISOString().slice(0, 10) : "";
  };
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10).replace(/^(?!20\d\d).*$/, "");
  return "";
}

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

/**
 * Adds used rows for the same branch + part + ticket together — within a
 * section. The Truck Stock and LIVE sections often both record the same use
 * (the shelf row marked Used with the ticket #, and the ticket's LIVE row), so
 * across sections the larger count wins instead of adding up.
 */
class UsedCollector {
  private lines = new Map<string, { line: UsedLine; notes: Set<string>; bySection: Map<UsedLine["from"], number> }>();

  add(line: UsedLine) {
    const key = `${partKey(line.branch, clean(line.partNo))}\u0000${clean(line.ticketNo).toLowerCase()}`;
    const entry = this.lines.get(key) ?? { line: { ...line, quantity: 0 }, notes: new Set<string>(), bySection: new Map() };
    this.lines.set(key, entry);
    entry.bySection.set(line.from, (entry.bySection.get(line.from) ?? 0) + line.quantity);
    const l = entry.line;
    l.usedDate ||= line.usedDate;
    l.tech ||= line.tech;
    l.storageLocation ||= line.storageLocation;
    l.description ||= line.description;
    if (line.notes) entry.notes.add(line.notes);
  }

  result(): UsedLine[] {
    return [...this.lines.values()].map(({ line, notes, bySection }) => ({
      ...line,
      quantity: Math.max(...bySection.values()),
      notes: [...notes].join(" · ").slice(0, 500),
    }));
  }
}

/** Part # columns of the workbook's sections under a row-2 label (row 1 holds the column names). */
function sectionPartColumns(rows: string[][], isLabel: (v: unknown) => boolean = isTruckStockLabel): number[] {
  const h1 = rows[0] ?? [];
  const h2 = rows[1] ?? [];
  const cols = new Set<number>();
  h2.forEach((label, c) => {
    if (!isLabel(label)) return;
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

/** Of the columns beside PART #, the first headed Ticket # / Date / Tech / Tracking #. */
type SideColumns = Partial<Record<"ticket" | "date" | "tech" | "tracking", number>>;
function sideColumns(h1: string[], cols: number[]): SideColumns {
  const side: SideColumns = {};
  for (const c of cols) {
    const k = headerKind(h1[c]);
    if ((k === "ticket" || k === "date" || k === "tech" || k === "tracking") && side[k] === undefined) side[k] = c;
  }
  return side;
}

/**
 * A Used row as a used part: the ticket number from a Ticket # column, else
 * the first note that is one; the rest of the notes (not the description,
 * date, tech or tracking columns) stay as notes.
 */
function usedLineFrom(
  cell: (c: number | null | undefined) => string,
  base: { branch: string; partNo: string; quantity: number; storageLocation: string; description: string },
  side: SideColumns,
  noteCols: number[],
  status: string,
  from: UsedLine["from"],
): UsedLine {
  let ticketNo = side.ticket !== undefined ? cell(side.ticket) : "";
  const dateText = cell(side.date);
  let usedDate = isoDate(dateText);
  const notes: string[] = [];
  for (const c of noteCols) {
    if (c === side.ticket || c === side.date || c === side.tech || c === side.tracking) continue;
    const v = cell(c);
    if (!v || v.toLowerCase() === status.toLowerCase() || /^ticket$/i.test(v)) continue;
    // An unlabeled DATE PICKED column comes out of Excel as a day number (46065).
    if (!usedDate && /^\d{5}$/.test(v) && isoDate(v)) {
      usedDate = isoDate(v);
      continue;
    }
    const t = ticketNo ? "" : ticketIn(v);
    if (t) {
      ticketNo = t;
      if (clean(v) === t) continue;
    }
    notes.push(v);
  }
  if (dateText && !isoDate(dateText)) notes.push(dateText);
  if (!/^used$/i.test(status)) notes.unshift(status); // "In House Ticket Use"
  return { ...base, ticketNo, usedDate, tech: cell(side.tech), notes: notes.join(" · ").slice(0, 500), from };
}

function readTruckStockSection(t: ImportTable, p: number, branch: string, out: PartCollector, used: UsedCollector, skipped: Record<string, number>) {
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
  const side = sideColumns(h1, extra);
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

    if (GONE.test(status)) {
      const label = statusLabel(status);
      skipped[label] = (skipped[label] ?? 0) + 1;
      out.add({ branch, partNo, quantity: 0, storageLocation: location, description: cell(descCol), manufacturer: "", notes: [], status: null, counted: false });
      if (USED.test(status)) {
        const base = { branch, partNo, quantity: qty ?? 1, storageLocation: location, description: cell(descCol) };
        used.add(usedLineFrom(cell, base, side, extra.filter((c) => c !== descCol), status, "truck stock"));
      }
      continue;
    }
    out.add({ branch, partNo, quantity: qty ?? 1, storageLocation: location, description: cell(descCol), manufacturer: "", notes, status: null, counted: true });
  }
}

/**
 * A LIVE section: parts ordered for a customer ticket (PART #, Location,
 * Status, TICKET #, DATE PICKED, TECH, NOTES). Only its Used rows are read,
 * as used parts; the rest are waiting for their ticket, not spare stock.
 */
function readLiveSection(t: ImportTable, p: number, branch: string, used: UsedCollector) {
  const h1 = t.rows[0] ?? [];
  const h2 = t.rows[1] ?? [];
  const width = t.rows.reduce((w, r) => Math.max(w, r.length), 0);
  const cols: number[] = [];
  for (let c = p + 1; c < Math.min(p + 10, width); c++) {
    if (isPartHeader(h1[c]) || isSectionLabel(h2[c])) break;
    cols.push(c);
  }
  const kindCol = (k: Kind) => cols.find((c) => headerKind(h1[c]) === k);
  const locationCol = kindCol("location");
  const statusCol = kindCol("status");
  const quantityCol = kindCol("quantity");
  const side = sideColumns(h1, cols);
  const dataRows = t.rows.slice(2);
  const rest = cols.filter((c) => c !== locationCol && c !== statusCol && c !== quantityCol);
  const descCol = descriptionColumn(h1, rest, dataRows.filter((r) => clean(r[p])));
  for (const row of dataRows) {
    const cell = (c: number | null | undefined) => (c == null ? "" : clean(row[c]));
    const partNo = cell(p);
    const status = cell(statusCol);
    if (!partNo || !/\d/.test(partNo) || !USED.test(status)) continue;
    const q = cell(quantityCol);
    const quantity = /^\d{1,3}$/.test(q) ? Number(q) || 1 : (splitCount(q).n ?? 1);
    const base = { branch, partNo, quantity, storageLocation: cell(locationCol), description: cell(descCol) };
    used.add(usedLineFrom(cell, base, side, rest.filter((c) => c !== descCol), status, "live"));
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

function readList(t: ImportTable, hr: number, branch: string, out: PartCollector, used: UsedCollector, skipped: Record<string, number>) {
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
    const q = cell(col.quantity).replace(/,/g, "");
    const qty = q === "" ? 1 : /^\d+(\.\d+)?$/.test(q) ? Math.trunc(Number(q)) : (splitCount(q).n ?? 1);
    if (USED.test(status)) {
      const notes = cell(col.notes);
      const ticketNo = col.ticket !== undefined ? cell(col.ticket) : ticketIn(notes);
      const dateText = cell(col.date);
      used.add({
        branch: rowBranch,
        partNo,
        ticketNo,
        quantity: qty,
        usedDate: isoDate(dateText),
        tech: cell(col.tech),
        storageLocation: base.storageLocation,
        description: base.description,
        notes: [notes, dateText && !isoDate(dateText) ? dateText : ""].filter(Boolean).join(" · "),
        from: "list",
      });
      // A list with a Ticket # column is a Used list (this page's export): history only, not shelf rows.
      if (col.ticket !== undefined) continue;
    }
    if (GONE.test(status)) {
      const label = statusLabel(status);
      skipped[label] = (skipped[label] ?? 0) + 1;
      out.add({ ...base, quantity: 0, notes: [], status: null, counted: false });
      continue;
    }
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
  const used = new UsedCollector();
  const skipped: Record<string, number> = {};
  const read: string[] = [];
  const ignored: string[] = [];
  for (const t of tables) {
    const branch = branchForTab(t.name);
    const sections = sectionPartColumns(t.rows);
    const live = sectionPartColumns(t.rows, isLiveLabel);
    if (sections.length > 0 || live.length > 0) {
      // In a whole workbook only branch-code tabs count (FORM, "Copy of RL" … are skipped);
      // a lone CSV may be renamed, so the user picks its branch instead.
      if (!branch && tables.length > 1) {
        ignored.push(t.name);
        continue;
      }
      sections.forEach((p) => readTruckStockSection(t, p, branch, sheet, used, skipped));
      live.forEach((p) => readLiveSection(t, p, branch, used));
      read.push(t.name);
      continue;
    }
    const hr = listHeaderRow(t.rows);
    // Same for a list tab in a workbook: it needs a branch-code name or a Branch column (NEED RETURN, Sheet17 … have neither).
    if (hr >= 0 && (branch || tables.length === 1 || t.rows[hr].some((h) => headerKind(h) === "branch"))) {
      readList(t, hr, branch, list, used, skipped);
      read.push(t.name);
    } else ignored.push(t.name);
  }
  return { parts: [...sheet.result(), ...list.result()], used: used.result(), skipped, read, ignored };
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
 * matched). A part that would be added but looks like one already there
 * (lookAlikeKeys) is a possible duplicate: unless its key is in `separate` it
 * takes that row instead (or joins the file's other spelling of it).
 *
 * "update": the file's Qty always wins; its blank cells keep what the app has
 * (and workbook notes only fill empty Notes). "addOnly": parts the app has
 * are left alone. "clear": the file's branches end up holding exactly the
 * file — matched rows take every value from it and the rest are removed
 * (saved in place rather than deleted and re-added, so a failed save never
 * leaves a branch empty). `fallbackBranch` is used for parts the file gives
 * no branch.
 */
export function planTruckStockImport(
  parts: ImportPart[],
  existing: TruckStockRow[],
  opts: { fallbackBranch: string; mode: ImportMode; separate?: Set<string> },
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

  // Possible duplicates among the parts that would be added. A look-alike the
  // app has comes first (not when clearing: that row goes anyway), then
  // another spelling in the file — preferring one that matched a row.
  const duplicates: PossibleDuplicate[] = [];
  const absorbed = new Set<ImportPart>();
  const ours = new Map<string, TruckStockRow[]>();
  if (opts.mode !== "clear") {
    existing.forEach((r) => lookAlikeKeys(r.branch, r.partNo).forEach((k) => ours.set(k, [...(ours.get(k) ?? []), r])));
  }
  const inFile = new Map<string, ImportPart>();
  const register = (p: ImportPart) => lookAlikeKeys(p.branch, p.partNo).forEach((k) => inFile.has(k) || inFile.set(k, p));
  const brief = (x: { partNo: string; quantity: number; storageLocation: string }) => ({ partNo: x.partNo, quantity: x.quantity, storageLocation: x.storageLocation });
  [...merged.values()].filter((p) => matched.has(p)).forEach(register);
  for (const [k, p] of merged) {
    if (matched.has(p) || !p.canAdd) continue;
    const keys = lookAlikeKeys(p.branch, p.partNo);
    // "DA81-06403A" before "DA81-06403A (4)" when both look like the file's "da81 06403a".
    const r = keys
      .flatMap((x) => ours.get(x) ?? [])
      .filter((x) => !used.has(x.id))
      .sort((a, b) => Number(squash(a.partNo) !== squash(p.partNo)) - Number(squash(b.partNo) !== squash(p.partNo)))[0];
    if (r) {
      const key = `ours:${k}`;
      duplicates.push({ key, kind: "ours", branch: p.branch, part: brief(p), like: brief(r) });
      if (!opts.separate?.has(key)) {
        matched.set(p, r);
        used.add(r.id);
      }
      register(p);
      continue;
    }
    const q = keys.map((x) => inFile.get(x)).find(Boolean);
    if (q) {
      const key = `file:${k}`;
      duplicates.push({ key, kind: "file", branch: p.branch, part: brief(p), like: brief(q) });
      if (!opts.separate?.has(key)) {
        absorbed.add(p);
        q.quantity += p.quantity;
        q.storageLocation ||= p.storageLocation;
        q.description ||= p.description;
        q.manufacturer ||= p.manufacturer;
        q.notes ||= p.notes;
        q.status ??= p.status;
        continue;
      }
    }
    register(p);
  }

  const changes: StockChange[] = [];
  let unchanged = 0;
  let kept = 0;
  for (const p of merged.values()) {
    if (absorbed.has(p)) continue;
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
    if (opts.mode === "addOnly") {
      kept++;
      continue;
    }
    if (opts.mode === "clear" && !p.canAdd) {
      // Only listed as Used / Sold …: an emptied branch wouldn't get it back.
      changes.push({ kind: "remove", before, after: before, changed: [] });
      continue;
    }
    const after: StockFields =
      opts.mode === "clear"
        ? {
            branch: before.branch,
            partNo: before.partNo,
            quantity: p.quantity,
            storageLocation: p.storageLocation,
            description: p.description,
            manufacturer: p.manufacturer,
            notes: p.notes,
            status: p.status ?? "in_stock",
          }
        : {
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
  const atBranches = existing.filter((r) => branches.has(r.branch.toLowerCase()));
  const missing = atBranches.filter((r) => !used.has(r.id));
  if (opts.mode === "clear") missing.forEach((r) => changes.push({ kind: "remove", before: r, after: r, changed: [] }));
  return {
    changes,
    unchanged,
    kept,
    missing: missing.length,
    atBranches: atBranches.length,
    branches: [...new Set([...merged.values()].map((p) => p.branch))].sort((a, b) => a.localeCompare(b)),
    duplicates,
  };
}

export type UsedChange = { kind: "add" | "update"; before?: TruckStockUsedRow; after: UsedFields; changed: string[] };
export type UsedPlan = { changes: UsedChange[]; unchanged: number; kept: number };

const USED_FIELDS: [keyof UsedFields, string][] = [
  ["quantity", "Qty"],
  ["usedDate", "Date"],
  ["tech", "Tech"],
  ["storageLocation", "Stored At"],
  ["description", "Description"],
  ["notes", "Notes"],
];

/**
 * What importing the file's used parts would do to the Used list. They match
 * by branch + part number + ticket number (ignoring case and spacing). New
 * ones are added in every mode; ones already there take the file's Qty and
 * fill in from it ("update" and "clear" — clearing never removes used parts,
 * they're a record of what happened) or are left alone ("addOnly").
 */
export function planUsedImport(
  lines: UsedLine[],
  existing: TruckStockUsedRow[],
  opts: { fallbackBranch: string; mode: ImportMode; branches: string[] },
): UsedPlan {
  const key = (b: string, p: string, t: string) => `${clean(b).toLowerCase()}\u0000${clean(p).toLowerCase()}\u0000${clean(t).toLowerCase()}`;
  const byKey = new Map(existing.map((r) => [key(r.branch, r.partNo, r.ticketNo), r]));
  const spelling = new Map([...opts.branches, ...existing.map((r) => r.branch)].map((b) => [b.toLowerCase(), b]));
  const merged = new Map<string, UsedLine>();
  for (const l of lines) {
    const raw = l.branch || opts.fallbackBranch.trim();
    if (!raw) continue;
    const branch = spelling.get(raw.toLowerCase()) ?? raw;
    const k = key(branch, l.partNo, l.ticketNo);
    const m = merged.get(k);
    if (!m) merged.set(k, { ...l, branch });
    else {
      m.quantity += l.quantity;
      m.usedDate ||= l.usedDate;
      m.tech ||= l.tech;
      m.storageLocation ||= l.storageLocation;
      m.description ||= l.description;
      m.notes ||= l.notes;
    }
  }
  const changes: UsedChange[] = [];
  let unchanged = 0;
  let kept = 0;
  for (const [k, l] of merged) {
    const before = byKey.get(k);
    const { from: _from, ...fields } = l;
    if (!before) {
      changes.push({ kind: "add", after: fields, changed: [] });
      continue;
    }
    if (opts.mode === "addOnly") {
      kept++;
      continue;
    }
    const after: UsedFields = {
      branch: before.branch,
      partNo: before.partNo,
      ticketNo: before.ticketNo,
      quantity: l.quantity,
      usedDate: l.usedDate || before.usedDate,
      tech: l.tech || before.tech,
      storageLocation: l.storageLocation || before.storageLocation,
      description: l.description || before.description,
      notes: l.notes || before.notes,
    };
    const changed = USED_FIELDS.filter(([f]) => clean(after[f]) !== clean(before[f])).map(([, label]) => label);
    if (changed.length === 0) unchanged++;
    else changes.push({ kind: "update", before, after, changed });
  }
  return { changes, unchanged, kept };
}

export const TRUCK_STOCK_EXPORT_HEADERS = ["Branch", "Part No", "Stored At", "Description", "Brand", "Qty", "Status", "Notes", "Date Added"];
/** The Used list's export; Import reads it back as used parts (Status "Used" + a Ticket # column). */
export const TRUCK_STOCK_USED_EXPORT_HEADERS = ["Branch", "Part No", "Ticket #", "Qty", "Date Used", "Tech", "Stored At", "Description", "Notes", "Status"];

/** "2026-04-07" → "4/7/2026". */
export const usedDateText = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}` : iso);

/** Excel download with Part No kept as text, so 140225820228 and 00010664460001 survive a round trip through Excel. */
export async function downloadTruckStockXlsx(filename: string, rows: (string | number)[][], headers = TRUCK_STOCK_EXPORT_HEADERS, sheetName = "Truck Stock") {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = headers.map((h, i) => ({
    wch: Math.min(40, rows.slice(0, 500).reduce((w, r) => Math.max(w, String(r[i] ?? "").length), h.length) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}_${todayISO()}.xlsx`);
}
