/**
 * Accounting → Daily Mileage (migrations 0451 + 0453): each technician's
 * trips, kept the way Finance's "Mileage Record Keeping" workbook keeps them
 * — total miles, excluded miles and why, vehicle, branch, ticket #, Mile Map
 * links, notes and an approval status — so a day's miles can be checked
 * before they're paid.
 *
 * Two views of the same trips:
 *   Grid  — technicians down, days across; each cell is the day's eligible
 *           miles (total − excluded, rejected trips left out). A plain cell
 *           is typed or pasted into straight from the workbook; a day with
 *           excluded miles or several trips opens its trips instead
 *           (double-click any cell to open it).
 *   Trips — one row per trip, laid out like the workbook's Daily Entry
 *           Revised tab, with the entry check and bulk Approve / Reject.
 *
 * Car IQ, rate and pay aren't typed: each day is priced at the technician's
 * Car IQ status that day (Car IQ history, else their current flag) and the
 * company's rate history — the same as payroll. This page is the record only
 * for now — payroll still reads its own mileage lines.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, FileSpreadsheet, LayoutGrid, List, Loader2, Pencil, Plus, Route, Trash2 } from "lucide-react";
import { DailyMileageImportModal } from "@/components/DailyMileageImportModal";
import { DayTripsModal, StatusBadge, TripEditor } from "@/components/DailyMileageTripModals";
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
import {
  MILEAGE_STATUSES,
  dayTotals,
  eligibleMiles,
  entryCheck,
  parseMiles,
  parsePastedBlock,
  priceMiles,
  statusLabel,
  thresholdCounts,
  type DayPricing,
  type MileageStatus,
} from "@/lib/dailyMileage";
import {
  deleteTrips,
  getCarIqFlags,
  getTechDailyMileage,
  isTechDailyMileageMissing,
  saveTechDailyMileage,
  setTripStatus,
  type MileageCellChange,
  type TechMileageTrip,
} from "@/lib/supabase/techDailyMileage";

type Props = { mod: ModuleDef; sub: SubModuleDef };
type CarIqFilter = "all" | "with" | "without" | "unset";
type RangeMode = "period" | "month" | "custom";
type View = "grid" | "trips";
type StatusFilter = "all" | MileageStatus | "attention";

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
/** A cell's approval underline. */
const statusEdge = (s: MileageStatus | "mixed" | null) =>
  s === "approved" ? "border-b-2 border-b-emerald-400/70" : s === "rejected" ? "border-b-2 border-b-red-400/70" : s === "needs_review" ? "border-b-2 border-b-amber-400/70" : s === "mixed" ? "border-b-2 border-b-sky-400/60" : "";

/** A trip that holds more than a number — clearing its cell would lose that. */
const hasDetails = (t: TechMileageTrip) => !!(t.excludedMiles || t.exclusionReason || t.vehicle || t.branch || t.ticketRefs || t.totalMapUrl || t.eligibleMapUrl || t.notes || t.status !== "pending");

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
  const [trips, setTrips] = useState<TechMileageTrip[]>([]);
  /** false until migration 0453 is run: only miles and notes exist. */
  const [reviewFields, setReviewFields] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** What's typed in a cell and not yet saved, by cell. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(0);

  const [view, setView] = useState<View>("grid");
  const [branch, setBranch] = useState("");
  const [carIq, setCarIq] = useState<CarIqFilter>("all");
  const [search, setSearch] = useState("");
  const [onlyWithMiles, setOnlyWithMiles] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [importing, setImporting] = useState(false);
  /** The open day (grid) and the trip being edited / added. */
  const [openDay, setOpenDay] = useState<{ profileId: string; date: string } | null>(null);
  const [editing, setEditing] = useState<{ trip: TechMileageTrip | null; profileId?: string; workDate?: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
    if (!validRange) { setTrips([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    setDrafts({});
    setSelected(new Set());
    try {
      const r = await getTechDailyMileage(range.start, range.end);
      setTrips(r.trips);
      setReviewFields(r.reviewFields);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(isTechDailyMileageMissing(msg) ? "Daily Mileage isn't set up in the database yet — run migrations 0451_tech_daily_mileage.sql and 0453_tech_daily_mileage_trips.sql in Supabase, then reload." : msg);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [range, validRange]);
  useEffect(() => { void loadPeriod(); }, [loadPeriod]);

  /** Puts saved trips into the page and drops deleted ones. */
  const applySaved = (saved: TechMileageTrip[], deletedIds: string[] = []) => {
    const gone = new Set(deletedIds);
    const byId = new Map(saved.map((t) => [t.id, t]));
    setTrips((prev) => {
      const kept = prev.filter((t) => !gone.has(t.id)).map((t) => byId.get(t.id) ?? t);
      const known = new Set(kept.map((t) => t.id));
      const added = saved.filter((t) => !known.has(t.id) && t.workDate >= range.start && t.workDate <= range.end);
      return [...kept, ...added].filter((t) => t.workDate >= range.start && t.workDate <= range.end);
    });
    if (gone.size) setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
  };

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
  const priceOn = useCallback((profileId: string, date: string) => pricingFor(profileId)(date), [pricingFor]);

  /** Trips by technician and day. */
  const byDay = useMemo(() => {
    const map = new Map<string, TechMileageTrip[]>();
    for (const t of trips) { const k = cellKey(t.profileId, t.workDate); const list = map.get(k); if (list) list.push(t); else map.set(k, [t]); }
    return map;
  }, [trips]);

  // Technicians (any technician pay role, main or extra) who are active, plus
  // anyone — e.g. since deactivated — who already has trips in this period.
  // PH staff are left out like payroll leaves them out (getsTechPortion):
  // there are no PH field technicians, so a technician-tier extra role there
  // is an access grant (Alyssa Diones: Parts Manager + Branch Manager).
  const techs = useMemo(() => {
    const withMiles = new Set(trips.map((r) => r.profileId));
    return people
      .filter((p) => (p.is_active !== false && !isPhBranch(p) && hasAnyTechnicianPayRole(p.role, p.extra_roles)) || withMiles.has(p.id))
      .map((p) => ({ id: p.id, name: p.display_name || p.email || "—", branch: p.assigned_branch || "", active: p.is_active !== false }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, trips]);
  const techById = useMemo(() => new Map(techs.map((t) => [t.id, t])), [techs]);

  const branches = useMemo(
    () => Array.from(new Set([...techs.map((t) => t.branch), ...trips.map((t) => t.branch)].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [techs, trips],
  );
  const currentStatus = (id: string) => pricingFor(id)(range.end || todayISO()).hasCarIq;
  const rangeLabel = !validRange
    ? "Pick the dates"
    : mode === "month" ? monthName(month) : `${fmtDay(range.start)} – ${fmtDay(range.end)}, ${range.end.slice(0, 4)}`;
  /** A week line before each Sunday, except at the first column. */
  const weekEdge = (i: number) => (i > 0 && weekday(days[i]) === "Sun" ? "border-l border-white/20" : "");

  const dayOf = (id: string, date: string) => dayTotals(byDay.get(cellKey(id, date)) ?? []);
  const rowHasMiles = (id: string) => days.some((d) => byDay.has(cellKey(id, d)));

  /** The technician filters (search, Car IQ) — branch is applied per view. */
  const techPasses = (t: { id: string; name: string; branch: string }) => {
    const s = currentStatus(t.id);
    if (carIq === "with" && s !== true) return false;
    if (carIq === "without" && s !== false) return false;
    if (carIq === "unset" && s != null) return false;
    if (search.trim() && !`${t.name} ${t.branch}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  };

  const rows = techs.filter((t) => {
    if (branch && t.branch !== branch) return false;
    if (!techPasses(t)) return false;
    if (onlyWithMiles && !rowHasMiles(t.id)) return false;
    return true;
  });

  /** A technician's period: total / excluded / eligible miles, pay at each day's rate, approved pay, long days. */
  const rowSummary = (id: string) => {
    const list: { date: string; miles: number }[] = [];
    const approved: { date: string; miles: number }[] = [];
    let total = 0, excluded = 0, attention = 0;
    for (const d of days) {
      const dayTrips = byDay.get(cellKey(id, d));
      if (!dayTrips) continue;
      const t = dayTotals(dayTrips);
      total += t.miles; excluded += t.excluded;
      attention += dayTrips.filter((x) => entryCheck(x) || x.status === "needs_review").length;
      list.push({ date: d, miles: t.eligible });
      const ok = dayTrips.filter((x) => x.status === "approved" && !entryCheck(x)).reduce((s, x) => s + eligibleMiles(x), 0);
      if (ok) approved.push({ date: d, miles: ok });
    }
    const priced = priceMiles(list, pricingFor(id));
    return { ...priced, total, excluded, attention, approvedPay: priceMiles(approved, pricingFor(id)).pay, ...thresholdCounts(list.map((x) => x.miles)) };
  };

  // ── Grid cells ──────────────────────────────────────────────────────────

  /** A cell can be typed into when the day has no trip, or one plain trip (nothing excluded, not rejected). */
  const cellEditable = (dayTrips: TechMileageTrip[] | undefined) => !dayTrips || (dayTrips.length === 1 && !dayTrips[0].excludedMiles && dayTrips[0].status !== "rejected");

  /** Saves a batch of cells; the grid shows the new values right away and rolls back on failure. */
  const commit = async (changes: MileageCellChange[]) => {
    const real = changes.filter((c) => {
      const before = byDay.get(cellKey(c.profileId, c.workDate))?.[0]?.miles ?? null;
      return before !== c.miles;
    });
    const keys = changes.map((c) => cellKey(c.profileId, c.workDate));
    setDrafts((prev) => { const next = { ...prev }; for (const k of keys) delete next[k]; return next; });
    if (!real.length) return;
    setSaving((n) => n + 1);
    try {
      const { saved, deletedIds } = await saveTechDailyMileage(real);
      applySaved(saved, deletedIds);
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
    const existing = byDay.get(k)?.[0] ?? null;
    if (Number.isNaN(miles)) {
      toast.error(`"${drafts[k]}" isn't a number of miles.`);
      setDrafts((prev) => { const next = { ...prev }; delete next[k]; return next; });
      return;
    }
    if (miles == null && existing && hasDetails(existing)) {
      toast.error("This trip has details (vehicle, tickets, notes or approval) — double-click the cell to open it and delete it there.");
      setDrafts((prev) => { const next = { ...prev }; delete next[k]; return next; });
      return;
    }
    void commit([{ profileId: id, workDate: date, miles, existingId: existing?.id ?? null }]);
  };

  /** A block copied from Excel fills the cells to the right and below the one it's pasted into. */
  const pasteBlock = (rowIndex: number, dayIndex: number, text: string) => {
    const block = parsePastedBlock(text);
    const changes: MileageCellChange[] = [];
    let skipped = 0, locked = 0;
    block.forEach((cells, r) => {
      const t = rows[rowIndex + r];
      if (!t) { skipped += cells.length; return; }
      cells.forEach((raw, c) => {
        const date = days[dayIndex + c];
        if (!date) { skipped++; return; }
        const miles = parseMiles(raw);
        if (Number.isNaN(miles)) { skipped++; return; }
        const dayTrips = byDay.get(cellKey(t.id, date));
        if (!cellEditable(dayTrips) || (miles == null && dayTrips?.[0] && hasDetails(dayTrips[0]))) { locked++; return; }
        changes.push({ profileId: t.id, workDate: date, miles, existingId: dayTrips?.[0]?.id ?? null });
      });
    });
    if (skipped) toast.message(`${skipped} pasted cell${skipped === 1 ? "" : "s"} skipped (past the last row or day, or not a number).`);
    if (locked) toast.message(`${locked} day${locked === 1 ? "" : "s"} left as they are — they have several trips, excluded miles or details. Open them to change.`);
    void commit(changes);
  };

  /** Arrow keys and Enter move between cells like a spreadsheet. */
  const move = (rowIndex: number, dayIndex: number, dr: number, dc: number) => {
    const el = document.querySelector<HTMLElement>(`[data-mile-cell="${rowIndex + dr}:${dayIndex + dc}"]`);
    if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select(); }
  };

  const totals = useMemo(() => {
    const perDay = days.map((d) => rows.reduce((s, t) => s + dayOf(t.id, d).eligible, 0));
    let total = 0, excluded = 0, miles = 0, pay = 0, approvedPay = 0, unpriced = 0, attention = 0, over200 = 0, over300 = 0, over400 = 0;
    for (const t of rows) {
      const s = rowSummary(t.id);
      total += s.total; excluded += s.excluded; miles += s.miles; pay += s.pay; approvedPay += s.approvedPay; unpriced += s.unpricedMiles; attention += s.attention;
      over200 += s.over200; over300 += s.over300; over400 += s.over400;
    }
    return { perDay, total, excluded, miles, pay, approvedPay, unpriced, attention, over200, over300, over400 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, byDay, days, pricingFor]);

  // ── Trips list ──────────────────────────────────────────────────────────

  const tripBranch = (t: TechMileageTrip) => t.branch || techById.get(t.profileId)?.branch || "";
  const listTrips = useMemo(() => {
    return trips
      .filter((t) => {
        const tech = techById.get(t.profileId);
        if (tech && !techPasses(tech)) return false;
        if (branch && tripBranch(t) !== branch) return false;
        if (statusFilter === "attention") return !!entryCheck(t) || t.status === "needs_review";
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => a.workDate.localeCompare(b.workDate) || (techById.get(a.profileId)?.name ?? "").localeCompare(techById.get(b.profileId)?.name ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, techById, branch, statusFilter, search, carIq, pricingFor]);

  const tripPrice = (t: TechMileageTrip) => {
    const p = priceOn(t.profileId, t.workDate);
    const eligible = eligibleMiles(t);
    return { ...p, eligible, pay: p.rate == null ? null : Math.round(eligible * p.rate * 100) / 100 };
  };

  const allShownSelected = listTrips.length > 0 && listTrips.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(listTrips.map((t) => t.id)));
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const bulkStatus = async (status: MileageStatus) => {
    const ids = [...selected];
    if (!ids.length || bulkBusy) return;
    if (status === "approved") {
      const flagged = trips.filter((t) => selected.has(t.id) && entryCheck(t)).length;
      if (flagged && !window.confirm(`${flagged} of these trip${flagged === 1 ? " has" : "s have"} an entry-check problem (e.g. excluded miles without a reason). Approve anyway?`)) return;
    }
    setBulkBusy(true);
    try {
      applySaved(await setTripStatus(ids, status));
      toast.success(`${ids.length} trip${ids.length === 1 ? "" : "s"} marked ${statusLabel(status)}.`);
      setSelected(new Set());
    } catch (e) {
      toast.error(`Couldn't update: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length || bulkBusy || !window.confirm(`Delete ${ids.length} trip${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBulkBusy(true);
    try {
      await deleteTrips(ids);
      applySaved([], ids);
      toast.success(`Deleted ${ids.length} trip${ids.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkBusy(false);
    }
  };

  // ── Export ──────────────────────────────────────────────────────────────

  const [exporting, setExporting] = useState(false);
  /** The filters in effect, written under the workbook's title. */
  const filterNote = () => {
    const parts = [
      branch ? `Branch: ${branch}.` : "",
      carIq !== "all" ? `Car IQ: ${carIq === "with" ? "with" : carIq === "without" ? "without" : "not set"}.` : "",
      search.trim() ? `Search: "${search.trim()}".` : "",
      view === "trips" && statusFilter !== "all" ? `Status: ${statusFilter === "attention" ? "needs attention" : statusLabel(statusFilter)}.` : "",
      view === "grid" && onlyWithMiles ? "Only technicians with miles." : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" ") : "All technicians.";
  };

  /** A formatted Excel workbook of what's on screen (lib/dailyMileageExport.ts). */
  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { downloadMileageGridWorkbook, downloadMileageTripsWorkbook } = await import("@/lib/dailyMileageExport");
      if (view === "trips") {
        await downloadMileageTripsWorkbook({
          rangeLabel,
          filterNote: filterNote(),
          fileName: `mileage-trips_${range.start}_to_${range.end}.xlsx`,
          rows: listTrips.map((t) => {
            const p = tripPrice(t);
            return {
              date: t.workDate, technician: techById.get(t.profileId)?.name ?? "", branch: tripBranch(t), vehicle: t.vehicle,
              total: t.miles, excluded: t.excludedMiles, reason: t.exclusionReason, carIq: p.hasCarIq, eligible: p.eligible,
              rate: p.rate, pay: p.pay, status: statusLabel(t.status), approvedBy: t.status === "pending" ? "" : t.reviewedByName ?? "",
              ticketRefs: t.ticketRefs, totalMapUrl: t.totalMapUrl, eligibleMapUrl: t.eligibleMapUrl, notes: t.notes, check: entryCheck(t),
            };
          }),
        });
      } else {
        await downloadMileageGridWorkbook({
          rangeLabel,
          filterNote: filterNote(),
          days,
          fileName: `daily-mileage_${range.start}_to_${range.end}.xlsx`,
          rows: rows.map((t) => {
            const s = rowSummary(t.id);
            return {
              name: t.name, branch: t.branch, carIq: currentStatus(t.id),
              days: days.map((d) => (byDay.has(cellKey(t.id, d)) ? dayOf(t.id, d).eligible : null)),
              total: s.total, excluded: s.excluded, eligible: s.miles, rates: s.rates, pay: s.pay, approvedPay: s.approvedPay,
              over200: s.over200, over300: s.over300, over400: s.over400,
            };
          }),
        });
      }
    } catch (e) {
      toast.error(`Couldn't build the Excel file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  /** The table's own scroll box — the floating sideways bar follows it. */
  const gridRef = useRef<HTMLDivElement>(null);
  const periodIndex = periods.findIndex((p) => p.start === period.start);
  const control = "rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none";
  const th = "sticky top-0 z-20 bg-slate-900 px-2 py-2";
  const openTech = openDay ? techById.get(openDay.profileId) : null;
  const openTrips = openDay ? byDay.get(cellKey(openDay.profileId, openDay.date)) ?? [] : [];

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="w-full px-6 space-y-4">
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
          <div className="flex gap-1" role="group" aria-label="View">
            {([["grid", "Grid", LayoutGrid], ["trips", "Trips", List]] as const).map(([k, l, Icon]) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                aria-pressed={view === k}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${view === k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {l}
              </button>
            ))}
          </div>
          <span className="mx-1 h-6 w-px bg-white/10" aria-hidden />
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
          {view === "trips" && (
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Approval status" className={control}>
              <option value="all">Any status</option>
              <option value="attention">Needs attention</option>
              {MILEAGE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search technician…" aria-label="Search technician" className={`${control} min-w-[200px]`} />
          {view === "grid" && (
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
              <input type="checkbox" checked={onlyWithMiles} onChange={(e) => setOnlyWithMiles(e.target.checked)} /> Only with miles
            </label>
          )}
          <span className="ml-auto inline-flex items-center gap-3">
            {saving > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>}
            <button type="button" onClick={() => setEditing({ trip: null })} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
              <Plus className="h-3.5 w-3.5" /> Add trip
            </button>
            <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Import
            </button>
            <button type="button" onClick={() => void exportExcel()} disabled={exporting || (view === "grid" ? !rows.length : !listTrips.length)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export Excel
            </button>
          </span>
        </div>

        {/* Period totals */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Eligible miles", value: fmtMiles(totals.miles), sub: totals.excluded ? `${fmtMiles(totals.total)} total − ${fmtMiles(totals.excluded)} excluded` : `${rows.filter((t) => rowHasMiles(t.id)).length} of ${rows.length} technicians entered`, warn: false },
            { label: "Mileage pay", value: fmtMoney(totals.pay), sub: totals.unpriced > 0 ? `${fmtMiles(totals.unpriced)} mi not priced — Car IQ status not set` : "At each day's Car IQ rate", warn: totals.unpriced > 0 },
            { label: "Approved pay", value: fmtMoney(totals.approvedPay), sub: "Approved trips that pass the entry check", warn: false },
            { label: "Needs attention", value: String(totals.attention), sub: "Entry-check problems or marked Needs review", warn: totals.attention > 0 },
            { label: "Long days", value: `${totals.over200} · ${totals.over300} · ${totals.over400}`, sub: "Days over 200 · 300 · 400 eligible miles", warn: false },
            { label: mode === "period" ? "Pay period" : mode === "month" ? "Month" : "Dates", value: rangeLabel, sub: validRange ? `${days.length} days${mode === "period" ? ", Sunday to Saturday" : ""}` : "From and To are needed", warn: false },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
              <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-white">{loading ? "…" : c.value}</p>
              <p className={`mt-0.5 truncate text-xs ${c.warn ? "text-amber-300" : "text-slate-500"}`} title={c.sub}>{c.sub}</p>
            </div>
          ))}
        </div>

        {!reviewFields && !error && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Excluded miles, vehicle, tickets, map links and approvals need migration 0453_tech_daily_mileage_trips.sql — run it in Supabase, then reload. Miles and notes work in the meantime.
          </p>
        )}

        {view === "grid" ? (
          <p className="text-xs text-slate-400">
            Each cell is the day's <b className="text-slate-300">eligible</b> miles. Type the miles, or copy a block from the workbook and paste it into the first cell — it fills to the right and down. Enter or the arrow keys move between cells.
            Double-click a cell to see its trips; a day with excluded miles or several trips opens on click. Underline: <span className="border-b-2 border-emerald-400/70 px-0.5">approved</span> <span className="border-b-2 border-amber-400/70 px-0.5">needs review</span> <span className="border-b-2 border-red-400/70 px-0.5">rejected</span>.
            Shaded days are over <span className="rounded bg-amber-500/15 px-1 text-amber-200">200</span>, <span className="rounded bg-orange-500/20 px-1 text-orange-200">300</span> or <span className="rounded bg-red-500/20 px-1 text-red-200">400</span> miles.
          </p>
        ) : (
          <p className="text-xs text-slate-400">
            One row per trip, like the workbook's Daily Entry tab. Car IQ, rate and compensation come from AHS for each date. Tick trips to approve, reject or delete them together; click a row to edit it.
          </p>
        )}

        {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        {/* Bulk actions (Trips view) */}
        {view === "trips" && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-white">
            <span className="font-semibold">{selected.size} selected</span>
            <button type="button" disabled={bulkBusy || !reviewFields} onClick={() => bulkStatus("approved")} className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button>
            <button type="button" disabled={bulkBusy || !reviewFields} onClick={() => bulkStatus("needs_review")} className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-semibold hover:bg-amber-600 disabled:opacity-50">Needs review</button>
            <button type="button" disabled={bulkBusy || !reviewFields} onClick={() => bulkStatus("rejected")} className="rounded-md bg-red-800 px-2.5 py-1 text-xs font-semibold hover:bg-red-700 disabled:opacity-50">Reject</button>
            <button type="button" disabled={bulkBusy || !reviewFields} onClick={() => bulkStatus("pending")} className="rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold hover:bg-slate-600 disabled:opacity-50">Back to pending</button>
            <button type="button" disabled={bulkBusy} onClick={bulkDelete} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-red-200 hover:bg-slate-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-slate-300 hover:text-white">Clear selection</button>
          </div>
        )}

        {/* Its own scroll box, as tall as the screen allows: the header stays on top and the names on the left while scrolling. */}
        <div ref={gridRef} className="max-h-[calc(100vh-7rem)] max-w-full overflow-auto rounded-lg border border-white/10 bg-slate-900/50">
          {loading ? (
            <div className="p-4"><TableSkeleton rows={8} cols={10} /></div>
          ) : !validRange ? (
            <EmptyState icon={<Route />} title="Pick the From and To dates." />
          ) : view === "trips" ? (
            listTrips.length === 0 ? (
              <EmptyState icon={<Route />} title={trips.length ? "No trips match these filters." : "No trips in these dates yet."} hint={trips.length ? "Clear the filters to see every trip." : "Add a trip, type miles in the Grid, or import the workbook."} />
            ) : (
              <table className="w-full min-w-max text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[10px] font-semibold uppercase text-slate-400">
                    <th className={`${th} left-0 z-30 w-8`}><input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="Select all trips shown" /></th>
                    <th className={th}>Date</th>
                    <th className={th}>Technician</th>
                    <th className={th}>Branch</th>
                    <th className={th}>Vehicle</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Excluded</th>
                    <th className={th}>Reason</th>
                    <th className={`${th} text-right`}>Eligible</th>
                    <th className={th}>Car IQ</th>
                    <th className={`${th} text-right`}>Rate</th>
                    <th className={`${th} text-right`}>Comp.</th>
                    <th className={th}>Status</th>
                    <th className={th}>Ticket #</th>
                    <th className={th}>Maps</th>
                    <th className={th}>Notes</th>
                    <th className={th}>Check</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {listTrips.map((t) => {
                    const tech = techById.get(t.profileId);
                    const p = tripPrice(t);
                    const check = entryCheck(t);
                    const isSel = selected.has(t.id);
                    return (
                      <tr key={t.id} onClick={() => setEditing({ trip: t })} className={`cursor-pointer border-b border-white/5 hover:bg-white/[0.04] ${isSel ? "bg-blue-500/10" : ""} ${t.status === "rejected" ? "text-slate-500" : ""}`}>
                        <td className="sticky left-0 z-10 bg-slate-900 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSel} onChange={() => toggle(t.id)} aria-label={`Select ${tech?.name ?? "trip"} on ${fmtDay(t.workDate)}`} />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-300">{weekday(t.workDate)} {fmtDay(t.workDate)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium text-white">{tech?.name ?? "Unknown"}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-300">{tripBranch(t) || "—"}{t.branch && tech && t.branch !== tech.branch ? <span className="ml-1 text-[9px] text-sky-300" title={`Their own branch: ${tech.branch || "none"}`}>away</span> : null}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-300">{t.vehicle || "—"}</td>
                        <td className="px-2 py-1.5 text-right text-slate-100">{fmtMiles(t.miles)}</td>
                        <td className="px-2 py-1.5 text-right text-amber-200">{t.excludedMiles ? fmtMiles(t.excludedMiles) : "—"}</td>
                        <td className="max-w-[10rem] truncate px-2 py-1.5 text-slate-300" title={t.exclusionReason}>{t.exclusionReason || "—"}</td>
                        <td className={`px-2 py-1.5 text-right font-semibold ${t.status === "rejected" ? "line-through" : "text-white"}`}>{fmtMiles(p.eligible)}</td>
                        <td className={`px-2 py-1.5 ${p.hasCarIq == null ? "text-amber-300" : "text-slate-300"}`}>{p.hasCarIq == null ? "Not set" : p.hasCarIq ? "Yes" : "No"}</td>
                        <td className="px-2 py-1.5 text-right text-slate-300">{p.rate == null ? "—" : fmtRate(p.rate)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-emerald-300">{p.pay == null ? "—" : fmtMoney(p.pay)}</td>
                        <td className="px-2 py-1.5"><StatusBadge status={t.status} />{t.reviewedByName && t.status !== "pending" ? <div className="text-[9px] text-slate-500">{t.reviewedByName}</div> : null}</td>
                        <td className="max-w-[10rem] truncate px-2 py-1.5 text-slate-300" title={t.ticketRefs}>{t.ticketRefs || "—"}</td>
                        <td className="whitespace-nowrap px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          {[["Total", t.totalMapUrl], ["Eligible", t.eligibleMapUrl]].filter(([, u]) => /^https?:\/\//i.test(u)).map(([l, u]) => (
                            <a key={l} href={u} target="_blank" rel="noreferrer" className="mr-2 inline-flex items-center gap-0.5 text-blue-300 hover:text-blue-200">{l} <ExternalLink className="h-3 w-3" /></a>
                          ))}
                          {!/^https?:\/\//i.test(t.totalMapUrl) && !/^https?:\/\//i.test(t.eligibleMapUrl) && <span className="text-slate-600">—</span>}
                        </td>
                        <td className="max-w-[14rem] truncate px-2 py-1.5 text-slate-400" title={t.notes}>{t.notes || "—"}</td>
                        <td className={`whitespace-nowrap px-2 py-1.5 ${check ? "text-amber-300" : "text-emerald-300"}`}>{check || "OK"}</td>
                        <td className="px-2 py-1.5"><Pencil className="h-3.5 w-3.5 text-slate-500" /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    let total = 0, excl = 0, elig = 0, pay = 0;
                    for (const t of listTrips) { const p = tripPrice(t); total += t.miles; excl += t.status === "rejected" ? t.miles : t.excludedMiles; elig += p.eligible; pay += p.pay ?? 0; }
                    return (
                      <tr className="font-semibold text-slate-200 [&>td]:sticky [&>td]:bottom-0 [&>td]:z-20 [&>td]:border-t-2 [&>td]:border-white/20 [&>td]:bg-slate-900 [&>td:first-child]:z-30">
                        <td className="left-0" />
                        <td colSpan={4} className="px-2 py-2 text-xs uppercase">Total · {listTrips.length} trip{listTrips.length === 1 ? "" : "s"}</td>
                        <td className="px-2 py-2 text-right">{fmtMiles(total)}</td>
                        <td className="px-2 py-2 text-right text-amber-200">{excl ? fmtMiles(excl) : "—"}</td>
                        <td />
                        <td className="px-2 py-2 text-right text-white">{fmtMiles(elig)}</td>
                        <td colSpan={2} />
                        <td className="px-2 py-2 text-right text-emerald-300">{fmtMoney(Math.round(pay * 100) / 100)}</td>
                        <td colSpan={6} />
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            )
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
                  <th className={`${th} border-l border-white/20 text-right`} title="Total miles before exclusions">Total</th>
                  <th className={`${th} text-right`} title="Excluded miles (and rejected trips)">Excl.</th>
                  <th className={`${th} text-right`}>Eligible</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Pay</th>
                  <th className={`${th} text-right`} title="Approved trips that pass the entry check">Approved</th>
                  <th className={`${th} text-right`} title="Days over 200 miles">&gt;200</th>
                  <th className={`${th} text-right`} title="Days over 300 miles">&gt;300</th>
                  <th className={`${th} text-right`} title="Days over 400 miles">&gt;400</th>
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
                          {s.attention > 0 && <span className="rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-200" title="Trips with an entry-check problem or marked Needs review">{s.attention}</span>}
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
                        const dayTrips = byDay.get(k);
                        const day = dayOf(t.id, d);
                        const open = () => (dayTrips ? setOpenDay({ profileId: t.id, date: d }) : setEditing({ trip: null, profileId: t.id, workDate: d }));
                        const title = dayTrips
                          ? `${dayTrips.length} trip${dayTrips.length === 1 ? "" : "s"} · ${fmtMiles(day.miles)} total${day.excluded ? ` − ${fmtMiles(day.excluded)} excluded` : ""} · ${day.status === "mixed" ? "mixed status" : statusLabel(day.status as MileageStatus)}${day.problems ? " · check needed" : ""}${dayTrips[0].updatedByName ? ` · saved by ${dayTrips[0].updatedByName}` : ""}`
                          : undefined;
                        if (!cellEditable(dayTrips)) {
                          return (
                            <td key={d} className={`px-0.5 py-0.5 ${weekEdge(c)}`}>
                              <button
                                type="button"
                                data-mile-cell={`${r}:${c}`}
                                onClick={open}
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowDown") { e.preventDefault(); move(r, c, 1, 0); }
                                  else if (e.key === "ArrowUp") { e.preventDefault(); move(r, c, -1, 0); }
                                  else if (e.key === "ArrowRight") { e.preventDefault(); move(r, c, 0, 1); }
                                  else if (e.key === "ArrowLeft") { e.preventDefault(); move(r, c, 0, -1); }
                                }}
                                title={title}
                                aria-label={`${t.name} on ${fmtDay(d)}: ${fmtMiles(day.eligible)} eligible miles — open trips`}
                                className={`relative h-7 w-[3.6rem] rounded border border-white/10 px-1 text-right text-slate-100 hover:border-blue-400/60 focus:border-blue-500 focus:outline-none ${bandClass(day.eligible)} ${statusEdge(day.status)} ${day.status === "rejected" && !day.eligible ? "text-slate-500 line-through" : ""}`}
                              >
                                {(dayTrips?.length ?? 0) > 1 && <span className="absolute left-0.5 top-0 text-[8px] text-sky-300">×{dayTrips!.length}</span>}
                                {day.excluded > 0 && (dayTrips?.length ?? 0) <= 1 && <span className="absolute left-0.5 top-0 text-[8px] text-amber-300">−</span>}
                                {day.problems > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />}
                                {fmtMiles(day.eligible)}
                              </button>
                            </td>
                          );
                        }
                        const m = dayTrips?.[0]?.miles ?? null;
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
                              onDoubleClick={open}
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
                              title={title}
                              className={`h-7 w-[3.6rem] rounded border border-transparent bg-transparent px-1 text-right text-slate-100 placeholder-slate-700 hover:border-white/10 focus:border-blue-500 focus:bg-slate-800 focus:outline-none ${m != null && !(k in drafts) ? `${bandClass(m)} ${statusEdge(day.status)}` : ""}`}
                              placeholder="—"
                            />
                          </td>
                        );
                      })}
                      <td className="border-l border-white/20 px-2 py-1 text-right text-slate-300">{s.total ? fmtMiles(s.total) : "—"}</td>
                      <td className="px-2 py-1 text-right text-amber-200">{s.excluded ? fmtMiles(s.excluded) : "—"}</td>
                      <td className="px-2 py-1 text-right font-semibold text-white">{s.miles ? fmtMiles(s.miles) : "—"}</td>
                      <td className="px-2 py-1 text-right text-slate-300">{s.rates.length ? s.rates.map(fmtRate).join(" / ") : status == null ? <span className="text-amber-300">not set</span> : "—"}</td>
                      <td className="px-2 py-1 text-right font-semibold text-emerald-300">
                        {s.pay ? fmtMoney(s.pay) : "—"}
                        {s.unpricedMiles > 0 && <div className="text-[10px] font-normal text-amber-300">{fmtMiles(s.unpricedMiles)} mi not priced</div>}
                      </td>
                      <td className="px-2 py-1 text-right text-emerald-200">{s.approvedPay ? fmtMoney(s.approvedPay) : "—"}</td>
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
                  <td className="border-l border-white/20 px-2 py-2 text-right">{fmtMiles(totals.total)}</td>
                  <td className="px-2 py-2 text-right text-amber-200">{totals.excluded ? fmtMiles(totals.excluded) : "—"}</td>
                  <td className="px-2 py-2 text-right text-white">{fmtMiles(totals.miles)}</td>
                  <td />
                  <td className="px-2 py-2 text-right text-emerald-300">{fmtMoney(totals.pay)}</td>
                  <td className="px-2 py-2 text-right text-emerald-200">{fmtMoney(totals.approvedPay)}</td>
                  <td className="px-2 py-2 text-right">{totals.over200}</td>
                  <td className="px-2 py-2 text-right">{totals.over300}</td>
                  <td className="px-2 py-2 text-right">{totals.over400}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        <FloatingHorizontalScrollbar targetRef={gridRef} />

        {openDay && (
          <DayTripsModal
            techName={openTech?.name ?? "Technician"}
            date={openDay.date}
            trips={openTrips}
            pricing={priceOn(openDay.profileId, openDay.date)}
            onEdit={(trip) => setEditing({ trip })}
            onAdd={() => setEditing({ trip: null, profileId: openDay.profileId, workDate: openDay.date })}
            onClose={() => setOpenDay(null)}
          />
        )}
        {editing && (
          <TripEditor
            trip={editing.trip}
            defaults={{ profileId: editing.profileId, workDate: editing.workDate ?? (validRange && todayISO() >= range.start && todayISO() <= range.end ? todayISO() : range.start) }}
            technicians={techs.filter((t) => t.active || t.id === editing.trip?.profileId || t.id === editing.profileId)}
            branches={branches}
            priceOn={priceOn}
            reviewFields={reviewFields}
            onClose={() => setEditing(null)}
            onSaved={(trip) => {
              applySaved([trip]);
              setEditing(null);
              if (trip.workDate < range.start || trip.workDate > range.end) toast.message(`Saved — ${fmtDay(trip.workDate)} is outside the dates shown.`);
              // A day emptied by moving its only trip closes too.
              if (openDay && (byDay.get(cellKey(openDay.profileId, openDay.date)) ?? []).every((t) => t.id === trip.id) && trip.workDate !== openDay.date) setOpenDay(null);
            }}
            onDeleted={(id) => {
              applySaved([], [id]);
              setEditing(null);
              if (openDay && (byDay.get(cellKey(openDay.profileId, openDay.date)) ?? []).every((t) => t.id === id)) setOpenDay(null);
            }}
          />
        )}
        {importing && (
          <DailyMileageImportModal
            // Anyone a sheet name could be: technicians outside the Philippines, active or not.
            technicians={people
              .filter((p) => !isPhBranch(p) && hasAnyTechnicianPayRole(p.role, p.extra_roles))
              .map((p) => ({ id: p.id, name: p.display_name || p.email || "—", branch: p.assigned_branch || "", active: p.is_active !== false }))}
            monthHint={(range.start || todayISO()).slice(0, 7)}
            onClose={() => setImporting(false)}
            onSaved={(n) => { setImporting(false); toast.success(n ? `Imported ${n} trip${n === 1 ? "" : "s"}.` : "Nothing new — every day in the file was already saved."); void loadPeriod(); }}
          />
        )}
      </div>
    </main>
  );
}
