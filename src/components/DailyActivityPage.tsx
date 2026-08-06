import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, mergeLocationOptions } from "@/lib/locations";
import { getCompanyUsers } from "@/lib/supabase/users";
import { getCompanyTickets, getTicketAuditLog, type TicketAuditEntry } from "@/lib/supabase/tickets";
import { ROLE_LABELS } from "@/lib/roleLabels";

// Every audit action bucketed into exactly one of these, so a user's TOTAL
// always equals the sum of their columns (matches the reference report).
type ActionBucket =
  | "schedule" | "reschedule" | "cancel" | "callAttempt" | "csrUpdate"
  | "infoUpdate" | "completed" | "acknowledge" | "claimRequested" | "triageSupport";

const BUCKET_LABEL: Record<ActionBucket, string> = {
  schedule: "* SCHEDULE",
  reschedule: "RESCHEDULE",
  cancel: "CANCEL",
  callAttempt: "CALL ATTEMPT",
  csrUpdate: "CSR UPDATE",
  infoUpdate: "INFO. UPDATE",
  completed: "COMPLETED",
  acknowledge: "ACKNOWLEDGE",
  claimRequested: "CLAIM REQUESTED",
  triageSupport: "TRIAGE SUPPORT",
};
// One distinct color per action type, reused for both the per-user trend
// chart's lines and its legend/tooltip.
const BUCKET_COLOR: Record<ActionBucket, string> = {
  schedule: "#3b82f6",
  reschedule: "#818cf8",
  cancel: "#ef4444",
  callAttempt: "#f59e0b",
  csrUpdate: "#34d399",
  infoUpdate: "#06b6d4",
  completed: "#22c55e",
  acknowledge: "#f472b6",
  claimRequested: "#a78bfa",
  triageSupport: "#fb923c",
};
const BUCKET_ORDER: ActionBucket[] = [
  "schedule", "reschedule", "cancel", "callAttempt", "csrUpdate",
  "infoUpdate", "completed", "acknowledge", "claimRequested", "triageSupport",
];

// Classify a raw ticket_audit_log entry into one report column. `reschedule`
// actions split on before_value: no prior schedule_date means this is the
// first time the ticket was scheduled ("* SCHEDULE"); a prior value means an
// existing schedule is being moved ("RESCHEDULE"). status_change actions are
// bucketed off the new status's naming convention (CSR-/OP-/PT-/TR-/CL-
// prefixes, same taxonomy used everywhere else in this app). There is no
// tracked "call attempt" action anywhere in the schema, so that column has
// no live source and always reads 0 — kept in the table only so the layout
// matches the reference; it isn't fabricated.
function classify(entry: TicketAuditEntry): ActionBucket {
  if (entry.action === "reschedule") {
    return entry.beforeValue ? "reschedule" : "schedule";
  }
  if (entry.action === "reassign") return "infoUpdate";
  const after = (entry.afterValue || "").toLowerCase();
  if (/cancel/.test(after)) return "cancel";
  if (/claim/.test(after)) return "claimRequested";
  if (/completed|data.?closed/.test(after)) return "completed";
  if (/acknowledged/.test(after)) return "acknowledge";
  if (/triage/.test(after)) return "triageSupport";
  if (after.startsWith("csr-")) return "csrUpdate";
  return "infoUpdate";
}

// Same "is this ticket still open/pending" rule used by Ticket List / Overall
// Status, duplicated locally since neither exports it.
function isPendingStatus(status: string): boolean {
  const v = String(status || "").trim().toLowerCase();
  if (!v) return false;
  if (v.includes("need cancel")) return true;
  if (v === "cl-cancelled" || v === "cancelled" || /\bcancell?ed\b/.test(v)) return false;
  if (v === "cl-completed" || v === "completed" || v === "cl-claimed" || v === "claimed" || v.includes("data closed") || v.includes("data-closed")) return false;
  return v.startsWith("csr-") || v.startsWith("op-") || v.startsWith("pt-") || v.startsWith("tr-") || v.startsWith("cl-");
}

interface RawEntry {
  ticketNo: string;
  bucket: ActionBucket;
  when: string;
}

interface ActivityRow {
  userId: string;
  name: string;
  office: string;
  role: string;
  counts: Record<ActionBucket, number>;
  total: number;
  entries: RawEntry[];
}

const AUTO_REFRESH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "1", label: "Every 1 minute(s)" },
  { value: "5", label: "Every 5 minute(s)" },
  { value: "10", label: "Every 10 minute(s)" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 500];

// Checkbox dropdown controlling which action-type lines render on a trend
// chart. Portaled to <body> with `fixed` positioning (same fix as the User
// Type filter above) since the trigger sits inside a .panel — an absolute-
// positioned menu would get stuck behind the next sibling .panel, as each
// forms its own stacking context via backdrop-blur.
function ChartLineFilter({ selected, onChange }: { selected: Set<ActionBucket>; onChange: (next: Set<ActionBucket>) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    // `capture: true` is needed so scrolling the page (which this fixed-
    // position menu doesn't track) closes it — but scroll events fire on
    // ancestors during capture too, so scrolling the menu's own internal
    // checkbox list would otherwise also trigger this and close it before
    // the scroll could happen. Ignore scrolls that originate inside the menu.
    const close = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [open]);

  const allChecked = selected.size === BUCKET_ORDER.length;
  const toggleAll = () => onChange(allChecked ? new Set() : new Set(BUCKET_ORDER));
  const toggleOne = (b: ActionBucket) => {
    const next = new Set(selected);
    if (next.has(b)) next.delete(b); else next.add(b);
    onChange(next);
  };

  return (
    <span className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Lines ({selected.size}/{BUCKET_ORDER.length})
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            className="fixed z-50 w-48 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl"
            style={{ top: pos.top, right: pos.right }}
          >
            <label className="flex items-center gap-2 px-2 py-1 mb-1 rounded border-b border-white/10 hover:bg-white/5 cursor-pointer text-xs font-semibold text-slate-100">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-blue-500" />
              Select All
            </label>
            {BUCKET_ORDER.map((b) => (
              <label key={b} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer text-xs">
                <input type="checkbox" checked={selected.has(b)} onChange={() => toggleOne(b)} className="accent-blue-500" />
                <span style={{ color: BUCKET_COLOR[b] }}>{BUCKET_LABEL[b]}</span>
              </label>
            ))}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function DailyActivityPage({ mod, sub, companyId }: { mod: ModuleDef; sub: SubModuleDef; companyId: string | null }) {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("ALL");
  // Defaults to the last 30 days rather than just "today" — a single-day
  // window is too narrow to show anything meaningful once activity is
  // sparse, and this still lets Work Date From/To be narrowed to one day.
  const [dateFrom, setDateFrom] = useState(formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [dateTo, setDateTo] = useState(formatDate(new Date()));
  const [userTypeFilter, setUserTypeFilter] = useState<Set<string>>(new Set());
  const [userTypeOpen, setUserTypeOpen] = useState(false);
  const [userTypeMenuPos, setUserTypeMenuPos] = useState<{ top: number; left: number } | null>(null);
  const userTypeBtnRef = useRef<HTMLButtonElement>(null);
  const [autoRefresh, setAutoRefresh] = useState("0");

  // Portaled to <body> (see below) instead of relying on `absolute` inside
  // this filter panel — the panel and the table panel below it are sibling
  // .panel elements that each form their own stacking context, so a z-index
  // set inside one can never out-rank a later sibling panel. Same fix as
  // the LTP Aging dropdown on the Operations report.
  const openUserTypeMenu = () => {
    const rect = userTypeBtnRef.current?.getBoundingClientRect();
    if (rect) setUserTypeMenuPos({ top: rect.bottom + 4, left: rect.left });
    setUserTypeOpen(true);
  };
  useEffect(() => {
    if (!userTypeOpen) return;
    const close = () => setUserTypeOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [userTypeOpen]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [locationOptions, setLocationOptions] = useState<string[]>(["ALL", ...LOCATIONS]);

  const [detailsUser, setDetailsUser] = useState<ActivityRow | null>(null);
  const [detailsSearch, setDetailsSearch] = useState("");
  const [detailsPageSize, setDetailsPageSize] = useState(50);
  const [detailsPage, setDetailsPage] = useState(1);

  // Which action-type lines to draw on each trend chart — independent per
  // chart since the aggregate and per-user views are separate contexts.
  // Both default to "everything visible."
  const [overallVisibleBuckets, setOverallVisibleBuckets] = useState<Set<ActionBucket>>(new Set(BUCKET_ORDER));
  const [detailsVisibleBuckets, setDetailsVisibleBuckets] = useState<Set<ActionBucket>>(new Set(BUCKET_ORDER));

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [profiles, tickets, auditLog] = await Promise.all([
        getCompanyUsers(),
        getCompanyTickets(),
        getTicketAuditLog({ startDate: dateFrom || undefined, endDate: dateTo || undefined }),
      ]);

      const profileById = new Map(profiles.map((p) => [p.id, p]));
      const ticketMeta = new Map<string, string>();
      for (const t of tickets as any[]) if (t._id) ticketMeta.set(t._id, t.ticketNo);

      const byUser = new Map<string, ActivityRow>();
      for (const entry of auditLog) {
        const who = entry.changedBy;
        if (!who) continue;
        const profile = profileById.get(who);
        if (!profile || profile.is_active === false) continue;
        if (!byUser.has(who)) {
          byUser.set(who, {
            userId: who,
            name: profile.display_name || profile.username || profile.email || "Unknown",
            office: profile.assigned_branch || "Unknown",
            role: profile.role || "",
            counts: Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<ActionBucket, number>,
            total: 0,
            entries: [],
          });
        }
        const row = byUser.get(who)!;
        const bucket = classify(entry);
        row.counts[bucket] += 1;
        row.total += 1;
        row.entries.push({ ticketNo: ticketMeta.get(entry.ticketId) || "—", bucket, when: entry.createdAt });
      }

      const nextRows = Array.from(byUser.values()).sort((a, b) => b.total - a.total);
      setRows(nextRows);
      setPendingCount(tickets.filter((t) => isPendingStatus(t.status)).length);
      setLocationOptions(["ALL", ...mergeLocationOptions(LOCATIONS, profiles.map((p) => p.assigned_branch || ""))]);
      setLastModified(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load daily activity data.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh on the selected interval.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    const minutes = parseInt(autoRefresh, 10);
    if (minutes > 0) {
      intervalRef.current = setInterval(() => { load(); }, minutes * 60 * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load]);

  const userTypeOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.role))).filter(Boolean).sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (location !== "ALL" && row.office !== location) return false;
      if (userTypeFilter.size > 0 && !userTypeFilter.has(row.role)) return false;
      if (term && !`${row.name} ${row.office}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, search, location, userTypeFilter]);

  // Column totals across every currently-filtered user — a bottom summary
  // row alongside each row's own per-user total on the right.
  const columnTotals = useMemo(() => {
    const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<ActionBucket, number>;
    let total = 0;
    for (const row of filteredRows) {
      for (const b of BUCKET_ORDER) counts[b] += row.counts[b];
      total += row.total;
    }
    return { counts, total };
  }, [filteredRows]);

  // Daily activity trend across every currently-filtered user, broken down
  // by action type — same shape as the per-user drill-down chart, just
  // summed over filteredRows instead of one user's entries.
  const overallDailySeries = useMemo(() => {
    const byDay = new Map<string, Record<ActionBucket, number>>();
    for (const row of filteredRows) {
      for (const e of row.entries) {
        const day = new Date(e.when).toISOString().slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<ActionBucket, number>);
        byDay.get(day)![e.bucket] += 1;
      }
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ date: day.slice(5), ...counts }));
  }, [filteredRows]);

  const detailsEntries = useMemo(() => {
    if (!detailsUser) return [];
    const term = detailsSearch.trim().toLowerCase();
    return detailsUser.entries
      .filter((e) => !term || e.ticketNo.toLowerCase().includes(term))
      .sort((a, b) => b.when.localeCompare(a.when));
  }, [detailsUser, detailsSearch]);
  const detailsTotalPages = Math.max(1, Math.ceil(detailsEntries.length / detailsPageSize));
  const detailsSafePage = Math.min(detailsPage, detailsTotalPages);
  const detailsPaged = detailsEntries.slice((detailsSafePage - 1) * detailsPageSize, detailsSafePage * detailsPageSize);

  // Daily activity trend for the selected user, broken down by action type —
  // uses this user's full entry set (not narrowed by the ticket-no search
  // box above, which is for finding one row, not reshaping the trend).
  const detailsDailySeries = useMemo(() => {
    if (!detailsUser) return [];
    const byDay = new Map<string, Record<ActionBucket, number>>();
    for (const e of detailsUser.entries) {
      const day = new Date(e.when).toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<ActionBucket, number>);
      byDay.get(day)![e.bucket] += 1;
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ date: day.slice(5), ...counts }));
  }, [detailsUser]);

  const openDetails = (row: ActivityRow) => {
    setDetailsUser(row);
    setDetailsSearch("");
    setDetailsPage(1);
  };

  const toggleUserType = (role: string) =>
    setUserTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });

  const liveSummary = companyId ? `Live data: ${filteredRows.reduce((s, r) => s + r.total, 0)} activit${filteredRows.reduce((s, r) => s + r.total, 0) === 1 ? "y" : "ies"} for company ${companyId}.` : "";

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 py-4">
        <div className="mb-3">
          <div className="flex items-center gap-3 mb-2">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight mb-1">Daily Activity Report</h1>
            <p className="text-sm text-muted-foreground">Review daily operational activities summary.</p>
          </div>
        </div>

        <div className="panel mb-3">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Left: filters, compressed into 2 columns instead of 4 now that
                this side only gets ~40% of the panel width. */}
            <div className="lg:w-2/5 min-w-0">
              <div className="grid gap-2 grid-cols-2">
                <div className="control-group">
                  <label htmlFor="location">Location</label>
                  <select id="location" value={location} onChange={(e) => setLocation(e.target.value)} className="glass-input">
                    {locationOptions.map((office) => (
                      <option key={office} value={office}>{office === "ALL" ? "All Locations" : office}</option>
                    ))}
                  </select>
                </div>
                <div className="control-group relative">
                  <label>User Type</label>
                  <button
                    ref={userTypeBtnRef}
                    type="button"
                    onClick={() => (userTypeOpen ? setUserTypeOpen(false) : openUserTypeMenu())}
                    className="glass-input w-full text-left flex items-center justify-between"
                  >
                    <span className="truncate">
                      {userTypeFilter.size === 0 ? "All User Types" : Array.from(userTypeFilter).map((r) => ROLE_LABELS[r] || r).join(", ")}
                    </span>
                  </button>
                  {userTypeOpen && userTypeMenuPos && createPortal(
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setUserTypeOpen(false)} />
                      <div
                        className="fixed z-50 w-64 max-h-64 overflow-y-auto rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl"
                        style={{ top: userTypeMenuPos.top, left: userTypeMenuPos.left }}
                      >
                        {userTypeOptions.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1.5">No activity yet.</p>}
                        {userTypeOptions.map((role) => (
                          <label key={role} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm text-slate-200">
                            <input type="checkbox" checked={userTypeFilter.has(role)} onChange={() => toggleUserType(role)} className="accent-blue-500" />
                            {ROLE_LABELS[role] || role}
                          </label>
                        ))}
                      </div>
                    </>,
                    document.body,
                  )}
                </div>
                <div className="control-group">
                  <label htmlFor="dateFrom">Work Date From</label>
                  <input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input" />
                </div>
                <div className="control-group">
                  <label htmlFor="dateTo">Work Date To</label>
                  <input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input" />
                </div>
                <div className="control-group">
                  <label htmlFor="autoRefresh">Auto Refresh</label>
                  <select id="autoRefresh" value={autoRefresh} onChange={(e) => setAutoRefresh(e.target.value)} className="glass-input">
                    {AUTO_REFRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                <div>Work Date: {dateFrom} ~ {dateTo}</div>
                <div>CSR activity derived from the live ticket audit trail</div>
                {lastModified && <div>Last modified @ {lastModified}</div>}
                {liveSummary && <div>{liveSummary}</div>}
              </div>

              <div className="mt-2">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="searchInput"
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="search in result"
                    className="glass-input pl-9 w-full"
                  />
                </label>
                <div className="results-count mt-1.5 text-xs text-muted-foreground">
                  Showing {filteredRows.length} of {rows.length} records
                </div>
              </div>

              {error && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
              )}
            </div>

            {/* Right: overall activity trend across every filtered user, colored by action type */}
            <div className="lg:w-3/5 min-w-0 lg:border-l lg:border-white/10 lg:pl-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Overall Activity Trend</p>
                <ChartLineFilter selected={overallVisibleBuckets} onChange={setOverallVisibleBuckets} />
              </div>
              {overallDailySeries.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No activity to chart for this range.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260} debounce={200}>
                  <LineChart data={overallDailySeries} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600 }} />
                    <Legend wrapperStyle={{ fontSize: 9, color: "#94a3b8" }} />
                    {BUCKET_ORDER.filter((b) => overallVisibleBuckets.has(b)).map((b) => (
                      <Line key={b} type="monotone" dataKey={b} name={BUCKET_LABEL[b]} stroke={BUCKET_COLOR[b]} strokeWidth={1.5} dot={{ r: 2 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="panel mb-3">
          <div className="table-wrap overflow-x-auto">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Office</th>
                  {BUCKET_ORDER.map((b) => <th key={b}>{BUCKET_LABEL[b]}</th>)}
                  <th>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} className="py-6 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading activity…</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-6 text-center text-muted-foreground">
                      No live activity records available.
                    </td>
                  </tr>
                ) : filteredRows.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <button type="button" onClick={() => openDetails(row)} className="text-blue-500 hover:underline font-medium">
                        {row.name}
                      </button>
                    </td>
                    <td>{row.office}</td>
                    {BUCKET_ORDER.map((b) => <td key={b}>{row.counts[b] || ""}</td>)}
                    <td className="font-semibold">{row.total}</td>
                  </tr>
                ))}
              </tbody>
              {!loading && filteredRows.length > 0 && (
                <tfoot>
                  <tr className="font-semibold" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <td colSpan={2}>Total</td>
                    {BUCKET_ORDER.map((b) => <td key={b}>{columnTotals.counts[b] || ""}</td>)}
                    <td>{columnTotals.total}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <div className="panel mb-3 py-2">
          <div className="text-xs text-muted-foreground">TOTAL # of TICKETS TO DO: {pendingCount}</div>
        </div>

        {/* ── Per-user activity drill-down ── */}
        {detailsUser && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDetailsUser(null)}>
            <div className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-6xl max-h-[85vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
                <span className="font-semibold">{detailsUser.name} Activities @ {dateFrom} to {dateTo}</span>
                <button onClick={() => setDetailsUser(null)} className="text-white/30 hover:text-white/70 transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <div className="flex flex-1 overflow-hidden">
                {/* Left: ticket-by-ticket list, same as before */}
                <div className="flex flex-col flex-3 min-w-0 border-r border-white/10">
                  <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{detailsEntries.length} records found</span>
                    <div className="relative ml-auto max-w-xs">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        value={detailsSearch}
                        onChange={(e) => { setDetailsSearch(e.target.value); setDetailsPage(1); }}
                        placeholder="search in result"
                        className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto flex-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                          <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">#</th>
                          <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Ticket No</th>
                          <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Action Time</th>
                          <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Action Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailsPaged.length === 0 ? (
                          <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No records match.</td></tr>
                        ) : detailsPaged.map((e, i) => (
                          <tr key={i} className="border-b border-white/5">
                            <td className="px-3 py-1.5 text-muted-foreground">{(detailsSafePage - 1) * detailsPageSize + i + 1}</td>
                            <td className="px-3 py-1.5 font-mono text-blue-400">{e.ticketNo}</td>
                            <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{new Date(e.when).toLocaleString()}</td>
                            <td className="px-3 py-1.5" style={{ color: BUCKET_COLOR[e.bucket] }}>{BUCKET_LABEL[e.bucket]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-5 py-3 border-t border-white/10 flex items-center gap-1.5">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => { setDetailsPageSize(size); setDetailsPage(1); }}
                        className={`px-2 py-1 rounded text-xs border ${detailsPageSize === size ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                      >
                        {size}
                      </button>
                    ))}
                    {detailsTotalPages > 1 && (
                      <span className="ml-auto text-xs text-muted-foreground">Page {detailsSafePage} of {detailsTotalPages}</span>
                    )}
                  </div>
                </div>

                {/* Right: per-user daily activity trend, colored by action type */}
                <div className="flex-2 min-w-0 p-4 overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold">Activity Trend</p>
                    <ChartLineFilter selected={detailsVisibleBuckets} onChange={setDetailsVisibleBuckets} />
                  </div>
                  {detailsDailySeries.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-8 text-center">No activity to chart yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300} debounce={200}>
                      <LineChart data={detailsDailySeries} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600 }} />
                        <Legend wrapperStyle={{ fontSize: 9, color: "#94a3b8" }} formatter={(value) => value} />
                        {BUCKET_ORDER.filter((b) => detailsVisibleBuckets.has(b)).map((b) => (
                          <Line key={b} type="monotone" dataKey={b} name={BUCKET_LABEL[b]} stroke={BUCKET_COLOR[b]} strokeWidth={1.5} dot={{ r: 2 }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}