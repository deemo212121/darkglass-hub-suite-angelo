/**
 * Branch/Role working-hours templates (migration 0121) — lets an Admin set a
 * Required Schedule (Check-In/Check-Out) once per branch + role instead of
 * per employee. This module only reads/writes the template row itself;
 * applying it to employees' actual profiles.required_check_in/out is a
 * separate step (see ManageWorkingHoursModal.tsx, which calls
 * updateCompanyUser from ./users for each selected employee).
 */
import { supabase } from "./client";

export interface BranchRoleScheduleRow {
  id: string;
  branch: string;
  role: string;
  requiredCheckIn: string;
  requiredCheckOut: string;
}

function mapRow(row: any): BranchRoleScheduleRow {
  return {
    id: row.id,
    branch: row.branch,
    role: row.role,
    requiredCheckIn: row.required_check_in,
    requiredCheckOut: row.required_check_out,
  };
}

/** Every saved branch/role template for the caller's company (RLS-scoped, Admin/Superadmin only). */
export async function getBranchRoleSchedules(): Promise<BranchRoleScheduleRow[]> {
  const { data, error } = await supabase
    .from("branch_role_schedules")
    .select("id, branch, role, required_check_in, required_check_out")
    .order("branch", { ascending: true });
  if (error) {
    console.error("getBranchRoleSchedules error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Create or update the template for one (branch, role) pair. */
export async function upsertBranchRoleSchedule(input: {
  branch: string;
  role: string;
  requiredCheckIn: string;
  requiredCheckOut: string;
}): Promise<void> {
  const { error } = await supabase.from("branch_role_schedules").upsert(
    {
      branch: input.branch,
      role: input.role,
      required_check_in: input.requiredCheckIn,
      required_check_out: input.requiredCheckOut,
    },
    { onConflict: "company_id,branch,role" }
  );
  if (error) {
    console.error("upsertBranchRoleSchedule error:", error.message);
    throw new Error(error.message);
  }
}
