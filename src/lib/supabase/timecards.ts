/**
 * Supabase timecards service — the logged-in user's personal timecard.
 * Entries are keyed by the caller's profile + work date, company-scoped by RLS.
 */

import { supabase } from "./client";
import type { PtoType } from "./pto";

// The flat UI time-entry shape used by the timecard page.
export interface UITimeEntry {
  checkIn: string;
  checkOut: string;
  mealStart: string;
  mealEnd: string;
  notes: string;
  /** State the technician is assigned to for this specific day — technicians
   * hop between states job to job, so this is independently set per day
   * rather than one value carried on the profile. Omit to leave unchanged. */
  state?: string;
}

/** True only for a genuine network-level failure (the request never reached
 * the server at all) — distinct from a real Postgres/RLS error (which got a
 * response, just a rejecting one). supabase-js catches the browser's raw
 * "TypeError: Failed to fetch" internally and hands it back through the
 * normal `{ error }` result shape rather than letting it propagate as a
 * thrown TypeError, so this checks the message text (it's already been
 * stringified into error.message by the time our own code re-throws it as
 * a plain Error below) rather than the exception's type. Retrying a real
 * server error would just waste time re-showing the same failure; retrying
 * a network blip (common on a tech's phone moving between coverage spots
 * while punching in/out) often just works. */
function isNetworkFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}

const NETWORK_UNREACHABLE_MESSAGE = "Couldn't reach the server — check your connection and try again.";

/** Retries only genuine network failures, with a short backoff, before
 * giving the caller a plain-language message instead of a raw browser
 * TypeError. A real server-side error (RLS, validation, etc.) is thrown
 * immediately on the first attempt, unchanged. */
async function withNetworkRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
      if (i === attempts - 1) throw new Error(NETWORK_UNREACHABLE_MESSAGE);
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  throw new Error(NETWORK_UNREACHABLE_MESSAGE);
}

/** Resolve the caller's profile id from their Firebase uid. */
async function getMyProfileId(firebaseUid: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (error) {
    console.error("getMyProfileId error:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/** Public: get the caller's profile id from their Firebase uid. */
export async function getProfileIdByFirebaseUid(firebaseUid: string): Promise<string | null> {
  return getMyProfileId(firebaseUid);
}

/**
 * Get the caller's profile id + required scheduled shift times.
 *
 * working_hours/meal_minutes (migration 0109) are fetched in a SEPARATE,
 * best-effort query rather than folded into the main select — if that
 * migration hasn't been applied yet (or any future optional column has an
 * issue), it must never take down profileId/requiredCheckIn/requiredCheckOut
 * too, since those gate loading the rest of the timecard page (calendar
 * entries, today's punch state, etc). Learned this the hard way: a single
 * combined select silently nulled out profileId on a column-not-found
 * error, which made the whole Timecard page look empty.
 */
export async function getMyProfileSchedule(firebaseUid: string): Promise<{
  profileId: string | null;
  requiredCheckIn: string;
  requiredCheckOut: string;
  workingHours: number | null;
  mealMinutes: number | null;
  /** Day-off indices (0=Sunday..6=Saturday, same convention as getAttendanceForRange's daysOff) — without this, every day (including real days off) gets treated as a scheduled work day. */
  offDays: number[];
  /** profiles.schedule_timezone — which real-world clock this employee's punches should be stamped in (see src/lib/serverTime.ts). Defaults to "CST", same convention as AppHeader's clock and getMyFullProfile. */
  scheduleTimezone: "CST" | "EST";
  /** profiles.employment_type (migration 0152) — a "trainee" punches on
   *  these exact same screens, but every write/read here is redirected to
   *  trainee_timecard_entries (traineeTimecards.ts) instead of the real
   *  timecard_entries, until their manager approves the day. Defaults to
   *  "regular" the same best-effort way working_hours/meal_minutes do below
   *  — an un-applied migration or a transient error here must never make an
   *  ordinary employee's punch silently vanish into the trainee table. */
  employmentType: "trainee" | "regular";
}> {
  // Network failures are retried and then surfaced as a thrown error — a
  // transient blip here used to return profileId:null, which downstream reads
  // as "you have no profile" and makes the timecard show a blank punch card
  // (and any punch then alerts "please re-login"). A real column error still
  // returns the empty shape below, so an un-applied optional-column migration
  // can't take the whole page down (see the doc comment above).
  const { data, error } = await withNetworkRetry(async () => {
    const res = await supabase
      .from("profiles")
      .select("id, required_check_in, required_check_out, off_days, schedule_timezone")
      .eq("firebase_uid", firebaseUid)
      .maybeSingle();
    if (res.error && isNetworkFailure(res.error.message)) throw new Error(res.error.message);
    return res;
  });
  if (error) {
    console.error("getMyProfileSchedule error:", error.message);
    return { profileId: null, requiredCheckIn: "", requiredCheckOut: "", workingHours: null, mealMinutes: null, offDays: [], scheduleTimezone: "CST", employmentType: "regular" };
  }

  let workingHours: number | null = null;
  let mealMinutes: number | null = null;
  if (data?.id) {
    const { data: extra, error: extraError } = await supabase
      .from("profiles")
      .select("working_hours, meal_minutes")
      .eq("id", data.id)
      .maybeSingle();
    if (extraError) {
      console.error("getMyProfileSchedule (working_hours/meal_minutes) error:", extraError.message);
    } else {
      workingHours = extra?.working_hours ?? null;
      mealMinutes = extra?.meal_minutes ?? null;
    }
  }

  // The pending-approval trainee workflow now follows Masterlist's
  // Employment Status alone (per the user's explicit call) — ANY role
  // marked Trainee there redirects their punches here for manager approval,
  // not just the Technician department. It reverts the moment Employment
  // Status is changed off Trainee on Masterlist.
  let employmentType: "trainee" | "regular" = "regular";
  if (data?.id) {
    const { data: typeRow, error: typeError } = await supabase
      .from("profiles")
      .select("employment_type")
      .eq("id", data.id)
      .maybeSingle();
    if (typeError) {
      console.error("getMyProfileSchedule (employment_type) error:", typeError.message);
    } else if (typeRow?.employment_type === "trainee") {
      employmentType = "trainee";
    }
  }

  return {
    profileId: data?.id ?? null,
    requiredCheckIn: data?.required_check_in ?? "",
    requiredCheckOut: data?.required_check_out ?? "",
    workingHours,
    mealMinutes,
    offDays: ((data as any)?.off_days as number[] | null) ?? [],
    scheduleTimezone: ((data as any)?.schedule_timezone as "CST" | "EST" | null) ?? "CST",
    employmentType,
  };
}

/**
 * Scheduled shift length for meal-eligibility purposes — prefers the
 * profile's explicit working_hours override (migration 0109) when set,
 * since a plain Time In/Out subtraction doesn't always match someone's
 * real scheduled hours. Falls back to the Time In/Out diff otherwise.
 *
 * working_hours is NET productive time — it excludes the meal — so the
 * GROSS scheduled shift (what "more than 6 hours" actually means, same as
 * the old Check-In-to-Check-Out span) adds meal_minutes back on top, e.g.
 * 7.5 working hours + 30 meal minutes = an 8-hour shift.
 */
export function resolveScheduledShiftHours(
  requiredCheckIn: string,
  requiredCheckOut: string,
  workingHours: number | null | undefined,
  mealMinutes?: number | null | undefined
): number {
  if (typeof workingHours === "number" && workingHours > 0) {
    return workingHours + (typeof mealMinutes === "number" && mealMinutes > 0 ? mealMinutes / 60 : 0);
  }
  return requiredCheckIn && requiredCheckOut ? hoursBetween(requiredCheckIn, requiredCheckOut) : 0;
}

/**
 * Scheduled NET hours for a day the employee didn't actually punch (e.g. an
 * approved PTO day being credited toward payroll) — the productive time
 * they'd have worked, i.e. the gross scheduled shift minus the meal break.
 * Prefers the explicit working_hours override (already net) same as
 * resolveScheduledShiftHours; otherwise derives it from Check-In/Check-Out
 * minus the meal.
 */
export function resolveScheduledNetHours(
  requiredCheckIn: string,
  requiredCheckOut: string,
  workingHours: number | null | undefined,
  mealMinutes?: number | null | undefined
): number {
  if (typeof workingHours === "number" && workingHours > 0) {
    return workingHours;
  }
  if (!requiredCheckIn || !requiredCheckOut) return 0;
  const gross = hoursBetween(requiredCheckIn, requiredCheckOut);
  const meal = typeof mealMinutes === "number" && mealMinutes > 0 ? mealMinutes / 60 : 0;
  return Math.max(0, gross - meal);
}

/**
 * Total scheduled ("duty") hours across every day in [periodStart,
 * periodEnd] that isn't one of the employee's own off days — the
 * period-level threshold payroll calculators split actual worked hours
 * against: regular = min(totalRawHours, duty), overtime = max(0,
 * totalRawHours - duty). This replaced capping each day at a flat 8 hours
 * independently and summing THOSE — a single long day used to generate
 * "overtime" on its own even when the employee was still behind on hours
 * from an earlier short day in the same period, which double-counted nothing
 * but overstated overtime pay relative to what was actually owed. Returns 0
 * when there's no configured schedule to derive hours from (no
 * required_check_in/check_out and no working_hours override) or no period
 * given — callers should fall back to the old per-day cap in that case
 * rather than silently zeroing out overtime for someone with no schedule on
 * file.
 */
export function computeScheduledDutyHours(
  requiredCheckIn: string,
  requiredCheckOut: string,
  workingHours: number | null | undefined,
  mealMinutes: number | null | undefined,
  offDays: number[] | null | undefined,
  periodStart: string,
  periodEnd: string
): number {
  if (!periodStart || !periodEnd) return 0;
  const netHours = resolveScheduledNetHours(requiredCheckIn, requiredCheckOut, workingHours, mealMinutes);
  if (netHours <= 0) return 0;
  const offDaySet = new Set(offDays ?? []);
  let total = 0;
  for (let d = new Date(`${periodStart}T00:00:00`); d <= new Date(`${periodEnd}T00:00:00`); d.setDate(d.getDate() + 1)) {
    if (!offDaySet.has(d.getDay())) total += netHours;
  }
  return total;
}

/** YYYY-MM-DD of the Sunday that starts the calendar week containing `dateStr`. */
export function startOfWeekSunday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Splits a chronological run of per-day worked hours into regular vs.
 * overtime, resetting the overtime threshold every calendar week (Sunday
 * through Saturday) instead of pooling a whole (possibly multi-week) query
 * range into one cap. Two things go wrong without this: (1) a shortfall in
 * one week of a multi-week payroll period would silently "absorb" real
 * overtime earned in another week, since a flat period-wide cap only cares
 * about the total; (2) a caller viewing a sub-range that starts mid-week
 * (e.g. Thursday through Saturday) would compute that sub-range's own tiny
 * duty cap from scratch, ignoring that the week's regular-hours quota may
 * already have been used up earlier in the week, outside the viewed range.
 *
 * `days` must span from the Sunday that starts the first day you want a
 * result for, through the last day you want a result for — a caller that
 * only wants to DISPLAY a narrower sub-range (e.g. this modal's freely
 * adjustable Start/End pickers) still needs to pass the wider, week-aligned
 * array so earlier same-week days can seed the running total; it just
 * ignores/discards result entries for dates before its own display start.
 * Returns a map of every input date to that day's {regular, overtime} split.
 */
/**
 * Standard FLSA weekly overtime threshold — used for CSR instead of the
 * scheduled-duty-hours cap above, since CSR shift start/end times vary
 * person to person and aren't reliably captured in
 * requiredCheckIn/requiredCheckOut. See splitRegularOvertimeWeekly's
 * flatWeeklyThreshold param.
 */
export const CSR_WEEKLY_OVERTIME_THRESHOLD = 40;
export function splitRegularOvertimeWeekly(
  days: { date: string; rawHours: number }[],
  schedule: {
    requiredCheckIn?: string | null;
    requiredCheckOut?: string | null;
    workingHours?: number | null;
    mealMinutes?: number | null;
    offDays?: number[] | null;
  },
  fallbackRegularHoursPerDay = 8,
  /**
   * Overrides the per-week cap with a flat number of hours (e.g. 40) instead
   * of deriving it from requiredCheckIn/requiredCheckOut/workingHours — for
   * CSR, whose duty schedule varies person-to-person and isn't reliably
   * captured in those fields, standard FLSA weekly overtime (over 40 hrs/wk)
   * doesn't depend on a configured schedule being accurate. `schedule` is
   * ignored entirely when this is set. See callers (PayrollCalculationPage.tsx,
   * AccountingDashboard.tsx, EmployeePayrollDetailModal.tsx) for the
   * isCsrRestrictedRole check that decides when to pass this.
   */
  flatWeeklyThreshold?: number
): Map<string, { regular: number; overtime: number }> {
  const result = new Map<string, { regular: number; overtime: number }>();
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let currentWeekStart = "";
  let weekDuty = 0;
  let cumulativeRaw = 0;
  for (const { date, rawHours } of sorted) {
    const weekStart = startOfWeekSunday(date);
    if (weekStart !== currentWeekStart) {
      currentWeekStart = weekStart;
      weekDuty = flatWeeklyThreshold != null
        ? flatWeeklyThreshold
        : computeScheduledDutyHours(
            schedule.requiredCheckIn || "",
            schedule.requiredCheckOut || "",
            schedule.workingHours,
            schedule.mealMinutes,
            schedule.offDays,
            weekStart,
            addDaysISO(weekStart, 6)
          );
      cumulativeRaw = 0;
    }
    let regular: number;
    let overtime: number;
    if (weekDuty > 0) {
      const before = cumulativeRaw;
      cumulativeRaw += rawHours;
      regular = Math.max(0, Math.min(cumulativeRaw, weekDuty) - before);
      overtime = rawHours - regular;
      // Snap near-zero noise from the cumulative running total to exactly 0.
      // `regular`/`overtime` here come from repeatedly adding hours derived
      // from integer-second time arithmetic (hoursBetween: seconds / 3600) —
      // binary floating point can't represent most of those fractions
      // exactly, so a day with truly zero real overtime can come out as
      // something like 0.0000000001 instead of a clean 0. Left unsnapped,
      // that's still "> 0" to every downstream consumer (display thresholds
      // included), which used to misclassify a day with no real overtime as
      // having some.
      if (Math.abs(overtime) < 1 / 3600) overtime = 0;
    } else {
      regular = Math.min(rawHours, fallbackRegularHoursPerDay);
      overtime = Math.max(0, rawHours - fallbackRegularHoursPerDay);
    }
    result.set(date, { regular, overtime });
  }
  return result;
}

/**
 * Load all timecard entries for a profile in a given month.
 * @param profileId the logged-in user's profile id
 * @param year e.g. 2026
 * @param month 0-based (0 = January) to match the JS Date the page uses
 * Returns a map keyed by "YYYY-MM-DD".
 */
export async function getMonthEntries(
  profileId: string,
  year: number,
  month: number
): Promise<Record<string, UITimeEntry>> {
  const mm = String(month + 1).padStart(2, "0");
  const start = `${year}-${mm}-01`;
  // last day of month
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

  // Retry a genuine network blip (a tech's phone between coverage spots)
  // before giving up — a thrown failure here leaves the timecard unable to
  // load, and a card that renders anyway would show blank punches the tech
  // might then overwrite.
  const data = await withNetworkRetry(async () => {
    const { data, error } = await supabase
      .from("timecard_entries")
      .select("work_date, check_in, check_out, meal_start, meal_end, notes")
      .eq("profile_id", profileId)
      .gte("work_date", start)
      .lte("work_date", end);
    if (error) {
      console.error("getMonthEntries error:", error.message);
      throw new Error(error.message);
    }
    return data;
  });

  const map: Record<string, UITimeEntry> = {};
  (data ?? []).forEach((row: any) => {
    map[row.work_date] = {
      checkIn: row.check_in ?? "",
      checkOut: row.check_out ?? "",
      mealStart: row.meal_start ?? "",
      mealEnd: row.meal_end ?? "",
      notes: row.notes ?? "",
    };
  });
  return map;
}

/** Single day's entry for the caller's profile — lighter than getMonthEntries for callers (e.g. the header time-clock widget) that only need today. */
export async function getEntryForDate(profileId: string, workDate: string): Promise<UITimeEntry | null> {
  const data = await withNetworkRetry(async () => {
    const { data, error } = await supabase
      .from("timecard_entries")
      .select("check_in, check_out, meal_start, meal_end, notes")
      .eq("profile_id", profileId)
      .eq("work_date", workDate)
      .maybeSingle();
    if (error) {
      console.error("getEntryForDate error:", error.message);
      throw new Error(error.message);
    }
    return data;
  });
  if (!data) return null;
  return {
    checkIn: data.check_in ?? "",
    checkOut: data.check_out ?? "",
    mealStart: data.meal_start ?? "",
    mealEnd: data.meal_end ?? "",
    notes: data.notes ?? "",
  };
}

/**
 * Upsert a single day's timecard entry for the caller's profile.
 * company_id is auto-stamped by the set_company_id trigger.
 */
export async function saveEntry(
  profileId: string,
  workDate: string,
  entry: UITimeEntry,
  opts?: { clockedInBy?: string }
): Promise<void> {
  // clocked_in_by is only ever included in the payload when this save is
  // itself a manager's proxy clock-in — omitting the key entirely (rather
  // than sending it as null) means a later self-punch save for the same
  // day (e.g. the technician's own Time Out) doesn't wipe out that audit
  // trail, since PostgREST's upsert only updates columns present in the
  // payload.
  await withNetworkRetry(async () => {
    const { error } = await supabase
      .from("timecard_entries")
      .upsert(
        {
          profile_id: profileId,
          work_date: workDate,
          check_in: entry.checkIn || null,
          check_out: entry.checkOut || null,
          meal_start: entry.mealStart || null,
          meal_end: entry.mealEnd || null,
          notes: entry.notes || null,
          ...(opts?.clockedInBy ? { clocked_in_by: opts.clockedInBy } : {}),
          // Only included when the caller explicitly sets it — otherwise a
          // punch-only save (clock in/out, corrections, etc.) would null out
          // whatever state was already assigned to this day.
          ...(entry.state !== undefined ? { state: entry.state || null } : {}),
        },
        { onConflict: "profile_id,work_date" }
      );
    if (error) {
      console.error("saveEntry error:", error.message);
      throw new Error(error.message);
    }
  });
}

export type PunchField = "checkIn" | "checkOut" | "mealStart" | "mealEnd";

const PUNCH_COLUMN: Record<PunchField, string> = {
  checkIn: "check_in",
  checkOut: "check_out",
  mealStart: "meal_start",
  mealEnd: "meal_end",
};

/**
 * Whether `field` is currently safe to remove/re-punch. Punches form a
 * strict chain — Check In -> Meal In -> Meal Out -> Check Out — and only
 * the most recently-made one is touchable at any moment: correcting an
 * earlier punch (e.g. an accidental Check In) requires first removing
 * everything that came after it, in reverse order, one step at a time.
 * This is what lets a stray double-tap be self-corrected without an admin
 * Time Correction request, while still keeping the chain internally
 * consistent (never a Meal Out with no Meal In, etc). Assumes the field
 * itself is already punched — only meaningful for deciding whether to show
 * a remove control on a punch that exists.
 */
export function canEditPunch(entry: Pick<UITimeEntry, "checkOut" | "mealStart" | "mealEnd">, field: PunchField): boolean {
  switch (field) {
    case "checkIn": return !entry.mealStart;
    case "mealStart": return !entry.mealEnd;
    case "mealEnd": return !entry.checkOut;
    case "checkOut": return true; // last in the chain — nothing after it to conflict with
  }
}

/**
 * Stamp ONE punch column for a day, leaving the others exactly as they are in
 * the database. The mobile Time In/Out + Meal In/Out buttons must use this,
 * never saveEntry(): saveEntry re-writes all five columns from the client's
 * in-memory copy, so if that copy failed to load (a network blip in the
 * field) and rendered blank, the next tap would upsert NULLs over the real
 * check-in / meal punches. This upsert only names the single column tapped —
 * PostgREST's ON CONFLICT updates just the columns present in the payload —
 * so a stale local view can't erase anything.
 */
export async function savePunch(
  profileId: string,
  workDate: string,
  field: PunchField,
  time: string
): Promise<void> {
  const column = PUNCH_COLUMN[field];
  await withNetworkRetry(async () => {
    const { error } = await supabase
      .from("timecard_entries")
      .upsert(
        { profile_id: profileId, work_date: workDate, [column]: time },
        { onConflict: "profile_id,work_date" }
      );
    if (error) {
      console.error("savePunch error:", error.message);
      throw new Error(error.message);
    }
  });
}

/**
 * Self-service undo for one punch column — the flip side of savePunch,
 * clearing it back to null instead of stamping a time. Callers must check
 * canEditPunch first: this function itself doesn't enforce the chain rule
 * (Check In only removable while Meal In is empty, etc), since the current
 * value of every OTHER column has to be known to decide that, and this is a
 * single-column write by design (same stale-local-copy safety as savePunch
 * — never touches the other three columns regardless of what the caller's
 * in-memory entry looks like).
 */
export async function clearPunch(
  profileId: string,
  workDate: string,
  field: PunchField
): Promise<void> {
  const column = PUNCH_COLUMN[field];
  await withNetworkRetry(async () => {
    const { error } = await supabase
      .from("timecard_entries")
      .upsert(
        { profile_id: profileId, work_date: workDate, [column]: null },
        { onConflict: "profile_id,work_date" }
      );
    if (error) {
      console.error("clearPunch error:", error.message);
      throw new Error(error.message);
    }
  });
}

/**
 * Append one line to a day's timecard notes without touching any punch
 * column — reads the current notes, appends, then upserts only `notes`
 * (same single-column-upsert safety as savePunch: a stale/blank in-memory
 * entry can't wipe check_in/check_out/meals). Used by the automatic
 * home-arrival clock-out to leave an audit marker alongside the punch it
 * just wrote. Best-effort by contract — callers treat a failure here as
 * non-fatal (the clock-out itself already succeeded).
 */
export async function appendEntryNote(profileId: string, workDate: string, line: string): Promise<void> {
  const existing = await getEntryForDate(profileId, workDate).catch(() => null);
  const prev = (existing?.notes ?? "").trim();
  const notes = prev ? `${prev}\n${line}` : line;
  await withNetworkRetry(async () => {
    const { error } = await supabase
      .from("timecard_entries")
      .upsert({ profile_id: profileId, work_date: workDate, notes }, { onConflict: "profile_id,work_date" });
    if (error) {
      console.error("appendEntryNote error:", error.message);
      throw new Error(error.message);
    }
  });
}

/** Delete a day's entry for the caller's profile. */
export async function deleteEntry(profileId: string, workDate: string): Promise<void> {
  const { error } = await supabase
    .from("timecard_entries")
    .delete()
    .eq("profile_id", profileId)
    .eq("work_date", workDate);
  if (error) {
    console.error("deleteEntry error:", error.message);
    throw new Error(error.message);
  }
}


/**
 * Compute hours worked between two "HH:MM" or "HH:MM:SS" strings, accounting
 * for an optional meal break. Mirrors the math used by the personal timecard
 * page so the self-service Attendance tab agrees with the timecard. Seconds
 * (when present) are included so payroll hours — and therefore pay — aren't
 * rounded to the nearest minute.
 */
function hoursBetween(t1: string, t2: string): number {
  if (!t1 || !t2) return 0;
  const [h1, m1, s1 = 0] = t1.split(":").map(Number);
  const [h2, m2, s2 = 0] = t2.split(":").map(Number);
  return ((h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1)) / 3600;
}

export function calcWorkedHours(entry: UITimeEntry): number {
  if (!entry || !entry.checkIn || !entry.checkOut) return 0;
  const span = hoursBetween(entry.checkIn, entry.checkOut);
  if (entry.mealStart && entry.mealEnd) {
    const mealDuration = hoursBetween(entry.mealStart, entry.mealEnd);
    // A punched meal duration of 0, negative, or longer than the shift
    // itself isn't a real break — it's bad punch data (e.g. a stray/
    // mistimed Meal In or Meal Out) — so don't subtract it. Previously this
    // subtracted unconditionally and let Math.max(0, hrs) clamp a resulting
    // negative to 0, silently erasing the whole day's real Check In/Check
    // Out hours instead of surfacing that the meal punch was wrong.
    if (mealDuration > 0 && mealDuration < span) return span - mealDuration;
  }
  return Math.max(0, span);
}

/** Policy meal-break length (30 min) for meal-always-paid roles — no longer used to size the pay credit itself (see computeMealTimeCredit), only as the threshold a real punched meal duration is flagged against as running long. */
export const MEAL_ALWAYS_PAID_DEFAULT_HOURS = 0.5;

/**
 * Extra PAID hours for employees in meal-always-paid roles (roleLabels.ts's
 * isMealAlwaysPaidRole) — plain Technicians and the field-tech management
 * tiers (Branch/Senior Branch Manager, Tech Manager, Technical
 * Director/Assistant Director) aren't required to punch Meal In/Out, but
 * their meal break is still paid time.
 *
 * Credits back exactly the real punched meal duration (Meal Out − Meal In)
 * — not a flat 30 minutes. calcWorkedHours above already SUBTRACTS that
 * same real duration from the raw Check In-to-Check Out span (meal time
 * isn't worked time), so adding it straight back here nets to "the whole
 * clock-in-to-clock-out span is paid," whatever the break actually ran —
 * 20 minutes, 30, or 45. A flat 30-minute credit used to sit here instead,
 * which either over- or under-paid depending on how the real punch compared
 * to that fixed number; a real punch's own length is what actually
 * happened, so that's what gets paid. No punch at all (mealStart/mealEnd
 * empty) credits 0 — calcWorkedHours never subtracted anything for a break
 * that was never taken, so there's nothing to add back, and this doesn't
 * additionally reward not taking one. A break that runs over the 30-minute
 * policy length isn't capped or penalized here — see the "Meal Time" column
 * in EmployeePayrollDetailModal.tsx, which flags (not deducts) an
 * over-length break instead.
 *
 * Callers add this directly into the day's raw hours BEFORE running the
 * regular/overtime weekly split (splitRegularOvertimeWeekly) — not folded
 * on afterward — so it's treated exactly like real worked time: it fills
 * whatever room is left in the week's regular quota, and only spills into
 * overtime once that quota (real hours + this credit, combined) is used up.
 * There is deliberately no separate "meal" bucket in the split output — the
 * result is just regular/overtime, same as everywhere else in this file.
 *
 * Eligibility (shift over 6 hours) is judged from THIS DAY's own real
 * Check In-to-Check Out span, not the employee's generic scheduled shift
 * length — a technician whose normal schedule is 8 hours but who only
 * worked 4.5 hours today (left early, came in late, etc.) isn't meal-
 * eligible today just because most of their days are longer. Callers used
 * to pass a single mealEligible flag computed once from the schedule and
 * reused for every day, which incorrectly credited (and flagged "missing
 * meal" on) short days that never crossed the 6-hour line at all.
 */
export function computeMealTimeCredit(
  entry: Pick<UITimeEntry, "checkIn" | "checkOut" | "mealStart" | "mealEnd">,
  mealAlwaysPaid: boolean
): number {
  if (!mealAlwaysPaid) return 0;
  if (!entry.checkIn || !entry.checkOut) return 0;
  const span = hoursBetween(entry.checkIn, entry.checkOut);
  if (span <= 6) return 0;
  if (!entry.mealStart || !entry.mealEnd) return 0;
  const mealDuration = hoursBetween(entry.mealStart, entry.mealEnd);
  // Same sanity guard as calcWorkedHours above — a meal duration of 0,
  // negative, or longer than the shift itself is bad punch data, not a
  // real break calcWorkedHours actually subtracted, so there's nothing
  // real to credit back here either.
  if (mealDuration <= 0 || mealDuration >= span) return 0;
  return mealDuration;
}

/** Public helper for components that need the raw HH:MM diff. */
export function hoursDiff(t1: string, t2: string): number {
  return hoursBetween(t1, t2);
}

/**
 * Daily attendance summary row used by the self-service Attendance tab and
 * the warning detector. One row per date in the requested range; days the
 * user didn't clock in at all are included with status="absent".
 */
export interface AttendanceRow {
  date: string;          // "YYYY-MM-DD"
  clockIn: string;       // "HH:MM" or ""
  clockOut: string;      // "HH:MM" or ""
  mealStart: string;     // "HH:MM" or ""
  mealEnd: string;       // "HH:MM" or ""
  hoursWorked: number;
  /**
   * "missing-meal": clocked a full in/out day, was meal-eligible (scheduled
   * shift > 6h), but never completed Meal In + Meal Out. Not blocked at
   * punch time — just recorded here so HR/managers can see it.
   * "day-off": no punch on a day in the person's off_days (weekend/RDO) —
   * a distinct status from "absent" so it reads as an expected rest day,
   * not a missed shift.
   * "holiday": no punch on a company holiday (see companyHolidays.ts) —
   * same idea as "day-off": nobody was expected to clock in, so this
   * shouldn't read as a missed shift either. If they DID clock in, status
   * is "present" as normal — a holiday doesn't change pay calculation,
   * only whether a no-punch day counts as a miss.
   * "pending-correction": there's an unresolved timecard correction
   * (timecardCorrections.ts) filed for this date — the employee already
   * flagged the missing/incorrect punch and it's awaiting manager/HR/
   * Accounting approval, so this shouldn't read as a flat unexplained
   * "absent"/"missing-*" until that review actually resolves it. Once
   * approved, the correction upserts the real punch into timecard_entries
   * and this reverts to "present" on the next fetch; if rejected, the
   * underlying absent/missing status stands.
   * "paid-leave": no punch on a day covered by an APPROVED, PAID pto
   * request (pto.ts's isPaidPtoType — Sick is always unpaid and never lands
   * here) — hoursWorked is the day's scheduled net hours (not 0), so it
   * pays out at the normal rate instead of reading as a missed shift. See
   * leaveType for which kind (vacation/personal/bereavement/holiday-type
   * PTO). Same crediting rule AccountingDashboard.tsx's computeHoursMap
   * already applies to the real payroll total — this only makes that same
   * truth visible on this per-day table instead of it disagreeing with the
   * real number by showing "Absent"/$0.
   * "unpaid-leave": no punch on a day covered by an APPROVED, UNPAID pto
   * request (Unpaid or Sick — isPaidPtoType is false) — hoursWorked is 0
   * (there's no pay to credit), but this is a recognized, EXCUSED absence,
   * not an unexplained no-show — so it reads as "Unpaid Leave"/"Sick Leave"
   * instead of flattening to plain "absent" and looking like a missed
   * shift nobody accounted for.
   */
  status: "present" | "absent" | "missing-in" | "missing-out" | "missing-meal" | "day-off" | "holiday" | "pending-correction" | "paid-leave" | "unpaid-leave";
  /** Only set when status is "paid-leave" or "unpaid-leave" — which kind of PTO covers this day. */
  leaveType?: PtoType;
  /** State the technician was assigned to for this day, if set. */
  state?: string;
}

/**
 * Build a date-by-date attendance summary for the caller. Compares each
 * day's timecard against the user's scheduled shift to flag missing
 * clock-in or clock-out entries.
 */
export async function getAttendanceForRange(
  profileId: string,
  startDate: string,
  endDate: string,
  scheduled: {
    requiredCheckIn?: string;
    requiredCheckOut?: string;
    workingHours?: number | null;
    mealMinutes?: number | null;
    daysOff?: number[];
    /** Opt-in — omitted/0 means hoursWorked is the literal punch, unchanged from today. Pay-facing callers pass payGraceMinutesFor(...) (see attendanceGrace.ts) so hoursWorked reflects paid hours, not just the raw clock-in. */
    graceMinutes?: number;
    /** "YYYY-MM-DD" company holiday dates (see companyHolidays.ts) — a no-punch day here reads as "holiday", not "absent", same as daysOff. */
    holidayDates?: string[];
    /** "YYYY-MM-DD" dates with an unresolved timecard correction for this profile (see timecardCorrections.ts) — an absent/missing day here reads as "pending-correction" instead. */
    pendingCorrectionDates?: string[];
    /** "YYYY-MM-DD" -> leave type, for this profile's APPROVED, PAID pto requests (pto.ts's isPaidPtoType) overlapping the range — a no-punch day here reads as "paid-leave" (hoursWorked = the day's scheduled net hours) instead of "absent". */
    paidLeaveDates?: Map<string, PtoType>;
    /** "YYYY-MM-DD" -> leave type, for this profile's APPROVED, UNPAID pto requests (Unpaid/Sick — isPaidPtoType false) overlapping the range — a no-punch day here reads as "unpaid-leave" (hoursWorked 0, but excused) instead of "absent". Takes precedence over paidLeaveDates for the same date if a caller somehow passes conflicting maps — an unpaid request is the more specific/recent record whenever both exist for one day (see EmployeePayrollDetailModal.tsx's merge). */
    unpaidLeaveDates?: Map<string, PtoType>;
  } = {}
): Promise<AttendanceRow[]> {
  const { data, error } = await supabase
    .from("timecard_entries")
    .select("work_date, check_in, check_out, meal_start, meal_end, state")
    .eq("profile_id", profileId)
    .gte("work_date", startDate)
    .lte("work_date", endDate)
    .order("work_date", { ascending: true });
  if (error) throw new Error(error.message);

  const byDate = new Map<string, any>();
  for (const row of data ?? []) byDate.set(row.work_date as string, row);

  // Iterate every day in the inclusive range.
  const rows: AttendanceRow[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const daysOff = new Set((scheduled.daysOff ?? []).map((n) => n));
  const holidayDates = new Set(scheduled.holidayDates ?? []);
  const pendingCorrectionDates = new Set(scheduled.pendingCorrectionDates ?? []);
  const paidLeaveDates = scheduled.paidLeaveDates ?? new Map<string, PtoType>();
  const unpaidLeaveDates = scheduled.unpaidLeaveDates ?? new Map<string, PtoType>();
  // Same rule as the timecard punch flows (TimeClockMenu.tsx / routes/timecard.tsx):
  // a shift over 6 hours is meal-eligible. Punching no longer BLOCKS timing
  // out without a meal — this is just where that gets recorded instead.
  // Judged per day below from that day's own real Check In-to-Check Out
  // span, not this employee's generic scheduled shift length — a short day
  // (left early, came in late) isn't meal-eligible just because most of
  // this employee's days are longer.
  const scheduledNetHours = resolveScheduledNetHours(scheduled.requiredCheckIn ?? "", scheduled.requiredCheckOut ?? "", scheduled.workingHours, scheduled.mealMinutes);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;
    const dow = d.getDay();
    const isOffDay = daysOff.has(dow);
    const isHoliday = holidayDates.has(key);
    // An unpaid request for this date wins over a paid one — see the
    // unpaidLeaveDates param doc for why a caller might pass both.
    const unpaidType = unpaidLeaveDates.get(key);
    const leaveType = unpaidType ?? paidLeaveDates.get(key);
    const row = byDate.get(key);
    if (!row) {
      // No timecard entry. Future days are skipped entirely (nothing to
      // report yet). A day off (or company holiday) still gets its own row
      // — status "day-off"/"holiday" instead of "absent" — so it reads as
      // an expected rest day rather than a gap that looks like missing
      // data, or a missed shift. Same for an approved paid-leave day, which
      // also gets paid its scheduled net hours instead of reading as a
      // missed shift (0 hours) — see AttendanceRow.status's "paid-leave" doc.
      const isFuture = key > new Date().toISOString().slice(0, 10);
      if (!isFuture) {
        const isUnpaidLeave = !isOffDay && !isHoliday && unpaidType != null;
        const isPaidLeave = !isUnpaidLeave && !isOffDay && !isHoliday && leaveType != null && scheduledNetHours > 0;
        rows.push({
          date: key,
          clockIn: "",
          clockOut: "",
          mealStart: "",
          mealEnd: "",
          hoursWorked: isPaidLeave ? scheduledNetHours : 0,
          status: isOffDay ? "day-off" : isHoliday ? "holiday" : isUnpaidLeave ? "unpaid-leave" : isPaidLeave ? "paid-leave" : pendingCorrectionDates.has(key) ? "pending-correction" : "absent",
          ...(isPaidLeave || isUnpaidLeave ? { leaveType } : {}),
        });
      }
      continue;
    }
    const entry: UITimeEntry = {
      checkIn: row.check_in ?? "",
      checkOut: row.check_out ?? "",
      mealStart: row.meal_start ?? "",
      mealEnd: row.meal_end ?? "",
      notes: "",
    };
    // A timecard_entries row existing for this date is NOT the same as a
    // real punch — e.g. a trainee day approved with no actual check-in/out
    // recorded, or any other row written with both time columns still
    // null — used to fall through to the "present" default below with no
    // real times to show, rendering as a misleading green "Present" next
    // to blank Clock In/Out cells instead of the missing-data status a
    // day with no `row` at all already gets (see the `!row` branch above).
    let status: AttendanceRow["status"] = "present";
    if (!entry.checkIn && !entry.checkOut) status = isOffDay ? "day-off" : isHoliday ? "holiday" : "absent";
    else if (entry.checkIn && !entry.checkOut) status = "missing-out";
    else if (!entry.checkIn && entry.checkOut) status = "missing-in";
    else if (entry.checkIn && entry.checkOut && hoursBetween(entry.checkIn, entry.checkOut) > 6 && !(entry.mealStart && entry.mealEnd)) status = "missing-meal";
    if (status !== "present" && pendingCorrectionDates.has(key)) status = "pending-correction";
    // hoursWorked reflects the LITERAL punch — grace (payGraceMinutesFor/
    // applyGraceToCheckIn/roundCheckOutToSchedule, attendanceGrace.ts) is a
    // warning-suppression window only ("don't flag a missing/late clock-in
    // until they're N minutes past schedule" — attendanceAlerts.ts,
    // AttendanceMonitoringPage.tsx), not a pay policy. It must never inflate
    // worked hours/pay by pulling a late check-in back to the scheduled
    // time — an employee who clocks in late is paid for the hours they
    // actually worked, same as any other day.
    rows.push({
      date: key,
      clockIn: entry.checkIn,
      clockOut: entry.checkOut,
      mealStart: entry.mealStart,
      mealEnd: entry.mealEnd,
      hoursWorked: calcWorkedHours(entry),
      status,
      ...(row.state ? { state: row.state as string } : {}),
    });
  }
  return rows;
}

/**
 * Company-wide timecard warning summary for the HR Dashboard.
 * Returns one row per profile with a count of days in the current month
 * where the employee had a missing check-in or check-out.
 *
 * RLS is satisfied because the caller (HR/Admin) can read all profiles in
 * their company, and timecard_entries inherits the same company scope.
 */
export interface TimecardWarningRow {
  profileId: string;
  displayName: string;
  email: string;
  missingEntries: number;      // days with absent status in the current month
  missingCheckIn: number;      // days with check-out but no check-in
  missingCheckOut: number;     // days with check-in but no check-out
  totalWarnings: number;       // sum of all three
}

// Supabase caps an unbounded select at 1000 rows — a real company (228+
// active employees here) blows past that within a single month-to-date
// window (confirmed: 1,276 rows for one 24-day range), and since there's
// no explicit order, the rows that get silently dropped are effectively
// arbitrary — in practice the MOST RECENT days, since older rows were
// inserted first and fill the page before today's does. That's exactly
// what caused a real employee's today clock-in to vanish from the
// Attendance Monitoring dashboard despite the underlying row existing.
// Page through in chunks of 1000 instead, same fix already applied to
// jotformSubmissions.ts's getJotformSubmissions for the same reason.
const TIMECARD_ENTRIES_PAGE_SIZE = 1000;

export async function getCompanyTimecardWarnings(
  year: number,
  month: number   // 0-based
): Promise<TimecardWarningRow[]> {
  const mm = String(month + 1).padStart(2, "0");
  const startDate = `${year}-${mm}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
  const today = new Date().toISOString().slice(0, 10);

  // 1. Fetch every profile for the company (we need display_name + off_days).
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, display_name, email, off_days")
    // Only the platform-level SUPERSUPERADMIN is excluded — the per-company
    // SUPERADMIN role is a real employee and should get normal attendance tracking.
    .neq("role", "SUPERSUPERADMIN")
    .eq("is_active", true);
  if (pErr) {
    console.error("getCompanyTimecardWarnings profiles error:", pErr.message);
    return [];
  }

  // 2. Fetch all timecard entries for the company in the requested month —
  // paginated for the same reason as getCompanyTimecardEntries above (a
  // full month for this company's 228+ employees comfortably exceeds
  // Supabase's default 1000-row cap on an unbounded select).
  const entries: Array<{ profile_id: string; work_date: string; check_in: string | null; check_out: string | null }> = [];
  for (let from = 0; ; from += TIMECARD_ENTRIES_PAGE_SIZE) {
    const { data: page, error: eErr } = await supabase
      .from("timecard_entries")
      .select("profile_id, work_date, check_in, check_out")
      .gte("work_date", startDate)
      .lte("work_date", endDate)
      .range(from, from + TIMECARD_ENTRIES_PAGE_SIZE - 1);
    if (eErr) {
      console.error("getCompanyTimecardWarnings entries error:", eErr.message);
      return [];
    }
    entries.push(...((page ?? []) as any));
    if (!page || page.length < TIMECARD_ENTRIES_PAGE_SIZE) break;
  }

  // Group entries by profile_id.
  const byProfile = new Map<string, Array<{ work_date: string; check_in: string | null; check_out: string | null }>>();
  for (const e of entries ?? []) {
    const key = e.profile_id as string;
    if (!byProfile.has(key)) byProfile.set(key, []);
    byProfile.get(key)!.push(e as any);
  }

  // Build the working-day range (Mon–Fri, not in the future).
  const workingDays: string[] = [];
  const d = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (d <= end && d.toISOString().slice(0, 10) <= today) {
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) workingDays.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  const rows: TimecardWarningRow[] = [];
  for (const profile of profiles ?? []) {
    const profileEntries = byProfile.get(profile.id) ?? [];
    const entryByDate = new Map(profileEntries.map((e) => [e.work_date, e]));
    const offDays = new Set<number>((profile.off_days as number[] | null) ?? []);

    let missingEntries = 0;
    let missingCheckIn = 0;
    let missingCheckOut = 0;

    for (const day of workingDays) {
      const dow = new Date(day + "T00:00:00").getDay();
      if (offDays.has(dow)) continue;
      const e = entryByDate.get(day);
      if (!e) {
        missingEntries++;
      } else if (e.check_in && !e.check_out) {
        missingCheckOut++;
      } else if (!e.check_in && e.check_out) {
        missingCheckIn++;
      }
    }

    const totalWarnings = missingEntries + missingCheckIn + missingCheckOut;
    if (totalWarnings > 0) {
      rows.push({
        profileId: profile.id,
        displayName: (profile.display_name as string | null) ?? (profile.email as string),
        email: profile.email as string,
        missingEntries,
        missingCheckIn,
        missingCheckOut,
        totalWarnings,
      });
    }
  }

  return rows.sort((a, b) => b.totalWarnings - a.totalWarnings);
}

/** Raw per-day timecard entry for one profile, used by company-wide reports. */
export interface CompanyTimecardEntry {
  profileId: string;
  workDate: string; // "YYYY-MM-DD"
  checkIn: string;
  checkOut: string;
  mealStart: string;
  mealEnd: string;
  /** Profile id of whoever performed the clock-in, if not the technician themselves (a manager's proxy clock-in). Null for a normal self-punch. */
  clockedInBy: string | null;
}

/**
 * Company-wide raw timecard entries in a date range (inclusive). Unlike
 * getCompanyTimecardWarnings this returns one row per entry, not an
 * aggregated count, so callers (Attendance Monitoring dashboard) can build
 * their own daily/weekly/monthly views and alerts on top of it.
 */
export async function getCompanyTimecardEntries(
  startDate: string,
  endDate: string
): Promise<CompanyTimecardEntry[]> {
  const all: CompanyTimecardEntry[] = [];
  for (let from = 0; ; from += TIMECARD_ENTRIES_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("timecard_entries")
      .select("profile_id, work_date, check_in, check_out, meal_start, meal_end, clocked_in_by")
      .gte("work_date", startDate)
      .lte("work_date", endDate)
      .order("work_date", { ascending: false })
      .range(from, from + TIMECARD_ENTRIES_PAGE_SIZE - 1);
    if (error) {
      console.error("getCompanyTimecardEntries error:", error.message);
      return all;
    }
    all.push(
      ...(data ?? []).map((row: any) => ({
        profileId: row.profile_id as string,
        workDate: row.work_date as string,
        checkIn: row.check_in ?? "",
        checkOut: row.check_out ?? "",
        mealStart: row.meal_start ?? "",
        mealEnd: row.meal_end ?? "",
        clockedInBy: row.clocked_in_by ?? null,
      }))
    );
    if (!data || data.length < TIMECARD_ENTRIES_PAGE_SIZE) break;
  }
  return all;
}
