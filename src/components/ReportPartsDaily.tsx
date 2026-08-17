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

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronLeft, Loader2, LayoutDashboard, CheckCheck, Building2 } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole } from "@/lib/roleLabels";
import { getPartsDoneActivity, type PartsDoneActivityRow } from "@/lib/supabase/partsDoneActivityLog";

const PARTS_ROLES = new Set(["PARTS", "PARTS_MANAGER"]);
const DONE_STATUSES = new Set(["Used", "Claimed"]);
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

const TABS = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "done-activity" as const, label: "Done Activity", icon: CheckCheck },
];
type ReportPartsDailyTab = (typeof TABS)[number]["id"];

// CheckboxDropdown — same pattern PartsOrderDashboard.tsx established
// (select-styled trigger, portal-positioned checkbox list below it, empty
// `selected` = no filter/show all). Kept local here too since this is the
// only tab on this page that needs it.
function CheckboxDropdown({ options, selected, onChange, allLabel }: {
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (opt: string) => {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next);
  };

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="glass-input w-full text-left flex items-center justify-between gap-2"
      >
        <span className="truncate">
          {selected.size === 0 ? `All ${allLabel}` : Array.from(selected).join(", ")}
        </span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          <label className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded border-b border-white/10 hover:bg-white/5 cursor-pointer text-sm font-semibold text-slate-100 whitespace-nowrap">
            <input type="checkbox" checked={selected.size === 0} onChange={() => onChange(new Set())} className="accent-blue-500" />
            All {allLabel}
          </label>
          {options.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1.5">No options.</p>}
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm text-slate-200 whitespace-nowrap">
              <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} className="accent-blue-500" />
              {opt}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Done Activity tab's per-metric done/total color: nothing to do at all
// (total 0) is neutral, fully caught up is green, still behind is amber.
function doneMetricColor(done: number, total: number): string {
  if (total === 0) return "text-slate-400";
  return done >= total ? "text-emerald-400" : "text-amber-400";
}

// Rows without structured metrics (migration 0175) — either logged before
// that migration, or a branch-progress lookup miss at log time — still
// carry the numbers inside the flat `summary` sentence
// (formatBranchProgressLine's own fixed wording), so parse them back out
// rather than falling back to an unbulleted line.
const SUMMARY_METRICS_RE = /Collections done (\d+)\/(\d+).*Daily Pickup done (\d+)\/(\d+).*Parts Received done (\d+)\/(\d+)/;
function parseSummaryMetrics(summary: string): PartsDoneActivityRow["metrics"] {
  const m = SUMMARY_METRICS_RE.exec(summary);
  if (!m) return null;
  return {
    collectionsDone: Number(m[1]),
    collectionsTotal: Number(m[2]),
    pickupDone: Number(m[3]),
    pickupTotal: Number(m[4]),
    receivedDone: Number(m[5]),
    receivedTotal: Number(m[6]),
  };
}

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

  const [tab, setTab] = useState<ReportPartsDailyTab>("overview");

  // Deep link from a bell-icon notification straight into the Done
  // Activity tab (the "Parts done" notification sets ?tab=done-activity
  // on its link — see m.$module.tsx's confirmImDone) — same convention
  // PartInventory.tsx's Truck Stock Requests tab already uses.
  const routeSearch = (useSearch({ strict: false }) as { tab?: string }) ?? {};
  useEffect(() => {
    if (routeSearch.tab === "done-activity") setTab("done-activity");
  }, [routeSearch.tab]);

  // Done Activity tab — a log of every "Done" button click on the Parts
  // hub (m.$module.tsx), synced with the same "Parts done" notification
  // that goes out to each branch's Parts Manager (see migration 0174 /
  // partsDoneActivityLog.ts). Loaded lazily, only once this tab is opened.
  const [doneActivity, setDoneActivity] = useState<PartsDoneActivityRow[]>([]);
  const [doneActivityLoading, setDoneActivityLoading] = useState(false);
  const [doneActivityLoaded, setDoneActivityLoaded] = useState(false);
  useEffect(() => {
    if (tab !== "done-activity" || doneActivityLoaded) return;
    setDoneActivityLoading(true);
    getPartsDoneActivity()
      .then((r) => { setDoneActivity(r); setDoneActivityLoaded(true); })
      .catch((err) => console.error("Failed to load Done activity:", err))
      .finally(() => setDoneActivityLoading(false));
  }, [tab, doneActivityLoaded]);
  // Empty set = no filter (show all), same convention as the checkbox
  // dropdowns above. Date range is inclusive on both ends, compared
  // against createdAt's own date (not time-of-day).
  const [doneActivityBranchFilter, setDoneActivityBranchFilter] = useState<Set<string>>(new Set());
  const [doneActivityNameFilter, setDoneActivityNameFilter] = useState<Set<string>>(new Set());
  const [doneActivityFrom, setDoneActivityFrom] = useState("");
  const [doneActivityTo, setDoneActivityTo] = useState("");
  const doneActivityBranchOptions = useMemo(
    () => Array.from(new Set(doneActivity.map((r) => r.branch))).sort((a, b) => a.localeCompare(b)),
    [doneActivity]
  );
  const doneActivityNameOptions = useMemo(
    () => Array.from(new Set(doneActivity.map((r) => r.actorName).filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b)),
    [doneActivity]
  );
  const filteredDoneActivity = useMemo(() => {
    return doneActivity.filter((r) => {
      if (doneActivityBranchFilter.size > 0 && !doneActivityBranchFilter.has(r.branch)) return false;
      if (doneActivityNameFilter.size > 0 && !(r.actorName && doneActivityNameFilter.has(r.actorName))) return false;
      const day = r.createdAt.slice(0, 10);
      if (doneActivityFrom && day < doneActivityFrom) return false;
      if (doneActivityTo && day > doneActivityTo) return false;
      return true;
    });
  }, [doneActivity, doneActivityBranchFilter, doneActivityNameFilter, doneActivityFrom, doneActivityTo]);

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

        <div className="flex gap-2 border-b border-white/10 mb-6 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 border-b-2 transition whitespace-nowrap flex items-center gap-2 text-sm ${tab === t.id ? "border-blue-500 text-blue-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
        <>
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
              <ResponsiveContainer width="100%" height={220} debounce={200}>
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
            <ResponsiveContainer width="100%" height={220} debounce={200}>
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
        </>
        )}

        {tab === "done-activity" && (
        <div className="space-y-3">
          <div className="panel flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
              <CheckboxDropdown options={doneActivityBranchOptions} selected={doneActivityBranchFilter} onChange={setDoneActivityBranchFilter} allLabel="Branches" />
            </div>
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reported By</label>
              <CheckboxDropdown options={doneActivityNameOptions} selected={doneActivityNameFilter} onChange={setDoneActivityNameFilter} allLabel="Names" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From</label>
              <input type="date" aria-label="Done activity date from" value={doneActivityFrom} onChange={(e) => setDoneActivityFrom(e.target.value)} className="glass-input" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To</label>
              <input type="date" aria-label="Done activity date to" value={doneActivityTo} onChange={(e) => setDoneActivityTo(e.target.value)} className="glass-input" />
            </div>
            {(doneActivityBranchFilter.size > 0 || doneActivityNameFilter.size > 0 || doneActivityFrom || doneActivityTo) && (
              <button
                type="button"
                onClick={() => { setDoneActivityBranchFilter(new Set()); setDoneActivityNameFilter(new Set()); setDoneActivityFrom(""); setDoneActivityTo(""); }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Clear filters
              </button>
            )}
          </div>

          {doneActivityLoading ? (
            <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading Done activity…
            </div>
          ) : doneActivity.length === 0 ? (
            <div className="panel text-sm text-muted-foreground">No one has clicked "Done" on the Parts hub yet.</div>
          ) : filteredDoneActivity.length === 0 ? (
            <div className="panel text-sm text-muted-foreground">No Done activity matches these filters.</div>
          ) : (
            Array.from(
              filteredDoneActivity.reduce((map, row) => {
                (map.get(row.branch) ?? map.set(row.branch, []).get(row.branch)!).push(row);
                return map;
              }, new Map<string, PartsDoneActivityRow[]>())
            )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([branch, rows]) => (
                <div key={branch} className="panel">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-400" />{branch}</h3>
                    <span className="text-xs text-muted-foreground">{rows.length} Done click{rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="space-y-2">
                    {rows.map((row) => {
                      const metrics = row.metrics ?? parseSummaryMetrics(row.summary);
                      return (
                      <div key={row.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Done</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {new Date(row.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                        {metrics ? (
                          <ul className="mt-1.5 space-y-1">
                            {[
                              { label: "Collection", dot: "bg-cyan-400", done: metrics.collectionsDone, total: metrics.collectionsTotal },
                              { label: "Pickup", dot: "bg-violet-400", done: metrics.pickupDone, total: metrics.pickupTotal },
                              { label: "Receive", dot: "bg-emerald-400", done: metrics.receivedDone, total: metrics.receivedTotal },
                            ].map((m) => (
                              <li key={m.label} className="flex items-center gap-2 text-sm">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
                                <span className="text-slate-300">{m.label}</span>
                                <span className={`ml-auto font-semibold tabular-nums ${doneMetricColor(m.done, m.total)}`}>{m.done}/{m.total}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-sm text-slate-200">{row.summary}</p>
                        )}
                        <p className="mt-2 pt-2 border-t border-white/5 text-xs text-slate-400">
                          <span className="font-medium text-slate-300">Name:</span> {row.actorName || "Unknown"}
                          <span className="mx-1.5 text-muted-foreground">·</span>
                          Notified {row.recipientCount} Parts Manager{row.recipientCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))
          )}
        </div>
        )}
      </main>
    </div>
  );
}
