/**
 * HR module -> Analytics. Titled generically ("Analytics", not "Hiring
 * Analytics") since more categories are expected here later — currently
 * covers two:
 *  - Hiring: candidates by pipeline status (donut) + who's actually made
 *    changes there (Team Activity), sourced from hr_activity_log entries
 *    with targetType: "candidate" (every logActivity call in
 *    ReportHRDaily.tsx's Hiring handlers).
 *  - Employee Monitoring: HR Status breakdown across attendance_notes in a
 *    date range (donut) + who's actually been setting those statuses/notes
 *    (Team Activity), sourced from hr_activity_log entries with
 *    targetType: "attendance_hr_status" (every logActivity call in
 *    AbsentListPage.tsx's handleSaveHrStatus/handleSaveNote). FOR NOW ONLY:
 *    rows with no log entry in range (i.e. from before that logging went
 *    live) fall back into the same Team Activity count via
 *    attendance_notes.created_by, restricted to the HR role — see the
 *    empActivityByActor memo below. Once enough log history has accrued
 *    this fallback should be deleted.
 * A future category should add its own <AnalyticsCategory> section below
 * rather than a separate page — the slug/custom key ("hiring-analytics")
 * stays as internal plumbing, unrelated to the title.
 *
 * Originally a tab inside ReportHRDaily.tsx (the Hiring page itself); moved
 * out to its own module tile per the user's explicit request, so it's
 * reachable straight from the HR landing grid instead of buried in Hiring's
 * tab set.
 *
 * Dispatched from m.$module.$submodule.tsx for custom === "hiring-analytics";
 * the route already renders <AppHeader /> and gates access to ADMIN / HR
 * (DASHBOARD_ROLE_GATES).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, PieChart, Users } from "lucide-react";
import { getCandidates, type Candidate, type CandidateStatus } from "@/lib/supabase/hrCandidates";
import { getAttendanceNotes, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { getActivityLog, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { normalizeRole } from "@/lib/roleLabels";

const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  applied: "Applied",
  phone_screening: "Phone Screening",
  interviewing: "Interviewing",
  selected: "Selected",
  training: "Training",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};
// The dataviz skill's validated default categorical order (dark mode,
// passes CVD/contrast checks) — 8 hues, safe for a pie/donut's simultaneous
// (not just adjacent) comparison up to that count. Shared by both donuts
// below; anything past 8 categories folds into a plain muted gray "Other".
const CHART_PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const CHART_OTHER_COLOR = "#6b7280";
// Candidates by Status: fixed per-status assignment (never re-ordered by
// count/rank) so a status keeps the same color across every render, per the
// dataviz skill's "color follows the entity" rule — only 9 possible
// statuses exist so this can be a real 1:1 identity mapping. Employee
// Monitoring's HR Status breakdown (built below, inside the component)
// can't do the same: it's an open-ended, freely-typed set of statuses, so
// it assigns colors by rank among whatever actually appears in the
// selected range instead — documented at that call site.
const CANDIDATE_STATUS_CHART_COLOR: Record<CandidateStatus, string> = {
  applied: CHART_PALETTE[0],
  phone_screening: CHART_PALETTE[1],
  interviewing: CHART_PALETTE[2],
  selected: CHART_PALETTE[3],
  training: CHART_PALETTE[4],
  hired: CHART_PALETTE[5],
  withdrawn: CHART_PALETTE[6],
  rejected: CHART_PALETTE[7],
  cancelled: CHART_OTHER_COLOR,
};

interface DonutSlice {
  key: string;
  label: string;
  count: number;
  color: string;
  pct: number;
  path: string;
}

/** Naive "add an s" breaks on words like "status" -> "statuses", not
 * "statuss" — the only irregular unit this page uses so far. */
function pluralizeUnit(unit: string, count: number): string {
  if (count === 1) return unit;
  return unit.endsWith("s") ? `${unit}es` : `${unit}s`;
}

/** Pure arc math — one donut-slice SVG path per row, in the order given (the
 * caller controls sort order; colors are already resolved on each row). */
function buildDonutSlices(rows: { key: string; label: string; count: number; color: string }[]): { total: number; slices: DonutSlice[] } {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const cx = 60, cy = 60, rOuter = 54, rInner = 32;
  const polar = (r: number, angleDeg: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  let cursor = 0;
  const slices = rows.map((row) => {
    const startAngle = total > 0 ? (cursor / total) * 360 : 0;
    cursor += row.count;
    const endAngle = total > 0 ? (cursor / total) * 360 : 0;
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const startOuter = polar(rOuter, endAngle);
    const endOuter = polar(rOuter, startAngle);
    const startInner = polar(rInner, endAngle);
    const endInner = polar(rInner, startAngle);
    const path = [
      `M ${startOuter.x} ${startOuter.y}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
      `L ${endInner.x} ${endInner.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
      "Z",
    ].join(" ");
    return { ...row, path, pct: total > 0 ? (row.count / total) * 100 : 0 };
  });
  return { total, slices };
}

/** Groups candidates by a person-id field (assignedManagerId,
 * assignedInterviewerId, …) resolved to a display name via `nameById`,
 * falling back to "Unassigned". Colors by rank, same convention as the
 * HR Status donut — the set of people who could hold this field is
 * open-ended, so there's no fixed per-person color to assign. */
function donutByPerson(candidates: Candidate[], getPersonId: (c: Candidate) => string | null, nameById: Map<string, string>): { total: number; slices: DonutSlice[] } {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const id = getPersonId(c);
    const label = (id && nameById.get(id)) || "Unassigned";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rows = Array.from(counts.entries())
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count)
    .map((r, i) => ({ ...r, color: i < CHART_PALETTE.length ? CHART_PALETTE[i] : CHART_OTHER_COLOR }));
  return buildDonutSlices(rows);
}

/** The "donut + legend" card by itself — used both as AnalyticsCategory's
 * primary donut and standalone for the extra Hiring breakdowns below. */
function DonutPanel({ heading, unitLabel, loading, slices, total }: { heading: string; unitLabel: string; loading: boolean; slices: DonutSlice[]; total: number }) {
  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><PieChart className="h-4 w-4 text-blue-300" /> {heading}</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">{total} {pluralizeUnit(unitLabel, total)} total.</p>
      </div>
      <div className="p-4 flex flex-col items-center gap-3">
        {loading ? (
          <p className="text-sm text-muted-foreground py-8">Loading…</p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground py-8">Nothing to chart yet.</p>
        ) : (
          <>
            <svg viewBox="0 0 120 120" className="w-56 h-56 shrink-0" role="img" aria-label={heading}>
              {slices.map((s) => (
                <path key={s.key} d={s.path} fill={s.color} stroke="#0f172a" strokeWidth={2} />
              ))}
              <text x="60" y="57" textAnchor="middle" className="fill-white" style={{ fontSize: 18, fontWeight: 700 }}>{total}</text>
              <text x="60" y="70" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: "0.05em" }}>{pluralizeUnit(unitLabel, total === 1 ? 1 : 2)}</text>
            </svg>
            <ul className="w-full space-y-1.5">
              {slices.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="flex-1 text-slate-200 truncate">{s.label}</span>
                  <span className="text-slate-400 tabular-nums shrink-0">{s.count} ({s.pct.toFixed(0)}%)</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** One category's worth of "donut on the left, Team Activity leaderboard on
 * the right" — the repeating shape every category on this page uses. */
function AnalyticsCategory({
  title,
  donutHeading,
  donutUnitLabel,
  loading,
  slices,
  total,
  activityHeading,
  activitySubheading,
  activityFrom,
  onActivityFromChange,
  activityTo,
  onActivityToChange,
  activityLoading,
  activityByActor,
}: {
  title: string;
  donutHeading: string;
  donutUnitLabel: string;
  loading: boolean;
  slices: DonutSlice[];
  total: number;
  activityHeading: string;
  activitySubheading: string;
  activityFrom: string;
  onActivityFromChange: (v: string) => void;
  activityTo: string;
  onActivityToChange: (v: string) => void;
  activityLoading: boolean;
  activityByActor: { name: string; count: number }[];
}) {
  const maxActivity = activityByActor.reduce((m, a) => Math.max(m, a.count), 0);
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-1">{title}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
        <DonutPanel heading={donutHeading} unitLabel={donutUnitLabel} loading={loading} slices={slices} total={total} />

        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><Users className="h-4 w-4 text-blue-300" /> {activityHeading}</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">{activitySubheading}</p>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From</label>
                <input type="date" value={activityFrom} onChange={(e) => onActivityFromChange(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">To</label>
                <input type="date" value={activityTo} onChange={(e) => onActivityToChange(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
            </div>
          </div>
          <div className="p-4">
            {activityLoading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
            ) : activityByActor.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No activity in this range.</p>
            ) : (
              <div className="space-y-2 max-w-md">
                {activityByActor.map((a) => (
                  <div key={a.name} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm text-slate-200 truncate" title={a.name}>{a.name}</span>
                    <div className="flex-1 h-5 rounded bg-white/5 overflow-hidden">
                      <div className="h-full rounded bg-blue-500" style={{ width: `${maxActivity > 0 ? (a.count / maxActivity) * 100 : 0}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm font-semibold text-slate-200 tabular-nums">{a.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Default date-range: last 30 days, same window UniversalActivityLogPage
 * defaults to. Shared by every category's Team Activity filter below. */
function last30Days(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function groupByActor(entries: HrActivityLogEntry[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const name = e.actorName || "Unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function HiringAnalyticsPage() {
  const navigate = useNavigate();

  // ── Hiring ──────────────────────────────────────────────────────────
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getCandidates()
      .then((rows) => { if (!cancelled) setCandidates(rows); })
      .catch((err) => console.error("Failed to load candidates for Analytics:", err))
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const hiringDonut = useMemo(() => {
    const counts = new Map<CandidateStatus, number>();
    for (const c of candidates) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    const rows = Array.from(counts.entries())
      .map(([status, count]) => ({ key: status, label: CANDIDATE_STATUS_LABEL[status], count, color: CANDIDATE_STATUS_CHART_COLOR[status] }))
      .sort((a, b) => b.count - a.count);
    return buildDonutSlices(rows);
  }, [candidates]);

  // Shared with Employee Monitoring below (created_by resolution) — fetched
  // once here since Hiring's own Assigned Manager/Interviewer donuts need
  // it too, to resolve assignedManagerId/assignedInterviewerId to a name.
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCompanyUsers()
      .then((rows) => { if (!cancelled) setProfiles(rows); })
      .catch((err) => console.error("Failed to load profiles for Analytics:", err));
    return () => { cancelled = true; };
  }, []);
  const nameByProfileId = useMemo(() => new Map(profiles.map((p) => [p.id, p.display_name || p.email || "Unknown"])), [profiles]);

  const assignedManagerDonut = useMemo(
    () => donutByPerson(candidates, (c) => c.assignedManagerId, nameByProfileId),
    [candidates, nameByProfileId]
  );
  const assignedInterviewerDonut = useMemo(
    () => donutByPerson(candidates, (c) => c.assignedInterviewerId, nameByProfileId),
    [candidates, nameByProfileId]
  );

  const defaultRange = last30Days();
  const [hiringActivityFrom, setHiringActivityFrom] = useState(defaultRange.from);
  const [hiringActivityTo, setHiringActivityTo] = useState(defaultRange.to);
  const [hiringActivityEntries, setHiringActivityEntries] = useState<HrActivityLogEntry[]>([]);
  const [hiringActivityLoading, setHiringActivityLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHiringActivityLoading(true);
    getActivityLog({ targetType: "candidate", from: `${hiringActivityFrom}T00:00:00`, to: `${hiringActivityTo}T23:59:59`, limit: 2000 })
      .then((rows) => { if (!cancelled) setHiringActivityEntries(rows); })
      .catch((err) => { console.error("Failed to load Hiring activity:", err); if (!cancelled) setHiringActivityEntries([]); })
      .finally(() => { if (!cancelled) setHiringActivityLoading(false); });
    return () => { cancelled = true; };
  }, [hiringActivityFrom, hiringActivityTo]);
  const hiringActivityByActor = useMemo(() => groupByActor(hiringActivityEntries), [hiringActivityEntries]);

  // ── Employee Monitoring (Absent List's HR Status) ────────────────────
  // One shared date range drives BOTH the donut and Team Activity below —
  // HR Status is a per-day pick, not a persistent state like a candidate's
  // pipeline stage, so "the breakdown" and "who set it" are naturally the
  // same question over the same window, unlike Hiring's donut (always
  // every candidate, regardless of date) paired with a separately-ranged
  // Team Activity. Same 30-day default as Hiring's own Team Activity.
  const empRange = last30Days();
  const [empFrom, setEmpFrom] = useState(empRange.from);
  const [empTo, setEmpTo] = useState(empRange.to);
  const [empNotesLoading, setEmpNotesLoading] = useState(true);
  const [empNotes, setEmpNotes] = useState<AttendanceNoteRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    setEmpNotesLoading(true);
    getAttendanceNotes(empFrom, empTo)
      .then((rows) => { if (!cancelled) setEmpNotes(rows); })
      .catch((err) => { console.error("Failed to load HR Status breakdown for Analytics:", err); if (!cancelled) setEmpNotes([]); })
      .finally(() => { if (!cancelled) setEmpNotesLoading(false); });
    return () => { cancelled = true; };
  }, [empFrom, empTo]);
  const empHrNoteCounts = useMemo(() => {
    // Scoped to the HR Status field only. attendance_notes rows also exist
    // purely because someone left a general `content` note (a separate,
    // manager-facing field — see AttendanceNoteRow) with no HR Status
    // involved at all, so a blank hrNote can't safely be read as "needs
    // review" — it's just as often "never meant to have a status." Rather
    // than guess, only rows with a real status value are counted here.
    const counts = new Map<string, number>();
    for (const r of empNotes) {
      if (!r.hrNote) continue;
      counts.set(r.hrNote, (counts.get(r.hrNote) ?? 0) + 1);
    }
    return counts;
  }, [empNotes]);

  const empDonut = useMemo(() => {
    // HR Status is a freely-typed/growing option list (Vacation, Sick,
    // Admin, Unnoticed, Not yet Started, …) — unlike CandidateStatus's fixed
    // 9 values, there's no safe way to give every possible label its own
    // permanent identity color within the validated 8-slot palette,  so
    // colors are assigned by rank among whatever actually shows up in the
    // selected range (top 8, largest first) instead of a fixed per-label
    // mapping — the same "fold to Other past N" allowance the dataviz
    // skill calls for on an open-ended category set.
    const rows = Array.from(empHrNoteCounts.entries())
      .map(([label, count]) => ({ key: label, label, count }))
      .sort((a, b) => b.count - a.count)
      .map((r, i) => ({ ...r, color: i < CHART_PALETTE.length ? CHART_PALETTE[i] : CHART_OTHER_COLOR }));
    return buildDonutSlices(rows);
  }, [empHrNoteCounts]);

  const [empActivityEntries, setEmpActivityEntries] = useState<HrActivityLogEntry[]>([]);
  const [empActivityLoading, setEmpActivityLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setEmpActivityLoading(true);
    getActivityLog({ targetType: "attendance_hr_status", from: `${empFrom}T00:00:00`, to: `${empTo}T23:59:59`, limit: 2000 })
      .then((rows) => { if (!cancelled) setEmpActivityEntries(rows); })
      .catch((err) => { console.error("Failed to load Employee Monitoring activity:", err); if (!cancelled) setEmpActivityEntries([]); })
      .finally(() => { if (!cancelled) setEmpActivityLoading(false); });
    return () => { cancelled = true; };
  }, [empFrom, empTo]);
  const empActivityByActor = useMemo(() => {
    // FOR NOW ONLY: hr_activity_log only has entries from when that logging
    // went live (this same session), so on its own Team Activity undercounts
    // anyone who touched a row before then. To bridge that gap, a row with
    // no matching log entry in this range falls back to
    // attendance_notes.created_by — a much older field that's always
    // stamped — restricted to the HR role, since created_by is a single
    // column shared with the plain/manager note (see upsertAttendanceNote)
    // and can get silently overwritten by a non-HR edit that never touched
    // HR Status. Once enough history has accrued under the activity log,
    // this fallback should just be deleted and this should go back to
    // `groupByActor(empActivityEntries)`.
    const counts = new Map<string, number>();
    for (const e of empActivityEntries) {
      const name = e.actorName || "Unknown";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const loggedKeys = new Set(empActivityEntries.map((e) => e.targetId).filter((id): id is string => !!id));
    const hrNameById = new Map(
      profiles
        .filter((p) => normalizeRole(p.role) === "HR" || (p.extra_roles ?? []).some((r) => normalizeRole(r) === "HR"))
        .map((p) => [p.id, p.display_name || p.email || "Unknown"])
    );
    for (const r of empNotes) {
      if (!r.hrNote || !r.createdBy) continue;
      const key = `${r.profileId}|${r.noteDate}`;
      if (loggedKeys.has(key)) continue; // already represented by a log entry — don't double-count
      const name = hrNameById.get(r.createdBy);
      if (!name) continue; // last editor isn't HR — not counted here
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [empActivityEntries, empNotes, profiles]);

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: "hr" } })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <PieChart className="h-5 w-5" /> Analytics
          </h1>
          <p className="text-sm text-slate-400">Status breakdowns and who's actually been making changes, across HR.</p>
        </div>
      </div>

      <div className="space-y-8">
        <AnalyticsCategory
          title="Hiring"
          donutHeading="Candidates by Status"
          donutUnitLabel="candidate"
          loading={candidatesLoading}
          slices={hiringDonut.slices}
          total={hiringDonut.total}
          activityHeading="Team Activity"
          activitySubheading="Who's actually made changes in Hiring — candidates added, status changes, CVs forwarded, deletions."
          activityFrom={hiringActivityFrom}
          onActivityFromChange={setHiringActivityFrom}
          activityTo={hiringActivityTo}
          onActivityToChange={setHiringActivityTo}
          activityLoading={hiringActivityLoading}
          activityByActor={hiringActivityByActor}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DonutPanel heading="Candidates by Assigned Manager" unitLabel="candidate" loading={candidatesLoading} slices={assignedManagerDonut.slices} total={assignedManagerDonut.total} />
          <DonutPanel heading="Candidates by Assigned Interviewer" unitLabel="candidate" loading={candidatesLoading} slices={assignedInterviewerDonut.slices} total={assignedInterviewerDonut.total} />
        </div>

        <AnalyticsCategory
          title="Employee Monitoring"
          donutHeading="HR Status Breakdown"
          donutUnitLabel="status"
          loading={empNotesLoading}
          slices={empDonut.slices}
          total={empDonut.total}
          activityHeading="Team Activity"
          activitySubheading="Who's actually made changes on the Absent List — HR Status set, notes edited. This same range also drives the HR Status Breakdown chart on the left. Rows from before activity logging existed fall back to who's on the row now (HR role only) so counts aren't undercounted for now."
          activityFrom={empFrom}
          onActivityFromChange={setEmpFrom}
          activityTo={empTo}
          onActivityToChange={setEmpTo}
          activityLoading={empActivityLoading || empNotesLoading}
          activityByActor={empActivityByActor}
        />
      </div>
    </main>
  );
}
