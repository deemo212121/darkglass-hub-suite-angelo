import { describe, expect, it } from "vitest";
import { weeklyOtPremium } from "./techWeeklyOvertime";
import { approvedPaidDates, fixedSalaryForPaidDates } from "./fixedSalaryPaidDays";

describe("paid-day technician guarantee and PTO", () => {
  it("keeps Chris's zero-hour Week 2 pay out of Week 1 OT while retaining it in total pay", () => {
    const hours = 46.21527778;
    const weeks = weeklyOtPremium(
      [{ date: "2026-10-30", regular: 40, overtime: hours - 40 }],
      () => 9.25, () => true,
      new Map([["2026-10-25", 690], ["2026-11-01", 30]]), 0
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0].includablePay).toBe(690);
    expect(weeks[0].premium).toBeCloseTo(75.14310525);
    const totalPay = hours * 9.25 + weeks[0].premium + 690 + 30 + 339.9 + 15;
    expect(Math.round(totalPay * 100) / 100).toBe(1577.53);
  });
  it("does not move a zero-hour week's negative tagged balance, but still allocates untagged pay", () => {
    const days = [{ date: "2026-10-30", regular: 40, overtime: 5 }];
    const weeks = weeklyOtPremium(days, () => 10, () => true,
      new Map([["2026-10-25", 100], ["2026-11-01", -30]]), 20);
    expect(weeks[0].includablePay).toBe(120);
    expect(weeks[0].premium).toBeCloseTo(5 * (450 + 120) / 45 * 0.5);
  });
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
