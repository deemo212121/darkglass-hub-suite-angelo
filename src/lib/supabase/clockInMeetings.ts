/**
 * Missed technician clock-ins → "meeting required" (migration 0348). Rows
 * are written by the Worker's hourly job (missedClockInMeetings.ts); the
 * people who can see the daily clock-in code mark them done. Each row is
 * 1 error on the Technician Performance Report, done or not.
 */
import { supabase } from "./client";

export interface ClockInMeeting {
  id: string;
  profileId: string;
  missedDate: string;
  status: "required" | "done";
  doneByName: string | null;
  doneAt: string | null;
  note: string | null;
}

const COLUMNS = "id, profile_id, missed_date, status, done_by_name, done_at, note";

function mapRow(r: any): ClockInMeeting {
  return {
    id: r.id,
    profileId: r.profile_id,
    missedDate: r.missed_date,
    status: r.status === "done" ? "done" : "required",
    doneByName: r.done_by_name ?? null,
    doneAt: r.done_at ?? null,
    note: r.note ?? null,
  };
}

/** Missed clock-ins (done or not) in a date range. Empty if migration 0348 isn't run yet. */
export async function getClockInMeetingsInRange(startDate: string, endDate: string): Promise<ClockInMeeting[]> {
  const { data, error } = await supabase
    .from("clock_in_meetings")
    .select(COLUMNS)
    .gte("missed_date", startDate)
    .lte("missed_date", endDate)
    .order("missed_date", { ascending: false })
    .limit(5000);
  if (error) {
    console.warn("getClockInMeetingsInRange:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Meetings still to hold, oldest first. */
export async function getPendingClockInMeetings(): Promise<ClockInMeeting[]> {
  const { data, error } = await supabase
    .from("clock_in_meetings")
    .select(COLUMNS)
    .eq("status", "required")
    .order("missed_date", { ascending: true })
    .limit(500);
  if (error) {
    console.warn("getPendingClockInMeetings:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

export async function markClockInMeetingDone(id: string, doneByName: string, note: string): Promise<void> {
  const { data, error } = await supabase
    .from("clock_in_meetings")
    .update({ status: "done", done_by_name: doneByName, done_at: new Date().toISOString(), note: note.trim() || null })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("You don't have permission to mark this meeting done.");
}
