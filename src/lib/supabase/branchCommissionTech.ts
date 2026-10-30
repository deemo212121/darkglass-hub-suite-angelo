/**
 * Branch Commission, per technician (migration 0417). Finance types each
 * technician's Completion % / LTP % / completed tickets for a pay period and
 * can mark them as a trainee for it. A branch's numbers come from its
 * non-trainee technicians (rollUpBranch) and feed the same Condition policy
 * (branchManagerCommission.ts resolveCommissionTier) for whoever manages it.
 */
import { supabase } from "./client";

export interface TechCommissionRow {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  completionPct: number;
  ltpPct: number;
  completedTickets: number;
  isTrainee: boolean;
  updatedAt: string;
}

const COLUMNS = "id, profile_id, period_start, period_end, completion_pct, ltp_pct, completed_tickets, is_trainee, updated_at";

function mapRow(row: any): TechCommissionRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    completionPct: Number(row.completion_pct) || 0,
    ltpPct: Number(row.ltp_pct) || 0,
    completedTickets: Number(row.completed_tickets) || 0,
    isTrainee: !!row.is_trainee,
    updatedAt: row.updated_at,
  };
}

/** True when migration 0417 hasn't been run — the tab says so. */
export function isTechTallyMissingError(message: string): boolean {
  return /branch_commission_tech_tally|does not exist|schema cache/i.test(message);
}

/** Every technician row for one period. Throws so the tab can show a missing-migration note. */
export async function getTechCommissionTally(periodStart: string, periodEnd: string): Promise<TechCommissionRow[]> {
  const { data, error } = await supabase
    .from("branch_commission_tech_tally")
    .select(COLUMNS)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** Every technician row whose period falls inside [rangeStart, rangeEnd] — the Trend chart. */
export async function getTechCommissionTallyInRange(rangeStart: string, rangeEnd: string): Promise<TechCommissionRow[]> {
  const { data, error } = await supabase
    .from("branch_commission_tech_tally")
    .select(COLUMNS)
    .gte("period_start", rangeStart)
    .lte("period_end", rangeEnd)
    .order("period_start", { ascending: true });
  if (error) {
    console.error("getTechCommissionTallyInRange error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

export type TechCommissionFields = Partial<Pick<TechCommissionRow, "completionPct" | "ltpPct" | "completedTickets" | "isTrainee">>;

/** Create-or-update one technician's row for one period; returns the row id. */
export async function upsertTechCommissionTally(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  fields: TechCommissionFields
): Promise<string> {
  const patch: Record<string, unknown> = { profile_id: profileId, period_start: periodStart, period_end: periodEnd };
  if ("completionPct" in fields) patch.completion_pct = fields.completionPct;
  if ("ltpPct" in fields) patch.ltp_pct = fields.ltpPct;
  if ("completedTickets" in fields) patch.completed_tickets = fields.completedTickets;
  if ("isTrainee" in fields) patch.is_trainee = fields.isTrainee;
  const { data, error } = await supabase
    .from("branch_commission_tech_tally")
    .upsert(patch, { onConflict: "company_id,profile_id,period_start,period_end" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export interface BranchRollUp {
  completionPct: number;
  ltpPct: number;
  completedTickets: number;
  /** Non-trainee technicians counted. */
  counted: number;
  trainees: number;
}

/**
 * A branch's numbers from its technicians: trainees left out, tickets summed,
 * Completion % / LTP % averaged weighted by each tech's tickets (a plain
 * average when nobody has tickets yet).
 */
export function rollUpBranch(techs: { completionPct: number; ltpPct: number; completedTickets: number; isTrainee: boolean }[]): BranchRollUp {
  const counted = techs.filter((t) => !t.isTrainee);
  const trainees = techs.length - counted.length;
  const completedTickets = counted.reduce((sum, t) => sum + t.completedTickets, 0);
  if (counted.length === 0) return { completionPct: 0, ltpPct: 0, completedTickets: 0, counted: 0, trainees };
  const weight = (t: (typeof counted)[number]) => (completedTickets > 0 ? t.completedTickets : 1);
  const totalWeight = counted.reduce((sum, t) => sum + weight(t), 0);
  const avg = (pick: (t: (typeof counted)[number]) => number) =>
    Math.round((counted.reduce((sum, t) => sum + pick(t) * weight(t), 0) / totalWeight) * 10) / 10;
  return { completionPct: avg((t) => t.completionPct), ltpPct: avg((t) => t.ltpPct), completedTickets, counted: counted.length, trainees };
}
