/**
 * Approval Chain areas (migration 0332) — a named Area owned by one Senior
 * Branch Manager. An area's branches aren't stored here: they're that SBM's
 * rows in senior_branch_manager_branches (seniorBranchManagerAssignments.ts),
 * the same table Branch Daily Report uses. Admin / SuperAdmin only (RLS).
 */
import { supabase } from "./client";

export interface ApprovalArea {
  id: string;
  name: string;
  seniorBranchManagerId: string | null;
  sortOrder: number;
}

export async function getApprovalAreas(): Promise<ApprovalArea[]> {
  const { data, error } = await supabase
    .from("approval_areas")
    .select("id, name, senior_branch_manager_id, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, seniorBranchManagerId: r.senior_branch_manager_id ?? null, sortOrder: r.sort_order ?? 0 }));
}

export async function createApprovalArea(name: string, seniorBranchManagerId: string | null, sortOrder = 0): Promise<void> {
  const { error } = await supabase.from("approval_areas").insert({ name: name.trim(), senior_branch_manager_id: seniorBranchManagerId, sort_order: sortOrder });
  if (error) throw new Error(error.message);
}

export async function updateApprovalArea(id: string, fields: { name?: string; seniorBranchManagerId?: string | null }): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.name !== undefined) payload.name = fields.name.trim();
  if (fields.seniorBranchManagerId !== undefined) payload.senior_branch_manager_id = fields.seniorBranchManagerId;
  const { error } = await supabase.from("approval_areas").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Top-level approvers (migration 0333). Empty = the role-based default
 * (Admin / Technical Director / Asst. Director); otherwise only these people.
 * Returns [] when the migration hasn't been run yet.
 */
export async function getTopApproverIds(): Promise<string[]> {
  const { data, error } = await supabase.from("approval_chain_top_approvers").select("profile_id");
  if (error) return [];
  return (data ?? []).map((r: any) => r.profile_id as string);
}

/** Replaces the whole top-level list. Pass [] to go back to the role-based default. */
export async function setTopApproverIds(profileIds: string[]): Promise<void> {
  const { error: delError } = await supabase.from("approval_chain_top_approvers").delete().not("id", "is", null);
  if (delError) throw new Error(delError.message);
  if (profileIds.length === 0) return;
  const { error } = await supabase.from("approval_chain_top_approvers").insert(profileIds.map((profile_id) => ({ profile_id })));
  if (error) throw new Error(error.message);
}

/** PH department managers (migration 0334) — explicit lists per department; a department with none uses the role default. */
export interface PhDepartmentManagerRow {
  department: string;
  profileId: string;
}

export async function getPhDepartmentManagers(): Promise<PhDepartmentManagerRow[]> {
  const { data, error } = await supabase.from("ph_department_managers").select("department, profile_id");
  if (error) return [];
  return (data ?? []).map((r: any) => ({ department: r.department as string, profileId: r.profile_id as string }));
}

/** Replaces one department's manager list. Pass [] to go back to the role default. */
export async function setPhDepartmentManagers(department: string, profileIds: string[]): Promise<void> {
  const { error: delError } = await supabase.from("ph_department_managers").delete().eq("department", department);
  if (delError) throw new Error(delError.message);
  if (profileIds.length === 0) return;
  const { error } = await supabase.from("ph_department_managers").insert(profileIds.map((profile_id) => ({ department, profile_id })));
  if (error) throw new Error(error.message);
}

export async function deleteApprovalArea(id: string): Promise<void> {
  const { error } = await supabase.from("approval_areas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
