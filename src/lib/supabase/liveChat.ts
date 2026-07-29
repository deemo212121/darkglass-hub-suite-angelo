/**
 * Staff side of the public "quick live chat" widget (see migration 0078
 * and src/components/LiveChatWidget.tsx / LiveChatSupportPage.tsx).
 *
 * Unlike the visitor side (which has no Supabase session and goes through
 * src/lib/server/liveChatBridge.ts instead), staff are logged in — this
 * reads/writes directly via the authenticated client under normal RLS,
 * same pattern as src/lib/supabase/messaging.ts.
 */
import { supabase } from "./client";

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
  // Merged in from live_chat_inbox_previews() (migration 0083) — not real
  // columns on the table, just derived per-session summary data for the
  // conversation list.
  unreadCount: number;
  lastMessageBody: string | null;
  lastMessageSender: "visitor" | "staff" | null;
}

export type LiveChatMessageKind = "chat" | "callback_request" | "appointment_request" | "internal_note";

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
  "id, visitor_name, visitor_phone, branch, concern, appliance, status, created_at, last_message_at, assigned_to, assigned_to_name, visitor_typing_at, visitor_last_seen_at, escalated";

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
 * by construction (see migration 0079): the update only matches a row that's
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
  return { claimed: (data?.length ?? 0) > 0 };
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

/** Hand a claimed chat to a specific person (not "first to click," unlike Assist) — unconditional, whoever's transferring it is trusted to know who should have it next. */
export async function transferLiveChatSession(sessionId: string, toProfileId: string, toName: string): Promise<void> {
  const { error } = await supabase
    .from("live_chat_sessions")
    .update({ assigned_to: toProfileId, assigned_to_name: toName })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

/** A visual flag for the queue/header, not a workflow of its own. */
export async function setLiveChatEscalated(sessionId: string, escalated: boolean): Promise<void> {
  const { error } = await supabase.from("live_chat_sessions").update({ escalated }).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

/** Staff-only — never returned to the visitor widget (see liveChatBridge.ts's GET handler, which excludes kind=internal_note). */
export async function addLiveChatInternalNote(sessionId: string, staffName: string, body: string): Promise<void> {
  const { error } = await supabase
    .from("live_chat_messages")
    .insert({ session_id: sessionId, sender: "staff", sender_name: staffName, kind: "internal_note", body });
  if (error) throw new Error(error.message);
}

/** Staff-initiated counterpart to the customer's own "Schedule Service" quick action — same badge rendering either way, just sender: "staff". Used both for the sidebar's Quick Action and for "Suggest Different Time" on an existing request. */
export async function requestLiveChatAppointment(
  sessionId: string,
  staffName: string,
  day: "today" | "tomorrow" | "custom",
  date: string | null
): Promise<void> {
  const label = day === "today" ? "Today" : day === "tomorrow" ? "Tomorrow" : date || "a preferred date";
  const { error: insertError } = await supabase.from("live_chat_messages").insert({
    session_id: sessionId,
    sender: "staff",
    sender_name: staffName,
    kind: "appointment_request",
    request_data: { day, date, window: "9:00 AM - 12:00 PM", status: "pending" },
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
export async function proposeLiveChatCallback(sessionId: string, staffName: string, preference: "now" | "30min" | "tomorrow"): Promise<void> {
  const label = preference === "now" ? "Now" : preference === "30min" ? "In 30 minutes" : "Tomorrow";
  const { error: insertError } = await supabase.from("live_chat_messages").insert({
    session_id: sessionId,
    sender: "staff",
    sender_name: staffName,
    kind: "callback_request",
    request_data: { preference, status: "pending" },
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
