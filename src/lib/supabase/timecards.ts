/**
 * Supabase timecards service — the logged-in user's personal timecard.
 * Entries are keyed by the caller's profile + work date, company-scoped by RLS.
 */

import { supabase } from "./client";

// The flat UI time-entry shape used by the timecard page.
export interface UITimeEntry {
  checkIn: string;
  checkOut: string;
  mealStart: string;
  mealEnd: string;
  notes: string;
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
}> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, required_check_in, required_check_out")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (error) {
    console.error("getMyProfileSchedule error:", error.message);
    return { profileId: null, requiredCheckIn: "", requiredCheckOut: "", workingHours: null, mealMinutes: null };
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

  return {
    profileId: data?.id ?? null,
    requiredCheckIn: data?.required_check_in ?? "",
    requiredCheckOut: data?.required_check_out ?? "",
    workingHours,
    mealMinutes,
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
      },
      { onConflict: "profile_id,work_date" }
    );
  if (error) {
    console.error("saveEntry error:", error.message);
    throw new Error(error.message);
  }
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
  let hrs = hoursBetween(entry.checkIn, entry.checkOut);
  if (entry.mealStart && entry.mealEnd) {
    hrs -= hoursBetween(entry.mealStart, entry.mealEnd);
  }
  return Math.max(0, hrs);
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
  /** "missing-meal": clocked a full in/out day, was meal-eligible (scheduled shift > 6h), but never completed Meal In + Meal Out. Not blocked at punch time — just recorded here so HR/managers can see it. */
  status: "present" | "absent" | "missing-in" | "missing-out" | "missing-meal";
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
  scheduled: { requiredCheckIn?: string; requiredCheckOut?: string; workingHours?: number | null; mealMinutes?: number | null; daysOff?: number[] } = {}
): Promise<AttendanceRow[]> {
  const { data, error } = await supabase
    .from("timecard_entries")
    .select("work_date, check_in, check_out, meal_start, meal_end")
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
  // Same rule as the timecard punch flows (TimeClockMenu.tsx / routes/timecard.tsx):
  // a scheduled shift over 6 hours is meal-eligible. Punching no longer BLOCKS
  // timing out without a meal — this is just where that gets recorded instead.
  const mealEligible =
    resolveScheduledShiftHours(scheduled.requiredCheckIn ?? "", scheduled.requiredCheckOut ?? "", scheduled.workingHours, scheduled.mealMinutes) > 6;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;
    const dow = d.getDay();
    const isOffDay = daysOff.has(dow);
    const row = byDate.get(key);
    if (!row) {
      // No timecard entry. Skip days that are explicitly off so we don't
      // alarm users about weekends/RDOs. Future days are also skipped.
      const isFuture = key > new Date().toISOString().slice(0, 10);
      if (!isOffDay && !isFuture) {
        rows.push({
          date: key,
          clockIn: "",
          clockOut: "",
          mealStart: "",
          mealEnd: "",
          hoursWorked: 0,
          status: "absent",
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
    let status: AttendanceRow["status"] = "present";
    if (entry.checkIn && !entry.checkOut) status = "missing-out";
    else if (!entry.checkIn && entry.checkOut) status = "missing-in";
    else if (entry.checkIn && entry.checkOut && mealEligible && !(entry.mealStart && entry.mealEnd)) status = "missing-meal";
    rows.push({
      date: key,
      clockIn: entry.checkIn,
      clockOut: entry.checkOut,
      mealStart: entry.mealStart,
      mealEnd: entry.mealEnd,
      hoursWorked: calcWorkedHours(entry),
      status,
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

  // 2. Fetch all timecard entries for the company in the requested month.
  const { data: entries, error: eErr } = await supabase
    .from("timecard_entries")
    .select("profile_id, work_date, check_in, check_out")
    .gte("work_date", startDate)
    .lte("work_date", endDate);
  if (eErr) {
    console.error("getCompanyTimecardWarnings entries error:", eErr.message);
    return [];
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
  const { data, error } = await supabase
    .from("timecard_entries")
    .select("profile_id, work_date, check_in, check_out, meal_start, meal_end, clocked_in_by")
    .gte("work_date", startDate)
    .lte("work_date", endDate);
  if (error) {
    console.error("getCompanyTimecardEntries error:", error.message);
    return [];
  }
  return (data ?? []).map((row: any) => ({
    profileId: row.profile_id as string,
    workDate: row.work_date as string,
    checkIn: row.check_in ?? "",
    checkOut: row.check_out ?? "",
    mealStart: row.meal_start ?? "",
    mealEnd: row.meal_end ?? "",
    clockedInBy: row.clocked_in_by ?? null,
  }));
}
