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

const COLUMNS = "id, profile_id, period_start, period_end, branch, regular_pay, ot_pay, bonus, commission, pto_pay, deduction, mileage_other_reimb, pretax_insurance, salary_match, source, updated_by_name, updated_at, technician:profiles!payroll_review_breakdowns_profile_id_fkey(display_name)";

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

export async function getPayrollReviewBreakdowns(periodStart: string, periodEnd: string): Promise<PayrollReviewBreakdown[]> {
  const { data, error } = await supabase
    .from("payroll_review_breakdowns")
    .select(COLUMNS)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(friendly(error.message));
  return (data ?? []).map(mapRow);
}

/** Every pay period that has at least one row, newest first — the tab's period dropdown. */
export async function getPayrollReviewPeriods(): Promise<{ periodStart: string; periodEnd: string; count: number }[]> {
  // Paged: one answer stops at 1,000 rows, which would drop the oldest periods.
  const PAGE = 1000;
  const rows: { period_start: string; period_end: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("payroll_review_breakdowns")
      .select("period_start, period_end")
      .order("period_start", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(friendly(error.message));
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE) break;
  }
  const byKey = new Map<string, { periodStart: string; periodEnd: string; count: number }>();
  for (const r of rows) {
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
  opts: { branch: string | null; source: "review" | "manual"; updatedBy: string | null; updatedByName: string | null }
): Promise<void> {
  const { error } = await supabase.from("payroll_review_breakdowns").upsert(
    {
      profile_id: profileId,
      period_start: periodStart,
      period_end: periodEnd,
      branch: opts.branch,
      source: opts.source,
      updated_by: opts.updatedBy,
      updated_by_name: opts.updatedByName,
      ...toColumns(amounts),
    },
    { onConflict: "company_id,profile_id,period_start,period_end" }
  );
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
