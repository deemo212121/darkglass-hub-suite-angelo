/**
 * Attendance Monitoring's SuperAdmin-only Settings tab — which managers
 * are enrolled to receive the grace-period warning email (see migration
 * 0217, src/lib/server/attendanceAlerts.ts). A manager is "enrolled" iff a
 * row exists here for them; checking/unchecking their box just inserts or
 * deletes one. RLS restricts every read/write to SuperAdmin (see the
 * migration), matching the tab itself being hidden from everyone else.
 */
import { supabase } from "./client";
import { auth as firebaseAuth } from "@/lib/firebase/config";

/** Every enrolled manager's profile id, for the current company. */
export async function getAttendanceWarningSubscribedManagerIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from("attendance_warning_subscriptions").select("manager_profile_id");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: any) => r.manager_profile_id as string));
}

export async function enrollAttendanceWarningManager(managerProfileId: string, createdBy: string, createdByName: string): Promise<void> {
  const { error } = await supabase.from("attendance_warning_subscriptions").upsert(
    { manager_profile_id: managerProfileId, created_by: createdBy, created_by_name: createdByName },
    { onConflict: "company_id,manager_profile_id" }
  );
  if (error) throw new Error(error.message);
}

export async function unenrollAttendanceWarningManager(managerProfileId: string): Promise<void> {
  const { error } = await supabase.from("attendance_warning_subscriptions").delete().eq("manager_profile_id", managerProfileId);
  if (error) throw new Error(error.message);
}

/** One-off confirmation email, sent the moment a manager's checkbox is
 *  checked — separate from the actual grace-warning emails
 *  attendanceAlerts.ts sends later. Uses the same ATTENDANCE Gmail
 *  connection; throws with a readable message if it's not connected yet
 *  (caller decides whether that should block enrollment or just warn). */
export async function sendAttendanceEnrollmentEmail(managerProfileId: string): Promise<{ sentTo: string }> {
  const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
  if (!idToken) throw new Error("You need to be logged in to send this email.");
  const res = await fetch("/api/gmail?action=send-attendance-enrollment-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, managerProfileId }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; sentTo?: string; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error || "Failed to send enrollment email.");
  return { sentTo: body.sentTo || "" };
}
