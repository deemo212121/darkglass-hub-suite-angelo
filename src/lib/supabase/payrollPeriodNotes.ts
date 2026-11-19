/**
 * Accounting's internal notes on one employee's pay period (migration 0465),
 * shown at the bottom of the Tech Activity Report. Author and time are
 * stamped by the database.
 */
import { supabase } from "./client";

export interface PayrollPeriodNote {
  id: string;
  body: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export async function getPayrollPeriodNotes(profileId: string, periodStart: string, periodEnd: string): Promise<PayrollPeriodNote[]> {
  const { data, error } = await supabase
    .from("payroll_period_notes")
    .select("id, body, created_by, created_by_name, created_at")
    .eq("profile_id", profileId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    body: r.body,
    createdBy: r.created_by ?? null,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
  }));
}

export async function addPayrollPeriodNote(profileId: string, periodStart: string, periodEnd: string, body: string): Promise<void> {
  const { error } = await supabase
    .from("payroll_period_notes")
    .insert({ profile_id: profileId, period_start: periodStart, period_end: periodEnd, body: body.trim() });
  if (error) throw new Error(error.message);
}

export async function deletePayrollPeriodNote(id: string): Promise<void> {
  const { error } = await supabase.from("payroll_period_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
