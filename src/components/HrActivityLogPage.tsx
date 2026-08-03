/**
 * HR Activity Log — company-wide audit trail of actions taken across the
 * HR & Recruitment Dashboard (Hiring, Warnings & Mistakes, Onboarding
 * Documents, Certificates of Employment, Employee Warning Forms, staffing
 * targets, employee status changes). Read-only; entries are never edited
 * or deleted so the trail can't be tampered with after the fact.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2, Search } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";
import { subscribeTableChanges } from "@/lib/supabase/realtime";

const ACTION_BADGE_COLOR = (action: string): string => {
  if (action.includes("deleted") || action.includes("cancelled") || action.includes("retracted")) return "bg-red-500/20 text-red-300 border-red-500/30";
  if (action.includes("confirmed") || action.includes("added")) return "bg-green-500/20 text-green-300 border-green-500/30";
  if (action.includes("reverted")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  return "bg-blue-500/20 text-blue-300 border-blue-500/30";
};

export function HrActivityLogPage() {
  const { ready, companyId } = useAuth();
  const [entries, setEntries] = useState<HrActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(
        await getActivityLog({
          from: from ? `${from}T00:00:00` : undefined,
          to: to ? `${to}T23:59:59` : undefined,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity log.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, from, to]);

  // Live — new entries (from anyone, anywhere in the HR dashboard) appear here without a manual refresh.
  useEffect(() => {
    if (!ready || !companyId) return;
    return subscribeTableChanges("hr_activity_log", () => void load(), `company_id=eq.${companyId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, companyId]);

  const actionOptions = useMemo(() => Array.from(new Set(entries.map((e) => e.action))).sort(), [entries]);
  const actorOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.actorName).filter((n): n is string => !!n))).sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (actorFilter && e.actorName !== actorFilter) return false;
      if (q && !(e.actorName ?? "").toLowerCase().includes(q) && !(e.targetLabel ?? "").toLowerCase().includes(q) && !activityActionLabel(e.action).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, search, actionFilter, actorFilter]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-4 border-b border-white/10">
            <h2 className="font-semibold text-sm">HR Activity Log</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Every action taken across the HR &amp; Recruitment Dashboard — who did what, and when.</p>
          </div>

          <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-end gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Actor, target, or action…"
                className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Actor</label>
              <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                {actorOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Action</label>
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                {actionOptions.map((a) => <option key={a} value={a}>{activityActionLabel(a)}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            {(search || actionFilter || actorFilter || from || to) && (
              <button onClick={() => { setSearch(""); setActionFilter(""); setActorFilter(""); setFrom(""); setTo(""); }} className="btn text-sm px-3 py-1.5">Clear</button>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">{filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</span>
          </div>

          {error && (
            <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>
          )}

          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="border-b border-white/10 bg-slate-900">
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actor</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Action</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Target</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Details</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">When</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No activity recorded{search || actionFilter || actorFilter ? " matching these filters." : " yet."}</td></tr>
                ) : (
                  filtered.map((e) => (
                    <tr key={e.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{e.actorName ?? "Unknown"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${ACTION_BADGE_COLOR(e.action)}`}>{activityActionLabel(e.action)}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{e.targetLabel ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-sm truncate" title={Object.keys(e.details).length ? JSON.stringify(e.details) : ""}>
                        {Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
