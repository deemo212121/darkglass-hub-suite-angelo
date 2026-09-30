/**
 * Absent List — HR module. Everyone with no recorded clock-in on any day in
 * the selected date range (defaults to just today), excluding scheduled
 * rest days (profiles.off_days) and anyone on approved PTO/leave that day
 * (not a genuine miss). Same "no Time In = absent" convention Ticket
 * Attendance's own Status filter already uses, for consistency across the
 * app — this page is the general-purpose "who's missing today (or over a
 * stretch of days)" lookup HR itself reaches for, distinct from Attendance
 * Warning Settings' live grace-window alerting (a different, narrower tool
 * for a different purpose).
 *
 * ADMIN/HR/FINANCE/SUPERADMIN see the whole company. Manager-tier roles
 * also reach this page (DASHBOARD_ROLE_GATES["absent-list"]), scoped by
 * visibleEmployeeMonitoringProfileIds: a Team Leader sees only their own
 * direct reports; Branch Manager tier and up sees their whole downward
 * management chain instead, not just direct reports — see that function's
 * own doc comment for the reasoning.
 *
 * A row is one (person, day) absence — spanning a range can put the same
 * person in multiple rows, each with its own independently editable
 * Note/HR Status for that specific day.
 *
 * Also hosts the Time Off Calendar (HrCalendarTab, moved in from HR &
 * Recruitment Dashboard's own sidebar) as a second view toggled from the
 * buttons up top — both pages answer "who's out and why", so they live
 * together now instead of in two different modules.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Pencil, Check, Loader2, Filter, CalendarDays, ListChecks, ClipboardList, Paperclip, Flag, History, X, BarChart3, AlertTriangle, Umbrella, HeartPulse, ListTodo, FileDown, Users } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS, TECHNICIAN_PAY_ROLES, normalizeRole } from "@/lib/roleLabels";
import { getCompanyUsers, getEmployeeInfoByProfileIds, type ProfileRow } from "@/lib/supabase/users";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleEmployeeMonitoringProfileIds } from "@/lib/notifyRouting";
import { getCompanyTimecardEntries, getProfileIdByFirebaseUid, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getAttendanceNotes, upsertAttendanceNote, upsertAttendanceHrNote, uploadAttendanceNoteAttachment, removeAttendanceNoteAttachment, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { getCompanyPtoRequests, sickYearWindow, sickDaysUsed, SICK_LEAVE_ANNUAL_ALLOWANCE, type PtoRequestRow } from "@/lib/supabase/pto";
import { HrCalendarTab } from "@/components/HrCalendarTab";
import { TicketAttendanceTab } from "@/components/TicketAttendanceTab";
import { PtoManagementTab } from "@/components/PtoManagementTab";
import { EmployeeAttendanceStatusTab } from "@/components/EmployeeAttendanceStatusTab";
import { VisitExceptionReportTab } from "@/components/VisitExceptionReportTab";
import { ExceptionReportsTab } from "@/components/ExceptionReportsTab";
import { HolidayCalendarTab } from "@/components/HolidayCalendarTab";
import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";
import { getCompanyHolidaysInRange, type CompanyHolidayRow } from "@/lib/supabase/companyHolidays";
import { getPendingCorrectionsInRange, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { PendingItemDetailModal, type PendingItem } from "@/components/PendingItemDetailModal";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every "YYYY-MM-DD" from start to end, inclusive — local calendar days, not
 * UTC (toISOString() would shift a date backward a day for anyone east of
 * UTC, e.g. the Philippines). */
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const endD = new Date(end + "T00:00:00");
  for (let d = new Date(start + "T00:00:00"); d <= endD; d.setDate(d.getDate() + 1)) {
    out.push(toDateStr(d));
  }
  return out;
}

// HR Status — replaces what used to be a free-text HR Note with a fixed
// reason list, still stored in the same attendance_notes.hr_note column
// (no migration needed, it was already a plain string).
const HR_STATUS_OPTIONS = [
  "Vacation",
  "Sick",
  "Personal",
  "Holiday",
  "Unpaid",
  "Bereavement",
  "Unnoticed",
  "Present (No Clock-In)",
  "Admin",
  "Resigned",
  "Terminated",
  "Not yet Started",
];
// "Absent" was RENAMED to "Unnoticed" (a label-only change — no clock-in,
// no explanation on file — same status, same severity, same behavior
// everywhere it's used, e.g. HrCalendarTab.tsx's red "Marked Unnoticed"
// cell). Nothing already saved as "Absent" was touched or rewritten — those
// rows keep showing "Absent" via the orphaned-value fallback in
// renderAbsentRow below, and HrCalendarTab.tsx still recognizes both
// "Absent" and "Unnoticed" as the same underlying status so old data keeps
// behaving exactly as it did before the rename. Only a NEW pick from this
// dropdown saves "Unnoticed" going forward.
// Resigned/Terminated end employment entirely and Unnoticed flags a no-call/
// no-show — meaningfully different severity from an ordinary leave type, so
// they get their own color instead of blending into the rest. It's a
// deliberate HR call (never assumed/auto-set — see absentRows above, which
// only lists candidates for review, not confirmed absences), so it also
// gets its own color rather than blending in with Vacation/Sick/etc.
// "Present (No Clock-In)" is the opposite correction — HR confirming the
// person WAS actually there that day, just never clocked in (forgot, bad
// wifi, manual timecard later, etc.) — the common case for anyone whose
// attendance isn't tracked by the time clock at all (HR/office/admin
// roles), who would otherwise show up on this page every workday. "Admin"
// covers a day spent on administrative/office duty rather than their usual
// clock-in work. None of these three are a leave type, so all are excluded
// from HR_STATUS_TO_PTO_TYPE the same way Unnoticed/Resigned/Terminated are
// (see HrCalendarTab.tsx) and never plot on the Time Off Calendar.
const HR_STATUS_COLOR: Record<string, string> = {
  // "Absent" kept here (not in HR_STATUS_OPTIONS anymore) purely so a
  // pre-rename row still renders red instead of falling back to the
  // default grey — see the comment above.
  Absent: "text-red-300",
  Unnoticed: "text-red-300",
  "Present (No Clock-In)": "text-cyan-300",
  Admin: "text-sky-300",
  Resigned: "text-red-300",
  Terminated: "text-red-300",
  "Not yet Started": "text-violet-300",
};

interface AbsentRow {
  profile: ProfileRow;
  date: string;
  note: string;
  hrNote: string;
  pendingItem: PendingItem | null;
}

export function AbsentListPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, displayName, companyId, role, extraRoles } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  // Time Off Calendar moved in here from HR & Recruitment Dashboard's own
  // sidebar — they're both "who's out and why" tools, so it's a toggle on
  // this page now rather than a separate module tab. Ticket Attendance is
  // the same self-contained tab Accounting Dashboard and Attendance
  // Monitoring already mount (TicketAttendanceTab.tsx takes no props and
  // fetches its own data), added as a third view so HR can check on-site
  // check-ins without leaving this page.
  const [view, setView] = useState<"list" | "calendar" | "ticketAttendance" | "ptoManagement" | "exceptionReports" | "holidays" | "visitExceptions" | "exceededSickDays" | "pendingExplanations" | "attendanceStatus">("list");
  const [statsCardHidden, setStatsCardHidden] = useState(false);
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [notes, setNotes] = useState<AttendanceNoteRow[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-column funnel filters in the header row — Role/Branch/Manager are
  // multi-select (empty set = no restriction), Note is tri-state (All/Has
  // note/No note). Same pattern Ticket Attendance's own header filters use.
  type TriState = "all" | "has" | "none";
  type FilterMenuKey =
    | "name" | "role" | "branch" | "manager" | "notes" | "hrNote" | "correction"
    | "peName" | "peRole" | "peBranch" | "peManager"
    | "esdName" | "esdRole" | "esdBranch" | "esdManager" | "esdStatus";
  const [openFilterMenu, setOpenFilterMenu] = useState<FilterMenuKey | null>(null);
  const [nameFilter, setNameFilter] = useState<Set<string>>(new Set());
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [branchFilter, setBranchFilter] = useState<Set<string>>(new Set());
  const [managerFilter, setManagerFilter] = useState<Set<string>>(new Set());
  const [notesColFilter, setNotesColFilter] = useState<TriState>("all");
  const [hrStatusFilter, setHrStatusFilter] = useState<Set<string>>(new Set());
  const [correctionFilter, setCorrectionFilter] = useState<TriState>("all");

  // Pending Explanations — its own independent Date range/Search/column
  // funnels, separate from the List tab's (switching tabs never changes
  // what another tab was showing).
  const [peDateFrom, setPeDateFrom] = useState(todayISO());
  const [peDateTo, setPeDateTo] = useState(todayISO());
  const [peSearch, setPeSearch] = useState("");
  const [peNameFilter, setPeNameFilter] = useState<Set<string>>(new Set());
  const [peRoleFilter, setPeRoleFilter] = useState<Set<string>>(new Set());
  const [peBranchFilter, setPeBranchFilter] = useState<Set<string>>(new Set());
  const [peManagerFilter, setPeManagerFilter] = useState<Set<string>>(new Set());

  // Exceeded Sick Days — its own independent "as of" date (a single-day
  // snapshot, not a range: sick balance is a tenure-year total, not a
  // per-day thing) + Search + column funnels, including a Status funnel
  // for the Pending Request/Fully Decided badge.
  const [esdAsOfDate, setEsdAsOfDate] = useState(todayISO());
  const [esdSearch, setEsdSearch] = useState("");
  const [esdNameFilter, setEsdNameFilter] = useState<Set<string>>(new Set());
  const [esdRoleFilter, setEsdRoleFilter] = useState<Set<string>>(new Set());
  const [esdBranchFilter, setEsdBranchFilter] = useState<Set<string>>(new Set());
  const [esdManagerFilter, setEsdManagerFilter] = useState<Set<string>>(new Set());
  const [esdStatusFilter, setEsdStatusFilter] = useState<TriState>("all");

  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  // Employee roster + PTO requests don't depend on the selected date —
  // loaded once, separately from the per-date timecard/notes fetch below.
  const [hireDateByProfileId, setHireDateByProfileId] = useState<Map<string, string>>(new Map());
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  useEffect(() => {
    getCompanyUsers()
      .then((rows) => {
        setProfiles(rows);
        // Hire dates power the Time Off Calendar's Sick Leave/Vacation PTO
        // badges (same tenure math Master List uses) — a separate fetch
        // since it isn't part of getCompanyUsers' own select.
        return getEmployeeInfoByProfileIds(rows.map((p) => p.id));
      })
      .then((infoByProfile) => {
        const m = new Map<string, string>();
        for (const [id, info] of infoByProfile) if (info.hireDate) m.set(id, info.hireDate);
        setHireDateByProfileId(m);
      })
      .catch((err) => console.error("Failed to load employees for Absent List:", err));
    getCompanyPtoRequests()
      .then(setPtoRequests)
      .catch((err) => console.error("Failed to load PTO requests for Absent List:", err));
    // Only feeds visibleEmployeeMonitoringProfileIds' CSR_MANAGER "see every
    // team" case below — safe to just no-op if the composition tables don't
    // exist yet (a company that hasn't set up CSR Team Composition), same
    // as AttendanceMonitoringPage.tsx's own fetch.
    getCsrTeamComposition()
      .then(setCsrComposition)
      .catch(() => setCsrComposition(null));
  }, []);

  // Manager-tier roles (Team Leader, Branch Manager and up) only see their
  // own reports here; Admin/HR/Finance/SuperAdmin see everyone (returns
  // null = unrestricted). See visibleEmployeeMonitoringProfileIds' own doc
  // comment for exactly how the scope differs by tier.
  const myProfile = useMemo(() => (myProfileId ? profiles.find((p) => p.id === myProfileId) ?? null : null), [myProfileId, profiles]);
  const teamScopedIds = useMemo(
    () => (myProfile ? visibleEmployeeMonitoringProfileIds(myProfile, profiles, csrComposition) : null),
    [myProfile, profiles, csrComposition]
  );
  const visibleProfiles = useMemo(
    () => (teamScopedIds === null ? profiles : profiles.filter((p) => teamScopedIds.has(p.id))),
    [profiles, teamScopedIds]
  );

  const [holidays, setHolidays] = useState<CompanyHolidayRow[]>([]);
  const [pendingCorrections, setPendingCorrections] = useState<TimecardCorrectionRow[]>([]);
  const load = () => {
    if (dateTo < dateFrom) return; // invalid range mid-edit (e.g. only "From" typed so far) — wait for a valid one
    // Pending Explanations has its own independent date range now — fetch
    // the union of both so one shared load covers whatever either tab is
    // currently showing, instead of a second full fetch per tab. An
    // invalid (mid-edit) pe range just falls back to the List tab's own
    // range for this union.
    const peValid = peDateTo >= peDateFrom;
    const from = peValid && peDateFrom < dateFrom ? peDateFrom : dateFrom;
    const to = peValid && peDateTo > dateTo ? peDateTo : dateTo;
    setLoading(true);
    Promise.all([
      getCompanyTimecardEntries(from, to),
      getAttendanceNotes(from, to),
      getCompanyHolidaysInRange(from, to),
      getPendingCorrectionsInRange(from, to),
    ])
      .then(([tc, n, hol, pending]) => {
        setEntries(tc);
        setNotes(n);
        setHolidays(hol);
        setPendingCorrections(pending);
      })
      .catch((err) => console.error("Failed to load Absent List:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, peDateFrom, peDateTo]);

  // Keyed "profileId|date" — check-in and notes are both per (profile, day),
  // same as everything else on this page once it spans more than one day.
  const checkedInSet = useMemo(
    () => new Set(entries.filter((e) => e.checkIn).map((e) => `${e.profileId}|${e.workDate}`)),
    [entries]
  );
  const noteByKey = useMemo(() => new Map(notes.map((n) => [`${n.profileId}|${n.noteDate}`, n])), [notes]);
  // Approved, paid or unpaid leave covering a given date — not counted as
  // absent (it's scheduled and already reviewed), just excluded outright.
  const isOnLeave = (profileId: string, d: string) =>
    ptoRequests.some((r) => r.profileId === profileId && r.status === "approved" && r.startDate <= d && d <= r.endDate);

  // Company Holidays (Holiday Calendar tab) — one shared calendar for
  // everyone, US and Philippines staff alike (per HR's explicit call —
  // Philippines follows the same U.S. holiday list rather than its own).
  const holidayDates = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const isCompanyHoliday = (d: string): boolean => holidayDates.has(d);

  // Pending Timecard Corrections or PTO requests — someone already filed
  // something for this day that's awaiting manager/HR/Accounting review, so
  // this isn't a plain unexplained absence. Unlike holidays/approved leave,
  // these rows stay on the list (see the Correction column below) rather
  // than being excluded outright — this page's whole point is HR review, and
  // a pending request is still an open item worth seeing, just distinctly
  // marked (and, on click, identified as a correction vs. a PTO request)
  // from a genuine no-show.
  const pendingCorrectionByKey = useMemo(() => new Map(pendingCorrections.map((c) => [`${c.profileId}|${c.workDate}`, c])), [pendingCorrections]);
  const pendingPtoRequests = useMemo(() => ptoRequests.filter((r) => r.status === "pending"), [ptoRequests]);
  const pendingItemFor = (profileId: string, d: string): PendingItem | null => {
    const correction = pendingCorrectionByKey.get(`${profileId}|${d}`);
    if (correction) return { type: "correction", data: correction };
    const pto = pendingPtoRequests.find((r) => r.profileId === profileId && r.startDate <= d && d <= r.endDate);
    if (pto) return { type: "pto", data: pto };
    return null;
  };

  // Every date in the selected range, oldest first.
  const rangeDates = useMemo(() => (dateTo >= dateFrom ? enumerateDates(dateFrom, dateTo) : []), [dateFrom, dateTo]);

  // Filter-menu option lists — sourced from the (scope-narrowed) active
  // roster, not just today's absent rows, so the checklists stay stable
  // regardless of what's currently filtered.
  const nameOptions = useMemo(
    () => Array.from(new Set(visibleProfiles.filter((p) => p.is_active).map((p) => p.display_name || p.email))).sort(),
    [visibleProfiles]
  );
  const roleOptions = useMemo(
    () => Array.from(new Set(visibleProfiles.filter((p) => p.is_active).map((p) => p.role))).sort((a, b) => (ROLE_LABELS[a] || a).localeCompare(ROLE_LABELS[b] || b)),
    [visibleProfiles]
  );
  const branchOptions = useMemo(
    () => Array.from(new Set(visibleProfiles.filter((p) => p.is_active).map((p) => p.assigned_branch).filter((b): b is string => !!b))).sort(),
    [visibleProfiles]
  );
  const managerOptions = useMemo(
    () => Array.from(new Set(visibleProfiles.filter((p) => p.is_active).map((p) => p.manager_name).filter((m): m is string => !!m))).sort(),
    [visibleProfiles]
  );

  // Shared by every tab's own Name/Role/Branch/Manager narrowing (List,
  // Pending Explanations, Exceeded Sick Days) — same filter shape, just fed
  // each tab's own independent search text + filter Sets.
  const filterProfilesBy = (
    list: ProfileRow[],
    searchQ: string,
    nameSet: Set<string>,
    roleSet: Set<string>,
    branchSet: Set<string>,
    managerSet: Set<string>
  ) => {
    const q = searchQ.trim().toLowerCase();
    return list
      .filter((p) => p.is_active)
      .filter((p) => !q || (p.display_name || p.email).toLowerCase().includes(q))
      .filter((p) => nameSet.size === 0 || nameSet.has(p.display_name || p.email))
      .filter((p) => roleSet.size === 0 || roleSet.has(p.role))
      .filter((p) => branchSet.size === 0 || (p.assigned_branch && branchSet.has(p.assigned_branch)))
      .filter((p) => managerSet.size === 0 || (p.manager_name && managerSet.has(p.manager_name)));
  };

  // Name/Role/Branch/Manager filters don't depend on the date — narrow the
  // (scope-narrowed) roster once, then apply the per-day checks (rest day/
  // leave/check-in) per date in the range against that same narrowed list.
  const activeFilteredProfiles = useMemo(
    () => filterProfilesBy(visibleProfiles, search, nameFilter, roleFilter, branchFilter, managerFilter),
    [visibleProfiles, search, nameFilter, roleFilter, branchFilter, managerFilter]
  );
  const peActiveFilteredProfiles = useMemo(
    () => filterProfilesBy(visibleProfiles, peSearch, peNameFilter, peRoleFilter, peBranchFilter, peManagerFilter),
    [visibleProfiles, peSearch, peNameFilter, peRoleFilter, peBranchFilter, peManagerFilter]
  );
  const esdActiveFilteredProfiles = useMemo(
    () => filterProfilesBy(visibleProfiles, esdSearch, esdNameFilter, esdRoleFilter, esdBranchFilter, esdManagerFilter),
    [visibleProfiles, esdSearch, esdNameFilter, esdRoleFilter, esdBranchFilter, esdManagerFilter]
  );
  const peRangeDates = useMemo(() => (peDateTo >= peDateFrom ? enumerateDates(peDateFrom, peDateTo) : []), [peDateFrom, peDateTo]);

  const absentRows: AbsentRow[] = useMemo(() => {
    const rows: AbsentRow[] = [];
    for (const d of rangeDates) {
      const dow = new Date(d + "T00:00:00").getDay();
      for (const p of activeFilteredProfiles) {
        if ((p.off_days ?? []).includes(dow)) continue; // scheduled rest day
        const hireDate = hireDateByProfileId.get(p.id);
        if (hireDate && d < hireDate) continue; // not hired yet as of this date
        if (isOnLeave(p.id, d)) continue; // approved PTO/leave
        if (isCompanyHoliday(d)) continue; // company holiday
        if (checkedInSet.has(`${p.id}|${d}`)) continue; // checked in that day
        const entry = noteByKey.get(`${p.id}|${d}`);
        const note = entry?.content || "";
        // Being on this list (no clock-in on file, not on leave, not a rest
        // day) does NOT mean the person was actually absent — someone whose
        // presence just isn't tracked by the time clock (HR/office/admin
        // roles) would show up here every single workday. So this is left
        // blank until HR explicitly confirms what actually happened that
        // day; "Absent" is still a pickable option, it's just no longer
        // assumed. (A previous version of this page auto-defaulted and
        // auto-saved "Absent" here — that produced false absences for
        // exactly that reason and was reverted.)
        const hrNote = entry?.hrNote || "";
        if (notesColFilter !== "all" && (notesColFilter === "has" ? !note : !!note)) continue;
        if (hrStatusFilter.size > 0 && !hrStatusFilter.has(hrNote)) continue;
        const pendingItem = pendingItemFor(p.id, d);
        if (correctionFilter !== "all" && (correctionFilter === "has" ? !pendingItem : !!pendingItem)) continue;
        rows.push({ profile: p, date: d, note, hrNote, pendingItem });
      }
    }
    return rows.sort(
      (a, b) => a.date.localeCompare(b.date) || (a.profile.display_name || a.profile.email).localeCompare(b.profile.display_name || b.profile.email)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDates, activeFilteredProfiles, checkedInSet, noteByKey, notesColFilter, hrStatusFilter, correctionFilter, ptoRequests, holidayDates, pendingCorrectionByKey, pendingPtoRequests, hireDateByProfileId]);

  const onLeaveCount = useMemo(() => {
    let count = 0;
    for (const d of rangeDates) {
      const dow = new Date(d + "T00:00:00").getDay();
      count += visibleProfiles.filter((p) => p.is_active && !(p.off_days ?? []).includes(dow) && isOnLeave(p.id, d)).length;
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProfiles, rangeDates, ptoRequests]);

  // Read-only breakdown of the HR Status already applied on the rows
  // currently shown (absentRows, i.e. whatever's left after the header
  // filters) — purely a count, doesn't change what "Absent" means or how/
  // when it gets set (see absentRows' own comment: HR Status is never
  // assumed/auto-set). "—" groups rows nobody has reviewed yet. Always sums
  // to absentRows.length, same number shown just above it.
  const hrStatusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of absentRows) {
      const k = r.hrNote || "—";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [absentRows]);

  // absentRows is already sorted date-then-name, so grouping preserves that
  // order — one section per day, in range order, names beneath each.
  const groupedAbsentRows = useMemo(() => {
    const groups = new Map<string, AbsentRow[]>();
    for (const r of absentRows) {
      const list = groups.get(r.date) ?? [];
      list.push(r);
      groups.set(r.date, list);
    }
    return Array.from(groups.entries());
  }, [absentRows]);

  // "Pending Explanations / Excuses" — a To-Do view of the same underlying
  // absence data absentRows computes, but ignoring the List tab's own
  // Notes/HR Status/Correction column filters (this view's whole point IS
  // "no HR Status set yet", so that condition is hardcoded here rather than
  // becoming another pickable option in that filter menu). Has its own
  // independent Date range/Search/Name/Role/Branch/Manager filters (pe*),
  // separate from the List tab's — see load()'s union-range comment for
  // how the underlying entries/notes/holidays/corrections data still
  // covers whatever this tab's own range is.
  const pendingExplanationRows: AbsentRow[] = useMemo(() => {
    const rows: AbsentRow[] = [];
    for (const d of peRangeDates) {
      const dow = new Date(d + "T00:00:00").getDay();
      for (const p of peActiveFilteredProfiles) {
        if ((p.off_days ?? []).includes(dow)) continue;
        const hireDate = hireDateByProfileId.get(p.id);
        if (hireDate && d < hireDate) continue;
        if (isOnLeave(p.id, d)) continue;
        if (isCompanyHoliday(d)) continue;
        if (checkedInSet.has(`${p.id}|${d}`)) continue;
        const entry = noteByKey.get(`${p.id}|${d}`);
        const hrNote = entry?.hrNote || "";
        if (hrNote) continue; // already explained/reviewed — nothing pending here
        rows.push({ profile: p, date: d, note: entry?.content || "", hrNote, pendingItem: pendingItemFor(p.id, d) });
      }
    }
    return rows.sort(
      (a, b) => a.date.localeCompare(b.date) || (a.profile.display_name || a.profile.email).localeCompare(b.profile.display_name || b.profile.email)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peRangeDates, peActiveFilteredProfiles, checkedInSet, noteByKey, ptoRequests, holidayDates, pendingCorrectionByKey, pendingPtoRequests, hireDateByProfileId]);

  const groupedPendingExplanationRows = useMemo(() => {
    const groups = new Map<string, AbsentRow[]>();
    for (const r of pendingExplanationRows) {
      const list = groups.get(r.date) ?? [];
      list.push(r);
      groups.set(r.date, list);
    }
    return Array.from(groups.entries());
  }, [pendingExplanationRows]);

  // "Exceeded Sick Days" — technician-tier employees who've used (approved
  // or still-pending — sickDaysUsed counts anything not denied/cancelled,
  // so a pending request already counts toward "used" here) more Sick
  // Leave than their SICK_LEAVE_ANNUAL_ALLOWANCE for their current tenure
  // year (see pto.ts's sickYearWindow/sickDaysUsed — same allowance math
  // HrCalendarTab/Master List already show per person). hasPendingRequest
  // is surfaced separately so HR can see at a glance which over-limit rows
  // still have a request awaiting review vs. ones that are already fully
  // decided.
  interface SickDaysExceededRow {
    profile: ProfileRow;
    used: number;
    allowance: number;
    hasPendingRequest: boolean;
    requests: PtoRequestRow[];
  }
  const fmtSickDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // Sick Leave remaining/allowance per person — same badge HrCalendarTab
  // already shows next to a name, reused here so HR sees the balance right
  // where they're reviewing an absence, not just on the Exceeded Sick Days
  // tab. Everyone, not just technicians — the allowance itself isn't
  // technician-specific (see pto.ts's sickYearWindow).
  const sickBalanceByProfileId = useMemo(() => {
    const map = new Map<string, { remaining: number; allowance: number }>();
    for (const p of visibleProfiles) {
      if (!p.is_active) continue;
      const window = sickYearWindow(hireDateByProfileId.get(p.id) || null, p.created_at || null);
      if (!window) continue;
      const myRequests = ptoRequests.filter((r) => r.profileId === p.id && r.ptoType === "sick");
      const used = sickDaysUsed(myRequests, window);
      map.set(p.id, { remaining: Math.max(0, window.allowance - used), allowance: window.allowance });
    }
    return map;
  }, [visibleProfiles, ptoRequests, hireDateByProfileId]);
  const exceededSickDaysRows: SickDaysExceededRow[] = useMemo(() => {
    const rows: SickDaysExceededRow[] = [];
    for (const p of esdActiveFilteredProfiles) {
      if (!TECHNICIAN_PAY_ROLES.has(normalizeRole(p.role))) continue;
      // "As of" esdAsOfDate, not always today — sickYearWindow's onDate
      // param picks which tenure year (and its allowance/used totals)
      // applies as of that date, per the user's own call on how the date
      // field should behave for a tenure-year balance instead of a range.
      const window = sickYearWindow(hireDateByProfileId.get(p.id) || null, p.created_at || null, esdAsOfDate);
      if (!window) continue;
      const myRequests = ptoRequests.filter((r) => r.profileId === p.id && r.ptoType === "sick");
      const used = sickDaysUsed(myRequests, window);
      if (used <= window.allowance) continue;
      const requestsInWindow = myRequests.filter(
        (r) => r.status !== "denied" && r.status !== "cancelled" && r.startDate >= window.start && r.startDate < window.end
      );
      const hasPendingRequest = requestsInWindow.some((r) => r.status === "pending");
      if (esdStatusFilter === "has" && !hasPendingRequest) continue;
      if (esdStatusFilter === "none" && hasPendingRequest) continue;
      rows.push({
        profile: p,
        used,
        allowance: window.allowance,
        hasPendingRequest,
        requests: requestsInWindow.sort((a, b) => a.startDate.localeCompare(b.startDate)),
      });
    }
    return rows.sort((a, b) => b.used - b.allowance - (a.used - a.allowance) || (a.profile.display_name || a.profile.email).localeCompare(b.profile.display_name || b.profile.email));
  }, [esdActiveFilteredProfiles, ptoRequests, hireDateByProfileId, esdAsOfDate, esdStatusFilter]);

  // Shape HrCalendarTab expects — same (scope-narrowed) roster this page
  // already loads, just remapped field names.
  const calendarEmployees = useMemo(
    () =>
      visibleProfiles.map((p) => ({
        id: p.id,
        name: p.display_name || p.email,
        branch: p.assigned_branch || "",
        status: p.is_active ? "active" : "inactive",
        role: p.role,
        startDate: hireDateByProfileId.get(p.id) || p.created_at?.slice(0, 10) || null,
        managerName: p.manager_name || null,
        offDays: p.off_days ?? null,
      })),
    [visibleProfiles, hireDateByProfileId]
  );

  // Keyed "profileId|date" (not just profileId) — a person can now appear
  // in several rows at once (one per absent day in the range), each with
  // its own independently editable note/status.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const handleSaveNote = async (profileId: string, noteDate: string) => {
    if (!companyId) return;
    const content = noteDraft;
    const key = `${profileId}|${noteDate}`;
    const previousContent = notes.find((n) => n.profileId === profileId && n.noteDate === noteDate)?.content || "";
    setSavingNoteId(key);
    try {
      await upsertAttendanceNote({
        profileId,
        noteDate,
        content,
        notifyIndividual: false,
        notifyTeamLead: false,
        createdBy: myProfileId,
        companyId,
      });
      if (content !== previousContent) {
        const p = profiles.find((pr) => pr.id === profileId);
        void logActivity({
          action: "attendance_note_changed",
          targetType: "attendance_hr_status",
          targetId: key,
          targetLabel: `${p?.display_name || p?.email || profileId} — ${noteDate}`,
          details: { from: previousContent || "(none)", to: content || "(none)" },
        });
      }
      setNotes((prev) => {
        const existing = prev.find((n) => n.profileId === profileId && n.noteDate === noteDate);
        return [
          ...prev.filter((n) => !(n.profileId === profileId && n.noteDate === noteDate)),
          {
            profileId,
            noteDate,
            content,
            hrNote: existing?.hrNote || "",
            notifyIndividual: false,
            notifyTeamLead: false,
            createdBy: myProfileId,
            attachmentPath: existing?.attachmentPath ?? null,
            attachmentAddedBy: existing?.attachmentAddedBy ?? null,
            attachmentAddedAt: existing?.attachmentAddedAt ?? null,
            attachmentRemovedBy: existing?.attachmentRemovedBy ?? null,
            attachmentRemovedAt: existing?.attachmentRemovedAt ?? null,
          },
        ];
      });
      setEditingId(null);
    } catch (err) {
      alert(`Failed to save note: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingNoteId(null);
    }
  };

  const [savingHrNoteId, setSavingHrNoteId] = useState<string | null>(null);
  const handleSaveHrStatus = async (profileId: string, noteDate: string, hrNote: string) => {
    const key = `${profileId}|${noteDate}`;
    // Captured before the save so the activity log can show the actual
    // transition (e.g. "Absent → Sick"), not just the new value in isolation.
    const previousHrNote = notes.find((n) => n.profileId === profileId && n.noteDate === noteDate)?.hrNote || "";
    setSavingHrNoteId(key);
    try {
      await upsertAttendanceHrNote(profileId, noteDate, hrNote, myProfileId, companyId);
      if (hrNote !== previousHrNote) {
        const p = profiles.find((pr) => pr.id === profileId);
        void logActivity({
          action: "attendance_hr_status_changed",
          targetType: "attendance_hr_status",
          targetId: key,
          targetLabel: `${p?.display_name || p?.email || profileId} — ${noteDate}`,
          details: { from: previousHrNote || "(none)", to: hrNote || "(none)" },
        });
      }
      setNotes((prev) => {
        const existing = prev.find((n) => n.profileId === profileId && n.noteDate === noteDate);
        if (existing) return prev.map((n) => (n.profileId === profileId && n.noteDate === noteDate ? { ...n, hrNote, createdBy: myProfileId ?? n.createdBy } : n));
        return [...prev, { profileId, noteDate, content: "", hrNote, notifyIndividual: false, notifyTeamLead: false, createdBy: myProfileId, attachmentPath: null, attachmentAddedBy: null, attachmentAddedAt: null, attachmentRemovedBy: null, attachmentRemovedAt: null }];
      });
    } catch (err) {
      alert(`Failed to save HR status: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingHrNoteId(null);
    }
  };

  // Photo/file backing up an HR Status (e.g. a doctor's note) — shows up on
  // the Time Off Calendar's own orange-cell popup too (see
  // hrPlottedByProfile in HrCalendarTab.tsx), since both read/write the
  // same attendance_notes row.
  const [uploadingAttachmentId, setUploadingAttachmentId] = useState<string | null>(null);
  const handleAttachFile = async (profileId: string, noteDate: string, file: File) => {
    if (!companyId) return;
    const key = `${profileId}|${noteDate}`;
    setUploadingAttachmentId(key);
    try {
      const path = await uploadAttendanceNoteAttachment(profileId, noteDate, companyId, file, myProfileId);
      const now = new Date().toISOString();
      setNotes((prev) => {
        const existing = prev.find((n) => n.profileId === profileId && n.noteDate === noteDate);
        if (existing)
          return prev.map((n) =>
            n.profileId === profileId && n.noteDate === noteDate
              ? { ...n, attachmentPath: path, attachmentAddedBy: myProfileId, attachmentAddedAt: now, attachmentRemovedBy: null, attachmentRemovedAt: null }
              : n
          );
        return [
          ...prev,
          {
            profileId,
            noteDate,
            content: "",
            hrNote: "",
            notifyIndividual: false,
            notifyTeamLead: false,
            createdBy: myProfileId,
            attachmentPath: path,
            attachmentAddedBy: myProfileId,
            attachmentAddedAt: now,
            attachmentRemovedBy: null,
            attachmentRemovedAt: null,
          },
        ];
      });
      const employee = profiles.find((p) => p.id === profileId);
      void logActivity({
        action: "attendance_attachment_added",
        targetType: "attendance_hr_status",
        targetId: key,
        targetLabel: `${employee?.display_name || employee?.email || profileId} — ${noteDate}`,
        details: { fileName: file.name },
      });
    } catch (err) {
      alert(`Failed to attach file: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploadingAttachmentId(null);
    }
  };
  const [previewAttachmentUrl, setPreviewAttachmentUrl] = useState<string | null>(null);
  const [pendingDetailModal, setPendingDetailModal] = useState<{ profileName: string; date: string; item: PendingItem } | null>(null);
  const [historyModal, setHistoryModal] = useState<{ profileId: string; date: string; profileName: string } | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HrActivityLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const openHistory = (profileId: string, date: string, profileName: string) => {
    setHistoryModal({ profileId, date, profileName });
    setHistoryLoading(true);
    getActivityLog({ targetId: `${profileId}|${date}`, limit: 20 })
      .then(setHistoryEntries)
      .catch((err) => {
        console.error("Failed to load activity history:", err);
        setHistoryEntries([]);
      })
      .finally(() => setHistoryLoading(false));
  };
  const handleViewAttachment = (attachmentPath: string) => {
    setPreviewAttachmentUrl(attachmentPath);
  };
  const handleRemoveAttachment = async (profileId: string, noteDate: string, attachmentPath: string) => {
    if (!confirm("Remove this attachment?")) return;
    const key = `${profileId}|${noteDate}`;
    setUploadingAttachmentId(key);
    try {
      await removeAttendanceNoteAttachment(profileId, noteDate, attachmentPath, myProfileId);
      const now = new Date().toISOString();
      setNotes((prev) =>
        prev.map((n) => (n.profileId === profileId && n.noteDate === noteDate ? { ...n, attachmentPath: null, attachmentRemovedBy: myProfileId, attachmentRemovedAt: now } : n))
      );
      const employee = profiles.find((p) => p.id === profileId);
      void logActivity({
        action: "attendance_attachment_removed",
        targetType: "attendance_hr_status",
        targetId: key,
        targetLabel: `${employee?.display_name || employee?.email || profileId} — ${noteDate}`,
        details: {},
      });
    } catch (err) {
      alert(`Failed to remove attachment: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploadingAttachmentId(null);
    }
  };

  // Shared markup for the Role/Branch/Manager multi-select header filters.
  const renderMultiSelectFilterHeader = (
    key: FilterMenuKey,
    label: string,
    options: string[],
    selected: Set<string>,
    setSelected: (s: Set<string>) => void,
    optionLabel: (v: string) => string = (v) => v
  ) => (
    <>
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => setOpenFilterMenu((cur) => (cur === key ? null : key))}
          title={`Filter by ${label}`}
          className={selected.size > 0 ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}
        >
          <Filter className="h-3 w-3" />
        </button>
      </span>
      {openFilterMenu === key && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenFilterMenu(null)} />
          <div className="absolute left-0 top-full mt-1 w-56 max-h-72 overflow-y-auto bg-slate-900 border border-white/15 rounded-lg shadow-2xl z-50 p-2 normal-case font-normal text-left">
            {options.length === 0 ? (
              <div className="text-xs text-slate-500 px-2 py-1.5">No options.</div>
            ) : (
              <>
                {options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(opt)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(opt)) next.delete(opt);
                        else next.add(opt);
                        setSelected(next);
                      }}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    {optionLabel(opt)}
                  </label>
                ))}
                {selected.size > 0 && (
                  <button type="button" onClick={() => setSelected(new Set())} className="mt-1 w-full text-left text-xs text-blue-300 hover:text-blue-200 px-2 py-1">
                    Clear
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  // Shared markup for the Note/HR Note tri-state ("All"/"Has"/"None") header filters.
  const renderTriStateFilterHeader = (
    key: FilterMenuKey,
    label: string,
    value: TriState,
    setValue: (v: TriState) => void,
    hasLabel: string,
    noneLabel: string
  ) => (
    <>
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => setOpenFilterMenu((cur) => (cur === key ? null : key))}
          title={`Filter by ${label}`}
          className={value !== "all" ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}
        >
          <Filter className="h-3 w-3" />
        </button>
      </span>
      {openFilterMenu === key && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenFilterMenu(null)} />
          <div className="absolute left-0 top-full mt-1 w-40 bg-slate-900 border border-white/15 rounded-lg shadow-2xl z-50 p-1 normal-case font-normal text-left">
            {([
              ["all", "All"],
              ["has", hasLabel],
              ["none", noneLabel],
            ] as [TriState, string][]).map(([v, vLabel]) => (
              <button
                key={v}
                type="button"
                onClick={() => { setValue(v); setOpenFilterMenu(null); }}
                className={`block w-full text-left px-2 py-1.5 text-sm rounded hover:bg-white/5 ${value === v ? "text-blue-300 font-semibold" : "text-slate-200"}`}
              >
                {vLabel}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );

  const renderAbsentRow = ({ profile: p, date: rowDate, note, hrNote, pendingItem }: AbsentRow) => {
    const key = `${p.id}|${rowDate}`;
    const isEditing = editingId === key;
    return (
      <tr key={key} className="border-b border-white/5">
        <td className="py-2 pr-3 text-white font-medium whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            {p.display_name || p.email}
            {(() => {
              const sick = sickBalanceByProfileId.get(p.id);
              return sick ? (
                <span
                  className="bg-teal-500/20 text-teal-300 px-1 py-0.5 rounded text-[9px] font-semibold shrink-0"
                  title={`Sick Leave remaining/allowance: ${sick.remaining}/${sick.allowance}`}
                >
                  {sick.remaining}/{sick.allowance}
                </span>
              ) : null;
            })()}
          </span>
        </td>
        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{ROLE_LABELS[p.role] || p.role}</td>
        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{p.assigned_branch || "—"}</td>
        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{p.manager_name || "—"}</td>
        <td className="py-2 pr-3 min-w-[220px]">
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveNote(p.id, rowDate);
                  if (e.key === "Escape") setEditingId(null);
                }}
                placeholder="Why are they absent?"
                className="glass-input text-xs py-1"
              />
              <button
                type="button"
                onClick={() => void handleSaveNote(p.id, rowDate)}
                disabled={savingNoteId === key}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 shrink-0"
              >
                {savingNoteId === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingId(key);
                setNoteDraft(note);
              }}
              className="flex items-center gap-1.5 text-left text-slate-300 hover:text-white"
            >
              {note ? <span className="truncate max-w-[260px]">{note}</span> : <span className="text-slate-600">Add note</span>}
              <Pencil className="h-3 w-3 text-slate-500 shrink-0" />
            </button>
          )}
        </td>
        <td className="py-2 pr-3 min-w-[160px]">
          <div className="flex items-center gap-1.5">
            <select
              value={hrNote}
              onChange={(e) => void handleSaveHrStatus(p.id, rowDate, e.target.value)}
              disabled={savingHrNoteId === key}
              className={`glass-input text-xs py-1 disabled:opacity-50 ${HR_STATUS_COLOR[hrNote] || "text-slate-300"}`}
            >
              {/* Explicit dark background on every option — the dropdown
                  popup is browser chrome, not this page, so without it the
                  light status text renders on the browser's own near-white
                  popup and becomes nearly unreadable. */}
              <option value="" className="bg-slate-800 text-slate-400">—</option>
              {HR_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} className={`bg-slate-800 ${HR_STATUS_COLOR[s] || "text-slate-200"}`}>{s}</option>
              ))}
              {/* A row already saved with a status that's since been removed
                  from HR_STATUS_OPTIONS (e.g. "Unnoticed") keeps showing it
                  here instead of going blank — picking anything else still
                  works normally, this option just isn't offered on a row
                  that doesn't already have it. */}
              {hrNote && !HR_STATUS_OPTIONS.includes(hrNote) && (
                <option value={hrNote} className={`bg-slate-800 ${HR_STATUS_COLOR[hrNote] || "text-slate-200"}`}>{hrNote}</option>
              )}
            </select>
            {savingHrNoteId === key && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500 shrink-0" />}
            <button
              type="button"
              onClick={() => openHistory(p.id, rowDate, p.display_name || p.email)}
              title="View change history for this day"
              className="text-slate-500 hover:text-slate-300 shrink-0"
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </div>
          {hrNote && (() => {
            const addedById = noteByKey.get(key)?.createdBy;
            if (!addedById) return null;
            const addedByName = profiles.find((pr) => pr.id === addedById)?.display_name || profiles.find((pr) => pr.id === addedById)?.email;
            return addedByName ? <p className="mt-1 text-[10px] text-slate-500">Added by: {addedByName}</p> : null;
          })()}
        </td>
        <td className="py-2 pr-3">
          {pendingItem ? (
            <button
              type="button"
              onClick={() => setPendingDetailModal({ profileName: p.display_name || p.email, date: rowDate, item: pendingItem })}
              className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition"
              title={pendingItem.type === "correction" ? "Time correction submitted — click for details" : "PTO request submitted — click for details"}
            >
              {pendingItem.type === "correction" ? "Time Correction" : "PTO"}
            </button>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
        <td className="py-2">
          <div className="flex items-center gap-1.5">
            <label
              title="Attach a photo/file (e.g. a doctor's note)"
              className="cursor-pointer text-slate-500 hover:text-slate-300 shrink-0"
            >
              {uploadingAttachmentId === key ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" />
              )}
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                disabled={uploadingAttachmentId === key}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleAttachFile(p.id, rowDate, file);
                }}
              />
            </label>
            {(() => {
              const attachmentPath = noteByKey.get(key)?.attachmentPath;
              if (!attachmentPath) return null;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => handleViewAttachment(attachmentPath)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 underline disabled:opacity-50 whitespace-nowrap"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    disabled={uploadingAttachmentId === key}
                    onClick={() => void handleRemoveAttachment(p.id, rowDate, attachmentPath)}
                    className="text-[10px] text-red-400 hover:text-red-300 underline disabled:opacity-50 whitespace-nowrap"
                  >
                    Remove
                  </button>
                </>
              );
            })()}
          </div>
          {(() => {
            const note = noteByKey.get(key);
            if (!note) return null;
            const nameOf = (id: string | null) => (id ? profiles.find((pr) => pr.id === id)?.display_name || profiles.find((pr) => pr.id === id)?.email : null);
            const addedByName = note.attachmentPath ? nameOf(note.attachmentAddedBy) : null;
            const removedByName = !note.attachmentPath ? nameOf(note.attachmentRemovedBy) : null;
            if (!addedByName && !removedByName) return null;
            return (
              <p className="mt-1 text-[10px] text-slate-500">
                {addedByName && `Added by: ${addedByName}`}
                {removedByName && `Removed by: ${removedByName}`}
              </p>
            );
          })()}
        </td>
      </tr>
    );
  };

  return (
    <main className="flex-1 bg-slate-950">
      <div className="w-full min-w-0 px-4 lg:px-6 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-white">
          <button type="button" onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <h1 className="text-xl font-semibold">{sub.title}</h1>
          <p className="text-sm text-slate-400">{sub.description}</p>
        </div>

        <div className="flex gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "list" ? "bg-primary/20 text-primary" : ""}`}
          >
            <ListChecks className="h-3.5 w-3.5" /> Absent List
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "calendar" ? "bg-primary/20 text-primary" : ""}`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Time Off Calendar
          </button>
          <button
            type="button"
            onClick={() => setView("ticketAttendance")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "ticketAttendance" ? "bg-primary/20 text-primary" : ""}`}
          >
            <ClipboardList className="h-3.5 w-3.5" /> Ticket Attendance
          </button>
          <button
            type="button"
            onClick={() => setView("ptoManagement")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "ptoManagement" ? "bg-primary/20 text-primary" : ""}`}
          >
            <Umbrella className="h-3.5 w-3.5" /> PTO Management
          </button>
          <button
            type="button"
            onClick={() => setView("exceptionReports")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "exceptionReports" ? "bg-primary/20 text-primary" : ""}`}
          >
            <FileDown className="h-3.5 w-3.5" /> Exception Reports
          </button>
          <button
            type="button"
            onClick={() => setView("holidays")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "holidays" ? "bg-primary/20 text-primary" : ""}`}
          >
            <Flag className="h-3.5 w-3.5" /> Holiday Calendar
          </button>
          <button
            type="button"
            onClick={() => setView("visitExceptions")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "visitExceptions" ? "bg-primary/20 text-primary" : ""}`}
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Visit Exception Report
          </button>
          <button
            type="button"
            onClick={() => setView("exceededSickDays")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "exceededSickDays" ? "bg-primary/20 text-primary" : ""}`}
          >
            <HeartPulse className="h-3.5 w-3.5" /> Exceeded Sick Days
          </button>
          <button
            type="button"
            onClick={() => setView("pendingExplanations")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "pendingExplanations" ? "bg-primary/20 text-primary" : ""}`}
          >
            <ListTodo className="h-3.5 w-3.5" /> Pending Explanations
          </button>
          <button
            type="button"
            onClick={() => setView("attendanceStatus")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "attendanceStatus" ? "bg-primary/20 text-primary" : ""}`}
          >
            <Users className="h-3.5 w-3.5" /> Attendance Status
          </button>
        </div>

        {view === "calendar" && (
          <HrCalendarTab employees={calendarEmployees} myProfileId={myProfileId} myDisplayName={displayName} />
        )}

        {view === "ticketAttendance" && <TicketAttendanceTab />}

        {view === "attendanceStatus" && <EmployeeAttendanceStatusTab />}


        {view === "ptoManagement" && <PtoManagementTab />}


        {view === "exceptionReports" && <ExceptionReportsTab />}

        {view === "holidays" && <HolidayCalendarTab myProfileId={myProfileId} />}

        {view === "visitExceptions" && <VisitExceptionReportTab />}

        {view === "exceededSickDays" && (
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-semibold">Exceeded Sick Days</h2>
              <span className="text-xs text-slate-400">({exceededSickDaysRows.length})</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Technicians who've used more Sick Leave than their {SICK_LEAVE_ANNUAL_ALLOWANCE}-day annual allowance for their tenure year as of the date below. "Used" already counts pending (not yet decided) requests, not just approved ones — a Pending badge means at least one of those requests is still awaiting review.
            </p>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">As Of</label>
                <input type="date" value={esdAsOfDate} onChange={(e) => setEsdAsOfDate(e.target.value)} className="glass-input" />
              </div>
              {esdAsOfDate !== todayISO() && (
                <button type="button" onClick={() => setEsdAsOfDate(todayISO())} className="btn text-sm px-3 py-1.5">Today</button>
              )}
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Search</label>
                <input type="text" value={esdSearch} onChange={(e) => setEsdSearch(e.target.value)} placeholder="Employee name…" className="glass-input w-full" />
              </div>
            </div>
            {loading ? (
              <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
            ) : exceededSickDaysRows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No one is currently over their Sick Leave allowance.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10 text-left">
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("esdName", "Name", nameOptions, esdNameFilter, setEsdNameFilter)}</th>
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("esdRole", "Role", roleOptions, esdRoleFilter, setEsdRoleFilter, (v) => ROLE_LABELS[v] || v)}</th>
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("esdBranch", "Branch", branchOptions, esdBranchFilter, setEsdBranchFilter)}</th>
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("esdManager", "Manager", managerOptions, esdManagerFilter, setEsdManagerFilter)}</th>
                      <th className="py-2 pr-3">Used / Allowance</th>
                      <th className="py-2 pr-3">Over By</th>
                      <th className="py-2 pr-3 relative">{renderTriStateFilterHeader("esdStatus", "Status", esdStatusFilter, setEsdStatusFilter, "Pending Request", "Fully Decided")}</th>
                      <th className="py-2">Sick Requests This Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exceededSickDaysRows.map((r) => (
                      <tr key={r.profile.id} className="border-b border-white/5 align-top">
                        <td className="py-2 pr-3 text-white font-medium whitespace-nowrap">{r.profile.display_name || r.profile.email}</td>
                        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{ROLE_LABELS[r.profile.role] || r.profile.role}</td>
                        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{r.profile.assigned_branch || "—"}</td>
                        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{r.profile.manager_name || "—"}</td>
                        <td className="py-2 pr-3 text-red-300 font-semibold whitespace-nowrap">{fmtSickDays(r.used)} / {r.allowance}</td>
                        <td className="py-2 pr-3 text-red-300 font-semibold whitespace-nowrap">{fmtSickDays(r.used - r.allowance)}</td>
                        <td className="py-2 pr-3">
                          {r.hasPendingRequest ? (
                            <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">Pending Request</span>
                          ) : (
                            <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-500/20 text-slate-300 border border-slate-500/40">Fully Decided</span>
                          )}
                        </td>
                        <td className="py-2">
                          <ul className="space-y-0.5">
                            {r.requests.map((req) => (
                              <li key={req.id} className="text-xs text-slate-300 whitespace-nowrap">
                                {req.startDate}{req.endDate !== req.startDate ? ` – ${req.endDate}` : ""}{" "}
                                <span className={req.status === "pending" ? "text-amber-300" : "text-emerald-300"}>({req.status})</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === "pendingExplanations" && (
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-semibold">Pending Explanations / Excuses</h2>
              <span className="text-xs text-slate-400">({pendingExplanationRows.length})</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              A To-Do list of absences in the selected date range that still don't have an HR Status set — either the employee needs to provide a reason, or a manager still needs to review one. Add the HR Status here and it disappears from this list.
            </p>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">From</label>
                <input type="date" value={peDateFrom} onChange={(e) => setPeDateFrom(e.target.value)} className="glass-input" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">To</label>
                <input type="date" value={peDateTo} onChange={(e) => setPeDateTo(e.target.value)} className="glass-input" />
              </div>
              {!(peDateFrom === todayISO() && peDateTo === todayISO()) && (
                <button type="button" onClick={() => { setPeDateFrom(todayISO()); setPeDateTo(todayISO()); }} className="btn text-sm px-3 py-1.5">Today</button>
              )}
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Search</label>
                <input type="text" value={peSearch} onChange={(e) => setPeSearch(e.target.value)} placeholder="Employee name…" className="glass-input w-full" />
              </div>
            </div>
            {loading ? (
              <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
            ) : pendingExplanationRows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">Nothing pending — every absence in range already has an HR Status.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10 text-left">
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("peName", "Name", nameOptions, peNameFilter, setPeNameFilter)}</th>
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("peRole", "Role", roleOptions, peRoleFilter, setPeRoleFilter, (v) => ROLE_LABELS[v] || v)}</th>
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("peBranch", "Branch", branchOptions, peBranchFilter, setPeBranchFilter)}</th>
                      <th className="py-2 pr-3 relative">{renderMultiSelectFilterHeader("peManager", "Manager", managerOptions, peManagerFilter, setPeManagerFilter)}</th>
                      <th className="py-2 pr-3">Note</th>
                      <th className="py-2 pr-3">HR Status</th>
                      <th className="py-2 pr-3">Request</th>
                      <th className="py-2">Attachment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peRangeDates.length > 1
                      ? groupedPendingExplanationRows.map(([groupDate, rows]) => (
                          <Fragment key={groupDate}>
                            <tr className="bg-white/10 border-t-2 border-b border-blue-500/30">
                              <td colSpan={7} className="py-3 px-2 text-base font-bold text-blue-300 uppercase tracking-wide">
                                {groupDate} <span className="text-slate-400 font-normal normal-case text-sm">({rows.length})</span>
                              </td>
                            </tr>
                            {rows.map(renderAbsentRow)}
                          </Fragment>
                        ))
                      : pendingExplanationRows.map(renderAbsentRow)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === "list" && !loading && (
          statsCardHidden ? (
            <button
              type="button"
              onClick={() => setStatsCardHidden(false)}
              title="Show stats"
              className="fixed right-3 top-20 z-40 rounded-full border border-white/10 bg-slate-900/90 p-2 shadow-lg backdrop-blur-md text-slate-400 hover:text-white transition"
            >
              <BarChart3 className="h-4 w-4" />
            </button>
          ) : (
            <div className="fixed right-3 top-20 z-40 w-60 rounded-2xl border border-white/10 bg-slate-900/90 p-3 shadow-lg backdrop-blur-md text-sm text-slate-400">
              <button
                type="button"
                onClick={() => setStatsCardHidden(true)}
                title="Hide"
                className="absolute top-2 right-2 text-slate-500 hover:text-white transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 pr-4">
                {dateFrom === dateTo ? dateFrom : `${dateFrom} – ${dateTo}`}
              </div>
              <div className="mt-0.5">
                <span className="text-red-300 font-semibold">{absentRows.length}</span> absent{rangeDates.length > 1 ? " (instances)" : ""}
                {onLeaveCount > 0 && <span className="block mt-0.5 text-xs text-slate-500">({onLeaveCount} on approved leave, not counted)</span>}
              </div>
              {hrStatusBreakdown.size > 0 && (
                <ul className="mt-2 pt-2 border-t border-white/10 text-xs space-y-0.5">
                  {[...HR_STATUS_OPTIONS, "—"]
                    .filter((s) => hrStatusBreakdown.has(s))
                    .map((s) => (
                      <li key={s} className={`flex items-center gap-1.5 ${HR_STATUS_COLOR[s] || "text-slate-500"}`}>
                        <span className="text-slate-600">•</span>
                        {hrStatusBreakdown.get(s)} {s === "—" ? "Not yet reviewed" : s}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )
        )}

        {view === "list" && (
        <div className="panel">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-2">From</label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => setDateFrom(e.target.value)}
                className="glass-input"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-2">To</label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => setDateTo(e.target.value)}
                className="glass-input"
              />
            </div>
            <button
              type="button"
              onClick={() => { setDateFrom(todayISO()); setDateTo(todayISO()); }}
              className="btn text-sm py-1.5 mb-0.5"
            >
              Today
            </button>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-2">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Employee name..."
                className="glass-input"
              />
            </div>
            {loading && <div className="ml-auto text-sm text-slate-400">Loading…</div>}
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : absentRows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              No one is marked absent {dateFrom === dateTo ? `for ${dateFrom}` : `between ${dateFrom} and ${dateTo}`}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10 text-left">
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("name", "Name", nameOptions, nameFilter, setNameFilter)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("role", "Role", roleOptions, roleFilter, setRoleFilter, (v) => ROLE_LABELS[v] || v)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("branch", "Branch", branchOptions, branchFilter, setBranchFilter)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("manager", "Manager", managerOptions, managerFilter, setManagerFilter)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderTriStateFilterHeader("notes", "Note", notesColFilter, setNotesColFilter, "Has note", "No note")}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("hrNote", "HR Status", HR_STATUS_OPTIONS, hrStatusFilter, setHrStatusFilter)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderTriStateFilterHeader("correction", "Request", correctionFilter, setCorrectionFilter, "Pending", "None")}
                    </th>
                    <th className="py-2">Attachment</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeDates.length > 1
                    ? groupedAbsentRows.map(([groupDate, rows]) => (
                        <Fragment key={groupDate}>
                          <tr className="bg-white/10 border-t-2 border-b border-blue-500/30">
                            <td colSpan={7} className="py-3 px-2 text-base font-bold text-blue-300 uppercase tracking-wide">
                              {groupDate} <span className="text-slate-400 font-normal normal-case text-sm">({rows.length})</span>
                            </td>
                          </tr>
                          {rows.map(renderAbsentRow)}
                        </Fragment>
                      ))
                    : absentRows.map(renderAbsentRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
      </div>
      {previewAttachmentUrl && (
        <AttachmentPreviewModal url={previewAttachmentUrl} title="HR Status attachment" onClose={() => setPreviewAttachmentUrl(null)} />
      )}
      {pendingDetailModal && (
        <PendingItemDetailModal
          profileName={pendingDetailModal.profileName}
          date={pendingDetailModal.date}
          item={pendingDetailModal.item}
          profiles={profiles}
          myProfileId={myProfileId}
          myRole={role}
          myExtraRoles={extraRoles}
          myDisplayName={displayName}
          onClose={() => setPendingDetailModal(null)}
          onReviewed={() => {
            setPendingDetailModal(null);
            load();
          }}
        />
      )}
      {historyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setHistoryModal(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h2 className="text-base font-bold text-white">Change History</h2>
                <p className="text-xs text-slate-400 mt-0.5">{historyModal.profileName} — {historyModal.date}</p>
              </div>
              <button onClick={() => setHistoryModal(null)} className="p-1 hover:bg-white/10 rounded transition text-slate-400">✕</button>
            </div>
            <div className="px-5 py-4">
              {historyLoading ? (
                <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-xs text-slate-500">No changes logged for this day yet.</p>
              ) : (
                <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {historyEntries.map((entry) => (
                    <li key={entry.id} className="text-xs text-slate-400">
                      <span className="text-slate-200 font-semibold">{activityActionLabel(entry.action)}</span>
                      {entry.details?.from !== undefined && entry.details?.to !== undefined && (
                        <span> — "{String(entry.details.from) || "—"}" → "{String(entry.details.to) || "—"}"</span>
                      )}
                      <div className="text-slate-500 mt-0.5">{entry.actorName || "Someone"} · {new Date(entry.createdAt).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

