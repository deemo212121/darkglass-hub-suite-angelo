/**
 * rest_day_history (migration 0371) — rest days with an "effective from"
 * date. See src/lib/restDays.ts for how pages use it. Every read falls back
 * gracefully (empty history → current profiles.off_days) if 0371 hasn't
 * been run yet.
 */
import { supabase } from "./client";
import { buildRestDayHistory, type RestDayHistory } from "@/lib/restDays";

export interface RestDayHistoryRow {
  id: string;
  profileId: string;
  offDays: number[];
  effectiveFrom: string;
  changedBy: string | null;
  createdAt: string;
}

const PAGE_SIZE = 1000;

/** Whole company's history (RLS-scoped), for pages that look at many employees. */
export async function getRestDayHistory(): Promise<RestDayHistory> {
  const rows: { profile_id: string; off_days: number[] | null; effective_from: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("rest_day_history")
      .select("profile_id, off_days, effective_from")
      .order("profile_id", { ascending: true })
      .order("effective_from", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      // 0371 not run yet — pages fall back to profiles.off_days.
      console.warn("getRestDayHistory:", error.message);
      return new Map();
    }
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return buildRestDayHistory(rows);
}

/** One employee's schedules, oldest first — for the history box on their edit page. */
export async function getRestDayHistoryFor(profileId: string): Promise<RestDayHistoryRow[]> {
  const { data, error } = await supabase
    .from("rest_day_history")
    .select("id, profile_id, off_days, effective_from, changed_by, created_at")
    .eq("profile_id", profileId)
    .order("effective_from", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    profileId: r.profile_id,
    offDays: r.off_days ?? [],
    effectiveFrom: r.effective_from,
    changedBy: r.changed_by ?? null,
    createdAt: r.created_at,
  }));
}

/**
 * Change someone's rest days starting on `effectiveFrom` (YYYY-MM-DD).
 * Days before it keep the schedule they had. Falls back to a plain update
 * (recorded as effective today) if 0371's function isn't there yet.
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
 * Add (or replace) one schedule in someone's history — e.g. HR entering the
 * rest days they had before a change made before this history existed.
 * Doesn't touch their current rest days.
 */
export async function upsertRestDayPeriod(profileId: string, companyId: string, offDays: number[], effectiveFrom: string, changedBy: string | null): Promise<void> {
  const { error } = await supabase
    .from("rest_day_history")
    .upsert(
      { profile_id: profileId, company_id: companyId, off_days: offDays, effective_from: effectiveFrom, changed_by: changedBy },
      { onConflict: "profile_id,effective_from" }
    );
  if (error) throw new Error(error.message);
}

export async function deleteRestDayPeriod(id: string): Promise<void> {
  const { error } = await supabase.from("rest_day_history").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
