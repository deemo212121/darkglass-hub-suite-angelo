import { ChevronLeft, DollarSign, Calendar, Clock, ListTodo, Download, Eye, EyeOff, TrendingUp, AlertCircle, CheckCircle2, XCircle, Plus, FileText, X } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { getEmployeeFromEmail, getUserPayslips, getUserAttendance } from "@/lib/userDataSync";
import { LOCATIONS } from "@/lib/locations";
import {
  type AttendanceRow,
  getAttendanceForRange,
  getMyProfileSchedule,
} from "@/lib/supabase/timecards";

interface PayrollRecord {
  id: string;
  period: string;
  date: string;
  grossPay: number;
  netPay: number;
  deductions: number;
  overtime: number;
  status: "available" | "pending";
}

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

interface EmployeePayslipData {
  id: string;
  name: string;
  department: string;
  dailyTimecards: Array<{
    date: string;
    timeIn: string;
    timeOut: string;
    mealInTime: string;
    mealOutTime: string;
    hoursWorked: number;
  }>;
  totalHoursMonth: number;
  totalOvertimeMonth: number;
  totalPTOHours: number;
  totalAbsences: number;
  totalHolidayPay: number;
  notes?: string;
}

// Mock Data
const CURRENT_PAYROLL: PayrollRecord = {
  id: "current",
  period: "Jun 1-15, 2026",
  date: "2026-06-16",
  grossPay: 3200,
  netPay: 2560,
  deductions: 400,
  overtime: 150,
  status: "available",
};

const PAYROLL_HISTORY: PayrollRecord[] = [
  { id: "1", period: "Jun 1-15, 2026", date: "2026-06-16", grossPay: 3200, netPay: 2560, deductions: 400, overtime: 150, status: "available" },
  { id: "2", period: "May 16-31, 2026", date: "2026-06-01", grossPay: 3100, netPay: 2480, deductions: 380, overtime: 120, status: "available" },
  { id: "3", period: "May 1-15, 2026", date: "2026-05-16", grossPay: 3200, netPay: 2560, deductions: 400, overtime: 140, status: "available" },
];

const EMPLOYEE_PAYSLIP_DATA: EmployeePayslipData = {
  id: "current-employee",
  name: "John Doe",
  department: "Operations",
  dailyTimecards: [
    { date: "2026-06-01", timeIn: "8:00 AM", timeOut: "5:00 PM", mealInTime: "12:00 PM", mealOutTime: "1:00 PM", hoursWorked: 8 },
    { date: "2026-06-02", timeIn: "8:10 AM", timeOut: "5:05 PM", mealInTime: "12:00 PM", mealOutTime: "1:00 PM", hoursWorked: 8.92 },
    { date: "2026-06-03", timeIn: "7:55 AM", timeOut: "5:15 PM", mealInTime: "12:00 PM", mealOutTime: "1:00 PM", hoursWorked: 9.33 },
    { date: "2026-06-04", timeIn: "8:00 AM", timeOut: "5:00 PM", mealInTime: "12:00 PM", mealOutTime: "1:00 PM", hoursWorked: 9 },
    { date: "2026-06-05", timeIn: "8:05 AM", timeOut: "5:10 PM", mealInTime: "12:00 PM", mealOutTime: "1:00 PM", hoursWorked: 9.08 },
  ],
  totalHoursMonth: 160,
  totalOvertimeMonth: 8,
  totalPTOHours: 0,
  totalAbsences: 0,
  totalHolidayPay: 0,
  notes: "June payroll processed successfully. All timecards verified.",
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

const PTO_BALANCE = {
  vacation: { available: 12, used: 8, pending: 2 },
  sickLeave: { available: 10, used: 3, pending: 0 },
  personal: { available: 3, used: 1, pending: 1 },
};

const PTO_HISTORY = [
  { date: "2026-05-20", type: "Vacation", days: 3, status: "approved" },
  { date: "2026-04-15", type: "Sick Leave", days: 1, status: "approved" },
];

const UPCOMING_REQUESTS = [
  { id: "1", type: "PTO Request", dates: "Jun 10-14, 2026", days: 5, status: "pending" },
];

const ALL_REQUESTS: Request[] = [
  { id: "1", type: "PTO Request", status: "pending", submittedDate: "2026-06-02", details: "Vacation: Jun 10-14, 2026 (5 days)" },
  { id: "2", type: "Time Correction", status: "approved", submittedDate: "2026-05-30", details: "Corrected clock-out time for May 28 from 5:00 PM to 5:15 PM" },
  { id: "3", type: "Attendance Dispute", status: "rejected", submittedDate: "2026-05-25", details: "Missing clock-in record for May 24" },
  { id: "4", type: "Payroll Inquiry", status: "closed", submittedDate: "2026-05-20", details: "Question about overtime calculation for May 1-15 period" },
];

function generatePayslipHTML(employee: EmployeePayslipData): string {
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Calculate payroll values
  const hourlyRate = 20;
  const overtimeRate = 30;
  const ptoRate = 20;
  const regularPay = employee.totalHoursMonth * hourlyRate;
  const overtimePay = employee.totalOvertimeMonth * overtimeRate;
  const ptoPay = employee.totalPTOHours * ptoRate;
  const holidayPay = employee.totalHolidayPay;
  const grossPay = regularPay + overtimePay + ptoPay + holidayPay;
  const absenceCost = employee.totalAbsences * 20;
  const deductions = grossPay * 0.2;
  const netPay = grossPay - deductions;

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
          <span>${currentDate}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Period</label>
          <span>June 1-30, 2026</span>
        </div>
      </div>
    </div>

    <div style="margin-top: 15px; margin-bottom: 15px;">
      <h3 style="font-size: 14px; font-weight: 700; color: #1f2937; margin-bottom: 8px; border-bottom: 2px solid #1e40af; padding-bottom: 5px;">Daily Timecard Details</h3>
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Check In</th>
            <th>Meal Start</th>
            <th>Meal End</th>
            <th>Check Out</th>
            <th>Working Hours</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${employee.dailyTimecards.map(tc => {
            const checkInTime = tc.timeIn || "—";
            const checkOutTime = tc.timeOut || "—";
            const mealStart = tc.mealInTime || "—";
            const mealEnd = tc.mealOutTime || "—";
            const hours = tc.hoursWorked.toFixed(2);
            const amount = (tc.hoursWorked * hourlyRate).toFixed(2);
            return `
          <tr>
            <td>${tc.date}</td>
            <td>${checkInTime}</td>
            <td>${mealStart}</td>
            <td>${mealEnd}</td>
            <td>${checkOutTime}</td>
            <td>${hours}</td>
            <td>$${hourlyRate}</td>
            <td class="amount">$${amount}</td>
          </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="summary-section">
      <table class="table">
        <thead>
          <tr>
            <th>Description</th>
            <th style="text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Regular Hours</td>
            <td class="amount">$${regularPay.toFixed(2)}</td>
          </tr>
          ${employee.totalOvertimeMonth > 0 ? `
          <tr>
            <td>Overtime Hours</td>
            <td class="amount">$${overtimePay.toFixed(2)}</td>
          </tr>
          ` : ''}
          ${employee.totalPTOHours > 0 ? `
          <tr>
            <td>PTO Hours</td>
            <td class="amount">$${ptoPay.toFixed(2)}</td>
          </tr>
          ` : ''}
          ${employee.totalAbsences > 0 ? `
          <tr>
            <td>Absences (${employee.totalAbsences} days)</td>
            <td class="amount">-$${absenceCost.toFixed(2)}</td>
          </tr>
          ` : ''}
          ${employee.totalHolidayPay > 0 ? `
          <tr>
            <td>Holiday Pay</td>
            <td class="amount">$${holidayPay.toFixed(2)}</td>
          </tr>
          ` : ''}
        </tbody>
      </table>
      
      <div class="summary-row gross" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>Gross Pay</div>
        <div class="amount">$${grossPay.toFixed(2)}</div>
      </div>

      <table class="table" style="margin-top: 15px;">
        <tbody>
          <tr>
            <td>Deductions (20%)</td>
            <td class="amount">-$${deductions.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary-row total" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>NET PAY</div>
        <div class="amount">$${netPay.toFixed(2)}</div>
      </div>
    </div>

    <div class="footer">
      ${employee.notes ? `<div style="text-align: left; margin-bottom: 20px; padding: 12px; background: #f3f4f6; border-left: 4px solid #1e40af; border-radius: 4px;"><p style="margin: 0; font-size: 12px;"><strong style="color: #1e40af;">Notes:</strong> <span style="color: #374151;">${employee.notes}</span></p></div>` : ''}
      <p style="margin: 0; margin-bottom: 10px;">This is an electronically generated payslip. No signature is required.</p>
      <p style="margin: 0;">© ${new Date().getFullYear()} Admin Hub Solutions. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

export function EmployeeSelfServicePage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef; }) {
  const { email, uid } = useAuth();
  const employee = getEmployeeFromEmail(email);
  const userPayslips = getUserPayslips(email);
  
  // Load current payslip data
  const currentPayslip = userPayslips.length > 0 ? userPayslips[userPayslips.length - 1] : null;
  const payslipData = currentPayslip ? {
    id: currentPayslip.employeeId,
    name: currentPayslip.employeeName,
    department: currentPayslip.department,
    dailyTimecards: [],
    totalHoursMonth: currentPayslip.hoursWorked,
    totalOvertimeMonth: currentPayslip.overtimeHours,
    totalPTOHours: currentPayslip.ptoHours,
    totalAbsences: 0,
    totalHolidayPay: currentPayslip.holidayPay || 0,
    notes: "Payslip generated from employee data sync system",
  } : EMPLOYEE_PAYSLIP_DATA;
  
  const [activeTab, setActiveTab] = useState<"dashboard" | "payroll" | "attendance" | "pto" | "requests">("dashboard");
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
  const [submittedRequests, setSubmittedRequests] = useState<Request[]>(ALL_REQUESTS);
  const [formData, setFormData] = useState({
    leaveType: "Vacation",
    startDate: "",
    endDate: "",
    correctionDate: "",
    details: "",
    branch: LOCATIONS[0] || "",
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
        if (!schedule.profileId || cancelled) return;
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

  const tabs = [
    { id: "dashboard", label: "My Dashboard", icon: TrendingUp },
    { id: "payroll", label: "My Payroll", icon: DollarSign },
    { id: "attendance", label: "My Attendance", icon: Clock },
    { id: "pto", label: "My PTO", icon: Calendar },
    { id: "requests", label: "My Requests", icon: ListTodo },
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

  const handleSubmitRequest = () => {
    if (!formData.details.trim()) {
      alert("Please fill in the details/reason field");
      return;
    }

    let typeLabel = "";
    let details = "";

    switch (modalType) {
      case "pto":
        if (!formData.startDate || !formData.endDate) {
          alert("Please select start and end dates");
          return;
        }
        typeLabel = "PTO Request";
        details = `Branch: ${formData.branch} | Position: ${employee?.role || "N/A"} | ${formData.leaveType}: ${formData.startDate} to ${formData.endDate} - ${formData.details}`;
        break;
      case "dispute":
        typeLabel = "Attendance Dispute";
        details = formData.details;
        break;
      case "correction":
        if (!formData.correctionDate) {
          alert("Please select a date");
          return;
        }
        typeLabel = "Time Correction";
        details = `Date: ${formData.correctionDate} - ${formData.details}`;
        break;
      case "inquiry":
        typeLabel = "Payroll Inquiry";
        details = formData.details;
        break;
    }

    const newRequest: Request = {
      id: String(submittedRequests.length + 1),
      type: typeLabel,
      status: "pending",
      submittedDate: new Date().toISOString().split("T")[0],
      details: details,
    };

    setSubmittedRequests([newRequest, ...submittedRequests]);
    setSubmitSuccess(true);
    
    setTimeout(() => {
      setShowModal(false);
      setSubmitSuccess(false);
      setFormData({
        leaveType: "Vacation",
        startDate: "",
        endDate: "",
        correctionDate: "",
        details: "",
        branch: LOCATIONS[0] || "",
      });
    }, 1500);
  };

  const handleDownload = (type: "payslip" | "attendance") => {
    const csvContent = type === "payslip" 
      ? `Payslip\nPeriod: ${CURRENT_PAYROLL.period}\nGross Pay: $${CURRENT_PAYROLL.grossPay}\nDeductions: $${CURRENT_PAYROLL.deductions}\nNet Pay: $${CURRENT_PAYROLL.netPay}`
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

  const handleDownloadPayslip = () => {
    if (!iframeRef.current) return;
    const payslipHtml = iframeRef.current.contentWindow?.document.documentElement.innerHTML;
    if (!payslipHtml) return;

    const element = document.createElement("a");
    const file = new Blob([payslipHtml], { type: "text/html" });
    element.href = URL.createObjectURL(file);
    element.download = `Payslip-${EMPLOYEE_PAYSLIP_DATA.name}-${Date.now()}.html`;
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
                <p className="text-2xl font-bold text-green-300">${CURRENT_PAYROLL.netPay}</p>
                <p className="text-xs text-slate-400 mt-1">{CURRENT_PAYROLL.period}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">PTO Remaining</p>
                <p className="text-2xl font-bold text-blue-300">25 days</p>
                <p className="text-xs text-slate-400 mt-1">All types combined</p>
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
                Current Payroll (Jun 1-15, 2026)
              </h3>
              <div className="grid gap-4 md:grid-cols-4 mb-4">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Gross Pay</p>
                  <p className="text-lg font-semibold text-blue-300">${CURRENT_PAYROLL.grossPay}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Deductions</p>
                  <p className="text-lg font-semibold text-red-300">-${CURRENT_PAYROLL.deductions}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Net Pay</p>
                  <p className="text-lg font-semibold text-green-300">${CURRENT_PAYROLL.netPay}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Overtime</p>
                  <p className="text-lg font-semibold text-amber-300">${CURRENT_PAYROLL.overtime}</p>
                </div>
              </div>
              <button
                onClick={() => handleViewPayslip("current")}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center justify-center gap-2"
              >
                <FileText className="h-3 w-3" />
                View Payslip
              </button>
            </div>

            {/* Previous Payroll History */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Previous Payroll History</h3>
              <div className="space-y-3">
                {PAYROLL_HISTORY.map(payroll => (
                  <div key={payroll.id} className="border border-white/10 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{payroll.period}</p>
                        <p className="text-xs text-slate-400">{payroll.date}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold text-green-300">${payroll.netPay}</p>
                          <p className="text-xs text-slate-400">Net Pay</p>
                        </div>
                        <button
                          onClick={() => handleViewPayslip(payroll.id)}
                          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold transition"
                        >
                          View
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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

        {/* PTO Tab */}
        {activeTab === "pto" && (
          <div className="space-y-6">
            {/* PTO Balance */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-sm font-semibold text-white mb-3">Vacation</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Available:</span>
                    <span className="text-green-300 font-semibold">{PTO_BALANCE.vacation.available}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Used:</span>
                    <span className="text-amber-300 font-semibold">{PTO_BALANCE.vacation.used}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Pending:</span>
                    <span className="text-blue-300 font-semibold">{PTO_BALANCE.vacation.pending}</span>
                  </div>
                </div>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-sm font-semibold text-white mb-3">Sick Leave</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Available:</span>
                    <span className="text-green-300 font-semibold">{PTO_BALANCE.sickLeave.available}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Used:</span>
                    <span className="text-amber-300 font-semibold">{PTO_BALANCE.sickLeave.used}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Pending:</span>
                    <span className="text-blue-300 font-semibold">{PTO_BALANCE.sickLeave.pending}</span>
                  </div>
                </div>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-sm font-semibold text-white mb-3">Personal</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Available:</span>
                    <span className="text-green-300 font-semibold">{PTO_BALANCE.personal.available}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Used:</span>
                    <span className="text-amber-300 font-semibold">{PTO_BALANCE.personal.used}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Pending:</span>
                    <span className="text-blue-300 font-semibold">{PTO_BALANCE.personal.pending}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* PTO History */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">PTO History</h3>
              <div className="space-y-2">
                {PTO_HISTORY.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm border-b border-white/10 pb-2 last:border-0">
                    <div>
                      <p className="text-white font-semibold">{item.type}</p>
                      <p className="text-xs text-slate-400">{item.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-300 font-semibold">{item.days} days</p>
                      <p className="text-xs text-green-300">Approved ✓</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upcoming Leave Requests */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Upcoming Leave Requests</h3>
              {UPCOMING_REQUESTS.length > 0 ? (
                <div className="space-y-2">
                  {UPCOMING_REQUESTS.map((request, idx) => (
                    <div key={idx} className="border border-white/10 rounded p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-semibold text-white">{request.type}</p>
                          <p className="text-xs text-slate-400">{request.dates}</p>
                          <p className="text-xs text-amber-300 mt-1">{request.days} days</p>
                        </div>
                        <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded text-xs font-semibold">Pending</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No upcoming leave requests</p>
              )}
            </div>

            <button
              onClick={() => { setModalType("pto"); setShowModal(true); }}
              className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Submit PTO Request
            </button>
          </div>
        )}

        {/* Requests Tab */}
        {activeTab === "requests" && (
          <div className="space-y-6">
            {/* Request Summary */}
            <div className="grid gap-4 md:grid-cols-4">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Pending</p>
                <p className="text-2xl font-bold text-yellow-300">{submittedRequests.filter(r => r.status === "pending").length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Approved</p>
                <p className="text-2xl font-bold text-green-300">{submittedRequests.filter(r => r.status === "approved").length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Rejected</p>
                <p className="text-2xl font-bold text-red-300">{submittedRequests.filter(r => r.status === "rejected").length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Closed</p>
                <p className="text-2xl font-bold text-slate-300">{submittedRequests.filter(r => r.status === "closed").length}</p>
              </div>
            </div>

            {/* Requests List */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Track Status</h3>
              <div className="space-y-3">
                {submittedRequests.map(request => (
                  <div key={request.id} className="border border-white/10 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">{request.type}</p>
                        <p className="text-xs text-slate-400 mt-1">Submitted: {request.submittedDate}</p>
                        <p className="text-sm text-slate-300 mt-2">{request.details}</p>
                      </div>
                      <span className={`px-3 py-1 rounded text-xs font-semibold whitespace-nowrap ml-3 ${getStatusColor(request.status)}`}>
                        {getStatusIcon(request.status)} {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Submit Request Buttons */}
            <div className="grid gap-3 md:grid-cols-2">
              <button
                onClick={() => { setModalType("pto"); setShowModal(true); }}
                className="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2"
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
                    <div>
                      <label className="text-xs font-semibold text-white block mb-1">Date</label>
                      <input 
                        type="date" 
                        value={formData.correctionDate}
                        onChange={(e) => setFormData({ ...formData, correctionDate: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500" 
                      />
                    </div>
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
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitRequest}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition flex items-center justify-center gap-2"
                  >
                    <Plus className="h-3 w-3" />
                    Submit
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

      {/* Payslip Modal */}
      {payslipModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-lg w-[95vw] h-[95vh] max-w-7xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-white/10">
              <h2 className="text-2xl font-bold text-white">
                {selectedPayslipId === "current" ? "Current Payslip" : "Payslip"}
              </h2>
              <button
                onClick={() => setPayslipModalOpen(false)}
                className="p-1 hover:bg-white/10 rounded transition"
              >
                <X className="h-5 w-5 text-slate-300" />
              </button>
            </div>

            {/* Payslip Content */}
            <div className="flex-1 overflow-y-auto bg-white">
              <iframe
                ref={iframeRef}
                srcDoc={generatePayslipHTML(payslipData)}
                className="w-full h-full border-none"
                title="Payslip"
              />
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
