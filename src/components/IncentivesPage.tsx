/**
 * HR / Accounting → Incentives — technicians reaching 6 months and the
 * three incentives that come with it (rules: src/lib/techIncentives.ts):
 * HR Incentive $100 to the recruiter, Branch Manager Incentive $500 (6-month
 * average grade C or better, still employed), and the technician's $500
 * match, added when the Branch Manager's is approved. HR submits;
 * Accounting (Finance) or Super Admin approves, which puts it on payroll
 * for the pay period it's approved in (src/lib/supabase/techIncentives.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, Award, Check, X, Undo2, Send, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { AppModal } from "@/components/ui-kit/AppModal";
import { GradeMedal, letterGrade, payPeriodsThrough, shortPoints, gradeName, type LetterGrade } from "@/components/techPerformanceGrading";
import { getMyPerformance } from "@/lib/supabase/myPerformance";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import {
  approveIncentive,
  getIncentiveCases,
  getTechIncentives,
  isBranchManagerPerson,
  notifyAboutIncentive,
  rejectIncentive,
  retainedAtSixMonths,
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
  INCENTIVE_PROGRAM_START,
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

interface SixMonthGrade {
  /** Average points over the graded pay periods; null with none to grade. */
  points: number | null;
  grade: LetterGrade | null;
  periods: IncentiveGradePeriod[];
  /** The 6 months are over (otherwise it's the grade so far). */
  complete: boolean;
}

/**
 * The Technician Performance grade over the 6 months: each graded pay period
 * fully inside them (from the first graded period, 08/27, on), its points
 * averaged. Before the 6-month mark: the periods finished so far.
 */
async function sixMonthGrade(technicianId: string, startDate: string, sixMonth: string, today: string): Promise<SixMonthGrade> {
  const complete = sixMonth <= today;
  const end = complete ? sixMonth : addDaysISO(today, -1);
  const periods = payPeriodsThrough(end).filter((p) => p.start >= startDate && p.end <= end);
  const graded = await Promise.all(
    periods.map(async (p) => {
      const points = shortPoints(await getMyPerformance(technicianId, p.start, p.end));
      return { start: p.start, end: p.end, points, grade: letterGrade(points) };
    })
  );
  const points = graded.length ? graded.reduce((s, g) => s + g.points, 0) / graded.length : null;
  return { points, grade: points == null ? null : letterGrade(points), periods: graded, complete };
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

type Dialog =
  | { type: "submit"; c: IncentiveCase }
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
  const [grades, setGrades] = useState<Record<string, SixMonthGrade | "loading" | "error">>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [{ cases, people, missingStartDate }, rows] = await Promise.all([getIncentiveCases(), getTechIncentives()]);
      setCases(cases);
      setPeople(people);
      setMissingStartDate(missingStartDate);
      setIncentives(rows);
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

  const loadGrade = (c: IncentiveCase) => {
    const id = c.technician.id;
    setGrades((g) => ({ ...g, [id]: "loading" }));
    sixMonthGrade(id, c.startDate, c.sixMonthDate, today)
      .then((res) => setGrades((g) => ({ ...g, [id]: res })))
      .catch(() => setGrades((g) => ({ ...g, [id]: "error" })));
  };

  // Each row's state, per incentive.
  const views = useMemo(
    () =>
      cases.map((c) => {
        const rows = byTechnician.get(c.technician.id) ?? {};
        const due = c.sixMonthDate <= today;
        const retained = retainedAtSixMonths(c);
        const g = grades[c.technician.id];
        const gradeOk = typeof g === "object" && g.complete ? (g.points ?? -Infinity) >= MIN_GRADE_POINTS : null;
        const open = (r?: TechIncentive) => !r || r.status === "rejected";
        const needsHr = due && retained && (open(rows.hr) || (open(rows.branch_manager) && gradeOk !== false));
        const waiting = rows.hr?.status === "pending" || rows.branch_manager?.status === "pending";
        const done = !needsHr && !waiting && (rows.hr?.status === "approved" || rows.branch_manager?.status === "approved");
        const status: Filter = !retained && !(rows.hr || rows.branch_manager) ? "not-eligible" : waiting ? "waiting" : needsHr ? "needs-hr" : !due ? "upcoming" : done ? "done" : "all";
        return { c, rows, due, retained, gradeOk, status };
      }),
    [cases, byTechnician, grades, today]
  );

  // Grade every technician who's reached 6 months and still needs the Branch Manager step.
  useEffect(() => {
    for (const v of views) {
      if (!v.due || !v.retained || grades[v.c.technician.id]) continue;
      if (v.rows.branch_manager && v.rows.branch_manager.status !== "rejected") continue;
      loadGrade(v.c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views]);

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: views.length, "needs-hr": 0, waiting: 0, upcoming: 0, done: 0, "not-eligible": 0 };
    for (const v of views) if (v.status !== "all") out[v.status]++;
    return out;
  }, [views]);
  const shown = filter === "all" ? views.filter((v) => v.status !== "not-eligible") : views.filter((v) => v.status === filter);

  const log = (action: string, inc: { id: string; kind: IncentiveKind; technicianId: string; recipientId: string; amount: number }, details: Record<string, unknown> = {}) =>
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
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const gradeLine = (g: SixMonthGrade | "loading" | "error" | undefined, c: IncentiveCase, stored?: TechIncentive) => {
    if (stored && stored.gradePoints != null && stored.grade) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-300" title={stored.gradePeriods.map((p) => `${fmtPeriod(p.start, p.end)}: ${p.grade} (${p.points} pts)`).join("\n")}>
          <GradeMedal grade={stored.grade as LetterGrade} size="sm" /> {gradeName(stored.grade as LetterGrade)} · {stored.gradePoints.toFixed(1)} pts avg ({stored.gradePeriods.length} pay periods)
        </span>
      );
    }
    if (g === "loading") return <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Checking grade…</span>;
    if (g === "error") return <button type="button" onClick={() => loadGrade(c)} className="text-[11px] text-red-300 underline">Couldn't load the grade — retry</button>;
    if (!g) return <button type="button" onClick={() => loadGrade(c)} className="text-[11px] text-sky-300 hover:text-sky-200 underline">Grade so far</button>;
    if (g.points == null || !g.grade) return <span className="text-[11px] text-slate-400">No graded pay periods{g.complete ? "" : " yet"}</span>;
    const ok = g.points >= MIN_GRADE_POINTS;
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] ${ok ? "text-slate-300" : "text-red-300"}`}
        title={g.periods.map((p) => `${fmtPeriod(p.start, p.end)}: ${p.grade} (${p.points} pts)`).join("\n")}
      >
        <GradeMedal grade={g.grade} size="sm" /> {gradeName(g.grade)} · {g.points.toFixed(1)} pts avg ({g.periods.length} pay period{g.periods.length === 1 ? "" : "s"}){g.complete ? "" : " so far"}
        {g.complete && !ok && " — below C"}
      </span>
    );
  };

  /** The actions for one incentive row (HR or Branch Manager). */
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

  const incentiveCell = (v: (typeof views)[number], kind: IncentiveKind) => {
    const inc = v.rows[kind];
    const amount = money(INCENTIVE_AMOUNT[kind]);
    if (kind === "technician_match") {
      if (inc) return <div><Pill tone="approved">Approved</Pill> <span className="text-xs text-slate-300">{amount}</span><div className="text-[11px] text-slate-500">Payroll {fmtPeriod(inc.payPeriodStart, inc.payPeriodEnd)}</div></div>;
      return <span className="text-[11px] text-slate-500">Added when the Branch Manager's is approved</span>;
    }
    const grade = kind === "branch_manager" ? gradeLine(grades[v.c.technician.id], v.c, inc && inc.status !== "rejected" ? inc : undefined) : null;
    if (inc && inc.status !== "rejected") {
      return (
        <div>
          <Pill tone={inc.status}>{inc.status === "pending" ? "Waiting on Accounting" : "Approved"}</Pill> <span className="text-xs text-slate-200">{amount} · {nameOf(inc.recipientId)}</span>
          {inc.status === "approved" && <div className="text-[11px] text-slate-500">Payroll {fmtPeriod(inc.payPeriodStart, inc.payPeriodEnd)} · by {inc.reviewedByName || "—"}</div>}
          {inc.status === "pending" && <div className="text-[11px] text-slate-500">Submitted by {inc.submittedByName || "—"} · {fmtDate(inc.submittedAt)}</div>}
          {grade && <div>{grade}</div>}
          {rowActions(inc)}
        </div>
      );
    }
    if (!v.retained) return <Pill tone="muted">Left before 6 months</Pill>;
    if (!v.due) return <div><span className="text-[11px] text-slate-500">{amount} at 6 months</span>{grade && <div>{grade}</div>}</div>;
    if (kind === "branch_manager" && v.gradeOk === false) return <div><Pill tone="muted">Not eligible</Pill>{grade && <div>{grade}</div>}</div>;
    return (
      <div>
        {inc?.status === "rejected" ? <Pill tone="rejected">Rejected</Pill> : <Pill tone="ready">Ready to submit</Pill>} <span className="text-xs text-slate-300">{amount}</span>
        {inc?.status === "rejected" && <div className="text-[11px] text-red-300">“{inc.reviewNote}” — {inc.reviewedByName}</div>}
        {grade && <div>{grade}</div>}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Technician 6-month incentives — HR submits, Accounting approves, and approved incentives go on payroll.</p>
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
          6 months count from the technician's start date (the later of the Master List Hire Date and their HR Hiring training / start date), for technicians reaching 6 months on or after {fmtDate(INCENTIVE_PROGRAM_START)}. Approved incentives go on payroll for the pay period they're approved in (now {fmtPeriod(payPeriodContaining(today).start, payPeriodContaining(today).end)}).
        </p>
        {!loading && missingStartDate.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span className="font-semibold">{missingStartDate.length} active technician{missingStartDate.length === 1 ? " has" : "s have"} no start date</span> — no Hire Date in the Master List and no HR Hiring start date, so their 6 months can't be counted until one is added:{" "}
            {missingStartDate.map((p) => p.display_name || p.email).join(", ")}.
          </div>
        )}

        {incentives === null && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Incentives need database migration 0426 — ask an admin to run it. Until then the list shows who's due, but nothing can be submitted.
          </div>
        )}
        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex flex-wrap gap-1.5 mb-3">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filter === f ? "border-primary/50 bg-primary/20 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground"}`}
            >
              {FILTER_LABEL[f]} <span className="ml-1 rounded-full bg-black/20 px-1.5 text-[10px] tabular-nums">{f === "all" ? counts.all - counts["not-eligible"] : counts[f]}</span>
            </button>
          ))}
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
                    <th className="px-3 py-2 font-semibold whitespace-nowrap">Started → 6 months</th>
                    <th className="px-3 py-2 font-semibold min-w-[220px]">{INCENTIVE_LABEL.hr}</th>
                    <th className="px-3 py-2 font-semibold min-w-[260px]">{INCENTIVE_LABEL.branch_manager}</th>
                    <th className="px-3 py-2 font-semibold min-w-[180px]">{INCENTIVE_LABEL.technician_match}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Nothing here.</td></tr>
                  ) : shown.map((v) => {
                    const days = daysUntil(v.c.sixMonthDate, today);
                    // Something to submit, or a pending one HR may change.
                    const submittable = canSubmit && incentives !== null && v.due && v.retained && (v.status === "needs-hr" || v.status === "waiting");
                    return (
                      <tr key={v.c.technician.id} className="border-b border-white/5 align-top hover:bg-white/[0.03]">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-white">{v.c.technician.display_name || v.c.technician.email}</div>
                          <div className="text-[11px] text-muted-foreground">{v.c.technician.assigned_branch || "No branch"}</div>
                          {v.c.separation && <div className="text-[11px] text-red-300">{v.c.separation.label}{v.c.separation.date ? ` ${fmtDate(v.c.separation.date)}` : ""}</div>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="text-slate-300">{fmtDate(v.c.startDate)} → <span className="font-semibold text-white">{fmtDate(v.c.sixMonthDate)}</span></div>
                          <div className="text-[11px] text-muted-foreground">
                            {v.c.startSource} · {days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : days === 0 ? "today" : `reached ${-days} day${days === -1 ? "" : "s"} ago`}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{incentiveCell(v, "hr")}</td>
                        <td className="px-3 py-2.5">{incentiveCell(v, "branch_manager")}</td>
                        <td className="px-3 py-2.5">{incentiveCell(v, "technician_match")}</td>
                        <td className="px-3 py-2.5 text-right">
                          {submittable && (
                            <button type="button" onClick={() => setDialog({ type: "submit", c: v.c })} className="btn btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 whitespace-nowrap">
                              <Send className="h-3.5 w-3.5" /> {[v.rows.hr, v.rows.branch_manager].some((r) => r?.status === "pending") ? "Edit / submit" : "Submit"}
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

      {dialog?.type === "submit" && (
        <SubmitDialog
          c={dialog.c}
          rows={byTechnician.get(dialog.c.technician.id) ?? {}}
          people={people}
          grade={grades[dialog.c.technician.id]}
          onRetryGrade={() => loadGrade(dialog.c)}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(picks) =>
            run(async () => {
              const c = dialog.c;
              const rows = byTechnician.get(c.technician.id) ?? {};
              const submitted: TechIncentive[] = [];
              for (const pick of picks) {
                const existing = rows[pick.kind];
                const g = grades[c.technician.id];
                const saved = await submitIncentive({
                  technicianId: c.technician.id,
                  kind: pick.kind,
                  recipientId: pick.recipientId,
                  startDate: c.startDate,
                  sixMonthDate: c.sixMonthDate,
                  grade: pick.kind === "branch_manager" && typeof g === "object" && g.points != null && g.grade ? { points: g.points, grade: g.grade, periods: g.periods } : null,
                  existing: existing && existing.status !== "approved" ? existing : null,
                  submittedById: myProfileId,
                  submittedByName: displayName || "HR",
                });
                submitted.push(saved);
                log("incentive_submitted", saved);
              }
              const techName = c.technician.display_name || "a technician";
              await notifyAboutIncentive({
                recipientIds: approverIds,
                senderId: myProfileId,
                senderName: displayName || "HR",
                body: `🏅 Incentive${submitted.length > 1 ? "s" : ""} to approve: ${techName} reached 6 months — ${submitted.map((s) => `${INCENTIVE_LABEL[s.kind]} ${money(s.amount)} for ${nameOf(s.recipientId)}`).join("; ")}.`,
                linkTo: "/m/accounting/incentives",
              });
              toast.success(`Submitted for Accounting's approval`);
            })
          }
        />
      )}

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
                : "It goes back to Ready to submit."}
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

/** HR's submit form for one technician: the HR Incentive's recruiter and the Branch Manager Incentive's Branch Manager. */
function SubmitDialog({
  c, rows, people, grade, onRetryGrade, busy, onClose, onSubmit,
}: {
  c: IncentiveCase;
  rows: Partial<Record<IncentiveKind, TechIncentive>>;
  people: IncentivePerson[];
  grade: SixMonthGrade | "loading" | "error" | undefined;
  onRetryGrade: () => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (picks: { kind: "hr" | "branch_manager"; recipientId: string }[]) => void;
}) {
  const open = (r?: TechIncentive) => !r || r.status !== "approved";
  const hrOpen = open(rows.hr);
  const bmOpen = open(rows.branch_manager);
  const [hrOn, setHrOn] = useState(hrOpen);
  const [recruiter, setRecruiter] = useState(rows.hr?.recipientId ?? c.suggestedRecruiterId ?? "");
  const gradeReady = typeof grade === "object" && grade.complete;
  const gradeOk = gradeReady && (grade.points ?? -Infinity) >= MIN_GRADE_POINTS;
  const [bmOn, setBmOn] = useState(bmOpen);
  const [branchManager, setBranchManager] = useState(rows.branch_manager?.recipientId ?? c.suggestedBranchManagerId ?? "");
  const managers = useMemo(() => {
    const list = people.filter((p) => p.is_active && isBranchManagerPerson(p));
    const picked = people.find((p) => p.id === branchManager);
    if (picked && !list.includes(picked)) list.push(picked);
    return list.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
  }, [people, branchManager]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.display_name || HR_INCENTIVE_RECRUITERS[id] || id;
  // A Branch Manager incentive already pending wasn't auto-graded — grade it now.
  useEffect(() => {
    if (bmOpen && grade === undefined) onRetryGrade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only what's new or changed — one already waiting with the same person isn't sent again.
  const picks: { kind: "hr" | "branch_manager"; recipientId: string }[] = [];
  if (hrOpen && hrOn && recruiter) picks.push({ kind: "hr", recipientId: recruiter });
  if (bmOpen && bmOn && gradeOk && branchManager) picks.push({ kind: "branch_manager", recipientId: branchManager });
  const changed = picks.filter((p) => !(rows[p.kind]?.status === "pending" && rows[p.kind]?.recipientId === p.recipientId));

  return (
    <AppModal
      title={`Submit incentives — ${c.technician.display_name}`}
      description={`Reached 6 months on ${fmtDate(c.sixMonthDate)} (started ${fmtDate(c.startDate)}, ${c.startSource}) · ${c.technician.assigned_branch || "No branch"}`}
      icon={<Award className="h-5 w-5" />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn text-sm px-4 py-2">Cancel</button>
          <button type="button" disabled={busy || changed.length === 0} onClick={() => onSubmit(changed)} className="btn btn-primary text-sm px-4 py-2 inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit to Accounting
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className={`rounded-lg border border-white/10 p-3 ${hrOpen ? "" : "opacity-60"}`}>
          <label className="flex items-center gap-2 font-semibold text-white">
            <input type="checkbox" checked={hrOpen && hrOn} disabled={!hrOpen} onChange={(e) => setHrOn(e.target.checked)} className="accent-blue-500" />
            {INCENTIVE_LABEL.hr} · {money(INCENTIVE_AMOUNT.hr)}
          </label>
          {hrOpen ? (
            <div className="mt-2">
              <label className="block text-xs text-slate-400 uppercase mb-1">Recruiter</label>
              <select value={recruiter} onChange={(e) => setRecruiter(e.target.value)} disabled={!hrOn} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm">
                <option value="">— Pick the recruiter —</option>
                {Object.keys(HR_INCENTIVE_RECRUITERS).map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">{c.suggestedRecruiterId ? `Filled in from who added their HR Hiring record (${nameOf(c.suggestedRecruiterId)}).` : "Their HR Hiring record wasn't added by one of the recruiters — pick who recruited them."}</p>
            </div>
          ) : <p className="text-xs text-slate-400 mt-1">Already approved.</p>}
        </div>

        <div className={`rounded-lg border border-white/10 p-3 ${bmOpen ? "" : "opacity-60"}`}>
          <label className="flex items-center gap-2 font-semibold text-white">
            <input type="checkbox" checked={bmOpen && bmOn && gradeOk} disabled={!bmOpen || !gradeOk} onChange={(e) => setBmOn(e.target.checked)} className="accent-blue-500" />
            {INCENTIVE_LABEL.branch_manager} · {money(INCENTIVE_AMOUNT.branch_manager)}
          </label>
          {!bmOpen ? <p className="text-xs text-slate-400 mt-1">Already approved.</p> : (
            <div className="mt-2 space-y-2">
              <div className="text-xs">
                {grade === "loading" || grade === undefined ? (
                  <span className="inline-flex items-center gap-1 text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Checking the 6-month grade…</span>
                ) : grade === "error" ? (
                  <button type="button" onClick={onRetryGrade} className="text-red-300 underline">Couldn't load the grade — retry</button>
                ) : grade.points == null || !grade.grade ? (
                  <span className="text-red-300">No graded pay periods in their 6 months — the C requirement can't be checked.</span>
                ) : (
                  <div>
                    <span className={gradeOk ? "text-emerald-300" : "text-red-300"}>
                      6-month average: {gradeName(grade.grade)} ({grade.grade}) · {grade.points.toFixed(1)} pts — {gradeOk ? "meets C or better" : "below C, not eligible"}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {grade.periods.map((p) => (
                        <span key={p.start} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">{fmtPeriod(p.start, p.end)}: {p.grade} ({p.points})</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Branch Manager</label>
                <select value={branchManager} onChange={(e) => setBranchManager(e.target.value)} disabled={!bmOn || !gradeOk} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm">
                  <option value="">— Pick the Branch Manager —</option>
                  {managers.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.assigned_branch || "—"}</option>)}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">{c.suggestedBranchManagerId ? `Filled in from ${c.technician.assigned_branch || "their branch"}'s Branch Manager.` : "No Branch Manager found for their branch — pick one."}</p>
              </div>
              <p className="text-[11px] text-slate-500">Approving it also adds the {money(INCENTIVE_AMOUNT.technician_match)} {INCENTIVE_LABEL.technician_match} for {c.technician.display_name}.</p>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-500">Accounting approves; approving adds it to payroll for the pay period it's approved in.</p>
      </div>
    </AppModal>
  );
}
