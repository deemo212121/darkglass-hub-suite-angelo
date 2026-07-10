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
 *  4. We look up HR users for the configured company from Supabase `profiles`
 *     (the actual source of truth for roles — see findHrFirebaseUids below),
 *     matching either the primary `role` or an `extra_roles` (sub-role) entry.
 *  5. We write one notification doc per HR user at
 *     notifications/{firebase_uid}/items/jotform_{submissionID} — a
 *     deterministic ID so Jotform's automatic retries of the same submission
 *     can't duplicate it. The doc path uses the Firebase uid because that's
 *     what the client's notification listener (NotificationsMenu) subscribes
 *     with (useAuth().uid), and profiles.firebase_uid is exactly that value.
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
      // Datastore (Firestore notifications) + Storage (Jotform file-upload
      // answers get re-hosted in Firebase Storage — see uploadFileToStorage).
      scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/devstorage.read_write",
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

// ---- Firebase Storage (file-upload answers get re-hosted here) ----

/**
 * Matches a base64 data URI Jotform sometimes submits directly as a field's
 * value — notably the signature pad's "Type" mode (as opposed to "Draw"
 * mode, which uploads a file and gives a URL/path like the other cases
 * below). Capture group is the extension to use when saving it.
 */
const DATA_URI_RE = /^data:image\/(png|jpe?g|gif|webp|heic);base64,/i;

/**
 * True for any string that *looks like a file* Jotform would have produced
 * for an uploaded file or signature — either a filename-shaped string, or an
 * inline base64 data URI. Jotform's rawRequest is inconsistent about how
 * much path info it includes per field type: a full URL, a bare
 * "uploads/{user}/{form}/{submission}/{file}" path with no domain, just the
 * filename alone with nothing else, or — for a signature typed rather than
 * drawn — the whole image inlined as base64. All need to be recognized as
 * "this is a file, not a text answer"; only extractFileUrls' resolution
 * logic below cares about which shape it actually is.
 */
function looksLikeJotformFileValue(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  return /\.(png|jpe?g|gif|webp|heic|pdf)(\?|$)/i.test(trimmed) || DATA_URI_RE.test(trimmed);
}

/** Recursively collects every string value out of a parsed rawRequest (arrays and composite objects included). */
function collectStringValues(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStringValues(v, out));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => collectStringValues(v, out));
}

/**
 * Best-effort scan of a parsed rawRequest for Jotform file-upload answers
 * (upload widgets and signature pads both surface as a URL/path/filename
 * string, however much of it Jotform included) — we mirror them into
 * Firebase Storage so they survive independent of the Jotform account.
 */
function extractFileUrls(rawRequest: string | null): string[] {
  if (!rawRequest) return [];
  try {
    const parsed = JSON.parse(rawRequest) as Record<string, unknown>;
    const allValues: string[] = [];
    for (const val of Object.values(parsed)) collectStringValues(val, allValues);

    // Some upload-widget answers in the same submission carry the full
    // "uploads/{username}/{formId}/{submissionId}/" prefix (signature pads
    // usually do) while others give only the bare filename with nothing
    // else. Since every file in one submission shares the same account/
    // form/submission, reuse whichever prefix we can find to resolve the
    // bare ones instead of silently dropping them.
    let uploadPrefix: string | undefined;
    for (const v of allValues) {
      const m = v.match(/(?:^https?:\/\/[^/]+\/)?(uploads\/[^/]+\/[^/]+\/[^/]+)\//i);
      if (m) {
        uploadPrefix = m[1];
        break;
      }
    }

    const urls: string[] = [];
    for (const v of allValues) {
      if (!looksLikeJotformFileValue(v)) continue;
      const trimmed = v.trim();
      // Data URIs are self-contained — fetch() can read them directly, no
      // domain/path resolution needed (and none would make sense anyway).
      if (DATA_URI_RE.test(trimmed)) urls.push(trimmed);
      else if (/^https?:\/\//i.test(trimmed)) urls.push(trimmed);
      else if (/^uploads\//i.test(trimmed)) urls.push(`https://www.jotform.com/${trimmed}`);
      else if (uploadPrefix && !trimmed.includes("/")) urls.push(`https://www.jotform.com/${uploadPrefix}/${trimmed}`);
      // else: a bare filename with no sibling prefix anywhere in this
      // submission to borrow — genuinely nothing to construct a URL from.
    }
    return urls;
  } catch {
    return [];
  }
}

// Cache per formId — the form's questions don't change between
// submissions, so there's no reason to call Jotform's API on every single
// webhook delivery for the same form.
const formQuestionLabelsCache = new Map<string, Record<string, string>>();

/**
 * Fetches the real question titles for a form from Jotform's own API, keyed
 * by question id (qid) — the number in a rawRequest key like "q14_...".
 * Needed because copy-pasting a field in Jotform's builder and then editing
 * its displayed question text does NOT change the field's internal name,
 * which is the only thing rawRequest ever includes — so several fields can
 * share the same internal name ("typeA") while showing completely different
 * text to the person filling out the form. Best-effort: returns {} (falling
 * back to humanizeFieldKey below) if the API call fails for any reason.
 */
async function fetchFormQuestionLabels(formId: string, apiKey: string | undefined): Promise<Record<string, string>> {
  if (!apiKey) return {};
  const cached = formQuestionLabelsCache.get(formId);
  if (cached) return cached;
  try {
    const res = await fetch(`https://api.jotform.com/form/${encodeURIComponent(formId)}/questions?apiKey=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return {};
    const body = (await res.json()) as { content?: Record<string, { text?: string }> };
    const labels: Record<string, string> = {};
    for (const [qid, q] of Object.entries(body.content ?? {})) {
      if (q?.text) labels[qid] = q.text.replace(/<[^>]+>/g, "").trim(); // strip any HTML Jotform embeds in the title
    }
    formQuestionLabelsCache.set(formId, labels);
    return labels;
  } catch {
    return {};
  }
}

/**
 * Turns a Jotform rawRequest question key like "q14_technicianQuestions"
 * into a readable label ("Technician Questions"). Best-effort heuristic,
 * same spirit as extractSubmitterName below — used only as a fallback when
 * fetchFormQuestionLabels above couldn't resolve the field's real title.
 */
function humanizeFieldKey(key: string): string {
  const stripped = key.replace(/^q\d+_/, "");
  const spaced = stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Renders one answer value (string / array / composite object) to display text, or null to omit it. */
function stringifyAnswerValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || looksLikeJotformFileValue(trimmed)) return null; // shown in Attachments instead
    return trimmed;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string" && v.trim() !== "" && !looksLikeJotformFileValue(v));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    // Composite widgets (name, address, signature pad) all come through as
    // an object of sub-values — filter out file-like ones the same as the
    // string/array branches above (a signature pad's answer is exactly this
    // shape, e.g. { url: "uploads/..." }), or its path leaks through as
    // plain text instead of becoming an Attachments thumbnail.
    const parts = Object.values(value as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string" && v.trim() !== "" && !looksLikeJotformFileValue(v)
    );
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return String(value);
}

/**
 * Builds the full "every question and answer" list directly from rawRequest
 * (structured JSON) rather than Jotform's own "pretty" summary text — the
 * pretty string is comma-joined free text with no reliable field delimiter,
 * so multi-select checkboxes and paragraph answers containing commas could
 * get silently mis-split or dropped when parsed back out downstream.
 * Returned as an array (stored JSON-encoded) instead of a string.
 */
async function buildAnswerRows(
  rawRequest: string | null,
  formId: string,
  jotformApiKey: string | undefined
): Promise<{ label: string; value: string }[]> {
  if (!rawRequest) return [];
  try {
    const parsed = JSON.parse(rawRequest) as Record<string, unknown>;
    const questionLabels = await fetchFormQuestionLabels(formId, jotformApiKey);
    const rows: { label: string; value: string }[] = [];
    for (const [key, val] of Object.entries(parsed)) {
      // Real question answers are always keyed "qN_fieldName". rawRequest
      // also carries Jotform's own submission bookkeeping alongside them —
      // slug, jsExecutionTracker, submitSource, submitDate, buildDate,
      // uploadServerUrl, etc. — which never follow that pattern. Skip
      // anything that isn't an actual question key.
      const qidMatch = key.match(/^q(\d+)_/);
      if (!qidMatch) continue;
      const value = stringifyAnswerValue(val);
      if (value === null) continue;
      const label = questionLabels[qidMatch[1]] || humanizeFieldKey(key);
      rows.push({ label, value });
    }
    // Two questions can genuinely share the identical title in Jotform
    // itself (e.g. several fields left as the default "Type a question"
    // placeholder) — number the duplicates so they're still distinguishable
    // in the list instead of silently looking like the same field repeated.
    const labelCounts = new Map<string, number>();
    for (const r of rows) labelCounts.set(r.label, (labelCounts.get(r.label) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const r of rows) {
      if ((labelCounts.get(r.label) ?? 0) <= 1) continue;
      const n = (seen.get(r.label) ?? 0) + 1;
      seen.set(r.label, n);
      r.label = `${r.label} (${n})`;
    }
    return rows;
  } catch {
    return [];
  }
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * Upload one file to Firebase Storage via the GCS JSON API (multipart upload
 * in a single request: JSON metadata part + raw bytes part). Sets a
 * `firebaseStorageDownloadTokens` value so the returned URL works the same
 * way client-side `getDownloadURL()` calls do elsewhere in this app (see
 * src/lib/firebase/storage.ts) — no separate auth needed to view it.
 */
async function uploadFileToStorage(
  bucket: string,
  accessToken: string,
  objectPath: string,
  contentType: string,
  bytes: Uint8Array
): Promise<string> {
  const boundary = `jotform_${crypto.randomUUID()}`;
  const downloadToken = crypto.randomUUID();
  const enc = new TextEncoder();
  const metadataJson = JSON.stringify({
    name: objectPath,
    contentType,
    metadata: { firebaseStorageDownloadTokens: downloadToken },
  });
  const body = concatUint8Arrays([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    enc.encode(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      // Cast needed: this lib's DOM types predate the generic
      // Uint8Array<ArrayBufferLike> signature (same pre-existing mismatch as
      // supabaseTokenBridge.ts) — the runtime value is a plain Blob either way.
      body: new Blob([body as unknown as BlobPart]),
    }
  );
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);

  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}

/**
 * Download every Jotform-hosted file answer and re-upload it into Firebase
 * Storage under companies/{companyId}/jotform-submissions/{formId}/{submissionId}/.
 * Best-effort: a single file failing to mirror doesn't fail the whole
 * webhook — the notification still goes out either way.
 */
async function mirrorSubmissionFiles(
  fileUrls: string[],
  opts: { bucket: string; accessToken: string; companyId: string; formId: string; submissionId: string; jotformApiKey?: string }
): Promise<string[]> {
  const results = await Promise.allSettled(
    fileUrls.map(async (url, i) => {
      const dataUriMatch = url.match(DATA_URI_RE);

      if (dataUriMatch) {
        // Self-contained — fetch() decodes a data: URI locally with no
        // network request, so none of the Jotform-auth machinery below
        // applies (appending ?apiKey= would corrupt the base64 payload).
        const fileRes = await fetch(url);
        const contentType = fileRes.headers.get("content-type") || `image/${dataUriMatch[1].toLowerCase()}`;
        const bytes = new Uint8Array(await fileRes.arrayBuffer());
        const ext = dataUriMatch[1].toLowerCase().replace(/^jpg$/, "jpeg");
        const filename = `signature-${i}.${ext}`;
        const objectPath = `companies/${opts.companyId}/jotform-submissions/${opts.formId}/${opts.submissionId}/${filename}`;
        return uploadFileToStorage(opts.bucket, opts.accessToken, objectPath, contentType, bytes);
      }

      // Jotform's uploaded-file URLs are private by default (a plain fetch
      // gets redirected to Jotform's own login page, which is the HTML
      // Jotform sends back instead of the file). Jotform's officially
      // supported way to fetch them programmatically is appending the
      // account's API key as a query param.
      const downloadUrl = opts.jotformApiKey
        ? `${url}${url.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(opts.jotformApiKey)}`
        : url;
      const fileRes = await fetch(downloadUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
      });
      if (!fileRes.ok) throw new Error(`Fetching Jotform file failed (${fileRes.status}): ${url}`);
      const contentType = fileRes.headers.get("content-type") || "application/octet-stream";
      // Guard against silently re-hosting an HTML error/interstitial page as
      // if it were the real file — verify the response actually looks like
      // the file type its URL claims before uploading it anywhere.
      const extMatch = url.match(/\.(png|jpe?g|gif|webp|heic|pdf)(\?|$)/i);
      const expectedType = extMatch ? extMatch[1].toLowerCase() : null;
      const looksRight =
        !expectedType ||
        (expectedType === "pdf" ? contentType.includes("pdf") : contentType.startsWith("image/"));
      if (!looksRight) {
        throw new Error(`Unexpected content-type "${contentType}" fetching ${url} — likely blocked, not a real file`);
      }
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] || `file-${i}`);
      const objectPath = `companies/${opts.companyId}/jotform-submissions/${opts.formId}/${opts.submissionId}/${filename}`;
      return uploadFileToStorage(opts.bucket, opts.accessToken, objectPath, contentType, bytes);
    })
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[jotform-webhook] file mirror failed for ${fileUrls[i]}:`, r.reason);
  });
  return results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled").map((r) => r.value);
}

// Must stay in sync with isJotformHrRole()/JOTFORM_HR_ROLES in
// src/lib/roleLabels.ts, which gates who sees the Jotform Submissions tab
// on the HR & Recruitment Dashboard (ReportHRDaily.tsx) — this is who
// actually gets notified. Inlined rather than imported: this file is
// deliberately dependency-free so it stays portable across whatever
// runtime ends up building it (Cloudflare Worker today, previously a
// Vercel nodejs20.x function).
const JOTFORM_HR_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN", "MANAGER"]);

/**
 * Look up HR-tier recipients from Supabase `profiles` — the app's actual
 * source of truth for users and roles (Firestore's `users_index` is legacy
 * and isn't written to by the current user-provisioning flow, so querying
 * it here always returned zero recipients for any account created
 * recently).
 *
 * Matches HR/Admin/Superadmin/Manager as either the primary `role` or
 * anywhere in `extra_roles` (sub-roles), scoped to the target company and
 * active accounts only. Uses the service-role key to bypass RLS — this
 * webhook has no logged-in Supabase session to scope a normal query to.
 */
async function findHrFirebaseUids(
  supabaseUrl: string,
  serviceKey: string,
  companyId: string
): Promise<string[]> {
  const url =
    `${supabaseUrl}/rest/v1/profiles` +
    `?select=firebase_uid,role,extra_roles` +
    `&company_id=eq.${encodeURIComponent(companyId)}` +
    `&is_active=eq.true`;
  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`Supabase profiles query failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{
    firebase_uid: string | null;
    role: string | null;
    extra_roles: string[] | null;
  }>;
  return rows
    .filter((r) => {
      const roles = [r.role, ...(r.extra_roles ?? [])].map((v) => String(v ?? "").trim().toUpperCase());
      return roles.some((v) => JOTFORM_HR_ROLES.has(v));
    })
    .map((r) => r.firebase_uid)
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
  fields: { title: string; body: string; formId: string; submissionId: string; answers: string; photos: string[] }
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
          // Jotform's own human-readable "Label: value, Label: value…" summary
          // of every answer — stashed here so the notification can be clicked
          // open to show the full submission, without a second data store.
          answers: sv(fields.answers),
          // Any file-upload answers, re-hosted in Firebase Storage under
          // companies/{companyId}/jotform-submissions/ (see mirrorSubmissionFiles).
          photos: { arrayValue: { values: fields.photos.map((p) => sv(p)) } },
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
    // Lead with the actual form's name so different forms are distinguishable
    // at a glance in the notification list, instead of every entry reading
    // the same generic "New Form Submitted".
    const title = formTitle || "New Form Submitted";
    const body = `Submitted by ${submitterName}`;

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

    const supabaseUrl: string | undefined =
      (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ??
      getEnv("VITE_SUPABASE_URL");
    const supabaseServiceKey: string | undefined =
      (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ??
      getEnv("SUPABASE_SERVICE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return json(
        { error: !supabaseUrl ? "Server missing VITE_SUPABASE_URL" : "Server missing SUPABASE_SERVICE_KEY" },
        500
      );
    }

    const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKey);
    const hrUids = await findHrFirebaseUids(supabaseUrl, supabaseServiceKey, companyId);

    if (hrUids.length === 0) {
      // Not an error — ack quickly so Jotform doesn't retry a "failed" delivery.
      return json({ success: true, notified: 0, note: "No active HR users found for companyId" });
    }

    // ── Mirror any uploaded files into Firebase Storage ─────────────────────
    // Jotform's own file URLs require a Jotform session/API key to fetch
    // later and can vanish if the form or account changes, so we re-host them
    // under companies/{companyId}/jotform-submissions/ instead. Best-effort —
    // a failed mirror never blocks the notification itself.
    const storageBucket: string | undefined =
      (g.__FIREBASE_STORAGE_BUCKET__ && g.__FIREBASE_STORAGE_BUCKET__ !== "" ? g.__FIREBASE_STORAGE_BUCKET__ : undefined) ??
      getEnv("VITE_FIREBASE_STORAGE_BUCKET");
    const jotformApiKey: string | undefined =
      (g.__JOTFORM_API_KEY__ && g.__JOTFORM_API_KEY__ !== "" ? g.__JOTFORM_API_KEY__ : undefined) ??
      getEnv("JOTFORM_API_KEY");
    const fileUrls = extractFileUrls(rawRequest);
    let photos: string[] = [];
    if (fileUrls.length > 0 && storageBucket) {
      try {
        photos = await mirrorSubmissionFiles(fileUrls, {
          bucket: storageBucket,
          accessToken,
          companyId,
          formId: formID,
          submissionId: submissionID,
          jotformApiKey,
        });
      } catch (err) {
        console.error("[jotform-webhook] file mirroring failed:", err);
      }
    }

    // Structured rows built straight from rawRequest (with real question
    // titles pulled from Jotform's Form API where possible) — see
    // buildAnswerRows for why this replaced Jotform's "pretty" text. Built
    // once and reused for every recipient below, not per-uid.
    const answersJson = JSON.stringify(await buildAnswerRows(rawRequest, formID, jotformApiKey));

    const dedupeId = submissionID ? `jotform_${submissionID}` : `jotform_${crypto.randomUUID()}`;
    const results = await Promise.all(
      hrUids.map((uid) =>
        writeNotification(projectId!, accessToken, uid, dedupeId, {
          title,
          body,
          formId: formID,
          submissionId: submissionID,
          answers: answersJson,
          photos,
        })
      )
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
