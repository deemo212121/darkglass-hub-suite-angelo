/**
 * "Schedule on this date" — rest days and Time In / Time Out Required with
 * an effective-from date (rest_day_history, migrations 0373 + 0375), so
 * changing someone's schedule in October doesn't re-judge September: their
 * September rest days don't become absences, and their September punches
 * aren't measured against October's required times.
 *
 * Pure (no Supabase client) so the Worker can share it.
 */

export interface RestDayPeriod {
  /** YYYY-MM-DD — first day this schedule applies. */
  from: string;
  /** Date.getDay() indices (0 = Sunday). */
  offDays: number[];
  /** Time In / Time Out Required in force from `from` ("HH:MM"). null = not recorded (0375 not run, or blank) → fall back to the current value. */
  checkIn?: string | null;
  checkOut?: string | null;
}

/** profileId → schedules, oldest first. */
export type RestDayHistory = Map<string, RestDayPeriod[]>;

export function buildRestDayHistory(
  rows: { profile_id: string; off_days: number[] | null; effective_from: string; required_check_in?: string | null; required_check_out?: string | null }[]
): RestDayHistory {
  const map: RestDayHistory = new Map();
  for (const r of rows) {
    const list = map.get(r.profile_id) ?? [];
    list.push({
      from: r.effective_from.slice(0, 10),
      offDays: r.off_days ?? [],
      checkIn: r.required_check_in ?? null,
      checkOut: r.required_check_out ?? null,
    });
    map.set(r.profile_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.from.localeCompare(b.from));
  return map;
}

/** The schedule period in force on `date`: the latest that started on or before it (or the earliest, for a date before any). */
function periodOn(history: RestDayHistory | null | undefined, profileId: string, date: string): RestDayPeriod | null {
  const list = history?.get(profileId);
  if (!list || list.length === 0) return null;
  let current: RestDayPeriod | null = null;
  for (const p of list) {
    if (p.from <= date) current = p;
    else break;
  }
  return current ?? list[0];
}

/**
 * The rest days in force on `date` for this employee. No history (or 0373
 * not run yet) → their current `fallback` (profiles.off_days), exactly as before.
 */
export function offDaysOn(history: RestDayHistory | null | undefined, profileId: string, date: string, fallback: number[] | null | undefined): number[] {
  return periodOn(history, profileId, date)?.offDays ?? fallback ?? [];
}

/** Is `date` (YYYY-MM-DD) one of this employee's rest days, by the schedule in force that day? */
export function isRestDayOn(history: RestDayHistory | null | undefined, profileId: string, date: string, fallback: number[] | null | undefined): boolean {
  const dow = new Date(`${date}T00:00:00`).getDay();
  return offDaysOn(history, profileId, date, fallback).includes(dow);
}

/**
 * Time In / Time Out Required in force on `date`. Falls back to the current
 * values (profiles.required_check_in/out) when the history doesn't have
 * them — no history, 0375 not run yet, or a period recorded before 0375.
 */
export function requiredTimesOn(
  history: RestDayHistory | null | undefined,
  profileId: string,
  date: string,
  fallback: { checkIn?: string | null; checkOut?: string | null }
): { checkIn: string; checkOut: string } {
  const p = periodOn(history, profileId, date);
  const hasTimes = !!p && (p.checkIn != null || p.checkOut != null);
  return {
    checkIn: (hasTimes ? p!.checkIn : fallback.checkIn) || "",
    checkOut: (hasTimes ? p!.checkOut : fallback.checkOut) || "",
  };
}
