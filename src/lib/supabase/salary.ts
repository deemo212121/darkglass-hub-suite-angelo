/**
 * Supabase salary/rate-history service — Accounting Dashboard + Payroll
 * Calculation Dashboard. Rows are keyed by profile_id (see migration 0032),
 * company-scoped by RLS. Each row is a rate that took effect on a given
 * date, so a mid-period raise/promotion is just a new row — day-by-day
 * payroll math picks up whichever rate was effective on each specific day
 * instead of needing a single flat rate per period.
 */

import { supabase } from "./client";

export type SalaryChangeReason = "promotion" | "demotion" | "adjustment" | "initial";

export interface SalaryEntryRow {
  id: string;
  profileId: string;
  effectiveDate: string; // "YYYY-MM-DD"
  hourlyRate: number;
  reason: SalaryChangeReason;
  notes: string | null;
  createdAt: string;
}

function mapRow(row: any): SalaryEntryRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    effectiveDate: row.effective_date,
    hourlyRate: Number(row.hourly_rate) || 0,
    reason: row.reason,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}

/** Full rate-change history for one employee, newest first. */
export async function getSalaryHistory(profileId: string): Promise<SalaryEntryRow[]> {
  const { data, error } = await supabase
    .from("salary_entries")
    .select("id, profile_id, effective_date, hourly_rate, reason, notes, created_at")
    .eq("profile_id", profileId)
    .order("effective_date", { ascending: false });
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
    .select("id, profile_id, effective_date, hourly_rate, reason, notes, created_at")
    .not("profile_id", "is", null)
    .order("effective_date", { ascending: false });
  if (error) {
    console.error("getCompanySalaryEntries error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Record a new rate — a raise/promotion/demotion/adjustment effective from a given date. */
export async function addSalaryEntry(input: {
  profileId: string;
  effectiveDate: string;
  hourlyRate: number;
  reason: SalaryChangeReason;
  notes?: string;
}): Promise<void> {
  const { error } = await supabase.from("salary_entries").insert({
    profile_id: input.profileId,
    effective_date: input.effectiveDate,
    hourly_rate: input.hourlyRate,
    reason: input.reason,
    notes: input.notes || null,
  });
  if (error) {
    console.error("addSalaryEntry error:", error.message);
    throw new Error(error.message);
  }
}

/** The rate in effect on a given date, from a (not-necessarily-sorted) history. 0 if no entry is effective yet. */
export function rateEffectiveOn(history: SalaryEntryRow[], date: string): number {
  let best: SalaryEntryRow | null = null;
  for (const entry of history) {
    if (entry.effectiveDate > date) continue;
    if (!best || entry.effectiveDate > best.effectiveDate) best = entry;
  }
  return best?.hourlyRate ?? 0;
}

/** The rate in effect today. */
export function currentRate(history: SalaryEntryRow[]): number {
  return rateEffectiveOn(history, new Date().toISOString().slice(0, 10));
}
