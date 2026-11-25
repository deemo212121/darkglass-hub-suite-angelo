/**
 * Branch Commission — Accounting Dashboard tab. Commission is earned by
 * the PERSON holding a Branch Manager or Senior Branch Manager role
 * (COMMISSION_MANAGER_ROLES — Technical Directors / Assistant Directors
 * don't earn it), per branch they manage, tiered
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
import { Loader2, History as HistoryIcon, X, ChevronDown, Upload, CheckCircle2, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { isAdminOrAboveHolder } from "@/lib/roleLabels";
import { BranchCommissionImportModal } from "@/components/BranchCommissionImportModal";
import {
  getBranchPeriods,
  upsertBranchPeriod,
  isBranchPeriodMissingError,
  type BranchPeriodRow,
  type BranchPeriodFields,
} from "@/lib/supabase/branchCommissionBranchPeriod";
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
import {
  getBranchManagerPicks,
  getTechBranchPicks,
  setBranchManagerPick,
  setTechBranchPick,
  isAssignmentsMissingError,
} from "@/lib/supabase/branchCommissionAssignments";
import { getCommissionPeriods, upsertCommissionPeriodLabel, type CommissionPeriod } from "@/lib/supabase/branchManagerCommissionPeriods";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";

// Plain field technicians + Tech Managers — TECHNICIAN_PAY_ROLES also
// includes Branch Manager/Senior Branch Manager/Technical (Assistant)
// Director (same "Technician" department per ROLE_DEPARTMENT_BREAKDOWN),
// but those are the managers — excluded here so no one is double-listed.
const TECHNICIAN_ONLY_ROLES = new Set([...TECHNICIAN_PAY_ROLES].filter((r) => !BM_AND_UP_ROLES.has(r)));
// Who earns branch commission and shows as a branch's "BM": Branch Managers and Senior Branch Managers only.
const COMMISSION_MANAGER_ROLES = new Set(["BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER"]);

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

// Finance pays by week, Sunday–Saturday (their sheet's W1 = 9/27–10/3).
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function weekBounds(iso?: string): { start: string; end: string } {
  const d = iso ? new Date(`${iso}T12:00:00`) : new Date();
  if (isNaN(d.getTime())) return weekBounds();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay(), 12);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 12);
  return { start: isoOf(start), end: isoOf(end) };
}
function shiftWeek(startIso: string, weeks: number) {
  const d = new Date(`${startIso}T12:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return weekBounds(isoOf(d));
}
const isWeek = (start: string, end: string) => { const w = weekBounds(start); return w.start === start && w.end === end; };
const usDate = (iso: string) => { const [y, m, d] = iso.split("-"); return y ? `${Number(m)}/${Number(d)}/${y}` : iso; };
/** Weeks for the period dropdown: 4 ahead of this week back to 52 before, newest first. */
function weekOptions(): Array<{ start: string; end: string }> {
  const now = weekBounds();
  const out: Array<{ start: string; end: string }> = [];
  for (let i = 4; i >= -52; i--) out.push(shiftWeek(now.start, i));
  return out;
}

function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// A branch has numbers once any counted tech has something typed in.
function hasNumbers(r: BranchResult | undefined): r is BranchResult {
  return !!r && r.counted > 0 && (r.completedTickets > 0 || r.completionPct > 0 || r.ltpPct > 0 || r.ticketsFromBranch);
}
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nameOf = (p: ProfileRow) => p.display_name || p.email || "";
const byName = (a: ProfileRow, b: ProfileRow) => nameOf(a).localeCompare(nameOf(b));
const roleOf = (p: ProfileRow) => ROLE_LABELS[normalizeRole(p.role)] || p.role;
// HR's own trainee flag — the Regular / Trainee pick starts here until Finance saves one for the period.
const hrTrainee = (p: ProfileRow) => p.employment_type === "trainee" && !p.trainee_access_granted;

type NumberField = "completionPct" | "ltpPct" | "completedTickets";
type BranchResult = ReturnType<typeof rollUpBranch> &
  ReturnType<typeof resolveCommissionTier> & {
    earned: number;
    ticketsFromBranch: boolean;
    // Combined view (2+ weeks ticked) only:
    weekTiers?: CommissionTier[];
    paidWeeks?: number;
    weeks?: number;
    paidEarned?: number;
  };
type WeekData = { start: string; end: string; rows: Map<string, TechCommissionRow>; bp: Map<string, BranchPeriodRow> };

export function BranchManagerCommissionTab() {
  const defaultPeriod = weekBounds();
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end);
  // Weeks ticked in the week list (Sunday dates). 2+ = combined, view-only.
  const [tickedWeeks, setTickedWeeks] = useState<string[]>([]);
  const combined = tickedWeeks.length > 1;
  const [weekData, setWeekData] = useState<WeekData[]>([]);
  const [weekMenuOpen, setWeekMenuOpen] = useState(false);
  const showWeek = (start: string, end?: string) => {
    setTickedWeeks([]);
    setPeriodStart(start);
    setPeriodEnd(end ?? weekBounds(start).end);
  };
  const applyTicked = (starts: string[]) => {
    const sorted = [...new Set(starts)].sort();
    if (sorted.length <= 1) {
      const w = weekBounds(sorted[0] ?? periodStart);
      showWeek(w.start, w.end);
      return;
    }
    setTickedWeeks(sorted);
    setPeriodStart(sorted[0]);
    setPeriodEnd(weekBounds(sorted[sorted.length - 1]).end);
  };
  const [managers, setManagers] = useState<ProfileRow[]>([]);
  const [technicians, setTechnicians] = useState<ProfileRow[]>([]);
  const [sbmRows, setSbmRows] = useState<SbmBranchAssignment[]>([]);
  const [rowsByProfileId, setRowsByProfileId] = useState<Map<string, TechCommissionRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  // Branch Commission-only picks (0476): branch key → manager id, and technician id → branch.
  const [managerPicks, setManagerPicks] = useState<Map<string, { profileId: string; branch: string }>>(new Map());
  const [techPicks, setTechPicks] = useState<Map<string, { branchKey: string; branch: string }>>(new Map());
  const [assignmentsMissing, setAssignmentsMissing] = useState(false);
  const [savingAssign, setSavingAssign] = useState<string | null>(null);
  // Per branch for the current period (0479): Flash tech, Damages, Total damage, branch tickets, note, Paid.
  const { uid, displayName, role, extraRoles } = useAuth();
  const [branchPeriods, setBranchPeriods] = useState<Map<string, BranchPeriodRow>>(new Map());
  const [branchPeriodMissing, setBranchPeriodMissing] = useState(false);
  const [savingBranch, setSavingBranch] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // Undo Paid: Accounting / Accounting Manager / Admin and up.
  const canUndoPaid =
    isAdminOrAboveHolder(role, extraRoles) ||
    [role, ...(extraRoles ?? [])].some((r) => ["FINANCE", "ACCOUNTING_MANAGER"].includes(normalizeRole(r ?? "")));

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
        setManagers(active.filter((p) => COMMISSION_MANAGER_ROLES.has(normalizeRole(p.role))).sort(byName));
        setTechnicians(active.filter((p) => TECHNICIAN_ONLY_ROLES.has(normalizeRole(p.role))).sort(byName));
      })
      .catch((err) => console.error("Failed to load commission rosters:", err));
    getSeniorBranchManagerAssignments()
      .then((rows) => { if (!cancelled) setSbmRows(rows); })
      .catch((err) => console.error("Failed to load branch assignments:", err));
    Promise.all([getBranchManagerPicks(), getTechBranchPicks()])
      .then(([mgr, tech]) => {
        if (cancelled) return;
        setManagerPicks(new Map(mgr.map((p) => [p.branchKey, { profileId: p.profileId, branch: p.branch }])));
        setTechPicks(new Map(tech.map((p) => [p.profileId, { branchKey: p.branchKey, branch: p.branch }])));
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (isAssignmentsMissingError(message)) setAssignmentsMissing(true);
        else console.error("Failed to load commission branch picks:", err);
      });
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
    if (!combined) { setWeekData([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(
      tickedWeeks.map(async (start) => {
        const w = weekBounds(start);
        const [rows, bp] = await Promise.all([getTechCommissionTally(w.start, w.end), getBranchPeriods(w.start, w.end).catch(() => [] as BranchPeriodRow[])]);
        return { start: w.start, end: w.end, rows: new Map(rows.map((r) => [r.profileId, r])), bp: new Map(bp.map((r) => [r.branchKey, r])) };
      })
    )
      .then((data) => { if (!cancelled) setWeekData(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickedWeeks.join(","), reloadTick]);

  useEffect(() => {
    if (combined || !periodStart || !periodEnd || periodStart > periodEnd) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodStart, periodEnd, reloadTick, combined]);

  useEffect(() => {
    if (combined || !periodStart || !periodEnd || periodStart > periodEnd) return;
    let cancelled = false;
    getBranchPeriods(periodStart, periodEnd)
      .then((rows) => {
        if (cancelled) return;
        setBranchPeriods(new Map(rows.map((r) => [r.branchKey, r])));
        setBranchPeriodMissing(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setBranchPeriods(new Map());
        if (isBranchPeriodMissingError(message)) setBranchPeriodMissing(true);
        else console.error("Failed to load branch details for the period:", err);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodStart, periodEnd, reloadTick, combined]);

  const currentPeriodSaved = useMemo(
    () => periods.some((p) => p.periodStart === periodStart && p.periodEnd === periodEnd),
    [periods, periodStart, periodEnd]
  );

  // Any OTHER saved period sharing a day with the current range — flagged, since shared days get double-counted.
  const overlappingPeriod = useMemo(() => {
    if (combined || !periodStart || !periodEnd) return null;
    return (
      periods.find(
        (p) =>
          !(p.periodStart === periodStart && p.periodEnd === periodEnd) &&
          periodStart <= p.periodEnd &&
          p.periodStart <= periodEnd
      ) ?? null
    );
  }, [periods, periodStart, periodEnd, combined]);

  // ---- Branch structure ----
  // Display spelling per normalized branch: Approval Chain's spelling first, then profiles'.
  const branchLabel = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sbmRows) if (s.branch && !seen.has(normBranch(s.branch))) seen.set(normBranch(s.branch), s.branch);
    for (const p of [...managers, ...technicians]) {
      if (p.assigned_branch && !seen.has(normBranch(p.assigned_branch))) seen.set(normBranch(p.assigned_branch), p.assigned_branch);
    }
    for (const [key, p] of managerPicks) if (!seen.has(key)) seen.set(key, p.branch);
    for (const p of techPicks.values()) if (!seen.has(p.branchKey)) seen.set(p.branchKey, p.branch);
    return seen;
  }, [sbmRows, managers, technicians, managerPicks, techPicks]);
  const labelOf = (key: string) => branchLabel.get(key) || "No branch";
  const byBranchLabel = (a: string, b: string) => labelOf(a).localeCompare(labelOf(b));

  // A manager's branches: their own assigned branch, plus the branches
  // Approval Chain gives a Senior Branch Manager that no other manager has
  // as their own — a region's branch with its own Branch Manager is that
  // manager's, not the Senior Branch Manager's.
  // Worked out from Assigned Branch + Approval Chain (before any Branch Commission pick).
  const autoBranchesOfManager = useMemo(() => {
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
  const autoManagerNamesOf = (key: string) => managers.filter((m) => (autoBranchesOfManager.get(m.id) ?? []).includes(key)).map(nameOf);

  // A branch picked on this tab counts only toward the picked manager (ignored if they're no longer an active BM / SBM).
  const branchesOfManager = useMemo(() => {
    const activeIds = new Set(managers.map((m) => m.id));
    const picked = new Map([...managerPicks].filter(([, p]) => activeIds.has(p.profileId)));
    const map = new Map<string, string[]>();
    for (const m of managers) {
      const keys = new Set((autoBranchesOfManager.get(m.id) ?? []).filter((k) => !picked.has(k)));
      for (const [k, p] of picked) if (p.profileId === m.id) keys.add(k);
      map.set(m.id, [...keys].sort(byBranchLabel));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managers, autoBranchesOfManager, managerPicks, branchLabel]);

  const techsByBranch = useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const t of technicians) {
      const key = techPicks.get(t.id)?.branchKey ?? normBranch(t.assigned_branch);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [technicians, techPicks]);

  const valuesIn = (rows: Map<string, TechCommissionRow>, t: ProfileRow) => {
    const row = rows.get(t.id);
    return {
      completionPct: row?.completionPct ?? 0,
      ltpPct: row?.ltpPct ?? 0,
      completedTickets: row?.completedTickets ?? 0,
      isTrainee: row?.isTrainee ?? hrTrainee(t),
    };
  };
  // Weighted by tickets; a plain average when no week has tickets.
  const blendPct = (items: Array<{ pct: number; w: number }>) => {
    if (items.length === 0) return 0;
    const total = items.reduce((s2, x) => s2 + x.w, 0);
    const v = total > 0 ? items.reduce((s2, x) => s2 + x.pct * x.w, 0) / total : items.reduce((s2, x) => s2 + x.pct, 0) / items.length;
    return Math.round(v * 10) / 10;
  };
  // Combined view: a technician's weeks added up (tickets) and blended (%).
  const techValues = (t: ProfileRow) => {
    if (!combined) return valuesIn(rowsByProfileId, t);
    const weeks = weekData.filter((w) => w.rows.has(t.id)).map((w) => valuesIn(w.rows, t));
    const last = weekData.length > 0 ? valuesIn(weekData[weekData.length - 1].rows, t) : valuesIn(new Map(), t);
    return {
      completionPct: blendPct(weeks.map((v) => ({ pct: v.completionPct, w: v.completedTickets }))),
      ltpPct: blendPct(weeks.map((v) => ({ pct: v.ltpPct, w: v.completedTickets }))),
      completedTickets: weeks.reduce((s2, v) => s2 + v.completedTickets, 0),
      isTrainee: last.isTrainee,
    };
  };

  const resultsFor = (rows: Map<string, TechCommissionRow>, bps: Map<string, BranchPeriodRow>) => {
    const map = new Map<string, BranchResult>();
    const keys = new Set<string>([...techsByBranch.keys(), ...[...branchesOfManager.values()].flat()]);
    for (const key of keys) {
      const rolled = rollUpBranch((techsByBranch.get(key) ?? []).map((t) => valuesIn(rows, t)));
      const override = bps.get(key)?.ticketsOverride ?? null;
      const roll = override === null ? rolled : { ...rolled, completedTickets: override };
      const tier = resolveCommissionTier(roll.completionPct, roll.ltpPct);
      map.set(key, { ...roll, ...tier, ticketsFromBranch: override !== null, earned: roll.counted === 0 ? 0 : tier.ratePerTicket * roll.completedTickets });
    }
    return map;
  };

  const branchResult = useMemo(() => {
    if (!combined) return resultsFor(rowsByProfileId, branchPeriods);
    // Each week gets its own Condition and $, then the weeks are added up — Finance pays week by week.
    const perWeek = weekData.map((w) => ({ w, res: resultsFor(w.rows, w.bp) }));
    const map = new Map<string, BranchResult>();
    const keys = new Set(perWeek.flatMap((x) => [...x.res.keys()]));
    for (const key of keys) {
      const weeks = perWeek.map((x) => ({ r: x.res.get(key)!, paid: !!x.w.bp.get(key)?.paidAt })).filter((x) => x.r);
      const withNumbers = weeks.filter((x) => hasNumbers(x.r));
      const completionPct = blendPct(withNumbers.map((x) => ({ pct: x.r.completionPct, w: x.r.completedTickets })));
      const ltpPct = blendPct(withNumbers.map((x) => ({ pct: x.r.ltpPct, w: x.r.completedTickets })));
      const tier = resolveCommissionTier(completionPct, ltpPct);
      map.set(key, {
        completionPct,
        ltpPct,
        completedTickets: weeks.reduce((s2, x) => s2 + x.r.completedTickets, 0),
        counted: Math.max(0, ...weeks.map((x) => x.r.counted)),
        trainees: Math.max(0, ...weeks.map((x) => x.r.trainees)),
        ...tier,
        ticketsFromBranch: weeks.some((x) => x.r.ticketsFromBranch),
        earned: weeks.reduce((s2, x) => s2 + x.r.earned, 0),
        weekTiers: withNumbers.map((x) => x.r.tier),
        weeks: weeks.length,
        paidWeeks: weeks.filter((x) => x.paid).length,
        paidEarned: weeks.reduce((s2, x) => s2 + (x.paid ? x.r.earned : 0), 0),
      });
    }
    return map;
    // valuesIn / resultsFor read the maps passed in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techsByBranch, branchesOfManager, rowsByProfileId, branchPeriods, combined, weekData]);
  const isPaid = (key: string | null | undefined) => !combined && !!key && !!branchPeriods.get(key)?.paidAt;
  // Combined view: Flash tech / Damages / Total damage across the ticked weeks.
  const combinedBranch = (key: string) => {
    const rows = weekData.map((w) => w.bp.get(key)).filter((r): r is BranchPeriodRow => !!r);
    const yn = (f: "flashTech" | "damages") => (rows.some((r) => r[f] === true) ? true : rows.length > 0 && rows.every((r) => r[f] === false) ? false : null);
    const counts = rows.map((r) => r.damageCount).filter((n): n is number => n !== null);
    return { flashTech: yn("flashTech"), damages: yn("damages"), damageCount: counts.length ? counts.reduce((a, b) => a + b, 0) : null };
  };
  const techBranchKey = (t: ProfileRow) => techPicks.get(t.id)?.branchKey ?? normBranch(t.assigned_branch);



  const managerTotal = (m: ProfileRow) => (branchesOfManager.get(m.id) ?? []).reduce((sum, k) => sum + (branchResult.get(k)?.earned ?? 0), 0);
  const grandTotal = managers.reduce((sum, m) => sum + managerTotal(m), 0);
  const paidTotal = managers.reduce(
    (sum, m) =>
      sum +
      (branchesOfManager.get(m.id) ?? []).reduce(
        (s2, k) => s2 + (combined ? branchResult.get(k)?.paidEarned ?? 0 : isPaid(k) ? branchResult.get(k)?.earned ?? 0 : 0),
        0
      ),
    0
  );
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

  const assignmentsError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (isAssignmentsMissingError(message)) setAssignmentsMissing(true);
    else setError(message);
  };
  const managerName = (id: string | null) => (id ? (managers.find((m) => m.id === id) ? nameOf(managers.find((m) => m.id === id)!) : id) : "Auto");
  const saveManagerPick = async (key: string, profileId: string) => {
    const branch = labelOf(key);
    const before = managerPicks.get(key)?.profileId ?? null;
    const to = profileId || null;
    if (before === to) return;
    setSavingAssign(`branch:${key}`);
    setError(null);
    try {
      await setBranchManagerPick(branch, to);
      setManagerPicks((prev) => {
        const next = new Map(prev);
        if (to) next.set(key, { profileId: to, branch });
        else next.delete(key);
        return next;
      });
      void logActivity({
        action: "branch_commission_manager_picked",
        targetType: "branch_commission_branch_managers",
        targetId: key,
        targetLabel: branch,
        details: { from: managerName(before), to: managerName(to) },
      });
    } catch (err) {
      assignmentsError(err);
    } finally {
      setSavingAssign(null);
    }
  };
  const saveTechBranch = async (tech: ProfileRow, key: string) => {
    if ((techPicks.get(tech.id)?.branchKey ?? "") === key) return;
    const assigned = `Assigned Branch (${tech.assigned_branch || "none"})`;
    const before = techPicks.get(tech.id)?.branch ?? null;
    const branch = key ? labelOf(key) : null;
    setSavingAssign(`tech:${tech.id}`);
    setError(null);
    try {
      await setTechBranchPick(tech.id, branch);
      setTechPicks((prev) => {
        const next = new Map(prev);
        if (key && branch) next.set(tech.id, { branchKey: key, branch });
        else next.delete(tech.id);
        return next;
      });
      void logActivity({
        action: "branch_commission_tech_moved",
        targetType: "branch_commission_tech_branches",
        targetId: tech.id,
        targetLabel: nameOf(tech),
        details: { from: before ?? assigned, to: branch ?? assigned },
      });
    } catch (err) {
      assignmentsError(err);
    } finally {
      setSavingAssign(null);
    }
  };
  // Every branch a technician can be moved to.
  const allBranchKeys = useMemo(
    () => [...branchLabel.keys()].filter(Boolean).sort(byBranchLabel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchLabel]
  );

  const saveBranchField = async (key: string, fields: BranchPeriodFields, what: string) => {
    const before = branchPeriods.get(key);
    setSavingBranch(`${key}:${what}`);
    setError(null);
    try {
      const saved = await upsertBranchPeriod(labelOf(key), periodStart, periodEnd, fields);
      setBranchPeriods((prev) => new Map(prev).set(key, saved));
      const pick = (r: BranchPeriodRow | undefined) =>
        what === "paid" ? (r?.paidAt ? `Paid (${r.paidByName || "?"})` : "Not paid")
        : what === "flashTech" ? r?.flashTech ?? null
        : what === "damages" ? r?.damages ?? null
        : what === "damageCount" ? r?.damageCount ?? null
        : what === "ticketsOverride" ? r?.ticketsOverride ?? null
        : r?.note ?? "";
      void logActivity({
        action: what === "paid" ? (saved.paidAt ? "branch_commission_marked_paid" : "branch_commission_paid_undone") : "branch_commission_branch_value_changed",
        targetType: "branch_commission_branch_period",
        targetId: saved.id,
        targetLabel: `${labelOf(key)} — ${periodStart} to ${periodEnd}`,
        details: { field: what, from: pick(before), to: pick(saved), ...(what === "paid" ? { amount: branchResult.get(key)?.earned ?? 0 } : {}) },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isBranchPeriodMissingError(message)) setBranchPeriodMissing(true);
      else setError(message);
    } finally {
      setSavingBranch(null);
    }
  };
  const markPaid = async (key: string) => {
    const amount = branchResult.get(key)?.earned ?? 0;
    if (!confirm(`Mark ${labelOf(key)} as Paid for ${periodStart} to ${periodEnd} (${money(amount)})?\n\nIts numbers lock for this period. This is for tracking only — nothing is sent to payroll.`)) return;
    const myId = uid ? await getMyProfileId(uid).catch(() => null) : null;
    await saveBranchField(key, { paidAt: new Date().toISOString(), paidBy: myId, paidByName: displayName || "" }, "paid");
  };
  const undoPaid = async (key: string) => {
    if (!confirm(`Undo Paid for ${labelOf(key)} (${periodStart} to ${periodEnd})? Its numbers unlock.`)) return;
    await saveBranchField(key, { paidAt: null, paidBy: null, paidByName: null }, "paid");
  };
  const yesNoText = (v: boolean | null) =>
    v === null ? <span className="text-muted-foreground">—</span> : (
      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${v ? "border-rose-400/50 bg-rose-500/20 text-rose-200" : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"}`}>
        {v ? "Yes" : "No"}
      </span>
    );
  const yesNoValue = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "");
  const yesNoSelect = (key: string, field: "flashTech" | "damages", value: boolean | null | undefined) => (
    <select
      value={yesNoValue(value)}
      onChange={(e) => void saveBranchField(key, { [field]: e.target.value === "" ? null : e.target.value === "yes" }, field)}
      disabled={branchPeriodMissing || isPaid(key) || savingBranch !== null}
      className={`glass-input !w-auto text-[11px] py-0.5 px-2 rounded-full font-semibold disabled:opacity-60 ${
        value === true ? "!bg-rose-500/20 !border-rose-400/50 text-rose-200" : value === false ? "!bg-emerald-500/15 !border-emerald-400/40 text-emerald-200" : "text-muted-foreground"
      }`}
    >
      <option value="">—</option>
      <option value="no">No</option>
      <option value="yes">Yes</option>
    </select>
  );
  const branchNumberInput = (key: string, field: "damageCount" | "ticketsOverride", value: number | null | undefined, placeholder: string) => (
    <input
      key={`${key}:${field}:${value ?? ""}:${periodStart}:${periodEnd}`}
      type="number"
      min="0"
      step="1"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const rawValue = e.target.value.trim();
        const next = rawValue === "" ? null : Math.max(0, Math.round(Number(rawValue) || 0));
        if (next === (value ?? null)) return;
        void saveBranchField(key, { [field]: next }, field);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      disabled={branchPeriodMissing || isPaid(key) || savingBranch !== null}
      className="glass-input text-sm py-1 px-2 rounded-md text-right tabular-nums w-[4.5rem] disabled:opacity-50"
    />
  );

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
    showWeek(period.periodStart, period.periodEnd);
    setHistoryMenuOpen(false);
  };

  const th = "px-4 py-2.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase whitespace-nowrap";

  const numberInput = (tech: ProfileRow, field: NumberField, value: number, hidden: boolean) => {
    const saving = savingKey === `${tech.id}:${field}`;
    const locked = isPaid(techBranchKey(tech));
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
          disabled={saving || migrationMissing || locked || combined}
          title={combined ? "Combined weeks are view-only — pick one week to edit" : locked ? "This branch is marked Paid for this period — undo Paid to change it" : undefined}
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
    {importOpen && (
      <BranchCommissionImportModal
        onClose={() => setImportOpen(false)}
        periods={periods}
        importerName={displayName || ""}
        saveBlocked={branchPeriodMissing ? "Run migration 0479_branch_commission_branch_period.sql in Supabase first — until then this is a preview only." : null}
        context={() => ({
          branches: new Map([...branchLabel].filter(([k]) => !!k)),
          technicians: technicians.map((t) => ({ id: t.id, name: nameOf(t), branchKey: techBranchKey(t) })),
          managersOf: (key) => managers.filter((m) => (branchesOfManager.get(m.id) ?? []).includes(key)).map(nameOf),
        })}
        onImported={(first) => {
          refreshPeriods();
          if (first) showWeek(first.start, first.end);
          setReloadTick((n) => n + 1);
        }}
      />
    )}
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
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            disabled={migrationMissing}
            title="Import Finance's weekly Branch Commission sheet — shows a preview first"
            className="btn text-xs px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
          <div className="relative flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-1 py-1">
            <button type="button" onClick={() => { const w = shiftWeek(weekBounds(periodStart).start, -1); showWeek(w.start, w.end); }} title="Previous week" className="px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-white/10">‹</button>
            <button
              type="button"
              onClick={() => setWeekMenuOpen((v) => !v)}
              title="Pay week, Sunday–Saturday — tick more than one to see them combined"
              className="glass-input !w-auto text-sm py-1 px-2 rounded-md tabular-nums inline-flex items-center gap-2"
            >
              {combined
                ? `${tickedWeeks.length} weeks: ${usDate(periodStart)} – ${usDate(periodEnd)}`
                : `${usDate(periodStart)} – ${usDate(periodEnd)}${isWeek(periodStart, periodEnd) ? (periodStart === weekBounds().start ? " (this week)" : "") : " (saved range)"}`}
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {weekMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setWeekMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1 w-72 rounded-lg border border-white/10 bg-slate-900 shadow-2xl z-30">
                  <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">Click a week to open it · tick boxes to combine</span>
                    {combined && (
                      <button type="button" onClick={() => showWeek(periodStart)} className="text-[10px] text-sky-300 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto py-1">
                    {weekOptions().map((w) => {
                      const ticked = combined ? tickedWeeks.includes(w.start) : w.start === periodStart && w.end === periodEnd;
                      const current = !combined && ticked;
                      return (
                        <div key={w.start} className={`flex items-center gap-2 px-3 py-1.5 text-sm tabular-nums hover:bg-white/5 ${current ? "bg-sky-500/10" : ""}`}>
                          <input
                            type="checkbox"
                            checked={ticked}
                            onChange={() => {
                              const base = combined ? tickedWeeks : isWeek(periodStart, periodEnd) ? [periodStart] : [];
                              applyTicked(ticked ? base.filter((x) => x !== w.start) : [...base, w.start]);
                            }}
                            className="h-3.5 w-3.5 accent-sky-500 cursor-pointer"
                            aria-label={`Combine ${usDate(w.start)} – ${usDate(w.end)}`}
                          />
                          <button
                            type="button"
                            onClick={() => { showWeek(w.start, w.end); setWeekMenuOpen(false); }}
                            className={`flex-1 text-left ${ticked ? "text-white" : "text-slate-300"}`}
                          >
                            {usDate(w.start)} – {usDate(w.end)}
                            {w.start === weekBounds().start && <span className="text-[10px] text-sky-300"> (this week)</span>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <button type="button" onClick={() => { const w = shiftWeek(weekBounds(periodStart).start, 1); showWeek(w.start, w.end); }} title="Next week" className="px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-white/10">›</button>
            <button type="button" onClick={() => { const w = weekBounds(); showWeek(w.start, w.end); }} className="px-2 py-1 rounded text-[11px] text-slate-400 hover:text-white hover:bg-white/10">This week</button>
          </div>
          {!combined && (
            <>
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
            </>
          )}
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

      {(combined || overlappingPeriod || migrationMissing || assignmentsMissing || branchPeriodMissing || error || periodStart > periodEnd) && (
        <div className="px-5 pt-3 space-y-2">
          {combined && (
            <p className="text-xs text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded-md px-3 py-2">
              Showing {tickedWeeks.length} weeks combined ({tickedWeeks.map((w) => usDate(w)).join(", ")}): tickets added up, % weighted by tickets,
              and each week's Condition and $ worked out on its own, then added. View only — pick one week to edit or mark as paid.
            </p>
          )}
          {periodStart > periodEnd && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              The start date ({usDate(periodStart)}) is after the end date ({usDate(periodEnd)}) — nothing can load. Pick a week from the list.
            </p>
          )}
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
          {assignmentsMissing && (
            <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              Run migration <code>0476_branch_commission_assignments.sql</code> in Supabase to pick a branch's manager or move a technician to another branch here.
            </p>
          )}
          {branchPeriodMissing && (
            <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              Run migration <code>0479_branch_commission_branch_period.sql</code> in Supabase for Flash tech, Damages, Total damage, Mark as Paid and Import.
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
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            Paid <span className="text-emerald-300 font-semibold">{money(paidTotal)}</span> · Unpaid <span className="text-amber-300 font-semibold">{money(grandTotal - paidTotal)}</span>
          </div>
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
              <th className={`${th} text-left`}>Flash tech</th>
              <th className={`${th} text-left`}>Damages</th>
              <th className={`${th} text-right`}>Total damage</th>
              <th className={`${th} text-left`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {managers.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground text-sm">No one currently holds a Branch Manager-tier role.</td></tr>
            ) : (
              managers.map((m, mi) => {
                const keys = branchesOfManager.get(m.id) ?? [];
                const lines = keys.length > 0 ? keys : [null];
                const band = mi % 2 === 1 ? "bg-white/[0.02]" : "";
                return (
                  <Fragment key={m.id}>
                    {lines.map((key, i) => {
                      const r = key ? branchResult.get(key) : undefined;
                      const bp = key && !combined ? branchPeriods.get(key) : undefined;
                      const cb = key && combined ? combinedBranch(key) : null;
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
                            {key && bp?.note && <div className="text-[10px] text-amber-200/80 mt-0.5 max-w-[14rem] whitespace-normal">{bp.note}</div>}
                          </td>
                          {key && hasNumbers(r) && r ? (
                            <>
                              <td className="px-4 py-2.5 text-right tabular-nums">{r.completionPct}%</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{r.ltpPct}%</td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="inline-flex flex-col items-end gap-0.5">
                                  {combined ? (
                                    <span className="tabular-nums">{r.completedTickets}</span>
                                  ) : (
                                    branchNumberInput(key, "ticketsOverride", bp?.ticketsOverride, String(r.ticketsFromBranch ? "" : r.completedTickets))
                                  )}
                                  <span className="text-[9px] text-muted-foreground">{combined ? `${r.weeks ?? 0} weeks added up` : r.ticketsFromBranch ? "branch total" : "techs added up"}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {combined ? (
                                  <span className="inline-flex items-center gap-1 flex-wrap" title="Each week's own Condition">
                                    {(r.weekTiers ?? []).map((t, wi) => (
                                      <span key={wi} className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${TIER_BADGE_CLASSES[t]}`}>C{t}</span>
                                    ))}
                                  </span>
                                ) : (
                                  tierBadge(r.tier, r.label)
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap">{money(r.earned)}</td>
                            </>
                          ) : (
                            <>
                              <td colSpan={2} className="px-4 py-2.5 text-xs text-muted-foreground/70">
                                {!key ? "" : (r?.counted ?? 0) === 0 ? "No counted technicians at this branch" : "Waiting for numbers"}
                              </td>
                              <td className="px-4 py-2.5 text-right">{key && !combined ? branchNumberInput(key, "ticketsOverride", bp?.ticketsOverride, "0") : null}</td>
                              <td className="px-4 py-2.5" />
                              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground/60">—</td>
                            </>
                          )}
                          <td className="px-4 py-2.5">{cb ? yesNoText(cb.flashTech) : key ? yesNoSelect(key, "flashTech", bp?.flashTech) : null}</td>
                          <td className="px-4 py-2.5">{cb ? yesNoText(cb.damages) : key ? yesNoSelect(key, "damages", bp?.damages) : null}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{cb ? cb.damageCount ?? "—" : key ? branchNumberInput(key, "damageCount", bp?.damageCount, "—") : null}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {!key ? null : combined ? (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                                  r?.weeks && r.paidWeeks === r.weeks ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" : r?.paidWeeks ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/15 text-muted-foreground"
                                }`}
                              >
                                {r?.paidWeeks ?? 0} of {tickedWeeks.length} weeks paid
                              </span>
                            ) : bp?.paidAt ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200"
                                  title={`Paid by ${bp.paidByName || "—"} on ${new Date(bp.paidAt).toLocaleString()}`}
                                >
                                  <CheckCircle2 className="h-3 w-3" /> Paid
                                </span>
                                {canUndoPaid && (
                                  <button
                                    type="button"
                                    onClick={() => void undoPaid(key)}
                                    disabled={savingBranch !== null}
                                    title="Undo Paid (unlocks this branch's numbers)"
                                    className="rounded-md p-1 text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30"
                                  >
                                    <Undo2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void markPaid(key)}
                                disabled={branchPeriodMissing || savingBranch !== null}
                                className="btn text-[11px] py-0.5 px-2.5 disabled:opacity-40"
                              >
                                {savingBranch === `${key}:paid` ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Mark as Paid
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {lines.length > 1 && (
                      <tr className={`${band} border-b border-white/10`}>
                        <td colSpan={6} className="px-4 py-1.5 text-right text-[11px] text-muted-foreground">{nameOf(m)} · {lines.length} branches</td>
                        <td className="px-4 py-1.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">{money(managerTotal(m))}</td>
                        <td colSpan={4} />
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
                <td className="px-4 py-3 font-semibold" colSpan={6}>{combined ? `Total commission for ${tickedWeeks.length} weeks` : "Total commission for period"}</td>
                <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-emerald-300 whitespace-nowrap">{money(grandTotal)}</td>
                <td colSpan={4} className="px-4 py-3 text-[11px] text-muted-foreground tabular-nums">
                  Paid {money(paidTotal)} · Unpaid {money(grandTotal - paidTotal)}
                </td>
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
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            BM:
                            <select
                              value={managers.some((m) => m.id === managerPicks.get(g.key)?.profileId) ? managerPicks.get(g.key)!.profileId : ""}
                              onChange={(e) => void saveManagerPick(g.key, e.target.value)}
                              disabled={!g.key || assignmentsMissing || savingAssign !== null || isPaid(g.key)}
                              title={g.key ? "Whose commission this branch counts toward (Branch Commission only — profiles and Approval Chain don't change)" : "Technicians with no branch can't be given a manager"}
                              className={`glass-input !w-auto text-[11px] py-0.5 px-1.5 rounded-md disabled:opacity-50 ${unmanaged ? "text-amber-300 border-amber-500/40" : "text-slate-200"}`}
                            >
                              <option value="">
                                {autoManagerNamesOf(g.key).length > 0 ? `${autoManagerNamesOf(g.key).join(", ")} (from profiles / Approval Chain)` : "No manager — not counted in any commission"}
                              </option>
                              {managers.map((m) => (
                                <option key={m.id} value={m.id}>{nameOf(m)} — {roleOf(m)}</option>
                              ))}
                            </select>
                            {savingAssign === `branch:${g.key}` && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                          </span>
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
                            <div className="mt-1 flex items-center gap-1.5">
                              <select
                                value={techPicks.get(t.id)?.branchKey ?? ""}
                                onChange={(e) => void saveTechBranch(t, e.target.value)}
                                disabled={assignmentsMissing || savingAssign !== null || isPaid(techBranchKey(t))}
                                title="Branch this technician's numbers count under (Branch Commission only — their profile doesn't change)"
                                className={`glass-input !w-auto text-[10px] py-0.5 px-1.5 rounded-md disabled:opacity-50 ${techPicks.has(t.id) ? "text-sky-300 border-sky-500/40" : "text-muted-foreground"}`}
                              >
                                <option value="">Assigned Branch ({t.assigned_branch || "none"})</option>
                                {allBranchKeys.filter((k) => k !== normBranch(t.assigned_branch)).map((k) => (
                                  <option key={k} value={k}>{labelOf(k)}</option>
                                ))}
                              </select>
                              {savingAssign === `tech:${t.id}` && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={v.isTrainee ? "trainee" : "regular"}
                                onChange={(e) => void saveTechField(t, "isTrainee", e.target.value === "trainee")}
                                disabled={savingTrainee || migrationMissing || isPaid(techBranchKey(t)) || combined}
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
                              disabled={!row || combined}
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
