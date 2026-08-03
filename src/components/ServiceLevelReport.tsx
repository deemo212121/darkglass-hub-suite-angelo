import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const COMPLETE_MODES = ["Completed","Cancelled","All"];

function generateRows(count = 60) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const comp = new Date(); comp.setDate(comp.getDate()-1-(i%30));
    const ftf = i%3!==2; const tat = 1+(i*3)%14;
    return {
      id: i+1, ticketNo: "TK-2026-"+pad(9000+i),
      location: pick(locs,i), tech: pick(TECHS_FULL,i),
      completedDate: comp.toISOString().slice(0,10),
      ftf, tat, slaTarget: 7,
      slaMet: tat<=7, jobType: pick(["In-Warranty","OOW","Exchange"],i),
    };
  });
}
const ALL_ROWS = generateRows(60);

function SimpleDropdown({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1">
      <button aria-label={`Select ${label}`} aria-expanded={open} onClick={()=>setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value||`All ${label}`}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`}/>
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          <button onClick={()=>{onChange("");setOpen(false);}} className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-white/5">— All —</button>
          {options.map(o=>(
            <button key={o} onClick={()=>{onChange(o);setOpen(false);}}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===o?"bg-blue-600 text-white":""}`}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ServiceLevelReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [tech, setTech] = useState("");
  const [completeMode, setCompleteMode] = useState("Completed");
  const [startDate, setStartDate] = useState(offsetStr(-30));
  const [endDate, setEndDate] = useState(todayStr());

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (tech) r = r.filter(x=>x.tech===tech);
    if (startDate) r = r.filter(x=>x.completedDate>=startDate);
    if (endDate) r = r.filter(x=>x.completedDate<=endDate);
    return r;
  }, [endDate, location, startDate, tech]);

  const slaMet = rows.filter(r=>r.slaMet).length;
  const slaRate = rows.length ? Math.round(slaMet/rows.length*100) : 0;
  const ftfCount = rows.filter(r=>r.ftf).length;
  const ftfRate = rows.length ? Math.round(ftfCount/rows.length*100) : 0;

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Service Level Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Service Level Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <SimpleDropdown label="Location" options={LOCATIONS.slice(1)} value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Technician</span>
            <SimpleDropdown label="Technician" options={TECHS_FULL} value={tech} onChange={setTech}/>
          </div>
          <div className="flex items-center gap-2">
            <select value={completeMode} onChange={e=>setCompleteMode(e.target.value)} title="Completion mode" aria-label="Completion mode" className="glass-input text-sm py-1.5 px-2 rounded-md">
              {COMPLETE_MODES.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={()=>setCompleteMode("")} className="btn text-xs px-2 py-1">Clear</button>
            <label htmlFor="slr-start" className="sr-only">Start date</label>
            <input id="slr-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="slr-end" className="sr-only">End date</label>
            <input id="slr-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          {label:"Total",value:rows.length,color:"text-blue-400"},
          {label:"SLA Met",value:slaMet,color:"text-green-400"},
          {label:"SLA Rate",value:slaRate+"%",color:slaRate>=90?"text-green-400":slaRate>=75?"text-yellow-400":"text-red-400"},
          {label:"FTF Rate",value:ftfRate+"%",color:ftfRate>=80?"text-green-400":ftfRate>=65?"text-yellow-400":"text-red-400"},
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
              {["#","Ticket No","Location","Technician","Job Type","Completed","TAT (days)","SLA Met","FTF"].map(h=>(
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
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5 text-xs">{r.jobType}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.completedDate}</td>
                  <td className="px-3 py-2.5 text-right"><span className={r.tat<=7?"text-green-400":r.tat<=10?"text-yellow-400":"text-red-400 font-semibold"}>{r.tat}</span></td>
                  <td className="px-3 py-2.5 text-center">{r.slaMet?"✓":"✗"}</td>
                  <td className="px-3 py-2.5 text-center">{r.ftf?"✓":"—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
