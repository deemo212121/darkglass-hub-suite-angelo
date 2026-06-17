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

function strToB64url(input: string): string {
  return bytesToB64url(new TextEncoder().encode(input));
}

function b64urlToString(input: string): string {
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

interface FirebaseClaims {
  sub: string;
  email?: string;
  aud: string;
  iss: string;
  exp: number;
  [k: string]: unknown;
}

/** Verify a Firebase ID token (RS256) with Web Crypto. Throws if invalid. */
async function verifyFirebaseToken(idToken: string, projectId: string): Promise<FirebaseClaims> {
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
    const { idToken } = (await request.json()) as { idToken?: string };
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

    return json({ token, expiresAt, uid: claims.sub });
  } catch (error) {
    console.error("[supabase-token] error:", error);
    return json({ error: error instanceof Error ? error.message : "Token exchange failed" }, 401);
  }
}
