/**
 * Accounting → Expenses → Other Expenses: a branch's own costs, one row per
 * bill (migrations 0444 / 0445), and the per-branch report. The categories
 * are Accounting's branch sheet columns, in its order:
 *
 *   Lease · Auto Insurance / Payment · Internet · Utility
 *   Flash Tech Travel / Lodging · Flash Tech Food Reimbursement · Rental Car
 *   CarIQ Transactions · CarIQ Mileage Reimbursement ($0.20)
 *   NON CarIQ Mileage Reimbursement ($0.50) · Gas
 *   Equipment / Office Supplies · Field Equipment · Operation
 *   Tech Payroll · US Office Payroll · PH Office Payroll
 *   → Payroll Total · EXP TOTAL (everything that isn't payroll) · TOTAL
 *
 * CarIQ Transactions can be filled from Car IQ's transaction report
 * (Import Car IQ — lib/carIqImport.ts).
 *
 * "phone" / "other" are from the first version of the page — still read
 * (counted in EXP TOTAL) but no longer offered.
 */

export type BranchExpenseCategory =
  | "lease"
  | "auto_insurance"
  | "internet"
  | "utility"
  | "travel_lodging"
  | "food"
  | "rental_car"
  | "cariq_transactions"
  | "cariq_mileage"
  | "non_cariq_mileage"
  | "gas"
  | "equipment_supplies"
  | "field_equipment"
  | "operation"
  | "tech_payroll"
  | "us_office_payroll"
  | "ph_office_payroll"
  | "phone"
  | "other";

/** Offered in Add Expense and shown as report columns — the sheet's order. */
export const BRANCH_EXPENSE_CATEGORIES: BranchExpenseCategory[] = [
  "lease",
  "auto_insurance",
  "internet",
  "utility",
  "travel_lodging",
  "food",
  "rental_car",
  "cariq_transactions",
  "cariq_mileage",
  "non_cariq_mileage",
  "gas",
  "equipment_supplies",
  "field_equipment",
  "operation",
  "tech_payroll",
  "us_office_payroll",
  "ph_office_payroll",
];

/** First-version categories — kept readable, not offered. */
export const LEGACY_BRANCH_EXPENSE_CATEGORIES: BranchExpenseCategory[] = ["phone", "other"];

export const ALL_BRANCH_EXPENSE_CATEGORIES: BranchExpenseCategory[] = [...BRANCH_EXPENSE_CATEGORIES, ...LEGACY_BRANCH_EXPENSE_CATEGORIES];

export const PAYROLL_CATEGORIES = new Set<BranchExpenseCategory>(["tech_payroll", "us_office_payroll", "ph_office_payroll"]);

export const BRANCH_EXPENSE_LABEL: Record<BranchExpenseCategory, string> = {
  lease: "Lease",
  auto_insurance: "Auto Insurance / Payment",
  internet: "Internet",
  utility: "Utility",
  travel_lodging: "Flash Tech Travel / Lodging",
  food: "Flash Tech Food Reimbursement",
  rental_car: "Rental Car",
  cariq_transactions: "CarIQ Transactions",
  cariq_mileage: "CarIQ Mileage Reimbursement ($0.20)",
  non_cariq_mileage: "NON CarIQ Mileage Reimbursement ($0.50)",
  gas: "Gas",
  equipment_supplies: "Equipment / Office Supplies",
  field_equipment: "Field Equipment",
  operation: "Operation",
  tech_payroll: "Tech Payroll",
  us_office_payroll: "US Office Payroll",
  ph_office_payroll: "PH Office Payroll",
  phone: "Phone",
  other: "Other",
};

export interface BranchExpenseFile {
  url: string;
  path: string;
  name: string;
}

export interface BranchExpense {
  id: string;
  branch: string;
  category: BranchExpenseCategory;
  /** Only for the old "other" — what it was. */
  otherLabel: string;
  vendor: string;
  amount: number;
  /** Bill date, "YYYY-MM-DD". */
  expenseDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string;
  receipts: BranchExpenseFile[];
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
}

/** "Lease", or an old Other expense's own label ("Other — Pest control"). */
export function branchExpenseCategoryText(e: Pick<BranchExpense, "category" | "otherLabel">): string {
  return e.category === "other" && e.otherLabel.trim() ? `Other — ${e.otherLabel.trim()}` : BRANCH_EXPENSE_LABEL[e.category] ?? e.category;
}

export interface BranchReportRow {
  branch: string;
  byCategory: Record<BranchExpenseCategory, number>;
  /** Tech + US Office + PH Office payroll. */
  payrollTotal: number;
  /** Everything that isn't payroll (the sheet's EXP TOTAL). */
  expenseTotal: number;
  /** Payroll Total + EXP TOTAL. */
  total: number;
  count: number;
}

const zeroes = () => Object.fromEntries(ALL_BRANCH_EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<BranchExpenseCategory, number>;
const cents = (n: number) => Math.round(n * 100) / 100;
const emptyRow = (branch: string): BranchReportRow => ({ branch, byCategory: zeroes(), payrollTotal: 0, expenseTotal: 0, total: 0, count: 0 });

function add(row: BranchReportRow, category: BranchExpenseCategory, amount: number) {
  row.byCategory[category] = cents((row.byCategory[category] ?? 0) + amount);
  if (PAYROLL_CATEGORIES.has(category)) row.payrollTotal = cents(row.payrollTotal + amount);
  else row.expenseTotal = cents(row.expenseTotal + amount);
  row.total = cents(row.total + amount);
  row.count++;
}

/** One row per branch with each category's total, Payroll Total, EXP TOTAL and TOTAL, plus the all-branches row. */
export function buildBranchReport(rows: Pick<BranchExpense, "branch" | "category" | "amount">[]): { branches: BranchReportRow[]; total: BranchReportRow } {
  const map = new Map<string, BranchReportRow>();
  const total = emptyRow("All branches");
  for (const r of rows) {
    const b = map.get(r.branch) ?? emptyRow(r.branch);
    add(b, r.category, r.amount);
    map.set(r.branch, b);
    add(total, r.category, r.amount);
  }
  return { branches: Array.from(map.values()), total };
}
