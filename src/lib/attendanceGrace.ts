/**
 * Shared grace-period/timezone logic for Attendance Monitoring. Kept
 * dependency-free (no Supabase client import) so both the client page
 * (AttendanceMonitoringPage.tsx) and the server Cron Trigger job
 * (src/lib/server/attendanceAlerts.ts) can use the exact same math without
 * the server bundle pulling in browser-only code.
 *
 * Timezone policy (corrected 2026-07-27): the Philippines branch follows
 * Central Time by policy (not its own local Asia/Manila time) since it
 * operates on US business hours, but every US branch follows its own real
 * local timezone for clock in/out — a technician in Asheville (Eastern) and
 * one in Birmingham (Central) are judged against their own wall clock, not
 * a single shared reference. DEFAULT_ATTENDANCE_TIMEZONE (Central) is also
 * used for calendar-day boundaries (which date is "today") throughout the
 * feature — branch-to-branch date-rollover skew is at most the 1-hour
 * Eastern/Central gap, not worth threading a separate per-branch date axis
 * through every date-keyed query for.
 */

export const DEFAULT_ATTENDANCE_TIMEZONE = "America/Chicago";
export const ATTENDANCE_GRACE_MINUTES = 5;

/**
 * Branch (profiles.assigned_branch) -> IANA timezone. Derived from each real
 * city's actual US timezone; Philippines is intentionally mapped to Central
 * per policy, not its native Asia/Manila zone. A couple of entries are best
 * guesses where the branch name alone is ambiguous (e.g. "Columbus" exists
 * in both Eastern and Central states) — flagged for review, not silently
 * assumed correct forever.
 */
export const BRANCH_TIMEZONES: Record<string, string> = {
  Philippines: "America/Chicago", // policy: follows Central, not local PH time
  "New Orleans": "America/Chicago",
  Norfolk: "America/New_York",
  Jonesboro: "America/Chicago",
  Asheville: "America/New_York",
  "Jackson, TN": "America/Chicago",
  Atlanta: "America/New_York",
  Wilmington: "America/New_York",
  "St. Louis": "America/Chicago",
  "Little Rock": "America/Chicago",
  Knoxville: "America/New_York",
  Columbus: "America/New_York", // ambiguous (GA/OH are Eastern, MS is Central) — confirm which Columbus this is
  Nashville: "America/Chicago",
  Jacksonville: "America/New_York",
  "Jackson, MS": "America/Chicago",
  Chattanooga: "America/New_York",
  "Lake Charles": "America/Chicago",
  Memphis: "America/Chicago",
  Birmingham: "America/Chicago",
  Raleigh: "America/New_York",
  Mobile: "America/Chicago",
  "Cape Girardeau": "America/Chicago",
  Huntsville: "America/Chicago",
  Savannah: "America/New_York",
  "San Antonio": "America/Chicago",
  Destin: "America/Chicago", // FL panhandle west of the Apalachicola line — Central, unlike most of Florida
  Tallahassee: "America/New_York",
  Montgomery: "America/Chicago",
  Richmond: "America/New_York",
};

/** Resolves a branch name to its clock-in/out timezone, falling back to DEFAULT_ATTENDANCE_TIMEZONE for unmapped or blank branches. */
export function timezoneForBranch(branch: string | null | undefined): string {
  const key = (branch || "").trim();
  return BRANCH_TIMEZONES[key] || DEFAULT_ATTENDANCE_TIMEZONE;
}

/** "08:00" + 5 -> "08:05". Wraps around midnight (23:58 + 5 -> "00:03"). */
export function addMinutesToHHMM(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * Real clock punches (TimeClockMenu.tsx/routes/timecard.tsx) save "HH:MM:SS"
 * — schedules (profiles.required_check_in/out) are always "HH:MM". Comparing
 * those two as raw strings is unsound (e.g. "08:00:00" > "08:00" — the
 * seconds-bearing string always sorts "greater" even at the exact same
 * instant), so every comparison below goes through seconds-since-midnight
 * instead. A bare "HH:MM" is treated as "HH:MM:00".
 */
export function toSeconds(hms: string): number {
  const [h, m, s = 0] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

function fromSeconds(totalSeconds: number): string {
  const wrapped = ((totalSeconds % 86400) + 86400) % 86400;
  const h = Math.floor(wrapped / 3600);
  const m = Math.floor((wrapped % 3600) / 60);
  const s = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Clock-precision rounding tolerance — a punch within this many seconds of
 * the scheduled time (either side, for check-out) is treated as exactly on
 * schedule, before any minutes-based grace policy even starts being
 * consumed. E.g. required 08:00: 08:00:01-08:00:59 is on time; lateness
 * (and the PH/US-office grace window) only starts accruing from 08:01:01.
 */
export const ON_TIME_BUFFER_SECONDS = 60;

/**
 * Pay-affecting grace period (distinct from the flat ATTENDANCE_GRACE_MINUTES
 * alert softener above — this is the actual per-region policy Finance uses to
 * decide how much lateness gets forgiven in paid hours). PH: 5 min. US office
 * (any non-technician role): 15 min. Technicians: 0 — they're paid per
 * completed repair ticket (Tech Payroll), not hourly, so grace doesn't apply.
 * Callers pass `isTechnician` (normalizeRole(role) === "TECHNICIAN") rather
 * than a raw role string, so this file never needs to import role logic.
 */
export function payGraceMinutesFor(country: string | null | undefined, isTechnician: boolean): number {
  if (isTechnician) return 0;
  return country === "PH" ? 5 : 15;
}

/**
 * The check-in time to use for PAY purposes, given a grace window.
 * - On time or early (actual <= scheduled): unchanged/literal — pays any
 *   early arrival as worked, untouched by this feature.
 * - Late by up to ON_TIME_BUFFER_SECONDS: treated as exactly on schedule
 *   (clock-precision rounding, not part of the grace budget).
 * - Late beyond the buffer but within the grace window: also treated as
 *   exactly on schedule (fully forgiven).
 * - Late beyond the grace window: only the excess past the window is
 *   docked — e.g. required 08:00, grace 5 min, checkIn 08:06:00 -> "08:01:00"
 *   (only the 1 minute past the 5-minute grace window is unpaid).
 * Never applies to clock-out — see roundCheckOutToSchedule for the (much
 * narrower) rounding-only tolerance that applies there instead.
 */
export function applyGraceToCheckIn(checkIn: string, requiredCheckIn: string, graceMinutes: number): string {
  if (!checkIn || !requiredCheckIn) return checkIn;
  const actualSec = toSeconds(checkIn);
  const requiredSec = toSeconds(requiredCheckIn);
  if (actualSec <= requiredSec) return checkIn;
  const lateSeconds = actualSec - requiredSec;
  if (lateSeconds <= ON_TIME_BUFFER_SECONDS) return requiredCheckIn;
  if (graceMinutes <= 0) return checkIn;
  const dockedSeconds = Math.max(0, lateSeconds - graceMinutes * 60);
  return fromSeconds(requiredSec + dockedSeconds);
}

/**
 * Clock-out never gets the minutes-based grace period (leaving early or
 * working late is always paid/docked at the literal actual time) — but a
 * punch within ON_TIME_BUFFER_SECONDS of the scheduled end, on EITHER side,
 * is still just clock-precision noise and rounds to exactly on schedule:
 * neither docked for a few seconds early nor paid overtime for a few
 * seconds late. Beyond that buffer, genuinely early/late is literal.
 */
export function roundCheckOutToSchedule(checkOut: string, requiredCheckOut: string): string {
  if (!checkOut || !requiredCheckOut) return checkOut;
  const deltaSeconds = Math.abs(toSeconds(checkOut) - toSeconds(requiredCheckOut));
  return deltaSeconds <= ON_TIME_BUFFER_SECONDS ? requiredCheckOut : checkOut;
}

/** Current wall-clock time and date in the given IANA timezone, regardless of the caller's own local timezone. */
export function nowInTimezone(timeZone: string): { hhmm: string; dateISO: string } {
  const now = new Date();
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const dateISO = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { hhmm, dateISO };
}
