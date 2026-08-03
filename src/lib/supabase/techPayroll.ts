/**
 * Tech Payroll — technicians are paid per completed repair ticket instead
 * of hourly. Two pieces:
 *  - tech_repair_rates (migration 0120): the $ amount per repair_type,
 *    optionally overridden per branch. Edited on TechPayrollSetup.tsx.
 *  - getTechCompletedRepairCounts: counts completed visits per technician
 *    (grouped by repair_type + branch, so AccountingDashboard.tsx can look
 *    up each group's rate and multiply) within a payroll period.
 */

import { supabase } from "./client";
import { statusGroupOf } from "@/lib/ticketData";

/** repair_type value used as the fallback rate for a completed visit with no repair_type set. */
export const DEFAULT_REPAIR_TYPE = "Default Amount";

export interface TechRepairRate {
  id: string;
  repairType: string;
  /** null = applies to every branch. */
  branch: string | null;
  amount: number;
}

/** All tech repair rates for the caller's company (RLS-scoped). */
export async function getTechRepairRates(): Promise<TechRepairRate[]> {
  const { data, error } = await supabase
    .from("tech_repair_rates")
    .select("id, repair_type, branch, amount")
    .order("repair_type", { ascending: true });
  if (error) {
    console.error("getTechRepairRates error:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    repairType: r.repair_type,
    branch: r.branch ?? null,
    amount: Number(r.amount) || 0,
  }));
}

/** Create or update one (repair_type, branch) rate. Pass `id` to update an existing row. */
export async function upsertTechRepairRate(input: {
  id?: string;
  repairType: string;
  branch: string | null;
  amount: number;
}): Promise<void> {
  if (input.id) {
    const { error } = await supabase
      .from("tech_repair_rates")
      .update({ repair_type: input.repairType, branch: input.branch, amount: input.amount, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("tech_repair_rates")
    .insert({ repair_type: input.repairType, branch: input.branch, amount: input.amount });
  if (error) throw new Error(error.message);
}

export async function deleteTechRepairRate(id: string): Promise<void> {
  const { error } = await supabase.from("tech_repair_rates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** One technician's completed-repair count for one repair_type + branch combo within a period. */
export interface TechRepairCount {
  technician: string;
  repairType: string;
  /** The completed visit's ticket's branch (tickets.location) — "" if unset. */
  branch: string;
  count: number;
}

/**
 * Completed-repair counts per technician for a payroll period, grouped by
 * repair_type + branch so the caller can look up each group's rate and
 * multiply by count. "Completed" mirrors statusGroupOf's "completed" bucket
 * (the same rule every other "is this ticket done" check in the app uses),
 * checked against the VISIT's own repair_status (not the parent ticket's
 * status, since a ticket can have several visits and only this one is the
 * technician's own completed work). Dated by schedule_date — the day the
 * work actually happened, same convention getCsrVisitDatesByTicketIds uses.
 *
 * visits has no branch of its own (only its parent ticket does), so this
 * does the same two-step "fetch, then join by ticket_id via a Map" pattern
 * as getLatestVisitTechnicianByTicketIds/getVisitsByTicketIds instead of a
 * PostgREST embed (no embed pattern is used anywhere else in this file for
 * visits->tickets).
 */
export async function getTechCompletedRepairCounts(
  startDate: string,
  endDate: string
): Promise<TechRepairCount[]> {
  if (!startDate || !endDate) return [];
  const { data, error } = await supabase
    .from("visits")
    .select("ticket_id, technician, repair_type, repair_status")
    .gte("schedule_date", startDate)
    .lte("schedule_date", endDate)
    .not("technician", "is", null);
  if (error) {
    console.error("getTechCompletedRepairCounts error:", error.message);
    return [];
  }
  const completed = (data ?? []).filter(
    (r: any) => String(r.technician || "").trim() && statusGroupOf(r.repair_status || "") === "completed"
  );
  if (completed.length === 0) return [];

  const ticketIds = Array.from(new Set(completed.map((r: any) => r.ticket_id).filter(Boolean)));
  const { data: ticketRows, error: tErr } = await supabase
    .from("tickets")
    .select("id, location")
    .in("id", ticketIds);
  if (tErr) console.error("getTechCompletedRepairCounts (ticket location) error:", tErr.message);
  const locationByTicket = new Map((ticketRows ?? []).map((t: any) => [t.id, t.location || ""]));

  const counts = new Map<string, TechRepairCount>();
  for (const r of completed as any[]) {
    const technician = String(r.technician).trim();
    const repairType = String(r.repair_type || "").trim() || DEFAULT_REPAIR_TYPE;
    const branch = locationByTicket.get(r.ticket_id) || "";
    const key = `${technician}|${repairType}|${branch}`;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { technician, repairType, branch, count: 1 });
  }
  return Array.from(counts.values());
}
