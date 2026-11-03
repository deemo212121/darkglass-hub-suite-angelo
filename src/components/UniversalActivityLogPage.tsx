/**
 * Universal Activity Log — one combined feed across every department
 * (Claims/Parts/CSR/Triage/BizOps/Technician/HR/Accounting/IT/Admin), plus
 * an ALL tab merging everything. See src/lib/supabase/universalActivityLog.ts
 * for how each department's rows are actually sourced — this page is just
 * the filter bar + table over that already-normalized feed, it does no
 * data-shaping of its own.
 *
 * Each tab loads its newest 500 entries when first opened, and "Load 500
 * more" the next 500 older ones; a tab keeps what it loaded while you look
 * at others. Date From / Date To are optional limits.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import * as XLSX from "xlsx";
import { ChevronLeft, Loader2, Download, Search, ShieldAlert } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import {
  getUniversalActivityPage,
  DEPARTMENT_LABEL,
  DEPARTMENT_ORDER,
  type ActivityTab,
  type UniversalActivityEntry,
} from "@/lib/supabase/universalActivityLog";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { todayISO } from "@/lib/localDate";

type TabKey = ActivityTab;
const TABS: TabKey[] = ["all", ...DEPARTMENT_ORDER];
const PAGE_SIZE = 500;

/** What one tab has loaded: its rows (newest first) and where the next page starts (null = nothing older). */
type TabState = { entries: UniversalActivityEntry[]; next: string | null; loading: boolean; error: string | null };

function downloadXlsx(rows: UniversalActivityEntry[], tab: TabKey) {
  const data = rows.map((r) => ({
    When: new Date(r.when).toLocaleString(),
    Department: DEPARTMENT_LABEL[r.department],
    Actor: r.actorName,
    Action: r.alert ? `ALERT: ${r.action}` : r.action,
    Target: r.targetLabel,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Activity Log");
  const span = rows.length ? `${rows[rows.length - 1].when.slice(0, 10)}_to_${rows[0].when.slice(0, 10)}` : todayISO();
  XLSX.writeFile(workbook, `activity-log_${tab}_${span}.xlsx`);
}

export function UniversalActivityLogPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [activeTab, setActiveTab] = usePersistedTab<TabKey>("ahs:universal-activity-log-tab", TABS, "all");

  const [tabs, setTabs] = useState<Partial<Record<TabKey, TabState>>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  // Bumped when the dates change, so pages still loading for the old dates are dropped.
  const generation = useRef(0);
  // "generation:tab" pages being fetched right now — one at a time per tab.
  const inFlight = useRef(new Set<string>());

  // Optional date limits as instants: the viewer's own local midnight to end of day.
  const afterIso = dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : null;
  const toIso = dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : null;

  const loadPage = async (tab: TabKey, reset: boolean) => {
    const gen = generation.current;
    const key = `${gen}:${tab}`;
    const prev = reset ? undefined : tabs[tab];
    if (inFlight.current.has(key) || (prev && !prev.next)) return;
    inFlight.current.add(key);
    setTabs((t) => ({ ...t, [tab]: { entries: prev?.entries ?? [], next: prev?.next ?? null, loading: true, error: null } }));
    try {
      const page = await getUniversalActivityPage({
        tab,
        before: prev ? prev.next : toIso,
        after: afterIso,
        limit: PAGE_SIZE,
        have: new Set(prev?.entries.map((e) => e.id)),
      });
      if (gen !== generation.current) return;
      setTabs((t) => ({ ...t, [tab]: { entries: reset ? page.entries : [...(t[tab]?.entries ?? []), ...page.entries], next: page.next, loading: false, error: null } }));
    } catch (err) {
      if (gen !== generation.current) return;
      setTabs((t) => ({ ...t, [tab]: { entries: t[tab]?.entries ?? [], next: t[tab]?.next ?? null, loading: false, error: err instanceof Error ? err.message : "Failed to load activity log." } }));
    } finally {
      inFlight.current.delete(key);
    }
  };

  // A tab loads its first page the first time it's opened (and again after the dates change).
  useEffect(() => {
    if (!tabs[activeTab]) void loadPage(activeTab, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tabs]);

  const changeDates = (from: string, to: string) => {
    generation.current++;
    setDateFrom(from);
    setDateTo(to);
    setTabs({});
  };

  const current = tabs[activeTab];
  const tabRows = current?.entries ?? [];
  const firstLoad = !current || (current.loading && current.entries.length === 0);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabRows;
    return tabRows.filter(
      (r) =>
        r.actorName.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        r.targetLabel.toLowerCase().includes(q)
    );
  }, [tabRows, search]);

  const tabCount = (t: TabKey) => {
    const s = tabs[t];
    if (!s || (s.loading && s.entries.length === 0)) return null;
    return `${s.entries.length.toLocaleString()}${s.next ? "+" : ""}`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Every department's activity in one feed, newest first — {PAGE_SIZE} at a time, load more at the bottom. Pick a department or view ALL.</p>
          </div>
        </div>

        <div className="panel mb-6 mt-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
                <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => changeDates(e.target.value, dateTo)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => changeDates(dateFrom, e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              {(dateFrom || dateTo) && (
                <button type="button" onClick={() => changeDates("", "")} className="btn text-xs px-3 py-1.5">
                  Clear dates
                </button>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Actor, action, or target…"
                    title="Searches the rows loaded so far"
                    className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
                  />
                </div>
              </div>
            </div>
            <button onClick={() => downloadXlsx(filteredRows, activeTab)} disabled={firstLoad || filteredRows.length === 0} className="btn text-sm px-3 shrink-0 flex items-center gap-1.5 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Download XLSX
            </button>
          </div>
        </div>

        <div className="flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t === "all" ? "ALL" : DEPARTMENT_LABEL[t]}
              {tabCount(t) && <span className="ml-1.5 text-[10px] text-muted-foreground">({tabCount(t)})</span>}
            </button>
          ))}
        </div>

        {current?.error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{current.error}</div>}

        {firstLoad ? (
          <div className="panel p-8">
            <BrandedLoader label="Loading activity log…" />
          </div>
        ) : (
          <div className="panel p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">When</th>
                    {activeTab === "all" && <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Department</th>}
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Actor</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Action</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={activeTab === "all" ? 5 : 4} className="px-3 py-8 text-center text-muted-foreground">{search.trim() ? "No loaded activity matches the search." : "No activity."}</td></tr>
                  ) : filteredRows.map((r) => (
                    <tr key={r.id} className={`border-b border-white/5 ${r.alert ? "bg-rose-500/10 hover:bg-rose-500/15" : "hover:bg-white/5"}`}>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.when).toLocaleString()}</td>
                      {activeTab === "all" && (
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] uppercase tracking-wide">{DEPARTMENT_LABEL[r.department]}</span>
                        </td>
                      )}
                      <td className="px-3 py-2 font-medium">{r.actorName}</td>
                      <td className={`px-3 py-2 ${r.alert ? "text-rose-200" : ""}`}>
                        {r.alert && (
                          <span className="mr-1.5 inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-200">
                            <ShieldAlert className="h-3 w-3" /> Alert
                          </span>
                        )}
                        {r.action}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.targetLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-3 py-3 text-xs text-muted-foreground">
              <span>
                {search.trim() ? `${filteredRows.length.toLocaleString()} of ${tabRows.length.toLocaleString()} loaded` : `${tabRows.length.toLocaleString()} loaded`}
                {tabRows.length > 0 && ` · back to ${new Date(tabRows[tabRows.length - 1].when).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
              </span>
              {current?.next ? (
                <button
                  type="button"
                  onClick={() => void loadPage(activeTab, false)}
                  disabled={current.loading}
                  className="btn text-xs px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {current.loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {current.loading ? "Loading…" : `Load ${PAGE_SIZE} more`}
                </button>
              ) : (
                <span>{dateFrom || dateTo ? "That's everything in these dates." : "That's everything."}</span>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
