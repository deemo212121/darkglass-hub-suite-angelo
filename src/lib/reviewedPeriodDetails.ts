import { cents } from "./payRounding";
import type { PayrollReviewAmounts } from "./supabase/payrollReviewBreakdowns";

export interface ReviewedPeriodDetailSource {
  mileage: number;
  items: { label: string; value: number; rate: number; isWageIncludable: boolean }[];
}

export interface ReviewedPeriodDetail {
  key: string;
  label: string;
  group: "mileageOtherReimb" | "deduction" | "pretaxInsurance";
  amount: number;
}

/** Keep saved summary totals authoritative, exposing any unmatched amount explicitly.
 * A negative adjustment reverses part of the corresponding group, rather than
 * silently attributing a manual change to mileage, phone allowance, or another item.
 */
export function reviewedPeriodDetails(saved: PayrollReviewAmounts, source?: ReviewedPeriodDetailSource): ReviewedPeriodDetail[] {
  const lines = new Map<string, ReviewedPeriodDetail>();
  const add = (group: ReviewedPeriodDetail["group"], label: string, amount: number) => {
    const clean = label.trim().replace(/\s+/g, " ");
    const key = `${group}:${clean.toLowerCase()}`;
    const existing = lines.get(key);
    if (existing) existing.amount += amount;
    else lines.set(key, { key, label: clean, group, amount });
  };
  if (source) {
    add("mileageOtherReimb", "Mileage", source.mileage);
    for (const item of source.items) {
      if (item.isWageIncludable) continue;
      const amount = item.value * item.rate;
      if (!Number.isFinite(amount) || !amount) continue;
      const group = amount < 0 ? (/insur|pre-?tax/i.test(item.label) ? "pretaxInsurance" : "deduction") : "mileageOtherReimb";
      add(group, item.label || (amount < 0 ? "Deduction" : "Reimbursement"), Math.abs(amount));
    }
  }
  for (const line of lines.values()) line.amount = cents(line.amount);
  for (const group of ["mileageOtherReimb", "deduction", "pretaxInsurance"] as const) {
    const itemized = [...lines.values()].filter((l) => l.group === group).reduce((sum, l) => sum + l.amount, 0);
    const difference = cents(cents(saved[group]) - itemized);
    if (difference) {
      const label = group === "mileageOtherReimb" ? "Unitemized reimbursement adjustment" : group === "deduction" ? "Unitemized deduction adjustment" : "Unitemized pre-tax insurance adjustment";
      lines.set(`${group}:unitemized`, { key: `${group}:unitemized`, label, group, amount: difference });
    }
  }
  return [...lines.values()].filter((l) => l.amount !== 0);
}

/** Excel column letters, including AA and beyond for itemized exports. */
export function excelColumnLetter(index: number): string {
  let result = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
