/**
 * HR "Leaders" tab — department-grouped leadership roster (migration 0153).
 * A hand-maintained roster, not derived from profiles.role/department (see
 * the migration's header comment for why) — edited by dragging rows to
 * reorder within a department or move to a different one, on the HR Daily
 * Report page's Leaders tab.
 *
 * `reportsTo` (migration 0154) is an optional reporting line WITHIN a
 * department — e.g. Technician's Branch Managers each report to a Senior
 * Branch Manager, who reports to the Assistant Technical Director. Null
 * means "top of this department's tree" (or the department has no
 * hierarchy at all — most don't).
 */

import { supabase } from "./client";

export type LeadersRosterTier = "senior" | "manager" | "standard";

export interface LeadersRosterRow {
  id: string;
  department: string;
  roleTitle: string;
  personName: string;
  tier: LeadersRosterTier;
  deptSort: number;
  rowSort: number;
  reportsTo: string | null;
}

const SELECT = "id, department, role_title, person_name, tier, dept_sort, row_sort, reports_to";

function mapRow(r: any): LeadersRosterRow {
  return {
    id: r.id,
    department: r.department,
    roleTitle: r.role_title,
    personName: r.person_name,
    tier: (r.tier as LeadersRosterTier) || "standard",
    deptSort: Number(r.dept_sort) || 0,
    rowSort: Number(r.row_sort) || 0,
    reportsTo: r.reports_to ?? null,
  };
}

export async function getLeadersRoster(): Promise<LeadersRosterRow[]> {
  const { data, error } = await supabase
    .from("hr_leaders_roster")
    .select(SELECT)
    .order("dept_sort", { ascending: true })
    .order("row_sort", { ascending: true });
  if (error) {
    console.error("getLeadersRoster error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

export async function upsertLeadersRosterRow(input: {
  id?: string;
  department: string;
  roleTitle: string;
  personName: string;
  tier: LeadersRosterTier;
  deptSort: number;
  rowSort: number;
  reportsTo?: string | null;
}): Promise<string> {
  const payload = {
    department: input.department,
    role_title: input.roleTitle,
    person_name: input.personName,
    tier: input.tier,
    dept_sort: input.deptSort,
    row_sort: input.rowSort,
    reports_to: input.reportsTo ?? null,
  };
  if (input.id) {
    const { error } = await supabase.from("hr_leaders_roster").update(payload).eq("id", input.id);
    if (error) throw new Error(error.message);
    return input.id;
  }
  const { data, error } = await supabase.from("hr_leaders_roster").insert(payload).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Drag-drop reposition — only touches the fields a move can change (department block + its ordering), never the role/name text or reporting line. */
export async function moveLeadersRosterRow(id: string, next: { department: string; deptSort: number; rowSort: number }): Promise<void> {
  const { error } = await supabase
    .from("hr_leaders_roster")
    .update({ department: next.department, dept_sort: next.deptSort, row_sort: next.rowSort })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteLeadersRosterRow(id: string): Promise<void> {
  const { error } = await supabase.from("hr_leaders_roster").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
