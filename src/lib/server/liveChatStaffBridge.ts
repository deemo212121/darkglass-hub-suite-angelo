/**
 * Staff-authenticated Live Chat actions that need to bypass RLS.
 *
 * Why this exists: live_chat_sessions_update's WITH CHECK/USING combo
 * (migration 0093) ties assigned_to visibility to the tiered CSR
 * visibility rule (self / unclaimed / your own led team / wide-visibility
 * roles) — correct for the SELECT policy, but it also ends up blocking
 * the one write that's SUPPOSED to cross that boundary: Transfer, whose
 * entire point is handing a chat to someone outside the caller's own
 * visibility tier (a different team, a specialist, etc). Reworking the
 * policy back to a plain company-only WITH CHECK didn't clear this up in
 * practice, so — same "service-role key, no RLS" shape as
 * googleDriveBridge.ts's authenticated actions — this bridge verifies the
 * caller's own Firebase login, confirms both caller and target are active
 * staff in the same company as the chat, and performs the reassignment
 * with the service key instead of fighting RLS further.
 *
 * Flow:
 *  POST /api/live-chat-staff?action=transfer — body { idToken, sessionId,
 *  toProfileId } — reassigns the chat and stamps transferred_from/
 *  transferred_from_name (migration 0108) with the CALLER's own identity,
 *  then posts a kind="system" notice visible to both sides.
 */
import { verifyFirebaseToken } from "./supabaseTokenBridge";

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
  firebaseProjectId: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  const firebaseProjectId = (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  if (!supabaseUrl) return { error: "Server missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Server missing SUPABASE_SERVICE_KEY" };
  if (!firebaseProjectId) return { error: "Server missing VITE_FIREBASE_PROJECT_ID" };
  return { supabaseUrl, supabaseServiceKey, firebaseProjectId };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

interface StaffProfile {
  id: string;
  companyId: string;
  name: string;
}

async function fetchActiveProfileByFirebaseUid(env: EnvBag, firebaseUid: string): Promise<StaffProfile | null> {
  const res = await sbFetch(
    env,
    `profiles?select=id,company_id,display_name,email,is_active&firebase_uid=eq.${encodeURIComponent(firebaseUid)}&limit=1`
  );
  if (!res.ok) throw new Error(`profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id: string; company_id: string; display_name: string | null; email: string; is_active: boolean }>;
  const r = rows[0];
  if (!r || !r.is_active) return null;
  return { id: r.id, companyId: r.company_id, name: r.display_name || r.email };
}

async function fetchActiveProfileById(env: EnvBag, profileId: string): Promise<StaffProfile | null> {
  const res = await sbFetch(env, `profiles?select=id,company_id,display_name,email,is_active&id=eq.${encodeURIComponent(profileId)}&limit=1`);
  if (!res.ok) throw new Error(`profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id: string; company_id: string; display_name: string | null; email: string; is_active: boolean }>;
  const r = rows[0];
  if (!r || !r.is_active) return null;
  return { id: r.id, companyId: r.company_id, name: r.display_name || r.email };
}

export async function handleLiveChatStaffRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    if (!idToken) return json({ error: "Missing idToken" }, 400);

    const claims = await verifyFirebaseToken(idToken, envBag.firebaseProjectId);
    const caller = await fetchActiveProfileByFirebaseUid(envBag, claims.sub);
    if (!caller) return json({ error: "Profile not found or inactive" }, 403);

    if (action === "transfer") {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const toProfileId = typeof payload.toProfileId === "string" ? payload.toProfileId : "";
      if (!UUID_RE.test(sessionId)) return json({ error: "Missing or invalid sessionId" }, 400);
      if (!UUID_RE.test(toProfileId)) return json({ error: "Missing or invalid toProfileId" }, 400);

      const sessionRes = await sbFetch(envBag, `live_chat_sessions?select=id,company_id&id=eq.${encodeURIComponent(sessionId)}&limit=1`);
      if (!sessionRes.ok) throw new Error(`session lookup failed (${sessionRes.status}): ${await sessionRes.text()}`);
      const [session] = (await sessionRes.json()) as Array<{ id: string; company_id: string }>;
      if (!session) return json({ error: "Chat session not found." }, 404);
      if (session.company_id !== caller.companyId) return json({ error: "Not authorized for this chat." }, 403);

      const target = await fetchActiveProfileById(envBag, toProfileId);
      if (!target || target.companyId !== caller.companyId) return json({ error: "Target staff member not found." }, 404);

      const updateRes = await sbFetch(envBag, `live_chat_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          assigned_to: target.id,
          assigned_to_name: target.name,
          transferred_from: caller.id,
          transferred_from_name: caller.name,
        }),
      });
      if (!updateRes.ok) throw new Error(`transfer update failed (${updateRes.status}): ${await updateRes.text()}`);

      // internal_note, not "system" — this is staff bookkeeping (who handed
      // the chat to whom), not something the customer needs to see (unlike
      // escalation's customer-facing notice). liveChatBridge.ts's GET handler
      // already excludes kind=internal_note from the visitor widget.
      await sbFetch(envBag, "live_chat_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          session_id: sessionId,
          sender: "staff",
          sender_name: caller.name,
          kind: "internal_note",
          body: `Transferred this chat to ${target.name}`,
        }),
      }).catch((err) => console.error("[live-chat-staff] transfer note failed:", err));

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[live-chat-staff] error:", err);
    return json({ error: err instanceof Error ? err.message : "Request failed" }, 500);
  }
}
