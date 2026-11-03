/**
 * HR / Accounting → Incentives — technicians reaching 6 months and the
 * three incentives that come with it (rules: src/lib/techIncentives.ts):
 * HR Incentive $100 to the recruiter, Branch Manager Incentive $500 (6-month
 * average grade C or better, still employed), and the technician's $500
 * match, added when the Branch Manager's is approved.
 *
 * In the table HR picks who gets each one (the recruiter from a dropdown;
 * the Branch Manager filled in from the branch, blank when there's none) —
 * saved as they pick — and every technician's 6-month average grade loads
 * on its own from Technician Performance. Once the 6 months are up HR
 * submits; Accounting (Finance) or Super Admin approves, which puts it on
 * payroll for the pay period it's approved in.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, Award, Check, X, Undo2, Send, AlertTriangle, ArrowDownUp, Search } from "lucide-react";
import { toast } from "sonner";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { AppModal } from "@/components/ui-kit/AppModal";
import { GradeMedal, letterGrade, payPeriodsThrough, shortPoints, gradeName, type LetterGrade } from "@/components/techPerformanceGrading";
import { getPerformanceLoader } from "@/lib/supabase/myPerformance";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import {
  approveIncentive,
  getIncentiveCases,
  getTechIncentives,
  isBranchManagerPerson,
  isTraineePerson,
  notifyAboutIncentive,
  rejectIncentive,
  retainedAtSixMonths,
  setIncentiveRecipient,
  submitIncentive,
  undoIncentiveApproval,
  withdrawIncentive,
  type IncentiveCase,
  type IncentiveGradePeriod,
  type IncentivePerson,
  type TechIncentive,
} from "@/lib/supabase/techIncentives";
import {
  HR_INCENTIVE_RECRUITERS,
  INCENTIVE_AMOUNT,
  INCENTIVE_LABEL,
  INCENTIVE_STARTED_ON_OR_AFTER,
  MIN_GRADE_POINTS,
  daysUntil,
  type IncentiveKind,
} from "@/lib/techIncentives";
import { anyHeldRoleIn, isCompanySuperAdminRole, isFinanceRole } from "@/lib/roleLabels";
import { addDaysISO, todayISO } from "@/lib/localDate";
import { payPeriodContaining } from "@/lib/payPeriods";

const SUBMIT_ROLES = new Set(["HR", "ADMIN", "FINANCE"]);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtPeriod = (s: string | null, e: string | null) => (s && e ? `${fmtDate(s).replace(/, \d{4}$/, "")} – ${fmtDate(e)}` : "—");
const periodsTitle = (periods: IncentiveGradePeriod[]) => periods.map((p) => `${fmtPeriod(p.start, p.end)}: ${gradeName(p.grade as LetterGrade)} (${p.points} pts)`).join("\n");

interface SixMonthGrade {
  /** Average points over the graded pay periods; null with none to grade. */
  points: number | null;
  grade: LetterGrade | null;
  periods: IncentiveGradePeriod[];
  /** The 6 months are over (otherwise it's the grade so far). */
  complete: boolean;
}

/**
 * Every technician's Technician Performance grade over their 6 months, in
 * one read: each graded pay period fully inside the 6 months (from the
 * first graded period, 08/27, on), its points averaged. Before the 6-month
 * mark it's the periods finished so far. Technicians who left before 6
 * months aren't graded.
 */
async function gradeEveryone(cases: IncentiveCase[], today: string): Promise<Record<string, SixMonthGrade>> {
  const lastFinished = addDaysISO(today, -1);
  const windows = cases
    .filter((c) => retainedAtSixMonths(c))
    .map((c) => {
      const complete = c.sixMonthDate <= today;
      const end = complete ? c.sixMonthDate : lastFinished;
      return { c, complete, periods: payPeriodsThrough(end).filter((p) => p.start >= c.startDate && p.end <= end) };
    });
  const all = windows.flatMap((w) => w.periods);
  const out: Record<string, SixMonthGrade> = {};
  if (all.length === 0) {
    for (const w of windows) out[w.c.technician.id] = { points: null, grade: null, periods: [], complete: w.complete };
    return out;
  }
  const spanStart = all.reduce((m, p) => (p.start < m ? p.start : m), all[0].start);
  const spanEnd = all.reduce((m, p) => (p.end > m ? p.end : m), all[0].end);
  const perf = await getPerformanceLoader(windows.map((w) => w.c.technician.id), spanStart, spanEnd);
  for (const w of windows) {
    const graded = w.periods.map((p) => {
      const points = shortPoints(perf(w.c.technician.id, p.start, p.end));
      return { start: p.start, end: p.end, points, grade: letterGrade(points) };
    });
    const points = graded.length ? graded.reduce((s, g) => s + g.points, 0) / graded.length : null;
    out[w.c.technician.id] = { points, grade: points == null ? null : letterGrade(points), periods: graded, complete: w.complete };
  }
  return out;
}

type Filter = "all" | "needs-hr" | "waiting" | "upcoming" | "done" | "not-eligible";
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  "needs-hr": "Needs HR",
  waiting: "Waiting on Accounting",
  upcoming: "Upcoming",
  done: "Done",
  "not-eligible": "Left before 6 months",
};

type SortKey = "closest" | "six-month" | "name" | "branch" | "grade";
const SORT_LABEL: Record<SortKey, string> = {
  closest: "Closest to 6 months",
  "six-month": "6-month date (earliest first)",
  name: "Technician A–Z",
  branch: "Branch",
  grade: "Grade (highest first)",
};
const SORT_KEY = "ahs:incentives-sort";

type Dialog =
  | { type: "submit"; c: IncentiveCase; picks: { kind: "hr" | "branch_manager"; recipientId: string; existing: TechIncentive | null }[] }
  | { type: "approve"; inc: TechIncentive }
  | { type: "reject"; inc: TechIncentive }
  | { type: "undo"; inc: TechIncentive }
  | { type: "withdraw"; inc: TechIncentive };

const STATUS_PILL: Record<string, string> = {
  pending: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  approved: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  rejected: "border-red-400/30 bg-red-500/10 text-red-200",
  muted: "border-white/10 bg-white/5 text-slate-400",
  ready: "border-sky-400/30 bg-sky-500/10 text-sky-200",
};
function Pill({ tone, children }: { tone: keyof typeof STATUS_PILL; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[tone]}`}>{children}</span>;
}
const SELECT_CLASS = "w-full min-w-[11rem] bg-slate-800/60 border border-white/10 rounded-md px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-60";

export function IncentivesPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, displayName, role, extraRoles } = useAuth();
  const canSubmit = anyHeldRoleIn(SUBMIT_ROLES, role, extraRoles) || isCompanySuperAdminRole(role, extraRoles);
  const canApprove = isFinanceRole(role, extraRoles) || isCompanySuperAdminRole(role, extraRoles);
  const today = todayISO();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<IncentiveCase[]>([]);
  const [people, setPeople] = useState<IncentivePerson[]>([]);
  const [missingStartDate, setMissingStartDate] = useState<IncentivePerson[]>([]);
  const [incentives, setIncentives] = useState<TechIncentive[] | null>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, SixMonthGrade> | "loading" | "error">("loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSortState] = useState<SortKey>(() => {
    try {
      const v = localStorage.getItem(SORT_KEY) as SortKey | null;
      return v && v in SORT_LABEL ? v : "closest";
    } catch {
      return "closest";
    }
  });
  const setSort = (v: SortKey) => {
    setSortState(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* private mode — just not remembered */
    }
  };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadGrades = (list: IncentiveCase[]) => {
    setGrades("loading");
    gradeEveryone(list, today)
      .then(setGrades)
      .catch((err) => {
        console.error("Incentives: grades failed to load:", err);
        setGrades("error");
      });
  };
  const reloadIncentives = async () => setIncentives(await getTechIncentives());
  const load = async () => {
    setError(null);
    try {
      const [{ cases, people, missingStartDate }, rows] = await Promise.all([getIncentiveCases(), getTechIncentives()]);
      setCases(cases);
      setPeople(people);
      setMissingStartDate(missingStartDate);
      setIncentives(rows);
      loadGrades(cases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load incentives.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    if (uid) getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const nameOf = (id: string | null | undefined) => (id ? personById.get(id)?.display_name || HR_INCENTIVE_RECRUITERS[id] || "Unknown" : "—");
  const byTechnician = useMemo(() => {
    const map = new Map<string, Partial<Record<IncentiveKind, TechIncentive>>>();
    for (const r of incentives ?? []) map.set(r.technicianId, { ...(map.get(r.technicianId) ?? {}), [r.kind]: r });
    return map;
  }, [incentives]);
  const approverIds = useMemo(() => people.filter((p) => p.is_active && isFinanceRole(p.role, p.extra_roles)).map((p) => p.id), [people]);
  const branchManagers = useMemo(
    () => people.filter((p) => p.is_active && isBranchManagerPerson(p)).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")),
    [people]
  );

  // Not submitted yet: nothing saved, only picked (planned), or rejected.
  const isOpen = (r?: TechIncentive) => !r || r.status === "planned" || r.status === "rejected";
  /** Who's picked in the table: the saved pick, else the suggestion (recruiter from the Hiring record, the branch's Branch Manager), else blank. */
  const pickedFor = (c: IncentiveCase, kind: "hr" | "branch_manager", r?: TechIncentive) =>
    r ? r.recipientId : kind === "hr" ? c.suggestedRecruiterId : c.suggestedBranchManagerId;

  const views = useMemo(
    () =>
      cases.map((c) => {
        const rows = byTechnician.get(c.technician.id) ?? {};
        const days = daysUntil(c.sixMonthDate, today);
        const due = days <= 0;
        const retained = retainedAtSixMonths(c);
        const g = typeof grades === "object" ? grades[c.technician.id] : undefined;
        const gradeOk = g?.complete ? (g.points ?? -Infinity) >= MIN_GRADE_POINTS : null;
        const needsHr = due && retained && (isOpen(rows.hr) || (isOpen(rows.branch_manager) && gradeOk !== false));
        const waiting = rows.hr?.status === "pending" || rows.branch_manager?.status === "pending";
        const done = due && !needsHr && !waiting && (rows.hr?.status === "approved" || rows.branch_manager?.status === "approved");
        const leftEarly = !retained && isOpen(rows.hr) && isOpen(rows.branch_manager);
        // Which filter chips the row is under — a row can be under more than one (e.g. one waiting on Accounting, the other still to submit).
        const under: Record<Filter, boolean> = { all: !leftEarly, "needs-hr": needsHr, waiting, upcoming: !due && retained, done, "not-eligible": leftEarly };
        // What Submit would send: an open incentive with someone picked (the Branch Manager's only at C or better).
        const submittable: { kind: "hr" | "branch_manager"; recipientId: string; existing: TechIncentive | null }[] = [];
        const hrPick = pickedFor(c, "hr", rows.hr);
        const bmPick = pickedFor(c, "branch_manager", rows.branch_manager);
        if (due && retained && isOpen(rows.hr) && hrPick) submittable.push({ kind: "hr", recipientId: hrPick, existing: rows.hr ?? null });
        if (due && retained && isOpen(rows.branch_manager) && gradeOk && bmPick) submittable.push({ kind: "branch_manager", recipientId: bmPick, existing: rows.branch_manager ?? null });
        return { c, rows, days, due, retained, grade: g, gradeOk, needsHr, under, submittable };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cases, byTechnician, grades, today]
  );

  // Search: the technician's name / email / branch, or who's picked (or approved) for their incentives.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return views;
    return views.filter((v) => {
      const names = [
        v.c.technician.display_name,
        v.c.technician.email,
        v.c.technician.assigned_branch,
        nameOf(pickedFor(v.c, "hr", v.rows.hr)),
        nameOf(pickedFor(v.c, "branch_manager", v.rows.branch_manager)),
      ];
      return names.some((n) => (n || "").toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, search, personById]);

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: 0, "needs-hr": 0, waiting: 0, upcoming: 0, done: 0, "not-eligible": 0 };
    for (const v of searched) for (const f of Object.keys(out) as Filter[]) if (v.under[f]) out[f]++;
    return out;
  }, [searched]);

  const shown = useMemo(() => {
    const list = searched.filter((v) => v.under[filter]);
    const name = (v: (typeof views)[number]) => v.c.technician.display_name || "";
    const byName = (a: (typeof views)[number], b: (typeof views)[number]) => name(a).localeCompare(name(b));
    const sorted = [...list];
    if (sort === "closest") {
      // Not there yet, fewest days left first; then the ones already past 6 months, most recent first.
      sorted.sort((a, b) => (a.days > 0) !== (b.days > 0) ? (a.days > 0 ? -1 : 1) : a.days > 0 ? a.days - b.days || byName(a, b) : b.days - a.days || byName(a, b));
    } else if (sort === "six-month") {
      sorted.sort((a, b) => a.c.sixMonthDate.localeCompare(b.c.sixMonthDate) || byName(a, b));
    } else if (sort === "name") {
      sorted.sort(byName);
    } else if (sort === "branch") {
      sorted.sort((a, b) => (a.c.technician.assigned_branch || "~").localeCompare(b.c.technician.assigned_branch || "~") || a.days - b.days);
    } else {
      // The grade the row shows: the one saved when the Branch Manager's was submitted, else the live one.
      const pts = (v: (typeof views)[number]) => {
        const bm = v.rows.branch_manager;
        return (bm && !isOpen(bm) ? bm.gradePoints : v.grade?.points) ?? -Infinity;
      };
      sorted.sort((a, b) => pts(b) - pts(a) || byName(a, b));
    }
    return sorted;
  }, [searched, filter, sort]);

  const log = (action: string, inc: { id: string; kind: IncentiveKind; technicianId: string; recipientId: string | null; amount: number }, details: Record<string, unknown> = {}) =>
    void logModuleActivity({
      module: "accounting",
      actorName: displayName || "Unknown",
      action,
      targetType: "tech_incentive",
      targetId: inc.id,
      targetLabel: `${INCENTIVE_LABEL[inc.kind]} ${money(inc.amount)} — ${nameOf(inc.recipientId)} (technician ${nameOf(inc.technicianId)})`,
      details,
    });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setDialog(null);
      await reloadIncentives();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  // Saving a pick from a table dropdown.
  const pick = async (v: (typeof views)[number], kind: "hr" | "branch_manager", recipientId: string | null) => {
    const key = `${v.c.technician.id}:${kind}`;
    setSavingKey(key);
    try {
      const existing = v.rows[kind] ?? null;
      await setIncentiveRecipient({ technicianId: v.c.technician.id, kind, recipientId, startDate: v.c.startDate, sixMonthDate: v.c.sixMonthDate, existing });
      void logModuleActivity({
        module: "accounting",
        actorName: displayName || "Unknown",
        action: "incentive_recipient_set",
        targetType: "tech_incentive",
        targetId: existing?.id ?? v.c.technician.id,
        targetLabel: `${INCENTIVE_LABEL[kind]} — ${recipientId ? nameOf(recipientId) : "nobody"} (technician ${v.c.technician.display_name})`,
        details: { from: existing ? nameOf(existing.recipientId) : null, to: recipientId ? nameOf(recipientId) : null },
      });
      await reloadIncentives();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSavingKey(null);
    }
  };

  const gradeCell = (v: (typeof views)[number]) => {
    if (!v.retained) return <span className="text-[11px] text-slate-500">—</span>;
    const stored = v.rows.branch_manager && !isOpen(v.rows.branch_manager) ? v.rows.branch_manager : undefined;
    if (stored?.grade && stored.gradePoints != null) {
      return (
        <div title={periodsTitle(stored.gradePeriods)}>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-200"><GradeMedal grade={stored.grade as LetterGrade} size="sm" /> {gradeName(stored.grade as LetterGrade)}</span>
          <div className="text-[11px] text-slate-500">{stored.gradePoints.toFixed(1)} pts avg · {stored.gradePeriods.length} pay periods · when submitted</div>
        </div>
      );
    }
    if (grades === "loading") return <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</span>;
    if (grades === "error") return <button type="button" onClick={() => loadGrades(cases)} className="text-[11px] text-red-300 underline">Couldn't load — retry</button>;
    const g = v.grade;
    if (!g || g.points == null || !g.grade) return <span className="text-[11px] text-slate-500">No graded pay periods{g?.complete ? "" : " yet"}</span>;
    const ok = g.points >= MIN_GRADE_POINTS;
    return (
      <div title={periodsTitle(g.periods)}>
        <span className={`inline-flex items-center gap-1.5 text-xs ${ok ? "text-slate-200" : "text-red-300"}`}><GradeMedal grade={g.grade} size="sm" /> {gradeName(g.grade)}{ok ? "" : " — below C"}</span>
        <div className="text-[11px] text-slate-500">{g.points.toFixed(1)} pts avg · {g.periods.length} pay period{g.periods.length === 1 ? "" : "s"}{g.complete ? "" : " so far"}</div>
      </div>
    );
  };

  /** The approve / reject / withdraw / undo buttons under an incentive. */
  const rowActions = (inc: TechIncentive) => (
    <div className="mt-1 flex flex-wrap gap-1">
      {inc.status === "pending" && canApprove && (
        <>
          <button type="button" onClick={() => setDialog({ type: "approve", inc })} className="inline-flex items-center gap-1 rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20">
            <Check className="h-3 w-3" /> Approve
          </button>
          <button type="button" onClick={() => setDialog({ type: "reject", inc })} className="inline-flex items-center gap-1 rounded border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-200 hover:bg-red-500/20">
            <X className="h-3 w-3" /> Reject
          </button>
        </>
      )}
      {inc.status === "pending" && canSubmit && (
        <button type="button" onClick={() => setDialog({ type: "withdraw", inc })} className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/5">
          Withdraw
        </button>
      )}
      {inc.status === "approved" && canApprove && inc.kind !== "technician_match" && (
        <button type="button" onClick={() => setDialog({ type: "undo", inc })} className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/5">
          <Undo2 className="h-3 w-3" /> Undo approval
        </button>
      )}
    </div>
  );

  /** HR Incentive / Branch Manager Incentive cell: who gets it (a dropdown until it's approved), then where it stands. */
  const incentiveCell = (v: (typeof views)[number], kind: "hr" | "branch_manager") => {
    const inc = v.rows[kind];
    const amount = money(INCENTIVE_AMOUNT[kind]);
    if (inc && (inc.status === "approved" || inc.status === "pending")) {
      return (
        <div>
          <div className="text-xs text-slate-200">{nameOf(inc.recipientId)}</div>
          <div className="mt-0.5"><Pill tone={inc.status}>{inc.status === "pending" ? "Waiting on Accounting" : "Approved"}</Pill> <span className="text-[11px] text-slate-300">{amount}</span></div>
          {inc.status === "approved" && <div className="text-[11px] text-slate-500">Payroll {fmtPeriod(inc.payPeriodStart, inc.payPeriodEnd)} · by {inc.reviewedByName || "—"}</div>}
          {inc.status === "pending" && <div className="text-[11px] text-slate-500">Submitted by {inc.submittedByName || "—"} · {fmtDate(inc.submittedAt)}</div>}
          {rowActions(inc)}
        </div>
      );
    }
    if (!v.retained) return <Pill tone="muted">Left before 6 months</Pill>;
    const key = `${v.c.technician.id}:${kind}`;
    const picked = pickedFor(v.c, kind, inc) ?? "";
    const editable = canSubmit && incentives !== null && savingKey !== key;
    const options =
      kind === "hr"
        ? Object.keys(HR_INCENTIVE_RECRUITERS).map((id) => ({ id, label: nameOf(id) }))
        : [...branchManagers, ...(picked && !branchManagers.some((p) => p.id === picked) && personById.get(picked) ? [personById.get(picked)!] : [])].map((p) => ({ id: p.id, label: `${p.display_name} · ${p.assigned_branch || "—"}` }));
    const notEligible = kind === "branch_manager" && v.due && v.gradeOk === false;
    return (
      <div>
        <div className="flex items-center gap-1.5">
          <select value={picked} disabled={!editable} onChange={(e) => void pick(v, kind, e.target.value || null)} className={SELECT_CLASS} aria-label={kind === "hr" ? "HR recruiter" : "Branch Manager"}>
            <option value="">{kind === "hr" ? "— Pick the recruiter —" : "— No Branch Manager —"}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {savingKey === key && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {inc?.status === "rejected" ? (
            <Pill tone="rejected">Rejected</Pill>
          ) : notEligible ? (
            <Pill tone="muted">Not eligible — below C</Pill>
          ) : v.due ? (
            picked ? <Pill tone="ready">Ready to submit</Pill> : <Pill tone="muted">Pick who gets it</Pill>
          ) : null}
          <span className="text-[11px] text-slate-500">{amount}{v.due ? "" : " at 6 months"}</span>
        </div>
        {inc?.status === "rejected" && <div className="text-[11px] text-red-300">“{inc.reviewNote}” — {inc.reviewedByName}</div>}
        {kind === "hr" && !inc && v.c.suggestedRecruiterId && <div className="text-[10px] text-slate-500">From their HR Hiring record</div>}
        {kind === "branch_manager" && !inc && (v.c.suggestedBranchManagerId ? <div className="text-[10px] text-slate-500">{v.c.technician.assigned_branch || "Their branch"}'s Branch Manager</div> : <div className="text-[10px] text-slate-500">No Branch Manager found for their branch</div>)}
      </div>
    );
  };

  const matchCell = (v: (typeof views)[number]) => {
    const inc = v.rows.technician_match;
    if (inc) return <div><Pill tone="approved">Approved</Pill> <span className="text-xs text-slate-300">{money(inc.amount)}</span><div className="text-[11px] text-slate-500">Payroll {fmtPeriod(inc.payPeriodStart, inc.payPeriodEnd)}</div></div>;
    return <span className="text-[11px] text-slate-500">{money(INCENTIVE_AMOUNT.technician_match)} — added when the Branch Manager's is approved</span>;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1700px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Technician 6-month incentives — HR picks who gets each one and submits, Accounting approves, and approved incentives go on payroll.</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 mt-4 mb-4">
          {([
            ["hr", `${money(INCENTIVE_AMOUNT.hr)} to the HR recruiter (${Object.values(HR_INCENTIVE_RECRUITERS).map((n) => n.split(" ")[0]).join(", ")}) for each technician who reaches 6 months.`],
            ["branch_manager", `${money(INCENTIVE_AMOUNT.branch_manager)} to the Branch Manager when the technician is still employed at 6 months and their 6-month average grade is C or better.`],
            ["technician_match", `${money(INCENTIVE_AMOUNT.technician_match)} to the technician, added automatically when the Branch Manager's incentive is approved.`],
          ] as const).map(([kind, text]) => (
            <div key={kind} className="panel !p-3">
              <p className="text-xs font-semibold text-white flex items-center gap-1.5"><Award className="h-3.5 w-3.5 text-amber-300" /> {INCENTIVE_LABEL[kind]}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{text}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">
          Technicians who started on or after {fmtDate(INCENTIVE_STARTED_ON_OR_AFTER)} — everyone hired from November on, plus everyone who was still in training (under 3 months) when this started — and anyone still in training. 6 months count from their start date (the later of the Master List Hire Date and their HR Hiring training / start date). The grade is their Technician Performance grade averaged over every finished pay period in their 6 months. Approved incentives go on payroll for the pay period they're approved in (now {fmtPeriod(payPeriodContaining(today).start, payPeriodContaining(today).end)}).
        </p>
        {!loading && missingStartDate.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span className="font-semibold">{missingStartDate.length} active technician{missingStartDate.length === 1 ? " has" : "s have"} no start date</span> — no Hire Date in the Master List and no HR Hiring start date, so their 6 months can't be counted until one is added:{" "}
            {missingStartDate.map((p) => p.display_name || p.email).join(", ")}.
          </div>
        )}
        {incentives === null && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Incentives need database migration 0426 — ask an admin to run it. Until then the list shows who's coming up, but nobody can be picked or submitted.
          </div>
        )}
        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filter === f ? "border-primary/50 bg-primary/20 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground"}`}
              >
                {FILTER_LABEL[f]} <span className="ml-1 rounded-full bg-black/20 px-1.5 text-[10px] tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search technician, branch, recruiter, manager…"
              aria-label="Search incentives"
              className="w-64 max-w-full bg-slate-800/60 border border-white/10 rounded-md py-1 pl-8 pr-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownUp className="h-3.5 w-3.5" /> Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="bg-slate-800/60 border border-white/10 rounded-md px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none">
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
          </div>
        </div>

        {loading ? (
          <div className="panel p-8"><BrandedLoader label="Loading incentives…" /></div>
        ) : (
          <div className="panel p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Technician</th>
                    <th className="px-3 py-2 font-semibold whitespace-nowrap min-w-[170px]">6 months</th>
                    <th className="px-3 py-2 font-semibold min-w-[150px]">6-month grade</th>
                    <th className="px-3 py-2 font-semibold min-w-[200px]">{INCENTIVE_LABEL.hr}</th>
                    <th className="px-3 py-2 font-semibold min-w-[220px]">{INCENTIVE_LABEL.branch_manager}</th>
                    <th className="px-3 py-2 font-semibold min-w-[160px]">{INCENTIVE_LABEL.technician_match}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{search.trim() ? `Nothing matches “${search.trim()}”${filter === "all" ? "" : ` under ${FILTER_LABEL[filter]}`}.` : "Nothing here."}</td></tr>
                  ) : shown.map((v) => {
                    const totalDays = Math.max(1, -daysUntil(v.c.startDate, v.c.sixMonthDate));
                    const elapsed = Math.min(100, Math.max(0, Math.round(((totalDays - Math.max(0, v.days)) / totalDays) * 100)));
                    const canSubmitRow = canSubmit && incentives !== null && v.needsHr;
                    return (
                      <tr key={v.c.technician.id} className="border-b border-white/5 align-top hover:bg-white/[0.03]">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-white">{v.c.technician.display_name || v.c.technician.email}</div>
                          <div className="text-[11px] text-muted-foreground">{v.c.technician.assigned_branch || "No branch"}</div>
                          {isTraineePerson(v.c.technician) && <span className="mt-0.5 inline-block rounded border border-violet-400/30 bg-violet-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-violet-200">In training</span>}
                          {v.c.separation && <div className="text-[11px] text-red-300">{v.c.separation.label}{v.c.separation.date ? ` ${fmtDate(v.c.separation.date)}` : ""}</div>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="font-semibold text-white">{fmtDate(v.c.sixMonthDate)}</div>
                          <div className={`text-[11px] ${v.days > 0 && v.days <= 14 ? "text-amber-300 font-semibold" : "text-muted-foreground"}`}>
                            {v.days > 0 ? `in ${v.days} day${v.days === 1 ? "" : "s"}` : v.days === 0 ? "today" : `reached ${-v.days} day${v.days === -1 ? "" : "s"} ago`}
                          </div>
                          <div className="mt-1 h-1 w-28 rounded-full bg-white/10 overflow-hidden" title={`${elapsed}% of the 6 months`}>
                            <div className={`h-full ${v.days <= 0 ? "bg-emerald-400" : "bg-sky-400"}`} style={{ width: `${elapsed}%` }} />
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">Started {fmtDate(v.c.startDate)} · {v.c.startSource}</div>
                        </td>
                        <td className="px-3 py-2.5">{gradeCell(v)}</td>
                        <td className="px-3 py-2.5">{incentiveCell(v, "hr")}</td>
                        <td className="px-3 py-2.5">{incentiveCell(v, "branch_manager")}</td>
                        <td className="px-3 py-2.5">{matchCell(v)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {canSubmitRow && (
                            <button
                              type="button"
                              disabled={v.submittable.length === 0}
                              title={v.submittable.length === 0 ? "Pick who gets it first" : undefined}
                              onClick={() => setDialog({ type: "submit", c: v.c, picks: v.submittable })}
                              className="btn btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                            >
                              <Send className="h-3.5 w-3.5" /> Submit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {dialog?.type === "submit" && (() => {
        const { c, picks } = dialog;
        const g = typeof grades === "object" ? grades[c.technician.id] : undefined;
        return (
          <AppModal
            title={`Submit to Accounting — ${c.technician.display_name}`}
            description={`Reached 6 months on ${fmtDate(c.sixMonthDate)} (started ${fmtDate(c.startDate)}) · ${c.technician.assigned_branch || "No branch"}`}
            icon={<Send className="h-5 w-5" />}
            busy={busy}
            onClose={() => setDialog(null)}
            footer={
              <>
                <button type="button" onClick={() => setDialog(null)} disabled={busy} className="btn text-sm px-4 py-2">Cancel</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const submitted: TechIncentive[] = [];
                      for (const p of picks) {
                        const saved = await submitIncentive({
                          technicianId: c.technician.id,
                          kind: p.kind,
                          recipientId: p.recipientId,
                          startDate: c.startDate,
                          sixMonthDate: c.sixMonthDate,
                          grade: p.kind === "branch_manager" && g && g.points != null && g.grade ? { points: g.points, grade: g.grade, periods: g.periods } : null,
                          existing: p.existing,
                          submittedById: myProfileId,
                          submittedByName: displayName || "HR",
                        });
                        submitted.push(saved);
                        log("incentive_submitted", saved);
                      }
                      await notifyAboutIncentive({
                        recipientIds: approverIds,
                        senderId: myProfileId,
                        senderName: displayName || "HR",
                        body: `🏅 Incentive${submitted.length > 1 ? "s" : ""} to approve: ${c.technician.display_name || "a technician"} reached 6 months — ${submitted.map((s) => `${INCENTIVE_LABEL[s.kind]} ${money(s.amount)} for ${nameOf(s.recipientId)}`).join("; ")}.`,
                        linkTo: "/m/accounting/incentives",
                      });
                      toast.success("Submitted for Accounting's approval");
                    })
                  }
                  className="btn btn-primary text-sm px-4 py-2 inline-flex items-center gap-1.5"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
                </button>
              </>
            }
          >
            <div className="space-y-2 text-sm text-slate-300">
              {picks.map((p) => (
                <div key={p.kind} className="rounded-lg border border-white/10 px-3 py-2">
                  <div className="font-semibold text-white">{INCENTIVE_LABEL[p.kind]} · {money(INCENTIVE_AMOUNT[p.kind])}</div>
                  <div className="text-xs">To {nameOf(p.recipientId)}</div>
                  {p.kind === "branch_manager" && g?.grade && g.points != null && (
                    <div className="text-[11px] text-slate-400 mt-1">6-month average {gradeName(g.grade)} · {g.points.toFixed(1)} pts over {g.periods.length} pay periods. Approving it also adds the {money(INCENTIVE_AMOUNT.technician_match)} {INCENTIVE_LABEL.technician_match} for {c.technician.display_name}.</div>
                  )}
                </div>
              ))}
              {(() => {
                const v = views.find((x) => x.c.technician.id === c.technician.id);
                const missing: string[] = [];
                if (v && isOpen(v.rows.hr) && !picks.some((p) => p.kind === "hr")) missing.push(`${INCENTIVE_LABEL.hr} — no recruiter picked`);
                if (v && isOpen(v.rows.branch_manager) && !picks.some((p) => p.kind === "branch_manager")) missing.push(v.gradeOk === false ? `${INCENTIVE_LABEL.branch_manager} — not eligible (below C)` : `${INCENTIVE_LABEL.branch_manager} — no Branch Manager picked`);
                return missing.length ? <p className="text-[11px] text-slate-500">Not included: {missing.join("; ")}.</p> : null;
              })()}
              <p className="text-[11px] text-slate-500">Accounting approves; approving adds it to payroll for the pay period it's approved in.</p>
            </div>
          </AppModal>
        );
      })()}

      {dialog?.type === "approve" && (() => {
        const inc = dialog.inc;
        const period = payPeriodContaining(today);
        const tech = nameOf(inc.technicianId);
        return (
          <AppModal
            title={`Approve ${INCENTIVE_LABEL[inc.kind]}?`}
            description={`${money(inc.amount)} for ${nameOf(inc.recipientId)} — ${tech} reached 6 months on ${fmtDate(inc.sixMonthDate)}`}
            icon={<Check className="h-5 w-5" />}
            busy={busy}
            onClose={() => setDialog(null)}
            footer={
              <>
                <button type="button" onClick={() => setDialog(null)} disabled={busy} className="btn text-sm px-4 py-2">Cancel</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const res = await approveIncentive(inc, { reviewerId: myProfileId, reviewerName: displayName || "Accounting", technicianName: tech, incentives: incentives ?? [] });
                      log("incentive_approved", inc, { payPeriod: res.period });
                      if (res.match) log("incentive_approved", res.match, { payPeriod: res.period, matchOf: inc.id });
                      if (inc.submittedById && inc.submittedById !== myProfileId) {
                        void notifyAboutIncentive({ recipientIds: [inc.submittedById], senderId: myProfileId, senderName: displayName || "Accounting", body: `✅ Approved: ${INCENTIVE_LABEL[inc.kind]} ${money(inc.amount)} for ${nameOf(inc.recipientId)} (${tech}) — on payroll ${fmtPeriod(res.period.start, res.period.end)}.`, linkTo: "/m/hr/incentives" });
                      }
                      toast.success(`Approved — added to payroll ${fmtPeriod(res.period.start, res.period.end)}`);
                    })
                  }
                  className="btn btn-primary text-sm px-4 py-2 inline-flex items-center gap-1.5"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                </button>
              </>
            }
          >
            <div className="space-y-2 text-sm text-slate-300">
              <p>
                Adds <span className="font-semibold text-white">{money(inc.amount)}</span> to {nameOf(inc.recipientId)}'s payroll for {fmtPeriod(period.start, period.end)}
                {inc.kind === "hr" ? " (a payroll adjustment)." : " (a pay line on their Tech Activity Report)."}
              </p>
              {inc.kind === "branch_manager" && (
                <p>
                  Also adds the <span className="font-semibold text-white">{money(INCENTIVE_AMOUNT.technician_match)} {INCENTIVE_LABEL.technician_match}</span> to {tech}'s payroll for the same pay period.
                </p>
              )}
              {inc.kind === "branch_manager" && inc.grade && (
                <p className="text-xs text-slate-400">Grade when submitted: {gradeName(inc.grade as LetterGrade)} · {inc.gradePoints?.toFixed(1)} pts avg over {inc.gradePeriods.length} pay periods.</p>
              )}
              <p className="text-xs text-slate-400">Submitted by {inc.submittedByName || "—"} on {fmtDate(inc.submittedAt)}.</p>
            </div>
          </AppModal>
        );
      })()}

      {dialog?.type === "reject" && <RejectDialog label={`${INCENTIVE_LABEL[dialog.inc.kind]} ${money(dialog.inc.amount)} for ${nameOf(dialog.inc.recipientId)}`} busy={busy} onClose={() => setDialog(null)} onReject={(reason) =>
        run(async () => {
          const inc = dialog.inc;
          await rejectIncentive(inc, { reviewerId: myProfileId, reviewerName: displayName || "Accounting", reason });
          log("incentive_rejected", inc, { reason });
          if (inc.submittedById && inc.submittedById !== myProfileId) {
            void notifyAboutIncentive({ recipientIds: [inc.submittedById], senderId: myProfileId, senderName: displayName || "Accounting", body: `❌ Rejected: ${INCENTIVE_LABEL[inc.kind]} ${money(inc.amount)} for ${nameOf(inc.recipientId)} (${nameOf(inc.technicianId)}). Reason: ${reason}`, linkTo: "/m/hr/incentives" });
          }
          toast.success("Rejected");
        })
      } />}

      {(dialog?.type === "undo" || dialog?.type === "withdraw") && (() => {
        const inc = dialog.inc;
        const undo = dialog.type === "undo";
        return (
          <AppModal
            title={undo ? "Undo this approval?" : "Withdraw this incentive?"}
            description={`${INCENTIVE_LABEL[inc.kind]} ${money(inc.amount)} for ${nameOf(inc.recipientId)} — ${nameOf(inc.technicianId)}`}
            icon={<Undo2 className="h-5 w-5" />}
            tone="warning"
            busy={busy}
            onClose={() => setDialog(null)}
            footer={
              <>
                <button type="button" onClick={() => setDialog(null)} disabled={busy} className="btn text-sm px-4 py-2">Cancel</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (undo) {
                        await undoIncentiveApproval(inc, incentives ?? []);
                        log("incentive_approval_undone", inc, { payPeriod: { start: inc.payPeriodStart, end: inc.payPeriodEnd } });
                        toast.success("Approval undone — it's off payroll and waiting on Accounting again");
                      } else {
                        await withdrawIncentive(inc.id);
                        log("incentive_withdrawn", inc);
                        toast.success("Withdrawn");
                      }
                    })
                  }
                  className="btn btn-primary text-sm px-4 py-2 inline-flex items-center gap-1.5"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} {undo ? "Undo approval" : "Withdraw"}
                </button>
              </>
            }
          >
            <p className="text-sm text-slate-300">
              {undo
                ? `Takes ${money(inc.amount)} off ${nameOf(inc.recipientId)}'s payroll for ${fmtPeriod(inc.payPeriodStart, inc.payPeriodEnd)} and puts it back to waiting on Accounting.${inc.kind === "branch_manager" ? ` The technician's ${money(INCENTIVE_AMOUNT.technician_match)} ${INCENTIVE_LABEL.technician_match} comes off too.` : ""} If that payroll was already generated, regenerate it.`
                : `It's no longer waiting on Accounting; ${nameOf(inc.recipientId)} stays picked, so you can submit it again.`}
            </p>
          </AppModal>
        );
      })()}
    </div>
  );
}

function RejectDialog({ label, busy, onClose, onReject }: { label: string; busy: boolean; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <AppModal
      title="Reject this incentive?"
      description={label}
      icon={<X className="h-5 w-5" />}
      tone="warning"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn text-sm px-4 py-2">Cancel</button>
          <button type="button" disabled={busy || !reason.trim()} onClick={() => onReject(reason.trim())} className="btn btn-primary text-sm px-4 py-2 inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Reject
          </button>
        </>
      }
    >
      <label className="block text-xs text-slate-400 uppercase mb-1">Reason <span className="text-red-400 normal-case">* required</span></label>
      <textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it rejected? HR sees this and can resubmit." className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
    </AppModal>
  );
}
