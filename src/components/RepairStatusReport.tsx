import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const STATUSES=["TR-Need Triage","TR-Need PO","OP-Waiting for Part","OP-Ready for Service","OP-Reschedule Follow up","CL-Completed","CL-Cancelled","CL-Ready to Complete"];
const ALL_ROWS=Array.from({length:60},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(i%30));return{id:i+1,ticketNo:"TK-2026-"+pad(1000+i),location:pick(LOCATIONS.slice(1),i),tech:pick(TECHS_FULL,i),repairStatus:pick(STATUSES,i),date:d.toISOString().slice(0,10),count:1+(i%5)};});

export function RepairStatusReport({ mod, sub }: Props) {
  const [dataLevel, setDataLevel] = useState<"location"|"tech">("tech");
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [dateType, setDateType] = useState<"monthly"|"daily">("daily");
  const [startDate, setStartDate] = useState(offsetStr(-7));
  const [endDate, setEndDate] = useState(todayStr());
  const locRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const rows = useMemo(()=>{let r=ALL_ROWS;if(location)r=r.filter(x=>x.location===location);if(startDate)r=r.filter(x=>x.date>=startDate);if(endDate)r=r.filter(x=>x.date<=endDate);return r;},[location,startDate,endDate]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Repair Status Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Repair Status Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex items-center gap-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Data Level</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" name="rsr-dl" checked={dataLevel==="location"} onChange={()=>setDataLevel("location")} className="accent-blue-500"/>By Location</label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" name="rsr-dl" checked={dataLevel==="tech"} onChange={()=>setDataLevel("tech")} className="accent-blue-500"/>By Technician</label>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-48">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
              <div ref={locRef} className="relative flex-1">
                <button aria-label="Select location" aria-expanded={locOpen} onClick={()=>setLocOpen(o=>!o)}
                  className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                  <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span>
                  <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${locOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {locOpen && (
                  <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
                    {LOCATIONS.map((l,i)=>(
                      <button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":l===""?"text-muted-foreground":""}`}>
                        {l||"— All Locations —"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Date Type</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" name="rsr-dt" checked={dateType==="monthly"} onChange={()=>setDateType("monthly")} className="accent-blue-500"/>Monthly</label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" name="rsr-dt" checked={dateType==="daily"} onChange={()=>setDateType("daily")} className="accent-blue-500"/>Daily</label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Duration</span>
              <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
              <span className="text-muted-foreground text-xs">~</span>
              <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            </div>
          </div>
        </div>
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">{["#","Ticket No",dataLevel==="tech"?"Technician":"Location","Date","Repair Status","Count"].map(h=><th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{rows.length===0?<tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>:rows.map((r,idx)=><tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}><td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td><td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td><td className="px-3 py-2.5">{dataLevel==="tech"?r.tech:r.location}</td><td className="px-3 py-2.5 text-muted-foreground">{r.date}</td><td className="px-3 py-2.5 text-xs">{r.repairStatus}</td><td className="px-3 py-2.5 text-right">{r.count}</td></tr>)}</tbody>
        </table>
      </div>
    </main>
  );
}
