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
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";
import { EmployeePayrollDetailModal } from "@/components/EmployeePayrollDetailModal";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { calcWorkedHours, getMyProfileSchedule } from "@/lib/supabase/timecards";
import { createNotification } from "@/lib/supabase/notifications";
import { useAuth } from "@/lib/auth";

// ─── Constants ───────────────────────────────────────────────────────────────
// PH employees are paid in PHP; this converts their PHP-denominated rate into
// a comparable USD figure so the whole dashboard can report in one currency
// (no ₱ shown anywhere) instead of switching symbols per employee's country.
const EXCHANGE_RATE = 57; // 1 USD = 57 PHP
// Hours worked are computed client-side from real check_in/check_out punches
// (timecard_entries.hours_worked/overtime_hours are never populated by the
// clock-in/out save flow) — same convention as PayrollCalculationPage.tsx.
const REGULAR_HOURS_PER_DAY = 8;

// ─── Types ───────────────────────────────────────────────────────────────────
interface SupabaseEmployee {
  id: string;
  full_name: string;
  department: string | null;
  country: string | null;  // derived: "PH" if assigned_branch===Philippines, else "US"
  hourly_rate: number | null;
  status: string | null;
  // profile fields
  display_name?: string;
  username?: string;
  role?: string;
  assigned_branch?: string;
  offDays?: number[];
  requiredCheckIn?: string;
  requiredCheckOut?: string;
}

interface SalaryEntry {
  profile_id: string;
  effective_date: string;
  hourly_rate: number;
}

interface TimecardEntry {
  profile_id: string | null;
  employee_id: string | null;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  meal_start: string | null;
  meal_end: string | null;
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
  profile_id: string;
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
  hourlyRateUSD: number;
  hoursWorked: number;
  overtimeHours: number;
  grossPay: number;
  grossPayUSD: number;
}

interface MonthlyBarData {
  month: string;
  usPayroll: number;
  phPayroll: number;
  total: number;
}

// ─── Helper ──────────────────────────────────────────────────────────────────
// Weekends are off days — a period should never end on one (nothing worked
// there anyway), so roll back to the Friday before.
function rollBackToWeekday(d: Date): Date {
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (day === 0) d.setDate(d.getDate() - 2);
  else if (day === 6) d.setDate(d.getDate() - 1);
  return d;
}

// Regular/overtime hours per employee from a set of raw timecard rows —
// shared by the live preview and by regeneratePayroll() (which recomputes
// against a past run's own period rather than the current preview range).
function computeHoursMap(entries: TimecardEntry[]): Map<string, { regular: number; overtime: number }> {
  const hoursMap = new Map<string, { regular: number; overtime: number }>();
  for (const tc of entries) {
    const key = tc.profile_id || tc.employee_id;
    if (!key || !tc.check_in || !tc.check_out) continue;
    const hours = calcWorkedHours({
      checkIn: tc.check_in,
      checkOut: tc.check_out,
      mealStart: tc.meal_start || "",
      mealEnd: tc.meal_end || "",
      notes: "",
    });
    const reg = Math.min(hours, REGULAR_HOURS_PER_DAY);
    const ot = Math.max(0, hours - REGULAR_HOURS_PER_DAY);
    const prev = hoursMap.get(key) ?? { regular: 0, overtime: 0 };
    hoursMap.set(key, { regular: prev.regular + reg, overtime: prev.overtime + ot });
  }
  return hoursMap;
}

// Ends yesterday (or the Friday before, if yesterday fell on a weekend) —
// an employee still clocked in today wouldn't have a check-out yet, so
// including today would understate their hours. Starts the day after the
// previous payroll run's period_end so consecutive runs never gap or
// overlap; with no prior run (first time ever), defaults to a 14-day window.
function periodBounds(lastPeriodEnd: string | null): { start: string; end: string } {
  const endDate = rollBackToWeekday((() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  })());
  const end = endDate.toISOString().split("T")[0];

  let startDate: Date;
  if (lastPeriodEnd) {
    startDate = new Date(lastPeriodEnd + "T00:00:00");
    startDate.setDate(startDate.getDate() + 1);
  } else {
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 13); // first-ever run: default 14-day window
  }
  const start = startDate.toISOString().split("T")[0];
  return { start, end };
}

// Always USD — PH employees are paid in PHP internally (salary_entries),
// but every amount is converted (see EXCHANGE_RATE) before it reaches this
// formatter so nothing in the UI shows ₱.
function fmt(amount: number) {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// Older payroll_line_items rows may have been recorded with currency: "PHP"
// (native, pre-standardization) — convert only those; everything else (all
// current rows use currency: "USD") is already a plain USD figure.
function toUSD(li: PayrollLineItem): number {
  return li.currency === "PHP" ? (li.gross_pay ?? 0) / EXCHANGE_RATE : (li.gross_pay ?? 0);
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AccountingDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "payroll" | "reports">("overview");
  // Overview KPI cards default to the live current-period preview, but can
  // be pointed at any previously generated payroll run instead.
  const [selectedRunId, setSelectedRunId] = useState<string>("current");
  const [selectedCurrency, setSelectedCurrency] = useState<"USD" | "PHP">("USD");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [employeeSearch, setEmployeeSearch] = useState("");

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
  const [regenerating, setRegenerating] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [detailEmployee, setDetailEmployee] = useState<SupabaseEmployee | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runLineItems, setRunLineItems] = useState<Record<string, PayrollLineItem[]>>({});
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        empRes,
        salRes,
        runsRes,
        lineRes,
        auditRes,
      ] = await Promise.all([
        supabase.from("profiles").select("id,display_name,username,role,assigned_branch,off_days,required_check_in,required_check_out").neq("role", "SUPERADMIN"),
        supabase.from("salary_entries").select("profile_id,effective_date,hourly_rate").not("profile_id", "is", null).order("effective_date", { ascending: false }),
        supabase.from("payroll_runs").select("id,period_start,period_end,status,generated_at").order("generated_at", { ascending: false }),
        supabase.from("payroll_line_items").select("payroll_run_id,profile_id,hours_worked,overtime_hours,hourly_rate,regular_pay,overtime_pay,gross_pay,net_pay,currency"),
        supabase.from("payroll_audit_log").select("action,employee_name,details,amount,created_at").order("created_at", { ascending: false }).limit(100),
      ]);

      for (const res of [empRes, salRes, runsRes, lineRes, auditRes]) {
        if (res.error) throw new Error(res.error.message);
      }

      const runs = (runsRes.data ?? []) as PayrollRun[];
      // runs is already ordered by generated_at desc, so runs[0] is the most
      // recent run — the next period picks up the day after it ended.
      const { start, end } = periodBounds(runs[0]?.period_end ?? null);
      const tcRes = await supabase
        .from("timecard_entries")
        .select("profile_id,employee_id,work_date,check_in,check_out,meal_start,meal_end,status")
        .gte("work_date", start)
        .lte("work_date", end);
      if (tcRes.error) throw new Error(tcRes.error.message);

      setEmployees(((empRes.data ?? []) as any[]).map((p) => ({
        id: p.id,
        full_name: p.display_name || p.username || p.id,
        department: p.role ?? null,
        country: p.assigned_branch === "Philippines" ? "PH" : "US",
        hourly_rate: null,
        status: "Active",
        display_name: p.display_name,
        username: p.username,
        role: p.role,
        assigned_branch: p.assigned_branch,
        offDays: p.off_days ?? undefined,
        requiredCheckIn: p.required_check_in ?? undefined,
        requiredCheckOut: p.required_check_out ?? undefined,
      })) as SupabaseEmployee[]);
      setSalaryEntries((salRes.data ?? []) as SalaryEntry[]);
      setTimecardEntries((tcRes.data ?? []) as TimecardEntry[]);
      setPayrollRuns(runs);
      setPayrollLineItems((lineRes.data ?? []) as PayrollLineItem[]);
      setAuditLog((auditRes.data ?? []) as PayrollAuditLogRow[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyProfileSchedule(uid).then((s) => {
      if (!cancelled) setMyProfileId(s.profileId);
    });
    return () => { cancelled = true; };
  }, [uid]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  // Latest salary entry per employee (salaryEntries is already ordered by
  // effective_date desc, so the first hit per profile is the current rate).
  const latestRateMap = new Map<string, number>();
  for (const se of salaryEntries) {
    if (!latestRateMap.has(se.profile_id)) {
      latestRateMap.set(se.profile_id, se.hourly_rate);
    }
  }

  // Hours worked per employee in current period. Computed from real
  // check_in/check_out punches (see REGULAR_HOURS_PER_DAY comment above).
  const hoursMap = computeHoursMap(timecardEntries);

  // Build payroll rows. salary_entries.hourly_rate is always entered as a
  // plain USD figure (the shared "Add Rate Change" form labels it "$/hr"
  // with no currency conversion of its own — see EmployeePayrollDetailModal.tsx),
  // regardless of the employee's assigned country, so hourlyRateUSD/grossPayUSD
  // are just hourlyRate/grossPay verbatim — no PHP division here. (EXCHANGE_RATE
  // is still used for payroll_line_items rows recorded with currency: "PHP"
  // before this was standardized — see toggleRun()/Reports tab below.)
  const payrollRows: EmployeePayrollRow[] = employees.map((emp) => {
    const hourlyRate =
      latestRateMap.get(emp.id) ?? emp.hourly_rate ?? 0;
    const hours = hoursMap.get(emp.id) ?? { regular: 0, overtime: 0 };
    const grossPay =
      hours.regular * hourlyRate + hours.overtime * hourlyRate * 1.5;
    return {
      employee: emp,
      hourlyRate,
      hourlyRateUSD: hourlyRate,
      hoursWorked: hours.regular,
      overtimeHours: hours.overtime,
      grossPay,
      grossPayUSD: grossPay,
    };
  });

  const usRows = payrollRows.filter((r) => r.employee.country === "US");
  const phRows = payrollRows.filter((r) => r.employee.country === "PH");

  // grossPayUSD is already plain USD (see payrollRows above) — no conversion here.
  const totalUSPayroll = usRows.reduce((s, r) => s + r.grossPayUSD, 0);
  const totalPHPayroll = phRows.reduce((s, r) => s + r.grossPayUSD, 0);
  const totalPayrollUSD = totalUSPayroll + totalPHPayroll;
  const avgPayPerEmployee =
    payrollRows.length > 0 ? totalPayrollUSD / payrollRows.length : 0;

  // Overview KPI cards: either the live current-period preview (computed
  // above from payrollRows) or a specific historical run's actual recorded
  // payroll_line_items — selected via the dropdown on the Overview tab.
  const selectedRun = selectedRunId === "current" ? null : payrollRuns.find((r) => r.id === selectedRunId) ?? null;
  const overviewSummary = (() => {
    if (!selectedRun) {
      return {
        totalPayrollUSD,
        totalUSPayroll,
        totalPHPayroll,
        usCount: usRows.length,
        phCount: phRows.length,
        avgPayPerEmployee,
        periodLabel: "Last 14 days · USD",
        employeeCount: employees.length,
        employeeCountLabel: "Active",
      };
    }
    const items = payrollLineItems.filter((li) => li.payroll_run_id === selectedRun.id);
    let usTotal = 0, phTotal = 0, usCount = 0, phCount = 0;
    for (const li of items) {
      const emp = employees.find((e) => e.id === li.profile_id);
      const usd = toUSD(li);
      if (emp?.country === "PH") { phTotal += usd; phCount++; }
      else { usTotal += usd; usCount++; }
    }
    const total = usTotal + phTotal;
    return {
      totalPayrollUSD: total,
      totalUSPayroll: usTotal,
      totalPHPayroll: phTotal,
      usCount,
      phCount,
      avgPayPerEmployee: items.length > 0 ? total / items.length : 0,
      periodLabel: `${selectedRun.period_start} – ${selectedRun.period_end} · USD`,
      employeeCount: items.length,
      employeeCountLabel: "Paid in this run",
    };
  })();

  // Monthly bar chart data from payroll_line_items grouped by run period.
  const monthlyBarData: MonthlyBarData[] = (() => {
    const map = new Map<string, { usPayroll: number; phPayroll: number }>();
    for (const run of payrollRuns) {
      const label = run.period_start
        ? new Date(run.period_start).toLocaleString("en-US", { month: "short", year: "2-digit" })
        : run.id;
      const items = payrollLineItems.filter((li) => li.payroll_run_id === run.id);
      const us = items
        .filter((li) => {
          const emp = employees.find((e) => e.id === li.profile_id);
          return emp?.country === "US";
        })
        .reduce((s, li) => s + toUSD(li), 0);
      const ph = items
        .filter((li) => {
          const emp = employees.find((e) => e.id === li.profile_id);
          return emp?.country === "PH";
        })
        .reduce((s, li) => s + toUSD(li), 0);
      const prev = map.get(label) ?? { usPayroll: 0, phPayroll: 0 };
      map.set(label, { usPayroll: prev.usPayroll + us, phPayroll: prev.phPayroll + ph });
    }
    return Array.from(map.entries()).map(([month, v]) => ({
      month,
      usPayroll: Math.round(v.usPayroll),
      phPayroll: Math.round(v.phPayroll),
      total: Math.round(v.usPayroll + v.phPayroll),
    }));
  })();

  // ── Generate Payroll ─────────────────────────────────────────────────────────
  const generatePayroll = async () => {
    if (payrollRows.length === 0) return;
    setGenerating(true);
    try {
      // payrollRuns is ordered by generated_at desc, so [0] is the most
      // recent run — the next period picks up the day after it ended.
      const lastPeriodEnd = payrollRuns[0]?.period_end ?? null;
      const { start, end } = periodBounds(lastPeriodEnd);
      if (start > end) {
        setError(`Payroll already covers through ${lastPeriodEnd}. Nothing new to generate yet — use "Regenerate Last Payroll" if you need to recompute it (e.g. a rate or timecard was fixed after the fact).`);
        setGenerating(false);
        return;
      }

      // Insert payroll run
      const { data: runData, error: runErr } = await supabase
        .from("payroll_runs")
        .insert({
          period_start: start,
          period_end: end,
          status: "generated",
          generated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (runErr) throw new Error(runErr.message);

      const runId = (runData as { id: string }).id;

      // Build line items — always USD (hourlyRateUSD/grossPayUSD are
      // already exchange-rate-converted for PH rows), so every run this
      // dashboard generates reads in one currency, no ₱ anywhere.
      const lineItems = payrollRows.map((r) => ({
        payroll_run_id: runId,
        profile_id: r.employee.id,
        hours_worked: r.hoursWorked,
        overtime_hours: r.overtimeHours,
        hourly_rate: r.hourlyRateUSD,
        regular_pay: r.hoursWorked * r.hourlyRateUSD,
        overtime_pay: r.overtimeHours * r.hourlyRateUSD * 1.5,
        gross_pay: r.grossPayUSD,
        net_pay: r.grossPayUSD, // simplified — no deductions model
        currency: "USD",
      }));

      const { error: lineErr } = await supabase.from("payroll_line_items").insert(lineItems);
      if (lineErr) throw new Error(lineErr.message);

      // Insert audit log entry
      await supabase.from("payroll_audit_log").insert({
        action: "generate",
        employee_name: "All Employees",
        details: `Generated payroll run for ${start} – ${end}. ${payrollRows.length} employees. Total: $${totalPayrollUSD.toFixed(2)}`,
        amount: Math.round(totalPayrollUSD * 100) / 100,
      });

      // Notify every employee who actually got paid something in this run —
      // skip $0 rows (e.g. no rate set yet) since there's nothing to tell them.
      await Promise.all(
        payrollRows
          .filter((r) => r.grossPayUSD > 0)
          .map((r) =>
            createNotification({
              recipientId: r.employee.id,
              senderId: myProfileId,
              senderName: "Payroll",
              body: "💰 Payslip is Ready — View Payslip",
              linkTo: "/m/dashboard/employee-self-service?tab=payroll",
            }).catch((err) => console.error("Failed to notify", r.employee.id, err))
          )
      );

      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate payroll");
    } finally {
      setGenerating(false);
    }
  };

  // ── Regenerate the most recent payroll run ───────────────────────────────────
  // Recomputes and replaces that run's line items using current rates/
  // attendance — for when a rate was missing or a timecard was corrected
  // after the run was already generated. Same period_start/period_end, just
  // fresh numbers and a bumped generated_at.
  const regeneratePayroll = async () => {
    const lastRun = payrollRuns[0];
    if (!lastRun) return;
    setRegenerating(true);
    try {
      const { data: entriesData, error: entriesErr } = await supabase
        .from("timecard_entries")
        .select("profile_id,employee_id,work_date,check_in,check_out,meal_start,meal_end,status")
        .gte("work_date", lastRun.period_start)
        .lte("work_date", lastRun.period_end);
      if (entriesErr) throw new Error(entriesErr.message);

      const regenHoursMap = computeHoursMap((entriesData ?? []) as TimecardEntry[]);
      const regenRows = employees.map((emp) => {
        const hourlyRate = latestRateMap.get(emp.id) ?? emp.hourly_rate ?? 0;
        const hours = regenHoursMap.get(emp.id) ?? { regular: 0, overtime: 0 };
        const grossPayUSD = hours.regular * hourlyRate + hours.overtime * hourlyRate * 1.5;
        return { employee: emp, hoursWorked: hours.regular, overtimeHours: hours.overtime, hourlyRateUSD: hourlyRate, grossPayUSD };
      });

      const { error: deleteErr } = await supabase.from("payroll_line_items").delete().eq("payroll_run_id", lastRun.id);
      if (deleteErr) throw new Error(deleteErr.message);

      const lineItems = regenRows.map((r) => ({
        payroll_run_id: lastRun.id,
        profile_id: r.employee.id,
        hours_worked: r.hoursWorked,
        overtime_hours: r.overtimeHours,
        hourly_rate: r.hourlyRateUSD,
        regular_pay: r.hoursWorked * r.hourlyRateUSD,
        overtime_pay: r.overtimeHours * r.hourlyRateUSD * 1.5,
        gross_pay: r.grossPayUSD,
        net_pay: r.grossPayUSD,
        currency: "USD",
      }));
      const { error: insertErr } = await supabase.from("payroll_line_items").insert(lineItems);
      if (insertErr) throw new Error(insertErr.message);

      await supabase.from("payroll_runs").update({ generated_at: new Date().toISOString() }).eq("id", lastRun.id);

      const newTotal = regenRows.reduce((s, r) => s + r.grossPayUSD, 0);
      await supabase.from("payroll_audit_log").insert({
        action: "edit",
        employee_name: "All Employees",
        details: `Regenerated payroll run for ${lastRun.period_start} – ${lastRun.period_end}. ${regenRows.length} employees. Total: $${newTotal.toFixed(2)}.`,
        amount: Math.round(newTotal * 100) / 100,
      });

      await Promise.all(
        regenRows
          .filter((r) => r.grossPayUSD > 0)
          .map((r) =>
            createNotification({
              recipientId: r.employee.id,
              senderId: myProfileId,
              senderName: "Payroll",
              body: "🔄 Payslip Updated — View Payslip",
              linkTo: "/m/dashboard/employee-self-service?tab=payroll",
            }).catch((err) => console.error("Failed to notify", r.employee.id, err))
          )
      );

      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to regenerate payroll");
    } finally {
      setRegenerating(false);
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
        .select("payroll_run_id,profile_id,hours_worked,overtime_hours,hourly_rate,regular_pay,overtime_pay,gross_pay,net_pay,currency")
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
  // selectedCurrency is really a "which team" filter (US vs PH employees) —
  // every amount is always shown in USD regardless of which team is active.
  const displayRows = selectedCurrency === "USD" ? usRows : phRows;

  const departmentOptions = Array.from(
    new Set(displayRows.map((r) => r.employee.department).filter((d): d is string => !!d))
  );

  const visibleRows = displayRows.filter((row) => {
    if (departmentFilter !== "all" && row.employee.department !== departmentFilter) return false;
    if (employeeSearch && !row.employee.full_name.toLowerCase().includes(employeeSearch.toLowerCase())) return false;
    return true;
  });
  const visibleTotalUSD = visibleRows.reduce((s, r) => s + r.grossPayUSD, 0);

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
            {/* Period selector */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400 uppercase tracking-wide">Period</label>
              <select
                title="Select payroll period"
                value={selectedRunId}
                onChange={(e) => setSelectedRunId(e.target.value)}
                className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="current">Current Period (Live)</option>
                {payrollRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.period_start} – {run.period_end}
                  </option>
                ))}
              </select>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Total Employees</p>
                <p className="text-2xl font-bold text-green-300">{overviewSummary.employeeCount}</p>
                <p className="text-xs text-slate-500 mt-1">{overviewSummary.employeeCountLabel}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">{selectedRun ? "Total Payroll (Selected Period)" : "Total Payroll (Current Period)"}</p>
                <p className="text-2xl font-bold text-blue-300">{fmt(overviewSummary.totalPayrollUSD)}</p>
                <p className="text-xs text-slate-500 mt-1">{overviewSummary.periodLabel}</p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">US / PH Split</p>
                <p className="text-lg font-bold text-purple-300">
                  {fmt(overviewSummary.totalUSPayroll)} / {fmt(overviewSummary.totalPHPayroll)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {overviewSummary.usCount} US · {overviewSummary.phCount} PH employees
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Avg Pay / Employee</p>
                <p className="text-2xl font-bold text-amber-300">{fmt(overviewSummary.avgPayPerEmployee)}</p>
                <p className="text-xs text-slate-500 mt-1">{selectedRun ? "Selected period" : "Current period"}</p>
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
                type="button"
                onClick={generatePayroll}
                disabled={generating || payrollRows.length === 0}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded font-semibold transition flex items-center gap-2"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                Generate Payroll
              </button>
              {payrollRuns.length > 0 && (
                <button
                  type="button"
                  onClick={regeneratePayroll}
                  disabled={regenerating}
                  title={`Recompute the last run (${payrollRuns[0].period_start} – ${payrollRuns[0].period_end}) using current rates/attendance`}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded font-semibold transition flex items-center gap-2"
                >
                  {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Regenerate Last Payroll
                </button>
              )}
              <button
                type="button"
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
                    onClick={() => {
                      setSelectedCurrency(cur);
                      setDepartmentFilter("all");
                    }}
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
                  {fmt(selectedCurrency === "USD" ? totalUSPayroll : totalPHPayroll)}
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
                  {fmt(displayRows.reduce((s, r) => s + r.overtimeHours * r.hourlyRateUSD * 1.5, 0))}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">Avg per Employee</p>
                <p className="text-2xl font-bold text-purple-300">
                  {fmt(displayRows.length > 0
                    ? (selectedCurrency === "USD" ? totalUSPayroll : totalPHPayroll) / displayRows.length
                    : 0)}
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
                <span className="text-xs text-slate-400">{visibleRows.length} employees</span>
              </div>
              <div className="px-4 py-3 border-b border-white/10 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase mb-1">Department / Role</label>
                  <select
                    title="Department / Role"
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="all">All Departments</option>
                    {departmentOptions.map((d) => (
                      <option key={d} value={d}>{ROLE_LABELS[d] ?? d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase mb-1">Search</label>
                  <input
                    type="text"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Search employee..."
                    className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
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
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                        No {selectedCurrency === "USD" ? "US" : "PH"} employees found.
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => (
                      <tr key={row.employee.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-3 font-medium">
                          <button
                            type="button"
                            onClick={() => setDetailEmployee(row.employee)}
                            title={`assigned_branch: ${row.employee.assigned_branch || "(blank)"} · profile id: ${row.employee.id}`}
                            className="text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {row.employee.full_name}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {row.employee.department ? (ROLE_LABELS[row.employee.department] ?? row.employee.department) : "—"}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-300">
                          {row.hoursWorked.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center text-orange-300">
                          {row.overtimeHours.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-300">
                          ${row.hourlyRateUSD.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-green-300">
                          {fmt(row.grossPayUSD)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {visibleRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-white/20 bg-white/5">
                      <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-slate-300">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-green-300">
                        {fmt(visibleTotalUSD)}
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
                                run.status === "draft"
                                  ? "bg-yellow-900/50 text-yellow-300"
                                  : "bg-green-900/50 text-green-300"
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
                                      const emp = employees.find((e) => e.id === li.profile_id);
                                      // Historical runs generated before this dashboard went dollar-only
                                      // may still be flagged "PHP" — convert those for display so every
                                      // run (old or new) reads in USD.
                                      const divisor = li.currency === "PHP" ? EXCHANGE_RATE : 1;
                                      return (
                                        <tr key={idx} className="border-b border-white/5">
                                          <td className="py-2 text-white">
                                            {emp
                                              ? emp.full_name
                                              : li.profile_id}
                                          </td>
                                          <td className="py-2 text-center text-slate-300">{li.hours_worked?.toFixed(1)}</td>
                                          <td className="py-2 text-center text-orange-300">{li.overtime_hours?.toFixed(1)}</td>
                                          <td className="py-2 text-right text-slate-300">
                                            ${(li.hourly_rate / divisor).toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right text-slate-300">
                                            ${(li.regular_pay / divisor).toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right text-orange-300">
                                            ${(li.overtime_pay / divisor).toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right font-semibold text-green-300">
                                            ${(li.gross_pay / divisor).toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right text-slate-400">USD</td>
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

      {detailEmployee && (
        <EmployeePayrollDetailModal
          profileId={detailEmployee.id}
          employeeName={detailEmployee.full_name}
          department={detailEmployee.department ?? undefined}
          requiredCheckIn={detailEmployee.requiredCheckIn}
          requiredCheckOut={detailEmployee.requiredCheckOut}
          offDays={detailEmployee.offDays}
          onClose={() => setDetailEmployee(null)}
          onRateChanged={fetchData}
        />
      )}
    </div>
  );
}
