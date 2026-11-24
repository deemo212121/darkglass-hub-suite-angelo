/**
 * Branch Commission only (migration 0476): which manager a branch counts
 * toward, and which branch a technician's numbers count under — picked on
 * the Accounting Dashboard's Branch Commission tab. Nothing else reads
 * these; profiles' Assigned Branch and the Approval Chain stay as they are.
 */
import { supabase } from "./client";
import { branchMatchKey } from "@/lib/branchName";

export interface BranchManagerPick { branchKey: string; branch: string; profileId: string }
export interface TechBranchPick { profileId: string; branchKey: string; branch: string }

/** True when migration 0476 hasn't been run yet. */
export function isAssignmentsMissingError(message: string): boolean {
  return /branch_commission_(branch_managers|tech_branches)|does not exist|schema cache/i.test(message);
}

export async function getBranchManagerPicks(): Promise<BranchManagerPick[]> {
  const { data, error } = await supabase.from("branch_commission_branch_managers").select("branch_key, branch, profile_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ branchKey: r.branch_key, branch: r.branch, profileId: r.profile_id }));
}

export async function getTechBranchPicks(): Promise<TechBranchPick[]> {
  const { data, error } = await supabase.from("branch_commission_tech_branches").select("profile_id, branch_key, branch");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ profileId: r.profile_id, branchKey: r.branch_key, branch: r.branch }));
}

/** Pick the manager a branch counts toward; null puts it back to Assigned Branch + Approval Chain. */
export async function setBranchManagerPick(branch: string, profileId: string | null): Promise<void> {
  const branchKey = branchMatchKey(branch);
  if (profileId === null) {
    const { error } = await supabase.from("branch_commission_branch_managers").delete().eq("branch_key", branchKey);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("branch_commission_branch_managers")
    .upsert({ branch_key: branchKey, branch, profile_id: profileId }, { onConflict: "company_id,branch_key" });
  if (error) throw new Error(error.message);
}

/** Move a technician's numbers to another branch; null puts them back under their Assigned Branch. */
export async function setTechBranchPick(profileId: string, branch: string | null): Promise<void> {
  if (branch === null) {
    const { error } = await supabase.from("branch_commission_tech_branches").delete().eq("profile_id", profileId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("branch_commission_tech_branches")
    .upsert({ profile_id: profileId, branch_key: branchMatchKey(branch), branch }, { onConflict: "company_id,profile_id" });
  if (error) throw new Error(error.message);
}
