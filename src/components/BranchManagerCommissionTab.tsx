/**
 * Branch Commission — Accounting Dashboard tab. Commission is earned by
 * the PERSON holding a Branch Manager-tier role (roleLabels.ts's
 * BM_AND_UP_ROLES — Branch Manager, Senior Branch Manager, Technical
 * Director, Technical Assistant Director), tiered off their branch's
 * Completion % and LTP (Long Term Pending) % for a pay period, multiplied
 * by their branch's completed-ticket count — all three typed in by hand
 * (see migration 0289's comment for why none of them are auto-derived).
 * This tab is a pure calculator/report: it computes the tier and $
 * amount live from resolveCommissionTier, never stores them, so the
 * displayed number can never drift from the policy logic in
 * branchManagerCommission.ts. No payroll integration yet — that's a
 * deliberate later step once the numbers here are verified.
 *
 * Self-contained (own data fetching), same convention as
 * TicketAttendanceTab.tsx, so it can be mounted on its own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, History as HistoryIcon, X, ChevronDown } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { normalizeRole, ROLE_LABELS, BM_AND_UP_ROLES, TECHNICIAN_PAY_ROLES } from "@/lib/roleLabels";
import {
  getBranchManagerCommissionTally,
  getBranchManagerCommissionTallyInRange,
  upsertBranchManagerCommissionTally,
  resolveCommissionTier,
  type BranchManagerCommissionRow,
  type CommissionTier,
} from "@/lib/supabase/branchManagerCommission";
import { getCommissionPeriods, upsertCommissionPeriodLabel, type CommissionPeriod } from "@/lib/supabase/branchManagerCommissionPeriods";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";

// Plain field technicians + Tech Managers — TECHNICIAN_PAY_ROLES also
// includes Branch Manager/Senior Branch Manager/Technical (Assistant)
// Director (same "Technician" department per ROLE_DEPARTMENT_BREAKDOWN),
// but those are already the roster above (BM_AND_UP_ROLES) — excluded
// here so no one is double-listed.
const TECHNICIAN_ONLY_ROLES = new Set([...TECHNICIAN_PAY_ROLES].filter((r) => !BM_AND_UP_ROLES.has(r)));

// Static literal-string lookup — Tailwind's JIT scanner can't see classes
// built from a template literal at runtime, so every tier's full class
// string has to appear literally somewhere in this file.
const TIER_BADGE_CLASSES: Record<CommissionTier, string> = {
  1: "border-emerald-400/40 bg-emerald-500/15 text-emerald-300",
  2: "border-blue-400/40 bg-blue-500/15 text-blue-300",
  3: "border-amber-400/40 bg-amber-500/15 text-amber-300",
  4: "border-red-400/40 bg-red-500/15 text-red-300",
};

function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

type CommissionField = "completionPct" | "ltpPct" | "completedTickets";

export function BranchManagerCommissionTab() {
  const defaultPeriod = currentMonthBounds();
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end);
  const [people, setPeople] = useState<ProfileRow[]>([]);
  const [technicians, setTechnicians] = useState<ProfileRow[]>([]);
  const [rowsByProfileId, setRowsByProfileId] = useState<Map<string, BranchManagerCommissionRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Last-known-saved snapshot per profileId for the CURRENT period — diffed
  // against before every save so activity-log entries carry a real from/to,
  // not a comparison against a value already overwritten by this same edit.
  // Same ref-snapshot pattern PartsDailyReportEbay.tsx's originalOrdersRef
  // uses for its own "Changed By" history. Rebuilt whenever the period's
  // rows (re)load, updated in place after each successful save.
  const originalRowsRef = useRef<Map<string, BranchManagerCommissionRow>>(new Map());

  // Named period registry — the History list. Loaded once; refreshed after
  // saving a label so a newly-named period shows up immediately.
  const [periods, setPeriods] = useState<CommissionPeriod[]>([]);
  const [periodLabelDraft, setPeriodLabelDraft] = useState("");
  const originalPeriodLabelRef = useRef("");
  const [savingLabel, setSavingLabel] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);

  // Per-row change-history popup.
  const [rowHistoryTarget, setRowHistoryTarget] = useState<{ tallyId: string; personName: string } | null>(null);
  const [rowHistoryEntries, setRowHistoryEntries] = useState<HrActivityLogEntry[]>([]);
  const [rowHistoryLoading, setRowHistoryLoading] = useState(false);

  // Trend chart — plots Completion %/LTP % across every cut-off saved for
  // one person, labeled by that period's own name where one's been set.
  // No manual range to pick: the span is just the earliest-to-latest saved
  // period, since History already is the range.
  const [trendProfileId, setTrendProfileId] = useState<string>("");
  const [trendRows, setTrendRows] = useState<BranchManagerCommissionRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  // Rosters — everyone currently holding a Branch Manager-tier or plain
  // Technician-tier role, primary role only (matches isBmAndUpRole's own
  // "actual job title, not an incidental extra_roles grant" reasoning) —
  // fetched once, independent of the selected period.
  useEffect(() => {
    let cancelled = false;
    getCompanyUsers()
      .then((all) => {
        if (cancelled) return;
        const byName = (a: ProfileRow, b: ProfileRow) => (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "");
        const active = all.filter((p) => p.is_active);
        const managerRoster = active.filter((p) => BM_AND_UP_ROLES.has(normalizeRole(p.role))).sort(byName);
        setPeople(managerRoster);
        setTechnicians(active.filter((p) => TECHNICIAN_ONLY_ROLES.has(normalizeRole(p.role))).sort(byName));
        setTrendProfileId((prev) => prev || managerRoster[0]?.id || "");
      })
      .catch((err) => console.error("Failed to load commission rosters:", err));
    return () => { cancelled = true; };
  }, []);

  const refreshPeriods = () => {
    getCommissionPeriods()
      .then(setPeriods)
      .catch((err) => console.error("Failed to load commission period history:", err));
  };
  useEffect(refreshPeriods, []);

  // The label input reflects whichever saved period matches the currently
  // selected Start/End — blank for a range that's never been named/saved.
  useEffect(() => {
    const match = periods.find((p) => p.periodStart === periodStart && p.periodEnd === periodEnd);
    setPeriodLabelDraft(match?.label ?? "");
    originalPeriodLabelRef.current = match?.label ?? "";
  }, [periods, periodStart, periodEnd]);

  useEffect(() => {
    if (!periodStart || !periodEnd || periodStart > periodEnd) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getBranchManagerCommissionTally(periodStart, periodEnd)
      .then((rows) => {
        if (cancelled) return;
        const map = new Map(rows.map((r) => [r.profileId, r]));
        setRowsByProfileId(map);
        originalRowsRef.current = new Map(map);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load commission tally.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [periodStart, periodEnd]);

  // True once the CURRENT Start/End exactly matches an already-saved
  // period — drives the Save button (enabled either for a brand-new,
  // never-saved range, or when the name text itself has changed).
  const currentPeriodSaved = useMemo(
    () => periods.some((p) => p.periodStart === periodStart && p.periodEnd === periodEnd),
    [periods, periodStart, periodEnd]
  );

  // Any OTHER saved period that shares at least one day with the current
  // Start/End — cut-offs shouldn't normally overlap (a shared day would
  // get double-counted), so this flags it rather than silently allowing
  // it. Excludes an exact match to itself — reopening the same saved
  // period to edit it isn't an overlap.
  const overlappingPeriod = useMemo(() => {
    if (!periodStart || !periodEnd) return null;
    return (
      periods.find(
        (p) =>
          !(p.periodStart === periodStart && p.periodEnd === periodEnd) &&
          periodStart <= p.periodEnd &&
          p.periodStart <= periodEnd
      ) ?? null
    );
  }, [periods, periodStart, periodEnd]);

  // Earliest-to-latest span across every saved period — the Trend chart's
  // implicit range, so there's nothing to manually pick.
  const trendSpan = useMemo(() => {
    if (periods.length === 0) return null;
    let start = periods[0].periodStart;
    let end = periods[0].periodEnd;
    for (const p of periods) {
      if (p.periodStart < start) start = p.periodStart;
      if (p.periodEnd > end) end = p.periodEnd;
    }
    return { start, end };
  }, [periods]);

  useEffect(() => {
    if (!trendSpan) { setTrendRows([]); return; }
    let cancelled = false;
    setTrendLoading(true);
    getBranchManagerCommissionTallyInRange(trendSpan.start, trendSpan.end)
      .then((rows) => {
        if (!cancelled) setTrendRows(rows);
      })
      .catch((err) => console.error("Failed to load commission trend:", err))
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });
    return () => { cancelled = true; };
  }, [trendSpan]);

  const periodLabelByRange = useMemo(
    () => new Map(periods.map((p) => [`${p.periodStart}|${p.periodEnd}`, p.label])),
    [periods]
  );

  const trendChartData = useMemo(() => {
    return trendRows
      .filter((r) => r.profileId === trendProfileId)
      .map((r) => {
        const label = periodLabelByRange.get(`${r.periodStart}|${r.periodEnd}`);
        return {
          periodLabel: label || `${r.periodStart.slice(5)} – ${r.periodEnd.slice(5)}`,
          "Completion %": r.completionPct,
          "LTP %": r.ltpPct,
        };
      });
  }, [trendRows, trendProfileId, periodLabelByRange]);

  const handleFieldBlur = async (person: ProfileRow, field: CommissionField, rawValue: string) => {
    const value = Math.max(0, Number(rawValue) || 0);
    const key = `${person.id}:${field}`;
    setSavingKey(key);
    setError(null);
    const before = originalRowsRef.current.get(person.id);
    const fromValue = before ? before[field] : 0;
    try {
      const rowId = await upsertBranchManagerCommissionTally(person.id, periodStart, periodEnd, { [field]: value });
      const updatedRow: BranchManagerCommissionRow = {
        id: rowId,
        profileId: person.id,
        periodStart,
        periodEnd,
        completionPct: before?.completionPct ?? 0,
        ltpPct: before?.ltpPct ?? 0,
        completedTickets: before?.completedTickets ?? 0,
        updatedAt: new Date().toISOString(),
        [field]: value,
      };
      setRowsByProfileId((prev) => {
        const next = new Map(prev);
        next.set(person.id, updatedRow);
        return next;
      });
      originalRowsRef.current.set(person.id, updatedRow);
      if (fromValue !== value) {
        void logActivity({
          action: "branch_commission_value_changed",
          targetType: "branch_manager_commission_tally",
          targetId: rowId,
          targetLabel: `${person.display_name || person.email} — ${periodStart} to ${periodEnd}`,
          details: { field, from: fromValue, to: value },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${field}.`);
    } finally {
      setSavingKey(null);
    }
  };

  const handlePeriodLabelBlur = async (rawLabel: string) => {
    const label = rawLabel.trim();
    // A brand-new (never-saved) range still needs saving even with an
    // empty name — only skip when this exact period already exists AND
    // the name hasn't actually changed.
    if (currentPeriodSaved && label === originalPeriodLabelRef.current) return;
    setSavingLabel(true);
    setError(null);
    try {
      const periodId = await upsertCommissionPeriodLabel(periodStart, periodEnd, label);
      void logActivity({
        action: "branch_commission_period_labeled",
        targetType: "branch_manager_commission_period",
        targetId: periodId,
        targetLabel: `${periodStart} to ${periodEnd}`,
        details: { from: originalPeriodLabelRef.current, to: label },
      });
      originalPeriodLabelRef.current = label;
      refreshPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save period name.");
    } finally {
      setSavingLabel(false);
    }
  };

  const openRowHistory = async (person: ProfileRow) => {
    const row = rowsByProfileId.get(person.id);
    if (!row) return;
    setRowHistoryTarget({ tallyId: row.id, personName: person.display_name || person.email || "" });
    setRowHistoryEntries([]);
    setRowHistoryLoading(true);
    try {
      const entries = await getActivityLog({ targetId: row.id, targetType: "branch_manager_commission_tally", limit: 50 });
      setRowHistoryEntries(entries);
    } catch (err) {
      console.error("Failed to load Branch Commission row history:", err);
    } finally {
      setRowHistoryLoading(false);
    }
  };

  const selectHistoryPeriod = (period: CommissionPeriod) => {
    setPeriodStart(period.periodStart);
    setPeriodEnd(period.periodEnd);
    setHistoryMenuOpen(false);
  };

  const totalCommission = useMemo(() => {
    let total = 0;
    for (const person of people) {
      const row = rowsByProfileId.get(person.id);
      if (!row) continue;
      const { ratePerTicket } = resolveCommissionTier(row.completionPct, row.ltpPct);
      total += ratePerTicket * row.completedTickets;
    }
    return total;
  }, [people, rowsByProfileId]);

  return (
    <>
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm">Branch Commission</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Per-ticket commission for Branch Manager, Senior Branch Manager, Technical Director, and Technical Assistant Director,
            tiered off Completion % and LTP %. All three fields are entered by hand for the selected period — the tier and $ amount
            are computed live, never stored.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {(loading || savingLabel) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="glass-input text-sm py-1.5 px-2 rounded-md"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="glass-input text-sm py-1.5 px-2 rounded-md"
          />
          <input
            type="text"
            value={periodLabelDraft}
            onChange={(e) => setPeriodLabelDraft(e.target.value)}
            placeholder="Name this period…"
            className="glass-input text-sm py-1.5 px-2 rounded-md w-40"
          />
          <button
            type="button"
            onClick={() => void handlePeriodLabelBlur(periodLabelDraft)}
            disabled={savingLabel || (currentPeriodSaved && periodLabelDraft.trim() === originalPeriodLabelRef.current)}
            title={currentPeriodSaved ? "Save the renamed period" : "Save this new period"}
            className="btn text-xs px-3 py-1.5 disabled:opacity-40"
          >
            Save
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setHistoryMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              History
              <ChevronDown className="h-3 w-3" />
            </button>
            {historyMenuOpen && (
              <div className="absolute right-0 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-2xl z-20">
                <div className="px-3 py-2 border-b border-white/10 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sticky top-0 bg-slate-900">
                  Saved Periods ({periods.length})
                </div>
                {periods.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">No periods saved yet.</p>
                ) : (
                  periods.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectHistoryPeriod(p)}
                      className={`w-full text-left px-3 py-2.5 text-xs hover:bg-white/5 border-b border-white/5 last:border-b-0 ${
                        p.periodStart === periodStart && p.periodEnd === periodEnd ? "bg-white/5 text-white" : "text-slate-300"
                      }`}
                    >
                      <div className="font-medium">{p.label || `${p.periodStart} – ${p.periodEnd}`}</div>
                      {p.label && <div className="text-[10px] text-muted-foreground mt-0.5">{p.periodStart} – {p.periodEnd}</div>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {overlappingPeriod && (
        <p className="mx-4 mt-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-2.5 py-2">
          This range overlaps with an already-saved period — <span className="font-semibold">{overlappingPeriod.label || `${overlappingPeriod.periodStart} – ${overlappingPeriod.periodEnd}`}</span>{" "}
          ({overlappingPeriod.periodStart} – {overlappingPeriod.periodEnd}). Any overlapping days may get double-counted across the two.
        </p>
      )}

      <div className="px-4 py-3 border-b border-white/10 bg-white/5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${TIER_BADGE_CLASSES[1].split(" ")[1]}`} />
          <span className="text-muted-foreground">Completion ≥ 50% &amp; LTP &lt; 50% — <span className="text-foreground font-semibold">$10/ticket</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${TIER_BADGE_CLASSES[2].split(" ")[1]}`} />
          <span className="text-muted-foreground">Completion ≤ 49% or LTP ≥ 50% — <span className="text-foreground font-semibold">$5/ticket</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${TIER_BADGE_CLASSES[3].split(" ")[1]}`} />
          <span className="text-muted-foreground">Both fail moderately (35-50% / 50-75%) — <span className="text-foreground font-semibold">$2.50/ticket</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${TIER_BADGE_CLASSES[4].split(" ")[1]}`} />
          <span className="text-muted-foreground">Completion &lt; 35% or LTP &gt; 70% — <span className="text-foreground font-semibold">no commission</span></span>
        </div>
      </div>

      {error && (
        <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>
      )}

      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="border-b border-white/10 bg-slate-900">
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Branch</th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Completion %</th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">LTP %</th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Completed Tickets</th>
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Tier</th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Commission</th>
              <th className="px-4 py-3 text-center text-xs text-muted-foreground uppercase">History</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">No one currently holds a Branch Manager-tier role.</td></tr>
            ) : (
              people.map((person) => {
                const row = rowsByProfileId.get(person.id);
                const completionPct = row?.completionPct ?? 0;
                const ltpPct = row?.ltpPct ?? 0;
                const completedTickets = row?.completedTickets ?? 0;
                const { tier, ratePerTicket, label } = resolveCommissionTier(completionPct, ltpPct);
                const commission = ratePerTicket * completedTickets;
                const rowSavingField = (field: CommissionField) => savingKey === `${person.id}:${field}`;
                return (
                  <tr key={person.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium whitespace-nowrap">{person.display_name || person.email}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{ROLE_LABELS[normalizeRole(person.role)] || person.role}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{person.assigned_branch || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {rowSavingField("completionPct") && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                        <input
                          key={`${person.id}:completionPct:${completionPct}`}
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          defaultValue={completionPct}
                          onBlur={(e) => void handleFieldBlur(person, "completionPct", e.target.value)}
                          disabled={rowSavingField("completionPct")}
                          className="glass-input text-sm py-1 px-2 rounded-md w-20 text-right disabled:opacity-50"
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {rowSavingField("ltpPct") && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                        <input
                          key={`${person.id}:ltpPct:${ltpPct}`}
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          defaultValue={ltpPct}
                          onBlur={(e) => void handleFieldBlur(person, "ltpPct", e.target.value)}
                          disabled={rowSavingField("ltpPct")}
                          className="glass-input text-sm py-1 px-2 rounded-md w-20 text-right disabled:opacity-50"
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {rowSavingField("completedTickets") && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                        <input
                          key={`${person.id}:completedTickets:${completedTickets}`}
                          type="number"
                          step="1"
                          min="0"
                          defaultValue={completedTickets}
                          onBlur={(e) => void handleFieldBlur(person, "completedTickets", e.target.value)}
                          disabled={rowSavingField("completedTickets")}
                          className="glass-input text-sm py-1 px-2 rounded-md w-24 text-right disabled:opacity-50"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TIER_BADGE_CLASSES[tier]}`}
                        title={label}
                      >
                        Condition {tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold whitespace-nowrap">
                      ${commission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => void openRowHistory(person)}
                        disabled={!row}
                        title={row ? "View change history" : "Nothing saved yet for this period"}
                        className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <HistoryIcon className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {people.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/5">
                <td className="px-4 py-3 font-semibold" colSpan={7}>Total commission for period</td>
                <td className="px-4 py-3 text-right font-mono font-bold text-emerald-300 whitespace-nowrap">
                  ${totalCommission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>

    <div className="panel p-0 overflow-hidden mt-4">
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm">Trend</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Completion % and LTP % across every saved cut-off for one person — labeled by each period's own name from History
            above. No range to pick: this is every period that's been saved.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {trendLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <select
            value={trendProfileId}
            onChange={(e) => setTrendProfileId(e.target.value)}
            className="glass-input text-sm py-1.5 px-2 rounded-md"
          >
            {people.length === 0 && <option value="">No one on the roster yet</option>}
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="p-4">
        {trendChartData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No saved cut-offs for this person yet — enter and save their numbers above for a period to see it plotted here.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={260} debounce={200}>
            <LineChart data={trendChartData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="periodLabel" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600 }} />
              <Legend wrapperStyle={{ fontSize: 9, color: "#94a3b8" }} />
              <Line type="monotone" dataKey="Completion %" stroke="#34d399" strokeWidth={1.5} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="LTP %" stroke="#fb7185" strokeWidth={1.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>

    <div className="panel p-0 overflow-hidden mt-4">
      <div className="px-4 py-4 border-b border-white/10">
        <h2 className="font-semibold text-sm">Technician Commission</h2>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Roster of everyone currently holding a Technician-tier role. Commission rules for this group haven't been defined yet —
          this is a placeholder roster only, to be wired up once the policy is set.
        </p>
      </div>
      <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="border-b border-white/10 bg-slate-900">
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Branch</th>
            </tr>
          </thead>
          <tbody>
            {technicians.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">No one currently holds a Technician-tier role.</td></tr>
            ) : (
              technicians.map((person) => (
                <tr key={person.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{person.display_name || person.email}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{ROLE_LABELS[normalizeRole(person.role)] || person.role}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{person.assigned_branch || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>

    {rowHistoryTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setRowHistoryTarget(null)}>
        <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-semibold">History — {rowHistoryTarget.personName}</h3>
            <button type="button" onClick={() => setRowHistoryTarget(null)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto p-4 space-y-2">
            {rowHistoryLoading ? (
              <p className="text-xs text-muted-foreground text-center py-6">Loading…</p>
            ) : rowHistoryEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No changes logged for this period yet.</p>
            ) : (
              rowHistoryEntries.map((entry) => (
                <div key={entry.id} className="text-xs border-b border-white/5 pb-2 last:border-b-0">
                  <div className="text-slate-300">
                    <span className="font-medium">{activityActionLabel(entry.action)}</span>
                    {entry.details?.field && <span className="text-muted-foreground"> ({entry.details.field})</span>}
                    {" — "}
                    <span className="text-red-300">{String(entry.details?.from ?? "—")}</span>
                    {" → "}
                    <span className="text-emerald-300">{String(entry.details?.to ?? "—")}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {entry.actorName || "Unknown"} · {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
