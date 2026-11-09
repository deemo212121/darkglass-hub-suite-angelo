import { describe, expect, it } from "vitest";
import { reviewedPeriodDetails, excelColumnLetter } from "./reviewedPeriodDetails";

const saved = { regularPay: 660, otPay: 844.89, bonus: 0, commission: 1035, ptoPay: 0,
  deduction: 75, mileageOtherReimb: 584.24, pretaxInsurance: 20, salaryMatch: 0 };
const item = (label: string, amount: number, isWageIncludable = false) => ({ label, value: 1, rate: amount, isWageIncludable });

describe("Reviewed Period itemized export", () => {
  it("separates mileage, phone allowance, every deduction and insurance", () => {
    const lines = reviewedPeriodDetails(saved, { mileage: 554.24, items: [
      item("Phone Allowance", 30), item("Lost Part", -50), item("Uniform Deduction", -25), item("Pre-Tax Insurance", -20), item("Bonus", 100, true),
    ] });
    expect(lines.map((l) => [l.label, l.amount])).toEqual([
      ["Mileage", 554.24], ["Phone Allowance", 30], ["Lost Part", 50], ["Uniform Deduction", 25], ["Pre-Tax Insurance", 20],
    ]);
    for (const group of ["mileageOtherReimb", "deduction", "pretaxInsurance"] as const) {
      expect(lines.filter((l) => l.group === group).reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(saved[group], 2);
    }
  });
  it("combines repeated types, while keeping opposite signs in separate groups", () => {
    const lines = reviewedPeriodDetails({ ...saved, mileageOtherReimb: 30, deduction: 5, pretaxInsurance: 0 }, { mileage: 0,
      items: [item("Phone Allowance", 10), item(" phone   allowance ", 20), item("Phone Allowance", -5)] });
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.group === "mileageOtherReimb")?.amount).toBe(30);
    expect(lines.find((l) => l.group === "deduction")?.amount).toBe(5);
  });
  it("preserves manually edited totals with explicit signed adjustments", () => {
    const lines = reviewedPeriodDetails({ ...saved, mileageOtherReimb: 25 }, { mileage: 40, items: [] });
    expect(lines.find((l) => l.key === "mileageOtherReimb:unitemized")?.amount).toBe(-15);
    expect(lines.filter((l) => l.group === "mileageOtherReimb").reduce((sum, l) => sum + l.amount, 0)).toBe(25);
  });
  it("does not invent item types for historical or manually added rows without detail", () => {
    const lines = reviewedPeriodDetails(saved);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.label.startsWith("Unitemized"))).toBe(true);
  });
  it("reconciles fractional-cent items and excludes zero amounts", () => {
    const lines = reviewedPeriodDetails({ ...saved, mileageOtherReimb: 0.01, deduction: 0, pretaxInsurance: 0 }, { mileage: 0,
      items: [item("A", .005), item("B", .005), item("Unused", 0)] });
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(.01, 8);
    expect(lines.some((l) => l.label === "Unused")).toBe(false);
  });
  it("supports Excel totals beyond column Z", () => {
    expect([1, 26, 27, 52, 53, 703].map(excelColumnLetter)).toEqual(["A", "Z", "AA", "AZ", "BA", "AAA"]);
  });
});
