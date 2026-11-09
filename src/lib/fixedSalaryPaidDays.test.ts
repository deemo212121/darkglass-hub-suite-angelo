import { describe, it, expect } from "vitest";
import { approvedPaidDates, fixedSalaryForPaidDates } from "./fixedSalaryPaidDays";

const worked = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"];
const vacation = { status: "approved", ptoType: "vacation", startDate: "2026-11-12", endDate: "2026-11-13" };
describe("fixed salary paid-day cap", () => {
  it("pays the full guarantee for eight worked days plus two paid PTO dates", () => {
    const pto = approvedPaidDates([vacation], "2026-11-01", "2026-11-14", [0, 6], "2025-01-01");
    expect(fixedSalaryForPaidDates(2000, [...worked, ...pto])).toBe(2000);
  });
  it("prorates eight paid days and pays zero with no paid dates", () => {
    expect(fixedSalaryForPaidDates(2000, worked)).toBe(1600);
    expect(fixedSalaryForPaidDates(2000, [])).toBe(0);
  });
  it("counts overlapping work and leave only once and caps extra dates", () => {
    expect(fixedSalaryForPaidDates(2000, [...worked, ...worked])).toBe(1600);
    expect(fixedSalaryForPaidDates(2000, [...worked, "2026-11-12", "2026-11-13", "2026-11-14"])).toBe(2000);
  });
  it("does not credit unapproved, unpaid, ineligible, or off-day PTO", () => {
    const dates = (requests: typeof vacation[]) => approvedPaidDates(requests, "2026-11-01", "2026-11-14", [0, 6], "2026-11-13");
    expect(dates([vacation])).toEqual(["2026-11-13"]);
    expect(dates([{ ...vacation, status: "pending" }])).toEqual([]);
    expect(dates([vacation, { ...vacation, ptoType: "unpaid" }])).toEqual([]);
    expect(dates([{ ...vacation, startDate: "2026-11-14", endDate: "2026-11-14" }])).toEqual([]);
  });
});
