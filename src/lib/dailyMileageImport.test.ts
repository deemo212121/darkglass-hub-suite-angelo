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

  it("a list keeps each line as its own trip", () => {
    const r = parseMileageSheet([
      ["Report"],
      ["Driver", "Date", "Miles"],
      ["Lamar Hudson", "2026-11-02", 40],
      ["Lamar Hudson", "2026-11-02", 35.5],
      ["Lamar Hudson", "", 10],
    ], YM)!;
    expect(r.layout).toBe("list");
    expect(r.entries).toEqual([
      { name: "Lamar Hudson", date: "2026-11-02", miles: 40 },
      { name: "Lamar Hudson", date: "2026-11-02", miles: 35.5 },
    ]);
    expect(r.skipped).toBe(1);
  });

  it("the Mileage Record Keeping workbook (Daily Entry Revised)", () => {
    const r = parseMileageSheet([
      ["DAILY ENTRY  |  MILEAGE + PAYROLL VERIFICATION"],
      ["Enter one row per technician/day"],
      ["", "", "", "", "", "", "", "", "MOVE THIS COLUMN TO MANUAL/AHS"],
      ["Date", "Technician", "Branch", "Vehicle", "Total Miles", "Excluded", "Exclusion Reason", "Car IQ?", "Eligible Miles", "Rate / Mile", "Mileage Compensation", "Approval Status", "Approved By", "Payroll Status", "Payment Date", "Pay Period Start", "Ticket #", "Total Mile Map", "Eligible Mile Map", "Notes"],
      [new Date(2026, 10, 9), "Adejaun Tyson", "Columbus, GA", "Personal vehicle", 331.9, 10.7, "Other", "YES", 321.2, 0.2, 64.24, "Approved", "", "", "", "", "4708999530BL", "https://bit.ly/a", "https://bit.ly/b", "No notes, no photos"],
      [new Date(2026, 10, 8), "Alexxis Henry", "Savannah, GA", "Personal vehicle", 77.3, "", "", "YES", 77.3, 0.2, 15.46, "", "", "", "", "", "", "", "", ""],
      [new Date(2026, 10, 8), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ], YM)!;
    expect(r.layout).toBe("list");
    expect(r.skipped).toBe(0);
    expect(r.entries[0]).toEqual({
      name: "Adejaun Tyson", date: "2026-11-09", miles: 331.9, excludedMiles: 10.7, exclusionReason: "Other", vehicle: "Personal vehicle", branch: "Columbus, GA",
      ticketRefs: "4708999530BL", totalMapUrl: "https://bit.ly/a", eligibleMapUrl: "https://bit.ly/b", notes: "No notes, no photos", status: "approved",
    });
    expect(r.entries[1]).toMatchObject({ miles: 77.3, excludedMiles: 0 });
    expect(r.entries[1].status).toBeUndefined();
  });

  it("the older tabs: Counted Miles + Total Miles including excluded", () => {
    const r = parseMileageSheet([
      ["Date", "Technician", "Branch", "Vehicle", "Counted Miles", "Total Miles including excluded mileage", "Exclusion Reason", "Google Maps Link"],
      [new Date(2026, 9, 2), "Abraham Im", "Atlanta, GA", "Personal vehicle", 158.5, 165.5, "Missing photos", "https://x"],
      [new Date(2026, 9, 20), "Abraham Im", "Atlanta, GA", "Personal vehicle", 132.5, " ", "", ""],
    ], YM)!;
    expect(r.entries[0]).toMatchObject({ miles: 165.5, excludedMiles: 7, exclusionReason: "Missing photos", totalMapUrl: "https://x" });
    expect(r.entries[1]).toMatchObject({ miles: 132.5, excludedMiles: 0 });
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
