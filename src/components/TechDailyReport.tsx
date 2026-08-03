import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function generateActivityRows(count = 40) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate()-(i%7));
    return {
      id: i+1, date: d.toISOString().slice(0,10),
      location: pick(locs,i), tech: pick(TECHS_FULL,i),
      assigned: 8+(i%6), rescheduled: i%4, cancelled: i%3===0?1:0, completed: 5+(i%6),
    };
  });
}
function generateRevenueRows(count = 40) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate()-(i%7));
    return {
      id: i+1, date: d.toISOString().slice(0,10),
      location: pick(locs,i), tech: pick(TECHS_FULL,i),
      laborRevenue: 150+(i*37)%800, partsRevenue: 80+(i*23)%400,
      totalRevenue: (150+(i*37)%800)+(80+(i*23)%400),
    };
  });
}
const ACT_ROWS = generateActivityRows(40);
const REV_ROWS = generateRevenueRows(40);

function LocationDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1">
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

export function TechDailyReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(offsetStr(-7));
  const [endDate, setEndDate] = useState(offsetStr(-1));

  const actRows = useMemo(() => {
    let r = ACT_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.date>=startDate);
    if (endDate) r = r.filter(x=>x.date<=endDate);
    return r;
  }, [endDate, location, startDate]);

  const revRows = useMemo(() => {
    let r = REV_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.date>=startDate);
    if (endDate) r = r.filter(x=>x.date<=endDate);
    return r;
  }, [endDate, location, startDate]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Tech Daily Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Tech Daily Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <LocationDropdown value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="tdr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
            <input id="tdr-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="tdr-end" className="sr-only">End date</label>
            <input id="tdr-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          
        </div>
      </div>

      {/* Activity Section */}
      <div className="panel panel-filter mb-5">
        <h2 className="text-base font-semibold mb-2">Repair Activity Daily Summary</h2>
        <div className="text-xs text-muted-foreground mb-3 space-y-0.5">
          <p>* Assigned: # of Technician Visit. If a technician visited 2 times for same ticket #, then the # of assigned is 2.</p>
          <p>* Rescheduled (=Pending): Not completed and not cancelled at the visit</p>
          <p>* Cancelled: Cancelled at the visit</p>
          <p>* Completed: Completed at the visit</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["Date","Location","Technician","Assigned","Rescheduled","Cancelled","Completed"].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actRows.length===0
                ? <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No data. Click Refresh.</td></tr>
                : actRows.map((r,idx)=>(
                  <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                    <td className="px-3 py-2 text-muted-foreground">{r.date}</td>
                    <td className="px-3 py-2">{r.location}</td>
                    <td className="px-3 py-2">{r.tech}</td>
                    <td className="px-3 py-2 text-right font-medium">{r.assigned}</td>
                    <td className="px-3 py-2 text-right text-yellow-400">{r.rescheduled}</td>
                    <td className="px-3 py-2 text-right text-red-400">{r.cancelled}</td>
                    <td className="px-3 py-2 text-right text-green-400">{r.completed}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revenue Section */}
      <div className="panel">
        <h2 className="text-base font-semibold mb-3">Revenue Summary</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["Date","Location","Technician","Labor Revenue","Parts Revenue","Total Revenue"].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {revRows.length===0
                ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No data. Click Refresh.</td></tr>
                : revRows.map((r,idx)=>(
                  <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                    <td className="px-3 py-2 text-muted-foreground">{r.date}</td>
                    <td className="px-3 py-2">{r.location}</td>
                    <td className="px-3 py-2">{r.tech}</td>
                    <td className="px-3 py-2 text-right">${r.laborRevenue.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">${r.partsRevenue.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium text-green-400">${r.totalRevenue.toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
