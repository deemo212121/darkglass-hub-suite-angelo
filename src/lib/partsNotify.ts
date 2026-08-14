/**
 * Shared "notify Parts Manager" helper — used by the Parts hub's "I'm
 * Done" button (m.$module.tsx). Parts Manager may be someone's PRIMARY
 * role (Firestore users_index.userType, stamped once at account
 * creation) or an EXTRA role (Supabase profiles.extra_roles, which
 * Firestore has no concept of) — merges both lookups and sends once so
 * nobody with both ends up double-notified.
 */
import { getFirebaseUidsForRole } from "@/lib/supabase/users";
import { sendNotification, getUidsForFirestoreRole, type AppNotification } from "@/lib/firebase/notifications";

export async function notifyPartsManagers(
  companyId: string | null,
  payload: Omit<AppNotification, "id" | "uid" | "isRead" | "createdAt">
): Promise<void> {
  const [firestoreUids, supabaseUids] = await Promise.all([
    getUidsForFirestoreRole("Parts Manager", companyId ?? ""),
    getFirebaseUidsForRole("PARTS_MANAGER"),
  ]);
  const uids = Array.from(new Set([...firestoreUids, ...supabaseUids]));
  if (uids.length > 0) await sendNotification(uids, payload);
}
