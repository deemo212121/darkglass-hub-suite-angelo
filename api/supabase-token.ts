/**
 * Firebase -> Supabase token bridge.
 *
 * Flow:
 *  1. Client sends its Firebase ID token (from the current login).
 *  2. We verify that token against Google's public certs (RS256).
 *  3. We mint a short-lived Supabase JWT (HS256, signed with SUPABASE_JWT_SECRET)
 *     whose `sub` = the Firebase uid. Supabase RLS reads that `sub`.
 *
 * No Firebase service account key required — verification uses Google's
 * public certificates. The Supabase JWT secret stays server-only.
 */

import crypto from "node:crypto";

export const config = {
  runtime: "nodejs20.x",
};

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// --- small base64url helpers ---
function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

// --- cache Google certs for their max-age to avoid refetching every call ---
let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGoogleCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAt > now) {
    return certCache.certs;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  const certs = (await res.json()) as Record<string, string>;
  // honor cache-control max-age, default 1h
  const cacheControl = res.headers.get("cache-control") || "";
  const match = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = match ? parseInt(match[1], 10) * 1000 : 3600 * 1000;
  certCache = { certs, expiresAt: now + maxAgeMs };
  return certs;
}

interface FirebaseClaims {
  sub: string;
  user_id?: string;
  email?: string;
  aud: string;
  iss: string;
  exp: number;
  [k: string]: unknown;
}

/**
 * Verify a Firebase ID token (RS256) and return its claims.
 * Throws if invalid/expired/wrong project.
 */
async function verifyFirebaseToken(idToken: string, projectId: string): Promise<FirebaseClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64urlDecode(headerB64).toString("utf8")) as { kid?: string; alg?: string };
  const claims = JSON.parse(base64urlDecode(payloadB64).toString("utf8")) as FirebaseClaims;

  if (header.alg !== "RS256") throw new Error("Unexpected token alg");
  if (!header.kid) throw new Error("Missing token kid");

  // Standard Firebase ID token checks
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new Error("Token expired");
  if (claims.aud !== projectId) throw new Error("Token audience mismatch");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Token issuer mismatch");
  }
  if (!claims.sub) throw new Error("Token missing sub");

  // Verify signature against the matching Google public cert
  const certs = await getGoogleCerts();
  const certPem = certs[header.kid];
  if (!certPem) throw new Error("No matching Google cert for token kid");

  const publicKey = new crypto.X509Certificate(certPem).publicKey;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const valid = verifier.verify(publicKey, base64urlDecode(signatureB64));
  if (!valid) throw new Error("Invalid token signature");

  return claims;
}

/**
 * Mint a Supabase-compatible JWT (HS256) for the given Firebase uid.
 */
function mintSupabaseToken(opts: {
  firebaseUid: string;
  email?: string;
  secret: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.ttlSeconds ?? 60 * 60); // default 1h

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: opts.firebaseUid, // RLS reads this as the user identity
    role: "authenticated", // maps to the Supabase 'authenticated' Postgres role
    aud: "authenticated",
    iss: "firebase-bridge",
    email: opts.email ?? "",
    iat: now,
    exp,
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac("sha256", opts.secret)
    .update(signingInput)
    .digest();
  const signatureB64 = base64urlEncode(signature);

  return { token: `${signingInput}.${signatureB64}`, expiresAt: exp };
}

export default async function handler(request: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { idToken } = (await request.json()) as { idToken?: string };
    if (!idToken) return json({ error: "Missing idToken" }, 400);

    const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;

    if (!projectId) return json({ error: "Server missing VITE_FIREBASE_PROJECT_ID" }, 500);
    if (!jwtSecret) return json({ error: "Server missing SUPABASE_JWT_SECRET" }, 500);

    // 1. Verify Firebase identity
    const claims = await verifyFirebaseToken(idToken, projectId);

    // 2. Mint Supabase token
    const { token, expiresAt } = mintSupabaseToken({
      firebaseUid: claims.sub,
      email: claims.email,
      secret: jwtSecret,
    });

    return json({ token, expiresAt, uid: claims.sub });
  } catch (error) {
    console.error("[supabase-token] error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Token exchange failed" },
      401
    );
  }
}
