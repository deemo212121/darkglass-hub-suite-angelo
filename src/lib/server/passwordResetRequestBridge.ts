/**
 * "Forgot password?" — submitted from the login screen, BEFORE the person is
 * authenticated, so everything here runs with the service-role key (same
 * shape as loginLockoutBridge.ts).
 *
 * Self-service reset, in three steps from the form (username + Unique ID
 * pick the account, the same way sign-in does):
 *   - "lookup": as the username is typed, say whether it exists and show
 *     where the password will go — the email on file, MASKED (public page).
 *   - "send-code": email a 6-digit code to the email on file (valid 10
 *     minutes, one use, 5 tries — table password_reset_codes, migration 0363).
 *     Nothing is reset yet, so someone who only knows a username can't
 *     lock its owner out.
 *   - reset (with the code): once the code checks out, the server:
 *   1. resets their Firebase password to the default (the DEFAULT_RESET_PASSWORD secret, the
 *      same one Admin/HR's reset and new accounts use — adminPasswordBridge),
 *   2. turns on must_change_password, so that default works for one login
 *      before they must choose their own (__root.tsx's redirect gate),
 *   3. emails the new password to the account's email ON FILE (never a
 *      typed address), from the IT Gmail account connected on the IT
 *      Tickets page (PREFERRED_IT_SENDER's slot first), with IT's template,
 *   4. logs it as a resolved IT ticket and notifies IT / Admin.
 *
 * At most 3 automatic resets per account per hour. No email on file, or no
 * IT email connected: nothing is reset — an IT ticket is opened instead. If no IT email is connected (or
 * the server isn't configured for it), nothing is reset — it falls back to
 * the old behaviour: an IT ticket for IT to handle by hand.
 */
import { readAdminPasswordEnv, getIdentityToolkitAccessToken, setUserPassword } from "./adminPasswordBridge";
import { readEnv as readGmailEnv, fetchGmailConnection, refreshAccessToken, sendGmailMessage, type Region } from "./gmailBridge";

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined =>
    env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl =
    (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey =
    (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ??
    getEnv("SUPABASE_SERVICE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) return { error: "missing supabase env" };
  return { supabaseUrl, supabaseServiceKey };
}

async function sbFetch(env: EnvBag, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.supabaseServiceKey,
      Authorization: `Bearer ${env.supabaseServiceKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const IT_TICKET_NOTIFY_ROLE_CODES = new Set(["IT", "ADMIN", "SUPERADMIN"]);
const IT_SLOTS: Region[] = ["IT_1", "IT_2", "IT_3"];
/** The IT mailbox reset emails come from — whichever IT slot is connected as this address. Falls back to another connected IT slot if it isn't. */
const PREFERRED_IT_SENDER = "angelo.mendoza@usinhomeservices.com";
const AUTO_SUBJECT = "Password Reset (automatic)";
const MAX_RESETS_PER_HOUR = 3;
const MAX_CODES_PER_HOUR = 3;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

/** A random 6-digit code ("004219" style — leading zeros kept). */
function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/** Only the hash is stored — salted with the profile id so the same code on two accounts never hashes the same. */
async function hashCode(profileId: string, code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${profileId}:${code}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function codeEmailBody(name: string, code: string): string {
  return [
    `Hi ${name},`,
    ``,
    `Someone asked to reset your AHS password. Your confirmation code is:`,
    ``,
    `    ${code}`,
    ``,
    `Type this code on the Forgot Password screen to reset your password. It expires in 10 minutes and works once.`,
    ``,
    `If you didn't ask for this, ignore this email — your password hasn't changed. Please contact us directly on Discord or reply to this Email if you have any concerns.`,
    ``,
    `Thank you,`,
    ``,
    `IT Team`,
  ].join("\n");
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "jane.doe@gmail.com" → "j***@gmail.com" — this page is public, so never show the full address. */
function maskEmail(email: string): string {
  // "angelo.mendoza@usinhomeservices.com" → "ange..........@......homeservices.com":
  // enough to recognise your own address, not enough to read someone else's.
  const [user, domain = ""] = email.split("@");
  const keepUser = Math.min(4, Math.ceil(user.length / 2));
  const dot = domain.lastIndexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const hideName = Math.ceil(name.length * 0.4);
  return `${user.slice(0, keepUser)}${".".repeat(user.length - keepUser)}@${".".repeat(hideName)}${name.slice(hideName)}${tld}`;
}



interface Profile {
  id: string;
  company_id: string;
  firebase_uid: string | null;
  email: string | null;
  display_name: string | null;
  username: string | null;
  is_active: boolean | null;
}

function emailBody(name: string, password: string): string {
  return [
    `Hi ${name},`,
    ``,
    `Your password has been reset to default: "${password}"`,
    ``,
    `You'll be asked to choose a new password right after you log in.`,
    ``,
    `Please contact us directly on Discord or reply to this Email if you have any concerns.`,
    ``,
    `Thank you,`,
    ``,
    `IT Team`,
  ].join("\n");
}

async function notifyIt(env: EnvBag, companyId: string, senderName: string, body: string): Promise<void> {
  try {
    const res = await sbFetch(env, `profiles?company_id=eq.${companyId}&is_active=eq.true&select=id,role,extra_roles`);
    if (!res.ok) return;
    const rows: { id: string; role: string; extra_roles: string[] | null }[] = await res.json();
    const ids = rows
      .filter((r) => [r.role, ...(r.extra_roles ?? [])].some((v) => IT_TICKET_NOTIFY_ROLE_CODES.has(String(v ?? "").trim().toUpperCase())))
      .map((r) => r.id);
    await Promise.all(
      ids.map((id) =>
        sbFetch(env, "notifications", {
          method: "POST",
          body: JSON.stringify({ company_id: companyId, recipient_id: id, sender_id: null, sender_name: senderName, body, link_to: "/m/admin/it-tickets" }),
        }).catch((err) => console.warn("[password-reset-request] notify failed for", id, err))
      )
    );
  } catch (err) {
    console.warn("[password-reset-request] notify step failed:", err);
  }
}

async function logTicket(env: EnvBag, p: Profile, name: string, subject: string, description: string, resolved: boolean): Promise<void> {
  const res = await sbFetch(env, "it_tickets", {
    method: "POST",
    body: JSON.stringify({
      company_id: p.company_id,
      created_by: p.id,
      created_by_name: name,
      subject,
      description,
      priority: resolved ? "normal" : "high",
      status: resolved ? "resolved" : "open",
      resolution_notes: resolved ? "Reset automatically from the login screen; default password emailed to the address on file." : null,
    }),
  });
  if (!res.ok) console.error("[password-reset-request] ticket insert failed:", await res.text().catch(() => ""));
}

export async function handlePasswordResetRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envBag = readEnv(env);
  if ("error" in envBag) {
    console.warn("[password-reset-request] " + envBag.error);
    return json({ error: "Server not configured" }, 500);
  }

  try {
    const { action, username, companyCode, code: typedCode } = (await request.json()) as {
      action?: string;
      username?: string;
      companyCode?: string;
      code?: string;
    };
    const u = username?.trim() ?? "";
    const code = companyCode?.trim().toLowerCase() ?? "";
    if (!u) return json({ error: "Enter your username." }, 400);
    if (!code) return json({ error: "Enter your Unique ID." }, 400);

    // The same username can exist in more than one company, so — like the
    // sign-in form (login_email_for_username) — the Unique ID picks the
    // company: its login alias when one is set, otherwise its legacy code.
    const companiesRes = await sbFetch(envBag, `companies?select=id,login_alias,legacy_code`);
    const companies = companiesRes.ok ? ((await companiesRes.json()) as { id: string; login_alias: string | null; legacy_code: string | null }[]) : [];
    const company = companies.find((c) => ((c.login_alias ?? c.legacy_code) ?? "").trim().toLowerCase() === code);
    if (!company) {
      if (action === "lookup") return json({ exists: false, badCompany: true });
      return json({ error: "Unique ID is incorrect." }, 404);
    }

    const lookupRes = await sbFetch(
      envBag,
      `profiles?company_id=eq.${company.id}&username=ilike.${encodeURIComponent(u)}&select=id,company_id,firebase_uid,email,display_name,username,is_active`
    );
    const candidates: Profile[] = lookupRes.ok ? ((await lookupRes.json()) as Profile[]) : [];
    // ilike treats "_" as a wildcard — keep only the exact (case-insensitive) match, active first.
    const exact = candidates.filter((p) => (p.username ?? "").trim().toLowerCase() === u.toLowerCase());
    const profile: Profile | undefined = exact.find((p) => p.is_active !== false) ?? exact[0];
    const usable = !!profile && !!profile.firebase_uid && profile.is_active !== false;
    const onFile = (profile?.email ?? "").trim().toLowerCase();

    // Step 1 — the form checks the username as it's typed: does it exist, and
    // where will the password go (masked — this page is public).
    if (action === "lookup") {
      if (!usable) return json({ exists: false });
      return json({ exists: true, maskedEmail: EMAIL_RE.test(onFile) ? maskEmail(onFile) : null });
    }

    // Steps 2–3 — the code and the new password always go to the email on file, never a typed one.
    if (!usable || !profile) return json({ error: "Username doesn't exist." }, 404);
    const name = profile.display_name || profile.username || u;
    if (!EMAIL_RE.test(onFile)) {
      await logTicket(
        envBag,
        profile,
        name,
        "Password Reset Request",
        [`${name} is requesting a password reset.`, `Username: ${profile.username || u}`, `Not reset automatically: there's no email on this account.`].join("\n"),
        false
      );
      await notifyIt(envBag, profile.company_id, name, `🔑 Password reset request from ${name} (${profile.username || u}) — no email on file, needs IT`);
      return json({ error: "There's no email on your account, so IT has been notified — they'll help you reset it. You can also reach them on Discord." }, 409);
    }
    const e = onFile;

    // Find the IT email first — never send a code or reset without a way to email them.
    const gmailEnv = readGmailEnv(env);
    const pwEnv = readAdminPasswordEnv(env);
    let sender: { accessToken: string; fromEmail: string } | null = null;
    if (!("error" in gmailEnv) && !("error" in pwEnv)) {
      // The preferred sender's slot first, then any other connected IT slot.
      const conns = (
        await Promise.all(IT_SLOTS.map(async (slot) => ({ slot, conn: await fetchGmailConnection(gmailEnv, profile.company_id, slot).catch(() => null) })))
      )
        .filter((x): x is { slot: Region; conn: NonNullable<typeof x.conn> } => !!x.conn)
        .sort((a, b) => Number((b.conn.connectedEmail ?? "").toLowerCase() === PREFERRED_IT_SENDER) - Number((a.conn.connectedEmail ?? "").toLowerCase() === PREFERRED_IT_SENDER));
      for (const { slot, conn } of conns) {
        try {
          const accessToken = await refreshAccessToken(gmailEnv, conn.refreshToken);
          sender = { accessToken, fromEmail: conn.connectedEmail || "me" };
          break;
        } catch (err) {
          console.warn(`[password-reset-request] ${slot} Gmail token failed:`, err);
        }
      }
    }

    if (!sender || "error" in pwEnv) {
      // Fallback: no IT email to send from — leave it to IT, like before.
      await logTicket(
        envBag,
        profile,
        name,
        "Password Reset Request",
        [`${name} is requesting a password reset.`, `Username: ${profile.username || u}`, `Email on file: ${e}`, `Not reset automatically: no IT Gmail account is connected on the IT Tickets page.`].join("\n"),
        false
      );
      await notifyIt(envBag, profile.company_id, name, `🔑 Password reset request from ${name} (${profile.username || u}) — needs IT (no IT email connected)`);
      return json({ ok: true, queued: true, message: "IT has been notified and will reset your password for you. You can also reach them on Discord." });
    }

    // Step 2 — email a confirmation code. Nothing is reset yet.
    if (action === "send-code") {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const sentRes = await sbFetch(envBag, `password_reset_codes?profile_id=eq.${profile.id}&created_at=gte.${encodeURIComponent(since)}&select=id`);
      if (!sentRes.ok) {
        console.error("[password-reset-request] code table read failed:", await sentRes.text().catch(() => ""));
        return json({ error: "Password reset isn't set up yet — contact IT on Discord." }, 500);
      }
      if (((await sentRes.json()) as unknown[]).length >= MAX_CODES_PER_HOUR) {
        return json({ error: "Too many codes were sent in the last hour. Use the latest code in your email, or try again later." }, 429);
      }
      const code = newCode();
      // Only the newest code works — retire any earlier unused ones.
      await sbFetch(envBag, `password_reset_codes?profile_id=eq.${profile.id}&used_at=is.null`, {
        method: "PATCH",
        body: JSON.stringify({ used_at: new Date().toISOString() }),
      });
      const ins = await sbFetch(envBag, "password_reset_codes", {
        method: "POST",
        body: JSON.stringify({ profile_id: profile.id, code_hash: await hashCode(profile.id, code), expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() }),
      });
      if (!ins.ok) {
        console.error("[password-reset-request] code insert failed:", await ins.text().catch(() => ""));
        return json({ error: "Couldn't create a code right now — try again, or contact IT on Discord." }, 500);
      }
      try {
        await sendGmailMessage(sender.accessToken, sender.fromEmail, e, "Password Reset Code AHS", codeEmailBody(name, code));
      } catch (err) {
        console.error("[password-reset-request] code email failed:", err);
        return json({ error: "Couldn't send the code email — try again, or contact IT on Discord." }, 502);
      }
      return json({ ok: true, codeSent: true, sentTo: maskEmail(e) });
    }

    // Step 3 — reset, only with the newest code, unexpired, unused, under 5 tries.
    const typed = (typedCode ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(typed)) return json({ error: "Enter the 6-digit code from your email." }, 400);
    const codeRes = await sbFetch(
      envBag,
      `password_reset_codes?profile_id=eq.${profile.id}&used_at=is.null&select=id,code_hash,expires_at,attempts&order=created_at.desc&limit=1`
    );
    const row = codeRes.ok ? ((await codeRes.json()) as { id: string; code_hash: string; expires_at: string; attempts: number }[])[0] : undefined;
    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) {
      return json({ error: "That code has expired or was used up. Send a new code.", codeExpired: true }, 400);
    }
    if ((await hashCode(profile.id, typed)) !== row.code_hash) {
      const attempts = row.attempts + 1;
      await sbFetch(envBag, `password_reset_codes?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ attempts }) });
      const left = MAX_CODE_ATTEMPTS - attempts;
      return left > 0
        ? json({ error: `That code is incorrect. ${left} ${left === 1 ? "try" : "tries"} left.` }, 400)
        : json({ error: "That code is incorrect, and it no longer works. Send a new code.", codeExpired: true }, 400);
    }
    await sbFetch(envBag, `password_reset_codes?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ used_at: new Date().toISOString() }) });

    // At most MAX_RESETS_PER_HOUR automatic resets per account per hour.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentRes = await sbFetch(
      envBag,
      `it_tickets?created_by=eq.${profile.id}&subject=eq.${encodeURIComponent(AUTO_SUBJECT)}&created_at=gte.${encodeURIComponent(since)}&select=id`
    );
    const recent = recentRes.ok ? ((await recentRes.json()) as unknown[]).length : 0;
    if (recent >= MAX_RESETS_PER_HOUR) {
      return json({ error: "This password was already reset several times in the last hour. Check your email, or contact IT on Discord." }, 429);
    }

    // 1. Reset to the default. 2. Must change it on next login.
    const idtToken = await getIdentityToolkitAccessToken(pwEnv.serviceAccountEmail, pwEnv.privateKey);
    await setUserPassword(idtToken, profile.firebase_uid!, pwEnv.defaultPassword); // `usable` above guarantees it
    await sbFetch(envBag, `profiles?id=eq.${profile.id}`, { method: "PATCH", body: JSON.stringify({ must_change_password: true }) });

    // 3. Email it to the address on file.
    let emailed = true;
    try {
      await sendGmailMessage(sender.accessToken, sender.fromEmail, e, "Password Reset AHS", emailBody(name, pwEnv.defaultPassword));
    } catch (err) {
      emailed = false;
      console.error("[password-reset-request] email failed:", err);
    }

    // 4. Log it for IT.
    await logTicket(
      envBag,
      profile,
      name,
      AUTO_SUBJECT,
      [
        `${name} reset their password from the login screen.`,
        `Username: ${profile.username || u}`,
        `Sent to (email on file): ${e}`,
        emailed ? `Default password emailed from ${sender.fromEmail}.` : `Password WAS reset, but the email from ${sender.fromEmail} failed — contact them directly.`,
      ].join("\n"),
      emailed
    );
    await notifyIt(
      envBag,
      profile.company_id,
      name,
      emailed ? `🔑 ${name} reset their password (sent to ${e})` : `⚠️ ${name}'s password was reset but the email failed — contact them`
    );

    if (!emailed) {
      return json({ error: "Your password was reset, but the email couldn't be sent. IT has been notified — contact them on Discord." }, 502);
    }
    return json({ ok: true, sentTo: maskEmail(e) });
  } catch (error) {
    console.error("[password-reset-request] error:", error);
    return json({ error: "Something went wrong — try again, or contact IT directly." }, 500);
  }
}
