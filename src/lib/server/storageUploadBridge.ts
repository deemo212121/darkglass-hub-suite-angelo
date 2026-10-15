/**
 * Same-origin Firebase Storage upload — the fallback for browsers that can't
 * reach firebasestorage.googleapis.com (an office web filter, a carrier, a
 * privacy extension). The Storage SDK there retries until it gives up with
 * storage/retry-limit-exceeded: signing pages failed with "Couldn't reach the
 * file storage service" and mobile ticket photos sat on "Waiting to sync"
 * forever. src/lib/firebase/storage.ts then sends the same bytes here — the
 * app's own domain, reachable whenever the app itself loaded — and this
 * writes them to the same object path with the service account
 * (uploadFileToStorage), returning the same kind of download URL.
 *
 *   POST /api/storage-upload?path=<object path>
 *     Authorization: Bearer <Firebase ID token>
 *     Content-Type:  the file's type
 *     X-Custom-Metadata: encodeURIComponent(JSON) of customMetadata (optional)
 *     body: the raw file bytes
 *   → { url, fullPath }
 *
 * Same limits as storage.rules, plus company scoping the rules can't do:
 * signed-in only, under companies/{the caller's company}/ (or the legacy
 * shared COMP001 folder the app falls back to), under 25 MB, and images only
 * under .../tickets/.
 */

import { verifyFirebaseToken } from "./supabaseTokenBridge";
import { getGoogleAccessToken, uploadFileToStorage } from "./jotformBridge";

const MAX_BYTES = 25 * 1024 * 1024;
const LEGACY_COMPANY_FOLDER = "COMP001";

interface UploadEnv {
  supabaseUrl: string;
  supabaseServiceKey: string;
  projectId: string;
  serviceAccountEmail: string;
  privateKey: string;
  bucket: string;
}

function readEnv(env?: Record<string, string | undefined>): UploadEnv | null {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const pick = (global: string, key: string): string | undefined => (g[global] && g[global] !== "" ? g[global] : undefined) ?? getEnv(key);
  const supabaseUrl = pick("__SUPABASE_URL__", "VITE_SUPABASE_URL");
  const supabaseServiceKey = pick("__SUPABASE_SERVICE_KEY__", "SUPABASE_SERVICE_KEY");
  const projectId = pick("__FIREBASE_PROJECT_ID__", "VITE_FIREBASE_PROJECT_ID");
  const serviceAccountEmail = pick("__FIREBASE_SA_EMAIL__", "FIREBASE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = pick("__FIREBASE_SA_PRIVATE_KEY__", "FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const bucket = pick("__FIREBASE_STORAGE_BUCKET__", "VITE_FIREBASE_STORAGE_BUCKET");
  if (!supabaseUrl || !supabaseServiceKey || !projectId || !serviceAccountEmail || !privateKey || !bucket) return null;
  return { supabaseUrl, supabaseServiceKey, projectId, serviceAccountEmail, privateKey, bucket };
}

/** A clean companies/... object path, or null — no "..", empty or "." segments, no control characters. */
function cleanObjectPath(raw: string | null): string | null {
  if (!raw || raw.length > 1024) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  const parts = raw.split("/");
  if (parts.length < 3 || parts[0] !== "companies") return null;
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return raw;
}

export async function handleStorageUploadRequest(request: Request, rawEnv?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv(rawEnv);
  if (!env) return json({ error: "Server not configured for file uploads" }, 500);

  const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return json({ error: "Not signed in." }, 401);
  let uid: string;
  try {
    uid = (await verifyFirebaseToken(idToken, env.projectId)).sub;
  } catch {
    return json({ error: "Your login session has expired — refresh the page (or sign in again) and try again." }, 401);
  }

  const objectPath = cleanObjectPath(new URL(request.url).searchParams.get("path"));
  if (!objectPath) return json({ error: "Invalid file path." }, 400);

  try {
    const meRes = await fetch(`${env.supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(uid)}&select=company_id,role,extra_roles&limit=1`, {
      headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` },
    });
    const me = meRes.ok ? ((await meRes.json()) as { company_id: string | null; role: string | null; extra_roles: string[] | null }[])[0] : undefined;
    if (!me) return json({ error: "No account found for this login." }, 403);
    const folder = objectPath.split("/")[1];
    const platformAdmin = [me.role, ...(me.extra_roles ?? [])].some((r) => String(r ?? "").trim().toUpperCase() === "SUPERSUPERADMIN");
    if (folder !== me.company_id && folder !== LEGACY_COMPANY_FOLDER && !platformAdmin) return json({ error: "That folder belongs to another company." }, 403);

    const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim() || "application/octet-stream";
    if (objectPath.split("/")[2] === "tickets" && !contentType.startsWith("image/")) return json({ error: "Ticket attachments must be images." }, 400);

    let customMetadata: Record<string, string> = {};
    const metaHeader = request.headers.get("X-Custom-Metadata");
    if (metaHeader) {
      try {
        const parsed = JSON.parse(decodeURIComponent(metaHeader)) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed ?? {})) if (typeof v === "string" && k !== "firebaseStorageDownloadTokens") customMetadata[k] = v;
      } catch {
        customMetadata = {};
      }
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return json({ error: "The file is empty." }, 400);
    if (bytes.byteLength >= MAX_BYTES) return json({ error: "The file is too large (25 MB max)." }, 413);

    const accessToken = await getGoogleAccessToken(env.serviceAccountEmail, env.privateKey);
    const url = await uploadFileToStorage(env.bucket, accessToken, objectPath, contentType, bytes, customMetadata);
    return json({ url, fullPath: objectPath });
  } catch (err) {
    console.error("storage-upload failed:", err);
    return json({ error: err instanceof Error ? err.message : "Upload failed" }, 502);
  }
}
