/**
 * Attendance Monitoring Report — read-only summary, distinct from
 * Attendance Monitoring Dashboard (which has interactive PTO/correction
 * approval, warning submission, and messaging this page deliberately
 * omits). Reuses the same real data (getCompanyTimecardEntries,
 * getCompanyPtoRequests, getCompanyTimecardCorrections, getAllAgentNotes)
 * so the numbers always agree with the dashboard, but this page never
 * writes — no approve/reject, no notes, no messages.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Users, UserCheck, UserX, Clock, Loader2, Download } from "lucide-react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, calcWorkedHours, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { toSeconds, ON_TIME_BUFFER_SECONDS, payGraceMinutesFor } from "@/lib/attendanceGrace";

// profiles.department is rarely populated in this data set — role is the
// real department-like dimension (same convention AccountingDashboard.tsx
// already established: department: p.role).
function roleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[normalizeRole(role)] ?? role ?? "Unspecified";
}
import { getCompanyPtoRequests, type PtoRequestRow } from "@/lib/supabase/pto";
import { getCompanyTimecardCorrections, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";

const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

/**
 * Off-day indices follow the same convention timecards.ts uses company-wide
 * (JS Date.getDay(): 0=Sunday..6=Saturday) — mirrors
 * AttendanceMonitoringPage.tsx's computeAlerts so "late/absent" mean the
 * same thing on both pages.
 */
// Exported (along with dayStatus/graceMinutesFor/DayStatus below) so other
// reports can derive their own attendance summary from the same real
// present/late/absent classification instead of re-embedding this whole
// page — e.g. Triage Daily Report's own Attendance panel.
export function isOffDay(dateIso: string, offDays: number[] | null | undefined): boolean {
  if (!offDays || offDays.length === 0) return false;
  const dow = new Date(dateIso + "T00:00:00").getDay();
  return offDays.includes(dow);
}

export interface DayStatus {
  present: boolean;
  late: boolean;
  absent: boolean;
  hours: number;
}

/**
 * Lateness must go through the same clock-precision buffer + pay-grace
 * window Attendance Monitoring's own Daily Attendance Tracker applies
 * (attendanceGrace.ts) — a raw `checkIn > requiredCheckIn` string
 * comparison (the previous version of this function) flags literally any
 * nonzero-second punch as late, disagreeing with the dashboard on nearly
 * every row (e.g. a PH employee clocking in at 08:00:32 against a 08:00
 * schedule reads "Late" here but "✓ OK" there).
 */
export function dayStatus(entry: CompanyTimecardEntry | undefined, requiredCheckIn: string | null, offDay: boolean, graceMinutes: number): DayStatus {
  if (!entry || (!entry.checkIn && !entry.checkOut)) {
    return { present: false, late: false, absent: !offDay, hours: 0 };
  }
  let late = false;
  if (requiredCheckIn && entry.checkIn) {
    const lateSeconds = toSeconds(entry.checkIn) - toSeconds(requiredCheckIn);
    late = lateSeconds > Math.max(ON_TIME_BUFFER_SECONDS, graceMinutes * 60);
  }
  const hours = entry.checkIn && entry.checkOut
    ? calcWorkedHours({ checkIn: entry.checkIn, checkOut: entry.checkOut, mealStart: entry.mealStart, mealEnd: entry.mealEnd, notes: "" })
    : 0;
  return { present: true, late, absent: false, hours };
}

/** Mirrors AttendanceMonitoringPage's own country/role -> grace-minutes resolution exactly, so both pages agree on what counts as "late". */
export function graceMinutesFor(p: ProfileRow): number {
  const country = p.assigned_branch === "Philippines" ? "PH" : "US";
  return payGraceMinutesFor(country, normalizeRole(p.role) === "TECHNICIAN");
}

type DailyStatus = "present" | "late" | "absent" | "day-off";
const STATUS_LABEL: Record<DailyStatus, string> = {
  present: "✓ Present",
  late: "Late",
  absent: "Absent",
  "day-off": "Day Off",
};
const STATUS_CLASS: Record<DailyStatus, string> = {
  present: "bg-green-500/20 text-green-300",
  late: "bg-yellow-500/20 text-yellow-300",
  absent: "bg-red-500/20 text-red-300",
  "day-off": "bg-slate-500/20 text-slate-300",
};

export function ReportAttendanceMonitoring({
  mod,
  sub,
  filterProfile,
  embedded,
  groupBy = "role",
}: {
  mod: ModuleDef;
  sub: SubModuleDef;
  /** Restricts the roster to profiles matching this predicate — e.g. the Triage Dashboard's Technical Support-only Attendance tab. Unset shows every company employee. */
  filterProfile?: (p: ProfileRow) => boolean;
  /** Skips this page's own outer shell (back-link, title, description, min-h-screen wrapper) — set when a parent page (e.g. TriageDashboardPage's Attendance tab) already provides that chrome. */
  embedded?: boolean;
  /**
   * "role" (default) groups the bottom summary table by role label — meant
   * for the system-wide report, where multiple departments are expected.
   * "employee" breaks it down per person by name instead — for a
   * filterProfile-scoped embed like Triage Dashboard's Attendance tab,
   * where filterProfile is a "holds this role, primary OR secondary" check
   * (pile-up semantics, same as everywhere else in this app), so a person
   * could pass filterProfile while their PRIMARY role (and thus their role
   * label) is something else entirely — grouping by role there would show
   * confusing "other department" rows instead of who's actually on the team.
   */
  groupBy?: "role" | "employee";
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(6));
  const [dateTo, setDateTo] = useState(todayIso());
  const [departmentFilter, setDepartmentFilter] = useState("");
  // Which individuals to show in the day-by-day table (groupBy === "employee")
  // — empty means everyone in filteredProfiles. Deliberately doesn't affect
  // the KPI tiles/trend chart above, which stay department-wide.
  const [employeeFilter, setEmployeeFilter] = useState<Set<string>>(new Set());
  const [employeeFilterOpen, setEmployeeFilterOpen] = useState(false);
  const [employeeFilterPos, setEmployeeFilterPos] = useState<{ top: number; left: number } | null>(null);
  const employeeFilterBtnRef = useRef<HTMLButtonElement>(null);
  const employeeFilterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [companyUsers, tcEntries, pto, corr, allNotes] = await Promise.all([
          getCompanyUsers(),
          getCompanyTimecardEntries(dateFrom, dateTo),
          getCompanyPtoRequests(),
          getCompanyTimecardCorrections(),
          getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
        ]);
        if (cancelled) return;
        // Deactivated accounts are hidden by default here, same as Role
        // Management/Accessibility Management/Login Security — an
        // attendance breakdown has nothing actionable to say about someone
        // whose account is disabled.
        const activeUsers = companyUsers.filter((u) => u.is_active !== false);
        setProfiles(filterProfile ? activeUsers.filter(filterProfile) : activeUsers);
        setEntries(tcEntries);
        setPtoRequests(pto);
        setCorrections(corr);
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Attendance Monitoring Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const departmentOptions = useMemo(() => Array.from(new Set(profiles.map((p) => roleLabel(p.role)))).sort(), [profiles]);
  const filteredProfiles = useMemo(() => profiles.filter((p) => !departmentFilter || roleLabel(p.role) === departmentFilter), [profiles, departmentFilter]);

  // Options for the Employee checkbox filter — every profile currently
  // passing the Department filter above, by display name.
  const employeeFilterOptions = useMemo(
    () =>
      filteredProfiles
        .map((p) => ({ id: p.id, name: p.display_name || p.username || p.email || "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filteredProfiles]
  );
  // Drop any selected id that's no longer in range (e.g. Department filter
  // changed) so a stale selection can't silently keep hiding everyone.
  useEffect(() => {
    setEmployeeFilter((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(employeeFilterOptions.map((o) => o.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [employeeFilterOptions]);

  const openEmployeeFilterMenu = () => {
    const rect = employeeFilterBtnRef.current?.getBoundingClientRect();
    if (rect) setEmployeeFilterPos({ top: rect.bottom + 4, left: rect.left });
    setEmployeeFilterOpen(true);
  };
  useEffect(() => {
    if (!employeeFilterOpen) return;
    const close = (e: Event) => {
      if (employeeFilterMenuRef.current && e.target instanceof Node && employeeFilterMenuRef.current.contains(e.target)) return;
      setEmployeeFilterOpen(false);
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [employeeFilterOpen]);
  const toggleEmployeeFilter = (id: string) =>
    setEmployeeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const entriesByProfileDate = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    for (const e of entries) map.set(`${e.profileId}|${e.workDate}`, e);
    return map;
  }, [entries]);

  const dateRange = useMemo(() => {
    const dates: string[] = [];
    let d = new Date(dateFrom + "T00:00:00");
    const end = new Date(dateTo + "T00:00:00");
    while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return dates;
  }, [dateFrom, dateTo]);

  // Role-level summary across the date range — this is a system-wide
  // report, not a per-employee attribution tool (that's what Attendance
  // Monitoring Dashboard's Daily Attendance Tracker is for). One pass per
  // employee over dateRange, aggregated into their role bucket.
  const roleSummary = useMemo(() => {
    const map = new Map<string, { count: number; present: number; absent: number; late: number; hours: number }>();
    for (const p of filteredProfiles) {
      const role = roleLabel(p.role);
      const bucket = map.get(role) ?? { count: 0, present: 0, absent: 0, late: 0, hours: 0 };
      bucket.count += 1;
      const graceMinutes = graceMinutesFor(p);
      for (const d of dateRange) {
        const off = isOffDay(d, p.off_days);
        const st = dayStatus(entriesByProfileDate.get(`${p.id}|${d}`), p.required_check_in, off, graceMinutes);
        if (st.present) { bucket.present++; if (st.late) bucket.late++; bucket.hours += st.hours; }
        else if (st.absent) bucket.absent++;
      }
      map.set(role, bucket);
    }
    return Array.from(map.entries()).map(([role, v]) => ({ role, ...v })).sort((a, b) => b.absent - a.absent || b.late - a.late);
  }, [filteredProfiles, dateRange, entriesByProfileDate]);

  // Day-by-day breakdown, for groupBy === "employee" — one row per
  // (employee, date), Name/Role on the far left same as the aggregate
  // Role Summary's columns, but not collapsed into a period total: this is
  // the same shape as Employee Self-Service's own "Daily Attendance (last
  // 30 days)" table, just covering every employee in filteredProfiles
  // instead of only the signed-in user.
  const dailyEmployeeRows = useMemo(() => {
    const rows: {
      profileId: string;
      name: string;
      role: string;
      date: string;
      clockIn: string;
      clockOut: string;
      requiredCheckIn: string;
      requiredCheckOut: string;
      hours: number;
      status: DailyStatus;
    }[] = [];
    for (const p of filteredProfiles) {
      if (employeeFilter.size > 0 && !employeeFilter.has(p.id)) continue;
      const name = p.display_name || p.username || p.email || "Unknown";
      const role = roleLabel(p.role);
      const graceMinutes = graceMinutesFor(p);
      for (const d of dateRange) {
        const entry = entriesByProfileDate.get(`${p.id}|${d}`);
        const off = isOffDay(d, p.off_days);
        const st = dayStatus(entry, p.required_check_in, off, graceMinutes);
        const status: DailyStatus = st.present ? (st.late ? "late" : "present") : off ? "day-off" : "absent";
        rows.push({
          profileId: p.id, name, role, date: d,
          clockIn: entry?.checkIn || "", clockOut: entry?.checkOut || "",
          requiredCheckIn: p.required_check_in || "", requiredCheckOut: p.required_check_out || "",
          hours: st.hours, status,
        });
      }
    }
    // Grouped by date (most recent first) so scanning down reads "who was
    // in on 8/11, then who was in on 8/10, ..." instead of one person's
    // entire week before jumping to the next person.
    return rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  }, [filteredProfiles, dateRange, entriesByProfileDate, employeeFilter]);

  // Today-scoped KPI tiles (only meaningful when today falls inside the
  // selected range — otherwise these read 0, same as a report for a past
  // period showing no "today").
  const todayInRange = dateRange.includes(todayIso());
  const todayKpi = useMemo(() => {
    if (!todayInRange) return { present: 0, absent: 0, late: 0 };
    let present = 0, absent = 0, late = 0;
    for (const p of filteredProfiles) {
      const off = isOffDay(todayIso(), p.off_days);
      const st = dayStatus(entriesByProfileDate.get(`${p.id}|${todayIso()}`), p.required_check_in, off, graceMinutesFor(p));
      if (st.present) { present++; if (st.late) late++; }
      else if (st.absent) absent++;
    }
    return { present, absent, late };
  }, [todayInRange, filteredProfiles, entriesByProfileDate]);

  // Scoped to filteredProfiles (department filter AND the optional
  // filterProfile restriction) — company-wide PTO/correction counts would be
  // misleading on a department-specific embed like the Triage Dashboard's
  // Attendance tab.
  const visibleProfileIds = useMemo(() => new Set(filteredProfiles.map((p) => p.id)), [filteredProfiles]);
  const ptoPending = ptoRequests.filter((r) => r.status === "pending" && visibleProfileIds.has(r.profileId)).length;
  const correctionsPending = corrections.filter((c) => c.status === "pending" && visibleProfileIds.has(c.profileId)).length;
  const warningsCount = useMemo(() => {
    const profileIds = new Set(filteredProfiles.map((p) => p.id));
    return notes.filter((n) => n.status === "approved" && n.type === "warning" && profileIds.has(n.agentProfileId)).length;
  }, [notes, filteredProfiles]);

  // Daily Present/Absent/Late trend across the selected range — single pass.
  const trendData = useMemo(() => {
    return dateRange.map((d) => {
      let present = 0, absent = 0, late = 0;
      for (const p of filteredProfiles) {
        const off = isOffDay(d, p.off_days);
        const st = dayStatus(entriesByProfileDate.get(`${p.id}|${d}`), p.required_check_in, off, graceMinutesFor(p));
        if (st.present) { present++; if (st.late) late++; }
        else if (st.absent) absent++;
      }
      const [, m, day] = d.split("-");
      return { date: `${Number(m)}/${Number(day)}`, present, absent, late };
    });
  }, [dateRange, filteredProfiles, entriesByProfileDate]);

  const exportToXlsx = () => {
    const sheet: (string | number)[][] = [
      ["Attendance Monitoring Report"],
      [`Period: ${dateFrom} to ${dateTo}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Summary — Today", ],
      ["Metric", "Value"],
      ["Total Employees", filteredProfiles.length],
      ["Present Today", todayKpi.present],
      ["Absent Today", todayKpi.absent],
      ["Late Today", todayKpi.late],
      ["PTO Pending", ptoPending],
      ["Corrections Pending", correctionsPending],
      ["Warnings", warningsCount],
      [],
      ["Daily Trend"],
      ["Date", "Present", "Absent", "Late"],
      ...trendData.map((t) => [t.date, t.present, t.absent, t.late]),
      [],
      ...(groupBy === "employee"
        ? [
            ["Daily Attendance"],
            ["Name", "Role", "Date", "Clock In", "Required In", "Clock Out", "Required Out", "Hours", "Status"],
            ...dailyEmployeeRows.map((r) => [r.name, r.role, r.date, r.clockIn || "—", r.requiredCheckIn || "—", r.clockOut || "—", r.requiredCheckOut || "—", r.hours.toFixed(2), STATUS_LABEL[r.status]]),
          ]
        : [
            ["Role Summary — Full Period"],
            ["Role", "Employees", "Days Present", "Absences", "Lates", "Total Hours"],
            ...roleSummary.map((r) => [r.role, r.count, r.present, r.absent, r.late, r.hours.toFixed(1)]),
          ]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Report");
    XLSX.writeFile(workbook, `attendance-monitoring-report_${dateFrom}_to_${dateTo}.xlsx`);
  };

  const content = (
    <>
      {!embedded && (
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Read-only attendance summary — approve PTO/corrections from the Attendance Monitoring Dashboard.</p>
          </div>
        </div>
      )}

        <div className="panel p-2.5 mb-3"><div className="flex flex-wrap items-end gap-2.5">
          <div className="flex flex-col gap-0.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-xs py-1 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-0.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-xs py-1 px-2 rounded-md" /></div>
          {groupBy !== "employee" && (
            <div className="flex flex-col gap-0.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Department</label>
              <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="glass-input text-xs py-1 px-2 rounded-md">
                <option value="">All Departments</option>
                {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select></div>
          )}
          {groupBy === "employee" && (
            <div className="flex flex-col gap-0.5 relative">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee</label>
              <button
                ref={employeeFilterBtnRef}
                type="button"
                onClick={() => (employeeFilterOpen ? setEmployeeFilterOpen(false) : openEmployeeFilterMenu())}
                className="glass-input text-xs py-1 px-2 rounded-md text-left flex items-center justify-between gap-2 min-w-[9rem]"
              >
                <span className="truncate">
                  {employeeFilter.size === 0
                    ? "All Employees"
                    : employeeFilterOptions.filter((o) => employeeFilter.has(o.id)).map((o) => o.name).join(", ")}
                </span>
              </button>
              {employeeFilterOpen && employeeFilterPos && createPortal(
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setEmployeeFilterOpen(false)} />
                  <div
                    ref={employeeFilterMenuRef}
                    className="fixed z-50 w-64 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl"
                    style={{ top: employeeFilterPos.top, left: employeeFilterPos.left }}
                  >
                    <label className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded border-b border-white/10 hover:bg-white/5 cursor-pointer text-sm font-semibold text-slate-100">
                      <input
                        type="checkbox"
                        checked={employeeFilter.size === 0}
                        onChange={() => setEmployeeFilter(new Set())}
                        className="accent-blue-500"
                      />
                      All Employees
                    </label>
                    {employeeFilterOptions.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1.5">No employees.</p>}
                    {employeeFilterOptions.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm text-slate-200">
                        <input type="checkbox" checked={employeeFilter.has(o.id)} onChange={() => toggleEmployeeFilter(o.id)} className="accent-blue-500" />
                        {o.name}
                      </label>
                    ))}
                  </div>
                </>,
                document.body,
              )}
            </div>
          )}
          <button onClick={exportToXlsx} disabled={loading} className="btn text-xs px-2.5 py-1 mb-0.5 flex items-center gap-1.5 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Download XLSX
          </button>
        </div></div>

        {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-6 mb-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Attendance Monitoring Report…</div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
          {[
            ["Total Employees", filteredProfiles.length, "text-white", Users],
            ["Present Today", todayKpi.present, "text-green-300", UserCheck],
            ["Absent Today", todayKpi.absent, "text-red-300", UserX],
            ["Late Today", todayKpi.late, "text-yellow-300", Clock],
            ["PTO Pending", ptoPending, "text-blue-300", Clock],
            ["Warnings", warningsCount, "text-orange-300", UserX],
          ].map(([label, value, color, Icon]: any) => (
            <div key={label} className="panel p-2 text-center">
              <div className="flex justify-center mb-0.5 text-muted-foreground"><Icon className="h-3.5 w-3.5" /></div>
              <p className={`text-base font-bold ${color}`}>{value}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {groupBy !== "employee" && (
        <div className="panel p-3 mb-3">
          <p className="text-sm font-semibold mb-3">Daily Attendance Trend</p>
          <ResponsiveContainer width="100%" height={220} debounce={200}>
            <BarChart data={trendData} margin={{ left: -10 }}>
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="present" fill="#34d399" radius={[4, 4, 0, 0]} name="Present" />
              <Bar dataKey="late" fill="#facc15" radius={[4, 4, 0, 0]} name="Late" />
              <Bar dataKey="absent" fill="#f87171" radius={[4, 4, 0, 0]} name="Absent" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}

        {groupBy === "employee" ? (
        <div className="panel overflow-x-auto p-0">
          <div className="px-3 py-2 border-b border-white/10 font-semibold text-xs flex justify-between"><span>Daily Attendance</span><span className="text-muted-foreground">{dailyEmployeeRows.length} records</span></div>
          <table className="w-full text-xs"><thead><tr className="border-b border-white/10 bg-white/5">
            {[
              { label: "Name", align: "text-left" },
              { label: "Role", align: "text-left" },
              { label: "Clock In", align: "text-center" },
              { label: "Required In", align: "text-center" },
              { label: "Clock Out", align: "text-center" },
              { label: "Required Out", align: "text-center" },
              { label: "Hours", align: "text-center" },
              { label: "Status", align: "text-center" },
            ].map((h) => (
              <th key={h.label} className={`px-2.5 py-1.5 ${h.align} text-[10px] text-muted-foreground uppercase whitespace-nowrap`}>{h.label}</th>
            ))}
          </tr></thead>
          <tbody>
            {dailyEmployeeRows.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No attendance records found.</td></tr> :
              dailyEmployeeRows.map((r, i) => {
                const showDateBand = i === 0 || dailyEmployeeRows[i - 1].date !== r.date;
                return (
                  <Fragment key={`${r.profileId}|${r.date}`}>
                    {showDateBand && (
                      <tr className="bg-blue-500/10">
                        <td colSpan={8} className="px-2.5 py-1 font-semibold text-blue-300 text-[10px] uppercase tracking-wide">{r.date}</td>
                      </tr>
                    )}
                    <tr className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-2.5 py-1 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="px-2.5 py-1 text-muted-foreground whitespace-nowrap">{r.role}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{r.clockIn || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap text-muted-foreground">{r.requiredCheckIn || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{r.clockOut || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap text-muted-foreground">{r.requiredCheckOut || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{r.hours.toFixed(2)}h</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
          </tbody></table>
        </div>
        ) : (
        <div className="panel overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Role Summary — Full Period</span><span className="text-xs text-muted-foreground">{roleSummary.length} roles</span></div>
          <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">
            {["Role", "Employees", "Days Present", "Absences", "Lates", "Total Hours"].map((h) => (
              <th key={h} className="px-3 py-3 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {roleSummary.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No employees found.</td></tr> :
              roleSummary.map((r, i) => (
                <tr key={r.role} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-3 py-2.5 font-medium">{r.role}</td>
                  <td className="px-3 py-2.5 text-center">{r.count}</td>
                  <td className="px-3 py-2.5 text-center">{r.present}</td>
                  <td className="px-3 py-2.5 text-center">{r.absent > 0 ? <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">{r.absent}</span> : "—"}</td>
                  <td className="px-3 py-2.5 text-center">{r.late > 0 ? <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">{r.late}</span> : "—"}</td>
                  <td className="px-3 py-2.5 text-center">{r.hours.toFixed(1)}</td>
                </tr>
              ))}
          </tbody></table>
        </div>
        )}
        </>
        )}
    </>
  );

  if (embedded) return content;
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">{content}</main>
    </div>
  );
}
