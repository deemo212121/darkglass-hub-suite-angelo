/**
 * Payroll adjustments (migration 0393) — reimbursements (+) and deductions
 * (−) for one employee in one pay period, entered on Accounting → Payroll's
 * employee popup. For PH payroll (everyone) and US Office staff (Parts
 * Manager, Parts Team Leader, Parts, Admin-level) — not technicians, who
 * have their own custom pay lines (techPayroll.ts's tech_custom_pay_items).
 */
import { supabase } from "./client";
import { normalizeRole } from "@/lib/roleLabels";

export type PayrollAdjustmentKind = "reimbursement" | "deduction";

export interface PayrollAdjustment {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  kind: PayrollAdjustmentKind;
  description: string;
  amount: number;
}

/** Just what a payslip / payroll line item needs to show each line. */
export type PayrollAdjustmentLine = Pick<PayrollAdjustment, "kind" | "description" | "amount">;

const COLUMNS = "id, profile_id, period_start, period_end, kind, description, amount";

function mapRow(r: any): PayrollAdjustment {
  return {
    id: r.id,
    profileId: r.profile_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    kind: r.kind === "deduction" ? "deduction" : "reimbursement",
    description: r.description ?? "",
    amount: Number(r.amount) || 0,
  };
}

/** Everyone's adjustments for exactly this pay period (RLS-scoped to the company). Empty if 0393 isn't run yet. */
export async function getPayrollAdjustmentsForPeriod(periodStart: string, periodEnd: string): Promise<PayrollAdjustment[]> {
  const { data, error } = await supabase
    .from("payroll_adjustments")
    .select(COLUMNS)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("getPayrollAdjustmentsForPeriod:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

export async function addPayrollAdjustment(input: {
  profileId: string;
  periodStart: string;
  periodEnd: string;
  kind: PayrollAdjustmentKind;
  description: string;
  amount: number;
  createdByName?: string | null;
}): Promise<PayrollAdjustment> {
  const { data, error } = await supabase
    .from("payroll_adjustments")
    .insert({
      profile_id: input.profileId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      kind: input.kind,
      description: input.description.trim(),
      amount: Math.round(Math.abs(input.amount) * 100) / 100,
      created_by_name: input.createdByName ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    throw new Error(/payroll_adjustments/.test(error.message) ? "Adjustments need migration 0393 — run it in the Supabase SQL Editor first." : error.message);
  }
  return mapRow(data);
}

export async function updatePayrollAdjustment(id: string, fields: { kind: PayrollAdjustmentKind; description: string; amount: number }): Promise<void> {
  const { error } = await supabase
    .from("payroll_adjustments")
    .update({ kind: fields.kind, description: fields.description.trim(), amount: Math.round(Math.abs(fields.amount) * 100) / 100 })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePayrollAdjustment(id: string): Promise<void> {
  const { error } = await supabase.from("payroll_adjustments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reimbursements, deductions and the net change (reimbursements − deductions). */
export function sumPayrollAdjustments(lines: PayrollAdjustmentLine[] | null | undefined): { reimbursements: number; deductions: number; net: number } {
  let reimbursements = 0;
  let deductions = 0;
  for (const l of lines ?? []) {
    if (l.kind === "deduction") deductions += l.amount;
    else reimbursements += l.amount;
  }
  return { reimbursements, deductions, net: reimbursements - deductions };
}

const US_OFFICE_ADJUSTMENT_ROLES = new Set(["PARTS_MANAGER", "PARTS_TEAM_LEADER", "PARTS", "FINANCE", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);

/**
 * Who gets adjustments: everyone on PH payroll; on US payroll only Office
 * staff — Parts Manager, Parts Team Leader, Parts, Accounting, Admin-level (primary or
 * extra role). Never a technician / anyone with a Tech Activity Report.
 */
export function payrollAdjustmentsEligible(emp: { country?: string | null; role?: string | null; extraRoles?: string[] | null }, isTechnician: boolean): boolean {
  if (isTechnician) return false;
  if (emp.country === "PH") return true;
  return [emp.role, ...(emp.extraRoles ?? [])].some((r) => US_OFFICE_ADJUSTMENT_ROLES.has(normalizeRole(r)));
}
