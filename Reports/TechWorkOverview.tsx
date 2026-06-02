import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const REPAIR_STATUSES = ["TR-Need Triage","TR-Need PO","OP-Waiting for Part","OP-Ready for Service","OP-Reschedule Follow up","CL-Completed","CL-Cancelled"];

function generateRows(count = 60) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const sched = new Date(); sched.setDate(sched.getDate()+(i%7)-3);
    return {
      id: i+1, ticketNo: "TK-2026-"+pad(7000+i),
      location: pick(locs,i), tech: pick(TECHS_FULL,i),
      schedDate: sched.toISOString().slice(0,10),
      repairStatus: pick(REPAIR_STATUSES,i),
      customer: pick(["John Doe","Jane Smith","Acme LLC","Beth Larsen","Carlos Mora"],i),
      appliance: pick(["Washer","Dryer","Refrigerator","Range/Oven","Dishwasher"],i),
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

export function TechWorkOverview({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(todayStr());

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    return r;
  }, [location]);

  const byTech: Record<string,typeof ALL_ROWS> = {};
  rows.forEach(r => { if (!byTech[r.tech]) byTech[r.tech]=[]; byTech[r.tech].push(r); });

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Tech Work Overview</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Tech Work Overview</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <LocationDropdown value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="two-date" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
            <input id="two-date" type="date" value={date} onChange={e=>setDate(e.target.value)} title="Overview date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-40"/>
          </div>
          
        </div>
      </div>
      <div className="space-y-4">
        {Object.entries(byTech).map(([tech, techRows])=>(
          <div key={tech} className="panel p-0 overflow-hidden">
            <div className="px-4 py-2.5 bg-white/5 border-b border-white/10 flex items-center justify-between">
              <span className="font-semibold text-sm">{tech}</span>
              <span className="text-xs text-muted-foreground">{techRows.length} tickets</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {["Ticket No","Location","Schedule Date","Repair Status","Customer","Appliance"].map(h=>(
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {techRows.map((r,idx)=>(
                  <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                    <td className="px-3 py-2 font-mono text-blue-400 text-xs">{r.ticketNo}</td>
                    <td className="px-3 py-2">{r.location}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.schedDate}</td>
                    <td className="px-3 py-2 text-xs">{r.repairStatus}</td>
                    <td className="px-3 py-2">{r.customer}</td>
                    <td className="px-3 py-2">{r.appliance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {Object.keys(byTech).length===0 && (
          <div className="panel py-12 text-center text-muted-foreground">No records. Select a location and click Refresh.</div>
        )}
      </div>
    </main>
  );
}
