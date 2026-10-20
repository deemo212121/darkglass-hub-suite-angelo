/**
 * Finance's per-technician payroll summary for one pay period — the
 * Accounting Dashboard's "Reviewed Periods" tab (migration 0392).
 * Snapshotted from the Tech Activity Report when Finance clicks Done
 * (source "review"), editable afterwards, or added by hand ("manual").
 */
import { supabase } from "./client";

export interface PayrollReviewAmounts {
  /** Regular hours pay, incl. the state regular-hours match (plus trainee / holiday top-ups). */
  regularPay: number;
  /** OT hours at straight time + OT premium + state OT match. */
  otPay: number;
  /** LTP, Performance, OW Incentive and other bonus lines. */
  bonus: number;
  /** Ticket / piece-rate pay: Minor, Carryover, SQT, 2 Man, Redo, Seal, etc. */
  commission: number;
  ptoPay: number;
  /** Positive number, subtracted. */
  deduction: number;
  /** Mileage + other reimbursements (incl. Flash Tech mileage). */
  mileageOtherReimb: number;
  /** Positive number, subtracted. */
  pretaxInsurance: number;
  salaryMatch: number;
}

export interface PayrollReviewBreakdown extends PayrollReviewAmounts {
  id: string;
  profileId: string;
  /** The technician's display name from their profile (joined on read). */
  technicianName: string | null;
  periodStart: string;
  periodEnd: string;
  branch: string | null;
  source: "review" | "manual";
  updatedByName: string | null;
  updatedAt: string;
  /** Snapshotted at Done (migration 0395); null for older/manual rows or before the migration. */
  regularHours: number | null;
  otHours: number | null;
}

export const REVIEW_AMOUNT_FIELDS: { key: keyof PayrollReviewAmounts; column: string }[] = [
  { key: "regularPay", column: "regular_pay" },
  { key: "otPay", column: "ot_pay" },
  { key: "bonus", column: "bonus" },
  { key: "commission", column: "commission" },
  { key: "ptoPay", column: "pto_pay" },
  { key: "deduction", column: "deduction" },
  { key: "mileageOtherReimb", column: "mileage_other_reimb" },
  { key: "pretaxInsurance", column: "pretax_insurance" },
  { key: "salaryMatch", column: "salary_match" },
];

/** What the row adds up to: earnings + reimbursements − deductions − pre-tax insurance. */
export function reviewBreakdownTotal(a: PayrollReviewAmounts): number {
  return a.regularPay + a.otPay + a.bonus + a.commission + a.ptoPay + a.mileageOtherReimb + a.salaryMatch - a.deduction - a.pretaxInsurance;
}

const BASE_COLUMNS = "id, profile_id, period_start, period_end, branch, regular_pay, ot_pay, bonus, commission, pto_pay, deduction, mileage_other_reimb, pretax_insurance, salary_match, source, updated_by_name, updated_at, technician:profiles!payroll_review_breakdowns_profile_id_fkey(display_name)";

const COLUMNS = `${BASE_COLUMNS}, regular_hours, ot_hours`;
/** True when the hours columns (migration 0395) don't exist yet — callers retry without them. */
const missingHours = (message: string) => /regular_hours|ot_hours/i.test(message);

const missingTable = (message: string) => /payroll_review_breakdowns/i.test(message) && /does not exist|schema cache|not find/i.test(message);
const friendly = (message: string) => (missingTable(message) ? "Reviewed Periods needs database migration 0392 — ask an admin to run it." : message);

function mapRow(r: any): PayrollReviewBreakdown {
  return {
    id: r.id,
    profileId: r.profile_id,
    technicianName: r.technician?.display_name ?? null,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    branch: r.branch ?? null,
    regularPay: Number(r.regular_pay) || 0,
    otPay: Number(r.ot_pay) || 0,
    bonus: Number(r.bonus) || 0,
    commission: Number(r.commission) || 0,
    ptoPay: Number(r.pto_pay) || 0,
    deduction: Number(r.deduction) || 0,
    mileageOtherReimb: Number(r.mileage_other_reimb) || 0,
    pretaxInsurance: Number(r.pretax_insurance) || 0,
    salaryMatch: Number(r.salary_match) || 0,
    source: r.source === "review" ? "review" : "manual",
    updatedByName: r.updated_by_name ?? null,
    updatedAt: r.updated_at,
    regularHours: r.regular_hours != null ? Number(r.regular_hours) : null,
    otHours: r.ot_hours != null ? Number(r.ot_hours) : null,
  };
}

const toColumns = (a: Partial<PayrollReviewAmounts>) => {
  const out: Record<string, number> = {};
  for (const { key, column } of REVIEW_AMOUNT_FIELDS) {
    const v = a[key];
    if (v !== undefined) out[column] = Math.round(v * 100) / 100;
  }
  return out;
};

/** Every row for a period — or just one person's when profileId is given (Self-Service). */
export async function getPayrollReviewBreakdowns(periodStart: string, periodEnd: string, profileId?: string): Promise<PayrollReviewBreakdown[]> {
  const query = (columns: string) => {
    const q = supabase.from("payroll_review_breakdowns").select(columns).eq("period_start", periodStart).eq("period_end", periodEnd);
    return profileId ? q.eq("profile_id", profileId) : q;
  };
  let { data, error } = await query(COLUMNS);
  if (error && missingHours(error.message)) ({ data, error } = await query(BASE_COLUMNS));
  if (error) throw new Error(friendly(error.message));
  return (data ?? []).map(mapRow);
}

/** Every pay period that has at least one row, newest first — the tab's period dropdown. */
export async function getPayrollReviewPeriods(): Promise<{ periodStart: string; periodEnd: string; count: number }[]> {
  const { data, error } = await supabase
    .from("payroll_review_breakdowns")
    .select("period_start, period_end")
    .order("period_start", { ascending: false })
    .limit(5000);
  if (error) throw new Error(friendly(error.message));
  const byKey = new Map<string, { periodStart: string; periodEnd: string; count: number }>();
  for (const r of (data ?? []) as { period_start: string; period_end: string }[]) {
    const key = `${r.period_start}|${r.period_end}`;
    const prev = byKey.get(key);
    if (prev) prev.count += 1;
    else byKey.set(key, { periodStart: r.period_start, periodEnd: r.period_end, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.periodStart.localeCompare(a.periodStart) || b.periodEnd.localeCompare(a.periodEnd));
}

/** Create or overwrite one technician's row for a period (Done snapshot, or Add on the tab). */
export async function upsertPayrollReviewBreakdown(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  amounts: PayrollReviewAmounts,
  opts: {
    branch: string | null;
    source: "review" | "manual";
    updatedBy: string | null;
    updatedByName: string | null;
    /** Regular / OT hours to snapshot (migration 0395) — skipped if that migration hasn't run. */
    hours?: { regular: number; ot: number };
  }
): Promise<void> {
  const row = {
    profile_id: profileId,
    period_start: periodStart,
    period_end: periodEnd,
    branch: opts.branch,
    source: opts.source,
    updated_by: opts.updatedBy,
    updated_by_name: opts.updatedByName,
    ...toColumns(amounts),
  };
  const upsert = (r: Record<string, unknown>) =>
    supabase.from("payroll_review_breakdowns").upsert(r, { onConflict: "company_id,profile_id,period_start,period_end" });
  let { error } = await upsert(
    opts.hours ? { ...row, regular_hours: Math.round(opts.hours.regular * 1000) / 1000, ot_hours: Math.round(opts.hours.ot * 1000) / 1000 } : row
  );
  if (error && opts.hours && missingHours(error.message)) ({ error } = await upsert(row));
  if (error) throw new Error(friendly(error.message));
}

/** Edit amounts on an existing row (the tab's cells). */
export async function updatePayrollReviewBreakdown(
  id: string,
  amounts: Partial<PayrollReviewAmounts>,
  updatedBy: string | null,
  updatedByName: string | null
): Promise<void> {
  const { error } = await supabase
    .from("payroll_review_breakdowns")
    .update({ ...toColumns(amounts), updated_by: updatedBy, updated_by_name: updatedByName })
    .eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

export async function deletePayrollReviewBreakdown(id: string): Promise<void> {
  const { error } = await supabase.from("payroll_review_breakdowns").delete().eq("id", id);
  if (error) throw new Error(friendly(error.message));
}
