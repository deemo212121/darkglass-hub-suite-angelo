/**
 * Branch-level access control for the Branch Daily Report
 * (src/components/BranchDailyReportPage.tsx):
 *
 * - Which branches each Senior Branch Manager is responsible for — HR and
 *   above, or a Senior Branch Manager themselves (migration 0319), assign
 *   these. The assigned Senior Branch Manager can then set Urgency / add
 *   notes for that branch. A branch has at most one owning Senior Branch
 *   Manager at a time.
 * - Extra editors (migration 0319) — a specific person manually granted
 *   notes-only access to one branch, regardless of their own role or
 *   assigned_branch (e.g. someone who needs to post updates for a branch
 *   they're not formally staffed at). Same "HR-and-above, or the Senior
 *   Branch Manager who owns that branch" tier manages this list as manages
 *   the SBM assignments above (can_manage_branch_extra_editors).
 *
 * Real enforcement for both is the RLS policies / can_edit_branch_daily_
 * report() in migration 0319 — this file is just the client-side reads/
 * writes against them.
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

export interface BranchExtraEditor {
  id: string;
  branch: string;
  profileId: string;
  grantedBy: string | null;
  createdAt: string;
}

function extraEditorFromRow(r: any): BranchExtraEditor {
  return { id: r.id, branch: r.branch, profileId: r.profile_id, grantedBy: r.granted_by ?? null, createdAt: r.created_at };
}

/** Every manually-granted extra editor, company-wide. */
export async function getBranchExtraEditors(): Promise<BranchExtraEditor[]> {
  const { data, error } = await supabase
    .from("branch_daily_report_extra_editors")
    .select("id, branch, profile_id, granted_by, created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map(extraEditorFromRow);
}

/** Grants one person notes-only access to one branch's Daily Report — idempotent (unique on branch+profile). */
export async function addBranchExtraEditor(branch: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from("branch_daily_report_extra_editors")
    .upsert({ branch, profile_id: profileId }, { onConflict: "company_id,branch,profile_id" });
  if (error) throw new Error(error.message);
}

export async function removeBranchExtraEditor(id: string): Promise<void> {
  const { error } = await supabase.from("branch_daily_report_extra_editors").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface BranchFallbackTech {
  id: string;
  branch: string;
  profileId: string;
}

/**
 * Hand-picked fallback techs (migration 0327), company-wide. A branch with
 * any rows here uses exactly this list instead of the automatic
 * highest-tier pick; a branch with none keeps the automatic default.
 */
export async function getBranchFallbackTechs(): Promise<BranchFallbackTech[]> {
  const { data, error } = await supabase
    .from("branch_daily_report_fallback_techs")
    .select("id, branch, profile_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, branch: r.branch, profileId: r.profile_id }));
}

/** Replaces a branch's fallback list. An empty list restores the automatic highest-tier default. */
export async function setBranchFallbackTechs(branch: string, profileIds: string[]): Promise<void> {
  const { error: delError } = await supabase.from("branch_daily_report_fallback_techs").delete().eq("branch", branch);
  if (delError) throw new Error(delError.message);
  if (profileIds.length === 0) return;
  const { error } = await supabase
    .from("branch_daily_report_fallback_techs")
    .insert(profileIds.map((profileId) => ({ branch, profile_id: profileId })));
  if (error) throw new Error(error.message);
}
