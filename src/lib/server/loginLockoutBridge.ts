/**
 * Login lockout — 5 failed attempts locks an account for 30 seconds.
 *
 * Why this runs server-side: the check has to happen BEFORE Firebase's own
 * credential check, at a point where the browser has no Supabase session yet
 * (login hasn't succeeded) — so it can't go through the normal RLS-scoped
 * client. Same "service-role key, no session required" shape as
 * supabaseTokenBridge.ts, just without the Firebase-token-verification step
 * (there's no token to verify yet at this point in the flow).
 *
 * Flow (see src/lib/auth.tsx's login()):
 *  1. Before attempting sign-in: POST { action: "check", email } — if
 *     locked, the caller shows "too many attempts, contact IT" and never
 *     even calls Firebase.
 *  2. On a Firebase sign-in failure: POST { action: "recordFailure", email }.
 *     Once failed_login_count reaches 5, every failure re-locks for another
 *     30s from that point (not just the first time it crosses 5) — an
 *     account that's already fragile stays fragile until it succeeds.
 *  3. On a Firebase sign-in success: POST { action: "recordSuccess", email }
 *     to reset the counter.
 *
 * Fails OPEN on any internal error (missing env, network blip, no matching
 * row) — a broken lockout check must never itself block every login
 * company-wide. This is the one thing in the login path that's allowed to
 * silently do nothing wrong rather than loudly do something wrong.
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

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_SECONDS = 30;

interface LockoutProfileRow {
  id: string;
  company_id: string;
  display_name: string | null;
  email: string;
  failed_login_count: number | null;
  locked_until: string | null;
}

export async function handleLoginLockoutRequest(
  request: Request,
  env?: Record<string, string | undefined>
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envBag = readEnv(env);
  if ("error" in envBag) {
    console.warn("[login-lockout] " + envBag.error + " — failing open");
    return json({ locked: false });
  }

  try {
    const { action, email: rawEmail } = (await request.json()) as { action?: string; email?: string };
    if (!action || !rawEmail) return json({ locked: false });
    const email = rawEmail.trim();

    // Case-insensitive exact match (ilike with no wildcards) — Firebase itself
    // treats email case-insensitively, so a lockout keyed on an exact-case
    // eq. match would silently no-op whenever what's typed differs in case
    // from what's stored in profiles.email.
    const lookupRes = await sbFetch(
      envBag,
      `profiles?email=ilike.${encodeURIComponent(email)}&select=id,company_id,display_name,email,failed_login_count,locked_until&limit=1`
    );
    if (!lookupRes.ok) return json({ locked: false });
    const rows: LockoutProfileRow[] = await lookupRes.json();
    const profile = rows[0];

    const now = Date.now();

    if (action === "check") {
      if (!profile?.locked_until) return json({ locked: false });
      const lockedUntilMs = new Date(profile.locked_until).getTime();
      if (lockedUntilMs > now) {
        return json({ locked: true, remainingSeconds: Math.ceil((lockedUntilMs - now) / 1000) });
      }
      return json({ locked: false });
    }

    if (action === "recordFailure") {
      // No matching profile (e.g. a mistyped email) — nothing to lock, and
      // responding identically either way avoids confirming whether an
      // email exists in the system.
      if (!profile) return json({ locked: false });

      const nextCount = (profile.failed_login_count ?? 0) + 1;
      const patch: Record<string, unknown> = { failed_login_count: nextCount };
      let locked = false;
      let remainingSeconds: number | undefined;

      if (nextCount >= LOCKOUT_THRESHOLD) {
        patch.locked_until = new Date(now + LOCKOUT_SECONDS * 1000).toISOString();
        locked = true;
        remainingSeconds = LOCKOUT_SECONDS;
      }

      await sbFetch(envBag, `profiles?id=eq.${profile.id}`, { method: "PATCH", body: JSON.stringify(patch) });

      // Append to history every time this crosses into (or re-enters) a
      // locked state — a "fragile" account that keeps failing builds up a
      // real timeline here, not just a single most-recent entry.
      if (locked) {
        await sbFetch(envBag, "login_lockout_events", {
          method: "POST",
          body: JSON.stringify({
            company_id: profile.company_id,
            profile_id: profile.id,
            employee_name: profile.display_name || profile.email,
            employee_email: profile.email,
            fail_count: nextCount,
          }),
        }).catch((err) => console.warn("[login-lockout] failed to record history event:", err));
      }

      return json({ locked, remainingSeconds, failCount: nextCount });
    }

    if (action === "recordSuccess") {
      if (profile) {
        await sbFetch(envBag, `profiles?id=eq.${profile.id}`, {
          method: "PATCH",
          body: JSON.stringify({ failed_login_count: 0, locked_until: null }),
        });
      }
      return json({ ok: true });
    }

    return json({ locked: false });
  } catch (error) {
    console.error("[login-lockout] error:", error);
    return json({ locked: false });
  }
}
