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

// LTP aging bucket: 1-7 mean "aged exactly N days", 8 means "aged 8+ days"
// (the dropdown's open-ended catch-all bucket). A ticket with aging 0 never
// matches any bucket — same-day tickets aren't "late" by definition.
export const LTP_AGING_MAX_BUCKET = 8;

export function matchesAgingBucket(aging: number | null | undefined, buckets: Set<number>): boolean {
  if (buckets.size === 0) return false;
  const a = Math.floor(aging ?? 0);
  if (a >= LTP_AGING_MAX_BUCKET) return buckets.has(LTP_AGING_MAX_BUCKET);
  return buckets.has(a);
}

/** Human label for the current bucket selection, e.g. "7+ Days", "3, 5, 8+ Days", "All Days". */
export function describeAgingBuckets(buckets: Set<number>): string {
  if (buckets.size === 0) return "None";
  if (buckets.size === LTP_AGING_MAX_BUCKET) return "All Days";
  const sorted = Array.from(buckets).sort((a, b) => a - b);
  // A contiguous run ending at the open-ended "8+" bucket (e.g. {7,8}) is
  // really just a single "N+ days" threshold — read that way ("7+ Days")
  // rather than as an enumerated list ("7, 8+ Days").
  const isContiguousToMax =
    sorted[sorted.length - 1] === LTP_AGING_MAX_BUCKET && sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (isContiguousToMax) return `${sorted[0]}+ Days`;
  const parts = sorted.map((n) => (n >= LTP_AGING_MAX_BUCKET ? `${n}+` : `${n}`));
  return `${parts.join(", ")} Days`;
}

// Accepts ISO, MM/DD/YY and MM/DD/YYYY formats (same formats TicketList's
// equivalent daysSinceCreated/daysAgo helpers handle).
function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const raw = String(dateStr).trim();
  let d: Date | null = null;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const mm = parseInt(slash[1], 10) - 1;
    const dd = parseInt(slash[2], 10);
    let yy = parseInt(slash[3], 10);
    if (yy < 100) yy += 2000;
    d = new Date(yy, mm, dd);
  } else {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

// The stored `t.aging` column is written once — always 0 — at ticket
// creation/sync (see NewTicketPage.tsx, servicePowerSync.ts) and nothing
// ever increments it afterward, so it's permanently 0 for essentially every
// ticket rather than a live day-count. Real elapsed time is derived the same
// way TicketList's actual "Aging" column does: days since the last status
// change, falling back to days since the ticket was created when there's no
// recorded status change yet (skips TicketList's further localStorage-only
// statusLog fallback — that's per-browser and not appropriate for a
// company-wide report).
function liveAgingDays(t: Ticket): number {
  return daysSince(t.statusChangedAt) ?? daysSince(t.created) ?? 0;
}

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
  /** % of tickets entered within [dateFrom, dateTo] that are still open ("pending") and match the selected LTP aging bucket(s). Null when there are no such tickets. */
  dailyLTP: number | null;
  /** Count of date-range tickets that are still open and match the selected aging bucket(s) — the numerator behind dailyLTP. */
  lateCount: number;
  /** Count of date-range tickets that are still open, any aging — the denominator behind dailyLTP. */
  pendingCount: number;
  /** % of tickets entered this month (any status) that are currently open and match the selected aging bucket(s). Null when no tickets were entered this month. */
  monthlyLTP: number | null;
  /** Count of this-month tickets that are currently open and match the selected aging bucket(s) — the numerator behind monthlyLTP. */
  monthlyLateCount: number;
  /** Count of all tickets entered this month at this branch, any status — the denominator behind monthlyLTP. */
  monthlyTotalCount: number;
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
 * within [dateFrom, dateTo]. `agingBuckets` is the user-selected set of LTP
 * aging buckets (1-7 = exact days, 8 = "8+ days") — see matchesAgingBucket.
 * Daily LTP is scoped to tickets CREATED within [dateFrom, dateTo] that are
 * still open today (so changing the date range actually moves the number);
 * Need Cancel stays a live snapshot (a cancel request stays live until
 * resolved, independent of any date range) — everything else is scoped to
 * the date range.
 */
export function computeBranchRows(
  tickets: Ticket[],
  regionLocations: string[],
  dateFrom: string,
  dateTo: string,
  agingBuckets: Set<number>,
): BranchRow[] {
  const month = dateTo.slice(0, 7);

  return regionLocations.map((branch) => {
    const branchTickets = tickets.filter((t) => normalizeLocation(t.location) === normalizeLocation(branch));

    const openTickets = branchTickets.filter(
      (t) => statusGroupOf(t.status) === "open" && inRange(t.created, dateFrom, dateTo),
    );
    const lateCount = openTickets.filter((t) => matchesAgingBucket(liveAgingDays(t), agingBuckets)).length;
    const dailyLTP = openTickets.length > 0 ? (lateCount / openTickets.length) * 100 : null;

    // Monthly LTP: numerator is this-month tickets that are currently open
    // AND late; denominator is every ticket entered this month regardless of
    // status (open, completed, or cancelled) — "number of tickets entered
    // for this location," not just the ones still open today.
    const monthlyTickets = branchTickets.filter((t) => dateOnly(t.created).slice(0, 7) === month);
    const monthlyLateCount = monthlyTickets.filter(
      (t) => statusGroupOf(t.status) === "open" && matchesAgingBucket(liveAgingDays(t), agingBuckets),
    ).length;
    const monthlyLTP = monthlyTickets.length > 0 ? (monthlyLateCount / monthlyTickets.length) * 100 : null;

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
      dailyLTP: dailyLTP !== null ? Math.round(dailyLTP * 100) / 100 : null,
      lateCount,
      pendingCount: openTickets.length,
      monthlyLTP: monthlyLTP !== null ? Math.round(monthlyLTP * 100) / 100 : null,
      monthlyLateCount,
      monthlyTotalCount: monthlyTickets.length,
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

export interface DailyLtpRow {
  /** YYYY-MM-DD — the day tickets in this row were CREATED, not a historical status snapshot (see computeDailyLtpBreakdown). */
  date: string;
  /** Currently-open tickets from this day's cohort matching the selected aging bucket(s). */
  lateCount: number;
  /** Currently-open tickets from this day's cohort, any aging. */
  pendingCount: number;
  /** Running cumulative sum of pendingCount from day 1 of the month through this day. */
  monthTotalPending: number;
  /** lateCount / pendingCount for this day. Null when pendingCount is 0. */
  ltpPct: number | null;
  /** Comma-joined tally of which branch(es) this day's pending tickets belong to, e.g. "Asheville (2), Atlanta (1)". Empty string when pendingCount is 0. */
  locations: string;
}

/**
 * Per-day breakdown for one calendar month: tickets are grouped by the day
 * they were CREATED, then evaluated against their CURRENT open/aging state —
 * there's no stored historical snapshot of pending/aging counts to look back
 * on (aging is always computed live, as of right now; see liveAgingDays).
 * So a row doesn't mean "this was pending on that day" — it means "of the
 * tickets created that day, this many are still pending today, and this many
 * of those are aged into the selected bucket(s)."
 *
 * Stops at today for the current month (no point listing future empty days);
 * runs the full month otherwise.
 */
export function computeDailyLtpBreakdown(
  tickets: Ticket[],
  regionLocations: string[],
  monthYYYYMM: string,
  agingBuckets: Set<number>,
): DailyLtpRow[] {
  const locations = new Set(regionLocations.map(normalizeLocation));
  const scoped = tickets.filter((t) => locations.has(normalizeLocation(t.location)));

  const [y, m] = monthYYYYMM.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);
  const lastDay = monthYYYYMM === todayIso.slice(0, 7) ? Number(todayIso.slice(8, 10)) : daysInMonth;

  let cumPending = 0;
  const rows: DailyLtpRow[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${monthYYYYMM}-${String(day).padStart(2, "0")}`;
    const cohort = scoped.filter((t) => dateOnly(t.created) === dateStr);
    const openCohort = cohort.filter((t) => statusGroupOf(t.status) === "open");
    const late = openCohort.filter((t) => matchesAgingBucket(liveAgingDays(t), agingBuckets)).length;
    const pending = openCohort.length;
    cumPending += pending;

    const locationTally = new Map<string, number>();
    for (const t of openCohort) {
      const loc = normalizeLocation(t.location) || "Unknown";
      locationTally.set(loc, (locationTally.get(loc) ?? 0) + 1);
    }
    const locations = Array.from(locationTally.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([loc, count]) => `${loc} (${count})`)
      .join(", ");

    rows.push({
      date: dateStr,
      lateCount: late,
      pendingCount: pending,
      monthTotalPending: cumPending,
      ltpPct: pending > 0 ? Math.round((late / pending) * 10000) / 100 : null,
      locations,
    });
  }
  return rows;
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
