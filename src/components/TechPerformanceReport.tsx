import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function generateRows(count = 20) {
  const locs = LOCATIONS.slice(1);
  return TECHS_FULL.slice(0, count).map((tech, i) => {
    const jobs = 50+(i*13)%80; const completed = 35+(i*11)%70;
    const ftf = Math.round(completed*0.7+(i%10)); const tat = 3+(i%5);
    const score = Math.round((ftf/completed*40)+(completed/jobs*40)+(Math.max(0,7-tat)/7*20));
    return {
      id: i+1, tech, location: pick(locs,i), jobs, completed,
      ftf, ftfRate: Math.round(ftf/completed*100),
      tat, callbacks: i%4, score, rank: i+1,
    };
  }).sort((a,b)=>b.score-a.score).map((r,i)=>({...r,rank:i+1}));
}
const ALL_ROWS = generateRows(20);

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

export function TechPerformanceReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [tech, setTech] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (tech) r = r.filter(x=>x.tech===tech);
    return r;
  }, [location, tech]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Tech Performance Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Tech Performance Report</h1>
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
            <label htmlFor="tpr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Schedule Date</label>
            <input id="tpr-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="tpr-end" className="sr-only">End date</label>
            <input id="tpr-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          
        </div>
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-700/80">
              {["Rank","Technician","Location","Jobs","Completed","FTF","FTF %","Avg TAT","Callbacks","Score"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-200 whitespace-nowrap border-r border-white/10 last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 font-bold text-center">{r.rank<=3?["🥇","🥈","🥉"][r.rank-1]:r.rank}</td>
                  <td className="px-3 py-2.5 font-medium">{r.tech}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 text-right">{r.jobs}</td>
                  <td className="px-3 py-2.5 text-right">{r.completed}</td>
                  <td className="px-3 py-2.5 text-right">{r.ftf}</td>
                  <td className="px-3 py-2.5 text-right"><span className={r.ftfRate>=80?"text-green-400 font-semibold":r.ftfRate>=65?"text-yellow-400":"text-red-400"}>{r.ftfRate}%</span></td>
                  <td className="px-3 py-2.5 text-right">{r.tat}d</td>
                  <td className="px-3 py-2.5 text-right">{r.callbacks}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-blue-400">{r.score}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
