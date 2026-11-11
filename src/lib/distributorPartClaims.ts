/**
 * Marcone & Encompass Parts (Claims module) — the rules behind each row.
 *
 * Parts ordered from Marcone or Encompass are charged to our account there;
 * the ServicePower claim reimburses them, and the distributor's credit then
 * lands on the part (partCreditSync.ts stamps parts.credited_at). The page
 * lists every invoiced part from those two and follows it: used → claimed →
 * paid → credited (or returned → credited), and flags a used part whose job
 * is done but was never claimed. Each invoice is also looked up on the
 * distributor's API (distributorInvoiceCheck.ts) to confirm the part is on it.
 *
 * "Used" = the part statuses that go on a claim (servicePowerClaimPayload.ts's
 * Used / Claimed) plus PAID (a few legacy rows were set to it by hand).
 */

export type PartDistributor = "Marcone" | "Encompass";

/** "Marcone-162468", "Marcone- Birmingham / Montgomery", "Encompass-Birmingham / Montgomery" → the distributor. */
export function distributorOf(partDist: string | null | undefined): PartDistributor | null {
  const v = String(partDist ?? "").toLowerCase();
  if (v.includes("marcone")) return "Marcone";
  if (v.includes("encompass")) return "Encompass";
  return null;
}

const USED_PART_STATUSES = new Set(["used", "claimed", "paid"]);
export function isUsedPart(status: string | null | undefined): boolean {
  return USED_PART_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

/** Sent back to the distributor: RA - PNN / RA - Qty Discrepancy / RA - Defect / RA- DMG, or Defective. */
export function isReturnedPart(status: string | null | undefined): boolean {
  const v = String(status ?? "").trim().toLowerCase();
  return /^ra\s*-/.test(v) || v === "defective";
}

/**
 * credited    — the distributor's credit is on the part
 * paid        — ServicePower paid the claim (or the part was marked PAID)
 * claimed     — the claim is in, waiting on payment / credit
 * not-claimed — used, the job is done (Ready to Complete / Need Cancel / Cancelled / closed), no claim: the alert
 * job-open    — used, the ticket is still being worked, so nothing to claim yet
 * returned    — sent back to the distributor, waiting on its credit
 * not-used    — not used yet (Part Ready, Tech Pickup, Hold, PO Made, stocked…)
 */
export type PartClaimState = "credited" | "paid" | "claimed" | "not-claimed" | "job-open" | "returned" | "not-used";

export interface PartClaimFacts {
  partStatus: string;
  ticketStatus: string;
  creditedAt: string;
  /** The ticket's claim was sent to ServicePower from AHS (ticket_claim_details.sp_submitted_at). */
  spSubmittedAt: string;
  spPaymentDate: string;
  spClaimStatusCode: string;
  spPaidTotal: number | null;
}

const CLAIMED_TICKET_STATUSES = new Set(["cl-claimed", "cl-data-closed", "cl-data closed"]);

export function partClaimState(f: PartClaimFacts): PartClaimState {
  if (f.creditedAt) return "credited";
  if (isReturnedPart(f.partStatus)) return "returned";
  if (!isUsedPart(f.partStatus)) return "not-used";
  const part = f.partStatus.trim().toLowerCase();
  // Same "paid" test as Claim List: ServicePower paid something on the claim.
  const spPaid = !!f.spPaymentDate || (f.spPaidTotal != null && (f.spClaimStatusCode === "P" || f.spPaidTotal > 0));
  if (part === "paid" || spPaid) return "paid";
  const ticket = f.ticketStatus.trim().toLowerCase();
  if (part === "claimed" || CLAIMED_TICKET_STATUSES.has(ticket) || f.spSubmittedAt) return "claimed";
  // Still being worked (OP-/CSR-/TR-/PT-, Parts Back Ordered…) — not claimable yet.
  const stillOpen = /^(op|csr|tr|pt)-/.test(ticket) || ticket.includes("parts back ordered");
  return stillOpen ? "job-open" : "not-claimed";
}

export const PART_CLAIM_STATE_LABEL: Record<PartClaimState, string> = {
  credited: "Credited",
  paid: "Paid",
  claimed: "Claimed",
  "not-claimed": "Used — not claimed",
  "job-open": "Used — job still open",
  returned: "Returned — waiting for credit",
  "not-used": "Not used yet",
};

// ─── Matching a part to the distributor's invoice ──────────────────────────

/**
 * What to look the invoice up by on the distributor's API. Marcone: the
 * leading digits ("78397586-1" → "78397586" — same as partCreditSync.ts's
 * marconeInvoiceKey), which is also the order number its order lookup takes.
 * Encompass: the invoice without our line ending ("1-456874-0626-1" →
 * "1-456874-0626"); its order lookup rejects the suffixed form.
 */
export function distributorInvoiceRef(dist: PartDistributor, invoiceNo: string | null | undefined): string {
  const v = String(invoiceNo ?? "").trim();
  if (dist === "Marcone") return v.match(/^\d{6,}/)?.[0] ?? "";
  return v.match(/^\d{1,2}-\d{5,7}-\d{4}/)?.[0] ?? "";
}

/** Part numbers compared without case, spaces or dashes. */
export const normPartNo = (v: string | null | undefined) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** One line of a distributor invoice, as both APIs report it. */
export interface DistributorInvoiceLine {
  partNumbers: string[];
  qty: number;
  unitPrice: number | null;
  amount: number | null;
  status: string;
  /** Marcone: how many of this line have been returned. */
  returned: number;
}

/** The line on the invoice for this part number, or null. */
export function matchInvoiceLine(lines: DistributorInvoiceLine[], partNo: string | null | undefined): DistributorInvoiceLine | null {
  const want = normPartNo(partNo);
  if (!want) return null;
  return lines.find((l) => l.partNumbers.some((n) => normPartNo(n) === want)) ?? null;
}
