/**
 * Claims Daily Report — a day-scoped view over the same live claim tickets
 * ClaimsDashboard.tsx already reads (warranty === "IW" or claim_company
 * set; lifecycle = PT-/CL- prefixed statuses). ClaimsDashboard already
 * covers the pipeline overview; this page adds the daily-report framing it
 * doesn't: Completed-today vs currently-Remaining, and a real 10-day trend.
 * The old mock's "Pending Types" (Awaiting Authorization/Missing Parts/
 * Customer Follow-up/Documentation) had no backing anywhere in the schema —
 * replaced with the real PT-/CL- claim-stage breakdown.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FileText, Clock, Users, Loader2 } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { statusGroupOf, type Ticket } from "@/lib/ticketData";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole } from "@/lib/roleLabels";

const CLAIMS_ROLES = new Set(["CLAIMS", "CLAIMS_MANAGER"]);
const CHART_COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#60a5fa", "#f87171"];

// Same PT-/CL- claim-stage vocabulary as ClaimsDashboard.tsx.
const STAGE_ORDER = ["pt-need preauthorization", "cl-need cancel", "cl-parts back ordered", "cl-ready to complete"];
const STAGE_LABEL: Record<string, string> = {
  "pt-need preauthorization": "Need Pre-Authorization",
  "cl-need cancel": "Need Cancel",
  "cl-parts back ordered": "Parts Back Ordered",
  "cl-ready to complete": "Ready to Complete",
};
const CLOSED_STATUSES = new Set(["cl-claimed", "cl-data closed", "cl-data-closed"]);

// Fixed light tooltip — CSS-variable tooltips don't reliably resolve against
// the dark theme; this always-readable pattern is used across every
// dashboard rebuilt this session.
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;

function normStatus(s: string | undefined | null): string {
  return String(s || "").trim().toLowerCase();
}
function isClaimTicket(t: Ticket): boolean {
  return String(t.warranty || "").trim().toUpperCase() === "IW" || !!String(t.claimCompany || "").trim();
}
function dateOnly(v: string | undefined | null): string {
  return (v || "").slice(0, 10);
}
const todayIso = () => new Date().toISOString().slice(0, 10);
/** Add (or subtract, with a negative n) n days to an ISO date string. */
const addDaysToIso = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtShort = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; };

export function ReportClaimsDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [date, setDate] = useState(todayIso());
  const [companyFilter, setCompanyFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [allTickets, profiles, allNotes] = await Promise.all([
          getCompanyTickets(),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
        ]);
        if (cancelled) return;
        setTickets(allTickets.filter(isClaimTicket));
        setStaff(profiles.filter((p) => CLAIMS_ROLES.has(normalizeRole(p.role))));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Claims Daily Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const companyOptions = useMemo(() => Array.from(new Set(tickets.map((t) => t.claimCompany).filter((c): c is string => !!c))).sort(), [tickets]);

  const filtered = useMemo(
    () => tickets.filter((t) => !companyFilter || t.claimCompany === companyFilter),
    [tickets, companyFilter],
  );

  const completedTodayTickets = useMemo(
    () => filtered.filter((t) => CLOSED_STATUSES.has(normStatus(t.status)) && dateOnly(t.statusChangedAt) === date),
    [filtered, date],
  );
  const remainingTickets = useMemo(() => filtered.filter((t) => statusGroupOf(t.status) === "open"), [filtered]);

  const kpi = {
    completed: completedTodayTickets.length,
    remaining: remainingTickets.length,
    companies: companyOptions.length,
    staff: staff.length,
  };

  const companyChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of completedTodayTickets) {
      const key = t.claimCompany?.trim() || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [completedTodayTickets]);

  const stageChartData = useMemo(() => {
    return STAGE_ORDER.map((s) => ({
      name: STAGE_LABEL[s],
      value: remainingTickets.filter((t) => normStatus(t.status) === s).length,
    })).filter((s) => s.value > 0);
  }, [remainingTickets]);

  // Real day-by-day Completed count for the 10 days ending at the selected
  // Date — not the real "today" — so this stays consistent with the KPI
  // tiles when looking at a past date instead of the current one. One pass
  // over the ticket set, not a repeated per-day scan.
  const trendData = useMemo(() => {
    const dates = Array.from({ length: 10 }, (_, i) => addDaysToIso(date, i - 9));
    const counts = new Map(dates.map((d) => [d, 0]));
    for (const t of filtered) {
      if (!CLOSED_STATUSES.has(normStatus(t.status))) continue;
      const d = dateOnly(t.statusChangedAt);
      if (counts.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return dates.map((d) => ({ date: fmtShort(d), completed: counts.get(d) ?? 0 }));
  }, [filtered, date]);

  // Company-wide totals only — this is a system-wide report, not a
  // per-employee attribution tool (that's what ClaimsDashboard.tsx's staff
  // table is for).
  const totalWarnings = useMemo(() => {
    const staffIds = new Set(staff.map((p) => p.id));
    return notes.filter((n) => n.status === "approved" && n.type === "warning" && staffIds.has(n.agentProfileId)).length;
  }, [notes, staff]);
  const totalMistakes = useMemo(() => {
    const staffIds = new Set(staff.map((p) => p.id));
    return notes.filter((n) => n.status === "approved" && n.type === "mistake" && staffIds.has(n.agentProfileId)).length;
  }, [notes, staff]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim Company</label>
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All{companyOptions.length === 0 ? " (none logged yet)" : ""}</option>
              {companyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          {companyFilter && <button onClick={() => setCompanyFilter("")} className="btn text-sm px-3 mb-0.5">Clear</button>}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">Remaining reflects currently-open claim tickets (a live snapshot); Completed is scoped to the selected Date.</p>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Claims Daily Report…</div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Completed", value: kpi.completed, color: "text-green-300", icon: <FileText className="h-4 w-4" /> },
            { label: "Remaining", value: kpi.remaining, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
            { label: "Claim Companies", value: kpi.companies, color: "text-blue-300", icon: <FileText className="h-4 w-4" /> },
            { label: "Claims Staff", value: kpi.staff, color: "text-purple-300", icon: <Users className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-4 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Company Breakdown — Completed</p>
            {companyChartData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No claims completed on this date.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={companyChartData} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>{companyChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Claim Stage — Remaining</p>
            {stageChartData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No claims currently pending.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={stageChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {stageChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Completed — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trendData} margin={{ left: -10 }}>
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="completed" fill="#34d399" radius={[4, 4, 0, 0]} name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Company Table — Completed</span><span className="text-xs text-muted-foreground">{companyChartData.length} companies</span></div>
            <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5"><th className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">Company</th><th className="px-4 py-2 text-right text-xs text-muted-foreground uppercase">Count</th></tr></thead>
            <tbody>
              {companyChartData.length === 0 ? <tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground text-sm">No claims completed on this date.</td></tr> :
                companyChartData.map((c) => <tr key={c.name} className="border-b border-white/5 hover:bg-white/5"><td className="px-4 py-2.5 font-medium">{c.name}</td><td className="px-4 py-2.5 text-right text-blue-400 font-semibold">{c.value}</td></tr>)}
            </tbody></table>
          </div>
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Stage Table — Remaining</span><span className="text-xs text-muted-foreground">{stageChartData.length} stages</span></div>
            <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5"><th className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">Stage</th><th className="px-4 py-2 text-right text-xs text-muted-foreground uppercase">Count</th></tr></thead>
            <tbody>
              {stageChartData.length === 0 ? <tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground text-sm">No claims currently pending.</td></tr> :
                stageChartData.map((s) => <tr key={s.name} className="border-b border-white/5 hover:bg-white/5"><td className="px-4 py-2.5">{s.name}</td><td className="px-4 py-2.5 text-right text-yellow-400 font-semibold">{s.value}</td></tr>)}
            </tbody></table>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Claims Staff", value: kpi.staff, color: "text-purple-300", icon: <Users className="h-4 w-4" /> },
            { label: "Warnings (Company-wide)", value: totalWarnings, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
            { label: "Mistakes (Company-wide)", value: totalMistakes, color: "text-orange-300", icon: <Clock className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
