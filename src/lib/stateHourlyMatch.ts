/**
 * A technician's State minimum-wage match for one pay period — the settled
 * rule (regular-hours floor + cascaded OT match, per Sunday workweek), moved
 * here verbatim from TechActivityReportModal so the payroll table can apply
 * it for every technician as payroll loads, instead of only once someone
 * opens that technician's Tech Activity Report. Both now call this, so the
 * report and the table can't disagree.
 *
 * Pure: the caller supplies each worked day's regular / OT hours (the flat
 * 40-hr weekly split) and the state it was worked in, the rate in effect on
 * each date, and the company-rate figures already on the payroll row.
 */
import { startOfWeekSunday } from "@/lib/supabase/timecards";
import { stateMinWageOn, COMMISSION_COUNTS_TOWARD_STATE_MIN, OT_MATCH_ADDS_TRUE_UP_AND_FLOOR } from "@/lib/stateMinWage";
import type { TechWeeklyOt } from "@/lib/techWeeklyOvertime";

export interface StateMatchDay {
  date: string;
  regular: number;
  overtime: number;
  state?: string | null;
}

export interface StateMatchInput {
  /** Worked days (paid leave left out); days outside the period are ignored. */
  days: StateMatchDay[];
  periodStart: string;
  periodEnd: string;
  /** The hourly rate in effect on a date (salary history, else the period rate). */
  rateOnDate: (date: string) => number;
  hoursWorked: number;
  overtimeHours: number;
  techWeightedRegularRate: number;
  techIncludablePay: number;
  techHourlyPayStraight: number;
  techHourlyPayOtPremium: number;
  techWeeklyOt: TechWeeklyOt[];
}

export interface StateMatchResult {
  /** Regular hours at each day's state floor (or the company rate where no state applies). */
  stateMinFloor: number;
  /** Regular hours at the rate actually in effect each day. */
  companyRegularPayBlended: number;
  companyHourlyOtTotal: number;
  matchMin: number;
  commissionAppliedToFloor: number;
  requiredPremiumAfterMinMatch: number;
  stateOtFloorPremium: number;
  matchOt: number;
  /** What's owed for hours in State mode: company + Min match + OT match. */
  stateHourlyOtTotal: number;
  /** The Regular $ part of the State total — saved with the override (migration 0400). */
  stateRegularShare: number;
  /** True when State pays more than the company rate — State mode applies. */
  stateMatchRequired: boolean;
}

export function computeStateHourlyMatch(input: StateMatchInput): StateMatchResult {
  const { periodStart, periodEnd, rateOnDate, techWeeklyOt, techIncludablePay, techWeightedRegularRate } = input;
  const days = input.days.filter((d) => d.date >= periodStart && d.date <= periodEnd);

  // Min-floor check, same shape as the reference spreadsheet's "Match to
  // pay" table: regular+meal hours at each day's own state floor. A day with
  // no state assigned defaults to the company rate rather than being skipped
  // (skipping it would understate the state side and hide a real shortfall).
  let stateMinFloor = 0;
  let companyRegularPayBlended = 0;
  for (const d of days) {
    const floor = stateMinWageOn(d.state ?? undefined, d.date) ?? rateOnDate(d.date);
    stateMinFloor += d.regular * floor;
    companyRegularPayBlended += d.regular * rateOnDate(d.date);
  }

  const companyHourlyOtTotal = input.techHourlyPayStraight + input.techHourlyPayOtPremium;
  // Per Sunday workweek: the regular-hours state gap (floor − company pay,
  // can be negative when the company rate is above the floor) and the OT
  // hours' straight-time gap (their state floor vs. the company rate).
  const weeklyIncludable = new Map(techWeeklyOt.map((w) => [w.weekStart, w.includablePay]));
  const weekKey = (date: string) => (weeklyIncludable.size > 0 ? startOfWeekSunday(date) : "period");
  if (weeklyIncludable.size === 0) weeklyIncludable.set("period", techIncludablePay);
  const weeklyStateGaps = new Map<string, { regular: number; otStraight: number; otHalf: number }>();
  for (const d of days) {
    const companyRate = rateOnDate(d.date);
    const floor = stateMinWageOn(d.state ?? undefined, d.date) ?? companyRate;
    const gap = weeklyStateGaps.get(weekKey(d.date)) ?? { regular: 0, otStraight: 0, otHalf: 0 };
    gap.regular += d.regular * (floor - companyRate);
    gap.otStraight += d.overtime * (Math.max(floor, companyRate) - companyRate);
    gap.otHalf += d.overtime * Math.max(floor, companyRate) * 0.5;
    weeklyStateGaps.set(weekKey(d.date), gap);
  }
  // COMMISSION_COUNTS_TOWARD_STATE_MIN: each week's commission first covers
  // that week's regular-hours gap; what's left covers its OT hours'
  // straight-time gap. Off: the period-wide check, base pay alone vs. floor.
  let matchMin = Math.max(stateMinFloor - companyRegularPayBlended, 0);
  let commissionAppliedToFloor = 0;
  let otStraightStateMatch = [...weeklyStateGaps.values()].reduce((sum, g) => sum + g.otStraight, 0);
  const weekMinMatch = new Map<string, number>();
  const weekOtStraightMatch = new Map<string, number>();
  for (const [week, gap] of weeklyStateGaps) {
    weekMinMatch.set(week, Math.max(gap.regular, 0));
    weekOtStraightMatch.set(week, gap.otStraight);
  }
  if (COMMISSION_COUNTS_TOWARD_STATE_MIN) {
    matchMin = 0;
    otStraightStateMatch = 0;
    for (const [week, gap] of weeklyStateGaps) {
      // A week whose Redos outweigh its earnings has NEGATIVE commission, and
      // that pulls its pay below the floor too — the deficit is matched back
      // (Finance's Step 3/9: corrected straight-time vs. the state floor).
      // It used to be clamped to $0, so a Redo could cut pay below minimum
      // wage unmatched.
      const credit = weeklyIncludable.get(week) ?? 0;
      const minW = Math.max(gap.regular - credit, 0);
      matchMin += minW;
      commissionAppliedToFloor += Math.min(Math.max(credit, 0), Math.max(gap.regular, 0));
      const leftover = Math.max(credit - gap.regular, 0);
      const otStraightW = Math.max(gap.otStraight - leftover, 0);
      otStraightStateMatch += otStraightW;
      commissionAppliedToFloor += Math.min(leftover, gap.otStraight);
      weekMinMatch.set(week, minW);
      weekOtStraightMatch.set(week, otStraightW);
    }
  }
  // After a Min-floor top-up, the regular rate the OT premium is based on is
  // recomputed with that extra pay folded in, and any incremental premium
  // that higher rate requires is owed too (the workbook's Steps 9–11).
  const totalHoursForMatch = input.hoursWorked + input.overtimeHours;
  const regularRateAfterMinMatch = totalHoursForMatch > 0 ? techWeightedRegularRate + matchMin / totalHoursForMatch : techWeightedRegularRate;
  // Training days included — overtime during training is still overtime.
  const premiumHours = days.reduce((sum, d) => sum + d.overtime, 0);
  let requiredPremiumAfterMinMatch = premiumHours * regularRateAfterMinMatch * 0.5;
  // OT hours belong to the state they were worked in (policy, 2026-10-14):
  // each day's overtime is paid at least 1.5x that day's state minimum.
  const stateOtHalfFloorPeriod = days.reduce((sum, d) => {
    if (d.overtime <= 0) return sum;
    const companyRate = rateOnDate(d.date);
    const floor = Math.max(stateMinWageOn(d.state ?? undefined, d.date) ?? companyRate, companyRate);
    return sum + d.overtime * floor * 0.5;
  }, 0);
  let stateOtFloorPremium = otStraightStateMatch + stateOtHalfFloorPeriod;
  // OT_MATCH_ADDS_TRUE_UP_AND_FLOOR: add both checks (Finance's sheet) or pay only the higher one.
  const combineOtChecks = (trueUp: number, floorShortfall: number) =>
    OT_MATCH_ADDS_TRUE_UP_AND_FLOOR ? Math.max(trueUp, 0) + Math.max(floorShortfall, 0) : Math.max(trueUp, floorShortfall, 0);
  let matchOt = otStraightStateMatch + combineOtChecks(
    requiredPremiumAfterMinMatch - input.techHourlyPayOtPremium,
    stateOtHalfFloorPeriod - input.techHourlyPayOtPremium,
  );
  // Checked PER WORKWEEK when the weekly breakdown is available (FLSA
  // measures overtime per week), so one week's surplus can't cover another's
  // shortfall (Vincent Pullens 9/27–10/10).
  if (techWeeklyOt.length > 0) {
    requiredPremiumAfterMinMatch = 0;
    stateOtFloorPremium = 0;
    matchOt = 0;
    for (const w of techWeeklyOt) {
      const gap = weeklyStateGaps.get(w.weekStart) ?? { regular: 0, otStraight: 0, otHalf: 0 };
      const minW = weekMinMatch.get(w.weekStart) ?? 0;
      const otStraightW = weekOtStraightMatch.get(w.weekStart) ?? 0;
      const rateAfter = w.hours > 0 ? (w.straightPay + w.includablePay + minW + otStraightW) / w.hours : 0;
      const cascade = w.premiumHours * rateAfter * 0.5;
      requiredPremiumAfterMinMatch += cascade;
      stateOtFloorPremium += otStraightW + gap.otHalf;
      matchOt += otStraightW + combineOtChecks(cascade - w.premium, gap.otHalf - w.premium);
    }
  }
  const stateHourlyOtTotal = companyHourlyOtTotal + matchMin + matchOt;
  return {
    stateMinFloor,
    companyRegularPayBlended,
    companyHourlyOtTotal,
    matchMin,
    commissionAppliedToFloor,
    requiredPremiumAfterMinMatch,
    stateOtFloorPremium,
    matchOt,
    stateHourlyOtTotal,
    stateRegularShare: companyRegularPayBlended + matchMin,
    stateMatchRequired: stateHourlyOtTotal > companyHourlyOtTotal + 0.005,
  };
}
