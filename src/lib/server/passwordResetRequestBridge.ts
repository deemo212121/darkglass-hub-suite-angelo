/**
 * "Forgot password?" — submitted from the login screen, BEFORE the person is
 * authenticated, so everything here runs with the service-role key (same
 * shape as loginLockoutBridge.ts).
 *
 * Self-service reset, in two steps from the form:
 *   - "lookup": as the username is typed, say whether it exists and show
 *     where the password will go — the email on file, MASKED (public page).
 *   - reset: for an existing, active username, the server:
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
    const { action, username } = (await request.json()) as { action?: string; username?: string };
    const u = username?.trim() ?? "";
    if (!u) return json({ error: "Enter your username." }, 400);

    const lookupRes = await sbFetch(
      envBag,
      `profiles?username=ilike.${encodeURIComponent(u)}&select=id,company_id,firebase_uid,email,display_name,username,is_active&limit=1`
    );
    const profile: Profile | undefined = lookupRes.ok ? ((await lookupRes.json()) as Profile[])[0] : undefined;
    const usable = !!profile && !!profile.firebase_uid && profile.is_active !== false;
    const onFile = (profile?.email ?? "").trim().toLowerCase();

    // Step 1 — the form checks the username as it's typed: does it exist, and
    // where will the password go (masked — this page is public).
    if (action === "lookup") {
      if (!usable) return json({ exists: false });
      return json({ exists: true, maskedEmail: EMAIL_RE.test(onFile) ? maskEmail(onFile) : null });
    }

    // Step 2 — reset. Always sent to the email on file, never a typed one.
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

    // Find the IT email BEFORE resetting — never reset someone we can't email.
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
