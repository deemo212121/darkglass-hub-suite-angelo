/**
 * Branch Commission, per branch per pay period (migration 0479): Flash tech,
 * Damages, Total damage, the branch's own ticket count (when Finance keeps it
 * per branch), a note, and Mark as Paid. Monitoring only — nothing here is
 * sent to payroll.
 */
import { supabase } from "./client";
import { branchMatchKey } from "@/lib/branchName";

export interface BranchPeriodRow {
  id: string;
  branchKey: string;
  branch: string;
  periodStart: string;
  periodEnd: string;
  flashTech: boolean | null;
  damages: boolean | null;
  damageCount: number | null;
  ticketsOverride: number | null;
  note: string;
  paidAt: string | null;
  paidBy: string | null;
  paidByName: string | null;
}

const COLUMNS =
  "id, branch_key, branch, period_start, period_end, flash_tech, damages, damage_count, tickets_override, note, paid_at, paid_by, paid_by_name";

function mapRow(r: any): BranchPeriodRow {
  return {
    id: r.id,
    branchKey: r.branch_key,
    branch: r.branch,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    flashTech: r.flash_tech ?? null,
    damages: r.damages ?? null,
    damageCount: r.damage_count ?? null,
    ticketsOverride: r.tickets_override ?? null,
    note: r.note ?? "",
    paidAt: r.paid_at ?? null,
    paidBy: r.paid_by ?? null,
    paidByName: r.paid_by_name ?? null,
  };
}

/** True when migration 0479 hasn't been run yet. */
export function isBranchPeriodMissingError(message: string): boolean {
  return /branch_commission_branch_period|does not exist|schema cache/i.test(message);
}

/** Every branch's row for one period. */
export async function getBranchPeriods(periodStart: string, periodEnd: string): Promise<BranchPeriodRow[]> {
  const { data, error } = await supabase
    .from("branch_commission_branch_period")
    .select(COLUMNS)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** Every row whose period falls inside [rangeStart, rangeEnd] — the import's "already paid?" check. */
export async function getBranchPeriodsInRange(rangeStart: string, rangeEnd: string): Promise<BranchPeriodRow[]> {
  const { data, error } = await supabase
    .from("branch_commission_branch_period")
    .select(COLUMNS)
    .gte("period_start", rangeStart)
    .lte("period_end", rangeEnd);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export type BranchPeriodFields = Partial<
  Pick<BranchPeriodRow, "flashTech" | "damages" | "damageCount" | "ticketsOverride" | "note" | "paidAt" | "paidBy" | "paidByName">
>;

/** Create-or-update one branch's row for one period; returns the saved row. */
export async function upsertBranchPeriod(
  branch: string,
  periodStart: string,
  periodEnd: string,
  fields: BranchPeriodFields
): Promise<BranchPeriodRow> {
  const patch: Record<string, unknown> = { branch_key: branchMatchKey(branch), branch, period_start: periodStart, period_end: periodEnd };
  if ("flashTech" in fields) patch.flash_tech = fields.flashTech;
  if ("damages" in fields) patch.damages = fields.damages;
  if ("damageCount" in fields) patch.damage_count = fields.damageCount;
  if ("ticketsOverride" in fields) patch.tickets_override = fields.ticketsOverride;
  if ("note" in fields) patch.note = fields.note || null;
  if ("paidAt" in fields) patch.paid_at = fields.paidAt;
  if ("paidBy" in fields) patch.paid_by = fields.paidBy;
  if ("paidByName" in fields) patch.paid_by_name = fields.paidByName;
  const { data, error } = await supabase
    .from("branch_commission_branch_period")
    .upsert(patch, { onConflict: "company_id,branch_key,period_start,period_end" })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}
