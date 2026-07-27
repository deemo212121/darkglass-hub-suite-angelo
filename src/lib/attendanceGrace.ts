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
