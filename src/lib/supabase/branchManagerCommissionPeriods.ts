/**
 * Branch Commission periods (migration 0290) — the named, browsable
 * cut-off registry sitting above branchManagerCommission.ts's per-person
 * tally rows. A period is just a company-wide (start, end) date range
 * with an optional label (e.g. "Sept Cutoff 1") — this module is the
 * History list source and the save for that label.
 */
import { supabase } from "./client";

export interface CommissionPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  label: string | null;
  updatedAt: string;
}

function mapRow(row: any): CommissionPeriod {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    label: row.label ?? null,
    updatedAt: row.updated_at,
  };
}

/** Every saved period (RLS-scoped), newest first — this is the History list. */
export async function getCommissionPeriods(): Promise<CommissionPeriod[]> {
  const { data, error } = await supabase
    .from("branch_manager_commission_periods")
    .select("id, period_start, period_end, label, updated_at")
    .order("period_start", { ascending: false });
  if (error) {
    console.error("getCommissionPeriods error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Create-or-rename the period covering this exact date range. Returns the saved row's id, for activity-log targetId. */
export async function upsertCommissionPeriodLabel(periodStart: string, periodEnd: string, label: string): Promise<string> {
  const { data, error } = await supabase
    .from("branch_manager_commission_periods")
    .upsert({ period_start: periodStart, period_end: periodEnd, label: label || null }, { onConflict: "company_id,period_start,period_end" })
    .select("id")
    .single();
  if (error) {
    console.error("upsertCommissionPeriodLabel error:", error.message);
    throw new Error(error.message);
  }
  return data.id;
}
