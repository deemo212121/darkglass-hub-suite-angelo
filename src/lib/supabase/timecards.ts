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
