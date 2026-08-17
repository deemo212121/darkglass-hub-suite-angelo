/**
 * Shared "notify Parts Manager" helper — used by the Parts hub's "Done"
 * button (m.$module.tsx). The notified role(s) may be someone's PRIMARY
 * role (Firestore users_index.userType, stamped once at account
 * creation) or an EXTRA role (Supabase profiles.extra_roles, which
 * Firestore has no concept of) — merges both lookups and sends once so
 * nobody with both ends up double-notified.
 *
 * Which role(s) to notify is itself configurable — see
 * notificationRoleGates.ts's "parts_done_digest" trigger (defaults to
 * Parts Manager) — so this takes the effective role list as a param
 * instead of hardcoding "Parts Manager"/"PARTS_MANAGER".
 */
import { getFirebaseUidsForRoles } from "@/lib/supabase/users";
import { sendNotification, getUidsForFirestoreRole, type AppNotification } from "@/lib/firebase/notifications";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { filterOptedIn } from "@/lib/supabase/notificationOptOuts";

/** Returns how many people actually got notified (post opt-out filtering) — used to log the Done-button activity, see partsDoneActivityLog.ts. */
export async function notifyPartsManagers(
  companyId: string | null,
  roleCodes: string[],
  triggerKey: string,
  payload: Omit<AppNotification, "id" | "uid" | "isRead" | "createdAt">
): Promise<number> {
  const firestoreLookups = await Promise.all(
    roleCodes.map((code) => getUidsForFirestoreRole(ROLE_LABELS[code] || code, companyId ?? ""))
  );
  const supabaseUids = await getFirebaseUidsForRoles(roleCodes);
  const candidates = Array.from(new Set([...firestoreLookups.flat(), ...supabaseUids]));
  const uids = await filterOptedIn(candidates, triggerKey);
  if (uids.length > 0) await sendNotification(uids, payload);
  return uids.length;
}
