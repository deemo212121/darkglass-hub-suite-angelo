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
 *  - getTechAssignedCounts: same period, but every assigned ticket
 *    regardless of outcome — for the Assigned/Completed/Ratio columns.
 *  - getTechRedoTickets / getTechOnHoldTickets / getTechSecondCounts: the
 *    Tech Activity Report modal's Redo and On Hold lists, and "Two Tech"
 *    (second_technician, migration 0126) cross-reference count.
 *  - tech_manual_pay_items (migration 0125): LDT count, mileage, training
 *    value, and OW Incentive % entered directly by Finance per technician
 *    per period — there's no ticket/visit data to auto-count these from.
 *  - tech_custom_pay_items (migration 0127): freeform "(custom program)"
 *    bonus lines, any number per technician per period.
 */

import { supabase } from "./client";
import { mileageEffectiveTotal } from "./mileage";

/** repair_type value used as the fallback rate for a completed visit with no repair_type set. */
export const DEFAULT_REPAIR_TYPE = "Default Amount";

/**
 * The single "is this ticket done, for pay purposes" gate used everywhere in
 * this file — a ticket's own current status has actually reached CLAIMED or
 * READY TO COMPLETE (RTC). Deliberately narrower than ticketData.ts's
 * statusGroupOf (which also treats CL-Completed/Data-Closed as "completed"
 * and buckets RTC under "open" for dashboard/filter purposes) — for payroll
 * specifically, RTC is the point the technician's own part of the job is
 * done, so it counts even before the back office finishes claims/data-close.
 * Not a timestamp check: a ticket at one of these statuses counts as done
 * whether or not the technician managed to stamp an on-site check-in. A
 * technician who did the work but the status never got updated has to file
 * a Ticket Time Dispute with photos instead of this silently falling back
 * to raw timestamps, which is exactly the ambiguity a status-based ticket
 * of record avoids.
 */
function isCompletedStatus(status: string): boolean {
  const v = String(status || "").trim().toLowerCase();
  return v === "cl-claimed" || v === "claimed" || v === "cl-ready to complete" || v === "ready to complete";
}

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
 * Flat per-ticket rates shown as their own editable-rate lines on the Tech
 * Activity Report modal, each also configurable on TechPayrollSetup.tsx:
 *  - "Completed Tickets": paid on EVERY completed (redo/on-hold-excluded)
 *    ticket, on top of whatever its own repair_type category already pays —
 *    distinct from DEFAULT_REPAIR_TYPE, which only applies to a completed
 *    visit with no repair_type set at all.
 *  - "Redo Reduction": an optional consolation rate paid per redo ticket
 *    (getTechRedoTickets) — 0 by default (see techRateFor's fallback chain),
 *    since a redo already doesn't count toward Completed Tickets at all;
 *    this exists only for a company that wants to pay something for the
 *    trip out even on a re-dispatch.
 */
export const BASE_RATE_TYPES = ["Completed Tickets", "Redo Reduction"];
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

// Supabase caps an unbounded select at 1000 rows — a single semi-monthly
// payroll period's visits for a whole company can exceed that. Page
// through in chunks of 1000.
const PAGE_SIZE = 1000;

/**
 * One "this technician did this ticket" completion candidate — the shared
 * pool behind getTechCompletedRepairCounts / getTechRedoTickets /
 * getTechOnHoldTickets, so the three can never drift on what counts as
 * "completed" (see the SP-sync stale-stamp fix in tickets.ts for a concrete
 * example of what happens when two "is this done" checks quietly disagree).
 */
interface TechCompletedCandidate {
  ticketId: string;
  ticketNo: string;
  technician: string;
  /** From the ticket's latest Visit Log entry, when one exists — DEFAULT_REPAIR_TYPE otherwise. Categorization only; completion itself is isCompletedStatus(ticket.status), not this. */
  repairType: string;
  /** The ticket's branch (tickets.location) — "" if unset. */
  location: string;
  redo: boolean;
  /** On hold for payroll via the Mileage tab (mileage_entries.payroll_excluded, migration 0144/0148) — manual or the automatic "no photos yet" rule. */
  onHold: boolean;
}

/**
 * Every technician-ticket completion within a period — a ticket, currently
 * assigned to that technician (tickets.technician/location/redo/status, the
 * ticket of record, not a possibly-stale Visit Log copy), whose own status
 * has reached CLAIMED or READY TO COMPLETE (see isCompletedStatus). Not a
 * Visit Log repair_status check and not on-site check-in timestamps — a
 * ticket only counts once, no matter how many visits were logged against it,
 * since it can only hold one status at a time; that's also a behavior change
 * from the old per-completed-visit counting, deliberately, since paying out
 * for the same ticket twice because two visits each individually got marked
 * complete was never actually two separate repairs.
 *
 * Visit Log entries are still consulted, but ONLY for repair_type
 * categorization (Major Repair, Panel 60/80 Over, etc.) on the qualifying
 * tickets found above — the LATEST visit per ticket by created_at, since a
 * ticket can have an earlier diagnostic visit and a later one that's the
 * real category. A qualifying ticket with no Visit Log entry at all still
 * counts, just under DEFAULT_REPAIR_TYPE.
 *
 * Dated by schedule_date — the day the work actually happened, same
 * convention getCsrVisitDatesByTicketIds uses.
 *
 * Each candidate carries (not filters out) whether its ticket is a redo or
 * on hold for payroll — callers decide what to do with that: pay counts
 * exclude both, the Redo/On Hold lists surface exactly the ones excluded for
 * that reason so the exclusion is never an invisible gap in the totals.
 */
async function getTechCompletedCandidates(startDate: string, endDate: string): Promise<TechCompletedCandidate[]> {
  if (!startDate || !endDate) return [];
  const ticketRows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("tickets")
      .select("id, ticket_no, technician, location, redo, status")
      .gte("schedule_date", startDate)
      .lte("schedule_date", endDate)
      .not("technician", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getTechCompletedCandidates (tickets) error:", error.message);
      return [];
    }
    ticketRows.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  const completedTickets = ticketRows.filter((t: any) => String(t.technician || "").trim() && isCompletedStatus(t.status));
  if (completedTickets.length === 0) return [];

  const ticketIds = completedTickets.map((t: any) => t.id);
  const [{ data: visitRows, error: vErr }, { data: excludedRows, error: exErr }] = await Promise.all([
    // Purely for repair_type categorization now — NOT for determining
    // whether the ticket is complete (that's isCompletedStatus above).
    supabase.from("visits").select("ticket_id, repair_type, created_at").in("ticket_id", ticketIds),
    // Tickets Finance has put on hold for payroll via the Mileage tab's On
    // Hold action (migration 0148) — while flagged, a ticket that's
    // genuinely completed still never counts toward pay, but it's
    // reversible. Same "skip this ticket_id" treatment as redo.
    supabase.from("mileage_entries").select("ticket_id").eq("payroll_excluded", true).in("ticket_id", ticketIds),
  ]);
  if (vErr) console.error("getTechCompletedCandidates (visit repair types) error:", vErr.message);
  if (exErr) console.error("getTechCompletedCandidates (payroll exclusions) error:", exErr.message);

  const latestRepairTypeByTicketId = new Map<string, string>();
  const latestCreatedAtByTicketId = new Map<string, string>();
  for (const v of (visitRows ?? []) as any[]) {
    const prevCreatedAt = latestCreatedAtByTicketId.get(v.ticket_id);
    if (!prevCreatedAt || v.created_at > prevCreatedAt) {
      latestCreatedAtByTicketId.set(v.ticket_id, v.created_at);
      latestRepairTypeByTicketId.set(v.ticket_id, String(v.repair_type || "").trim());
    }
  }
  const excludedTicketIds = new Set((excludedRows ?? []).map((r: any) => r.ticket_id));

  return completedTickets.map((t: any) => ({
    ticketId: t.id,
    ticketNo: t.ticket_no || "",
    technician: String(t.technician).trim(),
    repairType: latestRepairTypeByTicketId.get(t.id) || DEFAULT_REPAIR_TYPE,
    location: t.location || "",
    redo: !!t.redo,
    onHold: excludedTicketIds.has(t.id),
  }));
}

/**
 * Completed-repair counts per technician for a payroll period, grouped by
 * repair_type + branch so the caller can look up each group's rate and
 * multiply by count. See getTechCompletedCandidates for what counts as
 * "completed."
 *
 * Redo tickets (tickets.redo — a manager-flagged re-dispatch of a prior
 * failed repair) don't count toward the technician's paid completed total,
 * same as the legacy per-tech payroll report's "Redo Reduction" line —
 * excluded outright here rather than counted then subtracted, since this
 * model pays per repair_type bucket rather than one flat completed-count
 * rate. Same treatment for a ticket on hold for payroll (see
 * TechCompletedCandidate.onHold) — see getTechOnHoldTickets for the visible
 * list of which tickets that excludes.
 */
export async function getTechCompletedRepairCounts(
  startDate: string,
  endDate: string
): Promise<TechRepairCount[]> {
  const candidates = await getTechCompletedCandidates(startDate, endDate);
  const counts = new Map<string, TechRepairCount>();
  for (const c of candidates) {
    if (c.redo || c.onHold) continue;
    const repairType = c.repairType ?? DEFAULT_REPAIR_TYPE;
    const key = `${c.technician}|${repairType}|${c.location}`;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { technician: c.technician, repairType, branch: c.location, count: 1 });
  }
  return Array.from(counts.values());
}

/** One ticket a technician's completion was excluded for — Tech Activity Report's Redo / On Hold lists. */
export interface TechRedoTicket {
  ticketId: string;
  ticketNo: string;
}

/**
 * Distinct tickets behind getTechCompletedRepairCounts' "Redo Reduction"
 * line — every completed ticket (per getTechCompletedCandidates) flagged
 * tickets.redo, deduped to one entry per ticket even if it had multiple
 * completed visits. Keeping this in sync with getTechCompletedRepairCounts'
 * own exclusion matters for more than the list itself: the modal displays
 * "grossCompleted − redoTickets.length = ticketsCompleted", so a technician
 * whose redo tickets were only caught by the on-site-timestamp fallback
 * would otherwise show "Redo Reduction: 0" while ticketsCompleted quietly
 * came out lower than the gross count anyway — correct pay, but an
 * inexplicable-looking gap.
 */
export async function getTechRedoTickets(startDate: string, endDate: string): Promise<Map<string, TechRedoTicket[]>> {
  const candidates = await getTechCompletedCandidates(startDate, endDate);
  return groupExcludedTickets(candidates, (c) => c.redo);
}

/**
 * Distinct tickets behind an "On Hold Reduction" line, sibling to Redo
 * Reduction above: every completed ticket (per getTechCompletedCandidates)
 * currently on hold for payroll via the Mileage tab (manual, or the
 * automatic "no photos yet" rule), excluding anything already accounted for
 * as a redo — a ticket only ever shows up in one of the two lists, matching
 * getTechCompletedRepairCounts' own precedence (redo is checked first).
 * Without this, "did the work but the pay isn't showing" reads as a bug
 * instead of the reversible, expected hold it actually is.
 */
export async function getTechOnHoldTickets(startDate: string, endDate: string): Promise<Map<string, TechRedoTicket[]>> {
  const candidates = await getTechCompletedCandidates(startDate, endDate);
  return groupExcludedTickets(candidates, (c) => !c.redo && c.onHold);
}

/** Shared grouping/dedup for getTechRedoTickets / getTechOnHoldTickets — one entry per (technician, ticket), keyed by lowercased technician name. */
function groupExcludedTickets(
  candidates: TechCompletedCandidate[],
  matches: (c: TechCompletedCandidate) => boolean
): Map<string, TechRedoTicket[]> {
  const out = new Map<string, TechRedoTicket[]>();
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!matches(c)) continue;
    const technician = c.technician.toLowerCase();
    const dedupeKey = `${technician}|${c.ticketId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const list = out.get(technician) ?? [];
    list.push({ ticketId: c.ticketId, ticketNo: c.ticketNo });
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
  const data: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("visits")
      .select("ticket_id, second_technician")
      .gte("schedule_date", startDate)
      .lte("schedule_date", endDate)
      .not("second_technician", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getTechSecondCounts error:", error.message);
      return counts;
    }
    data.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  const assisted = (data ?? []).filter((r: any) => String(r.second_technician || "").trim());
  if (assisted.length === 0) return counts;

  // second_technician only ever exists on a Visit Log row (tickets have no
  // second-technician column of their own) — but whether the JOB is done
  // now follows the same ticket.status rule as everywhere else (isCompletedStatus).
  const ticketIds = Array.from(new Set(assisted.map((r: any) => r.ticket_id).filter(Boolean)));
  const { data: ticketRows, error: tErr } = await supabase.from("tickets").select("id, redo, status").in("id", ticketIds);
  if (tErr) console.error("getTechSecondCounts (ticket lookup) error:", tErr.message);
  const ticketById = new Map((ticketRows ?? []).map((t: any) => [t.id, t]));

  for (const r of assisted as any[]) {
    const ticket = ticketById.get(r.ticket_id);
    if (!ticket || ticket.redo || !isCompletedStatus(ticket.status)) continue;
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
  const data: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("visits")
      .select("ticket_id, technician, second_technician")
      .gte("schedule_date", startDate)
      .lte("schedule_date", endDate)
      .not("technician", "is", null)
      .not("second_technician", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getTechAssistedTickets error:", error.message);
      return out;
    }
    data.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  const assisted = (data ?? []).filter((r: any) => String(r.second_technician || "").trim());
  if (assisted.length === 0) return out;

  const ticketIds = Array.from(new Set(assisted.map((r: any) => r.ticket_id).filter(Boolean)));
  const { data: ticketRows, error: tErr } = await supabase.from("tickets").select("id, ticket_no, redo, status").in("id", ticketIds);
  if (tErr) console.error("getTechAssistedTickets (ticket lookup) error:", tErr.message);
  const ticketById = new Map((ticketRows ?? []).map((t: any) => [t.id, t]));

  for (const r of assisted as any[]) {
    const ticket = ticketById.get(r.ticket_id);
    if (!ticket || ticket.redo || !isCompletedStatus(ticket.status)) continue;
    const technician = String(r.technician).trim().toLowerCase();
    const list = out.get(technician) ?? [];
    list.push({ ticketId: ticket.id, ticketNo: ticket.ticket_no || "", secondTechnician: String(r.second_technician).trim() });
    out.set(technician, list);
  }
  return out;
}

/** One ticket where THIS technician was the assisting (second) technician — the reciprocal of TechAssistedTicket, for the assisting tech's own Tech Activity Report. */
export interface TechSecondTechTicket {
  ticketId: string;
  ticketNo: string;
  primaryTechnician: string;
}

/**
 * For each ASSISTING (second) technician, the completed (redo-excluded)
 * tickets within a period where they helped a primary technician — the
 * mirror image of getTechAssistedTickets, which lists the same tickets from
 * the PRIMARY technician's side. Before this existed, a shared/"2 Man Job"
 * ticket was only ever visible ticket-by-ticket on the primary technician's
 * own Tech Activity Report (the "2nd Tech (assisted this tech)" panel) — the
 * assisting technician's report only ever showed a bare "Two Tech" count
 * (getTechSecondCounts), with nothing to click through to see which tickets
 * it came from.
 */
export async function getTechSecondTechTickets(startDate: string, endDate: string): Promise<Map<string, TechSecondTechTicket[]>> {
  const out = new Map<string, TechSecondTechTicket[]>();
  if (!startDate || !endDate) return out;
  const data: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("visits")
      .select("ticket_id, technician, second_technician")
      .gte("schedule_date", startDate)
      .lte("schedule_date", endDate)
      .not("technician", "is", null)
      .not("second_technician", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getTechSecondTechTickets error:", error.message);
      return out;
    }
    data.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  const assisted = (data ?? []).filter((r: any) => String(r.second_technician || "").trim());
  if (assisted.length === 0) return out;

  const ticketIds = Array.from(new Set(assisted.map((r: any) => r.ticket_id).filter(Boolean)));
  const { data: ticketRows, error: tErr } = await supabase.from("tickets").select("id, ticket_no, redo, status").in("id", ticketIds);
  if (tErr) console.error("getTechSecondTechTickets (ticket lookup) error:", tErr.message);
  const ticketById = new Map((ticketRows ?? []).map((t: any) => [t.id, t]));

  for (const r of assisted as any[]) {
    const ticket = ticketById.get(r.ticket_id);
    if (!ticket || ticket.redo || !isCompletedStatus(ticket.status)) continue;
    const technician = String(r.second_technician).trim().toLowerCase();
    const list = out.get(technician) ?? [];
    list.push({ ticketId: ticket.id, ticketNo: ticket.ticket_no || "", primaryTechnician: String(r.technician).trim() });
    out.set(technician, list);
  }
  return out;
}

/**
 * Every ticket assigned to a technician within a period, regardless of
 * outcome (completed, cancelled, still open, never even visited) — for the
 * Tech Payroll tab's Assigned/Completed/Ratio/Avg. Comp. columns. Ticket-
 * based (tickets.technician + schedule_date), NOT visits-based: a `visits`
 * row only exists once someone actually files a Visit Log entry, so counting
 * from `visits` silently dropped every ticket that was scheduled to a
 * technician but never got a visit logged (whether or not the technician
 * actually went — see getTechCompletedRepairCounts' on-site-timestamp
 * fallback for the completed side of that same gap). This mirrors
 * getTicketAttendanceForTechnician / ticketStatsByDate's "Scheduled" column
 * on the Employee Payroll Detail modal exactly, so the two views agree.
 * Keyed by lowercased/trimmed technician name — same free-text-match
 * convention as everywhere else this field gets matched against a real
 * profile (e.g. AccountingDashboard.tsx's employeeByName).
 */
export async function getTechAssignedCounts(startDate: string, endDate: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!startDate || !endDate) return counts;
  const data: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("tickets")
      .select("technician")
      .gte("schedule_date", startDate)
      .lte("schedule_date", endDate)
      .not("technician", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getTechAssignedCounts error:", error.message);
      return counts;
    }
    data.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  for (const r of data as any[]) {
    const technician = String(r.technician || "").trim().toLowerCase();
    if (!technician) continue;
    counts.set(technician, (counts.get(technician) ?? 0) + 1);
  }
  return counts;
}

/**
 * Each technician's real logged mileage (mileage_entries.total_mileage,
 * Accounting Dashboard's Mileage tab) within a payroll period — the
 * DEFAULT for the Mileage line's Value, before Finance has ever manually
 * entered/edited it for that period (see AccountingDashboard.tsx's
 * techManualByProfile: manual?.mileage falls back to this map instead of
 * a flat 0). Excludes entries on hold for payroll (payroll_excluded —
 * manual holds AND the automatic "no photos yet" rule alike), same "no
 * proof of the drive, no pay for it" rule already applied to Completed
 * Tickets. Once Finance saves any manual value for a technician's
 * period, that saved row takes over and this total is no longer
 * consulted for them — see getTechManualPayItems.
 */
export async function getTechAutoMileageTotals(periodStart: string, periodEnd: string): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (!periodStart || !periodEnd) return totals;
  const data: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("mileage_entries")
      .select("profile_id, work_date, total_mileage, mileage_override, mileage_adjustment, payroll_excluded")
      .not("profile_id", "is", null)
      .is("deleted_at", null)
      .gte("work_date", periodStart)
      .lte("work_date", periodEnd)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getTechAutoMileageTotals error:", error.message);
      return totals;
    }
    data.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  // Every ticket a technician had on one day shares that day's SAME route
  // total (see syncMileageFromTickets) — sum per (profile, day) FIRST, one
  // day's mileage counted once, before adding days together, or a
  // multi-ticket day would be double/triple-counted here. Reads the
  // EFFECTIVE total (a Finance override/adjustment, if any, on top of the
  // calculated total_mileage), not the raw calculated figure, so a manual
  // correction actually reaches payroll. The deleted_at filter above keeps
  // a soft-deleted entry (softDeleteMileageEntry, migration 0210 — a stop
  // the technician never actually made) out of this entirely.
  const perDay = new Map<string, number>();
  for (const row of (data ?? []) as any[]) {
    if (row.payroll_excluded) continue;
    const key = `${row.profile_id}|${row.work_date}`;
    perDay.set(
      key,
      mileageEffectiveTotal({
        totalMileage: Number(row.total_mileage) || 0,
        mileageOverride: row.mileage_override != null ? Number(row.mileage_override) : null,
        mileageAdjustment: row.mileage_adjustment != null ? Number(row.mileage_adjustment) : null,
      })
    );
  }
  for (const [key, dayMiles] of perDay) {
    const profileId = key.slice(0, key.indexOf("|"));
    totals.set(profileId, (totals.get(profileId) ?? 0) + dayMiles);
  }
  return totals;
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

/**
 * Every technician's custom pay lines for one period, company-wide
 * (RLS-scoped) — one query instead of one-per-technician, same pattern as
 * getTechManualPayItems. Used by AccountingDashboard.tsx's real payroll
 * calculation (payrollRows) so a custom line (hand-added, or auto-created
 * by an approved Payroll Dispute — see handlePayrollDisputeAction) actually
 * counts toward Total Payment / what Generate Payroll inserts, not just
 * the Tech Activity Report modal's own preview total.
 */
export async function getAllTechCustomPayItemsForPeriod(periodStart: string, periodEnd: string): Promise<TechCustomPayItem[]> {
  if (!periodStart || !periodEnd) return [];
  const { data, error } = await supabase
    .from("tech_custom_pay_items")
    .select("id, profile_id, period_start, period_end, label, value, rate")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) {
    console.error("getAllTechCustomPayItemsForPeriod error:", error.message);
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

/** One technician's full Tech Payroll breakdown for a period — the piece-rate categories, not hours x rate. */
export interface TechPayrollBreakdown {
  periodStart: string;
  periodEnd: string;
  ticketsCompleted: number;
  ticketsAssigned: number;
  /** Distinct days clocked in during the period — Avg. Comp.'s denominator. */
  workingDays: number;
  techCategoryPay: { twoManJob: number; backTub: number; sealedSystem: number; sealedSystemR600: number };
  /** Completed (redo-excluded) count per repair_type category, every configured category. */
  techCategoryCounts: Record<string, number>;
  twoTechCount: number;
  twoTechPay: number;
  ldtCount: number;
  ldtPay: number;
  mileage: number;
  mileagePay: number;
  trainingValue: number;
  trainingPay: number;
  mcaBonus: number;
  /** Flat per-ticket rate paid on every completed (redo-excluded) ticket, on top of its own repair-type rate. */
  completedTicketsPay: number;
  /** Same total AccountingDashboard.tsx's Tech Payroll tab calls Total Net for this technician/period. */
  grossPay: number;
}

/**
 * Same piece-rate formula AccountingDashboard.tsx's Tech Payroll tab uses to
 * total one technician's pay for a period, scoped down to a single
 * technician — lets the mobile Payroll tab show a tech the exact same
 * breakdown/total Finance sees on desktop instead of an hours x rate view
 * that doesn't apply to piece-rate pay. Read-only and safe to call for a
 * period that hasn't been "Generate Payroll"-ed yet (same live-computation
 * the desktop tab itself does before a run exists).
 */
export async function getTechPayrollBreakdown(
  profileId: string,
  fullName: string,
  assignedBranch: string,
  periodStart: string,
  periodEnd: string
): Promise<TechPayrollBreakdown> {
  const nameKey = fullName.trim().toLowerCase();
  const [repairCounts, categoryOverrides, assignedCounts, manualItems, secondCounts, rates, timecardRes] = await Promise.all([
    getTechCompletedRepairCounts(periodStart, periodEnd),
    getTechCategoryOverrides(periodStart, periodEnd),
    getTechAssignedCounts(periodStart, periodEnd),
    getTechManualPayItems(periodStart, periodEnd),
    getTechSecondCounts(periodStart, periodEnd),
    getTechRepairRates(),
    supabase
      .from("timecard_entries")
      .select("work_date, check_in")
      .eq("profile_id", profileId)
      .gte("work_date", periodStart)
      .lte("work_date", periodEnd),
  ]);
  const rateFor = (repairType: string, branch: string) => techRateFor(rates, repairType, branch);

  // Mirrors AccountingDashboard.tsx's techGrossByProfile accumulation, scoped to just this technician.
  let ticketsCompleted = 0;
  let categoryGross = 0;
  let twoManJob = 0, backTub = 0, sealedSystem = 0, sealedSystemR600 = 0;
  const categoryCounts: Record<string, number> = {};
  for (const rc of repairCounts) {
    if (rc.technician.trim().toLowerCase() !== nameKey) continue;
    const rate = rateFor(rc.repairType, rc.branch || assignedBranch || "");
    const amount = rate * rc.count;
    ticketsCompleted += rc.count;
    categoryGross += amount;
    if (rc.repairType === "2 Man Job") twoManJob += amount;
    if (rc.repairType === "Back Tub") backTub += amount;
    if (rc.repairType === "Sealed System") sealedSystem += amount;
    if (rc.repairType === "Sealed System(R600)") sealedSystemR600 += amount;
    categoryCounts[rc.repairType] = (categoryCounts[rc.repairType] ?? 0) + rc.count;
  }
  // Finance's manual category-count corrections replace the live count for
  // that category — same second pass AccountingDashboard.tsx applies.
  let twoTechOverride: number | undefined;
  for (const ov of categoryOverrides) {
    if (ov.profileId !== profileId) continue;
    if (ov.category === "Two Tech") { twoTechOverride = ov.count; continue; }
    const rate = rateFor(ov.category, assignedBranch || "");
    const liveCount = categoryCounts[ov.category] ?? 0;
    const countDelta = ov.count - liveCount;
    const amountDelta = countDelta * rate;
    ticketsCompleted += countDelta;
    categoryGross += amountDelta;
    if (ov.category === "2 Man Job") twoManJob += amountDelta;
    if (ov.category === "Back Tub") backTub += amountDelta;
    if (ov.category === "Sealed System") sealedSystem += amountDelta;
    if (ov.category === "Sealed System(R600)") sealedSystemR600 += amountDelta;
    categoryCounts[ov.category] = ov.count;
  }

  const manual = manualItems.find((m) => m.profileId === profileId);
  const ldtPay = (manual?.ldtCount ?? 0) * rateFor("LDT", assignedBranch || "");
  const mileagePay = (manual?.mileage ?? 0) * rateFor("Mileage", assignedBranch || "");
  const trainingPay = (manual?.trainingValue ?? 0) * rateFor("Training Paid", assignedBranch || "");

  const twoTechCount = twoTechOverride ?? secondCounts.get(nameKey) ?? 0;
  const twoTechPay = twoTechCount * rateFor("Two Tech", assignedBranch || "");

  const mcaThreshold = rateFor("MCA Threshold", assignedBranch || "");
  const mcaBonus = mcaThreshold > 0 && ticketsCompleted >= mcaThreshold ? rateFor("MCA Bonus", assignedBranch || "") : 0;

  const completedTicketsPay = ticketsCompleted * rateFor("Completed Tickets", assignedBranch || "");

  const grossPay = categoryGross + ldtPay + mileagePay + trainingPay + twoTechPay + mcaBonus + completedTicketsPay;

  const workingDates = new Set<string>();
  for (const r of (timecardRes.data ?? []) as Array<{ work_date: string; check_in: string | null }>) {
    if (r.check_in) workingDates.add(r.work_date);
  }

  return {
    periodStart,
    periodEnd,
    ticketsCompleted,
    ticketsAssigned: assignedCounts.get(nameKey) ?? 0,
    workingDays: workingDates.size,
    techCategoryPay: { twoManJob, backTub, sealedSystem, sealedSystemR600 },
    techCategoryCounts: categoryCounts,
    twoTechCount,
    twoTechPay,
    ldtCount: manual?.ldtCount ?? 0,
    ldtPay,
    mileage: manual?.mileage ?? 0,
    mileagePay,
    trainingValue: manual?.trainingValue ?? 0,
    trainingPay,
    mcaBonus,
    completedTicketsPay,
    grossPay,
  };
}
