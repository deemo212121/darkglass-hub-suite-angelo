import { describe, expect, it } from "vitest";
import { branchExpenseCategoryText, buildBranchReport } from "./branchExpenses";

describe("buildBranchReport", () => {
  it("totals each category per branch, plus an all-branches row", () => {
    const { branches, total } = buildBranchReport([
      { branch: "Dallas", category: "utility", amount: 120.1 },
      { branch: "Dallas", category: "utility", amount: 80.2 },
      { branch: "Dallas", category: "lease", amount: 2500 },
      { branch: "Austin", category: "internet", amount: 89.99 },
    ]);
    const dallas = branches.find((b) => b.branch === "Dallas")!;
    expect(dallas.byCategory.utility).toBe(200.3);
    expect(dallas.byCategory.lease).toBe(2500);
    expect(dallas.total).toBe(2700.3);
    expect(dallas.count).toBe(3);
    expect(total.byCategory.internet).toBe(89.99);
    expect(total.total).toBe(2790.29);
    expect(total.count).toBe(4);
  });
});

describe("branchExpenseCategoryText", () => {
  it("names Other by its own label", () => {
    expect(branchExpenseCategoryText({ category: "lease", otherLabel: "" })).toBe("Lease");
    expect(branchExpenseCategoryText({ category: "other", otherLabel: "Pest control" })).toBe("Other — Pest control");
  });
});
