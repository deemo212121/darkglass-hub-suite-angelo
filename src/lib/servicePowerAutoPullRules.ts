/**
 * Rules for the ServicePower auto-pull (server/servicePowerAutoPull.ts),
 * kept pure so they can be tested.
 *
 * companies.settings.spAutoPull = { sources: ["GE", "SQUARE TRADE", …], from: "YYYY-MM-DD" }
 * (migration 0475). No sources = off.
 */

export interface SpAutoPullSettings {
  /** Work Order Sources as saved on tickets (GE, SQUARE TRADE, ELECTROLUX …), upper case. */
  sources: string[];
  /** Earliest call received date the auto-pull looks at (YYYY-MM-DD), or "" for no limit. */
  from: string;
}

/** Calls received in the last this-many days (today included) are looked at on every run. */
export const AUTO_PULL_LOOKBACK_DAYS = 7;

/** The sources most ServicePower calls come from, offered on the Data Migration page. */
export const AUTO_PULL_SOURCE_CHOICES = ["GE", "SQUARE TRADE", "ELECTROLUX", "ASSURANT SOLUTIONS", "CENTRICITY", "AIG WARRANTY"] as const;

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The auto-pull settings from companies.settings, or null when it's off. */
export function readSpAutoPullSettings(settings: unknown): SpAutoPullSettings | null {
  const raw = (settings as Record<string, any> | null | undefined)?.spAutoPull;
  if (!raw || typeof raw !== "object") return null;
  const sources = Array.isArray(raw.sources)
    ? [...new Set(raw.sources.map((s: unknown) => String(s ?? "").trim().toUpperCase()).filter(Boolean))] as string[]
    : [];
  if (sources.length === 0) return null;
  const from = typeof raw.from === "string" && isIso(raw.from) ? raw.from : "";
  return { sources, from };
}

/** Whether a call's Work Order Source (as convertCallToTicket saves it) is one the auto-pull takes. */
export function isAutoPullSource(ticketSource: string | null | undefined, sources: string[]): boolean {
  const s = String(ticketSource ?? "").trim().toUpperCase();
  return !!s && sources.includes(s);
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The call-received dates a run looks at: the last AUTO_PULL_LOOKBACK_DAYS
 * days through today, never before `from`. Returned as ServicePower's
 * 2-day windows (getCallInfo accepts at most two days per request).
 * Empty when `from` is after today.
 */
export function autoPullWindows(todayIso: string, from: string, lookbackDays = AUTO_PULL_LOOKBACK_DAYS): Array<{ from: string; to: string }> {
  let start = addDaysIso(todayIso, -(Math.max(1, lookbackDays) - 1));
  if (from && from > start) start = from;
  const windows: Array<{ from: string; to: string }> = [];
  for (let d = start; d <= todayIso; d = addDaysIso(d, 2)) {
    const end = addDaysIso(d, 1);
    windows.push({ from: d, to: end > todayIso ? todayIso : end });
  }
  return windows;
}

/** "YYYY-MM-DD" → ServicePower's "MM/DD/YYYY HH:mm:ss" (start or end of that day). */
export function spWindowDate(iso: string, endOfDay: boolean): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

/** Today's date in Central time (YYYY-MM-DD) — the company's day. */
export function centralTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
