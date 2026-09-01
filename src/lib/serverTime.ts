/**
 * Server-verified "now" for anything that stamps a time punch (Time In/Out,
 * Meal In/Out) — never trust the browser's own clock for these, since an
 * employee can freely set their computer's date/time and back- or
 * forward-date a punch that way. getServerNow() fetches the real instant
 * from /api/server-time (Cloudflare's own system clock, immune to the
 * client's OS clock — see src/lib/server/serverTime.ts), and the zoned*
 * helpers below convert that instant into the employee's own scheduled
 * timezone (profiles.schedule_timezone — the SAME field AppHeader's clock
 * and the Master List's Hours of Work dropdown read/write) to get the
 * correct local wall-clock time and calendar date to save the punch under.
 */
export type ScheduleTimezone = "CST" | "EST";

export const TIME_ZONES: Record<ScheduleTimezone, { label: string; timeZone: string }> = {
  CST: { label: "Central Time", timeZone: "America/Chicago" },
  EST: { label: "Eastern Time", timeZone: "America/New_York" },
};

/**
 * Fetches the real current instant from the server. Throws on failure —
 * callers should surface this as a retry-able error (e.g. an alert) rather
 * than silently falling back to the client's own clock, which would defeat
 * the whole point.
 */
export async function getServerNow(): Promise<Date> {
  const res = await fetch("/api/server-time", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not reach the server clock. Please try again.");
  const { nowIso } = (await res.json()) as { nowIso: string };
  const date = new Date(nowIso);
  if (isNaN(date.getTime())) throw new Error("Server returned an invalid time. Please try again.");
  return date;
}

/** Wall-clock HH:MM:SS (24h) for `date` as seen in `tz`. */
export function zonedTimeString(date: Date, tz: ScheduleTimezone): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONES[tz].timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Intl can render midnight as "24" with hour12:false — normalize to "00".
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${hh}:${get("minute")}:${get("second")}`;
}

/** Calendar date (YYYY-MM-DD) for `date` as seen in `tz`. */
export function zonedDateKey(date: Date, tz: ScheduleTimezone): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONES[tz].timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Inverse of zonedTimeString/zonedDateKey: given a civil wall-clock
 * date+time meant to be read IN `tz` (e.g. a technician typing "10:00 AM"
 * into a plain <input type="time">, meaning 10:00 AM in their own scheduled
 * timezone, not whatever timezone their device happens to be set to),
 * returns the real UTC instant it represents, as an ISO string.
 *
 * Standard "double conversion" trick since the Intl API only formats a
 * known Date into a zone, not the reverse: treat the input as if it were
 * already UTC, see what that instant reads as back in `tz`, and correct by
 * the difference (which also correctly accounts for DST on that date).
 */
export function zonedWallClockToUtcIso(year: number, month: number, day: number, hour: number, minute: number, tz: ScheduleTimezone): string {
  const asUtcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONES[tz].timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(asUtcGuess));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const tzHour = get("hour") === "24" ? 0 : Number(get("hour"));
  const asIfUtc = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")), tzHour, Number(get("minute")), 0);
  return new Date(asUtcGuess + (asUtcGuess - asIfUtc)).toISOString();
}
