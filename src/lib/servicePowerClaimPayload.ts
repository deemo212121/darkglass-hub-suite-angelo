/**
 * Builds a ServicePower Claim Submission payload (services/claim/v1/submission)
 * entirely from data this app already has on a ticket — the Pre-Claim modal's
 * saved fields, the ticket's own customer/product info, and its parts list.
 * Nothing here is manually retyped per claim; the whole point is that Claims
 * never has to re-key what's already on the ticket into ServicePower's portal.
 *
 * Field mapping is documented inline per field below. Anything ServicePower
 * requires that this app has no real source for (dealer info, EIA repair
 * schematic locations, tpa* fields, etc.) is simply left unset — all of
 * those are optional per the integration guide.
 */
import type { Ticket } from "@/lib/ticketData";
import type { TicketClaimDetails } from "@/lib/supabase/claimDetails";
import type { UIPartRow } from "@/lib/supabase/tickets";
import type { ClaimSubmissionClaim, ClaimSubmissionPart } from "@/types/servicePower";

/** "2026-08-07" (or with a time part) -> "20260807". Returns undefined for anything that isn't a clean date. */
function toSpDate(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().slice(0, 10).replace(/-/g, "");
  return /^\d{8}$/.test(cleaned) ? cleaned : undefined;
}

/** SP's customerPhone element is numeric-only, length 10 — strip formatting, keep the last 10 digits. */
function toSpPhone(value: string | undefined | null): string | undefined {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  return digits.slice(-10);
}

function markupPriceFor(p: UIPartRow): number {
  const price = Number(p.partPrice) || 0;
  const pct = Number(p.markup) || 0;
  return price * (1 + pct / 100);
}

/** Truncates to a field's max length so SP never rejects on length alone. */
function clip(value: string | undefined | null, maxLen: number): string | undefined {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, maxLen) : undefined;
}

export interface BuildClaimPayloadResult {
  claim: ClaimSubmissionClaim | null;
  /** Non-fatal — fields that were skipped because this app has no data for them. Shown to the user before submitting, not blocking. */
  warnings: string[];
  /** Fatal — a truly mandatory field (manufacturerName) has no source data, so no claim was built. */
  error: string | null;
}

/**
 * Part statuses that go on a claim: "Used", and "Claimed" — a part already
 * marked as claimed was used too (SA-5382504's two parts were switched to
 * Claimed while the claim was prepared and dropped out of Part Fee).
 */
export const CLAIMABLE_PART_STATUSES = new Set(["Used", "Claimed"]);
export function isClaimablePart(p: { status?: string | null }): boolean {
  return CLAIMABLE_PART_STATUSES.has(String(p.status ?? "").trim());
}

/**
 * Assembles one ClaimSubmissionClaim from a ticket's already-saved data.
 * `partFee` should be the same figure the Pre-Claim modal displays/sums as
 * "Part Fee" (sum of markup price across parts marked Used or Claimed) — passed
 * in rather than recomputed here so the submitted partsAmount always
 * matches exactly what Claims saw on screen.
 */
export function buildServicePowerClaimPayload(
  ticket: Ticket,
  claimDetails: TicketClaimDetails,
  parts: UIPartRow[],
  customerComplaint: string,
  servicePerformed: string,
  partFee: number,
  /**
   * The call's own ServiceCenter on ServicePower (getCallInfo's
   * <ServiceCenter>, e.g. "108501359") — the servicer number the
   * manufacturer issued us. ServicePower rejects a claim whose
   * serviceCenterNumber is the SP login (ticket.accountNo, e.g. "GSL00002")
   * with "Invalid manufacturerName/serviceCenterNumber"; that login is only
   * the fallback when the call couldn't be read.
   */
  spServiceCenter?: string,
): BuildClaimPayloadResult {
  const warnings: string[] = [];

  const manufacturerName = clip(ticket.manufacturer, 30);
  if (!manufacturerName) {
    return { claim: null, warnings, error: "This ticket has no Manufacturer set — ServicePower requires one to submit a claim." };
  }

  const serviceCenterNumber = (spServiceCenter ?? "").trim() || ticket.accountNo || "";
  if (!(spServiceCenter ?? "").trim()) {
    warnings.push(
      ticket.accountNo
        ? `Couldn't read this call's Service Center from ServicePower — sent the S/P account (${ticket.accountNo}) instead, which ServicePower may reject.`
        : "No ServicePower service center number for this call — serviceCenterNumber will be left blank.",
    );
  }
  if (!ticket.firstName && !ticket.lastName) {
    warnings.push("No customer name on this ticket.");
  }

  const usedParts = parts.filter(isClaimablePart);
  if (usedParts.length > 25) {
    warnings.push(`${usedParts.length} parts are marked Used/Claimed, but ServicePower accepts at most 25 per claim — only the first 25 will be sent.`);
  }
  const spParts: ClaimSubmissionPart[] = usedParts.slice(0, 25).map((p) => ({
    number: p.partNo,
    quantity: Number(p.quantity) || undefined,
    description: clip(p.partDesc, 30),
    priceRequested: Math.round(markupPriceFor(p) * 100) / 100 || undefined,
    distributorNumber: clip(p.distributorNo, 12),
    // ServicePower flags a part with no invoice number ("Blank Parts Invoice Number").
    invoiceNumber: clip(p.invoiceNo, 20),
    // The claim's Job Code (Claim section) on every part line, else the
    // part's own — ServicePower rejects a claim with none ("Blank Job Code").
    jobCode: clip(claimDetails.jobCode || p.jobCode, 4),
  }));

  // Resubmitting a claim SP already has an id for MUST pass these back, or
  // SP creates a brand new duplicate claim instead of updating this one —
  // see ClaimSubmissionClaim's own doc comment.
  const existingClaimBatchNumber = claimDetails.spClaimBatchNumber ? Number(claimDetails.spClaimBatchNumber) || undefined : undefined;
  const existingClaimSequenceNumber = claimDetails.spClaimSequenceNumber ? Number(claimDetails.spClaimSequenceNumber) || undefined : undefined;

  const claim: ClaimSubmissionClaim = {
    manufacturerName,
    serviceCenterNumber: serviceCenterNumber || undefined,
    claimNumber: ticket.ticketNo,
    callNumber: ticket.ticketNo,

    customerFirstName: clip(ticket.firstName, 15),
    customerLastName: clip(ticket.lastName, 20),
    customerAddress1: clip(ticket.address, 30),
    customerAddress2: clip(ticket.address2, 30),
    customerCity: clip(ticket.city, 20),
    customerState: clip(ticket.state, 2),
    customerZipCode: clip(ticket.zip, 9),
    customerPhone: toSpPhone(ticket.phone),
    customerEmail: clip(ticket.email, 50),

    brandName: clip(ticket.manufacturer, 20),
    modelNumber: clip(ticket.model, 20),
    serialNumber: clip(ticket.serial, 25),
    datePurchased: toSpDate(ticket.purchaseDate),

    eiaDefectOrComplaintCode: clip(claimDetails.failureDefectCode, 4),
    defectOrComplaintDescription: clip(customerComplaint, 150),
    servicePerformedDescription: clip(servicePerformed, 250),
    eiaRepairCode1: clip(claimDetails.resolutionCode, 4),

    repairCategory: clip(claimDetails.repairCategory, 2),
    // The Claim section's Job Code, else the first part's — sent on the claim
    // itself so a labor-only claim (no part lines) still has one.
    jobCode: clip(claimDetails.jobCode || spParts.find((p) => p.jobCode)?.jobCode, 4),
    stockRepairFlag: claimDetails.dealerStockRepair ? "Y" : "N",

    existingClaimBatchNumber,
    existingClaimSequenceNumber,

    dateReceived: toSpDate(ticket.callReceivedDate),
    // When the customer requested service — the call's received date;
    // ServicePower rejects a claim without it ("Blank Request Date").
    dateRequested: toSpDate(ticket.callReceivedDate),
    dateStarted: toSpDate(claimDetails.startDate),
    dateCompleted: toSpDate(claimDetails.completeDate),

    laborAmount: claimDetails.laborFee || undefined,
    // Rounded to cents — summed part prices carry float noise (68.92999…).
    partsAmount: Math.round(partFee * 100) / 100 || undefined,
    otherAmount: claimDetails.otherFee || undefined,
    shippingChargeAmount: claimDetails.shippingFee || undefined,
    travelChargeAmount: claimDetails.extraMileFee || undefined,
    mileageAmount: claimDetails.mileageFee || undefined,

    serviceContractNumber: clip(claimDetails.serviceContractNo, 15),

    parts: spParts.length > 0 ? spParts : undefined,
  };

  return { claim, warnings, error: null };
}
