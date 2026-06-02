import { useState, useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

// ── helpers ──────────────────────────────────────────────────────────────────
const TECHS = ["A. Reyes","M. Patel","J. Kim","S. Brown","L. Ortiz","R. Chen"];
const BRANCHES = ["Houston HQ","Dallas","Austin","San Antonio","Memphis","Atlanta"];
const APPLIANCES = ["Washer","Dryer","Refrigerator","Range/Oven","Dishwasher","Microwave"];
const CUSTOMERS = ["John Doe","Jane Smith","Acme LLC","Beth Larsen","Carlos Mora","Priya Shah","Tom O'Neil","Lily Park"];
const WARRANTY_TYPES = ["In-warranty","Out-of-warranty"];

const pick = <T,>(a: T[], i: number) => a[i % a.length];
const pad = (n: number) => String(n).padStart(4,"0");

function isoWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay()+6) % 7));
  const w1 = new Date(d.getFullYear(),0,4);
  const wn = 1 + Math.round(((d.getTime()-w1.getTime())/86400000 - 3 + ((w1.getDay()+6)%7))/7);
  return `${d.getFullYear()}-W${String(wn).padStart(2,"0")}`;
}
function todayStr() { return new Date().toISOString().slice(0,10); }
function offsetStr(days: number) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function monthStr(offset = 0) {
  const d = new Date(); d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0,7);
}

// Use plain date pickers for monthly/weekly to avoid Firefox/Safari incompatibility
// Monthly = two date inputs (day clamped to first of month on display)
// Weekly  = two date inputs (user picks any day in the week)
type DateMode = "monthly"|"weekly"|"daily";

// ── seed data ─────────────────────────────────────────────────────────────────
function generateRows(count = 60) {
  return Array.from({ length: count }, (_, i) => {
    const open = new Date(); open.setDate(open.getDate() - (i % 90) - 5);
    const tat = 1 + (i * 3) % 20;
    const close = new Date(open); close.setDate(close.getDate() + tat);
    return {
      id: i + 1,
      ticketNo: "TK-2026-" + pad(5000 + i),
      tech: pick(TECHS, i),
      branch: pick(BRANCHES, i),
      customer: pick(CUSTOMERS, i),
      appliance: pick(APPLIANCES, i),
      warrantyType: pick(WARRANTY_TYPES, i),
      openDate: open.toISOString().slice(0,10),
      closeDate: close.toISOString().slice(0,10),
      month: close.toISOString().slice(0,7),
      monthLabel: close.toLocaleString("default",{month:"short",year:"numeric"}),
      tat,
      status: tat <= 3 ? "Good" : tat <= 7 ? "Average" : "Slow",
    };
  });
}
const ALL_ROWS = generateRows(60);

const STATUS_CHIP: Record<string,string> = {
  Good: "bg-green-500/20 text-green-300 border border-green-500/30",
  Average: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  Slow: "bg-red-500/20 text-red-300 border border-red-500/30",
};

// ── TAT Summary ───────────────────────────────────────────────────────────────
function TatSummary({ rows, groupBy }: { rows: typeof ALL_ROWS; groupBy: "month"|"tech"|"branch" }) {
  type G = { label: string; count: number; totalTat: number; good: number; avg: number; slow: number };
  const groups: Record<string, G> = {};
  rows.forEach(r => {
    const key = groupBy === "month" ? r.month : groupBy === "tech" ? r.tech : r.branch;
    const label = groupBy === "month" ? r.monthLabel : key;
    if (!groups[key]) groups[key] = { label, count: 0, totalTat: 0, good: 0, avg: 0, slow: 0 };
    groups[key].count++;
    groups[key].totalTat += r.tat;
    if (r.status === "Good") groups[key].good++;
    else if (r.status === "Average") groups[key].avg++;
    else groups[key].slow++;
  });
  const entries = Object.entries(groups).sort((a,b) => a[0].localeCompare(b[0]));
  if (!entries.length) return <p className="text-muted-foreground text-sm px-2 py-4">No data for current filters.</p>;
  const col = groupBy === "month" ? "Month" : groupBy === "tech" ? "Technician" : "Branch";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            {[col,"Tickets","Avg TAT (days)","Good (≤3d)","Average (4-7d)","Slow (>7d)"].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(([k,v], idx) => {
            const avgTat = Math.round(v.totalTat / v.count);
            return (
              <tr key={k} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                <td className="px-3 py-2 font-medium">{v.label}</td>
                <td className="px-3 py-2">{v.count}</td>
                <td className="px-3 py-2">
                  <span className={avgTat<=3?"text-green-400 font-semibold":avgTat<=7?"text-yellow-400":"text-red-400 font-semibold"}>
                    {avgTat}
                  </span>
                </td>
                <td className="px-3 py-2 text-green-400">{v.good}</td>
                <td className="px-3 py-2 text-yellow-400">{v.avg}</td>
                <td className="px-3 py-2 text-red-400">{v.slow}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/10 bg-white/5 font-semibold">
            <td className="px-3 py-2 text-xs text-muted-foreground uppercase">Total</td>
            <td className="px-3 py-2">{rows.length}</td>
            <td className="px-3 py-2">{rows.length?Math.round(rows.reduce((s,r)=>s+r.tat,0)/rows.length):0}</td>
            <td className="px-3 py-2 text-green-400">{rows.filter(r=>r.status==="Good").length}</td>
            <td className="px-3 py-2 text-yellow-400">{rows.filter(r=>r.status==="Average").length}</td>
            <td className="px-3 py-2 text-red-400">{rows.filter(r=>r.status==="Slow").length}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Date range row (cross-browser: all use type="date") ───────────────────────
function DateRangeRow({
  dateMode, setDateMode,
  monthStart, setMonthStart, monthEnd, setMonthEnd,
  weekStart, setWeekStart, weekEnd, setWeekEnd,
  dayStart, setDayStart, dayEnd, setDayEnd,
}: {
  dateMode: DateMode; setDateMode: (m: DateMode) => void;
  monthStart: string; setMonthStart: (v: string) => void;
  monthEnd: string; setMonthEnd: (v: string) => void;
  weekStart: string; setWeekStart: (v: string) => void;
  weekEnd: string; setWeekEnd: (v: string) => void;
  dayStart: string; setDayStart: (v: string) => void;
  dayEnd: string; setDayEnd: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">Complete Date*</span>

      {/* Monthly — use date pickers, label says "Month" */}
      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
        <input type="radio" name="tatDateMode" value="monthly" checked={dateMode==="monthly"} onChange={() => setDateMode("monthly")} className="accent-blue-500" />
        Monthly
      </label>
      <div className={`flex items-center gap-1 transition-opacity ${dateMode!=="monthly"?"opacity-40 pointer-events-none":""}`}>
        <label htmlFor="tat-month-start" className="sr-only">Month start</label>
        <input
          id="tat-month-start"
          type="date"
          value={monthStart}
          onChange={e => setMonthStart(e.target.value)}
          title="Start of monthly range"
          placeholder="YYYY-MM-DD"
          className="glass-input text-sm py-1 px-2 rounded-md w-32.5"
        />
        <span className="text-muted-foreground text-xs">~</span>
        <label htmlFor="tat-month-end" className="sr-only">Month end</label>
        <input
          id="tat-month-end"
          type="date"
          value={monthEnd}
          onChange={e => setMonthEnd(e.target.value)}
          title="End of monthly range"
          placeholder="YYYY-MM-DD"
          className="glass-input text-sm py-1 px-2 rounded-md w-32.5"
        />
      </div>

      {/* Weekly — use date pickers */}
      <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2">
        <input type="radio" name="tatDateMode" value="weekly" checked={dateMode==="weekly"} onChange={() => setDateMode("weekly")} className="accent-blue-500" />
        Weekly
      </label>
      <div className={`flex items-center gap-1 transition-opacity ${dateMode!=="weekly"?"opacity-40 pointer-events-none":""}`}>
        <label htmlFor="tat-week-start" className="sr-only">Week start</label>
        <input
          id="tat-week-start"
          type="date"
          value={weekStart}
          onChange={e => setWeekStart(e.target.value)}
          title="Start of weekly range"
          placeholder="YYYY-MM-DD"
          className="glass-input text-sm py-1 px-2 rounded-md w-35"
        />
        <span className="text-muted-foreground text-xs">~</span>
        <label htmlFor="tat-week-end" className="sr-only">Week end</label>
        <input
          id="tat-week-end"
          type="date"
          value={weekEnd}
          onChange={e => setWeekEnd(e.target.value)}
          title="End of weekly range"
          placeholder="YYYY-MM-DD"
          className="glass-input text-sm py-1 px-2 rounded-md w-35"
        />
      </div>

      {/* Daily */}
      <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2">
        <input type="radio" name="tatDateMode" value="daily" checked={dateMode==="daily"} onChange={() => setDateMode("daily")} className="accent-blue-500" />
        Daily
      </label>
      <div className={`flex items-center gap-1 transition-opacity ${dateMode!=="daily"?"opacity-40 pointer-events-none":""}`}>
        <label htmlFor="tat-day-start" className="sr-only">Day start</label>
        <input
          id="tat-day-start"
          type="date"
          value={dayStart}
          onChange={e => setDayStart(e.target.value)}
          title="Start date"
          placeholder="YYYY-MM-DD"
          className="glass-input text-sm py-1 px-2 rounded-md w-32.5"
        />
        <span className="text-muted-foreground text-xs">~</span>
        <label htmlFor="tat-day-end" className="sr-only">Day end</label>
        <input
          id="tat-day-end"
          type="date"
          value={dayEnd}
          onChange={e => setDayEnd(e.target.value)}
          title="End date"
          placeholder="YYYY-MM-DD"
          className="glass-input text-sm py-1 px-2 rounded-md w-32.5"
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function TatReport({ mod, sub }: Props) {
  const [byLocation, setByLocation] = useState(false);
  const [byTechnician, setByTechnician] = useState(false);
  const [byBranch, setByBranch] = useState(false);
  const [inWarranty, setInWarranty] = useState(true);
  const [outOfWarranty, setOutOfWarranty] = useState(false);

  const [dateMode, setDateMode] = useState<DateMode>("daily");
  const [monthStart, setMonthStart] = useState(offsetStr(-210));
  const [monthEnd, setMonthEnd] = useState(todayStr());
  const [weekStart, setWeekStart] = useState(offsetStr(-60));
  const [weekEnd, setWeekEnd] = useState(todayStr());
  const [dayStart, setDayStart] = useState(offsetStr(-7));
  const [dayEnd, setDayEnd] = useState(todayStr());
  const [showDetail, setShowDetail] = useState(false);

  const handleRefresh = () => {
    setShowDetail(false);
  };

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    const wf = [inWarranty && "In-warranty", outOfWarranty && "Out-of-warranty"].filter(Boolean) as string[];
    if (wf.length) r = r.filter(x => wf.includes(x.warrantyType));
    if (dateMode === "monthly") {
      r = r.filter(x => x.closeDate >= monthStart && x.closeDate <= monthEnd);
    } else if (dateMode === "weekly") {
      r = r.filter(x => x.closeDate >= weekStart && x.closeDate <= weekEnd);
    } else {
      if (dayStart) r = r.filter(x => x.closeDate >= dayStart);
      if (dayEnd) r = r.filter(x => x.closeDate <= dayEnd);
    }
    return r;
  }, [dateMode, dayEnd, dayStart, inWarranty, monthEnd, monthStart, outOfWarranty, weekEnd, weekStart]);

  const avgTat = rows.length ? Math.round(rows.reduce((s,r)=>s+r.tat,0)/rows.length) : 0;
  const groupBy: "month"|"tech"|"branch" = byTechnician ? "tech" : byBranch ? "branch" : "month";

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground transition-colors">🏠</Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground transition-colors">Report</Link>
        <span>›</span>
        <span className="text-foreground font-medium">TAT Report</span>
      </div>

      {/* Title */}
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Turn Around Time (TAT) Report</h1>
      </div>

      {/* Filter Panel */}
      <div className="panel panel-filter mb-5">
        <div className="grid gap-3">
          {/* Row 1: Data Level + Warranty + Refresh */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex items-center gap-5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">Data Level*</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={byLocation} onChange={e => setByLocation(e.target.checked)} className="accent-blue-500" title="Group by Location" />
                Location
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={byTechnician} onChange={e => setByTechnician(e.target.checked)} className="accent-blue-500" title="Group by Technician" />
                Technician
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={byBranch} onChange={e => setByBranch(e.target.checked)} className="accent-blue-500" title="Group by Branch" />
                Branch
              </label>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warranty Type*</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={inWarranty} onChange={e => setInWarranty(e.target.checked)} className="accent-blue-500" title="Include In-warranty" />
                In-warranty
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={outOfWarranty} onChange={e => setOutOfWarranty(e.target.checked)} className="accent-blue-500" title="Include Out-of-warranty" />
                Out-of-warranty
              </label>
            </div>
            
          </div>

          {/* Row 2: Date mode — all type="date" for cross-browser support */}
          <DateRangeRow
            dateMode={dateMode} setDateMode={setDateMode}
            monthStart={monthStart} setMonthStart={setMonthStart}
            monthEnd={monthEnd} setMonthEnd={setMonthEnd}
            weekStart={weekStart} setWeekStart={setWeekStart}
            weekEnd={weekEnd} setWeekEnd={setWeekEnd}
            dayStart={dayStart} setDayStart={setDayStart}
            dayEnd={dayEnd} setDayEnd={setDayEnd}
          />
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Total Tickets", value: rows.length, color: "text-blue-400" },
          { label: "Avg TAT (days)", value: avgTat, color: avgTat<=3?"text-green-400":avgTat<=7?"text-yellow-400":"text-red-400" },
          { label: "Good (≤ 3 days)", value: rows.filter(r=>r.status==="Good").length, color: "text-green-400" },
          { label: "Slow (> 7 days)", value: rows.filter(r=>r.status==="Slow").length, color: "text-red-400" },
        ].map(k => (
          <div key={k.label} className="panel py-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Summary Table */}
      <div className="panel panel-filter mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">
            Statistics ({byTechnician ? "by Technician" : byBranch ? "by Branch" : "Monthly"})
          </h2>
          <button onClick={() => setShowDetail(d => !d)} className="btn text-xs">
            {showDetail ? "Hide Detail" : "Show Detail"}
          </button>
        </div>
        <TatSummary rows={rows} groupBy={groupBy} />
      </div>

      {/* Detail Table */}
      {showDetail && (
        <div className="panel overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold">
              Detail Records
              <span className="ml-2 text-xs text-muted-foreground font-normal">({rows.length} records)</span>
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["#","Ticket No","Technician","Branch","Customer","Appliance","Warranty","Open Date","Close Date","TAT (days)","Status"].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    No records match the current filters. Adjust and click Refresh.
                  </td>
                </tr>
              ) : rows.map((row, idx) => (
                <tr key={row.id} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{row.ticketNo}</td>
                  <td className="px-3 py-2.5">{row.tech}</td>
                  <td className="px-3 py-2.5">{row.branch}</td>
                  <td className="px-3 py-2.5">{row.customer}</td>
                  <td className="px-3 py-2.5">{row.appliance}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      row.warrantyType==="In-warranty"
                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                        : "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                    }`}>{row.warrantyType}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.openDate}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.closeDate}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={row.tat<=3?"text-green-400 font-semibold":row.tat<=7?"text-yellow-400":"text-red-400 font-semibold"}>
                      {row.tat}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[row.status]}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
