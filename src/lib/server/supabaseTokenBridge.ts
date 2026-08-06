/**
 * Firebase -> Supabase token bridge (runtime-agnostic, Web Crypto only).
 *
 * Why this file exists:
 *  - The original bridge lived in `api/supabase-token.ts` and used Node's
 *    `crypto.X509Certificate`, which is NOT reliably available on Cloudflare
 *    Workers (V8 isolate runtime).
 *  - This implementation uses ONLY the Web Crypto API (`crypto.subtle`) and
 *    `fetch`, both standard on Workers, Vite dev, Node 20+, and the browser's
 *    server runtimes. So the same code path runs everywhere.
 *
 * Flow:
 *  1. Client sends its Firebase ID token (from the current login).
 *  2. We verify that token (RS256) against Google's published public keys.
 *  3. We mint a short-lived Supabase JWT (HS256, signed with SUPABASE_JWT_SECRET)
 *     whose `sub` = the Firebase uid. Supabase RLS reads that `sub`.
 *
 * No Firebase service-account key required — verification uses Google's public
 * keys. The Supabase JWT secret stays server-only.
 *
 * This is also the only point in the login flow that runs server-side, so
 * it's where we record which IP a user most recently logged in from
 * (profiles.last_login_ip, migration 0088) — the browser has no reliable
 * way to learn its own public IP, but Cloudflare stamps every request with
 * the real client IP in CF-Connecting-IP.
 */

// Google's Firebase ID-token public keys in JWK form (works directly with
// crypto.subtle.importKey, unlike the x509 PEM endpoint).
const GOOGLE_JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// ---- base64url helpers (no Buffer; Worker-safe) ----
function b64urlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8-safe (unlike plain btoa) — used elsewhere for encoding small JSON payloads into a URL-safe string, e.g. googleDriveBridge.ts's OAuth `state` param. */
export function strToB64url(input: string): string {
  return bytesToB64url(new TextEncoder().encode(input));
}

export function b64urlToString(input: string): string {
  return new TextDecoder().decode(b64urlToBytes(input));
}

// ---- cache Google's JWKs for their max-age ----
type Jwk = JsonWebKey & { kid?: string };
let jwkCache: { keys: Record<string, Jwk>; expiresAt: number } | null = null;

async function getGoogleJwks(): Promise<Record<string, Jwk>> {
  const now = Date.now();
  if (jwkCache && jwkCache.expiresAt > now) return jwkCache.keys;

  const res = await fetch(GOOGLE_JWK_URL);
  const body = (await res.json()) as { keys: Jwk[] };
  const keys: Record<string, Jwk> = {};
  for (const k of body.keys ?? []) {
    if (k.kid) keys[k.kid] = k;
  }

  const cacheControl = res.headers.get("cache-control") || "";
  const match = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = match ? parseInt(match[1], 10) * 1000 : 3600 * 1000;
  jwkCache = { keys, expiresAt: now + maxAgeMs };
  return keys;
}

export interface FirebaseClaims {
  sub: string;
  email?: string;
  aud: string;
  iss: string;
  exp: number;
  [k: string]: unknown;
}

/** Verify a Firebase ID token (RS256) with Web Crypto. Throws if invalid. Exported so other bridges (e.g. googleDriveBridge.ts, adminUpdateEmailBridge.ts) can identify a caller from their existing Firebase login without a separate verification path. */
export async function verifyFirebaseToken(idToken: string, projectId: string): Promise<FirebaseClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(b64urlToString(headerB64)) as { kid?: string; alg?: string };
  const claims = JSON.parse(b64urlToString(payloadB64)) as FirebaseClaims;

  if (header.alg !== "RS256") throw new Error("Unexpected token alg");
  if (!header.kid) throw new Error("Missing token kid");

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new Error("Token expired");
  if (claims.aud !== projectId) throw new Error("Token audience mismatch");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Token issuer mismatch");
  }
  if (!claims.sub) throw new Error("Token missing sub");

  const jwks = await getGoogleJwks();
  const jwk = jwks[header.kid];
  if (!jwk) throw new Error("No matching Google key for token kid");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) throw new Error("Invalid token signature");

  return claims;
}

/** Mint a Supabase-compatible JWT (HS256) for the given Firebase uid. */
async function mintSupabaseToken(opts: {
  firebaseUid: string;
  email?: string;
  secret: string;
  ttlSeconds?: number;
}): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.ttlSeconds ?? 60 * 60); // default 1h

  const headerB64 = strToB64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = strToB64url(
    JSON.stringify({
      sub: opts.firebaseUid, // RLS reads this as the user identity
      role: "authenticated", // maps to the Supabase 'authenticated' role
      aud: "authenticated",
      iss: "firebase-bridge",
      email: opts.email ?? "",
      iat: now,
      exp,
    })
  );
  const signingInput = `${headerB64}.${payloadB64}`;

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(signingInput));
  const signatureB64 = bytesToB64url(new Uint8Array(sig));

  return { token: `${signingInput}.${signatureB64}`, expiresAt: exp };
}

/** Real client IP as seen by Cloudflare — falls back to X-Forwarded-For for local/dev, where neither header may be present. */
function clientIpFrom(request: Request): string | null {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

/**
 * Cloudflare stamps every request that reaches a live Worker with a `cf`
 * object carrying edge-resolved geolocation (country/region/city/lat/lng) —
 * no external geo-IP API needed. Only present in production (absent for
 * plain Node `Request` objects, e.g. the Vite dev middleware), so this is
 * one more piece of the login flow that can't be exercised locally.
 */
function geoFromRequest(request: Request): {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? parseFloat(v) : null);
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return {
    country: str(cf?.country),
    region: str(cf?.region),
    city: str(cf?.city),
    latitude: num(cf?.latitude),
    longitude: num(cf?.longitude),
  };
}

/** Parsed from the User-Agent header — good-enough browser/device labels without pulling in a UA-parsing library for one admin page. */
function parseUserAgent(ua: string | null): { browser: string; device: string } {
  if (!ua) return { browser: "Unknown", device: "Unknown" };
  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let device = "Unknown";
  if (/iPhone/.test(ua)) device = "iPhone";
  else if (/iPad/.test(ua)) device = "iPad";
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? "Android Phone" : "Android Tablet";
  else if (/Windows/.test(ua)) device = "Windows PC";
  else if (/Macintosh/.test(ua)) device = "Mac";
  else if (/Linux/.test(ua)) device = "Linux PC";

  return { browser, device };
}

/** Standalone (no shared-lib import) so this file never risks the kind of cross-chunk circular import that broke a production deploy earlier — see mapEngine.ts's getOfficeCoordinates comment for the full story. */
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Most frequent value in a list of non-null strings. */
function mode(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

const UNUSUAL_DISTANCE_MILES = 50;
const LOGIN_SECURITY_LINK = "/m/admin/login-security";

interface RecentLoginEvent {
  profile_id: string;
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

function locLabel(e: Pick<RecentLoginEvent, "city" | "region" | "country"> | null | undefined): string {
  if (!e) return "an unknown location";
  return [e.city, e.region, e.country].filter(Boolean).join(", ") || "an unknown location";
}

/**
 * Best-effort — never throws, and every failure just skips the flag/notify
 * step rather than the whole function, since none of this should ever
 * block a login. Checks the login that was just recorded against:
 *  - this same user's own recent history (unusual location), and
 *  - every other active user's most recent login (shared IP)
 * and pings HR/Admin via the notifications table (bell icon) when either
 * fires. Not deduped beyond what naturally falls out of each check (see
 * inline notes) — a stable shared-IP situation (e.g. same office Wi-Fi)
 * will re-notify on every login, which may be worth tightening later.
 */
async function detectAndNotifyLoginFlags(
  supabaseUrl: string,
  sbHeaders: Record<string, string>,
  profile: { id: string; company_id: string; display_name: string | null },
  newEvent: RecentLoginEvent
): Promise<void> {
  try {
    const reasons: string[] = [];

    // --- Unusual location: compare against this user's own prior history.
    // Self-limiting by construction — once a location shows up more than
    // once, it's no longer "new" and stops triggering this.
    if (newEvent.latitude != null && newEvent.longitude != null) {
      const histRes = await fetch(
        `${supabaseUrl}/rest/v1/login_events?profile_id=eq.${profile.id}&select=ip,country,region,city,latitude,longitude,created_at&order=created_at.desc&limit=20`,
        { headers: sbHeaders }
      );
      if (histRes.ok) {
        const history: RecentLoginEvent[] = await histRes.json();
        const prior = history.filter((e) => e.created_at !== newEvent.created_at && e.latitude != null && e.longitude != null);
        if (prior.length > 0) {
          const usualKey = mode(prior.map((e) => `${e.city ?? ""}|${e.region ?? ""}|${e.country ?? ""}`));
          const usualEvent = prior.find((e) => `${e.city ?? ""}|${e.region ?? ""}|${e.country ?? ""}` === usualKey);
          if (usualEvent && usualEvent.latitude != null && usualEvent.longitude != null) {
            const distance = haversineMiles(
              { lat: newEvent.latitude, lng: newEvent.longitude },
              { lat: usualEvent.latitude, lng: usualEvent.longitude }
            );
            if (distance > UNUSUAL_DISTANCE_MILES && locLabel(newEvent) !== locLabel(usualEvent)) {
              reasons.push(`logged in from an unusual location (${locLabel(newEvent)}) — usually logs in from ${locLabel(usualEvent)}`);
            }
          }
        }
      }
    }

    // --- Shared IP: does any OTHER active user's most recent login share this IP?
    if (newEvent.ip) {
      const companyRes = await fetch(
        `${supabaseUrl}/rest/v1/login_events?company_id=eq.${profile.company_id}&select=profile_id,ip,created_at&order=created_at.desc&limit=500`,
        { headers: sbHeaders }
      );
      if (companyRes.ok) {
        const companyEvents: RecentLoginEvent[] = await companyRes.json();
        const latestByProfile = new Map<string, RecentLoginEvent>();
        for (const e of companyEvents) {
          if (!latestByProfile.has(e.profile_id)) latestByProfile.set(e.profile_id, e);
        }
        const sharer = Array.from(latestByProfile.values()).find((e) => e.profile_id !== profile.id && e.ip === newEvent.ip);
        if (sharer) {
          const sharerRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${sharer.profile_id}&select=display_name,email`, { headers: sbHeaders });
          const sharerProfile = sharerRes.ok ? (await sharerRes.json())[0] : null;
          const sharerName = sharerProfile?.display_name || sharerProfile?.email || "another employee";
          reasons.push(`logged in from the same IP (${newEvent.ip}) as ${sharerName}`);
        }
      }
    }

    if (reasons.length === 0) return;

    // --- Resolve HR/Admin recipients and notify.
    const recipientsRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?company_id=eq.${profile.company_id}&is_active=eq.true&select=id,role,extra_roles`,
      { headers: sbHeaders }
    );
    if (!recipientsRes.ok) return;
    const allProfiles: Array<{ id: string; role: string | null; extra_roles: string[] | null }> = await recipientsRes.json();
    const normalize = (r: string | null | undefined) => String(r ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    const recipientIds = allProfiles
      .filter((p) => p.id !== profile.id)
      .filter((p) => [p.role, ...(p.extra_roles ?? [])].map(normalize).some((r) => r === "HR" || r === "ADMIN" || r === "SUPERADMIN"))
      .map((p) => p.id);
    if (recipientIds.length === 0) return;

    const employeeName = profile.display_name || "This employee";
    const body = `⚠ ${employeeName} ${reasons.join(" and ")}.`;

    await Promise.all(
      recipientIds.map((recipientId) =>
        fetch(`${supabaseUrl}/rest/v1/notifications`, {
          method: "POST",
          headers: sbHeaders,
          body: JSON.stringify({
            company_id: profile.company_id,
            recipient_id: recipientId,
            sender_id: null,
            sender_name: "Login Security",
            body,
            link_to: LOGIN_SECURITY_LINK,
          }),
        })
      )
    );
  } catch (error) {
    console.warn("[supabase-token] detectAndNotifyLoginFlags failed:", error);
  }
}

/** Does `profileId` already have a login_events row from today (UTC)? */
async function hasLoginEventToday(
  supabaseUrl: string,
  sbHeaders: Record<string, string>,
  profileId: string
): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const res = await fetch(
    `${supabaseUrl}/rest/v1/login_events?profile_id=eq.${encodeURIComponent(profileId)}&created_at=gte.${encodeURIComponent(todayStart.toISOString())}&select=id&limit=1`,
    { headers: sbHeaders }
  );
  if (!res.ok) return false; // fail open — better an extra event than silently missing the day's first IP
  const rows: Array<{ id: string }> = await res.json();
  return rows.length > 0;
}

/**
 * Best-effort — never throws. A failure here (missing env vars, network
 * blip, no matching profile yet) must not block the login itself, since
 * this runs on the hot path of every login and silent token refresh.
 * Updates profiles.last_login_ip (fast "most recent" lookup) AND appends a
 * row to login_events (the full history the Login Security page reads),
 * then checks the new login for anomalies and pings HR/Admin if flagged.
 *
 * `onlyIfFirstToday`: a user who logs in once and never logs out again
 * still refreshes their session daily (page-load restore, tab-focus, the
 * 45-min background refresh) without ever going through the real login()
 * path — so without this, they'd get exactly one login_events row, ever.
 * When set, this skips everything (no patch, no insert) if today already
 * has a captured row for them; otherwise it records today's first one
 * exactly like a real login would.
 */
async function recordLoginEvent(
  firebaseUid: string,
  request: Request,
  supabaseUrl: string | undefined,
  serviceKey: string | undefined,
  opts: { onlyIfFirstToday?: boolean } = {}
): Promise<void> {
  const ip = clientIpFrom(request);
  if (!supabaseUrl || !serviceKey) return;
  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  try {
    if (opts.onlyIfFirstToday) {
      const lookupRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(firebaseUid)}&select=id`,
        { headers: sbHeaders }
      );
      if (!lookupRes.ok) return;
      const lookupRows: Array<{ id: string }> = await lookupRes.json();
      const profileId = lookupRows[0]?.id;
      if (!profileId) return;
      if (await hasLoginEventToday(supabaseUrl, sbHeaders, profileId)) return;
    }

    // Update the fast-lookup column and get back the profile's id/company_id
    // in the same round trip (needed for the login_events insert below).
    const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(firebaseUid)}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify(ip ? { last_login_ip: ip } : {}),
    });
    if (!patchRes.ok) return;
    const rows: Array<{ id: string; company_id: string; display_name: string | null }> = await patchRes.json();
    const profile = rows[0];
    if (!profile) return;

    const geo = geoFromRequest(request);
    const ua = request.headers.get("user-agent");
    const { browser, device } = parseUserAgent(ua);

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/login_events`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        company_id: profile.company_id,
        profile_id: profile.id,
        ip,
        ...geo,
        user_agent: ua,
        browser,
        device,
      }),
    });
    if (!insertRes.ok) return;
    const inserted: RecentLoginEvent[] = await insertRes.json();
    const newEvent = inserted[0];
    if (newEvent) {
      await detectAndNotifyLoginFlags(supabaseUrl, sbHeaders, profile, newEvent);
    }
  } catch (error) {
    console.warn("[supabase-token] recordLoginEvent failed:", error);
  }
}

/**
 * One active session per account (migration 0124) — mints a fresh
 * current_session_id on a real interactive login (recordLogin=true),
 * claiming this device as the one true session. Every other call (the
 * 45-min background refresh, tab-focus, or a persisted session restoring on
 * page load) just reads back whatever is currently stored, so the caller
 * (auth.tsx) can compare it against what it locally remembers claiming and
 * detect a later login elsewhere. Returns null (never throws) on any
 * failure — a broken session-lock check must never block login itself.
 */
async function mintOrReadSessionId(
  firebaseUid: string,
  recordLogin: boolean,
  supabaseUrl: string | undefined,
  serviceKey: string | undefined
): Promise<string | null> {
  if (!supabaseUrl || !serviceKey) return null;
  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  try {
    if (recordLogin) {
      const sessionId = crypto.randomUUID();
      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(firebaseUid)}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ current_session_id: sessionId }),
      });
      return res.ok ? sessionId : null;
    }

    const lookupRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(firebaseUid)}&select=current_session_id`,
      { headers: sbHeaders }
    );
    if (!lookupRes.ok) return null;
    const rows: Array<{ current_session_id: string | null }> = await lookupRes.json();
    const existing = rows[0]?.current_session_id;
    if (existing) return existing;

    // Bootstrap: a session from before this feature shipped has no id yet —
    // mint one now so it's never compared against null.
    const bootstrapId = crypto.randomUUID();
    const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(firebaseUid)}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ current_session_id: bootstrapId }),
    });
    return patchRes.ok ? bootstrapId : null;
  } catch (error) {
    console.warn("[supabase-token] mintOrReadSessionId failed:", error);
    return null;
  }
}

/**
 * Handle a POST /api/supabase-token request. Returns a standard Response.
 * `env` lets callers pass platform-provided secrets (Cloudflare bindings);
 * falls back to process.env for Node/dev.
 */
export async function handleSupabaseTokenRequest(
  request: Request,
  env?: Record<string, string | undefined>
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { idToken, recordLogin } = (await request.json()) as { idToken?: string; recordLogin?: boolean };
    if (!idToken) return json({ error: "Missing idToken" }, 400);

    // Build-time injected constants (see vite.config.ts `define`). These are
    // baked into the SERVER bundle only (dist/server), never the client. This
    // is the most reliable source on Cloudflare Workers, where runtime env
    // plumbing varies. Falls back to passed-in env / process.env.
    const injectedSecret =
      typeof (globalThis as any).__SUPABASE_JWT_SECRET__ === "string"
        ? ((globalThis as any).__SUPABASE_JWT_SECRET__ as string)
        : "";
    const injectedProject =
      typeof (globalThis as any).__FIREBASE_PROJECT_ID__ === "string"
        ? ((globalThis as any).__FIREBASE_PROJECT_ID__ as string)
        : "";

    const getEnv = (k: string): string | undefined =>
      env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);

    const projectId = injectedProject || getEnv("VITE_FIREBASE_PROJECT_ID");
    const jwtSecret = injectedSecret || getEnv("SUPABASE_JWT_SECRET");
    if (!projectId || !jwtSecret) {
      return json(
        {
          error: !projectId
            ? "Server missing VITE_FIREBASE_PROJECT_ID"
            : "Server missing SUPABASE_JWT_SECRET",
        },
        500
      );
    }

    const claims = await verifyFirebaseToken(idToken, projectId);
    const { token, expiresAt } = await mintSupabaseToken({
      firebaseUid: claims.sub,
      email: claims.email,
      secret: jwtSecret,
    });

    // Log to login_events for an actual interactive login (recordLogin, set
    // by auth.tsx) unconditionally. Otherwise (the 45-min background
    // refresh, tab-focus, or a persisted session just restoring on page
    // load — someone who's stayed logged in since yesterday and never hits
    // the real login() path) still record it, but only if today doesn't
    // already have a captured IP for them, so a normal day's routine
    // refreshes don't grow the table beyond that one first capture.
    if (recordLogin) {
      await recordLoginEvent(claims.sub, request, getEnv("VITE_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_KEY"));
    } else {
      await recordLoginEvent(claims.sub, request, getEnv("VITE_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_KEY"), {
        onlyIfFirstToday: true,
      });
    }

    const sessionId = await mintOrReadSessionId(
      claims.sub,
      !!recordLogin,
      getEnv("VITE_SUPABASE_URL"),
      getEnv("SUPABASE_SERVICE_KEY")
    );

    return json({ token, expiresAt, uid: claims.sub, sessionId });
  } catch (error) {
    console.error("[supabase-token] error:", error);
    return json({ error: error instanceof Error ? error.message : "Token exchange failed" }, 401);
  }
}
