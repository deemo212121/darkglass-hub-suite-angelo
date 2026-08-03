/**
 * Part Return Status — real parts flagged for return (one of the 4 real
 * "RA - *" statuses already used on the ticket detail page's Parts tab),
 * joined to their ticket for location filtering. See migration 0070 for
 * the return_status/returned_by columns this reads and writes — those
 * track the *return shipment's own* lifecycle, separate from the part's
 * ticket-facing status.
 */

import { supabase } from "./client";

export interface PartReturnRow {
  id: string;
  raNo: string;
  poNo: string;
  partNo: string;
  description: string;
  returnType: "RETURN" | "CORE RETURN";
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

const RA_STATUSES = ["RA - Defect", "RA- DMG", "RA - PNN", "RA - Qty Discrepancy"];

// The real ticket-facing status already encodes *why* the part is being
// returned — no separate free-text reason field exists (or is needed).
const RETURN_REASON_BY_STATUS: Record<string, string> = {
  "RA - Defect": "Defect",
  "RA- DMG": "DMG",
  "RA - PNN": "PNN",
  "RA - Qty Discrepancy": "Qty Discrepancy",
};

export async function getPartReturns(): Promise<PartReturnRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, ra_no, po_no, part_no, part_desc, quantity, part_price, core_value, status, return_status, ra_date, returned_by, part_dist, tickets!inner(location)"
    )
    .in("status", RA_STATUSES);

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
    returnReason: RETURN_REASON_BY_STATUS[row.status] || row.status || "",
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
