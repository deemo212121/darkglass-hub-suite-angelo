/**
 * Employee Details — rebuilt on live data. Previously this whole route was
 * mock data (a hardcoded EMPLOYEES_DATA object keyed "1"-"8") even though
 * every real link into it (AttendanceMonitoringPage.tsx's staff/PTO/
 * correction/note tables, CsrAgentDetailPage-style links, etc.) passes a
 * real Supabase profile id — so it always rendered "Employee Not Found"
 * for every real employee.
 *
 * Present/late/absent classification reuses ReportAttendanceMonitoring.tsx's
 * own exported dayStatus()/isOffDay()/graceMinutesFor() — the same
 * present/late/absent rule Attendance Monitoring's own tabs use, so the
 * numbers here always agree with the company-wide report.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Loader2, CalendarOff } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { dayStatus, isOffDay, graceMinutesFor, type DayStatus } from "@/components/ReportAttendanceMonitoring";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";

export const Route = createFileRoute("/employee/$employeeId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Employee Details — Admin Hub Solutions` }],
  }),
  component: EmployeeDetailsPage,
});

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const todayMonthValue = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
function monthLabel(monthValue: string): string {
  const [y, m] = monthValue.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function shiftMonth(monthValue: string, delta: number): string {
  const [y, m] = monthValue.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** Full weeks (Sun-Sat) covering `monthValue`, including the leading/trailing days of neighboring months needed to complete each row. */
function buildMonthWeeks(monthValue: string): Array<Array<{ date: Date; iso: string; inMonth: boolean }>> {
  const [y, m] = monthValue.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const lastOfMonth = new Date(y, m, 0);
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const end = new Date(lastOfMonth);
  end.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));

  const weeks: Array<Array<{ date: Date; iso: string; inMonth: boolean }>> = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(cursor);
      date.setDate(cursor.getDate() + i);
      return { date, iso: toIso(date), inMonth: date.getMonth() === m - 1 };
    });
    weeks.push(week);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function dayCellClass(status: "present" | "late" | "absent" | "day-off" | "future" | "no-data"): string {
  switch (status) {
    case "present": return "bg-green-500/10 border-green-500/30";
    case "late": return "bg-yellow-500/10 border-yellow-500/30";
    case "absent": return "bg-red-500/10 border-red-500/30";
    case "day-off": return "bg-slate-500/10 border-slate-500/20";
    case "future": return "bg-transparent border-white/5";
    default: return "bg-white/5 border-white/10";
  }
}

function EmployeeDetailsPage() {
  const { employeeId } = Route.useParams();
  const navigate = useNavigate();
  const goBackToDashboard = useSmartBack(() => navigate({ to: "/m/$module", params: { module: "dashboard" } }));
  const { ready } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employee, setEmployee] = useState<ProfileRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [monthValue, setMonthValue] = useState(todayMonthValue());

  // This route is always opened via target="_blank" (every link into it
  // across AttendanceMonitoringPage.tsx opens a fresh tab) — Firebase auth
  // has to rehydrate from scratch there, so firing the Supabase query before
  // `ready` flips true would run it unauthenticated. RLS's profiles_select
  // policy then has no auth_company_id()/is_superadmin() to match against,
  // returns zero rows, and every real employee looks like "Employee Not
  // Found" — same guard PartOrder.tsx and everywhere else in this app use.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const profiles = await getCompanyUsers();
        const me = profiles.find((p) => p.id === employeeId) ?? null;
        if (cancelled) return;
        if (!me) { setNotFound(true); setLoading(false); return; }
        setEmployee(me);

        const [y, m] = monthValue.split("-").map(Number);
        const monthStart = toIso(new Date(y, m - 1, 1));
        const monthEnd = toIso(new Date(y, m, 0));
        const rows = await getCompanyTimecardEntries(monthStart, monthEnd);
        if (cancelled) return;
        setEntries(rows.filter((r) => r.profileId === employeeId));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load employee details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, employeeId, monthValue]);

  const entryByDate = useMemo(() => new Map(entries.map((e) => [e.workDate, e])), [entries]);
  const graceMinutes = employee ? graceMinutesFor(employee) : 0;
  const monthWeeks = useMemo(() => buildMonthWeeks(monthValue), [monthValue]);
  const todayIso = toIso(new Date());

  const dayInfo = (iso: string): { status: "present" | "late" | "absent" | "day-off" | "future" | "no-data"; st: DayStatus | null } => {
    if (!employee) return { status: "no-data", st: null };
    if (iso > todayIso) return { status: "future", st: null };
    const off = isOffDay(iso, employee.off_days);
    const entry = entryByDate.get(iso);
    const st = dayStatus(entry, employee.required_check_in, off, graceMinutes);
    if (off && !st.present) return { status: "day-off", st };
    if (!st.present) return { status: "absent", st };
    return { status: st.late ? "late" : "present", st };
  };

  // Month summary — same tiles Attendance Monitoring's own Weekly/Monthly
  // summaries use (present/late/absent day counts + total worked hours).
  const monthSummary = useMemo(() => {
    if (!employee) return { present: 0, late: 0, absent: 0, dayOff: 0, hours: 0 };
    let present = 0, late = 0, absent = 0, dayOff = 0, hours = 0;
    for (const week of monthWeeks) {
      for (const day of week) {
        if (!day.inMonth || day.iso > todayIso) continue;
        const { status, st } = dayInfo(day.iso);
        if (status === "present") { present++; hours += st?.hours ?? 0; }
        else if (status === "late") { present++; late++; hours += st?.hours ?? 0; }
        else if (status === "absent") absent++;
        else if (status === "day-off") dayOff++;
      }
    }
    return { present, late, absent, dayOff, hours };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, monthWeeks, entryByDate, graceMinutes, todayIso]);

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-2xl font-bold text-white mb-4">Employee Not Found</p>
            <p className="text-sm text-slate-400 mb-4">No profile matches this id — it may have been deleted, or the link is stale.</p>
            <button onClick={() => navigate({ to: "/m/$module", params: { module: "dashboard" } })} className="btn px-4 py-2 rounded-md hover:bg-white/10 transition">
              <ChevronLeft className="h-4 w-4 inline mr-2" />
              Back to Dashboard
            </button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <AppHeader />

      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur">
        <div className="max-w-350 mx-auto px-6 py-6 flex items-center gap-4">
          <button type="button" onClick={goBackToDashboard} className="btn hover:bg-white/15 p-2 rounded-md">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{loading ? "Loading…" : employee?.display_name || employee?.username || employee?.email || "—"}</h1>
            <p className="text-sm text-slate-400">
              {employee ? `${ROLE_LABELS[normalizeRole(employee.role)] ?? employee.role} · ${employee.assigned_branch || "Unassigned"}${employee.manager_name ? ` · Reports to ${employee.manager_name}` : ""}` : "Employee Details"}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-350 mx-auto w-full px-6 py-8">
        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <BrandedLoader label="Loading employee details…" />
        ) : employee ? (
        <div className="space-y-6">
          {/* Working Hours */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-400" />
              Working Hours
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Required Check In</p>
                <p className="text-lg font-semibold text-white">{employee.required_check_in || "—"}</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Required Check Out</p>
                <p className="text-lg font-semibold text-white">{employee.required_check_out || "—"}</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Scheduled Shift Length</p>
                <p className="text-lg font-semibold text-blue-300">{employee.working_hours != null ? `${employee.working_hours}h` : "—"}</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Meal Break</p>
                <p className="text-lg font-semibold text-white">{employee.meal_minutes != null ? `${employee.meal_minutes} min` : "—"}</p>
              </div>
            </div>
          </div>

          {/* Working Days & Day Offs */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <CalendarOff className="h-5 w-5 text-purple-400" />
              Working Days &amp; Day Offs
            </h2>
            <div className="grid grid-cols-7 gap-2">
              {DAY_NAMES.map((name, idx) => {
                const off = (employee.off_days ?? []).includes(idx);
                return (
                  <div key={name} className={`rounded-lg border p-3 text-center ${off ? "bg-slate-500/10 border-slate-500/30" : "bg-green-500/10 border-green-500/30"}`}>
                    <p className={`text-sm font-semibold ${off ? "text-slate-400" : "text-green-300"}`}>{DAY_ABBREV[idx]}</p>
                    <p className="text-[10px] text-slate-500 uppercase mt-1">{off ? "Day Off" : "Working"}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Month summary */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-blue-400" />
              {monthLabel(monthValue)} Summary
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white/5 p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-green-300">{monthSummary.present}</p>
                <p className="text-xs text-slate-400 mt-1 uppercase">Present</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-yellow-300">{monthSummary.late}</p>
                <p className="text-xs text-slate-400 mt-1 uppercase">Late</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-red-300">{monthSummary.absent}</p>
                <p className="text-xs text-slate-400 mt-1 uppercase">Absent</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-slate-300">{monthSummary.dayOff}</p>
                <p className="text-xs text-slate-400 mt-1 uppercase">Day Off</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg text-center">
                <p className="text-2xl font-bold text-blue-300">{monthSummary.hours.toFixed(1)}</p>
                <p className="text-xs text-slate-400 mt-1 uppercase">Hours Worked</p>
              </div>
            </div>
          </div>

          {/* Timestamp Calendar */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-purple-400" />
                Timestamp Calendar
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setMonthValue((v) => shiftMonth(v, -1))} className="btn p-1.5 rounded-md hover:bg-white/10">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold w-36 text-center">{monthLabel(monthValue)}</span>
                <button onClick={() => setMonthValue((v) => shiftMonth(v, 1))} className="btn p-1.5 rounded-md hover:bg-white/10">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {DAY_ABBREV.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-slate-500 uppercase py-1">{d}</div>
              ))}
            </div>
            <div className="space-y-1.5">
              {monthWeeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1.5">
                  {week.map((day) => {
                    if (!day.inMonth) return <div key={day.iso} className="rounded-lg border border-transparent p-2 min-h-16" />;
                    const { status, st } = dayInfo(day.iso);
                    const entry = entryByDate.get(day.iso);
                    return (
                      <div key={day.iso} className={`rounded-lg border p-2 min-h-16 ${dayCellClass(status)}`}>
                        <p className="text-xs font-semibold text-slate-300">{day.date.getDate()}</p>
                        {status === "day-off" ? (
                          <p className="text-[10px] text-slate-500 mt-1">Day Off</p>
                        ) : status === "future" ? null : status === "no-data" ? null : (
                          <>
                            <p className="text-[10px] text-slate-400 mt-1">{entry?.checkIn || "—"}{entry?.checkOut ? ` – ${entry.checkOut}` : ""}</p>
                            {(entry?.mealStart || entry?.mealEnd) && (
                              <p className="text-[10px] text-slate-500">Meal: {entry?.mealStart || "—"}{entry?.mealEnd ? ` – ${entry.mealEnd}` : ""}</p>
                            )}
                            {st && st.hours > 0 && <p className="text-[10px] text-slate-500">{st.hours.toFixed(1)}h</p>}
                            {status === "late" && <p className="text-[10px] text-yellow-400 font-medium mt-0.5">Late</p>}
                            {status === "absent" && <p className="text-[10px] text-red-400 font-medium mt-0.5">Absent</p>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-4 text-[10px] text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-500/30 border border-green-500/50" /> Present</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-yellow-500/30 border border-yellow-500/50" /> Late</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500/30 border border-red-500/50" /> Absent</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-500/30 border border-slate-500/50" /> Day Off</span>
            </div>
          </div>
        </div>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}
