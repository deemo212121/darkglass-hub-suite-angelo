import { ChevronLeft, Compass, DollarSign, Clock, ListTodo, Download, Eye, EyeOff, TrendingUp, AlertCircle, CheckCircle2, XCircle, Plus, FileText, X, Paperclip, Receipt, Pencil, Trash2, Loader2 } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { runTour, takeQueuedTour } from "@/lib/tours/runTour";
import { SELF_SERVICE_TOUR, SELF_SERVICE_TOUR_TARGET } from "@/lib/tours/selfServiceTour";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { LOCATIONS } from "@/lib/locations";
import {
  type AttendanceRow,
  getAttendanceForRange,
  getMyProfileSchedule,
  getEntryForDate,
  splitRegularOvertimeWeekly,
  CSR_WEEKLY_OVERTIME_THRESHOLD,
} from "@/lib/supabase/timecards";
import { getCompanyHolidaysInRange } from "@/lib/supabase/companyHolidays";
import { getPendingCorrectionsInRange } from "@/lib/supabase/timecardCorrections";
import {
  getCompanyPtoRequests,
  createPtoRequest,
  isEligibleForPto,
  ptoEligibleDate,
  ptoYearWindow,
  ptoDaysUsed,
  ptoRequestsInYear,
  sickYearWindow,
  sickRequestsInYear,
  workingDayCount,
  setPtoAttachmentUrl,
  type PtoRequestRow,
  type PtoType,
} from "@/lib/supabase/pto";
import { uploadPtoRequestAttachment, deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import {
  getCompanyTimecardCorrections,
  createTimecardCorrection,
  validateCorrectionTimes,
  correctionShiftMinutes,
  formatShift,
  CORRECTION_MEAL_REQUIRED_AFTER_MINUTES,
  validateSelfCorrectionDate,
  selfCorrectionEarliestDate,
  getSelfCorrectionWindow,
  type SelfCorrectionWindow,
  type TimecardCorrectionRow,
} from "@/lib/supabase/timecardCorrections";
import { zonedDateKey } from "@/lib/serverTime";
import { buildCorrectionSubmissionPdf } from "@/lib/timecardCorrectionPdf";
import { buildPtoSubmissionPdf } from "@/lib/ptoExceptionReportPdf";
import { EXCEPTION_TYPE_LABELS, CORRECTION_ISSUE_LABELS, isCorrectionIssueType, type ExceptionType, type CorrectionIssueType } from "@/lib/exceptionVisitReportTemplate";
import { getRoleDepartmentBreakdown, normalizeRole } from "@/lib/roleLabels";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import {
  getCompanyEmployeeRequests,
  createEmployeeRequest,
  type EmployeeRequestRow,
} from "@/lib/supabase/employeeRequests";
import { getCompanyUsers, getProfileEmployeeInfo, type ProfileRow } from "@/lib/supabase/users";
import { createNotification } from "@/lib/supabase/notifications";
import { resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import { getMyPayslips, type MyPayslipRow } from "@/lib/supabase/payslips";
import { getMyPayrollNotes, acknowledgePayrollNote, type PayrollNote } from "@/lib/supabase/payrollNotes";
import { MyPayDetails } from "@/components/MyPayDetails";
import { getProfileExpenses, deleteExpense, reimbursementTypeLabel, type ExpenseRow } from "@/lib/supabase/expenses";
import { ExpenseFormModal } from "@/components/ExpenseFormModal";
import { ReceiptLightbox } from "@/components/ReceiptLightbox";
import { fmtExpenseReviewedAt } from "@/components/ExpenseTrackingPage";
import { ROLE_LABELS } from "@/lib/roleLabels";
import {
  formatClockTime,
  offDaysInRange,
  ptoDaysInRange,
  renderPayslipFullHtml,
  type PayslipDailyRow,
  type EmployeePayslipData,
} from "@/lib/payslipTemplate";

interface AttendanceRecord {
  date: string;
  clockIn: string;
  clockOut: string;
  hoursWorked: number;
  status: "completed" | "pending";
}

interface LoginLogoutRecord {
  date: string;
  time: string;
  type: "login" | "logout";
}

interface Request {
  id: string;
  type: string;
  status: "pending" | "approved" | "rejected" | "closed" | "modified";
  submittedDate: string;
  details: string;
  /** Why it was rejected — "Rejected by <name> (<step>): <reason>" lines, shown in a red box. */
  rejectionReason?: string | null;
}

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EXPENSE_STATUS_STYLE: Record<ExpenseRow["status"], string> = {
  Pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  Approved: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  Reimbursed: "bg-green-500/20 text-green-300 border-green-500/30",
  Rejected: "bg-red-500/20 text-red-300 border-red-500/30",
};
const EXPENSE_STATUS_LABEL: Record<ExpenseRow["status"], string> = {
  Pending: "In Review",
  Approved: "Approved — to be paid",
  Reimbursed: "Reimbursed",
  Rejected: "Rejected",
};

const PTO_TYPE_LABEL: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick Leave",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};


const ATTENDANCE_DAILY: AttendanceRecord[] = [
  { date: "2026-06-04", clockIn: "8:00 AM", clockOut: "5:00 PM", hoursWorked: 9, status: "completed" },
  { date: "2026-06-03", clockIn: "7:55 AM", clockOut: "5:15 PM", hoursWorked: 9.33, status: "completed" },
  { date: "2026-06-02", clockIn: "8:10 AM", clockOut: "5:05 PM", hoursWorked: 8.92, status: "completed" },
  { date: "2026-06-01", clockIn: "8:00 AM", clockOut: "5:00 PM", hoursWorked: 9, status: "completed" },
  { date: "2026-05-31", clockIn: "PTO", clockOut: "PTO", hoursWorked: 0, status: "completed" },
];

const LOGIN_LOGOUT_HISTORY: LoginLogoutRecord[] = [
  { date: "2026-06-04", time: "8:00 AM", type: "login" },
  { date: "2026-06-04", time: "5:00 PM", type: "logout" },
  { date: "2026-06-03", time: "7:55 AM", type: "login" },
  { date: "2026-06-03", time: "5:15 PM", type: "logout" },
];

export function EmployeeSelfServicePage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef; }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { email, uid, role, extraRoles, displayName, companyId } = useAuth();
  const search = (useSearch({ strict: false }) as { tab?: string }) ?? {};

  const [activeTab, setActiveTab] = usePersistedTab<"dashboard" | "payroll" | "attendance" | "requests" | "expenses">(
    "ahs:employee-self-service-active-tab",
    ["dashboard", "payroll", "attendance", "requests", "expenses"],
    "dashboard",
  );
  const [expandedPayslip, setExpandedPayslip] = useState<string | null>(null);
  const [payslipModalOpen, setPayslipModalOpen] = useState(false);
  const [selectedPayslipId, setSelectedPayslipId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<"pto" | "sick" | "correction" | "unpaidLeave">("pto");
  // Guided tour: switch tabs and open / close a request form for the steps inside it.
  const tourOpts = {
    setTab: (t: string) => setActiveTab(t as typeof activeTab),
    openPanel: (panel: string) => {
      setSubmitSuccess(false);
      setModalType(panel as typeof modalType);
      setShowModal(true);
    },
    closePanel: () => setShowModal(false),
  };

  // Guided tour handed over from Guides → Self-Service Guide.
  const tourStartedRef = useRef(false);
  useEffect(() => {
    if (tourStartedRef.current) return;
    const id = takeQueuedTour(SELF_SERVICE_TOUR_TARGET);
    if (id !== SELF_SERVICE_TOUR.id) return;
    tourStartedRef.current = true;
    window.setTimeout(() => void runTour(SELF_SERVICE_TOUR, tourOpts), 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [attendanceView, setAttendanceView] = useState<"daily" | "monthly">("daily");
  // Real Supabase-backed attendance for the My Attendance tab.
  const [liveAttendance, setLiveAttendance] = useState<AttendanceRow[]>([]);
  const [missingAttendance, setMissingAttendance] = useState<AttendanceRow[]>([]);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [showLoginLogout, setShowLoginLogout] = useState(false);

  // Real Supabase-backed PTO / time-correction / attendance-dispute / payroll-inquiry
  // requests — company-scoped by RLS, filtered down to "mine" below for the
  // employee-facing tabs. Reviewing everyone else's pending requests now
  // lives entirely on Attendance Monitoring (PTO Management / Corrections /
  // Disputes & Inquiries tabs) instead of here.
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myHireDate, setMyHireDate] = useState<string | null>(null);
  // Until the hire date has loaded, PTO eligibility is unknown — not "eligible".
  const [myHireDateLoaded, setMyHireDateLoaded] = useState(false);
  const [allPtoRequests, setAllPtoRequests] = useState<PtoRequestRow[]>([]);
  const [allCorrections, setAllCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [allEmployeeRequests, setAllEmployeeRequests] = useState<EmployeeRequestRow[]>([]);
  const [companyProfiles, setCompanyProfiles] = useState<ProfileRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [myPayslips, setMyPayslips] = useState<MyPayslipRow[]>([]);
  // Notes from Payroll (migration 0399) — unread ones show as a banner above
  // the tabs until "I've read this" is clicked.
  const [myPayrollNotes, setMyPayrollNotes] = useState<PayrollNote[]>([]);
  const [ackingNoteId, setAckingNoteId] = useState<string | null>(null);
  // Which payslip periods have their pay details expanded (runId).
  const [openPayDetails, setOpenPayDetails] = useState<Set<string>>(new Set());
  const [payslipDailyRows, setPayslipDailyRows] = useState<PayslipDailyRow[]>([]);
  const [payslipDailyLoading, setPayslipDailyLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestTypeFilter, setRequestTypeFilter] = useState<"all" | "PTO Request" | "Sick Leave Request" | "Time Correction" | "Attendance Dispute" | "Payroll Inquiry">("all");
  // My Expenses tab — the employee's own expenses (Accounting approves or
  // rejects them under Accounting → Expenses → Employee Requests).
  const [myExpenses, setMyExpenses] = useState<ExpenseRow[]>([]);
  const [myExpensesLoading, setMyExpensesLoading] = useState(true);
  const [expenseFilter, setExpenseFilter] = useState<"all" | ExpenseRow["status"]>("all");
  // null = closed; { editing: null } = new request; { editing: row } = edit a pending one.
  const [expenseForm, setExpenseForm] = useState<{ editing: ExpenseRow | null } | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);
  const [summaryModal, setSummaryModal] = useState<"pending" | "approved" | "rejected" | "closed" | "pto" | "sick" | null>(null);

  const [formData, setFormData] = useState({
    leaveType: "Vacation",
    startDate: "",
    endDate: "",
    correctionDate: "",
    correctedCheckIn: "",
    correctedCheckOut: "",
    correctedMealStart: "",
    correctedMealEnd: "",
    details: "",
    branch: (LOCATIONS[0] as string) || "",
    position: "",
    // Employee Attendance & Visit Exception Report fields, folded directly
    // into Time Correction (migration 0304), Sick Leave, and Unpaid Leave
    // (migration 0306) requests — shared here since only one modal is ever
    // open at a time. See timecardCorrectionPdf.ts / ptoExceptionReportPdf.ts.
    // Time Correction asks for the Issue (migration 0333) instead — see the
    // effect below that swaps the default when the modal type changes.
    exceptionType: "missed_workday" as ExceptionType | CorrectionIssueType,
    otherDescription: "",
    // Only shown/used when the employee's own profile has no technician_id
    // on file — "let them type it in when it's blank" per the original ask.
    employeeIdOverride: "",
  });
  // Time Correction uses the Issue list; Sick / Unpaid Leave keep the Exception
  // Type list. Keep the shared field on a valid choice for whichever is open.
  useEffect(() => {
    setFormData((f) => {
      if (modalType === "correction") return f.exceptionType === "other" || isCorrectionIssueType(f.exceptionType) ? f : { ...f, exceptionType: "forgot_to_clock" };
      return isCorrectionIssueType(f.exceptionType) ? { ...f, exceptionType: "missed_workday" } : f;
    });
  }, [modalType]);
  const correctionShift = correctionShiftMinutes(formData.correctedCheckIn, formData.correctedCheckOut);
  // Over 6 hours: meal fields unlocked and required. 6 hours or less (or
  // not both punches entered yet): locked — a meal on a short shift is unpaid.
  const correctionMealRequired = correctionShift !== null && correctionShift > CORRECTION_MEAL_REQUIRED_AFTER_MINUTES;
  // Pre-fill all four fields with what's on the timecard for the picked
  // date (Check In, Check Out, Meal Start, Meal End) — re-filled whenever
  // the date changes — so nothing gets missed: the employee only changes
  // what's wrong. A punch that isn't on the timecard stays blank.
  useEffect(() => {
    if (!myProfileId || !formData.correctionDate) return;
    let cancelled = false;
    getEntryForDate(myProfileId, formData.correctionDate)
      .then((e) => {
        if (cancelled) return;
        setFormData((prev) =>
          prev.correctionDate !== formData.correctionDate
            ? prev
            : {
                ...prev,
                correctedCheckIn: e?.checkIn || "",
                correctedCheckOut: e?.checkOut || "",
                correctedMealStart: e?.mealStart || "",
                correctedMealEnd: e?.mealEnd || "",
              }
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [myProfileId, formData.correctionDate]);
  // How far back the date picker goes: 2 days, or just yesterday once today
  // already has a Check Out — re-read each time the Time Correction form opens.
  const [correctionWindow, setCorrectionWindow] = useState<SelfCorrectionWindow | null>(null);
  useEffect(() => {
    if (!showModal || modalType !== "correction" || !myProfileId) return;
    let cancelled = false;
    getSelfCorrectionWindow(myProfileId)
      .then((w) => { if (!cancelled) setCorrectionWindow(w); })
      .catch((e) => console.error("time correction: load window failed", e));
    return () => { cancelled = true; };
  }, [showModal, modalType, myProfileId]);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const correctionSigPad =useSignaturePad({ width: 400, height: 110, defaultName: displayName || "" });
  // Reused for both Sick Leave and Unpaid Leave (mutually exclusive modal states).
  const leaveSigPad = useSignaturePad({ width: 400, height: 110, defaultName: displayName || "" });
  useEffect(() => {
    if (!showModal || formData.position) return;
    const me = companyProfiles.find((p) => p.id === myProfileId);
    if (!me?.role) return;
    setFormData((prev) => (prev.position ? prev : { ...prev, position: me.role, branch: prev.branch || me.assigned_branch || prev.branch }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, companyProfiles, myProfileId]);
  // Sick / Unpaid Leave: a photo or PDF as proof (e.g. a doctor's note) is required.
  const [leaveProof, setLeaveProof] = useState<File | null>(null);
  useEffect(() => {
    if (!showModal) setLeaveProof(null);
  }, [showModal]);

  // Load the caller's real attendance for the last 30 days from Supabase, and
  // flag days where they're missing a clock-in or clock-out so we can surface
  // a warning banner. Re-runs whenever the user navigates back into the page.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const schedule = await getMyProfileSchedule(uid);
        if (cancelled) return;
        setMyProfileId(schedule.profileId);
        if (!schedule.profileId) return;
        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 30);
        const toKey = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const holidays = await getCompanyHolidaysInRange(toKey(start), toKey(today)).catch(() => []);
        const pendingCorrections = await getPendingCorrectionsInRange(toKey(start), toKey(today)).catch(() => []);
        const rows = await getAttendanceForRange(
          schedule.profileId,
          toKey(start),
          toKey(today),
          {
            requiredCheckIn: schedule.requiredCheckIn,
            requiredCheckOut: schedule.requiredCheckOut,
            workingHours: schedule.workingHours,
            mealMinutes: schedule.mealMinutes,
            daysOff: schedule.offDays,
            holidayDates: holidays.map((h) => h.date),
            pendingCorrectionDates: pendingCorrections.filter((c) => c.profileId === schedule.profileId).map((c) => c.workDate),
          }
        );
        if (cancelled) return;
        setLiveAttendance(rows);
        setMissingAttendance(
          rows.filter((r) => r.status === "missing-in" || r.status === "missing-out")
        );
      } catch (err) {
        console.warn("Attendance load skipped:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // PTO eligibility requires knowing the employee's hire date (stored in
  // profiles.employee_info, not part of the regular profile columns).
  useEffect(() => {
    if (!myProfileId) return;
    let cancelled = false;
    getProfileEmployeeInfo(myProfileId)
      .then((info) => {
        if (!cancelled) setMyHireDate(info?.hireDate || null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMyHireDateLoaded(true);
      });
    return () => { cancelled = true; };
  }, [myProfileId]);

  // Load real PTO / correction / attendance-dispute / payroll-inquiry requests
  // for the whole company (RLS already scopes this to the caller's company) —
  // filtered down to "mine" below for the My Requests tab. companyProfiles is
  // also needed for resolveTeamLeadOrManager when submitting a new request.
  useEffect(() => {
    if (!myProfileId) return;
    let cancelled = false;
    (async () => {
      setRequestsLoading(true);
      try {
        const [ptoRows, correctionRows, employeeReqRows, profileRows, payslipRows] = await Promise.all([
          getCompanyPtoRequests(),
          getCompanyTimecardCorrections(),
          getCompanyEmployeeRequests(),
          getCompanyUsers(),
          getMyPayslips(myProfileId),
        ]);
        if (cancelled) return;
        setAllPtoRequests(ptoRows);
        setAllCorrections(correctionRows);
        setAllEmployeeRequests(employeeReqRows);
        setCompanyProfiles(profileRows);
        setMyPayslips(payslipRows);
      } catch (err) {
        console.error("Failed to load employee requests:", err);
      } finally {
        if (!cancelled) setRequestsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [myProfileId]);

  // Separate from the load above so a missing migration (0399) can't blank
  // the payslips.
  useEffect(() => {
    if (!myProfileId) return;
    let cancelled = false;
    getMyPayrollNotes(myProfileId)
      .then((rows) => { if (!cancelled) setMyPayrollNotes(rows); })
      .catch((err) => console.error("Failed to load payroll notes:", err));
    return () => { cancelled = true; };
  }, [myProfileId]);
  const handleAcknowledgeNote = async (note: PayrollNote) => {
    setAckingNoteId(note.id);
    try {
      await acknowledgePayrollNote(note.id);
      const now = new Date().toISOString();
      setMyPayrollNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, acknowledgedAt: now } : n)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't save that — please try again.");
    } finally {
      setAckingNoteId(null);
    }
  };
  const unreadPayrollNotes = myPayrollNotes.filter((n) => !n.acknowledgedAt);
  const noteForPeriod = (start: string, end: string) => myPayrollNotes.find((n) => n.periodStart === start && n.periodEnd === end) ?? null;
  const togglePayDetails = (runId: string) =>
    setOpenPayDetails((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });

  // Separate from the load above so a failure here can't blank the other
  // request types. Flash Tech trip expenses (company-booked hotel/travel —
  // expense_subtype set, even once the trip itself is deleted) aren't the
  // employee's to claim back, so they're left out.
  const refreshExpenses = async (profileId: string) => {
    const rows = await getProfileExpenses(profileId);
    setMyExpenses(rows.filter((e) => !e.flashTechTripId && !e.expenseSubtype));
  };
  useEffect(() => {
    if (!myProfileId) return;
    setMyExpensesLoading(true);
    refreshExpenses(myProfileId)
      .catch((err) => console.error("Failed to load expenses:", err))
      .finally(() => setMyExpensesLoading(false));
  }, [myProfileId]);
  const myReimbursement = useMemo(() => {
    const of = (status: ExpenseRow["status"]) => myExpenses.filter((e) => e.status === status);
    const total = (rows: ExpenseRow[]) => rows.reduce((s, e) => s + e.amount, 0);
    const [pending, approved, reimbursed, rejected] = [of("Pending"), of("Approved"), of("Reimbursed"), of("Rejected")];
    return {
      pending: total(pending), pendingCount: pending.length,
      approved: total(approved), approvedCount: approved.length,
      reimbursed: total(reimbursed), reimbursedCount: reimbursed.length,
      rejectedCount: rejected.length,
    };
  }, [myExpenses]);
  const visibleExpenses = useMemo(
    () => (expenseFilter === "all" ? myExpenses : myExpenses.filter((e) => e.status === expenseFilter)),
    [myExpenses, expenseFilter]
  );
  const handleDeleteExpense = async (row: ExpenseRow) => {
    if (!myProfileId || !confirm("Delete this expense request? This cannot be undone.")) return;
    setDeletingExpenseId(row.id);
    try {
      await deleteExpense(row.id);
      if (row.receiptPath) deleteExpenseReceiptFile(row.receiptPath).catch((err) => console.error("Failed to delete receipt file:", err));
      await refreshExpenses(myProfileId);
    } catch (err) {
      alert(`Failed to delete expense: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingExpenseId(null);
    }
  };

  const refreshRequests = async () => {
    const [ptoRows, correctionRows, employeeReqRows] = await Promise.all([
      getCompanyPtoRequests(),
      getCompanyTimecardCorrections(),
      getCompanyEmployeeRequests(),
    ]);
    setAllPtoRequests(ptoRows);
    setAllCorrections(correctionRows);
    setAllEmployeeRequests(employeeReqRows);
  };

  const myPtoRequests = useMemo(
    () => allPtoRequests.filter((r) => r.profileId === myProfileId),
    [allPtoRequests, myProfileId]
  );
  const myCorrections = useMemo(
    () => allCorrections.filter((r) => r.profileId === myProfileId),
    [allCorrections, myProfileId]
  );
  const myEmployeeRequests = useMemo(
    () => allEmployeeRequests.filter((r) => r.profileId === myProfileId),
    [allEmployeeRequests, myProfileId]
  );

  const profileName = (profileId: string) => {
    const p = companyProfiles.find((p) => p.id === profileId);
    return p?.display_name || p?.email || "Unknown";
  };

  const myRequests: Request[] = useMemo(() => {
    const items: Request[] = [];
    for (const r of myPtoRequests) {
      const managerLine = r.managerStatus !== "pending"
        ? `Manager: ${r.managerStatus}${r.managerReviewedBy ? ` by ${profileName(r.managerReviewedBy)}` : ""}`
        : "Manager: pending";
      const hrLine = r.hrStatus !== "pending"
        ? `HR: ${r.hrStatus}${r.hrReviewedBy ? ` by ${profileName(r.hrReviewedBy)}` : ""}`
        : "HR: pending";
      items.push({
        id: `pto-${r.id}`,
        type: r.ptoType === "sick" ? "Sick Leave Request" : "PTO Request",
        status: r.status === "denied" ? "rejected" : r.status === "cancelled" ? "closed" : r.status,
        submittedDate: r.createdAt.slice(0, 10),
        details: `${PTO_TYPE_LABEL[r.ptoType] ?? r.ptoType}: ${r.startDate} to ${r.endDate} (${r.hoursRequested}h)${r.reason ? ` - ${r.reason}` : ""}\n${managerLine} | ${hrLine}`,
        rejectionReason: r.status === "denied" ? r.reviewNote : null,
      });
    }
    for (const r of myCorrections) {
      const corrManagerLine = r.managerStatus !== "pending"
        ? `Manager: ${r.managerStatus}${r.managerReviewedBy ? ` by ${profileName(r.managerReviewedBy)}` : ""}`
        : "Manager: pending";
      const corrHrLine = r.hrStatus !== "pending"
        ? `HR: ${r.hrStatus}${r.hrReviewedBy ? ` by ${profileName(r.hrReviewedBy)}` : ""}`
        : "HR: pending";
      const corrAccountingLine = r.accountingStatus !== "pending"
        ? `Accounting: ${r.accountingStatus}${r.accountingReviewedBy ? ` by ${profileName(r.accountingReviewedBy)}` : ""}`
        : "Accounting: pending";
      items.push({
        id: `corr-${r.id}`,
        type: "Time Correction",
        status: r.status,
        submittedDate: r.createdAt.slice(0, 10),
        details: `Date: ${r.workDate} - requested ${r.correctedCheckIn || "—"} to ${r.correctedCheckOut || "—"} (was ${r.originalCheckIn || "—"} to ${r.originalCheckOut || "—"})${(r.correctedMealStart || r.correctedMealEnd) ? `\nMeal: requested ${r.correctedMealStart || "—"} to ${r.correctedMealEnd || "—"} (was ${r.originalMealStart || "—"} to ${r.originalMealEnd || "—"})` : ""}${r.reason ? `. ${r.reason}` : ""}\n${corrManagerLine} | ${corrHrLine} | ${corrAccountingLine}${r.status === "approved" ? "\n✅ Your timecard has been updated with the corrected time." : ""}`,
        rejectionReason: r.status === "rejected" ? r.reviewNote : null,
      });
    }
    const money = (n: number | null) => `$${(n ?? 0).toFixed(2)}`;
    for (const r of myEmployeeRequests) {
      // Payroll dispute amounts — when Accounting approved it with changes
      // ("Modify", migration 0382) show what was asked next to what was approved.
      const amounts =
        r.requestType !== "payroll_dispute" || (r.totalReceived === null && r.totalExpected === null)
          ? ""
          : r.modifiedAt
          ? `\nYou requested: Received ${money(r.originalTotalReceived)} · Expected ${money(r.originalTotalExpected)} · Missing ${money(r.originalMissingAmount)}` +
            `\n✏️ Modified by Accounting: Received ${money(r.totalReceived)} · Expected ${money(r.totalExpected)} · Missing ${money(r.missingAmount)}`
          : `\nReceived ${money(r.totalReceived)} · Expected ${money(r.totalExpected)} · Missing ${money(r.missingAmount)}`;
      items.push({
        id: `req-${r.id}`,
        type: r.requestType === "attendance_dispute" ? "Attendance Dispute" : r.requestType === "payroll_dispute" ? "Payroll Dispute" : "Payroll Inquiry",
        // A payroll dispute Accounting changed before approving reads "Modified".
        status: r.status === "approved" && r.modifiedAt ? "modified" : r.status,
        submittedDate: r.createdAt.slice(0, 10),
        details: r.details + amounts + (r.reviewNote && r.status !== "rejected" ? `\n\n${r.modifiedAt ? "Accounting's comment" : "Response"}: ${r.reviewNote}` : ""),
        rejectionReason: r.status === "rejected" ? r.reviewNote || null : null,
      });
    }
    return items.sort((a, b) => b.submittedDate.localeCompare(a.submittedDate));
  }, [myPtoRequests, myCorrections, myEmployeeRequests, companyProfiles]);

  const filteredMyRequests = useMemo(
    () => (requestTypeFilter === "all" ? myRequests : myRequests.filter((r) => r.type === requestTypeFilter)),
    [myRequests, requestTypeFilter]
  );

  // PTO eligibility: 1 year of tenure from hire date (falls back to account
  // creation date if HR hasn't set a hire date yet).
  const myCreatedAt = companyProfiles.find((p) => p.id === myProfileId)?.created_at ?? null;
  // Locked while the dates are still loading, so a newer employee can't slip
  // a request in before the 1-year check has anything to go on.
  const ptoEligibilityKnown = myHireDateLoaded && !!(myHireDate || myCreatedAt);
  const ptoEligible = ptoEligibilityKnown && isEligibleForPto(myHireDate, myCreatedAt);
  const ptoEligibleOn = ptoEligibleDate(myHireDate, myCreatedAt);

  // Annual PTO allowance: 5 days in the employee's first eligible year, +1
  // each following year (6, 7, 8, ...), resetting on their hire anniversary
  // rather than the calendar year. `unpaid` requests don't count against it.
  const myPtoYear = ptoYearWindow(myHireDate, myCreatedAt);
  const myPtoYearRequests = useMemo(
    () => (myPtoYear ? ptoRequestsInYear(myPtoRequests, myPtoYear) : []),
    [myPtoRequests, myPtoYear]
  );
  const myPtoUsed = myPtoYearRequests.reduce((sum, r) => sum + r.hoursRequested / 8, 0);
  const myPtoRemaining = myPtoYear ? Math.max(0, myPtoYear.allowance - myPtoUsed) : 0;
  // Every PTO day this year is approved or pending — the PTO Request button locks until the anniversary reset.
  const myPtoUsedUp = ptoEligible && !!myPtoYear && myPtoRemaining <= 0;
  const myPtoYearRequestIds = useMemo(
    () => new Set(myPtoYearRequests.map((r) => `pto-${r.id}`)),
    [myPtoYearRequests]
  );

  // Sick Leave: its own flat 5-days-a-year allowance (never increments like
  // vacation PTO does), available from day 1 of employment — no 1-year wait,
  // and always unpaid (see isPaidPtoType in pto.ts) so it never draws
  // against, or gets confused with, the vacation PTO allowance above.
  const mySickYear = sickYearWindow(myHireDate, myCreatedAt);
  const mySickYearRequests = useMemo(
    () => (mySickYear ? sickRequestsInYear(myPtoRequests, mySickYear) : []),
    [myPtoRequests, mySickYear]
  );
  const mySickUsed = mySickYearRequests.reduce((sum, r) => sum + r.hoursRequested / 8, 0);
  const mySickRemaining = mySickYear ? Math.max(0, mySickYear.allowance - mySickUsed) : 0;
  const mySickYearRequestIds = useMemo(
    () => new Set(mySickYearRequests.map((r) => `pto-${r.id}`)),
    [mySickYearRequests]
  );

  // Deep link from a bell-icon notification straight into a specific tab
  // (e.g. PTO/correction outcome -> "requests", payroll generated ->
  // "payroll"). Reviewing others' pending requests now happens entirely on
  // Attendance Monitoring, not here.
  useEffect(() => {
    const tab = search.tab;
    if (!tab) return;
    if (["dashboard", "payroll", "attendance", "requests", "expenses"].includes(tab)) {
      setActiveTab(tab as typeof activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.tab]);

  const tabs = [
    { id: "dashboard", label: "My Dashboard", icon: TrendingUp },
    { id: "payroll", label: "My Payroll", icon: DollarSign },
    { id: "attendance", label: "My Attendance", icon: Clock },
    { id: "requests", label: "My Requests", icon: ListTodo },
    { id: "expenses", label: "My Expenses", icon: Receipt },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-500/20 text-yellow-300";
      case "approved": return "bg-green-500/20 text-green-300";
      case "modified": return "bg-sky-500/20 text-sky-300";
      case "rejected": return "bg-red-500/20 text-red-300";
      case "closed": return "bg-slate-500/20 text-slate-300";
      default: return "bg-slate-500/20 text-slate-300";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending": return "⏳";
      case "approved": return "✓";
      case "modified": return "✏️";
      case "rejected": return "✕";
      case "closed": return "—";
      default: return "—";
    }
  };

  const handleSubmitRequest = async () => {
    if (!formData.details.trim()) {
      alert("Please fill in the details/reason field");
      return;
    }
    if (!myProfileId) {
      alert("Unable to identify your profile. Please reload the page and try again.");
      return;
    }

    setSubmitting(true);
    try {
      switch (modalType) {
        case "pto": {
          if (!formData.startDate || !formData.endDate) {
            alert("Please select start and end dates");
            setSubmitting(false);
            return;
          }
          if (!ptoEligible) {
            alert(`You're not yet eligible for PTO — employees need 1 year of tenure first. You'll be eligible starting ${ptoEligibleOn}.`);
            setSubmitting(false);
            return;
          }
          const requestedDays = workingDayCount(formData.startDate, formData.endDate, companyProfiles.find((p) => p.id === myProfileId)?.off_days);
          if (requestedDays === 0) {
            alert("Every day in that range is one of your scheduled rest days — there's nothing to file leave for.");
            setSubmitting(false);
            return;
          }
          if (myPtoYear && requestedDays > myPtoRemaining) {
            alert(`This request is ${requestedDays} day${requestedDays === 1 ? "" : "s"}, but you only have ${myPtoRemaining} of ${myPtoYear.allowance} days left for Year ${myPtoYear.tenureYear} (resets ${myPtoYear.end}).`);
            setSubmitting(false);
            return;
          }
          const ptoTypeMap: Record<string, PtoType> = {
            Vacation: "vacation",
          };
          const myProfile = companyProfiles.find((p) => p.id === myProfileId) ?? null;
          const managerProfile = myProfile ? await resolveTeamLeadOrManager(myProfile, companyProfiles) : null;
          await createPtoRequest({
            profileId: myProfileId,
            ptoType: ptoTypeMap[formData.leaveType] || "vacation",
            startDate: formData.startDate,
            endDate: formData.endDate,
            reason: `Branch: ${formData.branch} | Position: ${ROLE_LABELS[formData.position] || formData.position || "N/A"} - ${formData.details}`,
            requestedBy: myProfileId,
            managerId: managerProfile?.id ?? null,
          });
          // PTO needs both a manager and an HR approval — ping the resolved
          // manager (if any) plus every HR user; if no manager could be
          // resolved, fall back to notifying ADMIN too so it isn't stranded.
          {
            const recipients = new Map<string, ProfileRow>();
            if (managerProfile && managerProfile.id !== myProfileId) recipients.set(managerProfile.id, managerProfile);
            for (const p of companyProfiles) {
              if (p.id === myProfileId || !p.is_active) continue;
              const primary = (p.role || "").toUpperCase();
              if (primary === "HR" || (!managerProfile && (primary === "ADMIN" || primary === "SUPERADMIN"))) recipients.set(p.id, p);
            }
            await Promise.all(
              Array.from(recipients.values()).map((r) =>
                createNotification({
                  recipientId: r.id,
                  senderId: myProfileId,
                  senderName: displayName || "Employee",
                  body: `🗓️ New PTO Request from ${displayName || "an employee"} needs your approval: ${formData.leaveType}, ${formData.startDate} to ${formData.endDate}.`,
                  linkTo: "/m/dashboard/attendance-monitoring?tab=pto-management",
                }).catch((err) => console.error("Failed to notify", r.id, err))
              )
            );
          }
          break;
        }
        case "sick": {
          if (!formData.startDate || !formData.endDate) {
            alert("Please select start and end dates");
            setSubmitting(false);
            return;
          }
          // No 1-year eligibility gate here — Sick Leave is available from
          // day 1 of employment, unlike vacation PTO above.
          const requestedDays = workingDayCount(formData.startDate, formData.endDate, companyProfiles.find((p) => p.id === myProfileId)?.off_days);
          if (requestedDays === 0) {
            alert("Every day in that range is one of your scheduled rest days — there's nothing to file leave for.");
            setSubmitting(false);
            return;
          }
          if (mySickYear && requestedDays > mySickRemaining) {
            alert(`This request is ${requestedDays} day${requestedDays === 1 ? "" : "s"}, but you only have ${mySickRemaining} of ${mySickYear.allowance} Sick Leave day(s) left for Year ${mySickYear.tenureYear} (resets ${mySickYear.end}).`);
            setSubmitting(false);
            return;
          }
          if (!formData.details.trim()) {
            alert("Please describe the reason for this exception.");
            setSubmitting(false);
            return;
          }
          if (!leaveSigPad.hasContent()) {
            alert("Please sign to acknowledge the information above is accurate before submitting.");
            setSubmitting(false);
            return;
          }
          if (!leaveProof) {
            alert("Please attach a proof photo or PDF (e.g. a doctor's note).");
            setSubmitting(false);
            return;
          }
          const sickSignatureDataUrl = leaveSigPad.toDataURL();
          if (!sickSignatureDataUrl) {
            alert("Please sign to acknowledge the information above is accurate before submitting.");
            setSubmitting(false);
            return;
          }
          if (!companyId) {
            alert("Your company couldn't be resolved yet — try again in a moment.");
            setSubmitting(false);
            return;
          }
          const myProfile = companyProfiles.find((p) => p.id === myProfileId) ?? null;
          const managerProfile = myProfile ? await resolveTeamLeadOrManager(myProfile, companyProfiles) : null;
          const sickRequestId = crypto.randomUUID();
          // Upload the proof first — if it fails, nothing has been submitted yet.
          const sickProofUrl = await uploadPtoRequestAttachment(companyId, sickRequestId, leaveProof);
          {
            const { roleLabel: jobTitle } = getRoleDepartmentBreakdown(myProfile?.role ?? role);
            const { pdfUrl, employeeSignatureUrl } = await buildPtoSubmissionPdf({
              requestId: sickRequestId,
              companyId,
              employeeInfo: {
                employeeName: displayName || "",
                technicianId: myProfile?.technician_id || formData.employeeIdOverride,
                jobTitle,
                department: myProfile?.assigned_branch || "",
                directManagerName: managerProfile?.display_name || managerProfile?.email || "",
              },
              dateOfIncident: formData.startDate,
              exceptionType: formData.exceptionType as ExceptionType, // never an Issue value here — the effect above resets it for leave
              otherDescription: formData.otherDescription,
              detailedReason: formData.details,
              employeeSignatureDataUrl: sickSignatureDataUrl,
            });
            await createPtoRequest({
              id: sickRequestId,
              profileId: myProfileId,
              ptoType: "sick",
              startDate: formData.startDate,
              endDate: formData.endDate,
              reason: `Branch: ${formData.branch} | Position: ${ROLE_LABELS[formData.position] || formData.position || "N/A"} - ${formData.details}`,
              requestedBy: myProfileId,
              managerId: managerProfile?.id ?? null,
              exceptionType: formData.exceptionType as ExceptionType, // never an Issue value here — the effect above resets it for leave
              otherDescription: formData.otherDescription,
              employeeSignatureUrl,
              employeeSignatureName: displayName || "",
              pdfUrl,
            });
            await setPtoAttachmentUrl(sickRequestId, sickProofUrl, myProfileId);
          }
          // Same manager + HR (or fallback Admin) notification pattern as
          // vacation PTO — Sick Leave goes through the same approval pipeline,
          // it just doesn't draw against the same allowance or get paid.
          {
            const recipients = new Map<string, ProfileRow>();
            if (managerProfile && managerProfile.id !== myProfileId) recipients.set(managerProfile.id, managerProfile);
            for (const p of companyProfiles) {
              if (p.id === myProfileId || !p.is_active) continue;
              const primary = (p.role || "").toUpperCase();
              if (primary === "HR" || (!managerProfile && (primary === "ADMIN" || primary === "SUPERADMIN"))) recipients.set(p.id, p);
            }
            await Promise.all(
              Array.from(recipients.values()).map((r) =>
                createNotification({
                  recipientId: r.id,
                  senderId: myProfileId,
                  senderName: displayName || "Employee",
                  body: `🤒 New Sick Leave Request from ${displayName || "an employee"} needs your approval: ${formData.startDate} to ${formData.endDate}.`,
                  linkTo: "/m/dashboard/attendance-monitoring?tab=pto-management",
                }).catch((err) => console.error("Failed to notify", r.id, err))
              )
            );
          }
          break;
        }
        case "unpaidLeave": {
          if (!formData.startDate || !formData.endDate) {
            alert("Please select start and end dates");
            setSubmitting(false);
            return;
          }
          // No eligibility gate and no allowance check — unpaid leave
          // doesn't draw against any balance, unlike vacation PTO/Sick Leave
          // above.
          if (!formData.details.trim()) {
            alert("Please describe the reason for this exception.");
            setSubmitting(false);
            return;
          }
          if (!leaveSigPad.hasContent()) {
            alert("Please sign to acknowledge the information above is accurate before submitting.");
            setSubmitting(false);
            return;
          }
          if (!leaveProof) {
            alert("Please attach a proof photo or PDF.");
            setSubmitting(false);
            return;
          }
          const unpaidSignatureDataUrl = leaveSigPad.toDataURL();
          if (!unpaidSignatureDataUrl) {
            alert("Please sign to acknowledge the information above is accurate before submitting.");
            setSubmitting(false);
            return;
          }
          if (!companyId) {
            alert("Your company couldn't be resolved yet — try again in a moment.");
            setSubmitting(false);
            return;
          }
          const myProfile = companyProfiles.find((p) => p.id === myProfileId) ?? null;
          const managerProfile = myProfile ? await resolveTeamLeadOrManager(myProfile, companyProfiles) : null;
          const unpaidRequestId = crypto.randomUUID();
          // Upload the proof first — if it fails, nothing has been submitted yet.
          const unpaidProofUrl = await uploadPtoRequestAttachment(companyId, unpaidRequestId, leaveProof);
          {
            const { roleLabel: jobTitle } = getRoleDepartmentBreakdown(myProfile?.role ?? role);
            const { pdfUrl, employeeSignatureUrl } = await buildPtoSubmissionPdf({
              requestId: unpaidRequestId,
              companyId,
              employeeInfo: {
                employeeName: displayName || "",
                technicianId: myProfile?.technician_id || formData.employeeIdOverride,
                jobTitle,
                department: myProfile?.assigned_branch || "",
                directManagerName: managerProfile?.display_name || managerProfile?.email || "",
              },
              dateOfIncident: formData.startDate,
              exceptionType: formData.exceptionType as ExceptionType, // never an Issue value here — the effect above resets it for leave
              otherDescription: formData.otherDescription,
              detailedReason: formData.details,
              employeeSignatureDataUrl: unpaidSignatureDataUrl,
            });
            await createPtoRequest({
              id: unpaidRequestId,
              profileId: myProfileId,
              ptoType: "unpaid",
              startDate: formData.startDate,
              endDate: formData.endDate,
              reason: `Branch: ${formData.branch} | Position: ${ROLE_LABELS[formData.position] || formData.position || "N/A"} - ${formData.details}`,
              requestedBy: myProfileId,
              managerId: managerProfile?.id ?? null,
              exceptionType: formData.exceptionType as ExceptionType, // never an Issue value here — the effect above resets it for leave
              otherDescription: formData.otherDescription,
              employeeSignatureUrl,
              employeeSignatureName: displayName || "",
              pdfUrl,
            });
            await setPtoAttachmentUrl(unpaidRequestId, unpaidProofUrl, myProfileId);
          }
          {
            const recipients = new Map<string, ProfileRow>();
            if (managerProfile && managerProfile.id !== myProfileId) recipients.set(managerProfile.id, managerProfile);
            for (const p of companyProfiles) {
              if (p.id === myProfileId || !p.is_active) continue;
              const primary = (p.role || "").toUpperCase();
              if (primary === "HR" || (!managerProfile && (primary === "ADMIN" || primary === "SUPERADMIN"))) recipients.set(p.id, p);
            }
            await Promise.all(
              Array.from(recipients.values()).map((r) =>
                createNotification({
                  recipientId: r.id,
                  senderId: myProfileId,
                  senderName: displayName || "Employee",
                  body: `🗓️ New Unpaid Leave Request from ${displayName || "an employee"} needs your approval: ${formData.startDate} to ${formData.endDate}.`,
                  linkTo: "/m/dashboard/attendance-monitoring?tab=pto-management",
                }).catch((err) => console.error("Failed to notify", r.id, err))
              )
            );
          }
          break;
        }
        case "correction": {
          if (!formData.correctionDate) {
            alert("Please select a date");
            setSubmitting(false);
            return;
          }
          // No future dates; up to 2 days back, or only today and yesterday once today has a Check Out.
          await validateSelfCorrectionDate(myProfileId, formData.correctionDate);
          // Re-read the day's real punches at submit time for the "original"
          // times saved with the request (the 30-day attendance list misses
          // older dates).
          const punched = myProfileId ? await getEntryForDate(myProfileId, formData.correctionDate).catch(() => null) : null;
          const submittedMealStart = formData.correctedMealStart;
          const submittedMealEnd = formData.correctedMealEnd;
          const correctionTimesError = validateCorrectionTimes({
            checkIn: formData.correctedCheckIn,
            checkOut: formData.correctedCheckOut,
            mealStart: submittedMealStart,
            mealEnd: submittedMealEnd,
          });
          if (correctionTimesError) {
            alert(correctionTimesError);
            setSubmitting(false);
            return;
          }
          const existing = liveAttendance.find((a) => a.date === formData.correctionDate);
          if (formData.exceptionType === "other" && !formData.otherDescription.trim()) {
            alert("Please specify the issue for “Other”.");
            setSubmitting(false);
            return;
          }
          if (!formData.details.trim()) {
            alert("Please describe the reason for this exception.");
            setSubmitting(false);
            return;
          }
          if (!correctionSigPad.hasContent()) {
            alert("Please sign to acknowledge the information above is accurate before submitting.");
            setSubmitting(false);
            return;
          }
          const signatureDataUrl = correctionSigPad.toDataURL();
          if (!signatureDataUrl) {
            alert("Please sign to acknowledge the information above is accurate before submitting.");
            setSubmitting(false);
            return;
          }
          const correctionRequesterProfile = companyProfiles.find((p) => p.id === myProfileId) ?? null;
          const correctionManagerProfile = correctionRequesterProfile
            ? await resolveTeamLeadOrManager(correctionRequesterProfile, companyProfiles)
            : null;
          if (!companyId) {
            alert("Your company couldn't be resolved yet — try again in a moment.");
            setSubmitting(false);
            return;
          }
          const correctionId = crypto.randomUUID();
          const { roleLabel: jobTitle } = getRoleDepartmentBreakdown(correctionRequesterProfile?.role ?? role);
          const { pdfUrl, employeeSignatureUrl } = await buildCorrectionSubmissionPdf({
            correctionId,
            companyId,
            employeeInfo: {
              employeeName: displayName || "",
              technicianId: correctionRequesterProfile?.technician_id || formData.employeeIdOverride,
              jobTitle,
              department: correctionRequesterProfile?.assigned_branch || "",
              directManagerName: correctionManagerProfile?.display_name || correctionManagerProfile?.email || "",
            },
            workDate: formData.correctionDate,
            exceptionType: formData.exceptionType,
            otherDescription: formData.otherDescription,
            reason: formData.details,
            employeeSignatureDataUrl: signatureDataUrl,
          });
          await createTimecardCorrection({
            id: correctionId,
            profileId: myProfileId,
            workDate: formData.correctionDate,
            originalCheckIn: punched?.checkIn || existing?.clockIn || "",
            originalCheckOut: punched?.checkOut || existing?.clockOut || "",
            correctedCheckIn: formData.correctedCheckIn,
            correctedCheckOut: formData.correctedCheckOut,
            originalMealStart: punched?.mealStart || existing?.mealStart || "",
            originalMealEnd: punched?.mealEnd || existing?.mealEnd || "",
            correctedMealStart: submittedMealStart,
            correctedMealEnd: submittedMealEnd,
            reason: formData.details,
            requestedBy: myProfileId,
            exceptionType: formData.exceptionType,
            otherDescription: formData.otherDescription,
            employeeSignatureUrl,
            employeeSignatureName: displayName || "",
            pdfUrl,
            managerId: correctionManagerProfile?.id ?? null,
          });
          // The manager reviews first; HR/Finance only act once the manager
          // has approved (see reviewCorrectionStage's "ping HR/Accounting"
          // step), but — same precedent as the PTO submit flow above — HR
          // and Finance get an early heads-up here too rather than only
          // learning about it once it's already their turn.
          {
            const recipients = new Map<string, ProfileRow>();
            if (correctionManagerProfile && correctionManagerProfile.id !== myProfileId) {
              recipients.set(correctionManagerProfile.id, correctionManagerProfile);
            }
            for (const p of companyProfiles) {
              const primary = (p.role || "").toUpperCase();
              if (primary === "HR" || primary === "FINANCE") recipients.set(p.id, p);
            }
            const requesterProfile = companyProfiles.find((p) => p.id === myProfileId);
            if (requesterProfile) recipients.set(requesterProfile.id, requesterProfile);
            await Promise.all(
              Array.from(recipients.values()).map((r) =>
                createNotification({
                  recipientId: r.id,
                  senderId: myProfileId,
                  senderName: displayName || "Employee",
                  body: `🕐 New Time Correction Request from ${displayName || "an employee"} for ${formData.correctionDate}.`,
                  linkTo: r.id === myProfileId
                    ? "/m/dashboard/employee-self-service?tab=requests"
                    : "/m/dashboard/attendance-monitoring?tab=corrections",
                }).catch((err) => console.error("Failed to notify", r.id, err))
              )
            );
          }
          break;
        }
      }

      await refreshRequests();
      setSubmitSuccess(true);

      setTimeout(() => {
        setShowModal(false);
        setSubmitSuccess(false);
        setFormData({
          leaveType: "Vacation",
          startDate: "",
          endDate: "",
          correctionDate: "",
          correctedCheckIn: "",
          correctedCheckOut: "",
          correctedMealStart: "",
          correctedMealEnd: "",
          details: "",
          branch: LOCATIONS[0] || "",
          position: "",
          exceptionType: "missed_workday",
          otherDescription: "",
          employeeIdOverride: "",
        });
        correctionSigPad.clear();
        leaveSigPad.clear();
      }, 1500);
    } catch (err) {
      alert(`Failed to submit request: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = (type: "payslip" | "attendance") => {
    const latest = myPayslips[0];
    const csvContent = type === "payslip"
      ? (latest
        ? `Payslip\nPeriod: ${latest.periodStart} to ${latest.periodEnd}\nGross Pay: $${latest.grossPay.toFixed(2)}\nNet Pay: $${latest.netPay.toFixed(2)}`
        : "Payslip\nNo payroll generated yet.")
      : `Attendance Report\nGenerated: ${new Date().toLocaleDateString()}\nRecords: ${ATTENDANCE_DAILY.length}`;
    
    const element = document.createElement("a");
    // Leading BOM — without it Excel mis-decodes any non-ASCII character as
    // Windows-1252 instead of the UTF-8 the charset=utf-8 above declares.
    element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(String.fromCharCode(0xfeff) + csvContent));
    element.setAttribute("download", `${type}-report-${Date.now()}.csv`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleViewPayslip = (payrollId: string) => {
    setSelectedPayslipId(payrollId);
    setPayslipModalOpen(true);
  };

  const selectedPayslip = myPayslips.find((p) => p.runId === selectedPayslipId) ?? myPayslips[0] ?? null;

  // Working hours/meal-break schedule, hoisted out of the effect below so
  // payslipData (Working Hours / Total Break Time rows) can read it too,
  // not just the daily-rows computation.
  const [myScheduleInfo, setMyScheduleInfo] = useState<{
    requiredCheckIn: string;
    requiredCheckOut: string;
    workingHours: number | null;
    mealMinutes: number | null;
  } | null>(null);

  // Build the day-by-day duty breakdown shown on the payslip: fetch real
  // attendance for the selected payslip's exact pay period and apply that
  // run's stored hourly rate per day (payroll runs use one flat rate per
  // employee for the whole period, so no per-day rate lookup is needed).
  // Fixed-salary payslips (migration 0119) skip this entirely — an hours ×
  // $0/hr table would read as "you earned $0 today" despite the correct
  // flat Total below, so the template's own "No daily attendance recorded"
  // fallback is shown instead (see payslipTemplate.ts).
  useEffect(() => {
    if (!payslipModalOpen || !selectedPayslip || !myProfileId || selectedPayslip.compensationType === "fixed") {
      setPayslipDailyRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setPayslipDailyLoading(true);
      try {
        const schedule = uid ? await getMyProfileSchedule(uid) : null;
        if (!cancelled) setMyScheduleInfo(schedule);
        const holidays = await getCompanyHolidaysInRange(selectedPayslip.periodStart, selectedPayslip.periodEnd).catch(() => []);
        const pendingCorrections = await getPendingCorrectionsInRange(selectedPayslip.periodStart, selectedPayslip.periodEnd).catch(() => []);
        const rows = await getAttendanceForRange(
          myProfileId,
          selectedPayslip.periodStart,
          selectedPayslip.periodEnd,
          {
            requiredCheckIn: schedule?.requiredCheckIn,
            requiredCheckOut: schedule?.requiredCheckOut,
            workingHours: schedule?.workingHours,
            mealMinutes: schedule?.mealMinutes,
            daysOff: schedule?.offDays,
            holidayDates: holidays.map((h) => h.date),
            pendingCorrectionDates: pendingCorrections.filter((c) => c.profileId === myProfileId).map((c) => c.workDate),
          }
        );
        if (cancelled) return;
        const rate = selectedPayslip.hourlyRate;
        // Regular vs OT split per Sunday–Saturday WEEK at 40 hours — the same
        // rule the payslip's gross uses (everyone, PH included, OT at 1.5×,
        // since 2026-10-22). This used to split each DAY at 8 hours, so the
        // day rows showed OT the gross didn't have (four 10-hour days: 8 OT
        // hours in the rows, none in the gross).
        const split = splitRegularOvertimeWeekly(
          rows.map((r) => ({ date: r.date, rawHours: r.hoursWorked })),
          {},
          8,
          CSR_WEEKLY_OVERTIME_THRESHOLD
        );
        const daily: PayslipDailyRow[] = rows
          .filter((r) => r.hoursWorked > 0)
          .map((r) => {
            const { regular, overtime } = split.get(r.date) ?? { regular: r.hoursWorked, overtime: 0 };
            return {
              date: r.date,
              clockIn: r.clockIn,
              clockOut: r.clockOut,
              mealStart: r.mealStart,
              mealEnd: r.mealEnd,
              hours: r.hoursWorked,
              rate,
              amount: regular * rate + overtime * rate * 1.5,
            };
          });
        setPayslipDailyRows(daily);
      } catch (err) {
        console.error("Failed to load payslip daily breakdown:", err);
        if (!cancelled) setPayslipDailyRows([]);
      } finally {
        if (!cancelled) setPayslipDailyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [payslipModalOpen, selectedPayslip, myProfileId, uid]);

  const payslipData: EmployeePayslipData | null = selectedPayslip ? (() => {
    const counts = payslipDailyRows.length;
    const totalHours = payslipDailyRows.reduce((s, r) => s + r.hours, 0);
    const average = counts > 0 ? totalHours / counts : 0;
    const myOffDays = companyProfiles.find((p) => p.id === myProfileId)?.off_days ?? [];
    const offDays = offDaysInRange(myOffDays, selectedPayslip.periodStart, selectedPayslip.periodEnd);
    const ptoUsed = ptoDaysInRange(myPtoRequests, selectedPayslip.periodStart, selectedPayslip.periodEnd, false);
    const sickLeave = ptoDaysInRange(myPtoRequests, selectedPayslip.periodStart, selectedPayslip.periodEnd, true);
    const workingHoursLabel =
      myScheduleInfo?.requiredCheckIn && myScheduleInfo?.requiredCheckOut
        ? `${formatClockTime(myScheduleInfo.requiredCheckIn)} - ${formatClockTime(myScheduleInfo.requiredCheckOut)}`
        : "—";
    const breakLabel = myScheduleInfo?.mealMinutes ? `${myScheduleInfo.mealMinutes} mins Break` : "—";
    // Same US/PH split as AccountingDashboard.tsx's payrollRows: anyone not
    // assigned to the Philippines branch is treated as US.
    const isUS = (companyProfiles.find((p) => p.id === myProfileId)?.assigned_branch ?? "") !== "Philippines";
    return {
      name: displayName || "Employee",
      department: ROLE_LABELS[role || ""] || role || "",
      period: `${selectedPayslip.periodStart} to ${selectedPayslip.periodEnd}`,
      generatedDate: selectedPayslip.generatedAt ? new Date(selectedPayslip.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "",
      dailyRows: payslipDailyRows,
      grossPay: selectedPayslip.grossPay,
      netPay: selectedPayslip.netPay,
      email: email || "—",
      hireDate: myHireDate || "—",
      workingHoursLabel,
      breakLabel,
      hourlyRate: selectedPayslip.hourlyRate,
      compensationType: selectedPayslip.compensationType,
      annualSalary: selectedPayslip.annualSalary,
      counts,
      totalHours,
      average,
      offDays,
      ptoUsed,
      sickLeave,
      totalDays: offDays + ptoUsed,
      extraPay: selectedPayslip.extraPay,
      // Payroll's note for this period (migration 0399) first, then the run line's own note.
      notes: [noteForPeriod(selectedPayslip.periodStart, selectedPayslip.periodEnd)?.body, selectedPayslip.notes]
        .filter(Boolean)
        .map((t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
        .join("\n\n"),
      adjustments: selectedPayslip.adjustments,
      isUS,
    };
  })() : null;

  const handleDownloadPayslip = () => {
    if (!iframeRef.current) return;
    const payslipHtml = iframeRef.current.contentWindow?.document.documentElement.innerHTML;
    if (!payslipHtml) return;

    const element = document.createElement("a");
    const file = new Blob([payslipHtml], { type: "text/html" });
    element.href = URL.createObjectURL(file);
    element.download = `Payslip-${payslipData?.name || "employee"}-${Date.now()}.html`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(element.href);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={goBack} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </button>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              {sub.title}
            </h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
          <button
            type="button"
            onClick={() => void runTour(SELF_SERVICE_TOUR, tourOpts)}
            title="Take a guided tour of this page"
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-sky-400/40 bg-sky-500/15 px-2.5 py-1.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/25"
          >
            <Compass className="h-4 w-4" /> Tour
          </button>
        </div>

        {/* Notes from Payroll — above the tabs so they can't be missed; each
            stays until the employee clicks "I've read this". */}
        {unreadPayrollNotes.length > 0 && (
          <div className="mb-6 space-y-3">
            {unreadPayrollNotes.map((note) => (
              <div key={note.id} className="bg-amber-500/15 border-2 border-amber-400/60 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-300 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-200">
                    Note from Payroll · {note.periodStart} to {note.periodEnd} pay
                  </div>
                  <div className="mt-1 text-sm text-amber-50 whitespace-pre-wrap">{note.body}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAcknowledgeNote(note)}
                  disabled={ackingNoteId === note.id}
                  className="shrink-0 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  {ackingNoteId === note.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  I've read this
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div data-tour="ess-tabs" className="flex gap-2 mb-8 border-b border-white/10 overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 border-b-2 transition whitespace-nowrap flex items-center gap-2 ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-300"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <div data-tour="ess-summary" className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">Current Payroll</p>
                <p className="text-2xl font-bold text-green-300">{myPayslips[0] ? `$${myPayslips[0].netPay.toFixed(2)}` : "—"}</p>
                <p className="text-xs text-slate-400 mt-1">{myPayslips[0] ? `${myPayslips[0].periodStart} to ${myPayslips[0].periodEnd}` : "No payroll yet"}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">PTO Remaining</p>
                <p className="text-2xl font-bold text-blue-300">
                  {myPtoYear ? `${myPtoRemaining} of ${myPtoYear.allowance} days` : "—"}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {myPtoYear ? `Year ${myPtoYear.tenureYear} · resets ${myPtoYear.end}` : "Not yet eligible"}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">Attendance Rate</p>
                <p className="text-2xl font-bold text-amber-300">98.5%</p>
                <p className="text-xs text-slate-400 mt-1">This month</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">Lates</p>
                <p className="text-2xl font-bold text-orange-300">2</p>
                <p className="text-xs text-slate-400 mt-1">This month</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">Absences</p>
                <p className="text-2xl font-bold text-red-300">1</p>
                <p className="text-xs text-slate-400 mt-1">This month</p>
              </div>
            </div>

            {/* Attendance Summary Detail */}
            <div data-tour="ess-dashboard-detail" className="grid gap-4 md:grid-cols-2">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Total Attendances</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Days Worked</span>
                    <span className="text-green-300 font-semibold">19</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Total Hours</span>
                    <span className="text-blue-300 font-semibold">152.5 hrs</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Average Per Day</span>
                    <span className="text-purple-300 font-semibold">8.03 hrs</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Pending Requests</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Awaiting Approval</span>
                    <span className="text-yellow-300 font-semibold">1</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Already Approved</span>
                    <span className="text-green-300 font-semibold">2</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Rejected</span>
                    <span className="text-red-300 font-semibold">1</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Payroll Tab */}
        {activeTab === "payroll" && (
          <div className="space-y-6">
            {/* Current Payroll with Payslip View */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-400" />
                {myPayslips[0] ? `Current Payroll (${myPayslips[0].periodStart} to ${myPayslips[0].periodEnd})` : "Current Payroll"}
              </h3>
              {requestsLoading ? (
                <p className="text-xs text-slate-400 py-4">Loading…</p>
              ) : !myPayslips[0] ? (
                <p className="text-xs text-slate-400 py-4">No payroll has been generated for you yet.</p>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Gross Pay</p>
                      <p className="text-lg font-semibold text-blue-300">${myPayslips[0].grossPay.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Deductions</p>
                      <p className="text-lg font-semibold text-red-300">-${(myPayslips[0].grossPay - myPayslips[0].netPay).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Net Pay</p>
                      <p className="text-lg font-semibold text-green-300">${myPayslips[0].netPay.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Overtime</p>
                      <p className="text-lg font-semibold text-amber-300">${myPayslips[0].overtimePay.toFixed(2)}</p>
                    </div>
                  </div>
                  {(() => {
                    const note = noteForPeriod(myPayslips[0].periodStart, myPayslips[0].periodEnd);
                    return note?.acknowledgedAt ? (
                      <div className="mb-4 border border-amber-400/30 bg-amber-500/5 rounded-lg px-3 py-2 text-xs text-amber-100 whitespace-pre-wrap">
                        <span className="font-semibold text-amber-200">Note from Payroll: </span>{note.body}
                      </div>
                    ) : null;
                  })()}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-tour="ess-view-payslip"
                      onClick={() => handleViewPayslip(myPayslips[0].runId)}
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center justify-center gap-2"
                    >
                      <FileText className="h-3 w-3" />
                      View Payslip
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePayDetails(myPayslips[0].runId)}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold transition"
                    >
                      {openPayDetails.has(myPayslips[0].runId) ? "Hide pay details" : "Pay details"}
                    </button>
                  </div>
                  {openPayDetails.has(myPayslips[0].runId) && myProfileId && (
                    <div className="mt-4">
                      <MyPayDetails
                        profileId={myProfileId}
                        periodStart={myPayslips[0].periodStart}
                        periodEnd={myPayslips[0].periodEnd}
                        fallbackHours={{ regular: myPayslips[0].hoursWorked, overtime: myPayslips[0].overtimeHours }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Previous Payroll History */}
            <div data-tour="ess-payroll-history" className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Previous Payroll History</h3>
              {myPayslips.length <= 1 ? (
                <p className="text-xs text-slate-400">No earlier payroll history yet.</p>
              ) : (
                <div className="space-y-3">
                  {myPayslips.slice(1).map(payroll => (
                    <div key={payroll.runId} className="border border-white/10 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">{payroll.periodStart} to {payroll.periodEnd}</p>
                          <p className="text-xs text-slate-400">{payroll.generatedAt ? new Date(payroll.generatedAt).toLocaleDateString() : ""}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-bold text-green-300">${payroll.netPay.toFixed(2)}</p>
                            <p className="text-xs text-slate-400">Net Pay</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => togglePayDetails(payroll.runId)}
                            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold transition"
                          >
                            {openPayDetails.has(payroll.runId) ? "Hide details" : "Details"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleViewPayslip(payroll.runId)}
                            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold transition"
                          >
                            View
                          </button>
                        </div>
                      </div>
                      {(() => {
                        const note = noteForPeriod(payroll.periodStart, payroll.periodEnd);
                        return note?.acknowledgedAt ? (
                          <div className="mt-2 text-xs text-amber-100/90 whitespace-pre-wrap">
                            <span className="font-semibold text-amber-200">Note from Payroll: </span>{note.body}
                          </div>
                        ) : null;
                      })()}
                      {openPayDetails.has(payroll.runId) && myProfileId && (
                        <div className="mt-3">
                          <MyPayDetails
                            profileId={myProfileId}
                            periodStart={payroll.periodStart}
                            periodEnd={payroll.periodEnd}
                            fallbackHours={{ regular: payroll.hoursWorked, overtime: payroll.overtimeHours }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Attendance Tab */}
        {activeTab === "attendance" && (
          <div className="space-y-6">
            {/* Missed clock-in / clock-out warning */}
            {missingAttendance.length > 0 && !warningDismissed && (
              <div className="bg-amber-500/10 border border-amber-400/40 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-300 mt-0.5 shrink-0" />
                <div className="flex-1 text-sm text-amber-100">
                  <div className="font-semibold">
                    {missingAttendance.length} day{missingAttendance.length === 1 ? "" : "s"} missing
                    {missingAttendance.some((r) => r.status === "missing-in") ? " a clock-in" : ""}
                    {missingAttendance.some((r) => r.status === "missing-in") &&
                    missingAttendance.some((r) => r.status === "missing-out") ? " /" : ""}
                    {missingAttendance.some((r) => r.status === "missing-out") ? " a clock-out" : ""}.
                  </div>
                  <div className="mt-1 text-amber-200/80">
                    {missingAttendance.slice(0, 5).map((r) => r.date).join(", ")}
                    {missingAttendance.length > 5 ? `, +${missingAttendance.length - 5} more` : ""}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Link
                      to="/timecard"
                      className="px-3 py-1.5 rounded bg-amber-500/30 hover:bg-amber-500/40 text-amber-100 text-xs font-semibold transition"
                    >
                      Fix in My Timecard
                    </Link>
                    <button
                      onClick={() => setWarningDismissed(true)}
                      className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-amber-100/80 text-xs font-semibold transition"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div data-tour="ess-att-views" className="flex gap-2 flex-wrap items-center">
              <button
                onClick={() => setAttendanceView("daily")}
                className={`px-4 py-2 rounded text-xs font-semibold transition ${
                  attendanceView === "daily"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                Daily Attendance
              </button>
              <button
                onClick={() => setAttendanceView("monthly")}
                className={`px-4 py-2 rounded text-xs font-semibold transition ${
                  attendanceView === "monthly"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                Monthly Attendance
              </button>
              <button
                onClick={() => setShowLoginLogout(!showLoginLogout)}
                className={`px-4 py-2 rounded text-xs font-semibold transition ${
                  showLoginLogout
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                Login/Logout History
              </button>
              <Link
                to="/timecard"
                className="ml-auto px-4 py-2 rounded text-xs font-semibold bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/30 transition inline-flex items-center gap-2"
              >
                <Clock className="h-3.5 w-3.5" />
                Open My Timecard
              </Link>
            </div>

            {attendanceView === "daily" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Daily Attendance (last 30 days)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="px-3 py-2 text-left font-semibold text-slate-400">Date</th>
                        <th className="px-3 py-2 text-center font-semibold text-slate-400">Clock In</th>
                        <th className="px-3 py-2 text-center font-semibold text-slate-400">Clock Out</th>
                        <th className="px-3 py-2 text-center font-semibold text-slate-400">Hours</th>
                        <th className="px-3 py-2 text-center font-semibold text-slate-400">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveAttendance.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                            No attendance recorded yet. Open My Timecard to log your hours.
                          </td>
                        </tr>
                      )}
                      {liveAttendance.slice().reverse().map((record) => {
                        const statusLabel: Record<AttendanceRow["status"], { label: string; className: string }> = {
                          present: { label: "✓ Present", className: "bg-green-500/20 text-green-300" },
                          absent: { label: "Absent", className: "bg-red-500/20 text-red-300" },
                          "missing-in": { label: "Missing Time-In", className: "bg-amber-500/20 text-amber-300" },
                          "missing-out": { label: "Missing Time-Out", className: "bg-amber-500/20 text-amber-300" },
                          "missing-meal": { label: "Meal Not Taken", className: "bg-orange-500/20 text-orange-300" },
                          "day-off": { label: "Rest Day", className: "bg-slate-500/20 text-slate-300" },
                          holiday: { label: "Holiday", className: "bg-purple-500/20 text-purple-300" },
                          "pending-correction": { label: "Pending Time Correction Request", className: "bg-amber-500/20 text-amber-300" },
                          "paid-leave": { label: "Paid Leave", className: "bg-sky-500/20 text-sky-300" },
                          "unpaid-leave": { label: "Unpaid Leave", className: "bg-orange-500/20 text-orange-300" },
                        };
                        const meta = statusLabel[record.status];
                        return (
                          <tr key={record.date} className="border-b border-white/10 hover:bg-white/5">
                            <td className="px-3 py-2 text-white">{record.date}</td>
                            <td className="px-3 py-2 text-center text-slate-300">{record.clockIn || "—"}</td>
                            <td className="px-3 py-2 text-center text-slate-300">{record.clockOut || "—"}</td>
                            <td className="px-3 py-2 text-center text-slate-300">{record.hoursWorked.toFixed(2)}h</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${meta.className}`}>
                                {meta.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  data-tour="ess-att-download"
                  onClick={() => handleDownload("attendance")}
                  className="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center justify-center gap-2"
                >
                  <Download className="h-3 w-3" />
                  Download Attendance Report
                </button>
              </div>
            )}

            {attendanceView === "monthly" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Monthly Attendance Summary - June 2026</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="bg-slate-800/50 rounded p-3">
                    <p className="text-xs text-slate-400 mb-1">Total Days Worked</p>
                    <p className="text-2xl font-bold text-blue-300">19</p>
                  </div>
                  <div className="bg-slate-800/50 rounded p-3">
                    <p className="text-xs text-slate-400 mb-1">Total Hours</p>
                    <p className="text-2xl font-bold text-green-300">152.5</p>
                  </div>
                  <div className="bg-slate-800/50 rounded p-3">
                    <p className="text-xs text-slate-400 mb-1">Attendance Rate</p>
                    <p className="text-2xl font-bold text-amber-300">98.5%</p>
                  </div>
                </div>
              </div>
            )}

            {showLoginLogout && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Login/Logout History</h3>
                <div className="space-y-2">
                  {LOGIN_LOGOUT_HISTORY.map((record, idx) => (
                    <div key={idx} className="flex justify-between text-sm border-b border-white/10 pb-2 last:border-0">
                      <span className="text-slate-300">{record.date} - {record.time}</span>
                      <span className={record.type === "login" ? "text-green-300 font-semibold" : "text-red-300 font-semibold"}>
                        {record.type === "login" ? "→ Login" : "← Logout"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attendance Summary */}
            <div data-tour="ess-att-summary" className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Attendance Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-300">Present Days</span>
                  <span className="text-white font-semibold">19</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Absent Days</span>
                  <span className="text-white font-semibold">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">PTO Days</span>
                  <span className="text-white font-semibold">1</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Requests Tab */}
        {activeTab === "requests" && (
          <div className="space-y-6">
            {/* Request Summary */}
            <div data-tour="ess-req-summary" className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
              <button
                type="button"
                onClick={() => setSummaryModal("pto")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-blue-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">PTO Remaining</p>
                <p className="text-2xl font-bold text-blue-300">
                  {myPtoYear ? `${myPtoRemaining} of ${myPtoYear.allowance}` : "—"}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {myPtoYear ? `Year ${myPtoYear.tenureYear} · resets ${myPtoYear.end}` : "Not yet eligible"}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSummaryModal("sick")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-teal-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Sick Leave Remaining</p>
                <p className="text-2xl font-bold text-teal-300">
                  {mySickYear ? `${mySickRemaining} of ${mySickYear.allowance}` : "—"}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {mySickYear ? `Year ${mySickYear.tenureYear} · resets ${mySickYear.end}` : "—"}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSummaryModal("pending")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-yellow-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Pending</p>
                <p className="text-2xl font-bold text-yellow-300">{filteredMyRequests.filter(r => r.status === "pending").length}</p>
              </button>
              <button
                type="button"
                onClick={() => setSummaryModal("approved")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-green-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Approved</p>
                <p className="text-2xl font-bold text-green-300">{filteredMyRequests.filter(r => r.status === "approved").length}</p>
              </button>
              <button
                type="button"
                onClick={() => setSummaryModal("rejected")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-red-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Rejected</p>
                <p className="text-2xl font-bold text-red-300">{filteredMyRequests.filter(r => r.status === "rejected").length}</p>
              </button>
              <button
                type="button"
                onClick={() => setSummaryModal("closed")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-slate-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Closed</p>
                <p className="text-2xl font-bold text-slate-300">{filteredMyRequests.filter(r => r.status === "closed").length}</p>
              </button>
            </div>

            {/* Submit Request Buttons */}
            {!ptoEligible && (
              <div className="bg-amber-500/10 border border-amber-400/40 rounded-lg p-3 text-xs text-amber-100">
                You're not yet eligible for PTO — employees need 1 year of tenure first. You'll be eligible starting {ptoEligibleOn}.
              </div>
            )}
            {myPtoUsedUp && myPtoYear && (
              <div className="bg-amber-500/10 border border-amber-400/40 rounded-lg p-3 text-xs text-amber-100">
                You've used all {myPtoYear.allowance} PTO days for Year {myPtoYear.tenureYear} (approved or still pending). PTO requests reopen on {myPtoYear.end}. Unpaid Leave is still available.
              </div>
            )}
            <div data-tour="ess-req-buttons" className="grid gap-3 md:grid-cols-2">
              <button data-tour="ess-req-pto"
                type="button"
                onClick={() => {
                  const myProfile = companyProfiles.find((p) => p.id === myProfileId);
                  setFormData((prev) => ({
                    ...prev,
                    position: myProfile?.role || prev.position,
                    branch: myProfile?.assigned_branch || prev.branch,
                  }));
                  setModalType("pto");
                  setShowModal(true);
                }}
                disabled={!ptoEligible || myPtoUsedUp}
                title={!ptoEligibilityKnown ? "Checking PTO eligibility…" : !ptoEligible ? `Not eligible until ${ptoEligibleOn} — PTO needs 1 year with the company` : myPtoUsedUp && myPtoYear ? `No PTO days left — resets ${myPtoYear.end}` : undefined}
                className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                PTO Request
              </button>
              <button data-tour="ess-req-sick"
                type="button"
                onClick={() => {
                  const myProfile = companyProfiles.find((p) => p.id === myProfileId);
                  setFormData((prev) => ({
                    ...prev,
                    position: myProfile?.role || prev.position,
                    branch: myProfile?.assigned_branch || prev.branch,
                  }));
                  setModalType("sick");
                  setShowModal(true);
                  leaveSigPad.clear();
                }}
                className="px-4 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Sick Leave Request
              </button>
              <button data-tour="ess-req-correction"
                onClick={() => { setModalType("correction"); setShowModal(true); correctionSigPad.clear(); }}
                className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Time Correction Request
              </button>
              <button data-tour="ess-req-unpaid"
                type="button"
                onClick={() => {
                  const myProfile = companyProfiles.find((p) => p.id === myProfileId);
                  setFormData((prev) => ({
                    ...prev,
                    position: myProfile?.role || prev.position,
                    branch: myProfile?.assigned_branch || prev.branch,
                  }));
                  setModalType("unpaidLeave");
                  setShowModal(true);
                  leaveSigPad.clear();
                }}
                className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Unpaid Leave Request
              </button>
            </div>

            {/* Requests List */}
            <div data-tour="ess-track-status" className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white">Track Status</h3>
                <select
                  title="Filter by request type"
                  value={requestTypeFilter}
                  onChange={(e) => setRequestTypeFilter(e.target.value as typeof requestTypeFilter)}
                  className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Types</option>
                  <option value="PTO Request">PTO Request</option>
                  <option value="Sick Leave Request">Sick Leave Request</option>
                  <option value="Time Correction">Time Correction</option>
                  <option value="Attendance Dispute">Attendance Dispute</option>
                  <option value="Payroll Inquiry">Payroll Inquiry</option>
                </select>
              </div>
              {requestsLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : filteredMyRequests.length === 0 ? (
                <p className="text-sm text-slate-400">{myRequests.length === 0 ? "No requests submitted yet." : "No requests match this filter."}</p>
              ) : (
                <div className="space-y-3">
                  {filteredMyRequests.map(request => (
                    <div key={request.id} className="border border-white/10 rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{request.type}</p>
                          <p className="text-xs text-slate-400 mt-1">Submitted: {request.submittedDate}</p>
                          <p className="text-sm text-slate-300 mt-2 whitespace-pre-line">{request.details}</p>
                          {request.status === "rejected" && (
                            <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Reason rejected</p>
                              <p className="text-sm text-red-100 whitespace-pre-line">{request.rejectionReason || "No reason was given."}</p>
                            </div>
                          )}
                        </div>
                        <span className={`px-3 py-1 rounded text-xs font-semibold whitespace-nowrap ml-3 ${getStatusColor(request.status)}`}>
                          {getStatusIcon(request.status)} {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* My Expenses Tab — expenses to be reimbursed; Accounting approves /
            rejects / marks them reimbursed under Accounting → Expenses →
            Employee Requests. */}
        {activeTab === "expenses" && (
          <div className="space-y-6">
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                onClick={() => setExpenseFilter("Approved")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-sky-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Reimbursement Due</p>
                <p className="text-2xl font-bold text-sky-300">{fmtMoney(myReimbursement.approved)}</p>
                <p className="text-xs text-slate-500 mt-1">{myReimbursement.approvedCount} approved, waiting to be paid</p>
              </button>
              <button
                type="button"
                onClick={() => setExpenseFilter("Pending")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-yellow-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">In Review</p>
                <p className="text-2xl font-bold text-yellow-300">{fmtMoney(myReimbursement.pending)}</p>
                <p className="text-xs text-slate-500 mt-1">{myReimbursement.pendingCount} waiting for Accounting</p>
              </button>
              <button
                type="button"
                onClick={() => setExpenseFilter("Reimbursed")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-green-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Reimbursed</p>
                <p className="text-2xl font-bold text-green-300">{fmtMoney(myReimbursement.reimbursed)}</p>
                <p className="text-xs text-slate-500 mt-1">{myReimbursement.reimbursedCount} paid back to you</p>
              </button>
              <button
                type="button"
                onClick={() => setExpenseFilter("Rejected")}
                className="bg-slate-900/50 border border-white/10 rounded-lg p-4 text-left hover:border-red-400/40 hover:bg-slate-900/80 transition"
              >
                <p className="text-xs text-slate-400 mb-1">Rejected</p>
                <p className="text-2xl font-bold text-red-300">{myReimbursement.rejectedCount}</p>
                <p className="text-xs text-slate-500 mt-1">see the reason on each one</p>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setExpenseForm({ editing: null })}
              disabled={!myProfileId}
              className="w-full px-4 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Expense Request
            </button>

            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4 gap-3">
                <h3 className="text-sm font-bold text-white">My Expenses</h3>
                <select
                  title="Filter by status"
                  value={expenseFilter}
                  onChange={(e) => setExpenseFilter(e.target.value as typeof expenseFilter)}
                  className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All</option>
                  <option value="Pending">In Review</option>
                  <option value="Approved">Approved — to be paid</option>
                  <option value="Reimbursed">Reimbursed</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
              {myExpensesLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : visibleExpenses.length === 0 ? (
                <p className="text-sm text-slate-400">
                  {myExpenses.length === 0 ? "No expenses yet. Use Expense Request to send one to Accounting with its receipt." : "No expenses with this status."}
                </p>
              ) : (
                <div className="space-y-3">
                  {visibleExpenses.map((e) => {
                    const route = [e.fromLocation, e.toLocation].filter(Boolean).join(" → ");
                    const reviewer = e.reviewedBy ? profileName(e.reviewedBy) : "Accounting";
                    const reviewedOn = e.reviewedAt ? ` · ${fmtExpenseReviewedAt(e.reviewedAt)}` : "";
                    const canChange = e.status === "Pending" && e.createdBy === myProfileId;
                    return (
                      <div key={e.id} className="border border-white/10 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-lg font-bold text-white font-mono">{fmtMoney(e.amount)}</p>
                            <p className="text-sm text-slate-300">{e.category}{reimbursementTypeLabel(e) ? ` · ${reimbursementTypeLabel(e)}` : ""} · {e.expenseDate}</p>
                            {e.description && <p className="text-sm text-slate-400 mt-1 break-words">{e.description}</p>}
                            {(route || e.orNumber) && (
                              <p className="text-xs text-slate-500 mt-1">{[route, e.orNumber ? `OR# ${e.orNumber}` : ""].filter(Boolean).join(" · ")}</p>
                            )}
                            <p className="text-xs mt-2">
                              {e.status === "Pending" && <span className="text-slate-400">Sent {e.createdAt.slice(0, 10)} · waiting for Accounting to review</span>}
                              {e.status === "Approved" && <span className="text-sky-300">Approved by {reviewer}{reviewedOn} · waiting to be reimbursed</span>}
                              {e.status === "Reimbursed" && <span className="text-green-300">Approved by {reviewer}{reviewedOn} · reimbursed ✓</span>}
                              {e.status === "Rejected" && <span className="text-red-300">Rejected by {reviewer}{reviewedOn}</span>}
                            </p>
                            {e.status === "Rejected" && (
                              <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Reason rejected</p>
                                <p className="text-sm text-red-100 whitespace-pre-line">{e.reviewNote || "No reason was given."}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-3 mt-2">
                              {e.receiptUrl && (
                                <button type="button" onClick={() => setPreviewReceiptUrl(e.receiptUrl)} className="inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200">
                                  <Paperclip className="h-3.5 w-3.5" /> View receipt
                                </button>
                              )}
                              {canChange && (
                                <>
                                  <button type="button" onClick={() => setExpenseForm({ editing: e })} className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white">
                                    <Pencil className="h-3 w-3" /> Edit
                                  </button>
                                  <button type="button" onClick={() => handleDeleteExpense(e)} disabled={deletingExpenseId === e.id} className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-red-300 disabled:opacity-50">
                                    {deletingExpenseId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <span className={`px-2.5 py-1 rounded border text-xs font-semibold whitespace-nowrap ${EXPENSE_STATUS_STYLE[e.status]}`}>
                            {EXPENSE_STATUS_LABEL[e.status]}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Request Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !submitSuccess && setShowModal(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {!submitSuccess ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-white">
                    {modalType === "pto" && "Submit PTO Request"}
                    {modalType === "sick" && "Submit Sick Leave Request"}
                    {modalType === "correction" && "Submit Time Correction Request"}
                    {modalType === "unpaidLeave" && "Submit Unpaid Leave Request"}
                  </h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-slate-400 hover:text-white transition"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {(modalType === "pto" || modalType === "sick" || modalType === "unpaidLeave") && (
                    <>
                      {modalType === "pto" && (
                        <div data-tour="ess-form-leave-type">
                          <label className="text-xs font-semibold text-white block mb-1">Leave Type</label>
                          <select
                            value={formData.leaveType}
                            onChange={(e) => setFormData({ ...formData, leaveType: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          >
                            <option>Vacation</option>
                          </select>
                        </div>
                      )}
                      <div data-tour="ess-form-position" className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Position</label>
                          {/* Always their primary position — not editable. */}
                          <input
                            type="text"
                            readOnly
                            value={formData.position ? ROLE_LABELS[formData.position] || ROLE_LABELS[normalizeRole(formData.position)] || formData.position : "Loading…"}
                            title="Your primary position (from your profile)"
                            className="w-full px-3 py-2 bg-slate-800/60 border border-white/10 rounded text-slate-300 text-sm cursor-not-allowed"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Branch</label>
                          <select 
                            value={formData.branch}
                            onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          >
                            {LOCATIONS.map((location) => (
                              <option key={location} value={location}>
                                {location}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div data-tour="ess-form-dates" className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Start Date</label>
                          <input 
                            type="date" 
                            value={formData.startDate}
                            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500" 
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">End Date</label>
                          <input 
                            type="date"
                            value={formData.endDate}
                            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      {modalType === "pto" && formData.startDate && formData.endDate && formData.startDate <= formData.endDate && (() => {
                        const days = workingDayCount(formData.startDate, formData.endDate, companyProfiles.find((p) => p.id === myProfileId)?.off_days);
                        return (
                          <p className={`text-xs ${myPtoYear && days > myPtoRemaining ? "text-red-300" : "text-slate-400"}`}>
                            Counts as {days} PTO day{days === 1 ? "" : "s"}. Your rest days (Sat/Sun unless your schedule says otherwise) aren't counted.
                            {myPtoYear && ` You have ${myPtoRemaining} left.`}
                          </p>
                        );
                      })()}
                    </>
                  )}
                  {modalType === "correction" && (
                    <>
                      <div data-tour="ess-form-corr-date">
                        <label className="text-xs font-semibold text-white block mb-1">Date</label>
                        <input
                          type="date"
                          title="Date"
                          max={correctionWindow?.today ?? zonedDateKey(new Date(), companyProfiles.find((p) => p.id === myProfileId)?.schedule_timezone === "EST" ? "EST" : "CST")}
                          min={correctionWindow?.earliest ?? selfCorrectionEarliestDate(zonedDateKey(new Date(), companyProfiles.find((p) => p.id === myProfileId)?.schedule_timezone === "EST" ? "EST" : "CST"), false)}
                          value={formData.correctionDate}
                          onChange={(e) => setFormData({ ...formData, correctionDate: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          {correctionWindow?.fridayOpen
                            ? "You have no Saturday or Sunday timecard, so you can still correct back to Friday. Older days: contact HR."
                            : correctionWindow?.clockedOutToday
                              ? "You've clocked out today, so you can correct today or yesterday. Older days: contact HR."
                              : "You can correct today or up to 2 days back (only today and yesterday once you've clocked out today). Older days: contact HR."}
                        </p>
                        {formData.correctionDate && (
                          <p className="text-xs text-slate-500 mt-1">
                            {(() => {
                              const existing = liveAttendance.find((a) => a.date === formData.correctionDate);
                              return existing
                                ? `Current record: ${existing.clockIn || "—"} → ${existing.clockOut || "—"} (meal: ${existing.mealStart || "—"} → ${existing.mealEnd || "—"})`
                                : "No existing record found for this date.";
                            })()}
                          </p>
                        )}
                      </div>
                      <div data-tour="ess-form-corr-times" className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Corrected Check In</label>
                          <input
                            type="time"
                            step="1"
                            title="Corrected Check In"
                            value={formData.correctedCheckIn}
                            onChange={(e) => setFormData({ ...formData, correctedCheckIn: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Corrected Check Out</label>
                          <input
                            type="time"
                            step="1"
                            title="Corrected Check Out"
                            value={formData.correctedCheckOut}
                            onChange={(e) => setFormData({ ...formData, correctedCheckOut: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <div data-tour="ess-form-corr-meal" className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Corrected Meal Start {correctionMealRequired && <span className="text-red-400">*</span>}</label>
                          <input
                            type="time"
                            step="1"
                            title="Corrected Meal Start"
                            value={formData.correctedMealStart}
                            onChange={(e) => setFormData({ ...formData, correctedMealStart: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Corrected Meal End {correctionMealRequired && <span className="text-red-400">*</span>}</label>
                          <input
                            type="time"
                            step="1"
                            title="Corrected Meal End"
                            value={formData.correctedMealEnd}
                            onChange={(e) => setFormData({ ...formData, correctedMealEnd: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <p className={`text-[10px] ${correctionMealRequired ? "text-amber-300" : "text-slate-500"}`}>
                        {correctionShift === null
                          ? "Fill in only the punch(es) you need corrected — a blank one keeps what's on your timecard. Meal start/end are required only when the shift is over 6 hours."
                          : correctionMealRequired
                          ? `Shift is ${formatShift(correctionShift)} — over 6 hours, so meal start and end are required.`
                          : `Shift is ${formatShift(correctionShift)} — meal break optional (required only over 6 hours).`}
                      </p>
                    </>
                  )}
                  {(modalType === "correction" || modalType === "sick" || modalType === "unpaidLeave") && (
                    <>
                      {(() => {
                        const myProfile = companyProfiles.find((p) => p.id === myProfileId) ?? null;
                        return (
                          <div>
                            <label className="text-xs font-semibold text-white block mb-1">Technician ID</label>
                            {myProfile?.technician_id ? (
                              <input
                                type="text"
                                value={myProfile.technician_id}
                                readOnly
                                disabled
                                title="Auto-filled from your profile"
                                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm opacity-70"
                              />
                            ) : (
                              <input
                                type="text"
                                placeholder="Not on file — type it in"
                                value={formData.employeeIdOverride}
                                onChange={(e) => setFormData({ ...formData, employeeIdOverride: e.target.value })}
                                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
                              />
                            )}
                          </div>
                        );
                      })()}
                      <div data-tour="ess-form-issue">
                        <label className="text-xs font-semibold text-white block mb-1">{modalType === "correction" ? "Issue" : "Exception Type"}</label>
                        <div className="flex flex-col gap-1.5">
                          {(modalType === "correction"
                            ? (Object.keys(CORRECTION_ISSUE_LABELS) as CorrectionIssueType[]).map((t) => [t, t === "other" ? "Other: Specify" : CORRECTION_ISSUE_LABELS[t]] as const)
                            : (Object.keys(EXCEPTION_TYPE_LABELS) as ExceptionType[]).map((t) => [t, EXCEPTION_TYPE_LABELS[t]] as const)
                          ).map(([t, label]) => (
                            <label key={t} className="flex items-center gap-2 text-sm text-white">
                              <input
                                type="radio"
                                name="correctionExceptionType"
                                checked={formData.exceptionType === t}
                                onChange={() => setFormData({ ...formData, exceptionType: t })}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                        {formData.exceptionType === "other" && (
                          <input
                            type="text"
                            placeholder={modalType === "correction" ? "Specify the issue…" : "Describe the exception…"}
                            value={formData.otherDescription}
                            onChange={(e) => setFormData({ ...formData, otherDescription: e.target.value })}
                            className="w-full mt-2 px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
                          />
                        )}
                      </div>
                    </>
                  )}
                  <div data-tour="ess-form-reason">
                    <label className="text-xs font-semibold text-white block mb-1">Details / Reason</label>
                    <textarea
                      placeholder="Please provide details..."
                      value={formData.details}
                      onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    />
                  </div>
                  {modalType === "correction" && (
                    <div>
                      <label className="text-xs font-semibold text-white block mb-2">
                        Employee Signature — I confirm the information above is accurate and truthful.
                      </label>
                      <canvas
                        {...correctionSigPad.canvasProps}
                        className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-sm ${correctionSigPad.canvasProps.className}`}
                      />
                      <div data-tour="ess-form-sign" className="mt-2">
                        <SignaturePadControls pad={correctionSigPad} />
                      </div>
                    </div>
                  )}
                  {(modalType === "sick" || modalType === "unpaidLeave") && (
                    <div>
                      <label className="text-xs font-semibold text-white block mb-1">
                        Proof (photo or PDF) <span className="text-red-400">*</span>
                      </label>
                      <p className="text-[11px] text-slate-400 mb-2">
                        {modalType === "sick" ? "e.g. a doctor's note or medical certificate." : "A photo or document supporting this leave."}
                      </p>
                      <label className="flex cursor-pointer items-center gap-3 rounded border border-dashed border-white/20 bg-slate-800 px-3 py-2.5 text-sm text-slate-300 hover:border-blue-500">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => setLeaveProof(e.target.files?.[0] ?? null)}
                          disabled={submitting}
                        />
                        {leaveProof && leaveProof.type.startsWith("image/") ? (
                          <img src={URL.createObjectURL(leaveProof)} alt="" className="h-10 w-10 rounded object-cover" />
                        ) : (
                          <FileText className="h-5 w-5 text-slate-400" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{leaveProof ? leaveProof.name : "Choose a photo or PDF…"}</span>
                        {leaveProof && (
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); setLeaveProof(null); }}
                            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                            aria-label="Remove proof"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </label>
                    </div>
                  )}
                  {(modalType === "sick" || modalType === "unpaidLeave") && (
                    <div>
                      <label className="text-xs font-semibold text-white block mb-2">
                        Employee Signature — I confirm the information above is accurate and truthful.
                      </label>
                      <canvas
                        {...leaveSigPad.canvasProps}
                        className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-sm ${leaveSigPad.canvasProps.className}`}
                      />
                      <div data-tour="ess-form-sign-leave" className="mt-2">
                        <SignaturePadControls pad={leaveSigPad} />
                      </div>
                    </div>
                  )}
                </div>

                <div data-tour="ess-form-submit" className="flex gap-3 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    disabled={submitting}
                    className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-semibold transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitRequest}
                    disabled={submitting}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {submitting ? "Submitting…" : "Submit"}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="rounded-full bg-green-500/20 p-3 mb-4">
                  <CheckCircle2 className="h-8 w-8 text-green-300" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Request Submitted</h3>
                <p className="text-sm text-slate-300 text-center">Your request has been submitted successfully. You can track its status in the Track Status section.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expense Request — same form Accounting uses, filed for yourself, receipt required */}
      {expenseForm && myProfileId && (
        <ExpenseFormModal
          editing={expenseForm.editing}
          fixedProfileId={myProfileId}
          requireReceipt
          createdBy={myProfileId}
          companyId={companyId}
          onClose={() => setExpenseForm(null)}
          onSaved={async () => {
            await refreshExpenses(myProfileId);
            if (!expenseForm.editing) setExpenseFilter("all");
          }}
        />
      )}

      {/* Request Summary Modal — drill into one of the Track Status counts */}
      {summaryModal && (() => {
        const titles: Record<typeof summaryModal & string, string> = {
          pto: `PTO Requests — Year ${myPtoYear?.tenureYear ?? "—"}`,
          sick: `Sick Leave Requests — Year ${mySickYear?.tenureYear ?? "—"}`,
          pending: "Pending Requests",
          approved: "Approved Requests",
          rejected: "Rejected Requests",
          closed: "Closed Requests",
        };
        const items =
          summaryModal === "pto"
            ? myRequests.filter((r) => myPtoYearRequestIds.has(r.id))
            : summaryModal === "sick"
              ? myRequests.filter((r) => mySickYearRequestIds.has(r.id))
              : filteredMyRequests.filter((r) => r.status === summaryModal);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSummaryModal(null)}>
            <div
              className="bg-slate-900 border border-white/10 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h3 className="text-sm font-bold text-white">{titles[summaryModal]}</h3>
                <button type="button" onClick={() => setSummaryModal(null)} className="text-slate-400 hover:text-white transition p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto space-y-3">
                {items.length === 0 ? (
                  <p className="text-sm text-slate-400">Nothing here.</p>
                ) : (
                  items.map((request) => (
                    <div key={request.id} className="border border-white/10 rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{request.type}</p>
                          <p className="text-xs text-slate-400 mt-1">Submitted: {request.submittedDate}</p>
                          <p className="text-sm text-slate-300 mt-2 whitespace-pre-line">{request.details}</p>
                          {request.status === "rejected" && (
                            <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Reason rejected</p>
                              <p className="text-sm text-red-100 whitespace-pre-line">{request.rejectionReason || "No reason was given."}</p>
                            </div>
                          )}
                        </div>
                        <span className={`px-3 py-1 rounded text-xs font-semibold whitespace-nowrap ml-3 ${getStatusColor(request.status)}`}>
                          {getStatusIcon(request.status)} {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Payslip Modal */}
      {payslipModalOpen && payslipData && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-lg w-[95vw] h-[95vh] max-w-7xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-white/10">
              <h2 className="text-2xl font-bold text-white">
                {selectedPayslipId === myPayslips[0]?.runId ? "Current Payslip" : "Payslip"}
              </h2>
              <button
                type="button"
                onClick={() => setPayslipModalOpen(false)}
                className="p-1 hover:bg-white/10 rounded transition"
              >
                <X className="h-5 w-5 text-slate-300" />
              </button>
            </div>

            {/* Payslip Content */}
            <div className="flex-1 overflow-y-auto bg-white">
              {payslipDailyLoading ? (
                <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                  Loading payslip…
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  srcDoc={renderPayslipFullHtml(payslipData)}
                  className="w-full h-full border-none"
                  title="Payslip"
                />
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-white/10 px-8 py-6 flex gap-4">
              <button
                onClick={() => setPayslipModalOpen(false)}
                className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-semibold transition"
              >
                Close
              </button>
              <button
                onClick={handleDownloadPayslip}
                className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
              <button
                onClick={() => {
                  if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.print();
                  }
                }}
                className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Last, so it opens above the Request Summary modal too */}
      {previewReceiptUrl && <ReceiptLightbox url={previewReceiptUrl} onClose={() => setPreviewReceiptUrl(null)} />}
    </div>
  );
}
