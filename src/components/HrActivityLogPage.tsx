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
  if (action.includes("confirmed") || action.includes("added") || action.includes("created")) return "bg-green-500/20 text-green-300 border-green-500/30";
  if (action.includes("reverted")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  return "bg-blue-500/20 text-blue-300 border-blue-500/30";
};

/** Opaque internal ids that show up in `details` but read as noise, not
 *  information — dropped from the Details column everywhere, not just the
 *  Audit Log, since a raw uuid is never what the reader actually wants. */
const DETAIL_KEYS_HIDDEN = new Set(["trainerId"]);

function formatDetails(details: Record<string, any>): string {
  return Object.entries(details)
    .filter(([k]) => !DETAIL_KEYS_HIDDEN.has(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

/**
 * The Audit Log is scoped to exactly 5 things — nothing else, even though
 * some of these share an action code with entries that don't belong here:
 *   - Account creation (+ its creation date, which is just the entry's own createdAt)
 *   - Time of hire (employee_start_date_changed)
 *   - Start/end date of training (candidate_status_changed, but ONLY the
 *     "training" status transition — not interviewing/hired/cancelled/etc.)
 *   - Active/inactive (employee_status_changed, but ONLY the account-status
 *     toggle — this action code is reused for Employment Type and Tier
 *     Level edits too, which carry no `status` field and must be excluded)
 * So this is a predicate, not a flat action-code allowlist.
 */
function isAuditLogEntry(e: HrActivityLogEntry): boolean {
  switch (e.action) {
    case "account_created":
      return true;
    case "employee_start_date_changed":
      return true;
    case "employee_status_changed":
      return e.details?.status !== undefined;
    case "candidate_status_changed":
      return e.details?.status === "training";
    default:
      return false;
  }
}

/** The log's actual content (filters + table) — reused as-is by both the
 * standalone route below and the modal popup opened from ReportHRDaily.tsx,
 * which don't navigate away from the HR Dashboard for this anymore.
 * `mode="audit"` narrows to AUDIT_LOG_ACTIONS (account creation, hire date,
 * training window, active/inactive) for the separate Audit Log button. */
export function HrActivityLogPanel({
  mode = "activity",
  title,
  description,
}: {
  mode?: "activity" | "audit";
  title?: string;
  description?: string;
} = {}) {
  const { ready, companyId } = useAuth();
  const [entries, setEntries] = useState<HrActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const scopedEntries = useMemo(
    () => (mode === "audit" ? entries.filter(isAuditLogEntry) : entries),
    [entries, mode]
  );

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

  const actionOptions = useMemo(() => Array.from(new Set(scopedEntries.map((e) => e.action))).sort(), [scopedEntries]);
  const actorOptions = useMemo(
    () => Array.from(new Set(scopedEntries.map((e) => e.actorName).filter((n): n is string => !!n))).sort(),
    [scopedEntries]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedEntries.filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (actorFilter && e.actorName !== actorFilter) return false;
      if (q && !(e.actorName ?? "").toLowerCase().includes(q) && !(e.targetLabel ?? "").toLowerCase().includes(q) && !activityActionLabel(e.action).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scopedEntries, search, actionFilter, actorFilter]);

  return (
        <div className="panel p-0 overflow-hidden h-full flex flex-col">
          <div className="px-5 py-4 pr-14 border-b border-white/10 shrink-0">
            <h2 className="font-semibold text-base">{title ?? "HR Activity Log"}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {description ?? "Every action taken across the HR & Recruitment Dashboard — who did what, and when."}
            </p>
          </div>

          <div className="px-5 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-end gap-3 shrink-0">
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
            <p className="mx-5 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 shrink-0">{error}</p>
          )}

          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-b border-white/10 bg-slate-900">
                  <th className="px-5 py-3 text-left text-xs text-muted-foreground uppercase tracking-wide">Actor</th>
                  <th className="px-5 py-3 text-left text-xs text-muted-foreground uppercase tracking-wide">Action</th>
                  <th className="px-5 py-3 text-left text-xs text-muted-foreground uppercase tracking-wide">Target</th>
                  <th className="px-5 py-3 text-left text-xs text-muted-foreground uppercase tracking-wide">Details</th>
                  <th className="px-5 py-3 text-left text-xs text-muted-foreground uppercase tracking-wide">When</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground text-sm"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground text-sm">No activity recorded{search || actionFilter || actorFilter ? " matching these filters." : " yet."}</td></tr>
                ) : (
                  filtered.map((e) => (
                    <tr key={e.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-5 py-3 font-medium whitespace-nowrap">{e.actorName ?? "Unknown"}</td>
                      <td className="px-5 py-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${ACTION_BADGE_COLOR(e.action)}`}>{activityActionLabel(e.action)}</span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{e.targetLabel ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground max-w-xl truncate" title={Object.keys(e.details).length ? JSON.stringify(e.details) : ""}>
                        {formatDetails(e.details) || "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
  );
}

/** Standalone route wrapper (`/hr-activity-log`) — kept for anyone with the
 * URL bookmarked; ReportHRDaily.tsx no longer navigates here, it pops
 * HrActivityLogPanel in a modal instead. */
export function HrActivityLogPage() {
  return (
    <div className="h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 min-h-0 max-w-6xl w-full mx-auto p-4 flex flex-col">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4 shrink-0">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>
        <div className="flex-1 min-h-0">
          <HrActivityLogPanel />
        </div>
      </main>
    </div>
  );
}
