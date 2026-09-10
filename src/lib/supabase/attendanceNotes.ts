/**
 * Supabase attendance notes service — the note/notify flow on the Attendance
 * Monitoring "Daily Attendance" tab. One note per (profile, day); see
 * migration 0027 for the profile_id column + unique index.
 */

import { supabase } from "./client";

export interface AttendanceNoteRow {
  profileId: string;
  noteDate: string;
  content: string;
  /** HR's own note on this (profile, day) — separate from `content` (the
   *  general/manager-facing note) so saving one never overwrites the
   *  other. See migration 0220. */
  hrNote: string;
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
  createdBy: string | null;
}

// Supabase caps an unbounded select at 1000 rows — a company's attendance
// notes within a date range can exceed that. Page through in chunks of 1000.
const PAGE_SIZE = 1000;

/** All attendance notes in a date range for the caller's company (RLS-scoped). */
export async function getAttendanceNotes(
  startDate: string,
  endDate: string
): Promise<AttendanceNoteRow[]> {
  const all: AttendanceNoteRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("attendance_notes")
      .select("profile_id, note_date, content, hr_note, notify_individual, notify_team_lead, created_by")
      .not("profile_id", "is", null)
      .gte("note_date", startDate)
      .lte("note_date", endDate)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getAttendanceNotes error:", error.message);
      return [];
    }
    all.push(
      ...(data ?? []).map((row: any) => ({
        profileId: row.profile_id,
        noteDate: row.note_date,
        content: row.content ?? "",
        hrNote: row.hr_note ?? "",
        notifyIndividual: Boolean(row.notify_individual),
        notifyTeamLead: Boolean(row.notify_team_lead),
        createdBy: row.created_by ?? null,
      }))
    );
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Create or replace the note for a given profile + day. */
export async function upsertAttendanceNote(input: {
  profileId: string;
  noteDate: string;
  content: string;
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
  createdBy: string | null;
}): Promise<void> {
  const { error } = await supabase.from("attendance_notes").upsert(
    {
      profile_id: input.profileId,
      note_date: input.noteDate,
      content: input.content,
      notify_individual: input.notifyIndividual,
      notify_team_lead: input.notifyTeamLead,
      created_by: input.createdBy,
    },
    { onConflict: "profile_id,note_date" }
  );
  if (error) {
    console.error("upsertAttendanceNote error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Create or replace ONLY the HR note for a given profile + day — a
 * separate slot from `content` (upsertAttendanceNote above), so an HR
 * user saving their own note can never clobber whatever the general/
 * manager note already says, and vice versa. Deliberately omits `content`
 * from the upsert payload entirely (rather than sending it unchanged) so
 * this stays a true partial update on conflict; migration 0220 relaxed
 * `content`'s NOT NULL constraint specifically so a brand-new (profile,
 * day) row can still be created by an HR-only save with no manager note
 * yet on file.
 */
export async function upsertAttendanceHrNote(profileId: string, noteDate: string, hrNote: string, createdBy?: string | null): Promise<void> {
  const payload: Record<string, unknown> = { profile_id: profileId, note_date: noteDate, hr_note: hrNote };
  // Only stamped when given — a missing/unresolved caller id must never
  // null out whoever set this previously, on either the first save or a
  // later edit.
  if (createdBy) payload.created_by = createdBy;
  const { error } = await supabase.from("attendance_notes").upsert(payload, { onConflict: "profile_id,note_date" });
  if (error) {
    console.error("upsertAttendanceHrNote error:", error.message);
    throw new Error(error.message);
  }
}
