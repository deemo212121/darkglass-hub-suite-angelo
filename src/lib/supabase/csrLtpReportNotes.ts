/**
 * LTP Report's "CSR" and "Notes" columns (CsrLtpReport.tsx) — one row per
 * (branch, date): "csr" is whoever's assigned to that branch/task that day
 * (picked from a datalist or freely typed), "note" is a freeform note. See
 * migration 0318: RLS is the "any company member can read/write everything"
 * pattern (this is a shared page every CSR role opens together), not the
 * row-scoped pattern GH Tracker uses.
 */

import { supabase } from "./client";

export interface CsrLtpReportNote {
  id: string;
  branch: string;
  noteDate: string; // "YYYY-MM-DD"
  csr: string | null;
  note: string | null;
  updatedAt: string;
}

const SELECT = "id, branch, note_date, csr, note, updated_at";

function fromRow(r: any): CsrLtpReportNote {
  return { id: r.id, branch: r.branch, noteDate: r.note_date, csr: r.csr, note: r.note, updatedAt: r.updated_at };
}

/** Every branch's row for one date — keyed by branch for CsrLtpReport.tsx's row lookup. */
export async function getLtpReportNotesForDate(noteDate: string): Promise<Map<string, CsrLtpReportNote>> {
  const { data, error } = await supabase
    .from("csr_ltp_report_notes")
    .select(SELECT)
    .eq("note_date", noteDate);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map(fromRow).map((n) => [n.branch, n]));
}

/**
 * Upsert on (branch, note_date) — matches the table's unique constraint.
 * Only the given field is written; the other (csr/note) is left untouched
 * on an existing row, since PostgREST's upsert only SETs columns present in
 * the payload.
 */
export async function upsertLtpReportField(branch: string, noteDate: string, field: "csr" | "note", value: string | null): Promise<void> {
  const { error } = await supabase
    .from("csr_ltp_report_notes")
    .upsert({ branch, note_date: noteDate, [field]: value || null }, { onConflict: "company_id,branch,note_date" });
  if (error) throw new Error(error.message);
}
