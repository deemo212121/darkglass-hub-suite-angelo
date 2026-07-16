/**
 * Accounting Report — read-only summary, distinct from Accounting Dashboard
 * (which has interactive Generate Payroll / per-employee edit actions this
 * page deliberately omits). Reuses the same real tables the dashboard reads
 * (profiles, salary_entries, timecard_entries, payroll_runs,
 * payroll_line_items) so the numbers always agree, but this page only ever
 * reads — no payroll generation, no approvals, no per-employee editing.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, DollarSign, Users, TrendingUp, Loader2, Download } from "lucide-react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";
import { calcWorkedHours } from "@/lib/supabase/timecards";

const EXCHANGE_RATE = 57; // 1 USD = 57 PHP — same convention as AccountingDashboard.tsx
const REGULAR_HOURS_PER_DAY = 8;
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

interface Employee {
  id: string;
  name: string;
  department: string;
  country: "US" | "PH";
}
interface SalaryEntry { profile_id: string; effective_date: string; hourly_rate: number }
interface TimecardEntry { profile_id: string | null; employee_id: string | null; check_in: string | null; check_out: string | null; meal_start: string | null; meal_end: string | null }
interface PayrollRun { id: string; period_start: string; period_end: string; status: string; generated_at: string | null }
interface PayrollLineItem { payroll_run_id: string; profile_id: string; gross_pay: number; currency: string }

function rollBackToWeekday(d: Date): Date {
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  else if (day === 6) d.setDate(d.getDate() - 1);
  return d;
}
function periodBounds(lastPeriodEnd: string | null): { start: string; end: string } {
  const endDate = rollBackToWeekday((() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })());
  const end = endDate.toISOString().split("T")[0];
  let startDate: Date;
  if (lastPeriodEnd) {
    startDate = new Date(lastPeriodEnd + "T00:00:00");
    startDate.setDate(startDate.getDate() + 1);
  } else {
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 13);
  }
  return { start: startDate.toISOString().split("T")[0], end };
}
function fmt(amount: number) {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function toUSD(li: PayrollLineItem): number {
  return li.currency === "PHP" ? (li.gross_pay ?? 0) / EXCHANGE_RATE : (li.gross_pay ?? 0);
}

export function ReportAccounting({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntry[]>([]);
  const [timecardEntries, setTimecardEntries] = useState<TimecardEntry[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payrollLineItems, setPayrollLineItems] = useState<PayrollLineItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [empRes, salRes, runsRes, lineRes] = await Promise.all([
          supabase.from("profiles").select("id,display_name,username,role,assigned_branch").neq("role", "SUPERADMIN"),
          supabase.from("salary_entries").select("profile_id,effective_date,hourly_rate").not("profile_id", "is", null).order("effective_date", { ascending: false }),
          supabase.from("payroll_runs").select("id,period_start,period_end,status,generated_at").order("generated_at", { ascending: false }),
          supabase.from("payroll_line_items").select("payroll_run_id,profile_id,gross_pay,currency"),
        ]);
        for (const res of [empRes, salRes, runsRes, lineRes]) if (res.error) throw new Error(res.error.message);
        const runs = (runsRes.data ?? []) as PayrollRun[];
        const { start, end } = periodBounds(runs[0]?.period_end ?? null);
        const tcRes = await supabase
          .from("timecard_entries")
          .select("profile_id,employee_id,check_in,check_out,meal_start,meal_end")
          .gte("work_date", start)
          .lte("work_date", end);
        if (tcRes.error) throw new Error(tcRes.error.message);
        if (cancelled) return;
        setEmployees(((empRes.data ?? []) as any[]).map((p) => ({
          id: p.id,
          name: p.display_name || p.username || p.id,
          department: p.role ?? "Unspecified",
          country: p.assigned_branch === "Philippines" ? "PH" : "US",
        })));
        setSalaryEntries((salRes.data ?? []) as SalaryEntry[]);
        setTimecardEntries((tcRes.data ?? []) as TimecardEntry[]);
        setPayrollRuns(runs);
        setPayrollLineItems((lineRes.data ?? []) as PayrollLineItem[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Accounting Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Current live period preview — same "Last 14 days" convention as
  // AccountingDashboard.tsx's Overview tab, computed from real punches.
  const currentPeriod = useMemo(() => {
    const latestRateMap = new Map<string, number>();
    for (const se of salaryEntries) if (!latestRateMap.has(se.profile_id)) latestRateMap.set(se.profile_id, se.hourly_rate);

    const hoursMap = new Map<string, number>();
    for (const tc of timecardEntries) {
      const key = tc.profile_id || tc.employee_id;
      if (!key || !tc.check_in || !tc.check_out) continue;
      const hours = calcWorkedHours({ checkIn: tc.check_in, checkOut: tc.check_out, mealStart: tc.meal_start || "", mealEnd: tc.meal_end || "", notes: "" });
      hoursMap.set(key, (hoursMap.get(key) ?? 0) + hours);
    }

    let usTotal = 0, phTotal = 0, usCount = 0, phCount = 0;
    for (const emp of employees) {
      const rate = latestRateMap.get(emp.id) ?? 0;
      const hours = hoursMap.get(emp.id) ?? 0;
      const reg = Math.min(hours, REGULAR_HOURS_PER_DAY * 14);
      const ot = Math.max(0, hours - reg);
      const gross = reg * rate + ot * rate * 1.5;
      if (emp.country === "PH") { phTotal += gross; phCount++; } else { usTotal += gross; usCount++; }
    }
    const total = usTotal + phTotal;
    return { usTotal, phTotal, total, usCount, phCount, avgPay: employees.length > 0 ? total / employees.length : 0 };
  }, [employees, salaryEntries, timecardEntries]);

  // Monthly Payroll Totals — same grouping AccountingDashboard.tsx uses, by run period month.
  const monthlyChartData = useMemo(() => {
    const map = new Map<string, { usPayroll: number; phPayroll: number }>();
    for (const run of payrollRuns) {
      const label = run.period_start ? new Date(run.period_start).toLocaleString("en-US", { month: "short", year: "2-digit" }) : run.id;
      const items = payrollLineItems.filter((li) => li.payroll_run_id === run.id);
      const us = items.filter((li) => employees.find((e) => e.id === li.profile_id)?.country === "US").reduce((s, li) => s + toUSD(li), 0);
      const ph = items.filter((li) => employees.find((e) => e.id === li.profile_id)?.country === "PH").reduce((s, li) => s + toUSD(li), 0);
      const prev = map.get(label) ?? { usPayroll: 0, phPayroll: 0 };
      map.set(label, { usPayroll: prev.usPayroll + us, phPayroll: prev.phPayroll + ph });
    }
    return Array.from(map.entries()).map(([month, v]) => ({ month, usPayroll: Math.round(v.usPayroll), phPayroll: Math.round(v.phPayroll) }));
  }, [payrollRuns, payrollLineItems, employees]);

  // Department-level breakdown of the current live period — aggregated, not
  // per-employee dollar figures, since this is a summary report rather than
  // the interactive per-employee payroll ledger (that stays on the Dashboard).
  const departmentBreakdown = useMemo(() => {
    const latestRateMap = new Map<string, number>();
    for (const se of salaryEntries) if (!latestRateMap.has(se.profile_id)) latestRateMap.set(se.profile_id, se.hourly_rate);
    const hoursMap = new Map<string, number>();
    for (const tc of timecardEntries) {
      const key = tc.profile_id || tc.employee_id;
      if (!key || !tc.check_in || !tc.check_out) continue;
      const hours = calcWorkedHours({ checkIn: tc.check_in, checkOut: tc.check_out, mealStart: tc.meal_start || "", mealEnd: tc.meal_end || "", notes: "" });
      hoursMap.set(key, (hoursMap.get(key) ?? 0) + hours);
    }
    const map = new Map<string, { count: number; total: number }>();
    for (const emp of employees) {
      const rate = latestRateMap.get(emp.id) ?? 0;
      const hours = hoursMap.get(emp.id) ?? 0;
      const reg = Math.min(hours, REGULAR_HOURS_PER_DAY * 14);
      const ot = Math.max(0, hours - reg);
      const gross = reg * rate + ot * rate * 1.5;
      const dept = emp.department || "Unspecified";
      const d = map.get(dept) ?? { count: 0, total: 0 };
      d.count += 1;
      d.total += gross;
      map.set(dept, d);
    }
    return Array.from(map.entries()).map(([department, v]) => ({ department, ...v })).sort((a, b) => b.total - a.total);
  }, [employees, salaryEntries, timecardEntries]);

  const exportToXlsx = () => {
    const sheet: (string | number)[][] = [
      ["Accounting Report"],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Summary — Current Period (Last 14 Days)"],
      ["Metric", "Value"],
      ["Total Employees", employees.length],
      ["Total Payroll", currentPeriod.total.toFixed(2)],
      ["US Payroll", currentPeriod.usTotal.toFixed(2)],
      ["PH Payroll", currentPeriod.phTotal.toFixed(2)],
      ["US Employees", currentPeriod.usCount],
      ["PH Employees", currentPeriod.phCount],
      ["Avg Pay / Employee", currentPeriod.avgPay.toFixed(2)],
      [],
      ["Monthly Payroll Totals"],
      ["Month", "US Payroll", "PH Payroll"],
      ...monthlyChartData.map((m) => [m.month, m.usPayroll, m.phPayroll]),
      [],
      ["Payroll Runs"],
      ["Period", "Status", "Generated"],
      ...payrollRuns.map((r) => [`${r.period_start} – ${r.period_end}`, r.status, r.generated_at ? new Date(r.generated_at).toLocaleString() : "—"]),
      [],
      ["Department Breakdown — Current Period"],
      ["Department", "Employees", "Total Payroll"],
      ...departmentBreakdown.map((d) => [d.department, d.count, d.total.toFixed(2)]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Accounting Report");
    XLSX.writeFile(workbook, `accounting-report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Read-only payroll summary — live from Accounting. Generate/approve payroll runs from the Accounting Dashboard.</p>
          </div>
          <button onClick={exportToXlsx} disabled={loading} className="btn text-sm px-3 ml-auto flex items-center gap-1.5 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Download XLSX
          </button>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Accounting Report…</div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 mt-4">
          {[
            ["Total Employees", employees.length, "text-white", Users],
            ["Total Payroll (14d)", fmt(currentPeriod.total), "text-green-300", DollarSign],
            ["US / PH Split", `${fmt(currentPeriod.usTotal)} / ${fmt(currentPeriod.phTotal)}`, "text-blue-300", TrendingUp],
            ["Avg Pay / Employee", fmt(currentPeriod.avgPay), "text-yellow-300", DollarSign],
          ].map(([label, value, color, Icon]: any) => (
            <div key={label} className="panel p-4 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground"><Icon className="h-4 w-4" /></div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Monthly Payroll Totals (USD)</p>
          {monthlyChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground py-16 text-center">No payroll runs generated yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyChartData} margin={{ left: -10 }}>
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="usPayroll" fill="#34d399" radius={[4, 4, 0, 0]} name="US Payroll" />
                <Bar dataKey="phPayroll" fill="#818cf8" radius={[4, 4, 0, 0]} name="PH Payroll" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="panel overflow-x-auto p-0">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">Payroll Runs</div>
            <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">
              {["Period", "Status", "Generated"].map((h) => <th key={h} className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {payrollRuns.length === 0 ? <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No payroll runs yet.</td></tr> :
                payrollRuns.slice(0, 12).map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 whitespace-nowrap">{r.period_start} – {r.period_end}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${r.status === "draft" ? "bg-yellow-500/20 text-yellow-300" : "bg-green-500/20 text-green-300"}`}>{r.status}</span></td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.generated_at ? new Date(r.generated_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
            </tbody></table>
          </div>
          <div className="panel overflow-x-auto p-0">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">Department Breakdown — Current Period</div>
            <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">
              {["Department", "Employees", "Total Payroll"].map((h) => <th key={h} className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {departmentBreakdown.length === 0 ? <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No employee data.</td></tr> :
                departmentBreakdown.map((d) => (
                  <tr key={d.department} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2">{d.department}</td>
                    <td className="px-3 py-2 text-right">{d.count}</td>
                    <td className="px-3 py-2 text-right font-semibold text-green-300">{fmt(d.total)}</td>
                  </tr>
                ))}
            </tbody></table>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
}
