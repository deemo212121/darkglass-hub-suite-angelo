/**
 * Claims Dashboard — overview for the Claims team, structured the same
 * way as CSRDashboard.tsx / ReportCSRDaily.tsx (filters, KPI tiles, a
 * couple of charts, a staff table).
 *
 * Data source: live `tickets`, not the dedicated `claims`/
 * `claim_authorizations` tables — nothing in the app ever writes to those,
 * so they're permanently empty. The real claims workflow already runs
 * through a ticket's own warranty/status fields: `warranty === "IW"` (or a
 * `claim_company` set) marks it as a claim, and its lifecycle is the
 * PT-/CL- prefixed statuses (PT-Need PreAuthorization → CL-Need Cancel /
 * CL-Parts Back Ordered / CL-Ready to Complete → CL-Claimed / CL-Data
 * Closed) — the same vocabulary NeedClaimList.tsx already reads for the
 * "needs claim action" queue. Company/status filter options are derived
 * from whatever's actually present in the data, not a hand-typed list.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FileText, Clock, CheckCircle2, AlertTriangle, Users, Loader2, Download } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";

const CLAIMS_ROLES = new Set(["CLAIMS", "CLAIMS_MANAGER"]);
const CHART_COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#60a5fa", "#f87171"];

// Claim-stage vocabulary — same PT-/CL- statuses NeedClaimList.tsx and
// CSRStatusSummary.tsx already key off of.
const PENDING_STAGES = new Set(["pt-need preauthorization", "cl-need cancel", "cl-parts back ordered", "cl-ready to complete"]);
const CLOSED_STAGES = new Set(["cl-claimed", "cl-data closed", "cl-data-closed", "cl-cancelled", "cancelled", "cancel", "completed"]);
const STAGE_ORDER = ["pt-need preauthorization", "cl-need cancel", "cl-parts back ordered", "cl-ready to complete", "cl-claimed", "cl-data closed"];
const STAGE_LABEL: Record<string, string> = {
  "pt-need preauthorization": "Need Pre-Authorization",
  "cl-need cancel": "Need Cancel",
  "cl-parts back ordered": "Parts Back Ordered",
  "cl-ready to complete": "Ready to Complete",
  "cl-claimed": "Claimed",
  "cl-data closed": "Data Closed",
};
const STAGE_COLOR: Record<string, string> = {
  "pt-need preauthorization": "#facc15",
  "cl-need cancel": "#fb923c",
  "cl-parts back ordered": "#94a3b8",
  "cl-ready to complete": "#60a5fa",
  "cl-claimed": "#34d399",
  "cl-data closed": "#34d399",
};

function normStatus(s: string | undefined | null): string {
  return String(s || "").trim().toLowerCase();
}

// A ticket counts as a claim when it's in-warranty or has a claim company —
// mirrors the `wty`/`claim_company` fields already used across ticket UIs.
function isClaimTicket(t: Ticket): boolean {
  return String(t.warranty || "").trim().toUpperCase() === "IW" || !!String(t.claimCompany || "").trim();
}

export function ClaimsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showStatusPct, setShowStatusPct] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [allTickets, profiles, allNotes] = await Promise.all([
          getCompanyTickets(),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => {
            console.error("Failed to load agent notes:", err);
            return [];
          }),
        ]);
        if (cancelled) return;
        setTickets(allTickets.filter(isClaimTicket));
        setStaff(profiles.filter((p) => CLAIMS_ROLES.has(normalizeRole(p.role))));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Claims Dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Filter options come from the data itself — no invented company/status list.
  const companyOptions = useMemo(() => Array.from(new Set(tickets.map((t) => t.claimCompany).filter((b): b is string => !!b))).sort(), [tickets]);
  const statusOptions = useMemo(() => Array.from(new Set(tickets.map((t) => t.status).filter((s): s is string => !!s))).sort(), [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (dateFrom && t.created && t.created < dateFrom) return false;
      if (dateTo && t.created && t.created > dateTo) return false;
      if (companyFilter && t.claimCompany !== companyFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      return true;
    });
  }, [tickets, dateFrom, dateTo, companyFilter, statusFilter]);

  const kpi = useMemo(() => {
    let pendingPreAuth = 0, awaitingAction = 0, closed = 0;
    for (const t of filteredTickets) {
      const s = normStatus(t.status);
      if (s === "pt-need preauthorization") pendingPreAuth++;
      else if (s === "cl-need cancel" || s === "cl-parts back ordered" || s === "cl-ready to complete") awaitingAction++;
      else if (CLOSED_STAGES.has(s)) closed++;
    }
    return { totalClaims: filteredTickets.length, pendingPreAuth, awaitingAction, closed, staffCount: staff.length };
  }, [filteredTickets, staff]);

  const companyBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filteredTickets) {
      const key = t.claimCompany?.trim() || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredTickets]);

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filteredTickets) {
      const key = t.status?.trim() || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredTickets]);

  // Claim-stage tiles — pipeline view off the real PT-/CL- statuses.
  const stageBreakdown = useMemo(() => {
    return STAGE_ORDER.map((s) => ({
      stage: s,
      label: STAGE_LABEL[s],
      count: filteredTickets.filter((t) => normStatus(t.status) === s).length,
    }));
  }, [filteredTickets]);

  // Aging — how long claims still awaiting pre-auth/claim action have sat in
  // that status, off status_changed_at (fallback created) — the same signal
  // NeedClaimList.tsx uses for its own aging column.
  const agingBuckets = useMemo(() => {
    const buckets = { "0-1 Day": 0, "2-3 Days": 0, "4-6 Days": 0, "7+ Days": 0 };
    const now = Date.now();
    for (const t of filteredTickets) {
      if (!PENDING_STAGES.has(normStatus(t.status))) continue;
      const started = t.statusChangedAt || t.created;
      if (!started) continue;
      const days = Math.floor((now - new Date(started).getTime()) / 86400000);
      if (days <= 1) buckets["0-1 Day"]++;
      else if (days <= 3) buckets["2-3 Days"]++;
      else if (days <= 6) buckets["4-6 Days"]++;
      else buckets["7+ Days"]++;
    }
    return Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }, [filteredTickets]);

  // Only approved notes count as an employee's official record — same rule
  // used everywhere else this workflow shows up.
  const warningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.status !== "approved" || n.type !== "warning") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [notes]);
  const mistakeCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.status !== "approved" || n.type !== "mistake") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const staffRows = useMemo(() => {
    return staff
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.username || p.email,
        role: ROLE_LABELS[normalizeRole(p.role)] ?? p.role,
        branch: p.assigned_branch || "—",
        // status_changed_by is stamped automatically by the ticket audit
        // trigger, so this reflects who last actually worked the claim.
        claimsTouched: filteredTickets.filter((t) => t.statusChangedBy === p.id).length,
        warnings: warningCountByProfile.get(p.id) ?? 0,
        mistakes: mistakeCountByProfile.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.claimsTouched - a.claimsTouched);
  }, [staff, filteredTickets, warningCountByProfile, mistakeCountByProfile]);

  // Exports exactly what's on screen — respects the same date/company/status
  // filters as the dashboard itself, so there's no separate "report period"
  // to keep in sync.
  const exportToXlsx = () => {
    const sheet: (string | number)[][] = [
      ["Claims Dashboard Report"],
      [`Period: ${dateFrom || "All time"} to ${dateTo || "All time"}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Summary"],
      ["Metric", "Value"],
      ["Total Claims", kpi.totalClaims],
      ["Need Pre-Auth", kpi.pendingPreAuth],
      ["Awaiting Claim Action", kpi.awaitingAction],
      ["Claimed / Closed", kpi.closed],
      ["Claims Staff", kpi.staffCount],
      [],
      ["By Company"],
      ["Company", "Claims"],
      ...companyBreakdown.map((c) => [c.name, c.value]),
      [],
      ["By Status"],
      ["Status", "Claims"],
      ...statusBreakdown.map((s) => [s.name, s.value]),
      [],
      ["Claim Stage"],
      ["Stage", "Count"],
      ...stageBreakdown.map((s) => [s.label, s.count]),
      [],
      ["Aging — Still Awaiting Pre-Auth / Claim Action"],
      ["Bucket", "Count"],
      ...agingBuckets.map((b) => [b.label, b.count]),
      [],
      ["Claims Staff"],
      ["Name", "Role", "Branch", "Claims Touched", "Warnings", "Mistakes"],
      ...staffRows.map((s) => [s.name, s.role, s.branch, s.claimsTouched, s.warnings, s.mistakes]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Claims Report");
    XLSX.writeFile(workbook, `claims-dashboard-report_${dateFrom || "all"}_to_${dateTo || "all"}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Claims pipeline overview — live from ticket warranty status &amp; claim stage.</p>
          </div>
        </div>

        {/* Filters */}
        <div className="panel p-4 mb-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Claim Company</label>
              <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="glass-input mt-1 w-full">
                <option value="">All{companyOptions.length === 0 ? " (none logged yet)" : ""}</option>
                {companyOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-input mt-1 w-full">
                <option value="">All{statusOptions.length === 0 ? " (none logged yet)" : ""}</option>
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="text-[10px] text-muted-foreground">
              A ticket counts as a claim when it's in-warranty (IW) or has a claim company set. Leave Date From/To blank for all-time.
            </p>
            <button onClick={exportToXlsx} disabled={loading} className="btn text-sm px-3 shrink-0 flex items-center gap-1.5 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Download XLSX
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Claims Dashboard…
          </div>
        ) : (
        <>
        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {[
            { label: "Total Claims", value: kpi.totalClaims, color: "text-white", icon: <FileText className="h-4 w-4" /> },
            { label: "Need Pre-Auth", value: kpi.pendingPreAuth, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
            { label: "Awaiting Claim Action", value: kpi.awaitingAction, color: "text-orange-300", icon: <AlertTriangle className="h-4 w-4" /> },
            { label: "Claimed / Closed", value: kpi.closed, color: "text-emerald-300", icon: <CheckCircle2 className="h-4 w-4" /> },
            { label: "Claims Staff", value: kpi.staffCount, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-4 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Claims by Company</p>
            {companyBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No claim tickets yet — this fills in as in-warranty tickets come in.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={companyBreakdown} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Claims" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Claims by Status</p>
              {statusBreakdown.length > 0 && (
                <button
                  onClick={() => setShowStatusPct((v) => !v)}
                  className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition-colors ${showStatusPct ? "border-white/20 bg-white/10 text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  {showStatusPct ? "Hide %" : "Show %"}
                </button>
              )}
            </div>
            {statusBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No claim tickets yet — this fills in as in-warranty tickets come in.</p>
            ) : (
              // On-slice labels overlap once there are more than a handful of
              // statuses — instead the pie sits label-free on the left and
              // every slice gets its own row (name + count + %) on the
              // right, same pattern as Parts Dashboard's Lines by Distributor.
              <div className="flex gap-3 items-center">
                <ResponsiveContainer width="45%" height={220}>
                  <PieChart>
                    <Pie data={statusBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false} labelLine={false}>
                      {statusBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600 }} formatter={(v: any, n: any) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
                {/* No scroll/centering — rows are compact enough to all fit
                    beside the pie, and top-aligned so the list doesn't float
                    with dead space above/below when there are few entries. */}
                <div className="flex-1 min-w-0 flex flex-col justify-start gap-px py-1">
                  {statusBreakdown.map((entry, i) => {
                    const total = statusBreakdown.reduce((s, d) => s + d.value, 0);
                    const pct = total > 0 ? (entry.value / total) * 100 : 0;
                    return (
                      <div key={entry.name} className="flex items-center gap-1.5 text-[10px] leading-[1.35]">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="truncate flex-1">{entry.name}</span>
                        <span className="text-muted-foreground shrink-0">
                          {entry.value}{showStatusPct ? ` · ${pct.toFixed(0)}%` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Claim stage tracking */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Claim Stage</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {stageBreakdown.map((s) => (
              <div key={s.stage} className="panel p-3 text-center">
                <p className="text-xl font-bold" style={{ color: STAGE_COLOR[s.stage] }}>{s.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Aging — Still Awaiting Pre-Auth / Claim Action</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {agingBuckets.map((b) => (
              <div key={b.label} className="panel p-3 text-center">
                <p className="text-lg font-bold text-orange-300">{b.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{b.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Staff table */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-4 border-b border-white/10">
            <h2 className="font-semibold text-sm">Claims Staff</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Everyone currently holding a Claims or Claims Manager role — click a name for their full stats, mistakes &amp; warnings.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Role</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Branch</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Claims Touched</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Warnings</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mistakes</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No one currently holds a Claims or Claims Manager role.</td></tr>
                ) : staffRows.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">
                      <a href={`/csr-agent/${s.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition" title={`View ${s.name}'s statistics`}>
                        {s.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{s.role}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.branch}</td>
                    <td className="px-3 py-2 text-right">{s.claimsTouched}</td>
                    <td className="px-3 py-2 text-right">
                      {s.warnings > 0 ? <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded font-semibold">{s.warnings}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.mistakes > 0 ? <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded font-semibold">{s.mistakes}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
}
