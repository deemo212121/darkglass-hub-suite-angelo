/**
 * Supabase ticket-billing service (mobile Service Report › Billing tab).
 * One billing record per ticket; company-scoped via RLS.
 */

import { supabase } from "./client";

export interface TicketBilling {
  labor: number;
  laborTaxable: boolean;
  parts: number;
  partsTaxable: boolean;
  partsUsed: string;
  diagnose: number;
  diagnoseTaxable: boolean;
  others: number;
  othersTaxable: boolean;
  taxRate: number;
  tax: number;
  deduction: number;
  total: number;
  customerName: string;
  paymentMethod: string;
  comment: string;
  signature: string; // data URL
}

function rowToBilling(row: any): TicketBilling {
  return {
    labor: Number(row.labor ?? 0),
    laborTaxable: row.labor_taxable ?? true,
    parts: Number(row.parts ?? 0),
    partsTaxable: row.parts_taxable ?? true,
    partsUsed: row.parts_used ?? "",
    diagnose: Number(row.diagnose ?? 0),
    diagnoseTaxable: row.diagnose_taxable ?? true,
    others: Number(row.others ?? 0),
    othersTaxable: row.others_taxable ?? true,
    taxRate: Number(row.tax_rate ?? 0),
    tax: Number(row.tax ?? 0),
    deduction: Number(row.deduction ?? 0),
    total: Number(row.total ?? 0),
    customerName: row.customer_name ?? "",
    paymentMethod: row.payment_method ?? "",
    comment: row.comment ?? "",
    signature: row.signature ?? "",
  };
}

async function getTicketId(ticketNo: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id")
    .eq("ticket_no", ticketNo)
    .maybeSingle();
  if (error) {
    console.error("billing getTicketId error:", error.message);
    throw new Error(error.message);
  }
  return data?.id ?? null;
}

/** Get the billing record for a ticket (or null if none saved yet). */
export async function getTicketBilling(ticketNo: string): Promise<TicketBilling | null> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) return null;
  const { data, error } = await supabase
    .from("ticket_billing")
    .select("*")
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (error) {
    console.error("getTicketBilling error:", error.message);
    throw new Error(error.message);
  }
  return data ? rowToBilling(data) : null;
}

/** Insert or update the billing record for a ticket (upsert on ticket_id). */
export async function saveTicketBilling(ticketNo: string, billing: TicketBilling): Promise<void> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) throw new Error(`Ticket ${ticketNo} not found`);

  const payload = {
    ticket_id: ticketId,
    labor: billing.labor,
    labor_taxable: billing.laborTaxable,
    parts: billing.parts,
    parts_taxable: billing.partsTaxable,
    parts_used: billing.partsUsed || null,
    diagnose: billing.diagnose,
    diagnose_taxable: billing.diagnoseTaxable,
    others: billing.others,
    others_taxable: billing.othersTaxable,
    tax_rate: billing.taxRate,
    tax: billing.tax,
    deduction: billing.deduction,
    total: billing.total,
    customer_name: billing.customerName || null,
    payment_method: billing.paymentMethod || null,
    comment: billing.comment || null,
    signature: billing.signature || null,
    updated_at: new Date().toISOString(),
  };

  // Does a billing row already exist for this ticket?
  const { data: existing } = await supabase
    .from("ticket_billing")
    .select("id")
    .eq("ticket_id", ticketId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("ticket_billing").update(payload).eq("id", existing.id);
    if (error) {
      console.error("saveTicketBilling update error:", error.message);
      throw new Error(error.message);
    }
  } else {
    const { error } = await supabase.from("ticket_billing").insert(payload); // company_id auto-stamped
    if (error) {
      console.error("saveTicketBilling insert error:", error.message);
      throw new Error(error.message);
    }
  }
}
