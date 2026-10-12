/**
 * Local calendar dates as "YYYY-MM-DD" — WITHOUT going through UTC.
 *
 * `date.toISOString().slice(0, 10)` converts to UTC first, so for a Date
 * built from local time (today, or "YYYY-MM-DDT00:00:00") it returns the
 * wrong day whenever the browser isn't on UTC: in the Philippines (UTC+8)
 * local midnight is the PREVIOUS day in UTC, so a "next day" button stays on
 * the same date and a date range starts a day early; in the US evening it's
 * already TOMORROW in UTC. Use these instead whenever the Date represents a
 * local calendar day.
 */

/** The local calendar date of `d` (defaults to now) as "YYYY-MM-DD". */
export function localISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" ± n calendar days (pure calendar math — no time zone or DST effects). */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every "YYYY-MM-DD" from start to end, inclusive (empty if start > end). */
export function enumerateISODates(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  for (let cur = startIso.slice(0, 10); cur <= endIso.slice(0, 10); cur = addDaysISO(cur, 1)) out.push(cur);
  return out;
}

// ---- "Today" in the signed-in person's assigned time zone ----------------
// Master List → profiles.schedule_timezone: CST (default — also every
// Philippines-based employee, per the company's "PH follows Central" policy)
// or EST. Set once at login (auth.tsx). `new Date().toISOString().slice(0,10)`
// is the UTC date instead — yesterday for PH staff before 8 AM, tomorrow for
// US staff after ~7 PM Central.
const SCHEDULE_ZONES: Record<string, string> = { CST: "America/Chicago", EST: "America/New_York" };
let userTimeZone = "America/Chicago";

/** Called at login with the person's Master List time zone ("CST" / "EST"; anything else → Central). */
export function setUserScheduleTimezone(tz: string | null | undefined): void {
  userTimeZone = SCHEDULE_ZONES[String(tz ?? "").trim().toUpperCase()] ?? "America/Chicago";
}

/** Today's date ("YYYY-MM-DD") in the signed-in person's assigned time zone. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: userTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
