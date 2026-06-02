import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, CSR_NAMES, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function isoWeek(date: Date) {
  const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate()+3-((d.getDay()+6)%7));
  const w1 = new Date(d.getFullYear(),0,4);
  const wn = 1+Math.round(((d.getTime()-w1.getTime())/86400000-3+((w1.getDay()+6)%7))/7);
  return `${d.getFullYear()}-W${String(wn).padStart(2,"0")}`;
}

function generateRows(count = 60, mode: "employee"|"tech") {
  const names = mode==="tech" ? TECHS_FULL : CSR_NAMES.slice(0,15);
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate()-(i%14));
    const clockIn = `${String(7+(i%2)).padStart(2,"0")}:${String((i*7)%60).padStart(2,"0")} AM`;
    const stayed = 6+(i%3); const down = i%4===0?0.5:0; const total = stayed-down;
    return {
      id: i+1, name: pick(names,i), location: pick(locs,i),
      date: d.toISOString().slice(0,10), week: isoWeek(d),
      clockIn, downTime: down, stayedTime: stayed, totalWorkTime: total,
    };
  });
}

function LocationDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative min-w-40 flex-1">
      <button aria-label="Select location" aria-expanded={open} onClick={()=>setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value||"All Locations"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`}/>
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          {LOCATIONS.map((l,i)=>(
            <button key={i} onClick={()=>{onChange(l);setOpen(false);}}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===l?"bg-blue-600 text-white":l===""?"text-muted-foreground":""}`}>
              {l||"— All Locations —"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeDropdown({ names, value, onChange }: { names: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative min-w-40 flex-1">
      <button aria-label="Select employee" aria-expanded={open} onClick={()=>setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value||"All"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`}/>
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          <button onClick={()=>{onChange("");setOpen(false);}} className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-white/5">— All —</button>
          {names.map(n=>(
            <button key={n} onClick={()=>{onChange(n);setOpen(false);}}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===n?"bg-blue-600 text-white":""}`}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimecardReport({ mod, sub }: Props) {
  const [activeTab, setActiveTab] = useState<"employee"|"tech">("employee");
  const [location, setLocation] = useState("");
  const [employee, setEmployee] = useState("");
  const [attendanceMode, setAttendanceMode] = useState<"week"|"date">("week");
  const [week, setWeek] = useState(isoWeek(new Date()));
  const [startDate, setStartDate] = useState(offsetStr(-14));
  const [endDate, setEndDate] = useState(todayStr());

  const empNames = activeTab==="tech" ? TECHS_FULL : CSR_NAMES.slice(0,15);
  const ALL_ROWS = useMemo(()=>generateRows(60, tab), [tab]);

  const rows = useMemo(()=>{
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (employee) r = r.filter(x=>x.name===employee);
    if (startDate) r = r.filter(x=>x.date>=startDate);
    if (endDate) r = r.filter(x=>x.date<=endDate);
    return r;
  }, [ALL_ROWS]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Timecard Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Timecard Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <LocationDropdown value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Employee</span>
            <EmployeeDropdown names={empNames} value={employee} onChange={setEmployee}/>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="tc-mode" checked={attendanceMode==="week"} onChange={()=>setAttendanceMode("week")} className="accent-blue-500" title="Attendance Week"/>
              Attendance Week
            </label>
            <div className={`flex items-center gap-1 transition-opacity ${attendanceMode!=="week"?"opacity-40 pointer-events-none":""}`}>
              <label htmlFor="tc-week" className="sr-only">Week</label>
              <input id="tc-week" type="text" value={week} readOnly placeholder="2026-W21" title="Attendance week" className="glass-input text-sm py-1.5 px-2 rounded-md w-28"/>
            </div>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2">
              <input type="radio" name="tc-mode" checked={attendanceMode==="date"} onChange={()=>setAttendanceMode("date")} className="accent-blue-500" title="Attendance Date"/>
              Attendance Date
            </label>
            <div className={`flex items-center gap-1 transition-opacity ${attendanceMode!=="date"?"opacity-40 pointer-events-none":""}`}>
              <label htmlFor="tc-start" className="sr-only">Start date</label>
              <input id="tc-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
              <span className="text-muted-foreground text-xs">~</span>
              <label htmlFor="tc-end" className="sr-only">End date</label>
              <input id="tc-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            </div>
          </div>
          
          <button className="btn px-4">Save</button>
        </div>
      </div>

      {/* Employee / Technician tabs */}
      <div className="flex items-center gap-2 mb-4">
        {(["employee","tech"] as const).map(tab=>(
          <button key={tab} onClick={()=>{setActiveTab(tab);setEmployee("");}}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab===tab?"bg-blue-600 text-white":"btn"}`}>
            {tab.charAt(0).toUpperCase()+tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Notes */}
      <div className="text-xs text-muted-foreground mb-4 space-y-0.5">
        <p>* Down Time: the interval between previous check-out time and current on-my-way time</p>
        <p>* Stayed Time: the interval between check-in time and check-out time</p>
        <p>* Total Work Time: the interval between on-my-way time and check-out time</p>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Name","Location","Date","Week","Clock In","Down Time (h)","Stayed Time (h)","Total Work Time (h)"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.date}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{r.week}</td>
                  <td className="px-3 py-2.5">{r.clockIn}</td>
                  <td className="px-3 py-2.5 text-right text-red-400">{r.downTime}</td>
                  <td className="px-3 py-2.5 text-right">{r.stayedTime}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-green-400">{r.totalWorkTime}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
