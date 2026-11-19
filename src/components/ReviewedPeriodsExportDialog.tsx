/**
 * Reviewed Periods → Download Excel: pick the pay periods and the
 * technicians, then one list (a row per person per period, grouped by
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
  const [periodKeys, setPeriodKeys] = useState<Set<string>>(() => new Set(current ? [current.key] : periodOptions[0] ? [periodOptions[0].key] : []));
  const [loaded, setLoaded] = useState<Map<string, ReviewedExportEntry[]>>(() => new Map(current ? [[current.key, current.entries]] : []));
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    const out = new Set<string>();
    for (const e of current?.entries ?? []) if (!defaultIncluded.has(e.profileId)) out.add(e.profileId);
    return out;
  });
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<ReviewedExportLayout>("list");
  const [full, setFull] = useState(initialFull);
  const [busy, setBusy] = useState(false);

  // Load each newly picked period once.
  useEffect(() => {
    for (const key of periodKeys) {
      if (loaded.has(key) || loadingKeys.has(key)) continue;
      const [start, end] = key.split("|");
      setLoadingKeys((s) => new Set(s).add(key));
      void loadSavedEntries(start, end, nameFallback)
        .then((entries) => setLoaded((m) => new Map(m).set(key, entries)))
        .catch((err) => toast.error(`${formatISODate(start)} – ${formatISODate(end)}: ${err instanceof Error ? err.message : "couldn't load"}`))
        .finally(() => setLoadingKeys((s) => { const n = new Set(s); n.delete(key); return n; }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKeys]);

  const entries = useMemo(() => [...periodKeys].flatMap((k) => loaded.get(k) ?? []), [periodKeys, loaded]);
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; branch: string; periods: number }>();
    for (const e of entries) {
      const p = m.get(e.profileId);
      if (p) p.periods += 1;
      else m.set(e.profileId, { id: e.profileId, name: e.name, branch: e.branch, periods: 1 });
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);
  const q = search.trim().toLowerCase();
  const shownPeople = people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.branch.toLowerCase().includes(q));
  const chosen = entries.filter((e) => !excluded.has(e.profileId));
  const chosenPeople = people.filter((p) => !excluded.has(p.id)).length;
  const loading = loadingKeys.size > 0;

  const togglePeriod = (key: string) => setPeriodKeys((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const togglePerson = (id: string) => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setShown = (include: boolean) => setExcluded((s) => {
    const n = new Set(s);
    for (const p of shownPeople) { if (include) n.delete(p.id); else n.add(p.id); }
    return n;
  });

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/15 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <p className="font-semibold text-white">Download Excel</p>
            <p className="text-xs text-slate-400">Pick the pay periods and technicians to include.</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white/80" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[220px_1fr]">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pay periods</p>
              <button type="button" onClick={() => setPeriodKeys(new Set(periodOptions.filter((o) => o.count > 0 || o.key === current?.key).map((o) => o.key)))} className="text-[11px] text-blue-300 hover:underline">All</button>
            </div>
            <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border border-white/10 p-2">
              {periodOptions.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-200 hover:bg-white/5">
                  <input type="checkbox" checked={periodKeys.has(o.key)} onChange={() => togglePeriod(o.key)} />
                  <span className="flex-1">{formatISODate(o.start)} – {formatISODate(o.end)}</span>
                  {loadingKeys.has(o.key) ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : <span className="text-[10px] text-slate-500">{o.key === current?.key ? "open" : o.count || ""}</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Technicians ({chosenPeople} of {people.length})</p>
              <button type="button" onClick={() => setShown(true)} className="text-[11px] text-blue-300 hover:underline">Select all</button>
              <button type="button" onClick={() => setShown(false)} className="text-[11px] text-blue-300 hover:underline">Clear</button>
              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or branch" className="glass-input w-48 rounded-md py-1 pl-7 pr-2 text-xs" />
              </div>
            </div>
            <div className="max-h-[50vh] flex-1 overflow-y-auto rounded-md border border-white/10 p-2">
              {people.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-slate-500">{loading ? "Loading…" : "Pick a pay period."}</p>
              ) : (
                <div className="grid gap-x-3 sm:grid-cols-2">
                  {shownPeople.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-200 hover:bg-white/5">
                      <input type="checkbox" checked={!excluded.has(p.id)} onChange={() => togglePerson(p.id)} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {periodKeys.size > 1 && <span className="shrink-0 text-[10px] text-slate-500">{p.periods}/{periodKeys.size}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
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
