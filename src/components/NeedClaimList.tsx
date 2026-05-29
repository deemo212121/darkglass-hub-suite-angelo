import { useState, useMemo } from "react";
import { ChevronLeft, RefreshCw, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

const LOCATIONS = [
  "","Asheville","Atlanta","Birmingham","Cape Girardeau","Chattanooga","Columbus",
  "Dallas","Destin","Huntsville","Jackson,MS","Jackson,TN","Jacksonville","Jonesboro",
  "Knoxville","Lake Charles","Little Rock","Louisville","Memphis","Mobile","Montgomery",
  "Nashville","Norfolk","Richmond","San Antonio","St. Louis",
];

const DAY_OPTIONS = ["30 days","60 days","90 days","120 days","180 days","365 days"];

function getDefaultDates(days = 90) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function generateRows(count = 60) {
  const TECHS = ["A. Reyes","M. Patel","J. Kim","S. Brown","L. Ortiz","R. Chen"];
  const CUSTOMERS = ["John Doe","Jane Smith","Acme LLC","Beth Larsen","Carlos Mora","Priya Shah","Tom O'Neil","Lily Park"];
  const APPLIANCES = ["Washer","Dryer","Refrigerator","Range/Oven","Dishwasher","Microwave"];
  const COMPANIES = ["Samsung","LG","Whirlpool","GE Appliances","Bosch","Electrolux"];
  const STATUSES: Array<"Ready to Complete" | "Cancelled" | "Claimed"> = ["Ready to Complete","Cancelled","Claimed"];
  const LOCS = LOCATIONS.slice(1);
  const pick = <T,>(a: T[], i: number) => a[i % a.length];
  const pad = (n: number) => String(n).padStart(4, "0");
  const dateStr = (offset: number) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    ticketNo: "TK-2026-" + pad(1000 + i),
    location: pick(LOCS, i),
    completedDate: dateStr(-(i % 85)),
    status: pick(STATUSES, i) as "Ready to Complete" | "Cancelled" | "Claimed",
    tech: pick(TECHS, i),
    customer: pick(CUSTOMERS, i),
    appliance: pick(APPLIANCES, i),
    claimCompany: pick(COMPANIES, i),
    amount: 80 + (i * 37) % 600,
  }));
}

const ALL_ROWS = generateRows(60);

const STATUS_COLORS: Record<string, string> = {
  "Ready to Complete": "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  "Cancelled": "bg-red-500/20 text-red-300 border border-red-500/30",
  "Claimed": "bg-green-500/20 text-green-300 border border-green-500/30",
};

export function NeedClaimList({ mod, sub }: Props) {
  const def = getDefaultDates(90);
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(def.start);
  const [endDate, setEndDate] = useState(def.end);
  const [dayRange, setDayRange] = useState("90 days");
  const [ticketSearch, setTicketSearch] = useState("");
  const [readyToComplete, setReadyToComplete] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [applied, setApplied] = useState({ location: "", startDate: def.start, endDate: def.end, ticketSearch: "", readyToComplete: false, cancelled: false, claimed: false });

  const handleDayChange = (val: string) => {
    setDayRange(val);
    const days = parseInt(val);
    const { start, end } = getDefaultDates(days);
    setStartDate(start);
    setEndDate(end);
  };

  const handleRefresh = () => {
    setApplied({ location, startDate, endDate, ticketSearch, readyToComplete, cancelled, claimed });
  };

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (applied.location) r = r.filter(x => x.location === applied.location);
    if (applied.ticketSearch) r = r.filter(x => x.ticketNo.toLowerCase().includes(applied.ticketSearch.toLowerCase()));
    if (applied.startDate) r = r.filter(x => x.completedDate >= applied.startDate);
    if (applied.endDate) r = r.filter(x => x.completedDate <= applied.endDate);
    const statusFilter = [
      applied.readyToComplete && "Ready to Complete",
      applied.cancelled && "Cancelled",
      applied.claimed && "Claimed",
    ].filter(Boolean) as string[];
    if (statusFilter.length) r = r.filter(x => statusFilter.includes(x.status));
    return r;
  }, [applied]);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground transition-colors">🏠</Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground transition-colors">Claim</Link>
        <span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>

      {/* Page Title */}
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          Need Claim List
          <span className="text-muted-foreground cursor-help text-base" title="Tickets that are completed or cancelled and require claim processing">ⓘ</span>
        </h1>
      </div>

      {/* Caution Banner */}
      <div className="mb-4 px-4 py-2.5 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm">
        ⚠ Caution: result message from verification — always verify information entered for claim process. Make sure to check with your claim companies when your claim request is denied.
      </div>

      {/* Filter Bar */}
      <div className="panel mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Location */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs text-muted-foreground font-medium">Location</label>
            <select
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="glass-input text-sm py-1.5 px-2 rounded-md"
            >
              {LOCATIONS.map(l => (
                <option key={l} value={l}>{l || "All Locations"}</option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Completed / Cancelled</label>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="glass-input text-sm py-1.5 px-2 rounded-md w-[130px]"
              />
              <span className="text-muted-foreground">~</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="glass-input text-sm py-1.5 px-2 rounded-md w-[130px]"
              />
              <select
                value={dayRange}
                onChange={e => handleDayChange(e.target.value)}
                className="glass-input text-sm py-1.5 px-2 rounded-md"
              >
                {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Ticket No Search */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs text-muted-foreground font-medium">Ticket No</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search ticket..."
                value={ticketSearch}
                onChange={e => setTicketSearch(e.target.value)}
                className="glass-input text-sm py-1.5 pl-7 pr-2 rounded-md w-full"
              />
            </div>
          </div>

          {/* Status Checkboxes */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium invisible">Status</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={readyToComplete}
                  onChange={e => setReadyToComplete(e.target.checked)}
                  className="accent-blue-500"
                />
                <span>Ready to Complete</span>
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelled}
                  onChange={e => setCancelled(e.target.checked)}
                  className="accent-blue-500"
                />
                <span>Cancelled</span>
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={claimed}
                  onChange={e => setClaimed(e.target.checked)}
                  className="accent-blue-500"
                />
                <span>Claimed</span>
              </label>
            </div>
          </div>

          {/* Refresh Button */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium invisible">Action</label>
            <button
              onClick={handleRefresh}
              className="btn btn-primary flex items-center gap-2 px-4"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-2 text-sm text-muted-foreground">
        Showing <span className="text-foreground font-medium">{rows.length}</span> record{rows.length !== 1 ? "s" : ""}
      </div>

      {/* Table */}
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">#</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Completed/Cancelled</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Technician</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Appliance</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim Co.</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                  No records found. Adjust filters and click Refresh.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-b border-white/5 hover:bg-white/5 transition-colors ${idx % 2 === 0 ? "" : "bg-white/[0.02]"}`}
                >
                  <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400 hover:text-blue-300 cursor-pointer">{row.ticketNo}</td>
                  <td className="px-3 py-2.5">{row.location}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.completedDate}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? ""}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{row.tech}</td>
                  <td className="px-3 py-2.5">{row.customer}</td>
                  <td className="px-3 py-2.5">{row.appliance}</td>
                  <td className="px-3 py-2.5">{row.claimCompany}</td>
                  <td className="px-3 py-2.5 text-right font-medium">${row.amount.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
