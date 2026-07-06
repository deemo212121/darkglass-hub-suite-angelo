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

/** Get the caller's profile id + required scheduled shift times. */
export async function getMyProfileSchedule(firebaseUid: string): Promise<{
  profileId: string | null;
  requiredCheckIn: string;
  requiredCheckOut: string;
}> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, required_check_in, required_check_out")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (error) {
    console.error("getMyProfileSchedule error:", error.message);
    return { profileId: null, requiredCheckIn: "", requiredCheckOut: "" };
  }
  return {
    profileId: data?.id ?? null,
    requiredCheckIn: data?.required_check_in ?? "",
    requiredCheckOut: data?.required_check_out ?? "",
  };
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

/**
 * Upsert a single day's timecard entry for the caller's profile.
 * company_id is auto-stamped by the set_company_id trigger.
 */
export async function saveEntry(
  profileId: string,
  workDate: string,
  entry: UITimeEntry
): Promise<void> {
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
 * Compute hours worked between two HH:MM strings, accounting for an optional
 * meal break. Mirrors the math used by the personal timecard page so the
 * self-service Attendance tab agrees with the timecard.
 */
function hoursBetween(t1: string, t2: string): number {
  if (!t1 || !t2) return 0;
  const [h1, m1] = t1.split(":").map(Number);
  const [h2, m2] = t2.split(":").map(Number);
  return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
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
  hoursWorked: number;
  status: "present" | "absent" | "missing-in" | "missing-out";
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
  scheduled: { requiredCheckIn?: string; requiredCheckOut?: string; daysOff?: number[] } = {}
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
    rows.push({
      date: key,
      clockIn: entry.checkIn,
      clockOut: entry.checkOut,
      hoursWorked: calcWorkedHours(entry),
      status,
    });
  }
  // Tag scheduled lookup unused-var to make linters happy without dropping
  // it from the public API. The arg is reserved for future late/early checks.
  void scheduled.requiredCheckIn;
  void scheduled.requiredCheckOut;
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
    .neq("role", "SUPERADMIN")
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
