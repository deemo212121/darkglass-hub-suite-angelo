/**
 * Reserved Part List — real parts that have been received and staged but
 * not yet handed to a tech or used (status = "Part Ready", the same status
 * the ticket detail page's own Parts tab sets once a part comes in - see
 * the "STAGING PARTS" workflow: a part shows Part Ready once verified in
 * and ready to give out). Reads parts joined to tickets for Location/
 * Technician/Schedule Date filtering.
 *
 * By default this hides tickets whose own status is a terminal Cancelled/
 * Data-Closed state (a cancelled ticket shouldn't still be "reserving" a
 * part) - the "Show All Repair Status" toggle reveals those too, scoped to
 * a tickets.status_changed_at date range.
 */

import { supabase } from "./client";

export const TERMINAL_TICKET_STATUSES = ["CL-Cancelled", "CL-Data-Closed"];

export interface ReservedPartRow {
  id: string;
  partNo: string;
  description: string;
  ticketNo: string;
  technician: string;
  location: string;
  invoiceNo: string;
  scheduleDate: string;
  quantity: number;
  ticketStatus: string;
  statusChangedAt: string;
}

export async function getReservedPartRows(): Promise<ReservedPartRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, part_no, part_desc, invoice_no, quantity, tickets!inner(ticket_no, technician, location, schedule_date, status, status_changed_at)"
    )
    .eq("status", "Part Ready");

  if (error) {
    console.error("getReservedPartRows error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    partNo: row.part_no || "",
    description: row.part_desc || "",
    ticketNo: row.tickets?.ticket_no || "",
    technician: row.tickets?.technician || "",
    location: row.tickets?.location || "",
    invoiceNo: row.invoice_no || "",
    scheduleDate: row.tickets?.schedule_date || "",
    quantity: Number(row.quantity ?? 0),
    ticketStatus: row.tickets?.status || "",
    statusChangedAt: row.tickets?.status_changed_at || "",
  }));
}
