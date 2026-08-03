/**
 * Firestore-backed notification system.
 * Collection: notifications/{uid}/items/{notifId}
 *
 * Supports:
 *  - System-triggered alerts (parts, claims, tech EOD)
 *  - Targeted delivery to specific UIDs or role groups
 *  - Real-time unread count via onSnapshot
 */
import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db, isFirebaseReady } from "./config";

export type NotifKind =
  | "system"
  | "part_status_change"
  | "cross_inventory_request"
  | "tech_eod_reminder"
  | "restock_auto"
  | "claim_part_tamper"
  | "warning_mistake_issued"
  | "jotform_submission";

export interface AppNotification {
  id: string;
  uid: string;           // recipient uid
  kind: NotifKind;
  title: string;
  body: string;
  link?: string;         // optional route to navigate to
  ticketNo?: string;     // attach a ticket number for deep-link
  isRead: boolean;
  createdAt: string;     // ISO string
  // Jotform's "Label: value, Label: value…" summary of every submitted
  // answer — only present on kind: "jotform_submission" notifications.
  answers?: string;
  // Any file-upload answers, re-hosted in Firebase Storage (see
  // src/lib/server/jotformBridge.ts) — only present on jotform_submission.
  photos?: string[];
  // Short summaries of any attachment that failed to mirror to Storage —
  // surfaced so a failure is visible here instead of only a server log.
  attachmentErrors?: string[];
}

// ─── Write ─────────────────────────────────────────────────────────────────

/** Send a notification to one or more UIDs. */
export async function sendNotification(
  recipientUids: string[],
  payload: Omit<AppNotification, "id" | "uid" | "isRead" | "createdAt">
): Promise<void> {
  if (!isFirebaseReady() || !db) return;
  // Firestore rejects a field explicitly set to `undefined` (unlike `null`
  // or simply omitting it) — strip those out so callers can pass optional
  // fields like `link`/`ticketNo` as `undefined` without the whole write
  // failing. Without this, addDoc() throws and the notification never
  // saves, silently, unless the caller happens to await + catch it.
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined)
  ) as typeof payload;
  await Promise.all(
    recipientUids.map((uid) =>
      addDoc(collection(db!, "notifications", uid, "items"), {
        ...cleanPayload,
        uid,
        isRead: false,
        createdAt: serverTimestamp(),
      })
    )
  );
}

/** Convenience: notify by role label (looks up users from users_index). */
export async function sendNotificationToRole(
  roleLabel: string,
  companyId: string,
  payload: Omit<AppNotification, "id" | "uid" | "isRead" | "createdAt">
): Promise<void> {
  if (!isFirebaseReady() || !db) return;
  const q = query(
    collection(db!, "users_index"),
    where("userType", "==", roleLabel),
    where("companyId", "==", companyId)
  );
  const snap = await getDocs(q);
  const uids = snap.docs.map((d) => d.data().uid as string).filter(Boolean);
  if (uids.length > 0) await sendNotification(uids, payload);
}

/** Notify specific named users (Naveen, Ian, Tina) by display name. */
export async function sendNotificationToUsers(
  displayNames: string[],
  companyId: string,
  payload: Omit<AppNotification, "id" | "uid" | "isRead" | "createdAt">
): Promise<void> {
  if (!isFirebaseReady() || !db) return;
  const uids: string[] = [];
  for (const name of displayNames) {
    const q = query(
      collection(db!, "users_index"),
      where("displayName", "==", name),
      where("companyId", "==", companyId)
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const uid = d.data().uid as string;
      if (uid) uids.push(uid);
    });
  }
  if (uids.length > 0) await sendNotification(uids, payload);
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getNotifications(uid: string): Promise<AppNotification[]> {
  if (!isFirebaseReady() || !db) return [];
  const q = query(
    collection(db!, "notifications", uid, "items"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<AppNotification, "id" | "createdAt">),
    createdAt:
      d.data().createdAt instanceof Timestamp
        ? (d.data().createdAt as Timestamp).toDate().toISOString()
        : String(d.data().createdAt ?? ""),
  }));
}

export function subscribeNotifications(
  uid: string,
  onChange: (items: AppNotification[]) => void
): Unsubscribe {
  if (!isFirebaseReady() || !db) return () => {};
  const q = query(
    collection(db!, "notifications", uid, "items"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AppNotification, "id" | "createdAt">),
      createdAt:
        d.data().createdAt instanceof Timestamp
          ? (d.data().createdAt as Timestamp).toDate().toISOString()
          : String(d.data().createdAt ?? ""),
    }));
    onChange(items);
  });
}

export async function markNotificationRead(uid: string, notifId: string): Promise<void> {
  if (!isFirebaseReady() || !db) return;
  await updateDoc(doc(db!, "notifications", uid, "items", notifId), { isRead: true });
}

export async function deleteNotification(uid: string, notifId: string): Promise<void> {
  if (!isFirebaseReady() || !db) return;
  await deleteDoc(doc(db!, "notifications", uid, "items", notifId));
}

export async function markAllNotificationsRead(uid: string): Promise<void> {
  if (!isFirebaseReady() || !db) return;
  const q = query(
    collection(db!, "notifications", uid, "items"),
    where("isRead", "==", false)
  );
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { isRead: true })));
}
