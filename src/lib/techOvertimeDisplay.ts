/**
 * Company-mode display split of a technician's Hourly + OT pay — shared by
 * the Tech Activity Report, the tech payslip page and the payroll detail
 * step's Hourly + OT tile so all three show the same lines:
 *
 *   Hourly Pay               = regular hours × flat rate
 *   Overtime Pay (week)      = OT hours × base rate × 1.5
 *   OT on Incentive Pay      = OT hours × (weekly regular rate − base rate) × 0.5
 *
 * which adds up to the same straight time + weighted 0.5x premium that is
 * actually paid (OT hrs × base + OT hrs × regular rate × 0.5). Display only:
 * no paid amount changes.
 *
 * Rounding: each week's two lines add up to its rounded straight time +
 * rounded premium, and Hourly Pay takes the rounded straight-time total minus
 * those, so the lines sum to exactly the old Hourly Pay + OT Premium lines.
 */
import type { TechWeeklyOt } from "./techWeeklyOvertime";

export interface OvertimeDisplayWeek {
  key: string;
  /** "Wk 10/25", or "Weighted Rate" when there's no per-week data. */
  label: string;
  hours: number;
  baseRate: number;
  regularRate: number;
  /** OT hours × base rate × 1.5 */
  otAmount: number;
  /** OT hours × (regular rate − base rate) × 0.5 */
  incentiveAmount: number;
  straightPay?: number;
  includablePay?: number;
  weekHours?: number;
}

export interface OvertimeDisplay {
  hourlyRate: number;
  hourlyHours: number;
  hourlyAmount: number;
  weeks: OvertimeDisplayWeek[];
  /** hourlyAmount + every week's otAmount + incentiveAmount. */
  total: number;
}

export const weekLabel = (weekStart: string) => `Wk ${Number(weekStart.slice(5, 7))}/${Number(weekStart.slice(8, 10))}`;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildOvertimeDisplay(input: {
  hourlyRate: number;
  /** Regular hours (PTO hours included, subtracted via paidLeaveHours). */
  hoursWorked: number;
  overtimeHours: number;
  /** Straight time for every hour incl. PTO (techHourlyPayStraight). */
  straightPay: number;
  /** Weighted 0.5x premium for the period (techHourlyPayOtPremium). */
  otPremium: number;
  weightedRegularRate: number;
  weeklyOt?: TechWeeklyOt[];
  paidLeaveHours?: number;
  paidLeavePay?: number;
}): OvertimeDisplay {
  const { hourlyRate, hoursWorked, overtimeHours, straightPay, otPremium, weightedRegularRate } = input;
  const weeklyOt = input.weeklyOt ?? [];
  const paidLeaveHours = input.paidLeaveHours ?? 0;
  const paidLeavePay = input.paidLeavePay ?? 0;
  const source =
    overtimeHours > 0 && weeklyOt.some((w) => w.premiumHours > 0)
      ? weeklyOt
          .filter((w) => w.premiumHours > 0)
          .map((w) => ({
            key: w.weekStart,
            label: weekLabel(w.weekStart),
            hours: w.premiumHours,
            baseRate: w.hours > 0 && w.straightPay > 0 ? w.straightPay / w.hours : hourlyRate,
            regularRate: w.regularRate,
            premium: w.premium,
            straightPay: w.straightPay,
            includablePay: w.includablePay,
            weekHours: w.hours,
          }))
      : overtimeHours > 0
        ? [{ key: "weighted", label: "Weighted Rate", hours: overtimeHours, baseRate: hourlyRate, regularRate: weightedRegularRate, premium: otPremium }]
        : [];
  let otStraightRounded = 0;
  let otHours = 0;
  let total = 0;
  const weeks: OvertimeDisplayWeek[] = source.map(({ premium, ...w }) => {
    const straight = r2(w.hours * w.baseRate);
    const otAmount = r2(w.hours * w.baseRate * 1.5);
    const incentiveAmount = r2(r2(premium) + straight - otAmount);
    otStraightRounded += straight;
    otHours += w.hours;
    total += otAmount + incentiveAmount;
    return { ...w, otAmount, incentiveAmount };
  });
  const hourlyAmount = r2(r2(straightPay - paidLeavePay) - otStraightRounded);
  return {
    hourlyRate,
    hourlyHours: Math.max(hoursWorked - paidLeaveHours + overtimeHours - otHours, 0),
    hourlyAmount,
    weeks,
    total: r2(hourlyAmount + total),
  };
}
