/**
 * OVERALL STATUS — real-data adapter.
 *
 * Pulls live tickets via Supabase RLS (company-scoped) and rolls them up into
 * the shapes the OverallStatusPage charts and ranking tables need. The
 * upstream reference (janeyyy16/usapp) was hard-coded dummy data; this
 * version computes everything from the `tickets` table so the page reflects
 * the actual state of the company.
 *
 * Shape contract (kept compatible with the reference component so the
 * imports continue to type-check):
 *  - MONTHLY_STATS / DAILY_STATS — array of points for the line chart
 *  - STAT_LINES                   — line definitions (brand keys + colors)
 *  - PENDING_BY_STATUS            — donut slices grouped by repair status
 *  - PENDING_BY_LOCATION          — donut slices grouped by office / branch
 *  - CSR_ACTIVITY                 — donut slices grouped by created-by user
 *  - TECH_RANKING                 — table rows ranked by 30-day completion rate
 *                                    (completed / assigned, cancelled voided out)
 *  - ALL_LOCATIONS_FILTER         — flat list for the location dropdown
 */

import { getCompanyTickets, getTicketAuditLog } from "./supabase/tickets";
import { getCompanyUsers } from "./supabase/users";
import { isPendingStatus, statusGroupOf, type Ticket } from "./ticketData";

/** Minimal per-ticket info for the Completion Rate drill-down — enough to
 *  list and link to a ticket without holding the full Ticket object. */
export interface TicketRef {
  ticketNo: string;
  customer: string;
  status: string;
  created: string;
}

export interface RankingRow {
  rank: number;
  name: string;
  office: string;
  /** All-time count of tickets ever assigned to this tech, any status. */
  assigned: number;
  /** Count with a "completed" status group. */
  completed: number;
  /** Count with a "cancelled" status group — voided out of completionRate entirely. */
  cancelled: number;
  /** Comma-joined tally of this tech's cancellation reasons, e.g. "Cancelled By Warranty (2), Duplicate (1)". Empty string when none recorded. */
  cancellationReasons: string;
  /** completed / (assigned - cancelled) * 100 — cancelled tickets counted toward neither side. Null when that denominator is 0. */
  completionRate: number | null;
  /** Drill-down ticket lists backing the three counts above, plus the reason on each cancelled ticket. */
  completedTickets: TicketRef[];
  cancelledTickets: (TicketRef & { reason: string })[];
  /** Assigned tickets that are neither completed nor cancelled — still open/in progress. */
  openTickets: TicketRef[];
}

/**
 * One point on the Ticket Statistics line chart. `date` is the axis label;
 * every other key is a ticket-source name (e.g. "GE", "Assurant", "SPPN",
 * "SQUARE TRADE") with the count for that source on that day/month. `TOTAL`
 * is always present.
 */
export interface StatPoint {
  date: string;
  TOTAL: number;
  [source: string]: number | string;
}

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

export interface OverallStatusData {
  monthlyStats: StatPoint[];
  dailyStats: StatPoint[];
  /** One entry per ticket-source plus TOTAL. Order = TOTAL first, then by
   *  descending total count so the busiest source is drawn next. */
  statLines: { key: string; color: string }[];
  pendingByStatus: DonutSlice[];
  pendingByLocation: DonutSlice[];
  csrActivity: DonutSlice[];
  techRanking: RankingRow[];
  allLocationsFilter: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Color palettes (reused for donuts so visuals stay close to the reference).
// ────────────────────────────────────────────────────────────────────────────

const DONUT_PALETTE = [
  "#0d9488", "#c4b5fd", "#cbb994", "#38bdf8", "#ec4899",
  "#a5b4fc", "#a16207", "#1d4ed8", "#15803d", "#b45309",
  "#92400e", "#475569", "#059669", "#166534", "#ea580c",
  "#7c3aed", "#0891b2", "#84cc16", "#f472b6", "#1e3a8a",
  "#b91c1c", "#67e8f9", "#a78bfa", "#fca5a5", "#9ca3af",
];

// Status palette mirrors the Ticket List statusColorClass so the donut shares
// the same visual language as the rest of the app.
const STATUS_COLOR: Record<string, string> = {
  "pt-need preauthorization": "#ea580c", // orange
  "cl-ready to complete": "#ef4444",     // red
  "op-ready for service": "#3b82f6",     // blue
  "csr-left message for cx": "#10b981",  // mint
  "op-waiting for part": "#f59e0b",      // yellow
  "csr-assigned to asc": "#cbd5e1",      // near-white
  "cl-parts back ordered": "#94a3b8",
  "tr-need triage": "#9ca3af",           // grey
  "cl-need cancel": "#fdba74",           // peach
  "op-reschedule follow up": "#ec4899",  // pink
  "csr-acknowledged": "#f43f5e",         // coral
  "tr-need po": "#a16207",
  "op-update hold": "#f59e0b",
  "csr-needs scheduling": "#38bdf8",
};

// Known sources get reserved colors so they're visually stable across loads;
// any new sources fall back to the donut palette.
const SOURCE_COLOR: Record<string, string> = {
  TOTAL: "#22c55e",
  "GE": "#3b82f6",
  "ASSURANT": "#14b8a6",
  "ASSURANT SOLUTIONS": "#14b8a6",
  "CENTRICITY": "#a78bfa",
  "SPPN": "#f59e0b",
  "SP": "#f59e0b",
  "SQUARE TRADE": "#f472b6",
  "SQUARETRADE": "#f472b6",
  "AIG WARRANTY": "#ec4899",
  "AIG": "#ec4899",
  "ALLIANCE - SPEED QUEEN": "#0891b2",
  "ALLIANCE": "#0891b2",
  "CALL IN": "#a16207",
  "DUPLICATE": "#9ca3af",
  "WEBSITE SALES": "#7c3aed",
};

function sourceColor(name: string, idx: number): string {
  const key = String(name || "").trim().toUpperCase();
  return SOURCE_COLOR[key] ?? DONUT_PALETTE[idx % DONUT_PALETTE.length];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function statusColor(name: string, idx: number): string {
  const key = (name || "").trim().toLowerCase();
  return STATUS_COLOR[key] ?? DONUT_PALETTE[idx % DONUT_PALETTE.length];
}

// isPendingStatus / isClosedStatus are now the shared helpers imported from
// ./ticketData — the single source of truth for what "Open / Pending" means
// across Ticket List, this dashboard, and Operations Daily Report, after a
// prior drift bug where two separately-copied versions disagreed on statuses
// with no csr-/op-/pt-/tr-/cl- prefix (e.g. a bare "Acknowledged").

function ticketSourceName(ticket: Ticket): string {
  // Prefer the explicit Ticket Source; fall back to manufacturer / account so
  // we never end up with empty strings.
  const raw = (ticket.ticketSource || ticket.manufacturer || ticket.account || "").trim();
  return raw || "Unknown";
}

function toMonth(iso: string): string {
  // "2026-06-25T..." → "2026-06". Also tolerates "06/25/2026".
  // Ticket `created` is stored as a bare "YYYY-MM-DD" date (see
  // tickets.ts: `row.created_at.slice(0, 10)`), which `new Date(...)`
  // parses as UTC midnight. Reading it back with local getters (getMonth/
  // getDate) shifts the bucket a day earlier in any timezone behind UTC —
  // use the UTC getters so the bucket matches the stored calendar date.
  if (!iso) return "";
  const d = new Date(iso);
  if (!isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return "";
}

function toDay(iso: string): string {
  // → "MM/DD" to match the reference's daily axis labels. See toMonth for
  // why UTC getters are required here.
  if (!iso) return "";
  const d = new Date(iso);
  if (!isNaN(d.getTime())) {
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return "";
}

// ────────────────────────────────────────────────────────────────────────────
// Core: roll tickets into chart-ready buckets.
// ────────────────────────────────────────────────────────────────────────────

// A ticket's Posting date (`created`, a bare "YYYY-MM-DD" string — see
// tickets.ts) falls within [startDate, endDate] when given. Matches the
// Ticket List's Posting-date filter so this dashboard and the ticket list
// agree on what "in range" means.
function inPostingRange(created: string, startDate?: string, endDate?: string): boolean {
  if (!startDate && !endDate) return true;
  if (!created) return false;
  if (startDate && created < startDate) return false;
  if (endDate && created > endDate) return false;
  return true;
}

/**
 * Pull live tickets for the caller's company and compute every section the
 * OverallStatusPage renders. Lightweight enough to call on mount.
 *
 * `startDate`/`endDate` (bare "YYYY-MM-DD") scope the Ticket Statistics
 * chart and the two Pending-by donuts to tickets posted in that window;
 * CSR Activity and the ranking tables keep their own fixed windows.
 */
export async function loadOverallStatusData(opts?: { startDate?: string; endDate?: string }): Promise<OverallStatusData> {
  const { startDate, endDate } = opts ?? {};
  const [ticketsAll, profiles, auditLog] = await Promise.all([
    getCompanyTickets(),
    // Profiles roster — we need this to know which display_name/email/username
    // belong to users that hold the CSR role (primary or in extra_roles).
    // If the call fails, we still want the rest of the dashboard to render.
    getCompanyUsers().catch((err) => {
      console.error("Failed to load profiles for CSR activity:", err);
      return [] as Awaited<ReturnType<typeof getCompanyUsers>>;
    }),
    // Full change history (every status/reassign/reschedule action, not just
    // the "last changer" pointer stored on the ticket) — see csrCounts below
    // for why this matters.
    getTicketAuditLog().catch((err) => {
      console.error("Failed to load ticket audit log for CSR activity:", err);
      return [] as Awaited<ReturnType<typeof getTicketAuditLog>>;
    }),
  ]);

  // Build a lookup of CSR-role users. A user counts as "CSR" if their
  // primary role OR any entry in extra_roles starts with "CSR" (covers
  // CSR, CSR_AGENT, CSR_TEAM_LEADER, CSR_MANAGER). The Postgres audit
  // trigger writes tickets.status_changed_by = profiles.id (UUID), so the
  // primary lookup key MUST be the profile id. We also index by
  // display_name, username, and email as a safety net for older rows that
  // may have stamped a string instead of a uuid.
  const csrIdentities = new Map<string, string>(); // lowercased identifier → display name
  for (const p of profiles) {
    const primary = String((p as any).role || "").toUpperCase();
    const extras = ((p as any).extra_roles as string[] | null | undefined) || [];
    const isCsr = primary.startsWith("CSR") || extras.some((r) => String(r).toUpperCase().startsWith("CSR"));
    if (!isCsr) continue;
    const display = (p as any).display_name || (p as any).username || (p as any).email || "CSR";
    [
      (p as any).id,
      (p as any).firebase_uid,
      (p as any).display_name,
      (p as any).username,
      (p as any).email,
    ].forEach((k) => {
      if (!k) return;
      csrIdentities.set(String(k).trim().toLowerCase(), display);
    });
  }

  // Ticket Statistics (the line chart below) is scoped to the selected
  // Posting-date range as a flow metric — how many tickets were posted
  // within [startDate, endDate]. The two Pending-by donuts use a different,
  // "as of" snapshot instead (see `pendingAsOf` further down); CSR Activity
  // and the ranking tables keep using the full roster (`ticketsAll`) with
  // their own fixed windows.
  const tickets = ticketsAll.filter((t) => inPostingRange(t.created, startDate, endDate));

  // ── Source totals (for line ordering + chart legend) ───────────────────
  // First pass: count tickets per source so we know which lines to draw and
  // in what order (busiest first, after TOTAL).
  const sourceTotals = new Map<string, number>();
  for (const t of tickets) {
    const src = ticketSourceName(t);
    sourceTotals.set(src, (sourceTotals.get(src) ?? 0) + 1);
  }
  const orderedSources = Array.from(sourceTotals.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);

  // ── Monthly stats (scoped to the selected Posting-date range) ───────────
  // Each bucket holds a count per source plus the TOTAL.
  const monthBuckets = new Map<string, Record<string, number>>();
  for (const t of tickets) {
    const m = toMonth(t.created);
    if (!m) continue;
    if (!monthBuckets.has(m)) monthBuckets.set(m, { TOTAL: 0 });
    const bucket = monthBuckets.get(m)!;
    bucket.TOTAL += 1;
    const src = ticketSourceName(t);
    bucket[src] = (bucket[src] ?? 0) + 1;
  }
  const monthlyStats: StatPoint[] = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => {
      // Make sure every known source appears as 0 on months with no data so
      // the line chart doesn't break the line.
      const full: Record<string, number> = { TOTAL: vals.TOTAL };
      for (const s of orderedSources) full[s] = vals[s] ?? 0;
      return { date, ...full } as StatPoint;
    });

  // ── Daily stats (scoped to the selected Posting-date range) ─────────────
  const dayBuckets = new Map<string, { iso: string; counts: Record<string, number> }>();
  for (const t of tickets) {
    if (!t.created) continue;
    const d = new Date(t.created);
    if (isNaN(d.getTime())) continue;
    const iso = d.toISOString().slice(0, 10);
    const label = toDay(t.created);
    if (!dayBuckets.has(iso)) dayBuckets.set(iso, { iso, counts: { TOTAL: 0 } });
    const bucket = dayBuckets.get(iso)!;
    bucket.counts.TOTAL += 1;
    const src = ticketSourceName(t);
    bucket.counts[src] = (bucket.counts[src] ?? 0) + 1;
    (bucket as any).date = label;
  }
  const dailyStats: StatPoint[] = Array.from(dayBuckets.values())
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .map((b) => {
      const full: Record<string, number> = { TOTAL: b.counts.TOTAL };
      for (const s of orderedSources) full[s] = b.counts[s] ?? 0;
      return { date: (b as any).date, ...full } as StatPoint;
    });

  // ── Stat lines (TOTAL first, then every source in popularity order) ────
  const statLines = [
    { key: "TOTAL", color: SOURCE_COLOR.TOTAL },
    ...orderedSources.map((name, i) => ({ key: name, color: sourceColor(name, i) })),
  ];

  // "As of" backlog snapshot for the two Pending-by donuts: every ticket
  // that already existed by the selected end date (no lower bound — an
  // older ticket that's still open belongs in today's backlog even if it
  // was posted before the start date) and is still pending right now. This
  // is a point-in-time snapshot, not a flow-within-the-window count, so it
  // deliberately does NOT reuse `tickets` (which is bounded on both ends
  // for the Ticket Statistics chart above).
  const pendingAsOf = ticketsAll.filter((t) => {
    if (endDate && t.created > endDate) return false;
    return isPendingStatus(t.status);
  });

  // ── Pending by status (donut) ───────────────────────────────────────────
  const statusCounts = new Map<string, number>();
  for (const t of pendingAsOf) {
    statusCounts.set(t.status, (statusCounts.get(t.status) ?? 0) + 1);
  }
  const pendingByStatus: DonutSlice[] = Array.from(statusCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], i) => ({ name, value, color: statusColor(name, i) }));

  // ── Pending by location (donut) ─────────────────────────────────────────
  // Keyed on t.location only (no t.branch fallback) so this always agrees
  // with Ticket List's location filter, which only ever reads t.location.
  // A branch-only fallback here let tickets with a blank `location` get
  // counted under a location on this dashboard while being unfindable in
  // Ticket List when filtered to that same location.
  const locationCounts = new Map<string, number>();
  for (const t of pendingAsOf) {
    const key = (t.location || "").trim() || "Unassigned";
    locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1);
  }
  const pendingByLocation: DonutSlice[] = Array.from(locationCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], i) => ({ name, value, color: DONUT_PALETTE[i % DONUT_PALETTE.length] }));

  // ── CSR activity (donut) ────────────────────────────────────────────────
  // Count, per CSR-role user, every status/reassign/reschedule action they've
  // ever made — read from the FULL ticket_audit_log history, not
  // tickets.status_changed_by. That column only stores the single most
  // recent changer per ticket, so a CSR's early-stage edits disappear from
  // it the moment anyone else (a manager closing the ticket, etc.) touches
  // the same ticket later — undercounting exactly the CSRs who work tickets
  // at an early stage and hand them off.
  const csrCounts = new Map<string, number>();
  for (const entry of auditLog) {
    const who = String(entry.changedBy || "").trim();
    if (!who) continue;
    const display = csrIdentities.get(who.toLowerCase());
    if (!display) continue; // not a CSR-role user
    csrCounts.set(display, (csrCounts.get(display) ?? 0) + 1);
  }
  const csrActivity: DonutSlice[] = Array.from(csrCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], i) => ({ name, value, color: DONUT_PALETTE[i % DONUT_PALETTE.length] }));

  // ── Tech ranking (Completion Rate) ──────────────────────────────────────
  // All-time per-tech totals: Assigned (every ticket ever assigned to them,
  // any status), Completed, Cancelled, and Completion Rate = Completed /
  // (Assigned - Cancelled). A cancelled ticket is voided out of BOTH sides of
  // that rate — it neither counts as an assignment nor a completion for KPI
  // purposes, so a cancellation never helps or hurts a tech's rate — but it's
  // still counted and shown in its own Cancelled column, and its reason (if
  // recorded) is kept and shown rather than discarded.
  // Some tickets get stamped with a manager or office/admin account (e.g.
  // "Daven Hodge" — primary role Senior Branch Manager, "Memphis Admin" — no
  // profile at all) as a fallback when no field tech is assigned yet. Those
  // aren't real techs and skew the ranking with 0%/100% rows from a handful
  // of tickets, so exclude them — but NOT everyone lacking a profile match:
  // some real field techs (e.g. "Erick Guzman Juarez") have no User
  // Management account yet and would be wrongly dropped by a strict
  // "must match a TECHNICIAN profile" allow-list. A role that merely
  // *contains* "TECHNICIAN" (e.g. TECHNICIAN_MANAGER) still personally
  // works tickets and counts as a real tech — only exclude roles with no
  // technician component at all (Senior Branch Manager, BIZOPS_MANAGER, ...).
  const nonTechRoleByName = new Map<string, string>(); // lowercased display/username → primary role
  for (const p of profiles) {
    const display = ((p as any).display_name || (p as any).username || "").trim();
    if (!display) continue;
    const primary = String((p as any).role || "").toUpperCase();
    if (primary && !primary.includes("TECHNICIAN")) nonTechRoleByName.set(display.toLowerCase(), primary);
  }
  const isNonTechName = (tech: string) =>
    nonTechRoleByName.has(tech.toLowerCase()) || /\badmin\b/i.test(tech);

  // One row per technician — not per (technician, office) pair. Grouping by
  // office fragmented a tech across multiple rows whenever their tickets
  // carried different (or blank) location values, e.g. Erick Guzman Juarez
  // showing once under "San Antonio" and again under "—" for a handful of
  // tickets with no recorded location. The displayed office is whichever
  // one shows up most often among that tech's tickets.
  type TechAgg = {
    name: string;
    officeCounts: Map<string, number>;
    assigned: number;
    completed: number;
    cancelled: number;
    reasonCounts: Map<string, number>;
    completedTickets: TicketRef[];
    cancelledTickets: (TicketRef & { reason: string })[];
    openTickets: TicketRef[];
  };
  const techMap = new Map<string, TechAgg>();
  for (const t of ticketsAll) {
    const tech = (t.technician || "").trim();
    if (!tech || /unassigned/i.test(tech)) continue;
    if (isNonTechName(tech)) continue;
    const key = tech.toLowerCase();
    if (!techMap.has(key)) {
      techMap.set(key, {
        name: tech,
        officeCounts: new Map(),
        assigned: 0,
        completed: 0,
        cancelled: 0,
        reasonCounts: new Map(),
        completedTickets: [],
        cancelledTickets: [],
        openTickets: [],
      });
    }
    const agg = techMap.get(key)!;
    const office = (t.location || t.branch || "").trim();
    if (office) agg.officeCounts.set(office, (agg.officeCounts.get(office) ?? 0) + 1);
    agg.assigned += 1;
    const ref: TicketRef = { ticketNo: t.ticketNo, customer: t.customer || "", status: t.status, created: t.created || "" };
    const group = statusGroupOf(t.status);
    if (group === "completed") {
      agg.completed += 1;
      agg.completedTickets.push(ref);
    } else if (group === "cancelled") {
      agg.cancelled += 1;
      const reason = (t.cancellationReason || "").trim();
      if (reason) agg.reasonCounts.set(reason, (agg.reasonCounts.get(reason) ?? 0) + 1);
      agg.cancelledTickets.push({ ...ref, reason: reason || "—" });
    } else {
      agg.openTickets.push(ref);
    }
  }
  const techRows = Array.from(techMap.values())
    .map((a) => {
      const denom = a.assigned - a.cancelled;
      return {
        name: a.name,
        office: Array.from(a.officeCounts.entries()).sort(([, x], [, y]) => y - x)[0]?.[0] ?? "—",
        assigned: a.assigned,
        completed: a.completed,
        cancelled: a.cancelled,
        cancellationReasons: Array.from(a.reasonCounts.entries())
          .sort(([, x], [, y]) => y - x)
          .map(([reason, count]) => `${reason} (${count})`)
          .join(", "),
        completionRate: denom > 0 ? Math.round((a.completed / denom) * 10000) / 100 : null,
        completedTickets: a.completedTickets,
        cancelledTickets: a.cancelledTickets,
        openTickets: a.openTickets,
      };
    })
    .sort((a, b) => (b.completionRate ?? -1) - (a.completionRate ?? -1));
  const techRanking: RankingRow[] = techRows.map((r, i) => ({ rank: i + 1, ...r }));

  const allLocationsFilter = ["ALL", ...Array.from(new Set(ticketsAll.map((t) => (t.location || "").trim()).filter(Boolean))).sort()];

  return {
    monthlyStats,
    dailyStats,
    statLines,
    pendingByStatus,
    pendingByLocation,
    csrActivity,
    techRanking,
    allLocationsFilter,
  };
}

// Empty defaults so the page can render before data arrives.
export const EMPTY_OVERALL_STATUS: OverallStatusData = {
  monthlyStats: [],
  dailyStats: [],
  statLines: [{ key: "TOTAL", color: SOURCE_COLOR.TOTAL }],
  pendingByStatus: [],
  pendingByLocation: [],
  csrActivity: [],
  techRanking: [],
  allLocationsFilter: ["ALL"],
};
