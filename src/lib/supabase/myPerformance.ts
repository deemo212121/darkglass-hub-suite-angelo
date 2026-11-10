/**
 * One technician's own Technician Performance figures for a pay period —
 * the mobile app's "My standing" card. Same sources the report's short
 * view uses from 08/27 on: the per-day corrections (minor/major/redo/
 * mileage/hours, working days = days with hours entered), plus errors
 * (timecard correction requests, damage documents, missed clock-in /
 * Time Out meetings), and the Flash Tech Completion figures (their
 * Flashtech trips on the Flash Tech Calendar). Everything is read as the
 * technician themselves, so RLS limits it to their own rows.
 */
import { supabase } from "./client";
import { getClockInMeetingsInRange, type ClockInMeeting } from "./clockInMeetings";
import { addDaysISO } from "@/lib/localDate";

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
  /** Minor + Major on the days worked (hours entered) during a Flashtech trip, and how many such days. */
  flashTicketCount: number;
  flashDaysWorked: number;
  meetings: ClockInMeeting[];
}

/** One Flashtech trip's dates (Flash Tech Calendar). */
export interface FlashTripSpan {
  profileId: string;
  startDate: string;
  endDate: string;
}

/**
 * The Flashtech trips overlapping a date range (one technician's, or every
 * technician's) — Education / Inspection trips and cancelled ones don't count.
 */
export async function getFlashTripSpans(startDate: string, endDate: string, profileId?: string): Promise<FlashTripSpan[]> {
  const { rows, error } = await readAll((from, to) => {
    let q = supabase
      .from("flash_tech_trips")
      .select("id, technician_profile_id, start_date, end_date, trip_type, status_override")
      .lte("start_date", endDate)
      .gte("end_date", startDate);
    if (profileId) q = q.eq("technician_profile_id", profileId);
    return q.order("id").range(from, to);
  });
  if (error) throw new Error(error);
  return rows
    .filter((r) => r.technician_profile_id && (r.trip_type ?? "Flashtech") === "Flashtech" && r.status_override !== "Cancelled")
    .map((r) => ({ profileId: r.technician_profile_id, startDate: r.start_date, endDate: r.end_date }));
}

/** The dates from periodStart to periodEnd that one of the technician's flash trips covers. */
export function flashTripDates(trips: FlashTripSpan[], profileId: string, periodStart: string, periodEnd: string): Set<string> {
  const dates = new Set<string>();
  for (const t of trips) {
    if (t.profileId !== profileId) continue;
    const last = t.endDate < periodEnd ? t.endDate : periodEnd;
    for (let d = t.startDate > periodStart ? t.startDate : periodStart; d <= last; d = addDaysISO(d, 1)) dates.add(d);
  }
  return dates;
}

export async function getMyPerformance(profileId: string, startDate: string, endDate: string): Promise<MyPerformance> {
  const [overrides, corrections, damages, meetings, flashTrips] = await Promise.all([
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
    getFlashTripSpans(startDate, endDate, profileId),
  ]);
  if (overrides.error) throw new Error(overrides.error.message);
  return toPerformance(
    overrides.data ?? [],
    corrections.count ?? 0,
    damages.count ?? 0,
    meetings.filter((m) => m.profileId === profileId),
    flashTripDates(flashTrips, profileId, startDate, endDate)
  );
}

/** One technician's period figures from their per-day rows and error counts — shared by getMyPerformance and getPerformanceLoader. */
function toPerformance(rows: any[], timecardIssueCount: number, damageAssessmentCount: number, meetings: ClockInMeeting[], flashDates: Set<string>): MyPerformance {
  const sum = (k: string) => rows.reduce((s, r: any) => s + (Number(r[k]) || 0), 0);
  const flashDays = rows.filter((r: any) => flashDates.has(r.work_date) && Number(r.hours_worked) > 0);
  return {
    minorTicketCount: sum("minor_ticket"),
    majorTicketCount: sum("major_ticket"),
    redoCount: sum("redo_count"),
    daysWorked: rows.filter((r: any) => Number(r.hours_worked) > 0).length,
    hoursWorked: sum("hours_worked"),
    miles: sum("miles"),
    timecardIssueCount,
    damageAssessmentCount,
    missedClockInCount: meetings.length,
    flashTicketCount: flashDays.reduce((s, r: any) => s + (Number(r.minor_ticket) || 0) + (Number(r.major_ticket) || 0), 0),
    flashDaysWorked: flashDays.length,
    meetings,
  };
}

const PAGE_SIZE = 1000;
const ID_GROUP = 100;

async function readAll(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>): Promise<{ rows: any[]; error: string | null }> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { rows, error: null };
  }
}

/**
 * getMyPerformance for many technicians and pay periods at once: each
 * source is read once for the whole span (in pages and groups of ids),
 * then split per technician and pay period with the same arithmetic.
 * Incentives grades everyone's 6 months with it. Read as the viewer, so
 * RLS decides what they see (HR / Admin see it all).
 */
export async function getPerformanceLoader(
  profileIds: string[],
  startDate: string,
  endDate: string
): Promise<(profileId: string, periodStart: string, periodEnd: string) => MyPerformance> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const groups: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_GROUP) groups.push(ids.slice(i, i + ID_GROUP));
  const eachGroup = async (build: (group: string[], from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>) => {
    const parts = await Promise.all(groups.map((g) => readAll((from, to) => build(g, from, to))));
    return { rows: parts.flatMap((p) => p.rows), error: parts.find((p) => p.error)?.error ?? null };
  };
  const [overrides, corrections, damages, meetings, flashTrips] = await Promise.all([
    eachGroup((g, from, to) =>
      supabase
        .from("technician_daily_performance_overrides")
        .select("profile_id, work_date, redo_count, miles, hours_worked, minor_ticket, major_ticket")
        .in("profile_id", g)
        .gte("work_date", startDate)
        .lte("work_date", endDate)
        .order("profile_id")
        .order("work_date")
        .range(from, to)
    ),
    eachGroup((g, from, to) =>
      supabase.from("timecard_corrections").select("id, profile_id, work_date").in("profile_id", g).gte("work_date", startDate).lte("work_date", endDate).order("id").range(from, to)
    ),
    eachGroup((g, from, to) =>
      supabase
        .from("hr_signable_documents")
        .select("id, recipient_id, created_at")
        .eq("document_type", "damage")
        .in("recipient_id", g)
        .gte("created_at", `${startDate}T00:00:00`)
        .lte("created_at", `${endDate}T23:59:59`)
        .order("id")
        .range(from, to)
    ),
    getClockInMeetingsInRange(startDate, endDate),
    getFlashTripSpans(startDate, endDate),
  ]);
  // Same as getMyPerformance: the per-day rows must load; a failed error-count read counts as none.
  if (overrides.error) throw new Error(overrides.error);
  const byProfile = <T,>(rows: T[], key: (r: T) => string) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
    return map;
  };
  const days = byProfile(overrides.rows, (r) => r.profile_id);
  const corrDays = byProfile(corrections.error ? [] : corrections.rows, (r) => r.profile_id);
  const damageTimes = byProfile(damages.error ? [] : damages.rows, (r) => r.recipient_id);
  const meetingsBy = byProfile(meetings, (m) => m.profileId);
  return (profileId, periodStart, periodEnd) =>
    toPerformance(
      (days.get(profileId) ?? []).filter((r) => r.work_date >= periodStart && r.work_date <= periodEnd),
      (corrDays.get(profileId) ?? []).filter((r) => r.work_date >= periodStart && r.work_date <= periodEnd).length,
      (damageTimes.get(profileId) ?? []).filter((r) => r.created_at >= `${periodStart}T00:00:00` && r.created_at <= `${periodEnd}T23:59:59`).length,
      (meetingsBy.get(profileId) ?? []).filter((m) => m.missedDate >= periodStart && m.missedDate <= periodEnd),
      flashTripDates(flashTrips, profileId, periodStart, periodEnd)
    );
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
