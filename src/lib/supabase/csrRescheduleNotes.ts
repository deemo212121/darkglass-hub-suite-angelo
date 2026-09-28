/**
 * CSR-editable annotation cells for the Reschedule Requests page (migration
 * 0308) — Phone DX / Rerouted tallies and a free-text Notes column, keyed
 * per (work_date, technician). Neither Phone DX nor Rerouted has any other
 * data source in the app, so CSR tallies them by hand here, same as the
 * paper/spreadsheet worksheet this replaces. The rest of that page's data
 * (Total/Resched) is computed live from real tickets + reschedule-mode
 * Ticket Time Dispute submissions — see CsrRescheduleRequestsPage.tsx.
 */
import { supabase } from "./client";

export interface CsrRescheduleDailyNoteRow {
  id: string;
  workDate: string;
  technician: string;
  area: string | null;
  phoneDx: number;
  rerouted: number;
  notes: string;
  updatedBy: string | null;
  updatedAt: string;
}

function mapRow(r: any): CsrRescheduleDailyNoteRow {
  return {
    id: r.id,
    workDate: r.work_date,
    technician: r.technician,
    area: r.area ?? null,
    phoneDx: Number(r.phone_dx ?? 0),
    rerouted: Number(r.rerouted ?? 0),
    notes: r.notes ?? "",
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at,
  };
}

const ROW_COLUMNS = "id, work_date, technician, area, phone_dx, rerouted, notes, updated_by, updated_at";

/** Every note row for one day, keyed by technician name for O(1) lookup while building the summary table. */
export async function getCsrRescheduleDailyNotes(workDate: string): Promise<Map<string, CsrRescheduleDailyNoteRow>> {
  const { data, error } = await supabase
    .from("csr_reschedule_daily_notes")
    .select(ROW_COLUMNS)
    .eq("work_date", workDate);
  if (error) {
    console.error("getCsrRescheduleDailyNotes error:", error.message);
    return new Map();
  }
  const map = new Map<string, CsrRescheduleDailyNoteRow>();
  for (const row of (data ?? []).map(mapRow)) map.set(row.technician, row);
  return map;
}

/**
 * Upserts one (work_date, technician) row's editable cells — only the
 * fields the caller actually passes get overwritten, so updating just
 * Notes doesn't clobber an already-tallied Phone DX/Rerouted count (or
 * vice versa). Pass the row's CURRENT values for fields you're not
 * changing, same convention as PtoManagementTab's other inline-edit
 * callers — this function itself doesn't merge against what's already in
 * the database.
 */
export async function upsertCsrRescheduleDailyNote(input: {
  workDate: string;
  technician: string;
  area: string | null;
  phoneDx: number;
  rerouted: number;
  notes: string;
  updatedBy: string | null;
}): Promise<CsrRescheduleDailyNoteRow> {
  const { data, error } = await supabase
    .from("csr_reschedule_daily_notes")
    .upsert(
      {
        work_date: input.workDate,
        technician: input.technician,
        area: input.area,
        phone_dx: input.phoneDx,
        rerouted: input.rerouted,
        notes: input.notes,
        updated_by: input.updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,work_date,technician" }
    )
    .select(ROW_COLUMNS)
    .single();
  if (error) {
    console.error("upsertCsrRescheduleDailyNote error:", error.message);
    throw new Error(error.message);
  }
  return mapRow(data);
}
