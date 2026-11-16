import { describe, expect, it } from "vitest";
import { dayTotals, eligibleMiles, entryCheck, parseMiles, parsePastedBlock, priceMiles, thresholdCounts } from "./dailyMileage";

describe("thresholdCounts", () => {
  it("puts each day in its highest band only", () => {
    expect(thresholdCounts([150, 201, 250, 301, 400, 401, 520])).toEqual({ over200: 2, over300: 2, over400: 2 });
  });
  it("a day of exactly 200 doesn't count", () => {
    expect(thresholdCounts([200, 300])).toEqual({ over200: 1, over300: 0, over400: 0 });
  });
});

describe("priceMiles", () => {
  it("prices each day at that day's rate and reports days without one", () => {
    const r = priceMiles(
      [{ date: "2026-10-26", miles: 100 }, { date: "2026-10-27", miles: 50 }, { date: "2026-10-28", miles: 30 }],
      (d) => (d === "2026-10-26" ? { hasCarIq: true, rate: 0.2 } : d === "2026-10-27" ? { hasCarIq: false, rate: 0.4 } : { hasCarIq: null, rate: null }),
    );
    expect(r).toEqual({ miles: 180, pay: 40, unpricedMiles: 30, rates: [0.2, 0.4] });
  });
});

describe("parseMiles", () => {
  it("reads numbers with commas and a unit", () => {
    expect(parseMiles("1,248.5")).toBe(1248.5);
    expect(parseMiles("212 mi")).toBe(212);
  });
  it("blank clears, text is invalid", () => {
    expect(parseMiles("")).toBeNull();
    expect(parseMiles("  ")).toBeNull();
    expect(parseMiles("abc")).toBeNaN();
    expect(parseMiles("-5")).toBeNaN();
  });
});

describe("parsePastedBlock", () => {
  it("splits a spreadsheet selection into rows and cells", () => {
    expect(parsePastedBlock("10\t20\r\n30\t\n")).toEqual([["10", "20"], ["30", ""]]);
  });
});

describe("trips", () => {
  const trip = (miles: number, excludedMiles = 0, exclusionReason = "", status: "pending" | "approved" | "rejected" | "needs_review" = "pending") => ({ miles, excludedMiles, exclusionReason, status });

  it("eligible = total − excluded; a rejected trip pays nothing", () => {
    expect(eligibleMiles(trip(331.9, 10.7, "Other"))).toBe(321.2);
    expect(eligibleMiles(trip(71.8, 71.8, "Missing photos"))).toBe(0);
    expect(eligibleMiles(trip(100, 0, "", "rejected"))).toBe(0);
  });

  it("entry check follows the workbook's rules", () => {
    expect(entryCheck(trip(100))).toBe("");
    expect(entryCheck(trip(100, 10))).toBe("Add reason");
    expect(entryCheck(trip(100, 120, "Other"))).toBe("Check miles");
    expect(entryCheck(trip(0))).toBe("No miles");
  });

  it("adds a day's trips up", () => {
    expect(dayTotals([trip(100, 10, "Other", "approved"), trip(50, 0, "", "approved")])).toEqual({ miles: 150, excluded: 10, eligible: 140, status: "approved", problems: 0 });
    expect(dayTotals([trip(100), trip(40, 5, "", "rejected")])).toEqual({ miles: 140, excluded: 40, eligible: 100, status: "mixed", problems: 1 });
    expect(dayTotals([]).status).toBeNull();
  });
});
