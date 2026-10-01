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

export async function deleteApprovalArea(id: string): Promise<void> {
  const { error } = await supabase.from("approval_areas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
