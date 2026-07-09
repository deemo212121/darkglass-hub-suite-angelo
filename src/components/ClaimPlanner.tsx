import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const CLAIM_COMPANIES = ["Samsung","LG","Whirlpool","GE Appliances","Bosch","Electrolux"];
const TECHS = ["Damon Ottley","Marc James","Nathan Wagner","Christian Clark","Gabriel Talley","Josh Malloch"];

const ALL_ROWS = Array.from({length:40},(_,i)=>{
  const d = new Date(); d.setDate(d.getDate()+(i%14)-7);
  return {
    id:i+1, claimNo:"CLM-"+pad(90000+i), ticketNo:"TK-2026-"+pad(1000+i),
    location:pick(LOCATIONS.slice(1),i), tech:pick(TECHS,i),
    claimCompany:pick(CLAIM_COMPANIES,i),
    plannedDate:d.toISOString().slice(0,10),
    status:pick(["Completed","Open","Pending"],i),
    amount:100+(i*43)%900,
  };
});

const STATUS_CHIP: Record<string,string> = {
  Completed:"bg-green-500/20 text-green-300 border border-green-500/30",
  Open:"bg-blue-500/20 text-blue-300 border border-blue-500/30",
  Pending:"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
};

export function ClaimPlanner({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [statusCompleted, setStatusCompleted] = useState(true);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [date, setDate] = useState(todayStr());
  const locRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const prevDay = () => { const d=new Date(date); d.setDate(d.getDate()-1); setDate(d.toISOString().slice(0,10)); };
  const nextDay = () => { const d=new Date(date); d.setDate(d.getDate()+1); setDate(d.toISOString().slice(0,10)); };

  const activeStatuses = [
    statusCompleted && "Completed",
    statusOpen && "Open",
    statusPending && "Pending",
  ].filter(Boolean) as string[];

  const rows = useMemo(() => ALL_ROWS.filter(r => {
    if (location && r.location !== location) return false;
    if (activeStatuses.length && !activeStatuses.includes(r.status)) return false;
    return true;
  }), [location, statusCompleted, statusOpen, statusPending]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Claim Planner</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Claim Planner</h1>
      </div>

      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-4">
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
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Status</span>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={statusCompleted} onChange={e=>setStatusCompleted(e.target.checked)} className="accent-blue-500"/>Completed
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={statusOpen} onChange={e=>setStatusOpen(e.target.checked)} className="accent-blue-500"/>Open
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={statusPending} onChange={e=>setStatusPending(e.target.checked)} className="accent-blue-500"/>Pending
            </label>
          </div>
        </div>
      </div>

      <div className="panel mb-4">
        <div className="flex items-center justify-center gap-3">
          <button onClick={prevDay} className="btn p-1.5" aria-label="Previous day"><ChevronLeft className="h-4 w-4"/></button>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)}
            className="glass-input text-sm py-1.5 px-3 rounded-md w-40 text-center"/>
          <button onClick={nextDay} className="btn p-1.5" aria-label="Next day"><ChevronRight className="h-4 w-4"/></button>
        </div>
      </div>

      <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records</div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Claim No","Ticket No","Location","Technician","Claim Company","Planned Date","Status","Amount"].map(h=>(
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
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.claimNo}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400"><Link to="/ticket/$ticketNo" params={{ticketNo:r.ticketNo}} className="font-mono text-xs text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">{r.ticketNo}</Link></td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5">{r.claimCompany}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.plannedDate}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.status]}`}>{r.status}</span></td>
                  <td className="px-3 py-2.5 text-right">${r.amount.toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
