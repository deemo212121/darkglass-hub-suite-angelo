/**
 * Accounting → Expenses → Other Expenses: a branch's own running costs
 * (Utility, Lease, Internet, Phone, Other), one row per bill (migration
 * 0444), and the per-branch report — each category in its own column.
 */

export type BranchExpenseCategory = "utility" | "lease" | "internet" | "phone" | "other";

export const BRANCH_EXPENSE_CATEGORIES: BranchExpenseCategory[] = ["utility", "lease", "internet", "phone", "other"];

export const BRANCH_EXPENSE_LABEL: Record<BranchExpenseCategory, string> = {
  utility: "Utility",
  lease: "Lease",
  internet: "Internet",
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
  /** Only for "other" — what it is. */
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

/** "Utility", or the Other expense's own label ("Other — Pest control"). */
export function branchExpenseCategoryText(e: Pick<BranchExpense, "category" | "otherLabel">): string {
  return e.category === "other" && e.otherLabel.trim() ? `Other — ${e.otherLabel.trim()}` : BRANCH_EXPENSE_LABEL[e.category];
}

export interface BranchReportRow {
  branch: string;
  byCategory: Record<BranchExpenseCategory, number>;
  total: number;
  count: number;
}

const zeroes = (): Record<BranchExpenseCategory, number> => ({ utility: 0, lease: 0, internet: 0, phone: 0, other: 0 });
const cents = (n: number) => Math.round(n * 100) / 100;

/** One row per branch with each category's total, plus the all-branches total row. */
export function buildBranchReport(rows: Pick<BranchExpense, "branch" | "category" | "amount">[]): { branches: BranchReportRow[]; total: BranchReportRow } {
  const map = new Map<string, BranchReportRow>();
  const total: BranchReportRow = { branch: "All branches", byCategory: zeroes(), total: 0, count: 0 };
  for (const r of rows) {
    const b = map.get(r.branch) ?? { branch: r.branch, byCategory: zeroes(), total: 0, count: 0 };
    b.byCategory[r.category] = cents(b.byCategory[r.category] + r.amount);
    b.total = cents(b.total + r.amount);
    b.count++;
    map.set(r.branch, b);
    total.byCategory[r.category] = cents(total.byCategory[r.category] + r.amount);
    total.total = cents(total.total + r.amount);
    total.count++;
  }
  return { branches: Array.from(map.values()), total };
}
