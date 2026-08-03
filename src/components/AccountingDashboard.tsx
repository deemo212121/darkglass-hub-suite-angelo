import { useState, useEffect, useCallback, Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { usePersistedTab } from "@/lib/usePersistedTab";
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
  Download,
  Mail,
  Send,
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
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";
import { EmployeePayrollDetailModal } from "@/components/EmployeePayrollDetailModal";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { getRoleDepartmentBreakdown, normalizeRole } from "@/lib/roleLabels";
import { calcWorkedHours, getMyProfileSchedule, resolveScheduledNetHours, getAttendanceForRange } from "@/lib/supabase/timecards";
import { updatePayrollLineItemExtra, updatePayrollLineItemPaid } from "@/lib/supabase/payslips";
import { getEmployeeInfoByProfileIds, type EmployeeInfo } from "@/lib/supabase/users";
import { createNotification } from "@/lib/supabase/notifications";
import { getCompanyPtoRequests, type PtoRequestRow } from "@/lib/supabase/pto";
import { getTechRepairRates, getTechCompletedRepairCounts, DEFAULT_REPAIR_TYPE, type TechRepairRate, type TechRepairCount } from "@/lib/supabase/techPayroll";
import { perCutoffSalary } from "@/lib/supabase/salary";
import { useAuth } from "@/lib/auth";
import { getGmailConnectionStatus, disconnectGmail, sendPayslipEmail, type GmailConnectionStatus, type GmailRegion } from "@/lib/supabase/gmailConnection";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { captureHtmlToPdfBlob, blobToBase64 } from "@/lib/pdfCapture";
import { renderPayslipBodyHtml, PAYSLIP_STYLES, type PayslipDailyRow, type EmployeePayslipData } from "@/lib/payslipTemplate";
import { ActivityLogPanel } from "@/components/ActivityLogPanel";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";

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
  roleLabel: string | null;
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
  workingHours?: number | null;
  mealMinutes?: number | null;
  /** Never draws a salary through this system (e.g. the owner) — skipped by
   *  generatePayroll(), the missing-clock-out gate, and the nation/department
   *  export, but stays visible in the Payroll tab table so it can be
   *  unchecked again later. See migration 0112. */
  payrollExcluded: boolean;
}

interface SalaryEntry {
  profile_id: string;
  effective_date: string;
  compensation_type: "hourly" | "fixed";
  hourly_rate: number;
  annual_salary: number | null;
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
  extra_pay: number;
  notes: string | null;
  paid: boolean;
  paid_at: string | null;
  compensation_type: "hourly" | "fixed";
  annual_salary: number | null;
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
  compensationType: "hourly" | "fixed";
  /** Only meaningful when compensationType is "hourly" — 0 for fixed-salary employees. */
  hourlyRate: number;
  hourlyRateUSD: number;
  /** Only set when compensationType is "fixed". */
  annualSalary: number | null;
  hoursWorked: number;
  overtimeHours: number;
  /** Scheduled ("duty") hours for the period — see computeDutyHours. */
  dutyHours: number;
  grossPay: number;
  grossPayUSD: number;
  /** Tech Payroll only — completed repair tickets in the period. 0 for Office/fixed-salary rows. */
  ticketsCompleted: number;
}

interface MonthlyBarData {
  month: string;
  usOfficePayroll: number;
  usTechPayroll: number;
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

// Regular/overtime hours per employee from a set of raw timecard rows, plus
// approved PTO credited as if it were a normal scheduled day — shared by the
// live preview and by generatePayroll() when re-picked dates exactly match
// an existing run (recomputing it in place).
//
// A PTO day only counts toward pay if it was actually approved (pending
// requests haven't been decided yet) and isn't the "unpaid" type (that one's
// unpaid by definition — see ptoRequestsInYear in pto.ts, same exclusion).
// It's credited at the employee's scheduled NET hours for that day
// (resolveScheduledNetHours — same working_hours/meal_minutes-aware
// calculation used for meal-break eligibility), clipped to the payroll
// period and skipped on the employee's own off days or on any date they
// already have a real punch for (a real punch always wins over a PTO
// request that happens to overlap it).
function computeHoursMap(
  entries: TimecardEntry[],
  employees: SupabaseEmployee[],
  ptoRequests: PtoRequestRow[],
  periodStart: string,
  periodEnd: string
): Map<string, { regular: number; overtime: number }> {
  const hoursMap = new Map<string, { regular: number; overtime: number }>();
  const punchedDates = new Map<string, Set<string>>();
  for (const tc of entries) {
    const key = tc.profile_id || tc.employee_id;
    if (!key || !tc.check_in || !tc.check_out) continue;
    const dates = punchedDates.get(key) ?? new Set<string>();
    dates.add(tc.work_date);
    punchedDates.set(key, dates);
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

  if (!periodStart || !periodEnd) return hoursMap;
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  for (const pto of ptoRequests) {
    if (pto.status !== "approved" || pto.ptoType === "unpaid") continue;
    const emp = employeeById.get(pto.profileId);
    if (!emp) continue;
    const offDays = new Set(emp.offDays ?? []);
    const netHours = resolveScheduledNetHours(emp.requiredCheckIn || "", emp.requiredCheckOut || "", emp.workingHours, emp.mealMinutes);
    if (netHours <= 0) continue;
    const punched = punchedDates.get(pto.profileId);
    const start = pto.startDate < periodStart ? periodStart : pto.startDate;
    const end = pto.endDate > periodEnd ? periodEnd : pto.endDate;
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (offDays.has(d.getDay())) continue;
      if (punched?.has(iso)) continue;
      const prev = hoursMap.get(pto.profileId) ?? { regular: 0, overtime: 0 };
      hoursMap.set(pto.profileId, { regular: prev.regular + netHours, overtime: prev.overtime });
    }
  }
  return hoursMap;
}

// Scheduled ("duty") hours for the period — the employee's expected net
// hours (resolveScheduledNetHours, same working_hours/meal_minutes-aware
// calculation used for PTO crediting above) for every day in
// [periodStart, periodEnd] that isn't one of their own off days. Shown
// alongside Reg. Hours (actual worked) so Finance can spot under/over
// attendance at a glance, independent of whether those hours were
// actually punched.
function computeDutyHours(emp: SupabaseEmployee | undefined, periodStart: string, periodEnd: string): number {
  if (!emp || !periodStart || !periodEnd) return 0;
  const netHours = resolveScheduledNetHours(emp.requiredCheckIn || "", emp.requiredCheckOut || "", emp.workingHours, emp.mealMinutes);
  if (netHours <= 0) return 0;
  const offDays = new Set(emp.offDays ?? []);
  let total = 0;
  for (let d = new Date(`${periodStart}T00:00:00`); d <= new Date(`${periodEnd}T00:00:00`); d.setDate(d.getDate() + 1)) {
    if (!offDays.has(d.getDay())) total += netHours;
  }
  return total;
}

// Attendance rows with a clock-in but no clock-out — payroll can't trust
// what an unfinished shift's hours were, so generation/regeneration must be
// blocked entirely rather than silently computing 0 hours for that day
// (which is what computeHoursMap above does, by skipping the row). Returns
// one "Employee Name (YYYY-MM-DD)" string per offending row, for the error
// message shown to Finance.
function findMissingTimeouts(entries: TimecardEntry[], employees: SupabaseEmployee[]): string[] {
  const nameById = new Map(employees.map((e) => [e.id, e.full_name]));
  return entries
    .filter((tc) => tc.check_in && !tc.check_out)
    .map((tc) => {
      const key = tc.profile_id || tc.employee_id;
      const name = (key && nameById.get(key)) || "Unknown employee";
      return `${name} (${tc.work_date})`;
    })
    .sort();
}

// One nation's sheet for the "Payroll by Nation & Department" export —
// employees grouped by department (same department/role split as the
// Payroll tab's employee table — see getRoleDepartmentBreakdown), each
// group followed by a subtotal row, and a grand total for the whole
// nation at the end.
function buildDepartmentSheetRows(rows: EmployeePayrollRow[]): (string | number)[][] {
  const byDept = new Map<string, EmployeePayrollRow[]>();
  for (const r of rows) {
    const dept = r.employee.department || "Unspecified";
    const list = byDept.get(dept) ?? [];
    list.push(r);
    byDept.set(dept, list);
  }

  const sheet: (string | number)[][] = [
    ["Employee", "Department", "Role", "Reg Hrs", "OT Hrs", "Rate ($/hr)", "Gross Pay ($)"],
  ];
  let nationTotal = 0;
  for (const [dept, deptRows] of Array.from(byDept.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const r of deptRows) {
      sheet.push([
        r.employee.full_name,
        dept,
        r.employee.roleLabel || "—",
        Number(r.hoursWorked.toFixed(1)),
        Number(r.overtimeHours.toFixed(1)),
        r.compensationType === "fixed" && r.annualSalary ? `Fixed ($${r.annualSalary.toLocaleString()}/yr)` : Number(r.hourlyRateUSD.toFixed(2)),
        Number(r.grossPayUSD.toFixed(2)),
      ]);
    }
    const deptTotal = deptRows.reduce((s, r) => s + r.grossPayUSD, 0);
    sheet.push(["", `${dept} Subtotal`, "", "", "", "", Number(deptTotal.toFixed(2))]);
    sheet.push([]);
    nationTotal += deptTotal;
  }
  sheet.push(["", "Nation Total", "", "", "", "", Number(nationTotal.toFixed(2))]);
  return sheet;
}

// Default period suggested for genStart/genEnd (Finance can freely pick
// something else — see the date inputs on the Payroll tab). Ends yesterday
// (or the Friday before, if yesterday fell on a weekend) — an employee
// still clocked in today wouldn't have a check-out yet, so including today
// would understate their hours. Starts the day after the previous payroll
// run's period_end so the suggested range never gaps or overlaps it; with
// no prior run (first time ever), defaults to a 14-day window.
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

// A fixed-salary row's hourlyRateUSD is always 0 (see payrollRows above) —
// shown instead as its annual salary so the Rate column/filter/export never
// display a misleading "$0.00" for these employees.
function rateLabel(row: EmployeePayrollRow): string {
  if (row.compensationType === "fixed" && row.annualSalary) return `Fixed $${row.annualSalary.toLocaleString()}/yr`;
  return `$${row.hourlyRateUSD.toFixed(2)}`;
}

function parseGmailRegionParam(value: string | null): GmailRegion {
  return value === "PH" ? "PH" : "US";
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AccountingDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid, role, displayName, email } = useAuth();
  const canConnectGmail = String(role || "").toUpperCase() === "ADMIN" || String(role || "").toUpperCase() === "SUPERADMIN";
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = usePersistedTab<"overview" | "payroll" | "reports">(
    "ahs:accounting-dashboard-active-tab",
    ["overview", "payroll", "reports"],
    "overview",
  );
  // Overview KPI cards default to the live current-period preview, but can
  // be pointed at any previously generated payroll run instead.
  const [selectedRunId, setSelectedRunId] = useState<string>("current");
  const [selectedCurrency, setSelectedCurrency] = useState<"USD" | "PHP">("USD");
  // Under US Payroll only — technicians are paid per completed repair ticket
  // (Tech Payroll) instead of hourly (Office Payroll, the pre-existing view).
  const [payrollView, setPayrollView] = useState<"office" | "tech">("office");
  // Funnel-style column filters (Ticket List convention) — empty set = no filter.
  const [departmentFilter, setDepartmentFilter] = useState<Set<string>>(new Set());
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [regHoursFilter, setRegHoursFilter] = useState<Set<string>>(new Set());
  const [rateFilter, setRateFilter] = useState<Set<string>>(new Set());
  const [employeeSearch, setEmployeeSearch] = useState("");
  // Clicking the Name column header cycles asc -> desc -> back to
  // whatever order the data naturally came in (null).
  const [nameSort, setNameSort] = useState<"asc" | "desc" | null>(null);
  const toggleNameSort = () => setNameSort((prev) => (prev === null ? "asc" : prev === "asc" ? "desc" : null));

  // Raw data
  const [employees, setEmployees] = useState<SupabaseEmployee[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntry[]>([]);
  const [timecardEntries, setTimecardEntries] = useState<TimecardEntry[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payrollLineItems, setPayrollLineItems] = useState<PayrollLineItem[]>([]);
  const [auditLog, setAuditLog] = useState<PayrollAuditLogRow[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [techRepairRates, setTechRepairRates] = useState<TechRepairRate[]>([]);
  const [techRepairCounts, setTechRepairCounts] = useState<TechRepairCount[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [detailEmployee, setDetailEmployee] = useState<SupabaseEmployee | null>(null);
  // One connection per region (US/PH each send payslips from their own
  // connected Gmail account) — keyed the same way as the currency toggle.
  const [gmailStatusByRegion, setGmailStatusByRegion] = useState<Record<GmailRegion, GmailConnectionStatus | null>>({ US: null, PH: null });
  const [connectingGmailRegion, setConnectingGmailRegion] = useState<GmailRegion | null>(null);
  const [disconnectingGmailRegion, setDisconnectingGmailRegion] = useState<GmailRegion | null>(null);
  const [sendingPayslipId, setSendingPayslipId] = useState<string | null>(null);
  // The Payroll table's currency toggle already reads as "which region" —
  // reuse it directly rather than a second, easy-to-desync piece of state.
  const activeGmailRegion: GmailRegion = selectedCurrency === "USD" ? "US" : "PH";
  const gmailStatus = gmailStatusByRegion[activeGmailRegion];
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runLineItems, setRunLineItems] = useState<Record<string, PayrollLineItem[]>>({});
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  // Bank name/account number shown next to each employee in the Reports tab's
  // expanded run view — read straight from profiles.employee_info (the same
  // JSON blob the Employee Information tab edits), not duplicated anywhere.
  const [employeeInfoByProfileId, setEmployeeInfoByProfileId] = useState<Map<string, EmployeeInfo>>(new Map());

  // Payroll generation period — Finance picks this via the date inputs on
  // the Payroll tab. Seeded once (see fetchData) from the auto "day after
  // the last run's end, through yesterday" default, same range this used
  // to always use before it became editable.
  const [genStart, setGenStart] = useState("");
  const [genEnd, setGenEnd] = useState("");

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
        ptoRes,
        techRatesRes,
      ] = await Promise.all([
        supabase.from("profiles").select("id,display_name,username,role,assigned_branch,off_days,required_check_in,required_check_out,payroll_excluded").neq("role", "SUPERSUPERADMIN"),
        supabase.from("salary_entries").select("profile_id,effective_date,compensation_type,hourly_rate,annual_salary").not("profile_id", "is", null).order("effective_date", { ascending: false }),
        supabase.from("payroll_runs").select("id,period_start,period_end,status,generated_at").order("generated_at", { ascending: false }),
        supabase.from("payroll_line_items").select("payroll_run_id,profile_id,hours_worked,overtime_hours,hourly_rate,regular_pay,overtime_pay,gross_pay,net_pay,currency,extra_pay,notes,paid,paid_at,compensation_type,annual_salary"),
        supabase.from("payroll_audit_log").select("action,employee_name,details,amount,created_at").order("created_at", { ascending: false }).limit(100),
        getCompanyPtoRequests().catch((err) => { console.error("Failed to load PTO requests:", err); return [] as PtoRequestRow[]; }),
        // Best-effort — Tech Payroll just computes $0 for everyone if this fails.
        getTechRepairRates().catch((err) => { console.error("Failed to load tech repair rates:", err); return [] as TechRepairRate[]; }),
      ]);

      for (const res of [empRes, salRes, runsRes, lineRes, auditRes]) {
        if (res.error) throw new Error(res.error.message);
      }
      setPtoRequests(ptoRes);
      setTechRepairRates(techRatesRes);

      const runs = (runsRes.data ?? []) as PayrollRun[];

      // Fetched separately, best-effort — working_hours/meal_minutes
      // (migration 0109) must never be able to break the rest of this
      // dashboard if that migration hasn't been applied yet.
      const empIds = ((empRes.data ?? []) as any[]).map((p) => p.id);
      const workScheduleById = new Map<string, { working_hours: number | null; meal_minutes: number | null }>();
      if (empIds.length > 0) {
        const { data: extraRows, error: extraError } = await supabase
          .from("profiles")
          .select("id,working_hours,meal_minutes")
          .in("id", empIds);
        if (extraError) {
          console.error("Failed to load working_hours/meal_minutes:", extraError.message);
        } else {
          for (const r of extraRows ?? []) workScheduleById.set((r as any).id, r as any);
        }
        getEmployeeInfoByProfileIds(empIds)
          .then(setEmployeeInfoByProfileId)
          .catch((err) => console.error("Failed to load employee bank info:", err));
      }

      setEmployees(((empRes.data ?? []) as any[]).map((p) => {
        const { department, roleLabel } = getRoleDepartmentBreakdown(p.role);
        return {
        id: p.id,
        full_name: p.display_name || p.username || p.id,
        department,
        roleLabel,
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
        workingHours: workScheduleById.get(p.id)?.working_hours ?? null,
        mealMinutes: workScheduleById.get(p.id)?.meal_minutes ?? null,
        payrollExcluded: p.payroll_excluded ?? false,
        };
      }) as SupabaseEmployee[]);
      setSalaryEntries((salRes.data ?? []) as SalaryEntry[]);
      setPayrollRuns(runs);
      setPayrollLineItems((lineRes.data ?? []) as PayrollLineItem[]);
      setAuditLog((auditRes.data ?? []) as PayrollAuditLogRow[]);

      // Seed the generation period once (first load only — don't clobber
      // whatever Finance has already picked on a later refetch). runs is
      // already ordered by generated_at desc, so runs[0] is the most recent
      // run — the default next period picks up the day after it ended.
      setGenStart((prev) => prev || periodBounds(runs[0]?.period_end ?? null).start);
      setGenEnd((prev) => prev || periodBounds(runs[0]?.period_end ?? null).end);
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

  // Reload attendance whenever Finance changes the generation period —
  // everything below (hoursMap, payrollRows, the Payroll tab's totals, and
  // the Overview tab's "Current Period (Live)" preview) derives from this.
  useEffect(() => {
    if (!genStart || !genEnd || genStart > genEnd) {
      setTimecardEntries([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("timecard_entries")
      .select("profile_id,employee_id,work_date,check_in,check_out,meal_start,meal_end,status")
      .gte("work_date", genStart)
      .lte("work_date", genEnd)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load attendance for selected payroll period:", error.message);
          setTimecardEntries([]);
        } else {
          setTimecardEntries((data ?? []) as TimecardEntry[]);
        }
      });
    return () => { cancelled = true; };
  }, [genStart, genEnd]);

  // Tech Payroll's completed-repair counts for the same picked period.
  useEffect(() => {
    if (!genStart || !genEnd || genStart > genEnd) {
      setTechRepairCounts([]);
      return;
    }
    let cancelled = false;
    getTechCompletedRepairCounts(genStart, genEnd)
      .then((counts) => { if (!cancelled) setTechRepairCounts(counts); })
      .catch((err) => {
        console.error("Failed to load tech completed-repair counts:", err);
        if (!cancelled) setTechRepairCounts([]);
      });
    return () => { cancelled = true; };
  }, [genStart, genEnd]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  // Latest salary entry per employee (salaryEntries is already ordered by
  // effective_date desc, so the first hit per profile is the current one).
  const latestCompMap = new Map<string, SalaryEntry>();
  for (const se of salaryEntries) {
    if (!latestCompMap.has(se.profile_id)) {
      latestCompMap.set(se.profile_id, se);
    }
  }

  // Hours worked per employee in current period. Computed from real
  // check_in/check_out punches (see REGULAR_HOURS_PER_DAY comment above).
  const hoursMap = computeHoursMap(timecardEntries, employees, ptoRequests, genStart, genEnd);

  // Technicians are paid per completed repair ticket (Tech Payroll) instead
  // of hourly-or-fixed — role === TECHNICIAN only (TECHNICIAN_MANAGER and
  // everyone else stays on the Office Payroll calculation below).
  const isTechRole = (emp: SupabaseEmployee) => normalizeRole(emp.role) === "TECHNICIAN";

  // Rate lookup: an exact (repair_type, branch) match wins; otherwise fall
  // back to that repair_type's "All Branches" rate; otherwise the branch's
  // own "Default Amount" rate; otherwise "Default Amount, All Branches";
  // otherwise $0 (no rate configured yet — see TechPayrollSetup.tsx).
  const techRateFor = (repairType: string, branch: string): number => {
    const exact = techRepairRates.find((r) => r.repairType === repairType && r.branch === branch);
    if (exact) return exact.amount;
    const anyBranch = techRepairRates.find((r) => r.repairType === repairType && !r.branch);
    if (anyBranch) return anyBranch.amount;
    const defaultForBranch = techRepairRates.find((r) => r.repairType === DEFAULT_REPAIR_TYPE && r.branch === branch);
    if (defaultForBranch) return defaultForBranch.amount;
    const defaultAny = techRepairRates.find((r) => r.repairType === DEFAULT_REPAIR_TYPE && !r.branch);
    return defaultAny ? defaultAny.amount : 0;
  };

  // visits.technician is free text (no FK to profiles) — matched by name,
  // same convention as every other free-text technician match in the app
  // (e.g. resolveTeamLeadOrManager's manager_name match).
  const employeeByName = new Map(employees.map((e) => [e.full_name.trim().toLowerCase(), e]));
  const techGrossByProfile = new Map<string, { ticketsCompleted: number; grossPay: number }>();
  for (const rc of techRepairCounts) {
    const emp = employeeByName.get(rc.technician.trim().toLowerCase());
    if (!emp) continue;
    const rate = techRateFor(rc.repairType, rc.branch || emp.assigned_branch || "");
    const prev = techGrossByProfile.get(emp.id) ?? { ticketsCompleted: 0, grossPay: 0 };
    techGrossByProfile.set(emp.id, {
      ticketsCompleted: prev.ticketsCompleted + rc.count,
      grossPay: prev.grossPay + rate * rc.count,
    });
  }

  // Build payroll rows. salary_entries.hourly_rate is always entered as a
  // plain USD figure (the shared "Add Rate Change" form labels it "$/hr"
  // with no currency conversion of its own — see EmployeePayrollDetailModal.tsx),
  // regardless of the employee's assigned country, so hourlyRateUSD/grossPayUSD
  // are just hourlyRate/grossPay verbatim — no PHP division here. (EXCHANGE_RATE
  // is still used for payroll_line_items rows recorded with currency: "PHP"
  // before this was standardized — see toggleRun()/Reports tab below.)
  //
  // Fixed-salary employees (migration 0118) are paid a flat per-cutoff
  // amount (annual / 24) regardless of hours actually worked or overtime —
  // hoursWorked/overtimeHours/dutyHours are still computed for attendance
  // visibility, they just don't feed into grossPay for these employees.
  // Technicians (Tech Payroll) take priority over both: hoursWorked/
  // overtimeHours/hourlyRate/dutyHours stay populated from real
  // punches/schedule (informational, shown for reference) but grossPay is
  // their piece-rate total instead.
  const payrollRows: EmployeePayrollRow[] = employees.map((emp) => {
    const comp = latestCompMap.get(emp.id);
    const isFixed = comp?.compensation_type === "fixed";
    const hourlyRate = isFixed ? 0 : comp?.hourly_rate ?? emp.hourly_rate ?? 0;
    const annualSalary = isFixed ? comp?.annual_salary ?? 0 : null;
    const hours = hoursMap.get(emp.id) ?? { regular: 0, overtime: 0 };
    const tech = isTechRole(emp) ? techGrossByProfile.get(emp.id) : undefined;
    const grossPay = tech
      ? tech.grossPay
      : isFixed && annualSalary
        ? perCutoffSalary(annualSalary)
        : hours.regular * hourlyRate + hours.overtime * hourlyRate * 1.5;
    return {
      employee: emp,
      compensationType: isFixed ? "fixed" : "hourly",
      hourlyRate,
      hourlyRateUSD: hourlyRate,
      annualSalary,
      hoursWorked: hours.regular,
      overtimeHours: hours.overtime,
      ticketsCompleted: tech?.ticketsCompleted ?? 0,
      dutyHours: computeDutyHours(emp, genStart, genEnd),
      grossPay,
      grossPayUSD: grossPay,
    };
  });

  const usRows = payrollRows.filter((r) => r.employee.country === "US");
  const phRows = payrollRows.filter((r) => r.employee.country === "PH");
  const usOfficeRows = usRows.filter((r) => !isTechRole(r.employee));
  const usTechRows = usRows.filter((r) => isTechRole(r.employee));

  // Employees who never draw a salary through this system (e.g. the owner)
  // — kept out of generation, the missing-clock-out gate, and the export,
  // but still shown (with an unchecked box) in the table above.
  const includedPayrollRows = payrollRows.filter((r) => !r.employee.payrollExcluded);
  const includedUsRows = usRows.filter((r) => !r.employee.payrollExcluded);
  const includedPhRows = phRows.filter((r) => !r.employee.payrollExcluded);

  // Generate Payroll only ever acts on whichever nation tab (US/PH Payroll
  // toggle) is currently selected — clicking it while on PH Payroll must
  // never touch US employees, and vice versa. nationPayrollRows (unfiltered
  // by exclusion) is used to scope which existing line items get cleared
  // on a regenerate; nationIncludedPayrollRows is what actually gets
  // (re)inserted.
  const nationPayrollRows = selectedCurrency === "USD" ? usRows : phRows;
  const nationIncludedPayrollRows = selectedCurrency === "USD" ? includedUsRows : includedPhRows;

  // grossPayUSD is already plain USD (see payrollRows above) — no conversion here.
  const totalUSPayroll = usRows.reduce((s, r) => s + r.grossPayUSD, 0);
  const totalPHPayroll = phRows.reduce((s, r) => s + r.grossPayUSD, 0);
  const totalPayrollUSD = totalUSPayroll + totalPHPayroll;
  const avgPayPerEmployee =
    payrollRows.length > 0 ? totalPayrollUSD / payrollRows.length : 0;

  // Whether the picked genStart/genEnd exactly match an already-generated
  // run that already has line items for the currently selected nation — if
  // so, clicking Generate recomputes that nation's line items in place
  // instead of creating a new run (see generatePayroll's existingRun
  // check). Nation-aware so generating PH for the first time doesn't show
  // "Regenerate" just because US was already generated for this period.
  const matchesExistingRun = (() => {
    const run = payrollRuns.find((r) => r.period_start === genStart && r.period_end === genEnd);
    if (!run) return false;
    const nationIds = new Set(nationPayrollRows.map((r) => r.employee.id));
    return payrollLineItems.some((li) => li.payroll_run_id === run.id && nationIds.has(li.profile_id));
  })();

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
        periodLabel: genStart && genEnd ? `${genStart} – ${genEnd} · USD` : "USD",
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
  // US is split into Office/Tech (same TECHNICIAN-role split as US
  // Payroll's Office/Tech toggle) since that's where the piece-rate Tech
  // Payroll employees are. PH stays one combined bar.
  const monthlyBarData: MonthlyBarData[] = (() => {
    const map = new Map<string, { usOfficePayroll: number; usTechPayroll: number; phPayroll: number }>();
    for (const run of payrollRuns) {
      const label = run.period_start
        ? new Date(run.period_start).toLocaleString("en-US", { month: "short", year: "2-digit" })
        : run.id;
      const items = payrollLineItems.filter((li) => li.payroll_run_id === run.id);
      const usOffice = items
        .filter((li) => {
          const emp = employees.find((e) => e.id === li.profile_id);
          return emp?.country === "US" && !(emp && isTechRole(emp));
        })
        .reduce((s, li) => s + toUSD(li), 0);
      const usTech = items
        .filter((li) => {
          const emp = employees.find((e) => e.id === li.profile_id);
          return emp?.country === "US" && !!emp && isTechRole(emp);
        })
        .reduce((s, li) => s + toUSD(li), 0);
      const ph = items
        .filter((li) => {
          const emp = employees.find((e) => e.id === li.profile_id);
          return emp?.country === "PH";
        })
        .reduce((s, li) => s + toUSD(li), 0);
      const prev = map.get(label) ?? { usOfficePayroll: 0, usTechPayroll: 0, phPayroll: 0 };
      map.set(label, {
        usOfficePayroll: prev.usOfficePayroll + usOffice,
        usTechPayroll: prev.usTechPayroll + usTech,
        phPayroll: prev.phPayroll + ph,
      });
    }
    return Array.from(map.entries()).map(([month, v]) => ({
      month,
      usOfficePayroll: Math.round(v.usOfficePayroll),
      usTechPayroll: Math.round(v.usTechPayroll),
      phPayroll: Math.round(v.phPayroll),
      total: Math.round(v.usOfficePayroll + v.usTechPayroll + v.phPayroll),
    }));
  })();

  // ── Toggle "include in payroll" per employee ─────────────────────────────────
  // Persisted on the profile (not just this session) since it's a standing
  // fact about the person (e.g. the owner never draws a salary here), not a
  // one-off pick for a single run.
  const handleTogglePayrollExcluded = async (employeeId: string, excluded: boolean) => {
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, payrollExcluded: excluded } : e)));
    const { error } = await supabase.from("profiles").update({ payroll_excluded: excluded }).eq("id", employeeId);
    if (error) {
      setError(`Failed to update payroll inclusion: ${error.message}`);
      setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, payrollExcluded: !excluded } : e)));
    }
  };

  // ── Generate Payroll ─────────────────────────────────────────────────────────
  // Finance picks the period via genStart/genEnd (the date inputs on the
  // Payroll tab) rather than an auto-computed range. If the picked dates
  // exactly match an existing run, this recomputes and replaces that run's
  // line items in place (what "Regenerate" used to do) instead of creating
  // a duplicate — so a rate fix or corrected timecard can be re-applied to
  // the same payslip just by re-picking its dates and generating again.
  const generatePayroll = async () => {
    if (nationIncludedPayrollRows.length === 0) return;
    if (!genStart || !genEnd || genStart > genEnd) {
      setError("Pick a valid start and end date before generating payroll.");
      return;
    }
    setGenerating(true);
    try {
      // Scoped to whichever nation tab is selected — the other nation's
      // employees (and excluded employees' own missing clock-outs) never
      // factor into this generate action at all.
      const nationIncludedIds = new Set(nationIncludedPayrollRows.map((r) => r.employee.id));
      const nationTimecardEntries = timecardEntries.filter((tc) => nationIncludedIds.has(tc.profile_id || tc.employee_id || ""));
      const missingTimeouts = findMissingTimeouts(nationTimecardEntries, employees);
      if (missingTimeouts.length > 0) {
        const preview = missingTimeouts.slice(0, 5).join(", ");
        const more = missingTimeouts.length > 5 ? `, and ${missingTimeouts.length - 5} more` : "";
        setError(`Cannot generate payroll for ${genStart} – ${genEnd}: ${missingTimeouts.length} attendance record(s) are missing a clock-out — ${preview}${more}. Fix these timecards, then try again.`);
        setGenerating(false);
        return;
      }

      const existingRun = payrollRuns.find((r) => r.period_start === genStart && r.period_end === genEnd);
      // Whether THIS nation already has line items in that run — distinct
      // from existingRun itself, since a run can already exist for the
      // period from the other nation's tab while this one is still a
      // first-time generate (see matchesExistingRun above).
      const nationHasExistingLineItems = existingRun
        ? payrollLineItems.some((li) => li.payroll_run_id === existingRun.id && nationPayrollRows.some((r) => r.employee.id === li.profile_id))
        : false;
      // Overlapping ranges across different runs are allowed for now — no
      // block here even though that means the same day's hours could get
      // paid out under two separate runs if Finance picks overlapping dates.

      let runId: string;
      if (existingRun) {
        runId = existingRun.id;
        // Only this nation's line items get cleared — the other nation's
        // (generated separately, from its own tab) are left untouched. Uses
        // every employee in this nation, not just the currently-included
        // ones, so someone excluded after their last payslip was generated
        // has that stale line item cleaned up instead of left orphaned.
        const nationProfileIds = nationPayrollRows.map((r) => r.employee.id);
        const { error: deleteErr } = await supabase
          .from("payroll_line_items")
          .delete()
          .eq("payroll_run_id", runId)
          .in("profile_id", nationProfileIds);
        if (deleteErr) throw new Error(deleteErr.message);
        await supabase.from("payroll_runs").update({ generated_at: new Date().toISOString() }).eq("id", runId);
      } else {
        const { data: runData, error: runErr } = await supabase
          .from("payroll_runs")
          .insert({
            period_start: genStart,
            period_end: genEnd,
            status: "generated",
            generated_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (runErr) throw new Error(runErr.message);
        runId = (runData as { id: string }).id;
      }

      // Build line items — always USD (hourlyRateUSD/grossPayUSD are
      // already exchange-rate-converted for PH rows), so every run this
      // dashboard generates reads in one currency, no ₱ anywhere. Only the
      // currently selected nation, and only its included (non-excluded)
      // employees, ever get a line item here.
      //
      // Fixed-salary employees have no regular/overtime split — their whole
      // per-cutoff amount (grossPayUSD) goes in as regular_pay, with 0
      // overtime, matching this session's "no overtime for fixed salary"
      // decision.
      const lineItems = nationIncludedPayrollRows.map((r) => ({
        payroll_run_id: runId,
        profile_id: r.employee.id,
        hours_worked: r.hoursWorked,
        overtime_hours: r.overtimeHours,
        hourly_rate: r.hourlyRateUSD,
        regular_pay: r.compensationType === "fixed" ? r.grossPayUSD : r.hoursWorked * r.hourlyRateUSD,
        overtime_pay: r.compensationType === "fixed" ? 0 : r.overtimeHours * r.hourlyRateUSD * 1.5,
        gross_pay: r.grossPayUSD,
        net_pay: r.grossPayUSD, // simplified — no deductions model
        currency: "USD",
        compensation_type: r.compensationType,
        annual_salary: r.compensationType === "fixed" ? r.annualSalary : null,
      }));

      const { error: lineErr } = await supabase.from("payroll_line_items").insert(lineItems);
      if (lineErr) throw new Error(lineErr.message);

      const nationTotalUSD = nationIncludedPayrollRows.reduce((s, r) => s + r.grossPayUSD, 0);
      const nationLabel = selectedCurrency === "USD" ? "US" : "PH";

      // Insert audit log entry
      await supabase.from("payroll_audit_log").insert({
        action: nationHasExistingLineItems ? "edit" : "generate",
        employee_name: "All Employees",
        details: `${nationHasExistingLineItems ? "Regenerated" : "Generated"} ${nationLabel} payroll for ${genStart} – ${genEnd}. ${nationIncludedPayrollRows.length} employees. Total: $${nationTotalUSD.toFixed(2)}`,
        amount: Math.round(nationTotalUSD * 100) / 100,
      });
      void logModuleActivity({
        module: "accounting",
        actorName: displayName || email || "Admin",
        action: existingRun ? "payroll_run_regenerated" : "payroll_run_generated",
        targetLabel: `${genStart} – ${genEnd}`,
        details: { employees: payrollRows.length, totalUSD: Math.round(totalPayrollUSD * 100) / 100 },
      });

      // Notify every employee who actually got paid something in this run —
      // skip $0 rows (e.g. no rate set yet) since there's nothing to tell them.
      await Promise.all(
        nationIncludedPayrollRows
          .filter((r) => r.grossPayUSD > 0)
          .map((r) =>
            createNotification({
              recipientId: r.employee.id,
              senderId: myProfileId,
              senderName: "Payroll",
              body: nationHasExistingLineItems ? "🔄 Payslip Updated — View Payslip" : "💰 Payslip is Ready — View Payslip",
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

  // ── Export: Payroll by Nation & Department (Reports tab) ───────────────────
  // One sheet per nation (US, PH), each grouped by department with subtotals —
  // covers the same current period (genStart–genEnd) shown live on the
  // Payroll tab, just split the way Finance needs it for reconciliation.
  const exportNationDepartmentReport = () => {
    const workbook = XLSX.utils.book_new();
    for (const [label, rows] of [["US", includedUsRows], ["PH", includedPhRows]] as const) {
      const sheetData: (string | number)[][] = [
        [`Payroll by Department — ${label}`],
        [`Period: ${genStart} – ${genEnd}`],
        [`Generated: ${new Date().toLocaleString()}`],
        [],
        ...buildDepartmentSheetRows(rows),
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, worksheet, label);
    }
    XLSX.writeFile(workbook, `payroll-by-nation-department_${genStart}_to_${genEnd}.xlsx`);
  };

  // ── Connect Gmail (for individual payslip test-sends) ────────────────────────
  const loadGmailStatus = useCallback(async (region: GmailRegion) => {
    try {
      const status = await getGmailConnectionStatus(region);
      setGmailStatusByRegion((prev) => ({ ...prev, [region]: status }));
    } catch (err) {
      console.error(`Failed to load ${region} Gmail connection status:`, err);
    }
  }, []);
  useEffect(() => {
    void loadGmailStatus("US");
    void loadGmailStatus("PH");
  }, [loadGmailStatus]);

  // Google redirects back here with ?gmailConnected=1|0&gmailRegion=US|PH
  // after the consent screen (see gmailBridge.ts) — show the result once,
  // then strip the params so refreshing the page doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("gmailConnected");
    if (result === null) return;
    const region = parseGmailRegionParam(params.get("gmailRegion"));
    setError(result === "1" ? null : `Couldn't connect ${region} Gmail — please try again.`);
    if (result === "1") {
      void loadGmailStatus(region);
      void logModuleActivity({
        module: "accounting",
        actorName: displayName || email || "Admin",
        action: "gmail_connected",
        targetLabel: `${region} Payroll`,
      });
    }
    params.delete("gmailConnected");
    params.delete("gmailRegion");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectGmail = async (region: GmailRegion) => {
    setConnectingGmailRegion(region);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
      if (!idToken) { setError("You need to be logged in to connect Gmail."); return; }
      // A real navigation (not fetch) — Google's consent screen has to run in the top-level window.
      window.location.href = `/api/gmail?action=connect&region=${region}&idToken=${encodeURIComponent(idToken)}`;
    } finally {
      setConnectingGmailRegion(null);
    }
  };

  const handleDisconnectGmail = async (region: GmailRegion) => {
    if (!confirm(`Disconnect ${region} Gmail? Payslip emails for ${region} employees won't be sendable until it's reconnected.`)) return;
    setDisconnectingGmailRegion(region);
    try {
      await disconnectGmail(region);
      await loadGmailStatus(region);
      void logModuleActivity({
        module: "accounting",
        actorName: displayName || email || "Admin",
        action: "gmail_disconnected",
        targetLabel: `${region} Payroll`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to disconnect ${region} Gmail.`);
    } finally {
      setDisconnectingGmailRegion(null);
    }
  };

  // Individual send only, deliberately no "send all" yet — see gmailBridge.ts's header comment.
  // Builds the same "PAYSLIP" document Employee Self-Service shows/downloads
  // (see payslipTemplate.ts) and renders it to a real PDF client-side —
  // captureHtmlToPdfBlob needs a real browser DOM/canvas, which the Gmail
  // server bridge's runtime doesn't have, so the PDF is built here and
  // handed to the server as base64 to attach as-is.
  const buildPayslipPdfBase64 = async (row: EmployeePayrollRow): Promise<string> => {
    // Fixed-salary employees are paid a flat per-cutoff amount, not an
    // hourly breakdown — an hours × $0/hr daily table would read as "you
    // earned $0 today" despite the correct total below, so this skips the
    // daily rows entirely for them (the template already shows "No daily
    // attendance recorded" when dailyRows is empty).
    const dailyRows: PayslipDailyRow[] = row.compensationType === "fixed" ? [] : await (async () => {
      const attendanceRows = await getAttendanceForRange(row.employee.id, genStart, genEnd, {});
      const rate = row.hourlyRateUSD;
      return attendanceRows
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
    })();
    const payslipData: EmployeePayslipData = {
      name: row.employee.full_name,
      department: row.employee.department || "",
      period: `${genStart} to ${genEnd}`,
      generatedDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      dailyRows,
      grossPay: row.grossPayUSD,
      // No deductions concept in this live-preview flow (unlike a finalized
      // payroll_line_items row, which has its own stored net_pay) — gross
      // and net are the same until a real run tracks that separately.
      netPay: row.grossPayUSD,
    };
    const pdfBlob = await captureHtmlToPdfBlob(renderPayslipBodyHtml(payslipData), PAYSLIP_STYLES);
    return blobToBase64(pdfBlob);
  };

  const handleSendPayslip = async (row: EmployeePayrollRow) => {
    if (!genStart || !genEnd) return;
    if (!confirm(`Send a test payslip email to ${row.employee.full_name} for ${genStart} to ${genEnd}?`)) return;
    setSendingPayslipId(row.employee.id);
    try {
      const pdfBase64 = await buildPayslipPdfBase64(row);
      const { sentTo } = await sendPayslipEmail({
        profileId: row.employee.id,
        periodStart: genStart,
        periodEnd: genEnd,
        hoursWorked: row.hoursWorked,
        overtimeHours: row.overtimeHours,
        hourlyRate: row.hourlyRateUSD,
        grossPay: row.grossPayUSD,
        pdfBase64,
      });
      alert(`Payslip sent to ${sentTo}.`);
      void logModuleActivity({
        module: "accounting",
        actorName: displayName || email || "Admin",
        action: "payslip_sent",
        targetType: "profile",
        targetId: row.employee.id,
        targetLabel: `${row.employee.full_name} (${genStart} – ${genEnd})`,
      });
    } catch (err) {
      alert(`Failed to send payslip: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSendingPayslipId(null);
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
        .select("payroll_run_id,profile_id,hours_worked,overtime_hours,hourly_rate,regular_pay,overtime_pay,gross_pay,net_pay,currency,extra_pay,notes,paid,paid_at,compensation_type,annual_salary")
        .eq("payroll_run_id", runId);
      if (e) throw new Error(e.message);
      setRunLineItems((prev) => ({ ...prev, [runId]: (data ?? []) as PayrollLineItem[] }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load line items");
    } finally {
      setLoadingRunId(null);
    }
  };

  // ── Edit Extra Pay / Notes on one employee's line item ──────────────────────
  // Both show up on that employee's payslip (My Payroll tab) — Extra folds
  // into the Grand Total there, Notes is a free-text line from Finance.
  const lineItemEditKey = (runId: string, profileId: string) => `${runId}|${profileId}`;
  const [lineItemEdits, setLineItemEdits] = useState<Record<string, { extraPay: string; notes: string }>>({});
  const [savingLineItemKey, setSavingLineItemKey] = useState<string | null>(null);

  const handleSaveLineItemExtra = async (runId: string, profileId: string) => {
    const key = lineItemEditKey(runId, profileId);
    const edit = lineItemEdits[key];
    if (!edit) return;
    const extraPay = Number(edit.extraPay) || 0;
    setSavingLineItemKey(key);
    try {
      await updatePayrollLineItemExtra(runId, profileId, { extraPay, notes: edit.notes });
      setRunLineItems((prev) => ({
        ...prev,
        [runId]: (prev[runId] ?? []).map((li) =>
          li.profile_id === profileId ? { ...li, extra_pay: extraPay, notes: edit.notes || null } : li
        ),
      }));
      setLineItemEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Extra/Notes");
    } finally {
      setSavingLineItemKey(null);
    }
  };

  // Finance checks this off once the person has actually been paid —
  // separate from the run's own draft/generated status, since payouts
  // within a run are often staggered rather than all happening at once.
  const [togglingPaidKey, setTogglingPaidKey] = useState<string | null>(null);
  const handleToggleLineItemPaid = async (runId: string, profileId: string, nextPaid: boolean, employeeName: string) => {
    // Only the undo direction needs confirming — checking it off in the
    // first place is the routine action, unchecking it is the one that
    // could undo a real record of payment by accident.
    if (!nextPaid && !confirm(`Unmark ${employeeName} as paid? Only do this if they were checked off by mistake.`)) {
      return;
    }
    const key = lineItemEditKey(runId, profileId);
    setTogglingPaidKey(key);
    try {
      await updatePayrollLineItemPaid(runId, profileId, nextPaid);
      setRunLineItems((prev) => ({
        ...prev,
        [runId]: (prev[runId] ?? []).map((li) =>
          li.profile_id === profileId ? { ...li, paid: nextPaid, paid_at: nextPaid ? new Date().toISOString() : null } : li
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update paid status");
    } finally {
      setTogglingPaidKey(null);
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
  const displayRows = selectedCurrency === "USD" ? (payrollView === "tech" ? usTechRows : usOfficeRows) : phRows;
  const isTechView = selectedCurrency === "USD" && payrollView === "tech";
  // checkbox, Name, Department, Role, Gross Pay, Payslip (6) + Branch (US
  // only) + either Tickets Completed (Tech) or Reg/Duty/OT Hours + Rate (Office/PH).
  const payrollColCount = 6 + (selectedCurrency === "USD" ? 1 : 0) + (isTechView ? 1 : 4);

  // Excel-autofilter convention (matches TicketColumnFilter/TicketList): a
  // column's own option list reflects every OTHER active filter, so opening
  // Department still shows every department present among rows that already
  // pass the Role filter and search, and vice versa.
  const matchesRowFilters = (
    row: EmployeePayrollRow,
    opts: { excludeDept?: boolean; excludeRole?: boolean; excludeRegHours?: boolean; excludeRate?: boolean }
  ) => {
    if (!opts.excludeDept && departmentFilter.size > 0 && !departmentFilter.has(row.employee.department || "")) return false;
    if (!opts.excludeRole && roleFilter.size > 0 && !roleFilter.has(row.employee.roleLabel || "")) return false;
    if (!opts.excludeRegHours && regHoursFilter.size > 0 && !regHoursFilter.has(row.hoursWorked.toFixed(1))) return false;
    if (!opts.excludeRate && rateFilter.size > 0 && !rateFilter.has(rateLabel(row))) return false;
    if (employeeSearch && !row.employee.full_name.toLowerCase().includes(employeeSearch.toLowerCase())) return false;
    return true;
  };

  const departmentOptions = Array.from(
    new Set(displayRows.filter((r) => matchesRowFilters(r, { excludeDept: true })).map((r) => r.employee.department || ""))
  );
  const roleOptions = Array.from(
    new Set(displayRows.filter((r) => matchesRowFilters(r, { excludeRole: true })).map((r) => r.employee.roleLabel || ""))
  );
  const regHoursOptions = Array.from(
    new Set(displayRows.filter((r) => matchesRowFilters(r, { excludeRegHours: true })).map((r) => r.hoursWorked.toFixed(1)))
  );
  const rateOptions = Array.from(
    new Set(displayRows.filter((r) => matchesRowFilters(r, { excludeRate: true })).map(rateLabel))
  );

  const visibleRowsUnsorted = displayRows.filter((row) => matchesRowFilters(row, {}));
  const visibleRows = nameSort
    ? [...visibleRowsUnsorted].sort((a, b) =>
        nameSort === "asc"
          ? a.employee.full_name.localeCompare(b.employee.full_name)
          : b.employee.full_name.localeCompare(a.employee.full_name)
      )
    : visibleRowsUnsorted;
  const visibleTotalUSD = visibleRows.reduce((s, r) => s + r.grossPayUSD, 0);

  // Grouped by department, both the department groups and each group's
  // employees sorted alphabetically, for the table's department-separated view.
  const visibleRowsByDepartment = (() => {
    const groups = new Map<string, EmployeePayrollRow[]>();
    for (const row of visibleRows) {
      const dept = row.employee.department || "—";
      if (!groups.has(dept)) groups.set(dept, []);
      groups.get(dept)!.push(row);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([department, rows]) => ({
        department,
        rows: [...rows].sort((a, b) => a.employee.full_name.localeCompare(b.employee.full_name)),
      }));
  })();

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
                <ResponsiveContainer width="100%" height={300} debounce={200}>
                  <BarChart data={monthlyBarData}>
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" tickFormatter={(v) => `$${(v as number / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }}
                      formatter={(value) => [`$${(value as number).toLocaleString()}`, undefined]}
                    />
                    <Legend />
                    <Bar dataKey="usOfficePayroll" name="US Office" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="usTechPayroll" name="US Tech" fill="#f472b6" radius={[4, 4, 0, 0]} />
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
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 uppercase tracking-wide">Period</label>
                <input
                  type="date"
                  value={genStart}
                  max={genEnd || undefined}
                  onChange={(e) => setGenStart(e.target.value)}
                  className="bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
                <span className="text-slate-500 text-sm">to</span>
                <input
                  type="date"
                  value={genEnd}
                  min={genStart || undefined}
                  onChange={(e) => setGenEnd(e.target.value)}
                  className="bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={generatePayroll}
                disabled={generating || nationIncludedPayrollRows.length === 0 || !genStart || !genEnd || genStart > genEnd}
                title={matchesExistingRun ? "A payroll run already exists for these dates — this will recompute and replace it" : undefined}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded font-semibold transition flex items-center gap-2"
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : matchesExistingRun ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <DollarSign className="h-4 w-4" />
                )}
                {matchesExistingRun ? "Regenerate Payroll" : "Generate Payroll"}
              </button>
              <button
                type="button"
                onClick={() => setShowAuditLog(!showAuditLog)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-semibold transition flex items-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                Audit Log ({auditLog.length})
              </button>
              <ActivityLogPanel module="accounting" title="Accounting Activity Log" />
              {/* Currency toggle */}
              <div className="ml-auto flex gap-2">
                {(["USD", "PHP"] as const).map((cur) => (
                  <button
                    key={cur}
                    onClick={() => {
                      setSelectedCurrency(cur);
                      setDepartmentFilter(new Set());
                      setRoleFilter(new Set());
                      setRegHoursFilter(new Set());
                      setRateFilter(new Set());
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

            {/* Office/Tech sub-toggle — US Payroll only. Technicians are
                paid per completed repair ticket (Tech Payroll) instead of
                hourly (Office Payroll, everyone else). */}
            {selectedCurrency === "USD" && (
              <div className="flex gap-2">
                {(["office", "tech"] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => {
                      setPayrollView(view);
                      setDepartmentFilter(new Set());
                      setRoleFilter(new Set());
                      setRegHoursFilter(new Set());
                      setRateFilter(new Set());
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
                      payrollView === view
                        ? "bg-blue-500/30 text-white border border-blue-400/40"
                        : "bg-slate-800/50 text-slate-400 border border-white/10 hover:text-white"
                    }`}
                  >
                    {view === "office" ? "Office Payroll" : "Tech Payroll"}
                  </button>
                ))}
              </div>
            )}

            {/* Connect Gmail — one connection per region; payslip sends
                automatically use whichever region the recipient employee
                belongs to, regardless of which tab is currently active. */}
            <div className="flex flex-wrap gap-3">
              {(["US", "PH"] as const).map((region) => {
                const status = gmailStatusByRegion[region];
                return (
                  <div key={region} className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-sm">
                    <Mail className={`h-4 w-4 shrink-0 ${status?.connected ? "text-green-400" : "text-slate-500"}`} />
                    <span className="text-xs text-slate-400 uppercase font-semibold">{region} Payroll:</span>
                    {status?.connected ? (
                      <>
                        <span className="text-slate-200" title={status.connectedByName ? `Connected by ${status.connectedByName}` : undefined}>
                          {status.connectedAccountName || "Unknown"}
                          {status.connectedEmail && <span className="text-slate-500"> ({status.connectedEmail})</span>}
                        </span>
                        {canConnectGmail && (
                          <button
                            type="button"
                            onClick={() => handleDisconnectGmail(region)}
                            disabled={disconnectingGmailRegion === region}
                            className="text-red-300 hover:text-red-200 disabled:opacity-40 disabled:no-underline text-xs underline ml-1"
                          >
                            {disconnectingGmailRegion === region ? "Disconnecting…" : "Disconnect"}
                          </button>
                        )}
                      </>
                    ) : canConnectGmail ? (
                      <button
                        type="button"
                        onClick={() => handleConnectGmail(region)}
                        disabled={connectingGmailRegion === region}
                        className="text-blue-300 hover:text-blue-200 text-xs underline disabled:opacity-50"
                      >
                        {connectingGmailRegion === region ? "Connecting…" : "Connect Gmail"}
                      </button>
                    ) : (
                      <span className="text-slate-500 text-xs">Not connected — ask an Admin</span>
                    )}
                  </div>
                );
              })}
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
                <p className="text-xs text-slate-400 mb-1">{isTechView ? "Tickets Completed" : "Overtime Pay"}</p>
                <p className="text-2xl font-bold text-orange-300">
                  {isTechView
                    ? displayRows.reduce((s, r) => s + r.ticketsCompleted, 0)
                    : fmt(displayRows.reduce((s, r) => s + r.overtimeHours * r.hourlyRateUSD * 1.5, 0))}
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
                  {selectedCurrency === "USD" ? (payrollView === "tech" ? "Tech" : "Office") : "PH"} Employee Payroll — Current Period
                </span>
                <span className="text-xs text-slate-400">{visibleRows.length} employees</span>
              </div>
              <div className="px-4 py-3 border-b border-white/10">
                <label className="block text-[10px] text-slate-400 uppercase mb-1">Search</label>
                <input
                  type="text"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder="Search employee..."
                  className="w-full max-w-sm bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase w-10">
                      <input
                        type="checkbox"
                        title="Include/exclude all visible employees from payroll generation"
                        checked={visibleRows.length > 0 && visibleRows.every((r) => !r.employee.payrollExcluded)}
                        onChange={() => {
                          const nextIncluded = !(visibleRows.length > 0 && visibleRows.every((r) => !r.employee.payrollExcluded));
                          visibleRows.forEach((r) => {
                            if (r.employee.payrollExcluded === nextIncluded) {
                              handleTogglePayrollExcluded(r.employee.id, !nextIncluded);
                            }
                          });
                        }}
                        className="h-4 w-4 accent-blue-600 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">
                      <button
                        type="button"
                        onClick={toggleNameSort}
                        title="Sort by name"
                        className="flex items-center gap-1 hover:text-white transition"
                      >
                        Name
                        <span className="text-[10px]">{nameSort === "asc" ? "▲" : nameSort === "desc" ? "▼" : "⇅"}</span>
                      </button>
                    </th>
                    {selectedCurrency === "USD" && (
                      <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Branch</th>
                    )}
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">
                      <span className="inline-flex items-center">
                        Department
                        <TicketColumnFilter
                          options={departmentOptions}
                          selected={departmentFilter}
                          onChange={setDepartmentFilter}
                          label="Filter by Department"
                        />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">
                      <span className="inline-flex items-center">
                        Role
                        <TicketColumnFilter
                          options={roleOptions}
                          selected={roleFilter}
                          onChange={setRoleFilter}
                          label="Filter by Role"
                        />
                      </span>
                    </th>
                    {isTechView ? (
                      <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Tickets Completed</th>
                    ) : (
                      <>
                        <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">
                          <span className="inline-flex items-center justify-center">
                            Reg. Hours
                            <TicketColumnFilter
                              options={regHoursOptions}
                              selected={regHoursFilter}
                              onChange={setRegHoursFilter}
                              label="Filter by Reg. Hours"
                            />
                          </span>
                        </th>
                        <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase" title="Expected hours based on the employee's set schedule, for comparison against Reg. Hours">Duty Hours</th>
                        <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">OT Hours</th>
                        <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">
                          <span className="inline-flex items-center justify-center">
                            Rate
                            <TicketColumnFilter
                              options={rateOptions}
                              selected={rateFilter}
                              onChange={setRateFilter}
                              label="Filter by Rate"
                            />
                          </span>
                        </th>
                      </>
                    )}
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Gross Pay</th>
                    <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Payslip</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={payrollColCount} className="px-4 py-8 text-center text-slate-500 text-sm">
                        No {selectedCurrency === "USD" ? (payrollView === "tech" ? "Tech" : "Office") : "PH"} employees found.
                      </td>
                    </tr>
                  ) : (
                    visibleRowsByDepartment.map((group) => (
                      <Fragment key={group.department}>
                        <tr className="bg-white/[0.03]">
                          <td colSpan={payrollColCount} className="px-4 py-2 text-xs font-bold text-blue-300 uppercase tracking-wide">
                            {group.department} <span className="text-slate-500 font-normal normal-case">({group.rows.length})</span>
                          </td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr
                            key={row.employee.id}
                            className={`border-b border-white/5 hover:bg-white/5 ${row.employee.payrollExcluded ? "opacity-50" : ""}`}
                          >
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                title="Include in payroll generation"
                                checked={!row.employee.payrollExcluded}
                                onChange={(e) => handleTogglePayrollExcluded(row.employee.id, !e.target.checked)}
                                className="h-4 w-4 accent-blue-600 cursor-pointer"
                              />
                            </td>
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
                            {selectedCurrency === "USD" && (
                              <td className="px-4 py-3 text-slate-300">
                                {row.employee.assigned_branch || "—"}
                              </td>
                            )}
                            <td className="px-4 py-3 text-slate-300">
                              {row.employee.department || "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {row.employee.roleLabel || "—"}
                            </td>
                            {isTechView ? (
                              <td className="px-4 py-3 text-center text-slate-300">
                                {row.ticketsCompleted}
                              </td>
                            ) : (
                              <>
                                <td className="px-4 py-3 text-center text-slate-300">
                                  {row.hoursWorked.toFixed(1)}
                                </td>
                                <td
                                  className={`px-4 py-3 text-center ${row.hoursWorked < row.dutyHours ? "text-amber-300" : "text-slate-300"}`}
                                  title="Expected hours based on the employee's set schedule"
                                >
                                  {row.dutyHours.toFixed(1)}
                                </td>
                                <td className="px-4 py-3 text-center text-orange-300">
                                  {row.overtimeHours.toFixed(1)}
                                </td>
                                <td className="px-4 py-3 text-center text-slate-300" title={row.compensationType === "fixed" && row.annualSalary ? `$${perCutoffSalary(row.annualSalary).toFixed(2)}/cutoff` : undefined}>
                                  {rateLabel(row)}
                                </td>
                              </>
                            )}
                            <td className="px-4 py-3 text-right font-semibold text-green-300">
                              {fmt(row.grossPayUSD)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleSendPayslip(row)}
                                disabled={sendingPayslipId === row.employee.id || !gmailStatus?.connected}
                                title={gmailStatus?.connected ? "Send a test payslip email to this employee" : "Connect Gmail above first"}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white rounded text-xs font-medium transition"
                              >
                                <Send className="h-3 w-3" />
                                {sendingPayslipId === row.employee.id ? "Sending…" : "Send"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))
                  )}
                </tbody>
                {visibleRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-white/20 bg-white/5">
                      <td colSpan={payrollColCount - 3} className="px-4 py-3 text-sm font-semibold text-slate-300">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-green-300">
                        {fmt(visibleTotalUSD)}
                      </td>
                      <td />
                      <td />
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
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Payroll by Nation &amp; Department</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Exports the current period ({genStart || "—"} – {genEnd || "—"}) as one sheet per nation (US, PH), each grouped by department with subtotals.
                </p>
              </div>
              <button
                type="button"
                onClick={exportNationDepartmentReport}
                disabled={includedPayrollRows.length === 0}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-semibold transition flex items-center gap-2 text-sm shrink-0"
              >
                <Download className="h-4 w-4" />
                Export by Nation &amp; Department
              </button>
            </div>

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
                                      <th className="py-2 text-left text-slate-500 uppercase">Position</th>
                                      <th className="py-2 text-left text-slate-500 uppercase">Department</th>
                                      <th className="py-2 text-left text-slate-500 uppercase">Bank Name</th>
                                      <th className="py-2 text-left text-slate-500 uppercase">Account #</th>
                                      <th className="py-2 text-center text-slate-500 uppercase">Reg Hrs</th>
                                      <th className="py-2 text-center text-slate-500 uppercase">Duty Hrs</th>
                                      <th className="py-2 text-center text-slate-500 uppercase">OT Hrs</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Rate</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Regular Pay</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">OT Pay</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Gross Pay</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Extra</th>
                                      <th className="py-2 text-right text-slate-500 uppercase">Grand Total</th>
                                      <th className="py-2 text-left text-slate-500 uppercase">Notes</th>
                                      <th className="py-2 text-center text-slate-500 uppercase">Paid</th>
                                      <th className="py-2 text-center text-slate-500 uppercase"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {runLineItems[run.id].map((li, idx) => {
                                      const emp = employees.find((e) => e.id === li.profile_id);
                                      // Historical runs generated before this dashboard went dollar-only
                                      // may still be flagged "PHP" — convert those for display so every
                                      // run (old or new) reads in USD.
                                      const divisor = li.currency === "PHP" ? EXCHANGE_RATE : 1;
                                      const grossUSD = li.gross_pay / divisor;
                                      const key = lineItemEditKey(run.id, li.profile_id);
                                      const edit = lineItemEdits[key];
                                      const extraValue = edit?.extraPay ?? String(li.extra_pay || 0);
                                      const notesValue = edit?.notes ?? (li.notes || "");
                                      const grandTotal = grossUSD + (Number(extraValue) || 0);
                                      const bankInfo = employeeInfoByProfileId.get(li.profile_id);
                                      return (
                                        <tr key={idx} className="border-b border-white/5">
                                          <td className="py-2 text-white">
                                            {emp
                                              ? emp.full_name
                                              : li.profile_id}
                                          </td>
                                          <td className="py-2 text-slate-300">{emp?.roleLabel || "—"}</td>
                                          <td className="py-2 text-slate-300">{emp?.department || "—"}</td>
                                          <td className="py-2 text-slate-300">{bankInfo?.bankName || "—"}</td>
                                          <td className="py-2 text-slate-300">{bankInfo?.accountNumber || "—"}</td>
                                          <td className="py-2 text-center text-slate-300">{li.hours_worked?.toFixed(1)}</td>
                                          <td className="py-2 text-center text-slate-400">
                                            {computeDutyHours(emp, run.period_start, run.period_end).toFixed(1)}
                                          </td>
                                          <td className="py-2 text-center text-orange-300">{li.overtime_hours?.toFixed(1)}</td>
                                          <td className="py-2 text-right text-slate-300">
                                            {li.compensation_type === "fixed" && li.annual_salary
                                              ? `Fixed $${li.annual_salary.toLocaleString()}/yr`
                                              : `$${(li.hourly_rate / divisor).toFixed(2)}`}
                                          </td>
                                          <td className="py-2 text-right text-slate-300">
                                            ${(li.regular_pay / divisor).toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right text-orange-300">
                                            ${(li.overtime_pay / divisor).toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right font-semibold text-green-300">
                                            ${grossUSD.toFixed(2)}
                                          </td>
                                          <td className="py-2 text-right">
                                            <input
                                              type="number"
                                              step="0.01"
                                              value={extraValue}
                                              onChange={(e) =>
                                                setLineItemEdits((prev) => ({
                                                  ...prev,
                                                  [key]: { extraPay: e.target.value, notes: notesValue },
                                                }))
                                              }
                                              className="w-20 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-right text-slate-100 focus:outline-none focus:border-blue-500"
                                            />
                                          </td>
                                          <td className="py-2 text-right font-semibold text-blue-300">
                                            ${grandTotal.toFixed(2)}
                                          </td>
                                          <td className="py-2 text-left">
                                            <input
                                              type="text"
                                              placeholder="Note for this employee…"
                                              value={notesValue}
                                              onChange={(e) =>
                                                setLineItemEdits((prev) => ({
                                                  ...prev,
                                                  [key]: { extraPay: extraValue, notes: e.target.value },
                                                }))
                                              }
                                              className="w-40 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-slate-100 focus:outline-none focus:border-blue-500"
                                            />
                                          </td>
                                          <td className="py-2 text-center">
                                            <input
                                              type="checkbox"
                                              checked={li.paid}
                                              disabled={togglingPaidKey === key}
                                              onChange={(e) => handleToggleLineItemPaid(run.id, li.profile_id, e.target.checked, emp?.full_name || li.profile_id)}
                                              title={li.paid && li.paid_at ? `Marked paid ${new Date(li.paid_at).toLocaleString()}` : "Mark as paid"}
                                              className="h-4 w-4 accent-green-600 cursor-pointer"
                                            />
                                          </td>
                                          <td className="py-2 text-center">
                                            {edit && (
                                              <button
                                                type="button"
                                                onClick={() => handleSaveLineItemExtra(run.id, li.profile_id)}
                                                disabled={savingLineItemKey === key}
                                                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-semibold transition"
                                              >
                                                {savingLineItemKey === key ? "Saving…" : "Save"}
                                              </button>
                                            )}
                                          </td>
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
          workingHours={detailEmployee.workingHours}
          mealMinutes={detailEmployee.mealMinutes}
          offDays={detailEmployee.offDays}
          onClose={() => setDetailEmployee(null)}
          onRateChanged={fetchData}
        />
      )}
    </div>
  );
}
