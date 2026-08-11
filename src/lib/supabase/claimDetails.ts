/**
 * Ticket Claim Details — the Pre-Claim modal's persisted fields
 * (NeedClaimList.tsx's "Pre Claim" action), migration 0135. One row per
 * ticket, created on first save. See that migration's header comment for
 * which fields replace previously-ephemeral component state.
 */

import { supabase } from "./client";
import { getTicketId } from "./tickets";

export interface TicketClaimDetails {
  id: string;
  ticketId: string;
  preClaimStatus: string;
  claimNote: string;
  dealerStockRepair: boolean;
  serviceContractNo: string;
  callStatus: string;
  postingDate: string;
  startDate: string;
  completeDate: string;
  repairCategory: string;
  repairLevel: string;
  serviceType: string;
  jobCode: string;
  repairType: string;
  diagnosticOnly: boolean;
  partsOnlyWarranty: boolean;
  failureDefectCode: string;
  resolutionCode: string;
  laborFee: number;
  otherFee: number;
  shippingFee: number;
  extraMileFee: number;
  mileageFee: number;
  poAmount: number;
  // ServicePower submission result (migration 0145) — set once "Submit to
  // ServicePower" (PreClaimModal.tsx) has been used at least once.
  spClaimBatchNumber: string;
  spClaimSequenceNumber: string;
  spClaimStatusCode: string;
  spClaimStatusDescription: string;
  spSubmittedAt: string;
  spLastResponse: unknown;
}

function rowToClaimDetails(row: any): TicketClaimDetails {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    preClaimStatus: row.pre_claim_status ?? "",
    claimNote: row.claim_note ?? "",
    dealerStockRepair: !!row.dealer_stock_repair,
    serviceContractNo: row.service_contract_no ?? "",
    callStatus: row.call_status ?? "",
    postingDate: row.posting_date ?? "",
    startDate: row.start_date ?? "",
    completeDate: row.complete_date ?? "",
    repairCategory: row.repair_category ?? "",
    repairLevel: row.repair_level ?? "",
    serviceType: row.service_type ?? "",
    jobCode: row.job_code ?? "",
    repairType: row.repair_type ?? "",
    diagnosticOnly: !!row.diagnostic_only,
    partsOnlyWarranty: !!row.parts_only_warranty,
    failureDefectCode: row.failure_defect_code ?? "",
    resolutionCode: row.resolution_code ?? "",
    laborFee: Number(row.labor_fee) || 0,
    otherFee: Number(row.other_fee) || 0,
    shippingFee: Number(row.shipping_fee) || 0,
    extraMileFee: Number(row.extra_mile_fee) || 0,
    mileageFee: Number(row.mileage_fee) || 0,
    poAmount: Number(row.po_amount) || 0,
    spClaimBatchNumber: row.sp_claim_batch_number ?? "",
    spClaimSequenceNumber: row.sp_claim_sequence_number ?? "",
    spClaimStatusCode: row.sp_claim_status_code ?? "",
    spClaimStatusDescription: row.sp_claim_status_description ?? "",
    spSubmittedAt: row.sp_submitted_at ?? "",
    spLastResponse: row.sp_last_response ?? null,
  };
}

/** This ticket's claim details, or null if the Pre-Claim modal has never been saved for it. */
export async function getTicketClaimDetails(ticketNo: string): Promise<TicketClaimDetails | null> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) return null;
  const { data, error } = await supabase
    .from("ticket_claim_details")
    .select("*")
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (error) {
    console.error("getTicketClaimDetails error:", error.message);
    return null;
  }
  return data ? rowToClaimDetails(data) : null;
}

/**
 * Bulk fetch for every ticket currently shown on Need Claim List, so its
 * Pre-Claim Status column reads real saved data instead of resetting on
 * every reload. Keyed by ticket_id.
 */
export async function getCompanyTicketClaimDetails(): Promise<Map<string, TicketClaimDetails>> {
  const { data, error } = await supabase.from("ticket_claim_details").select("*");
  if (error) {
    console.error("getCompanyTicketClaimDetails error:", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((row: any) => [row.ticket_id as string, rowToClaimDetails(row)]));
}

/** Create or update a ticket's claim details (upsert on the ticket_id unique key). */
export async function upsertTicketClaimDetails(
  ticketNo: string,
  fields: Partial<Omit<TicketClaimDetails, "id" | "ticketId">>,
  updatedBy: string | null
): Promise<TicketClaimDetails> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) throw new Error(`Ticket ${ticketNo} not found`);

  const payload: Record<string, unknown> = { ticket_id: ticketId, updated_by: updatedBy };
  if (fields.preClaimStatus !== undefined) payload.pre_claim_status = fields.preClaimStatus || null;
  if (fields.claimNote !== undefined) payload.claim_note = fields.claimNote || null;
  if (fields.dealerStockRepair !== undefined) payload.dealer_stock_repair = fields.dealerStockRepair;
  if (fields.serviceContractNo !== undefined) payload.service_contract_no = fields.serviceContractNo || null;
  if (fields.callStatus !== undefined) payload.call_status = fields.callStatus || null;
  if (fields.postingDate !== undefined) payload.posting_date = fields.postingDate || null;
  if (fields.startDate !== undefined) payload.start_date = fields.startDate || null;
  if (fields.completeDate !== undefined) payload.complete_date = fields.completeDate || null;
  if (fields.repairCategory !== undefined) payload.repair_category = fields.repairCategory || null;
  if (fields.repairLevel !== undefined) payload.repair_level = fields.repairLevel || null;
  if (fields.serviceType !== undefined) payload.service_type = fields.serviceType || null;
  if (fields.jobCode !== undefined) payload.job_code = fields.jobCode || null;
  if (fields.repairType !== undefined) payload.repair_type = fields.repairType || null;
  if (fields.diagnosticOnly !== undefined) payload.diagnostic_only = fields.diagnosticOnly;
  if (fields.partsOnlyWarranty !== undefined) payload.parts_only_warranty = fields.partsOnlyWarranty;
  if (fields.failureDefectCode !== undefined) payload.failure_defect_code = fields.failureDefectCode || null;
  if (fields.resolutionCode !== undefined) payload.resolution_code = fields.resolutionCode || null;
  if (fields.laborFee !== undefined) payload.labor_fee = fields.laborFee;
  if (fields.otherFee !== undefined) payload.other_fee = fields.otherFee;
  if (fields.shippingFee !== undefined) payload.shipping_fee = fields.shippingFee;
  if (fields.extraMileFee !== undefined) payload.extra_mile_fee = fields.extraMileFee;
  if (fields.mileageFee !== undefined) payload.mileage_fee = fields.mileageFee;
  if (fields.poAmount !== undefined) payload.po_amount = fields.poAmount;
  if (fields.spClaimBatchNumber !== undefined) payload.sp_claim_batch_number = fields.spClaimBatchNumber || null;
  if (fields.spClaimSequenceNumber !== undefined) payload.sp_claim_sequence_number = fields.spClaimSequenceNumber || null;
  if (fields.spClaimStatusCode !== undefined) payload.sp_claim_status_code = fields.spClaimStatusCode || null;
  if (fields.spClaimStatusDescription !== undefined) payload.sp_claim_status_description = fields.spClaimStatusDescription || null;
  if (fields.spSubmittedAt !== undefined) payload.sp_submitted_at = fields.spSubmittedAt || null;
  if (fields.spLastResponse !== undefined) payload.sp_last_response = fields.spLastResponse;

  const { data, error } = await supabase
    .from("ticket_claim_details")
    .upsert(payload, { onConflict: "ticket_id" })
    .select("*")
    .single();
  if (error) {
    console.error("upsertTicketClaimDetails error:", error.message);
    throw new Error(error.message);
  }
  return rowToClaimDetails(data);
}
