import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase/client", () => ({ supabase: {} }));

import { resolveAdjustmentLines, sumPayrollAdjustments } from "./supabase/payrollAdjustments";

describe("office withholding taxes", () => {
  it("preserves four fixed withholding amounts when gross changes", () => {
    const lines = [
      { kind: "tax" as const, description: "MCWH", amount: 24.39, percent: null },
      { kind: "tax" as const, description: "SSWH", amount: 104.27, percent: null },
      { kind: "tax" as const, description: "FITW", amount: 153.99, percent: null },
      { kind: "tax" as const, description: "SITW", amount: 61.34, percent: null },
    ];
    expect(resolveAdjustmentLines(lines, 3000)).toEqual(lines);
    expect(sumPayrollAdjustments(lines, 2235.99)).toEqual({
      reimbursements: 0, deductions: 0, tax: 343.99, net: -343.99,
    });
    expect(2235.99 + sumPayrollAdjustments(lines, 2235.99).net).toBeCloseTo(1892, 2);
  });

  it("continues to recalculate percentage taxes alongside fixed taxes", () => {
    const lines = [
      { kind: "tax" as const, description: "MCWH", amount: 10, percent: null },
      { kind: "tax" as const, description: "FITW", amount: 0, percent: 5 },
    ];
    expect(resolveAdjustmentLines(lines, 2000).map((line) => line.amount)).toEqual([10, 100]);
    expect(sumPayrollAdjustments(lines, 2000).net).toBe(-110);
  });
});
