/**
 * Automatic weekly password reset — every Monday at 00:00 America/Chicago,
 * flips must_change_password to true for every active profile, company by
 * company. Same flag/effect as AdminUserManagementPage.tsx's "Reset All
 * Passwords" bulk action (which calls setMustChangePassword — see
 * src/lib/supabase/users.ts) and the individual "Reset Password" action,
 * just run automatically instead of an admin clicking the button — the
 * user keeps logging in with their existing password, then __root.tsx's
 * MustChangePasswordGate sends them to /profile to set a new one before
 * they can reach any dashboard (see migration 0103).
 *
 * Dispatched from the EXISTING hourly cron (see src/server.ts's
 * scheduled(), event.cron === "0 * * * *") rather than a separate cron
 * trigger in wrangler.jsonc — an hourly UTC tick always lands on an exact
 * Chicago-local hour boundary too (both UTC and America/Chicago are
 * whole-hour offsets from each other year-round), so checking "is it hour
 * 0 on a Monday in Chicago right now" self-adjusts across DST without
 * needing two separate cron expressions for CST vs CDT.
 */

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
}

function readEnv(env: Record<string, string | undefined>): EnvBag | { error: string } {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseServiceKey = env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl) return { error: "Missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Missing SUPABASE_SERVICE_KEY" };
  return { supabaseUrl, supabaseServiceKey };
}

/** True exactly once per week — the hour-0 Monday tick in America/Chicago (DST-safe, see header comment). */
export function isWeeklyPasswordResetTick(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  // Some ICU builds render midnight as "24" instead of "00" with hour12:false.
  return weekday === "Mon" && (hour === "00" || hour === "24");
}

export async function runWeeklyPasswordReset(
  env: Record<string, string | undefined>
): Promise<{ ok: boolean; updated?: number; error?: string }> {
  const envResult = readEnv(env);
  if ("error" in envResult) return { ok: false, error: envResult.error };

  const res = await fetch(`${envResult.supabaseUrl}/rest/v1/profiles?is_active=eq.true`, {
    method: "PATCH",
    headers: {
      apikey: envResult.supabaseServiceKey,
      Authorization: `Bearer ${envResult.supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ must_change_password: true }),
  });
  if (!res.ok) return { ok: false, error: `profiles update failed (${res.status}): ${await res.text()}` };
  const rows = (await res.json()) as unknown[];
  return { ok: true, updated: rows.length };
}
