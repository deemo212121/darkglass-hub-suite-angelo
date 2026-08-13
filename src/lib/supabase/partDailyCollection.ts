/**
 * Part Daily Collection — real parts that have already been picked up
 * (picked_up = true) and are now waiting for the Parts Manager to collect
 * them back from the technician (Used/Restock/Defective/etc.), joined to
 * their ticket for location/technician/date filtering. See migration 0166
 * for the collected/used_qty/restock_qty/collect_type/collect_note/lot_no
 * columns this reads and writes.
 */

import { supabase } from "./client";

export interface PartCollectionRow {
  id: string;
  techName: string;
  ticketNo: string;
  repairStatus: string;
  partNo: string;
  description: string;
  uniqueId: string;
  coreValue: number;
  quantity: number;
  usedQty: number;
  restockQty: number;
  collectType: string;
  lotNo: string;
  comment: string;
  partStatus: string;
  pickedUp: boolean;
  pickedUpDate: string;
  collected: boolean;
  collectedDate: string;
  scheduleDate: string;
}

// Suggests a Collect Type from the part's own status, per the rules the
// Parts team already uses (Claimed/Used-family statuses collect as "Used";
// everything that goes back on the shelf collects as "Restock"). Only a
// suggestion for the scan-to-collect flow — always freely editable after.
const USED_STATUSES = new Set(["Used", "Claimed"]);
export function suggestCollectType(partStatus: string): string {
  return USED_STATUSES.has(partStatus) ? "Used" : "Restock";
}

export async function getPartsForDailyCollection(filters: {
  location?: string;
  technician?: string;
  dateType: "Pickup Date" | "Collect Date";
  startDate: string;
  endDate: string;
  ticketNo?: string;
  notCollected: boolean;
  collected: boolean;
  collectType?: string;
}): Promise<PartCollectionRow[]> {
  let query = supabase
    .from("parts")
    .select(
      "id, part_no, part_desc, quantity, core_value, status, note, picked_up, picked_up_date, collected, collected_date, used_qty, restock_qty, collect_type, collect_note, lot_no, tickets!inner(ticket_no, technician, status, location, schedule_date)"
    )
    .eq("picked_up", true);

  if (filters.location) query = query.eq("tickets.location", filters.location);
  if (filters.technician) query = query.eq("tickets.technician", filters.technician);
  if (filters.collectType) query = query.eq("collect_type", filters.collectType);

  const { data, error } = await query;
  if (error) {
    console.error("getPartsForDailyCollection error:", error.message);
    throw new Error(error.message);
  }

  const rows: PartCollectionRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    techName: row.tickets?.technician || "",
    ticketNo: row.tickets?.ticket_no || "",
    repairStatus: row.tickets?.status || "",
    partNo: row.part_no || "",
    description: row.part_desc || "",
    uniqueId: String(row.id).slice(0, 8),
    coreValue: Number(row.core_value ?? 0),
    quantity: Number(row.quantity ?? 0),
    usedQty: Number(row.used_qty ?? 0),
    restockQty: Number(row.restock_qty ?? 0),
    collectType: row.collect_type || "",
    lotNo: row.lot_no || "",
    comment: row.collect_note || "",
    partStatus: row.status || "",
    pickedUp: row.picked_up === true,
    pickedUpDate: row.picked_up_date || "",
    collected: row.collected === true,
    collectedDate: row.collected_date || "",
    scheduleDate: row.tickets?.schedule_date || "",
  }));

  return rows.filter((r) => {
    const dateVal = filters.dateType === "Collect Date" ? r.collectedDate : r.scheduleDate;
    if (filters.startDate && (!dateVal || dateVal < filters.startDate)) return false;
    if (filters.endDate && (!dateVal || dateVal > filters.endDate)) return false;
    if (r.collected && !filters.collected) return false;
    if (!r.collected && !filters.notCollected) return false;
    if (filters.ticketNo && !r.ticketNo.toLowerCase().includes(filters.ticketNo.toLowerCase())) return false;
    return true;
  });
}

/** Persist one row's collection-tracking fields. Never touches `status`. */
export async function updatePartCollectionRow(
  id: string,
  updates: { collected?: boolean; collectedDate?: string; usedQty?: number; restockQty?: number; collectType?: string; lotNo?: string; comment?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.collected !== undefined) payload.collected = updates.collected;
  if (updates.collectedDate !== undefined) payload.collected_date = updates.collectedDate || null;
  if (updates.usedQty !== undefined) payload.used_qty = updates.usedQty;
  if (updates.restockQty !== undefined) payload.restock_qty = updates.restockQty;
  if (updates.collectType !== undefined) payload.collect_type = updates.collectType;
  if (updates.lotNo !== undefined) payload.lot_no = updates.lotNo;
  if (updates.comment !== undefined) payload.collect_note = updates.comment;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartCollectionRow error:", error.message);
    throw new Error(error.message);
  }
}
