/**
 * Customer-portal service request sync.
 *
 * The customer-facing portal writes service requests into
 * `portal_service_requests`. Once a request is verified/approved, we pull it
 * into our own `tickets` table so it shows up in the operations console.
 *
 * Company isolation: both tables are company-scoped. We create tickets through
 * the normal createTicket path (company_id auto-stamped by RLS trigger), and we
 * only ever read portal rows the caller's company can see.
 */

import { supabase } from "./client";
import { createTicket } from "./tickets";

export interface PortalRequest {
  id: string;
  requestNumber: string;
  fullName: string;
  phoneNumber: string;
  secondaryPhone: string;
  customerEmail: string;
  serviceAddress: string;
  serviceAddress2: string;
  city: string;
  region: string;
  state: string;
  zipCode: string;
  manualBrand: string;
  manualApplianceType: string;
  modelNumber: string;
  serialNumber: string;
  productModelVersion: string;
  issueDescription: string;
  specialRequest: string;
  preferredDate: string;
  purchaseDate: string;
  warrantyType: string;
  ticketSource: string;
  erTicketNo: string | null;
  verificationStatus: string;
  createdAt: string;
}

function rowToPortal(row: any): PortalRequest {
  return {
    id: row.id,
    requestNumber: row.request_number ?? "",
    fullName: row.full_name ?? "",
    phoneNumber: row.phone_number ?? "",
    secondaryPhone: row.secondary_phone ?? "",
    customerEmail: row.customer_email ?? row.portal_customer_email ?? "",
    serviceAddress: row.service_address ?? "",
    serviceAddress2: row.service_address_2 ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    state: row.state ?? "",
    zipCode: row.zip_code ?? "",
    manualBrand: row.manual_brand ?? "",
    manualApplianceType: row.manual_appliance_type ?? "",
    modelNumber: row.model_number ?? "",
    serialNumber: row.serial_number ?? "",
    productModelVersion: row.product_model_version ?? "",
    issueDescription: row.issue_description ?? "",
    specialRequest: row.special_request ?? "",
    preferredDate: row.preferred_date ?? "",
    purchaseDate: row.purchase_date ?? "",
    warrantyType: row.warranty_type ?? "",
    ticketSource: row.ticket_source ?? "",
    erTicketNo: row.er_ticket_no ?? null,
    verificationStatus: row.verification_status ?? "",
    createdAt: row.created_at ?? "",
  };
}

/**
 * Get APPROVED portal requests that have NOT yet been pulled into a ticket
 * (er_ticket_no is null). Company-scoped via RLS.
 */
export async function getApprovedUnsyncedPortalRequests(): Promise<PortalRequest[]> {
  const { data, error } = await supabase
    .from("portal_service_requests")
    .select("*")
    .eq("verification_status", "approved")
    .is("er_ticket_no", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getApprovedUnsyncedPortalRequests error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToPortal);
}

/** Mark a portal request as pulled into a ticket. */
async function markPortalRequestSynced(id: string, ticketNo: string): Promise<void> {
  const { error } = await supabase
    .from("portal_service_requests")
    .update({
      er_ticket_no: ticketNo,
      sync_status: "synced",
      sync_error: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    // Non-fatal: the ticket was still created. Log and continue.
    console.warn("markPortalRequestSynced failed:", error.message);
  }
}

/**
 * Pull all approved, unsynced portal requests into the tickets table.
 * Returns a summary of how many were pulled.
 */
export async function syncApprovedPortalRequests(): Promise<{
  pulled: number;
  failed: number;
  ticketNos: string[];
}> {
  const requests = await getApprovedUnsyncedPortalRequests();
  let pulled = 0;
  let failed = 0;
  const ticketNos: string[] = [];

  for (const r of requests) {
    try {
      // Use the portal request number as our ticket number so it's traceable.
      const ticketNo = r.requestNumber || `PORTAL-${r.id.slice(0, 8)}`;
      await createTicket({
        ticketNo,
        ticketSource: r.ticketSource || "Customer App",
        warranty: r.warrantyType || "",
        manufacturer: r.manualBrand || "",
        productType: r.manualApplianceType || "",
        model: r.modelNumber || "",
        modelVersion: r.productModelVersion || "",
        serial: r.serialNumber || "",
        purchaseDate: r.purchaseDate || "",
        customer: r.fullName || "",
        phone: r.phoneNumber || "",
        secondPhone: r.secondaryPhone || "",
        email: r.customerEmail || "",
        address: r.serviceAddress || "",
        address2: r.serviceAddress2 || "",
        city: r.city || "",
        state: r.state || "",
        zip: r.zipCode || "",
        location: r.region || r.city || "",
        schedule: r.preferredDate || "",
        problemDescription: r.issueDescription || "",
        internalNote: r.specialRequest || "",
        status: "CSR-Needs Scheduling",
        callReceivedDate: r.createdAt ? String(r.createdAt).slice(0, 10) : "",
      });
      await markPortalRequestSynced(r.id, ticketNo);
      ticketNos.push(ticketNo);
      pulled++;
    } catch (e) {
      console.error("Failed to pull portal request", r.requestNumber, e);
      failed++;
    }
  }

  return { pulled, failed, ticketNos };
}
