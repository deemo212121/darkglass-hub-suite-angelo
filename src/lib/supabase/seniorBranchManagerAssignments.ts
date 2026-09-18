/**
 * Which branches each Senior Branch Manager is responsible for on the
 * Branch Daily Report (src/components/BranchDailyReportPage.tsx) — HR and
 * above assign these; the assigned Senior Branch Manager is then the only
 * non-HR/Admin role who can set Urgency / add notes for that branch (see
 * can_edit_branch_daily_report() in migration 0283/0284). A branch has at
 * most one owning Senior Branch Manager at a time.
 */
import { supabase } from "./client";

export interface SbmBranchAssignment {
  id: string;
  profileId: string;
  branch: string;
}

function fromRow(r: any): SbmBranchAssignment {
  return { id: r.id, profileId: r.profile_id, branch: r.branch };
}

/** Every branch assignment, company-wide. */
export async function getSeniorBranchManagerAssignments(): Promise<SbmBranchAssignment[]> {
  const { data, error } = await supabase
    .from("senior_branch_manager_branches")
    .select("id, profile_id, branch");
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

/** Assigns a branch to a Senior Branch Manager, replacing whoever owned it before (branch is unique per company). */
export async function assignBranchToSeniorManager(profileId: string, branch: string): Promise<void> {
  const { error: delError } = await supabase.from("senior_branch_manager_branches").delete().eq("branch", branch);
  if (delError) throw new Error(delError.message);
  const { error } = await supabase.from("senior_branch_manager_branches").insert({ profile_id: profileId, branch });
  if (error) throw new Error(error.message);
}

export async function unassignBranch(branch: string): Promise<void> {
  const { error } = await supabase.from("senior_branch_manager_branches").delete().eq("branch", branch);
  if (error) throw new Error(error.message);
}
