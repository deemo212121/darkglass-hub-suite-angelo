/**
 * Detects technicians who belong on the Employee Monitoring → Visit
 * Exception Report tab for a given day — anyone who:
 *  - checked in but never clocked out (timecard_entries),
 *  - had a ticket scheduled that day with no on-site check-in recorded, or
 *    checked in but never recorded an on-site checkout (tickets.
 *    onsite_arrived_at/onsite_done_at, same source Ticket Attendance uses),
 *  - had a ticket rescheduled that day (ticket_reschedules).
 * Per an explicit user call, "no call no show" is NOT its own separate
 * condition — a missing on-site check-in already covers it, same reasoning
 * TechnicianPerformanceReport.tsx's own NCNS column (a blank manual field)
 * already documents: nothing in this app distinguishes a genuine NCNS from
 * any other missing check-in.
 *
 * Scoped to technician-tier roles only (TECHNICIAN_PAY_ROLES) — the clock-
 * out condition alone would otherwise also flag office/HR/CSR staff, whose
 * attendance already belongs to the regular Absent List/Attendance
 * Monitoring pages, not a report about missed customer visits.
 *
 * Ticket-based conditions only apply to a day that's already fully
 * elapsed — a ticket scheduled later TODAY with no check-in yet isn't an
 * exception, it just hasn't happened yet. Callers should default to
 * reviewing a past day (see VisitExceptionReportTab.tsx defaulting to
 * yesterday) rather than today.
 */
import { getCompanyUsers } from "./users";
import { getCompanyTimecardEntries } from "./timecards";
import { getCompanyTicketAttendance } from "./technicianWhereabouts";
import { getCompanyTicketReschedules } from "./ticketReschedules";
import { TECHNICIAN_PAY_ROLES, normalizeRole } from "@/lib/roleLabels";

export type VisitExceptionReason = "no_clockout" | "no_checkin" | "no_checkout" | "rescheduled";

export interface VisitExceptionTicketDetail {
  ticketNo: string;
  reason: "no_checkin" | "no_checkout" | "rescheduled";
  timeSlot: string | null;
  rescheduleReason?: string;
}

export interface VisitExceptionRow {
  profileId: string;
  name: string;
  role: string;
  location: string;
  manager: string;
  technicianId: string;
  reasons: VisitExceptionReason[];
  tickets: VisitExceptionTicketDetail[];
}

export async function getVisitExceptionsForDate(dateISO: string): Promise<VisitExceptionRow[]> {
  const [profiles, timecardEntries, ticketAttendance, reschedules] = await Promise.all([
    getCompanyUsers(),
    getCompanyTimecardEntries(dateISO, dateISO),
    getCompanyTicketAttendance(dateISO, dateISO),
    getCompanyTicketReschedules(dateISO, dateISO),
  ]);

  const technicianProfiles = profiles.filter((p) => TECHNICIAN_PAY_ROLES.has(normalizeRole(p.role)));
  const profileById = new Map(technicianProfiles.map((p) => [p.id, p]));
  const profileByNameKey = new Map(technicianProfiles.map((p) => [(p.display_name || p.email).trim().toLowerCase(), p]));

  const rowsByProfileId = new Map<string, VisitExceptionRow>();
  const ensure = (profileId: string): VisitExceptionRow | null => {
    const p = profileById.get(profileId);
    if (!p) return null; // not a technician-tier profile — out of scope for this report
    let row = rowsByProfileId.get(profileId);
    if (!row) {
      row = {
        profileId,
        name: p.display_name || p.email,
        role: p.role,
        location: p.assigned_branch || "—",
        manager: p.manager_name || "—",
        technicianId: p.technician_id?.trim() || "",
        reasons: [],
        tickets: [],
      };
      rowsByProfileId.set(profileId, row);
    }
    return row;
  };
  const addReason = (profileId: string, reason: VisitExceptionReason) => {
    const row = ensure(profileId);
    if (row && !row.reasons.includes(reason)) row.reasons.push(reason);
  };

  for (const e of timecardEntries) {
    if (e.checkIn && !e.checkOut) addReason(e.profileId, "no_clockout");
  }

  for (const t of ticketAttendance) {
    if (t.statusGroup === "cancelled") continue;
    const p = profileByNameKey.get(t.technician.trim().toLowerCase());
    if (!p) continue;
    if (!t.arrivedAt) {
      addReason(p.id, "no_checkin");
      ensure(p.id)?.tickets.push({ ticketNo: t.ticketNo, reason: "no_checkin", timeSlot: t.timeSlot });
    } else if (!t.doneAt) {
      addReason(p.id, "no_checkout");
      ensure(p.id)?.tickets.push({ ticketNo: t.ticketNo, reason: "no_checkout", timeSlot: t.timeSlot });
    }
  }

  for (const r of reschedules) {
    addReason(r.profileId, "rescheduled");
    ensure(r.profileId)?.tickets.push({ ticketNo: r.ticketNo, reason: "rescheduled", timeSlot: null, rescheduleReason: r.reason });
  }

  return Array.from(rowsByProfileId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Plain-English Detailed Reason paragraph HR can edit before sending — built from whichever condition(s) triggered. */
export function buildVisitExceptionReasonText(row: VisitExceptionRow, dateISO: string): string {
  const parts: string[] = [];
  if (row.reasons.includes("no_clockout")) parts.push(`No clock-out was recorded for ${dateISO}.`);
  const checkinTickets = row.tickets.filter((t) => t.reason === "no_checkin");
  if (checkinTickets.length > 0) parts.push(`No on-site check-in was recorded for ticket ${checkinTickets.map((t) => t.ticketNo).join(", ")}.`);
  const checkoutTickets = row.tickets.filter((t) => t.reason === "no_checkout");
  if (checkoutTickets.length > 0) parts.push(`No on-site checkout was recorded for ticket ${checkoutTickets.map((t) => t.ticketNo).join(", ")} (checked in, never checked out).`);
  const rescheduled = row.tickets.filter((t) => t.reason === "rescheduled");
  if (rescheduled.length > 0) parts.push(`Ticket ${rescheduled.map((t) => t.ticketNo).join(", ")} was rescheduled — reason given: "${rescheduled[0].rescheduleReason || "—"}".`);
  return parts.join(" ");
}
