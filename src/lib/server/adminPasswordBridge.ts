/**
 * Admin-triggered password reset — lets an ADMIN/SUPERADMIN force-set
 * another user's Firebase Auth password directly (no old password needed,
 * no reset email), for individual or bulk (whole company) testing use from
 * AdminUserManagementPage.tsx.
 *
 * This can ONLY run server-side: it calls the Identity Toolkit Admin REST
 * API with a service-account OAuth token. The Firebase CLIENT SDK has no
 * equivalent — `updatePassword()` only ever works on `auth.currentUser`,
 * which is why it sits unused in lib/firebase/users.ts (see the "void
 * updatePassword" comment there).
 *
 * Web Crypto / fetch only, no firebase-admin package, no Node crypto — same
 * reasoning as supabaseTokenBridge.ts's header comment (must run identically
 * on Cloudflare Workers, Vite dev, and Node serverless).
 *
 * Authorization mirrors googleDriveBridge.ts's `connect` action: verify the
 * caller's own Firebase ID token, look up their Supabase profile by
 * firebase_uid (service-role key, bypasses RLS), and require role
 * ADMIN/SUPERADMIN before doing anything.
 *
 * The service-account OAuth token is scoped to `identitytoolkit` and cached
 * in a module-level variable local to THIS file only — deliberately not
 * reusing jotformBridge.ts's getGoogleAccessToken, whose cache is keyed
 * globally regardless of scope (sharing it here would risk handing back a
 * wrong-scope token to either bridge). Same "each bridge stays self-contained"
 * convention as liveChatBridge.ts's duplicated recipient-lookup helper.
 *
 * POST /api/admin-reset-password
 *   body: { idToken: string, newPassword: string, targetUids: string[] }
 *   targetUids covers both "reset this one person" (a list of 1) and
 *   "reset everyone" (the full list the caller already has loaded
 *   client-side, scoped by their own RLS-scoped getCompanyUsers() fetch —
 *   this route trusts that list rather than re-deriving "my company's
 *   users" itself).
 */
import { verifyFirebaseToken } from "./supabaseTokenBridge";

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
  firebaseProjectId: string;
  serviceAccountEmail: string;
  privateKey: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  const firebaseProjectId = (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  const serviceAccountEmail = (g.__FIREBASE_SA_EMAIL__ && g.__FIREBASE_SA_EMAIL__ !== "" ? g.__FIREBASE_SA_EMAIL__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = (g.__FIREBASE_SA_PRIVATE_KEY__ && g.__FIREBASE_SA_PRIVATE_KEY__ !== "" ? g.__FIREBASE_SA_PRIVATE_KEY__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!supabaseUrl) return { error: "Server missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Server missing SUPABASE_SERVICE_KEY" };
  if (!firebaseProjectId) return { error: "Server missing VITE_FIREBASE_PROJECT_ID" };
  if (!serviceAccountEmail) return { error: "Server missing FIREBASE_SERVICE_ACCOUNT_EMAIL" };
  if (!privateKey) return { error: "Server missing FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY" };
  return { supabaseUrl, supabaseServiceKey, firebaseProjectId, serviceAccountEmail, privateKey };
}

const MAX_TARGETS = 500; // sanity cap — a testing tool, not a mass-account-takeover lever
const MIN_PASSWORD_LEN = 6; // Firebase Auth's own minimum

// ---- base64url + JWT signing (see file header re: not sharing jotformBridge's cache) ----
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function strToB64url(input: string): string {
  return bytesToB64url(new TextEncoder().encode(input));
}
function pemToPkcs8Bytes(pem: string): ArrayBuffer {
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const b64 = normalized.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let identityToolkitTokenCache: { token: string; expiresAt: number } | null = null;

async function getIdentityToolkitAccessToken(serviceAccountEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (identityToolkitTokenCache && identityToolkitTokenCache.expiresAt > now + 30) return identityToolkitTokenCache.token;

  const headerB64 = strToB64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = strToB64url(
    JSON.stringify({
      iss: serviceAccountEmail,
      scope: "https://www.googleapis.com/auth/identitytoolkit",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8Bytes(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  identityToolkitTokenCache = { token: body.access_token, expiresAt: now + body.expires_in };
  return body.access_token;
}

async function fetchCallerRole(env: EnvBag, firebaseUid: string): Promise<string | null> {
  const url = `${env.supabaseUrl}/rest/v1/profiles?select=role&firebase_uid=eq.${encodeURIComponent(firebaseUid)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ role: string | null }>;
  return rows[0]?.role ?? null;
}

/** No true batch form for a bare password change in the Identity Toolkit REST API — one call per target uid. */
async function setUserPassword(accessToken: string, uid: string, newPassword: string): Promise<void> {
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ localId: uid, password: newPassword, returnSecureToken: false }),
  });
  if (!res.ok) throw new Error(`(${res.status}) ${await res.text()}`);
}

export async function handleAdminPasswordRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
    const targetUids = Array.isArray(payload.targetUids)
      ? payload.targetUids.filter((u): u is string => typeof u === "string" && u.length > 0)
      : [];

    if (!idToken) return json({ error: "Missing idToken" }, 400);
    if (newPassword.length < MIN_PASSWORD_LEN) return json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400);
    if (targetUids.length === 0) return json({ error: "No target users specified." }, 400);
    if (targetUids.length > MAX_TARGETS) return json({ error: `Too many target users at once (max ${MAX_TARGETS}).` }, 400);

    const claims = await verifyFirebaseToken(idToken, envBag.firebaseProjectId);
    const callerRole = await fetchCallerRole(envBag, claims.sub);
    if (!callerRole || !["ADMIN", "SUPERADMIN"].includes(callerRole.toUpperCase())) {
      return json({ error: "Only an Admin can reset passwords." }, 403);
    }

    const accessToken = await getIdentityToolkitAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
    const results = await Promise.allSettled(targetUids.map((uid) => setUserPassword(accessToken, uid, newPassword)));
    const failed = results
      .map((r, i) => (r.status === "rejected" ? { uid: targetUids[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) } : null))
      .filter((x): x is { uid: string; error: string } => x !== null);

    return json({ succeeded: targetUids.length - failed.length, failed });
  } catch (error) {
    console.error("[admin-reset-password] error:", error);
    return json({ error: error instanceof Error ? error.message : "Password reset failed" }, 500);
  }
}
