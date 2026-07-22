/**
 * Part In/Out History — a real current-state snapshot for a part, searched
 * by Unique ID (matches this app's own convention of Unique ID = parts.id,
 * with a flexible fallback substring match against part_no/invoice_no/
 * po_no since staff often only have one of those on hand). Shows exactly
 * what the training manual describes for this feature: ticket number, PO
 * number, current status, and RMA number if the part's been returned.
 *
 * This is deliberately NOT a chronological event log - there's no real
 * per-event ledger anywhere in this app (parts/tickets only ever hold
 * current values, and the part_transactions table that could back a true
 * history is defined in the schema but nothing writes to it), so building
 * one here would mean fabricating events that never really happened.
 */

import { supabase } from "./client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_FIELDS =
  "id, part_no, part_desc, part_dist, quantity, status, po_no, invoice_no, ra_no, ra_date, received_date, qty_received, tickets!inner(ticket_no, location, status, technician, schedule_date)";

export interface PartHistorySnapshotRow {
  id: string;
  partNo: string;
  description: string;
  partDist: string;
  quantity: number;
  status: string;
  poNo: string;
  invoiceNo: string;
  raNo: string;
  raDate: string;
  receivedDate: string;
  qtyReceived: number;
  ticketNo: string;
  location: string;
  ticketStatus: string;
  technician: string;
  scheduleDate: string;
}

function rowFromDb(row: any): PartHistorySnapshotRow {
  return {
    id: row.id,
    partNo: row.part_no || "",
    description: row.part_desc || "",
    partDist: row.part_dist || "",
    quantity: Number(row.quantity ?? 0),
    status: row.status || "",
    poNo: row.po_no || "",
    invoiceNo: row.invoice_no || "",
    raNo: row.ra_no || "",
    raDate: row.ra_date || "",
    receivedDate: row.received_date || "",
    qtyReceived: Number(row.qty_received ?? 0),
    ticketNo: row.tickets?.ticket_no || "",
    location: row.tickets?.location || "",
    ticketStatus: row.tickets?.status || "",
    technician: row.tickets?.technician || "",
    scheduleDate: row.tickets?.schedule_date || "",
  };
}

export async function searchPartHistory(query: string): Promise<PartHistorySnapshotRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queries = [
    supabase.from("parts").select(SELECT_FIELDS).ilike("part_no", `%${trimmed}%`).limit(50),
    supabase.from("parts").select(SELECT_FIELDS).ilike("invoice_no", `%${trimmed}%`).limit(50),
    supabase.from("parts").select(SELECT_FIELDS).ilike("po_no", `%${trimmed}%`).limit(50),
  ];
  if (UUID_RE.test(trimmed)) {
    queries.push(supabase.from("parts").select(SELECT_FIELDS).eq("id", trimmed).limit(1));
  }

  const results = await Promise.all(queries);
  const byId = new Map<string, any>();
  for (const result of results) {
    if (result.error) {
      console.error("searchPartHistory error:", result.error.message);
      continue;
    }
    for (const row of result.data ?? []) byId.set(row.id, row);
  }
  return Array.from(byId.values()).map(rowFromDb);
}
