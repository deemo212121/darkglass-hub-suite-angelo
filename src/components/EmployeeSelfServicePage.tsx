import { ChevronLeft, DollarSign, Calendar, Clock, ListTodo, Download, Eye, EyeOff, TrendingUp, AlertCircle, CheckCircle2, XCircle, Plus, FileText } from "lucide-react";
import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/db";

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

export function EmployeeSelfServicePage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef; }) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "payroll" | "attendance" | "pto" | "requests">("dashboard");
  const [expandedPayslip, setExpandedPayslip] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<"pto" | "dispute" | "correction" | "inquiry">("pto");
  const [attendanceView, setAttendanceView] = useState<"daily" | "monthly">("daily");
  const [showLoginLogout, setShowLoginLogout] = useState(false);

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
            {/* Current Payroll */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Current Payroll</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Period</p>
                  <p className="text-lg font-semibold text-white">{CURRENT_PAYROLL.period}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Issue Date</p>
                  <p className="text-lg font-semibold text-white">{CURRENT_PAYROLL.date}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Gross Pay</p>
                  <p className="text-lg font-semibold text-blue-300">${CURRENT_PAYROLL.grossPay}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Net Pay</p>
                  <p className="text-lg font-semibold text-green-300">${CURRENT_PAYROLL.netPay}</p>
                </div>
              </div>
              <button
                onClick={() => handleDownload("payslip")}
                className="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center justify-center gap-2"
              >
                <Download className="h-3 w-3" />
                Download Payslip (PDF)
              </button>
            </div>

            {/* Payroll Breakdown */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Payroll Breakdown</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Regular Hours: 160 × $20/hr</span>
                  <span className="text-white font-semibold">$3,200</span>
                </div>
                <div className="flex justify-between text-sm border-t border-white/10 pt-3">
                  <span className="text-slate-300">Deductions</span>
                  <span className="text-red-300 font-semibold">-${CURRENT_PAYROLL.deductions}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Taxes (12%)</span>
                  <span className="text-red-300">-$240</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Benefits</span>
                  <span className="text-red-300">-$160</span>
                </div>
                <div className="flex justify-between text-sm border-t border-white/10 pt-3 font-bold">
                  <span className="text-white">Net Pay</span>
                  <span className="text-green-300">${CURRENT_PAYROLL.netPay}</span>
                </div>
              </div>
            </div>

            {/* Overtime Details */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Overtime Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-300">Overtime Hours</span>
                  <span className="text-white font-semibold">8 hours</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Rate</span>
                  <span className="text-white font-semibold">$30/hr (1.5x)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Overtime Pay</span>
                  <span className="text-amber-300 font-semibold">${CURRENT_PAYROLL.overtime}</span>
                </div>
              </div>
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
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-300">${payroll.netPay}</p>
                        <p className="text-xs text-slate-400">Net Pay</p>
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
            <div className="flex gap-2">
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
            </div>

            {attendanceView === "daily" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Daily Attendance</h3>
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
                      {ATTENDANCE_DAILY.map((record, idx) => (
                        <tr key={idx} className="border-b border-white/10 hover:bg-white/5">
                          <td className="px-3 py-2 text-white">{record.date}</td>
                          <td className="px-3 py-2 text-center text-slate-300">{record.clockIn}</td>
                          <td className="px-3 py-2 text-center text-slate-300">{record.clockOut}</td>
                          <td className="px-3 py-2 text-center text-slate-300">{record.hoursWorked.toFixed(2)}h</td>
                          <td className="px-3 py-2 text-center">
                            <span className="px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs font-semibold">✓</span>
                          </td>
                        </tr>
                      ))}
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
                <p className="text-2xl font-bold text-yellow-300">{ALL_REQUESTS.filter(r => r.status === "pending").length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Approved</p>
                <p className="text-2xl font-bold text-green-300">{ALL_REQUESTS.filter(r => r.status === "approved").length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Rejected</p>
                <p className="text-2xl font-bold text-red-300">{ALL_REQUESTS.filter(r => r.status === "rejected").length}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Closed</p>
                <p className="text-2xl font-bold text-slate-300">{ALL_REQUESTS.filter(r => r.status === "closed").length}</p>
              </div>
            </div>

            {/* Requests List */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Track Status</h3>
              <div className="space-y-3">
                {ALL_REQUESTS.map(request => (
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-bold text-white mb-4">
              {modalType === "pto" && "Submit PTO Request"}
              {modalType === "dispute" && "Submit Attendance Dispute"}
              {modalType === "correction" && "Submit Time Correction Request"}
              {modalType === "inquiry" && "Submit Payroll Inquiry"}
            </h2>

            <div className="space-y-3">
              {modalType === "pto" && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-white block mb-1">Leave Type</label>
                    <select className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500">
                      <option>Vacation</option>
                      <option>Sick Leave</option>
                      <option>Personal</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-white block mb-1">Start Date</label>
                      <input type="date" className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-white block mb-1">End Date</label>
                      <input type="date" className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm" />
                    </div>
                  </div>
                </>
              )}
              {modalType === "correction" && (
                <div>
                  <label className="text-xs font-semibold text-white block mb-1">Date</label>
                  <input type="date" className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm" />
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-white block mb-1">Details / Reason</label>
                <textarea
                  placeholder="Please provide details..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500"
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
                onClick={() => setShowModal(false)}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
