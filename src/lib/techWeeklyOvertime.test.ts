import { describe, expect, it } from "vitest";
import { weeklyOtPremium } from "./techWeeklyOvertime";
import { approvedPaidDates, fixedSalaryForPaidDates } from "./fixedSalaryPaidDays";

describe("paid-day technician guarantee and PTO", () => {
  it("counts Alexxis's six worked dates and three PTO dates, including worked weekends", () => {
    const work = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-11-05", "2026-11-06", "2026-11-07"];
    const pto = approvedPaidDates([{ status: "approved", ptoType: "vacation", startDate: "2026-10-28", endDate: "2026-10-30" }], "2026-10-25", "2026-11-07", [0, 6], null);
    expect(fixedSalaryForPaidDates(96000 / 26, [...work, ...pto])).toBeCloseTo(3323.076923, 6);
    expect(fixedSalaryForPaidDates(96000 / 26, [...work, ...pto, work[0]])).toBeCloseTo(3323.076923, 6);
  });
  it("PTO does not alter a worked week's weighted rate or OT premium", () => {
    const work = [{ date: "2026-10-27", regular: 40, overtime: 2.75 }];
    const baseline = weeklyOtPremium(work, () => 7.25, () => true, new Map([["2026-10-25", 320]]), 0);
    const withPto = weeklyOtPremium([...work, { date: "2026-10-26", regular: 8, overtime: 0, paidLeave: true }], () => 7.25, () => true, new Map([["2026-10-25", 320]]), 0);
    expect(withPto).toEqual(baseline);
    expect(withPto[0].hours).toBe(42.75);
    expect(withPto[0].premium).toBeCloseTo(20.26187865);
  });
  it("PTO alone earns paid-day credit without generating an OT workweek", () => {
    const pto = [{ date: "2026-11-02", regular: 8, overtime: 0, paidLeave: true }];
    expect(weeklyOtPremium(pto, () => 9.25, () => true, undefined, 0)).toEqual([]);
    expect(fixedSalaryForPaidDates(2000, pto.map((day) => day.date))).toBe(200);
  });
});
