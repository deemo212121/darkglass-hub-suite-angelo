import { describe, it, expect } from "vitest";
import { autoPullWindows, centralTodayIso, isAutoPullSource, readSpAutoPullSettings, spWindowDate } from "@/lib/servicePowerAutoPullRules";

describe("readSpAutoPullSettings", () => {
  it("reads sources (upper case, deduped) and from", () => {
    expect(readSpAutoPullSettings({ spAutoPull: { sources: ["GE", "square trade", "GE", " ELECTROLUX "], from: "2026-11-20" } })).toEqual({
      sources: ["GE", "SQUARE TRADE", "ELECTROLUX"],
      from: "2026-11-20",
    });
  });
  it("is off with no sources, no key, or no settings", () => {
    expect(readSpAutoPullSettings({ spAutoPull: { sources: [], from: "2026-11-20" } })).toBeNull();
    expect(readSpAutoPullSettings({ mapProvider: "leaflet" })).toBeNull();
    expect(readSpAutoPullSettings(null)).toBeNull();
  });
  it("ignores a bad from date", () => {
    expect(readSpAutoPullSettings({ spAutoPull: { sources: ["GE"], from: "11/20/2026" } })?.from).toBe("");
  });
});

describe("isAutoPullSource", () => {
  const sources = ["GE", "SQUARE TRADE", "ELECTROLUX"];
  it("matches the chosen sources only", () => {
    expect(isAutoPullSource("GE", sources)).toBe(true);
    expect(isAutoPullSource("Square Trade", sources)).toBe(true);
    expect(isAutoPullSource("ELECTROLUX", sources)).toBe(true);
    expect(isAutoPullSource("ASSURANT SOLUTIONS", sources)).toBe(false);
    expect(isAutoPullSource("CENTRICITY", sources)).toBe(false);
    expect(isAutoPullSource("", sources)).toBe(false);
    expect(isAutoPullSource(null, sources)).toBe(false);
  });
});

describe("autoPullWindows", () => {
  it("starts at the from date while it's inside the lookback (Fri 11/20 .. Tue 11/24)", () => {
    expect(autoPullWindows("2026-11-24", "2026-11-20")).toEqual([
      { from: "2026-11-20", to: "2026-11-21" },
      { from: "2026-11-22", to: "2026-11-23" },
      { from: "2026-11-24", to: "2026-11-24" },
    ]);
  });
  it("looks back 7 days once the from date is older", () => {
    const w = autoPullWindows("2026-12-10", "2026-11-20");
    expect(w[0].from).toBe("2026-12-04");
    expect(w[w.length - 1].to).toBe("2026-12-10");
    expect(w.every((x) => x.from <= x.to)).toBe(true);
  });
  it("crosses month and year ends", () => {
    const w = autoPullWindows("2027-01-02", "");
    expect(w[0].from).toBe("2026-12-27");
    expect(w[w.length - 1].to).toBe("2027-01-02");
  });
  it("is empty when from is after today", () => {
    expect(autoPullWindows("2026-11-24", "2026-11-30")).toEqual([]);
  });
});

describe("dates", () => {
  it("formats ServicePower window dates", () => {
    expect(spWindowDate("2026-11-20", false)).toBe("11/20/2026 00:00:00");
    expect(spWindowDate("2026-11-21", true)).toBe("11/21/2026 23:59:59");
  });
  it("uses the Central day", () => {
    // 2026-11-25 03:30 UTC is still 11/24 in Chicago (UTC-6).
    expect(centralTodayIso(new Date("2026-11-25T03:30:00Z"))).toBe("2026-11-24");
    expect(centralTodayIso(new Date("2026-11-25T06:30:00Z"))).toBe("2026-11-25");
  });
});
