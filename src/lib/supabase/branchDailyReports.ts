/**
 * Branch Daily Report (Reports module) — one row per (branch, date). See
 * migration 0284 for the full data-shape rationale: `notes` is a single
 * shared growing text field (appendNote below appends "Name (time): ..."
 * to whatever's already there, same as people taking turns typing into
 * one spreadsheet cell), `urgency` is Senior-Branch-Manager-set, and
 * pendingTickets/numberOfTechs are a frozen per-day snapshot — only
 * refreshCounts() (called for TODAY's row only, never a past date) ever
 * recomputes them.
 */
import { supabase } from "./client";

export type BranchReportUrgency = "low" | "moderate" | "high";

export interface BranchDailyReport {
  id: string;
  branch: string;
  reportDate: string; // "YYYY-MM-DD"
  urgency: BranchReportUrgency | null;
  notes: string;
  pendingTickets: number | null;
  numberOfTechs: number | null;
  countsCapturedAt: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

const SELECT = "id, branch, report_date, urgency, notes, pending_tickets, number_of_techs, counts_captured_at, updated_by_name, updated_at";

function fromRow(r: any): BranchDailyReport {
  return {
    id: r.id,
    branch: r.branch,
    reportDate: r.report_date,
    urgency: r.urgency,
    notes: r.notes || "",
    pendingTickets: r.pending_tickets,
    numberOfTechs: r.number_of_techs,
    countsCapturedAt: r.counts_captured_at,
    updatedByName: r.updated_by_name,
    updatedAt: r.updated_at,
  };
}

/** Every branch's report row for one date — branches with nothing filed yet simply have no row (the UI renders them blank). */
export async function getBranchDailyReports(reportDate: string): Promise<BranchDailyReport[]> {
  const { data, error } = await supabase
    .from("branch_daily_reports")
    .select(SELECT)
    .eq("report_date", reportDate);
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

async function getRow(branch: string, reportDate: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("branch_daily_reports")
    .select(SELECT)
    .eq("branch", branch)
    .eq("report_date", reportDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Appends one note to the branch/day's shared notes box (creating the row if it doesn't exist yet). */
export async function appendBranchDailyReportNote(
  branch: string,
  reportDate: string,
  authorName: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const existing = await getRow(branch, reportDate);
  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const entry = `${authorName} (${time}): ${trimmed}`;
  const notes = existing?.notes ? `${existing.notes}\n\n${entry}` : entry;
  const patch = { branch, report_date: reportDate, notes, updated_by_name: authorName, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("branch_daily_reports").upsert(patch, { onConflict: "company_id,branch,report_date" });
  if (error) throw new Error(error.message);
}

/** Senior Branch Manager's urgency call for this branch/day (creating the row if it doesn't exist yet). */
export async function setBranchDailyReportUrgency(
  branch: string,
  reportDate: string,
  urgency: BranchReportUrgency,
  updatedByName: string,
): Promise<void> {
  const patch = { branch, report_date: reportDate, urgency, updated_by_name: updatedByName, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("branch_daily_reports").upsert(patch, { onConflict: "company_id,branch,report_date" });
  if (error) throw new Error(error.message);
}

/** Recomputes and freezes today's Pending Tickets / Number of Techs snapshot for one branch. Never call this for a past date — see this file's header comment. */
export async function refreshBranchDailyReportCounts(
  branch: string,
  reportDate: string,
  counts: { pendingTickets: number; numberOfTechs: number },
): Promise<void> {
  const patch = {
    branch,
    report_date: reportDate,
    pending_tickets: counts.pendingTickets,
    number_of_techs: counts.numberOfTechs,
    counts_captured_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("branch_daily_reports").upsert(patch, { onConflict: "company_id,branch,report_date" });
  if (error) throw new Error(error.message);
}
