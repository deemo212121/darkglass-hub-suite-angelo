/**
 * Short-paid claims: only Accounting moves them to CL-Data-Closed.
 *
 * A claim ServicePower paid (status P) less than its Claim Total — the
 * Pre-Claim window's fees plus its Used / Claimed parts, the same figure the
 * Claim List shows as Requested (spClaimLookup.ts isShortPaid) — stays
 * CL-Claimed: the hourly paid-claim check and Sync Status never close it,
 * and by hand only Accounting may. "Accounting" is the same as for expense
 * review (migration 0396): FINANCE (an Accounting Manager too), Admin,
 * Super Admin (IT too) and SuperSuperAdmin, primary or extra role.
 *
 * Checked wherever a person can set CL-Data-Closed: Claim List's Change, the
 * ticket's visit Repair Status, Work Planner, No-Coverage Tickets and the
 * tech app's visit edit.
 */
import { supabase } from "@/lib/supabase/client";
import { anyHeldRoleIn } from "@/lib/roleLabels";
import { isClaimablePart } from "@/lib/servicePowerClaimPayload";
import { isShortPaid } from "@/lib/spClaimLookup";

const SHORT_PAID_DATA_CLOSE_ROLES = new Set(["FINANCE", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);

export const SHORT_PAID_DATA_CLOSE_MESSAGE =
  "ServicePower short-paid this claim (paid less than the Claim Total). Only Accounting can move it to CL-Data-Closed.";

export function isDataClosedStatus(status: string | null | undefined): boolean {
  return /^cl-data[- ]closed$/i.test(String(status ?? "").trim());
}

export function canDataCloseShortPaid(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return anyHeldRoleIn(SHORT_PAID_DATA_CLOSE_ROLES, role, extraRoles);
}

const n = (v: unknown) => Number(v) || 0;

/** Which of these tickets (by ticket number) have a short-paid ServicePower claim. */
export async function shortPaidTicketNos(ticketNos: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const nos = Array.from(new Set(ticketNos.map((t) => String(t ?? "").trim()).filter(Boolean)));
  for (let i = 0; i < nos.length; i += 200) {
    const { data: tickets, error } = await supabase.from("tickets").select("id, ticket_no").in("ticket_no", nos.slice(i, i + 200));
    if (error) throw error;
    const noById = new Map(((tickets ?? []) as Array<{ id: string; ticket_no: string }>).map((t) => [t.id, t.ticket_no]));
    if (noById.size === 0) continue;
    const { data: details, error: detailsError } = await supabase
      .from("ticket_claim_details")
      .select("ticket_id, labor_fee, other_fee, shipping_fee, extra_mile_fee, sp_claim_status_code, sp_paid_total")
      .in("ticket_id", Array.from(noById.keys()));
    if (detailsError) throw detailsError;
    // mileage_fee is the round-trip miles, not money — not part of the Claim Total.
    const paidWithFees = ((details ?? []) as any[]).filter(
      (d) => d.sp_claim_status_code === "P" && d.sp_paid_total != null && n(d.labor_fee) + n(d.other_fee) + n(d.shipping_fee) + n(d.extra_mile_fee) > 0,
    );
    if (paidWithFees.length === 0) continue;
    const { data: parts, error: partsError } = await supabase
      .from("parts")
      .select("ticket_id, part_price, markup, status")
      .in("ticket_id", paidWithFees.map((d) => d.ticket_id));
    if (partsError) throw partsError;
    for (const d of paidWithFees) {
      const partFee = ((parts ?? []) as any[])
        .filter((p) => p.ticket_id === d.ticket_id && isClaimablePart(p))
        .reduce((s, p) => s + n(p.part_price) * (1 + n(p.markup) / 100), 0);
      const claimTotal = Math.round((n(d.labor_fee) + n(d.other_fee) + n(d.shipping_fee) + n(d.extra_mile_fee) + partFee) * 100) / 100;
      if (isShortPaid(n(d.sp_paid_total), claimTotal)) out.add(noById.get(d.ticket_id)!);
    }
  }
  return out;
}

/**
 * The tickets this person may not move to `nextStatus`: short-paid claims,
 * when the move is to CL-Data-Closed and they aren't Accounting. Empty when
 * nothing is blocked.
 */
export async function shortPaidDataCloseBlocked(
  nextStatus: string | null | undefined,
  ticketNos: string[],
  role: string | null | undefined,
  extraRoles?: string[] | null,
): Promise<Set<string>> {
  if (!isDataClosedStatus(nextStatus) || canDataCloseShortPaid(role, extraRoles)) return new Set();
  return shortPaidTicketNos(ticketNos);
}
