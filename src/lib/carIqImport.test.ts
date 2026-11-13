import { describe, expect, it } from "vitest";
import { excelDate, groupByDriver, matchDriver, parseCarIqReport, totalsByBranch, totalsByBranchAndMonth, type CarIqPerson } from "./carIqImport";

const summary = [
  ["", "", "Transaction Report"],
  ["Start Date", "", "2026-10-14"],
  ["End Date", "", "2026-11-13"],
];
const tx = (first: string, last: string, total: number | string, city = "MEMPHIS", state = "TN", currency = "USD") => ({
  "DRIVER FIRST NAME": first, "DRIVER LAST NAME": last, TOTAL: total, CURRENCY: currency,
  "LOCAL DATE": 46309, "MERCHANT CITY": city, "MERCHANT STATE": state, "VEHICLE GROUP NAME": "",
});

describe("parseCarIqReport", () => {
  it("reads the period and every USD transaction's TOTAL", () => {
    const r = parseCarIqReport(summary, [tx("BRADLEY", "HOLLOWELL", 60), tx("RICO ", "SHAW", 38.66), tx("X", "Y", ""), tx("A", "B", 5, "X", "Y", "CAD")]);
    expect(r.periodStart).toBe("2026-10-14");
    expect(r.periodEnd).toBe("2026-11-13");
    expect(r.transactions.map((t) => [t.driver, t.total])).toEqual([["BRADLEY HOLLOWELL", 60], ["RICO SHAW", 38.66]]);
    expect(r.skipped).toBe(2);
    expect(r.transactions[0].date).toBe("2026-10-14");
  });
  it("turns Excel day numbers into dates", () => {
    expect(excelDate(46309)).toBe("2026-10-14");
  });
});

const people: CarIqPerson[] = [
  { name: "Bradley J. Hollowell", branch: "Jacksonville", isActive: true },
  { name: "Rico Shaw", branch: "Memphis", isActive: true },
  { name: "Rico Shaw", branch: "Atlanta", isActive: false },
  { name: "Danny Thornton", branch: "Jackson, MS", isActive: true },
  { name: "Dan Thomas", branch: "Raleigh", isActive: true },
];

describe("matchDriver", () => {
  it("matches first + last name, ignoring middle names and case", () => {
    expect(matchDriver("BRADLEY HOLLOWELL", people)?.branch).toBe("Jacksonville");
  });
  it("prefers the active person when names repeat", () => {
    expect(matchDriver("RICO SHAW", people)?.branch).toBe("Memphis");
  });
  it("falls back to last name + first initial only when one person fits", () => {
    expect(matchDriver("D. THORNTON", people)?.branch).toBe("Jackson, MS");
    expect(matchDriver("NOBODY HERE", people)).toBeNull();
  });
});

describe("totalsByBranchAndMonth", () => {
  it("splits a report that crosses months by each transaction's date", () => {
    const at = (day: number, total: number) => ({ ...tx("RICO", "SHAW", total), "LOCAL DATE": 46309 + day }); // 46309 = Oct 14
    const report = parseCarIqReport(summary, [at(0, 10), at(17, 20), at(18, 5), at(30, 7)]); // Oct 14, Oct 31, Nov 1, Nov 13
    const out = totalsByBranchAndMonth(report, () => "Memphis");
    expect(out.map((o) => [o.month, o.total, o.count, o.periodStart, o.periodEnd])).toEqual([
      ["2026-10", 30, 2, "2026-10-14", "2026-10-31"],
      ["2026-11", 12, 2, "2026-11-01", "2026-11-13"],
    ]);
    expect(totalsByBranchAndMonth(report, () => "")).toEqual([]);
  });
});

describe("groupByDriver + totalsByBranch", () => {
  it("sums each driver, then each branch; unmatched drivers get a station guess", () => {
    const report = parseCarIqReport(summary, [
      tx("RICO", "SHAW", 38.66), tx("RICO", "SHAW", 20.01),
      tx("BRADLEY", "HOLLOWELL", 60, "ORANGE PARK", "FL"),
      tx("TYREASE", "SMITH", 26.98, "HUNTSVILLE", "AL"),
      tx("NEW", "GUY", 10, "NOWHERE", "ZZ"),
    ]);
    const rows = groupByDriver(report, people, [{ branch: "Huntsville", city: "Huntsville", state: "AL" }]);
    const byName = Object.fromEntries(rows.map((r) => [r.driver, r]));
    expect(byName["RICO SHAW"]).toMatchObject({ count: 2, total: 58.67, branch: "Memphis", source: "profile" });
    expect(byName["TYREASE SMITH"]).toMatchObject({ branch: "Huntsville", source: "station" });
    expect(byName["NEW GUY"]).toMatchObject({ branch: "", source: "none" });
    const totals = totalsByBranch(rows);
    expect(totals.find((t) => t.branch === "Memphis")).toMatchObject({ total: 58.67, count: 2 });
    expect(totals.some((t) => t.branch === "")).toBe(false);
  });
});
