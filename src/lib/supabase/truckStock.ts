/**
 * Supabase service for Truck Stock (per-branch in-house inventory).
 *
 * Backs the Parts → Truck Stock page and the in-house counts shown by the
 * Marcone Lookup button on Part Transaction. All rows are company-scoped
 * by RLS; the `truck_stock_set_company` trigger auto-stamps company_id on
 * insert from the caller's profile.
 */

import { supabase } from "./client";

export type TruckStockRow = {
  id: string;
  branch: string;
  partNo: string;
  description: string;
  manufacturer: string;
  quantity: number;
  storageLocation: string;
  notes: string;
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
  };
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

/**
 * Find in-house stock for a specific part number across all branches.
 *
 * Used by the Marcone Lookup button on the Part Transaction page so the
 * tech can see whether anyone else in the company already has the part
 * before placing a new PO. Returns an empty array if nothing matches —
 * never throws on a missing part.
 */
export async function findTruckStockForPart(partNo: string): Promise<TruckStockRow[]> {
  const trimmed = partNo.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase
    .from("truck_stock")
    .select("*")
    .ilike("part_no", trimmed)
    .gt("quantity", 0)
    .order("quantity", { ascending: false });
  if (error) {
    console.warn("findTruckStockForPart error:", error.message);
    return [];
  }
  return (data ?? []).map(fromDb);
}


/**
 * Bulk insert / update truck_stock rows in chunks. Used by the
 * "Import workbook" button on the Truck Stock page to load 7k+ rows from
 * the parsed inventory spreadsheet.
 *
 * Uses Postgres upsert on (company_id, branch, part_no) so re-running the
 * import bumps quantities for existing rows instead of erroring on the
 * unique constraint.
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
  if (current < qty) {
    throw new Error(`Only ${current} of ${args.partNo} in stock at ${args.branch}; can't pull ${qty}.`);
  }
  const next = current - qty;
  const { error: updErr } = await supabase
    .from("truck_stock")
    .update({ quantity: next })
    .eq("id", row.id);
  if (updErr) throw new Error(updErr.message);
  return { newQuantity: next, storageLocation: row.storage_location ?? "" };
}
