/**
 * "Connect Google Drive" — lets one company Admin connect their own Google
 * account (OAuth authorization-code flow, `drive.file` scope — the app can
 * only see/manage files it creates itself, never the rest of that Drive),
 * then every submission on a form with a Document Template gets its
 * generated PDF auto-uploaded into that Drive under
 * "File Submissions/{Form Title}/{Form Title} - {Submitter} - {date}/".
 *
 * The refresh token this produces is stored server-side only (see migration
 * 0080_hr_google_drive_connections.sql) — regular users only ever see connected/not-connected status via
 * the get_google_drive_connection_status() RPC, never the token itself.
 *
 * One pathname (/api/google-drive) handles three things, distinguished by
 * query params, same convention as customFormsBridge.ts's slug/notify:
 *  - ?action=connect&idToken=...   — redirects the browser to Google's
 *    consent screen (a real navigation, not a fetch — Google's consent
 *    page can't run inside anything but the top-level window).
 *  - ?code=...&state=...           — Google's own callback hitting this
 *    same URL, since that's what gets registered as the redirect_uri.
 *  - ?action=upload (POST)         — called by the submitter's own browser
 *    right after a successful submission (see src/lib/documentTemplates/driveUpload.ts),
 *    carrying the already-generated PDF bytes + a submissionId. PDF
 *    generation itself can never happen here — it needs html2canvas/a real
 *    DOM/canvas, which this Worker/Node runtime doesn't have.
 *
 * Web Crypto / fetch only, no Node-specific APIs — same reasoning as
 * supabaseTokenBridge.ts (must run identically on Cloudflare Workers, Vite
 * dev, and any Node serverless target).
 */

import { verifyFirebaseToken, strToB64url, b64urlToString } from "./supabaseTokenBridge";
import { fetchSubmissionForNotify } from "./customFormsBridge";

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
  firebaseProjectId: string;
  googleClientId: string;
  googleClientSecret: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  const firebaseProjectId = (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  const googleClientId = getEnv("GOOGLE_DRIVE_CLIENT_ID");
  const googleClientSecret = getEnv("GOOGLE_DRIVE_CLIENT_SECRET");

  if (!supabaseUrl) return { error: "Server missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Server missing SUPABASE_SERVICE_KEY" };
  if (!firebaseProjectId) return { error: "Server missing VITE_FIREBASE_PROJECT_ID" };
  if (!googleClientId) return { error: "Server missing GOOGLE_DRIVE_CLIENT_ID" };
  if (!googleClientSecret) return { error: "Server missing GOOGLE_DRIVE_CLIENT_SECRET" };
  return { supabaseUrl, supabaseServiceKey, firebaseProjectId, googleClientId, googleClientSecret };
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";

// ---- profiles / connections (Supabase REST, service-role key) ----

async function fetchProfileByFirebaseUid(
  env: EnvBag,
  firebaseUid: string
): Promise<{ id: string; companyId: string; role: string | null; name: string } | null> {
  const url =
    `${env.supabaseUrl}/rest/v1/profiles?select=id,company_id,role,display_name,username,email` +
    `&firebase_uid=eq.${encodeURIComponent(firebaseUid)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id: string; company_id: string; role: string | null; display_name: string | null; username: string | null; email: string }>;
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, companyId: r.company_id, role: r.role, name: r.display_name || r.username || r.email };
}

async function fetchDriveConnection(env: EnvBag, companyId: string): Promise<{ refreshToken: string; rootFolderId: string | null } | null> {
  const url = `${env.supabaseUrl}/rest/v1/hr_google_drive_connections?select=refresh_token,root_folder_id&company_id=eq.${encodeURIComponent(companyId)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase Drive connection lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ refresh_token: string; root_folder_id: string | null }>;
  const r = rows[0];
  return r ? { refreshToken: r.refresh_token, rootFolderId: r.root_folder_id } : null;
}

async function upsertDriveConnection(env: EnvBag, companyId: string, connectedByProfileId: string, connectedByName: string, refreshToken: string): Promise<void> {
  const url = `${env.supabaseUrl}/rest/v1/hr_google_drive_connections?on_conflict=company_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.supabaseServiceKey,
      Authorization: `Bearer ${env.supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ company_id: companyId, connected_by: connectedByProfileId, connected_by_name: connectedByName, refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Supabase Drive connection upsert failed (${res.status}): ${await res.text()}`);
}

async function saveRootFolderId(env: EnvBag, companyId: string, rootFolderId: string): Promise<void> {
  const url = `${env.supabaseUrl}/rest/v1/hr_google_drive_connections?company_id=eq.${encodeURIComponent(companyId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ root_folder_id: rootFolderId }),
  });
  if (!res.ok) throw new Error(`Supabase Drive root folder save failed (${res.status}): ${await res.text()}`);
}

// ---- Google OAuth token exchange ----

async function exchangeCodeForTokens(env: EnvBag, code: string, redirectUri: string): Promise<{ refreshToken: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { refresh_token?: string };
  // Google only issues a refresh_token on first consent unless the auth
  // request forced prompt=consent (which the /connect step below always
  // does specifically so this never happens) — if it's still missing here,
  // something upstream changed; surface it clearly rather than silently
  // storing an unusable connection.
  if (!data.refresh_token) throw new Error("Google did not return a refresh token — try connecting again");
  return { refreshToken: data.refresh_token };
}

async function refreshAccessToken(env: EnvBag, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Google access token refresh failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ---- Drive API (v3) ----

/** Drive folder/file names allow most characters, but strip anything that reads as a path separator or trims oddly so a form title or submitter name can never produce a surprising nested path or trailing whitespace. */
function sanitizeDriveName(name: string): string {
  return name.replace(/[\\/]+/g, "-").trim().slice(0, 200) || "Untitled";
}

async function findFolder(accessToken: string, name: string, parentId: string | null): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  const parentClause = parentId ? `'${parentId}' in parents` : "'root' in parents";
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false and ${parentClause}`;
  const res = await fetch(`${DRIVE_FILES_ENDPOINT}?q=${encodeURIComponent(q)}&fields=files(id)`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive folder search failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { files: Array<{ id: string }> };
  return data.files[0]?.id ?? null;
}

async function createFolder(accessToken: string, name: string, parentId: string | null): Promise<string> {
  const res = await fetch(DRIVE_FILES_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function findOrCreateFolder(accessToken: string, name: string, parentId: string | null): Promise<string> {
  const existing = await findFolder(accessToken, name, parentId);
  return existing ?? createFolder(accessToken, name, parentId);
}

/** Two-step upload (create empty file metadata, then PATCH the raw bytes in) rather than a hand-built multipart/related body — much simpler to get right in a Worker with no Node Buffer/form-data library. */
async function uploadFileToDrive(accessToken: string, folderId: string, fileName: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const metaRes = await fetch(DRIVE_FILES_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  });
  if (!metaRes.ok) throw new Error(`Drive file create failed (${metaRes.status}): ${await metaRes.text()}`);
  const { id } = (await metaRes.json()) as { id: string };

  const uploadRes = await fetch(`${DRIVE_UPLOAD_ENDPOINT}/${id}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mimeType },
    // Cast needed: this lib's DOM types predate the generic
    // Uint8Array<ArrayBufferLike> signature (same pre-existing mismatch as
    // supabaseTokenBridge.ts/jotformBridge.ts) — the runtime value is a
    // plain Blob either way.
    body: new Blob([bytes as unknown as BlobPart]),
  });
  if (!uploadRes.ok) throw new Error(`Drive file upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  return id;
}

/** The whole "put this submission's PDF where it belongs" orchestration — resolves the submission from its id (never trusting client-claimed company/form/name fields), no-ops if that company hasn't connected Drive. */
async function uploadSubmissionPdfToDrive(env: EnvBag, submissionId: string, pdfBytes: Uint8Array): Promise<{ uploaded: boolean; reason?: string }> {
  const submission = await fetchSubmissionForNotify(env, submissionId);
  if (!submission) return { uploaded: false, reason: "Submission not found" };

  const connection = await fetchDriveConnection(env, submission.companyId);
  if (!connection) return { uploaded: false, reason: "Google Drive not connected for this company" };

  const accessToken = await refreshAccessToken(env, connection.refreshToken);

  let rootFolderId = connection.rootFolderId;
  if (!rootFolderId) {
    rootFolderId = await findOrCreateFolder(accessToken, "File Submissions", null);
    await saveRootFolderId(env, submission.companyId, rootFolderId);
  }

  const formTitle = submission.formTitle || "Untitled Form";
  const formFolderId = await findOrCreateFolder(accessToken, sanitizeDriveName(formTitle), rootFolderId);

  const dateStr = new Date().toISOString().slice(0, 10);
  const submissionFolderName = sanitizeDriveName(`${formTitle} - ${submission.submitterName || "Anonymous"} - ${dateStr}`);
  // Always a fresh folder (not find-or-create) — every submission is its own event, even if the same person submits the same form twice in one day.
  const submissionFolderId = await createFolder(accessToken, submissionFolderName, formFolderId);

  await uploadFileToDrive(accessToken, submissionFolderId, `${submissionFolderName}.pdf`, "application/pdf", pdfBytes);
  return { uploaded: true };
}

export async function handleGoogleDriveRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const url = new URL(request.url);
  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;

  // Google's own redirect back to us after the user completes (or cancels)
  // the consent screen — this is registered as the OAuth client's redirect_uri.
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code && state) {
    const appOrigin = url.origin;
    try {
      const decoded = JSON.parse(b64urlToString(state)) as { companyId: string; profileId: string; connectedByName: string };
      const redirectUri = `${url.origin}${url.pathname}`;
      const { refreshToken } = await exchangeCodeForTokens(envBag, code, redirectUri);
      await upsertDriveConnection(envBag, decoded.companyId, decoded.profileId, decoded.connectedByName, refreshToken);
      return Response.redirect(`${appOrigin}/hr-dashboard?tab=customForms&driveConnected=1`, 302);
    } catch (err) {
      console.error("[google-drive] callback error:", err);
      return Response.redirect(`${appOrigin}/hr-dashboard?tab=customForms&driveConnected=0`, 302);
    }
  }
  if (url.searchParams.get("error")) {
    // The user hit "Cancel" on Google's consent screen.
    return Response.redirect(`${url.origin}/hr-dashboard?tab=customForms&driveConnected=0`, 302);
  }

  if (url.searchParams.get("action") === "connect") {
    const idToken = url.searchParams.get("idToken");
    if (!idToken) return json({ error: "Missing idToken" }, 400);
    try {
      const claims = await verifyFirebaseToken(idToken, envBag.firebaseProjectId);
      const profile = await fetchProfileByFirebaseUid(envBag, claims.sub);
      if (!profile) return json({ error: "Profile not found" }, 404);
      if (!profile.role || !["ADMIN", "SUPERADMIN"].includes(profile.role.toUpperCase())) {
        return json({ error: "Only an Admin can connect Google Drive" }, 403);
      }
      const state = strToB64url(JSON.stringify({ companyId: profile.companyId, profileId: profile.id, connectedByName: profile.name }));
      const redirectUri = `${url.origin}${url.pathname}`;
      const authUrl = new URL(AUTH_ENDPOINT);
      authUrl.searchParams.set("client_id", envBag.googleClientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", DRIVE_SCOPE);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);
      return Response.redirect(authUrl.toString(), 302);
    } catch (err) {
      console.error("[google-drive] connect error:", err);
      return json({ error: err instanceof Error ? err.message : "Connect failed" }, 500);
    }
  }

  if (url.searchParams.get("action") === "upload") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const formData = await request.formData();
      const submissionId = formData.get("submissionId");
      const file = formData.get("file");
      if (typeof submissionId !== "string" || !submissionId) return json({ error: "Missing submissionId" }, 400);
      if (!(file instanceof File)) return json({ error: "Missing file" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await uploadSubmissionPdfToDrive(envBag, submissionId, bytes);
      return json(result);
    } catch (err) {
      console.error("[google-drive] upload error:", err);
      return json({ error: err instanceof Error ? err.message : "Upload failed" }, 500);
    }
  }

  return json({ error: "Unknown request" }, 400);
}
