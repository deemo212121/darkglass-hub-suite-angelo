/**
 * Per-technician, per-period override of the flat company-rate Hourly + OT
 * figure with the State-matched amount from the payroll detail step's
 * Compliant/"State" toggle (EmployeePayrollDetailModal). Set when Finance
 * clicks Next on the detail step with "State" selected; cleared when Next
 * is clicked with "Company" selected instead. See migration 0281.
 */
import { supabase } from "./client";

export interface HourlyOtOverride {
  amount: number;
  setByName: string | null;
  setAt: string;
}

/** profile_id -> override, for one pay period. */
export async function getHourlyOtOverrides(periodStart: string, periodEnd: string): Promise<Map<string, HourlyOtOverride>> {
  const { data, error } = await supabase
    .from("payroll_hourly_ot_overrides")
    .select("profile_id, amount, set_by_name, set_at")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(error.message);
  const out = new Map<string, HourlyOtOverride>();
  for (const r of (data ?? []) as Array<{ profile_id: string; amount: number; set_by_name: string | null; set_at: string }>) {
    out.set(r.profile_id, { amount: r.amount, setByName: r.set_by_name, setAt: r.set_at });
  }
  return out;
}

export async function setHourlyOtOverride(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  amount: number,
  setByName: string | null,
): Promise<void> {
  const { error } = await supabase.from("payroll_hourly_ot_overrides").upsert(
    { profile_id: profileId, period_start: periodStart, period_end: periodEnd, amount, set_by_name: setByName },
    { onConflict: "company_id,profile_id,period_start,period_end" },
  );
  if (error) throw new Error(error.message);
}

export async function clearHourlyOtOverride(profileId: string, periodStart: string, periodEnd: string): Promise<void> {
  const { error } = await supabase
    .from("payroll_hourly_ot_overrides")
    .delete()
    .eq("profile_id", profileId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(error.message);
}
