import { useState, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Users, CheckCircle, XCircle, Clock, Calendar, AlertCircle, TrendingUp, DollarSign, ExternalLink, Search, X } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface EmployeeStatus {
  id: string;
  name: string;
  status: "present" | "absent" | "late";
  checkInTime?: string;
  checkOutTime?: string;
  hoursWorked?: number;
  overtimeHours?: number;
}

interface EmployeeMonthlyStats {
  employeeId: string;
  employeeName: string;
  lateCount: number;
  absentCount: number;
  presentCount: number;
  totalWorkingDays: number;
}

interface EmployeeDetail extends EmployeeStatus {
  monthlyStats: EmployeeMonthlyStats;
  totalHoursMonth: number;
  totalOvertimeMonth: number;
  performance: "Excellent" | "Good" | "Average" | "Needs Improvement";
}

interface TimeCardEntry {
  employeeId: string;
  employeeName: string;
  date: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absences: number;
  holidayPay: number;
}

interface PayrollData {
  period: string;
  cutoffDate: string;
  status: "draft" | "pending" | "approved";
  totalEmployees: number;
  totalGrossPay: number;
  totalDeductions: number;
  entries: PayrollEntry[];
}

interface PayrollEntry {
  employeeId: string;
  employeeName: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absences: number;
  holidayPay: number;
  grossPay: number;
  deductions: number;
  netPay: number;
}

const COLORS = ["#34d399", "#f87171", "#fb923c"];

export function AccountingDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [activeTab, setActiveTab] = useState<"attendance" | "hours" | "payroll">("attendance");
  const [cutoffDate, setCutoffDate] = useState(new Date().toISOString().split("T")[0]);
  const [employees, setEmployees] = useState<EmployeeStatus[]>([]);
  const [timeCards, setTimeCards] = useState<TimeCardEntry[]>([]);
  const [payrollData, setPayrollData] = useState<PayrollData | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<EmployeeMonthlyStats[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Generate mock data
  useEffect(() => {
    const mockEmployees: EmployeeStatus[] = [
      { id: "1", name: "John Doe", status: "present", checkInTime: "08:00", checkOutTime: "17:30", hoursWorked: 9.5 },
      { id: "2", name: "Jane Smith", status: "present", checkInTime: "08:15", checkOutTime: "18:00", hoursWorked: 9.75 },
      { id: "3", name: "Bob Johnson", status: "late", checkInTime: "09:45", checkOutTime: "18:30", hoursWorked: 8.75, overtimeHours: 0.5 },
      { id: "4", name: "Alice Brown", status: "absent" },
      { id: "5", name: "Charlie Wilson", status: "present", checkInTime: "07:30", checkOutTime: "17:00", hoursWorked: 9.5 },
      { id: "6", name: "Diana Lee", status: "present", checkInTime: "08:00", checkOutTime: "18:00", hoursWorked: 10, overtimeHours: 1 },
      { id: "7", name: "Edward Davis", status: "late", checkInTime: "10:00", checkOutTime: "19:00", hoursWorked: 8.5 },
      { id: "8", name: "Fiona Garcia", status: "present", checkInTime: "08:00", checkOutTime: "17:00", hoursWorked: 9 },
    ];
    setEmployees(mockEmployees);

    // Monthly statistics
    const mockMonthlyStats: EmployeeMonthlyStats[] = [
      { employeeId: "1", employeeName: "John Doe", lateCount: 1, absentCount: 0, presentCount: 19, totalWorkingDays: 20 },
      { employeeId: "2", employeeName: "Jane Smith", lateCount: 0, absentCount: 1, presentCount: 19, totalWorkingDays: 20 },
      { employeeId: "3", employeeName: "Bob Johnson", lateCount: 4, absentCount: 0, presentCount: 16, totalWorkingDays: 20 },
      { employeeId: "4", employeeName: "Alice Brown", lateCount: 2, absentCount: 3, presentCount: 15, totalWorkingDays: 20 },
      { employeeId: "5", employeeName: "Charlie Wilson", lateCount: 0, absentCount: 0, presentCount: 20, totalWorkingDays: 20 },
      { employeeId: "6", employeeName: "Diana Lee", lateCount: 0, absentCount: 0, presentCount: 20, totalWorkingDays: 20 },
      { employeeId: "7", employeeName: "Edward Davis", lateCount: 3, absentCount: 1, presentCount: 16, totalWorkingDays: 20 },
      { employeeId: "8", employeeName: "Fiona Garcia", lateCount: 0, absentCount: 0, presentCount: 20, totalWorkingDays: 20 },
    ];
    setMonthlyStats(mockMonthlyStats);

    const mockTimeCards: TimeCardEntry[] = [
      { employeeId: "1", employeeName: "John Doe", date: "2026-06-02", hoursWorked: 40, overtimeHours: 2, ptoHours: 0, absences: 0, holidayPay: 0 },
      { employeeId: "2", employeeName: "Jane Smith", date: "2026-06-02", hoursWorked: 40, overtimeHours: 0, ptoHours: 8, absences: 0, holidayPay: 0 },
      { employeeId: "3", employeeName: "Bob Johnson", date: "2026-06-02", hoursWorked: 40, overtimeHours: 3, ptoHours: 0, absences: 0, holidayPay: 0 },
      { employeeId: "4", employeeName: "Alice Brown", date: "2026-06-02", hoursWorked: 32, overtimeHours: 0, ptoHours: 0, absences: 8, holidayPay: 0 },
      { employeeId: "5", employeeName: "Charlie Wilson", date: "2026-06-02", hoursWorked: 40, overtimeHours: 1, ptoHours: 0, absences: 0, holidayPay: 0 },
      { employeeId: "6", employeeName: "Diana Lee", date: "2026-06-02", hoursWorked: 40, overtimeHours: 5, ptoHours: 0, absences: 0, holidayPay: 0 },
      { employeeId: "7", employeeName: "Edward Davis", date: "2026-06-02", hoursWorked: 40, overtimeHours: 2, ptoHours: 0, absences: 0, holidayPay: 0 },
      { employeeId: "8", employeeName: "Fiona Garcia", date: "2026-06-02", hoursWorked: 40, overtimeHours: 0, ptoHours: 0, absences: 0, holidayPay: 0 },
    ];
    setTimeCards(mockTimeCards);

    const mockPayroll: PayrollData = {
      period: "June 1-15, 2026",
      cutoffDate: "2026-06-15",
      status: "draft",
      totalEmployees: 8,
      totalGrossPay: 28500,
      totalDeductions: 5700,
      entries: mockTimeCards.map((tc, i) => ({
        employeeId: tc.employeeId,
        employeeName: tc.employeeName,
        hoursWorked: tc.hoursWorked,
        overtimeHours: tc.overtimeHours,
        ptoHours: tc.ptoHours,
        absences: tc.absences,
        holidayPay: tc.holidayPay,
        grossPay: (tc.hoursWorked * 20) + (tc.overtimeHours * 30) + (tc.ptoHours * 20) + tc.holidayPay,
        deductions: ((tc.hoursWorked * 20) + (tc.overtimeHours * 30) + (tc.ptoHours * 20) + tc.holidayPay) * 0.2,
        netPay: (((tc.hoursWorked * 20) + (tc.overtimeHours * 30) + (tc.ptoHours * 20) + tc.holidayPay) * 0.8),
      })),
    };
    setPayrollData(mockPayroll);
  }, []);

  const attendanceStats = useMemo(() => {
    return {
      total: employees.length,
      present: employees.filter(e => e.status === "present").length,
      absent: employees.filter(e => e.status === "absent").length,
      late: employees.filter(e => e.status === "late").length,
    };
  }, [employees]);

  const hoursStats = useMemo(() => {
    const totals = timeCards.reduce((acc, tc) => ({
      hours: acc.hours + tc.hoursWorked,
      overtime: acc.overtime + tc.overtimeHours,
      pto: acc.pto + tc.ptoHours,
      absences: acc.absences + tc.absences,
    }), { hours: 0, overtime: 0, pto: 0, absences: 0 });
    return totals;
  }, [timeCards]);

  const handleEmployeeClick = (emp: EmployeeStatus) => {
    window.open(`/employee/${emp.id}`, "_blank");
  };

  const attendanceChartData = [
    { name: "Present", value: attendanceStats.present, fill: COLORS[0] },
    { name: "Late", value: attendanceStats.late, fill: COLORS[2] },
    { name: "Absent", value: attendanceStats.absent, fill: COLORS[1] },
  ];

  const hoursChartData = [
    { category: "Regular", hours: hoursStats.hours },
    { category: "Overtime", hours: hoursStats.overtime },
    { category: "PTO", hours: hoursStats.pto },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Employees</p>
                <p className="text-3xl font-bold text-blue-300">{attendanceStats.total}</p>
              </div>
              <Users className="h-8 w-8 text-blue-400 opacity-60" />
            </div>
          </div>
          <div className="panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Present Today</p>
                <p className="text-3xl font-bold text-green-300">{attendanceStats.present}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-400 opacity-60" />
            </div>
          </div>
          <div className="panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Absent Today</p>
                <p className="text-3xl font-bold text-red-300">{attendanceStats.absent}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-400 opacity-60" />
            </div>
          </div>
          <div className="panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Late Today</p>
                <p className="text-3xl font-bold text-yellow-300">{attendanceStats.late}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-400 opacity-60" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("attendance")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === "attendance"
                ? "bg-blue-600 text-white"
                : "btn"
            }`}
          >
            Attendance Monitoring
          </button>
          <button
            onClick={() => setActiveTab("hours")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === "hours"
                ? "bg-blue-600 text-white"
                : "btn"
            }`}
          >
            Hours Worked & Time Card
          </button>
          <button
            onClick={() => setActiveTab("payroll")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === "payroll"
                ? "bg-blue-600 text-white"
                : "btn"
            }`}
          >
            Payroll Calculation
          </button>
        </div>

        {/* Attendance Tab */}
        {activeTab === "attendance" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="panel p-4">
                <p className="text-sm font-semibold mb-4">Attendance Overview</p>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={attendanceChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {attendanceChartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="panel p-4">
                <p className="text-sm font-semibold mb-4">Attendance by Status</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-md bg-white/5">
                    <span className="text-sm">Present</span>
                    <span className="text-green-300 font-semibold">{attendanceStats.present}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-md bg-white/5">
                    <span className="text-sm">Late</span>
                    <span className="text-yellow-300 font-semibold">{attendanceStats.late}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-md bg-white/5">
                    <span className="text-sm">Absent</span>
                    <span className="text-red-300 font-semibold">{attendanceStats.absent}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Employee Attendance Table */}
            <div className="panel p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center justify-between">
                <span>Employee Attendance Details</span>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search employee..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="glass-input rounded pl-9 pr-9 py-2 bg-white/10 border border-white/20 text-sm w-full"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Check In</th>
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Check Out</th>
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {employees
                    .filter((emp) => emp.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((emp, i) => (
                    <tr key={emp.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleEmployeeClick(emp)}
                          className="font-medium text-blue-400 hover:text-blue-300 cursor-pointer flex items-center gap-1"
                        >
                          {emp.name}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          emp.status === "present" ? "bg-green-500/20 text-green-300" :
                          emp.status === "late" ? "bg-yellow-500/20 text-yellow-300" :
                          "bg-red-500/20 text-red-300"
                        }`}>
                          {emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{emp.checkInTime || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{emp.checkOutTime || "—"}</td>
                      <td className="px-4 py-3">{emp.hoursWorked ? emp.hoursWorked.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Monthly Attendance Statistics */}
            <div className="panel p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">
                Monthly Attendance Summary (June 2026)
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                    <th className="px-4 py-3 text-center text-xs text-muted-foreground uppercase">Present</th>
                    <th className="px-4 py-3 text-center text-xs text-muted-foreground uppercase">Late</th>
                    <th className="px-4 py-3 text-center text-xs text-muted-foreground uppercase">Absent</th>
                    <th className="px-4 py-3 text-center text-xs text-muted-foreground uppercase">Total Days</th>
                    <th className="px-4 py-3 text-center text-xs text-muted-foreground uppercase">Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyStats.map((stat, i) => {
                    const attendanceRate = ((stat.presentCount / stat.totalWorkingDays) * 100).toFixed(1);
                    return (
                      <tr key={stat.employeeId} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                        <td className="px-4 py-3 font-medium text-blue-400 cursor-pointer hover:text-blue-300"
                          onClick={() => handleEmployeeClick(employees.find(e => e.id === stat.employeeId)!)}>
                          {stat.employeeName}
                        </td>
                        <td className="px-4 py-3 text-center text-green-300 font-semibold">{stat.presentCount}</td>
                        <td className="px-4 py-3 text-center text-yellow-300 font-semibold">{stat.lateCount}</td>
                        <td className="px-4 py-3 text-center text-red-300 font-semibold">{stat.absentCount}</td>
                        <td className="px-4 py-3 text-center">{stat.totalWorkingDays}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            Number(attendanceRate) >= 95 ? "bg-green-500/20 text-green-300" :
                            Number(attendanceRate) >= 90 ? "bg-blue-500/20 text-blue-300" :
                            "bg-red-500/20 text-red-300"
                          }`}>
                            {attendanceRate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Hours Worked Tab */}
        {activeTab === "hours" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="panel p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Hours</p>
                <p className="text-2xl font-bold text-blue-300">{hoursStats.hours}</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Overtime Hours</p>
                <p className="text-2xl font-bold text-orange-300">{hoursStats.overtime}</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">PTO Hours</p>
                <p className="text-2xl font-bold text-purple-300">{hoursStats.pto}</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Absences</p>
                <p className="text-2xl font-bold text-red-300">{hoursStats.absences}</p>
              </div>
            </div>

            <div className="panel p-4">
              <p className="text-sm font-semibold mb-4">Hours Distribution</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={hoursChartData}>
                  <XAxis dataKey="category" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
                  <Bar dataKey="hours" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Time Card Table */}
            <div className="panel p-0 overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm min-w-[900px]">
                Time Card Details
              </div>
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Regular Hours</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Overtime</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">PTO</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Absences</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Holiday Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {timeCards.map((tc, i) => (
                    <tr key={tc.employeeId} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-3 font-medium">{tc.employeeName}</td>
                      <td className="px-4 py-3 text-right">{tc.hoursWorked}</td>
                      <td className="px-4 py-3 text-right text-orange-300 font-semibold">{tc.overtimeHours}</td>
                      <td className="px-4 py-3 text-right text-purple-300">{tc.ptoHours}</td>
                      <td className="px-4 py-3 text-right text-red-300">{tc.absences}</td>
                      <td className="px-4 py-3 text-right text-green-300">${tc.holidayPay.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Payroll Tab */}
        {activeTab === "payroll" && payrollData && (
          <div className="space-y-4">
            {/* Payroll Period Controls */}
            <div className="panel p-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Payroll Period
                  </label>
                  <select className="glass-input text-sm py-2 px-3 rounded-md">
                    <option>June 1-15, 2026</option>
                    <option>May 16-31, 2026</option>
                    <option>May 1-15, 2026</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Cutoff Date
                  </label>
                  <input
                    type="date"
                    value={cutoffDate}
                    onChange={(e) => setCutoffDate(e.target.value)}
                    className="glass-input text-sm py-2 px-3 rounded-md"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Status
                  </label>
                  <select className="glass-input text-sm py-2 px-3 rounded-md">
                    <option selected>Draft</option>
                    <option>Pending Review</option>
                    <option>Approved</option>
                  </select>
                </div>
                <button className="btn text-sm px-4 py-2">Generate Payslip</button>
              </div>
            </div>

            {/* Payroll Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="panel p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Gross Pay</p>
                <p className="text-3xl font-bold text-green-300">${payrollData.totalGrossPay.toLocaleString()}</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Deductions</p>
                <p className="text-3xl font-bold text-red-300">${payrollData.totalDeductions.toLocaleString()}</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Net Payroll</p>
                <p className="text-3xl font-bold text-blue-300">
                  ${(payrollData.totalGrossPay - payrollData.totalDeductions).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Payroll Details Table */}
            <div className="panel p-0 overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm min-w-[1200px]">
                Payroll Details - {payrollData.period}
              </div>
              <table className="w-full text-sm min-w-[1200px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Reg Hours</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">OT Hours</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">PTO</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Absences</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Holiday</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Gross Pay</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Deductions</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollData.entries.map((entry, i) => (
                    <tr key={entry.employeeId} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-3 font-medium">{entry.employeeName}</td>
                      <td className="px-4 py-3 text-right">{entry.hoursWorked}</td>
                      <td className="px-4 py-3 text-right text-orange-300 font-semibold">{entry.overtimeHours}</td>
                      <td className="px-4 py-3 text-right">{entry.ptoHours}</td>
                      <td className="px-4 py-3 text-right text-red-300">{entry.absences}</td>
                      <td className="px-4 py-3 text-right">${entry.holidayPay.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-green-300 font-semibold">${entry.grossPay.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-red-300">${entry.deductions.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-green-400 font-semibold">${entry.netPay.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
