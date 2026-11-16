import { describe, expect, it } from "vitest";
import { matchTechnician, parseMileageSheet, readDate } from "./dailyMileageImport";

const YM = "2026-11";

describe("readDate", () => {
  it("reads the usual ways a date is written", () => {
    expect(readDate("2026-11-03", YM)).toBe("2026-11-03");
    expect(readDate("11/3/2026", YM)).toBe("2026-11-03");
    expect(readDate("11/3", YM)).toBe("2026-11-03");
    expect(readDate("Nov 3", YM)).toBe("2026-11-03");
    expect(readDate("3-Nov", YM)).toBe("2026-11-03");
    expect(readDate("Mon 11/2", YM)).toBe("2026-11-02");
    expect(readDate(46329, YM)).toBe("2026-11-03"); // Excel day number
  });
  it("doesn't read names or totals as dates", () => {
    expect(readDate("A'Dejaun Tyson", YM)).toBeNull();
    expect(readDate("Total", YM)).toBeNull();
    expect(readDate(212, YM)).toBeNull();
  });
});

describe("parseMileageSheet", () => {
  it("one row per technician, days across the top (with a total column left out)", () => {
    const r = parseMileageSheet([
      ["Technician", "Branch", "Nov 1", "Nov 2", "Nov 3", "Total"],
      ["A'Dejaun Tyson", "Columbus", 120, "", "212.5", 332.5],
      ["Lamar Hudson", "Destin", "", 45, "abc", 45],
    ], YM)!;
    expect(r.layout).toBe("by-technician");
    expect(r.entries).toEqual([
      { name: "A'Dejaun Tyson", date: "2026-11-01", miles: 120 },
      { name: "A'Dejaun Tyson", date: "2026-11-03", miles: 212.5 },
      { name: "Lamar Hudson", date: "2026-11-02", miles: 45 },
    ]);
    expect(r.skipped).toBe(1);
  });

  it("bare day numbers across the top are days of the month on screen", () => {
    const r = parseMileageSheet([["Name", 1, 2, 3, 4, 5], ["Lamar Hudson", 10, 20, "", "", 50]], YM)!;
    expect(r.entries.map((e) => e.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-05"]);
  });

  it("one row per day, technicians across the top", () => {
    const r = parseMileageSheet([
      ["Date", "A'Dejaun Tyson", "Lamar Hudson"],
      ["11/1/2026", 100, ""],
      ["11/2/2026", 50, 75],
    ], YM)!;
    expect(r.layout).toBe("by-day");
    expect(r.entries).toHaveLength(3);
  });

  it("a list, adding up two lines for the same day", () => {
    const r = parseMileageSheet([
      ["Report"],
      ["Driver", "Date", "Miles"],
      ["Lamar Hudson", "2026-11-02", 40],
      ["Lamar Hudson", "2026-11-02", 35.5],
      ["Lamar Hudson", "", 10],
    ], YM)!;
    expect(r.layout).toBe("list");
    expect(r.entries).toEqual([{ name: "Lamar Hudson", date: "2026-11-02", miles: 75.5 }]);
    expect(r.skipped).toBe(1);
  });

  it("nothing that looks like miles by day → null", () => {
    expect(parseMileageSheet([["Hello"], ["World"]], YM)).toBeNull();
  });
});

describe("matchTechnician", () => {
  const people = [
    { id: "1", name: "A'Dejaun Tyson" },
    { id: "2", name: "Erick Guzman" },
    { id: "3", name: "Joshua Malloch" },
  ];
  it("evens out spelling, middle names and nicknames", () => {
    expect(matchTechnician("Adejaun Tyson", people)?.id).toBe("1");
    expect(matchTechnician("Erick Guzman Juarez", people)?.id).toBe("2");
    expect(matchTechnician("Josh Malloch", people)?.id).toBe("3");
    expect(matchTechnician("Someone Else", people)).toBeNull();
  });
});
