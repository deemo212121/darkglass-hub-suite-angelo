import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function generateRows(count = 60) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate()-(i%14));
    const assigned = 8+(i%8); const completed = 5+(i%8); const eff = Math.round(completed/assigned*100);
    return {
      id: i+1, schedDate: d.toISOString().slice(0,10),
      location: pick(locs,i), tech: pick(TECHS_FULL,i),
      assigned, rescheduled: i%4, cancelled: i%3===0?1:0, completed,
      efficiency: eff, avgJobTime: 45+(i*7)%90,
    };
  });
}
const ALL_ROWS = generateRows(60);

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

export function TechEfficiencyReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(offsetStr(-14));
  const [endDate, setEndDate] = useState(offsetStr(-1));

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.schedDate>=startDate);
    if (endDate) r = r.filter(x=>x.schedDate<=endDate);
    return r;
  }, [endDate, location, startDate]);

  const avgEff = rows.length ? Math.round(rows.reduce((s,r)=>s+r.efficiency,0)/rows.length) : 0;

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Tech Efficiency Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Tech Efficiency Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <LocationDropdown value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="ter-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Schedule Date</label>
            <input id="ter-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="ter-end" className="sr-only">End date</label>
            <input id="ter-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          {label:"Records",value:rows.length,color:"text-blue-400"},
          {label:"Total Assigned",value:rows.reduce((s,r)=>s+r.assigned,0),color:"text-cyan-400"},
          {label:"Total Completed",value:rows.reduce((s,r)=>s+r.completed,0),color:"text-green-400"},
          {label:"Avg Efficiency",value:avgEff+"%",color:avgEff>=80?"text-green-400":avgEff>=65?"text-yellow-400":"text-red-400"},
        ].map(k=>(
          <div key={k.label} className="panel py-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Date","Location","Technician","Assigned","Rescheduled","Cancelled","Completed","Efficiency %","Avg Job Time (min)"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.schedDate}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5 text-right">{r.assigned}</td>
                  <td className="px-3 py-2.5 text-right text-yellow-400">{r.rescheduled}</td>
                  <td className="px-3 py-2.5 text-right text-red-400">{r.cancelled}</td>
                  <td className="px-3 py-2.5 text-right text-green-400 font-medium">{r.completed}</td>
                  <td className="px-3 py-2.5 text-right"><span className={r.efficiency>=80?"text-green-400 font-semibold":r.efficiency>=65?"text-yellow-400":"text-red-400"}>{r.efficiency}%</span></td>
                  <td className="px-3 py-2.5 text-right">{r.avgJobTime}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
