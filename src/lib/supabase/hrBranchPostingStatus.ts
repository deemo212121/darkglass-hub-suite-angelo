/**
 * Recruitment Site tab's "Branch" view (HR Dashboard) — a simple per-branch
 * Open/Closed-for-posting toggle. See migration 0295. Unrelated to
 * hr_job_postings (0294): this isn't a job posting, just a setting.
 *
 * No row for a branch means open (the default) — getHrBranchPostingStatuses
 * only returns rows that have been explicitly set, so the caller treats a
 * missing branch as open.
 */
import { supabase } from "./client";

/** branch name -> isOpen, only for branches with an explicit row. */
export async function getHrBranchPostingStatuses(): Promise<Map<string, boolean>> {
  const { data, error } = await supabase.from("hr_branch_posting_status").select("branch, is_open");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r: any) => [r.branch, !!r.is_open]));
}

export async function setHrBranchPostingStatus(branch: string, isOpen: boolean): Promise<void> {
  const { error } = await supabase
    .from("hr_branch_posting_status")
    .upsert({ branch, is_open: isOpen }, { onConflict: "company_id,branch" });
  if (error) throw new Error(error.message);
}
