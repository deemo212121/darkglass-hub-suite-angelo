import { describe, expect, it } from "vitest";
import { buildPayrollFill, payrollBillLine, payrollNote, type PayrollPay } from "./branchPayroll";

const pay = (id: string, over: Partial<PayrollPay> = {}): PayrollPay => ({
  id, periodStart: "2026-11-09", periodEnd: "2026-11-22", profileId: id, name: `P${id}`, branch: "Memphis", group: "TECH", amount: 1000, ...over,
});

describe("buildPayrollFill", () => {
  const pays = [
    pay("1"), pay("2", { amount: 500.5 }),
    pay("3", { periodStart: "2026-10-26", periodEnd: "2026-11-08" }),
    pay("4", { periodStart: "2026-10-12", periodEnd: "2026-10-25" }),
    pay("5", { group: "US", amount: 2000 }),
    pay("6", { group: "PH", amount: 300 }),
    pay("7", { group: "MX" }),
    pay("8", { branch: "Atlanta" }),
    pay("9", { amount: 0 }),
  ];
  it("groups each line by pay period, counting a period in the month it ends", () => {
    const out = buildPayrollFill(pays, "memphis", "2026-11", new Set());
    expect(out.tech_payroll.map((x) => [x.start, x.end, x.total, x.pays.length])).toEqual([
      ["2026-10-26", "2026-11-08", 1000, 1],
      ["2026-11-09", "2026-11-22", 1500.5, 2],
    ]);
    expect(out.us_office_payroll.map((x) => x.total)).toEqual([2000]);
    expect(out.ph_office_payroll.map((x) => x.total)).toEqual([300]);
    // Oct 26 – Nov 8 is November's only — October doesn't get it too.
    expect(buildPayrollFill(pays, "Memphis", "2026-10", new Set()).tech_payroll.map((x) => x.end)).toEqual(["2026-10-25"]);
  });
  it("skips pay already saved in a bill", () => {
    const used = new Set([payrollBillLine(pays[0]).sourceId!]);
    const out = buildPayrollFill(pays, "Memphis", "2026-11", used);
    expect(out.tech_payroll[1]).toMatchObject({ total: 500.5 });
    expect(payrollNote(out.tech_payroll[1])).toBe("From payroll: 1 person");
  });
});
