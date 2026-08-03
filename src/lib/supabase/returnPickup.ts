/**
 * Return & Pickup — real parts that already have an RA number assigned
 * (return authorized) and are ready to be physically packaged/scanned out
 * for shipment back to the distributor. Reads parts.ra_no/ra_date/
 * invoice_no/part_no/quantity/status (all real, from 0001_init.sql) joined
 * to tickets for Branch (location) filtering, plus scan_out_qty (migration
 * 0072) tracking how many units have actually been scanned out the door.
 *
 * The original mock's Seq #, Ship To, and Item No columns matched a
 * Samsung-specific return-manifest format with no equivalent anywhere in
 * this app's schema; the user explicitly decided not to build a Samsung
 * feed for them, so they're dropped rather than faked.
 */

import { supabase } from "./client";

const SELECT_FIELDS =
  "id, ra_no, ra_date, part_no, invoice_no, quantity, scan_out_qty, status, tickets!inner(ticket_no, location)";

export interface ReturnPickupRow {
  id: string;
  raNo: string;
  raDate: string;
  partNo: string;
  invoiceNo: string;
  quantity: number;
  scanOutQty: number;
  status: string;
  location: string;
  ticketNo: string;
}

function rowFromDb(row: any): ReturnPickupRow {
  return {
    id: row.id,
    raNo: row.ra_no || "",
    raDate: row.ra_date || "",
    partNo: row.part_no || "",
    invoiceNo: row.invoice_no || "",
    quantity: Number(row.quantity ?? 0),
    scanOutQty: Number(row.scan_out_qty ?? 0),
    status: row.status || "",
    location: row.tickets?.location || "",
    ticketNo: row.tickets?.ticket_no || "",
  };
}

export async function getReturnPickupRows(): Promise<ReturnPickupRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(SELECT_FIELDS)
    .not("ra_no", "is", null)
    .neq("ra_no", "");

  if (error) {
    console.error("getReturnPickupRows error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowFromDb);
}

export async function updateReturnPickupRow(
  id: string,
  updates: { raNo?: string; raDate?: string; scanOutQty?: number }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.raNo !== undefined) payload.ra_no = updates.raNo;
  if (updates.raDate !== undefined) payload.ra_date = updates.raDate || null;
  if (updates.scanOutQty !== undefined) payload.scan_out_qty = updates.scanOutQty;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updateReturnPickupRow error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Look up one real part by its Unique ID (parts.id), for the "Add Part"
 * flow. parts.id is a uuid column - PostgREST's ilike operator can't run
 * against it (no text cast), so this only matches an exact id, same as
 * every other exact-id lookup in this codebase (e.g. getPartById).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findPartByUniqueId(uniqueId: string): Promise<ReturnPickupRow | null> {
  const trimmed = uniqueId.trim();
  if (!trimmed || !UUID_RE.test(trimmed)) return null;
  const { data, error } = await supabase
    .from("parts")
    .select(SELECT_FIELDS)
    .eq("id", trimmed)
    .maybeSingle();

  if (error) {
    console.error("findPartByUniqueId error:", error.message);
    throw new Error(error.message);
  }
  return data ? rowFromDb(data) : null;
}
