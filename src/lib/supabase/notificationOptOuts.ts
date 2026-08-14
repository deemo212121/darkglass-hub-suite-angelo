/**
 * Per-user opt-outs layered on top of Notification Access by Role
 * (notificationRoleGates.ts) — a user's role makes them a CANDIDATE for
 * a notification trigger, but this table lets an admin exclude a
 * specific person from it anyway. See migration 0172.
 */
import { supabase } from "./client";

/** trigger_key -> Set of opted-out firebase_uids, for every trigger that has at least one opt-out. */
export async function getNotificationOptOuts(): Promise<Record<string, Set<string>>> {
  const { data, error } = await supabase.from("notification_user_opt_outs").select("firebase_uid, trigger_key");
  if (error) {
    console.error("getNotificationOptOuts error:", error.message);
    return {};
  }
  const out: Record<string, Set<string>> = {};
  for (const row of data ?? []) {
    (out[row.trigger_key] ??= new Set()).add(row.firebase_uid as string);
  }
  return out;
}

export async function setUserNotificationOptOut(firebaseUid: string, triggerKey: string, optedOut: boolean): Promise<void> {
  if (optedOut) {
    const { error } = await supabase
      .from("notification_user_opt_outs")
      .insert({ firebase_uid: firebaseUid, trigger_key: triggerKey });
    // 23505 = unique_violation — already opted out (e.g. a stale double-click), harmless.
    if (error && (error as { code?: string }).code !== "23505") throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("notification_user_opt_outs")
      .delete()
      .eq("firebase_uid", firebaseUid)
      .eq("trigger_key", triggerKey);
    if (error) throw new Error(error.message);
  }
}

/** Filters a firebase_uid list down to only those NOT opted out of triggerKey. Fails open (returns the input unfiltered) on a query error, rather than silently dropping every recipient. */
export async function filterOptedIn(uids: string[], triggerKey: string): Promise<string[]> {
  if (uids.length === 0) return uids;
  const { data, error } = await supabase
    .from("notification_user_opt_outs")
    .select("firebase_uid")
    .eq("trigger_key", triggerKey)
    .in("firebase_uid", uids);
  if (error) {
    console.error("filterOptedIn error:", error.message);
    return uids;
  }
  const optedOut = new Set((data ?? []).map((r: any) => r.firebase_uid as string));
  return uids.filter((uid) => !optedOut.has(uid));
}
