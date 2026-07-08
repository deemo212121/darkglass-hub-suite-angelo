/**
 * Bell-icon notifications — a dedicated table (see migration 0035),
 * separate from the internal messenger's dm_threads/messages. Sending one
 * of these never creates or touches a DM thread, so it only ever shows up
 * in the recipient's notification bell, not their Messages inbox.
 */

import { supabase } from "./client";

export interface NotificationRow {
  id: string;
  recipientId: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  linkTo: string | null;
  isRead: boolean;
  createdAt: string;
}

function mapRow(row: any): NotificationRow {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    senderId: row.sender_id ?? null,
    senderName: row.sender_name ?? null,
    body: row.body,
    linkTo: row.link_to ?? null,
    isRead: Boolean(row.read_at),
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = "id, recipient_id, sender_id, sender_name, body, link_to, read_at, created_at";

/** The bell-icon feed for the caller, newest first. */
export async function getMyNotifications(profileId: string, limit = 30): Promise<NotificationRow[]> {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("notifications")
    .select(SELECT_COLUMNS)
    .eq("recipient_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("getMyNotifications error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Send a bell notification to one recipient. */
export async function createNotification(input: {
  recipientId: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  linkTo?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    recipient_id: input.recipientId,
    sender_id: input.senderId,
    sender_name: input.senderName,
    body: input.body,
    link_to: input.linkTo || null,
  });
  if (error) {
    console.error("createNotification error:", error.message);
    throw new Error(error.message);
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) console.warn("markNotificationRead:", error.message);
}

export async function markAllNotificationsRead(profileId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", profileId)
    .is("read_at", null);
  if (error) console.warn("markAllNotificationsRead:", error.message);
}

/** Live-append any new notification addressed to me. Returns an unsubscribe function. */
export function subscribeToMyNotifications(profileId: string, onInsert: (row: NotificationRow) => void): () => void {
  const channelName = `notifications-${profileId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sub = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${profileId}` },
      (payload: any) => {
        const row = payload?.new;
        if (row) onInsert(mapRow(row));
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(sub); } catch { /* ignore */ }
  };
}
