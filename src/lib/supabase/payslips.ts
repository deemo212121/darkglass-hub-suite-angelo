/**
 * Real payslip data for the Employee Self-Service "My Payroll" tab — reads
 * payroll_line_items (one row per employee per generated payroll_runs run),
 * joined client-side with the run's period dates.
 */

import { supabase } from "./client";

export interface MyPayslipRow {
  runId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  generatedAt: string | null;
  hoursWorked: number;
  overtimeHours: number;
  hourlyRate: number;
  regularPay: number;
  overtimePay: number;
  grossPay: number;
  netPay: number;
  currency: string;
}

/** All payslips generated for this employee (profileId), newest first. */
export async function getMyPayslips(profileId: string): Promise<MyPayslipRow[]> {
  if (!profileId) return [];
  const { data: lineItems, error: liErr } = await supabase
    .from("payroll_line_items")
    .select("payroll_run_id, hours_worked, overtime_hours, hourly_rate, regular_pay, overtime_pay, gross_pay, net_pay, currency")
    .eq("profile_id", profileId);
  if (liErr) {
    console.error("getMyPayslips error:", liErr.message);
    return [];
  }
  if (!lineItems || lineItems.length === 0) return [];

  const runIds = Array.from(new Set(lineItems.map((li: any) => li.payroll_run_id)));
  const { data: runs, error: runErr } = await supabase
    .from("payroll_runs")
    .select("id, period_start, period_end, status, generated_at")
    .in("id", runIds);
  if (runErr) {
    console.error("getMyPayslips runs error:", runErr.message);
    return [];
  }

  const runById = new Map((runs ?? []).map((r: any) => [r.id, r]));
  return lineItems
    .map((li: any): MyPayslipRow | null => {
      const run = runById.get(li.payroll_run_id);
      if (!run) return null;
      return {
        runId: li.payroll_run_id,
        periodStart: run.period_start,
        periodEnd: run.period_end,
        status: run.status,
        generatedAt: run.generated_at,
        hoursWorked: Number(li.hours_worked) || 0,
        overtimeHours: Number(li.overtime_hours) || 0,
        hourlyRate: Number(li.hourly_rate) || 0,
        regularPay: Number(li.regular_pay) || 0,
        overtimePay: Number(li.overtime_pay) || 0,
        grossPay: Number(li.gross_pay) || 0,
        netPay: Number(li.net_pay) || 0,
        currency: li.currency || "USD",
      };
    })
    .filter((r): r is MyPayslipRow => r !== null)
    .sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));
}
