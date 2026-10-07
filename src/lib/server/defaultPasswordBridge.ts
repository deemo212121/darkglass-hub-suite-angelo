/**
 * The company's default password — set by Admin/SuperAdmin under Login
 * Security → Default Password, stored in company_default_passwords
 * (migration 0364; RLS on, no policies, so only this server can read it).
 *
 * Used by:
 *   - adminPasswordBridge.ts — Admin/HR "Reset to default", and new accounts
 *     from Admin User Management (created with a random password, then reset
 *     to this through the same endpoint),
 *   - passwordResetRequestBridge.ts — Forgot Password on the login screen,
 *   - gmailBridge.ts — the Hiring panel's "Send Credentials" email.
 * Falls back to the DEFAULT_RESET_PASSWORD secret when the company hasn't
 * set one yet.
 *
 * POST /api/default-password
 *   body: { idToken, action: "status" }            → { isSet, source, updatedAt, updatedByName }
 *   body: { idToken, action: "set", password }     → { ok: true, updatedAt, updatedByName }
 * The value is never sent back to the browser.
 */
import { verifyFirebaseToken } from "./supabaseTokenBridge";

interface SupabaseEnv {
  supabaseUrl: string;
  supabaseServiceKey: string;
}

const SETTER_ROLES = new Set(["ADMIN", "SUPERADMIN"]);
export const DEFAULT_PASSWORD_MIN = 8;
export const DEFAULT_PASSWORD_MAX = 64;

function getEnvValue(env: Record<string, string | undefined> | undefined, k: string): string | undefined {
  return env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
}

async function sb(env: SupabaseEnv, path: string, init: RequestInit = {}): Promise<Response> {
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

interface StoredRow {
  password: string;
  updated_at: string;
  updated_by_name: string | null;
}

async function readRow(env: SupabaseEnv, companyId: string): Promise<StoredRow | null> {
  const res = await sb(env, `company_default_passwords?company_id=eq.${companyId}&select=password,updated_at,updated_by_name&limit=1`);
  if (!res.ok) {
    // Table missing (0364 not run yet) — fall back to the secret.
    console.warn("[default-password] read failed:", res.status, await res.text().catch(() => ""));
    return null;
  }
  return ((await res.json()) as StoredRow[])[0] ?? null;
}

/** The default password for this company: what Admin set, else the DEFAULT_RESET_PASSWORD secret, else null. */
export async function resolveDefaultPassword(
  env: SupabaseEnv,
  companyId: string,
  rawEnv?: Record<string, string | undefined>
): Promise<string | null> {
  const row = await readRow(env, companyId);
  if (row?.password) return row.password;
  return getEnvValue(rawEnv, "DEFAULT_RESET_PASSWORD") || null;
}

export async function handleDefaultPasswordRequest(request: Request, rawEnv?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? getEnvValue(rawEnv, "VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? getEnvValue(rawEnv, "SUPABASE_SERVICE_KEY");
  const firebaseProjectId = (g.__FIREBASE_PROJECT_ID__ || undefined) ?? getEnvValue(rawEnv, "VITE_FIREBASE_PROJECT_ID");
  if (!supabaseUrl || !supabaseServiceKey || !firebaseProjectId) return json({ error: "Server not configured" }, 500);
  const env: SupabaseEnv = { supabaseUrl, supabaseServiceKey };

  try {
    const payload = (await request.json().catch(() => ({}))) as { idToken?: string; action?: string; password?: string };
    if (!payload.idToken) return json({ error: "Not signed in." }, 401);

    // Only Admin / SuperAdmin (primary or extra role), checked against their own profile row.
    const claims = await verifyFirebaseToken(payload.idToken, firebaseProjectId);
    const meRes = await sb(env, `profiles?firebase_uid=eq.${encodeURIComponent(claims.sub)}&select=id,company_id,role,extra_roles,display_name&limit=1`);
    const me = meRes.ok
      ? ((await meRes.json()) as { id: string; company_id: string; role: string | null; extra_roles: string[] | null; display_name: string | null }[])[0]
      : undefined;
    const held = me ? [me.role, ...(me.extra_roles ?? [])].map((r) => String(r ?? "").trim().toUpperCase()) : [];
    if (!me || !held.some((r) => SETTER_ROLES.has(r))) return json({ error: "Only Admin can manage the default password." }, 403);

    if (payload.action === "status") {
      const row = await readRow(env, me.company_id);
      if (row) return json({ isSet: true, source: "company", updatedAt: row.updated_at, updatedByName: row.updated_by_name });
      const fromSecret = !!getEnvValue(rawEnv, "DEFAULT_RESET_PASSWORD");
      return json({ isSet: fromSecret, source: fromSecret ? "server" : null, updatedAt: null, updatedByName: null });
    }

    if (payload.action === "set") {
      const pw = typeof payload.password === "string" ? payload.password : "";
      if (pw !== pw.trim()) return json({ error: "The password can't start or end with a space." }, 400);
      if (pw.length < DEFAULT_PASSWORD_MIN || pw.length > DEFAULT_PASSWORD_MAX) {
        return json({ error: `Use ${DEFAULT_PASSWORD_MIN}–${DEFAULT_PASSWORD_MAX} characters.` }, 400);
      }
      if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return json({ error: "Use at least one letter and one number." }, 400);
      const updatedAt = new Date().toISOString();
      const updatedByName = me.display_name || "Admin";
      const res = await sb(env, "company_default_passwords?on_conflict=company_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ company_id: me.company_id, password: pw, updated_by: me.id, updated_by_name: updatedByName, updated_at: updatedAt }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[default-password] save failed:", res.status, text);
        if (res.status === 404 || text.includes("company_default_passwords")) {
          return json({ error: "Run migration 0364 in Supabase first, then try again." }, 500);
        }
        return json({ error: "Couldn't save the default password." }, 500);
      }
      return json({ ok: true, updatedAt, updatedByName });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[default-password] error:", error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
}
