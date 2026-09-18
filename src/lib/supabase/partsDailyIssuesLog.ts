import { supabase } from "./client";

// Manual per-branch, per-day "Issues" and "Lost" tally for the Part Daily
// Report's Overview tab — not derivable from any existing table, someone
// types it in by hand. See migration 0290.

export interface PartsDailyIssueEntry {
  branch: string;
  date: string;
  issues: number;
  lost: number;
}

export async function getPartsDailyIssues(startDate: string, endDate: string): Promise<PartsDailyIssueEntry[]> {
  const { data, error } = await supabase
    .from("parts_daily_issues_log")
    .select("branch, entry_date, issues, lost")
    .gte("entry_date", startDate)
    .lte("entry_date", endDate);
  if (error) throw error;
  return (data || []).map((r: any) => ({ branch: r.branch, date: r.entry_date, issues: r.issues, lost: r.lost }));
}

export async function upsertPartsDailyIssue(
  branch: string,
  date: string,
  patch: Partial<Pick<PartsDailyIssueEntry, "issues" | "lost">>
): Promise<void> {
  const payload: Record<string, unknown> = { branch, entry_date: date };
  if (patch.issues !== undefined) payload.issues = patch.issues;
  if (patch.lost !== undefined) payload.lost = patch.lost;
  const { error } = await supabase.from("parts_daily_issues_log").upsert(payload, { onConflict: "company_id,branch,entry_date" });
  if (error) throw error;
}
