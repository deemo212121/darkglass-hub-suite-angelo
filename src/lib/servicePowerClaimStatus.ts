/**
 * Claim List → "Sync Status": reads one ticket's claim back from
 * ServicePower (read-only there), saves what ServicePower paid onto its
 * claim details (migration 0397), and — same rule as the hourly paid-claim
 * check (server/spClaimPaymentSync.ts) — moves a CL-Claimed ticket whose
 * claim is paid to CL-Data-Closed, unless it has a Claim Total that
 * ServicePower paid less than (short-paid: stays CL-Claimed).
 */
import { upsertTicketClaimDetails, type TicketClaimDetails } from "@/lib/supabase/claimDetails";
import { updateTicketStatus } from "@/lib/supabase/tickets";
import {
  isShortPaid,
  isSpClaimPaid,
  isWrongManufacturerName,
  latestSpClaim,
  spClaimPaid,
  spClaimLookupNames,
  type SpRetrievedClaim,
} from "@/lib/spClaimLookup";

export const SP_CLAIMED_STATUS = "CL-Claimed";
export const SP_PAID_CLOSED_STATUS = "CL-Data-Closed";

export interface ClaimStatusSyncResult {
  /** The claim was found on ServicePower and saved. */
  found: boolean;
  message: string;
  details?: TicketClaimDetails;
  /** The ticket was moved to CL-Data-Closed. */
  closed: boolean;
  shortPaid: boolean;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export async function syncServicePowerClaimStatus(
  ticket: { ticketNo: string; manufacturer?: string | null; status?: string | null },
  claimTotal: number | null,
  updatedBy: string | null,
): Promise<ClaimStatusSyncResult> {
  const { fetchServicePowerCalls } = await import("@/lib/servicePowerSync");
  const { retrieveClaim } = await import("@/lib/servicePowerApiClient");

  const res = await fetchServicePowerCalls({ callNo: ticket.ticketNo });
  const call = (res.calls ?? []).find((c: any) => String(c?.callNumber ?? "").trim() === ticket.ticketNo) ?? res.calls?.[0];
  const center = String(call?.serviceCenter ?? "").trim();
  if (!call || !center) {
    return { found: false, closed: false, shortPaid: false, message: res.error ? `ServicePower: ${res.error}` : "This call isn't on ServicePower." };
  }

  const names = spClaimLookupNames(call.mfgId, ticket.ticketNo, ticket.manufacturer, call.product?.brandDesc);
  let claims: SpRetrievedClaim[] = [];
  let lastMessage = "";
  for (const manufacturerName of names) {
    const r = await retrieveClaim({ manufacturerName, serviceCenterNumber: center, claimNumber: ticket.ticketNo });
    if (Array.isArray(r?.claims) && r.claims.length > 0) {
      claims = r.claims as SpRetrievedClaim[];
      break;
    }
    lastMessage = (r?.messages ?? []).map((m) => m.message).join("; ");
    if (!isWrongManufacturerName(lastMessage)) break;
  }
  const claim = latestSpClaim(claims);
  if (!claim) return { found: false, closed: false, shortPaid: false, message: lastMessage || "No claim on ServicePower for this ticket." };

  const paid = spClaimPaid(claim);
  const details = await upsertTicketClaimDetails(
    ticket.ticketNo,
    {
      spClaimStatusCode: claim.claimStatusCode ?? "",
      spClaimStatusDescription: claim.claimStatusDescription ?? "",
      spClaimBatchNumber: claim.claimBatchNumber != null ? String(claim.claimBatchNumber) : "",
      spClaimSequenceNumber: claim.claimSequenceNumber != null ? String(claim.claimSequenceNumber) : "",
      spPaidTotal: paid.total,
      spPaidLabor: paid.labor,
      spPaidParts: paid.parts,
      spPaidShipping: paid.shipping,
      spPaidMileage: paid.mileage,
      spPaidOther: paid.other,
      spPaidTax: paid.tax,
      spPaymentDate: paid.paymentDate ?? "",
      spReceivedDate: paid.receivedDate ?? "",
      spClaimCheckedAt: new Date().toISOString(),
    },
    updatedBy,
  );

  const status = `ServicePower: ${claim.claimStatusDescription || claim.claimStatusCode || "found"}`;
  if (!isSpClaimPaid(claim)) return { found: true, details, closed: false, shortPaid: false, message: `${status} — not paid yet.` };
  if (isShortPaid(paid.total, claimTotal)) {
    return { found: true, details, closed: false, shortPaid: true, message: `${status} — short-paid: ${money(paid.total)} of ${money(claimTotal ?? 0)} claimed. Left as CL-Claimed.` };
  }
  if (String(ticket.status ?? "").trim() === SP_CLAIMED_STATUS) {
    await updateTicketStatus(ticket.ticketNo, SP_PAID_CLOSED_STATUS);
    return { found: true, details, closed: true, shortPaid: false, message: `${status} — ${money(paid.total)} paid. Ticket moved to ${SP_PAID_CLOSED_STATUS}.` };
  }
  return { found: true, details, closed: false, shortPaid: false, message: `${status} — ${money(paid.total)} paid.` };
}
