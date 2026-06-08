import { ChevronLeft, TrendingUp, AlertCircle, Download, CheckCircle2, AlertTriangle, X, Activity, BarChart3, LineChart as LineChartIcon, RefreshCw } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/db";

interface PayrollEmployee {
  id: string;
  name: string;
  department: string;
  country: "US" | "PH";
  hoursWorked: number;
  hourlyRate: number;
  totalWages: number;
}

interface SalaryHistory {
  effectiveDate: string; // YYYY-MM-DD
  hourlyRate: number;
  reason: string;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  hourlyRate: number; // Current rate
  salaryHistory: SalaryHistory[];
  currency: "USD" | "PHP";
}

interface PayrollData {
  employeeId: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absenceHours: number;
  holidayPay: number;
}

interface PayrollCalculation {
  employeeId: string;
  employeeName: string;
  department: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absenceHours: number;
  regularPay: number;
  overtimePay: number;
  ptoPay: number;
  holidayPay: number;
  grossPay: number;
  currency: "USD" | "PHP";
}

const EMPLOYEES: Employee[] = [
  { 
    id: "1", 
    name: "John Doe", 
    department: "Operations", 
    hourlyRate: 25, 
    currency: "USD",
    salaryHistory: [
      { effectiveDate: "2026-05-01", hourlyRate: 22, reason: "Initial hire" },
      { effectiveDate: "2026-06-05", hourlyRate: 25, reason: "Salary increase after probation" }
    ]
  },
  { 
    id: "2", 
    name: "Jane Smith", 
    department: "Customer Service", 
    hourlyRate: 22, 
    currency: "USD",
    salaryHistory: [
      { effectiveDate: "2026-01-15", hourlyRate: 20, reason: "Initial hire" },
      { effectiveDate: "2026-04-01", hourlyRate: 22, reason: "Annual merit increase" }
    ]
  },
  { 
    id: "3", 
    name: "Mike Brown", 
    department: "Parts", 
    hourlyRate: 28, 
    currency: "USD",
    salaryHistory: [
      { effectiveDate: "2025-06-10", hourlyRate: 26, reason: "Initial hire" },
      { effectiveDate: "2026-06-01", hourlyRate: 28, reason: "Promotion to senior role" }
    ]
  },
  { 
    id: "4", 
    name: "Sarah Johnson", 
    department: "Finance", 
    hourlyRate: 30, 
    currency: "USD",
    salaryHistory: [
      { effectiveDate: "2025-03-01", hourlyRate: 28, reason: "Initial hire" },
      { effectiveDate: "2026-02-01", hourlyRate: 30, reason: "Cost of living adjustment" }
    ]
  },
  { 
    id: "5", 
    name: "Tom Wilson", 
    department: "Operations", 
    hourlyRate: 26, 
    currency: "USD",
    salaryHistory: [
      { effectiveDate: "2026-04-15", hourlyRate: 24, reason: "Initial hire" },
      { effectiveDate: "2026-06-08", hourlyRate: 26, reason: "Performance bonus - permanent increase" }
    ]
  },
];

const PAYROLL_DATA: Record<string, PayrollData> = {
  "1": { employeeId: "1", hoursWorked: 160, overtimeHours: 5, ptoHours: 8, absenceHours: 0, holidayPay: 200 },
  "2": { employeeId: "2", hoursWorked: 160, overtimeHours: 0, ptoHours: 0, absenceHours: 4, holidayPay: 0 },
  "3": { employeeId: "3", hoursWorked: 165, overtimeHours: 8, ptoHours: 0, absenceHours: 0, holidayPay: 200 },
  "4": { employeeId: "4", hoursWorked: 160, overtimeHours: 2, ptoHours: 0, absenceHours: 0, holidayPay: 200 },
  "5": { employeeId: "5", hoursWorked: 155, overtimeHours: 0, ptoHours: 16, absenceHours: 0, holidayPay: 0 },
};

const OT_MULTIPLIER = 1.5; // Overtime at 1.5x

export function PayrollCalculationPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef; }) {
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [processedEmployees, setProcessedEmployees] = useState<string[]>([]);
  const [showSalaryHistory, setShowSalaryHistory] = useState<string | null>(null);
  const [payrollEmployees, setPayrollEmployees] = useState<PayrollEmployee[]>([]);
  const [dataSource, setDataSource] = useState<"accounting" | "local">("accounting");
  const downloadHandlerRef = useRef<() => void>(() => {});

  // Load payroll data from AccountingDashboard or use local data
  useEffect(() => {
    try {
      const storedEmployees = localStorage.getItem("payroll_employees");
      if (storedEmployees) {
        const employees = JSON.parse(storedEmployees);
        setPayrollEmployees(employees);
        setDataSource("accounting");
      } else {
        // Fallback to local employees if no shared data
        const localEmployees = EMPLOYEES.map(e => ({
          id: e.id,
          name: e.name,
          department: e.department,
          country: e.currency as "US" | "PH",
          hoursWorked: PAYROLL_DATA[e.id]?.hoursWorked || 160,
          hourlyRate: e.hourlyRate,
          totalWages: (PAYROLL_DATA[e.id]?.hoursWorked || 160) * e.hourlyRate,
        }));
        setPayrollEmployees(localEmployees);
        setDataSource("local");
      }
    } catch (error) {
      console.error("Error loading payroll employees:", error);
      setDataSource("local");
    }
  }, []);

  // Listen for updates from AccountingDashboard
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "payroll_employees") {
        try {
          const updated = JSON.parse(e.newValue || "[]");
          setPayrollEmployees(updated);
          setDataSource("accounting");
        } catch (error) {
          console.error("Error updating payroll employees:", error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const departments = [...new Set(EMPLOYEES.map(e => e.department))];

  // Helper function to calculate pro-rata pay when salary changes mid-period
  const calculateProRataPay = (employeeId: string, hoursWorked: number, periodStart: string, periodEnd: string) => {
    const employee = EMPLOYEES.find(e => e.id === employeeId);
    if (!employee) return 0;

    // If no salary changes in this period, use current rate
    const changesInPeriod = employee.salaryHistory.filter(
      h => h.effectiveDate >= periodStart && h.effectiveDate <= periodEnd
    );

    if (changesInPeriod.length === 0) {
      // No changes in period - use the rate that was active at period start
      const activeRate = employee.salaryHistory
        .filter(h => h.effectiveDate <= periodStart)
        .sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime())[0];
      return hoursWorked * (activeRate?.hourlyRate || employee.hourlyRate);
    }

    // Has changes - calculate pro-rata
    const sortedHistory = [...employee.salaryHistory].sort(
      (a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime()
    );

    let totalPay = 0;
    let currentDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    for (let i = 0; i < sortedHistory.length; i++) {
      const changeDate = new Date(sortedHistory[i].effectiveDate);
      if (changeDate > endDate) break;

      const nextChangeDate = i + 1 < sortedHistory.length 
        ? new Date(sortedHistory[i + 1].effectiveDate)
        : endDate;

      const rateStart = new Date(Math.max(currentDate.getTime(), changeDate.getTime()));
      const rateEnd = new Date(Math.min(endDate.getTime(), nextChangeDate.getTime()));

      const daysInRange = (rateEnd.getTime() - rateStart.getTime()) / (1000 * 60 * 60 * 24);
      const hoursInRange = (daysInRange / 7) * hoursWorked; // Pro-rata based on days

      totalPay += hoursInRange * sortedHistory[i].hourlyRate;
    }

    return totalPay;
  };

  // Check if employee has salary changes in the current period
  const hasSalaryChange = (employeeId: string) => {
    const employee = EMPLOYEES.find(e => e.id === employeeId);
    if (!employee) return false;
    const periodStart = "2026-06-01";
    const periodEnd = "2026-06-15";
    return employee.salaryHistory.some(
      h => h.effectiveDate >= periodStart && h.effectiveDate <= periodEnd
    );
  };

  const payrollCalculations = useMemo<PayrollCalculation[]>(() => {
    // Merge AccountingDashboard data with local EMPLOYEES data
    const employeeMap = new Map(EMPLOYEES.map(e => [e.id, e]));
    
    // Use payrollEmployees if available, otherwise fall back to EMPLOYEES
    const dataSource = payrollEmployees.length > 0 ? payrollEmployees : EMPLOYEES.map(e => ({
      id: e.id,
      name: e.name,
      department: e.department,
      country: e.currency as "US" | "PH",
      hoursWorked: PAYROLL_DATA[e.id]?.hoursWorked || 160,
      hourlyRate: e.hourlyRate,
      totalWages: 0,
    }));

    return dataSource.map((emp: any) => {
      const localEmployee = employeeMap.get(emp.id);
      const data = PAYROLL_DATA[emp.id];
      if (!data && !payrollEmployees.length) return null;

      // Use from AccountingDashboard if available
      const hoursWorked = emp.hoursWorked || data?.hoursWorked || 160;
      const hourlyRate = emp.hourlyRate || localEmployee?.hourlyRate || 0;
      
      // Calculate based on AccountingDashboard data if available
      const overtimeHours = data?.overtimeHours || 0;
      const ptoHours = data?.ptoHours || 0;
      const absenceHours = data?.absenceHours || 0;
      const holidayPay = data?.holidayPay || 0;

      const regularPay = hoursWorked * hourlyRate;
      const overtimePay = overtimeHours * hourlyRate * OT_MULTIPLIER;
      const ptoPay = ptoHours * hourlyRate;
      const grossPay = regularPay + overtimePay + ptoPay + holidayPay;

      return {
        employeeId: emp.id,
        employeeName: emp.name,
        department: emp.department,
        hoursWorked,
        overtimeHours,
        ptoHours,
        absenceHours,
        regularPay: Math.round(regularPay * 100) / 100,
        overtimePay: Math.round(overtimePay * 100) / 100,
        ptoPay: Math.round(ptoPay * 100) / 100,
        holidayPay,
        grossPay: Math.round(grossPay * 100) / 100,
        currency: emp.country || localEmployee?.currency || "USD",
      };
    }).filter(Boolean) as PayrollCalculation[];
  }, [payrollEmployees]);

  const filteredPayroll = selectedDepartment
    ? payrollCalculations.filter(p => p.department === selectedDepartment)
    : payrollCalculations;

  const totalGrossPay = useMemo(() => {
    return Math.round(filteredPayroll.reduce((sum, p) => sum + p.grossPay, 0) * 100) / 100;
  }, [filteredPayroll]);

  // Validation helpers
  const getPayrollIssues = () => {
    const issues = [];
    const employeesWithAbsences = filteredPayroll.filter(p => p.absenceHours > 0);
    const employeesWithoutHours = filteredPayroll.filter(p => p.hoursWorked === 0);
    const employeesOvertime = filteredPayroll.filter(p => p.overtimeHours > 20);

    if (employeesWithAbsences.length > 0) {
      issues.push({
        type: "warning",
        message: `${employeesWithAbsences.length} employee(s) have absence hours recorded`,
        severity: "medium",
      });
    }
    if (employeesWithoutHours.length > 0) {
      issues.push({
        type: "error",
        message: `${employeesWithoutHours.length} employee(s) have no hours recorded`,
        severity: "high",
      });
    }
    if (employeesOvertime.length > 0) {
      issues.push({
        type: "warning",
        message: `${employeesOvertime.length} employee(s) have excessive overtime (>20 hours)`,
        severity: "medium",
      });
    }
    return issues;
  };

  const issues = getPayrollIssues();
  const hasErrors = issues.some(i => i.severity === "high");

  const handleProcessPayroll = () => {
    setProcessedEmployees(filteredPayroll.map(p => p.employeeId));
    setShowConfirmDialog(false);
    setTimeout(() => {
      setProcessedEmployees([]);
    }, 3000);
  };

  // Update download handler in ref whenever dependencies change
  useEffect(() => {
    downloadHandlerRef.current = () => {
      const today = new Date().toISOString().split("T")[0];
      let csvContent = "Payroll Report\n";
      csvContent += `Date: ${today}\n\n`;
      csvContent += "Employee,Department,Hours Worked,Overtime Hours,Regular Pay,Overtime Pay,PTO Pay,Holiday Pay,Gross Pay\n";

      filteredPayroll.forEach(p => {
        csvContent += `"${p.employeeName}","${p.department}",${p.hoursWorked},${p.overtimeHours},$${p.regularPay.toFixed(2)},$${p.overtimePay.toFixed(2)},$${p.ptoPay.toFixed(2)},$${p.holidayPay.toFixed(2)},$${p.grossPay.toFixed(2)}\n`;
      });

      csvContent += `\nTotal Gross Pay,$${totalGrossPay.toFixed(2)}\n`;
      csvContent += `Average Per Employee,$${(totalGrossPay / filteredPayroll.length).toFixed(2)}\n`;

      const element = document.createElement("a");
      element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent));
      element.setAttribute("download", `payroll-report-${today}.csv`);
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    };
  }, [filteredPayroll, totalGrossPay]);

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

        <div className="space-y-6">
          {/* Data Source & Sync Indicator */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-blue-500/30 bg-blue-900/20">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-slate-300">
                Data Source: <span className="font-semibold text-blue-300">
                  {dataSource === "accounting" ? "Accounting Dashboard (Real-time Sync)" : "Local Demo Data"}
                </span>
              </span>
            </div>
            <button
              onClick={() => {
                const storedEmployees = localStorage.getItem("payroll_employees");
                if (storedEmployees) {
                  setPayrollEmployees(JSON.parse(storedEmployees));
                  setDataSource("accounting");
                }
              }}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Sync Now
            </button>
          </div>
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Payroll Ready</p>
                  <p className="text-2xl font-bold text-green-400 mt-2">{filteredPayroll.length}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Payroll Errors</p>
                  <p className="text-2xl font-bold text-red-400 mt-2">{issues.filter(i => i.severity === "high").length}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Total Hours Worked</p>
                  <p className="text-2xl font-bold text-blue-400 mt-2">{filteredPayroll.reduce((sum, p) => sum + p.hoursWorked, 0).toFixed(0)}</p>
                </div>
                <Activity className="h-8 w-8 text-blue-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Total OT Hours</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-2">{filteredPayroll.reduce((sum, p) => sum + p.overtimeHours, 0).toFixed(0)}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-yellow-400 opacity-50" />
              </div>
            </div>
          </div>

          {/* MODULE 1: Payroll Engine */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-400" />
              Payroll Engine
            </h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-4">
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Regular Hours</p>
                <p className="text-blue-300">Hours Worked × Hourly Rate</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Overtime</p>
                <p className="text-yellow-300">Overtime Hours × Rate × 1.5</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">PTO Pay</p>
                <p className="text-purple-300">PTO Hours × Hourly Rate</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Holiday Pay</p>
                <p className="text-green-300">Fixed amount per holiday</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Deductions</p>
                <p className="text-red-300">Tax & Benefits (future)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Gross & Net Pay</p>
                <p className="text-emerald-300">Sum of all components</p>
              </div>
            </div>

            {/* Payroll Formula Section */}
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-3">Calculation Formula</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">1.</span>
                  <p className="text-slate-300">Regular Pay = Hours Worked × Hourly Rate</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">2.</span>
                  <p className="text-slate-300">Overtime Pay = Overtime Hours × Hourly Rate × 1.5</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">3.</span>
                  <p className="text-slate-300">PTO Pay = PTO Hours × Hourly Rate</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">4.</span>
                  <p className="text-slate-300">Gross Pay = Regular + Overtime + PTO + Holiday Pay</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">5.</span>
                  <p className="text-slate-300">Net Pay = Gross Pay - Deductions</p>
                </div>
              </div>
            </div>
          </div>

          {/* MODULE 2: Payroll Error Detection */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Payroll Error Detection
            </h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-4">
              <div className={`border rounded p-3 ${issues.some(i => i.message.includes("no hours")) ? "bg-red-500/10 border-red-500/30" : "bg-slate-800/50 border-white/10"}`}>
                <p className="text-xs text-slate-400 font-semibold mb-1">Missing Clock-In</p>
                <p className={issues.some(i => i.message.includes("no hours")) ? "text-red-300" : "text-slate-300"}>{filteredPayroll.filter(p => p.hoursWorked === 0).length} employee(s)</p>
              </div>
              <div className={`border rounded p-3 ${issues.some(i => i.message.includes("excessive")) ? "bg-red-500/10 border-red-500/30" : "bg-slate-800/50 border-white/10"}`}>
                <p className="text-xs text-slate-400 font-semibold mb-1">Excessive Overtime</p>
                <p className={issues.some(i => i.message.includes("excessive")) ? "text-red-300" : "text-slate-300"}>{filteredPayroll.filter(p => p.overtimeHours > 20).length} employee(s)</p>
              </div>
              <div className={`border rounded p-3 ${issues.some(i => i.message.includes("absence")) ? "bg-yellow-500/10 border-yellow-500/30" : "bg-slate-800/50 border-white/10"}`}>
                <p className="text-xs text-slate-400 font-semibold mb-1">Absence Hours</p>
                <p className={issues.some(i => i.message.includes("absence")) ? "text-yellow-300" : "text-slate-300"}>{filteredPayroll.filter(p => p.absenceHours > 0).length} employee(s)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Missing Clock-Out</p>
                <p className="text-slate-300">0 employee(s)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Negative Hours</p>
                <p className="text-slate-300">0 employee(s)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Duplicate Records</p>
                <p className="text-slate-300">0 found</p>
              </div>
            </div>

            {/* Error Details */}
            {issues.length > 0 && (
              <div className={`border rounded-lg p-4 ${hasErrors ? "bg-red-500/10 border-red-500/40" : "bg-yellow-500/10 border-yellow-500/40"}`}>
                <h3 className={`text-sm font-bold mb-2 ${hasErrors ? "text-red-300" : "text-yellow-300"}`}>
                  {hasErrors ? "Critical Issues Found" : "Warnings"}
                </h3>
                <ul className="space-y-1">
                  {issues.map((issue, idx) => (
                    <li key={idx} className={`text-xs ${hasErrors ? "text-red-200" : "text-yellow-200"}`}>
                      • {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Salary Changes Quick Access Button */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Salary Changes Detected</h3>
              <p className="text-xs text-slate-400 mt-1">
                {filteredPayroll.filter(p => hasSalaryChange(p.employeeId)).length} employee(s) have salary changes in this period
              </p>
            </div>
            <button
              onClick={() => setShowSalaryHistory("list")}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm"
            >
              <TrendingUp className="h-4 w-4" />
              View Details
            </button>
          </div>
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <h3 className="text-sm font-bold text-white mb-3">Filter by Department</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedDepartment(null)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
                  selectedDepartment === null
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                All Departments
              </button>
              {departments.map(dept => (
                <button
                  key={dept}
                  onClick={() => setSelectedDepartment(dept)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
                    selectedDepartment === dept
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          </div>

          {/* Payroll Summary */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="text-sm font-bold text-white">Payroll Summary</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowConfirmDialog(true)}
                  disabled={hasErrors || processedEmployees.length > 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold transition ${
                    hasErrors || processedEmployees.length > 0
                      ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 text-white"
                  }`}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Process Payroll
                </button>
                <button
                  onClick={() => downloadHandlerRef.current()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
                >
                  <Download className="h-3 w-3" />
                  Download
                </button>
              </div>
            </div>

            {processedEmployees.length > 0 && (
              <div className="bg-green-500/10 border border-green-500/40 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  <p className="text-xs text-green-300">✓ Payroll processed successfully for {processedEmployees.length} employee(s)</p>
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3 mb-4">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                <p className="text-xs text-blue-300 mb-1">Total Employees</p>
                <p className="text-lg font-bold text-blue-300">{filteredPayroll.length}</p>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
                <p className="text-xs text-green-300 mb-1">Total Gross Pay</p>
                <p className="text-lg font-bold text-green-300">${totalGrossPay.toFixed(2)}</p>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3">
                <p className="text-xs text-purple-300 mb-1">Average Per Employee</p>
                <p className="text-lg font-bold text-purple-300">${(totalGrossPay / filteredPayroll.length).toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* MODULE 3: Payroll Preview */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-400" />
              Payroll Preview
            </h2>
            <div className="grid gap-3 mb-4 md:grid-cols-3">
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-2">Employee</p>
                <p className="text-sm text-slate-300">Name & Department</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-2">Hours Worked</p>
                <p className="text-sm text-blue-300">{filteredPayroll.reduce((sum, p) => sum + p.hoursWorked, 0).toFixed(0)} hrs</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-2">Overtime</p>
                <p className="text-sm text-yellow-300">{filteredPayroll.reduce((sum, p) => sum + p.overtimeHours, 0).toFixed(0)} hrs</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-2">Gross Pay</p>
                <p className="text-sm text-green-300">${totalGrossPay.toFixed(2)}</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-2">Deductions</p>
                <p className="text-sm text-red-300">$0.00 (pending)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-2">Net Pay</p>
                <p className="text-sm text-emerald-300">${totalGrossPay.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Analytics Section */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <LineChartIcon className="h-5 w-5 text-purple-400" />
              Analytics
            </h2>
            
            {/* Payroll Trends */}
            <div className="mb-6">
              <h3 className="text-sm font-bold text-white mb-3">Payroll Trends (Last 6 Periods)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={[
                  { period: "Week 1", grossPay: 5200, netPay: 4160 },
                  { period: "Week 2", grossPay: 5450, netPay: 4360 },
                  { period: "Week 3", grossPay: 5100, netPay: 4080 },
                  { period: "Week 4", grossPay: 5800, netPay: 4640 },
                  { period: "Week 5", grossPay: 5600, netPay: 4480 },
                  { period: "Week 6", grossPay: totalGrossPay, netPay: totalGrossPay },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="period" stroke="#999" />
                  <YAxis stroke="#999" />
                  <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }} />
                  <Legend />
                  <Line type="monotone" dataKey="grossPay" stroke="#22c55e" name="Gross Pay" strokeWidth={2} />
                  <Line type="monotone" dataKey="netPay" stroke="#3b82f6" name="Net Pay" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Overtime Trends */}
            <div className="mb-6">
              <h3 className="text-sm font-bold text-white mb-3">Overtime Trends (By Employee)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={filteredPayroll.slice(0, 5)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="employeeName" stroke="#999" />
                  <YAxis stroke="#999" />
                  <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }} />
                  <Legend />
                  <Bar dataKey="hoursWorked" fill="#3b82f6" name="Regular Hours" />
                  <Bar dataKey="overtimeHours" fill="#fbbf24" name="Overtime Hours" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Payroll History Summary */}
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-3">Payroll History</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center p-2 bg-slate-700/30 rounded">
                  <span className="text-slate-300">Current Period (Jun 1-15)</span>
                  <span className="text-green-300 font-semibold">${totalGrossPay.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-700/30 rounded">
                  <span className="text-slate-300">Previous Period (May 16-31)</span>
                  <span className="text-slate-400 font-semibold">$5,600.00</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-700/30 rounded">
                  <span className="text-slate-300">Monthly Total (June)</span>
                  <span className="text-blue-300 font-semibold">${(totalGrossPay * 2).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Payroll Details Table */}
          {showTable && (
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Payroll Details Preview</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ color: '#fff' }}>
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-2 text-left font-semibold" style={{ color: '#bfdbfe' }}>Employee</th>
                      <th className="px-3 py-2 text-left font-semibold" style={{ color: '#bfdbfe' }}>Department</th>
                      <th className="px-3 py-2 text-center font-semibold" style={{ color: '#bfdbfe' }}>Hours</th>
                      <th className="px-3 py-2 text-center font-semibold" style={{ color: '#bfdbfe' }}>OT Hours</th>
                      <th className="px-3 py-2 text-right font-semibold" style={{ color: '#bfdbfe' }}>Regular Pay</th>
                      <th className="px-3 py-2 text-right font-semibold" style={{ color: '#bfdbfe' }}>OT Pay</th>
                      <th className="px-3 py-2 text-right font-semibold" style={{ color: '#bfdbfe' }}>PTO Pay</th>
                      <th className="px-3 py-2 text-right font-semibold" style={{ color: '#bfdbfe' }}>Holiday Pay</th>
                      <th className="px-3 py-2 text-right font-semibold" style={{ color: '#bfdbfe' }}>Gross Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayroll.map(payroll => {
                      const hasIssue = payroll.absenceHours > 0 || payroll.hoursWorked === 0 || payroll.overtimeHours > 20;
                      return (
                        <tr 
                          key={payroll.employeeId} 
                          className={`border-b transition ${hasIssue ? "bg-yellow-500/5 border-yellow-500/30" : "border-white/5 hover:bg-white/5"}`}
                        >
                          <td className="px-3 py-2 font-medium" style={{ color: '#fff' }}>
                            {payroll.employeeName}
                            {hasIssue && <span className="text-yellow-400 ml-1">⚠</span>}
                          </td>
                          <td className="px-3 py-2" style={{ color: '#dbeafe' }}>{payroll.department}</td>
                          <td className="px-3 py-2 text-center" style={{ color: payroll.hoursWorked === 0 ? '#fca5a5' : '#dbeafe' }}>
                            {payroll.hoursWorked}
                            {payroll.hoursWorked === 0 && <span className="text-xs ml-1">⚠</span>}
                          </td>
                          <td className="px-3 py-2 text-center" style={{ color: payroll.overtimeHours > 20 ? '#fca5a5' : '#dbeafe' }}>
                            {payroll.overtimeHours}
                            {payroll.overtimeHours > 20 && <span className="text-xs ml-1">⚠</span>}
                          </td>
                          <td className="px-3 py-2 text-right" style={{ color: '#dbeafe' }}>${payroll.regularPay.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: '#dbeafe' }}>${payroll.overtimePay.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: payroll.ptoHours > 0 ? '#fbbf24' : '#dbeafe' }}>
                            ${payroll.ptoPay.toFixed(2)}
                            {payroll.ptoHours > 0 && <span className="text-xs ml-1">(+{payroll.ptoHours}h)</span>}
                          </td>
                          <td className="px-3 py-2 text-right" style={{ color: '#dbeafe' }}>${payroll.holidayPay.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-semibold" style={{ color: '#86efac' }}>${payroll.grossPay.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Salary Changes List Modal */}
      {showSalaryHistory === "list" && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Salary Changes & History</h2>
                <p className="text-sm text-slate-400 mt-1">
                  {filteredPayroll.filter(p => hasSalaryChange(p.employeeId)).length} employee(s) with changes in this period
                </p>
              </div>
              <button 
                onClick={() => setShowSalaryHistory(null)}
                className="text-slate-400 hover:text-white transition p-1"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 mb-6">
              {filteredPayroll.map(payroll => {
                const employee = EMPLOYEES.find(e => e.id === payroll.employeeId);
                const hasChange = hasSalaryChange(payroll.employeeId);
                const latestChange = employee?.salaryHistory[employee.salaryHistory.length - 1];
                
                return (
                  <div 
                    key={payroll.employeeId}
                    className={`border rounded-lg p-4 cursor-pointer transition ${
                      hasChange 
                        ? "bg-blue-500/10 border-blue-500/40 hover:bg-blue-500/15" 
                        : "bg-slate-800/50 border-white/10 hover:bg-slate-700/50"
                    }`}
                    onClick={() => setShowSalaryHistory(payroll.employeeId)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{payroll.employeeName}</p>
                        <p className="text-xs text-slate-400">{payroll.department}</p>
                      </div>
                      {hasChange && (
                        <span className="inline-block px-2 py-1 bg-blue-600 text-blue-100 text-xs font-semibold rounded">
                          Changed
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-300">
                        <span className="text-slate-400">Current Rate:</span> <span className="text-green-300 font-semibold">${payroll.regularPay / payroll.hoursWorked}</span>/hr
                      </p>
                      {latestChange && (
                        <p className="text-xs text-slate-300">
                          <span className="text-slate-400">Effective:</span> <span className="text-yellow-300">{latestChange.effectiveDate}</span>
                        </p>
                      )}
                      {hasChange && (
                        <p className="text-xs text-blue-300 mt-2">
                          📊 Pro-rata calculation applied
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-bold text-blue-300 mb-2">💡 Pro-rata Calculation</h3>
              <p className="text-xs text-blue-200">
                When an employee has a salary change during the payroll period, their pay is split proportionally:
              </p>
              <ul className="text-xs text-blue-200 mt-2 space-y-1">
                <li>• Days before change @ old rate</li>
                <li>• Days after change @ new rate</li>
                <li>• Total = (hours before × old rate) + (hours after × new rate)</li>
              </ul>
              <p className="text-xs text-blue-300 mt-3">
                💡 Click any card above to see detailed salary history
              </p>
            </div>

            <button
              onClick={() => setShowSalaryHistory(null)}
              className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Individual Employee Salary History Modal */}
      {showSalaryHistory && showSalaryHistory !== "list" && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
            {EMPLOYEES.find(e => e.id === showSalaryHistory) && (
              <>
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white">Salary History</h2>
                    <p className="text-sm text-slate-400 mt-1">
                      {filteredPayroll.find(p => p.employeeId === showSalaryHistory)?.employeeName}
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowSalaryHistory(null)}
                    className="text-slate-400 hover:text-white transition p-1"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3 mb-6">
                  {EMPLOYEES.find(e => e.id === showSalaryHistory)?.salaryHistory.map((entry, idx) => (
                    <div key={idx} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">
                            ${entry.hourlyRate}/hr
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Effective: <span className="text-slate-300">{entry.effectiveDate}</span>
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Reason: <span className="text-blue-300">{entry.reason}</span>
                          </p>
                        </div>
                        {idx === EMPLOYEES.find(e => e.id === showSalaryHistory)?.salaryHistory.length! - 1 && (
                          <span className="inline-block px-2 py-1 bg-green-600 text-green-100 text-xs font-semibold rounded whitespace-nowrap ml-2">
                            Current
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pro-rata Calculation Info */}
                {hasSalaryChange(showSalaryHistory) && (
                  <div className="bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 mb-4">
                    <h3 className="text-sm font-bold text-blue-300 mb-2">Pro-rata Applied</h3>
                    <p className="text-xs text-blue-200">
                      This employee had a salary change during the payroll period (Jun 1-15, 2026).
                    </p>
                    <ul className="text-xs text-blue-200 mt-2 space-y-1">
                      <li>• Split at change date</li>
                      <li>• Each period @ respective rate</li>
                      <li>• Fair & accurate total</li>
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => setShowSalaryHistory("list")}
                  className="w-full px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition font-semibold text-sm mb-2"
                >
                  ← Back to List
                </button>
                <button
                  onClick={() => setShowSalaryHistory(null)}
                  className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="h-6 w-6 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-bold text-white">Process Payroll?</h2>
                <p className="text-sm text-slate-300 mt-1">
                  You are about to process payroll for <strong>{filteredPayroll.length} employee(s)</strong> with a total gross pay of <strong>${totalGrossPay.toFixed(2)}</strong>.
                </p>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-3 mb-4 text-xs text-slate-300 space-y-1 max-h-40 overflow-y-auto">
              <p className="font-semibold text-white mb-2">Summary:</p>
              {filteredPayroll.slice(0, 5).map(p => (
                <div key={p.employeeId} className="flex justify-between">
                  <span>{p.employeeName}</span>
                  <span className="text-green-300">${p.grossPay.toFixed(2)}</span>
                </div>
              ))}
              {filteredPayroll.length > 5 && (
                <p className="text-slate-400 mt-2">+ {filteredPayroll.length - 5} more employee(s)</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleProcessPayroll}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirm Process
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
