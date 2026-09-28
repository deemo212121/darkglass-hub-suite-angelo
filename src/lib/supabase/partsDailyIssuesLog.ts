import { supabase } from "./client";

// Manual per-branch, per-day tally for the Part Daily Report's Daily
// Branch Activity table — none of these six are derivable from any
// existing table, someone types them in by hand. Issues/Lost: migration
// 0288. Not Recovered/Total Warnings/Remarks: migration 0321.

export interface PartsDailyIssueEntry {
  branch: string;
  date: string;
  issues: number;
  lost: number;
  notRecovered: number;
  totalWarnings: number;
  remarks: string;
}

export async function getPartsDailyIssues(startDate: string, endDate: string): Promise<PartsDailyIssueEntry[]> {
  const { data, error } = await supabase
    .from("parts_daily_issues_log")
    .select("branch, entry_date, issues, lost, not_recovered, total_warnings, remarks")
    .gte("entry_date", startDate)
    .lte("entry_date", endDate);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    branch: r.branch,
    date: r.entry_date,
    issues: r.issues,
    lost: r.lost,
    notRecovered: r.not_recovered ?? 0,
    totalWarnings: r.total_warnings ?? 0,
    remarks: r.remarks ?? "",
  }));
}

export async function upsertPartsDailyIssue(
  branch: string,
  date: string,
  patch: Partial<Pick<PartsDailyIssueEntry, "issues" | "lost" | "notRecovered" | "totalWarnings" | "remarks">>
): Promise<void> {
  const payload: Record<string, unknown> = { branch, entry_date: date };
  if (patch.issues !== undefined) payload.issues = patch.issues;
  if (patch.lost !== undefined) payload.lost = patch.lost;
  if (patch.notRecovered !== undefined) payload.not_recovered = patch.notRecovered;
  if (patch.totalWarnings !== undefined) payload.total_warnings = patch.totalWarnings;
  if (patch.remarks !== undefined) payload.remarks = patch.remarks;
  const { error } = await supabase.from("parts_daily_issues_log").upsert(payload, { onConflict: "company_id,branch,entry_date" });
  if (error) throw error;
}
