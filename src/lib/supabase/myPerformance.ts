/**
 * One technician's own Technician Performance figures for a pay period —
 * the mobile app's "My standing" card. Same sources the report's short
 * view uses from 08/27 on: the per-day corrections (minor/major/redo/
 * mileage/hours, working days = days with hours entered), plus errors
 * (timecard correction requests, damage documents, missed clock-in /
 * Time Out meetings). Everything is read as the technician themselves, so
 * RLS limits it to their own rows.
 */
import { supabase } from "./client";
import { getClockInMeetingsInRange, type ClockInMeeting } from "./clockInMeetings";

export interface MyPerformance {
  minorTicketCount: number;
  majorTicketCount: number;
  redoCount: number;
  daysWorked: number;
  hoursWorked: number;
  miles: number;
  timecardIssueCount: number;
  damageAssessmentCount: number;
  missedClockInCount: number;
  meetings: ClockInMeeting[];
}

export async function getMyPerformance(profileId: string, startDate: string, endDate: string): Promise<MyPerformance> {
  const [overrides, corrections, damages, meetings] = await Promise.all([
    supabase
      .from("technician_daily_performance_overrides")
      .select("work_date, redo_count, miles, hours_worked, minor_ticket, major_ticket")
      .eq("profile_id", profileId)
      .gte("work_date", startDate)
      .lte("work_date", endDate),
    supabase
      .from("timecard_corrections")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .gte("work_date", startDate)
      .lte("work_date", endDate),
    supabase
      .from("hr_signable_documents")
      .select("id", { count: "exact", head: true })
      .eq("document_type", "damage")
      .eq("recipient_id", profileId)
      .gte("created_at", `${startDate}T00:00:00`)
      .lte("created_at", `${endDate}T23:59:59`),
    getClockInMeetingsInRange(startDate, endDate),
  ]);
  if (overrides.error) throw new Error(overrides.error.message);

  const rows = overrides.data ?? [];
  const sum = (k: string) => rows.reduce((s, r: any) => s + (Number(r[k]) || 0), 0);
  const mine = meetings.filter((m) => m.profileId === profileId);
  return {
    minorTicketCount: sum("minor_ticket"),
    majorTicketCount: sum("major_ticket"),
    redoCount: sum("redo_count"),
    daysWorked: rows.filter((r: any) => Number(r.hours_worked) > 0).length,
    hoursWorked: sum("hours_worked"),
    miles: sum("miles"),
    timecardIssueCount: corrections.count ?? 0,
    damageAssessmentCount: damages.count ?? 0,
    missedClockInCount: mine.length,
    meetings: mine,
  };
}

/**
 * The technician's most recent work day (before today) that was closed by
 * an automatic clock-out and still has no Time Correction request — what
 * the "Fix your Time Out" banner is about. Null when there's nothing to fix.
 */
export async function getUncorrectedAutoClockOut(profileId: string, today: string): Promise<string | null> {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 7);
  const { data, error } = await supabase
    .from("timecard_entries")
    .select("work_date, notes")
    .eq("profile_id", profileId)
    .gte("work_date", since.toISOString().slice(0, 10))
    .lt("work_date", today)
    .like("notes", "%[Auto clock-out%")
    .order("work_date", { ascending: false })
    .limit(5);
  if (error || !data || data.length === 0) return null;
  const dates = data.map((r: any) => r.work_date as string);
  const { data: corr } = await supabase
    .from("timecard_corrections")
    .select("work_date")
    .eq("profile_id", profileId)
    .in("work_date", dates);
  const corrected = new Set((corr ?? []).map((c: any) => c.work_date as string));
  // HR may also have reviewed it as-is ("[Reviewed auto clock-out — …]").
  const reviewed = new Set(data.filter((r: any) => String(r.notes ?? "").includes("[Reviewed auto clock-out")).map((r: any) => r.work_date as string));
  return dates.find((d) => !corrected.has(d) && !reviewed.has(d)) ?? null;
}
