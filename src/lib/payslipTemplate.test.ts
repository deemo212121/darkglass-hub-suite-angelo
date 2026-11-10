import { describe, expect, it, vi } from "vitest";
vi.mock("./supabase/client", () => ({ supabase: {} }));
import { renderPayslipBodyHtml, type EmployeePayslipData } from "./payslipTemplate";

const employee: EmployeePayslipData = {
  name: "Test Employee", department: "Admin", period: "2026-10-25 to 2026-11-07",
  generatedDate: "November 10, 2026", email: "test@example.com", hireDate: "2026-05-19",
  workingHoursLabel: "8:00 AM - 4:00 PM", breakLabel: "30 mins Break",
  compensationType: "fixed", annualSalary: 17000, hourlyRate: 0,
  dailyRows: [{ date: "2026-10-26", clockIn: "08:00:00", clockOut: "16:00:00", mealStart: "12:00:00", mealEnd: "12:30:00", hours: 7.5, rate: 0, amount: 0 }],
  counts: 1, totalHours: 7.5, average: 7.5, offDays: 4, ptoUsed: 0, sickLeave: 0,
  totalDays: 4, grossPay: 653.85, netPay: 653.85, extraPay: 0, notes: "", isUS: false,
};

describe("fixed-salary payslip attendance", () => {
  it("shows attendance and duty hours without representing salary as zero hourly earnings", () => {
    const html = renderPayslipBodyHtml(employee);
    expect(html).toContain("2026-10-26");
    expect(html).toContain("7.500");
    expect(html).toContain("Fixed salary");
    expect(html).toContain("Fixed Salary Total");
    expect(html).toContain("$653.85");
    expect(html).not.toContain("No daily attendance recorded");
    expect(html).not.toContain('<td class="amount">$0.00</td>');
  });
  it("preserves hourly daily earnings", () => {
    const html = renderPayslipBodyHtml({ ...employee, compensationType: "hourly", annualSalary: null, hourlyRate: 6,
      dailyRows: [{ ...employee.dailyRows[0], rate: 6, amount: 45 }], grossPay: 45, netPay: 45 });
    expect(html).toContain('<td class="amount">$6.00</td>');
    expect(html).toContain('<td class="amount">$45.00</td>');
    expect(html).not.toContain("Fixed Salary Total");
  });
});
