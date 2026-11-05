/**
 * Paystub PDFs (Accounting → Paystubs, Self-Service → My Files) in the
 * private Supabase Storage bucket "employee-files" (migration 0418), done
 * server-side with the service key.
 *
 * The browser can't talk to Supabase Storage itself: Storage doesn't accept
 * the app's minted Supabase token the way the database does, so its RLS
 * sees no user and refuses every upload ("new row violates row-level
 * security policy") even though the same check passes in the database. So
 * this does the same checks the 0418 policies describe, from a verified
 * Firebase ID token:
 *   - upload / remove: an active Finance, HR, Admin or SuperAdmin (primary
 *     or extra role) of the company the path belongs to;
 *   - url (open a file): that, or the employee the file is PUBLISHED to.
 *
 *   POST /api/employee-files?action=upload&path=<company>/<batch>/<file>.pdf
 *     Authorization: Bearer <Firebase ID token>, body: the PDF bytes  → { ok }
 *   POST /api/employee-files?action=url&path=...[&download=<name>]       → { url }  (5 min)
 *   POST /api/employee-files?action=remove   body: { paths: string[] }   → { ok }
 */

import { verifyFirebaseToken } from "./supabaseTokenBridge";

const BUCKET = "employee-files";
const MAX_BYTES = 20 * 1024 * 1024;
const ADMIN_ROLES = new Set(["FINANCE", "ACCOUNTING_MANAGER", "HR", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);

interface Env {
  supabaseUrl: string;
  serviceKey: string;
  projectId: string;
}

function readEnv(env?: Record<string, string | undefined>): Env | null {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const pick = (global: string, key: string): string | undefined => (g[global] && g[global] !== "" ? g[global] : undefined) ?? getEnv(key);
  const supabaseUrl = pick("__SUPABASE_URL__", "VITE_SUPABASE_URL");
  const serviceKey = pick("__SUPABASE_SERVICE_KEY__", "SUPABASE_SERVICE_KEY");
  const projectId = pick("__FIREBASE_PROJECT_ID__", "VITE_FIREBASE_PROJECT_ID");
  if (!supabaseUrl || !serviceKey || !projectId) return null;
  return { supabaseUrl, serviceKey, projectId };
}

/** <company>/<...>/<file>, no "..", empty or "." segments, no control characters. */
function cleanPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  const parts = raw.split("/");
  if (parts.length < 2 || parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return raw;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export async function handleEmployeeFilesRequest(request: Request, rawEnv?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv(rawEnv);
  if (!env) return json({ error: "Server not configured for paystub files." }, 500);
  const svc = { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` };

  const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return json({ error: "Not signed in." }, 401);
  let uid: string;
  try {
    uid = (await verifyFirebaseToken(idToken, env.projectId)).sub;
  } catch {
    return json({ error: "Your login session has expired — refresh the page and try again." }, 401);
  }

  try {
    const meRes = await fetch(`${env.supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(uid)}&is_active=eq.true&select=id,company_id,role,extra_roles&limit=1`, { headers: svc });
    const me = meRes.ok ? ((await meRes.json()) as { id: string; company_id: string | null; role: string | null; extra_roles: string[] | null }[])[0] : undefined;
    if (!me?.company_id) return json({ error: "No active account found for this login." }, 403);
    const isAdmin = [me.role, ...(me.extra_roles ?? [])].some((r) => ADMIN_ROLES.has(String(r ?? "").trim().toUpperCase()));
    const inMyCompany = (path: string) => path.split("/")[0] === me.company_id;

    const params = new URL(request.url).searchParams;
    const action = params.get("action");

    if (action === "upload") {
      const path = cleanPath(params.get("path"));
      if (!path) return json({ error: "Invalid file path." }, 400);
      if (!isAdmin) return json({ error: "Only Finance, HR, Admin or Super Admin can upload paystubs." }, 403);
      if (!inMyCompany(path)) return json({ error: "That folder belongs to another company." }, 403);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0) return json({ error: "The file is empty." }, 400);
      if (bytes.byteLength >= MAX_BYTES) return json({ error: "The file is too large (20 MB max)." }, 413);
      const res = await fetch(`${env.supabaseUrl}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
        method: "POST",
        headers: { ...svc, "Content-Type": "application/pdf", "x-upsert": "false" },
        body: bytes,
      });
      if (!res.ok) return json({ error: `Upload failed (${res.status}): ${await res.text()}` }, 502);
      return json({ ok: true });
    }

    if (action === "url") {
      const path = cleanPath(params.get("path"));
      if (!path || !inMyCompany(path)) return json({ error: "File not found." }, 404);
      if (!isAdmin) {
        const ownRes = await fetch(
          `${env.supabaseUrl}/rest/v1/employee_files?storage_path=eq.${encodeURIComponent(path)}&profile_id=eq.${me.id}&status=eq.published&select=id&limit=1`,
          { headers: svc }
        );
        const own = ownRes.ok ? ((await ownRes.json()) as unknown[]) : [];
        if (own.length === 0) return json({ error: "File not found." }, 404);
      }
      const res = await fetch(`${env.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${encodePath(path)}`, {
        method: "POST",
        headers: { ...svc, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 300 }),
      });
      if (!res.ok) return json({ error: `Couldn't open the file (${res.status}).` }, 502);
      const { signedURL } = (await res.json()) as { signedURL: string };
      const download = params.get("download");
      const url = `${env.supabaseUrl}/storage/v1${signedURL}${download ? `&download=${encodeURIComponent(download)}` : ""}`;
      return json({ url });
    }

    if (action === "remove") {
      const body = (await request.json().catch(() => ({}))) as { paths?: unknown };
      const paths = (Array.isArray(body.paths) ? body.paths : []).map((p) => cleanPath(typeof p === "string" ? p : null));
      if (paths.length === 0 || paths.some((p) => !p)) return json({ error: "Invalid file path." }, 400);
      if (!isAdmin || !paths.every((p) => inMyCompany(p!))) return json({ error: "Only Finance, HR or Admin can remove paystubs for your company." }, 403);
      const res = await fetch(`${env.supabaseUrl}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: { ...svc, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok) return json({ error: `Remove failed (${res.status}).` }, 502);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("employee-files failed:", err);
    return json({ error: err instanceof Error ? err.message : "Request failed" }, 502);
  }
}
