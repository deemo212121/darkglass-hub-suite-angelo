/**
 * Branch Commission — Accounting Dashboard tab. Commission is earned by
 * the PERSON holding a Branch Manager-tier role (roleLabels.ts's
 * BM_AND_UP_ROLES — Branch Manager, Senior Branch Manager, Technical
 * Director, Technical Assistant Director), per branch they manage, tiered
 * off that branch's Completion % and LTP (Long Term Pending) % for a pay
 * period, multiplied by its completed-ticket count.
 *
 * Laid out the way Finance keeps it (migration 0417):
 * - Summary: one line per manager per branch — a manager's branches are
 *   their assigned branch plus any Approval Chain gives them (Senior Branch
 *   Manager → branches) — with the branch's Condition and Total Earned.
 * - Technicians: grouped by branch under its manager, each with their own
 *   Completion % / LTP % / completed tickets typed in by hand, and a
 *   Regular / Trainee pick. A trainee doesn't count in the bonus.
 * A branch's numbers are rolled up live from its non-trainee technicians
 * (branchCommissionTech.ts rollUpBranch) and tiered by
 * resolveCommissionTier — never stored, so they can't drift from the policy.
 * No payroll integration yet.
 *
 * Self-contained (own data fetching), same convention as
 * TicketAttendanceTab.tsx, so it can be mounted on its own.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, History as HistoryIcon, X, ChevronDown } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { normalizeRole, ROLE_LABELS, BM_AND_UP_ROLES, TECHNICIAN_PAY_ROLES } from "@/lib/roleLabels";
import { resolveCommissionTier, type CommissionTier } from "@/lib/supabase/branchManagerCommission";
import {
  getTechCommissionTally,
  getTechCommissionTallyInRange,
  upsertTechCommissionTally,
  isTechTallyMissingError,
  rollUpBranch,
  type TechCommissionRow,
} from "@/lib/supabase/branchCommissionTech";
import { getSeniorBranchManagerAssignments, type SbmBranchAssignment } from "@/lib/supabase/seniorBranchManagerAssignments";
import { normBranch } from "@/lib/approvalDirectory";
import { getCommissionPeriods, upsertCommissionPeriodLabel, type CommissionPeriod } from "@/lib/supabase/branchManagerCommissionPeriods";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";

// Plain field technicians + Tech Managers — TECHNICIAN_PAY_ROLES also
// includes Branch Manager/Senior Branch Manager/Technical (Assistant)
// Director (same "Technician" department per ROLE_DEPARTMENT_BREAKDOWN),
// but those are the managers — excluded here so no one is double-listed.
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
const TIER_DOT_CLASSES: Record<CommissionTier, string> = {
  1: "bg-emerald-400",
  2: "bg-blue-400",
  3: "bg-amber-400",
  4: "bg-red-400",
};
const TIER_RULES: { tier: CommissionTier; rule: string; rate: string }[] = [
  { tier: 1, rule: "Completion ≥ 50% & LTP < 50%", rate: "$10 / ticket" },
  { tier: 2, rule: "Completion ≤ 49% or LTP ≥ 50%", rate: "$5 / ticket" },
  { tier: 3, rule: "Completion 35–50% & LTP 50–75%", rate: "$2.50 / ticket" },
  { tier: 4, rule: "Completion < 35% or LTP > 70%", rate: "No commission" },
];

function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nameOf = (p: ProfileRow) => p.display_name || p.email || "";
const byName = (a: ProfileRow, b: ProfileRow) => nameOf(a).localeCompare(nameOf(b));
const roleOf = (p: ProfileRow) => ROLE_LABELS[normalizeRole(p.role)] || p.role;
// HR's own trainee flag — the Regular / Trainee pick starts here until Finance saves one for the period.
const hrTrainee = (p: ProfileRow) => p.employment_type === "trainee" && !p.trainee_access_granted;

type NumberField = "completionPct" | "ltpPct" | "completedTickets";
type BranchResult = ReturnType<typeof rollUpBranch> & ReturnType<typeof resolveCommissionTier> & { earned: number };

export function BranchManagerCommissionTab() {
  const defaultPeriod = currentMonthBounds();
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end);
  const [managers, setManagers] = useState<ProfileRow[]>([]);
  const [technicians, setTechnicians] = useState<ProfileRow[]>([]);
  const [sbmRows, setSbmRows] = useState<SbmBranchAssignment[]>([]);
  const [rowsByProfileId, setRowsByProfileId] = useState<Map<string, TechCommissionRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);

  // Last-known-saved snapshot per technician for the CURRENT period — diffed
  // against before every save so activity-log entries carry a real from/to.
  const originalRowsRef = useRef<Map<string, TechCommissionRow>>(new Map());

  // Named period registry — the History list.
  const [periods, setPeriods] = useState<CommissionPeriod[]>([]);
  const [periodLabelDraft, setPeriodLabelDraft] = useState("");
  const originalPeriodLabelRef = useRef("");
  const [savingLabel, setSavingLabel] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);

  // Per-technician change-history popup.
  const [rowHistoryTarget, setRowHistoryTarget] = useState<{ tallyId: string; personName: string } | null>(null);
  const [rowHistoryEntries, setRowHistoryEntries] = useState<HrActivityLogEntry[]>([]);
  const [rowHistoryLoading, setRowHistoryLoading] = useState(false);

  // Trend chart — one branch's rolled-up Completion % / LTP % across every saved cut-off.
  const [trendBranch, setTrendBranch] = useState<string>("");
  const [trendRows, setTrendRows] = useState<TechCommissionRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  // Rosters (primary role only, like isBmAndUpRole) + Approval Chain's
  // Senior Branch Manager → branch assignments — fetched once.
  useEffect(() => {
    let cancelled = false;
    getCompanyUsers()
      .then((all) => {
        if (cancelled) return;
        const active = all.filter((p) => p.is_active);
        setManagers(active.filter((p) => BM_AND_UP_ROLES.has(normalizeRole(p.role))).sort(byName));
        setTechnicians(active.filter((p) => TECHNICIAN_ONLY_ROLES.has(normalizeRole(p.role))).sort(byName));
      })
      .catch((err) => console.error("Failed to load commission rosters:", err));
    getSeniorBranchManagerAssignments()
      .then((rows) => { if (!cancelled) setSbmRows(rows); })
      .catch((err) => console.error("Failed to load branch assignments:", err));
    return () => { cancelled = true; };
  }, []);

  const refreshPeriods = () => {
    getCommissionPeriods()
      .then(setPeriods)
      .catch((err) => console.error("Failed to load commission period history:", err));
  };
  useEffect(refreshPeriods, []);

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
    getTechCommissionTally(periodStart, periodEnd)
      .then((rows) => {
        if (cancelled) return;
        const map = new Map(rows.map((r) => [r.profileId, r]));
        setRowsByProfileId(map);
        originalRowsRef.current = new Map(map);
        setMigrationMissing(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load commission tally.";
        if (isTechTallyMissingError(message)) setMigrationMissing(true);
        else setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [periodStart, periodEnd]);

  const currentPeriodSaved = useMemo(
    () => periods.some((p) => p.periodStart === periodStart && p.periodEnd === periodEnd),
    [periods, periodStart, periodEnd]
  );

  // Any OTHER saved period sharing a day with the current range — flagged, since shared days get double-counted.
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

  // ---- Branch structure ----
  // Display spelling per normalized branch: Approval Chain's spelling first, then profiles'.
  const branchLabel = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sbmRows) if (s.branch && !seen.has(normBranch(s.branch))) seen.set(normBranch(s.branch), s.branch);
    for (const p of [...managers, ...technicians]) {
      if (p.assigned_branch && !seen.has(normBranch(p.assigned_branch))) seen.set(normBranch(p.assigned_branch), p.assigned_branch);
    }
    return seen;
  }, [sbmRows, managers, technicians]);
  const labelOf = (key: string) => branchLabel.get(key) || "No branch";
  const byBranchLabel = (a: string, b: string) => labelOf(a).localeCompare(labelOf(b));

  // A manager's branches: their own assigned branch, plus the branches
  // Approval Chain gives a Senior Branch Manager that no other manager has
  // as their own — a region's branch with its own Branch Manager is that
  // manager's, not the Senior Branch Manager's.
  const branchesOfManager = useMemo(() => {
    const ownKey = (m: ProfileRow) => (m.assigned_branch && normBranch(m.assigned_branch) !== "philippines" ? normBranch(m.assigned_branch) : "");
    const directOwners = new Map<string, Set<string>>();
    for (const m of managers) {
      const key = ownKey(m);
      if (!key) continue;
      if (!directOwners.has(key)) directOwners.set(key, new Set());
      directOwners.get(key)!.add(m.id);
    }
    const map = new Map<string, string[]>();
    for (const m of managers) {
      const keys = new Set<string>();
      if (ownKey(m)) keys.add(ownKey(m));
      for (const s of sbmRows) {
        if (s.profileId !== m.id || !s.branch) continue;
        const key = normBranch(s.branch);
        const others = [...(directOwners.get(key) ?? [])].filter((id) => id !== m.id);
        if (others.length === 0) keys.add(key);
      }
      map.set(m.id, [...keys].sort(byBranchLabel));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managers, sbmRows, branchLabel]);

  const techsByBranch = useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const t of technicians) {
      const key = normBranch(t.assigned_branch);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [technicians]);

  const techValues = (t: ProfileRow) => {
    const row = rowsByProfileId.get(t.id);
    return {
      completionPct: row?.completionPct ?? 0,
      ltpPct: row?.ltpPct ?? 0,
      completedTickets: row?.completedTickets ?? 0,
      isTrainee: row?.isTrainee ?? hrTrainee(t),
    };
  };

  const branchResult = useMemo(() => {
    const map = new Map<string, BranchResult>();
    const keys = new Set<string>([...techsByBranch.keys(), ...[...branchesOfManager.values()].flat()]);
    for (const key of keys) {
      const roll = rollUpBranch((techsByBranch.get(key) ?? []).map(techValues));
      const tier = resolveCommissionTier(roll.completionPct, roll.ltpPct);
      map.set(key, { ...roll, ...tier, earned: roll.counted === 0 ? 0 : tier.ratePerTicket * roll.completedTickets });
    }
    return map;
    // techValues reads rowsByProfileId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techsByBranch, branchesOfManager, rowsByProfileId]);

  // A branch has numbers once any counted tech has something typed in.
  const hasNumbers = (r: BranchResult | undefined) => !!r && r.counted > 0 && (r.completedTickets > 0 || r.completionPct > 0 || r.ltpPct > 0);

  const managerTotal = (m: ProfileRow) => (branchesOfManager.get(m.id) ?? []).reduce((sum, k) => sum + (branchResult.get(k)?.earned ?? 0), 0);
  const grandTotal = managers.reduce((sum, m) => sum + managerTotal(m), 0);
  const managedKeys = useMemo(() => new Set([...branchesOfManager.values()].flat()), [branchesOfManager]);
  const stats = useMemo(() => {
    let branchesWithNumbers = 0;
    let counted = 0;
    let trainees = 0;
    for (const key of managedKeys) {
      const r = branchResult.get(key);
      if (hasNumbers(r)) branchesWithNumbers++;
      counted += r?.counted ?? 0;
      trainees += r?.trainees ?? 0;
    }
    return { branchesWithNumbers, branches: managedKeys.size, counted, trainees };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedKeys, branchResult]);

  // Technician groups: one per branch, in manager order; branches with
  // technicians but no manager go last (they don't count for anyone).
  const techGroups = useMemo(() => {
    const groups: { key: string; managerNames: string[] }[] = [];
    const placed = new Set<string>();
    const managersOf = (key: string) => managers.filter((m) => (branchesOfManager.get(m.id) ?? []).includes(key)).map(nameOf);
    for (const m of managers) {
      for (const key of branchesOfManager.get(m.id) ?? []) {
        if (placed.has(key) || !techsByBranch.has(key)) continue;
        placed.add(key);
        groups.push({ key, managerNames: managersOf(key) });
      }
    }
    const rest = [...techsByBranch.keys()].filter((k) => !placed.has(k)).sort(byBranchLabel);
    for (const key of rest) groups.push({ key, managerNames: [] });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managers, branchesOfManager, techsByBranch, branchLabel]);

  // ---- Trend ----
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
    getTechCommissionTallyInRange(trendSpan.start, trendSpan.end)
      .then((rows) => { if (!cancelled) setTrendRows(rows); })
      .catch((err) => console.error("Failed to load commission trend:", err))
      .finally(() => { if (!cancelled) setTrendLoading(false); });
    return () => { cancelled = true; };
  }, [trendSpan]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trendBranchOptions = useMemo(() => [...managedKeys].sort(byBranchLabel), [managedKeys, branchLabel]);
  useEffect(() => {
    if (!trendBranch && trendBranchOptions.length > 0) setTrendBranch(trendBranchOptions[0]);
  }, [trendBranch, trendBranchOptions]);

  const periodLabelByRange = useMemo(
    () => new Map(periods.map((p) => [`${p.periodStart}|${p.periodEnd}`, p.label])),
    [periods]
  );

  const trendChartData = useMemo(() => {
    const techIds = new Set((techsByBranch.get(trendBranch) ?? []).map((t) => t.id));
    const byPeriod = new Map<string, TechCommissionRow[]>();
    for (const r of trendRows) {
      if (!techIds.has(r.profileId)) continue;
      const key = `${r.periodStart}|${r.periodEnd}`;
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key)!.push(r);
    }
    return [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => {
        const roll = rollUpBranch(rows);
        const [start, end] = key.split("|");
        return {
          periodLabel: periodLabelByRange.get(key) || `${start.slice(5)} – ${end.slice(5)}`,
          "Completion %": roll.completionPct,
          "LTP %": roll.ltpPct,
        };
      });
  }, [trendRows, trendBranch, techsByBranch, periodLabelByRange]);

  // ---- Saves ----
  const saveTechField = async (tech: ProfileRow, field: NumberField | "isTrainee", value: number | boolean) => {
    const key = `${tech.id}:${field}`;
    setSavingKey(key);
    setError(null);
    const before = originalRowsRef.current.get(tech.id);
    const current = techValues(tech);
    const fromValue = before ? before[field] : current[field];
    try {
      const rowId = await upsertTechCommissionTally(tech.id, periodStart, periodEnd, {
        // The first save for a period also pins the Regular / Trainee shown, so it doesn't change if HR's flag does later.
        ...(before ? {} : { isTrainee: current.isTrainee }),
        [field]: value,
      });
      const updatedRow: TechCommissionRow = {
        id: rowId,
        profileId: tech.id,
        periodStart,
        periodEnd,
        ...current,
        updatedAt: new Date().toISOString(),
        [field]: value,
      };
      setRowsByProfileId((prev) => new Map(prev).set(tech.id, updatedRow));
      originalRowsRef.current.set(tech.id, updatedRow);
      if (fromValue !== value) {
        void logActivity({
          action: "branch_commission_value_changed",
          targetType: "branch_commission_tech_tally",
          targetId: rowId,
          targetLabel: `${nameOf(tech)} — ${periodStart} to ${periodEnd}`,
          details: { field: field === "isTrainee" ? "trainee" : field, from: fromValue, to: value },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${field}.`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleNumberBlur = (tech: ProfileRow, field: NumberField, rawValue: string) => {
    const value = Math.max(0, field === "completedTickets" ? Math.round(Number(rawValue) || 0) : Number(rawValue) || 0);
    const saved = originalRowsRef.current.get(tech.id);
    if (saved ? saved[field] === value : value === 0) return;
    void saveTechField(tech, field, value);
  };

  const handlePeriodLabelBlur = async (rawLabel: string) => {
    const label = rawLabel.trim();
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

  const openRowHistory = async (tech: ProfileRow) => {
    const row = rowsByProfileId.get(tech.id);
    if (!row) return;
    setRowHistoryTarget({ tallyId: row.id, personName: nameOf(tech) });
    setRowHistoryEntries([]);
    setRowHistoryLoading(true);
    try {
      setRowHistoryEntries(await getActivityLog({ targetId: row.id, targetType: "branch_commission_tech_tally", limit: 50 }));
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

  const th = "px-4 py-2.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase whitespace-nowrap";

  const numberInput = (tech: ProfileRow, field: NumberField, value: number, hidden: boolean) => {
    const saving = savingKey === `${tech.id}:${field}`;
    if (hidden) return <span className="text-xs text-muted-foreground/60">—</span>;
    return (
      <div className="inline-flex items-center justify-end gap-1">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        <input
          key={`${tech.id}:${field}:${value}:${periodStart}:${periodEnd}`}
          type="number"
          step={field === "completedTickets" ? "1" : "0.1"}
          min="0"
          max={field === "completedTickets" ? undefined : "100"}
          defaultValue={value === 0 ? "" : value}
          placeholder="0"
          onBlur={(e) => handleNumberBlur(tech, field, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          disabled={saving || migrationMissing}
          className="glass-input text-sm py-1 px-2 rounded-md text-right tabular-nums w-[4.5rem] disabled:opacity-50"
        />
        <span className={`text-xs text-muted-foreground w-3 ${field === "completedTickets" ? "invisible" : ""}`}>%</span>
      </div>
    );
  };

  const tierBadge = (tier: CommissionTier, label: string) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TIER_BADGE_CLASSES[tier]}`} title={label}>
      <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT_CLASSES[tier]}`} />
      Condition {tier}
    </span>
  );

  return (
    <>
    <div className="panel p-0 overflow-hidden">
      {/* Header + period controls */}
      <div className="px-5 py-4 border-b border-white/10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-base">Branch Commission</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Per-ticket commission for each branch a manager runs. Enter technicians' numbers below — trainees don't count — and
            each branch's Condition and total update as you go.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {(loading || savingLabel) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] pl-1 pr-1 py-1">
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md !w-[9.5rem]" />
            <span className="text-muted-foreground text-xs">to</span>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md !w-[9.5rem]" />
          </div>
          <input
            type="text"
            value={periodLabelDraft}
            onChange={(e) => setPeriodLabelDraft(e.target.value)}
            placeholder="Name this period…"
            className="glass-input text-sm py-1.5 px-2 rounded-md !w-44"
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

      {(overlappingPeriod || migrationMissing || error) && (
        <div className="px-5 pt-3 space-y-2">
          {overlappingPeriod && (
            <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              This range overlaps an already-saved period — <span className="font-semibold">{overlappingPeriod.label || `${overlappingPeriod.periodStart} – ${overlappingPeriod.periodEnd}`}</span>{" "}
              ({overlappingPeriod.periodStart} – {overlappingPeriod.periodEnd}). Overlapping days may get double-counted.
            </p>
          )}
          {migrationMissing && (
            <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              Run migration <code>0417_branch_commission_tech_tally.sql</code> in Supabase to start entering technicians' numbers.
            </p>
          )}
          {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</p>}
        </div>
      )}

      {/* Period at a glance */}
      <div className="px-5 py-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Total commission</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-300">{money(grandTotal)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Branches entered</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {stats.branchesWithNumbers}
            <span className="text-sm font-medium text-muted-foreground"> / {stats.branches}</span>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Managers</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{managers.length}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Technicians counted</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {stats.counted}
            {stats.trainees > 0 && <span className="text-sm font-medium text-amber-300"> · {stats.trainees} trainee{stats.trainees === 1 ? "" : "s"} excluded</span>}
          </div>
        </div>
      </div>

      {/* Condition legend */}
      <div className="px-5 pb-4 flex flex-wrap gap-2">
        {TIER_RULES.map((r) => (
          <div key={r.tier} className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${TIER_DOT_CLASSES[r.tier]}`} />
            <span className="font-semibold">Condition {r.tier}</span>
            <span className="text-muted-foreground">{r.rule}</span>
            <span className="font-semibold text-foreground">{r.rate}</span>
          </div>
        ))}
      </div>

      {/* Summary — one line per manager per branch */}
      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border-t border-white/10">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-white/10 bg-slate-900">
              <th className={`${th} text-left`}>BM Name</th>
              <th className={`${th} text-left`}>Branch</th>
              <th className={`${th} text-right`}>Completion</th>
              <th className={`${th} text-right`}>LTP</th>
              <th className={`${th} text-right`}>Tickets</th>
              <th className={`${th} text-left`}>Condition</th>
              <th className={`${th} text-right`}>Total Earned</th>
            </tr>
          </thead>
          <tbody>
            {managers.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">No one currently holds a Branch Manager-tier role.</td></tr>
            ) : (
              managers.map((m, mi) => {
                const keys = branchesOfManager.get(m.id) ?? [];
                const lines = keys.length > 0 ? keys : [null];
                const band = mi % 2 === 1 ? "bg-white/[0.02]" : "";
                return (
                  <Fragment key={m.id}>
                    {lines.map((key, i) => {
                      const r = key ? branchResult.get(key) : undefined;
                      const last = i === lines.length - 1 && lines.length === 1;
                      return (
                        <tr key={key ?? "none"} className={`${band} border-b ${last ? "border-white/10" : "border-white/5"}`}>
                          {i === 0 && (
                            <td className="px-4 py-2.5 align-top whitespace-nowrap" rowSpan={lines.length}>
                              <div className="font-semibold">{nameOf(m)}</div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">{roleOf(m)}</div>
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                            {key ? labelOf(key) : <span className="text-muted-foreground italic">No branch assigned</span>}
                          </td>
                          {key && hasNumbers(r) && r ? (
                            <>
                              <td className="px-4 py-2.5 text-right tabular-nums">{r.completionPct}%</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{r.ltpPct}%</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{r.completedTickets}</td>
                              <td className="px-4 py-2.5">{tierBadge(r.tier, r.label)}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap">{money(r.earned)}</td>
                            </>
                          ) : (
                            <>
                              <td colSpan={4} className="px-4 py-2.5 text-xs text-muted-foreground/70">
                                {!key ? "" : (r?.counted ?? 0) === 0 ? "No counted technicians at this branch" : "Waiting for numbers"}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground/60">—</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {lines.length > 1 && (
                      <tr className={`${band} border-b border-white/10`}>
                        <td colSpan={6} className="px-4 py-1.5 text-right text-[11px] text-muted-foreground">{nameOf(m)} · {lines.length} branches</td>
                        <td className="px-4 py-1.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">{money(managerTotal(m))}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
          {managers.length > 0 && (
            <tfoot className="sticky bottom-0">
              <tr className="border-t border-white/10 bg-slate-900">
                <td className="px-4 py-3 font-semibold" colSpan={6}>Total commission for period</td>
                <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-emerald-300 whitespace-nowrap">{money(grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>

    {/* Technicians — grouped by branch, under its manager */}
    <div className="panel p-0 overflow-hidden mt-4">
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-white/10 bg-slate-900">
              <th className={`${th} text-left`}>Tech</th>
              <th className={`${th} text-left`}>Counts as</th>
              <th className={`${th} text-right`}>Completion Ratio</th>
              <th className={`${th} text-right`}>LTP %</th>
              <th className={`${th} text-right`}>Tickets</th>
              <th className={`${th} text-center w-12`} />
            </tr>
          </thead>
          <tbody>
            {techGroups.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">No one currently holds a Technician-tier role.</td></tr>
            ) : (
              techGroups.map((g) => {
                const techs = techsByBranch.get(g.key) ?? [];
                const r = branchResult.get(g.key);
                const unmanaged = g.managerNames.length === 0;
                return (
                  <Fragment key={g.key || "none"}>
                    <tr className="border-b border-white/10 bg-white/[0.04]">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                          <span className="font-semibold">{labelOf(g.key)}</span>
                          {unmanaged ? (
                            <span className="text-[11px] text-amber-300">No manager — not counted in any commission</span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">BM: <span className="text-slate-200">{g.managerNames.join(", ")}</span></span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {r?.counted ?? 0} counted{r && r.trainees > 0 ? <span className="text-amber-300"> · {r.trainees} trainee{r.trainees === 1 ? "" : "s"}</span> : null}
                          </span>
                          {!unmanaged && hasNumbers(r) && r && (
                            <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                              <span>Completion <span className="text-slate-200 font-semibold">{r.completionPct}%</span></span>
                              <span>LTP <span className="text-slate-200 font-semibold">{r.ltpPct}%</span></span>
                              {tierBadge(r.tier, r.label)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {techs.map((t) => {
                      const v = techValues(t);
                      const row = rowsByProfileId.get(t.id);
                      const savingTrainee = savingKey === `${t.id}:isTrainee`;
                      return (
                        <tr key={t.id} className={`border-b border-white/5 hover:bg-white/[0.03] ${v.isTrainee ? "bg-amber-500/[0.03]" : ""}`}>
                          <td className="px-4 py-2 pl-7 whitespace-nowrap">
                            <div className={v.isTrainee ? "text-muted-foreground" : "font-medium"}>{nameOf(t)}</div>
                            <div className="text-[10px] text-muted-foreground">{roleOf(t)}</div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={v.isTrainee ? "trainee" : "regular"}
                                onChange={(e) => void saveTechField(t, "isTrainee", e.target.value === "trainee")}
                                disabled={savingTrainee || migrationMissing}
                                className={`glass-input text-xs py-1 px-2 rounded-md disabled:opacity-50 ${v.isTrainee ? "text-amber-300 border-amber-500/40" : ""}`}
                              >
                                <option value="regular">Regular</option>
                                <option value="trainee">Trainee</option>
                              </select>
                              {savingTrainee && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">{numberInput(t, "completionPct", v.completionPct, v.isTrainee)}</td>
                          <td className="px-4 py-2 text-right">{numberInput(t, "ltpPct", v.ltpPct, v.isTrainee)}</td>
                          <td className="px-4 py-2 text-right">{numberInput(t, "completedTickets", v.completedTickets, v.isTrainee)}</td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => void openRowHistory(t)}
                              disabled={!row}
                              title={row ? "View change history" : "Nothing saved yet for this period"}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                              <HistoryIcon className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>

    <div className="panel p-0 overflow-hidden mt-4">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm">Trend</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">One branch's Completion % and LTP % across every saved cut-off.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {trendLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <select value={trendBranch} onChange={(e) => setTrendBranch(e.target.value)} className="glass-input !w-auto text-sm py-1.5 px-2 rounded-md">
            {trendBranchOptions.length === 0 && <option value="">No branches yet</option>}
            {trendBranchOptions.map((k) => (
              <option key={k} value={k}>{labelOf(k)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="p-4">
        {trendChartData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No saved cut-offs for this branch yet — enter its technicians' numbers above for a period to see it plotted here.
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
