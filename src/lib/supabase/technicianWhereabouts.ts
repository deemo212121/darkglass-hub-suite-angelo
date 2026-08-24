/**
 * Technician Whereabouts — primarily a "current job site" proxy inferred
 * from today's ticket schedule (the same real data Mileage's day-route view
 * and Work Map already read), enriched with real live GPS when available
 * (see technicianLocationPings.ts / TechnicianLocationTracker.tsx) — a
 * technician only ever shows a live point while they're actually clocked in
 * AND have a confirmed Location Consent document on file; everyone else
 * (or anyone whose last ping has gone stale) falls back to the schedule
 * proxy exactly as before this existed.
 */

import { supabase } from "./client";
import { getCompanyTechnicians } from "./users";
import { getCompanyLocationPings } from "./technicianLocationPings";
import { statusGroupOf } from "@/lib/ticketData";
import { normalizeTimePeriod, FRAME_START_TIME } from "@/lib/timeframes";

export type WhereaboutsStatus = "current" | "last" | "none";

/** A live ping is only trusted for this long before falling back to the schedule proxy — covers a technician who closed the tab/lost signal without formally clocking out. */
const LIVE_STALE_MS = 15 * 60 * 1000;

export interface TechnicianWhereabouts {
  name: string;
  branch: string;
  status: WhereaboutsStatus;
  ticketNo: string | null;
  repairStatus: string | null;
  timeSlot: string | null;
  address: string | null;
  /** Real GPS, when a fresh one exists — see LIVE_STALE_MS. Additive: `status` above still reflects today's job-schedule state regardless of whether this is set. */
  liveLocation: { lat: number; lng: number; updatedAt: string } | null;
}

function formatAddress(row: any): string {
  const parts = [row.address, row.address2, [row.city, row.state].filter(Boolean).join(", "), row.zip];
  return parts.filter((p) => p && String(p).trim()).join(", ");
}

function slotSortKey(timeSlot: string | null | undefined): string {
  const frame = normalizeTimePeriod(timeSlot);
  return FRAME_START_TIME[frame ?? "ANYTIME"] ?? "17:30";
}

/**
 * One row per active technician (from getCompanyTechnicians — already
 * excludes deactivated accounts), each resolved to today's schedule:
 *  - "current": earliest still-open ticket scheduled today, by time slot.
 *  - "last": no open ticket left today, but at least one was completed —
 *    their last completed stop (by time slot). Cancelled-only days don't
 *    count here since a cancelled call is no real signal the tech ever
 *    went there.
 *  - "none": nothing scheduled today (or only cancelled calls).
 */
export async function getTechnicianWhereabouts(): Promise<TechnicianWhereabouts[]> {
  const technicians = await getCompanyTechnicians();
  if (technicians.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const [{ data, error }, pings] = await Promise.all([
    supabase
      .from("tickets")
      .select("ticket_no, technician, status, time_slot, customer:customers ( address, address2, city, state, zip )")
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
      .filter((p) => now - new Date(p.updatedAt).getTime() < LIVE_STALE_MS)
      .map((p) => [p.profileId, { lat: p.lat, lng: p.lng, updatedAt: p.updatedAt }])
  );

  return technicians.map((tech): TechnicianWhereabouts => {
    const rows = byTech.get(tech.name.trim().toLowerCase()) ?? [];
    const base = { name: tech.name, branch: tech.branch, liveLocation: liveByProfileId.get(tech.id) ?? null };
    if (rows.length === 0) {
      return { ...base, status: "none", ticketNo: null, repairStatus: null, timeSlot: null, address: null };
    }

    const open = rows.filter((r) => statusGroupOf(r.status) === "open").sort((a, b) => slotSortKey(a.time_slot).localeCompare(slotSortKey(b.time_slot)));
    if (open.length > 0) {
      const stop = open[0];
      return { ...base, status: "current", ticketNo: stop.ticket_no, repairStatus: stop.status, timeSlot: stop.time_slot, address: formatAddress(stop.customer ?? {}) };
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
}

/** Every ticket scheduled today for one technician, in time-slot order — feeds the "today's route" map view opened by clicking their dot. */
export async function getTechnicianTodayRoute(technicianName: string): Promise<TechnicianRouteStop[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("tickets")
    .select("ticket_no, technician, status, time_slot, customer:customers ( address, address2, city, state, zip )")
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
    }))
    .sort((a, b) => slotSortKey(a.timeSlot).localeCompare(slotSortKey(b.timeSlot)));
}
