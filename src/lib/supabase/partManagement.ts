/**
 * Parts PO & Management — every real part row across the company, joined to
 * its ticket for location/repair-status/receive-date filtering. This is the
 * general parts-management view: "Need PO" rows can be selected here and
 * submitted for PO (status -> "PO Made", po_date stamped today).
 *
 * updateTicketPart() (tickets.ts) always overwrites every column from its
 * input, so a narrow update through it would null out fields this page
 * never touches — updatePartManagementStatus() below writes only the
 * columns this page actually changes. deleteTicketPart() is a plain
 * single-purpose DELETE, so it's reused as-is.
 */

import { supabase } from "./client";
import { deleteTicketPart } from "./tickets";

export interface PartManagementRow {
  id: string;
  ticketNo: string;
  repairStatus: string;
  location: string;
  receiveDate: string;
  partDist: string;
  partNo: string;
  description: string;
  poNo: string;
  partStatus: string;
  note: string;
  unit: number;
  qty: number;
}

export async function getPartManagementRows(): Promise<PartManagementRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, part_no, part_desc, part_dist, part_price, quantity, status, po_no, note, tickets!inner(ticket_no, status, location, call_received_date)"
    );

  if (error) {
    console.error("getPartManagementRows error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    ticketNo: row.tickets?.ticket_no || "",
    repairStatus: row.tickets?.status || "",
    location: row.tickets?.location || "",
    receiveDate: row.tickets?.call_received_date || "",
    partDist: row.part_dist || "",
    partNo: row.part_no || "",
    description: row.part_desc || "",
    poNo: row.po_no || "",
    partStatus: row.status || "",
    note: row.note || "",
    unit: Number(row.part_price ?? 0),
    qty: Number(row.quantity ?? 0),
  }));
}

export async function updatePartManagementStatus(
  id: string,
  updates: { status?: string; poDate?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.poDate !== undefined) payload.po_date = updates.poDate || null;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartManagementStatus error:", error.message);
    throw new Error(error.message);
  }
}

export { deleteTicketPart as deletePartManagementRow };
