import { describe, it, expect } from "vitest";
import { computeStateHourlyMatch } from "@/lib/stateHourlyMatch";
import { weeklyOtPremium } from "@/lib/techWeeklyOvertime";

// Sample technician (GA, $7.25): week 1 Redos outweigh earnings, so the
// week's commission is negative and pay falls below the state floor. The
// floor shortfall plus the OT recalculation must be matched back.
describe("state match with negative weekly commission", () => {
  it("matches a Redo-driven shortfall back to the floor", () => {
    const w1 = [["2026-11-09", 11.155], ["2026-11-10", 9.921111111], ["2026-11-11", 6.554166667], ["2026-11-12", 9.829722222], ["2026-11-13", 9.106666667]] as const;
    const w2 = [["2026-11-16", 9.666666667], ["2026-11-17", 7.874166667], ["2026-11-18", 10.21916667], ["2026-11-19", 9.830277778], ["2026-11-20", 9.883611111]] as const;
    const days: { date: string; regular: number; overtime: number; state: string }[] = [];
    for (const wk of [w1, w2]) {
      let cum = 0;
      for (const [date, h] of wk) {
        const regular = Math.max(Math.min(h, 40 - cum), 0);
        cum += h;
        days.push({ date, regular, overtime: h - regular, state: "GA" });
      }
    }
    const rate = () => 7.25;
    const weekly = weeklyOtPremium(days, rate, () => true, new Map([["2026-11-08", -20]]), 0);
    const hours = days.reduce((s, d) => s + d.regular, 0);
    const ot = days.reduce((s, d) => s + d.overtime, 0);
    const premium = weekly.reduce((s, w) => s + w.premium, 0);
    const r = computeStateHourlyMatch({
      days, periodStart: "2026-11-08", periodEnd: "2026-11-21", rateOnDate: rate,
      hoursWorked: hours, overtimeHours: ot, techWeightedRegularRate: premium / (ot * 0.5),
      techIncludablePay: -20, techHourlyPayStraight: (hours + ot) * 7.25, techHourlyPayOtPremium: premium, techWeeklyOt: weekly,
    });
    expect(r.matchMin).toBeCloseTo(20, 2);
    expect(r.matchMin + r.matchOt).toBeCloseTo(22.82, 2);
  });
});
