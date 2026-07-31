/**
 * Staff side of the public "quick live chat" widget (see migration 0091
 * and src/components/LiveChatWidget.tsx / LiveChatSupportPage.tsx).
 *
 * Unlike the visitor side (which has no Supabase session and goes through
 * src/lib/server/liveChatBridge.ts instead), staff are logged in — this
 * reads/writes directly via the authenticated client under normal RLS,
 * same pattern as src/lib/supabase/messaging.ts.
 */
import { supabase } from "./client";
import { auth as firebaseAuth } from "@/lib/firebase/config";

export interface LiveChatSessionRow {
  id: string;
  visitor_name: string | null;
  visitor_phone: string | null;
  branch: string | null;
  concern: string | null;
  appliance: string | null;
  status: "open" | "closed";
  created_at: string;
  last_message_at: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  visitor_typing_at: string | null;
  visitor_last_seen_at: string | null;
  escalated: boolean;
  transferred_from: string | null;
  transferred_from_name: string | null;
  // Merged in from live_chat_inbox_previews() (migration 0096) — not real
  // columns on the table, just derived per-session summary data for the
  // conversation list.
  unreadCount: number;
  lastMessageBody: string | null;
  lastMessageSender: "visitor" | "staff" | null;
}

export type LiveChatMessageKind = "chat" | "callback_request" | "appointment_request" | "internal_note" | "system";

export interface LiveChatMessageRow {
  id: string;
  session_id: string;
  sender: "visitor" | "staff";
  sender_name: string | null;
  body: string;
  kind: LiveChatMessageKind;
  request_data: Record<string, any> | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime_type: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

const SESSION_COLUMNS =
  "id, visitor_name, visitor_phone, branch, concern, appliance, status, created_at, last_message_at, assigned_to, assigned_to_name, visitor_typing_at, visitor_last_seen_at, escalated, transferred_from, transferred_from_name";

interface InboxPreviewRow {
  session_id: string;
  unread_count: number;
  last_message_body: string | null;
  last_message_sender: "visitor" | "staff" | null;
  last_message_at: string | null;
}
const MESSAGE_COLUMNS =
  "id, session_id, sender, sender_name, body, kind, request_data, attachment_url, attachment_name, attachment_mime_type, delivered_at, read_at, created_at";

/**
 * Every chat session for the caller's company, most recently active first.
 * Also marks any visitor message across these sessions as "delivered" —
 * this fires just from the queue list refreshing (realtime/polling),
 * independent of any one staff member opening a specific thread, which is
 * what "read" (see getLiveChatMessages) is reserved for.
 */
export async function listLiveChatSessions(): Promise<LiveChatSessionRow[]> {
  const [sessionsRes, previewsRes] = await Promise.all([
    supabase.from("live_chat_sessions").select(SESSION_COLUMNS).order("last_message_at", { ascending: false }),
    supabase.rpc("live_chat_inbox_previews"),
  ]);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);
  if (previewsRes.error) console.error("Failed to load inbox previews:", previewsRes.error.message);

  const previewsById = new Map((previewsRes.data as InboxPreviewRow[] | null ?? []).map((p) => [p.session_id, p]));
  const sessions = ((sessionsRes.data as Omit<LiveChatSessionRow, "unreadCount" | "lastMessageBody" | "lastMessageSender">[]) ?? []).map((s) => {
    const preview = previewsById.get(s.id);
    return {
      ...s,
      unreadCount: preview?.unread_count ?? 0,
      lastMessageBody: preview?.last_message_body ?? null,
      lastMessageSender: preview?.last_message_sender ?? null,
    };
  });

  const sessionIds = sessions.filter((s) => s.status === "open").map((s) => s.id);
  if (sessionIds.length > 0) {
    void supabase
      .from("live_chat_messages")
      .update({ delivered_at: new Date().toISOString() })
      .in("session_id", sessionIds)
      .eq("sender", "visitor")
      .is("delivered_at", null)
      .then(({ error }) => { if (error) console.error("Failed to mark visitor messages delivered:", error.message); });
  }

  return sessions;
}

/** Fetches a thread's messages and marks any visitor messages in it as read — this is the "I actually opened this conversation" signal, distinct from just appearing in the queue list. */
export async function getLiveChatMessages(sessionId: string): Promise<LiveChatMessageRow[]> {
  const { data, error } = await supabase
    .from("live_chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const now = new Date().toISOString();
  void supabase
    .from("live_chat_messages")
    .update({ delivered_at: now, read_at: now })
    .eq("session_id", sessionId)
    .eq("sender", "visitor")
    .is("read_at", null)
    .then(({ error }) => { if (error) console.error("Failed to mark visitor messages read:", error.message); });

  return (data as LiveChatMessageRow[]) ?? [];
}

/** Throttle this client-side (see LiveChatSupportPage.tsx) — no need to hit the DB on every keystroke. */
export async function setLiveChatStaffTyping(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("live_chat_sessions")
    .update({ staff_typing_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) console.error("Failed to set staff typing indicator:", error.message);
}

export async function sendLiveChatStaffReply(sessionId: string, senderName: string, body: string): Promise<void> {
  const { error: insertError } = await supabase
    .from("live_chat_messages")
    .insert({ session_id: sessionId, sender: "staff", sender_name: senderName, body });
  if (insertError) throw new Error(insertError.message);

  const { error: touchError } = await supabase
    .from("live_chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (touchError) throw new Error(touchError.message);
}

export async function closeLiveChatSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("live_chat_sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

/**
 * Claims a chat so the rest of the queue sees it's being handled — race-safe
 * by construction (see migration 0092): the update only matches a row that's
 * still unassigned, so if two staff click "Assist" on the same chat at
 * nearly the same moment, only the first actually claims it. `claimed:
 * false` means someone else beat the caller to it; the caller should refetch
 * sessions to see who.
 */
export async function assistLiveChatSession(sessionId: string, staffProfileId: string, staffName: string): Promise<{ claimed: boolean }> {
  const { data, error } = await supabase
    .from("live_chat_sessions")
    .update({ assigned_to: staffProfileId, assigned_to_name: staffName })
    .eq("id", sessionId)
    .is("assigned_to", null)
    .select("id");
  if (error) throw new Error(error.message);
  const claimed = (data?.length ?? 0) > 0;
  // Best-effort — a failed system-message insert shouldn't undo a successful
  // claim. Generic wording (not the agent's name) — see kind="system", a
  // small gray notice rendered on both the staff and customer side, distinct
  // from a normal chat bubble or a staff-only internal_note.
  if (claimed) {
    void supabase
      .from("live_chat_messages")
      .insert({ session_id: sessionId, sender: "staff", kind: "system", body: "Agent joined the chat" })
      .then(({ error: msgError }) => { if (msgError) console.error("Failed to post 'agent joined' system message:", msgError.message); });
  }
  return { claimed };
}

/** Only releases if the caller is the one currently assigned — a stale UI can't accidentally steal someone else's claim by "releasing" it out from under them. */
export async function releaseLiveChatSession(sessionId: string, staffProfileId: string): Promise<void> {
  const { error } = await supabase
    .from("live_chat_sessions")
    .update({ assigned_to: null, assigned_to_name: null })
    .eq("id", sessionId)
    .eq("assigned_to", staffProfileId);
  if (error) throw new Error(error.message);
}

/**
 * Hand a claimed chat to a specific person (not "first to click," unlike
 * Assist) — unconditional, whoever's transferring it is trusted to know
 * who should have it next. Goes through liveChatStaffBridge.ts (service
 * key) rather than a direct client update: Transfer's whole point is
 * moving a chat OUTSIDE the caller's own tiered visibility (a different
 * team, a specialist), which live_chat_sessions_update's RLS check
 * blocks even after simplifying it back to a plain company-id check —
 * see that bridge file's header comment.
 */
export async function transferLiveChatSession(sessionId: string, toProfileId: string, toName: string): Promise<void> {
  const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
  if (!idToken) throw new Error("You need to be logged in to transfer a chat.");
  const res = await fetch("/api/live-chat-staff?action=transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, sessionId, toProfileId }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error || "Failed to transfer chat.");
}

/** A visual flag for the queue/header, not a workflow of its own. */
export async function setLiveChatEscalated(sessionId: string, escalated: boolean): Promise<void> {
  const { error } = await supabase.from("live_chat_sessions").update({ escalated }).eq("id", sessionId);
  if (error) throw new Error(error.message);
  // Best-effort, escalating only (not un-escalating) — a small gray notice
  // (kind="system", visible to both sides, same as "Agent joined the chat")
  // so the customer knows something changed instead of just seeing silence.
  if (escalated) {
    void supabase
      .from("live_chat_messages")
      .insert({ session_id: sessionId, sender: "staff", kind: "system", body: "Your concern has been escalated — please wait a moment." })
      .then(({ error: msgError }) => { if (msgError) console.error("Failed to post escalation system message:", msgError.message); });
  }
}

/** Staff-only — never returned to the visitor widget (see liveChatBridge.ts's GET handler, which excludes kind=internal_note). */
export async function addLiveChatInternalNote(sessionId: string, staffName: string, body: string): Promise<void> {
  const { error } = await supabase
    .from("live_chat_messages")
    .insert({ session_id: sessionId, sender: "staff", sender_name: staffName, kind: "internal_note", body });
  if (error) throw new Error(error.message);
}

/** Staff-initiated counterpart to the customer's own "Schedule Service" quick action — same badge rendering either way, just sender: "staff". Used both for the sidebar's Quick Action and for "Suggest Different Time" on an existing request. `note` (e.g. "we're fully booked that morning") is stored in request_data and rendered right on the badge, so the customer sees why, not just a new time appearing. */
export async function requestLiveChatAppointment(
  sessionId: string,
  staffName: string,
  day: "today" | "tomorrow" | "custom",
  date: string | null,
  window: string,
  note?: string
): Promise<void> {
  const label = day === "today" ? "Today" : day === "tomorrow" ? "Tomorrow" : date || "a preferred date";
  const trimmedNote = note?.trim() || null;
  const { error: insertError } = await supabase.from("live_chat_messages").insert({
    session_id: sessionId,
    sender: "staff",
    sender_name: staffName,
    kind: "appointment_request",
    request_data: { day, date, window, status: "pending", note: trimmedNote },
    body: `Proposed a service appointment: ${label}`,
  });
  if (insertError) throw new Error(insertError.message);

  const { error: touchError } = await supabase
    .from("live_chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (touchError) throw new Error(touchError.message);
}

/** Staff-initiated callback counter-proposal — same idea as requestLiveChatAppointment, for "Suggest Different Time" on a callback request. */
export async function proposeLiveChatCallback(sessionId: string, staffName: string, preference: "now" | "30min" | "tomorrow", note?: string): Promise<void> {
  const label = preference === "now" ? "Now" : preference === "30min" ? "In 30 minutes" : "Tomorrow";
  const trimmedNote = note?.trim() || null;
  const { error: insertError } = await supabase.from("live_chat_messages").insert({
    session_id: sessionId,
    sender: "staff",
    sender_name: staffName,
    kind: "callback_request",
    request_data: { preference, status: "pending", note: trimmedNote },
    body: `Proposed a callback: ${label}`,
  });
  if (insertError) throw new Error(insertError.message);

  const { error: touchError } = await supabase
    .from("live_chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (touchError) throw new Error(touchError.message);
}

/** Marks a callback/appointment request as accepted or declined (superseded by a countered time) — read as request_data?.status ?? "pending" by the UI, so old rows created before this existed default to pending. */
export async function respondToLiveChatRequest(messageId: string, requestData: Record<string, any> | null, status: "accepted" | "declined"): Promise<void> {
  const { error } = await supabase
    .from("live_chat_messages")
    .update({ request_data: { ...(requestData ?? {}), status } })
    .eq("id", messageId);
  if (error) throw new Error(error.message);
}

export interface LiveChatSavedReplyRow {
  id: string;
  label: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
}

/** Company-wide canned replies (see migration 0106) — any CSR can create, use, edit, or delete any of them; not personal to whoever made it. */
export async function getSavedReplies(): Promise<LiveChatSavedReplyRow[]> {
  const { data, error } = await supabase
    .from("live_chat_saved_replies")
    .select("id, label, body, created_by, created_at")
    .order("label", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    label: r.label,
    body: r.body,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

export async function createSavedReply(label: string, body: string): Promise<void> {
  const { error } = await supabase.from("live_chat_saved_replies").insert({ label, body });
  if (error) throw new Error(error.message);
}

export async function updateSavedReply(id: string, label: string, body: string): Promise<void> {
  const { error } = await supabase.from("live_chat_saved_replies").update({ label, body }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSavedReply(id: string): Promise<void> {
  const { error } = await supabase.from("live_chat_saved_replies").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
