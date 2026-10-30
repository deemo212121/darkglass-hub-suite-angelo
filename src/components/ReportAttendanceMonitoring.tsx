/**
 * Attendance Monitoring Report — read-only summary, distinct from
 * Attendance Monitoring Dashboard (which has interactive PTO/correction
 * approval, warning submission, and messaging this page deliberately
 * omits). Reuses the same real data (getCompanyTimecardEntries,
 * getCompanyPtoRequests, getCompanyTimecardCorrections, getAllAgentNotes)
 * so the numbers always agree with the dashboard, but this page never
 * writes — no approve/reject, no notes, no messages.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronRight, Users, UserCheck, UserX, Clock, Loader2, Download } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { AppModal } from "@/components/ui-kit/AppModal";
import { writeAttendanceWorkbook, type AttendanceSheetSpec } from "@/lib/attendanceReportWorkbook";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, getSeparations, preloadSeparations, getHireDatesByProfileIds, type ProfileRow, type Separation } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, calcWorkedHours, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { toSeconds, ON_TIME_BUFFER_SECONDS, payGraceMinutesFor } from "@/lib/attendanceGrace";

// profiles.department is rarely populated in this data set — role is the
// real department-like dimension (same convention AccountingDashboard.tsx
// already established: department: p.role).
function roleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[normalizeRole(role)] ?? role ?? "Unspecified";
}

// The departments the summary table groups people into, in the order shown —
// too many roles to list one per row. Roles not named here (Admin, HR, IT…)
// keep their own row after these.
const DEPARTMENTS: { name: string; roles: string[] }[] = [
  { name: "Technician", roles: ["TECHNICIAN", "TECHNICIAN_MANAGER", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR", "SENIOR_BRANCH_MANAGER", "BRANCH_MANAGER"] },
  { name: "CSR", roles: ["CSR", "CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"] },
  { name: "Accounting", roles: ["FINANCE"] },
  { name: "BizOps", roles: ["BIZOPS_ASSOCIATE", "BIZOPS_TEAM_LEADER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"] },
  { name: "Senior Managers", roles: ["SENIOR_MANAGER", "SENIOR_DIRECTOR", "MANAGER", "ASSISTANT_MANAGER"] },
  { name: "Triage", roles: ["TRIAGE_USER", "TRIAGE_MANAGER"] },
  { name: "PO", roles: ["PARTS_ORDER"] },
  { name: "Parts", roles: ["PARTS", "PARTS_MANAGER", "PARTS_TEAM_LEADER"] },
  { name: "Claims", roles: ["CLAIMS", "CLAIMS_MANAGER", "CLAIMS_TEAM_LEADER"] },
  { name: "IT", roles: ["IT", "SALES_MANAGER"] },
];
// The app's own developers (Angelo, John Oliver, Jhon) hold Super Admin but
// work in IT — matched by first name among Super Admins only.
const IT_SUPERADMINS = /^(angelo|john oliver|jhon)/i;
const DEPARTMENT_OF = new Map(DEPARTMENTS.flatMap((d) => d.roles.map((r) => [r, d.name] as const)));
function departmentOf(p: ProfileRow): string {
  const role = normalizeRole(p.role);
  if ((role === "SUPERADMIN" || role === "SUPERSUPERADMIN") && IT_SUPERADMINS.test((p.display_name || p.username || "").trim())) return "IT";
  return DEPARTMENT_OF.get(role) ?? roleLabel(p.role);
}
const departmentRank = (name: string) => {
  const i = DEPARTMENTS.findIndex((d) => d.name === name);
  return i === -1 ? DEPARTMENTS.length : i;
};
import { getCompanyTraineeEntries, type TraineeTimecardEntry } from "@/lib/supabase/traineeTimecards";
import { getCompanyPtoRequests, ptoYearWindow, ptoDaysUsed, ptoDaysPending, type PtoRequestRow } from "@/lib/supabase/pto";
import { getCompanyTimecardCorrections, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { localISODate, todayISO } from "@/lib/localDate";
import { getRestDayHistory } from "@/lib/supabase/restDayHistory";
import { isRestDayOn, requiredTimesOn, type RestDayHistory } from "@/lib/restDays";

const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

// Columns of the people under a department in Department Summary (and the XLSX's
// Employees section) — same layout as the attendance spreadsheet HR keeps.
const EMPLOYEE_COLUMNS: { label: string; left?: boolean }[] = [
  { label: "Employee", left: true },
  { label: "Department", left: true },
  { label: "Branch", left: true },
  { label: "Manager", left: true },
  { label: "Days Worked" },
  { label: "Working Hours" },
  { label: "Avg Hours / Day" },
  { label: "Days Absent" },
  { label: "Missing Time Out" },
  { label: "PTO Left" },
  { label: "Correction Requests" },
  { label: "Approved" },
  { label: "Pending" },
  { label: "Rejected" },
  { label: "Warnings" },
];

// Leave type names for the "on leave" breakdown.
const LEAVE_TYPE_LABEL: Record<string, string> = {
  vacation: "PTO",
  sick: "Sick Leave",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid Leave",
  bereavement: "Bereavement",
};
const LEAVE_TYPE_CLASS: Record<string, string> = {
  vacation: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  sick: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  unpaid: "border-slate-400/40 bg-slate-500/10 text-slate-300",
  bereavement: "border-violet-500/40 bg-violet-500/10 text-violet-300",
};
const leaveTypeLabel = (t: string) => LEAVE_TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
const fmtShortDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const todayIso = () => todayISO();
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISODate(d); };

/**
 * Off-day indices follow the same convention timecards.ts uses company-wide
 * (JS Date.getDay(): 0=Sunday..6=Saturday) — mirrors
 * AttendanceMonitoringPage.tsx's computeAlerts so "late/absent" mean the
 * same thing on both pages.
 */
// Exported (along with dayStatus/graceMinutesFor/DayStatus below) so other
// reports can derive their own attendance summary from the same real
// present/late/absent classification instead of re-embedding this whole
// page — e.g. Triage Daily Report's own Attendance panel.
export function isOffDay(dateIso: string, offDays: number[] | null | undefined): boolean {
  if (!offDays || offDays.length === 0) return false;
  const dow = new Date(dateIso + "T00:00:00").getDay();
  return offDays.includes(dow);
}

export interface DayStatus {
  present: boolean;
  late: boolean;
  absent: boolean;
  hours: number;
}

/**
 * Lateness must go through the same clock-precision buffer + pay-grace
 * window Attendance Monitoring's own Daily Attendance Tracker applies
 * (attendanceGrace.ts) — a raw `checkIn > requiredCheckIn` string
 * comparison (the previous version of this function) flags literally any
 * nonzero-second punch as late, disagreeing with the dashboard on nearly
 * every row (e.g. a PH employee clocking in at 08:00:32 against a 08:00
 * schedule reads "Late" here but "✓ OK" there).
 */
export function dayStatus(entry: CompanyTimecardEntry | undefined, requiredCheckIn: string | null, offDay: boolean, graceMinutes: number): DayStatus {
  if (!entry || (!entry.checkIn && !entry.checkOut)) {
    return { present: false, late: false, absent: !offDay, hours: 0 };
  }
  let late = false;
  if (requiredCheckIn && entry.checkIn) {
    const lateSeconds = toSeconds(entry.checkIn) - toSeconds(requiredCheckIn);
    late = lateSeconds > Math.max(ON_TIME_BUFFER_SECONDS, graceMinutes * 60);
  }
  const hours = entry.checkIn && entry.checkOut
    ? calcWorkedHours({ checkIn: entry.checkIn, checkOut: entry.checkOut, mealStart: entry.mealStart, mealEnd: entry.mealEnd, notes: "" })
    : 0;
  return { present: true, late, absent: false, hours };
}

/** Mirrors AttendanceMonitoringPage's own country/role -> grace-minutes resolution exactly, so both pages agree on what counts as "late". */
export function graceMinutesFor(p: ProfileRow): number {
  const country = p.assigned_branch === "Philippines" ? "PH" : "US";
  return payGraceMinutesFor(country);
}

type DailyStatus = "present" | "late" | "absent" | "day-off";
const STATUS_LABEL: Record<DailyStatus, string> = {
  present: "✓ Present",
  late: "Late",
  absent: "Absent",
  "day-off": "Day Off",
};
const STATUS_CLASS: Record<DailyStatus, string> = {
  present: "bg-green-500/20 text-green-300",
  late: "bg-yellow-500/20 text-yellow-300",
  absent: "bg-red-500/20 text-red-300",
  "day-off": "bg-slate-500/20 text-slate-300",
};

export function ReportAttendanceMonitoring({
  mod,
  sub,
  filterProfile,
  embedded,
  groupBy = "role",
}: {
  mod: ModuleDef;
  sub: SubModuleDef;
  /** Restricts the roster to profiles matching this predicate — e.g. the Triage Dashboard's Technical Support-only Attendance tab. Unset shows every company employee. */
  filterProfile?: (p: ProfileRow) => boolean;
  /** Skips this page's own outer shell (back-link, title, description, min-h-screen wrapper) — set when a parent page (e.g. TriageDashboardPage's Attendance tab) already provides that chrome. */
  embedded?: boolean;
  /**
   * "role" (default) groups the bottom summary table by role label — meant
   * for the system-wide report, where multiple departments are expected.
   * "employee" breaks it down per person by name instead — for a
   * filterProfile-scoped embed like Triage Dashboard's Attendance tab,
   * where filterProfile is a "holds this role, primary OR secondary" check
   * (pile-up semantics, same as everywhere else in this app), so a person
   * could pass filterProfile while their PRIMARY role (and thus their role
   * label) is something else entirely — grouping by role there would show
   * confusing "other department" rows instead of who's actually on the team.
   */
  groupBy?: "role" | "employee";
}) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  // Trainees clock in on Trainee Attendance (trainee_timecard_entries), not the regular timecard.
  const [traineeEntries, setTraineeEntries] = useState<TraineeTimecardEntry[]>([]);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(6));
  const [dateTo, setDateTo] = useState(todayIso());
  const [departmentFilter, setDepartmentFilter] = useState("");
  // Which individuals to show in the day-by-day table (groupBy === "employee")
  // — empty means everyone in filteredProfiles. Deliberately doesn't affect
  // the KPI tiles/trend chart above, which stay department-wide.
  const [employeeFilter, setEmployeeFilter] = useState<Set<string>>(new Set());
  const [employeeFilterOpen, setEmployeeFilterOpen] = useState(false);
  const [employeeFilterPos, setEmployeeFilterPos] = useState<{ top: number; left: number } | null>(null);
  const employeeFilterBtnRef = useRef<HTMLButtonElement>(null);
  const employeeFilterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [companyUsers, tcEntries, pto, corr, allNotes, traineeRows] = await Promise.all([
          getCompanyUsers(),
          getCompanyTimecardEntries(dateFrom, dateTo),
          getCompanyPtoRequests(),
          getCompanyTimecardCorrections(),
          getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
          getCompanyTraineeEntries(dateFrom, dateTo).catch((err) => { console.error("Failed to load trainee timecards:", err); return [] as TraineeTimecardEntry[]; }),
        ]);
        if (cancelled) return;
        // Deactivated accounts are kept — shown with their deactivation date
        // when they were still here during the range (see shownProfiles).
        setProfiles(filterProfile ? companyUsers.filter(filterProfile) : companyUsers);
        setEntries(tcEntries);
        setPtoRequests(pto);
        setCorrections(corr);
        setNotes(allNotes);
        setTraineeEntries(traineeRows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Attendance Monitoring Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  // When and why each deactivated account left — the Master List's status
  // date (Terminated / Resigned / Inactive) first, else the first time User
  // Management deactivated it (getSeparations). From that day on they aren't
  // counted absent.
  const [statusChanges, setStatusChanges] = useState<Map<string, Separation>>(new Map());
  useEffect(preloadSeparations, []);
  useEffect(() => {
    if (profiles.length === 0) return;
    let cancelled = false;
    getSeparations(profiles).then((m) => { if (!cancelled) setStatusChanges(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [profiles]);
  const deactivatedOn = (p: ProfileRow): string | null => (p.is_active === false ? statusChanges.get(p.id)?.date ?? null : null);
  const leftLabelOf = (p: ProfileRow): string => statusChanges.get(p.id)?.label ?? "Deactivated";
  // Deactivated accounts show only when they were still active for part of
  // the range (deactivated on/after Date From) or clocked in during it — not
  // everyone who ever left. No known date: only their actual punches count.
  const shownProfiles = useMemo(() => {
    const punched = new Set(entries.map((e) => e.profileId));
    return profiles.filter((p) => {
      if (p.is_active !== false) return true;
      const until = deactivatedOn(p);
      return (until != null && until >= dateFrom) || punched.has(p.id);
    });
  }, [profiles, entries, statusChanges, dateFrom]);

  const departmentOptions = useMemo(() => Array.from(new Set(shownProfiles.map((p) => departmentOf(p)))).sort((a, b) => departmentRank(a) - departmentRank(b) || a.localeCompare(b)), [shownProfiles]);
  const filteredProfiles = useMemo(() => shownProfiles.filter((p) => !departmentFilter || departmentOf(p) === departmentFilter), [shownProfiles, departmentFilter]);

  // Options for the Employee checkbox filter — every profile currently
  // passing the Department filter above, by display name.
  const employeeFilterOptions = useMemo(
    () =>
      filteredProfiles
        .map((p) => ({ id: p.id, name: p.display_name || p.username || p.email || "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filteredProfiles]
  );
  // Drop any selected id that's no longer in range (e.g. Department filter
  // changed) so a stale selection can't silently keep hiding everyone.
  useEffect(() => {
    setEmployeeFilter((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(employeeFilterOptions.map((o) => o.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [employeeFilterOptions]);

  const openEmployeeFilterMenu = () => {
    const rect = employeeFilterBtnRef.current?.getBoundingClientRect();
    if (rect) setEmployeeFilterPos({ top: rect.bottom + 4, left: rect.left });
    setEmployeeFilterOpen(true);
  };
  useEffect(() => {
    if (!employeeFilterOpen) return;
    const close = (e: Event) => {
      if (employeeFilterMenuRef.current && e.target instanceof Node && employeeFilterMenuRef.current.contains(e.target)) return;
      setEmployeeFilterOpen(false);
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [employeeFilterOpen]);
  const toggleEmployeeFilter = (id: string) =>
    setEmployeeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Rest days and Time In / Time Out Required in force on each day
  // (rest_day_history, migrations 0373 + 0375) — a later schedule change
  // doesn't re-judge earlier days as absent or late.
  const [restHistory, setRestHistory] = useState<RestDayHistory>(new Map());
  useEffect(() => {
    getRestDayHistory().then(setRestHistory).catch(() => {});
  }, []);
  const reqIn = (p: ProfileRow, d: string) => requiredTimesOn(restHistory, p.id, d, { checkIn: p.required_check_in, checkOut: p.required_check_out }).checkIn;
  // A rest day, or a day on/after the account was deactivated (or any day
  // when the date isn't known).
  const restOrGoneOn = (p: ProfileRow, d: string) => {
    if (isRestDayOn(restHistory, p.id, d, p.off_days)) return true;
    if (p.is_active !== false) return false;
    const until = deactivatedOn(p);
    return until == null || d >= until;
  };
  // Approved leave (PTO / Sick / Unpaid…) covering the day.
  const approvedLeaveByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of ptoRequests) {
      if (r.status !== "approved") continue;
      if (!map.has(r.profileId)) map.set(r.profileId, []);
      map.get(r.profileId)!.push(r);
    }
    return map;
  }, [ptoRequests]);
  // PTO balance (remaining / total for the PTO year as of Date To, capped at
  // today) — anchored to the Master List Hire Date like everywhere else.
  const [hireDates, setHireDates] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (profiles.length === 0) return;
    let cancelled = false;
    getHireDatesByProfileIds(profiles.map((p) => p.id)).then((m) => { if (!cancelled) setHireDates(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [profiles]);
  const ptoBalanceOf = (p: ProfileRow): { remaining: number; allowance: number; used: number; pending: number } | null => {
    const asOf = dateTo < todayIso() ? dateTo : todayIso();
    const window = ptoYearWindow(hireDates.get(p.id) ?? null, p.created_at ?? null, asOf);
    if (!window) return null;
    const mine = ptoRequests.filter((r) => r.profileId === p.id);
    const used = ptoDaysUsed(mine, window);
    return { remaining: Math.max(0, window.allowance - used), allowance: window.allowance, used, pending: ptoDaysPending(mine, window) };
  };
  const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  // "N on leave" → which leave it was (type, dates, reason).
  const [leaveView, setLeaveView] = useState<{ profileId: string; name: string } | null>(null);
  const onLeaveOn = (p: ProfileRow, d: string) => (approvedLeaveByProfile.get(p.id) ?? []).some((r) => r.startDate <= d && r.endDate >= d);
  // Not counted absent: a rest day, a deactivated day, or a day of approved leave.
  const offOn = (p: ProfileRow, d: string) => restOrGoneOn(p, d) || onLeaveOn(p, d);
  const reqOut = (p: ProfileRow, d: string) => requiredTimesOn(restHistory, p.id, d, { checkIn: p.required_check_in, checkOut: p.required_check_out }).checkOut;

  const entriesByProfileDate = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    for (const e of entries) map.set(`${e.profileId}|${e.workDate}`, e);
    return map;
  }, [entries]);

  const dateRange = useMemo(() => {
    const dates: string[] = [];
    let d = new Date(dateFrom + "T00:00:00");
    const end = new Date(dateTo + "T00:00:00");
    while (d <= end) { dates.push(localISODate(d)); d.setDate(d.getDate() + 1); }
    return dates;
  }, [dateFrom, dateTo]);

  const leaveViewRows = useMemo(() => {
    if (!leaveView) return [];
    const person = profiles.find((x) => x.id === leaveView.profileId);
    return (approvedLeaveByProfile.get(leaveView.profileId) ?? [])
      .filter((r) => r.startDate <= dateTo && (r.endDate || r.startDate) >= dateFrom)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((r) => {
        // Days of it inside the picked dates, rest days / days after leaving left out (same as the column).
        const inRange = person ? dateRange.filter((d) => d >= r.startDate && d <= (r.endDate || r.startDate) && !restOrGoneOn(person, d)).length : 0;
        return { ...r, inRange };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveView, approvedLeaveByProfile, profiles, dateFrom, dateTo, dateRange, restHistory, statusChanges]);

  // Role-level summary across the date range — this is a system-wide
  // report, not a per-employee attribution tool (that's what Attendance
  // Monitoring Dashboard's Daily Attendance Tracker is for). One pass per
  // employee over dateRange, aggregated into their role bucket.
  // Trainees have their own table below the Department Summary.
  const isTraineeProfile = (p: ProfileRow) => p.employment_type === "trainee";
  const regularProfiles = useMemo(() => filteredProfiles.filter((p) => !isTraineeProfile(p)), [filteredProfiles]);
  const roleSummary = useMemo(() => {
    // count = everyone shown for the range; inactive = the deactivated among them.
    const map = new Map<string, { count: number; inactive: number; present: number; absent: number; late: number; hours: number }>();
    for (const p of regularProfiles) {
      const role = departmentOf(p);
      const bucket = map.get(role) ?? { count: 0, inactive: 0, present: 0, absent: 0, late: 0, hours: 0 };
      bucket.count += 1;
      if (p.is_active === false) bucket.inactive += 1;
      const graceMinutes = graceMinutesFor(p);
      for (const d of dateRange) {
        const off = offOn(p, d);
        const st = dayStatus(entriesByProfileDate.get(`${p.id}|${d}`), reqIn(p, d), off, graceMinutes);
        if (st.present) { bucket.present++; if (st.late) bucket.late++; bucket.hours += st.hours; }
        else if (st.absent) bucket.absent++;
      }
      map.set(role, bucket);
    }
    return Array.from(map.entries()).map(([role, v]) => ({ role, ...v })).sort((a, b) => departmentRank(a.role) - departmentRank(b.role) || a.role.localeCompare(b.role));
  }, [regularProfiles, dateRange, entriesByProfileDate, restHistory, statusChanges, approvedLeaveByProfile]);

  // The people under each role in Role Summary — opened by clicking the
  // role's row. Same day classification as the role totals above, so a
  // role's people add up to its row.
  const [openRoles, setOpenRoles] = useState<Set<string>>(new Set());
  const toggleRole = (role: string) =>
    setOpenRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  const employeesByRole = useMemo(() => {
    const today = todayIso();
    const map = new Map<string, {
      profileId: string;
      name: string;
      department: string;
      title: string;
      deactivatedOn: string | null;
      leftLabel: string;
      leftSource: string | null;
      inactive: boolean;
      branch: string;
      manager: string;
      daysWorked: number;
      hours: number;
      absent: number;
      missingTimeOut: number;
      leaveDays: number;
      pto: { remaining: number; allowance: number; used: number; pending: number } | null;
      corrections: number;
      correctionsApproved: number;
      correctionsPending: number;
      correctionsRejected: number;
      warnings: number;
    }[]>();
    for (const p of regularProfiles) {
      const role = departmentOf(p);
      const graceMinutes = graceMinutesFor(p);
      let daysWorked = 0, hours = 0, absent = 0, missingTimeOut = 0, leaveDays = 0;
      for (const d of dateRange) {
        const entry = entriesByProfileDate.get(`${p.id}|${d}`);
        const off = offOn(p, d);
        const st = dayStatus(entry, reqIn(p, d), off, graceMinutes);
        if (st.present) { daysWorked++; hours += st.hours; }
        else if (st.absent) absent++;
        // Today's shift may still be going — only earlier days count as a missed Time Out.
        if (entry?.checkIn && !entry.checkOut && d < today) missingTimeOut++;
        if (!restOrGoneOn(p, d) && onLeaveOn(p, d)) leaveDays++;
      }
      const corr = corrections.filter((c) => c.profileId === p.id && c.workDate >= dateFrom && c.workDate <= dateTo);
      const list = map.get(role) ?? [];
      list.push({
        profileId: p.id,
        name: p.display_name || p.username || p.email || "Unknown",
        department: role,
        title: roleLabel(p.role),
        deactivatedOn: deactivatedOn(p),
        leftLabel: leftLabelOf(p),
        leftSource: statusChanges.get(p.id)?.source ?? null,
        inactive: p.is_active === false,
        branch: p.assigned_branch || "—",
        manager: p.manager_name || "—",
        daysWorked, hours, absent, missingTimeOut, leaveDays, pto: ptoBalanceOf(p),
        corrections: corr.length,
        correctionsApproved: corr.filter((c) => c.status === "approved").length,
        correctionsPending: corr.filter((c) => c.status === "pending").length,
        correctionsRejected: corr.filter((c) => c.status === "rejected").length,
        // Same count as the Warnings tile above: approved warnings sent to them.
        warnings: notes.filter((n) => n.status === "approved" && n.type === "warning" && n.agentProfileId === p.id).length,
      });
      map.set(role, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [regularProfiles, dateRange, dateFrom, dateTo, entriesByProfileDate, restHistory, statusChanges, ptoRequests, corrections, notes, hireDates]);

  // Trainees — one row each over the range, from their Trainee Attendance
  // punches. Absent = a past scheduled day with no punch (rest days, approved
  // leave, holidays-as-leave and days after they left don't count); Pending =
  // punched days still waiting for the manager's review.
  const traineeSummary = useMemo(() => {
    const byKey = new Map(traineeEntries.map((e) => [`${e.profileId}|${e.workDate}`, e]));
    const today = todayIso();
    return filteredProfiles
      .filter(isTraineeProfile)
      .map((p) => {
        let present = 0, absent = 0, pending = 0, hours = 0;
        for (const d of dateRange) {
          const e = byKey.get(`${p.id}|${d}`);
          if (e?.checkIn) {
            present++;
            if (e.status === "pending") pending++;
            if (e.checkOut) hours += calcWorkedHours({ checkIn: e.checkIn, checkOut: e.checkOut, mealStart: e.mealStart, mealEnd: e.mealEnd, notes: "" });
          } else if (d < today && !offOn(p, d)) absent++;
        }
        return {
          profileId: p.id,
          name: p.display_name || p.username || p.email || "Unknown",
          department: departmentOf(p),
          title: roleLabel(p.role),
          branch: p.assigned_branch || "—",
          manager: p.manager_name || "—",
          inactive: p.is_active === false,
          leftLabel: leftLabelOf(p),
          leftOn: deactivatedOn(p),
          present, absent, pending, hours,
        };
      })
      .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProfiles, traineeEntries, dateRange, restHistory, statusChanges, approvedLeaveByProfile]);

  // Day-by-day breakdown, for groupBy === "employee" — one row per
  // (employee, date), Name/Role on the far left same as the aggregate
  // Role Summary's columns, but not collapsed into a period total: this is
  // the same shape as Employee Self-Service's own "Daily Attendance (last
  // 30 days)" table, just covering every employee in filteredProfiles
  // instead of only the signed-in user.
  const dailyEmployeeRows = useMemo(() => {
    const rows: {
      profileId: string;
      name: string;
      role: string;
      date: string;
      clockIn: string;
      clockOut: string;
      requiredCheckIn: string;
      requiredCheckOut: string;
      hours: number;
      status: DailyStatus;
    }[] = [];
    for (const p of filteredProfiles) {
      if (employeeFilter.size > 0 && !employeeFilter.has(p.id)) continue;
      const name = p.display_name || p.username || p.email || "Unknown";
      const role = roleLabel(p.role);
      const graceMinutes = graceMinutesFor(p);
      for (const d of dateRange) {
        const entry = entriesByProfileDate.get(`${p.id}|${d}`);
        const off = offOn(p, d);
        const st = dayStatus(entry, reqIn(p, d), off, graceMinutes);
        const status: DailyStatus = st.present ? (st.late ? "late" : "present") : off ? "day-off" : "absent";
        rows.push({
          profileId: p.id, name, role, date: d,
          clockIn: entry?.checkIn || "", clockOut: entry?.checkOut || "",
          requiredCheckIn: reqIn(p, d), requiredCheckOut: reqOut(p, d),
          hours: st.hours, status,
        });
      }
    }
    // Grouped by date (most recent first) so scanning down reads "who was
    // in on 8/11, then who was in on 8/10, ..." instead of one person's
    // entire week before jumping to the next person.
    return rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  }, [filteredProfiles, dateRange, entriesByProfileDate, employeeFilter, restHistory, statusChanges, approvedLeaveByProfile]);

  // Today-scoped KPI tiles (only meaningful when today falls inside the
  // selected range — otherwise these read 0, same as a report for a past
  // period showing no "today").
  const todayInRange = dateRange.includes(todayIso());
  const todayKpi = useMemo(() => {
    if (!todayInRange) return { present: 0, absent: 0, late: 0 };
    let present = 0, absent = 0, late = 0;
    for (const p of filteredProfiles) {
      const off = offOn(p, todayIso());
      const st = dayStatus(entriesByProfileDate.get(`${p.id}|${todayIso()}`), p.required_check_in, off, graceMinutesFor(p));
      if (st.present) { present++; if (st.late) late++; }
      else if (st.absent) absent++;
    }
    return { present, absent, late };
  }, [todayInRange, filteredProfiles, entriesByProfileDate, restHistory, statusChanges, approvedLeaveByProfile]);

  // Scoped to filteredProfiles (department filter AND the optional
  // filterProfile restriction) — company-wide PTO/correction counts would be
  // misleading on a department-specific embed like the Triage Dashboard's
  // Attendance tab.
  const visibleProfileIds = useMemo(() => new Set(filteredProfiles.map((p) => p.id)), [filteredProfiles]);
  const ptoPending = ptoRequests.filter((r) => r.status === "pending" && visibleProfileIds.has(r.profileId)).length;
  const correctionsPending = corrections.filter((c) => c.status === "pending" && visibleProfileIds.has(c.profileId)).length;
  const warningsCount = useMemo(() => {
    const profileIds = new Set(filteredProfiles.map((p) => p.id));
    return notes.filter((n) => n.status === "approved" && n.type === "warning" && profileIds.has(n.agentProfileId)).length;
  }, [notes, filteredProfiles]);

  // Daily Present/Absent/Late trend across the selected range — single pass.
  const trendData = useMemo(() => {
    return dateRange.map((d) => {
      let present = 0, absent = 0, late = 0;
      for (const p of filteredProfiles) {
        const off = offOn(p, d);
        const st = dayStatus(entriesByProfileDate.get(`${p.id}|${d}`), reqIn(p, d), off, graceMinutesFor(p));
        if (st.present) { present++; if (st.late) late++; }
        else if (st.absent) absent++;
      }
      const [, m, day] = d.split("-");
      return { date: `${Number(m)}/${Number(day)}`, present, absent, late };
    });
  }, [dateRange, filteredProfiles, entriesByProfileDate, restHistory, statusChanges, approvedLeaveByProfile]);

  // Styled workbook (attendanceReportWorkbook.ts): Overview (today's numbers
  // + daily trend), then Departments / Employees / Trainees — or Daily
  // Attendance when grouped by employee.
  const [exporting, setExporting] = useState(false);
  const exportToXlsx = async () => {
    const period = `${fmtShortDate(dateFrom)} – ${fmtShortDate(dateTo)}`;
    const subtitle = `${period}   •   ${departmentFilter || "All Departments"}`;
    const leftName = (name: string, label: string, on: string | null) => `${name} (${label}${on ? " · " + fmtShortDate(on) : ""})`;
    const sheets: AttendanceSheetSpec[] = [
      {
        name: "Overview",
        title: "Attendance Monitoring Report",
        note: "Today's numbers are for today only; the Daily Trend covers every day in the period.",
        headers: ["Today", "Count"],
        textCols: 1,
        rows: [
          { cells: ["Total Employees", filteredProfiles.length] },
          { cells: ["Present Today", todayKpi.present] },
          { cells: ["Absent Today", todayKpi.absent] },
          { cells: ["Late Today", todayKpi.late] },
          { cells: ["PTO Pending", ptoPending] },
          { cells: ["Corrections Pending", correctionsPending] },
          { cells: ["Warnings", warningsCount] },
        ],
        widths: { 0: 28, 1: 14 },
      },
      {
        name: "Daily Trend",
        title: "Daily Trend",
        headers: ["Date", "Present", "Absent", "Late"],
        textCols: 1,
        rows: trendData.map((t) => ({ cells: [t.date, t.present, t.absent, t.late] })),
        greenCols: [1],
        redCols: [2],
        amberCols: [3],
        totalCols: [1, 2, 3],
        widths: { 0: 16 },
      },
    ];
    if (groupBy === "employee") {
      sheets.push({
        name: "Daily Attendance",
        title: "Daily Attendance",
        headers: ["Name", "Role", "Date", "Clock In", "Required In", "Clock Out", "Required Out", "Hours", "Status"],
        textCols: 3,
        rows: dailyEmployeeRows.map((r) => ({
          cells: [r.name, r.role, r.date, r.clockIn || "—", r.requiredCheckIn || "—", r.clockOut || "—", r.requiredCheckOut || "—", Number(r.hours.toFixed(2)), STATUS_LABEL[r.status]],
        })),
        formats: { 7: "0.00" },
      });
    } else {
      sheets.push(
        {
          name: "Departments",
          title: "Department Summary",
          note: "Regular employees only — trainees are on their own sheet. Deactivated people count while they were still here during the period.",
          headers: ["Department", "Active Employees", "Deactivated", "Days Present", "Absences", "Total Hours"],
          textCols: 1,
          rows: roleSummary.map((r) => ({ cells: [r.role, r.count - r.inactive, r.inactive, r.present, r.absent, Number(r.hours.toFixed(1))] })),
          greenCols: [1],
          redCols: [2, 4],
          formats: { 5: "#,##0.0" },
          totalCols: [1, 2, 3, 4, 5],
          widths: { 0: 24 },
        },
        {
          name: "Employees",
          title: "Employees",
          note: "Absences leave out rest days, approved leave and days after someone left. PTO Left is remaining / total for their PTO year.",
          headers: EMPLOYEE_COLUMNS.map((c) => c.label),
          textCols: 4,
          rows: roleSummary.flatMap((r) => [
            { cells: [`${r.role}  ·  ${(employeesByRole.get(r.role) ?? []).length} people`], tone: "group" as const },
            ...(employeesByRole.get(r.role) ?? []).map((e) => ({
              tone: e.inactive ? ("left" as const) : undefined,
              cells: [
                e.inactive ? leftName(e.name, e.leftLabel, e.deactivatedOn) : e.name, e.department, e.branch, e.manager,
                e.daysWorked, Number(e.hours.toFixed(2)), e.daysWorked ? Number((e.hours / e.daysWorked).toFixed(2)) : 0,
                e.absent, e.missingTimeOut,
                e.pto ? `${fmtDays(e.pto.remaining)}/${e.pto.allowance}${e.leaveDays ? ` · ${e.leaveDays} on leave` : ""}` : e.leaveDays ? `Not eligible · ${e.leaveDays} on leave` : "Not eligible",
                e.corrections, e.correctionsApproved, e.correctionsPending, e.correctionsRejected, e.warnings,
              ] as (string | number)[],
            })),
          ]),
          formats: { 5: "0.00", 6: "0.00" },
          redCols: [7, 13, 14],
          amberCols: [8, 12],
          greenCols: [11],
          widths: { 0: 34, 9: 22 },
        },
        {
          name: "Trainees",
          title: "Trainees",
          note: "From Trainee Attendance. Pending Days = punched days still waiting for the manager's review.",
          headers: ["Trainee", "Department", "Branch", "Manager", "Days Present", "Absences", "Pending Days", "Total Hours"],
          textCols: 4,
          rows: traineeSummary.map((t) => ({
            tone: t.inactive ? ("left" as const) : undefined,
            cells: [t.inactive ? leftName(t.name, t.leftLabel, t.leftOn) : t.name, t.department, t.branch, t.manager, t.present, t.absent, t.pending, Number(t.hours.toFixed(2))],
          })),
          redCols: [5],
          amberCols: [6],
          formats: { 7: "0.00" },
          totalCols: [4, 5, 6, 7],
          widths: { 0: 34 },
        },
      );
    }
    setExporting(true);
    try {
      await writeAttendanceWorkbook(`attendance-monitoring-report_${dateFrom}_to_${dateTo}.xlsx`, subtitle, sheets);
    } catch (err) {
      console.error("Attendance report export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  const content = (
    <>
      {!embedded && (
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Read-only attendance summary — approve PTO/corrections from the Attendance Monitoring Dashboard.</p>
          </div>
        </div>
      )}

        <div className="panel p-2.5 mb-3"><div className="flex flex-wrap items-end gap-2.5">
          <div className="flex flex-col gap-0.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-xs py-1 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-0.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-xs py-1 px-2 rounded-md" /></div>
          {groupBy !== "employee" && (
            <div className="flex flex-col gap-0.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Department</label>
              <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="glass-input text-xs py-1 px-2 rounded-md">
                <option value="">All Departments</option>
                {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select></div>
          )}
          {groupBy === "employee" && (
            <div className="flex flex-col gap-0.5 relative">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee</label>
              <button
                ref={employeeFilterBtnRef}
                type="button"
                onClick={() => (employeeFilterOpen ? setEmployeeFilterOpen(false) : openEmployeeFilterMenu())}
                className="glass-input text-xs py-1 px-2 rounded-md text-left flex items-center justify-between gap-2 min-w-[9rem]"
              >
                <span className="truncate">
                  {employeeFilter.size === 0
                    ? "All Employees"
                    : employeeFilterOptions.filter((o) => employeeFilter.has(o.id)).map((o) => o.name).join(", ")}
                </span>
              </button>
              {employeeFilterOpen && employeeFilterPos && createPortal(
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setEmployeeFilterOpen(false)} />
                  <div
                    ref={employeeFilterMenuRef}
                    className="fixed z-50 w-64 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl"
                    style={{ top: employeeFilterPos.top, left: employeeFilterPos.left }}
                  >
                    <label className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded border-b border-white/10 hover:bg-white/5 cursor-pointer text-sm font-semibold text-slate-100">
                      <input
                        type="checkbox"
                        checked={employeeFilter.size === 0}
                        onChange={() => setEmployeeFilter(new Set())}
                        className="accent-blue-500"
                      />
                      All Employees
                    </label>
                    {employeeFilterOptions.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1.5">No employees.</p>}
                    {employeeFilterOptions.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm text-slate-200">
                        <input type="checkbox" checked={employeeFilter.has(o.id)} onChange={() => toggleEmployeeFilter(o.id)} className="accent-blue-500" />
                        {o.name}
                      </label>
                    ))}
                  </div>
                </>,
                document.body,
              )}
            </div>
          )}
          <button
            onClick={() => void exportToXlsx()}
            disabled={loading || exporting}
            className="group flex items-center gap-1.5 px-3 py-1.5 mb-0.5 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-lg transition shadow-lg hover:shadow-blue-500/50 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-4 w-4 group-hover:scale-110 transition transform" /> Download Attendance Report
          </button>
        </div></div>

        {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-6 mb-3"><BrandedLoader label="Loading Attendance Monitoring Report…" /></div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
          {[
            ["Total Employees", filteredProfiles.length, "text-white", Users],
            ["Present Today", todayKpi.present, "text-green-300", UserCheck],
            ["Absent Today", todayKpi.absent, "text-red-300", UserX],
            ["Late Today", todayKpi.late, "text-yellow-300", Clock],
            ["PTO Pending", ptoPending, "text-blue-300", Clock],
            ["Warnings", warningsCount, "text-orange-300", UserX],
          ].map(([label, value, color, Icon]: any) => (
            <div key={label} className="panel p-2 text-center">
              <div className="flex justify-center mb-0.5 text-muted-foreground"><Icon className="h-3.5 w-3.5" /></div>
              <p className={`text-base font-bold ${color}`}>{value}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {groupBy !== "employee" && (
        <div className="panel p-3 mb-3">
          <p className="text-sm font-semibold mb-3">Daily Attendance Trend</p>
          <ResponsiveContainer width="100%" height={220} debounce={200}>
            <LineChart data={trendData} margin={{ left: -10, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Line type="monotone" dataKey="present" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} name="Present" />
              <Line type="monotone" dataKey="late" stroke="#facc15" strokeWidth={2} dot={{ r: 3 }} name="Late" />
              <Line type="monotone" dataKey="absent" stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} name="Absent" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        )}

        {groupBy === "employee" ? (
        <div className="panel overflow-x-auto p-0">
          <div className="px-3 py-2 border-b border-white/10 font-semibold text-xs flex justify-between"><span>Daily Attendance</span><span className="text-muted-foreground">{dailyEmployeeRows.length} records</span></div>
          <table className="w-full text-xs"><thead><tr className="border-b border-white/10 bg-white/5">
            {[
              { label: "Name", align: "text-left" },
              { label: "Role", align: "text-left" },
              { label: "Clock In", align: "text-center" },
              { label: "Required In", align: "text-center" },
              { label: "Clock Out", align: "text-center" },
              { label: "Required Out", align: "text-center" },
              { label: "Hours", align: "text-center" },
              { label: "Status", align: "text-center" },
            ].map((h) => (
              <th key={h.label} className={`px-2.5 py-1.5 ${h.align} text-[10px] text-muted-foreground uppercase whitespace-nowrap`}>{h.label}</th>
            ))}
          </tr></thead>
          <tbody>
            {dailyEmployeeRows.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No attendance records found.</td></tr> :
              dailyEmployeeRows.map((r, i) => {
                const showDateBand = i === 0 || dailyEmployeeRows[i - 1].date !== r.date;
                return (
                  <Fragment key={`${r.profileId}|${r.date}`}>
                    {showDateBand && (
                      <tr className="bg-blue-500/10">
                        <td colSpan={8} className="px-2.5 py-1 font-semibold text-blue-300 text-[10px] uppercase tracking-wide">{r.date}</td>
                      </tr>
                    )}
                    <tr className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-2.5 py-1 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="px-2.5 py-1 text-muted-foreground whitespace-nowrap">{r.role}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{r.clockIn || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap text-muted-foreground">{r.requiredCheckIn || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{r.clockOut || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap text-muted-foreground">{r.requiredCheckOut || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{r.hours.toFixed(2)}h</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
          </tbody></table>
        </div>
        ) : (
        <div className="panel overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Department Summary — Full Period</span><span className="text-xs text-muted-foreground">{roleSummary.length} departments · click one to see its people</span></div>
          <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">
            {["Department", "Employees", "Days Present", "Absences", "Total Hours"].map((h, i) => (
              <th key={h} className={`px-3 py-3 ${i === 0 ? "text-left" : "text-center"} text-xs text-muted-foreground uppercase whitespace-nowrap`}>
                {h}
                {h === "Employees" && <span className="block text-[9px] font-normal normal-case tracking-normal">Active | Deactivated</span>}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {roleSummary.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No employees found.</td></tr> :
              roleSummary.map((r, i) => {
                const isOpen = openRoles.has(r.role);
                const people = employeesByRole.get(r.role) ?? [];
                return (
                <Fragment key={r.role}>
                <tr
                  onClick={() => toggleRole(r.role)}
                  aria-expanded={isOpen}
                  className={`border-b border-white/5 hover:bg-white/5 cursor-pointer ${isOpen ? "bg-blue-500/10" : i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}
                >
                  <td className="px-3 py-2.5 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      {r.role}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums whitespace-nowrap" title={`${r.count - r.inactive} active, ${r.inactive} deactivated during these dates`}>
                    <span className="text-emerald-300">{r.count - r.inactive}</span>
                    <span className="mx-1.5 text-muted-foreground/50">|</span>
                    <span className={r.inactive > 0 ? "text-red-300" : "text-muted-foreground/60"}>{r.inactive}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">{r.present}</td>
                  <td className="px-3 py-2.5 text-center">{r.absent > 0 ? <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">{r.absent}</span> : "—"}</td>
                  <td className="px-3 py-2.5 text-center">{r.hours.toFixed(1)}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-white/10 bg-slate-950/40">
                    <td colSpan={5} className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-white/10 bg-white/5">
                            {EMPLOYEE_COLUMNS.map((c) => (
                              <th key={c.label} className={`px-2.5 py-1.5 ${c.left ? "text-left" : "text-center"} text-[10px] text-muted-foreground uppercase whitespace-nowrap`}>{c.label}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {people.map((e) => (
                              <tr key={e.profileId} className="border-b border-white/5 hover:bg-white/5">
                                <td className="px-2.5 py-1.5 pl-8 whitespace-nowrap"><span className="font-medium">{e.name}</span><span className="block text-[10px] text-muted-foreground">{e.title}</span>{e.inactive && (
                                  <span
                                    className="mt-0.5 inline-block rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300"
                                    title={e.leftSource ? `Date from ${e.leftSource}` : "No date on file"}
                                  >
                                    {e.leftLabel}{e.deactivatedOn ? ` · ${new Date(e.deactivatedOn + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                                  </span>
                                )}</td>
                                <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{e.department}</td>
                                <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{e.branch}</td>
                                <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{e.manager}</td>
                                <td className="px-2.5 py-1.5 text-center tabular-nums">{e.daysWorked}</td>
                                <td className="px-2.5 py-1.5 text-center tabular-nums">{e.hours.toFixed(2)}</td>
                                <td className="px-2.5 py-1.5 text-center tabular-nums">{e.daysWorked ? (e.hours / e.daysWorked).toFixed(2) : "—"}</td>
                                <td className="px-2.5 py-1.5 text-center">{e.absent > 0 ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-300 border border-red-500/30">{e.absent}</span> : "—"}</td>
                                <td className="px-2.5 py-1.5 text-center">{e.missingTimeOut > 0 ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/30">{e.missingTimeOut}</span> : "—"}</td>
                                <td
                                  className="px-2.5 py-1.5 text-center tabular-nums whitespace-nowrap"
                                  title={e.pto ? `${fmtDays(e.pto.remaining)} of ${e.pto.allowance} PTO days left this PTO year · ${fmtDays(e.pto.used)} used${e.pto.pending ? ` · ${fmtDays(e.pto.pending)} pending` : ""}${e.leaveDays ? ` · ${e.leaveDays} leave day${e.leaveDays === 1 ? "" : "s"} in these dates` : ""}` : "Not PTO-eligible yet (under 1 year from hire date)"}
                                >
                                  {e.pto ? (
                                    <>
                                      <span className={e.pto.remaining === 0 ? "text-red-300" : "text-emerald-300"}>{fmtDays(e.pto.remaining)}</span>
                                      <span className="text-muted-foreground">/{e.pto.allowance}</span>
                                      {e.pto.pending > 0 && <span className="block text-[9px] text-amber-300">{fmtDays(e.pto.pending)} pending</span>}
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground/60 text-[10px]">Not eligible</span>
                                  )}
                                  {e.leaveDays > 0 && (
                                    <button
                                      type="button"
                                      onClick={(ev) => { ev.stopPropagation(); setLeaveView({ profileId: e.profileId, name: e.name }); }}
                                      className="block mx-auto text-[9px] text-violet-300 underline decoration-dotted underline-offset-2 hover:text-violet-200"
                                      title="See which leave"
                                    >
                                      {e.leaveDays} on leave
                                    </button>
                                  )}
                                </td>
                                <td className="px-2.5 py-1.5 text-center">{e.corrections > 0 ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30">{e.corrections}</span> : "—"}</td>
                                <td className="px-2.5 py-1.5 text-center tabular-nums">{e.correctionsApproved || "—"}</td>
                                <td className="px-2.5 py-1.5 text-center tabular-nums">{e.correctionsPending || "—"}</td>
                                <td className="px-2.5 py-1.5 text-center tabular-nums">{e.correctionsRejected || "—"}</td>
                                <td className="px-2.5 py-1.5 text-center">{e.warnings > 0 ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/30">{e.warnings}</span> : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
          </tbody></table>
        </div>
        )}
        {groupBy !== "employee" && (
        <div className="panel overflow-x-auto p-0 mt-4">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between">
            <span>Trainees — Full Period</span>
            <span className="text-xs text-muted-foreground">
              {traineeSummary.filter((t) => !t.inactive).length} active
              {traineeSummary.some((t) => t.inactive) ? ` · ${traineeSummary.filter((t) => t.inactive).length} left` : ""} · from Trainee Attendance
            </span>
          </div>
          <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">
            {["Trainee", "Department", "Branch", "Manager", "Days Present", "Absences", "Pending Days", "Total Hours"].map((h, i) => (
              <th key={h} className={`px-3 py-3 ${i < 4 ? "text-left" : "text-center"} text-xs text-muted-foreground uppercase whitespace-nowrap`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {traineeSummary.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No trainees in these dates.</td></tr>
            ) : traineeSummary.map((t, i) => (
              <tr key={t.profileId} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-[10px] text-muted-foreground">{t.title}</span>
                  {t.inactive && (
                    <span className="mt-0.5 inline-block rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300">
                      {t.leftLabel}{t.leftOn ? ` · ${new Date(t.leftOn + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{t.department}</td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{t.branch}</td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{t.manager}</td>
                <td className="px-3 py-2.5 text-center tabular-nums">{t.present}</td>
                <td className="px-3 py-2.5 text-center">{t.absent > 0 ? <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">{t.absent}</span> : "—"}</td>
                <td className="px-3 py-2.5 text-center">{t.pending > 0 ? <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30">{t.pending}</span> : "—"}</td>
                <td className="px-3 py-2.5 text-center tabular-nums">{t.hours.toFixed(1)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        )}
        </>
        )}
      {leaveView && (
        <AppModal
          title={`Leave — ${leaveView.name}`}
          description={`Approved leave between ${fmtShortDate(dateFrom)} and ${fmtShortDate(dateTo)}`}
          onClose={() => setLeaveView(null)}
        >
          {leaveViewRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No approved leave in these dates.</p>
          ) : (
            <div className="space-y-2">
              {leaveViewRows.map((r) => (
                <div key={r.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${LEAVE_TYPE_CLASS[r.ptoType] ?? "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}>
                      {leaveTypeLabel(r.ptoType)}
                    </span>
                    <span className="text-sm text-slate-200">
                      {fmtShortDate(r.startDate)}{r.endDate && r.endDate !== r.startDate ? ` – ${fmtShortDate(r.endDate)}` : ""}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {r.inRange} day{r.inRange === 1 ? "" : "s"} in these dates
                    </span>
                  </div>
                  {r.reason?.trim() && <p className="mt-1.5 text-xs text-muted-foreground">"{r.reason.trim()}"</p>}
                </div>
              ))}
            </div>
          )}
        </AppModal>
      )}
    </>
  );

  if (embedded) return content;
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">{content}</main>
    </div>
  );
}
