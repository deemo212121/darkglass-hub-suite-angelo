/**
 * Part Receive — real parts that have a PO placed and are awaiting arrival
 * at the branch (status = "PO Made"), joined to their ticket for location
 * filtering. See migration 0071 for the qty_received/received_date columns
 * this reads and writes — tracked as their own fields, never changing the
 * part's ticket-facing `status`.
 *
 * invoice_no is editable here too: for branch-to-branch transfers there's
 * no real distributor invoice, so staff enter a synthetic reference like
 * "JS-TS-26000792299DF" (TS for Truck Stock, 2-letter branch, ticket #).
 */

import { supabase } from "./client";

export interface PartReceiveRow {
  id: string;
  poNo: string;
  poDate: string;
  orderNo: string;
  invoiceNo: string;
  partNo: string;
  partDesc: string;
  eta: string;
  receivedDate: string;
  tracking: string;
  ticketNo: string;
  ticketStatus: string;
  tech: string;
  schedule: string;
  quantity: number;
  qtyReceived: number;
  partPrice: number;
  coreValue: number;
  location: string;
  partFrom: string;
}

export async function getPartsToReceive(): Promise<PartReceiveRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, po_no, po_date, order_no, invoice_no, part_no, part_desc, eta, received_date, in_tracking, part_dist, quantity, qty_received, part_price, core_value, tickets!inner(ticket_no, technician, status, location, schedule_date)"
    )
    .eq("status", "PO Made");

  if (error) {
    console.error("getPartsToReceive error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    poNo: row.po_no || "",
    poDate: row.po_date || "",
    orderNo: row.order_no || "",
    invoiceNo: row.invoice_no || "",
    partNo: row.part_no || "",
    partDesc: row.part_desc || "",
    eta: row.eta || "",
    receivedDate: row.received_date || "",
    tracking: row.in_tracking || "",
    ticketNo: row.tickets?.ticket_no || "",
    ticketStatus: row.tickets?.status || "",
    tech: row.tickets?.technician || "",
    schedule: row.tickets?.schedule_date || "",
    quantity: Number(row.quantity ?? 0),
    qtyReceived: Number(row.qty_received ?? 0),
    partPrice: Number(row.part_price ?? 0),
    coreValue: Number(row.core_value ?? 0),
    location: row.tickets?.location || "",
    partFrom: row.part_dist || "",
  }));
}

export async function updatePartReceiveRow(
  id: string,
  updates: { qtyReceived?: number; receivedDate?: string; invoiceNo?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.qtyReceived !== undefined) payload.qty_received = updates.qtyReceived;
  if (updates.receivedDate !== undefined) payload.received_date = updates.receivedDate || null;
  if (updates.invoiceNo !== undefined) payload.invoice_no = updates.invoiceNo;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartReceiveRow error:", error.message);
    throw new Error(error.message);
  }
}

/** Distinct real "Part From" (part_dist) values currently in use, for the filter dropdown. */
export async function getDistinctPartSources(): Promise<string[]> {
  const { data, error } = await supabase.from("parts").select("part_dist").not("part_dist", "is", null);
  if (error) {
    console.error("getDistinctPartSources error:", error.message);
    return [];
  }
  const set = new Set((data ?? []).map((r: any) => r.part_dist).filter((v: string) => v && v.trim()));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
