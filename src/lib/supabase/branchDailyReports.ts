/**
 * Branch Daily Report (Reports module) — one row per (branch, date). See
 * migration 0284/0285 for the full data-shape rationale: `urgency` is
 * Senior-Branch-Manager-set, pendingTickets/numberOfTechs are a frozen
 * per-day snapshot (only refreshCounts() — TODAY's row only, never a past
 * date — ever recomputes them), and notes are individual rows in
 * branch_daily_report_notes (0285), each editable/deletable only by its
 * own author (enforced by RLS, not just the UI).
 */
import { supabase } from "./client";

export type BranchReportUrgency = "low" | "moderate" | "high";

export interface BranchDailyReport {
  id: string;
  branch: string;
  reportDate: string; // "YYYY-MM-DD"
  urgency: BranchReportUrgency | null;
  pendingTickets: number | null;
  numberOfTechs: number | null;
  countsCapturedAt: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface BranchDailyReportNote {
  id: string;
  reportId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

const SELECT = "id, branch, report_date, urgency, pending_tickets, number_of_techs, counts_captured_at, updated_by_name, updated_at";
const NOTE_SELECT = "id, report_id, author_id, author_name, body, edited, created_at, updated_at";

function fromRow(r: any): BranchDailyReport {
  return {
    id: r.id,
    branch: r.branch,
    reportDate: r.report_date,
    urgency: r.urgency,
    pendingTickets: r.pending_tickets,
    numberOfTechs: r.number_of_techs,
    countsCapturedAt: r.counts_captured_at,
    updatedByName: r.updated_by_name,
    updatedAt: r.updated_at,
  };
}

function fromNoteRow(r: any): BranchDailyReportNote {
  return {
    id: r.id,
    reportId: r.report_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    edited: r.edited,
    createdAt: r.created_at,
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

/** Every note attached to any of the given report rows (e.g. every branch's report id for one date) — keyed by reportId by the caller. Empty array in, empty array out (no query round trip wasted on a still-loading caller). */
export async function getBranchDailyReportNotes(reportIds: string[]): Promise<BranchDailyReportNote[]> {
  if (reportIds.length === 0) return [];
  const { data, error } = await supabase
    .from("branch_daily_report_notes")
    .select(NOTE_SELECT)
    .in("report_id", reportIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromNoteRow);
}

async function getOrCreateReportId(branch: string, reportDate: string): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("branch_daily_reports")
    .select("id")
    .eq("branch", branch)
    .eq("report_date", reportDate)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("branch_daily_reports")
    .insert({ branch, report_date: reportDate })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Adds one note to the branch/day's report (creating the report row if it doesn't exist yet). */
export async function addBranchDailyReportNote(
  branch: string,
  reportDate: string,
  authorId: string,
  authorName: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const reportId = await getOrCreateReportId(branch, reportDate);
  const { error } = await supabase
    .from("branch_daily_report_notes")
    .insert({ report_id: reportId, branch, author_id: authorId, author_name: authorName, body: trimmed });
  if (error) throw new Error(error.message);
}

/** Only the note's own author can call this successfully — RLS rejects anyone else's edit. */
export async function updateBranchDailyReportNote(noteId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from("branch_daily_report_notes")
    .update({ body: trimmed, edited: true, updated_at: new Date().toISOString() })
    .eq("id", noteId);
  if (error) throw new Error(error.message);
}

/** The note's own author, or HR-and-above for moderation — RLS rejects anyone else. */
export async function deleteBranchDailyReportNote(noteId: string): Promise<void> {
  const { error } = await supabase.from("branch_daily_report_notes").delete().eq("id", noteId);
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
