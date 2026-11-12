import { describe, expect, it } from "vitest";
import { BRANCH_EXPENSE_CATEGORIES, BRANCH_EXPENSE_LABEL, branchExpenseCategoryText, buildBranchReport } from "./branchExpenses";

describe("categories", () => {
  it("are Accounting's branch sheet columns, in its order", () => {
    expect(BRANCH_EXPENSE_CATEGORIES.map((c) => BRANCH_EXPENSE_LABEL[c])).toEqual([
      "Lease", "Auto Insurance / Payment", "Internet", "Utility", "Travel / Lodging", "Food", "Rental Car",
      "Gas", "Equipment / Office Supplies", "Operation", "Tech Payroll", "US Office Payroll", "PH Office Payroll",
    ]);
  });
});

describe("buildBranchReport", () => {
  it("totals each category per branch, with Payroll Total, EXP TOTAL and TOTAL", () => {
    const { branches, total } = buildBranchReport([
      { branch: "Atlanta", category: "utility", amount: 120.1 },
      { branch: "Atlanta", category: "utility", amount: 80.2 },
      { branch: "Atlanta", category: "lease", amount: 2500 },
      { branch: "Atlanta", category: "tech_payroll", amount: 10000 },
      { branch: "Atlanta", category: "us_office_payroll", amount: 3000.5 },
      { branch: "Mobile", category: "internet", amount: 89.99 },
    ]);
    const atl = branches.find((b) => b.branch === "Atlanta")!;
    expect(atl.byCategory.utility).toBe(200.3);
    expect(atl.expenseTotal).toBe(2700.3);
    expect(atl.payrollTotal).toBe(13000.5);
    expect(atl.total).toBe(15700.8);
    expect(atl.count).toBe(5);
    expect(total.expenseTotal).toBe(2790.29);
    expect(total.total).toBe(15790.79);
  });
});

describe("branchExpenseCategoryText", () => {
  it("names an old Other expense by its own label", () => {
    expect(branchExpenseCategoryText({ category: "gas", otherLabel: "" })).toBe("Gas");
    expect(branchExpenseCategoryText({ category: "other", otherLabel: "Pest control" })).toBe("Other — Pest control");
  });
});
