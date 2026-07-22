/**
 * Part Return — parts being processed through a warranty/insurance
 * provider claim (claim_to set), joined to their ticket for
 * location/aging/technician. Distinct from Part Return Status, which
 * tracks the RA shipment lifecycle for the 4 real "RA - *" statuses;
 * this page is scoped by *provider*, not by RA status. return_status
 * (migration 0070) is reused here for the "Include Returned" filter.
 */

import { supabase } from "./client";

export interface PartReturnRow {
  id: string;
  ticketNo: string;
  location: string;
  partNo: string;
  description: string;
  invoiceNo: string;
  invoiceDate: string;
  quantity: number;
  coreValue: number;
  status: string;
  aging: number;
  scheduleDate: string;
  technician: string;
  raNo: string;
  raDate: string;
  claimTo: string;
  returnStatus: string;
}

export async function getPartReturns(): Promise<PartReturnRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, part_no, part_desc, invoice_no, invoice_date, quantity, core_value, status, ra_no, ra_date, claim_to, return_status, tickets!inner(ticket_no, location, aging, schedule_date, technician)"
    )
    .not("claim_to", "is", null)
    .neq("claim_to", "");

  if (error) {
    console.error("getPartReturns error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    ticketNo: row.tickets?.ticket_no || "",
    location: row.tickets?.location || "",
    partNo: row.part_no || "",
    description: row.part_desc || "",
    invoiceNo: row.invoice_no || "",
    invoiceDate: row.invoice_date || "",
    quantity: Number(row.quantity ?? 0),
    coreValue: Number(row.core_value ?? 0),
    status: row.status || "",
    aging: Number(row.tickets?.aging ?? 0),
    scheduleDate: row.tickets?.schedule_date || "",
    technician: row.tickets?.technician || "",
    raNo: row.ra_no || "",
    raDate: row.ra_date || "",
    claimTo: row.claim_to || "",
    returnStatus: row.return_status || "NOT RECEIVED",
  }));
}

export async function updatePartReturnEntryRow(
  id: string,
  updates: { raNo?: string; raDate?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.raNo !== undefined) payload.ra_no = updates.raNo;
  if (updates.raDate !== undefined) payload.ra_date = updates.raDate || null;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartReturnEntryRow error:", error.message);
    throw new Error(error.message);
  }
}

/** Distinct real claim_to (Part Provider) values currently in use, for the filter dropdown. */
export async function getDistinctProviders(): Promise<string[]> {
  const { data, error } = await supabase.from("parts").select("claim_to").not("claim_to", "is", null);
  if (error) {
    console.error("getDistinctProviders error:", error.message);
    return [];
  }
  const set = new Set((data ?? []).map((r: any) => r.claim_to).filter((v: string) => v && v.trim()));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
