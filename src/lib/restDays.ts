/**
 * "Rest days on this date" — rest days with an effective-from date
 * (rest_day_history, migration 0371), so changing someone's rest days in
 * October doesn't turn their September rest days into absences.
 *
 * Pure (no Supabase client) so the Worker can share it.
 */

export interface RestDayPeriod {
  /** YYYY-MM-DD — first day this schedule applies. */
  from: string;
  /** Date.getDay() indices (0 = Sunday). */
  offDays: number[];
}

/** profileId → schedules, oldest first. */
export type RestDayHistory = Map<string, RestDayPeriod[]>;

export function buildRestDayHistory(rows: { profile_id: string; off_days: number[] | null; effective_from: string }[]): RestDayHistory {
  const map: RestDayHistory = new Map();
  for (const r of rows) {
    const list = map.get(r.profile_id) ?? [];
    list.push({ from: r.effective_from.slice(0, 10), offDays: r.off_days ?? [] });
    map.set(r.profile_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.from.localeCompare(b.from));
  return map;
}

/**
 * The rest days in force on `date` for this employee: the latest schedule
 * that started on or before it. No history (or 0371 not run yet) → their
 * current `fallback` (profiles.off_days), exactly as before.
 */
export function offDaysOn(history: RestDayHistory | null | undefined, profileId: string, date: string, fallback: number[] | null | undefined): number[] {
  const list = history?.get(profileId);
  if (!list || list.length === 0) return fallback ?? [];
  let current: number[] | null = null;
  for (const p of list) {
    if (p.from <= date) current = p.offDays;
    else break;
  }
  // A date before their earliest recorded schedule: use the earliest one.
  return current ?? list[0].offDays;
}

/** Is `date` (YYYY-MM-DD) one of this employee's rest days, by the schedule in force that day? */
export function isRestDayOn(history: RestDayHistory | null | undefined, profileId: string, date: string, fallback: number[] | null | undefined): boolean {
  const dow = new Date(`${date}T00:00:00`).getDay();
  return offDaysOn(history, profileId, date, fallback).includes(dow);
}
