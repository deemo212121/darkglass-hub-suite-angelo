/**
 * CSR Daily Report — the manually-filled half of CSRTeamDailyReport.tsx's
 * per-agent worksheet (Rate/Task/GH/Total/Schedule/Attempt/Update/Mistake/
 * Warning/Abs-Em./hr for one person on one date). Everything else on that
 * page (Full Name, Start Date, Month, Sick Day, Vacation Day, team/roster)
 * is fetched live from profiles/employee_info/pto_requests/csr_teams —
 * see migration 0270.
 */

import { supabase } from "./client";

export interface CsrDailyReportEntry {
  id: string;
  profileId: string;
  reportDate: string; // "YYYY-MM-DD"
  rate: number | null;
  task: string | null;
  gh: number | null;
  total: number | null;
  schedule: number | null;
  attempt: number | null;
  updateCount: number | null;
  mistake: string | null;
  warning: string | null;
  absEm: string | null;
  hr: number | null;
}

const SELECT = "id, profile_id, report_date, rate, task, gh, total, schedule, attempt, update_count, mistake, warning, abs_em, hr";

function fromRow(r: any): CsrDailyReportEntry {
  return {
    id: r.id,
    profileId: r.profile_id,
    reportDate: r.report_date,
    rate: r.rate,
    task: r.task,
    gh: r.gh,
    total: r.total,
    schedule: r.schedule,
    attempt: r.attempt,
    updateCount: r.update_count,
    mistake: r.mistake,
    warning: r.warning,
    absEm: r.abs_em,
    hr: r.hr,
  };
}

/** Every entry on file for one date, company-wide — keyed by profileId by the caller. */
export async function getCsrDailyReportEntries(reportDate: string): Promise<CsrDailyReportEntry[]> {
  const { data, error } = await supabase
    .from("csr_daily_report_entries")
    .select(SELECT)
    .eq("report_date", reportDate);
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export type CsrDailyReportEntryFields = Partial<Pick<CsrDailyReportEntry, "rate" | "task" | "gh" | "total" | "schedule" | "attempt" | "updateCount" | "mistake" | "warning" | "absEm" | "hr">>;

/** Create-or-update one person's row for one date — a single edited cell sends just that field, merged onto whatever's already there. */
export async function upsertCsrDailyReportEntry(profileId: string, reportDate: string, fields: CsrDailyReportEntryFields): Promise<void> {
  const patch: Record<string, unknown> = { profile_id: profileId, report_date: reportDate };
  if ("rate" in fields) patch.rate = fields.rate;
  if ("task" in fields) patch.task = fields.task;
  if ("gh" in fields) patch.gh = fields.gh;
  if ("total" in fields) patch.total = fields.total;
  if ("schedule" in fields) patch.schedule = fields.schedule;
  if ("attempt" in fields) patch.attempt = fields.attempt;
  if ("updateCount" in fields) patch.update_count = fields.updateCount;
  if ("mistake" in fields) patch.mistake = fields.mistake;
  if ("warning" in fields) patch.warning = fields.warning;
  if ("absEm" in fields) patch.abs_em = fields.absEm;
  if ("hr" in fields) patch.hr = fields.hr;

  const { error } = await supabase.from("csr_daily_report_entries").upsert(patch, { onConflict: "profile_id,report_date" });
  if (error) throw new Error(error.message);
}
