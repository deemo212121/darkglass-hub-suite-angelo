/**
 * Admin "reset to default password" bridge — lets an ADMIN/SUPERADMIN
 * force-set a single LOCKED-OUT user's Firebase Auth password back to the
 * same default used at account creation (see AdminUserManagementPage.tsx's
 * createCompanyUser, "Welcome2024!"), no old password needed, no reset
 * email required.
 *
 * A version of this existed once before as a free-form "admin types any
 * new password" tool and was removed in favor of a must_change_password
 * flag (migration 0085) — but that flag only helps if the user can still
 * log in with their CURRENT password, which is exactly what a genuinely
 * locked-out user can't do. This brings a direct reset back, but
 * narrowly: always the SAME known default (never an admin-chosen value),
 * single target only — resetting one locked-out person's password to a
 * known value is a legitimate support action; resetting EVERYONE to the
 * same known password at once has no real use case and is a much bigger
 * blast radius, so that's deliberately not offered. The caller
 * (AdminUserManagementPage.tsx) is expected to immediately follow a
 * successful reset with setMustChangePassword(targetProfileId, true) so
 * the known default is only ever valid for exactly one login before the
 * user is forced to pick a real password of their own — see __root.tsx's
 * redirect gate.
 *
 * Same technique as adminUpdateEmailBridge.ts (Identity Toolkit Admin REST
 * API + service-account OAuth2 access token, Web Crypto only — no
 * firebase-admin package, since that isn't reliably usable on Cloudflare
 * Workers).
 *
 * POST /api/admin-reset-password
 *   body: { idToken: string, targetProfileId: string }
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

const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN"]);

// Same value used at account creation — see AdminUserManagementPage.tsx's
// createCompanyUser call. Never accepted from the client — this endpoint
// only ever resets to this one known value, on purpose (see file header).
const DEFAULT_PASSWORD = "Welcome2024!";

// ---- base64url + JWT signing (duplicated per-bridge on purpose — see adminUpdateEmailBridge.ts) ----
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

interface ProfileLookup {
  id: string;
  role: string;
  company_id: string;
  firebase_uid: string | null;
}

async function fetchProfile(env: EnvBag, filter: { firebase_uid: string } | { id: string }): Promise<ProfileLookup | null> {
  const [[field, value]] = Object.entries(filter);
  const url = `${env.supabaseUrl}/rest/v1/profiles?${field}=eq.${encodeURIComponent(value)}&select=id,role,company_id,firebase_uid&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as ProfileLookup[];
  return rows[0] ?? null;
}

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
    const targetProfileId = typeof payload.targetProfileId === "string" ? payload.targetProfileId : "";

    if (!idToken || !targetProfileId) {
      return json({ error: "Missing idToken or targetProfileId" }, 400);
    }

    // 1. Confirm the caller is really who their ID token says they are.
    const claims = await verifyFirebaseToken(idToken, envBag.firebaseProjectId);

    // 2. Confirm the caller holds ADMIN/SUPERADMIN via their OWN profile row
    //    (never trust a client-supplied role) and load the target's row.
    const callerProfile = await fetchProfile(envBag, { firebase_uid: claims.sub });
    if (!callerProfile || !ADMIN_ROLES.has(String(callerProfile.role || "").toUpperCase())) {
      return json({ error: "Not authorized to reset passwords" }, 403);
    }
    const targetProfile = await fetchProfile(envBag, { id: targetProfileId });
    if (!targetProfile || !targetProfile.firebase_uid) {
      return json({ error: "Target user not found" }, 404);
    }
    if (targetProfile.company_id !== callerProfile.company_id) {
      return json({ error: "Target user is not in your company" }, 403);
    }

    // 3. Reset the ACTUAL Firebase Auth credential to the known default.
    const accessToken = await getIdentityToolkitAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
    await setUserPassword(accessToken, targetProfile.firebase_uid, DEFAULT_PASSWORD);

    return json({ success: true });
  } catch (error) {
    console.error("[admin-reset-password] error:", error);
    return json({ error: error instanceof Error ? error.message : "Password reset failed" }, 500);
  }
}
