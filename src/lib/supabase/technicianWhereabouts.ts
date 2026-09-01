/**
 * Technician Whereabouts — primarily a "current job site" proxy inferred
 * from today's ticket schedule (the same real data Mileage's day-route view
 * and Work Map already read), enriched with real live GPS when available
 * (see technicianLocationPings.ts / TechnicianLocationTracker.tsx) — a
 * technician only ever shows a live point while they're actually clocked in
 * AND have a confirmed Location Consent document on file; everyone else
 * falls back to the schedule proxy exactly as before this existed.
 *
 * A ping is kept and preferred over the schedule proxy for as long as its
 * row exists, however old — a technician who loses signal or closes the tab
 * mid-shift should still show at their last real position, not silently
 * snap back to their branch/ticket address just because a few minutes
 * passed. The row only goes away (via clearMyLocationPing) the moment they
 * actually clock out, which is the real "reset" boundary here: on clock-out
 * TechnicianLocationTracker.tsx deletes it, and everyone naturally falls
 * back to the schedule proxy for the next day. LIVE_FRESH_MS below is
 * cosmetic only now — "Live" vs. "last known" wording, never a cutoff that
 * drops the position.
 */

import { supabase } from "./client";
import { getCompanyTechnicians } from "./users";
import { getCompanyLocationPings } from "./technicianLocationPings";
import { statusGroupOf } from "@/lib/ticketData";
import { normalizeTimePeriod, FRAME_START_TIME } from "@/lib/timeframes";

export type WhereaboutsStatus = "current" | "scheduled" | "last" | "none";

/** Below this age a ping reads as "Live"; older is still shown (and still preferred over the schedule proxy) but labeled "Active" instead — see the header comment above for why nothing gets dropped anymore. Exported so the map legend (TechnicianWhereaboutsPage.tsx) can state the real cutoff instead of a hardcoded number that could drift out of sync. */
export const LIVE_FRESH_MS = 15 * 60 * 1000;

export interface TechnicianWhereabouts {
  /** Real profile id — used by TechnicianDayRouteModal to match an active Flash Tech trip (flash_tech_trips.technicianProfileId), same key TechnicianWhereaboutsPage already uses to match a live GPS ping. */
  profileId: string;
  name: string;
  branch: string;
  status: WhereaboutsStatus;
  ticketNo: string | null;
  repairStatus: string | null;
  timeSlot: string | null;
  address: string | null;
  /**
   * Real GPS, whenever a ping row exists for this technician — kept
   * regardless of age (see the file header comment). Additive: `status`
   * above still reflects today's job-schedule state independent of this.
   */
  liveLocation: { lat: number; lng: number; updatedAt: string; isLive: boolean } | null;
}

function formatAddress(row: any): string {
  const parts = [row.address, row.address2, [row.city, row.state].filter(Boolean).join(", "), row.zip];
  return parts.filter((p) => p && String(p).trim()).join(", ");
}

/** Exported so callers that need the same route-order sort outside this file (e.g. Attendance Monitoring's Ticket Attendance tab, matching Technician Whereabouts' numbered Stops list) don't have to duplicate it. */
export function slotSortKey(timeSlot: string | null | undefined): string {
  const frame = normalizeTimePeriod(timeSlot);
  return FRAME_START_TIME[frame ?? "ANYTIME"] ?? "17:30";
}

/**
 * One row per active technician (from getCompanyTechnicians — already
 * excludes deactivated accounts), each resolved to today's schedule:
 *  - "current": a ticket the technician has actually checked into via the
 *    mobile On-Site Check-In card (onsite_arrived_at set, onsite_done_at
 *    not yet) — being scheduled for today alone no longer counts; see
 *    migration 0202. If more than one somehow qualifies, the most
 *    recently arrived wins.
 *  - "scheduled": no on-site check-in in progress, but at least one open
 *    ticket is on today's schedule — their earliest one, by time slot.
 *    Distinct from "none" so "hasn't started yet" doesn't read as "nothing
 *    to do today" (a real distinction technicians and dispatchers both
 *    care about — see the wording issue this fixed).
 *  - "last": no on-site check-in and nothing left open today, but at least
 *    one ticket was completed today — their last completed stop (by time
 *    slot). Cancelled-only days don't count here since a cancelled call is
 *    no real signal the tech ever went there.
 *  - "none": nothing scheduled, checked into, or completed today (or only
 *    cancelled calls).
 */
export async function getTechnicianWhereabouts(): Promise<TechnicianWhereabouts[]> {
  const technicians = await getCompanyTechnicians();
  if (technicians.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const [{ data, error }, pings] = await Promise.all([
    supabase
      .from("tickets")
      .select("ticket_no, technician, status, time_slot, onsite_arrived_at, onsite_done_at, customer:customers ( address, address2, city, state, zip )")
      .eq("schedule_date", today),
    // Best-effort: a non-Admin/SuperAdmin caller would get an RLS-empty
    // result here, not an error, but this function itself is only ever
    // reached from the Admin-gated Whereabouts page.
    getCompanyLocationPings().catch((err) => {
      console.error("getCompanyLocationPings error:", err instanceof Error ? err.message : err);
      return [];
    }),
  ]);
  if (error) {
    console.error("getTechnicianWhereabouts error:", error.message);
    throw new Error(error.message);
  }

  const byTech = new Map<string, any[]>();
  for (const row of data ?? []) {
    const key = String(row.technician || "").trim().toLowerCase();
    if (!key) continue;
    if (!byTech.has(key)) byTech.set(key, []);
    byTech.get(key)!.push(row);
  }

  const now = Date.now();
  const liveByProfileId = new Map(
    pings
      // Every ping row is kept, however old — see the file header comment.
      // isLive is cosmetic labeling only, never a reason to drop a position.
      .map((p) => [p.profileId, { lat: p.lat, lng: p.lng, updatedAt: p.updatedAt, isLive: now - new Date(p.updatedAt).getTime() < LIVE_FRESH_MS }])
  );

  return technicians.map((tech): TechnicianWhereabouts => {
    const rows = byTech.get(tech.name.trim().toLowerCase()) ?? [];
    const base = {
      profileId: tech.id,
      name: tech.name,
      branch: tech.branch,
      liveLocation: liveByProfileId.get(tech.id) ?? null,
    };
    if (rows.length === 0) {
      return { ...base, status: "none", ticketNo: null, repairStatus: null, timeSlot: null, address: null };
    }

    const checkedIn = rows
      .filter((r) => r.onsite_arrived_at && !r.onsite_done_at)
      .sort((a, b) => new Date(b.onsite_arrived_at).getTime() - new Date(a.onsite_arrived_at).getTime());
    if (checkedIn.length > 0) {
      const stop = checkedIn[0];
      return { ...base, status: "current", ticketNo: stop.ticket_no, repairStatus: stop.status, timeSlot: stop.time_slot, address: formatAddress(stop.customer ?? {}) };
    }

    const open = rows.filter((r) => statusGroupOf(r.status) === "open").sort((a, b) => slotSortKey(a.time_slot).localeCompare(slotSortKey(b.time_slot)));
    if (open.length > 0) {
      const stop = open[0];
      return { ...base, status: "scheduled", ticketNo: stop.ticket_no, repairStatus: stop.status, timeSlot: stop.time_slot, address: formatAddress(stop.customer ?? {}) };
    }

    const completed = rows.filter((r) => statusGroupOf(r.status) === "completed").sort((a, b) => slotSortKey(b.time_slot).localeCompare(slotSortKey(a.time_slot)));
    if (completed.length > 0) {
      const stop = completed[0];
      return { ...base, status: "last", ticketNo: stop.ticket_no, repairStatus: stop.status, timeSlot: stop.time_slot, address: formatAddress(stop.customer ?? {}) };
    }

    return { ...base, status: "none", ticketNo: null, repairStatus: null, timeSlot: null, address: null };
  });
}

/** Only reads `.branch` — accepts any row shape that has one (TechnicianOption, TechnicianWhereabouts, ...) rather than a specific one. */
export function distinctBranches(rows: Array<{ branch: string }>): string[] {
  return Array.from(new Set(rows.map((r) => r.branch).filter((b) => b.trim()))).sort((a, b) => a.localeCompare(b));
}

export interface TechnicianRouteStop {
  ticketNo: string;
  status: string;
  statusGroup: ReturnType<typeof statusGroupOf>;
  timeSlot: string | null;
  address: string;
  /** Real On-Site Check-In timestamps (migration 0202) — when the technician tapped "I'm Here"/"I'm Done" on this stop today, for the Today's Route popup's "Timestamp (Start - End)" row. Either can be null: not yet arrived, or arrived but not yet marked done. */
  arrivedAt: string | null;
  doneAt: string | null;
}

/** Every ticket scheduled today for one technician, in time-slot order — feeds the "today's route" map view opened by clicking their dot. */
export async function getTechnicianTodayRoute(technicianName: string): Promise<TechnicianRouteStop[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("tickets")
    .select("ticket_no, technician, status, time_slot, onsite_arrived_at, onsite_done_at, customer:customers ( address, address2, city, state, zip )")
    .eq("schedule_date", today);
  if (error) {
    console.error("getTechnicianTodayRoute error:", error.message);
    throw new Error(error.message);
  }
  const key = technicianName.trim().toLowerCase();
  return (data ?? [])
    .filter((row: any) => String(row.technician || "").trim().toLowerCase() === key)
    .map((row: any) => ({
      ticketNo: row.ticket_no as string,
      status: row.status as string,
      statusGroup: statusGroupOf(row.status),
      timeSlot: row.time_slot as string | null,
      address: formatAddress(row.customer ?? {}),
      arrivedAt: row.onsite_arrived_at as string | null,
      doneAt: row.onsite_done_at as string | null,
    }))
    .sort((a, b) => slotSortKey(a.timeSlot).localeCompare(slotSortKey(b.timeSlot)));
}

export interface TicketAttendanceRow {
  ticketNo: string;
  technician: string;
  scheduleDate: string;
  status: string;
  statusGroup: ReturnType<typeof statusGroupOf>;
  timeSlot: string | null;
  address: string;
  /** Real On-Site Check-In timestamps (migration 0202) — see TechnicianRouteStop above. */
  arrivedAt: string | null;
  doneAt: string | null;
}

/**
 * Every ticket scheduled within [dateFrom, dateTo] company-wide, across every
 * technician — the Ticket Attendance tab's data source (Attendance
 * Monitoring), a company-wide/date-range version of getTechnicianTodayRoute
 * above (which is scoped to one technician's "today"). Used to answer "did
 * this technician actually check into their scheduled tickets," separate
 * from the general clock In/Out attendance the rest of this page tracks.
 */
export async function getCompanyTicketAttendance(dateFrom: string, dateTo: string): Promise<TicketAttendanceRow[]> {
  const { data, error } = await supabase
    .from("tickets")
    .select("ticket_no, technician, schedule_date, status, time_slot, onsite_arrived_at, onsite_done_at, customer:customers ( address, address2, city, state, zip )")
    .gte("schedule_date", dateFrom)
    .lte("schedule_date", dateTo);
  if (error) {
    console.error("getCompanyTicketAttendance error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? [])
    .filter((row: any) => String(row.technician || "").trim())
    .map((row: any) => ({
      ticketNo: row.ticket_no as string,
      technician: String(row.technician).trim(),
      scheduleDate: row.schedule_date as string,
      status: row.status as string,
      statusGroup: statusGroupOf(row.status),
      timeSlot: row.time_slot as string | null,
      address: formatAddress(row.customer ?? {}),
      arrivedAt: row.onsite_arrived_at as string | null,
      doneAt: row.onsite_done_at as string | null,
    }))
    // Date then time-slot order — same route order Technician Whereabouts'
    // numbered Stops list uses, so a technician's stop #3 there is also
    // row #3 here.
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate) || slotSortKey(a.timeSlot).localeCompare(slotSortKey(b.timeSlot)));
}
