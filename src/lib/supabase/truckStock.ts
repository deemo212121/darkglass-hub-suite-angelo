/**
 * Supabase service for Truck Stock (per-branch in-house inventory).
 *
 * Backs the Parts → Truck Stock page and the in-house counts shown by the
 * Marcone Lookup button on Part Transaction. All rows are company-scoped
 * by RLS; the `truck_stock_set_company` trigger auto-stamps company_id on
 * insert from the caller's profile.
 */

import { supabase } from "./client";
import { availableAfterEbay, ebayStockKey, getOnEbayCounts } from "./truckStockEbay";

/** The workbook's Status list (truckStockOptions.ts, migration 0461) + missing (0478); in_use is from before it — kept, not offered. */
export type TruckStockStatus = "in_stock" | "in_use" | "sold" | "ebay" | "b2b" | "return" | "ticket" | "used" | "missing";

const STATUS_CODES: readonly TruckStockStatus[] = ["in_stock", "in_use", "sold", "ebay", "b2b", "return", "ticket", "used", "missing"];

/** A saved code or the workbook's own wording ("IN STOCK", "In Use", "Ebay", "B2B" …) → its code; anything else is in stock. */
export function toTruckStockStatus(value: unknown): TruckStockStatus {
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (STATUS_CODES as readonly string[]).includes(v) ? (v as TruckStockStatus) : "in_stock";
}

export type TruckStockRow = {
  id: string;
  branch: string;
  partNo: string;
  description: string;
  manufacturer: string;
  quantity: number;
  storageLocation: string;
  notes: string;
  status: TruckStockStatus;
  createdAt?: string;
  updatedAt?: string;
};

function fromDb(r: any): TruckStockRow {
  return {
    id: r.id,
    branch: r.branch ?? "",
    partNo: r.part_no ?? "",
    description: r.description ?? "",
    manufacturer: r.manufacturer ?? "",
    quantity: Number(r.quantity ?? 0),
    storageLocation: r.storage_location ?? "",
    notes: r.notes ?? "",
    status: toTruckStockStatus(r.status),
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
  };
}

function toDb(row: TruckStockRow): Record<string, unknown> {
  return {
    branch: row.branch.trim(),
    part_no: row.partNo.trim(),
    description: row.description?.trim() || null,
    manufacturer: row.manufacturer?.trim() || null,
    quantity: Number.isFinite(row.quantity) ? Math.max(0, Math.trunc(row.quantity)) : 0,
    storage_location: row.storageLocation?.trim() || null,
    notes: row.notes?.trim() || null,
    status: toTruckStockStatus(row.status),
  };
}

/** One line of a stock row's history (migration 0464 — written by the database on every add / change / delete). */
export type TruckStockHistoryEntry = {
  id: string;
  action: "added" | "changed" | "deleted";
  /** status · description · manufacturer · quantity · storage_location · notes · branch · part_no */
  field: string | null;
  before: string | null;
  after: string | null;
  /** Who did it — null when nobody was signed in (shown as "System"). */
  byName: string | null;
  at: string;
};

/** A stock row's history, newest first. Throws "Run migration 0464…" until that's run. */
export async function getTruckStockHistory(truckStockId: string): Promise<TruckStockHistoryEntry[]> {
  const { data, error } = await supabase
    .from("truck_stock_history")
    .select("id, action, field, before_value, after_value, changed_by_name, changed_at")
    .eq("truck_stock_id", truckStockId)
    .order("changed_at", { ascending: false })
    .limit(500);
  if (error) {
    if (/truck_stock_history|schema cache|does not exist/i.test(error.message)) throw new Error("Run migration 0464_truck_stock_history.sql in Supabase to start recording changes.");
    throw new Error(error.message);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    action: r.action,
    field: r.field ?? null,
    before: r.before_value ?? null,
    after: r.after_value ?? null,
    byName: r.changed_by_name ?? null,
    at: r.changed_at,
  }));
}

/** All truck stock rows for the caller's company, ordered by branch then part. */
export async function getTruckStock(): Promise<TruckStockRow[]> {
  // Supabase caps a single SELECT at 1000 rows by default. The inventory
  // workbook seeds ~7k rows, so we page through with explicit range()
  // calls until the server returns less than a full page.
  const pageSize = 1000;
  const all: TruckStockRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("truck_stock")
      .select("*")
      .order("branch", { ascending: true })
      .order("part_no", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("getTruckStock error:", error.message);
      throw new Error(error.message);
    }
    const chunk = (data ?? []).map(fromDb);
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

/** Insert (no uuid id) or update (uuid id) a single row; returns the saved row. */
export async function upsertTruckStockRow(row: TruckStockRow): Promise<TruckStockRow> {
  const payload = toDb(row);
  const isUuid = /^[0-9a-f-]{36}$/i.test(row.id);
  if (isUuid) {
    const { data, error } = await supabase
      .from("truck_stock")
      .update(payload)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromDb(data);
  }

  // No uuid id: try to find an existing (branch, part_no) row and bump it
  // instead of creating a duplicate (the DB also enforces uniqueness, but
  // doing it here lets us return the merged result cleanly).
  const { data: existing } = await supabase
    .from("truck_stock")
    .select("id")
    .ilike("branch", row.branch.trim())
    .ilike("part_no", row.partNo.trim())
    .maybeSingle();
  if (existing?.id) {
    const { data, error } = await supabase
      .from("truck_stock")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromDb(data);
  }

  const { data, error } = await supabase
    .from("truck_stock")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return fromDb(data);
}

export async function deleteTruckStockRow(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const { error } = await supabase.from("truck_stock").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Gives rows a new part number (Import: a look-alike takes the file's tidier spelling). Run before the upsert that then hits them. */
export async function renameTruckStockRows(renames: Array<{ id: string; partNo: string }>): Promise<void> {
  for (let i = 0; i < renames.length; i += 10) {
    const results = await Promise.all(
      renames
        .slice(i, i + 10)
        .filter((r) => /^[0-9a-f-]{36}$/i.test(r.id))
        .map((r) => supabase.from("truck_stock").update({ part_no: r.partNo.trim() }).eq("id", r.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
  }
}

/** Deletes many rows (Clear first: parts at the branch that aren't in the file), 200 ids per request. */
export async function deleteTruckStockRows(ids: string[]): Promise<void> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  for (let i = 0; i < valid.length; i += 200) {
    const { error } = await supabase.from("truck_stock").delete().in("id", valid.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}

/**
 * Find in-house stock for a specific part number across all branches.
 *
 * Used by the Marcone Lookup button on the Part Transaction page so the
 * tech can see whether anyone else in the company already has the part
 * before placing a new PO. Returns an empty array if nothing matches —
 * never throws on a missing part. Quantities are what's available: units
 * Listed on eBay (0477) are left out.
 */
export async function findTruckStockForPart(partNo: string): Promise<TruckStockRow[]> {
  const trimmed = partNo.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase
    .from("truck_stock")
    .select("*")
    .ilike("part_no", trimmed)
    .gt("quantity", 0)
    .eq("status", "in_stock")
    .order("quantity", { ascending: false });
  if (error) {
    console.warn("findTruckStockForPart error:", error.message);
    return [];
  }
  return availableAfterEbay((data ?? []).map(fromDb));
}


/**
 * Bulk insert / update truck_stock rows in chunks. Used by the Import
 * button on the Truck Stock page (src/lib/truckStockFile.ts plans the rows).
 *
 * Uses Postgres upsert on (company_id, branch, part_no) so a row that
 * already exists is overwritten with the given values instead of erroring
 * on the unique constraint.
 */
export async function bulkUpsertTruckStock(
  rows: Array<Omit<TruckStockRow, "id" | "updatedAt">>,
  options: { chunkSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ inserted: number; errors: string[] }> {
  const chunkSize = options.chunkSize ?? 500;
  const total = rows.length;
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      branch: r.branch.trim(),
      part_no: r.partNo.trim(),
      description: r.description?.trim() || null,
      manufacturer: r.manufacturer?.trim() || null,
      quantity: Number.isFinite(r.quantity) ? Math.max(0, Math.trunc(r.quantity)) : 0,
      storage_location: r.storageLocation?.trim() || null,
      notes: r.notes?.trim() || null,
      status: toTruckStockStatus(r.status),
    }));
    const { error, count } = await supabase
      .from("truck_stock")
      .upsert(chunk, { onConflict: "company_id,branch,part_no", count: "exact" });
    if (error) {
      errors.push(`Chunk ${i / chunkSize + 1}: ${error.message}`);
    } else if (typeof count === "number") {
      inserted += count;
    } else {
      inserted += chunk.length;
    }
    options.onProgress?.(Math.min(i + chunkSize, total), total);
  }
  return { inserted, errors };
}


/**
 * A part used on a ticket (truck_stock_used, migration 0422): what the
 * inventory workbook marks Used, kept apart from truck_stock so it never
 * counts as stock. Listed under "Used" on the Truck Stock page.
 */
export type TruckStockUsedRow = {
  id: string;
  branch: string;
  partNo: string;
  /** "" when the sheet gave none. */
  ticketNo: string;
  quantity: number;
  /** yyyy-mm-dd, or "". */
  usedDate: string;
  tech: string;
  storageLocation: string;
  description: string;
  notes: string;
  createdAt?: string;
};

function usedFromDb(r: any): TruckStockUsedRow {
  return {
    id: r.id,
    branch: r.branch ?? "",
    partNo: r.part_no ?? "",
    ticketNo: r.ticket_no ?? "",
    quantity: Number(r.quantity ?? 0),
    usedDate: r.used_date ?? "",
    tech: r.tech ?? "",
    storageLocation: r.storage_location ?? "",
    description: r.description ?? "",
    notes: r.notes ?? "",
    createdAt: r.created_at ?? undefined,
  };
}

/** Every used row for the caller's company, newest use first. Throws when migration 0422 hasn't been run. */
export async function getTruckStockUsed(): Promise<TruckStockUsedRow[]> {
  const pageSize = 1000;
  const all: TruckStockUsedRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("truck_stock_used")
      .select("*")
      .order("used_date", { ascending: false, nullsFirst: false })
      .order("branch", { ascending: true })
      .order("part_no", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []).map(usedFromDb);
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

/** Insert / update used rows (Import), on (company_id, branch, part_no, ticket_no), 500 per request. */
export async function bulkUpsertTruckStockUsed(
  rows: Array<Omit<TruckStockUsedRow, "id" | "createdAt">>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      branch: r.branch.trim(),
      part_no: r.partNo.trim(),
      ticket_no: r.ticketNo.trim(),
      quantity: Number.isFinite(r.quantity) ? Math.max(0, Math.trunc(r.quantity)) : 1,
      used_date: r.usedDate || null,
      tech: r.tech.trim() || null,
      storage_location: r.storageLocation.trim() || null,
      description: r.description.trim() || null,
      notes: r.notes.trim() || null,
    }));
    const { error } = await supabase.from("truck_stock_used").upsert(chunk, { onConflict: "company_id,branch,part_no,ticket_no" });
    if (error) errors.push(`Used chunk ${i / 500 + 1}: ${error.message}`);
    onProgress?.(Math.min(i + 500, rows.length), rows.length);
  }
  return { errors };
}

export async function deleteTruckStockUsedRow(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const { error } = await supabase.from("truck_stock_used").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Missing list (migration 0478) ----------

/** Units that couldn't be found: off the stock row until Found puts them back. */
export type TruckStockMissingRow = {
  id: string;
  truckStockId: string | null;
  branch: string;
  partNo: string;
  quantity: number;
  description: string;
  storageLocation: string;
  notes: string;
  source: "manual" | "import";
  reportedAt: string;
  reportedByName: string;
  /** null while still missing. */
  foundAt: string | null;
  foundByName: string;
};

export type NewTruckStockMissing = Pick<TruckStockMissingRow, "truckStockId" | "branch" | "partNo" | "quantity" | "description" | "storageLocation" | "notes">;

function missingFromDb(r: any): TruckStockMissingRow {
  return {
    id: r.id,
    truckStockId: r.truck_stock_id ?? null,
    branch: r.branch ?? "",
    partNo: r.part_no ?? "",
    quantity: Number(r.quantity ?? 0),
    description: r.description ?? "",
    storageLocation: r.storage_location ?? "",
    notes: r.notes ?? "",
    source: r.source === "import" ? "import" : "manual",
    reportedAt: r.reported_at ?? "",
    reportedByName: r.reported_by_name ?? "",
    foundAt: r.found_at ?? null,
    foundByName: r.found_by_name ?? "",
  };
}

/** True when migration 0478 (the Missing list / MISSING status) hasn't been run yet. */
export function isMissingListMigrationMissing(message: string): boolean {
  return /truck_stock_missing|truck_stock_status_check|schema cache/i.test(message);
}

/** Every Missing entry (open and found), newest first. Throws until migration 0478 is run. */
export async function getTruckStockMissing(): Promise<TruckStockMissingRow[]> {
  const all: TruckStockMissingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("truck_stock_missing")
      .select("*")
      .order("reported_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []).map(missingFromDb));
    if ((data ?? []).length < 1000) return all;
  }
}

function missingToDb(m: NewTruckStockMissing, source: "manual" | "import") {
  return {
    truck_stock_id: m.truckStockId && /^[0-9a-f-]{36}$/i.test(m.truckStockId) ? m.truckStockId : null,
    branch: m.branch.trim(),
    part_no: m.partNo.trim(),
    quantity: Math.max(1, Math.trunc(m.quantity)),
    description: m.description?.trim() || null,
    storage_location: m.storageLocation?.trim() || null,
    notes: m.notes?.trim() || null,
    source,
  };
}

/** Put units on the Missing list (the caller takes them off the stock row). */
export async function addTruckStockMissing(m: NewTruckStockMissing): Promise<TruckStockMissingRow> {
  const { data, error } = await supabase.from("truck_stock_missing").insert(missingToDb(m, "manual")).select("*").single();
  if (error) throw new Error(error.message);
  return missingFromDb(data);
}

/** Found: the units go back on their stock row as IN STOCK (or the row is added again). Returns the row's new Qty. */
export async function markTruckStockMissingFound(id: string): Promise<number> {
  const { data, error } = await supabase.rpc("truck_stock_missing_found", { p_id: id });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function deleteTruckStockMissing(id: string): Promise<void> {
  const { error } = await supabase.from("truck_stock_missing").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Import: the file's MISSING / LOST parts onto the Missing list. A part that
 * already has an open entry from an import gets the file's count (so the
 * same file twice doesn't double it); one reported by hand is left alone.
 */
export async function syncImportedMissing(lines: NewTruckStockMissing[]): Promise<{ added: number; updated: number }> {
  const key = (branch: string, partNo: string) => `${branch.toLowerCase().replace(/[^a-z0-9]/g, "")}\u0000${partNo.trim().toUpperCase()}`;
  const open = new Map<string, TruckStockMissingRow>();
  for (const m of await getTruckStockMissing()) if (!m.foundAt && !open.has(key(m.branch, m.partNo))) open.set(key(m.branch, m.partNo), m);
  const inserts: ReturnType<typeof missingToDb>[] = [];
  let updated = 0;
  for (const line of lines) {
    if (line.quantity < 1 || !line.branch.trim() || !line.partNo.trim()) continue;
    const have = open.get(key(line.branch, line.partNo));
    if (!have) {
      inserts.push(missingToDb(line, "import"));
      continue;
    }
    if (have.source !== "import" || have.quantity === line.quantity) continue;
    const { error } = await supabase.from("truck_stock_missing").update({ quantity: line.quantity }).eq("id", have.id);
    if (error) throw new Error(error.message);
    updated++;
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from("truck_stock_missing").insert(inserts.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return { added: inserts.length, updated };
}

/** Which of `ticketNos` are tickets in the app (so the Used list only links those). */
export async function ticketNosInApp(ticketNos: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(ticketNos.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase.from("tickets").select("ticket_no").in("ticket_no", unique.slice(i, i + 200));
    if (error) throw new Error(error.message);
    (data ?? []).forEach((t: { ticket_no: string }) => found.add(t.ticket_no));
  }
  return found;
}

/**
 * Pull `qty` units of a part from a specific branch's truck stock.
 *
 * Called when the user clicks "Use from <branch>" on a Marcone Lookup
 * result inside Part Transaction — instead of buying from a distributor
 * we're shipping an existing in-house part to the customer. Decrement
 * is atomic on the row (Supabase update with the new value) so concurrent
 * pulls from two open tabs can't oversell stock; we re-read the row first
 * to validate quantity.
 *
 * Returns the new on-hand quantity for that row, or throws if the row
 * doesn't exist or there's not enough stock.
 */
export async function decrementTruckStock(args: {
  branch: string;
  partNo: string;
  qty: number;
}): Promise<{ newQuantity: number; storageLocation: string }> {
  const qty = Math.max(1, Math.trunc(args.qty || 1));
  const { data: row, error: readErr } = await supabase
    .from("truck_stock")
    .select("id, quantity, storage_location")
    .ilike("branch", args.branch.trim())
    .ilike("part_no", args.partNo.trim())
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error(`No truck stock row for ${args.partNo} at ${args.branch}.`);
  const current = Number(row.quantity ?? 0);
  // Units Listed on eBay (0477) stay on the shelf but can't be pulled.
  const onEbay = Math.min(
    current,
    (await getOnEbayCounts().catch(() => new Map<string, number>())).get(ebayStockKey(args.branch, args.partNo)) ?? 0,
  );
  if (current - onEbay < qty) {
    throw new Error(
      onEbay > 0
        ? `Only ${current - onEbay} of ${args.partNo} available at ${args.branch} (${onEbay} listed on eBay); can't pull ${qty}.`
        : `Only ${current} of ${args.partNo} in stock at ${args.branch}; can't pull ${qty}.`,
    );
  }
  const next = current - qty;
  const { error: updErr } = await supabase
    .from("truck_stock")
    .update({ quantity: next })
    .eq("id", row.id);
  if (updErr) throw new Error(updErr.message);
  return { newQuantity: next, storageLocation: row.storage_location ?? "" };
}

/**
 * Restore `qty` units to a branch's truck stock — the symmetric inverse of
 * decrementTruckStock. Used when a Truck Stock pull request is rejected: the
 * quantity was reserved (decremented) at request time, so rejecting it needs
 * to give those units back.
 */
export async function incrementTruckStock(args: {
  branch: string;
  partNo: string;
  qty: number;
}): Promise<{ newQuantity: number }> {
  const qty = Math.max(1, Math.trunc(args.qty || 1));
  const { data: row, error: readErr } = await supabase
    .from("truck_stock")
    .select("id, quantity")
    .ilike("branch", args.branch.trim())
    .ilike("part_no", args.partNo.trim())
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error(`No truck stock row for ${args.partNo} at ${args.branch}.`);
  const next = Number(row.quantity ?? 0) + qty;
  const { error: updErr } = await supabase
    .from("truck_stock")
    .update({ quantity: next })
    .eq("id", row.id);
  if (updErr) throw new Error(updErr.message);
  return { newQuantity: next };
}
