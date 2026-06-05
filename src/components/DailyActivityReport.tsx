import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, USER_TYPES, SERVICE_TYPES_SS, pick, pad, todayStr, offsetStr } from "@/components/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const TARGET_USERS = ["Claim Manager","CSR","HR","Manager","Part Manager","Superuser","Tech Manager","Technician"];
const TIMES = ["00:00 AM","06:00 AM","07:00 AM","08:00 AM","09:00 AM","10:00 AM","11:00 AM","12:00 PM","01:00 PM","02:00 PM","03:00 PM","04:00 PM","05:00 PM","06:00 PM"];
const ACTIONS = ["Login","Logout","View Ticket","Create Ticket","Update Ticket","Schedule","Cancel","Part Order","Note","Status Change"];

function generateRows(count = 80) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (i % 3));
    return {
      id: i + 1, ticketNo: i % 5 === 0 ? "" : "TK-2026-" + pad(3000 + i),
      location: pick(LOCATIONS.slice(1), i), userType: pick(TARGET_USERS, i),
      workDate: d.toISOString().slice(0, 10), time: pick(TIMES.slice(3), i),
      action: pick(ACTIONS, i), user: pick(["J. Lucas","A. Simmons","E. Guzman","D. Ottley","C. Forrest"], i),
      ticketsTodo: 5 + (i % 12),
    };
  });
}
const ALL_ROWS = generateRows(80);

function MultiCheckDropdown({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const all = selected.length === options.length;
  const display = all ? options.join(", ") : selected.join(", ") || "None";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label={`Select ${label}`} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2 text-left">
          <span className="truncate text-xs">{display}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(90vw,20rem)] sm:w-80 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-slate-950 p-0 text-white shadow-xl">
        <label className="flex cursor-pointer items-center gap-2 border-b border-white/10 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10">
          <input
            type="checkbox"
            checked={all}
            onChange={() => onChange(all ? [] : [...options])}
            className="accent-white"
            title="Select all target users"
          />
          Select All
        </label>
        {options.map(o => (
          <label key={o} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o])} className="accent-white" title={o} />
            {o}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LocationDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Select location" className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
          <span className={value ? "" : "text-muted-foreground"}>{value || "All Locations"}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(90vw,16rem)] sm:w-64 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-slate-950 p-0 text-white shadow-xl">
        {LOCATIONS.map((l, i) => (
          <button key={i} onClick={() => { onChange(l); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${value === l ? "bg-white/10 text-white" : l === "" ? "text-white/60" : "text-white/90"}`}>
            {l || "— All Locations —"}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function DailyActivityReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("00:00 AM");
  const [endDate, setEndDate] = useState(offsetStr(1));
  const [endTime, setEndTime] = useState("00:00 AM");
  const [targetUsers, setTargetUsers] = useState<string[]>([...TARGET_USERS]);

  useEffect(() => {
  }, [location, startDate, endDate, targetUsers]);

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x => x.location === location);
    r = r.filter(x => targetUsers.includes(x.userType));
    if (startDate) r = r.filter(x => x.workDate >= startDate);
    if (endDate) r = r.filter(x => x.workDate <= endDate);
    return r;
  }, [endDate, location, startDate, targetUsers]);

  const totalTicketsTodo = rows.reduce((s, r) => s + r.ticketsTodo, 0);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Daily Activity Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Daily Activity Report</h1>
      </div>

      <div className="panel mb-5 overflow-x-auto">
        <div className="flex min-w-max items-end gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</span>
            <LocationDropdown value={location} onChange={setLocation} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Work Date</span>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <label htmlFor="dar-start" className="sr-only">Start date</label>
              <input id="dar-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
              <select value={startTime} onChange={e => setStartTime(e.target.value)} title="Start time" aria-label="Start time" className="glass-input text-sm py-1.5 px-2 rounded-md w-28 min-w-0">
                {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-muted-foreground text-xs shrink-0">~</span>
              <label htmlFor="dar-end" className="sr-only">End date</label>
              <input id="dar-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
              <select value={endTime} onChange={e => setEndTime(e.target.value)} title="End time" aria-label="End time" className="glass-input text-sm py-1.5 px-2 rounded-md w-28 min-w-0">
                {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Target Users</span>
            <MultiCheckDropdown label="Target Users" options={TARGET_USERS} selected={targetUsers} onChange={setTargetUsers} />
          </div>
        </div>
      </div>

      <div className="flex justify-end mb-2">
        <span className="text-sm text-muted-foreground">TOTAL # of TICKETS TO DO: <span className="text-foreground font-bold text-lg">{totalTicketsTodo.toLocaleString()}</span></span>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Ticket No","User","User Type","Location","Date","Time","Action","Tickets To Do"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r, idx) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx % 2 !== 0 ? "bg-white/2" : ""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo || "—"}</td>
                  <td className="px-3 py-2.5">{r.user}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.userType}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.workDate}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.time}</td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">{r.action}</span></td>
                  <td className="px-3 py-2.5 text-right font-medium">{r.ticketsTodo}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
