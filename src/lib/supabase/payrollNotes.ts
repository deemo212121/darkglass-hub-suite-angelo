/**
 * A note from Payroll to one employee for one pay period (migration 0399)
 * — e.g. "You were overpaid by $138.79. It will be deducted from your next
 * pay." Written in Accounting Dashboard → Payroll History; shown in
 * Self-Service → My Payroll until the employee clicks "I've read this".
 * Keyed by period, not payroll run, so it survives a regenerate.
 */
import { supabase } from "./client";

export interface PayrollNote {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  body: string;
  createdByName: string | null;
  /** When the text was last written/changed. */
  updatedAt: string;
  /** When the employee clicked "I've read this"; cleared whenever the text changes. */
  acknowledgedAt: string | null;
}

const COLUMNS = "id, profile_id, period_start, period_end, body, created_by_name, updated_at, acknowledged_at";

const friendly = (message: string) =>
  /payroll_employee_notes|acknowledge_payroll_note/i.test(message) && /does not exist|schema cache|not find/i.test(message)
    ? "Payroll notes need database migration 0399 — ask an admin to run it."
    : message;

function mapRow(r: any): PayrollNote {
  return {
    id: r.id,
    profileId: r.profile_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    body: r.body ?? "",
    createdByName: r.created_by_name ?? null,
    updatedAt: r.updated_at,
    acknowledgedAt: r.acknowledged_at ?? null,
  };
}

/** Every note for one pay period, by profile id — Payroll History. */
export async function getPayrollNotesForPeriod(periodStart: string, periodEnd: string): Promise<Map<string, PayrollNote>> {
  const { data, error } = await supabase
    .from("payroll_employee_notes")
    .select(COLUMNS)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(friendly(error.message));
  return new Map((data ?? []).map((r) => [r.profile_id as string, mapRow(r)]));
}

/** The signed-in employee's own notes, newest period first — Self-Service. */
export async function getMyPayrollNotes(profileId: string): Promise<PayrollNote[]> {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("payroll_employee_notes")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .neq("body", "")
    .order("period_start", { ascending: false });
  if (error) throw new Error(friendly(error.message));
  return (data ?? []).map(mapRow);
}

/** Create or replace the note; an empty body deletes it. Returns the saved note, or null when deleted. */
export async function savePayrollNote(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  body: string,
  by: { id: string | null; name: string | null }
): Promise<PayrollNote | null> {
  const text = body.trim();
  if (!text) {
    const { error } = await supabase
      .from("payroll_employee_notes")
      .delete()
      .eq("profile_id", profileId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd);
    if (error) throw new Error(friendly(error.message));
    return null;
  }
  const { data, error } = await supabase
    .from("payroll_employee_notes")
    .upsert(
      { profile_id: profileId, period_start: periodStart, period_end: periodEnd, body: text, created_by: by.id, created_by_name: by.name },
      { onConflict: "company_id,profile_id,period_start,period_end" }
    )
    .select(COLUMNS)
    .single();
  if (error) throw new Error(friendly(error.message));
  return mapRow(data);
}

/** The employee's "I've read this" — only stamps their own note. */
export async function acknowledgePayrollNote(noteId: string): Promise<void> {
  const { error } = await supabase.rpc("acknowledge_payroll_note", { p_note_id: noteId });
  if (error) throw new Error(friendly(error.message));
}
