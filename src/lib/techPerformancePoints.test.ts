import { describe, it, expect, vi } from "vitest";
vi.mock("./supabase/client", () => ({ supabase: {} }));
import { flashTripDates } from "./supabase/myPerformance";
import {
  flashAvgPoints, gradeScaleFor, GRADERS, LETTER_META, pointsRangeText, shortFlashAvg, shortPoints, usesFlashScoring, type ShortRowInput,
} from "@/components/techPerformanceGrading";

const NEW = "2026-11-08"; // first pay period with the new points
const OLD = "2026-10-25"; // the pay period before it

// 10 working days, nothing else scored: Total Ticket alert (−1), Redo % 0% (+2),
// Working Days median (+1), Average Hours 0 (0), Mileage 0 (0), no errors (+1) = 3.
const base: ShortRowInput = {
  minorTicketCount: 0, majorTicketCount: 0, redoCount: 0, daysWorked: 10, hoursWorked: 0, miles: 0,
  timecardIssueCount: 0, damageAssessmentCount: 0, missedClockInCount: 0, flashTicketCount: 0, flashDaysWorked: 0,
};
const withTickets = (perDay: number, extra: Partial<ShortRowInput> = {}): ShortRowInput => ({ ...base, minorTicketCount: perDay * 10, ...extra });

describe("the 11/08/2026 cut-off", () => {
  it("starts with the 11/08 pay period", () => {
    expect(usesFlashScoring(NEW)).toBe(true);
    expect(usesFlashScoring("2026-11-22")).toBe(true);
    expect(usesFlashScoring(OLD)).toBe(false);
    expect(usesFlashScoring("2026-08-27")).toBe(false); // the all-periods total
    expect(pointsRangeText(OLD)).toBe("−7 to 12");
    expect(pointsRangeText(NEW)).toBe("−6 to 18");
  });
  it("keeps the old points before it", () => {
    expect(shortPoints(base, OLD)).toBe(3 - 1); // Average Tickets Alert −1
    expect(shortPoints(withTickets(6), OLD)).toBe(9); // Average Tickets +3, Total Ticket (60) +2, Redo % +2, Working Days +1, no errors +1
    expect(shortPoints(withTickets(5, { flashTicketCount: 50, flashDaysWorked: 5 }), OLD)).toBe(shortPoints(withTickets(5), OLD));
    expect(gradeScaleFor(OLD)[0].points?.max).toBe(3);
  });
});

describe("Average Tickets points from 11/08 (one more than before)", () => {
  it("is worth 0 to 4", () => {
    expect(shortPoints(base, NEW)).toBe(3); // Alert 0
    // 3 a day → 30 total: Effort +1 on Average Tickets, Total Ticket Effort 0 (+1 over Alert).
    expect(shortPoints(withTickets(3), NEW)).toBe(3 + 1 + 1);
    expect(shortPoints(withTickets(6), NEW)).toBe(3 + 4 + 3);
    expect(shortPoints(withTickets(6), NEW) - shortPoints(withTickets(6), OLD)).toBe(1);
    expect(gradeScaleFor(NEW)[0].points?.max).toBe(4);
  });
});

describe("Flash Tech Completion from 11/08", () => {
  it("scores each band as listed", () => {
    const cases: [number | null, number][] = [[null, 0], [3.9, 0], [4, 1], [4.9, 1], [5, 2], [5.9, 2], [6, 3], [6.9, 3], [7, 4], [8.9, 4], [9, 5], [14, 5]];
    for (const [v, pts] of cases) expect(flashAvgPoints(v)).toBe(pts);
  });
  it("is the tickets on worked flash days over those days, and adds to Points", () => {
    expect(shortFlashAvg({ flashTicketCount: 0, flashDaysWorked: 0 })).toBeNull();
    expect(shortFlashAvg({ flashTicketCount: 35, flashDaysWorked: 5 })).toBe(7);
    const row = withTickets(5, { flashTicketCount: 35, flashDaysWorked: 5 });
    expect(shortPoints(row, NEW) - shortPoints(withTickets(5), NEW)).toBe(4);
    expect(GRADERS.flashAvg(7)).toBe("great");
    expect(GRADERS.flashAvg(3)).toBeNull();
  });
  it("keeps Master open-ended now that points can pass 12", () => {
    expect(LETTER_META.SSS.range).toBe("11+ pts");
  });
});

describe("flashTripDates", () => {
  const trips = [
    { profileId: "a", startDate: "2026-10-20", endDate: "2026-10-28" },
    { profileId: "a", startDate: "2026-11-06", endDate: "2026-11-12" },
    { profileId: "b", startDate: "2026-10-25", endDate: "2026-10-26" },
  ];
  it("lists only that technician's trip days inside the pay period", () => {
    expect([...flashTripDates(trips, "a", "2026-10-25", "2026-11-07")].sort()).toEqual(
      ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-11-06", "2026-11-07"],
    );
    expect(flashTripDates(trips, "c", "2026-10-25", "2026-11-07").size).toBe(0);
  });
});
