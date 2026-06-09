import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, DollarSign, TrendingUp, PieChart as PieChartIcon, BarChart3, Download, Filter, BarChart4, FileText, Edit2, Save, X, Trash2, LogOut } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/db";
import { DUMMY_EMPLOYEES, initializeDummyData } from "@/lib/dummyData";

interface PayrollSummary {
  currency: "USD" | "PHP";
  totalCost: number;
  employeeCount: number;
  overtimeCost: number;
  averagePerEmployee: number;
}

interface ExpenseData {
  category: string;
  amount: number;
  percentage: number;
  trend: number;
}

interface DepartmentCost {
  department: string;
  payroll: number;
  expenses: number;
  total: number;
  employeeCount: number;
}

interface MonthlyFinancialReport {
  month: string;
  usPayroll: number;
  phPayroll: number;
  totalExpenses: number;
  technicianExpenses: number;
  partsExpenses: number;
  branchExpenses: number;
  overtimeCost: number;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  country: "US" | "PH";
  hoursWorked: number;
  hourlyRate: number;
  totalWages: number;
}

interface PayrollAuditLog {
  id: string;
  timestamp: string;
  action: "generate" | "edit" | "delete";
  employeeId: string;
  employeeName: string;
  details: string;
  userId: string;
  amount?: number;
}

const COLORS = ["#34d399", "#f87171", "#fb923c", "#3b82f6", "#a78bfa", "#06b6d4"];

const EXCHANGE_RATE = 57; // 1 USD = 57 PHP

export function AccountingDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [activeTab, setActiveTab] = useState<"overview" | "payroll" | "expenses" | "reports">("overview");
  const [selectedCurrency, setSelectedCurrency] = useState<"USD" | "PHP">("USD");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ hoursWorked: number; hourlyRate: number }>({ hoursWorked: 0, hourlyRate: 0 });
  const [auditLogs, setAuditLogs] = useState<PayrollAuditLog[]>([]);
  const [showAuditLog, setShowAuditLog] = useState(false);

  // Initialize employees from localStorage or use dummy data
  useEffect(() => {
    const storedEmployees = localStorage.getItem("payroll_employees");
    const storedAuditLogs = localStorage.getItem("payroll_audit_logs");
    
    if (storedEmployees) {
      try {
        setEmployees(JSON.parse(storedEmployees));
      } catch (e) {
        // If parse fails, use dummy employees
        const dummyEmployeesFormatted: Employee[] = DUMMY_EMPLOYEES.map(emp => ({
          id: emp.id,
          name: emp.name,
          department: emp.department,
          country: emp.country,
          hoursWorked: emp.hoursWorked,
          hourlyRate: emp.hourlyRate,
          totalWages: emp.totalWages,
        }));
        setEmployees(dummyEmployeesFormatted);
        localStorage.setItem("payroll_employees", JSON.stringify(dummyEmployeesFormatted));
      }
    } else {
      // Use dummy employees instead of mock data
      const dummyEmployeesFormatted: Employee[] = DUMMY_EMPLOYEES.map(emp => ({
        id: emp.id,
        name: emp.name,
        department: emp.department,
        country: emp.country,
        hoursWorked: emp.hoursWorked,
        hourlyRate: emp.hourlyRate,
        totalWages: emp.totalWages,
      }));
      setEmployees(dummyEmployeesFormatted);
      localStorage.setItem("payroll_employees", JSON.stringify(dummyEmployeesFormatted));
    }

    if (storedAuditLogs) {
      setAuditLogs(JSON.parse(storedAuditLogs));
    }
  }, []);

  // Save employees to localStorage and log audit
  const saveEmployees = (updatedEmployees: Employee[], logAction: PayrollAuditLog) => {
    setEmployees(updatedEmployees);
    localStorage.setItem("payroll_employees", JSON.stringify(updatedEmployees));
    
    const newAuditLog = {
      ...logAction,
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: "admin-user",
    };
    
    const updatedLogs = [...auditLogs, newAuditLog];
    setAuditLogs(updatedLogs);
    localStorage.setItem("payroll_audit_logs", JSON.stringify(updatedLogs));
  };

  // Generate payroll for all employees
  const generatePayrollAll = () => {
    const log: PayrollAuditLog = {
      id: "",
      timestamp: "",
      action: "generate",
      employeeId: "all",
      employeeName: "All Employees",
      details: `Generated payroll for ${employees.length} employees. Total cost: $${calculateTotalPayroll().toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      userId: "",
      amount: calculateTotalPayroll(),
    };
    
    // Show success notification (in real app, would use toast)
    saveEmployees(employees, log);
    alert("Payroll generated for all employees!");
  };

  // Generate payroll for individual employee
  const generatePayrollIndividual = (employee: Employee) => {
    const log: PayrollAuditLog = {
      id: "",
      timestamp: "",
      action: "generate",
      employeeId: employee.id,
      employeeName: employee.name,
      details: `Generated payroll: ${employee.hoursWorked} hours @ $${employee.hourlyRate}/hr = $${employee.totalWages}`,
      userId: "",
      amount: employee.totalWages,
    };
    
    saveEmployees(employees, log);
    alert(`Payroll generated for ${employee.name}!`);
  };

  // Edit employee payroll
  const startEdit = (employee: Employee) => {
    setEditingId(employee.id);
    setEditValues({ hoursWorked: employee.hoursWorked, hourlyRate: employee.hourlyRate });
  };

  const saveEdit = (employee: Employee) => {
    const updatedEmployees = employees.map(emp => {
      if (emp.id === employee.id) {
        const newTotalWages = editValues.hoursWorked * editValues.hourlyRate;
        return {
          ...emp,
          hoursWorked: editValues.hoursWorked,
          hourlyRate: editValues.hourlyRate,
          totalWages: newTotalWages,
        };
      }
      return emp;
    });

    const log: PayrollAuditLog = {
      id: "",
      timestamp: "",
      action: "edit",
      employeeId: employee.id,
      employeeName: employee.name,
      details: `Updated: Hours ${employee.hoursWorked}→${editValues.hoursWorked}, Rate $${employee.hourlyRate}→$${editValues.hourlyRate}`,
      userId: "",
      amount: editValues.hoursWorked * editValues.hourlyRate,
    };

    saveEmployees(updatedEmployees, log);
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  // Delete employee payroll record
  const deletePayrollRecord = (employee: Employee) => {
    if (confirm(`Delete payroll record for ${employee.name}?`)) {
      const updatedEmployees = employees.filter(emp => emp.id !== employee.id);
      
      const log: PayrollAuditLog = {
        id: "",
        timestamp: "",
        action: "delete",
        employeeId: employee.id,
        employeeName: employee.name,
        details: `Deleted payroll record: ${employee.totalWages}`,
        userId: "",
        amount: employee.totalWages,
      };

      saveEmployees(updatedEmployees, log);
    }
  };

  // Calculate totals
  const calculateTotalPayroll = () => {
    return employees.reduce((sum, emp) => sum + emp.totalWages, 0);
  };

  const calculateTotalByCountry = (country: "US" | "PH") => {
    return employees.filter(emp => emp.country === country).reduce((sum, emp) => sum + emp.totalWages, 0);
  };

  const calculateEmployeeCount = (country: "US" | "PH") => {
    return employees.filter(emp => emp.country === country).length;
  };

  // Mock Data
  const usPayroll: PayrollSummary = {
    currency: "USD",
    totalCost: calculateTotalByCountry("US"),
    employeeCount: calculateEmployeeCount("US"),
    overtimeCost: Math.round(calculateTotalByCountry("US") * 0.084),
    averagePerEmployee: calculateTotalByCountry("US") / Math.max(calculateEmployeeCount("US"), 1),
  };

  const phPayroll: PayrollSummary = {
    currency: "PHP",
    totalCost: calculateTotalByCountry("PH"),
    employeeCount: calculateEmployeeCount("PH"),
    overtimeCost: Math.round(calculateTotalByCountry("PH") * 0.084),
    averagePerEmployee: calculateTotalByCountry("PH") / Math.max(calculateEmployeeCount("PH"), 1),
  };

  const expenseData: ExpenseData[] = [
    { category: "Technician Expenses", amount: 8500, percentage: 35, trend: 2.5 },
    { category: "Parts Expenses", amount: 7200, percentage: 30, trend: -1.2 },
    { category: "Branch Operations", amount: 5600, percentage: 23, trend: 1.8 },
    { category: "Administrative", amount: 2400, percentage: 12, trend: 0.5 },
  ];

  const departmentCosts: DepartmentCost[] = [
    { department: "Operations", payroll: 12000, expenses: 4200, total: 16200, employeeCount: 3 },
    { department: "Customer Service", payroll: 8800, expenses: 2100, total: 10900, employeeCount: 2 },
    { department: "Parts", payroll: 3900, expenses: 1800, total: 5700, employeeCount: 1 },
    { department: "Finance", payroll: 3800, expenses: 800, total: 4600, employeeCount: 1 },
    { department: "Management", payroll: 2800, expenses: 600, total: 3400, employeeCount: 1 },
  ];

  const monthlyReports: MonthlyFinancialReport[] = [
    { month: "Apr", usPayroll: 26000, phPayroll: 1482000, totalExpenses: 22500, technicianExpenses: 8000, partsExpenses: 6800, branchExpenses: 5200, overtimeCost: 2100 },
    { month: "May", usPayroll: 27500, phPayroll: 1567500, totalExpenses: 23200, technicianExpenses: 8300, partsExpenses: 7100, branchExpenses: 5300, overtimeCost: 2200 },
    { month: "Jun", usPayroll: 28500, phPayroll: 1624500, totalExpenses: 24200, technicianExpenses: 8500, partsExpenses: 7200, branchExpenses: 5600, overtimeCost: 2400 },
  ];

  const expenseChartData = expenseData.map(e => ({ name: e.category, value: e.amount }));
  
  const payrollChartData = [
    { name: "US Payroll", value: usPayroll.totalCost },
    { name: "PH Payroll", value: phPayroll.totalCost / EXCHANGE_RATE },
  ];

  const departmentChartData = departmentCosts.map(d => ({ name: d.department, Payroll: d.payroll, Expenses: d.expenses }));

  const totalPayroll = usPayroll.totalCost + (phPayroll.totalCost / EXCHANGE_RATE);
  const totalExpenses = expenseData.reduce((sum, e) => sum + e.amount, 0);
  const totalOvertimeCost = usPayroll.overtimeCost + (phPayroll.overtimeCost / EXCHANGE_RATE);

  const kpiCards = [
    { label: "Total Payroll Cost", value: `$${totalPayroll.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "text-green-300", icon: DollarSign },
    { label: "Total Expenses", value: `$${totalExpenses.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "text-blue-300", icon: TrendingUp },
    { label: "US Payroll", value: `$${usPayroll.totalCost.toLocaleString()}`, color: "text-purple-300", icon: DollarSign },
    { label: "PH Payroll (USD)", value: `$${(phPayroll.totalCost / EXCHANGE_RATE).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "text-amber-300", icon: DollarSign },
    { label: "Overtime Cost", value: `$${totalOvertimeCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "text-orange-300", icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold">{sub.title}</h1>
              <p className="text-sm text-slate-400">{sub.description}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-white/10 overflow-x-auto">
          {[
            { id: "overview", label: "Overview", Icon: PieChartIcon },
            { id: "payroll", label: "Payroll", Icon: DollarSign },
            { id: "expenses", label: "Expenses", Icon: TrendingUp },
            { id: "reports", label: "Reports", Icon: FileText },
          ].map(tab => {
            const Icon = tab.Icon;
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

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {kpiCards.map((card, idx) => {
                const Icon = card.icon;
                return (
                  <div key={idx} className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">{card.label}</p>
                        <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                      </div>
                      <Icon className="h-5 w-5 text-slate-600" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Payroll Distribution (US vs PH)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={payrollChartData} layout="vertical">
                    <XAxis type="number" stroke="#94a3b8" />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" width={80} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} formatter={(value) => `$${(value as number).toFixed(0)}`} />
                    <Bar dataKey="value" fill="#34d399" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-4">Expense Breakdown</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={expenseChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: $${(value as number).toLocaleString()}`}>
                      {expenseChartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `$${(value as number).toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Monthly Trend */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Monthly Payroll Trend (USD)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthlyReports}>
                  <XAxis dataKey="month" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
                  <Legend />
                  <Line type="monotone" dataKey="usPayroll" stroke="#34d399" name="US Payroll" strokeWidth={2} />
                  <Line type="monotone" dataKey="overtimeCost" stroke="#f97316" name="Overtime Cost" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Payroll Tab */}
        {activeTab === "payroll" && (
          <div className="space-y-6">
            {/* Generate Payroll Button */}
            <div className="flex gap-4 items-center mb-4">
              <button
                onClick={generatePayrollAll}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-semibold transition flex items-center gap-2"
              >
                <DollarSign className="h-4 w-4" />
                Generate Payroll (All Employees)
              </button>
              <button
                onClick={() => setShowAuditLog(!showAuditLog)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-semibold transition flex items-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                Audit Log ({auditLogs.length})
              </button>
            </div>

            {/* Audit Log */}
            {showAuditLog && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 max-h-96 overflow-y-auto">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  Payroll Audit Log
                </h3>
                {auditLogs.length === 0 ? (
                  <p className="text-slate-400 text-sm">No audit logs yet</p>
                ) : (
                  <div className="space-y-2">
                    {[...auditLogs].reverse().map((log, idx) => (
                      <div key={log.id} className="bg-slate-800/50 rounded p-3 border border-white/5">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-xs font-semibold text-white">
                              {log.action.toUpperCase()}: {log.employeeName}
                            </p>
                            <p className="text-xs text-slate-400 mt-1">{log.details}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-500">
                              {new Date(log.timestamp).toLocaleString()}
                            </p>
                            {log.amount && (
                              <p className="text-xs text-green-300 font-semibold">
                                ${log.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Currency Toggle */}
            <div className="flex gap-4 mb-4">
              <button
                onClick={() => setSelectedCurrency("USD")}
                className={`px-4 py-2 rounded text-sm font-semibold transition ${
                  selectedCurrency === "USD"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                US Payroll
              </button>
              <button
                onClick={() => setSelectedCurrency("PHP")}
                className={`px-4 py-2 rounded text-sm font-semibold transition ${
                  selectedCurrency === "PHP"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                PH Payroll
              </button>
            </div>

            {/* Payroll Summary Cards */}
            {selectedCurrency === "USD" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Total Payroll Cost</p>
                  <p className="text-2xl font-bold text-green-300">${usPayroll.totalCost.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-2">Current period</p>
                </div>
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Employees</p>
                  <p className="text-2xl font-bold text-blue-300">{usPayroll.employeeCount}</p>
                  <p className="text-xs text-slate-500 mt-2">Active staff</p>
                </div>
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Overtime Cost</p>
                  <p className="text-2xl font-bold text-orange-300">${usPayroll.overtimeCost.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-2">Estimated</p>
                </div>
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Average per Employee</p>
                  <p className="text-2xl font-bold text-purple-300">${usPayroll.averagePerEmployee.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
                  <p className="text-xs text-slate-500 mt-2">Per employee</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Total Payroll Cost (USD)</p>
                  <p className="text-2xl font-bold text-green-300">${(phPayroll.totalCost / EXCHANGE_RATE).toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
                  <p className="text-xs text-slate-500 mt-2">Current period</p>
                </div>
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Employees</p>
                  <p className="text-2xl font-bold text-blue-300">{phPayroll.employeeCount}</p>
                  <p className="text-xs text-slate-500 mt-2">Active staff</p>
                </div>
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Overtime Cost (USD)</p>
                  <p className="text-2xl font-bold text-orange-300">${(phPayroll.overtimeCost / EXCHANGE_RATE).toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
                  <p className="text-xs text-slate-500 mt-2">Estimated</p>
                </div>
                <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">Average per Employee (USD)</p>
                  <p className="text-2xl font-bold text-purple-300">${(phPayroll.averagePerEmployee / EXCHANGE_RATE).toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
                  <p className="text-xs text-slate-500 mt-2">Per employee</p>
                </div>
              </div>
            )}

            {/* Payroll Summary List Header */}
            <div className="mt-8 mb-4">
              <h3 className="text-lg font-bold text-white">Payroll Summary List</h3>
              <p className="text-sm text-slate-400">List of Employees</p>
            </div>

            {/* Employee Payroll Details Table */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-0 overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center justify-between">
                <span>
                  {selectedCurrency === "USD" ? "US Employees" : "PH Employees"} Payroll Details
                </span>
                <span className="text-xs text-slate-400 font-normal">
                  {employees.filter(emp => emp.country === (selectedCurrency === "USD" ? "US" : "PH")).length} employees
                </span>
              </div>
              <table className="w-full text-sm min-w-[1200px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Department</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Hours</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Rate</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Total Wages</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees
                    .filter(emp => emp.country === (selectedCurrency === "USD" ? "US" : "PH"))
                    .map(employee => (
                      <tr key={employee.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-3 font-medium text-white">{employee.name}</td>
                        <td className="px-4 py-3 text-slate-300">{employee.department}</td>
                        <td className="px-4 py-3 text-center">
                          {editingId === employee.id ? (
                            <input
                              type="number"
                              value={editValues.hoursWorked}
                              onChange={(e) =>
                                setEditValues({ ...editValues, hoursWorked: parseFloat(e.target.value) || 0 })
                              }
                              className="w-20 px-2 py-1 bg-slate-700 text-white rounded border border-white/20 text-center"
                            />
                          ) : (
                            <span className="text-slate-300">{employee.hoursWorked}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {editingId === employee.id ? (
                            <input
                              type="number"
                              value={editValues.hourlyRate}
                              onChange={(e) =>
                                setEditValues({ ...editValues, hourlyRate: parseFloat(e.target.value) || 0 })
                              }
                              className="w-24 px-2 py-1 bg-slate-700 text-white rounded border border-white/20 text-center"
                              step="0.01"
                            />
                          ) : (
                            <span className="text-slate-300">
                              {selectedCurrency === "USD" ? "$" : "₱"}{employee.hourlyRate.toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {editingId === employee.id ? (
                            <span className="font-semibold text-green-300">
                              {selectedCurrency === "USD" ? "$" : "₱"}
                              {(editValues.hoursWorked * editValues.hourlyRate).toLocaleString("en-US", {
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          ) : (
                            <span className="font-semibold text-green-300">
                              {selectedCurrency === "USD" ? "$" : "₱"}
                              {employee.totalWages.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-2 justify-center">
                            {editingId === employee.id ? (
                              <>
                                <button
                                  onClick={() => saveEdit(employee)}
                                  className="p-1 bg-green-600 hover:bg-green-700 text-white rounded transition"
                                  title="Save"
                                >
                                  <Save className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="p-1 bg-red-600 hover:bg-red-700 text-white rounded transition"
                                  title="Cancel"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(employee)}
                                  className="p-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
                                  title="Edit"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => generatePayrollIndividual(employee)}
                                  className="p-1 bg-green-600 hover:bg-green-700 text-white rounded transition"
                                  title="Generate Payroll"
                                >
                                  <DollarSign className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => deletePayrollRecord(employee)}
                                  className="p-1 bg-red-600 hover:bg-red-700 text-white rounded transition"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>


          </div>
        )}

        {/* Expenses Tab */}
        {activeTab === "expenses" && (
          <div className="space-y-6">
            {/* Expense Summary */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {expenseData.map((expense, idx) => (
                <div key={idx} className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-1">{expense.category}</p>
                  <p className="text-2xl font-bold text-blue-300">${expense.amount.toLocaleString()}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-500">{expense.percentage}% of total</span>
                    <span className={`text-xs font-semibold ${expense.trend > 0 ? "text-red-300" : "text-green-300"}`}>
                      {expense.trend > 0 ? "↑" : "↓"} {Math.abs(expense.trend)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Expense Chart */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Expense Distribution by Category</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={expenseData.map(e => ({ name: e.category, amount: e.amount }))}>
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} formatter={(value) => `$${(value as number).toLocaleString()}`} />
                  <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Department Cost Breakdown */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4">Employee Cost Per Department</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={departmentChartData}>
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} formatter={(value) => `$${(value as number).toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="Payroll" fill="#34d399" />
                  <Bar dataKey="Expenses" fill="#f87171" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Department Table */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-0 overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">
                Department Cost Analysis
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Department</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Payroll</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Expenses</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Total</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Employees</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Cost/Employee</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentCosts.map((dept, idx) => (
                    <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium text-white">{dept.department}</td>
                      <td className="px-4 py-3 text-right text-green-300">${dept.payroll.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-blue-300">${dept.expenses.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold">${dept.total.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-slate-300">{dept.employeeCount}</td>
                      <td className="px-4 py-3 text-right text-purple-300">${(dept.total / dept.employeeCount).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { title: "Payroll Expense Report", Icon: FileText, description: "Detailed breakdown of all payroll costs" },
                { title: "Department Cost Report", Icon: BarChart4, description: "Cost analysis per department" },
                { title: "Monthly Financial Summary", Icon: TrendingUp, description: "Month-over-month financial trends" },
                { title: "Employee Cost Analysis", Icon: DollarSign, description: "Per-employee cost analysis" },
              ].map((report, idx) => {
                const Icon = report.Icon;
                return (
                  <div key={idx} className="bg-slate-900/50 border border-white/10 rounded-lg p-4 hover:border-blue-500/50 transition cursor-pointer">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-white">{report.title}</p>
                        <p className="text-xs text-slate-400 mt-1">{report.description}</p>
                      </div>
                      <Icon className="h-5 w-5 text-slate-500" />
                    </div>
                    <div className="flex gap-2 pt-3 border-t border-white/10">
                      <button className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center justify-center gap-1">
                        <Download className="h-3 w-3" />
                        PDF
                      </button>
                      <button className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold transition flex items-center justify-center gap-1">
                        <Download className="h-3 w-3" />
                        CSV
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Monthly Financial Data Table */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-0 overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">
                Monthly Financial Summary (USD)
              </div>
              <table className="w-full text-sm min-w-[1000px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Month</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">US Payroll</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">PH Payroll</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Tech Expenses</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Parts Expenses</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Branch Expenses</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Overtime</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyReports.map((month, idx) => {
                    const total = month.usPayroll + (month.phPayroll / EXCHANGE_RATE) + month.totalExpenses;
                    return (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-3 font-medium text-white">{month.month}</td>
                        <td className="px-4 py-3 text-right text-green-300">${month.usPayroll.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-amber-300">${(month.phPayroll / EXCHANGE_RATE).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 text-right text-blue-300">${month.technicianExpenses.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-purple-300">${month.partsExpenses.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-cyan-300">${month.branchExpenses.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-orange-300">${month.overtimeCost.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-white font-semibold">${total.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
