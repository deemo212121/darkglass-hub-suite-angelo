/**
 * Jotform webhook -> AHS notification bridge (runtime-agnostic, Web Crypto only).
 *
 * Why this file exists:
 *  - This project's notification writer (src/lib/firebase/notifications.ts)
 *    uses the Firebase CLIENT SDK, which is meant to run in the browser and
 *    is not reliably usable inside a Cloudflare Worker (same reasoning that
 *    keeps Node's crypto module out of supabaseTokenBridge.ts).
 *  - So this bridge talks to Firestore directly over its REST API using a
 *    service-account JWT (self-signed with Web Crypto, exchanged for a
 *    Google OAuth2 access token) — no firebase-admin package required.
 *  - It writes to the SAME collection, same document shape, and same
 *    recipient-lookup logic (users_index by userType + companyId) as the
 *    existing sendNotificationToRole() — this is the existing architecture,
 *    just invoked over REST instead of the client SDK so it works on Workers.
 *
 * Flow:
 *  1. Jotform POSTs form-encoded submission data to /api/jotform?secret=...
 *  2. We verify the shared secret (Jotform has no custom-header webhook option,
 *     so the secret travels as a query param on the configured webhook URL).
 *  3. We parse the submission (formID, submissionID, formTitle, submitter name).
 *  4. We look up HR users for the configured company (same query
 *     sendNotificationToRole() runs against users_index).
 *  5. We write one notification doc per HR user at
 *     notifications/{uid}/items/jotform_{submissionID} — a deterministic ID
 *     so Jotform's automatic retries of the same submission can't duplicate it.
 */

// ---- base64url helpers (no Buffer dependency; Worker-safe) ----
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
  const b64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ---- Google service-account OAuth2 token (cached in-memory for its TTL) ----
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(serviceAccountEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 30) return tokenCache.token;

  const headerB64 = strToB64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = strToB64url(
    JSON.stringify({
      iss: serviceAccountEmail,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Bytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: body.access_token, expiresAt: now + body.expires_in };
  return body.access_token;
}

// ---- Firestore REST helpers ----
function sv(s: string) {
  return { stringValue: s };
}

/** Same lookup sendNotificationToRole() does (users_index by userType + companyId), via REST. */
async function findHrUids(projectId: string, accessToken: string, companyId: string): Promise<string[]> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users_index" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                { fieldFilter: { field: { fieldPath: "userType" }, op: "EQUAL", value: sv("HR") } },
                { fieldFilter: { field: { fieldPath: "companyId" }, op: "EQUAL", value: sv(companyId) } },
              ],
            },
          },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`users_index query failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ document?: { fields?: Record<string, { stringValue?: string }> } }>;
  return rows
    .map((r) => r.document?.fields?.uid?.stringValue)
    .filter((uid): uid is string => Boolean(uid));
}

/**
 * Create one notification doc at a deterministic ID (jotform_{submissionID}).
 * A repeat Jotform delivery of the same submission reuses the same doc ID,
 * so Firestore's ALREADY_EXISTS (409) response is treated as a no-op success
 * rather than a duplicate write.
 */
async function writeNotification(
  projectId: string,
  accessToken: string,
  uid: string,
  docId: string,
  fields: { title: string; body: string; formId: string; submissionId: string }
): Promise<"created" | "duplicate"> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/notifications/${uid}/items?documentId=${encodeURIComponent(docId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        fields: {
          kind: sv("jotform_submission"),
          title: sv(fields.title),
          body: sv(fields.body),
          uid: sv(uid),
          isRead: { booleanValue: false },
          createdAt: { timestampValue: new Date().toISOString() },
          formId: sv(fields.formId),
          submissionId: sv(fields.submissionId),
        },
      }),
    }
  );
  if (res.status === 409) return "duplicate";
  if (!res.ok) throw new Error(`notification write failed (${res.status}): ${await res.text()}`);
  return "created";
}

// ---- Jotform payload parsing ----

/**
 * Jotform's webhook POSTs form-encoded data. The most reliable field is
 * `rawRequest` (a JSON string of every answer, keyed by question id).
 * Field/question names vary per form, so name extraction is a best-effort
 * heuristic: look for any answer key containing "name". Falls back to the
 * human-readable `pretty` summary, then to "Someone".
 */
function extractSubmitterName(rawRequest: string | null, pretty: string | null): string {
  if (rawRequest) {
    try {
      const parsed = JSON.parse(rawRequest) as Record<string, unknown>;
      const nameKey = Object.keys(parsed).find((k) => /name/i.test(k));
      if (nameKey) {
        const val = parsed[nameKey];
        if (typeof val === "string" && val.trim()) return val.trim();
        if (val && typeof val === "object") {
          const v = val as Record<string, string>;
          const combined = [v.first, v.middle, v.last].filter(Boolean).join(" ").trim();
          if (combined) return combined;
        }
      }
    } catch {
      // fall through to `pretty` parsing below
    }
  }
  if (pretty) {
    const match = pretty.match(/name\s*:\s*([^,]+)/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "Someone";
}

export async function handleJotformRequest(
  request: Request,
  env?: Record<string, string | undefined>
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const getEnv = (k: string): string | undefined =>
    env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);

  try {
    // ── Shared-secret check ────────────────────────────────────────────────
    // Jotform's webhook config is just a URL, so the secret rides along as a
    // query param: https://<host>/api/jotform?secret=XXXX
    const url = new URL(request.url);
    const expectedSecret = getEnv("JOTFORM_WEBHOOK_SECRET");
    if (!expectedSecret) return json({ error: "Server missing JOTFORM_WEBHOOK_SECRET" }, 500);
    if (url.searchParams.get("secret") !== expectedSecret) {
      return json({ error: "Invalid webhook secret" }, 401);
    }

    // ── Parse the Jotform submission ───────────────────────────────────────
    const contentType = request.headers.get("content-type") ?? "";
    let formID = "";
    let submissionID = "";
    let formTitle = "";
    let rawRequest: string | null = null;
    let pretty: string | null = null;

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      formID = String(body.formID ?? "");
      submissionID = String(body.submissionID ?? "");
      formTitle = String(body.formTitle ?? "");
      rawRequest = typeof body.rawRequest === "string" ? body.rawRequest : JSON.stringify(body.rawRequest ?? {});
      pretty = typeof body.pretty === "string" ? body.pretty : null;
    } else {
      // Jotform's default: multipart/form-data (also handles urlencoded).
      const form = await request.formData();
      formID = String(form.get("formID") ?? "");
      submissionID = String(form.get("submissionID") ?? "");
      formTitle = String(form.get("formTitle") ?? "");
      rawRequest = form.get("rawRequest") as string | null;
      pretty = form.get("pretty") as string | null;
    }

    const submitterName = extractSubmitterName(rawRequest, pretty);
    const title = "New Form Submitted";
    const body = `${submitterName} submitted ${formTitle || "a form"}`;

    // ── Recipients: HR users for the configured company ────────────────────
    const companyId = getEnv("JOTFORM_TARGET_COMPANY_ID");
    if (!companyId) return json({ error: "Server missing JOTFORM_TARGET_COMPANY_ID" }, 500);

    const g = globalThis as any;
    const projectId: string | undefined =
      (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ??
      getEnv("VITE_FIREBASE_PROJECT_ID");
    const serviceAccountEmail: string | undefined =
      (g.__FIREBASE_SA_EMAIL__ && g.__FIREBASE_SA_EMAIL__ !== "" ? g.__FIREBASE_SA_EMAIL__ : undefined) ??
      getEnv("FIREBASE_SERVICE_ACCOUNT_EMAIL");
    const privateKey: string | undefined =
      (g.__FIREBASE_SA_PRIVATE_KEY__ && g.__FIREBASE_SA_PRIVATE_KEY__ !== "" ? g.__FIREBASE_SA_PRIVATE_KEY__ : undefined) ??
      getEnv("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY");

    if (!projectId || !serviceAccountEmail || !privateKey) {
      return json(
        {
          error: !projectId
            ? "Server missing VITE_FIREBASE_PROJECT_ID"
            : !serviceAccountEmail
            ? "Server missing FIREBASE_SERVICE_ACCOUNT_EMAIL"
            : "Server missing FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY",
        },
        500
      );
    }

    const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKey);
    const hrUids = await findHrUids(projectId, accessToken, companyId);

    if (hrUids.length === 0) {
      // Not an error — ack quickly so Jotform doesn't retry a "failed" delivery.
      return json({ success: true, notified: 0, note: "No HR users found for companyId" });
    }

    const dedupeId = submissionID ? `jotform_${submissionID}` : `jotform_${crypto.randomUUID()}`;
    const results = await Promise.all(
      hrUids.map((uid) => writeNotification(projectId!, accessToken, uid, dedupeId, { title, body, formId: formID, submissionId: submissionID }))
    );

    return json({
      success: true,
      notified: results.filter((r) => r === "created").length,
      duplicates: results.filter((r) => r === "duplicate").length,
      submissionId: submissionID,
    });
  } catch (err) {
    console.error("[jotform-webhook] error:", err);
    return json({ error: err instanceof Error ? err.message : "Jotform webhook failed" }, 500);
  }
}
