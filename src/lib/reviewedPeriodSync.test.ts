import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { reviewedPeriodSyncAmounts } from "./reviewedPeriodSync";
const actual = { regularPay: 268.55, otPay: 0, bonus: 0, commission: -25, ptoPay: 0,
  deduction: 0, mileageOtherReimb: 185.9, pretaxInsurance: 34.65, salaryMatch: 0 };

describe("reviewed payroll synchronization", () => {
  it("compiles the reviewed-period screen without conflicting declarations", () => {
    const source = readFileSync(new URL("../components/ReviewedPeriodsTab.tsx", import.meta.url), "utf8");
    expect(() => parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] })).not.toThrow();
  });
  it("removes Abraham's stale $3 deduction using the real breakdown without changing gross", () => {
    expect(reviewedPeriodSyncAmounts({ ...actual, deduction: 3 }, actual, 394.8)).toEqual(actual);
  });
  it("does not write again when amounts already match", () => {
    expect(reviewedPeriodSyncAmounts(actual, actual, 394.8)).toBeNull();
  });
  it("waits for a complete breakdown that reconciles to actual gross", () => {
    expect(reviewedPeriodSyncAmounts(actual, undefined, 394.8)).toBeNull();
    expect(reviewedPeriodSyncAmounts(actual, actual, undefined)).toBeNull();
    expect(reviewedPeriodSyncAmounts(actual, { ...actual, deduction: 3 }, 394.8)).toBeNull();
    expect(reviewedPeriodSyncAmounts(actual, { ...actual, regularPay: NaN }, 394.8)).toBeNull();
  });
  it("preserves signed commission and rounds columns consistently", () => {
    const live = { ...actual, commission: -25.004, regularPay: 268.554 };
    expect(reviewedPeriodSyncAmounts({ ...actual, commission: 0 }, live, 394.8)).toEqual(actual);
  });
});
