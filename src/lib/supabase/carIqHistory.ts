/**
 * Car IQ History (AccountingDashboard.tsx's Car IQ tab) — an effective-dated
 * log of a technician's Car IQ on/off status, mirroring salary.ts's own
 * effective-dated rate pattern. employee_info.hasCarIq (users.ts's
 * setEmployeeHasCarIq) stays the fast "is it on right now" flag used
 * everywhere else (eligibility filters, the tab's own toggle display) — this
 * table is what a payroll period reads to detect a mid-period switch and
 * split mileage pay across the two rates (see mileageCarIqSplitFor in
 * AccountingDashboard.tsx). See migration 0323.
 */

import { supabase } from "./client";

export interface CarIqHistoryEntry {
  id: string;
  profileId: string;
  effectiveDate: string; // "YYYY-MM-DD"
  hasCarIq: boolean;
  changedByName: string | null;
  createdAt: string;
}

const SELECT = "id, profile_id, effective_date, has_car_iq, changed_by_name, created_at";
const PAGE_SIZE = 1000;

function fromRow(r: any): CarIqHistoryEntry {
  return { id: r.id, profileId: r.profile_id, effectiveDate: r.effective_date, hasCarIq: r.has_car_iq, changedByName: r.changed_by_name, createdAt: r.created_at };
}

/** Every profile's full Car IQ history, company-wide — paged the same way getCompanySalaryEntries is. */
export async function getCompanyCarIqHistory(): Promise<CarIqHistoryEntry[]> {
  const all: CarIqHistoryEntry[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("car_iq_history")
      .select(SELECT)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getCompanyCarIqHistory error:", error.message);
      return all;
    }
    all.push(...(data ?? []).map(fromRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Record a Car IQ on/off change effective from a given date — same upsert-by-(profile,date) shape as a Salary History entry. Returns the saved row (with its real id) so a caller doing an optimistic local update isn't left holding a blank id. */
export async function addCarIqHistoryEntry(profileId: string, effectiveDate: string, hasCarIq: boolean, changedByName: string | null): Promise<CarIqHistoryEntry> {
  const { data, error } = await supabase
    .from("car_iq_history")
    .upsert({ profile_id: profileId, effective_date: effectiveDate, has_car_iq: hasCarIq, changed_by_name: changedByName }, { onConflict: "profile_id,effective_date" })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

/**
 * Move an existing entry's effective date — e.g. correcting a backdated
 * entry that was first logged under "today" before the real install/
 * removal date was known. Distinct from addCarIqHistoryEntry's upsert
 * (which targets a NEW (profile, date) pair) since this changes which date
 * an already-saved row lives at.
 */
export async function updateCarIqHistoryEffectiveDate(entryId: string, effectiveDate: string): Promise<void> {
  const { error } = await supabase.from("car_iq_history").update({ effective_date: effectiveDate }).eq("id", entryId);
  if (error) throw new Error(error.message);
}

/** The most recent entry effective on or before `date` — same "latest entry at or before" rule as salary.ts's entryEffectiveOn. */
export function carIqEntryEffectiveOn(history: CarIqHistoryEntry[], profileId: string, date: string): CarIqHistoryEntry | null {
  let best: CarIqHistoryEntry | null = null;
  for (const entry of history) {
    if (entry.profileId !== profileId || entry.effectiveDate > date) continue;
    if (!best || entry.effectiveDate > best.effectiveDate || (entry.effectiveDate === best.effectiveDate && entry.createdAt > best.createdAt)) {
      best = entry;
    }
  }
  return best;
}

/**
 * Every effective-date boundary strictly inside (dateFrom, dateTo] where
 * this profile's Car IQ status actually changed — i.e. the switch points a
 * payroll period needs to split its mileage line at. Empty when the status
 * was constant throughout the period (the common case — no split needed).
 */
export function carIqSwitchDatesInRange(history: CarIqHistoryEntry[], profileId: string, dateFrom: string, dateTo: string): string[] {
  return history
    .filter((e) => e.profileId === profileId && e.effectiveDate > dateFrom && e.effectiveDate <= dateTo)
    .map((e) => e.effectiveDate)
    .sort();
}
