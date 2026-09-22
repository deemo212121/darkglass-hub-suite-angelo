/**
 * Per-technician, per-day manual corrections to the Technician
 * Performance Report (TechnicianPerformanceReport.tsx) — see migration
 * 0299 for the full schema/semantics. Keyed by a single calendar date
 * (not the report's Weekly/Monthly/Custom period range) so a correction
 * keeps applying correctly no matter what date range later contains that
 * day.
 */
import { supabase } from "./client";

export interface DailyPerformanceOverride {
  totalTickets: number | null;
  /** Not a "replace this day" figure like the other 3 — see migration 0300: the technician's whole period total is the SUM of every set redoCount across the period, since redo has no day-level live breakdown to replace one day of. */
  redoCount: number | null;
  miles: number | null;
  hoursWorked: number | null;
  setByName: string | null;
  setAt: string;
}

// Supabase caps an unbounded select at 1000 rows — a multi-month custom
// range across dozens of technicians can exceed that. Page through in
// chunks of 1000 (same pattern used elsewhere in this codebase, e.g.
// signableDocuments.ts).
const PAGE_SIZE = 1000;

/** profileId -> workDate (YYYY-MM-DD) -> override, for every day in [startDate, endDate] that has at least one corrected figure. */
export async function getTechnicianPerformanceOverrides(
  startDate: string,
  endDate: string
): Promise<Map<string, Map<string, DailyPerformanceOverride>>> {
  const out = new Map<string, Map<string, DailyPerformanceOverride>>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("technician_daily_performance_overrides")
      .select("profile_id, work_date, total_tickets, redo_count, miles, hours_worked, set_by_name, set_at")
      .gte("work_date", startDate)
      .lte("work_date", endDate)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{
      profile_id: string;
      work_date: string;
      total_tickets: number | null;
      redo_count: number | null;
      miles: number | null;
      hours_worked: number | null;
      set_by_name: string | null;
      set_at: string;
    }>) {
      if (!out.has(r.profile_id)) out.set(r.profile_id, new Map());
      out.get(r.profile_id)!.set(r.work_date, {
        totalTickets: r.total_tickets,
        redoCount: r.redo_count,
        miles: r.miles,
        hoursWorked: r.hours_worked,
        setByName: r.set_by_name,
        setAt: r.set_at,
      });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

export interface DailyPerformanceOverrideInput {
  profileId: string;
  workDate: string;
  totalTickets?: number | null;
  redoCount?: number | null;
  miles?: number | null;
  hoursWorked?: number | null;
}

/** Replaces (upserts) one day's correction for one technician. Only the fields actually passed are written — omit a field to leave it untouched rather than clearing it. */
export async function bulkUpsertTechnicianPerformanceOverrides(
  rows: DailyPerformanceOverrideInput[],
  setByName: string | null
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    profile_id: r.profileId,
    work_date: r.workDate,
    ...("totalTickets" in r ? { total_tickets: r.totalTickets } : {}),
    ...("redoCount" in r ? { redo_count: r.redoCount } : {}),
    ...("miles" in r ? { miles: r.miles } : {}),
    ...("hoursWorked" in r ? { hours_worked: r.hoursWorked } : {}),
    set_by_name: setByName,
  }));
  // Supabase's own upsert batch size isn't officially capped the way a
  // plain select's row limit is, but chunking keeps one CSV import (which
  // can span dozens of technicians times a full month) from becoming a
  // single giant request.
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await supabase
      .from("technician_daily_performance_overrides")
      .upsert(payload.slice(i, i + CHUNK), { onConflict: "company_id,profile_id,work_date" });
    if (error) throw new Error(error.message);
  }
}

export async function clearTechnicianPerformanceOverride(profileId: string, workDate: string): Promise<void> {
  const { error } = await supabase
    .from("technician_daily_performance_overrides")
    .delete()
    .eq("profile_id", profileId)
    .eq("work_date", workDate);
  if (error) throw new Error(error.message);
}
