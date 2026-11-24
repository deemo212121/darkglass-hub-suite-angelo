/**
 * Email Connection Status — does every Google account the app sends from
 * (or saves to) still work?
 *
 * Checks each saved Google connection by asking Google for a fresh access
 * token with its saved sign-in (the same first step every send does). It
 * sends no email and changes nothing. "expired" means Google refused the
 * sign-in (invalid_grant: expired, revoked, or the account's password
 * changed) and the account has to be connected again.
 *
 * Connections checked, per company:
 *   - hr_gmail_connections: Payroll (US / PH), Parts, IT Tickets slots 1–3
 *     (also used for Forgot Password codes), Attendance, HR Hiring, Flash Tech
 *   - hiring_gmail_accounts: the Hiring panel's own Gmail accounts
 *   - hr_google_drive_connections: HR's Google Drive
 *
 * Used by Password and Email Management → Email Connections (on demand) and
 * by the hourly cron once a day (runEmailConnectionAlert): every IT person
 * gets a bell for each expired connection, at most once a day each.
 *
 * Raw REST + service key, same as the other server jobs.
 */
import { readEnv, refreshAccessToken, type EnvBag } from "./gmailBridge";

export type ConnectionHealth = "ok" | "expired" | "error" | "not_connected";

export interface ConnectionStatusRow {
  /** slot = hr_gmail_connections (one per region); hiring = a Hiring panel account; drive = HR Google Drive. */
  kind: "slot" | "hiring" | "drive";
  /** The slot (US, IT_1 …) for kind "slot". */
  region?: string;
  /** Hiring panel account: its row id (to remove it) and the profile that owns it (to notify them). */
  id?: string;
  ownerId?: string | null;
  /** Where the app uses it, e.g. "IT Tickets — Slot 1". */
  label: string;
  /** What breaks when it's expired. */
  usedFor: string;
  email: string | null;
  /** The AHS person who connected it, and when (last connect). */
  connectedBy: string | null;
  connectedAt: string | null;
  status: ConnectionHealth;
  message?: string;
}

const REGION_INFO: Record<string, { label: string; usedFor: string }> = {
  US: { label: "US Payroll", usedFor: "US payslip emails" },
  PH: { label: "PH Payroll", usedFor: "PH payslip emails" },
  PARTS: { label: "Parts", usedFor: "Parts emails" },
  IT_1: { label: "IT Tickets — Slot 1", usedFor: "IT ticket emails and Forgot Password codes" },
  IT_2: { label: "IT Tickets — Slot 2", usedFor: "IT ticket emails and Forgot Password codes" },
  IT_3: { label: "IT Tickets — Slot 3", usedFor: "IT ticket emails and Forgot Password codes" },
  ATTENDANCE: { label: "Attendance", usedFor: "Attendance warning emails" },
  HR_HIRING: { label: "HR Hiring", usedFor: "Hiring emails" },
  FLASH_TECH: { label: "Flash Tech", usedFor: "Flash Tech emails" },
};

async function rest<T>(env: EnvBag, path: string): Promise<T> {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` },
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]} read failed (${res.status})`);
  return (await res.json()) as T;
}

async function health(env: EnvBag, refreshToken: string | null): Promise<{ status: ConnectionHealth; message?: string }> {
  if (!refreshToken) return { status: "expired", message: "No saved sign-in — connect it again." };
  try {
    await refreshAccessToken(env, refreshToken);
    return { status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid_grant")) return { status: "expired", message: "Google says this sign-in has expired or was revoked — connect it again." };
    return { status: "error", message: msg.slice(0, 300) };
  }
}

/** Every Google connection of one company, with whether it still works. */
export async function checkCompanyConnections(env: EnvBag, companyId: string): Promise<ConnectionStatusRow[]> {
  const cid = encodeURIComponent(companyId);
  const [slots, hiring, drive] = await Promise.all([
    rest<Array<{ region: string; connected_email: string | null; refresh_token: string | null; connected_by_name?: string | null; created_at?: string | null; updated_at?: string | null }>>(
      env, `hr_gmail_connections?select=*&company_id=eq.${cid}`,
    ),
    rest<Array<{ id: string; connected_by?: string | null; connected_email: string | null; refresh_token: string | null; connected_by_name?: string | null; created_at?: string | null; updated_at?: string | null }>>(
      env, `hiring_gmail_accounts?select=*&company_id=eq.${cid}`,
    ).catch(() => []),
    rest<Array<{ refresh_token: string | null; connected_email?: string | null; connected_by_name?: string | null; created_at?: string | null; updated_at?: string | null }>>(
      env, `hr_google_drive_connections?select=*&company_id=eq.${cid}&limit=1`,
    ).catch(() => []),
  ]);
  const order = Object.keys(REGION_INFO);
  const who = (r: { connected_by_name?: string | null; created_at?: string | null; updated_at?: string | null }) => ({
    connectedBy: r.connected_by_name ?? null,
    connectedAt: r.updated_at ?? r.created_at ?? null,
  });
  const items: Array<{ kind: ConnectionStatusRow["kind"]; region?: string; id?: string; ownerId?: string | null; label: string; usedFor: string; email: string | null; token: string | null; connectedBy: string | null; connectedAt: string | null }> = [
    ...slots
      .sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region))
      .map((s) => ({ kind: "slot" as const, region: s.region, ...(REGION_INFO[s.region] ?? { label: s.region, usedFor: "Emails" }), email: s.connected_email, token: s.refresh_token, ...who(s) })),
    ...hiring.map((h) => ({ kind: "hiring" as const, id: h.id, ownerId: h.connected_by ?? null, label: "Hiring panel", usedFor: "Hiring panel emails", email: h.connected_email, token: h.refresh_token, ...who(h) })),
    ...drive.map((d) => ({ kind: "drive" as const, label: "HR Google Drive", usedFor: "Saving HR files to Google Drive", email: d.connected_email ?? null, token: d.refresh_token, ...who(d) })),
  ];
  const checked: ConnectionStatusRow[] = await Promise.all(items.map(async (i) => ({ kind: i.kind, region: i.region, id: i.id, ownerId: i.ownerId, label: i.label, usedFor: i.usedFor, email: i.email, connectedBy: i.connectedBy, connectedAt: i.connectedAt, ...(await health(env, i.token)) })));
  // Slots nobody has connected yet (or that were disconnected) — listed so they can be connected from Email Connections.
  const have = new Set(slots.map((s) => s.region));
  const missing: ConnectionStatusRow[] = order
    .filter((r) => !have.has(r))
    .map((r) => ({ kind: "slot", region: r, ...REGION_INFO[r], email: null, connectedBy: null, connectedAt: null, status: "not_connected" }));
  return [...checked, ...missing];
}

/**
 * Once a day (hourly cron, at UTC_HOUR): every IT person (primary or extra
 * role, active) gets one bell per expired connection. Skips a bell they
 * already got in the last 20 hours, so a missed or repeated run never
 * doubles up.
 */
const UTC_HOUR = 14; // 8 AM Central (9 AM during daylight time)
export async function runEmailConnectionAlert(rawEnv: Record<string, string | undefined>, opts: { force?: boolean } = {}) {
  const summary = { companies: 0, expired: 0, notified: 0, skipped: false, errors: [] as string[] };
  if (!opts.force && new Date().getUTCHours() !== UTC_HOUR) {
    summary.skipped = true;
    return summary;
  }
  const envR = readEnv(rawEnv);
  if ("error" in envR) {
    summary.errors.push(envR.error);
    return summary;
  }
  const env = envR;
  const companies = await rest<Array<{ id: string }>>(env, "companies?select=id");
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  for (const c of companies) {
    try {
      const rows = await checkCompanyConnections(env, c.id);
      summary.companies++;
      const bad = rows.filter((r) => r.status === "expired");
      if (bad.length === 0) continue;
      summary.expired += bad.length;
      const itPeople = await rest<Array<{ id: string }>>(
        env, `profiles?select=id&company_id=eq.${c.id}&is_active=eq.true&or=(role.eq.IT,extra_roles.cs.{IT})`,
      );
      for (const r of bad) {
        const body = `📧 Email connection expired: ${r.label}${r.email ? ` (${r.email})` : ""}. ${r.usedFor} won't send until it's connected again.`;
        for (const p of itPeople) {
          const already = await rest<unknown[]>(
            env, `notifications?select=id&recipient_id=eq.${p.id}&body=eq.${encodeURIComponent(body)}&created_at=gte.${encodeURIComponent(since)}&limit=1`,
          ).catch(() => []);
          if (already.length > 0) continue;
          const res = await fetch(`${env.supabaseUrl}/rest/v1/notifications`, {
            method: "POST",
            headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              company_id: c.id,
              recipient_id: p.id,
              sender_id: null,
              sender_name: "Email Connections",
              body,
              link_to: "/m/admin/email-vault?view=connections",
            }),
          });
          if (res.ok) summary.notified++;
          else summary.errors.push(`notify ${p.id}: HTTP ${res.status}`);
        }
      }
    } catch (err) {
      summary.errors.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
