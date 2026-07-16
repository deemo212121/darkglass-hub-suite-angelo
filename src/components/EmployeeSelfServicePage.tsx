import { ChevronLeft, DollarSign, Clock, ListTodo, Download, Eye, EyeOff, TrendingUp, AlertCircle, CheckCircle2, XCircle, Plus, FileText, X } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getEmployeeFromEmail } from "@/lib/userDataSync";
import { LOCATIONS } from "@/lib/locations";
import {
  type AttendanceRow,
  getAttendanceForRange,
  getMyProfileSchedule,
} from "@/lib/supabase/timecards";
import {
  getCompanyPtoRequests,
  createPtoRequest,
  reviewPtoStage,
  canReviewPtoStage,
  isEligibleForPto,
  ptoEligibleDate,
  ptoYearWindow,
  ptoDaysUsed,
  ptoRequestsInYear,
  weekdayCount,
  type PtoRequestRow,
  type PtoType,
  type PtoStage,
} from "@/lib/supabase/pto";
import {
  getCompanyTimecardCorrections,
  createTimecardCorrection,
  approveTimecardCorrection,
  rejectTimecardCorrection,
  type TimecardCorrectionRow,
} from "@/lib/supabase/timecardCorrections";
import {
  getCompanyEmployeeRequests,
  createEmployeeRequest,
  updateEmployeeRequestStatus,
  type EmployeeRequestRow,
  type EmployeeRequestStatus,
} from "@/lib/supabase/employeeRequests";
import { getCompanyUsers, getProfileEmployeeInfo, type ProfileRow } from "@/lib/supabase/users";
import { createNotification } from "@/lib/supabase/notifications";
import { resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import { getMyPayslips, type MyPayslipRow } from "@/lib/supabase/payslips";
import { ROLE_LABELS } from "@/lib/roleLabels";

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
  status: "pending" | "approved" | "rejected" | "closed";
  submittedDate: string;
  details: string;
}

const PTO_TYPE_LABEL: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick Leave",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

interface PayslipDailyRow {
  date: string;
  clockIn: string;
  clockOut: string;
  mealStart: string;
  mealEnd: string;
  hours: number;
  rate: number;
  amount: number;
}

// Renders a raw "HH:MM" or "HH:MM:SS" capture time as "h:mm AM/PM" for the payslip.
function formatClockTime(t: string): string {
  if (!t) return "—";
  const [h, m, s = 0] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "—";
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} ${period}`;
}

// Zero-padded "HH:MM"/"HH:MM:SS" strings sort chronologically as plain
// strings, so this catches the classic native <input type="time"> mistake
// of leaving the AM/PM half wrong (e.g. typing "08:24" but submitting
// "20:24") without needing to parse into Date objects.
function isCheckOutBeforeCheckIn(checkIn: string, checkOut: string): boolean {
  return !!checkIn && !!checkOut && checkOut <= checkIn;
}

interface EmployeePayslipData {
  name: string;
  department: string;
  period: string;
  generatedDate: string;
  dailyRows: PayslipDailyRow[];
  grossPay: number;
  netPay: number;
}

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

function generatePayslipHTML(employee: EmployeePayslipData): string {
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const deductions = employee.grossPay - employee.netPay;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payslip - ${employee.name}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: white;
      padding: 10px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border: 1px solid #e5e7eb;
      padding: 20px;
    }
    .header {
      display: flex;
      flex-direction: row;
      gap: 15px;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      padding: 15px;
      border-bottom: 2px solid #1e40af;
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
      border-radius: 8px;
      position: relative;
    }
    .header h1 {
      color: white;
      font-size: 28px;
      margin-bottom: 0;
      letter-spacing: 1px;
    }
    .payslip-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 15px;
    }
    .info-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .info-section label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      font-weight: 600;
    }
    .info-section span {
      font-size: 13px;
      color: #1f2937;
      font-weight: 500;
    }
    .employee-highlight {
      background: #eff6ff;
      border-left: 4px solid #1e40af;
      padding: 10px;
      border-radius: 4px;
    }
    .employee-highlight .info-section label {
      color: #1e40af;
      font-weight: 700;
    }
    .employee-highlight .info-section span {
      font-size: 16px;
      font-weight: 700;
      color: #1e40af;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .table th {
      background: #f3f4f6;
      color: #1f2937;
      padding: 8px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      border: 1px solid #e5e7eb;
    }
    .table td {
      padding: 8px;
      border: 1px solid #e5e7eb;
      font-size: 12px;
      color: #374151;
    }
    .table tr:nth-child(even) {
      background: #fafafa;
    }
    .summary-section {
      margin-top: 15px;
      border-top: 2px solid #e5e7eb;
      padding-top: 10px;
    }
    .summary-row {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 10px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .summary-row.gross {
      background: #f0f9ff;
      border: 1px solid #bfdbfe;
      border-radius: 4px;
      padding: 10px;
      margin: 8px 0;
      font-weight: 600;
      font-size: 14px;
      color: #1e40af;
    }
    .summary-row.total {
      background: #1e40af;
      color: white;
      border-radius: 4px;
      padding: 12px;
      margin: 8px 0;
      font-weight: 700;
      font-size: 16px;
    }
    .summary-row.total .amount {
      text-align: right;
      font-size: 18px;
    }
    .amount {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .footer {
      text-align: center;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 11px;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .container {
        border: none;
        padding: 20px;
      }
      .header {
        background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%) !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      table {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      .summary-row.gross {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      .summary-row.total {
        background: #1e40af !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="text-align: center; width: 100%;">
        <h1>PAYSLIP</h1>
      </div>
    </div>

    <div class="payslip-info">
      <div class="employee-highlight">
        <div class="info-section">
          <label>Employee Name</label>
          <span>${employee.name}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Department</label>
          <span>${employee.department || "—"}</span>
        </div>
      </div>
      <div>
        <div class="info-section">
          <label>Payslip Date</label>
          <span>${employee.generatedDate || currentDate}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Period</label>
          <span>${employee.period}</span>
        </div>
      </div>
    </div>

    <div class="summary-section">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time In</th>
            <th>Meal In</th>
            <th>Meal Out</th>
            <th>Time Out</th>
            <th style="text-align: right;">Duty Hours</th>
            <th style="text-align: right;">Rate</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${employee.dailyRows.length > 0 ? employee.dailyRows.map((r) => `
          <tr>
            <td>${r.date}</td>
            <td>${formatClockTime(r.clockIn)}</td>
            <td>${formatClockTime(r.mealStart)}</td>
            <td>${formatClockTime(r.mealEnd)}</td>
            <td>${formatClockTime(r.clockOut)}</td>
            <td class="amount">${r.hours.toFixed(2)}</td>
            <td class="amount">$${r.rate.toFixed(2)}</td>
            <td class="amount">$${r.amount.toFixed(2)}</td>
          </tr>
          `).join('') : `
          <tr>
            <td colspan="8" style="text-align: center; color: #9ca3af;">No daily attendance recorded for this period.</td>
          </tr>
          `}
        </tbody>
        <tfoot>
          <tr style="font-weight: 700; background: #f3f4f6;">
            <td colspan="7">Total</td>
            <td class="amount">$${employee.grossPay.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="summary-row gross" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>Gross Pay</div>
        <div class="amount">$${employee.grossPay.toFixed(2)}</div>
      </div>

      ${deductions > 0 ? `
      <table class="table" style="margin-top: 15px;">
        <tbody>
          <tr>
            <td>Deductions</td>
            <td class="amount">-$${deductions.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      ` : ''}

      <div class="summary-row total" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>NET PAY</div>
        <div class="amount">$${employee.netPay.toFixed(2)}</div>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0; margin-bottom: 10px;">This is an electronically generated payslip. No signature is required.</p>
      <p style="margin: 0;">© ${new Date().getFullYear()} Admin Hub Solutions. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

export function EmployeeSelfServicePage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef; }) {
  const { email, uid, role, displayName } = useAuth();
  const search = (useSearch({ strict: false }) as { tab?: string }) ?? {};
  const employee = getEmployeeFromEmail(email);

  const [activeTab, setActiveTab] = useState<"dashboard" | "payroll" | "attendance" | "requests" | "manage">("dashboard");
  const [expandedPayslip, setExpandedPayslip] = useState<string | null>(null);
  const [payslipModalOpen, setPayslipModalOpen] = useState(false);
  const [selectedPayslipId, setSelectedPayslipId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<"pto" | "dispute" | "correction" | "inquiry">("pto");
  const [attendanceView, setAttendanceView] = useState<"daily" | "monthly">("daily");
  // Real Supabase-backed attendance for the My Attendance tab.
  const [liveAttendance, setLiveAttendance] = useState<AttendanceRow[]>([]);
  const [missingAttendance, setMissingAttendance] = useState<AttendanceRow[]>([]);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [showLoginLogout, setShowLoginLogout] = useState(false);

  // Real Supabase-backed PTO / time-correction / attendance-dispute / payroll-inquiry
  // requests — company-scoped by RLS, filtered down to "mine" below for the
  // employee-facing tabs and shown in full on the "Manage Requests" tab for
  // HR/Finance/Admin.
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myHireDate, setMyHireDate] = useState<string | null>(null);
  const [allPtoRequests, setAllPtoRequests] = useState<PtoRequestRow[]>([]);
  const [allCorrections, setAllCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [allEmployeeRequests, setAllEmployeeRequests] = useState<EmployeeRequestRow[]>([]);
  const [companyProfiles, setCompanyProfiles] = useState<ProfileRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [myPayslips, setMyPayslips] = useState<MyPayslipRow[]>([]);
  const [payslipDailyRows, setPayslipDailyRows] = useState<PayslipDailyRow[]>([]);
  const [payslipDailyLoading, setPayslipDailyLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [responseNote, setResponseNote] = useState<Record<string, string>>({});
  const [requestTypeFilter, setRequestTypeFilter] = useState<"all" | "PTO Request" | "Time Correction" | "Attendance Dispute" | "Payroll Inquiry">("all");
  const [summaryModal, setSummaryModal] = useState<"pending" | "approved" | "rejected" | "closed" | "pto" | null>(null);

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
  });
  const [submitSuccess, setSubmitSuccess] = useState(false);

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
        const rows = await getAttendanceForRange(
          schedule.profileId,
          toKey(start),
          toKey(today),
          {
            requiredCheckIn: schedule.requiredCheckIn,
            requiredCheckOut: schedule.requiredCheckOut,
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
    getProfileEmployeeInfo(myProfileId).then((info) => {
      if (!cancelled) setMyHireDate(info?.hireDate || null);
    });
    return () => { cancelled = true; };
  }, [myProfileId]);

  // Load real PTO / correction / attendance-dispute / payroll-inquiry requests
  // for the whole company (RLS already scopes this to the caller's company) —
  // used both for "mine" (My Requests tab) and, for HR/Finance/Admin, the
  // full company view on the Manage Requests tab.
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
        type: "PTO Request",
        status: r.status === "denied" ? "rejected" : r.status === "cancelled" ? "closed" : r.status,
        submittedDate: r.createdAt.slice(0, 10),
        details: `${PTO_TYPE_LABEL[r.ptoType] ?? r.ptoType}: ${r.startDate} to ${r.endDate} (${r.hoursRequested}h)${r.reason ? ` - ${r.reason}` : ""}\n${managerLine} | ${hrLine}`,
      });
    }
    for (const r of myCorrections) {
      items.push({
        id: `corr-${r.id}`,
        type: "Time Correction",
        status: r.status,
        submittedDate: r.createdAt.slice(0, 10),
        details: `Date: ${r.workDate} - requested ${r.correctedCheckIn || "—"} to ${r.correctedCheckOut || "—"} (was ${r.originalCheckIn || "—"} to ${r.originalCheckOut || "—"})${(r.correctedMealStart || r.correctedMealEnd) ? `\nMeal: requested ${r.correctedMealStart || "—"} to ${r.correctedMealEnd || "—"} (was ${r.originalMealStart || "—"} to ${r.originalMealEnd || "—"})` : ""}${r.reason ? `. ${r.reason}` : ""}${r.reviewedBy ? `\nReviewed by ${profileName(r.reviewedBy)}` : ""}`,
      });
    }
    for (const r of myEmployeeRequests) {
      items.push({
        id: `req-${r.id}`,
        type: r.requestType === "attendance_dispute" ? "Attendance Dispute" : "Payroll Inquiry",
        status: r.status,
        submittedDate: r.createdAt.slice(0, 10),
        details: r.details + (r.reviewNote ? `\n\nResponse: ${r.reviewNote}` : ""),
      });
    }
    return items.sort((a, b) => b.submittedDate.localeCompare(a.submittedDate));
  }, [myPtoRequests, myCorrections, myEmployeeRequests, companyProfiles]);

  const filteredMyRequests = useMemo(
    () => (requestTypeFilter === "all" ? myRequests : myRequests.filter((r) => r.type === requestTypeFilter)),
    [myRequests, requestTypeFilter]
  );

  const canManageRequests = ["ADMIN", "HR", "FINANCE"].includes((role || "").toUpperCase());

  // PTO eligibility: 1 year of tenure from hire date (falls back to account
  // creation date if HR hasn't set a hire date yet).
  const myCreatedAt = companyProfiles.find((p) => p.id === myProfileId)?.created_at ?? null;
  const ptoEligible = isEligibleForPto(myHireDate, myCreatedAt);
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
  const myPtoYearRequestIds = useMemo(
    () => new Set(myPtoYearRequests.map((r) => `pto-${r.id}`)),
    [myPtoYearRequests]
  );

  // Deep link from a bell-icon notification straight into a specific tab
  // (e.g. PTO/correction outcome -> "requests", new request submitted ->
  // "manage", payroll generated -> "payroll").
  useEffect(() => {
    const tab = search.tab;
    if (!tab) return;
    if (tab === "manage" && !canManageRequests) return;
    if (["dashboard", "payroll", "attendance", "requests", "manage"].includes(tab)) {
      setActiveTab(tab as typeof activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.tab, canManageRequests]);

  // Ping every HR/Finance/Admin in the company when a new request comes in,
  // so they don't have to keep checking the Manage Requests tab manually.
  // Uses the dedicated notifications table (not the messenger) — see
  // src/lib/supabase/notifications.ts.
  const notifyManagers = async (body: string) => {
    const recipients = companyProfiles.filter((p) => {
      if (p.id === myProfileId) return false;
      const primary = (p.role || "").toUpperCase();
      if (["ADMIN", "HR", "FINANCE"].includes(primary)) return true;
      return (p.extra_roles || []).some((r) => ["ADMIN", "HR", "FINANCE"].includes((r || "").toUpperCase()));
    });
    await Promise.all(
      recipients.map((r) =>
        createNotification({
          recipientId: r.id,
          senderId: myProfileId,
          senderName: displayName || employee?.role || "Employee",
          body,
          linkTo: "/m/dashboard/employee-self-service?tab=manage",
        }).catch((err) => console.error("Failed to notify", r.id, err))
      )
    );
  };

  const pendingPto = allPtoRequests.filter((r) => r.status === "pending");
  const pendingCorrections = allCorrections.filter((r) => r.status === "pending");
  const pendingEmployeeRequests = allEmployeeRequests.filter((r) => r.status === "pending");

  const handlePtoStageAction = async (request: PtoRequestRow, stage: PtoStage, decision: "approved" | "rejected") => {
    try {
      await reviewPtoStage(request, stage, decision, myProfileId || "", displayName || "Employee");
      await refreshRequests();
    } catch (err) {
      alert(`Failed to update PTO request: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleCorrectionAction = async (correction: TimecardCorrectionRow, approve: boolean) => {
    try {
      if (approve) {
        const effectiveCheckIn = correction.correctedCheckIn || correction.originalCheckIn || "";
        const effectiveCheckOut = correction.correctedCheckOut || correction.originalCheckOut || "";
        const effectiveMealStart = correction.correctedMealStart || correction.originalMealStart || "";
        const effectiveMealEnd = correction.correctedMealEnd || correction.originalMealEnd || "";
        if (isCheckOutBeforeCheckIn(effectiveCheckIn, effectiveCheckOut)) {
          alert(`Can't approve: check out (${effectiveCheckOut}) is before check in (${effectiveCheckIn}). This is usually an AM/PM mistake on the time picker — reject it and ask the employee to resubmit.`);
          return;
        }
        if (isCheckOutBeforeCheckIn(effectiveMealStart, effectiveMealEnd)) {
          alert(`Can't approve: meal end (${effectiveMealEnd}) is before meal start (${effectiveMealStart}). This is usually an AM/PM mistake on the time picker — reject it and ask the employee to resubmit.`);
          return;
        }
        await approveTimecardCorrection(correction, correction.correctedCheckIn, correction.correctedCheckOut, myProfileId, correction.correctedMealStart, correction.correctedMealEnd);
      } else {
        await rejectTimecardCorrection(correction, myProfileId);
      }
      await refreshRequests();
    } catch (err) {
      alert(`Failed to update correction: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleEmployeeRequestAction = async (id: string, status: EmployeeRequestStatus) => {
    try {
      await updateEmployeeRequestStatus(id, status, myProfileId, responseNote[id]);
      await refreshRequests();
      setResponseNote((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      alert(`Failed to update request: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const tabs = [
    { id: "dashboard", label: "My Dashboard", icon: TrendingUp },
    { id: "payroll", label: "My Payroll", icon: DollarSign },
    { id: "attendance", label: "My Attendance", icon: Clock },
    { id: "requests", label: "My Requests", icon: ListTodo },
    ...(canManageRequests ? [{ id: "manage", label: "Manage Requests", icon: AlertCircle }] : []),
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-500/20 text-yellow-300";
      case "approved": return "bg-green-500/20 text-green-300";
      case "rejected": return "bg-red-500/20 text-red-300";
      case "closed": return "bg-slate-500/20 text-slate-300";
      default: return "bg-slate-500/20 text-slate-300";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending": return "⏳";
      case "approved": return "✓";
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
          const requestedDays = weekdayCount(formData.startDate, formData.endDate);
          if (myPtoYear && requestedDays > myPtoRemaining) {
            alert(`This request is ${requestedDays} day${requestedDays === 1 ? "" : "s"}, but you only have ${myPtoRemaining} of ${myPtoYear.allowance} days left for Year ${myPtoYear.tenureYear} (resets ${myPtoYear.end}).`);
            setSubmitting(false);
            return;
          }
          const ptoTypeMap: Record<string, PtoType> = {
            Vacation: "vacation",
            "Sick Leave": "sick",
            Personal: "personal",
          };
          const myProfile = companyProfiles.find((p) => p.id === myProfileId) ?? null;
          const managerProfile = myProfile ? await resolveTeamLeadOrManager(myProfile, companyProfiles) : null;
          await createPtoRequest({
            profileId: myProfileId,
            ptoType: ptoTypeMap[formData.leaveType] || "vacation",
            startDate: formData.startDate,
            endDate: formData.endDate,
            reason: `Branch: ${formData.branch} | Position: ${employee?.role || "N/A"} - ${formData.details}`,
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
              if (p.id === myProfileId) continue;
              const primary = (p.role || "").toUpperCase();
              if (primary === "HR" || (!managerProfile && primary === "ADMIN")) recipients.set(p.id, p);
            }
            await Promise.all(
              Array.from(recipients.values()).map((r) =>
                createNotification({
                  recipientId: r.id,
                  senderId: myProfileId,
                  senderName: displayName || "Employee",
                  body: `🗓️ New PTO Request from ${displayName || "an employee"} needs your approval: ${formData.leaveType}, ${formData.startDate} to ${formData.endDate}.`,
                  linkTo: "/m/dashboard/employee-self-service?tab=manage",
                }).catch((err) => console.error("Failed to notify", r.id, err))
              )
            );
          }
          break;
        }
        case "dispute":
          await createEmployeeRequest({
            profileId: myProfileId,
            requestType: "attendance_dispute",
            details: formData.details,
            requestedBy: myProfileId,
          });
          await notifyManagers(`⚠️ New Attendance Dispute from ${displayName || "an employee"}.`);
          break;
        case "correction": {
          if (!formData.correctionDate) {
            alert("Please select a date");
            setSubmitting(false);
            return;
          }
          const existing = liveAttendance.find((a) => a.date === formData.correctionDate);
          const effectiveCheckIn = formData.correctedCheckIn || existing?.clockIn || "";
          const effectiveCheckOut = formData.correctedCheckOut || existing?.clockOut || "";
          if (isCheckOutBeforeCheckIn(effectiveCheckIn, effectiveCheckOut)) {
            alert(`Check out (${effectiveCheckOut}) is before check in (${effectiveCheckIn}). Double-check the AM/PM on the time picker.`);
            setSubmitting(false);
            return;
          }
          const effectiveMealStart = formData.correctedMealStart || existing?.mealStart || "";
          const effectiveMealEnd = formData.correctedMealEnd || existing?.mealEnd || "";
          if (isCheckOutBeforeCheckIn(effectiveMealStart, effectiveMealEnd)) {
            alert(`Meal end (${effectiveMealEnd}) is before meal start (${effectiveMealStart}). Double-check the AM/PM on the time picker.`);
            setSubmitting(false);
            return;
          }
          await createTimecardCorrection({
            profileId: myProfileId,
            workDate: formData.correctionDate,
            originalCheckIn: existing?.clockIn || "",
            originalCheckOut: existing?.clockOut || "",
            correctedCheckIn: formData.correctedCheckIn,
            correctedCheckOut: formData.correctedCheckOut,
            originalMealStart: existing?.mealStart || "",
            originalMealEnd: existing?.mealEnd || "",
            correctedMealStart: formData.correctedMealStart,
            correctedMealEnd: formData.correctedMealEnd,
            reason: formData.details,
            requestedBy: myProfileId,
          });
          // Time correction notifications are scoped to HR + Finance + the
          // requester (here, the employee themselves) — not the broader
          // ADMIN/HR/FINANCE set the other request types notify.
          {
            const recipients = new Map<string, ProfileRow>();
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
                    : "/m/dashboard/employee-self-service?tab=manage",
                }).catch((err) => console.error("Failed to notify", r.id, err))
              )
            );
          }
          break;
        }
        case "inquiry":
          await createEmployeeRequest({
            profileId: myProfileId,
            requestType: "payroll_inquiry",
            details: formData.details,
            requestedBy: myProfileId,
          });
          await notifyManagers(`💰 New Payroll Inquiry from ${displayName || "an employee"}.`);
          break;
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
        });
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
    element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent));
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

  // Build the day-by-day duty breakdown shown on the payslip: fetch real
  // attendance for the selected payslip's exact pay period and apply that
  // run's stored hourly rate per day (payroll runs use one flat rate per
  // employee for the whole period, so no per-day rate lookup is needed).
  useEffect(() => {
    if (!payslipModalOpen || !selectedPayslip || !myProfileId) {
      setPayslipDailyRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setPayslipDailyLoading(true);
      try {
        const schedule = uid ? await getMyProfileSchedule(uid) : null;
        const rows = await getAttendanceForRange(
          myProfileId,
          selectedPayslip.periodStart,
          selectedPayslip.periodEnd,
          {
            requiredCheckIn: schedule?.requiredCheckIn,
            requiredCheckOut: schedule?.requiredCheckOut,
          }
        );
        if (cancelled) return;
        const rate = selectedPayslip.hourlyRate;
        const daily: PayslipDailyRow[] = rows
          .filter((r) => r.hoursWorked > 0)
          .map((r) => {
            const regular = Math.min(r.hoursWorked, 8);
            const overtime = Math.max(0, r.hoursWorked - 8);
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

  const payslipData: EmployeePayslipData | null = selectedPayslip ? {
    name: displayName || "Employee",
    department: ROLE_LABELS[role || ""] || role || "",
    period: `${selectedPayslip.periodStart} to ${selectedPayslip.periodEnd}`,
    generatedDate: selectedPayslip.generatedAt ? new Date(selectedPayslip.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "",
    dailyRows: payslipDailyRows,
    grossPay: selectedPayslip.grossPay,
    netPay: selectedPayslip.netPay,
  } : null;

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
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              {sub.title}
            </h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-white/10 overflow-x-auto">
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
            <div className="grid gap-4 md:grid-cols-2">
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
                  <button
                    type="button"
                    onClick={() => handleViewPayslip(myPayslips[0].runId)}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center justify-center gap-2"
                  >
                    <FileText className="h-3 w-3" />
                    View Payslip
                  </button>
                </>
              )}
            </div>

            {/* Previous Payroll History */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
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
                            onClick={() => handleViewPayslip(payroll.runId)}
                            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold transition"
                          >
                            View
                          </button>
                        </div>
                      </div>
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

            <div className="flex gap-2 flex-wrap items-center">
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
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
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
            <div className="grid gap-4 md:grid-cols-5">
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

            {/* Requests List */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
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

            {/* Submit Request Buttons */}
            {!ptoEligible && (
              <div className="bg-amber-500/10 border border-amber-400/40 rounded-lg p-3 text-xs text-amber-100">
                You're not yet eligible for PTO — employees need 1 year of tenure first. You'll be eligible starting {ptoEligibleOn}.
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => { setModalType("pto"); setShowModal(true); }}
                disabled={!ptoEligible}
                title={!ptoEligible ? `Not eligible until ${ptoEligibleOn}` : undefined}
                className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                PTO Request
              </button>
              <button
                onClick={() => { setModalType("dispute"); setShowModal(true); }}
                className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Attendance Dispute
              </button>
              <button
                onClick={() => { setModalType("correction"); setShowModal(true); }}
                className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Time Correction Request
              </button>
              <button
                onClick={() => { setModalType("inquiry"); setShowModal(true); }}
                className="px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Payroll Inquiry
              </button>
            </div>
          </div>
        )}

        {/* Manage Requests Tab (HR / Finance / Admin only) */}
        {activeTab === "manage" && canManageRequests && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Pending PTO</p>
                <p className="text-2xl font-bold text-yellow-300">{pendingPto.length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Pending Corrections</p>
                <p className="text-2xl font-bold text-yellow-300">{pendingCorrections.length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Pending Disputes / Inquiries</p>
                <p className="text-2xl font-bold text-yellow-300">{pendingEmployeeRequests.length}</p>
              </div>
            </div>

            {/* Pending PTO */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">PTO Requests — Pending</h3>
              {requestsLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : pendingPto.length === 0 ? (
                <p className="text-sm text-slate-400">No pending PTO requests.</p>
              ) : (
                <div className="space-y-3">
                  {pendingPto.map((r) => {
                    const canManagerAct = r.managerStatus === "pending" && canReviewPtoStage(r, "manager", myProfileId, role);
                    const canHrAct = r.hrStatus === "pending" && canReviewPtoStage(r, "hr", myProfileId, role);
                    return (
                      <div key={r.id} className="border border-white/10 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white">{profileName(r.profileId)} — {PTO_TYPE_LABEL[r.ptoType] ?? r.ptoType}</p>
                            <p className="text-xs text-slate-400 mt-1">{r.startDate} to {r.endDate} ({r.hoursRequested}h)</p>
                            {r.reason && <p className="text-sm text-slate-300 mt-2">{r.reason}</p>}
                            <div className="flex gap-2 mt-2">
                              <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                r.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                                : r.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                                : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                              }`}>
                                Manager: {r.managerStatus.charAt(0).toUpperCase() + r.managerStatus.slice(1)}
                                {r.managerReviewedBy ? ` — ${profileName(r.managerReviewedBy)}` : ""}
                              </span>
                              <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                r.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                                : r.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                                : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                              }`}>
                                HR: {r.hrStatus.charAt(0).toUpperCase() + r.hrStatus.slice(1)}
                                {r.hrReviewedBy ? ` — ${profileName(r.hrReviewedBy)}` : ""}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            {canManagerAct && (
                              <div className="flex gap-1">
                                <button type="button" onClick={() => handlePtoStageAction(r, "manager", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">
                                  Approve (Mgr)
                                </button>
                                <button type="button" onClick={() => handlePtoStageAction(r, "manager", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">
                                  Reject
                                </button>
                              </div>
                            )}
                            {canHrAct && (
                              <div className="flex gap-1">
                                <button type="button" onClick={() => handlePtoStageAction(r, "hr", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">
                                  Approve (HR)
                                </button>
                                <button type="button" onClick={() => handlePtoStageAction(r, "hr", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">
                                  Reject
                                </button>
                              </div>
                            )}
                            {!canManagerAct && !canHrAct && (
                              <span className="text-xs text-slate-500">Awaiting other approver</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pending Time Corrections */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Time Corrections — Pending</h3>
              {requestsLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : pendingCorrections.length === 0 ? (
                <p className="text-sm text-slate-400">No pending time correction requests.</p>
              ) : (
                <div className="space-y-3">
                  {pendingCorrections.map((r) => (
                    <div key={r.id} className="border border-white/10 rounded-lg p-3 flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">{profileName(r.profileId)} — {r.workDate}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {r.originalCheckIn || "—"} → {r.originalCheckOut || "—"} &nbsp;⟶&nbsp; requested {r.correctedCheckIn || "—"} → {r.correctedCheckOut || "—"}
                        </p>
                        {(r.correctedMealStart || r.correctedMealEnd) && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            Meal: {r.originalMealStart || "—"} → {r.originalMealEnd || "—"} &nbsp;⟶&nbsp; requested {r.correctedMealStart || "—"} → {r.correctedMealEnd || "—"}
                          </p>
                        )}
                        {r.reason && <p className="text-sm text-slate-300 mt-2">{r.reason}</p>}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCorrectionAction(r, true)}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCorrectionAction(r, false)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending Attendance Disputes & Payroll Inquiries */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Attendance Disputes & Payroll Inquiries — Pending</h3>
              {requestsLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : pendingEmployeeRequests.length === 0 ? (
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
                        value={responseNote[r.id] || ""}
                        onChange={(e) => setResponseNote({ ...responseNote, [r.id]: e.target.value })}
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
      </main>

      {/* Request Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !submitSuccess && setShowModal(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            {!submitSuccess ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-white">
                    {modalType === "pto" && "Submit PTO Request"}
                    {modalType === "dispute" && "Submit Attendance Dispute"}
                    {modalType === "correction" && "Submit Time Correction Request"}
                    {modalType === "inquiry" && "Submit Payroll Inquiry"}
                  </h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-slate-400 hover:text-white transition"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {modalType === "pto" && (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-white block mb-1">Leave Type</label>
                        <select 
                          value={formData.leaveType}
                          onChange={(e) => setFormData({ ...formData, leaveType: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                        >
                          <option>Vacation</option>
                          <option>Sick Leave</option>
                          <option>Personal</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Position</label>
                          <div className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm">
                            {employee?.role || "N/A"}
                          </div>
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
                      <div className="grid grid-cols-2 gap-2">
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
                    </>
                  )}
                  {modalType === "correction" && (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-white block mb-1">Date</label>
                        <input
                          type="date"
                          title="Date"
                          value={formData.correctionDate}
                          onChange={(e) => setFormData({ ...formData, correctionDate: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                        />
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
                      <div className="grid grid-cols-2 gap-2">
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
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-white block mb-1">Corrected Meal Start</label>
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
                          <label className="text-xs font-semibold text-white block mb-1">Corrected Meal End</label>
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
                      <p className="text-[10px] text-slate-500">Leave meal fields blank if only the check-in/check-out time was wrong.</p>
                    </>
                  )}
                  <div>
                    <label className="text-xs font-semibold text-white block mb-1">Details / Reason</label>
                    <textarea
                      placeholder="Please provide details..."
                      value={formData.details}
                      onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-4">
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

      {/* Request Summary Modal — drill into one of the Track Status counts */}
      {summaryModal && (() => {
        const titles: Record<typeof summaryModal & string, string> = {
          pto: `PTO Requests — Year ${myPtoYear?.tenureYear ?? "—"}`,
          pending: "Pending Requests",
          approved: "Approved Requests",
          rejected: "Rejected Requests",
          closed: "Closed Requests",
        };
        const items =
          summaryModal === "pto"
            ? myRequests.filter((r) => myPtoYearRequestIds.has(r.id))
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
                  srcDoc={generatePayslipHTML(payslipData)}
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
    </div>
  );
}
