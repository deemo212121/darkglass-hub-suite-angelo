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
  location: string;
}

// TEMPORARY fallback — the real query below matches parts with status
// "Tech Pickup" AND an exact ticket schedule_date, so it's very easy for
// it to legitimately return nothing (no real part happens to be scheduled
// for the picked date yet). Rather than always showing an empty table,
// PartDailyPickup.tsx falls back to these example rows so there's always
// something to test the Picked Up toggle / "I'm Done" flow against — and
// partsBranchProgress.ts uses the same fallback for its per-branch digest.
// Ids are prefixed "ex-" so Save knows never to persist them.
//
// Lives here (not in the component) so lib code (partsBranchProgress.ts)
// never has to import from src/components/ — that direction creates a
// vendor <-> app-components circular chunk at build time (Rollup can't
// linearize the load order, which previously surfaced as `Uncaught
// ReferenceError: Cannot access 'X' before initialization` at runtime —
// see vite.config.ts's manualChunks comment for the same class of bug).
export const EXAMPLE_PICKUP_ROWS: PartPickupRow[] = [
  { id: "ex-pu-1", techName: "Abel Severino", ticketNo: "26000671722HS", repairStatus: "OP-Waiting for Part", partNo: "11101010016460", description: "Fixed Speed Reciprocating Comp", po: "1007567278-10-AV", quantity: 1, coreValue: 45, partStatus: "Tech Pickup", pickedUp: false, action: "", comment: "", inTransit: false, location: "Atlanta" },
  { id: "ex-pu-2", techName: "Darrin Stewart", ticketNo: "1007567278-10-AV", repairStatus: "CL-Claimed", partNo: "4056017371", description: "Pipe", po: "PO-260702-001", quantity: 2, coreValue: 0, partStatus: "Tech Pickup", pickedUp: true, action: "Picked up at office", comment: "", inTransit: false, location: "Memphis" },
  { id: "ex-pu-3", techName: "John Godfrey", ticketNo: "SA-3349588-AV", repairStatus: "OP-Ready for Service", partNo: "WE22X37340", description: "User Interface Board FL Dryer 87 & 95", po: "12-606043-0526", quantity: 1, coreValue: 0, partStatus: "Tech Pickup", pickedUp: false, action: "", comment: "", inTransit: true, location: "Nashville" },
  { id: "ex-pu-4", techName: "Zonate Grant", ticketNo: "1234567", repairStatus: "TR-Need Triage", partNo: "WE04X24719", description: "Button Start ASM", po: "75112201", quantity: 1, coreValue: 12.5, partStatus: "Tech Pickup", pickedUp: false, action: "", comment: "Waiting on tech", inTransit: false, location: "Birmingham" },
  { id: "ex-pu-5", techName: "Erick Guzman Juarez", ticketNo: "1007685370-10-AV", repairStatus: "OP-Waiting for Part", partNo: "140156010054", description: "Manifold, Water Filter, W/NO Con", po: "1-55553", quantity: 1, coreValue: 0, partStatus: "Tech Pickup", pickedUp: true, action: "Picked up", comment: "", inTransit: false, location: "San Antonio" },
];

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
    location: row.tickets?.location || "",
  }));
}

/** Persist one row's pickup-tracking fields. Never touches `status`. */
export async function updatePartPickupRow(
  id: string,
  updates: { pickedUp?: boolean; action?: string; comment?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.pickedUp !== undefined) {
    payload.picked_up = updates.pickedUp;
    if (updates.pickedUp) payload.picked_up_date = new Date().toISOString().slice(0, 10);
  }
  if (updates.action !== undefined) payload.pickup_action = updates.action;
  if (updates.comment !== undefined) payload.note = updates.comment;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartPickupRow error:", error.message);
    throw new Error(error.message);
  }
}
