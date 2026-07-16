/**
 * Part Daily Report — rebuilt on live data, sharing PartsDashboard.tsx's
 * data source (getPartsInventoryRows(), the real `parts` table joined to
 * `tickets` for branch/location) and its established status buckets
 * (PENDING/READY/DONE). Per branch: Collections = parts that reached a
 * DONE status, RA = parts with a return-authorization number set,
 * Receives = parts with an inbound tracking number set — all scoped to the
 * selected date range.
 *
 * `parts.created_by` isn't populated in this data set (same gap
 * PartsDashboard.tsx already documents), so there's no real field to
 * attribute an individual part line to a specific staff member — the Staff
 * Detail table shows real PARTS/PARTS_MANAGER profiles with their real
 * Warnings/Mistakes record instead of a fabricated per-person collections
 * count. Collections/RA/Receives stay branch-level, which is what the
 * charts actually emphasize anyway.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole } from "@/lib/roleLabels";

const PARTS_ROLES = new Set(["PARTS", "PARTS_MANAGER"]);
const DONE_STATUSES = new Set(["Used", "Claimed"]);
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

function isPartsProfile(p: ProfileRow): boolean {
  if (PARTS_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => PARTS_ROLES.has(normalizeRole(r)));
}
function dateOnly(v: string | undefined | null): string {
  return (v || "").slice(0, 10);
}
function inRange(v: string | undefined | null, from: string, to: string): boolean {
  const d = dateOnly(v);
  return !!d && d >= from && d <= to;
}
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
/** Add (or subtract, with a negative n) n days to an ISO date string. */
const addDaysToIso = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtShort = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; };

export function ReportPartsDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PartInventoryRow[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());
  const [branchFilter, setBranchFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [partRows, profiles, allNotes] = await Promise.all([
          getPartsInventoryRows(),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
        ]);
        if (cancelled) return;
        setRows(partRows);
        setStaff(profiles.filter(isPartsProfile));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Part Daily Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const branchOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.location).filter(Boolean))).sort(), [rows]);

  const inWindow = useMemo(
    () => rows.filter((r) => inRange(r.createdAt, dateFrom, dateTo) && (!branchFilter || r.location === branchFilter)),
    [rows, dateFrom, dateTo, branchFilter],
  );

  const collectionsRows = useMemo(() => inWindow.filter((r) => DONE_STATUSES.has(r.status)), [inWindow]);
  // RA is date-scoped by ra_date (when the RA was actually created), not the
  // part line's createdAt — those can be days apart. Falls back to
  // createdAt for older rows recorded before ra_date was tracked.
  const raRows = useMemo(
    () => rows.filter((r) => !!r.raNo.trim() && inRange(r.raDate || r.createdAt, dateFrom, dateTo) && (!branchFilter || r.location === branchFilter)),
    [rows, dateFrom, dateTo, branchFilter],
  );
  const receivesRows = useMemo(() => inWindow.filter((r) => !!r.inTracking.trim()), [inWindow]);

  const warningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "warning") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);
  const mistakeCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "mistake") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);

  const kpi = {
    collections: collectionsRows.length,
    ra: raRows.length,
    receives: receivesRows.length,
    warnings: staff.reduce((s, p) => s + (warningCountByProfile.get(p.id) ?? 0), 0),
    staffCount: staff.length,
  };

  const branchChartData = useMemo(() => {
    const map = new Map<string, { collections: number; ra: number; receives: number }>();
    const bump = (loc: string, key: "collections" | "ra" | "receives") => {
      const b = loc || "Unspecified";
      if (!map.has(b)) map.set(b, { collections: 0, ra: 0, receives: 0 });
      map.get(b)![key]++;
    };
    for (const r of collectionsRows) bump(r.location, "collections");
    for (const r of raRows) bump(r.location, "ra");
    for (const r of receivesRows) bump(r.location, "receives");
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.collections - a.collections).slice(0, 12);
  }, [collectionsRows, raRows, receivesRows]);

  // Real day-by-day Collections count for the 10 days ending at Date To —
  // not the real "today" — so this stays consistent with the KPI tiles when
  // looking at a past date range instead of the current one. One pass.
  const trendData = useMemo(() => {
    const dates = Array.from({ length: 10 }, (_, i) => addDaysToIso(dateTo, i - 9));
    const collected = new Map(dates.map((d) => [d, 0]));
    const received = new Map(dates.map((d) => [d, 0]));
    const branchScoped = rows.filter((r) => !branchFilter || r.location === branchFilter);
    for (const r of branchScoped) {
      if (DONE_STATUSES.has(r.status)) { const d = dateOnly(r.createdAt); if (collected.has(d)) collected.set(d, (collected.get(d) ?? 0) + 1); }
      if (r.inTracking.trim()) { const d = dateOnly(r.createdAt); if (received.has(d)) received.set(d, (received.get(d) ?? 0) + 1); }
    }
    return dates.map((d) => ({ date: fmtShort(d), collections: collected.get(d) ?? 0, receives: received.get(d) ?? 0 }));
  }, [rows, branchFilter, dateTo]);

  const totalMistakes = staff.reduce((s, p) => s + (mistakeCountByProfile.get(p.id) ?? 0), 0);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All Branches</option>
              {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select></div>
          {branchFilter && <button onClick={() => setBranchFilter("")} className="btn text-sm px-3 mb-0.5">Clear</button>}
        </div></div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Part Daily Report…</div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            ["Collections", kpi.collections, "text-green-300"],
            ["RA Created", kpi.ra, "text-yellow-300"],
            ["Receives", kpi.receives, "text-blue-300"],
            ["Warnings", kpi.warnings, "text-red-300"],
          ].map(([l, v, c]) => (
            <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-3xl font-bold ${c}`}>{v}</p></div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Collections / RA / Receives by Branch</p>
            {branchChartData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No part activity in this date range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={branchChartData} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  <Bar dataKey="collections" fill="#34d399" radius={[4, 4, 0, 0]} name="Collections" />
                  <Bar dataKey="receives" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Receives" />
                  <Bar dataKey="ra" fill="#fb923c" radius={[4, 4, 0, 0]} name="RA Created" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Collections Trend — Last 10 Days</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendData} margin={{ left: -10 }}>
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="collections" fill="#34d399" radius={[4, 4, 0, 0]} name="Collections" />
                <Bar dataKey="receives" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Receives" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            ["Parts Staff", kpi.staffCount, "text-blue-300"],
            ["Warnings (Company-wide)", kpi.warnings, "text-yellow-300"],
            ["Mistakes (Company-wide)", totalMistakes, "text-red-300"],
          ].map(([l, v, c]) => (
            <div key={l as string} className="panel p-3 text-center"><p className={`text-lg font-bold ${c}`}>{v}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{l}</p></div>
          ))}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
