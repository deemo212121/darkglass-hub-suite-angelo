import { describe, expect, it } from "vitest";
import { paidHolidayDates } from "./holidayPay";
import { fixedSalaryForPaidDates } from "./fixedSalaryPaidDays";

const holiday = { date: "2026-11-26", hourlyPaid: false, fixedSalaryPaid: true };
const period = ["2026-11-22", "2026-12-05"] as const;
describe("holiday pay policies", () => {
  it("credits the fixed-salary holiday as the tenth paid day", () => {
    const worked = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"];
    const credits = paidHolidayDates([holiday], ...period, [0,6], worked, () => "fixed");
    expect(fixedSalaryForPaidDates(2000, [...worked, ...credits])).toBe(2000);
  });
  it("selects the policy for compensation effective on the holiday", () => {
    expect(paidHolidayDates([holiday], ...period, [], [], () => "hourly")).toEqual([]);
    expect(paidHolidayDates([{ ...holiday, hourlyPaid: true, fixedSalaryPaid: false }], ...period, [], [], () => "hourly")).toEqual([holiday.date]);
  });
  it("never credits an existing worked/PTO date, rest day, or duplicate holiday twice", () => {
    expect(paidHolidayDates([holiday], ...period, [], [holiday.date], () => "fixed")).toEqual([]);
    expect(paidHolidayDates([holiday], ...period, [4], [], () => "fixed")).toEqual([]);
    expect(paidHolidayDates([holiday, holiday], ...period, [], [], () => "fixed")).toEqual([holiday.date]);
  });
  it("does not assume missing policies are paid, or credit dates outside the period", () => {
    expect(paidHolidayDates([{ date: holiday.date }], ...period, [], [], () => "fixed")).toEqual([]);
    expect(paidHolidayDates([{ ...holiday, fixedSalaryPaid: false }], ...period, [], [], () => "fixed")).toEqual([]);
    expect(paidHolidayDates([holiday], "2026-12-01", "2026-12-05", [], [], () => "fixed")).toEqual([]);
  });
});
