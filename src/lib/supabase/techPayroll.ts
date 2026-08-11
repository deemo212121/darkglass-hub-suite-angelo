/**
 * Tech Payroll — technicians are paid per completed repair ticket instead
 * of hourly. Pieces:
 *  - tech_repair_rates (migration 0120): the $ amount per repair_type,
 *    optionally overridden per branch. Edited on TechPayrollSetup.tsx. Also
 *    doubles as the rate table for the manual/auto-cross-reference
 *    categories below (LDT, Mileage, Training Paid, Two Tech, MCA
 *    Threshold, MCA Bonus), stored as ordinary repair_type rows.
 *  - getTechCompletedRepairCounts: counts completed visits per technician
 *    (grouped by repair_type + branch, so AccountingDashboard.tsx can look
 *    up each group's rate and multiply) within a payroll period.
 *  - getTechAssignedCounts: same period, but every assigned visit
 *    regardless of outcome — for the Assigned/Completed/Ratio columns.
 *  - getTechRedoTickets / getTechSecondCounts: the Tech Activity Report
 *    modal's Redo list and "Two Tech" (second_technician, migration 0126)
 *    cross-reference count.
 *  - tech_manual_pay_items (migration 0125): LDT count, mileage, training
 *    value, and OW Incentive % entered directly by Finance per technician
 *    per period — there's no ticket/visit data to auto-count these from.
 *  - tech_custom_pay_items (migration 0127): freeform "(custom program)"
 *    bonus lines, any number per technician per period.
 */

import { supabase } from "./client";
import { statusGroupOf } from "@/lib/ticketData";

/** repair_type value used as the fallback rate for a completed visit with no repair_type set. */
export const DEFAULT_REPAIR_TYPE = "Default Amount";

// Shared rate-table category lists — single source of truth for
// TechPayrollSetup.tsx's rate editor and TechActivityReportModal.tsx's
// per-category breakdown, so the two can never drift apart.

/** Matches the real "Repair Type" dropdown on a ticket's Visit Log (ticket.$ticketNo.tsx), plus DEFAULT_REPAIR_TYPE. */
export const REPAIR_TYPES = [
  DEFAULT_REPAIR_TYPE,
  "2 Man Job", "Back Tub", "Major Repair", "Panel 60 Over", "Panel 80 Over",
  "Seal with Trainee", "Sealed System", "Sealed System Follow Up",
  "Sealed System(R600)", "Stacked Unit(Washer Only)", "Wall Oven",
];
/**
 * A flat per-ticket rate paid on EVERY completed (redo-excluded) ticket, on
 * top of whatever its own repair_type category already pays — distinct from
 * DEFAULT_REPAIR_TYPE, which only applies to a completed visit with no
 * repair_type set at all. Shown as its own editable-rate line ("Completed
 * Tickets") on the Tech Activity Report modal.
 */
export const BASE_RATE_TYPES = ["Completed Tickets"];
/** Entered by Finance directly per technician per period (migration 0125) — not auto-counted from a completed visit's repair_type. */
export const MANUAL_PAY_TYPES = ["LDT", "Mileage", "Training Paid"];
/** Auto-counted like REPAIR_TYPES, but keyed off visits.second_technician (migration 0126) rather than repair_type. */
export const CROSS_REFERENCE_TYPES = ["Two Tech"];
/** "MCA Threshold" stores a plain minimum-completed-ticket count (not a dollar amount) in the same `amount` column; "MCA Bonus" is the flat $ paid when it's met. */
export const ACHIEVEMENT_BONUS_TYPES = ["MCA Threshold", "MCA Bonus"];

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

/**
 * Rate lookup shared by AccountingDashboard.tsx and TechActivityReportModal:
 * an exact (repair_type, branch) match wins; otherwise fall back to that
 * repair_type's "All Branches" rate; otherwise the branch's own "Default
 * Amount" rate; otherwise "Default Amount, All Branches"; otherwise $0 (no
 * rate configured yet — see TechPayrollSetup.tsx). repairType here covers
 * every rate-table-backed category: real repair types, LDT/Mileage/Training
 * Paid, "Two Tech", and the MCA Threshold/Bonus pair.
 */
export function techRateFor(rates: TechRepairRate[], repairType: string, branch: string): number {
  const exact = rates.find((r) => r.repairType === repairType && r.branch === branch);
  if (exact) return exact.amount;
  const anyBranch = rates.find((r) => r.repairType === repairType && !r.branch);
  if (anyBranch) return anyBranch.amount;
  const defaultForBranch = rates.find((r) => r.repairType === DEFAULT_REPAIR_TYPE && r.branch === branch);
  if (defaultForBranch) return defaultForBranch.amount;
  const defaultAny = rates.find((r) => r.repairType === DEFAULT_REPAIR_TYPE && !r.branch);
  return defaultAny ? defaultAny.amount : 0;
}

/**
 * Like upsertTechRepairRate, but resolves the exact row to edit the same way
 * techRateFor resolves which rate applies (exact → branch-fallback → default
 * chain) — used by the Tech Activity Report modal's inline-editable rate
 * cells, which edit "whichever rate is actually in effect" for that
 * category+branch rather than always creating a new branch-specific row.
 * Falls back to creating a new (repairType, branch) row scoped to the given
 * branch when nothing configured applies yet.
 */
export async function upsertResolvedTechRepairRate(
  rates: TechRepairRate[],
  repairType: string,
  branch: string,
  amount: number
): Promise<void> {
  const exact = rates.find((r) => r.repairType === repairType && r.branch === branch);
  const anyBranch = !exact ? rates.find((r) => r.repairType === repairType && !r.branch) : undefined;
  const resolved = exact ?? anyBranch;
  await upsertTechRepairRate({
    id: resolved?.id,
    repairType,
    branch: resolved ? resolved.branch : branch || null,
    amount,
  });
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
 * Redo tickets (tickets.redo — a manager-flagged re-dispatch of a prior
 * failed repair) don't count toward the technician's paid completed total,
 * same as the legacy per-tech payroll report's "Redo Reduction" line —
 * excluded outright here rather than counted then subtracted, since this
 * model pays per repair_type bucket rather than one flat completed-count rate.
 *
 * Also skips any ticket Finance has manually put on hold for payroll via the
 * Mileage tab's On Hold action (mileage_entries.payroll_excluded, migration
 * 0144) — stays excluded while on hold even though this ticket did
 * genuinely complete, but it's reversible (see setMileageEntryPayrollExcluded).
 *
 * visits has no branch/redo of its own (only its parent ticket does), so this
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
  const [{ data: ticketRows, error: tErr }, { data: excludedRows, error: exErr }] = await Promise.all([
    supabase.from("tickets").select("id, location, redo").in("id", ticketIds),
    // Tickets Finance has put on hold for payroll via the Mileage tab's On
    // Hold action (migration 0148) — while flagged, a ticket that's
    // genuinely completed still never counts toward pay, but it's
    // reversible. Same "skip this ticket_id" treatment as redo below.
    supabase.from("mileage_entries").select("ticket_id").eq("payroll_excluded", true).in("ticket_id", ticketIds),
  ]);
  if (tErr) console.error("getTechCompletedRepairCounts (ticket location) error:", tErr.message);
  if (exErr) console.error("getTechCompletedRepairCounts (payroll exclusions) error:", exErr.message);
  const locationByTicket = new Map((ticketRows ?? []).map((t: any) => [t.id, t.location || ""]));
  const redoByTicket = new Map((ticketRows ?? []).map((t: any) => [t.id, !!t.redo]));
  const excludedTicketIds = new Set((excludedRows ?? []).map((r: any) => r.ticket_id));

  const counts = new Map<string, TechRepairCount>();
  for (const r of completed as any[]) {
    if (redoByTicket.get(r.ticket_id)) continue;
    if (excludedTicketIds.has(r.ticket_id)) continue;
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

/** One redo'd ticket a technician's completed visit was excluded for — Tech Activity Report's Redo list. */
export interface TechRedoTicket {
  ticketId: string;
  ticketNo: string;
}

/**
 * The completed-but-redo-excluded tickets behind getTechCompletedRepairCounts'
 * "Redo Reduction" line — same query and same completed/redo rules, just
 * returning the excluded tickets themselves (with their ticket_no, for the
 * Tech Activity Report modal's clickable Redo list) instead of counting them
 * into a rate bucket.
 */
export async function getTechRedoTickets(startDate: string, endDate: string): Promise<Map<string, TechRedoTicket[]>> {
  const out = new Map<string, TechRedoTicket[]>();
  if (!startDate || !endDate) return out;
  const { data, error } = await supabase
    .from("visits")
    .select("ticket_id, technician, repair_status")
    .gte("schedule_date", startDate)
    .lte("schedule_date", endDate)
    .not("technician", "is", null);
  if (error) {
    console.error("getTechRedoTickets error:", error.message);
    return out;
  }
  const completed = (data ?? []).filter(
    (r: any) => String(r.technician || "").trim() && statusGroupOf(r.repair_status || "") === "completed"
  );
  if (completed.length === 0) return out;

  const ticketIds = Array.from(new Set(completed.map((r: any) => r.ticket_id).filter(Boolean)));
  const { data: ticketRows, error: tErr } = await supabase
    .from("tickets")
    .select("id, ticket_no, redo")
    .in("id", ticketIds);
  if (tErr) console.error("getTechRedoTickets (ticket lookup) error:", tErr.message);
  const ticketById = new Map((ticketRows ?? []).map((t: any) => [t.id, t]));

  const seen = new Set<string>();
  for (const r of completed as any[]) {
    const ticket = ticketById.get(r.ticket_id);
    if (!ticket?.redo) continue;
    const dedupeKey = `${String(r.technician).trim().toLowerCase()}|${r.ticket_id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const technician = String(r.technician).trim().toLowerCase();
    const list = out.get(technician) ?? [];
    list.push({ ticketId: ticket.id, ticketNo: ticket.ticket_no || "" });
    out.set(technician, list);
  }
  return out;
}

/**
 * How many completed visits within a period had this technician set as the
 * *second* (assisting) technician — visits.second_technician, migration
 * 0126 — for the Tech Activity Report's "Two Tech" line. Same
 * completed/redo-excluded rules as getTechCompletedRepairCounts, but keyed
 * off second_technician instead of technician, and not broken out by
 * repair_type/branch since "Two Tech" is a single flat rate.
 */
export async function getTechSecondCounts(startDate: string, endDate: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!startDate || !endDate) return counts;
  const { data, error } = await supabase
    .from("visits")
    .select("ticket_id, second_technician, repair_status")
    .gte("schedule_date", startDate)
    .lte("schedule_date", endDate)
    .not("second_technician", "is", null);
  if (error) {
    console.error("getTechSecondCounts error:", error.message);
    return counts;
  }
  const completed = (data ?? []).filter(
    (r: any) => String(r.second_technician || "").trim() && statusGroupOf(r.repair_status || "") === "completed"
  );
  if (completed.length === 0) return counts;

  const ticketIds = Array.from(new Set(completed.map((r: any) => r.ticket_id).filter(Boolean)));
  const { data: ticketRows, error: tErr } = await supabase.from("tickets").select("id, redo").in("id", ticketIds);
  if (tErr) console.error("getTechSecondCounts (ticket redo) error:", tErr.message);
  const redoByTicket = new Map((ticketRows ?? []).map((t: any) => [t.id, !!t.redo]));

  for (const r of completed as any[]) {
    if (redoByTicket.get(r.ticket_id)) continue;
    const technician = String(r.second_technician).trim().toLowerCase();
    counts.set(technician, (counts.get(technician) ?? 0) + 1);
  }
  return counts;
}

/** One ticket a primary technician had an assisting (second) technician on — Tech Activity Report's "2nd Tech" panel. */
export interface TechAssistedTicket {
  ticketId: string;
  ticketNo: string;
  secondTechnician: string;
}

/**
 * For each primary technician, the completed (redo-excluded) tickets within
 * a period where a second_technician assisted them — the inverse of
 * getTechSecondCounts (which counts from the assisting tech's side). Purely
 * informational on the Tech Activity Report modal; the assisting tech is
 * the one who earns "Two Tech" pay for these, not the primary.
 */
export async function getTechAssistedTickets(startDate: string, endDate: string): Promise<Map<string, TechAssistedTicket[]>> {
  const out = new Map<string, TechAssistedTicket[]>();
  if (!startDate || !endDate) return out;
  const { data, error } = await supabase
    .from("visits")
    .select("ticket_id, technician, second_technician, repair_status")
    .gte("schedule_date", startDate)
    .lte("schedule_date", endDate)
    .not("technician", "is", null)
    .not("second_technician", "is", null);
  if (error) {
    console.error("getTechAssistedTickets error:", error.message);
    return out;
  }
  const completed = (data ?? []).filter(
    (r: any) => String(r.second_technician || "").trim() && statusGroupOf(r.repair_status || "") === "completed"
  );
  if (completed.length === 0) return out;

  const ticketIds = Array.from(new Set(completed.map((r: any) => r.ticket_id).filter(Boolean)));
  const { data: ticketRows, error: tErr } = await supabase.from("tickets").select("id, ticket_no, redo").in("id", ticketIds);
  if (tErr) console.error("getTechAssistedTickets (ticket lookup) error:", tErr.message);
  const ticketById = new Map((ticketRows ?? []).map((t: any) => [t.id, t]));

  for (const r of completed as any[]) {
    const ticket = ticketById.get(r.ticket_id);
    if (!ticket || ticket.redo) continue;
    const technician = String(r.technician).trim().toLowerCase();
    const list = out.get(technician) ?? [];
    list.push({ ticketId: ticket.id, ticketNo: ticket.ticket_no || "", secondTechnician: String(r.second_technician).trim() });
    out.set(technician, list);
  }
  return out;
}

/**
 * Every visit assigned to a technician within a period, regardless of
 * outcome (completed, cancelled, still open) — for the Tech Payroll tab's
 * Assigned/Completed/Ratio/Avg. Comp. columns. Unlike
 * getTechCompletedRepairCounts this doesn't need repair_type/branch/redo
 * detail, just a per-technician total. Keyed by lowercased/trimmed
 * technician name — same free-text-match convention as everywhere else
 * visits.technician gets matched against a real profile (e.g.
 * AccountingDashboard.tsx's employeeByName).
 */
export async function getTechAssignedCounts(startDate: string, endDate: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!startDate || !endDate) return counts;
  const { data, error } = await supabase
    .from("visits")
    .select("technician")
    .gte("schedule_date", startDate)
    .lte("schedule_date", endDate)
    .not("technician", "is", null);
  if (error) {
    console.error("getTechAssignedCounts error:", error.message);
    return counts;
  }
  for (const r of (data ?? []) as any[]) {
    const technician = String(r.technician || "").trim().toLowerCase();
    if (!technician) continue;
    counts.set(technician, (counts.get(technician) ?? 0) + 1);
  }
  return counts;
}

/** One technician's manually-entered LDT/Mileage/Training/OW Incentive values for one payroll period. */
export interface TechManualPayItem {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  ldtCount: number;
  mileage: number;
  trainingValue: number;
  /** 0-100 — applied against the period's total payment on the Tech Activity Report modal. */
  owIncentivePct: number;
}

/** All manual pay items for the caller's company within a period (RLS-scoped). */
export async function getTechManualPayItems(periodStart: string, periodEnd: string): Promise<TechManualPayItem[]> {
  if (!periodStart || !periodEnd) return [];
  const { data, error } = await supabase
    .from("tech_manual_pay_items")
    .select("id, profile_id, period_start, period_end, ldt_count, mileage, training_value, ow_incentive_pct")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) {
    console.error("getTechManualPayItems error:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    profileId: r.profile_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    ldtCount: Number(r.ldt_count) || 0,
    mileage: Number(r.mileage) || 0,
    trainingValue: Number(r.training_value) || 0,
    owIncentivePct: Number(r.ow_incentive_pct) || 0,
  }));
}

/** Create or update one technician's manual pay item for a period (upsert on the profile_id+period unique key). */
export async function upsertTechManualPayItem(input: {
  profileId: string;
  periodStart: string;
  periodEnd: string;
  ldtCount: number;
  mileage: number;
  trainingValue: number;
  owIncentivePct: number;
}): Promise<void> {
  const { error } = await supabase.from("tech_manual_pay_items").upsert(
    {
      profile_id: input.profileId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      ldt_count: input.ldtCount,
      mileage: input.mileage,
      training_value: input.trainingValue,
      ow_incentive_pct: input.owIncentivePct,
    },
    { onConflict: "profile_id,period_start,period_end" }
  );
  if (error) throw new Error(error.message);
}

/** Clears one technician's manual pay item for a period back to zero (the "Delete" action on the Tech Payroll tab). */
export async function deleteTechManualPayItem(profileId: string, periodStart: string, periodEnd: string): Promise<void> {
  const { error } = await supabase
    .from("tech_manual_pay_items")
    .delete()
    .eq("profile_id", profileId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(error.message);
}

/** One freeform "(custom program)" bonus line on the Tech Activity Report modal. */
export interface TechCustomPayItem {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  label: string;
  value: number;
  rate: number;
}

/** All custom pay lines for one technician's period (RLS-scoped), in display order. */
export async function getTechCustomPayItems(
  profileId: string,
  periodStart: string,
  periodEnd: string
): Promise<TechCustomPayItem[]> {
  if (!profileId || !periodStart || !periodEnd) return [];
  const { data, error } = await supabase
    .from("tech_custom_pay_items")
    .select("id, profile_id, period_start, period_end, label, value, rate")
    .eq("profile_id", profileId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getTechCustomPayItems error:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    profileId: r.profile_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    label: r.label ?? "",
    value: Number(r.value) || 0,
    rate: Number(r.rate) || 0,
  }));
}

/** Add a new blank custom pay line for a technician's period. */
export async function addTechCustomPayItem(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  sortOrder: number
): Promise<TechCustomPayItem> {
  const { data, error } = await supabase
    .from("tech_custom_pay_items")
    .insert({ profile_id: profileId, period_start: periodStart, period_end: periodEnd, sort_order: sortOrder })
    .select("id, profile_id, period_start, period_end, label, value, rate")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    profileId: data.profile_id,
    periodStart: data.period_start,
    periodEnd: data.period_end,
    label: data.label ?? "",
    value: Number(data.value) || 0,
    rate: Number(data.rate) || 0,
  };
}

/** Update one custom pay line's label/value/rate. */
export async function updateTechCustomPayItem(
  id: string,
  fields: { label?: string; value?: number; rate?: number }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.label !== undefined) update.label = fields.label;
  if (fields.value !== undefined) update.value = fields.value;
  if (fields.rate !== undefined) update.rate = fields.rate;
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase.from("tech_custom_pay_items").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Remove one custom pay line. */
export async function deleteTechCustomPayItem(id: string): Promise<void> {
  const { error } = await supabase.from("tech_custom_pay_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Finance's manual correction of an auto-counted category (a REPAIR_TYPES
 * entry or "Two Tech") for one technician/period, when the live count from
 * visits data is wrong or incomplete — migration 0133. When present, this
 * takes precedence over the live count everywhere that category's pay is
 * computed, both on the Tech Activity Report and the main Tech Payroll
 * table's Total Net.
 */
export interface TechCategoryOverride {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  category: string;
  count: number;
}

/** All category overrides for the caller's company within a period (RLS-scoped) — bulk fetch for the main Tech Payroll table. */
export async function getTechCategoryOverrides(periodStart: string, periodEnd: string): Promise<TechCategoryOverride[]> {
  if (!periodStart || !periodEnd) return [];
  const { data, error } = await supabase
    .from("tech_category_overrides")
    .select("id, profile_id, period_start, period_end, category, count")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) {
    console.error("getTechCategoryOverrides error:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    profileId: r.profile_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    category: r.category,
    count: Number(r.count) || 0,
  }));
}

/** Create or update one technician's category-count override for a period (upsert on the profile_id+period+category unique key). */
export async function upsertTechCategoryOverride(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  category: string,
  count: number
): Promise<void> {
  const { error } = await supabase.from("tech_category_overrides").upsert(
    { profile_id: profileId, period_start: periodStart, period_end: periodEnd, category, count },
    { onConflict: "profile_id,period_start,period_end,category" }
  );
  if (error) throw new Error(error.message);
}
