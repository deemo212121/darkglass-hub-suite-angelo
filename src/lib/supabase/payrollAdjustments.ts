/**
 * Payroll adjustments (migrations 0386 + 0387) — reimbursements (+),
 * deductions (−) and tax (a % of gross pay, −) for one employee in one pay period, entered on Accounting → Payroll's
 * employee popup. For PH payroll (everyone) and US Office staff (Parts
 * Manager, Parts Team Leader, Parts, Admin-level) — not technicians, who
 * have their own custom pay lines (techPayroll.ts's tech_custom_pay_items).
 */
import { supabase } from "./client";
import { normalizeRole } from "@/lib/roleLabels";

export type PayrollAdjustmentKind = "reimbursement" | "deduction" | "tax";

export interface PayrollAdjustment {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  kind: PayrollAdjustmentKind;
  description: string;
  /** For tax: the last worked-out amount (use resolveAdjustmentLines with the current gross). */
  amount: number;
  /** Tax only — e.g. 13 for 13% of gross pay (migration 0387). */
  percent: number | null;
}

/** Just what a payslip / payroll line item needs to show each line. */
export type PayrollAdjustmentLine = Pick<PayrollAdjustment, "kind" | "description" | "amount"> & { percent?: number | null };

const COLUMNS_BASE = "id, profile_id, period_start, period_end, kind, description, amount";
const COLUMNS = COLUMNS_BASE + ", percent";
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function mapRow(r: any): PayrollAdjustment {
  return {
    id: r.id,
    profileId: r.profile_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    kind: r.kind === "deduction" ? "deduction" : r.kind === "tax" ? "tax" : "reimbursement",
    description: r.description ?? "",
    amount: Number(r.amount) || 0,
    percent: r.percent != null ? Number(r.percent) : null,
  };
}

/** Everyone's adjustments for exactly this pay period (RLS-scoped to the company). Empty if 0386 isn't run yet. */
export async function getPayrollAdjustmentsForPeriod(periodStart: string, periodEnd: string): Promise<PayrollAdjustment[]> {
  const run = (cols: string) =>
    supabase.from("payroll_adjustments").select(cols).eq("period_start", periodStart).eq("period_end", periodEnd).order("created_at", { ascending: true });
  let { data, error } = await run(COLUMNS);
  // Before 0387 there's no percent column — load the lines without it.
  if (error && /percent/.test(error.message)) ({ data, error } = await run(COLUMNS_BASE));
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
  /** Tax only. */
  percent?: number | null;
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
      amount: round2(Math.abs(input.amount)),
      ...(input.kind === "tax" ? { percent: input.percent ?? 0 } : {}),
      created_by_name: input.createdByName ?? null,
    })
    .select(input.kind === "tax" ? COLUMNS : COLUMNS_BASE)
    .single();
  if (error) {
    throw new Error(
      /percent|kind_check/.test(error.message)
        ? "Tax lines need migration 0387 — run it in the Supabase SQL Editor first."
        : /payroll_adjustments/.test(error.message)
          ? "Adjustments need migration 0386 — run it in the Supabase SQL Editor first."
          : error.message
    );
  }
  return mapRow(data);
}

export async function updatePayrollAdjustment(id: string, fields: { kind: PayrollAdjustmentKind; description: string; amount: number; percent?: number | null }): Promise<void> {
  const { error } = await supabase
    .from("payroll_adjustments")
    .update({
      kind: fields.kind,
      description: fields.description.trim(),
      amount: round2(Math.abs(fields.amount)),
      ...(fields.kind === "tax" ? { percent: fields.percent ?? 0 } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(/percent|kind_check/.test(error.message) ? "Tax lines need migration 0387 — run it in the Supabase SQL Editor first." : error.message);
}

export async function deletePayrollAdjustment(id: string): Promise<void> {
  const { error } = await supabase.from("payroll_adjustments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Lines with each Tax line's amount worked out from this gross pay
 * (gross × percent / 100, to 3 decimals). Without a gross, a tax
 * line keeps its last saved amount.
 */
export function resolveAdjustmentLines<T extends PayrollAdjustmentLine>(lines: T[] | null | undefined, grossPay?: number | null): T[] {
  return (lines ?? []).map((l) =>
    l.kind === "tax" && grossPay != null ? { ...l, amount: round3(Math.max(0, grossPay) * ((l.percent ?? 0) / 100)) } : l
  );
}

/**
 * Reimbursements, deductions, tax and the net change (reimbursements −
 * deductions − tax). Pass the gross pay so tax lines use the current gross.
 */
export function sumPayrollAdjustments(
  lines: PayrollAdjustmentLine[] | null | undefined,
  grossPay?: number | null
): { reimbursements: number; deductions: number; tax: number; net: number } {
  let reimbursements = 0;
  let deductions = 0;
  let tax = 0;
  for (const l of resolveAdjustmentLines(lines, grossPay)) {
    if (l.kind === "deduction") deductions += l.amount;
    else if (l.kind === "tax") tax += l.amount;
    else reimbursements += l.amount;
  }
  return { reimbursements, deductions, tax, net: round3(reimbursements - deductions - tax) };
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
