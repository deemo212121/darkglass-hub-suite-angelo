/**
 * Reviewed Periods → Download Excel: pick technicians per pay period (each
 * period keeps its own picks), then one list (a row per person per period, grouped by
 * name) or one tab per technician (a row per period).
 *
 * The period currently open on the tab exports exactly what the tab shows
 * (live actual gross, itemized from the live report). Any other period
 * exports its saved Reviewed Periods rows: gross = the saved columns, taxes
 * from that period's tax lines, bonuses / reimbursements / deductions
 * itemized from that period's custom lines (built-in mileage is what's left
 * of the reimbursement column).
 */
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { formatISODate } from "@/lib/localDate";
import { getPayrollReviewBreakdowns, reviewBreakdownTotal, type PayrollReviewBreakdown } from "@/lib/supabase/payrollReviewBreakdowns";
import { getTechTaxLinesForPeriod, taxLineAmount } from "@/lib/supabase/techTaxLines";
import { getAllTechCustomPayItemsForPeriod } from "@/lib/supabase/techPayroll";
import { reviewedPeriodDetails } from "@/lib/reviewedPeriodDetails";
import { downloadReviewedPeriodsWorkbook, type ReviewedExportEntry, type ReviewedExportLayout } from "@/lib/reviewedPeriodsExcel";

const cents = (n: number) => Math.round(n * 100) / 100;

async function loadSavedEntries(start: string, end: string, nameFallback: Map<string, string>): Promise<ReviewedExportEntry[]> {
  const [rows, taxes, items] = await Promise.all([
    getPayrollReviewBreakdowns(start, end),
    getTechTaxLinesForPeriod(start, end),
    getAllTechCustomPayItemsForPeriod(start, end),
  ]);
  const itemsBy = new Map<string, typeof items>();
  for (const it of items) itemsBy.set(it.profileId, [...(itemsBy.get(it.profileId) ?? []), it]);
  return rows.map((r: PayrollReviewBreakdown) => {
    const mine = itemsBy.get(r.profileId) ?? [];
    const otherReimb = mine.filter((i) => !i.isWageIncludable && i.value * i.rate > 0).reduce((s, i) => s + i.value * i.rate, 0);
    const details = reviewedPeriodDetails(r, { mileage: Math.max(cents(r.mileageOtherReimb - otherReimb), 0), items: mine });
    const gross = cents(reviewBreakdownTotal(r));
    const tax = cents((taxes.get(r.profileId) ?? []).reduce((s, l) => s + taxLineAmount(l, gross), 0));
    return {
      profileId: r.profileId,
      name: r.technicianName || nameFallback.get(r.profileId) || "(unknown technician)",
      branch: r.branch ?? "",
      periodStart: start,
      periodEnd: end,
      amounts: r,
      details,
      notInColumns: null,
      gross,
      taxes: tax,
      net: cents(gross - tax),
    };
  });
}

export function ReviewedPeriodsExportDialog({
  periodOptions,
  current,
  defaultIncluded,
  nameFallback,
  fullBreakdown: initialFull,
  onClose,
}: {
  periodOptions: { key: string; start: string; end: string; count: number }[];
  /** The tab's open period and its live entries (exactly what the tab shows). */
  current: { key: string; entries: ReviewedExportEntry[] } | null;
  /** Profiles checked by default (the tab's visible rows). */
  defaultIncluded: Set<string>;
  nameFallback: Map<string, string>;
  fullBreakdown: boolean;
  onClose: () => void;
}) {
  // Picks are per pay period: each period keeps its own ticked technicians.
  const [picks, setPicks] = useState<Map<string, Set<string>>>(() => {
    if (!current) return new Map();
    return new Map([[current.key, new Set(current.entries.filter((e) => defaultIncluded.has(e.profileId)).map((e) => e.profileId))]]);
  });
  const [active, setActive] = useState<string>(() => current?.key ?? periodOptions[0]?.key ?? "");
  const [loaded, setLoaded] = useState<Map<string, ReviewedExportEntry[]>>(() => new Map(current ? [[current.key, current.entries]] : []));
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<ReviewedExportLayout>("list");
  const [full, setFull] = useState(initialFull);
  const [busy, setBusy] = useState(false);

  const ensureLoaded = async (key: string): Promise<ReviewedExportEntry[]> => {
    const have = loaded.get(key);
    if (have) return have;
    const [start, end] = key.split("|");
    setLoadingKeys((s) => new Set(s).add(key));
    try {
      const entries = await loadSavedEntries(start, end, nameFallback);
      setLoaded((m) => new Map(m).set(key, entries));
      return entries;
    } catch (err) {
      toast.error(`${formatISODate(start)} – ${formatISODate(end)}: ${err instanceof Error ? err.message : "couldn't load"}`);
      return [];
    } finally {
      setLoadingKeys((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  };
  useEffect(() => { if (active) void ensureLoaded(active); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active]);

  const activeEntries = useMemo(() => [...(loaded.get(active) ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [loaded, active]);
  const activePicks = picks.get(active) ?? new Set<string>();
  const q = search.trim().toLowerCase();
  const shown = activeEntries.filter((e) => !q || e.name.toLowerCase().includes(q) || e.branch.toLowerCase().includes(q));
  const chosen = useMemo(() => [...picks].flatMap(([key, ids]) => (loaded.get(key) ?? []).filter((e) => ids.has(e.profileId))), [picks, loaded]);
  const loading = loadingKeys.size > 0;

  const setPeriodPicks = (key: string, ids: Set<string>) => setPicks((m) => {
    const n = new Map(m);
    if (ids.size) n.set(key, ids); else n.delete(key);
    return n;
  });
  const togglePerson = (id: string) => {
    const n = new Set(activePicks);
    if (n.has(id)) n.delete(id); else n.add(id);
    setPeriodPicks(active, n);
  };
  const setShown = (include: boolean) => {
    const n = new Set(activePicks);
    for (const e of shown) { if (include) n.add(e.profileId); else n.delete(e.profileId); }
    setPeriodPicks(active, n);
  };
  /** Period checkbox: everyone in it, or no one. */
  const togglePeriodAll = async (key: string) => {
    if ((picks.get(key)?.size ?? 0) > 0) { setPeriodPicks(key, new Set()); return; }
    const entries = await ensureLoaded(key);
    setPeriodPicks(key, new Set(entries.map((e) => e.profileId)));
  };
  /** The same people (those ticked here) in every pay period they appear in. */
  const applyToAllPeriods = async () => {
    const ids = new Set(activePicks);
    if (!ids.size) return;
    const keys = periodOptions.filter((o) => o.count > 0 || o.key === current?.key).map((o) => o.key);
    const all = await Promise.all(keys.map(async (k) => [k, await ensureLoaded(k)] as const));
    setPicks(() => {
      const n = new Map<string, Set<string>>();
      for (const [k, entries] of all) {
        const mine = new Set(entries.filter((e) => ids.has(e.profileId)).map((e) => e.profileId));
        if (mine.size) n.set(k, mine);
      }
      return n;
    });
  };

  const download = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      await downloadReviewedPeriodsWorkbook(chosen, { layout, fullBreakdown: full });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the Excel file.");
    } finally {
      setBusy(false);
    }
  };
  const activeOption = periodOptions.find((o) => o.key === active);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/15 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <p className="font-semibold text-white">Download Excel</p>
            <p className="text-xs text-slate-400">Click a pay period to pick its technicians. Each period keeps its own picks.</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white/80" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[240px_1fr]">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pay periods</p>
            <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border border-white/10 p-1.5">
              {periodOptions.map((o) => {
                const count = picks.get(o.key)?.size ?? 0;
                const total = loaded.get(o.key)?.length ?? o.count;
                const isActive = o.key === active;
                return (
                  <div
                    key={o.key}
                    onClick={() => setActive(o.key)}
                    className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm ${isActive ? "bg-blue-600/25 text-white ring-1 ring-blue-500/50" : "text-slate-200 hover:bg-white/5"}`}
                  >
                    <input
                      type="checkbox"
                      checked={count > 0}
                      ref={(el) => { if (el) el.indeterminate = count > 0 && count < total; }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => void togglePeriodAll(o.key)}
                      title={count > 0 ? "Clear this period" : "Everyone in this period"}
                    />
                    <span className="flex-1 leading-tight">{formatISODate(o.start)} – {formatISODate(o.end)}</span>
                    {loadingKeys.has(o.key)
                      ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                      : <span className={`text-[10px] ${count ? "text-blue-300 font-semibold" : "text-slate-500"}`}>{count ? `${count} picked` : o.key === current?.key ? "open" : o.count || ""}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {activeOption ? `${formatISODate(activeOption.start)} – ${formatISODate(activeOption.end)}` : "Technicians"} ({activePicks.size} of {activeEntries.length})
              </p>
              <button type="button" onClick={() => setShown(true)} className="text-[11px] text-blue-300 hover:underline">Select all</button>
              <button type="button" onClick={() => setShown(false)} className="text-[11px] text-blue-300 hover:underline">Clear</button>
              <button
                type="button"
                onClick={() => void applyToAllPeriods()}
                disabled={!activePicks.size || loading}
                title="Pick these same people in every pay period they appear in (replaces the other periods' picks)"
                className="text-[11px] text-blue-300 hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Same people in all periods
              </button>
              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or branch" className="glass-input w-44 rounded-md py-1 pl-7 pr-2 text-xs" />
              </div>
            </div>
            <div className="max-h-[50vh] flex-1 overflow-y-auto rounded-md border border-white/10 p-2">
              {activeEntries.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-slate-500">{loadingKeys.has(active) ? "Loading…" : active ? "No reviewed rows in this period." : "Pick a pay period."}</p>
              ) : (
                <div className="grid gap-x-3 sm:grid-cols-2">
                  {shown.map((e) => (
                    <label key={e.profileId} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-200 hover:bg-white/5">
                      <input type="checkbox" checked={activePicks.has(e.profileId)} onChange={() => togglePerson(e.profileId)} />
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      <span className="shrink-0 truncate text-[10px] text-slate-500">{e.branch}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {chosen.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">
                In the file: {[...picks].map(([k, ids]) => { const o = periodOptions.find((p) => p.key === k); return o ? `${formatISODate(o.start)} – ${formatISODate(o.end)} (${ids.size})` : null; }).filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-white/10 px-5 py-3">
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Layout</span>
            <label className="flex items-center gap-1.5"><input type="radio" checked={layout === "list"} onChange={() => setLayout("list")} /> One list (name + period per row)</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={layout === "tabs"} onChange={() => setLayout("tabs")} /> One tab per technician</label>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-300"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Full breakdown</label>
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy || loading || chosen.length === 0}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download {chosen.length ? `(${chosen.length} row${chosen.length === 1 ? "" : "s"})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
