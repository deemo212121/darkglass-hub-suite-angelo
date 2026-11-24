/**
 * Truck Stock ↔ eBay (migration 0477): units of a branch's part that are
 * currently Listed on Parts Daily Report eBAY count as "On eBay" — still on
 * the shelf, but not available to pull for a ticket or transfer. Nothing is
 * stored on truck_stock for this; it's worked out from the Listed listings.
 *
 * Matching is the same as the database's (0477 ebay_truck_stock_row): the
 * branch however it's spelled (branchMatchKey = chain_norm_branch) and the
 * part # ignoring case and spaces (ebayPartKey = ebay_part_key).
 */
import { supabase } from "./client";
import { branchMatchKey } from "@/lib/branchName";
import type { TruckStockRow } from "./truckStock";

/** Part # as matched between eBay and Truck Stock: no spaces, capitals. */
export function ebayPartKey(partNo: string | null | undefined): string {
  return String(partNo ?? "").replace(/\s+/g, "").toUpperCase();
}

/** One key per branch + part # — blank when either is missing (never matches). */
export function ebayStockKey(branch: string | null | undefined, partNo: string | null | undefined): string {
  const b = branchMatchKey(branch);
  const p = ebayPartKey(partNo);
  return b && p ? `${b}|${p}` : "";
}

/** Units currently Listed on eBay per branch + part (ebayStockKey → units). */
export async function getOnEbayCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("ebay_listings")
      .select("branch, part_no, quantity")
      .eq("status", "Listed")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const key = ebayStockKey(r.branch, r.part_no);
      if (key) out.set(key, (out.get(key) ?? 0) + Math.max(0, Number(r.quantity) || 0));
    }
    if ((data ?? []).length < 1000) return out;
  }
}

type StockLike = Pick<TruckStockRow, "id" | "branch" | "partNo" | "quantity" | "status">;

/**
 * How many of each row's units are on eBay (row id → units). A branch's
 * part normally has one row; when it has two (spelled two ways), the eBay
 * units go to the IN STOCK row with the most units first — the same row a
 * sale is taken off (0477) — and never more than a row holds.
 */
export function allocateOnEbay(rows: StockLike[], onEbay: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (onEbay.size === 0) return out;
  const byKey = new Map<string, StockLike[]>();
  for (const r of rows) {
    const key = ebayStockKey(r.branch, r.partNo);
    if (!key || !onEbay.has(key)) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  for (const [key, group] of byKey) {
    let left = onEbay.get(key) ?? 0;
    group.sort((a, b) => Number(b.status === "in_stock") - Number(a.status === "in_stock") || b.quantity - a.quantity);
    for (const r of group) {
      if (left <= 0) break;
      const take = Math.min(left, Math.max(0, r.quantity));
      if (take > 0) out.set(r.id, take);
      left -= take;
    }
  }
  return out;
}

/** The rows with Quantity cut to what's available (on eBay taken out); rows left with 0 are dropped. */
export async function availableAfterEbay<T extends StockLike>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const onEbay = await getOnEbayCounts().catch((err) => {
    console.warn("On-eBay counts unavailable:", err);
    return new Map<string, number>();
  });
  const taken = allocateOnEbay(rows, onEbay);
  return rows
    .map((r) => (taken.has(r.id) ? { ...r, quantity: r.quantity - (taken.get(r.id) ?? 0) } : r))
    .filter((r) => r.quantity > 0);
}
