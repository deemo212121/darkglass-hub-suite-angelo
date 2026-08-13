/**
 * "Update user email" bridge (runtime-agnostic, Web Crypto only). Despite
 * the filename, this now covers TWO callers, not just admins:
 *  - Self-service: a signed-in user fixing their OWN email from My Profile
 *    (e.g. a typo that's been silently bouncing their payslips).
 *  - Admin-side: ADMIN/SUPERADMIN editing another user's email from the
 *    admin user editor, same as always.
 *
 * Why this file exists:
 *  - profiles.email is not just a display field — the username-login path
 *    looks up profiles.email in Supabase and passes THAT value to Firebase's
 *    signInWithEmailAndPassword. So changing profiles.email without also
 *    changing the user's actual Firebase Auth email would desync the two
 *    and lock that user out of username-based login the next time they try
 *    to sign in.
 *  - There is no firebase-admin package here (same reasoning as the other
 *    server bridges — it isn't reliably usable on Cloudflare Workers), so
 *    this talks to the Identity Toolkit Admin REST API directly using a
 *    service-account OAuth2 access token, same technique as
 *    adminPasswordBridge.ts's password reset.
 *
 * Flow:
 *  1. Client sends its own Firebase ID token, the target profile's id, and
 *     the desired new email.
 *  2. We verify the caller's ID token (reusing supabaseTokenBridge's
 *     verifyFirebaseToken) to get their real Firebase uid — never trust a
 *     client-supplied "I am an admin" claim.
 *  3. We look up the caller's OWN profile via the Supabase REST API using
 *     the service-role key (bypasses RLS). The request is authorized if
 *     EITHER the caller is editing their OWN profile (targetProfileId ===
 *     their own id — self-service), OR their role (primary or extra_roles)
 *     is ADMIN/SUPERADMIN/HR and the target is in the SAME company
 *     (cross-tenant safety, unchanged admin path).
 *  4. We call Identity Toolkit's accounts:update to change the target
 *     Firebase user's email. Only once that succeeds do we return success —
 *     the caller (client) is responsible for then updating profiles.email
 *     via the normal updateCompanyUser() Supabase call, so the two are never
 *     left desynced from a partial failure on either side.
 *
 * POST /api/admin-update-email
 *   body: { idToken: string, targetProfileId: string, newEmail: string }
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

// HR added alongside ADMIN/SUPERADMIN so HR can edit login emails directly
// from the Master List's quick-edit popup (ReportHRDaily.tsx) — everywhere
// else in this app that gates on "holds a role", primary OR extra_roles
// both count, so this checks both too (see fetchProfile's select below).
const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN", "HR"]);

// ---- base64url + JWT signing (see adminPasswordBridge.ts re: not sharing jotformBridge's cache) ----
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
  extra_roles: string[] | null;
  company_id: string;
  firebase_uid: string | null;
}

function hasAdminRole(p: ProfileLookup): boolean {
  return [p.role, ...(p.extra_roles ?? [])].some((r) => ADMIN_ROLES.has(String(r || "").toUpperCase()));
}

async function fetchProfile(env: EnvBag, filter: { firebase_uid: string } | { id: string }): Promise<ProfileLookup | null> {
  const [[field, value]] = Object.entries(filter);
  const url = `${env.supabaseUrl}/rest/v1/profiles?${field}=eq.${encodeURIComponent(value)}&select=id,role,extra_roles,company_id,firebase_uid&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as ProfileLookup[];
  return rows[0] ?? null;
}

async function setUserEmail(accessToken: string, uid: string, newEmail: string): Promise<void> {
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ localId: uid, email: newEmail, emailVerified: false }),
  });
  if (!res.ok) throw new Error(`(${res.status}) ${await res.text()}`);
}

export async function handleAdminUpdateEmailRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    const targetProfileId = typeof payload.targetProfileId === "string" ? payload.targetProfileId : "";
    const newEmail = typeof payload.newEmail === "string" ? payload.newEmail : "";

    if (!idToken || !targetProfileId || !newEmail) {
      return json({ error: "Missing idToken, targetProfileId, or newEmail" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return json({ error: "Invalid email address" }, 400);
    }

    // 1. Confirm the caller is really who their ID token says they are.
    const claims = await verifyFirebaseToken(idToken, envBag.firebaseProjectId);

    // 2. Load the caller's OWN profile row (never trust a client-supplied
    //    role) and authorize: either they're editing their OWN email
    //    (self-service, always allowed — see the file-level doc comment),
    //    or they hold ADMIN/SUPERADMIN/HR (primary or extra_roles) and the
    //    target is in their company.
    const callerProfile = await fetchProfile(envBag, { firebase_uid: claims.sub });
    if (!callerProfile) return json({ error: "Caller profile not found" }, 404);
    const isSelf = callerProfile.id === targetProfileId;
    if (!isSelf && !hasAdminRole(callerProfile)) {
      return json({ error: "Not authorized to change user emails" }, 403);
    }
    const targetProfile = await fetchProfile(envBag, { id: targetProfileId });
    if (!targetProfile || !targetProfile.firebase_uid) {
      return json({ error: "Target user not found" }, 404);
    }
    if (!isSelf && targetProfile.company_id !== callerProfile.company_id) {
      return json({ error: "Target user is not in your company" }, 403);
    }

    // 3. Update the ACTUAL Firebase Auth credential — this is the whole
    //    point of this endpoint, since profiles.email alone would desync
    //    from what username-login actually authenticates against.
    const accessToken = await getIdentityToolkitAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
    try {
      await setUserEmail(accessToken, targetProfile.firebase_uid, newEmail);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("EMAIL_EXISTS")) return json({ error: "Email already in use by another account" }, 409);
      throw err;
    }

    return json({ success: true });
  } catch (error) {
    console.error("[admin-update-email] error:", error);
    return json({ error: error instanceof Error ? error.message : "Email update failed" }, 500);
  }
}
