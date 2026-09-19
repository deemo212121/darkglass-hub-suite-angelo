/**
 * Branch Manager Commission (migration 0289) — the manual per-person,
 * per-pay-period tally backing the Accounting Dashboard's "Branch
 * Commission" tab. Earned by the person holding a Branch Manager-tier
 * role (see roleLabels.ts's BM_AND_UP_ROLES), keyed by profile_id — not
 * by branch, since a branch's numbers are attributed to whoever manages
 * it. Completion %, LTP %, and Completed Ticket Count are all typed in
 * by hand (see the migration's own comment for why) — this module is
 * just the saved row itself, plus the one pure function that decides
 * which of the 4 commission tiers a person's numbers fall into.
 */
import { supabase } from "./client";

export interface BranchManagerCommissionRow {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  completionPct: number;
  ltpPct: number;
  completedTickets: number;
  updatedAt: string;
}

function mapRow(row: any): BranchManagerCommissionRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    completionPct: Number(row.completion_pct) || 0,
    ltpPct: Number(row.ltp_pct) || 0,
    completedTickets: Number(row.completed_tickets) || 0,
    updatedAt: row.updated_at,
  };
}

/** Every saved tally row for the given period (RLS-scoped). People with no row yet just aren't in this list — the caller merges against its own Branch Manager-and-up roster. */
export async function getBranchManagerCommissionTally(periodStart: string, periodEnd: string): Promise<BranchManagerCommissionRow[]> {
  const { data, error } = await supabase
    .from("branch_manager_commission_tally")
    .select("id, profile_id, period_start, period_end, completion_pct, ltp_pct, completed_tickets, updated_at")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) {
    console.error("getBranchManagerCommissionTally error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/**
 * Every saved tally row whose period falls entirely inside [rangeStart,
 * rangeEnd] (RLS-scoped), across however many cut-offs were actually
 * saved in that window — pay-period cut-offs here are nominally
 * biweekly but their exact dates aren't fixed/calendar-aligned, so this
 * just returns whatever rows exist rather than assuming a cadence.
 * Ordered by period_start for the Trend chart's own X axis.
 */
export async function getBranchManagerCommissionTallyInRange(rangeStart: string, rangeEnd: string): Promise<BranchManagerCommissionRow[]> {
  const { data, error } = await supabase
    .from("branch_manager_commission_tally")
    .select("id, profile_id, period_start, period_end, completion_pct, ltp_pct, completed_tickets, updated_at")
    .gte("period_start", rangeStart)
    .lte("period_end", rangeEnd)
    .order("period_start", { ascending: true });
  if (error) {
    console.error("getBranchManagerCommissionTallyInRange error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

export type BranchManagerCommissionFields = Partial<Pick<BranchManagerCommissionRow, "completionPct" | "ltpPct" | "completedTickets">>;

/** Create-or-update one person's row for one period — a single edited cell sends just that field, merged onto whatever's already there. Returns the row's own id, so a caller can log against a stable target even on the very first save (before this row existed). */
export async function upsertBranchManagerCommissionTally(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  fields: BranchManagerCommissionFields
): Promise<string> {
  const patch: Record<string, unknown> = { profile_id: profileId, period_start: periodStart, period_end: periodEnd };
  if ("completionPct" in fields) patch.completion_pct = fields.completionPct;
  if ("ltpPct" in fields) patch.ltp_pct = fields.ltpPct;
  if ("completedTickets" in fields) patch.completed_tickets = fields.completedTickets;

  const { data, error } = await supabase
    .from("branch_manager_commission_tally")
    .upsert(patch, { onConflict: "company_id,profile_id,period_start,period_end" })
    .select("id")
    .single();
  if (error) {
    console.error("upsertBranchManagerCommissionTally error:", error.message);
    throw new Error(error.message);
  }
  return data.id;
}

export type CommissionTier = 1 | 2 | 3 | 4;

export interface CommissionTierResult {
  tier: CommissionTier;
  ratePerTicket: number;
  label: string;
}

/**
 * The Branch Manager Commission policy, resolved into exact, non-
 * overlapping rules (the raw policy text left several boundaries
 * ambiguous — e.g. LTP 70-75% technically matched both Condition 3 and
 * 4 as written). Checked most-severe-first, first match wins:
 *
 *   4 (Critical Failure, $0):        completion < 35%  OR  ltp > 70%
 *   3 (Double Failure, $2.50):       35% < completion < 50%  AND  50% < ltp < 75%
 *   2 (Single Failure, $5):          completion <= 49%  OR  ltp >= 50%
 *   1 (High Completion/Low LTP, $10): else (completion >= 50% AND ltp < 50%)
 *
 * So e.g. completion exactly 35% or ltp exactly 70% land in Condition 2,
 * not 3 or 4 — the strict `<`/`>` in 3/4 deliberately excludes them.
 */
export function resolveCommissionTier(completionPct: number, ltpPct: number): CommissionTierResult {
  if (completionPct < 35 || ltpPct > 70) {
    return { tier: 4, ratePerTicket: 0, label: "Critical Failure — no commission" };
  }
  if (completionPct > 35 && completionPct < 50 && ltpPct > 50 && ltpPct < 75) {
    return { tier: 3, ratePerTicket: 2.5, label: "Double Failure" };
  }
  if (completionPct <= 49 || ltpPct >= 50) {
    return { tier: 2, ratePerTicket: 5, label: "Low Completion or High LTP" };
  }
  return { tier: 1, ratePerTicket: 10, label: "High Completion & Low LTP" };
}
