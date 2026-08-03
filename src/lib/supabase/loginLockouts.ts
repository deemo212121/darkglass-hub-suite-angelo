/**
 * Admin-side reads/actions for the Login Security page's Lockouts/History
 * tabs (LoginSecurityPage.tsx). The lockout state itself
 * (profiles.failed_login_count/locked_until) and the history log
 * (login_lockout_events) are written pre-authentication by
 * loginLockoutBridge.ts — this file covers the two things an already-logged-in
 * admin does from here: reading that history, and clearing an active lock.
 */
import { supabase } from "./client";

export interface LoginLockoutEventRow {
  id: string;
  profileId: string | null;
  employeeName: string;
  employeeEmail: string;
  failCount: number;
  lockedAt: string;
}

function mapEventRow(row: any): LoginLockoutEventRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    failCount: row.fail_count,
    lockedAt: row.locked_at,
  };
}

/** Every recorded lockout event for the caller's company, newest first (migration 0123). */
export async function getLoginLockoutHistory(): Promise<LoginLockoutEventRow[]> {
  const { data, error } = await supabase
    .from("login_lockout_events")
    .select("id, profile_id, employee_name, employee_email, fail_count, locked_at")
    .order("locked_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("getLoginLockoutHistory error:", error.message);
    return [];
  }
  return (data ?? []).map(mapEventRow);
}

/** Resets an account's failed-attempt counter and clears any active lock — same RLS path as any other admin profile edit (updateCompanyUser). */
export async function resetLoginLockout(profileId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ failed_login_count: 0, locked_until: null })
    .eq("id", profileId);
  if (error) {
    console.error("resetLoginLockout error:", error.message);
    throw new Error(error.message);
  }
}
