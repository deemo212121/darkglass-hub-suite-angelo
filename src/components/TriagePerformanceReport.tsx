import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function generateRows(count = 60) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate()-1-(i%30));
    const calls = 5+(i%8); const resolved = 3+(i%7); const escalated = i%5===0?1:0;
    return {
      id: i+1, ticketNo: "TK-2026-"+pad(3000+i),
      location: pick(locs,i), tech: pick(TECHS_FULL,i),
      completeDate: d.toISOString().slice(0,10),
      triageCalls: calls, resolved, escalated,
      resolutionRate: Math.round(resolved/calls*100),
      outcome: escalated>0?"Escalated":resolved>=calls-1?"Resolved":"Partial",
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

export function TriagePerformanceReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(offsetStr(-30));
  const [endDate, setEndDate] = useState(offsetStr(-1));

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.completeDate>=startDate);
    if (endDate) r = r.filter(x=>x.completeDate<=endDate);
    return r;
  }, [endDate, location, startDate]);

  const avgRes = rows.length ? Math.round(rows.reduce((s,r)=>s+r.resolutionRate,0)/rows.length) : 0;

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Triage Performance Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Triage Performance Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <LocationDropdown value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="trig-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Complete Date</label>
            <input id="trig-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="trig-end" className="sr-only">End date</label>
            <input id="trig-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          {label:"Total",value:rows.length,color:"text-blue-400"},
          {label:"Total Calls",value:rows.reduce((s,r)=>s+r.triageCalls,0),color:"text-cyan-400"},
          {label:"Resolved",value:rows.reduce((s,r)=>s+r.resolved,0),color:"text-green-400"},
          {label:"Avg Resolution",value:avgRes+"%",color:avgRes>=80?"text-green-400":avgRes>=65?"text-yellow-400":"text-red-400"},
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
              {["#","Ticket No","Location","Technician","Complete Date","Calls","Resolved","Escalated","Resolution %","Outcome"].map(h=>(
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
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.completeDate}</td>
                  <td className="px-3 py-2.5 text-right">{r.triageCalls}</td>
                  <td className="px-3 py-2.5 text-right text-green-400">{r.resolved}</td>
                  <td className="px-3 py-2.5 text-right text-red-400">{r.escalated||"—"}</td>
                  <td className="px-3 py-2.5 text-right"><span className={r.resolutionRate>=80?"text-green-400 font-semibold":r.resolutionRate>=65?"text-yellow-400":"text-red-400"}>{r.resolutionRate}%</span></td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.outcome==="Resolved"?"bg-green-500/20 text-green-300 border border-green-500/30":r.outcome==="Escalated"?"bg-red-500/20 text-red-300 border border-red-500/30":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"}`}>
                      {r.outcome}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
