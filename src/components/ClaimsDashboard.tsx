/**
 * Claims Dashboard — overview for the Claims team, structured the same
 * way as CSRDashboard.tsx / ReportCSRDaily.tsx (filters, KPI tiles, a
 * couple of charts, a staff table). Every number here is a live query —
 * `claims`/`claim_authorizations` exist in the schema but nothing in the
 * app has ever queried them before this, so on a fresh company this will
 * legitimately show zeros until real claims start getting logged. Brand
 * and status filter options are derived from whatever's actually in the
 * data (both columns are free text, no fixed vocabulary), not a
 * hand-typed list of insurance/warranty company names.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FileText, DollarSign, Clock, CheckCircle2, XCircle, AlertTriangle, Users, Loader2 } from "lucide-react";
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyClaimAuthorizations, getCompanyClaims, type Claim, type ClaimAuthorization } from "@/lib/supabase/claims";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";

const CLAIMS_ROLES = new Set(["CLAIMS", "CLAIMS_MANAGER"]);
const AUTH_STATUS_COLOR: Record<ClaimAuthorization["status"], string> = {
  requested: "#60a5fa",
  pending: "#facc15",
  approved: "#34d399",
  denied: "#f87171",
};
const AUTH_STATUS_LABEL: Record<ClaimAuthorization["status"], string> = {
  requested: "Requested",
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
};
const CHART_COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#60a5fa", "#f87171"];

const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ClaimsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [claims, setClaims] = useState<Claim[]>([]);
  const [auths, setAuths] = useState<ClaimAuthorization[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [claimsData, authsData, profiles, allNotes] = await Promise.all([
          getCompanyClaims({ startDate: dateFrom || undefined, endDate: dateTo || undefined }),
          getCompanyClaimAuthorizations({ startDate: dateFrom || undefined, endDate: dateTo || undefined }),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => {
            console.error("Failed to load agent notes:", err);
            return [];
          }),
        ]);
        if (cancelled) return;
        setClaims(claimsData);
        setAuths(authsData);
        setStaff(profiles.filter((p) => CLAIMS_ROLES.has(normalizeRole(p.role))));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Claims Dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  // Filter options come from the data itself — no invented brand/status list.
  const brandOptions = useMemo(() => Array.from(new Set(claims.map((c) => c.brand).filter((b): b is string => !!b))).sort(), [claims]);
  const statusOptions = useMemo(() => Array.from(new Set(claims.map((c) => c.status).filter((s): s is string => !!s))).sort(), [claims]);

  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      if (brandFilter && c.brand !== brandFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      return true;
    });
  }, [claims, brandFilter, statusFilter]);

  const kpi = useMemo(() => {
    const totalAmount = filteredClaims.reduce((s, c) => s + (c.amount ?? 0), 0);
    const pendingAuths = auths.filter((a) => a.status === "requested" || a.status === "pending").length;
    const approvedAuths = auths.filter((a) => a.status === "approved").length;
    return {
      totalClaims: filteredClaims.length,
      totalAmount,
      pendingAuths,
      approvedAuths,
      staffCount: staff.length,
    };
  }, [filteredClaims, auths, staff]);

  const brandBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filteredClaims) {
      const key = c.brand || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredClaims]);

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filteredClaims) {
      const key = c.status || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredClaims]);

  const authStatusBreakdown = useMemo(() => {
    return (["requested", "pending", "approved", "denied"] as const).map((status) => ({
      status,
      label: AUTH_STATUS_LABEL[status],
      count: auths.filter((a) => a.status === status).length,
    }));
  }, [auths]);

  // Aging — how long still-open authorizations (requested/pending) have been waiting.
  const agingBuckets = useMemo(() => {
    const buckets = { "0-1 Day": 0, "2-3 Days": 0, "4-6 Days": 0, "7+ Days": 0 };
    const now = Date.now();
    for (const a of auths) {
      if (a.status !== "requested" && a.status !== "pending") continue;
      const started = a.requestedAt || a.createdAt;
      const days = Math.floor((now - new Date(started).getTime()) / 86400000);
      if (days <= 1) buckets["0-1 Day"]++;
      else if (days <= 3) buckets["2-3 Days"]++;
      else if (days <= 6) buckets["4-6 Days"]++;
      else buckets["7+ Days"]++;
    }
    return Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }, [auths]);

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
        claimsSubmitted: filteredClaims.filter((c) => c.createdBy === p.id).length,
        warnings: warningCountByProfile.get(p.id) ?? 0,
        mistakes: mistakeCountByProfile.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.claimsSubmitted - a.claimsSubmitted);
  }, [staff, filteredClaims, warningCountByProfile, mistakeCountByProfile]);

  if (!loading && staff.length === 0 && claims.length === 0 && auths.length === 0) {
    // Still render the shell below (filters etc.) — this early return is
    // intentionally not used; kept as a reminder this is a real empty state,
    // not a bug, when nothing has been logged yet.
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Claims pipeline overview — live from the claims &amp; authorizations tables.</p>
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
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Brand</label>
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="glass-input mt-1 w-full">
                <option value="">All{brandOptions.length === 0 ? " (no claims logged yet)" : ""}</option>
                {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-input mt-1 w-full">
                <option value="">All{statusOptions.length === 0 ? " (no claims logged yet)" : ""}</option>
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Brand/Status options are built from whatever's actually been logged — leave Date From/To blank for all-time.
          </p>
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
            { label: "Total Amount", value: currency(kpi.totalAmount), color: "text-green-300", icon: <DollarSign className="h-4 w-4" /> },
            { label: "Pending Auth", value: kpi.pendingAuths, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
            { label: "Approved Auth", value: kpi.approvedAuths, color: "text-emerald-300", icon: <CheckCircle2 className="h-4 w-4" /> },
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
            <p className="text-sm font-semibold mb-4">Claims by Brand</p>
            {brandBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No claims logged yet — this fills in as claims are recorded.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={brandBreakdown} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Claims" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Claims by Status</p>
            {statusBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No claims logged yet — this fills in as claims are recorded.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={statusBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false} labelLine={false}>
                    {statusBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600 }} />
                  <Legend wrapperStyle={{ fontSize: 10, color: "var(--foreground)" }} formatter={(v) => <span style={{ color: "var(--foreground)" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pre-Authorization tracking */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Pre-Authorization Status</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {authStatusBreakdown.map((a) => (
              <div key={a.status} className="panel p-3 text-center">
                <p className="text-xl font-bold" style={{ color: AUTH_STATUS_COLOR[a.status] }}>{a.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{a.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Aging — Still Awaiting Decision</p>
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
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Claims Submitted</th>
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
                    <td className="px-3 py-2 text-right">{s.claimsSubmitted}</td>
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
