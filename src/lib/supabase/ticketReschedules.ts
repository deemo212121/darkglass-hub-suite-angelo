/**
 * Technician-initiated ticket reschedules (migration 0215) — a same-day,
 * mileage-side-effect-only flag a technician sets from the mobile On-Site
 * Check-In card ("Reschedule" + typed reason). Does NOT touch the real
 * ticket's own schedule_date/status. Consumed by:
 *  - mileage.ts's syncMileageFromTickets, to exclude the ticket from that
 *    day's route computation entirely;
 *  - TicketAttendanceTab.tsx, to show the reason in the Diagnosis column;
 *  - AccountingDashboard.tsx's "Reason" tab, a read-only audit list.
 */
import { supabase } from "./client";
import { getTicketId } from "./tickets";

export interface TicketRescheduleRow {
  id: string;
  ticketId: string;
  ticketNo: string;
  /** "YYYY-MM-DD" — the day this ticket was scheduled for when the
   *  technician rescheduled it (matches tickets.schedule_date at that
   *  moment, not necessarily today if this is ever read later). */
  workDate: string;
  reason: string;
  profileId: string;
  createdByName: string | null;
  createdAt: string;
}

function mapRow(r: any): TicketRescheduleRow {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    ticketNo: r.ticket_no,
    workDate: r.work_date,
    reason: r.reason,
    profileId: r.profile_id,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
  };
}

const ROW_COLUMNS = "id, ticket_id, ticket_no, work_date, reason, profile_id, created_by_name, created_at";
const PAGE_SIZE = 1000;

/**
 * Logs (or updates, if the same ticket was already rescheduled for the same
 * day — see the unique(ticket_id, work_date) constraint) the technician's
 * reason. Resolves the real ticket UUID from ticketNo the same way every
 * other ticket-keyed write in this app does (see getTicketId in tickets.ts)
 * — the mobile Ticket type itself carries no id, only ticketNo.
 */
export async function createOrUpdateTicketReschedule(input: {
  ticketNo: string;
  workDate: string;
  reason: string;
  profileId: string;
  createdByName: string | null;
}): Promise<TicketRescheduleRow> {
  const ticketId = await getTicketId(input.ticketNo);
  if (!ticketId) throw new Error(`Ticket ${input.ticketNo} not found.`);
  const { data, error } = await supabase
    .from("ticket_reschedules")
    .upsert(
      {
        ticket_id: ticketId,
        ticket_no: input.ticketNo,
        work_date: input.workDate,
        reason: input.reason.trim(),
        profile_id: input.profileId,
        created_by_name: input.createdByName,
      },
      { onConflict: "ticket_id,work_date" }
    )
    .select(ROW_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

/**
 * Every reschedule row for the caller's company (RLS-scoped), optionally
 * bounded by work_date — used by TicketAttendanceTab.tsx (its own visible
 * date range) and the Accounting Dashboard's "Reason" tab. Paginated like
 * every other bulk query in this codebase (Supabase's default 1000-row cap).
 */
export async function getCompanyTicketReschedules(dateFrom?: string, dateTo?: string): Promise<TicketRescheduleRow[]> {
  const all: TicketRescheduleRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from("ticket_reschedules").select(ROW_COLUMNS).order("work_date", { ascending: false }).order("id", { ascending: true });
    if (dateFrom) query = query.gte("work_date", dateFrom);
    if (dateTo) query = query.lte("work_date", dateTo);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getCompanyTicketReschedules error:", error.message);
      return all;
    }
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Scoped lookup for HomeOnSiteCard's "Resched" badge — just today's visible
 * tickets. Keyed by `${ticket_no}|${work_date}`, NOT ticket_no alone — a
 * ticket can carry more than one reschedule row over its lifetime (worked
 * one day, genuinely rescheduled to a later day, rescheduled again), so the
 * caller must match against the SPECIFIC ticket's own current schedule
 * date (its own Ticket.schedule, matching tickets.schedule_date) rather
 * than "today" — a technician's local device date isn't guaranteed to
 * agree with the ticket's actual schedule_date (see mileage.ts's own
 * timezone-policy notes), and this must match the same key
 * syncMileageFromTickets excludes on.
 */
export async function getTicketReschedulesForTicketNos(ticketNos: string[]): Promise<Map<string, TicketRescheduleRow>> {
  const map = new Map<string, TicketRescheduleRow>();
  if (ticketNos.length === 0) return map;
  const { data, error } = await supabase
    .from("ticket_reschedules")
    .select(ROW_COLUMNS)
    .in("ticket_no", ticketNos);
  if (error) {
    console.error("getTicketReschedulesForTicketNos error:", error.message);
    return map;
  }
  for (const row of (data ?? []).map(mapRow)) map.set(`${row.ticketNo}|${row.workDate}`, row);
  return map;
}
