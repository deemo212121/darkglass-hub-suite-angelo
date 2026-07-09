import { useState, useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const TECHS = ["A. Reyes", "M. Patel", "J. Kim", "S. Brown", "L. Ortiz", "R. Chen"];
const BRANCHES = ["Houston HQ", "Dallas", "Austin", "San Antonio", "Memphis", "Atlanta"];
const APPLIANCES = ["Washer", "Dryer", "Refrigerator", "Range/Oven", "Dishwasher", "Microwave"];
const pick = <T,>(a: T[], i: number) => a[i % a.length];
const pad = (n: number) => String(n).padStart(4, "0");

function isoWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, "0")}`;
}

function generateRows(count = 60) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (i % 90));
    const dateStr = d.toISOString().slice(0, 10);
    const jobs = 10 + (i * 7) % 12;
    const ftf = 6 + (i * 5) % (jobs - 2);
    const location = pick(BRANCHES, i);
    return {
      id: i + 1,
      ticketNo: "TK-2026-" + pad(1000 + i),
      date: dateStr,
      week: isoWeek(d),
      month: d.toLocaleString("default", { month: "short", year: "numeric" }),
      tech: pick(TECHS, i),
      branch: location,
      warrantyType: i % 2 === 0 ? "In-warranty" : "Out-of-warranty",
      appliance: pick(APPLIANCES, i),
      jobs,
      ftfCount: ftf,
      ftfRate: Math.round((ftf / jobs) * 100),
      callbacks: i % 4,
    };
  });
}

const ALL_ROWS = generateRows(60);

// Date helpers
const todayStr = () => new Date().toISOString().slice(0, 10);
const offsetStr = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthStr = (d: Date) => d.toISOString().slice(0, 7);
const currentMonth = () => monthStr(new Date());
const offsetMonth = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return monthStr(d);
};

// ── Component ─────────────────────────────────────────────────────────────────
type DateMode = "monthly" | "weekly" | "daily";

export function FtfReport({ mod, sub }: Props) {
  // Data Level checkboxes
  const [byLocation, setByLocation] = useState(false);
  const [byTechnician, setByTechnician] = useState(false);
  const [byBranch, setByBranch] = useState(false);

  // Warranty Type
  const [inWarranty, setInWarranty] = useState(true);
  const [outOfWarranty, setOutOfWarranty] = useState(false);

  // Date mode
  const [dateMode, setDateMode] = useState<DateMode>("daily");

  // Monthly range
  const [monthStart, setMonthStart] = useState(offsetMonth(-12));
  const [monthEnd, setMonthEnd] = useState(currentMonth());

  // Weekly range
  const [weekStart, setWeekStart] = useState(isoWeek(new Date(Date.now() - 60 * 86400000)));
  const [weekEnd, setWeekEnd] = useState(isoWeek(new Date()));

  // Daily range
  const [dayStart, setDayStart] = useState(offsetStr(-12));
  const [dayEnd, setDayEnd] = useState(todayStr());

  // Applied (on Refresh)

  const handleRefresh = () => {
  };

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    // Warranty filter
    const wf = [inWarranty && "In-warranty", outOfWarranty && "Out-of-warranty"].filter(Boolean) as string[];
    if (wf.length) r = r.filter(x => wf.includes(x.warrantyType));
    // Date filter
    if (dateMode === "daily") {
      if (dayStart) r = r.filter(x => x.date >= dayStart);
      if (dayEnd) r = r.filter(x => x.date <= dayEnd);
    } else if (dateMode === "monthly") {
      r = r.filter(x => {
        const m = x.date.slice(0, 7);
        return m >= monthStart && m <= monthEnd;
      });
    } else {
      r = r.filter(x => x.week >= weekStart && x.week <= weekEnd);
    }
    return r;
  }, [dateMode, dayEnd, dayStart, inWarranty, monthEnd, monthStart, outOfWarranty, weekEnd, weekStart]);

  // Grouping columns based on data level
  const groupCols: string[] = [];
  if (byLocation) groupCols.push("Branch");
  if (byTechnician) groupCols.push("Technician");
  if (byBranch) groupCols.push("Branch");

  const avgFtf = rows.length ? Math.round(rows.reduce((s, r) => s + r.ftfRate, 0) / rows.length) : 0;

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground transition-colors">🏠</Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground transition-colors">Report</Link>
        <span>›</span>
        <span className="text-foreground font-medium">FTF Report</span>
      </div>

      {/* Title */}
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">First Time Fix (FTF) Report</h1>
      </div>

      {/* Filter Panel */}
      <div className="panel panel-filter mb-5">
        <div className="grid gap-3">
          {/* Row 1: Data Level + Warranty Type + Refresh */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            {/* Data Level */}
            <div className="flex items-center gap-6">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">Data Level</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={byLocation} onChange={e => setByLocation(e.target.checked)} className="accent-blue-500" />
                Location
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={byTechnician} onChange={e => setByTechnician(e.target.checked)} className="accent-blue-500" />
                Technician
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={byBranch} onChange={e => setByBranch(e.target.checked)} className="accent-blue-500" />
                Branch
              </label>
            </div>

            <div className="flex-1" />

            {/* Warranty Type */}
            <div className="flex items-center gap-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warranty Type*</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={inWarranty} onChange={e => setInWarranty(e.target.checked)} className="accent-blue-500" />
                In-warranty
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={outOfWarranty} onChange={e => setOutOfWarranty(e.target.checked)} className="accent-blue-500" />
                Out-of-warranty
              </label>
            </div>

            
          </div>

          {/* Row 2: Date Mode */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">Dates</span>

            {/* Monthly */}
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="dateMode" value="monthly" checked={dateMode === "monthly"} onChange={() => setDateMode("monthly")} className="accent-blue-500" />
              Monthly
            </label>
            <div className={`flex items-center gap-1 transition-opacity ${dateMode !== "monthly" ? "opacity-40 pointer-events-none" : ""}`}>
              <input type="month" value={monthStart} onChange={e => setMonthStart(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md w-[130px]" />
              <span className="text-muted-foreground text-xs">~</span>
              <input type="month" value={monthEnd} onChange={e => setMonthEnd(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md w-[130px]" />
            </div>

            {/* Weekly */}
            <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2">
              <input type="radio" name="dateMode" value="weekly" checked={dateMode === "weekly"} onChange={() => setDateMode("weekly")} className="accent-blue-500" />
              Weekly
            </label>
            <div className={`flex items-center gap-1 transition-opacity ${dateMode !== "weekly" ? "opacity-40 pointer-events-none" : ""}`}>
              <input type="week" value={weekStart} onChange={e => setWeekStart(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md w-[140px]" />
              <span className="text-muted-foreground text-xs">~</span>
              <input type="week" value={weekEnd} onChange={e => setWeekEnd(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md w-[140px]" />
            </div>

            {/* Daily */}
            <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2">
              <input type="radio" name="dateMode" value="daily" checked={dateMode === "daily"} onChange={() => setDateMode("daily")} className="accent-blue-500" />
              Daily
            </label>
            <div className={`flex items-center gap-1 transition-opacity ${dateMode !== "daily" ? "opacity-40 pointer-events-none" : ""}`}>
              <input type="date" value={dayStart} onChange={e => setDayStart(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md w-[130px]" />
              <span className="text-muted-foreground text-xs">~</span>
              <input type="date" value={dayEnd} onChange={e => setDayEnd(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md w-[130px]" />
            </div>
          </div>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Total Records", value: rows.length, color: "text-blue-400" },
          { label: "Total Jobs", value: rows.reduce((s, r) => s + r.jobs, 0).toLocaleString(), color: "text-cyan-400" },
          { label: "FTF Count", value: rows.reduce((s, r) => s + r.ftfCount, 0).toLocaleString(), color: "text-green-400" },
          { label: "Avg FTF Rate", value: avgFtf + "%", color: avgFtf >= 80 ? "text-green-400" : avgFtf >= 65 ? "text-yellow-400" : "text-red-400" },
        ].map(k => (
          <div key={k.label} className="panel py-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Results label */}
      <div className="mb-2 text-sm text-muted-foreground">
        Showing <span className="text-foreground font-medium">{rows.length}</span> record{rows.length !== 1 ? "s" : ""}
        {dateMode === "daily" && dayStart && dayEnd && (
          <span> &middot; {dayStart} → {dayEnd}</span>
        )}
      </div>

      {/* Table */}
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {[
                "#", "Ticket No", "Date",
                ...(dateMode === "weekly" ? ["Week"] : dateMode === "monthly" ? ["Month"] : []),
                "Technician", "Branch", "Warranty", "Appliance", "Jobs", "FTF Count", "FTF %", "Callbacks"
              ].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center text-muted-foreground">
                  No records match the current filters. Adjust and click Refresh.
                </td>
              </tr>
            ) : rows.map((row, idx) => (
              <tr key={row.id} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${idx % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>
                <td className="px-3 py-2.5 font-mono text-blue-400">{row.ticketNo}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.date}</td>
                {dateMode === "weekly" && <td className="px-3 py-2.5 text-muted-foreground">{row.week}</td>}
                {dateMode === "monthly" && <td className="px-3 py-2.5 text-muted-foreground">{row.month}</td>}
                <td className="px-3 py-2.5">{row.tech}</td>
                <td className="px-3 py-2.5">{row.branch}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    row.warrantyType === "In-warranty"
                      ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                      : "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                  }`}>
                    {row.warrantyType}
                  </span>
                </td>
                <td className="px-3 py-2.5">{row.appliance}</td>
                <td className="px-3 py-2.5 text-right">{row.jobs}</td>
                <td className="px-3 py-2.5 text-right">{row.ftfCount}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className={`font-semibold ${row.ftfRate >= 80 ? "text-green-400" : row.ftfRate >= 65 ? "text-yellow-400" : "text-red-400"}`}>
                    {row.ftfRate}%
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">{row.callbacks}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/5 font-semibold">
                <td colSpan={dateMode === "daily" ? 8 : 9} className="px-3 py-2.5 text-muted-foreground text-xs uppercase tracking-wide">Totals</td>
                <td className="px-3 py-2.5 text-right">{rows.reduce((s, r) => s + r.jobs, 0)}</td>
                <td className="px-3 py-2.5 text-right">{rows.reduce((s, r) => s + r.ftfCount, 0)}</td>
                <td className={`px-3 py-2.5 text-right font-bold ${avgFtf >= 80 ? "text-green-400" : avgFtf >= 65 ? "text-yellow-400" : "text-red-400"}`}>
                  {avgFtf}%
                </td>
                <td className="px-3 py-2.5 text-right">{rows.reduce((s, r) => s + r.callbacks, 0)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </main>
  );
}
