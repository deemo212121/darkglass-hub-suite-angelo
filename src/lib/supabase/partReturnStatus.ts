/**
 * Part Return Status — real parts with an active return authorization,
 * joined to their ticket for location filtering. See migration 0070 for
 * the return_status/returned_by columns this reads and writes — those
 * track the *return shipment's own* lifecycle, separate from the part's
 * ticket-facing status.
 *
 * Matched on `ra_no` being set — NOT on the part's ticket-facing `status`
 * (this table used to filter on 4 literal "RA - *" status strings, but
 * live data confirms parts with a real ra_no set never actually carry one
 * of those statuses; they stay in their normal lifecycle status, e.g.
 * "Claimed"/"PO Made"/"Not Used & Stocked". That filter matched zero real
 * rows in production — this page has been showing nothing since it was
 * built). `raNo` non-empty is the same "has an RA" signal
 * partsInventory.ts's own PartInventoryRow.raNo already documents.
 */

import { supabase } from "./client";

export interface PartReturnRow {
  id: string;
  raNo: string;
  poNo: string;
  partNo: string;
  description: string;
  returnType: "RETURN" | "CORE RETURN";
  /** Free text — no fixed reason list exists in this schema; staff-entered via updatePartReturnRow. Usually blank; nothing derives a value for it. */
  returnReason: string;
  raDate: string;
  returnStatus: string;
  returnedBy: string;
  qty: number;
  unitPrice: number;
  coreValue: number;
  location: string;
  distributor: string;
}

export async function getPartReturns(): Promise<PartReturnRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, ra_no, po_no, part_no, part_desc, quantity, part_price, core_value, status, return_status, return_reason, ra_date, returned_by, part_dist, tickets!inner(location)"
    )
    .not("ra_no", "is", null)
    .neq("ra_no", "");

  if (error) {
    console.error("getPartReturns error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    raNo: row.ra_no || "",
    poNo: row.po_no || "",
    partNo: row.part_no || "",
    description: row.part_desc || "",
    returnType: Number(row.core_value) > 0 ? "CORE RETURN" : "RETURN",
    returnReason: row.return_reason || "",
    raDate: row.ra_date || "",
    returnStatus: row.return_status || "NOT RECEIVED",
    returnedBy: row.returned_by || "",
    qty: Number(row.quantity ?? 0),
    unitPrice: Number(row.part_price ?? 0),
    coreValue: Number(row.core_value ?? 0),
    location: row.tickets?.location || "",
    distributor: row.part_dist || "",
  }));
}

export async function updatePartReturnRow(
  id: string,
  updates: { raNo?: string; raDate?: string; returnStatus?: string; returnedBy?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.raNo !== undefined) payload.ra_no = updates.raNo;
  if (updates.raDate !== undefined) payload.ra_date = updates.raDate || null;
  if (updates.returnStatus !== undefined) payload.return_status = updates.returnStatus;
  if (updates.returnedBy !== undefined) payload.returned_by = updates.returnedBy;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartReturnRow error:", error.message);
    throw new Error(error.message);
  }
}

/** Distinct real distributor (part_dist) values currently in use, for the filter dropdown. */
export async function getDistinctDistributors(): Promise<string[]> {
  const { data, error } = await supabase.from("parts").select("part_dist").not("part_dist", "is", null);
  if (error) {
    console.error("getDistinctDistributors error:", error.message);
    return [];
  }
  const set = new Set((data ?? []).map((r: any) => r.part_dist).filter((v: string) => v && v.trim()));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
