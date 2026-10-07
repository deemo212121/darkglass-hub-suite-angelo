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
  /** missed_clock_in = no Time In; missed_time_out = auto clock-out not corrected before the next Time In (0349). */
  kind: "missed_clock_in" | "missed_time_out";
  status: "required" | "done";
  doneByName: string | null;
  doneAt: string | null;
  note: string | null;
}

const COLUMNS = "id, profile_id, missed_date, kind, status, done_by_name, done_at, note";

function mapRow(r: any): ClockInMeeting {
  return {
    id: r.id,
    profileId: r.profile_id,
    missedDate: r.missed_date,
    kind: r.kind === "missed_time_out" ? "missed_time_out" : "missed_clock_in",
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

/** Meetings already held, for missed days between startDate and endDate, most recent first. */
export async function getDoneClockInMeetings(startDate: string, endDate: string): Promise<ClockInMeeting[]> {
  const { data, error } = await supabase
    .from("clock_in_meetings")
    .select(COLUMNS)
    .eq("status", "done")
    .gte("missed_date", startDate)
    .lte("missed_date", endDate)
    .order("missed_date", { ascending: false })
    .order("done_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.warn("getDoneClockInMeetings:", error.message);
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

/** Change the note on a meeting (e.g. one already marked done). Same people who can mark meetings done. */
export async function updateClockInMeetingNote(id: string, note: string): Promise<void> {
  const { data, error } = await supabase
    .from("clock_in_meetings")
    .update({ note: note.trim() || null })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("You don't have permission to edit this note.");
}

/** First Time In per "profileId|date" for the given technician-days — shows a late (after 10 AM) clock-in next to its meeting. */
export async function getFirstTimeIns(pairs: { profileId: string; date: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pairs.length === 0) return out;
  const ids = Array.from(new Set(pairs.map((p) => p.profileId)));
  const dates = Array.from(new Set(pairs.map((p) => p.date)));
  const { data, error } = await supabase
    .from("timecard_entries")
    .select("profile_id, work_date, check_in")
    .in("profile_id", ids)
    .in("work_date", dates)
    .not("check_in", "is", null)
    .limit(5000);
  if (error) {
    console.warn("getFirstTimeIns:", error.message);
    return out;
  }
  for (const r of data ?? []) {
    const k = `${r.profile_id}|${r.work_date}`;
    const prev = out.get(k);
    if (!prev || String(r.check_in) < prev) out.set(k, String(r.check_in));
  }
  return out;
}

export interface ForcedClockOut {
  profileId: string;
  workDate: string;
  checkOut: string | null;
}

/**
 * Days closed by the midnight forced clock-out (or the arrived-home auto
 * clock-out) that aren't a meeting yet and have no Time Correction request:
 * the technician still has until their next Time In to send one. Once that
 * passes uncorrected, the hourly job turns it into a "missed Time Out"
 * meeting (0349) and it leaves this list.
 */
export async function getForcedClockOutsAwaitingCorrection(fromDate: string): Promise<ForcedClockOut[]> {
  const [entriesRes, meetingsRes, correctionsRes] = await Promise.all([
    supabase
      .from("timecard_entries")
      .select("profile_id, work_date, check_out")
      .gte("work_date", fromDate)
      .like("notes", "%[Auto clock-out%")
      .order("work_date", { ascending: false })
      .limit(2000),
    supabase.from("clock_in_meetings").select("profile_id, missed_date").eq("kind", "missed_time_out").gte("missed_date", fromDate).limit(5000),
    supabase.from("timecard_corrections").select("profile_id, work_date").gte("work_date", fromDate).limit(5000),
  ]);
  if (entriesRes.error) {
    console.warn("getForcedClockOutsAwaitingCorrection:", entriesRes.error.message);
    return [];
  }
  const done = new Set<string>();
  for (const m of meetingsRes.data ?? []) done.add(`${m.profile_id}|${m.missed_date}`);
  for (const c of correctionsRes.data ?? []) done.add(`${c.profile_id}|${c.work_date}`);
  return (entriesRes.data ?? [])
    .filter((e: any) => !done.has(`${e.profile_id}|${e.work_date}`))
    .map((e: any) => ({ profileId: e.profile_id, workDate: e.work_date, checkOut: e.check_out ?? null }));
}
