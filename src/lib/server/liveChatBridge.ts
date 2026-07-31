/**
 * Public "quick live chat" bridge — a landing-page visitor has no AHS
 * account, so this is the anonymous equivalent of Team Messenger, same
 * "service-role key, no RLS" shape as customFormsBridge.ts/signableDocumentsBridge.ts.
 * The client (LiveChatWidget.tsx) only ever talks to /api/live-chat via
 * plain fetch — it never imports src/lib/supabase/client.ts.
 *
 * Every visitor session is stamped with whichever company is the oldest
 * (first ever created) in this deployment — see resolvePrimaryCompanyId()
 * — since the landing page is shared across every tenant with no way to
 * know which company a not-yet-logged-in visitor represents (see migration
 * 0078's header comment).
 *
 * Flow:
 *  1. POST /api/live-chat?action=start — body { name?, phone, branch?, concern?,
 *     appliance?, message } — creates a new session + its first visitor
 *     message, returns { sessionId }. Also fires a best-effort "New Live
 *     Chat inquiry" notification to every CSR Agent-through-Manager/BizOps/
 *     Admin account (see notifyNewLiveChatInquiry).
 *  2. POST /api/live-chat?action=message&sessionId=X — body { message } —
 *     appends a visitor message to an existing open session.
 *  3. POST /api/live-chat?action=upload&sessionId=X — multipart/form-data
 *     with a `file` field (an image) — uploads to Firebase Storage the same
 *     way Custom Forms' file/signature answers do, and appends a message
 *     with the attachment fields set.
 *  4. POST /api/live-chat?action=typing&sessionId=X — no body — refreshes
 *     visitor_typing_at so staff can show a "visitor is typing" indicator.
 *  5. POST /api/live-chat?action=callback&sessionId=X — body { preference:
 *     "now"|"30min"|"tomorrow" } — records a callback request as a
 *     kind=callback_request message, rendered as a badge (not a chat
 *     bubble) on the staff side.
 *  6. POST /api/live-chat?action=schedule&sessionId=X — body { day:
 *     "today"|"tomorrow"|"custom", date? } — same idea for an appointment
 *     request (kind=appointment_request).
 *  7. POST /api/live-chat?action=respond&sessionId=X — body { messageId,
 *     status: "accepted"|"declined" } — the visitor's own answer to a
 *     staff-proposed (sender=staff) callback/appointment request, e.g.
 *     "Accept the schedule" / "This won't work for me" in the widget.
 *     Mirrors respondToLiveChatRequest on the staff side, just reachable
 *     without a Supabase session. Declining here does NOT auto-propose
 *     anything new — the visitor just keeps chatting and staff sends
 *     another counter via "Suggest Different Time" when ready.
 *  8. GET  /api/live-chat?sessionId=X — returns the session's status + full
 *     message history + whether staff is currently typing — the widget
 *     polls this for near-real-time updates, and this is also where
 *     staff's messages get marked delivered/read (the visitor viewing the
 *     open widget IS the "read" event, there's no separate inbox for them
 *     to have seen it without opening).
 */
import { getGoogleAccessToken, uploadFileToStorage } from "./jotformBridge";

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
  projectId?: string;
  serviceAccountEmail?: string;
  privateKey?: string;
  storageBucket?: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  if (!supabaseUrl) return { error: "Server missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Server missing SUPABASE_SERVICE_KEY" };

  // Only actually needed for action=upload — read opportunistically rather
  // than failing every other action if these happen to be unset.
  const projectId = (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  const serviceAccountEmail = (g.__FIREBASE_SA_EMAIL__ && g.__FIREBASE_SA_EMAIL__ !== "" ? g.__FIREBASE_SA_EMAIL__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = (g.__FIREBASE_SA_PRIVATE_KEY__ && g.__FIREBASE_SA_PRIVATE_KEY__ !== "" ? g.__FIREBASE_SA_PRIVATE_KEY__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const storageBucket = (g.__FIREBASE_STORAGE_BUCKET__ && g.__FIREBASE_STORAGE_BUCKET__ !== "" ? g.__FIREBASE_STORAGE_BUCKET__ : undefined) ?? getEnv("VITE_FIREBASE_STORAGE_BUCKET");
  return { supabaseUrl, supabaseServiceKey, projectId, serviceAccountEmail, privateKey, storageBucket };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LEN = 120;
const MAX_BRANCH_LEN = 60;
const MAX_PHONE_LEN = 30;
const PHONE_DIGITS = 10;
const MAX_MESSAGE_LEN = 4000;
const MAX_CUSTOM_TIME_LEN = 100;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// A "staff is typing" timestamp older than this is treated as stale — no
// separate "stopped typing" event, it just times out between polls.
const TYPING_RECENCY_MS = 6000;

// Sent automatically the moment a chat starts, so the visitor isn't staring
// at a silent thread while they wait for a live agent to pick it up.
const AUTO_GREETING_SENDER_NAME = "AHS Support";
const AUTO_GREETING_MESSAGE =
  "Thanks for reaching out! An agent will be with you shortly — feel free to share more details in the meantime so we can help you faster once we connect.";

const CALLBACK_PREFERENCE_LABELS: Record<string, string> = { now: "Now", "30min": "In 30 minutes", tomorrow: "Tomorrow" };
// "custom" has no fixed label — the visitor types their own preferred time
// (request_data.customTime) instead, so this falls back to that.
function callbackLabel(preference: string, customTime: string | undefined): string {
  if (preference === "custom") return customTime || "a custom time";
  return CALLBACK_PREFERENCE_LABELS[preference] ?? preference;
}
// A single default arrival window rather than a full time picker — keeps
// the customer-side form to just "which day" (see LiveChatWidget.tsx).
const DEFAULT_APPOINTMENT_WINDOW = "9:00 AM - 12:00 PM";

function scheduleDayLabel(day: string, date: string | undefined): string {
  if (day === "today") return "Today";
  if (day === "tomorrow") return "Tomorrow";
  return date || "a preferred date";
}

// Same roles that get "wide" or "queue" visibility into Live Chat (see
// migration 0093's is_csr_wide_visibility() and DASHBOARD_ROLE_GATES in
// dashboardAccess.ts) — anyone who could pick this chat up gets pinged
// that it exists.
const LIVE_CHAT_NOTIFY_ROLES = new Set([
  "ADMIN",
  "SUPERADMIN",
  "CSR_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
  "CSR_AGENT",
  "CSR_TEAM_LEADER",
]);

function sv(s: string) {
  return { stringValue: s };
}

/** Same lookup pattern as findHrFirebaseUids in customFormsBridge.ts/jotformBridge.ts, duplicated locally rather than shared — see those files' header comments on why each bridge stays self-contained. */
async function findLiveChatNotifyFirebaseUids(env: EnvBag, companyId: string): Promise<string[]> {
  const url =
    `${env.supabaseUrl}/rest/v1/profiles?select=firebase_uid,role,extra_roles` +
    `&company_id=eq.${encodeURIComponent(companyId)}&is_active=eq.true`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase profiles query failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ firebase_uid: string | null; role: string | null; extra_roles: string[] | null }>;
  return rows
    .filter((r) => [r.role, ...(r.extra_roles ?? [])].map((v) => String(v ?? "").trim().toUpperCase()).some((v) => LIVE_CHAT_NOTIFY_ROLES.has(v)))
    .map((r) => r.firebase_uid)
    .filter((uid): uid is string => Boolean(uid));
}

async function writeLiveChatNotification(env: EnvBag, accessToken: string, uid: string, dedupeId: string, fields: { title: string; body: string; link: string }): Promise<void> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.projectId}/databases/(default)/documents/notifications/${uid}/items?documentId=${encodeURIComponent(dedupeId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        fields: {
          kind: sv("live_chat_new_inquiry"),
          title: sv(fields.title),
          body: sv(fields.body),
          uid: sv(uid),
          isRead: { booleanValue: false },
          createdAt: { timestampValue: new Date().toISOString() },
          link: sv(fields.link),
        },
      }),
    }
  );
  if (!res.ok && res.status !== 409) throw new Error(`notification write failed (${res.status}): ${await res.text()}`);
}

/** Best-effort — a new chat has already been saved by the time this runs, so a notification failure should never surface as "failed to start chat". */
async function notifyNewLiveChatInquiry(env: EnvBag, companyId: string, sessionId: string, visitorName: string, concern: string, appliance: string): Promise<void> {
  if (!env.projectId || !env.serviceAccountEmail || !env.privateKey) return;
  try {
    const accessToken = await getGoogleAccessToken(env.serviceAccountEmail, env.privateKey);
    const uids = await findLiveChatNotifyFirebaseUids(env, companyId);
    const detail = [concern, appliance].filter(Boolean).join(" — ");
    await Promise.all(
      uids.map((uid) =>
        writeLiveChatNotification(env, accessToken, uid, `livechat_${sessionId}`, {
          title: "New Live Chat inquiry",
          body: `${visitorName || "A visitor"}${detail ? `: ${detail}` : ""}`,
          link: "/m/dashboard/live-chat-support",
        })
      )
    );
  } catch (err) {
    console.error("[live-chat] new-inquiry notification failed (chat was still saved):", err);
  }
}

async function sbFetch(env: EnvBag, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.supabaseServiceKey,
      Authorization: `Bearer ${env.supabaseServiceKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * The landing page is shared across every tenant, so a not-yet-logged-in
 * visitor has no company context at all — every chat is stamped with
 * whichever company row is oldest, the one stable "primary" company this
 * public site represents. See migration 0091's header comment.
 */
async function resolvePrimaryCompanyId(env: EnvBag): Promise<string | null> {
  const res = await sbFetch(env, "companies?select=id&order=created_at.asc&limit=1");
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

interface SessionLookup {
  id: string;
  status: string;
  visitor_name: string | null;
  company_id: string;
  staff_typing_at: string | null;
}

async function fetchSession(env: EnvBag, sessionId: string): Promise<SessionLookup | null> {
  const res = await sbFetch(
    env,
    `live_chat_sessions?select=id,status,visitor_name,company_id,staff_typing_at&id=eq.${encodeURIComponent(sessionId)}&limit=1`
  );
  if (!res.ok) throw new Error(`session lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as SessionLookup[];
  return rows[0] ?? null;
}

export async function handleLiveChatRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;
  const url = new URL(request.url);

  try {
    if (request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);

      const session = await fetchSession(envBag, sessionId);
      if (!session) return json({ error: "Chat session not found." }, 404);

      // The visitor viewing the open widget IS the "delivered + read" event
      // for whatever staff has sent so far — there's no separate inbox they
      // could have seen it in without this fetch happening. Same poll also
      // refreshes visitor_last_seen_at — the inbox's online/offline dot.
      await sbFetch(
        envBag,
        `live_chat_messages?session_id=eq.${encodeURIComponent(sessionId)}&sender=eq.staff&delivered_at=is.null`,
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ delivered_at: new Date().toISOString(), read_at: new Date().toISOString() }) }
      ).catch((err) => console.error("[live-chat] failed to mark staff messages delivered/read:", err));

      await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ visitor_last_seen_at: new Date().toISOString() }),
      }).catch((err) => console.error("[live-chat] failed to update visitor_last_seen_at:", err));

      // kind=neq.internal_note — internal notes are staff-only and must
      // never reach the visitor widget, even though they're stored in the
      // same table (see migration 0097).
      const messagesRes = await sbFetch(
        envBag,
        `live_chat_messages?select=id,sender,sender_name,body,kind,request_data,attachment_url,attachment_name,attachment_mime_type,delivered_at,read_at,created_at` +
          `&session_id=eq.${encodeURIComponent(sessionId)}&kind=neq.internal_note&order=created_at.asc`
      );
      if (!messagesRes.ok) throw new Error(`messages lookup failed (${messagesRes.status}): ${await messagesRes.text()}`);
      const messages = await messagesRes.json();

      const staffTypingAt =
        session.staff_typing_at && Date.now() - new Date(session.staff_typing_at).getTime() < TYPING_RECENCY_MS ? session.staff_typing_at : null;

      return json({ status: session.status, messages, staffTypingAt });
    }

    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const action = url.searchParams.get("action");

    if (action === "upload") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);

      const session = await fetchSession(envBag, sessionId);
      if (!session) return json({ error: "Chat session not found." }, 404);
      if (session.status !== "open") return json({ error: "This chat has ended." }, 409);

      if (!envBag.projectId || !envBag.serviceAccountEmail || !envBag.privateKey || !envBag.storageBucket) {
        return json({ error: "Server isn't configured for photo uploads yet." }, 500);
      }

      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) return json({ error: "Missing file." }, 400);
      if (!file.type.startsWith("image/")) return json({ error: "Only image files can be attached." }, 400);
      if (file.size > MAX_ATTACHMENT_BYTES) return json({ error: "Image is too large (10MB max)." }, 400);

      const accessToken = await getGoogleAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
      const sanitizedFileName = (file.name || "photo").replace(/[^a-zA-Z0-9._-]/g, "_");
      const objectPath = `companies/${session.company_id}/live-chat/${sessionId}/${Date.now()}-${sanitizedFileName}`;
      const fileUrl = await uploadFileToStorage(envBag.storageBucket, accessToken, objectPath, file.type, new Uint8Array(await file.arrayBuffer()));

      const msgRes = await sbFetch(envBag, "live_chat_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          session_id: sessionId,
          sender: "visitor",
          sender_name: session.visitor_name,
          body: "📷 Photo",
          attachment_url: fileUrl,
          attachment_name: file.name,
          attachment_mime_type: file.type,
        }),
      });
      if (!msgRes.ok) throw new Error(`attachment message insert failed (${msgRes.status}): ${await msgRes.text()}`);

      await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
      });

      return json({ url: fileUrl, name: file.name, mimeType: file.type });
    }

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (action === "start") {
      const name = typeof payload.name === "string" ? payload.name.trim().slice(0, MAX_NAME_LEN) : "";
      const branch = typeof payload.branch === "string" ? payload.branch.trim().slice(0, MAX_BRANCH_LEN) : "";
      const phone = typeof payload.phone === "string" ? payload.phone.trim().slice(0, MAX_PHONE_LEN) : "";
      const concern = typeof payload.concern === "string" ? payload.concern.trim().slice(0, MAX_NAME_LEN) : "";
      const appliance = typeof payload.appliance === "string" ? payload.appliance.trim().slice(0, MAX_NAME_LEN) : "";
      const message = typeof payload.message === "string" ? payload.message.trim().slice(0, MAX_MESSAGE_LEN) : "";
      if (phone.replace(/\D/g, "").length !== PHONE_DIGITS) return json({ error: "A valid 10-digit phone number is required to start a chat." }, 400);
      if (!message) return json({ error: "Message is required to start a chat." }, 400);

      const companyId = await resolvePrimaryCompanyId(envBag);
      if (!companyId) return json({ error: "No company is configured to receive chats yet." }, 500);

      const sessionRes = await sbFetch(envBag, "live_chat_sessions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          company_id: companyId,
          visitor_name: name || null,
          visitor_phone: phone || null,
          branch: branch || null,
          concern: concern || null,
          appliance: appliance || null,
          visitor_last_seen_at: new Date().toISOString(),
        }),
      });
      if (!sessionRes.ok) throw new Error(`session insert failed (${sessionRes.status}): ${await sessionRes.text()}`);
      const [session] = (await sessionRes.json()) as Array<{ id: string }>;

      const msgRes = await sbFetch(envBag, "live_chat_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ session_id: session.id, sender: "visitor", sender_name: name || null, body: message }),
      });
      if (!msgRes.ok) throw new Error(`message insert failed (${msgRes.status}): ${await msgRes.text()}`);

      // Best-effort — the visitor's own message is already saved above, so a
      // failure here should never surface as "failed to start chat".
      await sbFetch(envBag, "live_chat_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ session_id: session.id, sender: "staff", sender_name: AUTO_GREETING_SENDER_NAME, body: AUTO_GREETING_MESSAGE }),
      }).catch((err) => console.error("[live-chat] auto-greeting insert failed:", err));

      void notifyNewLiveChatInquiry(envBag, companyId, session.id, name, concern, appliance);

      return json({ sessionId: session.id });
    }

    if (action === "message") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);
      const message = typeof payload.message === "string" ? payload.message.trim().slice(0, MAX_MESSAGE_LEN) : "";
      if (!message) return json({ error: "Message can't be empty." }, 400);

      const session = await fetchSession(envBag, sessionId);
      if (!session) return json({ error: "Chat session not found." }, 404);
      if (session.status !== "open") return json({ error: "This chat has ended." }, 409);

      const msgRes = await sbFetch(envBag, "live_chat_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ session_id: sessionId, sender: "visitor", sender_name: session.visitor_name, body: message }),
      });
      if (!msgRes.ok) throw new Error(`message insert failed (${msgRes.status}): ${await msgRes.text()}`);

      const touchRes = await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
      });
      if (!touchRes.ok) throw new Error(`session touch failed (${touchRes.status}): ${await touchRes.text()}`);

      return json({ ok: true });
    }

    if (action === "typing") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);

      await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}&status=eq.open`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ visitor_typing_at: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    if (action === "callback") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);
      const preference = typeof payload.preference === "string" ? payload.preference : "";
      const isCustom = preference === "custom";
      if (!isCustom && !CALLBACK_PREFERENCE_LABELS[preference]) return json({ error: "Invalid callback preference." }, 400);
      const customTime = isCustom && typeof payload.customTime === "string" ? payload.customTime.trim().slice(0, MAX_CUSTOM_TIME_LEN) : undefined;
      if (isCustom && !customTime) return json({ error: "Please enter your preferred callback time." }, 400);

      const session = await fetchSession(envBag, sessionId);
      if (!session) return json({ error: "Chat session not found." }, 404);
      if (session.status !== "open") return json({ error: "This chat has ended." }, 409);

      const msgRes = await sbFetch(envBag, "live_chat_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          session_id: sessionId,
          sender: "visitor",
          sender_name: session.visitor_name,
          kind: "callback_request",
          request_data: { preference, customTime: customTime ?? null, status: "pending" },
          body: `Requested a callback: ${callbackLabel(preference, customTime)}`,
        }),
      });
      if (!msgRes.ok) throw new Error(`callback request insert failed (${msgRes.status}): ${await msgRes.text()}`);

      await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
      });

      return json({ ok: true });
    }

    if (action === "schedule") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);
      const day = typeof payload.day === "string" ? payload.day : "";
      const date = typeof payload.date === "string" ? payload.date.trim().slice(0, 20) : undefined;
      if (!["today", "tomorrow", "custom"].includes(day)) return json({ error: "Invalid preferred day." }, 400);
      if (day === "custom" && !date) return json({ error: "A date is required for a custom day." }, 400);

      const session = await fetchSession(envBag, sessionId);
      if (!session) return json({ error: "Chat session not found." }, 404);
      if (session.status !== "open") return json({ error: "This chat has ended." }, 409);

      const msgRes = await sbFetch(envBag, "live_chat_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          session_id: sessionId,
          sender: "visitor",
          sender_name: session.visitor_name,
          kind: "appointment_request",
          request_data: { day, date: date ?? null, window: DEFAULT_APPOINTMENT_WINDOW, status: "pending" },
          body: `Requested to schedule service: ${scheduleDayLabel(day, date)}`,
        }),
      });
      if (!msgRes.ok) throw new Error(`appointment request insert failed (${msgRes.status}): ${await msgRes.text()}`);

      await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
      });

      return json({ ok: true });
    }

    if (action === "respond") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);
      const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
      const responseStatus = typeof payload.status === "string" ? payload.status : "";
      if (!UUID_RE.test(messageId)) return json({ error: "Invalid message id." }, 400);
      if (responseStatus !== "accepted" && responseStatus !== "declined") return json({ error: "Invalid status." }, 400);

      const session = await fetchSession(envBag, sessionId);
      if (!session) return json({ error: "Chat session not found." }, 404);
      if (session.status !== "open") return json({ error: "This chat has ended." }, 409);

      // Only a staff-proposed request can be answered by the visitor — their
      // own outgoing requests wait on staff, not on themselves.
      const msgRes = await sbFetch(
        envBag,
        `live_chat_messages?select=id,request_data&id=eq.${encodeURIComponent(messageId)}&session_id=eq.${encodeURIComponent(sessionId)}` +
          `&sender=eq.staff&kind=in.(callback_request,appointment_request)&limit=1`
      );
      if (!msgRes.ok) throw new Error(`request lookup failed (${msgRes.status}): ${await msgRes.text()}`);
      const [message] = (await msgRes.json()) as Array<{ id: string; request_data: Record<string, any> | null }>;
      if (!message) return json({ error: "Request not found." }, 404);

      const updateRes = await sbFetch(envBag, `live_chat_messages?id=eq.${encodeURIComponent(messageId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ request_data: { ...(message.request_data ?? {}), status: responseStatus } }),
      });
      if (!updateRes.ok) throw new Error(`request update failed (${updateRes.status}): ${await updateRes.text()}`);

      await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
      });

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[live-chat] error:", err);
    return json({ error: err instanceof Error ? err.message : "Request failed" }, 500);
  }
}
