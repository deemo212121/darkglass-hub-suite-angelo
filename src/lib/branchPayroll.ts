/**
 * Overall Expenses → the three payroll lines filled from the generated
 * payroll runs (Accounting Dashboard → Generate payroll): each person's
 * Grand Total for a pay period (gross pay + Extra — not net, so
 * reimbursements and deductions aren't counted here), under their branch:
 *
 *   Technicians → Tech Payroll · US office staff → US Office Payroll ·
 *   Philippines staff → PH Office Payroll (Mexico has no line).
 *
 * A pay period counts in the month it ENDS in (it's paid after it ends), so a
 * period that crosses months (Oct 26 – Nov 8) lands once, in November —
 * never in both. One row per pay period. Every person's pay is saved with
 * the bill (its line items), so the same payslip is never counted twice.
 * Pure — the form loads the runs and hands them in.
 */

import type { BranchExpenseCategory, BranchExpenseLine } from "./branchExpenses";

export type PayrollGroup = "TECH" | "US" | "PH" | "MX";
export type PayrollCategory = Extract<BranchExpenseCategory, "tech_payroll" | "us_office_payroll" | "ph_office_payroll">;
export const PAYROLL_FILL_CATEGORIES: PayrollCategory[] = ["tech_payroll", "us_office_payroll", "ph_office_payroll"];

export const payrollCategoryOf = (g: PayrollGroup): PayrollCategory | null =>
  g === "TECH" ? "tech_payroll" : g === "US" ? "us_office_payroll" : g === "PH" ? "ph_office_payroll" : null;

export interface PayrollPay {
  /** payroll_line_items.id */
  id: string;
  periodStart: string;
  periodEnd: string;
  profileId: string;
  name: string;
  branch: string;
  group: PayrollGroup;
  /** Grand Total: gross pay + Extra (USD). */
  amount: number;
}

export interface PayrollPeriodFill {
  start: string;
  end: string;
  total: number;
  pays: PayrollPay[];
}

const cents = (n: number) => Math.round(n * 100) / 100;
export const payrollSourceId = (p: Pick<PayrollPay, "id">) => `payroll:${p.id}`;

/** Each payroll line's pay periods for one branch and month — periods ending in that month, oldest first. */
export function buildPayrollFill(
  pays: PayrollPay[],
  branch: string,
  month: string,
  usedIds: Set<string>,
): Record<PayrollCategory, PayrollPeriodFill[]> {
  const out: Record<PayrollCategory, PayrollPeriodFill[]> = { tech_payroll: [], us_office_payroll: [], ph_office_payroll: [] };
  const want = branch.trim().toLowerCase();
  for (const p of pays) {
    const cat = payrollCategoryOf(p.group);
    if (!cat || !(p.amount > 0) || p.periodEnd.slice(0, 7) !== month) continue;
    if (p.branch.trim().toLowerCase() !== want || usedIds.has(payrollSourceId(p))) continue;
    let period = out[cat].find((x) => x.start === p.periodStart && x.end === p.periodEnd);
    if (!period) { period = { start: p.periodStart, end: p.periodEnd, total: 0, pays: [] }; out[cat].push(period); }
    period.pays.push(p);
    period.total = cents(period.total + p.amount);
  }
  for (const c of PAYROLL_FILL_CATEGORIES) {
    out[c].sort((a, b) => a.start.localeCompare(b.start));
    for (const x of out[c]) x.pays.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

/** One person's pay as a line of the bill — shown when the line is opened. */
export function payrollBillLine(p: PayrollPay): BranchExpenseLine {
  return {
    date: p.periodEnd,
    time: "",
    driver: p.name,
    vehicle: "",
    service: "Gross pay + Extra",
    merchant: `Pay period ${p.periodStart} – ${p.periodEnd}`,
    address: "",
    amount: p.amount,
    sourceId: payrollSourceId(p),
  };
}

export const payrollNote = (x: Pick<PayrollPeriodFill, "pays">) => `From payroll: ${x.pays.length} ${x.pays.length === 1 ? "person" : "people"}`;
