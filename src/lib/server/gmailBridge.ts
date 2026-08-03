/**
 * "Connect Gmail" — lets one company Admin connect their own Google
 * account (OAuth authorization-code flow, `gmail.send` scope — the app can
 * only SEND mail as that account, never read/manage their inbox), then
 * Payroll can send individual payslip emails from that connected address.
 * Same shape as googleDriveBridge.ts (drive.file scope) — reuses the same
 * OAuth client (GOOGLE_DRIVE_CLIENT_ID/SECRET) with an additional
 * registered redirect URI (this file's own pathname) rather than a second
 * Google Cloud OAuth client.
 *
 * ONE connection PER REGION per company ('US' or 'PH' — matching
 * AccountingDashboard.tsx's US/PH Payroll toggle), not one company-wide
 * connection — each region's payslips should come from its own address.
 * The refresh token is stored server-side only (see migration
 * 0113_hr_gmail_connections.sql) — regular users only ever see
 * connected/not-connected status (+ who connected it and which address)
 * via get_gmail_connection_status(p_region), never the token itself.
 *
 * TESTING PHASE: only a per-employee "send one payslip" action exists
 * (?action=send-payslip) — there is deliberately no bulk "send all"
 * action yet, so this can be tried on a single employee before any wider
 * rollout. One pathname (/api/gmail) handles:
 *  - ?action=connect&region=US|PH&idToken=...  — redirects to Google's
 *    consent screen for that region's connection.
 *  - ?code=...&state=...                       — Google's own OAuth callback.
 *  - ?action=send-payslip (POST)                — body { idToken, profileId,
 *    periodStart, periodEnd, hoursWorked, overtimeHours, hourlyRate,
 *    grossPay, pdfBase64? } — emails that ONE employee their payslip for
 *    that period, from whichever region's connection matches the
 *    employee's OWN assigned_branch (never a client-supplied region — see
 *    resolveEmployeeRegion below — so a caller can't accidentally send a
 *    PH employee's payslip from the US-connected account or vice versa).
 *    When pdfBase64 is supplied (AccountingDashboard.tsx renders the real
 *    "PAYSLIP" template to a PDF client-side via captureHtmlToPdfBlob,
 *    since PDF rendering needs a real browser DOM this server runtime
 *    doesn't have — see payslipTemplate.ts), it's attached as a real PDF
 *    and the email body is just a short cover note; otherwise falls back
 *    to a plain-text numbers summary.
 */

import { verifyFirebaseToken, strToB64url, b64urlToString } from "./supabaseTokenBridge";

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

type Region = "US" | "PH";
function parseRegion(value: string | null | undefined): Region | null {
  const upper = String(value ?? "").toUpperCase();
  return upper === "US" || upper === "PH" ? upper : null;
}
/** Same rule as AccountingDashboard.tsx's country derivation — assigned_branch === "Philippines" is the only PH signal. */
function resolveEmployeeRegion(assignedBranch: string | null): Region {
  return assignedBranch === "Philippines" ? "PH" : "US";
}

// email+profile (not just gmail.send) so the connect step can look up and
// store both the connected address AND the Google account's own display
// name, for the "Connected as: x" UI — profile is required for the name;
// userinfo.email alone only returns the address.
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const CONNECT_ROLES = new Set(["ADMIN", "SUPERADMIN"]);
const PAYSLIP_SENDER_ROLES = new Set(["ADMIN", "SUPERADMIN", "FINANCE"]);

function b64urlEncode(input: string): string {
  return btoa(unescape(encodeURIComponent(input))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

async function fetchProfileById(
  env: EnvBag,
  profileId: string
): Promise<{ id: string; companyId: string; name: string; email: string; assignedBranch: string | null } | null> {
  const url = `${env.supabaseUrl}/rest/v1/profiles?select=id,company_id,display_name,username,email,assigned_branch&id=eq.${encodeURIComponent(profileId)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase profile lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id: string; company_id: string; display_name: string | null; username: string | null; email: string; assigned_branch: string | null }>;
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, companyId: r.company_id, name: r.display_name || r.username || r.email, email: r.email, assignedBranch: r.assigned_branch };
}

async function fetchGmailConnection(env: EnvBag, companyId: string, region: Region): Promise<{ refreshToken: string; connectedEmail: string | null } | null> {
  const url = `${env.supabaseUrl}/rest/v1/hr_gmail_connections?select=refresh_token,connected_email&company_id=eq.${encodeURIComponent(companyId)}&region=eq.${region}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase Gmail connection lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ refresh_token: string; connected_email: string | null }>;
  const r = rows[0];
  return r ? { refreshToken: r.refresh_token, connectedEmail: r.connected_email } : null;
}

async function upsertGmailConnection(
  env: EnvBag,
  companyId: string,
  region: Region,
  connectedByProfileId: string,
  connectedByName: string,
  connectedAccountName: string,
  connectedEmail: string,
  refreshToken: string
): Promise<void> {
  const url = `${env.supabaseUrl}/rest/v1/hr_gmail_connections?on_conflict=company_id,region`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.supabaseServiceKey,
      Authorization: `Bearer ${env.supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      company_id: companyId,
      region,
      connected_by: connectedByProfileId,
      connected_by_name: connectedByName,
      connected_account_name: connectedAccountName,
      connected_email: connectedEmail,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Supabase Gmail connection upsert failed (${res.status}): ${await res.text()}`);
}

// ---- Google OAuth token exchange ----

async function exchangeCodeForTokens(env: EnvBag, code: string, redirectUri: string): Promise<{ refreshToken: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { refresh_token?: string; access_token?: string };
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

async function fetchConnectedProfile(accessToken: string): Promise<{ email: string; name: string }> {
  const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google userinfo lookup failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { email?: string; name?: string };
  if (!data.email) throw new Error("Google did not return an email address for this account");
  // Falls back to the email itself if Google has no display name set (rare, but the field is optional).
  return { email: data.email, name: data.name || data.email };
}

// ---- Gmail API (v1) ----

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** RFC 2045 recommends wrapping base64 body content at 76 chars — Gmail's API is lenient about this, but staying compliant costs nothing. */
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

async function sendGmailMessage(accessToken: string, fromEmail: string, toEmail: string, subject: string, body: string): Promise<void> {
  const message = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const res = await fetch(GMAIL_SEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64urlEncode(message) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed (${res.status}): ${await res.text()}`);
}

/**
 * Same as sendGmailMessage but with one PDF attached — b64urlEncode can't
 * be reused for the message envelope here since the attachment's base64
 * bytes must stay standard base64 (+/ and = padding) verbatim; only the
 * OUTER envelope (the whole raw MIME message handed to Gmail's API) is
 * base64url-encoded, per the Gmail API's own requirement.
 */
async function sendGmailMessageWithAttachment(
  accessToken: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string,
  attachment: { filename: string; mimeType: string; base64Data: string }
): Promise<void> {
  const boundary = `boundary_${crypto.randomUUID()}`;
  const message = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
    "",
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(attachment.base64Data),
    "",
    `--${boundary}--`,
  ].join("\r\n");
  const res = await fetch(GMAIL_SEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64urlEncode(message) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed (${res.status}): ${await res.text()}`);
}

export async function handleGmailRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const url = new URL(request.url);
  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;

  // Google's own redirect back to us — registered as this OAuth client's
  // (additional) redirect_uri.
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code && state) {
    const appOrigin = url.origin;
    let region: Region = "US";
    try {
      const decoded = JSON.parse(b64urlToString(state)) as { companyId: string; profileId: string; connectedByName: string; region: string };
      region = parseRegion(decoded.region) ?? "US";
      const redirectUri = `${url.origin}${url.pathname}`;
      const { refreshToken } = await exchangeCodeForTokens(envBag, code, redirectUri);
      const accessToken = await refreshAccessToken(envBag, refreshToken);
      const { email: connectedEmail, name: connectedAccountName } = await fetchConnectedProfile(accessToken);
      await upsertGmailConnection(envBag, decoded.companyId, region, decoded.profileId, decoded.connectedByName, connectedAccountName, connectedEmail, refreshToken);
      return Response.redirect(`${appOrigin}/m/dashboard/accounting-dashboard?gmailConnected=1&gmailRegion=${region}`, 302);
    } catch (err) {
      console.error("[gmail] callback error:", err);
      return Response.redirect(`${appOrigin}/m/dashboard/accounting-dashboard?gmailConnected=0&gmailRegion=${region}`, 302);
    }
  }
  if (url.searchParams.get("error")) {
    // The user hit "Cancel" on Google's consent screen.
    return Response.redirect(`${url.origin}/m/dashboard/accounting-dashboard?gmailConnected=0`, 302);
  }

  if (url.searchParams.get("action") === "connect") {
    const idToken = url.searchParams.get("idToken");
    const region = parseRegion(url.searchParams.get("region"));
    if (!idToken) return json({ error: "Missing idToken" }, 400);
    if (!region) return json({ error: "Missing or invalid region (must be US or PH)" }, 400);
    try {
      const claims = await verifyFirebaseToken(idToken, envBag.firebaseProjectId);
      const profile = await fetchProfileByFirebaseUid(envBag, claims.sub);
      if (!profile) return json({ error: "Profile not found" }, 404);
      if (!profile.role || !CONNECT_ROLES.has(profile.role.toUpperCase())) {
        return json({ error: "Only an Admin can connect Gmail" }, 403);
      }
      const state = strToB64url(JSON.stringify({ companyId: profile.companyId, profileId: profile.id, connectedByName: profile.name, region }));
      const redirectUri = `${url.origin}${url.pathname}`;
      const authUrl = new URL(AUTH_ENDPOINT);
      authUrl.searchParams.set("client_id", envBag.googleClientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GMAIL_SCOPES);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);
      return Response.redirect(authUrl.toString(), 302);
    } catch (err) {
      console.error("[gmail] connect error:", err);
      return json({ error: err instanceof Error ? err.message : "Connect failed" }, 500);
    }
  }

  if (url.searchParams.get("action") === "send-payslip") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
      const profileId = typeof payload.profileId === "string" ? payload.profileId : "";
      if (!idToken) return json({ error: "Missing idToken" }, 400);
      if (!profileId) return json({ error: "Missing profileId" }, 400);

      const claims = await verifyFirebaseToken(idToken, envBag.firebaseProjectId);
      const caller = await fetchProfileByFirebaseUid(envBag, claims.sub);
      if (!caller) return json({ error: "Profile not found" }, 403);
      if (!caller.role || !PAYSLIP_SENDER_ROLES.has(caller.role.toUpperCase())) {
        return json({ error: "Only Admin or Finance can send payslip emails" }, 403);
      }

      const target = await fetchProfileById(envBag, profileId);
      if (!target || target.companyId !== caller.companyId) return json({ error: "Employee not found" }, 404);
      if (!target.email) return json({ error: `${target.name} has no email on file` }, 400);

      // Derived from the EMPLOYEE's own record, never trusted from the
      // client — a caller can't accidentally (or deliberately) send a PH
      // employee's payslip from the US-connected account or vice versa.
      const region = resolveEmployeeRegion(target.assignedBranch);
      const connection = await fetchGmailConnection(envBag, caller.companyId, region);
      if (!connection) return json({ error: `Gmail is not connected for ${region} payroll yet. Connect it above first.` }, 409);

      const periodStart = String(payload.periodStart ?? "");
      const periodEnd = String(payload.periodEnd ?? "");
      const hoursWorked = Number(payload.hoursWorked ?? 0);
      const overtimeHours = Number(payload.overtimeHours ?? 0);
      const hourlyRate = Number(payload.hourlyRate ?? 0);
      const grossPay = Number(payload.grossPay ?? 0);
      // Rendered client-side (captureHtmlToPdfBlob needs a real browser DOM,
      // which this server runtime doesn't have — see AccountingDashboard.tsx's
      // handleSendPayslip) and handed over as base64 to attach as-is.
      const pdfBase64 = typeof payload.pdfBase64 === "string" ? payload.pdfBase64 : "";

      const accessToken = await refreshAccessToken(envBag, connection.refreshToken);
      const fromEmail = connection.connectedEmail || "me";
      const subject = `Your Payslip: ${periodStart} to ${periodEnd}`;

      if (pdfBase64) {
        const body = [
          `Hi ${target.name},`,
          "",
          `Please find attached your payslip for the period ${periodStart} to ${periodEnd}.`,
          "",
          "This is a test email sent as part of setting up automated payslip delivery.",
          "If anything here looks incorrect, please contact HR or Finance.",
        ].join("\n");
        const filename = `Payslip-${periodStart}-to-${periodEnd}.pdf`;
        await sendGmailMessageWithAttachment(accessToken, fromEmail, target.email, subject, body, {
          filename,
          mimeType: "application/pdf",
          base64Data: pdfBase64,
        });
      } else {
        // Fallback: no PDF supplied, send the same plain-text summary as before.
        const body = [
          `Hi ${target.name},`,
          "",
          `Here is your payslip for the period ${periodStart} to ${periodEnd}:`,
          "",
          `Regular Hours: ${hoursWorked.toFixed(1)}`,
          `Overtime Hours: ${overtimeHours.toFixed(1)}`,
          `Hourly Rate: ${fmtMoney(hourlyRate)}`,
          `Gross Pay: ${fmtMoney(grossPay)}`,
          "",
          "This is a test email sent as part of setting up automated payslip delivery.",
          "If anything here looks incorrect, please contact HR or Finance.",
        ].join("\n");
        await sendGmailMessage(accessToken, fromEmail, target.email, subject, body);
      }

      return json({ ok: true, sentTo: target.email, region });
    } catch (err) {
      console.error("[gmail] send-payslip error:", err);
      return json({ error: err instanceof Error ? err.message : "Send failed" }, 500);
    }
  }

  return json({ error: "Unknown request" }, 400);
}
