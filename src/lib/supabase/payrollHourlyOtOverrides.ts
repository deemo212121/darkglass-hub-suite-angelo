/**
 * Per-technician, per-period override of the flat company-rate Hourly + OT
 * figure with the State-matched amount from the payroll detail step's
 * Compliant/"State" toggle (EmployeePayrollDetailModal). Set when Finance
 * clicks Next on the detail step with "State" selected; cleared when Next
 * is clicked with "Company" selected instead. See migration 0289.
 */
import { supabase } from "./client";

export interface HourlyOtOverride {
  amount: number;
  /** The Regular $ part of amount (migration 0400) — lets gross pay round Regular $ and OT $ separately, like the Tech Activity Report. Null when not known yet. */
  regularAmount: number | null;
  setByName: string | null;
  setAt: string;
}

/** True when regular_amount (migration 0400) doesn't exist yet — callers retry without it. */
const missingRegularAmount = (message: string) => /regular_amount/i.test(message);

/** profile_id -> override, for one pay period. */
export async function getHourlyOtOverrides(periodStart: string, periodEnd: string): Promise<Map<string, HourlyOtOverride>> {
  const query = (columns: string) =>
    supabase.from("payroll_hourly_ot_overrides").select(columns).eq("period_start", periodStart).eq("period_end", periodEnd);
  let { data, error } = await query("profile_id, amount, regular_amount, set_by_name, set_at");
  if (error && missingRegularAmount(error.message)) ({ data, error } = await query("profile_id, amount, set_by_name, set_at"));
  if (error) throw new Error(error.message);
  const out = new Map<string, HourlyOtOverride>();
  for (const r of (data ?? []) as unknown as Array<{ profile_id: string; amount: number; regular_amount?: number | null; set_by_name: string | null; set_at: string }>) {
    out.set(r.profile_id, {
      amount: Number(r.amount),
      regularAmount: r.regular_amount != null ? Number(r.regular_amount) : null,
      setByName: r.set_by_name,
      setAt: r.set_at,
    });
  }
  return out;
}

/** Save the State total — and its Regular $ part when known (null clears a stale one from an earlier total). */
export async function setHourlyOtOverride(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  amount: number,
  setByName: string | null,
  regularAmount: number | null = null,
): Promise<void> {
  const row = { profile_id: profileId, period_start: periodStart, period_end: periodEnd, amount, set_by_name: setByName };
  const upsert = (r: Record<string, unknown>) =>
    supabase.from("payroll_hourly_ot_overrides").upsert(r, { onConflict: "company_id,profile_id,period_start,period_end" });
  let { error } = await upsert({ ...row, regular_amount: regularAmount });
  if (error && missingRegularAmount(error.message)) ({ error } = await upsert(row));
  if (error) throw new Error(error.message);
}

/** Fill in just the Regular $ part of an existing override (the Tech Activity Report does this on open). No-op before migration 0400. */
export async function setHourlyOtOverrideRegularAmount(profileId: string, periodStart: string, periodEnd: string, regularAmount: number): Promise<void> {
  const { error } = await supabase
    .from("payroll_hourly_ot_overrides")
    .update({ regular_amount: regularAmount })
    .eq("profile_id", profileId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error && !missingRegularAmount(error.message)) throw new Error(error.message);
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
