/**
 * Part Daily Pickup — real parts that are sitting in "Tech Pickup" status
 * (ready for a technician to physically pick up), joined to their ticket
 * for location/technician/schedule-date filtering. See migration 0069 for
 * the picked_up/pickup_action columns this reads and writes.
 */

import { supabase } from "./client";

export interface PartPickupRow {
  id: string;
  techName: string;
  ticketNo: string;
  repairStatus: string;
  partNo: string;
  description: string;
  po: string;
  quantity: number;
  coreValue: number;
  partStatus: string;
  pickedUp: boolean;
  action: string;
  comment: string;
  inTransit: boolean;
}

export async function getPartsForDailyPickup(filters: {
  location?: string;
  technician?: string;
  pickupDate: string; // YYYY-MM-DD, matched against the ticket's schedule_date
}): Promise<PartPickupRow[]> {
  let query = supabase
    .from("parts")
    .select(
      "id, part_no, part_desc, po_no, quantity, core_value, status, in_tracking, note, picked_up, pickup_action, tickets!inner(ticket_no, technician, status, location, schedule_date)"
    )
    .eq("status", "Tech Pickup")
    .eq("tickets.schedule_date", filters.pickupDate);

  if (filters.location) query = query.eq("tickets.location", filters.location);
  if (filters.technician) query = query.eq("tickets.technician", filters.technician);

  const { data, error } = await query;
  if (error) {
    console.error("getPartsForDailyPickup error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    techName: row.tickets?.technician || "",
    ticketNo: row.tickets?.ticket_no || "",
    repairStatus: row.tickets?.status || "",
    partNo: row.part_no || "",
    description: row.part_desc || "",
    po: row.po_no || "",
    quantity: Number(row.quantity ?? 0),
    coreValue: Number(row.core_value ?? 0),
    partStatus: row.status || "",
    pickedUp: row.picked_up === true,
    action: row.pickup_action || "",
    comment: row.note || "",
    inTransit: Boolean(row.in_tracking && String(row.in_tracking).trim()),
  }));
}

/** Persist one row's pickup-tracking fields. Never touches `status`. */
export async function updatePartPickupRow(
  id: string,
  updates: { pickedUp?: boolean; action?: string; comment?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.pickedUp !== undefined) payload.picked_up = updates.pickedUp;
  if (updates.action !== undefined) payload.pickup_action = updates.action;
  if (updates.comment !== undefined) payload.note = updates.comment;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartPickupRow error:", error.message);
    throw new Error(error.message);
  }
}
