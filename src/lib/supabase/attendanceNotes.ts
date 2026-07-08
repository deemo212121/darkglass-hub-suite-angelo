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
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
}

/** All attendance notes in a date range for the caller's company (RLS-scoped). */
export async function getAttendanceNotes(
  startDate: string,
  endDate: string
): Promise<AttendanceNoteRow[]> {
  const { data, error } = await supabase
    .from("attendance_notes")
    .select("profile_id, note_date, content, notify_individual, notify_team_lead")
    .not("profile_id", "is", null)
    .gte("note_date", startDate)
    .lte("note_date", endDate);
  if (error) {
    console.error("getAttendanceNotes error:", error.message);
    return [];
  }
  return (data ?? []).map((row: any) => ({
    profileId: row.profile_id,
    noteDate: row.note_date,
    content: row.content ?? "",
    notifyIndividual: Boolean(row.notify_individual),
    notifyTeamLead: Boolean(row.notify_team_lead),
  }));
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
