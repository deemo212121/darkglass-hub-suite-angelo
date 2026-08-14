import { AlertCircle, AlertTriangle, Clock, Users, UserCheck, UserX, Bell, MessageSquare, ChevronLeft, Download, Calendar, FileText, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { getCompanyUsers, getProfileEmployeeInfo, type ProfileRow } from "@/lib/supabase/users";
import { resolvePresenceStatus, PRESENCE_DOT_CLASS, PRESENCE_LABEL } from "@/lib/presence";
import { getRoleDepartmentBreakdown, canSubmitConductNote, normalizeRole, isAttendanceManagerTierRole } from "@/lib/roleLabels";
import { addAgentNote, getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import {
  getCompanyTimecardEntries,
  getProfileIdByFirebaseUid,
  calcWorkedHours,
  hoursDiff,
  saveEntry as saveTimecardEntry,
  type CompanyTimecardEntry,
} from "@/lib/supabase/timecards";
import { getAttendanceNotes, upsertAttendanceNote } from "@/lib/supabase/attendanceNotes";
import { ActivityLogPanel } from "@/components/ActivityLogPanel";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { resolveTeamLeadOrManager, visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { ATTENDANCE_GRACE_MINUTES, addMinutesToHHMM, nowInTimezone, timezoneForBranch, DEFAULT_ATTENDANCE_TIMEZONE, payGraceMinutesFor, applyGraceToCheckIn, roundCheckOutToSchedule, toSeconds, ON_TIME_BUFFER_SECONDS } from "@/lib/attendanceGrace";
import { formatClockTime } from "@/lib/payslipTemplate";
import {
  getCompanyPtoRequests,
  createPtoRequest,
  reviewPtoStage,
  canReviewPtoStage,
  isEligibleForPto,
  ptoEligibleDate,
  type PtoRequestRow,
  type PtoType,
  type PtoStage,
} from "@/lib/supabase/pto";
import {
  getCompanyTimecardCorrections,
  getCompanyTimecardCorrectionHistory,
  createTimecardCorrection,
  reviewCorrectionStage,
  canReviewCorrectionStage,
  type TimecardCorrectionRow,
  type TimecardCorrectionHistoryRow,
  type CorrectionStage,
  type CorrectionStatus,
} from "@/lib/supabase/timecardCorrections";
import {
  getCompanyEmployeeRequests,
  updateEmployeeRequestStatus,
  type EmployeeRequestRow,
  type EmployeeRequestStatus,
} from "@/lib/supabase/employeeRequests";

interface DailyRecord {
  profileId: string;
  /** Only set in date-range mode (Daily Attendance Tracker's From/To filter) — the single-day view already carries its date in the section heading instead. */
  date?: string;
  name: string;
  email: string;
  location: string;
  department: string;
  manager: string;
  role: string;
  checkIn: string;
  mealIn: string;
  mealOut: string;
  checkOut: string;
  alerts: string[];
  isOffDay: boolean;
  /** Display name of whoever clocked this person in, if it wasn't themselves (a manager's proxy clock-in). */
  clockedInBy: string | null;
  /** Scheduled shift times ("HH:MM", possibly "") — shown in the name popover, see requiredTimePopoverId. */
  requiredCheckIn: string;
  requiredCheckOut: string;
}

const PTO_TYPE_LABELS: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function fmtHoursMinutes(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Off-day indices follow the same convention timecards.ts already uses
 * company-wide (getCompanyTimecardWarnings / getAttendanceForRange):
 * JS Date.getDay() — 0=Sunday..6=Saturday.
 *
 * `nowHHMM` is the current time in THIS employee's own branch timezone
 * ("HH:MM" — see timezoneForBranch in attendanceGrace.ts: Philippines
 * follows Central by policy, every US branch follows its own real local
 * zone) when scoring today live, or `null` when scoring a day that's
 * already over (e.g. past days in the monthly summary) — grace never
 * applies then, since anything still missing at that point is definitively
 * missing, not "not due yet."
 *
 * `graceMinutes` is the caller-computed per-region/role grace window (see
 * payGraceMinutesFor in attendanceGrace.ts — PH 5 min, US office 15 min,
 * Technicians 0), applied to both clock-in and clock-out detection timing.
 * A late-but-within-grace clock-in still shows a flag (so it isn't silently
 * invisible) but distinguished from a real (beyond-grace) late arrival —
 * and the same grace-adjusted check-in/rounded check-out feeds the
 * Over/Under Time worked-hours calc, so a fully-forgiven late arrival
 * doesn't also throw a false "Under Time" flag.
 *
 * Real punches carry seconds ("08:00:45"); schedules are plain "HH:MM".
 * Lateness/grace comparisons below go through toSeconds() rather than raw
 * string comparison (which is unsound across that precision mismatch — see
 * attendanceGrace.ts). A punch within ON_TIME_BUFFER_SECONDS (60s) of the
 * scheduled check-in is rounded to exactly on time before lateness is even
 * considered, same clock-precision courtesy applied to pay in
 * applyGraceToCheckIn/roundCheckOutToSchedule.
 */
function computeAlerts(
  checkIn: string,
  checkOut: string,
  mealStart: string,
  mealEnd: string,
  requiredCheckIn: string,
  requiredCheckOut: string,
  isOffDay: boolean,
  nowHHMM: string | null,
  graceMinutes: number = ATTENDANCE_GRACE_MINUTES,
  workingHours?: number | null
): string[] {
  if (isOffDay) return [];

  const graceIn = requiredCheckIn ? addMinutesToHHMM(requiredCheckIn, graceMinutes) : null;
  const graceOut = requiredCheckOut ? addMinutesToHHMM(requiredCheckOut, graceMinutes) : null;
  const pastInGrace = !graceIn || nowHHMM === null || nowHHMM > graceIn;
  const pastOutGrace = !graceOut || nowHHMM === null || nowHHMM > graceOut;

  if (!checkIn && !checkOut) {
    return pastInGrace ? ["Absent", "No Clock In"] : [];
  }
  const alerts: string[] = [];
  if (!checkIn) {
    if (pastInGrace) alerts.push("No Clock In");
  } else if (requiredCheckIn) {
    const lateInSeconds = toSeconds(checkIn) - toSeconds(requiredCheckIn);
    if (lateInSeconds > ON_TIME_BUFFER_SECONDS) {
      if (lateInSeconds <= graceMinutes * 60) alerts.push("Late Check In (Covered by Grace)");
      else alerts.push("Late Check In");
    }
  }
  if (checkIn && !checkOut && pastOutGrace) alerts.push("No Clock Out");
  if (checkIn && checkOut) {
    const paidCheckIn = requiredCheckIn ? applyGraceToCheckIn(checkIn, requiredCheckIn, graceMinutes) : checkIn;
    const paidCheckOut = requiredCheckOut ? roundCheckOutToSchedule(checkOut, requiredCheckOut) : checkOut;
    const worked = calcWorkedHours({ checkIn: paidCheckIn, checkOut: paidCheckOut, mealStart, mealEnd, notes: "" });
    // `worked` already has the meal break subtracted (calcWorkedHours), so
    // the target it's compared against needs to be the NET duty-hours
    // figure too — the profile's own working_hours (already meal-excluded)
    // when set. Falling back to the raw requiredCheckIn/requiredCheckOut
    // span here would compare a meal-EXCLUSIVE worked total against a
    // meal-INCLUSIVE required span, so anyone who takes their full
    // scheduled lunch reads as "Under Time" by about the length of their
    // lunch even after working their entire required shift.
    const requiredHours = workingHours != null ? workingHours : requiredCheckIn && requiredCheckOut ? hoursDiff(requiredCheckIn, requiredCheckOut) : 8;
    if (worked - requiredHours > 0.25) alerts.push(`Over Time (${fmtHoursMinutes(worked)})`);
    else if (requiredHours - worked > 0.25) alerts.push(`Under Time (${fmtHoursMinutes(worked)})`);
  }
  return alerts;
}

/** "Late Check In" counts toward late-arrival stats/filters; the grace-covered variant is still shown as a flag on the day itself but doesn't count as an actual lateness incident. */
function isPenalizedLateAlert(alert: string): boolean {
  return alert.includes("Late") && !alert.includes("Covered by Grace");
}

export function AttendanceMonitoringPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid, ready, allowedLocations, displayName, role, extraRoles } = useAuth();
  // Attendance notes (the quick "Add Note" / Notify Individual / Notify Team
  // Lead flow) are open to HR/Finance/Admin for the whole roster, and to
  // manager-tier roles for their own direct reports — the row itself is
  // already scoped to "my team" via visibleProfiles/visibleAttendanceProfileIds,
  // so this flag just needs to admit manager-tier roles at all, not re-scope
  // per row. normalizeRole() so legacy space-separated role values (e.g.
  // "CSR Manager") still match, same fix as hasDashboardAccess.
  const canManageNotes = [role, ...extraRoles].some((r) => ["ADMIN", "SUPERADMIN", "HR", "FINANCE"].includes(normalizeRole(r))) || isAttendanceManagerTierRole(role, extraRoles);
  // Attendance Disputes/Payroll Inquiries have no manager stage at all —
  // unlike PTO/Corrections above, these go straight to HR/Finance/Admin,
  // so manager-tier roles never see this tab (moved here from Employee
  // Self-Service's old "Manage Requests" tab, which had the same rule).
  const isFullRequestsAdmin = [role, ...extraRoles].some((r) => ["ADMIN", "SUPERADMIN", "HR", "FINANCE"].includes(normalizeRole(r)));
  // Warnings tab reuses the same conduct-note workflow as CsrAgentDetailPage
  // (employee_conduct_notes, reviewed on the HR Warnings & Mistakes tab) —
  // any manager-flavored role can submit one here for a tardy employee, but
  // unlike CsrAgentDetailPage it never fast-tracks to approved: every
  // submission from this tab always waits on HR review.
  const canWarn = ready && canSubmitConductNote(role, extraRoles);

  const [loading, setLoading] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [correctionHistory, setCorrectionHistory] = useState<TimecardCorrectionHistoryRow[]>([]);
  const [employeeRequests, setEmployeeRequests] = useState<EmployeeRequestRow[]>([]);
  const [employeeRequestNote, setEmployeeRequestNote] = useState<Record<string, string>>({});

  const ATTENDANCE_TABS = ["daily-attendance", "pto-management", "corrections", "disputes-inquiries", "warnings"] as const;
  const [activeTab, setActiveTab] = usePersistedTab<typeof ATTENDANCE_TABS[number]>(
    "ahs:attendance-monitoring-active-tab",
    ATTENDANCE_TABS,
    "daily-attendance",
  );
  // Deep-link support (e.g. the Accounting Dashboard's payroll-blocked
  // errors — missing clock-out or pending time correction — link straight
  // to whichever tab actually lets Finance fix it) — same ?tab= pattern
  // already used on Part Inventory / HR Daily / etc. Only ever overrides
  // forward, never fights the persisted tab on a plain reload with no
  // ?tab= present.
  const routeSearch = (useSearch({ strict: false }) as { tab?: string }) ?? {};
  useEffect(() => {
    if (routeSearch.tab && (ATTENDANCE_TABS as readonly string[]).includes(routeSearch.tab)) {
      setActiveTab(routeSearch.tab as typeof ATTENDANCE_TABS[number]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.tab]);
  const [summaryView, setSummaryView] = useState<"weekly" | "monthly" | "custom">("weekly");
  const [searchEmployee, setSearchEmployee] = useState<string>("");
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [summaryDepartmentFilter, setSummaryDepartmentFilter] = useState<string>("all");
  // Weekly Attendance Summary: narrow the roster to who checked in (or was
  // absent) on one specific day of the current week, instead of always
  // showing everyone's full Mon-Fri row.
  const [weeklyDayFilter, setWeeklyDayFilter] = useState<number | "all">("all");
  const [weeklyStatusFilter, setWeeklyStatusFilter] = useState<"all" | "present" | "absent">("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  // Daily Attendance Tracker only — hides everyone still missing either
  // punch (absent, or clocked in but not out yet) so the table only shows
  // employees whose attendance for the day is actually complete.
  const [completeOnly, setCompleteOnly] = useState(false);
  // Daily Attendance Tracker — clicking an employee's name shows their
  // scheduled shift (Required Check In/Out) right there instead of only
  // linking out to their full profile. Keyed by the SAME id used for the
  // row key (profileId, or profileId|date in date-range mode) so opening
  // one person's popover on one date doesn't also open it for the same
  // person on a different date. Only one open at a time — clicking the
  // same name again, or a different name, closes/switches it.
  const [requiredTimePopoverKey, setRequiredTimePopoverKey] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [selectedCorrection, setSelectedCorrection] = useState<TimecardCorrectionRow | null>(null);
  // Attendance Corrections table's own search/filter — separate from
  // searchEmployee/filterDepartment above, which are Daily Attendance's.
  const [correctionSearch, setCorrectionSearch] = useState("");
  const [correctionStatusFilter, setCorrectionStatusFilter] = useState<"all" | CorrectionStatus>("all");
  const [correctionDepartmentFilter, setCorrectionDepartmentFilter] = useState<string>("all");
  const [correctionTimecardData, setCorrectionTimecardData] = useState<{ checkIn: string; checkOut: string; mealStart: string; mealEnd: string }>({ checkIn: "", checkOut: "", mealStart: "", mealEnd: "" });
  const [notesData, setNotesData] = useState<Record<string, { content: string; notifyIndividual: boolean; notifyTeamLead: boolean }>>({});
  const [newNote, setNewNote] = useState("");
  const [notifyIndividual, setNotifyIndividual] = useState(false);
  const [notifyTeamLead, setNotifyTeamLead] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [selectedAlertType, setSelectedAlertType] = useState<"missing-clockin" | "missing-clockout" | "late-arrival" | null>(null);
  // Custom Attendance Summary — clicking a row's Present/Absent/Late count
  // opens a day-by-day breakdown for that one employee over the picked range.
  const [customDetailModal, setCustomDetailModal] = useState<{ profileId: string; name: string; type: "present" | "absent" | "late" } | null>(null);
  const [showPtoForm, setShowPtoForm] = useState(false);
  const [ptoForm, setPtoForm] = useState({ profileId: "", ptoType: "vacation" as PtoType, startDate: "", endDate: "", reason: "" });
  const [ptoFormHireDate, setPtoFormHireDate] = useState<string | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({ profileId: "", workDate: "", correctedCheckIn: "", correctedCheckOut: "", correctedMealStart: "", correctedMealEnd: "", reason: "" });
  const [conductNotes, setConductNotes] = useState<CsrAgentNote[]>([]);
  const [warnSearch, setWarnSearch] = useState("");
  const [warnTarget, setWarnTarget] = useState<{ profileId: string; name: string } | null>(null);
  const [warnText, setWarnText] = useState("");
  const [warnSaving, setWarnSaving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [submittingPto, setSubmittingPto] = useState(false);
  // Keyed by request/correction id so only the row actually being reviewed shows as busy.
  const [busyPtoId, setBusyPtoId] = useState<string | null>(null);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [correctionStageBusy, setCorrectionStageBusy] = useState(false);

  // "Today" is anchored to the default policy timezone (Central), not the
  // viewer's own browser locale — otherwise an HR/Admin user physically in
  // the Philippines (13-14 hours off Central) would see the wrong calendar
  // day here for roughly half of every 24 hours.
  const todayISO = useMemo(() => nowInTimezone(DEFAULT_ATTENDANCE_TIMEZONE).dateISO, []);
  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const weekStart = mondayOf(today);
    const start = weekStart < monthStart ? weekStart : monthStart;
    return { rangeStart: toISODate(start), rangeEnd: todayISO };
  }, [todayISO]);

  const loadAll = useCallback(async () => {
    if (!ready || !uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [profileId, profileRows, csrCompositionResult, entryRows, noteRows, ptoRows, correctionRows, historyRows, conductNoteRows, employeeRequestRows] = await Promise.all([
        getProfileIdByFirebaseUid(uid),
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getCompanyTimecardEntries(rangeStart, rangeEnd),
        getAttendanceNotes(todayISO, todayISO),
        getCompanyPtoRequests(),
        getCompanyTimecardCorrections(),
        getCompanyTimecardCorrectionHistory(),
        getAllAgentNotes().catch(() => []),
        getCompanyEmployeeRequests().catch(() => []),
      ]);
      setMyProfileId(profileId);
      setProfiles(profileRows);
      setCsrComposition(csrCompositionResult);
      setEntries(entryRows);
      const noteMap: Record<string, { content: string; notifyIndividual: boolean; notifyTeamLead: boolean }> = {};
      noteRows.forEach((n) => {
        noteMap[n.profileId] = { content: n.content, notifyIndividual: n.notifyIndividual, notifyTeamLead: n.notifyTeamLead };
      });
      setNotesData(noteMap);
      setPtoRequests(ptoRows);
      setCorrections(correctionRows);
      setCorrectionHistory(historyRows);
      setConductNotes(conductNoteRows);
      setEmployeeRequests(employeeRequestRows);
    } catch (error) {
      console.error("Failed to load attendance data:", error);
    } finally {
      setLoading(false);
    }
  }, [ready, uid, rangeStart, rangeEnd, todayISO]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Daily Attendance Tracker date — defaults to today, but HR/managers can
  // pick any earlier date to review that day instead.
  const [dailyDate, setDailyDate] = useState<string>(todayISO);
  const [dailyDateEntries, setDailyDateEntries] = useState<CompanyTimecardEntry[]>([]);
  const [dailyDateLoading, setDailyDateLoading] = useState(false);

  // The main `entries` fetch above already covers [rangeStart, rangeEnd]
  // (this week/month through today), so viewing today or any other day
  // already in that window is free — only fetch separately when a date
  // outside it (e.g. last month) is picked.
  useEffect(() => {
    if (dailyDate >= rangeStart && dailyDate <= rangeEnd) {
      setDailyDateEntries([]);
      return;
    }
    if (!ready || !uid) return;
    let cancelled = false;
    setDailyDateLoading(true);
    getCompanyTimecardEntries(dailyDate, dailyDate)
      .then((rows) => { if (!cancelled) setDailyDateEntries(rows); })
      .finally(() => { if (!cancelled) setDailyDateLoading(false); });
    return () => { cancelled = true; };
  }, [dailyDate, rangeStart, rangeEnd, ready, uid]);

  // Daily Attendance Tracker date-RANGE filter — separate from `dailyDate`
  // above (the single-day picker next to the table heading). When both
  // From/To are set, the tracker table switches to showing one row per
  // employee per date in the range instead of the single selected day.
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  const dateRangeActive = Boolean(filterDateFrom && filterDateTo && filterDateFrom <= filterDateTo);
  const clearDateRange = () => { setFilterDateFrom(""); setFilterDateTo(""); };

  const [rangeFilterEntries, setRangeFilterEntries] = useState<CompanyTimecardEntry[]>([]);
  const [rangeFilterLoading, setRangeFilterLoading] = useState(false);
  useEffect(() => {
    if (!dateRangeActive) { setRangeFilterEntries([]); return; }
    if (!ready || !uid) return;
    let cancelled = false;
    setRangeFilterLoading(true);
    getCompanyTimecardEntries(filterDateFrom, filterDateTo)
      .then((rows) => { if (!cancelled) setRangeFilterEntries(rows); })
      .finally(() => { if (!cancelled) setRangeFilterLoading(false); });
    return () => { cancelled = true; };
  }, [dateRangeActive, filterDateFrom, filterDateTo, ready, uid]);

  const dailyEntryByProfileId = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    if (dailyDate >= rangeStart && dailyDate <= rangeEnd) {
      for (const e of entries) if (e.workDate === dailyDate) map.set(e.profileId, e);
    } else {
      for (const e of dailyDateEntries) map.set(e.profileId, e);
    }
    return map;
  }, [dailyDate, rangeStart, rangeEnd, entries, dailyDateEntries]);

  // Custom Attendance Summary — lets HR/managers pick any date range instead
  // of being limited to the current week or month-to-date. Defaults to the
  // same window already loaded (rangeStart/rangeEnd) so switching to Custom
  // shows real data immediately, before the user picks their own dates.
  const [customRangeStart, setCustomRangeStart] = useState<string>(rangeStart);
  const [customRangeEnd, setCustomRangeEnd] = useState<string>(rangeEnd);
  const [customRangeEntries, setCustomRangeEntries] = useState<CompanyTimecardEntry[]>([]);
  const [customRangeLoading, setCustomRangeLoading] = useState(false);
  // Same "only fetch when outside what's already loaded" rule as dailyDateEntries above.
  const customRangeCovered = customRangeStart >= rangeStart && customRangeEnd <= rangeEnd;
  useEffect(() => {
    if (summaryView !== "custom" || customRangeCovered) { setCustomRangeEntries([]); return; }
    if (!ready || !uid || !customRangeStart || !customRangeEnd || customRangeStart > customRangeEnd) return;
    let cancelled = false;
    setCustomRangeLoading(true);
    getCompanyTimecardEntries(customRangeStart, customRangeEnd)
      .then((rows) => { if (!cancelled) setCustomRangeEntries(rows); })
      .finally(() => { if (!cancelled) setCustomRangeLoading(false); });
    return () => { cancelled = true; };
  }, [summaryView, customRangeStart, customRangeEnd, customRangeCovered, ready, uid]);

  // PTO eligibility for whoever is selected in the New PTO Request form —
  // hire date lives in profiles.employee_info, fetched on demand per
  // selection rather than bulk-loaded for the whole roster.
  useEffect(() => {
    if (!ptoForm.profileId) {
      setPtoFormHireDate(null);
      return;
    }
    let cancelled = false;
    getProfileEmployeeInfo(ptoForm.profileId).then((info) => {
      if (!cancelled) setPtoFormHireDate(info?.hireDate || null);
    });
    return () => { cancelled = true; };
  }, [ptoForm.profileId]);

  // Live clock, one per distinct branch timezone actually in view, so a row
  // visibly flips into "Missing Clock In/Out" as ITS OWN branch's 5-minute
  // grace period elapses (Eastern-branch employees judged against Eastern
  // time, Central against Central, Philippines against Central by policy),
  // without a reload.
  const distinctTimezones = useMemo(
    () => Array.from(new Set(profiles.map((p) => timezoneForBranch(p.assigned_branch)))),
    [profiles]
  );
  const computeNowByTimezone = useCallback(() => {
    const map: Record<string, string> = {};
    distinctTimezones.forEach((tz) => {
      map[tz] = nowInTimezone(tz).hhmm;
    });
    return map;
  }, [distinctTimezones]);
  const [nowByTimezone, setNowByTimezone] = useState<Record<string, string>>(computeNowByTimezone);
  useEffect(() => {
    setNowByTimezone(computeNowByTimezone());
    const interval = setInterval(() => setNowByTimezone(computeNowByTimezone()), 30_000);
    return () => clearInterval(interval);
  }, [computeNowByTimezone]);

  const allProfileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const profileName = (id: string | null) => {
    if (!id) return "—";
    const p = allProfileById.get(id);
    return p?.display_name || p?.email || "—";
  };

  const myProfile = useMemo(
    () => (myProfileId ? allProfileById.get(myProfileId) ?? null : null),
    [myProfileId, allProfileById]
  );

  // Manager-tier roles (Technician Manager, CSR Manager, BizOps Manager, ...)
  // only see their own direct reports here; Admin/HR/Finance/SuperAdmin see
  // everyone (returns null = unrestricted).
  const teamScopedIds = useMemo(
    () => (myProfile ? visibleAttendanceProfileIds(myProfile, profiles, csrComposition) : null),
    [myProfile, profiles, csrComposition]
  );

  const visibleProfiles = useMemo(() => {
    let result = profiles;
    if (allowedLocations !== null) result = result.filter((p) => allowedLocations.includes(p.assigned_branch || ""));
    if (teamScopedIds !== null) result = result.filter((p) => teamScopedIds.has(p.id));
    return result;
  }, [profiles, allowedLocations, teamScopedIds]);

  // PTO Management tab (KPI tile + both request lists) — same team scoping
  // as visibleProfiles/Daily Attendance above, so a manager-tier viewer only
  // ever sees their own team's PTO requests, never the whole company's.
  const visiblePtoRequests = useMemo(() => {
    if (teamScopedIds === null) return ptoRequests;
    return ptoRequests.filter((r) => teamScopedIds.has(r.profileId));
  }, [ptoRequests, teamScopedIds]);

  const entriesByKey = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    entries.forEach((e) => map.set(`${e.profileId}|${e.workDate}`, e));
    return map;
  }, [entries]);

  const customEntriesByKey = useMemo(() => {
    if (customRangeCovered) return entriesByKey;
    const map = new Map<string, CompanyTimecardEntry>();
    customRangeEntries.forEach((e) => map.set(`${e.profileId}|${e.workDate}`, e));
    return map;
  }, [customRangeCovered, entriesByKey, customRangeEntries]);

  const isDailyDateToday = dailyDate === todayISO;
  const dailyDateLabel = isDailyDateToday ? "Today" : dailyDate;

  // Shared by the single-day tracker and the date-range filter below — same
  // per-employee-per-date computation either way, just called once per date
  // in range mode instead of once for `dailyDate`.
  const buildDailyRecord = useCallback(
    (p: ProfileRow, dateISO: string, entry: CompanyTimecardEntry | undefined, isToday: boolean): DailyRecord => {
      const dow = new Date(dateISO + "T00:00:00").getDay();
      const offDays = new Set<number>(p.off_days ?? []);
      const isOffDay = offDays.has(dow);
      const checkIn = entry?.checkIn || "";
      const checkOut = entry?.checkOut || "";
      const mealIn = entry?.mealStart || "";
      const mealOut = entry?.mealEnd || "";
      const branchTz = timezoneForBranch(p.assigned_branch);
      // Grace-period/"not due yet" logic only makes sense for today — a
      // past day is already fully over, so anything still missing there is
      // definitively missing (see computeAlerts' nowHHMM=null doc comment).
      const rowNowHHMM = isToday ? (nowByTimezone[branchTz] ?? nowInTimezone(branchTz).hhmm) : null;
      const country = p.assigned_branch === "Philippines" ? "PH" : "US";
      const graceMinutes = payGraceMinutesFor(country, normalizeRole(p.role) === "TECHNICIAN");
      const alerts = computeAlerts(checkIn, checkOut, mealIn, mealOut, p.required_check_in || "", p.required_check_out || "", isOffDay, rowNowHHMM, graceMinutes, p.working_hours);
      const clockedInByName = entry?.clockedInBy ? allProfileById.get(entry.clockedInBy)?.display_name || null : null;
      return {
        profileId: p.id,
        date: dateISO,
        name: p.display_name || p.email,
        email: p.email,
        location: p.assigned_branch || "",
        department: getRoleDepartmentBreakdown(p.role).department,
        manager: p.manager_name || "",
        role: normalizeRole(p.role),
        checkIn: checkIn || "—",
        mealIn: mealIn || "—",
        mealOut: mealOut || "—",
        checkOut: checkOut || "—",
        alerts,
        isOffDay,
        clockedInBy: clockedInByName,
        requiredCheckIn: p.required_check_in || "",
        requiredCheckOut: p.required_check_out || "",
      };
    },
    [nowByTimezone, allProfileById]
  );

  const dailyRecords: DailyRecord[] = useMemo(
    () => visibleProfiles.map((p) => buildDailyRecord(p, dailyDate, dailyEntryByProfileId.get(p.id), isDailyDateToday)),
    [visibleProfiles, dailyEntryByProfileId, dailyDate, isDailyDateToday, buildDailyRecord]
  );

  const rangeEntryByKey = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    for (const e of rangeFilterEntries) map.set(`${e.profileId}|${e.workDate}`, e);
    return map;
  }, [rangeFilterEntries]);

  // One record per employee per date in [filterDateFrom, filterDateTo], inclusive.
  const rangeRecords: DailyRecord[] = useMemo(() => {
    if (!dateRangeActive) return [];
    const records: DailyRecord[] = [];
    const end = new Date(`${filterDateTo}T00:00:00`);
    for (let d = new Date(`${filterDateFrom}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = toISODate(d);
      const isToday = iso === todayISO;
      for (const p of visibleProfiles) {
        records.push(buildDailyRecord(p, iso, rangeEntryByKey.get(`${p.id}|${iso}`), isToday));
      }
    }
    return records;
  }, [dateRangeActive, filterDateFrom, filterDateTo, visibleProfiles, rangeEntryByKey, todayISO, buildDailyRecord]);

  const totalEmployees = visibleProfiles.length;
  const presentToday = dailyRecords.filter((r) => r.checkIn !== "—").length;
  const absentToday = dailyRecords.filter((r) => r.checkIn === "—" && !r.isOffDay).length;
  const lateToday = dailyRecords.filter((r) => r.alerts.some(isPenalizedLateAlert)).length;
  const ptoPendingApproval = visiblePtoRequests.filter((r) => r.status === "pending").length;

  const getAlertColor = (alert: string) => {
    if (alert.includes("Over Time")) return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    if (alert.includes("Under Time")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    if (alert.includes("Late")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    return "bg-red-500/20 text-red-300 border-red-500/30";
  };

  const filteredAndSortedData = (dateRangeActive ? rangeRecords : dailyRecords)
    .filter((record) => {
      // Employees who never clocked in for this date don't belong in the
      // Daily Attendance Tracker table at all — it's a list of the day's
      // actual attendance, not a roster. They're still counted in the
      // Absent KPI card and the Missing Clock-In alert above, just not
      // listed row-by-row here.
      if (record.checkIn === "—") return false;
      if (searchEmployee && !record.name.toLowerCase().includes(searchEmployee.toLowerCase())) return false;
      if (filterDepartment !== "all" && record.department !== filterDepartment) return false;
      if (filterLocation !== "all" && record.location !== filterLocation) return false;
      // checkIn is already guaranteed above — this now only additionally
      // requires a completed checkOut.
      if (completeOnly && record.checkOut === "—") return false;
      return true;
    })
    .sort((a, b) => (dateRangeActive && a.date !== b.date ? (a.date! < b.date! ? -1 : 1) : a.name.localeCompare(b.name)));

  // Grouped by department, both the department groups and each group's
  // employees sorted alphabetically — same treatment as the Payroll pages.
  const dailyDataByDepartment = (() => {
    const groups = new Map<string, DailyRecord[]>();
    for (const record of filteredAndSortedData) {
      const dept = record.department || "—";
      if (!groups.has(dept)) groups.set(dept, []);
      groups.get(dept)!.push(record);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([department, records]) => ({ department, records }));
  })();

  const profileDepartment = (p: ProfileRow) => getRoleDepartmentBreakdown(p.role).department;

  const departments = Array.from(
    new Set(visibleProfiles.map(profileDepartment).filter(Boolean))
  ) as string[];
  const locations = Array.from(new Set(visibleProfiles.map((p) => p.assigned_branch).filter(Boolean))) as string[];

  // Weekly/Monthly summary tables get their own department filter since
  // they're a separate section below the Daily Attendance table/filters.
  const summaryProfiles = useMemo(
    () => summaryDepartmentFilter === "all"
      ? visibleProfiles
      : visibleProfiles.filter((p) => profileDepartment(p) === summaryDepartmentFilter),
    [visibleProfiles, summaryDepartmentFilter]
  );

  // ---- Weekly summary (Mon–Fri of the current week) ----
  const weekDates = useMemo(() => {
    const monday = mondayOf(new Date());
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return toISODate(d);
    });
  }, []);

  const weeklySummary = useMemo(() => {
    return summaryProfiles.map((p) => {
      const offDays = new Set<number>(p.off_days ?? []);
      let presentCount = 0;
      let workingDays = 0;
      const cells = weekDates.map((iso) => {
        const dow = new Date(iso + "T00:00:00").getDay();
        if (offDays.has(dow)) return "off" as const;
        if (iso > todayISO) return "future" as const;
        workingDays++;
        const entry = entriesByKey.get(`${p.id}|${iso}`);
        const present = Boolean(entry?.checkIn);
        if (present) presentCount++;
        return present ? ("present" as const) : ("absent" as const);
      });
      const pct = workingDays > 0 ? Math.round((presentCount / workingDays) * 100) : 100;
      return { profileId: p.id, name: p.display_name || p.email, cells, presentCount, workingDays, pct };
    });
  }, [summaryProfiles, weekDates, entriesByKey, todayISO]);

  // Narrows weeklySummary to rows matching the selected day + status (e.g.
  // "who was absent on Wednesday") — "all" for either just shows everyone,
  // same as before this filter existed.
  const filteredWeeklySummary = useMemo(() => {
    if (weeklyDayFilter === "all" || weeklyStatusFilter === "all") return weeklySummary;
    return weeklySummary.filter((row) => row.cells[weeklyDayFilter] === weeklyStatusFilter);
  }, [weeklySummary, weeklyDayFilter, weeklyStatusFilter]);

  // ---- Monthly summary (month-to-date) ----
  const monthlySummary = useMemo(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return summaryProfiles.map((p) => {
      const offDays = new Set<number>(p.off_days ?? []);
      let workingDays = 0;
      let present = 0;
      let late = 0;
      for (let d = new Date(monthStart); d <= today; d.setDate(d.getDate() + 1)) {
        const iso = toISODate(d);
        const dow = d.getDay();
        if (offDays.has(dow)) continue;
        workingDays++;
        const entry = entriesByKey.get(`${p.id}|${iso}`);
        const checkIn = entry?.checkIn || "";
        const checkOut = entry?.checkOut || "";
        if (checkIn) present++;
        const monthlyCountry = p.assigned_branch === "Philippines" ? "PH" : "US";
        const monthlyGraceMinutes = payGraceMinutesFor(monthlyCountry, normalizeRole(p.role) === "TECHNICIAN");
        const alerts = computeAlerts(checkIn, checkOut, entry?.mealStart || "", entry?.mealEnd || "", p.required_check_in || "", p.required_check_out || "", false, null, monthlyGraceMinutes, p.working_hours);
        if (alerts.some(isPenalizedLateAlert)) late++;
      }
      const absent = Math.max(0, workingDays - present);
      const pct = workingDays > 0 ? Math.round((present / workingDays) * 100) : 100;
      const status = pct >= 90 ? "Good" : pct >= 70 ? "Warning" : "Poor";
      return { profileId: p.id, name: p.display_name || p.email, workingDays, present, absent, late, pct, status };
    });
  }, [summaryProfiles, entriesByKey]);

  // ---- Custom-range summary — same shape as monthlySummary above, just
  // over whatever [customRangeStart, customRangeEnd] the user picked instead
  // of a fixed week/month-to-date window. ----
  const customSummary = useMemo(() => {
    if (!customRangeStart || !customRangeEnd || customRangeStart > customRangeEnd) return [];
    const start = new Date(customRangeStart + "T00:00:00");
    const end = new Date(customRangeEnd + "T00:00:00");
    return summaryProfiles.map((p) => {
      const offDays = new Set<number>(p.off_days ?? []);
      let workingDays = 0;
      let present = 0;
      let late = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = toISODate(d);
        if (iso > todayISO) break; // don't count days that haven't happened yet as absences
        const dow = d.getDay();
        if (offDays.has(dow)) continue;
        workingDays++;
        const entry = customEntriesByKey.get(`${p.id}|${iso}`);
        const checkIn = entry?.checkIn || "";
        const checkOut = entry?.checkOut || "";
        if (checkIn) present++;
        const alerts = computeAlerts(checkIn, checkOut, entry?.mealStart || "", entry?.mealEnd || "", p.required_check_in || "", p.required_check_out || "", false, null, ATTENDANCE_GRACE_MINUTES, p.working_hours);
        if (alerts.some((a) => a.includes("Late"))) late++;
      }
      const absent = Math.max(0, workingDays - present);
      const pct = workingDays > 0 ? Math.round((present / workingDays) * 100) : 100;
      const status = pct >= 90 ? "Good" : pct >= 70 ? "Warning" : "Poor";
      return { profileId: p.id, name: p.display_name || p.email, workingDays, present, absent, late, pct, status };
    });
  }, [summaryProfiles, customEntriesByKey, customRangeStart, customRangeEnd, todayISO]);

  // Day-by-day breakdown behind the Custom Attendance Summary's Present/
  // Absent/Late numbers — same day-iteration/off-day rules as customSummary
  // above, just returning one row per day instead of an aggregate count.
  // Only computed on demand (the modal is rarely open), so a plain function
  // rather than a memo.
  interface CustomDayDetail {
    date: string;
    checkIn: string;
    mealStart: string;
    mealEnd: string;
    checkOut: string;
    isLate: boolean;
  }
  const buildCustomDayDetails = (profileId: string): CustomDayDetail[] => {
    const p = summaryProfiles.find((pr) => pr.id === profileId);
    if (!p || !customRangeStart || !customRangeEnd || customRangeStart > customRangeEnd) return [];
    const offDays = new Set<number>(p.off_days ?? []);
    const start = new Date(customRangeStart + "T00:00:00");
    const end = new Date(customRangeEnd + "T00:00:00");
    const days: CustomDayDetail[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = toISODate(d);
      if (iso > todayISO) break;
      if (offDays.has(d.getDay())) continue;
      const entry = customEntriesByKey.get(`${p.id}|${iso}`);
      const checkIn = entry?.checkIn || "";
      const checkOut = entry?.checkOut || "";
      const mealStart = entry?.mealStart || "";
      const mealEnd = entry?.mealEnd || "";
      const alerts = computeAlerts(checkIn, checkOut, mealStart, mealEnd, p.required_check_in || "", p.required_check_out || "", false, null, ATTENDANCE_GRACE_MINUTES, p.working_hours);
      days.push({ date: iso, checkIn, mealStart, mealEnd, checkOut, isLate: alerts.some((a) => a.includes("Late")) });
    }
    return days;
  };

  // ---- Warnings tab: month-to-date late counts, tardiest first ----
  const warnEmployees = useMemo(() => {
    const q = warnSearch.trim().toLowerCase();
    return monthlySummary
      .filter((row) => !q || row.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => b.late - a.late || a.name.localeCompare(b.name));
  }, [monthlySummary, warnSearch]);

  const handleSubmitWarning = async () => {
    if (!warnTarget) return;
    if (!warnText.trim()) {
      alert("Please enter a warning note.");
      return;
    }
    setWarnSaving(true);
    try {
      // Always routes through HR review, even for HR/Admin/Superadmin
      // submitters — unlike CsrAgentDetailPage, tardiness warnings issued
      // here should never auto-approve themselves.
      await addAgentNote({
        agentProfileId: warnTarget.profileId,
        type: "warning",
        note: warnText.trim(),
      });
      setConductNotes(await getAllAgentNotes().catch(() => conductNotes));
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "Admin",
        action: "conduct_warning_submitted",
        targetType: "profile",
        targetId: warnTarget.profileId,
        targetLabel: warnTarget.name,
        details: { note: warnText.trim() },
      });
      setWarnTarget(null);
      setWarnText("");
    } catch (error) {
      alert(`Failed to submit warning: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setWarnSaving(false);
    }
  };

  const handleDownloadSummary = () => {
    const today = dailyDate;
    let csvContent = "Attendance Summary Report\n";
    csvContent += `Date: ${today}\n\n`;
    csvContent += "Key Metrics\n";
    csvContent += `Total Employees,${totalEmployees}\n`;
    csvContent += `Present ${dailyDateLabel},${presentToday}\n`;
    csvContent += `Absent ${dailyDateLabel},${absentToday}\n`;
    csvContent += `Late ${dailyDateLabel},${lateToday}\n\n`;
    csvContent += "Daily Attendance Tracker\n";
    csvContent += "Employee Name,Location,Department,Manager,Check In,Meal In,Meal Out,Check Out,Alerts,Notes\n";
    dailyRecords.forEach((record) => {
      const alerts = record.alerts.join("; ");
      const notes = notesData[record.profileId]?.content || "";
      csvContent += `"${record.name}","${record.location}","${record.department}","${record.manager}","${record.checkIn}","${record.mealIn}","${record.mealOut}","${record.checkOut}","${alerts}","${notes}"\n`;
    });
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent));
    element.setAttribute("download", `attendance-summary-${today}.csv`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleSaveNote = async () => {
    if (!canManageNotes) return;
    if (!selectedNote) return;
    const employee = allProfileById.get(selectedNote);
    setSavingNote(true);
    try {
      await upsertAttendanceNote({
        profileId: selectedNote,
        noteDate: todayISO,
        content: newNote,
        notifyIndividual,
        notifyTeamLead,
        createdBy: myProfileId,
      });
      setNotesData({ ...notesData, [selectedNote]: { content: newNote, notifyIndividual, notifyTeamLead } });
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "Admin",
        action: "attendance_note_saved",
        targetType: "profile",
        targetId: selectedNote,
        targetLabel: employee?.display_name || employee?.email || undefined,
        details: { note: newNote.trim() },
      });

      const warnings: string[] = [];
      const noteBody = newNote.trim();
      if (myProfileId && noteBody) {
        const senderName = displayName || "Admin";
        if (notifyIndividual) {
          const thread = await getOrCreateDmThread(myProfileId, selectedNote);
          await sendMessage({
            dmThreadId: thread.id,
            senderId: myProfileId,
            senderName,
            kind: "system",
            body: `📋 Attendance note for you (${todayISO}): ${noteBody}`,
          });
        }
        if (notifyTeamLead && employee) {
          const lead = await resolveTeamLeadOrManager(employee, profiles);
          if (lead && lead.id !== myProfileId) {
            const thread = await getOrCreateDmThread(myProfileId, lead.id);
            await sendMessage({
              dmThreadId: thread.id,
              senderId: myProfileId,
              senderName,
              kind: "system",
              body: `📋 Attendance note about ${employee.display_name || employee.email} (${todayISO}): ${noteBody}`,
            });
          } else if (!lead) {
            warnings.push(`Saved, but no team lead/manager could be found for ${employee.display_name || employee.email} — assign one on the CSR Team board or set their Manager on the user's profile.`);
          }
        }
      }
      setSelectedNote(null);
      if (warnings.length) alert(warnings.join("\n"));
    } catch (error) {
      alert(`Failed to save note: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSavingNote(false);
    }
  };

  // Manager proxy clock-in — only ever clocks IN a direct-report technician
  // (never out; that stays the technician's own action). Stamps the
  // technician's own branch-local time, not the manager's, and records
  // clocked_in_by so the row visibly shows it wasn't a self-punch.
  const [clockingInIds, setClockingInIds] = useState<Set<string>>(new Set());
  const handleProxyClockIn = async (record: DailyRecord) => {
    if (!myProfileId) return;
    if (!window.confirm(`Clock in ${record.name} now?`)) return;
    setClockingInIds((prev) => new Set(prev).add(record.profileId));
    try {
      const branchTz = timezoneForBranch(record.location);
      const now = new Date();
      const hhmm = nowInTimezone(branchTz).hhmm;
      const seconds = String(now.getSeconds()).padStart(2, "0");
      await saveTimecardEntry(
        record.profileId,
        todayISO,
        { checkIn: `${hhmm}:${seconds}`, checkOut: "", mealStart: "", mealEnd: "", notes: "" },
        { clockedInBy: myProfileId }
      );
      await loadAll();
    } catch (error) {
      alert(`Failed to clock in: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setClockingInIds((prev) => {
        const next = new Set(prev);
        next.delete(record.profileId);
        return next;
      });
    }
  };

  const ptoFormCreatedAt = profiles.find((p) => p.id === ptoForm.profileId)?.created_at ?? null;
  // Sick Leave has no 1-year wait — it's available from day 1 — so the
  // vacation-PTO eligibility gate only applies to every other leave type.
  const ptoFormEligible = ptoForm.ptoType === "sick" || !ptoForm.profileId || isEligibleForPto(ptoFormHireDate, ptoFormCreatedAt);
  const ptoFormEligibleOn = ptoEligibleDate(ptoFormHireDate, ptoFormCreatedAt);

  const handleSubmitPtoRequest = async () => {
    if (!ptoForm.profileId || !ptoForm.startDate || !ptoForm.endDate) {
      alert("Please fill in employee, start date, and end date.");
      return;
    }
    if (ptoForm.ptoType !== "sick" && !isEligibleForPto(ptoFormHireDate, ptoFormCreatedAt)) {
      alert(`${profileName(ptoForm.profileId)} isn't eligible for PTO yet — employees need 1 year of tenure first. Eligible starting ${ptoFormEligibleOn}.`);
      return;
    }
    setSubmittingPto(true);
    try {
      const requester = profiles.find((p) => p.id === ptoForm.profileId) ?? null;
      const manager = requester ? await resolveTeamLeadOrManager(requester, profiles) : null;
      await createPtoRequest({
        profileId: ptoForm.profileId,
        ptoType: ptoForm.ptoType,
        startDate: ptoForm.startDate,
        endDate: ptoForm.endDate,
        reason: ptoForm.reason,
        requestedBy: myProfileId,
        managerId: manager?.id ?? null,
      });
      setPtoRequests(await getCompanyPtoRequests());
      setShowPtoForm(false);
      setPtoForm({ profileId: "", ptoType: "vacation", startDate: "", endDate: "", reason: "" });
    } catch (error) {
      alert(`Failed to submit PTO request: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSubmittingPto(false);
    }
  };

  const handlePtoStageAction = async (request: PtoRequestRow, stage: PtoStage, decision: "approved" | "rejected") => {
    setBusyPtoId(request.id);
    try {
      await reviewPtoStage(request, stage, decision, myProfileId || "", displayName || "Admin");
      setPtoRequests(await getCompanyPtoRequests());
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "Admin",
        action: decision === "approved" ? "pto_request_approved" : "pto_request_rejected",
        targetType: "pto_request",
        targetId: request.id,
        targetLabel: `${profileName(request.profileId)} (${request.startDate} – ${request.endDate})`,
        details: { stage, ptoType: request.ptoType },
      });
    } catch (error) {
      alert(`Failed to update PTO request: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyPtoId(null);
    }
  };

  const handleSubmitCorrection = async () => {
    if (!correctionForm.profileId || !correctionForm.workDate) {
      alert("Please select an employee and work date.");
      return;
    }
    const existing = entriesByKey.get(`${correctionForm.profileId}|${correctionForm.workDate}`);
    setSubmittingCorrection(true);
    try {
      const requester = profiles.find((p) => p.id === correctionForm.profileId) ?? null;
      const manager = requester ? await resolveTeamLeadOrManager(requester, profiles) : null;
      await createTimecardCorrection({
        profileId: correctionForm.profileId,
        workDate: correctionForm.workDate,
        originalCheckIn: existing?.checkIn || "",
        originalCheckOut: existing?.checkOut || "",
        correctedCheckIn: correctionForm.correctedCheckIn,
        correctedCheckOut: correctionForm.correctedCheckOut,
        originalMealStart: existing?.mealStart || "",
        originalMealEnd: existing?.mealEnd || "",
        correctedMealStart: correctionForm.correctedMealStart,
        correctedMealEnd: correctionForm.correctedMealEnd,
        reason: correctionForm.reason,
        requestedBy: myProfileId,
        managerId: manager?.id ?? null,
      });
      setCorrections(await getCompanyTimecardCorrections());
      setCorrectionHistory(await getCompanyTimecardCorrectionHistory());
      setShowCorrectionForm(false);
      setCorrectionForm({ profileId: "", workDate: "", correctedCheckIn: "", correctedCheckOut: "", correctedMealStart: "", correctedMealEnd: "", reason: "" });
    } catch (error) {
      alert(`Failed to submit correction: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const refreshCorrections = async () => {
    setCorrections(await getCompanyTimecardCorrections());
    setCorrectionHistory(await getCompanyTimecardCorrectionHistory());
  };

  const pendingEmployeeRequests = isFullRequestsAdmin ? employeeRequests.filter((r) => r.status === "pending") : [];

  const handleEmployeeRequestAction = async (id: string, status: EmployeeRequestStatus) => {
    try {
      await updateEmployeeRequestStatus(id, status, myProfileId, employeeRequestNote[id]);
      setEmployeeRequests(await getCompanyEmployeeRequests());
      setEmployeeRequestNote((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      alert(`Failed to update request: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleCorrectionStageAction = async (stage: CorrectionStage, decision: "approved" | "rejected") => {
    if (!selectedCorrection) return;
    setCorrectionStageBusy(true);
    try {
      await reviewCorrectionStage(
        selectedCorrection,
        stage,
        decision,
        myProfileId || "",
        displayName || "Reviewer",
        decision === "approved"
          ? {
              checkIn: correctionTimecardData.checkIn,
              checkOut: correctionTimecardData.checkOut,
              mealStart: correctionTimecardData.mealStart,
              mealEnd: correctionTimecardData.mealEnd,
            }
          : undefined
      );
      await refreshCorrections();
      setEntries(await getCompanyTimecardEntries(rangeStart, rangeEnd));
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "Reviewer",
        action: decision === "approved" ? "timecard_correction_approved" : "timecard_correction_rejected",
        targetType: "timecard_correction",
        targetId: selectedCorrection.id,
        targetLabel: `${profileName(selectedCorrection.profileId)} (${selectedCorrection.workDate})`,
        details: { stage },
      });
      setSelectedCorrection(null);
    } catch (error) {
      alert(`Failed to update correction: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setCorrectionStageBusy(false);
    }
  };

  // Attendance Corrections table's search + status filter. Status here is
  // the request's overall status (pending/approved/rejected) — distinct
  // from the per-stage manager/HR/Accounting badges shown alongside it,
  // which stay visible regardless of this filter. Also team-scoped, same
  // as visibleProfiles/visiblePtoRequests above — a manager-tier viewer
  // only ever sees corrections for their own team, never the whole company.
  const filteredCorrections = useMemo(() => {
    const q = correctionSearch.trim().toLowerCase();
    return corrections.filter((c) => {
      if (teamScopedIds !== null && !teamScopedIds.has(c.profileId)) return false;
      if (correctionStatusFilter !== "all" && c.status !== correctionStatusFilter) return false;
      if (correctionDepartmentFilter !== "all") {
        const p = allProfileById.get(c.profileId);
        if (!p || profileDepartment(p) !== correctionDepartmentFilter) return false;
      }
      if (q && !profileName(c.profileId).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [corrections, correctionSearch, correctionStatusFilter, correctionDepartmentFilter, profileName, teamScopedIds, allProfileById]);

  // Correction History panel — same team scoping as filteredCorrections
  // above, via each history entry's related correction's profileId.
  const visibleCorrectionHistory = useMemo(() => {
    if (teamScopedIds === null) return correctionHistory;
    return correctionHistory.filter((h) => {
      const related = corrections.find((c) => c.id === h.correctionId);
      return related ? teamScopedIds.has(related.profileId) : false;
    });
  }, [correctionHistory, corrections, teamScopedIds]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                {sub.title}
              </h1>
              <p className="text-sm text-muted-foreground">{sub.description}</p>
            </div>
            {/* Drives every "daily" scoped view on this page — the KPI
                cards above and the Daily Attendance Tracker table below —
                so HR/managers can review any earlier date from one control. */}
            <div className="flex items-center gap-2">
              {!isDailyDateToday && (
                <button
                  type="button"
                  onClick={() => setDailyDate(todayISO)}
                  className="text-xs px-2 py-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition"
                >
                  Jump to Today
                </button>
              )}
              <input
                type="date"
                value={dailyDate}
                max={todayISO}
                onChange={(e) => e.target.value && setDailyDate(e.target.value)}
                className="bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Total Employees</p>
                  <p className="text-2xl font-bold text-white mt-2">{loading ? "…" : totalEmployees}</p>
                </div>
                <Users className="h-8 w-8 text-blue-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Present {dailyDateLabel}</p>
                  <p className="text-2xl font-bold text-green-400 mt-2">{loading ? "…" : presentToday}</p>
                </div>
                <UserCheck className="h-8 w-8 text-green-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Absent {dailyDateLabel}</p>
                  <p className="text-2xl font-bold text-red-400 mt-2">{loading ? "…" : absentToday}</p>
                </div>
                <UserX className="h-8 w-8 text-red-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Late {dailyDateLabel}</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-2">{loading ? "…" : lateToday}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">PTO Pending</p>
                  <p className="text-2xl font-bold text-purple-400 mt-2">{loading ? "…" : ptoPendingApproval}</p>
                </div>
                <Calendar className="h-8 w-8 text-purple-400 opacity-50" />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-white/10 overflow-x-auto">
            {[
              { id: "daily-attendance", label: "Daily Attendance", Icon: Clock },
              { id: "pto-management", label: "PTO Management", Icon: Calendar },
              { id: "corrections", label: "Corrections", Icon: FileText },
              ...(isFullRequestsAdmin ? [{ id: "disputes-inquiries", label: "Disputes & Inquiries", Icon: MessageSquare }] : []),
              { id: "warnings", label: "Warnings", Icon: AlertTriangle },
            ].map(tab => {
              const Icon = tab.Icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-4 py-2 border-b-2 transition whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id ? "border-blue-500 text-blue-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          {activeTab === "daily-attendance" && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg p-4 backdrop-blur">
                  <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-400" />
                    Attendance Alerts
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      onClick={() => { setSelectedAlertType("missing-clockin"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-red-500/15 to-red-600/5 border border-red-500/40 rounded p-2 hover:border-red-500/60 hover:bg-red-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-red-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-red-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-red-300 truncate">Missing Clock In</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            <span className="text-xs font-bold text-red-300">{dailyRecords.filter(r => r.checkIn === "—" && !r.isOffDay).length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => { setSelectedAlertType("missing-clockout"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-yellow-500/15 to-yellow-600/5 border border-yellow-500/40 rounded p-2 hover:border-yellow-500/60 hover:bg-yellow-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-yellow-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-yellow-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-yellow-300 truncate">Missing Clock Out</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                            <span className="text-xs font-bold text-yellow-300">{dailyRecords.filter(r => r.checkOut === "—" && r.checkIn !== "—").length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => { setSelectedAlertType("late-arrival"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-orange-500/15 to-orange-600/5 border border-orange-500/40 rounded p-2 hover:border-orange-500/60 hover:bg-orange-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-orange-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-orange-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-orange-300 truncate">Late Arrival</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                            <span className="text-xs font-bold text-orange-300">{dailyRecords.filter(r => r.alerts.some(isPenalizedLateAlert)).length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                <button onClick={handleDownloadSummary} className="group relative px-4 py-3 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-lg transition shadow-lg hover:shadow-blue-500/50 flex flex-col items-center justify-center gap-1 h-fit min-w-fit">
                  <Download className="h-5 w-5 group-hover:scale-110 transition transform" />
                  <div className="text-xs font-semibold">Download</div>
                </button>
              </div>

              <ActivityLogPanel module="attendance-monitoring" title="Attendance Activity Log" />

              {/* Filters and Search for Daily */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Search Employee</label>
                    <input
                      type="text"
                      placeholder="Enter employee name..."
                      value={searchEmployee}
                      onChange={(e) => setSearchEmployee(e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Department</label>
                    <select value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                      <option value="all">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Location</label>
                    <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                      <option value="all">All Locations</option>
                      {locations.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">
                      Filter by Date Range
                      {dateRangeActive && (
                        <button type="button" onClick={clearDateRange} className="ml-2 text-blue-400 hover:text-blue-300 normal-case">
                          Clear
                        </button>
                      )}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={filterDateFrom}
                        max={filterDateTo || undefined}
                        onChange={(e) => setFilterDateFrom(e.target.value)}
                        className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                      />
                      <span className="text-slate-500 text-xs shrink-0">to</span>
                      <input
                        type="date"
                        value={filterDateTo}
                        min={filterDateFrom || undefined}
                        onChange={(e) => setFilterDateTo(e.target.value)}
                        className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={completeOnly}
                        onChange={(e) => setCompleteOnly(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-slate-800/50 accent-blue-500"
                      />
                      Complete only (Clock In &amp; Out)
                    </label>
                  </div>
                </div>
              </div>

              {/* Daily Attendance Table */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  {/* The single-date picker/Jump-to-Today control lives up in the
                      page header (drives the KPI cards too) — not duplicated
                      here. This heading just reflects whichever mode is active. */}
                  <h2 className="text-lg font-bold text-white">
                    {dateRangeActive
                      ? `Attendance — ${filterDateFrom} to ${filterDateTo}`
                      : `Daily Attendance Tracker — ${dailyDate}`}
                  </h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      {dateRangeActive && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Date</th>}
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Location</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Department</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Role</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check In</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check Out</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Alerts</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading || dailyDateLoading || (dateRangeActive && rangeFilterLoading) ? (
                      <tr><td colSpan={dateRangeActive ? 9 : 8} className="px-3 py-8 text-center text-slate-400">Loading attendance…</td></tr>
                    ) : filteredAndSortedData.length === 0 ? (
                      <tr><td colSpan={dateRangeActive ? 9 : 8} className="px-3 py-8 text-center text-slate-400">No employees match this filter.</td></tr>
                    ) : dailyDataByDepartment.map((group) => (
                      <Fragment key={group.department}>
                        <tr className="bg-white/[0.03]">
                          <td colSpan={dateRangeActive ? 9 : 8} className="px-3 py-2 text-xs font-bold text-blue-300 uppercase tracking-wide">
                            {group.department} <span className="text-slate-500 font-normal normal-case">({group.records.length})</span>
                          </td>
                        </tr>
                        {group.records.map((record) => (
                      <tr key={dateRangeActive ? `${record.profileId}|${record.date}` : record.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        {dateRangeActive && <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{record.date}</td>}
                        <td className="px-3 py-3 text-white font-medium relative">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${PRESENCE_DOT_CLASS[resolvePresenceStatus(allProfileById.get(record.profileId) ?? {})]}`}
                              title={PRESENCE_LABEL[resolvePresenceStatus(allProfileById.get(record.profileId) ?? {})]}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const key = dateRangeActive ? `${record.profileId}|${record.date}` : record.profileId;
                                setRequiredTimePopoverKey((cur) => (cur === key ? null : key));
                              }}
                              className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer text-left"
                            >
                              {record.name}
                            </button>
                          </span>
                          {requiredTimePopoverKey === (dateRangeActive ? `${record.profileId}|${record.date}` : record.profileId) && (
                            <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-white/10 bg-slate-800 p-3 shadow-xl">
                              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Scheduled Shift</p>
                              <p className="text-xs text-slate-200">
                                {record.requiredCheckIn && record.requiredCheckOut
                                  ? `${formatClockTime(record.requiredCheckIn)} – ${formatClockTime(record.requiredCheckOut)}`
                                  : "No schedule set"}
                              </p>
                              <a
                                href={`/employee/${record.profileId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-block text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
                              >
                                View full profile ↗
                              </a>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-300">{record.location || "—"}</td>
                        <td className="px-3 py-3 text-slate-300">{record.department || "—"}</td>
                        <td className="px-3 py-3 text-slate-300">{getRoleDepartmentBreakdown(record.role).roleLabel || "—"}</td>
                        <td className="px-3 py-3 text-slate-300">
                          {record.checkIn}
                          {record.clockedInBy && (
                            <span className="ml-1 text-xs text-amber-300/80" title="Clocked in by their manager, not themselves">
                              (by {record.clockedInBy})
                            </span>
                          )}
                          {(record.date ?? dailyDate) === todayISO && record.role === "TECHNICIAN" && record.checkIn === "—" && !record.isOffDay && (
                            <button
                              type="button"
                              disabled={clockingInIds.has(record.profileId)}
                              onClick={() => handleProxyClockIn(record)}
                              className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-green-500/20 hover:bg-green-500/30 disabled:opacity-50 text-green-300 text-xs font-semibold transition"
                            >
                              {clockingInIds.has(record.profileId) ? "Clocking in…" : "Clock In"}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-300">{record.checkOut}</td>
                        <td className="px-3 py-3">
                          {record.alerts.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {record.alerts.map((alert, i) => (
                                <span key={i} className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${getAlertColor(alert)}`}>
                                  {alert}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-green-400 text-xs font-semibold">✓ OK</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {canManageNotes ? (
                            <button type="button" onClick={() => { setSelectedNote(record.profileId); setNewNote(notesData[record.profileId]?.content || ""); setNotifyIndividual(notesData[record.profileId]?.notifyIndividual || false); setNotifyTeamLead(notesData[record.profileId]?.notifyTeamLead || false); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition">
                              <MessageSquare className="h-4 w-4" />
                              <span className="text-xs">{notesData[record.profileId] ? "Edit" : "Add"}</span>
                            </button>
                          ) : (
                            <span className="text-slate-500 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary View Toggle */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 mb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-300">View:</span>
                    <button
                      onClick={() => setSummaryView("weekly")}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${summaryView === "weekly" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                    >
                      Weekly
                    </button>
                    <button
                      onClick={() => setSummaryView("monthly")}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${summaryView === "monthly" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                    >
                      Monthly
                    </button>
                    <button
                      onClick={() => setSummaryView("custom")}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${summaryView === "custom" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                    >
                      Custom
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {summaryView === "weekly" && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-slate-400 uppercase">Day</span>
                        <select
                          value={weeklyDayFilter}
                          onChange={(e) => setWeeklyDayFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                          className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="all">All Days</option>
                          {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((label, i) => (
                            <option key={label} value={i}>{label}</option>
                          ))}
                        </select>
                        <select
                          value={weeklyStatusFilter}
                          onChange={(e) => setWeeklyStatusFilter(e.target.value as "all" | "present" | "absent")}
                          disabled={weeklyDayFilter === "all"}
                          title={weeklyDayFilter === "all" ? "Pick a day first" : undefined}
                          className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        >
                          <option value="all">Present or Absent</option>
                          <option value="present">Checked In</option>
                          <option value="absent">Absent</option>
                        </select>
                      </div>
                    )}
                    {summaryView === "custom" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={customRangeStart}
                          max={customRangeEnd || todayISO}
                          onChange={(e) => e.target.value && setCustomRangeStart(e.target.value)}
                          className="bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                        />
                        <span className="text-slate-500 text-sm">to</span>
                        <input
                          type="date"
                          value={customRangeEnd}
                          min={customRangeStart || undefined}
                          max={todayISO}
                          onChange={(e) => e.target.value && setCustomRangeEnd(e.target.value)}
                          className="bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                        />
                        {customRangeLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 uppercase">Department</span>
                      <select
                        value={summaryDepartmentFilter}
                        onChange={(e) => setSummaryDepartmentFilter(e.target.value)}
                        className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                      >
                        <option value="all">All Departments</option>
                        {departments.map((dept) => (
                          <option key={dept} value={dept}>{dept}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Weekly Attendance */}
              {summaryView === "weekly" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-white">Weekly Attendance Summary</h2>
                  {weeklyDayFilter !== "all" && weeklyStatusFilter !== "all" && (
                    <span className="text-xs text-slate-400">
                      {filteredWeeklySummary.length} {weeklyStatusFilter === "present" ? "checked in" : "absent"} on{" "}
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][weeklyDayFilter]}
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label, i) => (
                        <th
                          key={label}
                          className={`px-3 py-3 text-center text-xs font-semibold uppercase ${weeklyDayFilter === i ? "text-blue-300" : "text-slate-400"}`}
                        >
                          {label}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Total Days</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWeeklySummary.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                          No employees match this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredWeeklySummary.map((row) => (
                      <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${row.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {row.name}
                          </a>
                        </td>
                        {row.cells.map((cell, i) => (
                          <td key={i} className={`px-3 py-3 text-center text-xs ${weeklyDayFilter === i ? "bg-blue-500/5" : ""}`}>
                            {cell === "off" ? (
                              <span className="inline-block px-2 py-1 rounded bg-slate-700/50 text-slate-400">OFF</span>
                            ) : cell === "future" ? (
                              <span className="text-slate-600">—</span>
                            ) : cell === "present" ? (
                              <span className="inline-block px-2 py-1 rounded bg-green-500/20 text-green-300">✓</span>
                            ) : (
                              <span className="inline-block px-2 py-1 rounded bg-red-500/20 text-red-300">✗</span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.presentCount} / {row.workingDays}</td>
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.pct}%</td>
                      </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              )}

              {/* Monthly Attendance */}
              {summaryView === "monthly" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Monthly Attendance Summary (Month to Date)</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Total Days</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Present</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Absent</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Late</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySummary.map((row) => (
                      <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${row.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {row.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-300">{row.workingDays}</td>
                        <td className="px-3 py-3 text-center text-green-300 font-semibold">{row.present}</td>
                        <td className="px-3 py-3 text-center text-red-300 font-semibold">{row.absent}</td>
                        <td className="px-3 py-3 text-center text-yellow-300 font-semibold">{row.late}</td>
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.pct}%</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${row.status === "Good" ? "bg-green-500/20 text-green-300 border-green-500/30" : row.status === "Warning" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>{row.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}

              {/* Custom-range Attendance */}
              {summaryView === "custom" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">
                  Custom Attendance Summary {customRangeStart && customRangeEnd ? `(${customRangeStart} – ${customRangeEnd})` : ""}
                </h2>
                {!customRangeStart || !customRangeEnd || customRangeStart > customRangeEnd ? (
                  <p className="text-sm text-slate-400">Pick a valid start and end date above.</p>
                ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Total Days</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Present</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Absent</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Late</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customSummary.map((row) => (
                      <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${row.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {row.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-300">{row.workingDays}</td>
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => setCustomDetailModal({ profileId: row.profileId, name: row.name, type: "present" })}
                            disabled={row.present === 0}
                            className="text-green-300 font-semibold hover:underline disabled:no-underline disabled:cursor-default"
                          >
                            {row.present}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => setCustomDetailModal({ profileId: row.profileId, name: row.name, type: "absent" })}
                            disabled={row.absent === 0}
                            className="text-red-300 font-semibold hover:underline disabled:no-underline disabled:cursor-default"
                          >
                            {row.absent}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => setCustomDetailModal({ profileId: row.profileId, name: row.name, type: "late" })}
                            disabled={row.late === 0}
                            className="text-yellow-300 font-semibold hover:underline disabled:no-underline disabled:cursor-default"
                          >
                            {row.late}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.pct}%</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${row.status === "Good" ? "bg-green-500/20 text-green-300 border-green-500/30" : row.status === "Warning" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>{row.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
              )}
            </>
          )}

          {activeTab === "pto-management" && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button onClick={() => setShowPtoForm(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition">
                  + New PTO Request
                </button>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">PTO Requests</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Dates</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Days</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                    ) : visiblePtoRequests.filter(r => r.status === "pending").length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No pending PTO requests.</td></tr>
                    ) : visiblePtoRequests.filter(r => r.status === "pending").map((request) => (
                      <tr key={request.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">{profileName(request.profileId)}</td>
                        <td className="px-3 py-3 text-slate-300">{PTO_TYPE_LABELS[request.ptoType]}</td>
                        <td className="px-3 py-3 text-slate-300">{request.startDate} to {request.endDate}</td>
                        <td className="px-3 py-3 text-center text-slate-300">{Math.round(request.hoursRequested / 8)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              request.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : request.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              Manager: {request.managerStatus.charAt(0).toUpperCase() + request.managerStatus.slice(1)}
                              {request.managerReviewedBy ? ` — ${profileName(request.managerReviewedBy)}` : ""}
                            </span>
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              request.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : request.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              HR: {request.hrStatus.charAt(0).toUpperCase() + request.hrStatus.slice(1)}
                              {request.hrReviewedBy ? ` — ${profileName(request.hrReviewedBy)}` : ""}
                            </span>
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              request.accountingStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : request.accountingStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              Accounting: {request.accountingStatus.charAt(0).toUpperCase() + request.accountingStatus.slice(1)}
                              {request.accountingReviewedBy ? ` — ${profileName(request.accountingReviewedBy)}` : ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1.5">
                            {request.managerStatus === "pending" && canReviewPtoStage(request, "manager", myProfileId, role, extraRoles) && (
                              <div className="flex gap-1">
                                <span className="text-[10px] text-slate-500 self-center">Mgr:</span>
                                <button type="button" title="Approve as manager" onClick={() => handlePtoStageAction(request, "manager", "approved")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                                  {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                                </button>
                                <button type="button" title="Reject as manager" onClick={() => handlePtoStageAction(request, "manager", "rejected")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                                  {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                </button>
                              </div>
                            )}
                            {request.hrStatus === "pending" && canReviewPtoStage(request, "hr", myProfileId, role, extraRoles) && (
                              <div className="flex gap-1">
                                <span className="text-[10px] text-slate-500 self-center">HR:</span>
                                <button type="button" title="Approve as HR" onClick={() => handlePtoStageAction(request, "hr", "approved")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                                  {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                                </button>
                                <button type="button" title="Reject as HR" onClick={() => handlePtoStageAction(request, "hr", "rejected")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                                  {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                </button>
                              </div>
                            )}
                            {request.accountingStatus === "pending" && canReviewPtoStage(request, "accounting", myProfileId, role, extraRoles) && (
                              <div className="flex gap-1">
                                <span className="text-[10px] text-slate-500 self-center">Acct:</span>
                                <button type="button" title="Approve as Accounting" onClick={() => handlePtoStageAction(request, "accounting", "approved")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                                  {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                                </button>
                                <button type="button" title="Reject as Accounting" onClick={() => handlePtoStageAction(request, "accounting", "rejected")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                                  {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                </button>
                              </div>
                            )}
                            {!(request.managerStatus === "pending" && canReviewPtoStage(request, "manager", myProfileId, role, extraRoles)) &&
                             !(request.hrStatus === "pending" && canReviewPtoStage(request, "hr", myProfileId, role, extraRoles)) &&
                             !(request.accountingStatus === "pending" && canReviewPtoStage(request, "accounting", myProfileId, role, extraRoles)) && (
                              <span className="text-xs text-slate-500">{request.managerStatus === "pending" ? "Awaiting manager" : "Awaiting HR/Accounting"}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PTO History */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
                <h2 className="text-lg font-bold text-white mb-4">PTO History</h2>
                <div className="space-y-3">
                  {visiblePtoRequests.filter(r => r.status !== "pending").length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-slate-400 text-sm">No PTO history yet</p>
                    </div>
                  ) : visiblePtoRequests.filter(r => r.status !== "pending").map((request) => (
                    <div key={request.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{profileName(request.profileId)} - {PTO_TYPE_LABELS[request.ptoType]}</p>
                          <p className="text-xs text-slate-400 mt-1">{request.startDate} to {request.endDate}</p>
                          <p className="text-xs text-slate-500 mt-2">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${
                              request.status === "approved" ? "bg-green-500/20 text-green-300" : request.status === "denied" ? "bg-red-500/20 text-red-300" : "bg-slate-500/20 text-slate-300"
                            }`}>
                              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Manager: {request.managerStatus}{request.managerReviewedBy ? ` by ${profileName(request.managerReviewedBy)}` : ""}{request.managerReviewedAt ? ` on ${request.managerReviewedAt.slice(0, 10)}` : ""}
                          </p>
                          <p className="text-xs text-slate-500">
                            HR: {request.hrStatus}{request.hrReviewedBy ? ` by ${profileName(request.hrReviewedBy)}` : ""}{request.hrReviewedAt ? ` on ${request.hrReviewedAt.slice(0, 10)}` : ""}
                          </p>
                          <p className="text-xs text-slate-500">
                            Accounting: {request.accountingStatus}{request.accountingReviewedBy ? ` by ${profileName(request.accountingReviewedBy)}` : ""}{request.accountingReviewedAt ? ` on ${request.accountingReviewedAt.slice(0, 10)}` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "corrections" && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button onClick={() => setShowCorrectionForm(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition">
                  + New Correction Request
                </button>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Attendance Corrections</h2>
                <div className="grid gap-3 md:grid-cols-3 mb-4">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Search Employee</label>
                    <input
                      type="text"
                      placeholder="Enter employee name..."
                      value={correctionSearch}
                      onChange={(e) => setCorrectionSearch(e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Status</label>
                    <select
                      value={correctionStatusFilter}
                      onChange={(e) => setCorrectionStatusFilter(e.target.value as "all" | CorrectionStatus)}
                      className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="all">All Statuses</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Department</label>
                    <select
                      value={correctionDepartmentFilter}
                      onChange={(e) => setCorrectionDepartmentFilter(e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="all">All Departments</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Work Date</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Original Time</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Reason</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                    ) : filteredCorrections.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">{correctionSearch.trim() || correctionStatusFilter !== "all" || correctionDepartmentFilter !== "all" ? "No correction requests match your search/filter." : "No correction requests yet."}</td></tr>
                    ) : filteredCorrections.map((correction) => (
                      <tr key={correction.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${correction.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {profileName(correction.profileId)}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-slate-300">{correction.workDate}</td>
                        <td className="px-3 py-3 text-slate-300">{correction.originalCheckIn || "—"} → {correction.originalCheckOut || "—"}</td>
                        <td className="px-3 py-3 text-slate-300">{correction.reason || "—"}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              correction.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : correction.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              Manager: {correction.managerStatus.charAt(0).toUpperCase() + correction.managerStatus.slice(1)}
                            </span>
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              correction.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : correction.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              HR: {correction.hrStatus.charAt(0).toUpperCase() + correction.hrStatus.slice(1)}
                            </span>
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              correction.accountingStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : correction.accountingStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              Accounting: {correction.accountingStatus.charAt(0).toUpperCase() + correction.accountingStatus.slice(1)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {correction.status === "pending" ? (
                            <button onClick={() => { setSelectedCorrection(correction); setCorrectionTimecardData({ checkIn: correction.correctedCheckIn || correction.originalCheckIn, checkOut: correction.correctedCheckOut || correction.originalCheckOut, mealStart: correction.correctedMealStart || correction.originalMealStart, mealEnd: correction.correctedMealEnd || correction.originalMealEnd }); }} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition flex items-center gap-1">
                              View Timecard
                            </button>
                          ) : (
                            <span className="text-slate-400 text-xs">{correction.status === "approved" ? "Approved" : "Rejected"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Correction History */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
                <h2 className="text-lg font-bold text-white mb-4">Correction History</h2>
                <div className="space-y-3">
                  {visibleCorrectionHistory.length > 0 ? (
                    visibleCorrectionHistory.map((history) => {
                      const relatedCorrection = corrections.find(c => c.id === history.correctionId);
                      return (
                        <div key={history.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-white capitalize">{history.action}</p>
                              <p className="text-xs text-slate-400 mt-1">Changed by <span className="text-slate-300">{profileName(history.changedBy)}</span> on {new Date(history.createdAt).toLocaleString()}</p>
                              {relatedCorrection && (
                                <p className="text-xs text-slate-400 mt-2">
                                  Employee: <span className="text-slate-300 font-semibold">{profileName(relatedCorrection.profileId)}</span> |
                                  Date: <span className="text-slate-300">{relatedCorrection.workDate}</span> |
                                  Original: <span className="text-slate-300">{relatedCorrection.originalCheckIn || "—"} → {relatedCorrection.originalCheckOut || "—"}</span> →
                                  Corrected: <span className="text-slate-300 font-semibold">{relatedCorrection.correctedCheckIn || "—"} → {relatedCorrection.correctedCheckOut || "—"}</span>
                                </p>
                              )}
                              {history.previousStatus && (
                                <p className="text-xs text-slate-500 mt-2">
                                  Status: <span className="font-semibold text-slate-300">{history.previousStatus}</span> →
                                  <span className="font-semibold text-slate-300"> {history.newStatus}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-slate-400 text-sm">No correction history yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "disputes-inquiries" && isFullRequestsAdmin && (
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Pending Disputes / Inquiries</p>
                <p className="text-2xl font-bold text-yellow-300">{pendingEmployeeRequests.length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Attendance Disputes &amp; Payroll Inquiries — Pending</h3>
                {pendingEmployeeRequests.length === 0 ? (
                  <p className="text-sm text-slate-400">No pending disputes or inquiries.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingEmployeeRequests.map((r) => (
                      <div key={r.id} className="border border-white/10 rounded-lg p-3">
                        <p className="text-sm font-semibold text-white">
                          {profileName(r.profileId)} — {r.requestType === "attendance_dispute" ? "Attendance Dispute" : "Payroll Inquiry"}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">Submitted: {r.createdAt.slice(0, 10)}</p>
                        <p className="text-sm text-slate-300 mt-2">{r.details}</p>
                        <textarea
                          placeholder="Optional response note (visible to the employee)..."
                          value={employeeRequestNote[r.id] || ""}
                          onChange={(e) => setEmployeeRequestNote({ ...employeeRequestNote, [r.id]: e.target.value })}
                          rows={2}
                          className="w-full mt-2 px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
                        />
                        <div className="flex gap-2 mt-2">
                          {r.requestType === "attendance_dispute" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEmployeeRequestAction(r.id, "approved")}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEmployeeRequestAction(r.id, "rejected")}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition"
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleEmployeeRequestAction(r.id, "closed")}
                              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs font-semibold transition"
                            >
                              Respond &amp; Close
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "warnings" && (
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-400" />
                      Tardy Employees — Month to Date
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">Issue a warning for repeated tardiness — it goes to the same review queue as HR's Warnings &amp; Mistakes tab.</p>
                  </div>
                  <input
                    type="text"
                    placeholder="Search employee..."
                    value={warnSearch}
                    onChange={(e) => setWarnSearch(e.target.value)}
                    className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none w-56"
                  />
                </div>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Late (MTD)</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                    ) : warnEmployees.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No employees match this search.</td></tr>
                    ) : warnEmployees.map((row) => (
                      <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${row.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {row.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${row.late === 0 ? "text-slate-500" : row.late <= 2 ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-red-500/20 text-red-300 border border-red-500/30"}`}>
                            {row.late}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.pct}%</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${row.status === "Good" ? "bg-green-500/20 text-green-300 border-green-500/30" : row.status === "Warning" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>{row.status}</span>
                        </td>
                        <td className="px-3 py-3">
                          {canWarn ? (
                            <button
                              type="button"
                              onClick={() => { setWarnTarget({ profileId: row.profileId, name: row.name }); setWarnText(row.late > 0 ? `Repeated tardiness — ${row.late} late arrival${row.late === 1 ? "" : "s"} this month.` : ""); }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 transition"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span className="text-xs">Warn</span>
                            </button>
                          ) : (
                            <span className="text-slate-500 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Recent Warnings & Mistakes — same employee_conduct_notes table HR reviews */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400" /> Recent Warnings &amp; Mistakes
                </h2>
                {conductNotes.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">No warnings or mistakes on file yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Note</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conductNotes.slice(0, 15).map((n) => (
                        <tr key={n.id} className="border-b border-white/5 hover:bg-white/5 transition">
                          <td className="px-3 py-3 text-white font-medium">
                            <a href={`/employee/${n.agentProfileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                              {profileName(n.agentProfileId)}
                            </a>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                              {n.type === "warning" ? "Warning" : "Mistake"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-slate-300 max-w-xs truncate" title={n.note}>{n.note}</td>
                          <td className="px-3 py-3 text-slate-400 text-xs">{new Date(n.createdAt).toLocaleString()}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${n.status === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30" : n.status === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}>
                              {n.status === "approved" ? "Approved" : n.status === "rejected" ? "Rejected" : n.status === "manager_approved" ? "Awaiting HR" : "Pending"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Warning Modal */}
        {warnTarget && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-400" /> Issue Warning
                  </h3>
                  <p className="text-sm text-slate-400">{warnTarget.name}</p>
                </div>
                <button type="button" onClick={() => { setWarnTarget(null); setWarnText(""); }} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">Warning Note</label>
                <textarea value={warnText} onChange={(e) => setWarnText(e.target.value)} placeholder="Describe the tardiness / conduct issue..." rows={4} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none" />
              </div>
              <p className="text-xs text-slate-500 mb-4">
                This always goes to the HR Warnings &amp; Mistakes dashboard for review before it's issued — the employee is only notified once it's approved there.
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={handleSubmitWarning} disabled={warnSaving} className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm">
                  {warnSaving ? "Submitting…" : "Submit for Review"}
                </button>
                <button type="button" onClick={() => { setWarnTarget(null); setWarnText(""); }} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Notes Modal */}
        {selectedNote && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">{profileName(selectedNote)}</h3>
                  <p className="text-sm text-slate-400">{todayISO}</p>
                </div>
                <button onClick={() => setSelectedNote(null)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">Add Note</label>
                <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add note for this employee..." className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none" rows={4} />
              </div>
              <div className="space-y-3 mb-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={notifyIndividual} onChange={(e) => setNotifyIndividual(e.target.checked)} className="rounded border border-white/20 w-4 h-4 accent-blue-500" />
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-blue-400" />
                    <span className="text-sm text-slate-300">Notify Individual</span>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={notifyTeamLead} onChange={(e) => setNotifyTeamLead(e.target.checked)} className="rounded border border-white/20 w-4 h-4 accent-blue-500" />
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-orange-400" />
                    <span className="text-sm text-slate-300">Notify Team Lead</span>
                  </div>
                </label>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSaveNote} disabled={savingNote} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm">{savingNote ? "Saving…" : "Save Note"}</button>
                <button onClick={() => setSelectedNote(null)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* New PTO Request Modal */}
        {showPtoForm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-bold text-white">New PTO Request</h3>
                <button onClick={() => setShowPtoForm(false)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="space-y-3 mb-6">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Employee</label>
                  <select value={ptoForm.profileId} onChange={(e) => setPtoForm({ ...ptoForm, profileId: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">Select employee</option>
                    {visibleProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                    ))}
                  </select>
                  {ptoForm.profileId && ptoForm.ptoType !== "sick" && !ptoFormEligible && (
                    <p className="text-xs text-amber-300 mt-1">
                      Not yet eligible for PTO — needs 1 year of tenure first (eligible starting {ptoFormEligibleOn}).
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Type</label>
                  <select value={ptoForm.ptoType} onChange={(e) => setPtoForm({ ...ptoForm, ptoType: e.target.value as PtoType })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                    {(Object.keys(PTO_TYPE_LABELS) as PtoType[]).map((t) => (
                      <option key={t} value={t}>{PTO_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Start Date</label>
                    <input type="date" value={ptoForm.startDate} onChange={(e) => setPtoForm({ ...ptoForm, startDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">End Date</label>
                    <input type="date" value={ptoForm.endDate} onChange={(e) => setPtoForm({ ...ptoForm, endDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Reason</label>
                  <textarea value={ptoForm.reason} onChange={(e) => setPtoForm({ ...ptoForm, reason: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSubmitPtoRequest}
                  disabled={!ptoFormEligible || submittingPto}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition font-semibold text-sm"
                >
                  {submittingPto ? "Submitting…" : "Submit"}
                </button>
                <button onClick={() => setShowPtoForm(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* New Correction Request Modal */}
        {showCorrectionForm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-bold text-white">New Correction Request</h3>
                <button onClick={() => setShowCorrectionForm(false)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="space-y-3 mb-6">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Employee</label>
                  <select value={correctionForm.profileId} onChange={(e) => setCorrectionForm({ ...correctionForm, profileId: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">Select employee</option>
                    {visibleProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Work Date</label>
                  <input type="date" value={correctionForm.workDate} onChange={(e) => setCorrectionForm({ ...correctionForm, workDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  {correctionForm.profileId && correctionForm.workDate && (
                    <p className="text-xs text-slate-500 mt-1">
                      {(() => {
                        const existing = entriesByKey.get(`${correctionForm.profileId}|${correctionForm.workDate}`);
                        return existing
                          ? `Current record: ${existing.checkIn || "—"} → ${existing.checkOut || "—"} (meal: ${existing.mealStart || "—"} → ${existing.mealEnd || "—"})`
                          : "No existing record found for this date.";
                      })()}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Check In</label>
                    <input type="time" step="1" title="Corrected Check In" value={correctionForm.correctedCheckIn} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedCheckIn: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Check Out</label>
                    <input type="time" step="1" title="Corrected Check Out" value={correctionForm.correctedCheckOut} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedCheckOut: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Meal Start</label>
                    <input type="time" step="1" title="Corrected Meal Start" value={correctionForm.correctedMealStart} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedMealStart: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Meal End</label>
                    <input type="time" step="1" title="Corrected Meal End" value={correctionForm.correctedMealEnd} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedMealEnd: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Reason</label>
                  <textarea value={correctionForm.reason} onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSubmitCorrection} disabled={submittingCorrection} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm">{submittingCorrection ? "Submitting…" : "Submit"}</button>
                <button onClick={() => setShowCorrectionForm(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Timecard Correction Modal */}
        {selectedCorrection && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Timecard Correction</h2>
                  <p className="text-sm text-slate-400 mt-1">Employee: <a href={`/employee/${selectedCorrection.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">{profileName(selectedCorrection.profileId)}</a></p>
                  <p className="text-sm text-slate-400">Work Date: {selectedCorrection.workDate}</p>
                </div>
                <button onClick={() => setSelectedCorrection(null)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>

              {/* Timecard Details */}
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-4">Clock Times</h3>
                <p className="text-sm text-slate-400 mb-3">Original: <span className="text-base text-slate-200 font-semibold">{selectedCorrection.originalCheckIn || "—"} → {selectedCorrection.originalCheckOut || "—"}</span></p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check In</label>
                    <input type="time" step="1" title="Check In" value={correctionTimecardData.checkIn} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, checkIn: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check Out</label>
                    <input type="time" step="1" title="Check Out" value={correctionTimecardData.checkOut} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, checkOut: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                {(selectedCorrection.correctedMealStart || selectedCorrection.correctedMealEnd || selectedCorrection.originalMealStart || selectedCorrection.originalMealEnd) && (
                  <>
                    <p className="text-xs text-slate-400 mt-4 mb-3">Original Meal: {selectedCorrection.originalMealStart || "—"} → {selectedCorrection.originalMealEnd || "—"}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-xs text-slate-400 uppercase mb-2">Meal Start</label>
                        <input type="time" step="1" title="Meal Start" value={correctionTimecardData.mealStart} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, mealStart: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 uppercase mb-2">Meal End</label>
                        <input type="time" step="1" title="Meal End" value={correctionTimecardData.mealEnd} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, mealEnd: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Correction Details */}
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-4">Correction Details</h3>
                <div className="space-y-2">
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Reason:</span> {selectedCorrection.reason || "—"}</p>
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Requested:</span> {new Date(selectedCorrection.createdAt).toLocaleString()}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${selectedCorrection.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30" : selectedCorrection.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"}`}>
                      Manager: {selectedCorrection.managerStatus}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${selectedCorrection.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30" : selectedCorrection.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"}`}>
                      HR: {selectedCorrection.hrStatus}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${selectedCorrection.accountingStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30" : selectedCorrection.accountingStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"}`}>
                      Accounting: {selectedCorrection.accountingStatus}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons — the manager reviews first; HR/Accounting only
                  unlock once the manager has approved, and either one alone
                  is enough for final approval. */}
              <div className="space-y-2 mb-6">
                {selectedCorrection.managerStatus === "pending" && canReviewCorrectionStage(selectedCorrection, "manager", myProfileId, role, extraRoles) && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <button onClick={() => handleCorrectionStageAction("manager", "approved")} disabled={correctionStageBusy} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                      {correctionStageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Approve as Manager
                    </button>
                    <button onClick={() => handleCorrectionStageAction("manager", "rejected")} disabled={correctionStageBusy} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                      {correctionStageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Reject as Manager
                    </button>
                  </div>
                )}
                {selectedCorrection.hrStatus === "pending" && canReviewCorrectionStage(selectedCorrection, "hr", myProfileId, role, extraRoles) && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <button onClick={() => handleCorrectionStageAction("hr", "approved")} disabled={correctionStageBusy} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                      {correctionStageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Approve as HR
                    </button>
                    <button onClick={() => handleCorrectionStageAction("hr", "rejected")} disabled={correctionStageBusy} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                      {correctionStageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Reject as HR
                    </button>
                  </div>
                )}
                {selectedCorrection.accountingStatus === "pending" && canReviewCorrectionStage(selectedCorrection, "accounting", myProfileId, role, extraRoles) && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <button onClick={() => handleCorrectionStageAction("accounting", "approved")} disabled={correctionStageBusy} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                      {correctionStageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Approve as Accounting
                    </button>
                    <button onClick={() => handleCorrectionStageAction("accounting", "rejected")} disabled={correctionStageBusy} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                      {correctionStageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Reject as Accounting
                    </button>
                  </div>
                )}
                {!(selectedCorrection.managerStatus === "pending" && canReviewCorrectionStage(selectedCorrection, "manager", myProfileId, role, extraRoles)) &&
                 !(selectedCorrection.hrStatus === "pending" && canReviewCorrectionStage(selectedCorrection, "hr", myProfileId, role, extraRoles)) &&
                 !(selectedCorrection.accountingStatus === "pending" && canReviewCorrectionStage(selectedCorrection, "accounting", myProfileId, role, extraRoles)) && (
                  <p className="text-xs text-slate-500">
                    {selectedCorrection.managerStatus === "pending" ? "Awaiting manager review." : "Awaiting HR or Accounting review."}
                  </p>
                )}
              </div>

              {/* Correction History for this item */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-bold text-white mb-3">This Correction's History</h3>
                <div className="space-y-2">
                  {correctionHistory.filter(h => h.correctionId === selectedCorrection.id).length > 0 ? (
                    correctionHistory.filter(h => h.correctionId === selectedCorrection.id).map((history) => (
                      <div key={history.id} className="bg-slate-700/30 border border-white/5 rounded p-3 text-xs">
                        <p className="text-slate-300 capitalize">{history.action} by <span className="font-semibold text-white">{profileName(history.changedBy)}</span></p>
                        <p className="text-slate-500">{new Date(history.createdAt).toLocaleString()}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 text-xs">No history yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alert Details Modal */}
        {alertModalOpen && selectedAlertType && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setAlertModalOpen(false)}>
            <div className="bg-slate-900 border border-white/10 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-lg font-bold text-white">
                  {selectedAlertType === "missing-clockin" && "Missing Clock In"}
                  {selectedAlertType === "missing-clockout" && "Missing Clock Out"}
                  {selectedAlertType === "late-arrival" && "Late Arrival"}
                </h2>
                <button
                  onClick={() => setAlertModalOpen(false)}
                  className="p-1 hover:bg-white/10 rounded transition"
                >
                  <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-3">
                  {selectedAlertType === "missing-clockin" && dailyRecords.filter(r => r.checkIn === "—" && !r.isOffDay).map(record => (
                    <div key={record.profileId} className="bg-slate-800/50 border border-red-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department || "—"} • {record.location || "—"}</p>
                          <p className="text-xs text-slate-500 mt-2">Manager: {record.manager || "—"}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-red-500/20 text-red-300 text-xs font-semibold rounded border border-red-500/40">
                            No Clock In
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {selectedAlertType === "missing-clockout" && dailyRecords.filter(r => r.checkOut === "—" && r.checkIn !== "—").map(record => (
                    <div key={record.profileId} className="bg-slate-800/50 border border-yellow-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department || "—"} • {record.location || "—"}</p>
                          <p className="text-xs text-slate-400 mt-2">Clock In: <span className="font-mono font-semibold">{record.checkIn}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Manager: {record.manager || "—"}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-yellow-500/20 text-yellow-300 text-xs font-semibold rounded border border-yellow-500/40">
                            No Clock Out
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {selectedAlertType === "late-arrival" && dailyRecords.filter(r => r.alerts.some(isPenalizedLateAlert)).map(record => (
                    <div key={record.profileId} className="bg-slate-800/50 border border-orange-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department || "—"} • {record.location || "—"}</p>
                          <p className="text-xs text-slate-400 mt-2">Check In: <span className="font-mono font-semibold">{record.checkIn}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Manager: {record.manager || "—"}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-orange-500/20 text-orange-300 text-xs font-semibold rounded border border-orange-500/40">
                            Late
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-white/10 px-6 py-4">
                <button
                  onClick={() => setAlertModalOpen(false)}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Attendance Summary — per-employee day-by-day detail behind
            the Present/Absent/Late counts. */}
        {customDetailModal && (() => {
          const allDays = buildCustomDayDetails(customDetailModal.profileId);
          const days =
            customDetailModal.type === "present"
              ? allDays.filter((d) => d.checkIn)
              : customDetailModal.type === "late"
                ? allDays.filter((d) => d.checkIn && d.isLate)
                : allDays.filter((d) => !d.checkIn);
          const typeLabel = customDetailModal.type === "present" ? "Present" : customDetailModal.type === "late" ? "Late" : "Absent";
          const badgeClass =
            customDetailModal.type === "present"
              ? "bg-green-500/20 text-green-300 border-green-500/40"
              : customDetailModal.type === "late"
                ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
                : "bg-red-500/20 text-red-300 border-red-500/40";
          const fmtDay = (iso: string) =>
            new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          return (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setCustomDetailModal(null)}>
              <div className="bg-slate-900 border border-white/10 rounded-lg max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                  <div>
                    <h2 className="text-lg font-bold text-white">{customDetailModal.name}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">{typeLabel} — {customRangeStart} – {customRangeEnd}</p>
                  </div>
                  <button onClick={() => setCustomDetailModal(null)} className="p-1 hover:bg-white/10 rounded transition">
                    <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {days.length === 0 ? (
                    <p className="text-sm text-slate-400">No days to show.</p>
                  ) : customDetailModal.type === "absent" ? (
                    <div className="space-y-2">
                      {days.map((d) => (
                        <div key={d.date} className="flex items-center justify-between bg-slate-800/50 border border-red-500/30 rounded-lg px-4 py-3">
                          <span className="text-white font-medium">{fmtDay(d.date)}</span>
                          <span className={`inline-block px-3 py-1 text-xs font-semibold rounded border ${badgeClass}`}>Absent</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {days.map((d) => (
                        <div key={d.date} className="bg-slate-800/50 border border-white/10 rounded-lg px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white font-medium">{fmtDay(d.date)}</span>
                            {d.isLate && (
                              <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${badgeClass}`}>Late</span>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-center text-xs">
                            <div>
                              <p className="text-slate-500 uppercase text-[10px] mb-1">Time In</p>
                              <p className="text-slate-200 font-mono">{d.checkIn || "—"}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 uppercase text-[10px] mb-1">Meal In</p>
                              <p className="text-slate-200 font-mono">{d.mealStart || "—"}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 uppercase text-[10px] mb-1">Meal Out</p>
                              <p className="text-slate-200 font-mono">{d.mealEnd || "—"}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 uppercase text-[10px] mb-1">Time Out</p>
                              <p className="text-slate-200 font-mono">{d.checkOut || "—"}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t border-white/10 px-6 py-4">
                  <button
                    onClick={() => setCustomDetailModal(null)}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
