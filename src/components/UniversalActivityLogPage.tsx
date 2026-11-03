/**
 * Universal Activity Log — one combined feed across every department
 * (Claims/Parts/CSR/Triage/BizOps/Technician/HR/Accounting/IT/Admin), plus
 * an ALL tab merging everything. See src/lib/supabase/universalActivityLog.ts
 * for how each department's rows are actually sourced — this page is just
 * the filter bar + table over that already-normalized feed, it does no
 * data-shaping of its own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import * as XLSX from "xlsx";
import { ChevronLeft, Loader2, Download, Search, ShieldAlert } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import {
  getUniversalActivityLog,
  DEPARTMENT_LABEL,
  DEPARTMENT_ORDER,
  type ActivityDepartment,
  type UniversalActivityEntry,
} from "@/lib/supabase/universalActivityLog";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { localISODate, todayISO } from "@/lib/localDate";

type TabKey = "all" | ActivityDepartment;
const TABS: TabKey[] = ["all", ...DEPARTMENT_ORDER];

const todayIso = () => todayISO();
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISODate(d); };
const shiftIso = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return localISODate(d); };
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Opens on the last two weeks; "Load 2 more weeks" reads the two weeks
// before the oldest day shown and adds them below. The table draws rows a
// page at a time — two weeks can hold 20,000+ ticket status changes.
const LOAD_DAYS = 14;
const ROWS_PER_PAGE = 300;

function downloadXlsx(rows: UniversalActivityEntry[], dateFrom: string, dateTo: string) {
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
  XLSX.writeFile(workbook, `universal-activity-log_${dateFrom}_to_${dateTo}.xlsx`);
}

export function UniversalActivityLogPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [activeTab, setActiveTab] = usePersistedTab<TabKey>("ahs:universal-activity-log-tab", TABS, "all");

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<UniversalActivityEntry[]>([]);
  const [dateFrom, setDateFrom] = useState(daysAgoIso(LOAD_DAYS - 1));
  const [dateTo, setDateTo] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [shownRows, setShownRows] = useState(ROWS_PER_PAGE);
  // Bumped by every full load, so a slower earlier load (or a Load more
  // started before it) can't overwrite what the newer one shows.
  const loadSeq = useRef(0);

  const loadRange = async (from: string, to: string) => {
    if (!from || !to) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setShownRows(ROWS_PER_PAGE);
    try {
      const rows = await getUniversalActivityLog({ startDate: from, endDate: to });
      if (seq === loadSeq.current) setEntries(rows);
    } catch (err) {
      if (seq === loadSeq.current) setError(err instanceof Error ? err.message : "Failed to load activity log.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadRange(dateFrom, dateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeDateFrom = (v: string) => { setDateFrom(v); void loadRange(v, dateTo); };
  const changeDateTo = (v: string) => { setDateTo(v); void loadRange(dateFrom, v); };

  // The two weeks before the oldest day shown, added below what's loaded.
  const olderTo = dateFrom ? shiftIso(dateFrom, -1) : "";
  const olderFrom = dateFrom ? shiftIso(dateFrom, -LOAD_DAYS) : "";
  const loadOlder = async () => {
    if (!olderFrom || loadingMore) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    setError(null);
    try {
      const rows = await getUniversalActivityLog({ startDate: olderFrom, endDate: olderTo });
      if (seq !== loadSeq.current) return;
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))].sort((a, b) => b.when.localeCompare(a.when));
      });
      setDateFrom(olderFrom);
    } catch (err) {
      if (seq === loadSeq.current) setError(err instanceof Error ? err.message : "Failed to load older activity.");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { setShownRows(ROWS_PER_PAGE); }, [activeTab, search]);

  const countByTab = useMemo(() => {
    const counts = new Map<TabKey, number>();
    for (const e of entries) counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
    counts.set("all", entries.length);
    return counts;
  }, [entries]);

  const tabRows = useMemo(
    () => (activeTab === "all" ? entries : entries.filter((e) => e.department === activeTab)),
    [entries, activeTab]
  );

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

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Every department's activity in one feed — the last 2 weeks; load older weeks at the bottom. Pick a department or view ALL.</p>
          </div>
        </div>

        <div className="panel mb-6 mt-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
                <input type="date" value={dateFrom} onChange={(e) => changeDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
                <input type="date" value={dateTo} onChange={(e) => changeDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Actor, action, or target…"
                    className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
                  />
                </div>
              </div>
            </div>
            <button onClick={() => downloadXlsx(filteredRows, dateFrom, dateTo)} disabled={loading || filteredRows.length === 0} className="btn text-sm px-3 shrink-0 flex items-center gap-1.5 disabled:opacity-50">
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
              <span className="ml-1.5 text-[10px] text-muted-foreground">({countByTab.get(t) ?? 0})</span>
            </button>
          ))}
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
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
                    <tr><td colSpan={activeTab === "all" ? 5 : 4} className="px-3 py-8 text-center text-muted-foreground">No activity in this range.</td></tr>
                  ) : filteredRows.slice(0, shownRows).map((r) => (
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
                Showing {Math.min(shownRows, filteredRows.length).toLocaleString()} of {filteredRows.length.toLocaleString()}
                {dateFrom && dateTo ? ` · ${shortDate(dateFrom)} – ${shortDate(dateTo)}` : ""}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {filteredRows.length > shownRows && (
                  <button type="button" onClick={() => setShownRows((n) => n + ROWS_PER_PAGE)} className="btn text-xs px-3 py-1.5">
                    Show {Math.min(ROWS_PER_PAGE, filteredRows.length - shownRows).toLocaleString()} more
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingMore || !olderFrom}
                  title={olderFrom ? `Adds ${shortDate(olderFrom)} – ${shortDate(olderTo)}` : undefined}
                  className="btn text-xs px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {loadingMore ? "Loading…" : `Load 2 more weeks${olderFrom ? ` (${shortDate(olderFrom)} – ${shortDate(olderTo)})` : ""}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
