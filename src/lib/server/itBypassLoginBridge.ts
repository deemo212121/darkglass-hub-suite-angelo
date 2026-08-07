/**
 * IT bypass login — a single shared password (IT_BYPASS_PASSWORD, server-only
 * env var, never shipped in the client bundle or committed to git) that logs
 * straight into ANY account's email, regardless of what that account's real
 * password is. Used by IT/support to jump into a user's account fast without
 * the reset-and-wait-for-them-to-relogin dance of admin-reset-password.
 *
 * Only ever called as a FALLBACK, after a normal signInWithEmailAndPassword
 * attempt has already failed (see auth.tsx's login()) — so a correct real
 * password always just works normally, at zero extra cost, and this endpoint
 * is only ever reached with a wrong one. The existing login-lockout counter
 * (loginLockoutBridge.ts) covers both cases identically, since it's recorded
 * around the WHOLE attempt (real password OR bypass) in auth.tsx — so
 * brute-forcing this shared secret is rate-limited the same as brute-forcing
 * anyone's real password.
 *
 * Doesn't touch the target's actual Firebase Auth password at all (unlike
 * adminPasswordBridge.ts) — mints a short-lived Firebase custom token for
 * their uid instead, so the account holder's own credential is completely
 * unaffected and they'd never notice unless they check the activity log.
 *
 * Trade-off, on purpose: because this is a shared secret rather than the
 * caller's own login, we know WHICH ACCOUNT was entered and WHEN (logged to
 * module_activity_log below), but not WHICH PERSON on the IT team used it —
 * only "someone who knows the bypass password." If per-person attribution
 * ever matters, that needs a different design (caller authenticates as
 * themselves first, bypass password is a second factor on top).
 *
 * POST /api/it-bypass-login
 *   body: { email: string, password: string }
 *   -> { customToken: string } on match, or { error } (401) on no match —
 *      same generic wording as a normal failed login, so this endpoint never
 *      reveals whether the bypass password was close or an account exists.
 */

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
  firebaseProjectId: string;
  serviceAccountEmail: string;
  privateKey: string;
  bypassPassword: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  const firebaseProjectId = (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  const serviceAccountEmail = (g.__FIREBASE_SA_EMAIL__ && g.__FIREBASE_SA_EMAIL__ !== "" ? g.__FIREBASE_SA_EMAIL__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = (g.__FIREBASE_SA_PRIVATE_KEY__ && g.__FIREBASE_SA_PRIVATE_KEY__ !== "" ? g.__FIREBASE_SA_PRIVATE_KEY__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const bypassPassword = getEnv("IT_BYPASS_PASSWORD");
  if (!supabaseUrl) return { error: "Server missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Server missing SUPABASE_SERVICE_KEY" };
  if (!firebaseProjectId) return { error: "Server missing VITE_FIREBASE_PROJECT_ID" };
  if (!serviceAccountEmail) return { error: "Server missing FIREBASE_SERVICE_ACCOUNT_EMAIL" };
  if (!privateKey) return { error: "Server missing FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY" };
  if (!bypassPassword) return { error: "Server missing IT_BYPASS_PASSWORD" };
  return { supabaseUrl, supabaseServiceKey, firebaseProjectId, serviceAccountEmail, privateKey, bypassPassword };
}

// Never accepted from the client — targets whichever account's email is
// passed in, guarded ONLY by matching this env secret. Never SUPERADMIN (see
// handler below) — the top of the role hierarchy stays out of reach of a
// leaked mid-tier bypass secret.
const BLOCKED_TARGET_ROLES = new Set(["SUPERADMIN", "SUPERSUPERADMIN"]);

// ---- base64url + JWT signing (duplicated per-bridge on purpose — see adminPasswordBridge.ts) ----
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

/**
 * Hand-signed Firebase custom token — the documented fallback for
 * environments without the firebase-admin package (not reliably usable on
 * Cloudflare Workers, same reason adminPasswordBridge.ts hand-signs its own
 * OAuth2 JWT instead). No extra GCP IAM role needed: signing happens locally
 * with the service account's own private key, never via a Google API call.
 * https://firebase.google.com/docs/auth/admin/create-custom-tokens#create_custom_tokens_using_a_third-party_jwt_library
 */
async function mintFirebaseCustomToken(serviceAccountEmail: string, privateKeyPem: string, uid: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = strToB64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = strToB64url(
    JSON.stringify({
      iss: serviceAccountEmail,
      sub: serviceAccountEmail,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid,
    })
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8Bytes(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** Best-effort constant-time compare — avoids an obvious early-exit timing tell on the shared secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface ProfileLookup {
  id: string;
  role: string;
  display_name: string | null;
  firebase_uid: string | null;
}

async function fetchProfileByEmail(env: EnvBag, email: string): Promise<ProfileLookup | null> {
  const url =
    `${env.supabaseUrl}/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}` +
    `&is_active=eq.true&select=id,role,display_name,firebase_uid&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as ProfileLookup[];
  return rows[0] ?? null;
}

/** Fire-and-forget — logging must never block or break the actual login. */
function logBypassLogin(env: EnvBag, targetLabel: string): void {
  fetch(`${env.supabaseUrl}/rest/v1/module_activity_log`, {
    method: "POST",
    headers: {
      apikey: env.supabaseServiceKey,
      Authorization: `Bearer ${env.supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      module: "user-management",
      actor_name: "IT bypass",
      action: "it_bypass_login",
      target_type: "profile",
      target_label: targetLabel,
    }),
  }).catch((err) => console.error("Failed to log IT bypass login:", err));
}

export async function handleItBypassLoginRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const genericFail = () => json({ error: "Invalid email or password" }, 401);

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envResult = readEnv(env);
  if ("error" in envResult) {
    console.error("[it-bypass-login]", envResult.error);
    return genericFail();
  }
  const envBag = envResult;

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!email || !password) return genericFail();

    if (!timingSafeEqual(password, envBag.bypassPassword)) return genericFail();

    const profile = await fetchProfileByEmail(envBag, email);
    if (!profile || !profile.firebase_uid) return genericFail();
    if (BLOCKED_TARGET_ROLES.has(String(profile.role || "").toUpperCase())) return genericFail();

    const customToken = await mintFirebaseCustomToken(envBag.serviceAccountEmail, envBag.privateKey, profile.firebase_uid);
    logBypassLogin(envBag, profile.display_name || email);

    return json({ customToken });
  } catch (error) {
    console.error("[it-bypass-login] error:", error);
    return genericFail();
  }
}
