import type { PayrollReviewAmounts } from "./supabase/payrollReviewBreakdowns";
import { cents, centsSummaryTotal } from "./payRounding";

/** Sync only a complete breakdown that agrees with the actual payroll gross. */
export function reviewedPeriodSyncAmounts(saved: PayrollReviewAmounts, live: PayrollReviewAmounts | undefined, gross: number | undefined): PayrollReviewAmounts | null {
  if (!live || gross == null || !Number.isFinite(gross)) return null;
  const keys = Object.keys(saved).filter((key) => key in live) as (keyof PayrollReviewAmounts)[];
  const fields: (keyof PayrollReviewAmounts)[] = ["regularPay", "otPay", "bonus", "commission", "ptoPay", "deduction", "mileageOtherReimb", "pretaxInsurance", "salaryMatch"];
  if (fields.some((key) => !keys.includes(key) || !Number.isFinite(live[key]))) return null;
  const rounded = Object.fromEntries(fields.map((key) => [key, cents(live[key])])) as unknown as PayrollReviewAmounts;
  if (cents(centsSummaryTotal(rounded) - gross) !== 0) return null;
  return fields.some((key) => cents(saved[key]) !== rounded[key]) ? rounded : null;
}
