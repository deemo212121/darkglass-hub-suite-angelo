import { useState, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  DollarSign,
  TrendingUp,
  PieChart as PieChartIcon,
  BarChart3,
  FileText,
  LogOut,
  RefreshCw,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/db";
import { supabase } from "@/lib/supabase/client";

// ─── Constants ───────────────────────────────────────────────────────────────
const EXCHANGE_RATE = 57; // 1 USD = 57 PHP

// ─── Types ───────────────────────────────────────────────────────────────────
interface SupabaseEmployee {
  id: string;
  full_name: string;
  department: string | null;
  country: string | null;
  hourly_rate: number | null;
  status: string | null;
}

interface SalaryEntry {
  employee_id: string;
  effective_date: string;
  hourly_rate: number;
}

interface TimecardEntry {
  employee_id: string;
  work_date: string;
  hours_worked: number;
  overtime_hours: number;
  status: string;
}

interface PayrollRun {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  generated_at: string | null;
}

interface PayrollLineItem {
  payroll_run_id: string;
  employee_id: string;
  hours_worked: number;
  overtime_hours: number;
  hourly_rate: number;
  regular_pay: number;
  overtime_pay: number;
  gross_pay: number;
  net_pay: number;
  currency: string;
}

interface PayrollAuditLogRow {
  action: string;
  employee_name: string;
  details: string | null;
  amount: number | null;
  created_at: string;
}

interface EmployeePayrollRow {
  employee: SupabaseEmployee;
  hourlyRate: number;
  hoursWorked: number;
  overtimeHours: number;
  grossPay: number;
}

interface MonthlyBarData {
  month: string;
  usPayroll: number;
  phPayroll: number;
  total: number;
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function periodBounds(): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().split("T")[0];
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 13); // last 14 days inclusive
  const start = startDate.toISOString().split("T")[0];
  return { start, end };
}

function fmt(amount: number, currency: "USD" | "PHP" = "USD") {
  if (currency === "PHP") {
    return `₱${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AccountingDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [activeTab, setActiveTab] = useState<"overview" | "payroll" | "reports">("overview");
  const [selectedCurrency, setSelectedCurrency] = useState<"USD" | "PHP">("USD");

  // Raw data
  const [employees, setEmployees] = useState<SupabaseEmployee[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntry[]>([]);
  const [timecardEntries, setTimecardEntries] = useState<TimecardEntry[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payrollLineItems, setPayrollLineItems] = useState<PayrollLineItem[]>([]);
  const [auditLog, setAuditLog] = useState<PayrollAuditLogRow[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runLineItems, setRunLineItems] = useState<Record<string, PayrollLineItem[]>>({});
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = periodBounds();

      const [
        empRes,
        salRes,
        tcRes,
        runsRes,
        lineRes,
        auditRes,
      ] = await Promise.all([
        supabase.from("employees").select("id,full_name,department,country,hourly_rate,status").eq("status", "Active"),
        supabase.from("salary_entries").select("employee_id,effective_date,hourly_rate").order("effective_date", { ascending: false }),
        supabase.from("timecard_entries").select("employee_id,work_date,hours_worked,overtime_hours,status").gte("work_date", start).lte("work_date", end),
        supabase.from("payroll_runs").select("id,period_start,period_end,status,generated_at").order("generated_at", { ascending: false }),
        supabase.from("payroll_line_items").select("payroll_run_id,employee_id,hours_worked,overtime_hours,hourly_rate,regular_pay,overtime_pay,gross_pay,net_pay,currency"),
        supabase.from("payroll_audit_log").select("action,employee_name,details,amount,created_at").order("created_at", { ascending: false }).limit(100),
      ]);

      for (const res of [empRes, salRes, tcRes, runsRes, lineRes, auditRes]) {
        if (res.error) throw new Error(res.error.message);
      }

      setEmployees((empRes.data ?? []) as SupabaseEmployee[]);
      setSalaryEntries((salRes.data ?? []) as SalaryEntry[]);
      setTimecardEntries((tcRes.data ?? []) as TimecardEntry[]);
      setPayrollRuns((runsRes.data ?? []) as PayrollRun[]);
      setPayrollLineItems((lineRes.data ?? []) as PayrollLineItem[]);
      setAuditLog((auditRes.data ?? []) as PayrollAuditLogRow[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  // Latest salary entry per employee
  const latestRateMap = new Map<string, number>();
  for (const se of salaryEntries) {
    if (!latestRateMap.has(se.employee_id)) {
      latestRateMap.set(se.employee_id, se.hourly_rate);
    }
  }

  // Hours worked per employee in current period
  const hoursMap = new Map<string, { regular: number; overtime: number }>();
  for (const tc of timecardEntries) {
    const prev = hoursMap.get(tc.employee_id) ?? { regular: 0, overtime: 0 };
    hoursMap.set(tc.employee_id, {
      regular: prev.regular + (tc.hours_worked ?? 0),
      overtime: prev.overtime + (tc.overtime_hours ?? 0),
    });
  }

  // Build payroll rows
  const payrollRows: EmployeePayrollRow[] = employees.map((emp) => {
    const hourlyRate =
      latestRateMap.get(emp.id) ?? emp.hourly_rate ?? 0;
    const hours = hoursMap.get(emp.id) ?? { regular: 0, overtime: 0 };
    const grossPay =
      hours.regular * hourlyRate + hours.overtime * hourlyRate * 1.5;
    return {
      employee: emp,
      hourlyRate,
      hoursWorked: hours.regular,
      overtimeHours: hours.overtime,
      grossPay,
    };
  });

  const usRows = payrollRows.filter((r) => r.employee.country === "US");
  const phRows = payrollRows.filter((r) => r.employee.country === "PH");

  const totalUSPayroll = usRows.reduce((s, r) => s + r.grossPay, 0);
  const totalPHPayroll = phRows.reduce((s, r) => s + r.grossPay, 0);
  const totalPayrollUSD = totalUSPayroll + totalPHPayroll / EXCHANGE_RATE;
  const avgPayPerEmployee =
    payrollRows.length > 0 ? totalPayrollUSD / payrollRows.length : 0;

  // Monthly bar chart data from payroll_line_items grouped by run period
  const monthlyBarData: MonthlyBarData[] = (() => {
    const map = new Map<string, { usPayroll: number; phPayroll: number }>();
    for (const run of payrollRuns) {
      const label = run.period_start
        ? new Date(run.period_start).toLocaleString("en-US", { month: "short", year: "2-digit" })
        : run.id;
      const items = payrollLineItems.filter((li) => li.payroll_run_id === run.id);
      const us = items
        .filter((li) => {
          const emp = employees.find((e) => e.id === li.employee_id);
          return emp?.country === "US";
        })
        .reduce((s, li) => s + (li.gross_pay ?? 0), 0);
      const ph = items
        .filter((li) => {
          const emp = employees.find((e) => e.id === li.employee_id);
          return emp?.country === "PH";
        })
        .reduce((s, li) => s + (li.gross_pay ?? 0), 0);
      const prev = map.get(label) ?? { usPayroll: 0, phPayroll: 0 };
      map.set(label, { usPayroll: prev.usPayroll + us, phPayroll: prev.phPayroll + ph });
    }
    return Array.from(map.entries()).map(([month, v]) => ({
      month,
      usPayroll: Math.round(v.usPayroll),
      phPayroll: Math.round(v.phPayroll / EXCHANGE_RATE),
      total: Math.round(v.usPayroll + v.phPayroll / EXCHANGE_RATE),
    }));
  })();

  // ── Generate Payroll ─────────────────────────────────────────────────────────
  const generatePayroll = async () => {
    if (payrollRows.length === 0) return;
    setGenerating(true);
    try {
      const { start, end } = periodBounds();

      // Insert payroll run
      const { data: runData, error: runErr } = await supabase
        .from("payroll_runs")
        .insert({
          period_start: start,
          period_end: end,
          status: "completed",
          generated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (runErr) throw new Error(runErr.message);

      const runId = (runData as { id: string }).id;

      // Build line items
      const lineItems = payrollRows.map((r) => ({
        payroll_run_id: runId,
        employee_id: r.employee.id,
        hours_worked: r.hoursWorked,
        overtime_hours: r.overtimeHours,
        hourly_rate: r.hourlyRate,
        regular_pay: r.hoursWorked * r.hourlyRate,
        overtime_pay: r.overtimeHours * r.hourlyRate * 1.5,
        gross_pay: r.grossPay,
        net_pay: r.grossPay, // simplified — no deductions model
        currency: r.employee.country === "PH" ? "PHP" : "USD",
      }));

      const { error: lineErr } = await supabase.from("payroll_line_items").insert(lineItems);
      if (lineErr) throw new Error(lineErr.message);

      // Insert audit log entry
      await supabase.from("payroll_audit_log").insert({
        action: "GENERATE",
        employee_name: "All Employees",
        details: `Generated payroll run for ${start} – ${end}. ${payrollRows.length} employees. Total: $${totalPayrollUSD.toFixed(2)}`,
        amount: Math.round(totalPayrollUSD * 100) / 100,
      });

      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate payroll");
    } finally {
      setGenerating(false);
    }
  };

  // ── Expand payroll run line items ────────────────────────────────────────────
  const toggleRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (runLineItems[runId]) return; // already loaded
    setLoadingRunId(runId);
    try {
      const { data, error: e } = await supabase
        .from("payroll_line_items")
        .select("payroll_run_id,employee_id,hours_worked,overtime_hours,hourly_rate,regular_pay,overtime_pay,gross_pay,net_pay,currency")
        .eq("payroll_run_id", runId);
      if (e) throw new Error(e.message);
      setRunLineItems((prev) => ({ ...prev, [runId]: (data ?? []) as PayrollLineItem[] }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load line items");
    } finally {
      setLoadingRunId(null);
    }
  };

  // ── Totals per run ───────────────────────────────────────────────────────────
  const runTotals = new Map<string, number>();
  for (const li of payrollLineItems) {
    const prev = runTotals.get(li.payroll_run_id) ?? 0;
    // Normalize to USD
    const usdAmount = li.currency === "PHP" ? li.gross_pay / EXCHANGE_RATE : li.gross_pay;
    runTotals.set(li.payroll_run_id, prev + usdAmount);
  }

  // ── Render helpers ───────────────────────────────────────────────────────────
  const displayRows = selectedCurrency === "USD" ? usRows : phRows;
  const currencySymbol = selectedCurrency === "USD" ? "$" : "₱";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading accounting data…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-6 max-w-md text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-red-300 font-semibold mb-1">Error loading data</p>
          <p className="text-slate-400 text-sm mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-semibold transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{sub.title}</h1>
              <p className="text-sm text-slate-400">{sub.description}</p>
            </div>
            <button
              onClick={fetchData}
              className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-white/10 overflow-x-auto">
          {[
            { id: "overview", label: "Overview", Icon: PieChartIcon },
            { id: "payroll", label: "Payroll", Icon: DollarSign },
            { id: "reports", label: "Reports", Icon: FileText },
          ].map((tab) => {
            const Icon = tab.Icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as "overview" | "payroll" | "reports")}
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

        {/* ── Overview Tab ─────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Total Employees</p>
                <p className="text-2xl font-bold text-green-300">{employees.length}</p>
                <p className="text-xs text-slate-500 mt-1">Active</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Total Payroll (Current Period)</p>
                <p className="text-2xl font-bold text-blue-300">{fmt(totalPayrollUSD)}</p>
                <p className="text-xs text-slate-500 mt-1">Last 14 days · USD</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">US / PH Split</p>
                <p className="text-lg font-bold text-purple-300">
                  {fmt(totalUSPayroll)} / {fmt(totalPHPayroll / EXCHANGE_RATE)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {usRows.length} US · {phRows.length} PH employees
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Avg Pay / Employee</p>
                <p className="text-2xl font-bold text-amber-300">{fmt(avgPayPerEmployee)}</p>
                <p className="text-xs text-slate-500 mt-1">Current period</p>
              </div>
            </div>

            {/* Monthly bar chart */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-slate-400" />
                Monthly Payroll Totals (USD)
              </h3>
              {monthlyBarData.length === 0 ? (
                <p className="text-slate-500 text-sm py-8 text-center">
                  No completed payroll runs yet.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyBarData}>
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" tickFormatter={(v) => `$${(v as number / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }}
                      formatter={(value) => [`$${(value as number).toLocaleString()}`, undefined]}
                    />
                    <Legend />
                    <Bar dataKey="usPayroll" name="US Payroll" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="phPayroll" name="PH Payroll (USD)" fill="#818cf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* ── Payroll Tab ──────────────────────────────────────────────────── */}
        {activeTab === "payroll" && (
          <div className="space-y-6">
            {/* Actions bar */}
            <div className="flex flex-wrap gap-3 items-center">
              <button
                onClick={generatePayroll}
                disabled={generating || payrollRows.length === 0}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded font-semibold transition flex items-center gap-2"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                Generate Payroll
              </button>
              <button
                onClick={() => setShowAuditLog(!showAuditLog)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-semibold transition flex items-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                Audit Log ({auditLog.length})
              </button>
              {/* Currency toggle */}
              <div className="ml-auto flex gap-2">
                {(["USD", "PHP"] as const).map((cur) => (
                  <button
                    key={cur}
                    onClick={() => setSelectedCurrency(cur)}
                    className={`px-4 py-2 rounded text-sm font-semibold transition ${
                      selectedCurrency === cur
                        ? "bg-blue-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {cur === "USD" ? "US Payroll" : "PH Payroll"}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Total Payroll (Period)</p>
                <p className="text-2xl font-bold text-green-300">
                  {selectedCurrency === "USD"
                    ? fmt(totalUSPayroll)
                    : fmt(totalPHPayroll, "PHP")}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Employees</p>
                <p className="text-2xl font-bold text-blue-300">{displayRows.length}</p>
                <p className="text-xs text-slate-500 mt-1">Active in {selectedCurrency === "USD" ? "US" : "PH"}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Overtime Pay</p>
                <p className="text-2xl font-bold text-orange-300">
                  {selectedCurrency === "USD"
                    ? fmt(usRows.reduce((s, r) => s + r.overtimeHours * r.hourlyRate * 1.5, 0))
                    : fmt(phRows.reduce((s, r) => s + r.overtimeHours * r.hourlyRate * 1.5, 0), "PHP")}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Avg per Employee</p>
                <p className="text-2xl font-bold text-purple-300">
                  {selectedCurrency === "USD"
                    ? fmt(usRows.length > 0 ? totalUSPayroll / usRows.length : 0)
                    : fmt(phRows.length > 0 ? totalPHPayroll / phRows.length : 0, "PHP")}
                </p>
              </div>
            </div>

            {/* Audit Log */}
            {showAuditLog && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 max-h-80 overflow-y-auto">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  Payroll Audit Log
                </h3>
                {auditLog.length === 0 ? (
                  <p className="text-slate-500 text-sm">No audit entries yet.</p>
                ) : (
                  <div className="space-y-2">
                    {auditLog.map((log, idx) => (
                      <div key={idx} className="bg-slate-800/50 rounded p-3 border border-white/5">
                        <div className="flex justify-between items-start gap-3">
                          <div>
                            <p className="text-xs font-semibold text-white">
                              {log.action}: {log.employee_name}
                            </p>
                            {log.details && (
                              <p className="text-xs text-slate-400 mt-0.5">{log.details}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-slate-500">
                              {new Date(log.created_at).toLocaleString()}
                            </p>
                            {log.amount != null && (
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

            {/* Employee table */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {selectedCurrency === "USD" ? "US" : "PH"} Employee Payroll — Current Period
                </span>
                <span className="text-xs text-slate-400">{displayRows.length} employees</span>
              </div>
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Department</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Reg. Hours</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">OT Hours</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Rate</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Gross Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                        No {selectedCurrency === "USD" ? "US" : "PH"} employees found.
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((row) => (
                      <tr key={row.employee.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-3 font-medium text-white">
                          {row.employee.full_name}
                        </td>
                        <td className="px-4 py-3 text-slate-300">{row.employee.department ?? "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-300">
                          {row.hoursWorked.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center text-orange-300">
                          {row.overtimeHours.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-300">
                          {currencySymbol}{row.hourlyRate.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-green-300">
                          {selectedCurrency === "USD"
                            ? fmt(row.grossPay)
                            : fmt(row.grossPay, "PHP")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {displayRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-white/20 bg-white/5">
                      <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-slate-300">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-green-300">
                        {selectedCurrency === "USD"
                          ? fmt(totalUSPayroll)
                          : fmt(totalPHPayroll, "PHP")}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {/* ── Reports Tab ──────────────────────────────────────────────────── */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/10">
                <span className="text-sm font-semibold">Payroll Runs</span>
              </div>
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase w-8"></th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Period</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Generated</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Total (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRuns.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                        No payroll runs yet. Generate payroll from the Payroll tab.
                      </td>
                    </tr>
                  ) : (
                    payrollRuns.map((run) => (
                      <>
                        <tr
                          key={run.id}
                          className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                          onClick={() => toggleRun(run.id)}
                        >
                          <td className="px-4 py-3 text-slate-400">
                            {loadingRunId === run.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : expandedRunId === run.id ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-white">
                            {run.period_start} – {run.period_end}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                run.status === "completed"
                                  ? "bg-green-900/50 text-green-300"
                                  : run.status === "pending"
                                  ? "bg-yellow-900/50 text-yellow-300"
                                  : "bg-slate-700 text-slate-300"
                              }`}
                            >
                              {run.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {run.generated_at
                              ? new Date(run.generated_at).toLocaleString()
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-green-300">
                            {runTotals.has(run.id)
                              ? fmt(runTotals.get(run.id)!)
                              : "—"}
                          </td>
                        </tr>

                        {/* Expanded line items */}
                        {expandedRunId === run.id && runLineItems[run.id] && (
                          <tr key={`${run.id}-items`}>
                            <td colSpan={5} className="px-0 py-0">
                              <div className="bg-slate-800/60 border-t border-white/5 px-6 py-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-white/10">
                                      <th className="py-2 text-left text-slate-500 uppercase">Employee</th>
                                      <th className="py-2 text-center text-slate-500 uppercase">Reg Hrs</th>
                                      <th className="py-2 text-center text-slate-500 uppercase">OT Hrs</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Rate</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Regular Pay</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">OT Pay</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Gross Pay</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Currency</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {runLineItems[run.id].map((li, idx) => {
                                      const emp = employees.find((e) => e.id === li.employee_id);
                                      return (
                                        <tr key={idx} className="border-b border-white/5">
                                          <td className="py-2 text-white">
                                            {emp
                                              ? emp.full_name
                                              : li.employee_id}
                                          </td>
                                          <td className="py-2 text-center text-slate-300">{li.hours_worked?.toFixed(1)}</td>
                                          <td className="py-2 text-center text-orange-300">{li.overtime_hours?.toFixed(1)}</td>
                                          <td className="py-2 text-right text-slate-300">
                                            {li.currency === "PHP" ? "₱" : "$"}{li.hourly_rate?.toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right text-slate-300">
                                            {li.currency === "PHP" ? "₱" : "$"}{li.regular_pay?.toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right text-orange-300">
                                            {li.currency === "PHP" ? "₱" : "$"}{li.overtime_pay?.toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right font-semibold text-green-300">
                                            {li.currency === "PHP" ? "₱" : "$"}{li.gross_pay?.toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right text-slate-400">{li.currency}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
