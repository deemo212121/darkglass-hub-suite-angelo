/**
 * Pure, no-Supabase-dependency aggregation for the Operations Daily Report's
 * branch tables (Eastern/Western/Central TX tabs). Takes an already-fetched
 * `Ticket[]` (from getCompanyTickets()) and derives per-branch metrics —
 * nothing here is mock/hardcoded, every number comes from real ticket rows.
 */

import { statusGroupOf, type Ticket } from "./ticketData";

// The fixed set of reasons offered when a ticket's status is set to
// "CL-Cancelled" (src/routes/ticket.$ticketNo.tsx) — only a BizOps Manager
// can make that transition; a CSR flagging "CL-Need Cancel" just explains
// why in the free-text Internal Note, no structured reason yet. Order
// matches the dropdown.
export const CANCEL_REASONS = [
  "CANCELLED BY WARRANTY",
  "CUSTOMER UNREACHABLE",
  "WARRANTY DISCREPANCY/OOW",
  "REFUSE SERVICE",
  "DUPLICATE",
  "UNIT WORKING",
  "OUT OF COVERAGE",
  "NEED FUTURE SCHEDULE",
  "NOT COVERED",
] as const;

function isMorningSlot(t: Ticket): boolean {
  const period = (t.schedulePeriod || "").toUpperCase();
  const slot = (t.timeSlot || "").toUpperCase();
  return period.includes("MORNING") || slot.startsWith("8");
}

function dateOnly(v: string | undefined | null): string {
  return (v || "").slice(0, 10);
}

function inRange(v: string | undefined | null, from: string, to: string): boolean {
  const d = dateOnly(v);
  return !!d && d >= from && d <= to;
}

// Real synced ticket.location values sometimes drop the space after a comma
// (e.g. "Jackson,MS" instead of the canonical "Jackson, MS" in
// src/lib/locations.ts). Compare loosely so branch matching doesn't silently
// drop those tickets.
function normalizeLocation(v: string | undefined | null): string {
  return (v || "").trim().replace(/,\s+/g, ",");
}

export function isNeedCancel(t: Ticket): boolean {
  return t.status.trim().toLowerCase() === "cl-need cancel";
}

export function isCancelled(t: Ticket): boolean {
  const v = t.status.trim().toLowerCase();
  return v === "cl-cancelled" || v === "cancelled";
}

export interface BranchRow {
  branch: string;
  /** % of currently-open tickets at this branch aged past the LTP threshold. Null when there are no open tickets. */
  dailyLTP: number | null;
  /** Same ratio, restricted to open tickets created in the selected range's month. Null when there are none. */
  monthlyLTP: number | null;
  /** Tickets scheduled within [dateFrom, dateTo]. */
  assigned: number;
  completed: number;
  compPct: number | null;
  staff: number;
  amReschedule: number;
  /** Currently open CL-Need Cancel tickets at this branch (live snapshot, not date-range scoped — a cancel request stays live until resolved). */
  needCancel: number;
  /** Currently CL-Cancelled/Cancelled tickets at this branch created within [dateFrom, dateTo]. */
  cancelled: number;
  /** Comma-joined tally of parsed cancellation reasons for this branch's CL-Cancelled tickets, e.g. "Cancelled By Warranty (4), Duplicate (1)". Empty string when none have a recorded reason yet. */
  reasons: string;
  /** Same tally as `reasons`, but as a raw map so callers can aggregate across branches/regions without re-parsing the formatted string. */
  reasonCounts: Record<string, number>;
}

/**
 * Compute one row per branch in `regionLocations` for tickets scheduled
 * within [dateFrom, dateTo]. `ltpAgingDays` is the user-adjustable LTP
 * threshold (default 14 elsewhere). LTP and Need Cancel are live snapshots
 * (open-ticket state doesn't have historical date scoping in this schema),
 * everything else is scoped to the date range.
 */
export function computeBranchRows(
  tickets: Ticket[],
  regionLocations: string[],
  dateFrom: string,
  dateTo: string,
  ltpAgingDays: number,
): BranchRow[] {
  const month = dateTo.slice(0, 7);

  return regionLocations.map((branch) => {
    const branchTickets = tickets.filter((t) => normalizeLocation(t.location) === normalizeLocation(branch));

    const openTickets = branchTickets.filter((t) => statusGroupOf(t.status) === "open");
    const dailyLTP =
      openTickets.length > 0
        ? (openTickets.filter((t) => (t.aging ?? 0) >= ltpAgingDays).length / openTickets.length) * 100
        : null;

    const monthlyOpenTickets = openTickets.filter((t) => dateOnly(t.created).slice(0, 7) === month);
    const monthlyLTP =
      monthlyOpenTickets.length > 0
        ? (monthlyOpenTickets.filter((t) => (t.aging ?? 0) >= ltpAgingDays).length / monthlyOpenTickets.length) * 100
        : null;

    const assignedTickets = branchTickets.filter((t) => inRange(t.schedule, dateFrom, dateTo));
    const completed = assignedTickets.filter((t) => statusGroupOf(t.status) === "completed").length;
    const compPct = assignedTickets.length > 0 ? (completed / assignedTickets.length) * 100 : null;

    const touched = branchTickets.filter(
      (t) => inRange(t.schedule, dateFrom, dateTo) || inRange(t.statusChangedAt, dateFrom, dateTo),
    );
    const staff = new Set(touched.map((t) => (t.technician || "").trim()).filter(Boolean)).size;

    const amReschedule = branchTickets.filter(
      (t) =>
        t.status.trim().toLowerCase() === "op-reschedule follow up" &&
        inRange(t.statusChangedAt, dateFrom, dateTo) &&
        isMorningSlot(t),
    ).length;

    const needCancelTickets = branchTickets.filter(isNeedCancel);
    const cancelledTickets = branchTickets.filter((t) => isCancelled(t) && inRange(t.created, dateFrom, dateTo));

    // Reasons are only recorded once BizOps actually cancels a ticket (see
    // ticket.$ticketNo.tsx's canSetCancelled) — a CL-Need Cancel ticket has
    // whatever free-text a CSR wrote in Internal Note, but no structured
    // reason to tally yet.
    const reasonTally = new Map<string, number>();
    for (const t of cancelledTickets) {
      const reason = (t.cancellationReason || "").trim();
      if (!reason) continue;
      reasonTally.set(reason, (reasonTally.get(reason) ?? 0) + 1);
    }
    const reasons = Array.from(reasonTally.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason} (${count})`)
      .join(", ");

    return {
      branch,
      dailyLTP: dailyLTP !== null ? Math.round(dailyLTP * 10) / 10 : null,
      monthlyLTP: monthlyLTP !== null ? Math.round(monthlyLTP * 10) / 10 : null,
      assigned: assignedTickets.length,
      completed,
      compPct: compPct !== null ? Math.round(compPct * 10) / 10 : null,
      staff,
      amReschedule,
      needCancel: needCancelTickets.length,
      cancelled: cancelledTickets.length,
      reasons,
      reasonCounts: Object.fromEntries(reasonTally),
    };
  });
}

export interface DailyCount {
  date: string;
  assigned: number;
  completed: number;
}

/**
 * Real day-by-day Assigned/Completed counts across `regionLocations` for
 * every date in [dateFrom, dateTo] — used for the branch tab's trend chart.
 * Replaces an earlier version of this chart that plotted LTP% per day, which
 * doesn't actually vary by day (LTP is a live open-ticket snapshot, not a
 * historical one) and so was silently flat/misleading.
 */
export function computeDailyCounts(tickets: Ticket[], regionLocations: string[], dateFrom: string, dateTo: string): DailyCount[] {
  const locations = new Set(regionLocations.map(normalizeLocation));
  const regionTickets = tickets.filter((t) => locations.has(normalizeLocation(t.location)));

  const byDate = new Map<string, { assigned: number; completed: number }>();
  for (const t of regionTickets) {
    const d = dateOnly(t.schedule);
    if (!d || d < dateFrom || d > dateTo) continue;
    const bucket = byDate.get(d) ?? { assigned: 0, completed: 0 };
    bucket.assigned += 1;
    if (statusGroupOf(t.status) === "completed") bucket.completed += 1;
    byDate.set(d, bucket);
  }

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }));
}
