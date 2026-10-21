/**
 * Pay is rounded the way Finance's payroll summary does it: each summary
 * column to the cent first, then the columns added up (2026-10-21). Rounding
 * only the final total let fractions of a cent from different columns add
 * up to a cent the summary doesn't have — Joshua Malloch 9/27–10/10:
 * Regular $554.9734 + OT $186.0537 + $1,582.35 = $2,323.377 → $2,323.38
 * on the Tech Activity Report vs $2,323.37 on the summary, Payroll History
 * and his payslip. Used by the Tech Activity Report's Total Payment and the
 * Accounting Dashboard's gross pay, so both always land on the same cent.
 */
import type { PayrollReviewAmounts } from "@/lib/supabase/payrollReviewBreakdowns";

/** Round to the cent; the tiny nudge keeps 0.125 from landing on 0.12 through float error. */
export function cents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
}

/** Total of the summary columns, each rounded to the cent first: earnings + reimbursements − deductions − pre-tax insurance. */
export function centsSummaryTotal(a: PayrollReviewAmounts): number {
  return cents(
    cents(a.regularPay) + cents(a.otPay) + cents(a.bonus) + cents(a.commission) + cents(a.ptoPay) +
      cents(a.mileageOtherReimb) + cents(a.salaryMatch) - cents(a.deduction) - cents(a.pretaxInsurance)
  );
}

const BONUS_LINE = /ltp|bonus|performance|incentive|flash tech allowance/i;
const INSURANCE_LINE = /insur|pre-?tax/i;

/**
 * A technician's custom pay lines split into the summary columns — same
 * rules as the Tech Activity Report's Reviewed Periods breakdown: includable
 * lines are Bonus (by label) or Commission; non-includable negatives are
 * Pre-Tax Insurance (by label) or Deduction (as positive numbers);
 * non-includable positives are reimbursements.
 */
export function groupCustomPayLines(items: { label: string; value: number; rate: number; isWageIncludable: boolean }[]): {
  bonus: number;
  commission: number;
  reimbursement: number;
  deduction: number;
  pretaxInsurance: number;
} {
  const out = { bonus: 0, commission: 0, reimbursement: 0, deduction: 0, pretaxInsurance: 0 };
  for (const item of items) {
    const amount = item.value * item.rate;
    if (item.isWageIncludable) {
      if (BONUS_LINE.test(item.label)) out.bonus += amount;
      else out.commission += amount;
    } else if (amount < 0) {
      if (INSURANCE_LINE.test(item.label)) out.pretaxInsurance += -amount;
      else out.deduction += -amount;
    } else {
      out.reimbursement += amount;
    }
  }
  return out;
}
