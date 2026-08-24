/**
 * Reserved Part List — every real part currently allocated to a ticket
 * (not filtered by parts.status - confirmed against a real reference
 * screenshot of this exact page showing Used/PO Made/Part Ready/Tech
 * Pickup/Defective/Not Used & Stocked side by side). Reads parts joined to
 * tickets for Location/Technician/Schedule Date/Repair Status/Model
 * filtering.
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
  partStatus: string;
  ticketNo: string;
  technician: string;
  location: string;
  invoiceNo: string;
  scheduleDate: string;
  receivedDate: string;
  modelCode: string;
  quantity: number;
  ticketStatus: string;
  statusChangedAt: string;
}

// Supabase caps an unbounded select at 1000 rows — this query has no
// filter at all. Page through in chunks of 1000 instead.
const PAGE_SIZE = 1000;

export async function getReservedPartRows(): Promise<ReservedPartRow[]> {
  const all: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("parts")
      .select(
        "id, part_no, part_desc, status, invoice_no, quantity, received_date, tickets!inner(ticket_no, technician, location, schedule_date, status, status_changed_at, model)"
      )
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("getReservedPartRows error:", error.message);
      throw new Error(error.message);
    }
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return all.map((row: any) => ({
    id: row.id,
    partNo: row.part_no || "",
    description: row.part_desc || "",
    partStatus: row.status || "",
    ticketNo: row.tickets?.ticket_no || "",
    technician: row.tickets?.technician || "",
    location: row.tickets?.location || "",
    invoiceNo: row.invoice_no || "",
    scheduleDate: row.tickets?.schedule_date || "",
    receivedDate: row.received_date || "",
    modelCode: row.tickets?.model || "",
    quantity: Number(row.quantity ?? 0),
    ticketStatus: row.tickets?.status || "",
    statusChangedAt: row.tickets?.status_changed_at || "",
  }));
}
