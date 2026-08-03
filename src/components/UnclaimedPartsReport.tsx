import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const PARTS=["Motor Assembly","Pump Assembly","Control Board","Door Latch","Thermostat","Heating Element","Belt","Drain Hose","Water Valve","Timer"];
const CHIP:Record<string,string>={Unclaimed:"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30","In Review":"bg-blue-500/20 text-blue-300 border border-blue-500/30",Rejected:"bg-red-500/20 text-red-300 border border-red-500/30"};
const ALL_ROWS=Array.from({length:60},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(i*2)%60);return{id:i+1,ticketNo:"TK-2026-"+pad(1000+i),partNo:"PT-"+pad(70000+i),description:pick(PARTS,i),location:pick(LOCATIONS.slice(1),i),claimDate:d.toISOString().slice(0,10),amount:40+(i*23)%400,claimStatus:pick(["Unclaimed","In Review","Rejected"],i)};});

export function UnclaimedPartsReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [startDate, setStartDate] = useState(offsetStr(-30));
  const [endDate, setEndDate] = useState(todayStr());
  const locRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const rows = useMemo(()=>{let r=ALL_ROWS;if(location)r=r.filter(x=>x.location===location);if(startDate)r=r.filter(x=>x.claimDate>=startDate);if(endDate)r=r.filter(x=>x.claimDate<=endDate);return r;},[location,startDate,endDate]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Unclaimed Parts Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Unclaimed Parts Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
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
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Claim Date</label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
        </div>
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">{["#","Ticket No","Part No","Description","Location","Claim Date","Amount","Status"].map(h=><th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{rows.length===0?<tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>:rows.map((r,idx)=><tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}><td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td><td className="px-3 py-2.5 font-mono text-blue-400"><Link to="/ticket/$ticketNo" params={{ticketNo:r.ticketNo}} className="font-mono text-xs text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">{r.ticketNo}</Link></td><td className="px-3 py-2.5 font-mono text-xs">{r.partNo}</td><td className="px-3 py-2.5">{r.description}</td><td className="px-3 py-2.5">{r.location}</td><td className="px-3 py-2.5 text-muted-foreground">{r.claimDate}</td><td className="px-3 py-2.5 text-right">${r.amount.toFixed(2)}</td><td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${CHIP[r.claimStatus]||""}`}>{r.claimStatus}</span></td></tr>)}</tbody>
        </table>
      </div>
    </main>
  );
}
