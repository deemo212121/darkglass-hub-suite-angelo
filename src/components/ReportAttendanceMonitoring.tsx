/**
 * Attendance Monitoring Report — read-only summary, distinct from
 * Attendance Monitoring Dashboard (which has interactive PTO/correction
 * approval, warning submission, and messaging this page deliberately
 * omits). Reuses the same real data (getCompanyTimecardEntries,
 * getCompanyPtoRequests, getCompanyTimecardCorrections, getAllAgentNotes)
 * so the numbers always agree with the dashboard, but this page never
 * writes — no approve/reject, no notes, no messages.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Users, UserCheck, UserX, Clock, Loader2, Download } from "lucide-react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, calcWorkedHours, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";

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
function isOffDay(dateIso: string, offDays: number[] | null | undefined): boolean {
  if (!offDays || offDays.length === 0) return false;
  const dow = new Date(dateIso + "T00:00:00").getDay();
  return offDays.includes(dow);
}

interface DayStatus {
  present: boolean;
  late: boolean;
  absent: boolean;
  hours: number;
}

function dayStatus(entry: CompanyTimecardEntry | undefined, requiredCheckIn: string | null, offDay: boolean): DayStatus {
  if (!entry || (!entry.checkIn && !entry.checkOut)) {
    return { present: false, late: false, absent: !offDay, hours: 0 };
  }
  const late = !!(requiredCheckIn && entry.checkIn && entry.checkIn > requiredCheckIn);
  const hours = entry.checkIn && entry.checkOut
    ? calcWorkedHours({ checkIn: entry.checkIn, checkOut: entry.checkOut, mealStart: entry.mealStart, mealEnd: entry.mealEnd, notes: "" })
    : 0;
  return { present: true, late, absent: false, hours };
}

export function ReportAttendanceMonitoring({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
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
        setProfiles(companyUsers);
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
      for (const d of dateRange) {
        const off = isOffDay(d, p.off_days);
        const st = dayStatus(entriesByProfileDate.get(`${p.id}|${d}`), p.required_check_in, off);
        if (st.present) { bucket.present++; if (st.late) bucket.late++; bucket.hours += st.hours; }
        else if (st.absent) bucket.absent++;
      }
      map.set(role, bucket);
    }
    return Array.from(map.entries()).map(([role, v]) => ({ role, ...v })).sort((a, b) => b.absent - a.absent || b.late - a.late);
  }, [filteredProfiles, dateRange, entriesByProfileDate]);

  // Today-scoped KPI tiles (only meaningful when today falls inside the
  // selected range — otherwise these read 0, same as a report for a past
  // period showing no "today").
  const todayInRange = dateRange.includes(todayIso());
  const todayKpi = useMemo(() => {
    if (!todayInRange) return { present: 0, absent: 0, late: 0 };
    let present = 0, absent = 0, late = 0;
    for (const p of filteredProfiles) {
      const off = isOffDay(todayIso(), p.off_days);
      const st = dayStatus(entriesByProfileDate.get(`${p.id}|${todayIso()}`), p.required_check_in, off);
      if (st.present) { present++; if (st.late) late++; }
      else if (st.absent) absent++;
    }
    return { present, absent, late };
  }, [todayInRange, filteredProfiles, entriesByProfileDate]);

  const ptoPending = ptoRequests.filter((r) => r.status === "pending").length;
  const correctionsPending = corrections.filter((c) => c.status === "pending").length;
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
        const st = dayStatus(entriesByProfileDate.get(`${p.id}|${d}`), p.required_check_in, off);
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
      ["Role Summary — Full Period"],
      ["Role", "Employees", "Days Present", "Absences", "Lates", "Total Hours"],
      ...roleSummary.map((r) => [r.role, r.count, r.present, r.absent, r.late, r.hours.toFixed(1)]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Report");
    XLSX.writeFile(workbook, `attendance-monitoring-report_${dateFrom}_to_${dateTo}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Read-only attendance summary — approve PTO/corrections from the Attendance Monitoring Dashboard.</p>
          </div>
        </div>

        <div className="panel p-4 mb-6"><div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Department</label>
            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All Departments</option>
              {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select></div>
          <button onClick={exportToXlsx} disabled={loading} className="btn text-sm px-3 mb-0.5 flex items-center gap-1.5 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Download XLSX
          </button>
        </div></div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Attendance Monitoring Report…</div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          {[
            ["Total Employees", filteredProfiles.length, "text-white", Users],
            ["Present Today", todayKpi.present, "text-green-300", UserCheck],
            ["Absent Today", todayKpi.absent, "text-red-300", UserX],
            ["Late Today", todayKpi.late, "text-yellow-300", Clock],
            ["PTO Pending", ptoPending, "text-blue-300", Clock],
            ["Warnings", warningsCount, "text-orange-300", UserX],
          ].map(([label, value, color, Icon]: any) => (
            <div key={label} className="panel p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground"><Icon className="h-4 w-4" /></div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Daily Attendance Trend</p>
          <ResponsiveContainer width="100%" height={220}>
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
        </>
        )}
      </main>
    </div>
  );
}
