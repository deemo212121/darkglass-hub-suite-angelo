/**
 * Parts Dashboard — overview for the Parts team, rebuilt on live data.
 *
 * Every number here comes from a real query: `parts` (via
 * getPartsInventoryRows — the same source the real Part Inventory page
 * uses, 159 real ticket-attached part lines as of this writing) and
 * `truck_stock` (real per-branch on-hand counts, ~7k rows). Distributor/
 * status/location/technician filter options are derived from whatever
 * values are actually present in the data, not a fixed invented list —
 * the real `status` column carries free-text values beyond the nominal
 * enum (e.g. "CX Home", "RA - PNN"), so a hardcoded dropdown would hide
 * real rows. `parts.created_by` isn't populated in this data set, so the
 * Parts staff table shows real PARTS/PARTS_MANAGER profiles with their
 * real Warnings/Mistakes record, not a fabricated "lines submitted" count.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Package, TrendingUp, AlertTriangle, CheckCircle, Truck, RotateCcw, ClipboardList, BarChart2, DollarSign, Loader2, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getTruckStock, type TruckStockRow } from "@/lib/supabase/truckStock";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";

const COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#22d3ee", "#60a5fa"];
const PARTS_ROLES = new Set(["PARTS", "PARTS_MANAGER"]);
const PENDING_STATUSES = new Set(["Need PO", "PO Made"]);
const READY_STATUSES = new Set(["Part Ready", "Tech Pickup"]);
const DONE_STATUSES = new Set(["Used", "Claimed"]);

const CHART_TOOLTIP_STYLE: React.CSSProperties = { background: "var(--color-card)", color: "var(--color-foreground)", border: "1px solid var(--color-panel-border)", borderRadius: 6 };

const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function PartsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<PartInventoryRow[]>([]);
  const [truckStock, setTruckStock] = useState<TruckStockRow[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  // Embedded live table filters
  const [locationFilter, setLocationFilter] = useState("");
  const [distFilter, setDistFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [techFilter, setTechFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [partsRows, truck, users, allNotes] = await Promise.all([
          getPartsInventoryRows(),
          getTruckStock().catch((err) => {
            console.error("Failed to load truck stock:", err);
            return [] as TruckStockRow[];
          }),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => {
            console.error("Failed to load agent notes:", err);
            return [] as CsrAgentNote[];
          }),
        ]);
        if (cancelled) return;
        setRows(partsRows);
        setTruckStock(truck);
        setStaff(users.filter((p) => PARTS_ROLES.has(normalizeRole(p.role))));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Parts Dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const kpi = useMemo(() => {
    const totalSpend = rows.reduce((s, r) => s + r.partPrice * r.quantity, 0);
    const pendingPO = rows.filter((r) => PENDING_STATUSES.has(r.status)).length;
    const readyForPickup = rows.filter((r) => READY_STATUSES.has(r.status)).length;
    const completed = rows.filter((r) => DONE_STATUSES.has(r.status)).length;
    const uniqueTickets = new Set(rows.map((r) => r.ticketNo).filter(Boolean)).size;
    const truckStockTotal = truckStock.reduce((s, t) => s + t.quantity, 0);
    return { totalLines: rows.length, totalSpend, pendingPO, readyForPickup, completed, uniqueTickets, truckStockTotal, staffCount: staff.length };
  }, [rows, truckStock, staff]);

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.status || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const distBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.partDist || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const locationBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.location || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const truckStockByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of truckStock) {
      const key = t.branch || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + t.quantity);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);
  }, [truckStock]);

  // Daily trend — the live date range in this data set spans a few weeks,
  // not enough for a meaningful monthly view, so this tracks lines logged
  // per day over the trailing window instead of inventing a monthly bucket.
  const dailyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const day = r.createdAt.slice(0, 10);
      if (!day) continue;
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, count]) => ({ date: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }), count }));
  }, [rows]);

  const agingBuckets = useMemo(() => {
    const buckets = { "0-3 Days": 0, "4-7 Days": 0, "8-14 Days": 0, "15+ Days": 0 };
    for (const r of rows) {
      if (DONE_STATUSES.has(r.status)) continue;
      if (r.agingDays <= 3) buckets["0-3 Days"]++;
      else if (r.agingDays <= 7) buckets["4-7 Days"]++;
      else if (r.agingDays <= 14) buckets["8-14 Days"]++;
      else buckets["15+ Days"]++;
    }
    return Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }, [rows]);

  const topParts = useMemo(() => {
    const map = new Map<string, { partNo: string; desc: string; count: number; spend: number }>();
    for (const r of rows) {
      if (!r.partNo) continue;
      const key = r.partNo;
      const existing = map.get(key) ?? { partNo: r.partNo, desc: r.partDesc, count: 0, spend: 0 };
      existing.count += 1;
      existing.spend += r.partPrice * r.quantity;
      if (!existing.desc && r.partDesc) existing.desc = r.partDesc;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [rows]);

  const distTable = useMemo(() => {
    const totalLines = rows.length || 1;
    const map = new Map<string, { name: string; lines: number; spend: number }>();
    for (const r of rows) {
      const key = r.partDist || "Unspecified";
      const existing = map.get(key) ?? { name: key, lines: 0, spend: 0 };
      existing.lines += 1;
      existing.spend += r.partPrice * r.quantity;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((d) => ({ ...d, share: Math.round((d.lines / totalLines) * 1000) / 10 }))
      .sort((a, b) => b.lines - a.lines);
  }, [rows]);

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
        warnings: warningCountByProfile.get(p.id) ?? 0,
        mistakes: mistakeCountByProfile.get(p.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, warningCountByProfile, mistakeCountByProfile]);

  // Real in-stock lookup — matches the embedded table's part numbers
  // against truck_stock instead of showing an invented reserved/available
  // quantity.
  const stockByPartNo = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of truckStock) {
      const key = t.partNo.trim().toUpperCase();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + t.quantity);
    }
    return map;
  }, [truckStock]);

  const locationOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.location).filter(Boolean))).sort(), [rows]);
  const distOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.partDist).filter(Boolean))).sort(), [rows]);
  const statusOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.status).filter(Boolean))).sort(), [rows]);
  const techOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.technician).filter(Boolean))).sort(), [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (locationFilter && r.location !== locationFilter) return false;
      if (distFilter && r.partDist !== distFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (techFilter && r.technician !== techFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.ticketNo.toLowerCase().includes(q) && !r.partNo.toLowerCase().includes(q) && !r.partDesc.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, locationFilter, distFilter, statusFilter, techFilter, search]);

  const QUICK_NAV = [
    { slug: "part-order", label: "Part Order", icon: <ClipboardList className="h-4 w-4" /> },
    { slug: "part-inventory", label: "Part Inventory", icon: <Package className="h-4 w-4" /> },
    { slug: "part-collection", label: "Part Collection", icon: <CheckCircle className="h-4 w-4" /> },
    { slug: "part-pickup", label: "Part Pickup", icon: <Truck className="h-4 w-4" /> },
    { slug: "part-receive", label: "Part Receive", icon: <Package className="h-4 w-4" /> },
    { slug: "part-return", label: "Part Return", icon: <RotateCcw className="h-4 w-4" /> },
    { slug: "part-return-status", label: "Return Status", icon: <TrendingUp className="h-4 w-4" /> },
    { slug: "po-status", label: "PO Status", icon: <BarChart2 className="h-4 w-4" /> },
    { slug: "truck-stock", label: "Truck Stock", icon: <Truck className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Live from Part Inventory &amp; Truck Stock · {kpi.staffCount} Parts staff</p>
          </div>
        </div>

        {/* Quick nav */}
        <div className="flex flex-wrap gap-2 mb-6 mt-4">
          {QUICK_NAV.map((item) => (
            <Link key={item.slug} to="/m/$module/$submodule" params={{ module: "parts", submodule: item.slug }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors">
              {item.icon}{item.label}
            </Link>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Parts Dashboard…
          </div>
        ) : (
        <>
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
          {[
            { label: "Part Lines", value: kpi.totalLines.toLocaleString(), color: "text-blue-300", icon: <Package className="h-4 w-4" /> },
            { label: "Total Spend", value: currency(kpi.totalSpend), color: "text-green-300", icon: <DollarSign className="h-4 w-4" /> },
            { label: "Unique Tickets", value: kpi.uniqueTickets.toLocaleString(), color: "text-purple-300", icon: <ClipboardList className="h-4 w-4" /> },
            { label: "Pending PO", value: kpi.pendingPO, color: "text-orange-300", icon: <AlertTriangle className="h-4 w-4" /> },
            { label: "Ready for Pickup", value: kpi.readyForPickup, color: "text-cyan-300", icon: <Truck className="h-4 w-4" /> },
            { label: "Completed", value: kpi.completed, color: "text-emerald-300", icon: <CheckCircle className="h-4 w-4" /> },
            { label: "Truck Stock Units", value: kpi.truckStockTotal.toLocaleString(), color: "text-blue-300", icon: <Package className="h-4 w-4" /> },
            { label: "Parts Staff", value: kpi.staffCount, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value || "—"}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Charts row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="panel p-4 lg:col-span-2">
            <p className="text-sm font-semibold mb-4">Part Lines Logged — Last 14 Days</p>
            {dailyTrend.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No part lines logged yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyTrend} margin={{ left: -10 }}>
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Lines" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Distributor</p>
            {distBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={distBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ percent }: any) => `${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                    {distBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Location + status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Location</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={locationBreakdown} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={52} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Lines" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Truck Stock — Top Branches by On-Hand Units</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={truckStockByBranch} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={52} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#34d399" radius={[4, 4, 0, 0]} name="On-Hand" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status + aging + staff */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Status</p>
            <ResponsiveContainer width="100%" height={Math.max(180, statusBreakdown.length * 24)}>
              <BarChart data={statusBreakdown} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={110} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Aging — Still Open</p>
            <div className="space-y-3 mt-2">
              {agingBuckets.map((b) => {
                const max = Math.max(1, ...agingBuckets.map((x) => x.count));
                return (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="text-orange-300">{b.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${(b.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" />Parts Staff
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Warn</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mistk</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No one currently holds a Parts role.</td></tr>
                ) : staffRows.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">
                      <a href={`/csr-agent/${s.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition" title={`View ${s.name}'s statistics`}>
                        {s.name}
                      </a>
                      <p className="text-[10px] text-muted-foreground">{s.role} · {s.branch}</p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.warnings > 0 ? <span className="bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded font-semibold">{s.warnings}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.mistakes > 0 ? <span className="bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded font-semibold">{s.mistakes}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Distributor table */}
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-400" />Distributor Breakdown
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["Distributor", "Lines", "Spend", "Share"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {distTable.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
              ) : distTable.map((d, i) => (
                <tr key={d.name} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-4 py-2 font-medium">{d.name}</td>
                  <td className="px-4 py-2 text-blue-300">{d.lines.toLocaleString()}</td>
                  <td className="px-4 py-2 text-green-300">{currency(d.spend)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(100, d.share)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{d.share}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top parts table */}
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <Package className="h-4 w-4 text-purple-400" />Most Ordered Parts
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["Part No", "Description", "Times Ordered", "Total Spend"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {topParts.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
              ) : topParts.map((p, i) => (
                <tr key={p.partNo + i} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-4 py-2 font-mono text-xs text-blue-300">{p.partNo}</td>
                  <td className="px-4 py-2 text-xs">{p.desc || "—"}</td>
                  <td className="px-4 py-2 text-blue-300">{p.count}</td>
                  <td className="px-4 py-2 text-green-300">{currency(p.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Live Part Inventory table — filters + real rows, no fake reserve/ship workflow */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-purple-400" />
            <span className="font-semibold text-sm">Part Lines</span>
            <Link to="/m/$module/$submodule" params={{ module: "parts", submodule: "part-inventory" }}
              className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors">Open full page →</Link>
          </div>

          <div className="p-4 border-b border-white/10 bg-white/[0.01]">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Location</label>
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Locations</option>
                  {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Distributor</label>
                <select value={distFilter} onChange={(e) => setDistFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Distributors</option>
                  {distOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Status</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Statuses</option>
                  {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Technician</label>
                <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Technicians</option>
                  {techOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Search</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ticket, part #, description"
                  className="glass-input mt-1 w-full" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.01]">
            <span className="text-sm text-muted-foreground">{filteredRows.length} of {rows.length} lines</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Ticket</th>
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Part / Distributor</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Qty</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Price</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">In Truck Stock</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Aging</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No records match current filters.</td></tr>
                ) : filteredRows.slice(0, 200).map((r) => {
                  const inStock = stockByPartNo.get(r.partNo.trim().toUpperCase());
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2.5 align-top">
                        <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} className="font-mono text-xs text-blue-400 hover:underline">{r.ticketNo || "—"}</Link>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{r.location || "—"}{r.technician ? ` · ${r.technician}` : ""}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${PENDING_STATUSES.has(r.status) ? "bg-red-500/15 text-red-300 border-red-500/25" : READY_STATUSES.has(r.status) ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/25" : DONE_STATUSES.has(r.status) ? "bg-green-500/15 text-green-300 border-green-500/25" : "bg-white/10 text-muted-foreground border-white/10"}`}>
                          {r.status || "—"}
                        </span>
                        {r.warranty && <p className="text-[10px] text-muted-foreground mt-1">{r.warranty}</p>}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="text-xs font-medium">{r.partDesc || "—"}</p>
                        <p className="font-mono text-[11px] text-blue-300 mt-0.5">{r.partNo || "—"}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{r.partDist || "—"}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top text-right">{r.quantity}</td>
                      <td className="px-3 py-2.5 align-top text-right text-green-300">{currency(r.partPrice)}</td>
                      <td className="px-3 py-2.5 align-top text-right">
                        {inStock !== undefined ? <span className={inStock > 0 ? "text-green-300 font-semibold" : "text-red-300"}>{inStock}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right text-muted-foreground">{r.agingDays}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredRows.length > 200 && (
            <div className="px-4 py-2 text-center text-[10px] text-muted-foreground border-t border-white/10">
              Showing the first 200 of {filteredRows.length} matching lines — narrow the filters above to see more.
            </div>
          )}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
