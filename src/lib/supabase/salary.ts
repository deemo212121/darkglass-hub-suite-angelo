/**
 * Supabase salary/rate-history service — Accounting Dashboard + Payroll
 * Calculation Dashboard. Rows are keyed by profile_id (see migration 0032),
 * company-scoped by RLS. Each row is a rate that took effect on a given
 * date, so a mid-period raise/promotion is just a new row — day-by-day
 * payroll math picks up whichever rate was effective on each specific day
 * instead of needing a single flat rate per period.
 */

import { supabase } from "./client";

export type SalaryChangeReason = "promotion" | "demotion" | "adjustment" | "initial" | "training_rate";
export type CompensationType = "hourly" | "fixed";

/** Semi-monthly "1st–15th / 16th–end" cutoffs — 2 per month, 24 per year. Fixed-salary pay per cutoff is always annual / 24, regardless of how many days a given payroll run actually covers — see migration 0118. */
export const CUTOFFS_PER_YEAR = 24;
export const MONTHS_PER_YEAR = 12;

export interface SalaryEntryRow {
  id: string;
  profileId: string;
  effectiveDate: string; // "YYYY-MM-DD"
  compensationType: CompensationType;
  hourlyRate: number;
  /** Only set when compensationType is "fixed" — see perCutoffSalary/monthlySalary. */
  annualSalary: number | null;
  reason: SalaryChangeReason;
  notes: string | null;
  createdAt: string;
  /** Who entered this change — null for rows recorded before migration 0116. */
  createdByName: string | null;
}

function mapRow(row: any): SalaryEntryRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    effectiveDate: row.effective_date,
    compensationType: row.compensation_type === "fixed" ? "fixed" : "hourly",
    hourlyRate: Number(row.hourly_rate) || 0,
    annualSalary: row.annual_salary != null ? Number(row.annual_salary) || 0 : null,
    reason: row.reason,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
  };
}

const SELECT_COLUMNS = "id, profile_id, effective_date, compensation_type, hourly_rate, annual_salary, reason, notes, created_at, created_by_name";

/** Full rate-change history for one employee, newest first. */
export async function getSalaryHistory(profileId: string): Promise<SalaryEntryRow[]> {
  const { data, error } = await supabase
    .from("salary_entries")
    .select(SELECT_COLUMNS)
    .eq("profile_id", profileId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getSalaryHistory error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Every rate-change row for the caller's company — used to build a current-rate map for every employee in one query. */
export async function getCompanySalaryEntries(): Promise<SalaryEntryRow[]> {
  const { data, error } = await supabase
    .from("salary_entries")
    .select(SELECT_COLUMNS)
    .not("profile_id", "is", null)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getCompanySalaryEntries error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Record a new rate/salary — a raise/promotion/demotion/adjustment effective from a given date. */
export async function addSalaryEntry(input: {
  profileId: string;
  effectiveDate: string;
  compensationType?: CompensationType; // defaults to "hourly" — matches the column default
  hourlyRate?: number;
  annualSalary?: number;
  reason: SalaryChangeReason;
  notes?: string;
  /** Whoever is entering this change — created_by (the profile id) is auto-stamped server-side from the caller's own session; this is just the display name shown in the history table. */
  createdByName?: string;
}): Promise<void> {
  const { error } = await supabase.from("salary_entries").insert({
    profile_id: input.profileId,
    effective_date: input.effectiveDate,
    compensation_type: input.compensationType ?? "hourly",
    hourly_rate: input.hourlyRate ?? 0,
    annual_salary: input.compensationType === "fixed" ? input.annualSalary ?? 0 : null,
    reason: input.reason,
    notes: input.notes || null,
    created_by_name: input.createdByName || null,
  });
  if (error) {
    console.error("addSalaryEntry error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * The full entry effective on a given date, from a (not-necessarily-sorted)
 * history — null if nothing is effective yet. Use this (rather than
 * rateEffectiveOn) whenever the caller needs to branch on compensationType.
 *
 * Editing a day's rate (Attendance table's inline edit, or Add Rate Change)
 * always INSERTS a new row rather than updating one in place — so the same
 * effectiveDate can end up with several rows (e.g. corrected twice in one
 * sitting). When effectiveDate ties, the most recently CREATED entry wins
 * (falls back to array order for two rows with an identical createdAt,
 * which practically never happens) — otherwise a stale duplicate could win
 * arbitrarily depending on how the DB happened to order the tie, making an
 * edit look like it silently did nothing.
 */
export function entryEffectiveOn(history: SalaryEntryRow[], date: string): SalaryEntryRow | null {
  let best: SalaryEntryRow | null = null;
  for (const entry of history) {
    if (entry.effectiveDate > date) continue;
    if (
      !best ||
      entry.effectiveDate > best.effectiveDate ||
      (entry.effectiveDate === best.effectiveDate && entry.createdAt > best.createdAt)
    ) {
      best = entry;
    }
  }
  return best;
}

/** The hourly rate in effect on a given date. 0 if no entry is effective yet, or if the effective entry is a fixed salary (has no meaningful hourly rate). */
export function rateEffectiveOn(history: SalaryEntryRow[], date: string): number {
  const entry = entryEffectiveOn(history, date);
  return entry && entry.compensationType === "hourly" ? entry.hourlyRate : 0;
}

/** The rate in effect today. */
export function currentRate(history: SalaryEntryRow[]): number {
  return rateEffectiveOn(history, new Date().toISOString().slice(0, 10));
}

/** Per-cutoff pay for a fixed annual salary — always annual / 24, regardless of the exact period a payroll run covers (see migration 0118's header comment). */
export function perCutoffSalary(annualSalary: number): number {
  return annualSalary / CUTOFFS_PER_YEAR;
}

/** Monthly pay for a fixed annual salary — annual / 12. */
export function monthlySalary(annualSalary: number): number {
  return annualSalary / MONTHS_PER_YEAR;
}
