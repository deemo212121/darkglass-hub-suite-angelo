import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Download } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, calcWorkedHours, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getCompanySalaryEntries, rateEffectiveOn, currentRate, type SalaryEntryRow } from "@/lib/supabase/salary";
import { EmployeePayrollDetailModal } from "@/components/EmployeePayrollDetailModal";
import { ROLE_LABELS } from "@/lib/roleLabels";

const REGULAR_HOURS_PER_DAY = 8;
const OT_MULTIPLIER = 1.5;

function fmtMoney(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function profileDepartment(p: ProfileRow): string {
  return p.department || ROLE_LABELS[p.role] || p.role || "";
}

interface PayrollRow {
  profileId: string;
  name: string;
  department: string;
  rate: number;
  regularHours: number;
  overtimeHours: number;
  grossPay: number;
}

export function PayrollCalculationPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntryRow[]>([]);

  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [detailProfile, setDetailProfile] = useState<ProfileRow | null>(null);

  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRows, entryRows, salaryRows] = await Promise.all([
        getCompanyUsers(),
        getCompanyTimecardEntries(startDate, endDate),
        getCompanySalaryEntries(),
      ]);
      setProfiles(profileRows);
      setEntries(entryRows);
      setSalaryEntries(salaryRows);
    } catch (err) {
      console.error("Failed to load payroll data:", err);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const historyByProfile = useMemo(() => {
    const map = new Map<string, SalaryEntryRow[]>();
    for (const se of salaryEntries) {
      if (!map.has(se.profileId)) map.set(se.profileId, []);
      map.get(se.profileId)!.push(se);
    }
    return map;
  }, [salaryEntries]);

  const entriesByProfile = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry[]>();
    for (const e of entries) {
      if (!map.has(e.profileId)) map.set(e.profileId, []);
      map.get(e.profileId)!.push(e);
    }
    return map;
  }, [entries]);

  // Each day's hours are paid at whichever rate was effective ON that day —
  // a mid-period raise/promotion is handled automatically instead of
  // needing one flat rate for the whole period.
  const rows: PayrollRow[] = useMemo(() => {
    return profiles.map((p) => {
      const dayEntries = entriesByProfile.get(p.id) ?? [];
      const history = historyByProfile.get(p.id) ?? [];
      let regularHours = 0;
      let overtimeHours = 0;
      let grossPay = 0;
      for (const day of dayEntries) {
        if (!day.checkIn || !day.checkOut) continue;
        const hours = calcWorkedHours({
          checkIn: day.checkIn,
          checkOut: day.checkOut,
          mealStart: day.mealStart,
          mealEnd: day.mealEnd,
          notes: "",
        });
        const reg = Math.min(hours, REGULAR_HOURS_PER_DAY);
        const ot = Math.max(0, hours - REGULAR_HOURS_PER_DAY);
        const rate = rateEffectiveOn(history, day.workDate);
        regularHours += reg;
        overtimeHours += ot;
        grossPay += reg * rate + ot * rate * OT_MULTIPLIER;
      }
      return {
        profileId: p.id,
        name: p.display_name || p.email,
        department: profileDepartment(p),
        rate: currentRate(history),
        regularHours,
        overtimeHours,
        grossPay,
      };
    });
  }, [profiles, entriesByProfile, historyByProfile]);

  const departments = Array.from(new Set(rows.map((r) => r.department).filter(Boolean)));

  const filteredRows = rows.filter((r) => {
    if (departmentFilter !== "all" && r.department !== departmentFilter) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalGross = filteredRows.reduce((s, r) => s + r.grossPay, 0);
  const totalRegular = filteredRows.reduce((s, r) => s + r.regularHours, 0);
  const totalOvertime = filteredRows.reduce((s, r) => s + r.overtimeHours, 0);

  const handleDownload = () => {
    let csv = "Employee,Department,Regular Hours,Overtime Hours,Rate,Gross Pay\n";
    filteredRows.forEach((r) => {
      csv += `"${r.name}","${r.department}",${r.regularHours.toFixed(2)},${r.overtimeHours.toFixed(2)},${r.rate.toFixed(2)},${r.grossPay.toFixed(2)}\n`;
    });
    const el = document.createElement("a");
    el.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csv));
    el.setAttribute("download", `payroll-${startDate}-to-${endDate}.csv`);
    el.style.display = "none";
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  };

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
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase">Total Gross Pay</p>
              <p className="text-2xl font-bold text-green-400 mt-2">{loading ? "…" : fmtMoney(totalGross)}</p>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase">Regular Hours</p>
              <p className="text-2xl font-bold text-white mt-2">{loading ? "…" : totalRegular.toFixed(1)}</p>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase">Overtime Hours</p>
              <p className="text-2xl font-bold text-orange-400 mt-2">{loading ? "…" : totalOvertime.toFixed(1)}</p>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase">Employees</p>
              <p className="text-2xl font-bold text-blue-400 mt-2">{loading ? "…" : filteredRows.length}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Period Start</label>
                <input
                  type="date"
                  title="Period Start"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Period End</label>
                <input
                  type="date"
                  title="Period End"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Department</label>
                <select
                  title="Department"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">All Departments</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Search</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search employee..."
                  className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button type="button" onClick={handleDownload} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-semibold transition inline-flex items-center gap-2">
                <Download className="h-4 w-4" /> Export CSV
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
            <h2 className="text-lg font-bold text-white mb-4">Payroll — {startDate} to {endDate}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Department</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Reg. Hours</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">OT Hours</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Rate</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Gross Pay</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading payroll…</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No employees match this filter.</td></tr>
                ) : filteredRows.map((row) => (
                  <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                    <td className="px-3 py-3 text-white font-medium">
                      <button
                        type="button"
                        onClick={() => setDetailProfile(profiles.find((p) => p.id === row.profileId) ?? null)}
                        className="text-blue-400 hover:text-blue-300 hover:underline"
                      >
                        {row.name}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{row.department || "—"}</td>
                    <td className="px-3 py-3 text-right text-slate-200">{row.regularHours.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right text-orange-300">{row.overtimeHours.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right text-slate-200">${row.rate.toFixed(2)}/hr</td>
                    <td className="px-3 py-3 text-right font-semibold text-green-300">{fmtMoney(row.grossPay)}</td>
                  </tr>
                ))}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-white/20 bg-white/5">
                    <td colSpan={5} className="px-3 py-3 text-sm font-semibold text-slate-300">Total</td>
                    <td className="px-3 py-3 text-right font-bold text-green-300">{fmtMoney(totalGross)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </main>

      {detailProfile && (
        <EmployeePayrollDetailModal
          profileId={detailProfile.id}
          employeeName={detailProfile.display_name || detailProfile.email}
          department={profileDepartment(detailProfile)}
          requiredCheckIn={detailProfile.required_check_in || undefined}
          requiredCheckOut={detailProfile.required_check_out || undefined}
          offDays={detailProfile.off_days || undefined}
          onClose={() => setDetailProfile(null)}
          onRateChanged={load}
        />
      )}
    </div>
  );
}
