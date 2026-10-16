/**
 * rest_day_history (migrations 0373 + 0375) — rest days and Time In / Time
 * Out Required with an "effective from" date. See src/lib/restDays.ts for
 * how pages use it. Every read falls back gracefully (empty history, or no
 * times → current profiles values) if 0373 / 0375 haven't been run yet.
 */
import { supabase } from "./client";
import { buildRestDayHistory, type RestDayHistory } from "@/lib/restDays";

export interface RestDayHistoryRow {
  id: string;
  profileId: string;
  offDays: number[];
  /** null = not recorded (before 0375). */
  checkIn: string | null;
  checkOut: string | null;
  effectiveFrom: string;
  changedBy: string | null;
  createdAt: string;
}

const PAGE_SIZE = 1000;

type HistoryRow = { profile_id: string; off_days: number[] | null; effective_from: string; required_check_in?: string | null; required_check_out?: string | null };

async function fetchAllHistory(columns: string): Promise<{ rows: HistoryRow[]; error: string | null }> {
  const rows: HistoryRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("rest_day_history")
      .select(columns)
      .order("profile_id", { ascending: true })
      .order("effective_from", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as unknown as HistoryRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
}

/** Whole company's history (RLS-scoped), for pages that look at many employees. */
export async function getRestDayHistory(): Promise<RestDayHistory> {
  let res = await fetchAllHistory("profile_id, off_days, effective_from, required_check_in, required_check_out");
  // 0375 not run yet — rest days only (times fall back to the current ones).
  if (res.error) res = await fetchAllHistory("profile_id, off_days, effective_from");
  if (res.error) {
    // 0373 not run yet — pages fall back to profiles.off_days.
    console.warn("getRestDayHistory:", res.error);
    return new Map();
  }
  return buildRestDayHistory(res.rows);
}

/** One employee's schedules, oldest first — for the history box on their edit page. */
export async function getRestDayHistoryFor(profileId: string): Promise<RestDayHistoryRow[]> {
  const query = (columns: string) =>
    supabase.from("rest_day_history").select(columns).eq("profile_id", profileId).order("effective_from", { ascending: true });
  let { data, error } = await query("id, profile_id, off_days, required_check_in, required_check_out, effective_from, changed_by, created_at");
  if (error) ({ data, error } = await query("id, profile_id, off_days, effective_from, changed_by, created_at"));
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    offDays: r.off_days ?? [],
    checkIn: r.required_check_in ?? null,
    checkOut: r.required_check_out ?? null,
    effectiveFrom: r.effective_from,
    changedBy: r.changed_by ?? null,
    createdAt: r.created_at,
  }));
}

/**
 * Change someone's rest days starting on `effectiveFrom` (YYYY-MM-DD).
 * Days before it keep the schedule they had. Falls back to a plain update
 * (recorded as effective today) if 0373's function isn't there yet.
 */
export async function setProfileRestDays(profileId: string, offDays: number[], effectiveFrom: string): Promise<void> {
  const { error } = await supabase.rpc("set_profile_rest_days", {
    p_profile_id: profileId,
    p_off_days: offDays,
    p_effective_from: effectiveFrom,
  });
  if (!error) return;
  if (!/set_profile_rest_days|function/i.test(error.message)) throw new Error(error.message);
  const { error: e2 } = await supabase.from("profiles").update({ off_days: offDays }).eq("id", profileId);
  if (e2) throw new Error(e2.message);
}

/**
 * Change someone's rest days and/or Time In / Time Out Required starting on
 * `effectiveFrom` (YYYY-MM-DD). Days before it keep the schedule they had.
 * Falls back to a plain update (recorded as effective today) if 0375's
 * function isn't there yet.
 */
export async function setProfileSchedule(
  profileId: string,
  offDays: number[],
  checkIn: string | null,
  checkOut: string | null,
  effectiveFrom: string
): Promise<void> {
  const { error } = await supabase.rpc("set_profile_schedule", {
    p_profile_id: profileId,
    p_off_days: offDays,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_effective_from: effectiveFrom,
  });
  if (!error) return;
  if (!/set_profile_schedule|function/i.test(error.message)) throw new Error(error.message);
  const { error: e2 } = await supabase
    .from("profiles")
    .update({ off_days: offDays, required_check_in: checkIn, required_check_out: checkOut })
    .eq("id", profileId);
  if (e2) throw new Error(e2.message);
}

/**
 * Add (or replace) one schedule in someone's history — e.g. HR entering the
 * rest days / times they had before a change made before this history
 * existed. Doesn't touch their current schedule.
 */
export async function upsertRestDayPeriod(
  profileId: string,
  companyId: string,
  offDays: number[],
  effectiveFrom: string,
  changedBy: string | null,
  times?: { checkIn: string | null; checkOut: string | null }
): Promise<void> {
  const row: Record<string, unknown> = { profile_id: profileId, company_id: companyId, off_days: offDays, effective_from: effectiveFrom, changed_by: changedBy };
  if (times) {
    row.required_check_in = times.checkIn;
    row.required_check_out = times.checkOut;
  }
  const { error } = await supabase.from("rest_day_history").upsert(row, { onConflict: "profile_id,effective_from" });
  if (error) throw new Error(error.message);
}

export async function deleteRestDayPeriod(id: string): Promise<void> {
  const { error } = await supabase.from("rest_day_history").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
