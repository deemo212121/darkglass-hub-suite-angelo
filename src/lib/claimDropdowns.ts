/**
 * Centralised dropdown lists for the Claim Transaction section on the ticket
 * detail page. Keeping them in one place avoids the same picker drifting
 * across the Claim List, Need Claim List, and ticket-detail Claim Transaction
 * components.
 */

/** Claim Status — order mirrors what the user submitted in the latest spec. */
export const CLAIM_STATUSES = [
  "Approved",
  "ASC to Review",
  "Business Loss",
  "Claim Submitted to Vendor",
  "Hold by ASC",
  "Paid",
  "Paid by Customer",
  "Preauth",
  "Preauth Authorized",
  "REDO (Not Claimed)",
  "REJECTED",
  "Rejected by Vendor",
  "Review by Vendor",
  "UNDER REVIEW",
] as const;

/** Claim To — warranty / claim company picker. */
export const CLAIM_TOS = [
  "AIG WARRANTY",
  "ASSURANT SOLUTIONS",
  "Assurion",
  "Centricity",
  "Fidelity Home Insurance",
  "Frigidaire",
  "GE CUSTOMER CARE",
  "Hisense",
  "LG",
  "Midea",
  "MIELE",
  "NEW",
  "NSA",
  "ONPOINT WARRANTY",
  "SAFEWARE",
  "SERVICE POWER",
  "Speed Queen",
  "SQUARE TRADE",
  "SS 4930403",
] as const;

/** Payment Method — same list the mobile tech billing form uses. */
export const PAYMENT_METHODS = [
  "Cash",
  "Check",
  "Credit Card",
  "Ext Warranty",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type ClaimTo = (typeof CLAIM_TOS)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
