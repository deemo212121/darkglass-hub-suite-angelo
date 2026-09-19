/**
 * Tickets module — Operation. A live snapshot of how many company tickets
 * currently sit in each repair-pipeline status (REPAIR_STATUS_OPTIONS),
 * rendered as a ring-per-status grid — the same visual idea as the legacy
 * USAPP "Follow-Up Dashboard"'s circular percentage indicators, but
 * re-scoped: each ring here is "tickets currently in this status ÷ all
 * (branch-filtered) company tickets" — a live snapshot, not a completion/
 * follow-up rate, since this app has no status-change history log to
 * compute the legacy metric from. Backorder (CL-Parts Back Ordered) and
 * cancel (CL-Need Cancel) tracking are just two of these same status
 * rings, not separate features — they're already real status values.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { REPAIR_STATUS_OPTIONS, statusGroupOf, type Ticket } from "@/lib/ticketData";
import { LOCATIONS, mergeLocationOptions } from "@/lib/locations";
import { STATUS_COLORS, colorFor } from "@/components/CSRStatusSummary";

function StatusRing({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  return (
    <div className="flex flex-col items-center gap-2 p-3">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="9" />
          <circle
            cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9"
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{pct}%</div>
      </div>
      <div className="text-[11px] text-muted-foreground">{count} / {total}</div>
      <div className="text-[11px] font-semibold text-center leading-tight max-w-[7rem]">{label}</div>
    </div>
  );
}

export function TicketOperationReport({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState("");

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

  useEffect(() => { void load(); }, []);

  const locationOptions = useMemo(
    () => mergeLocationOptions(LOCATIONS, tickets.map((t) => t.location)),
    [tickets],
  );

  const scopedTickets = useMemo(
    () => (locationFilter ? tickets.filter((t) => t.location === locationFilter) : tickets),
    [tickets, locationFilter],
  );

  const total = scopedTickets.length;

  const countByStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of scopedTickets) map.set(t.status, (map.get(t.status) ?? 0) + 1);
    return map;
  }, [scopedTickets]);

  const groupCounts = useMemo(() => {
    const counts = { open: 0, completed: 0, cancelled: 0, other: 0 };
    for (const t of scopedTickets) {
      const g = statusGroupOf(t.status);
      counts[g] += 1;
    }
    return counts;
  }, [scopedTickets]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-bold">Operation</h1>
          <button onClick={() => void load()} className="btn text-xs px-2.5 py-1.5 ml-auto flex items-center gap-1.5" disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          Live snapshot of every open repair status, company-wide — how many tickets sit in each status right now, out of {locationFilter ? `${locationFilter}'s` : "the company's"} total. Includes backorder (CL-Parts Back Ordered) and cancel (CL-Need Cancel) tracking as two of these same statuses.
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
          <div className="ml-auto flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{total}</strong> total</span>
            <span><strong className="text-foreground">{groupCounts.open}</strong> open</span>
            <span><strong className="text-foreground">{groupCounts.completed}</strong> completed</span>
            <span><strong className="text-foreground">{groupCounts.cancelled}</strong> cancelled</span>
          </div>
        </div>

        {loading ? (
          <div className="panel p-10 flex items-center justify-center"><BrandedLoader /></div>
        ) : error ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : (
          <div className="panel p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-y-2">
              {REPAIR_STATUS_OPTIONS.map((status) => (
                <StatusRing
                  key={status}
                  label={status}
                  count={countByStatus.get(status) ?? 0}
                  total={total}
                  color={STATUS_COLORS[status] ?? colorFor(status)}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
