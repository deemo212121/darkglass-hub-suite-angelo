import { describe, expect, it } from "vitest";
import { parseMiles, parsePastedBlock, priceMiles, thresholdCounts } from "./dailyMileage";

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
