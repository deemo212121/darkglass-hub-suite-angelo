/**
 * "Is this request from a signed-in, active AHS user?" — for server bridges
 * that spend the company's own third-party accounts (Marcone, Encompass:
 * placing / cancelling orders, requesting returns). Before this, /api/marcone
 * and /api/encompass answered anyone on the internet.
 *
 * The browser sends its Firebase ID token in the request body as `idToken`
 * (same convention as /api/compensation-update); it's verified with
 * verifyFirebaseToken, then the caller must have an ACTIVE profile — so a
 * deactivated employee's still-valid session can't keep using it either. A
 * passing uid is remembered for a few minutes so a burst of lookups doesn't
 * re-check the profile every time.
 */
import { verifyFirebaseToken } from "./supabaseTokenBridge";

const PASS_TTL_MS = 5 * 60 * 1000;
const passedUntil = new Map<string, number>();

export type CallerCheck = { ok: true; uid: string } | { ok: false; status: number; error: string };

export async function requireActiveCaller(idToken: unknown, env?: Record<string, string | undefined>): Promise<CallerCheck> {
  if (typeof idToken !== "string" || !idToken) return { ok: false, status: 401, error: "Sign in to use this." };
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? getEnv("VITE_SUPABASE_URL");
  const serviceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  const projectId = (g.__FIREBASE_PROJECT_ID__ || undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  if (!supabaseUrl || !serviceKey || !projectId) return { ok: false, status: 500, error: "Server sign-in check isn't configured." };

  let uid: string;
  try {
    uid = (await verifyFirebaseToken(idToken, projectId)).sub;
  } catch {
    return { ok: false, status: 401, error: "Your session expired — sign in again." };
  }
  if ((passedUntil.get(uid) ?? 0) > Date.now()) return { ok: true, uid };

  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(uid)}&is_active=eq.true&select=id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) return { ok: false, status: 500, error: `Profile check failed (${res.status}).` };
  const rows = (await res.json()) as { id: string }[];
  if (rows.length === 0) return { ok: false, status: 403, error: "Your account isn't active." };
  passedUntil.set(uid, Date.now() + PASS_TTL_MS);
  return { ok: true, uid };
}
