/**
 * Accounting → Daily Mileage (migration 0451): the miles each technician
 * drove, one cell per technician per day of a pay period, typed or pasted
 * straight from Finance's workbook (a copied block fills the cells from the
 * one it's pasted into). Each row totals the miles, prices them at the Car
 * IQ rate in effect each day (Car IQ history + the company's rate history,
 * same as payroll) and counts the >200 / >300 / >400 mile days.
 *
 * The Mileage tab's entries come from ticket routes and run several times
 * higher than what's paid, so they aren't used here. This page is the
 * record only for now — payroll still reads its own mileage lines.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, Route } from "lucide-react";
import { DailyMileageImportModal } from "@/components/DailyMileageImportModal";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";
import { getCompanyUsersLite, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyCarIqHistory, carIqEntryEffectiveOn, type CarIqHistoryEntry } from "@/lib/supabase/carIqHistory";
import { getCarIqMileageRateHistory, carIqRatesOn, type CarIqMileageRateEntry } from "@/lib/supabase/companySettings";
import { CAR_IQ_MILEAGE_RATE_WITH, CAR_IQ_MILEAGE_RATE_WITHOUT, hasAnyTechnicianPayRole } from "@/lib/roleLabels";
import { listPayPeriods, payPeriodContaining, type PayPeriod } from "@/lib/payPeriods";
import { isPhBranch } from "@/lib/staffFormChecklist";
import { addDaysISO, todayISO } from "@/lib/localDate";
import { parseMiles, parsePastedBlock, priceMiles, thresholdCounts, type DayPricing } from "@/lib/dailyMileage";
import {
  getCarIqFlags,
  getTechDailyMileage,
  isTechDailyMileageMissing,
  saveTechDailyMileage,
  type MileageCellChange,
  type TechDailyMileage,
} from "@/lib/supabase/techDailyMileage";

type Props = { mod: ModuleDef; sub: SubModuleDef };
type CarIqFilter = "all" | "with" | "without" | "unset";
type RangeMode = "period" | "month" | "custom";

/** Custom dates are capped at this many days so the grid stays usable. */
const MAX_DAYS = 62;
/** "2026-11" → its first and last day. */
function monthRange(ym: string): PayPeriod {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}
/** "2026-11" + n months. */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const cellKey = (profileId: string, date: string) => `${profileId}|${date}`;
const fmtMiles = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRate = (n: number) => `$${n.toFixed(2)}`;
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const periodLabel = (p: PayPeriod) => `${fmtDay(p.start)} – ${fmtDay(p.end)}, ${p.end.slice(0, 4)}`;

/** A long day's shade: >200 amber, >300 orange, >400 red. */
const bandClass = (m: number) =>
  m > 400 ? "bg-red-500/20 text-red-200" : m > 300 ? "bg-orange-500/20 text-orange-200" : m > 200 ? "bg-amber-500/15 text-amber-200" : "";

function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(q).join(",")).join("\n");
  const el = document.createElement("a");
  el.href = "data:text/csv;charset=utf-8," + encodeURIComponent(String.fromCharCode(0xfeff) + csv);
  el.download = name;
  el.style.display = "none";
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
}

export function DailyMileagePage({ mod, sub }: Props) {
  const { uid } = useAuth();
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const periods = useMemo(() => listPayPeriods(), []);
  const [period, setPeriod] = useState<PayPeriod>(() => periods[0] ?? payPeriodContaining(todayISO()));
  /** Pay period (payroll), a calendar month (the branch sheet), or any dates. */
  const [mode, setMode] = useState<RangeMode>("period");
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [customFrom, setCustomFrom] = useState(() => `${todayISO().slice(0, 7)}-01`);
  const [customTo, setCustomTo] = useState(() => todayISO());
  const range: PayPeriod = useMemo(() => {
    if (mode === "month") return monthRange(month);
    if (mode === "custom") {
      const from = customFrom && customTo && customFrom > customTo ? customTo : customFrom;
      const to = customFrom && customTo && customFrom > customTo ? customFrom : customTo;
      // Capped so the grid stays usable — longer spans go month by month.
      return { start: from, end: to && from && to > addDaysISO(from, MAX_DAYS - 1) ? addDaysISO(from, MAX_DAYS - 1) : to };
    }
    return period;
  }, [mode, month, customFrom, customTo, period]);
  const validRange = !!range.start && !!range.end && range.start <= range.end;
  const days = useMemo(() => {
    if (!validRange) return [];
    const out: string[] = [];
    for (let d = range.start; d <= range.end; d = addDaysISO(d, 1)) out.push(d);
    return out;
  }, [range, validRange]);
  const capped = mode === "custom" && !!customFrom && !!customTo && range.end !== (customFrom > customTo ? customFrom : customTo);

  const [people, setPeople] = useState<ProfileRow[]>([]);
  const [carIqHistory, setCarIqHistory] = useState<CarIqHistoryEntry[]>([]);
  const [rateHistory, setRateHistory] = useState<CarIqMileageRateEntry[]>([]);
  const [carIqFlags, setCarIqFlags] = useState<Map<string, boolean>>(new Map());
  const [saved, setSaved] = useState<Map<string, TechDailyMileage>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** What's typed in a cell and not yet saved, by cell. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(0);

  const [branch, setBranch] = useState("");
  const [carIq, setCarIq] = useState<CarIqFilter>("all");
  const [search, setSearch] = useState("");
  const [onlyWithMiles, setOnlyWithMiles] = useState(false);
  const [importing, setImporting] = useState(false);

  // People, Car IQ status and rates don't change with the period — loaded once.
  useEffect(() => {
    if (!uid) return;
    Promise.all([
      getCompanyUsersLite(),
      getCompanyCarIqHistory(),
      getCarIqMileageRateHistory({ with: CAR_IQ_MILEAGE_RATE_WITH, without: CAR_IQ_MILEAGE_RATE_WITHOUT }),
      getCarIqFlags().catch(() => new Map<string, boolean>()),
    ])
      .then(([users, history, rates, flags]) => {
        setPeople(users);
        setCarIqHistory(history);
        setRateHistory(rates);
        setCarIqFlags(flags);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [uid]);

  const loadPeriod = useCallback(async () => {
    if (!validRange) { setSaved(new Map()); setLoading(false); return; }
    setLoading(true);
    setError(null);
    setDrafts({});
    try {
      const rows = await getTechDailyMileage(range.start, range.end);
      setSaved(new Map(rows.map((r) => [cellKey(r.profileId, r.workDate), r])));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(isTechDailyMileageMissing(msg) ? "Daily Mileage isn't set up in the database yet — run migration 0451_tech_daily_mileage.sql in Supabase, then reload." : msg);
      setSaved(new Map());
    } finally {
      setLoading(false);
    }
  }, [range, validRange]);
  useEffect(() => { void loadPeriod(); }, [loadPeriod]);

  /** Car IQ status and rate for a technician's day — their Car IQ history, else their current flag. */
  const pricingFor = useCallback(
    (profileId: string) => (date: string): DayPricing => {
      const status = carIqEntryEffectiveOn(carIqHistory, profileId, date)?.hasCarIq ?? carIqFlags.get(profileId) ?? null;
      if (status == null || rateHistory.length === 0) return { hasCarIq: status, rate: null };
      const r = carIqRatesOn(rateHistory, date);
      return { hasCarIq: status, rate: status ? r.with : r.without };
    },
    [carIqHistory, carIqFlags, rateHistory],
  );

  // Technicians (any technician pay role, main or extra) who are active, plus
  // anyone — e.g. since deactivated — who already has miles in this period.
  // PH staff are left out like payroll leaves them out (getsTechPortion):
  // there are no PH field technicians, so a technician-tier extra role there
  // is an access grant (Alyssa Diones: Parts Manager + Branch Manager).
  const techs = useMemo(() => {
    const withMiles = new Set([...saved.values()].map((r) => r.profileId));
    return people
      .filter((p) => (p.is_active !== false && !isPhBranch(p) && hasAnyTechnicianPayRole(p.role, p.extra_roles)) || withMiles.has(p.id))
      .map((p) => ({ id: p.id, name: p.display_name || p.email || "—", branch: p.assigned_branch || "", active: p.is_active !== false }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, saved]);

  const branches = useMemo(() => Array.from(new Set(techs.map((t) => t.branch).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [techs]);
  const currentStatus = (id: string) => pricingFor(id)(range.end || todayISO()).hasCarIq;
  const rangeLabel = !validRange
    ? "Pick the dates"
    : mode === "month" ? monthName(month) : `${fmtDay(range.start)} – ${fmtDay(range.end)}, ${range.end.slice(0, 4)}`;
  /** A week line before each Sunday, except at the first column. */
  const weekEdge = (i: number) => (i > 0 && weekday(days[i]) === "Sun" ? "border-l border-white/20" : "");

  const milesOf = (id: string, date: string) => saved.get(cellKey(id, date))?.miles ?? null;
  const rowHasMiles = (id: string) => days.some((d) => milesOf(id, d) != null);

  const rows = techs.filter((t) => {
    if (branch && t.branch !== branch) return false;
    const s = currentStatus(t.id);
    if (carIq === "with" && s !== true) return false;
    if (carIq === "without" && s !== false) return false;
    if (carIq === "unset" && s != null) return false;
    if (search.trim() && !`${t.name} ${t.branch}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (onlyWithMiles && !rowHasMiles(t.id)) return false;
    return true;
  });

  const rowSummary = (id: string) => {
    const list = days.map((d) => ({ date: d, miles: milesOf(id, d) })).filter((x): x is { date: string; miles: number } => x.miles != null);
    return { ...priceMiles(list, pricingFor(id)), ...thresholdCounts(list.map((x) => x.miles)) };
  };

  /** Saves a batch of cells; the grid shows the new values right away and rolls back on failure. */
  const commit = async (changes: MileageCellChange[]) => {
    const real = changes.filter((c) => {
      const before = saved.get(cellKey(c.profileId, c.workDate))?.miles ?? null;
      return before !== c.miles;
    });
    const keys = changes.map((c) => cellKey(c.profileId, c.workDate));
    setDrafts((prev) => { const next = { ...prev }; for (const k of keys) delete next[k]; return next; });
    if (!real.length) return;
    setSaving((n) => n + 1);
    try {
      const { saved: rowsSaved, deletedIds } = await saveTechDailyMileage(real);
      setSaved((prev) => {
        const next = new Map(prev);
        for (const [k, v] of next) if (deletedIds.includes(v.id)) next.delete(k);
        for (const r of rowsSaved) next.set(cellKey(r.profileId, r.workDate), r);
        return next;
      });
      if (real.length > 1) toast.success(`Saved ${real.length} days.`);
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      void loadPeriod();
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const commitCell = (id: string, date: string) => {
    const k = cellKey(id, date);
    if (!(k in drafts)) return;
    const miles = parseMiles(drafts[k]);
    if (Number.isNaN(miles)) {
      toast.error(`"${drafts[k]}" isn't a number of miles.`);
      setDrafts((prev) => { const next = { ...prev }; delete next[k]; return next; });
      return;
    }
    void commit([{ profileId: id, workDate: date, miles, existingId: saved.get(k)?.id ?? null }]);
  };

  /** A block copied from Excel fills the cells to the right and below the one it's pasted into. */
  const pasteBlock = (rowIndex: number, dayIndex: number, text: string) => {
    const block = parsePastedBlock(text);
    const changes: MileageCellChange[] = [];
    let skipped = 0;
    block.forEach((cells, r) => {
      const t = rows[rowIndex + r];
      if (!t) { skipped += cells.length; return; }
      cells.forEach((raw, c) => {
        const date = days[dayIndex + c];
        if (!date) { skipped++; return; }
        const miles = parseMiles(raw);
        if (Number.isNaN(miles)) { skipped++; return; }
        changes.push({ profileId: t.id, workDate: date, miles, existingId: saved.get(cellKey(t.id, date))?.id ?? null });
      });
    });
    if (skipped) toast.message(`${skipped} pasted cell${skipped === 1 ? "" : "s"} skipped (past the last row or day, or not a number).`);
    void commit(changes);
  };

  /** Arrow keys and Enter move between cells like a spreadsheet. */
  const move = (rowIndex: number, dayIndex: number, dr: number, dc: number) => {
    const el = document.querySelector<HTMLInputElement>(`input[data-mile-cell="${rowIndex + dr}:${dayIndex + dc}"]`);
    if (el) { el.focus(); el.select(); }
  };

  const totals = useMemo(() => {
    const perDay = days.map((d) => rows.reduce((s, t) => s + (milesOf(t.id, d) ?? 0), 0));
    let miles = 0, pay = 0, unpriced = 0, over200 = 0, over300 = 0, over400 = 0;
    for (const t of rows) {
      const s = rowSummary(t.id);
      miles += s.miles; pay += s.pay; unpriced += s.unpricedMiles; over200 += s.over200; over300 += s.over300; over400 += s.over400;
    }
    return { perDay, miles, pay, unpriced, over200, over300, over400 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, saved, days, pricingFor]);

  const exportCsv = () =>
    downloadCsv(
      `daily-mileage_${range.start}_to_${range.end}.csv`,
      ["Technician", "Branch", "Car IQ", ...days.map((d) => `${weekday(d)} ${d}`), "Miles", "Rate", "Pay", ">200 days", ">300 days", ">400 days"],
      rows.map((t) => {
        const s = rowSummary(t.id);
        const status = currentStatus(t.id);
        return [
          t.name, t.branch, status == null ? "Not set" : status ? "Yes" : "No",
          ...days.map((d) => milesOf(t.id, d) ?? ""),
          s.miles, s.rates.map(fmtRate).join(" / "), s.pay.toFixed(2), s.over200, s.over300, s.over400,
        ];
      }),
    );

  /** The grid's own scroll box — the floating sideways bar follows it. */
  const gridRef = useRef<HTMLDivElement>(null);
  const periodIndex = periods.findIndex((p) => p.start === period.start);
  const control = "rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none";

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1800px] mx-auto px-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-white">
          <button onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        {/* Dates + filters */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-4 py-3">
          <div className="flex gap-1" role="group" aria-label="Date range">
            {([["period", "Pay period"], ["month", "Month"], ["custom", "Custom dates"]] as const).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                aria-pressed={mode === k}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${mode === k ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {mode === "period" && (
            <>
              <button
                type="button"
                onClick={() => periods[periodIndex + 1] && setPeriod(periods[periodIndex + 1])}
                disabled={periodIndex < 0 || periodIndex >= periods.length - 1}
                aria-label="Previous pay period"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <select
                value={period.start}
                onChange={(e) => { const p = periods.find((x) => x.start === e.target.value); if (p) setPeriod(p); }}
                aria-label="Pay period"
                className={`${control} min-w-[12rem] font-semibold`}
              >
                {periods.map((p) => <option key={p.start} value={p.start}>{periodLabel(p)}</option>)}
              </select>
              <button
                type="button"
                onClick={() => periodIndex > 0 && setPeriod(periods[periodIndex - 1])}
                disabled={periodIndex <= 0}
                aria-label="Next pay period"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          {mode === "month" && (
            <>
              <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" className={`${control} font-semibold [color-scheme:dark]`} />
              <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700">
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          {mode === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" className={`${control} [color-scheme:dark]`} />
              <span className="text-xs text-slate-500">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" className={`${control} [color-scheme:dark]`} />
              {capped && <span className="text-xs text-amber-300">Showing the first {MAX_DAYS} days</span>}
            </>
          )}
          <span className="mx-1 h-6 w-px bg-white/10" aria-hidden />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch" className={control}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={carIq} onChange={(e) => setCarIq(e.target.value as CarIqFilter)} aria-label="Car IQ" className={control}>
            <option value="all">Car IQ: everyone</option>
            <option value="with">With Car IQ</option>
            <option value="without">Without Car IQ</option>
            <option value="unset">Car IQ not set</option>
          </select>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search technician…" aria-label="Search technician" className={`${control} min-w-[200px]`} />
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
            <input type="checkbox" checked={onlyWithMiles} onChange={(e) => setOnlyWithMiles(e.target.checked)} /> Only with miles
          </label>
          <span className="ml-auto inline-flex items-center gap-3">
            {saving > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>}
            <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Import
            </button>
            <button type="button" onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </span>
        </div>

        {/* Period totals */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Miles", value: fmtMiles(totals.miles), sub: `${rows.filter((t) => rowHasMiles(t.id)).length} of ${rows.length} technicians entered` },
            { label: "Mileage pay", value: fmtMoney(totals.pay), sub: totals.unpriced > 0 ? `${fmtMiles(totals.unpriced)} mi not priced — Car IQ status not set` : "At each day's Car IQ rate" },
            { label: "Long days", value: `${totals.over200} · ${totals.over300} · ${totals.over400}`, sub: "Days over 200 · 300 · 400 miles" },
            { label: mode === "period" ? "Pay period" : mode === "month" ? "Month" : "Dates", value: rangeLabel, sub: validRange ? `${days.length} days${mode === "period" ? ", Sunday to Saturday" : ""}` : "From and To are needed" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-white">{loading ? "…" : c.value}</p>
              <p className={`mt-0.5 truncate text-xs ${c.label === "Mileage pay" && totals.unpriced > 0 ? "text-amber-300" : "text-slate-500"}`} title={c.sub}>{c.sub}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400">
          Type the miles for each day, or copy a block from the workbook and paste it into the first cell — it fills to the right and down. Enter or the arrow keys move between cells; clear a cell to remove the day.
          Shaded days are over <span className="rounded bg-amber-500/15 px-1 text-amber-200">200</span>, <span className="rounded bg-orange-500/20 px-1 text-orange-200">300</span> or <span className="rounded bg-red-500/20 px-1 text-red-200">400</span> miles.
        </p>

        {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        {/* Its own scroll box, as tall as the screen allows: the dates stay on top and the names on the left while scrolling. */}
        <div ref={gridRef} className="max-h-[calc(100vh-7rem)] max-w-full overflow-auto rounded-lg border border-white/10 bg-slate-900/50">
          {loading ? (
            <div className="p-4"><TableSkeleton rows={8} cols={10} /></div>
          ) : !validRange ? (
            <EmptyState icon={<Route />} title="Pick the From and To dates." />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Route />} title="No technicians match these filters." hint="Clear the branch, Car IQ or search filters to see everyone." />
          ) : (
            <table className="w-full min-w-max text-xs tabular-nums">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-semibold uppercase text-slate-400">
                  <th className="sticky left-0 top-0 z-30 bg-slate-900 px-3 py-2 text-left">Technician</th>
                  {days.map((d, i) => (
                    <th key={d} className={`sticky top-0 z-20 bg-slate-900 px-1 py-2 text-center ${weekEdge(i)} ${weekday(d) === "Sun" || weekday(d) === "Sat" ? "text-slate-500" : ""}`}>
                      <div>{weekday(d)}</div>
                      <div className="font-normal normal-case text-slate-300">{fmtDay(d)}</div>
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-slate-900 border-l border-white/20 px-2 py-2 text-right">Miles</th>
                  <th className="sticky top-0 z-20 bg-slate-900 px-2 py-2 text-right">Rate</th>
                  <th className="sticky top-0 z-20 bg-slate-900 px-2 py-2 text-right">Pay</th>
                  <th className="sticky top-0 z-20 bg-slate-900 px-2 py-2 text-right" title="Days over 200 miles">&gt;200</th>
                  <th className="sticky top-0 z-20 bg-slate-900 px-2 py-2 text-right" title="Days over 300 miles">&gt;300</th>
                  <th className="sticky top-0 z-20 bg-slate-900 px-2 py-2 text-right" title="Days over 400 miles">&gt;400</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, r) => {
                  const s = rowSummary(t.id);
                  const status = currentStatus(t.id);
                  return (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="sticky left-0 z-10 bg-slate-900 px-3 py-1">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="font-medium text-white">{t.name}</span>
                          {!t.active && <span className="rounded bg-slate-700 px-1 text-[9px] font-semibold uppercase text-slate-300">Inactive</span>}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                          <span>{t.branch || "No branch"}</span>
                          <span className={status == null ? "text-amber-300" : status ? "text-sky-300" : "text-slate-400"}>
                            · {status == null ? "Car IQ not set" : status ? "Car IQ" : "No Car IQ"}
                          </span>
                        </div>
                      </td>
                      {days.map((d, c) => {
                        const k = cellKey(t.id, d);
                        const m = milesOf(t.id, d);
                        const value = k in drafts ? drafts[k] : m == null ? "" : String(m);
                        return (
                          <td key={d} className={`px-0.5 py-0.5 ${weekEdge(c)}`}>
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              data-mile-cell={`${r}:${c}`}
                              value={value}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={() => commitCell(t.id, d)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); move(r, c, 1, 0); }
                                else if (e.key === "ArrowUp") { e.preventDefault(); move(r, c, -1, 0); }
                                else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) { e.preventDefault(); move(r, c, 0, 1); }
                                else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) { e.preventDefault(); move(r, c, 0, -1); }
                                else if (e.key === "Escape") { setDrafts((prev) => { const next = { ...prev }; delete next[k]; return next; }); e.currentTarget.blur(); }
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
                                e.preventDefault();
                                pasteBlock(r, c, text);
                              }}
                              aria-label={`${t.name} miles on ${fmtDay(d)}`}
                              title={saved.get(k)?.updatedByName ? `Saved by ${saved.get(k)!.updatedByName}` : undefined}
                              className={`h-7 w-[3.6rem] rounded border border-transparent bg-transparent px-1 text-right text-slate-100 placeholder-slate-700 hover:border-white/10 focus:border-blue-500 focus:bg-slate-800 focus:outline-none ${m != null && !(k in drafts) ? bandClass(m) : ""}`}
                              placeholder="—"
                            />
                          </td>
                        );
                      })}
                      <td className="border-l border-white/20 px-2 py-1 text-right font-semibold text-white">{s.miles ? fmtMiles(s.miles) : "—"}</td>
                      <td className="px-2 py-1 text-right text-slate-300">{s.rates.length ? s.rates.map(fmtRate).join(" / ") : status == null ? <span className="text-amber-300">not set</span> : "—"}</td>
                      <td className="px-2 py-1 text-right font-semibold text-emerald-300">
                        {s.pay ? fmtMoney(s.pay) : "—"}
                        {s.unpricedMiles > 0 && <div className="text-[10px] font-normal text-amber-300">{fmtMiles(s.unpricedMiles)} mi not priced</div>}
                      </td>
                      <td className="px-2 py-1 text-right text-amber-200">{s.over200 || "—"}</td>
                      <td className="px-2 py-1 text-right text-orange-200">{s.over300 || "—"}</td>
                      <td className="px-2 py-1 text-right text-red-200">{s.over400 || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-slate-200 [&>td]:sticky [&>td]:bottom-0 [&>td]:z-20 [&>td]:border-t-2 [&>td]:border-white/20 [&>td]:bg-slate-900 [&>td:first-child]:z-30">
                  <td className="left-0 px-3 py-2 text-xs uppercase">Total · {rows.length} technician{rows.length === 1 ? "" : "s"}</td>
                  {totals.perDay.map((m, i) => (
                    <td key={days[i]} className={`px-1 py-2 text-right ${weekEdge(i)}`}>{m ? fmtMiles(m) : ""}</td>
                  ))}
                  <td className="border-l border-white/20 px-2 py-2 text-right text-white">{fmtMiles(totals.miles)}</td>
                  <td />
                  <td className="px-2 py-2 text-right text-emerald-300">{fmtMoney(totals.pay)}</td>
                  <td className="px-2 py-2 text-right">{totals.over200}</td>
                  <td className="px-2 py-2 text-right">{totals.over300}</td>
                  <td className="px-2 py-2 text-right">{totals.over400}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        <FloatingHorizontalScrollbar targetRef={gridRef} />
        {importing && (
          <DailyMileageImportModal
            // Anyone a sheet name could be: technicians outside the Philippines, active or not.
            technicians={people
              .filter((p) => !isPhBranch(p) && hasAnyTechnicianPayRole(p.role, p.extra_roles))
              .map((p) => ({ id: p.id, name: p.display_name || p.email || "—", branch: p.assigned_branch || "", active: p.is_active !== false }))}
            monthHint={(range.start || todayISO()).slice(0, 7)}
            onClose={() => setImporting(false)}
            onSaved={(n) => { setImporting(false); toast.success(n ? `Imported ${n} day${n === 1 ? "" : "s"}.` : "Nothing new — every day in the file was already saved."); void loadPeriod(); }}
          />
        )}
      </div>
    </main>
  );
}
