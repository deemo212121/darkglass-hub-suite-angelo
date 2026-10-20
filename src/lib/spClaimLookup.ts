/**
 * Reading a claim back from ServicePower's claim retrieval API — shared by
 * the hourly paid-claim check (server/spClaimPaymentSync.ts) and the Claim
 * List's Sync Status (servicePowerClaimStatus.ts), so both decide the same
 * way. No imports beyond mfgSource (which has none), so the server bundle
 * can use it.
 *
 * A claim is looked up with the call's own ServiceCenter plus the name
 * ServicePower files the claim under: the claim company from the call's
 * MfgId (I565 → "SQUARE TRADE" for a GE-brand Square Trade claim), else the
 * ticket's manufacturer, else the brand. Any other pair is refused with
 * "Invalid manufacturerName/serviceCenterNumber".
 */
import { mapSource } from "./mfgSource";

/** One claim as the retrieval API returns it (the fields this app reads). */
export interface SpRetrievedClaim {
  claimNumber?: string;
  claimStatusCode?: string;
  claimStatusDescription?: string;
  claimBatchNumber?: number;
  claimSequenceNumber?: number;
  receivedDate?: number | string;
  editedDate?: number | string;
  paymentDate?: number | string;
  paidTotal?: number;
  paidLaborAmount?: number;
  paidPartsAmount?: number;
  paidPartsHandlingAmount?: number;
  paidTravelAmount?: number;
  paidMileageAmount?: number;
  paidShippingAmount?: number;
  paidFreightAmount?: number;
  paidOtherAmount?: number;
  paidIncentiveAmount?: number;
  paidFederalTaxAmount?: number;
  paidStateTaxAmount?: number;
}

/** What ServicePower paid, grouped the way the Claim List shows it. */
export interface SpClaimPaid {
  total: number;
  labor: number;
  parts: number;
  shipping: number;
  mileage: number;
  other: number;
  tax: number;
  /** YYYY-MM-DD, or null when not paid yet. */
  paymentDate: string | null;
  /** YYYY-MM-DD — when ServicePower received the claim. */
  receivedDate: string | null;
}

/** Names to try for the claim's manufacturerName, best first, no blanks or repeats. */
export function spClaimLookupNames(
  mfgId: string | null | undefined,
  ticketNo: string,
  manufacturer: string | null | undefined,
  brandDesc: string | null | undefined,
): string[] {
  return Array.from(
    new Set(
      [mapSource(mfgId, null, ticketNo), mapSource(mfgId), manufacturer, brandDesc]
        .map((n) => String(n ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

/** True when ServicePower refused the manufacturerName / serviceCenterNumber pair (try the next name). */
export function isWrongManufacturerName(message: string): boolean {
  return /invalid manufacturer/i.test(message);
}

/** Resubmissions can leave more than one claim under one number — the latest received one counts. */
export function latestSpClaim<T extends SpRetrievedClaim>(claims: T[]): T | null {
  if (!claims.length) return null;
  return [...claims].sort(
    (a, b) =>
      String(b.receivedDate ?? "").localeCompare(String(a.receivedDate ?? "")) ||
      String(b.editedDate ?? "").localeCompare(String(a.editedDate ?? "")),
  )[0];
}

/** 20260915 → "2026-09-15"; 0 / blank → null. */
export function spDateIso(v: number | string | undefined | null): string | null {
  const s = String(v ?? "").trim();
  return /^\d{8}$/.test(s) && s !== "00000000" ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

const n = (v: unknown) => Number(v) || 0;
const cents = (v: number) => Math.round(v * 100) / 100;

export function spClaimPaid(c: SpRetrievedClaim): SpClaimPaid {
  return {
    total: cents(n(c.paidTotal)),
    labor: cents(n(c.paidLaborAmount)),
    parts: cents(n(c.paidPartsAmount)),
    shipping: cents(n(c.paidShippingAmount) + n(c.paidFreightAmount)),
    mileage: cents(n(c.paidMileageAmount) + n(c.paidTravelAmount)),
    other: cents(n(c.paidOtherAmount) + n(c.paidPartsHandlingAmount) + n(c.paidIncentiveAmount)),
    tax: cents(n(c.paidFederalTaxAmount) + n(c.paidStateTaxAmount)),
    paymentDate: spDateIso(c.paymentDate),
    receivedDate: spDateIso(c.receivedDate),
  };
}

/** Paid = status P with something actually paid. */
export function isSpClaimPaid(c: SpRetrievedClaim): boolean {
  return c.claimStatusCode === "P" && n(c.paidTotal) > 0;
}

/** Short-paid = there is a Claim Total to compare and ServicePower paid less. */
export function isShortPaid(paidTotal: number, claimTotal: number | null | undefined): boolean {
  return claimTotal != null && claimTotal > 0 && paidTotal + 0.005 < claimTotal;
}

/** The ticket_claim_details columns (migration 0397, plus the 0145 status ones) for a retrieved claim. */
export function spClaimDetailsColumns(c: SpRetrievedClaim, checkedAtIso: string) {
  const paid = spClaimPaid(c);
  return {
    sp_claim_status_code: c.claimStatusCode ?? null,
    sp_claim_status_description: c.claimStatusDescription ?? null,
    sp_claim_batch_number: c.claimBatchNumber != null ? String(c.claimBatchNumber) : null,
    sp_claim_sequence_number: c.claimSequenceNumber != null ? String(c.claimSequenceNumber) : null,
    sp_paid_total: paid.total,
    sp_paid_labor: paid.labor,
    sp_paid_parts: paid.parts,
    sp_paid_shipping: paid.shipping,
    sp_paid_mileage: paid.mileage,
    sp_paid_other: paid.other,
    sp_paid_tax: paid.tax,
    sp_payment_date: paid.paymentDate,
    sp_received_date: paid.receivedDate,
    sp_claim_checked_at: checkedAtIso,
  };
}

/** The columns that need migration 0397 — dropped from a write when the database doesn't have them yet. */
export const SP_PAID_COLUMNS_0397 = [
  "sp_paid_total", "sp_paid_labor", "sp_paid_parts", "sp_paid_shipping", "sp_paid_mileage",
  "sp_paid_other", "sp_paid_tax", "sp_payment_date", "sp_received_date", "sp_claim_checked_at",
] as const;
