/**
 * Tickets module — Operation. Per repair-pipeline status (REPAIR_STATUS_
 * OPTIONS), shows a "processed / total" funnel counter for a given day —
 * the same visual idea as the legacy USAPP "Follow-Up Dashboard"'s
 * circular percentage indicators, now backed by a real status-change
 * history (ticket_status_daily_stats, migration 0303) instead of just a
 * live snapshot: `total` = however many tickets were already in that
 * status at the start of the day PLUS however many have moved INTO it
 * since, `processed` (the ring itself) = however many have since moved
 * OUT of it. E.g. "TR-Need PO" opens the day at 0/100; once one of those
 * moves to "OP-Waiting for Part", Need PO becomes 1/100 (one processed)
 * and Waiting for Part becomes 0/101 (one arrived, total grows). Backorder
 * (CL-Parts Back Ordered) and cancel (CL-Need Cancel) tracking are just
 * two of these same status rings, not separate features.
 *
 * For TODAY specifically, a status with no ticket_status_daily_stats row
 * yet (nothing has changed into/out of it today) falls back to a live
 * count of tickets currently in that status, shown as N/N processed — the
 * same "0 processed" starting point the DB trigger would itself produce
 * on that status's first change of the day. Past days read the stored
 * table only; a status with no row that day showed zero status-change
 * activity, shown as "No activity" rather than a misleading 0/0.
 *
 * Clicking a ring opens Ticket List (new tab) filtered to tickets
 * currently in that status (?status=<exact status>) — always the LIVE
 * current membership of that status, not a historical reconstruction of
 * who was in it on a past selected day (this app has no per-ticket
 * "status as of day D" query yet).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getCompanyTickets, getTicketStatusDailyStats, type TicketStatusDailyStat } from "@/lib/supabase/tickets";
import { REPAIR_STATUS_OPTIONS, statusGroupOf, type Ticket } from "@/lib/ticketData";
import { LOCATIONS, mergeLocationOptions } from "@/lib/locations";
import { STATUS_COLORS, colorFor } from "@/components/CSRStatusSummary";

const todayUtc = () => new Date().toISOString().slice(0, 10);

function StatusRing({
  label, processed, total, color, noActivity, onClick,
}: { label: string; processed: number; total: number; color: string; noActivity: boolean; onClick: () => void }) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
      title={`Open all "${label}" tickets in Ticket List`}
    >
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="9" />
          {!noActivity && (
            <circle
              cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9"
              strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{noActivity ? "—" : `${pct}%`}</div>
      </div>
      <div className="text-[11px] text-muted-foreground">{noActivity ? "No activity" : `${processed} / ${total}`}</div>
      <div className="text-[11px] font-semibold text-center leading-tight max-w-[7rem]">{label}</div>
    </button>
  );
}

export function TicketOperationReport({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayUtc());
  const [dailyStats, setDailyStats] = useState<TicketStatusDailyStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(await getCompanyTickets());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets.");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (date: string) => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      setDailyStats(await getTicketStatusDailyStats(date));
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Failed to load daily history.");
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { void loadStats(selectedDate); }, [selectedDate]);

  const locationOptions = useMemo(
    () => mergeLocationOptions(LOCATIONS, tickets.map((t) => t.location)),
    [tickets],
  );

  const scopedTickets = useMemo(
    () => (locationFilter ? tickets.filter((t) => t.location === locationFilter) : tickets),
    [tickets, locationFilter],
  );

  const total = scopedTickets.length;
  const branchScoped = !!locationFilter;
  const isToday = selectedDate === todayUtc();

  const countByStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of scopedTickets) map.set(t.status, (map.get(t.status) ?? 0) + 1);
    return map;
  }, [scopedTickets]);

  const statsByStatus = useMemo(() => {
    const map = new Map<string, TicketStatusDailyStat>();
    for (const s of dailyStats) map.set(s.status, s);
    return map;
  }, [dailyStats]);

  // Daily funnel tracking (ticket_status_daily_stats) is company-wide only
  // — no per-branch breakdown exists — so a Branch filter falls back to a
  // live distribution snapshot (processed = tickets currently in that
  // status, total = all of that branch's tickets) instead of the funnel
  // numbers, regardless of which date is selected.
  const countsFor = (status: string): { processed: number; total: number; noActivity: boolean } => {
    if (branchScoped) {
      return { processed: countByStatus.get(status) ?? 0, total, noActivity: false };
    }
    const stat = statsByStatus.get(status);
    if (stat) return { processed: stat.leftCount, total: stat.baselineCount + stat.enteredCount, noActivity: false };
    if (isToday) {
      const live = countByStatus.get(status) ?? 0;
      return { processed: 0, total: live, noActivity: false };
    }
    return { processed: 0, total: 0, noActivity: true };
  };

  const groupCounts = useMemo(() => {
    const counts = { open: 0, completed: 0, cancelled: 0, other: 0 };
    for (const t of scopedTickets) {
      const g = statusGroupOf(t.status);
      counts[g] += 1;
    }
    return counts;
  }, [scopedTickets]);

  const openTicketsForStatus = (status: string) => {
    window.open(`/m/tickets/ticket-list?status=${encodeURIComponent(status)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-bold">Operation</h1>
          <button
            onClick={() => { void load(); void loadStats(selectedDate); }}
            className="btn text-xs px-2.5 py-1.5 ml-auto flex items-center gap-1.5"
            disabled={loading || statsLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || statsLoading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          {branchScoped
            ? `Live snapshot of every open repair status for ${locationFilter} — how many tickets sit in each status right now, out of the branch's total. Daily history tracking (below) is company-wide only, so it's not shown while a branch is selected.`
            : `How many tickets have moved through each repair status on ${isToday ? "today" : selectedDate} — the ring shows tickets processed out of that status ÷ everything that was in it today. Click a status to open its current tickets in Ticket List. Includes backorder (CL-Parts Back Ordered) and cancel (CL-Need Cancel) tracking as two of these same statuses.`}
        </p>

        <div className="panel mb-6 p-4 flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
          <select
            aria-label="Branch filter"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="glass-input text-sm py-1.5 px-3 rounded-md w-52"
          >
            <option value="">ALL</option>
            {locationOptions.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Day</label>
          <input
            type="date"
            aria-label="Day to view"
            value={selectedDate}
            max={todayUtc()}
            onChange={(e) => setSelectedDate(e.target.value || todayUtc())}
            disabled={branchScoped}
            className="glass-input text-sm py-1.5 px-3 rounded-md w-40 disabled:opacity-50"
          />
          {!isToday && !branchScoped && (
            <button onClick={() => setSelectedDate(todayUtc())} className="btn text-xs px-2.5 py-1.5">Back to Today</button>
          )}
          <div className="ml-auto flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{total}</strong> total</span>
            <span><strong className="text-foreground">{groupCounts.open}</strong> open</span>
            <span><strong className="text-foreground">{groupCounts.completed}</strong> completed</span>
            <span><strong className="text-foreground">{groupCounts.cancelled}</strong> cancelled</span>
          </div>
        </div>

        {loading || statsLoading ? (
          <div className="panel p-10 flex items-center justify-center"><BrandedLoader /></div>
        ) : error ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : statsError && !branchScoped ? (
          <div className="panel p-6 text-sm text-red-300">{statsError}</div>
        ) : (
          <div className="panel p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-y-2">
              {REPAIR_STATUS_OPTIONS.map((status) => {
                const { processed, total: statusTotal, noActivity } = countsFor(status);
                return (
                  <StatusRing
                    key={status}
                    label={status}
                    processed={processed}
                    total={statusTotal}
                    noActivity={noActivity}
                    color={STATUS_COLORS[status] ?? colorFor(status)}
                    onClick={() => openTicketsForStatus(status)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
