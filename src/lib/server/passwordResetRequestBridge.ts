/**
 * "Forgot password?" requests — submitted from the login screen, BEFORE
 * the person is authenticated (that's the whole point — they can't log
 * in), so there's no Supabase session to write with. Same "service-role
 * key, no session required" shape as loginLockoutBridge.ts.
 *
 * There's no self-service email reset in this app — passwords are reset
 * manually by IT/Admin (AdminUserManagementPage.tsx). Rather than a
 * separate request queue, this just creates a normal IT ticket (same
 * it_tickets table/page every other ticket uses) attributed to the
 * person whose username was submitted, and notifies IT/Admin — so
 * there's exactly one place staff check for open requests, not two.
 *
 * it_tickets.company_id/created_by are NOT NULL, so unlike
 * loginLockoutBridge this can't fail open on a bad lookup — a username
 * that doesn't match any profile has nothing to attribute the ticket to,
 * so the request is rejected with a clear message instead of silently
 * doing nothing.
 */

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

export async function handlePasswordResetRequest(
  request: Request,
  env?: Record<string, string | undefined>
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envBag = readEnv(env);
  if ("error" in envBag) {
    console.warn("[password-reset-request] " + envBag.error);
    return json({ error: "Server not configured" }, 500);
  }

  try {
    const { fullName, username, email } = (await request.json()) as {
      fullName?: string;
      username?: string;
      email?: string;
    };
    if (!fullName?.trim() || !username?.trim()) {
      return json({ error: "Name and username are required." }, 400);
    }

    const lookupRes = await sbFetch(
      envBag,
      `profiles?username=ilike.${encodeURIComponent(username.trim())}&select=id,company_id&limit=1`
    );
    const rows: { id: string; company_id: string }[] = lookupRes.ok ? await lookupRes.json() : [];
    const profile = rows[0];
    if (!profile) {
      return json({ error: `We couldn't find an account with the username "${username.trim()}". Please double-check it and try again, or contact IT directly.` }, 404);
    }

    const description = [
      `${fullName.trim()} is requesting a password reset.`,
      `Username: ${username.trim()}`,
      email?.trim() ? `Contact email: ${email.trim()}` : null,
      `Submitted from the login screen (not authenticated).`,
    ]
      .filter(Boolean)
      .join("\n");

    const ticketRes = await sbFetch(envBag, "it_tickets", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        company_id: profile.company_id,
        created_by: profile.id,
        created_by_name: fullName.trim(),
        subject: "Password Reset Request",
        description,
        priority: "high",
      }),
    });
    if (!ticketRes.ok) {
      const body = await ticketRes.text().catch(() => "");
      console.error("[password-reset-request] ticket insert failed:", body);
      return json({ error: "Failed to submit request." }, 500);
    }

    // Best-effort notify — a failure here shouldn't fail the whole request,
    // the ticket itself already exists and is visible on the IT Tickets page.
    try {
      const recipientsRes = await sbFetch(
        envBag,
        `profiles?company_id=eq.${profile.company_id}&is_active=eq.true&select=id,role,extra_roles`
      );
      if (recipientsRes.ok) {
        const recipients: { id: string; role: string; extra_roles: string[] | null }[] = await recipientsRes.json();
        const recipientIds = recipients
          .filter((r) => {
            const roles = [r.role, ...(r.extra_roles ?? [])].map((v) => String(v ?? "").trim().toUpperCase());
            return roles.some((v) => IT_TICKET_NOTIFY_ROLE_CODES.has(v));
          })
          .map((r) => r.id);
        await Promise.all(
          recipientIds.map((id) =>
            sbFetch(envBag, "notifications", {
              method: "POST",
              body: JSON.stringify({
                company_id: profile.company_id,
                recipient_id: id,
                sender_id: null,
                sender_name: fullName.trim(),
                body: `🔑 Password reset request from ${fullName.trim()} (${username.trim()})`,
                link_to: "/m/admin/it-tickets",
              }),
            }).catch((err) => console.warn("[password-reset-request] notify failed for", id, err))
          )
        );
      }
    } catch (err) {
      console.warn("[password-reset-request] notify step failed:", err);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("[password-reset-request] error:", error);
    return json({ error: "Failed to submit request." }, 500);
  }
}
