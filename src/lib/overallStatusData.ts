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
 *  - TECH_RANKING                 — table rows ranked by 30-day completion %
 *  - LOCATION_RANKING             — table rows ranked by 30-day completion %
 *  - ALL_LOCATIONS_FILTER         — flat list for the location dropdown
 */

import { getCompanyTickets } from "./supabase/tickets";
import { getCompanyUsers } from "./supabase/users";
import type { Ticket } from "./ticketData";

export interface RankingRow {
  rank: number;
  name: string;
  office: string;
  thirtyDay: number | null;
  tenDay: number | null;
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
  locationRanking: RankingRow[];
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

// Kept byte-for-byte in sync with `statusGroupOf` in TicketList.tsx. That
// function is the source of truth for what "Open / Pending" means in this
// app; this dashboard must bucket tickets the exact same way or its counts
// will silently drift from the Ticket List's "Open / Pending" filter (this
// caused a real mismatch: statuses like "Acknowledged" have no csr-/op-/pt-/
// tr-/cl- prefix, so the old blacklist-based check here counted them as
// pending while TicketList's whitelist-based check put them in "other" and
// excluded them from Open/Pending).
type StatusGroup = "open" | "completed" | "cancelled";

function statusGroupOf(status: string): StatusGroup | "other" {
  const v = String(status || "").trim().toLowerCase();
  if (!v) return "other";
  if (v.includes("need cancel")) return "open";
  if (v === "cl-cancelled" || v === "cancelled" || /\bcancell?ed\b/.test(v)) return "cancelled";
  if (
    v === "cl-completed" ||
    v === "completed" ||
    v === "cl-claimed" ||
    v === "claimed" ||
    v.includes("data closed") ||
    v.includes("data-closed")
  ) return "completed";
  if (
    v.startsWith("csr-") ||
    v.startsWith("op-") ||
    v.startsWith("pt-") ||
    v.startsWith("tr-") ||
    v.startsWith("cl-")
  ) return "open";
  return "other";
}

function isClosedStatus(status: string): boolean {
  return statusGroupOf(status) === "completed" || statusGroupOf(status) === "cancelled";
}

// "Pending" now means exactly what TicketList's "Open / Pending" filter
// means: statusGroupOf(status) === "open". Statuses that fall into "other"
// (no recognized prefix, e.g. a bare "Acknowledged") are excluded from both,
// instead of being silently swept into "pending" here.
function isPendingStatus(status: string): boolean {
  return statusGroupOf(status) === "open";
}

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

function isWithinDays(iso: string, days: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const ageMs = Date.now() - d.getTime();
  return ageMs <= days * 24 * 60 * 60 * 1000;
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
  const [ticketsAll, profiles] = await Promise.all([
    getCompanyTickets(),
    // Profiles roster — we need this to know which display_name/email/username
    // belong to users that hold the CSR role (primary or in extra_roles).
    // If the call fails, we still want the rest of the dashboard to render.
    getCompanyUsers().catch((err) => {
      console.error("Failed to load profiles for CSR activity:", err);
      return [] as Awaited<ReturnType<typeof getCompanyUsers>>;
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

  // Ticket Statistics + both Pending-by donuts are scoped to the selected
  // Posting-date range; CSR Activity and the ranking tables below keep
  // using the full roster (`ticketsAll`) with their own fixed windows.
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

  // ── Pending by status (donut) ───────────────────────────────────────────
  const statusCounts = new Map<string, number>();
  for (const t of tickets) {
    if (!isPendingStatus(t.status)) continue;
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
  for (const t of tickets) {
    if (!isPendingStatus(t.status)) continue;
    const key = (t.location || "").trim() || "Unassigned";
    locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1);
  }
  const pendingByLocation: DonutSlice[] = Array.from(locationCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], i) => ({ name, value, color: DONUT_PALETTE[i % DONUT_PALETTE.length] }));

  // ── CSR activity (donut) ────────────────────────────────────────────────
  // Count, per CSR-role user, how many tickets they changed the status on.
  // Source signal: tickets.status_changed_by — the audit trigger records who
  // last moved the status. Matched against the CSR roster so non-CSR
  // activity (e.g. a manager closing a ticket) is excluded.
  const csrCounts = new Map<string, number>();
  for (const t of ticketsAll) {
    const who = String(t.statusChangedBy || "").trim();
    if (!who) continue;
    const display = csrIdentities.get(who.toLowerCase());
    if (!display) continue; // not a CSR-role user
    csrCounts.set(display, (csrCounts.get(display) ?? 0) + 1);
  }
  const csrActivity: DonutSlice[] = Array.from(csrCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], i) => ({ name, value, color: DONUT_PALETTE[i % DONUT_PALETTE.length] }));

  // ── Tech ranking ────────────────────────────────────────────────────────
  // Completion rate = closed-or-completed / assigned within the window.
  type TechAgg = { name: string; office: string; thirty: { done: number; total: number }; ten: { done: number; total: number } };
  const techMap = new Map<string, TechAgg>();
  for (const t of ticketsAll) {
    const tech = (t.technician || "").trim();
    if (!tech || /unassigned/i.test(tech)) continue;
    const office = (t.location || t.branch || "—").trim() || "—";
    const key = `${tech}::${office}`;
    if (!techMap.has(key)) techMap.set(key, { name: tech, office, thirty: { done: 0, total: 0 }, ten: { done: 0, total: 0 } });
    const agg = techMap.get(key)!;
    const done = isClosedStatus(t.status);
    const stamp = t.statusChangedAt || t.created;
    if (isWithinDays(stamp, 30)) { agg.thirty.total += 1; if (done) agg.thirty.done += 1; }
    if (isWithinDays(stamp, 10)) { agg.ten.total += 1; if (done) agg.ten.done += 1; }
  }
  const techRows = Array.from(techMap.values())
    .map((a) => ({
      name: a.name,
      office: a.office,
      thirtyDay: a.thirty.total > 0 ? Math.round((a.thirty.done / a.thirty.total) * 10000) / 100 : null,
      tenDay: a.ten.total > 0 ? Math.round((a.ten.done / a.ten.total) * 10000) / 100 : null,
    }))
    .filter((r) => r.thirtyDay !== null || r.tenDay !== null)
    .sort((a, b) => (b.thirtyDay ?? -1) - (a.thirtyDay ?? -1));
  const techRanking: RankingRow[] = techRows.map((r, i) => ({ rank: i + 1, ...r }));

  // ── Location ranking ────────────────────────────────────────────────────
  type LocAgg = { office: string; thirty: { done: number; total: number }; ten: { done: number; total: number } };
  const locMap = new Map<string, LocAgg>();
  for (const t of ticketsAll) {
    const office = (t.location || t.branch || "").trim();
    if (!office) continue;
    if (!locMap.has(office)) locMap.set(office, { office, thirty: { done: 0, total: 0 }, ten: { done: 0, total: 0 } });
    const agg = locMap.get(office)!;
    const done = isClosedStatus(t.status);
    const stamp = t.statusChangedAt || t.created;
    if (isWithinDays(stamp, 30)) { agg.thirty.total += 1; if (done) agg.thirty.done += 1; }
    if (isWithinDays(stamp, 10)) { agg.ten.total += 1; if (done) agg.ten.done += 1; }
  }
  const locRows = Array.from(locMap.values())
    .map((a) => ({
      name: a.office,
      office: a.office,
      thirtyDay: a.thirty.total > 0 ? Math.round((a.thirty.done / a.thirty.total) * 10000) / 100 : null,
      tenDay: a.ten.total > 0 ? Math.round((a.ten.done / a.ten.total) * 10000) / 100 : null,
    }))
    .filter((r) => r.thirtyDay !== null || r.tenDay !== null)
    .sort((a, b) => (b.thirtyDay ?? -1) - (a.thirtyDay ?? -1));
  const locationRanking: RankingRow[] = locRows.map((r, i) => ({ rank: i + 1, ...r }));

  const allLocationsFilter = ["ALL", ...Array.from(new Set(locationRanking.map((r) => r.office))).sort()];

  return {
    monthlyStats,
    dailyStats,
    statLines,
    pendingByStatus,
    pendingByLocation,
    csrActivity,
    techRanking,
    locationRanking,
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
  locationRanking: [],
  allLocationsFilter: ["ALL"],
};
