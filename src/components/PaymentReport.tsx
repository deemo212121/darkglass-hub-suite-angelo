import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const PAYROLL_DATES = ["(custom)","05/13/2026 ~ 05/26/2026","04/28/2026 ~ 05/12/2026","04/11/2026 ~ 04/27/2026",
  "03/27/2026 ~ 04/10/2026","03/11/2026 ~ 03/26/2026","02/25/2026 ~ 03/10/2026","02/11/2026 ~ 02/24/2026",
  "01/28/2026 ~ 02/10/2026","01/13/2026 ~ 01/27/2026","12/27/2025 ~ 01/12/2026","12/11/2025 ~ 12/26/2025",
  "11/25/2025 ~ 12/10/2025","11/12/2025 ~ 11/24/2025","10/29/2025 ~ 11/11/2025"];
const PAY_STATUSES = ["Not-Paid","Paid","On-Hold","Cancelled"];
const CHIP: Record<string,string> = {
  Paid:"bg-green-500/20 text-green-300 border border-green-500/30",
  "Not-Paid":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  "On-Hold":"bg-orange-500/20 text-orange-300 border border-orange-500/30",
  Cancelled:"bg-red-500/20 text-red-300 border border-red-500/30",
};
const ALL_ROWS = Array.from({length:60},(_,i)=>{
  const d=new Date(); d.setDate(d.getDate()-1-(i%30));
  return { id:i+1, ticketNo:"TK-2026-"+pad(1000+i), location:pick(LOCATIONS.slice(1),i),
    tech:pick(TECHS_FULL,i), completeDate:d.toISOString().slice(0,10),
    laborAmount:80+(i*23)%400, techPaid:i%3===0, cancelled:i%7===0, payStatus:pick(PAY_STATUSES,i) };
});

export function PaymentReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [tech, setTech] = useState("");
  const [techOpen, setTechOpen] = useState(false);
  const [payrollDate, setPayrollDate] = useState("(custom)");
  const [startDate, setStartDate] = useState(offsetStr(-1));
  const [endDate, setEndDate] = useState(todayStr());
  const [techPaid, setTechPaid] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const locRef = useRef<HTMLDivElement>(null);
  const techRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
      if (techRef.current && !techRef.current.contains(e.target as Node)) setTechOpen(false);
    };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const rows = useMemo(()=>{
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (tech) r = r.filter(x=>x.tech===tech);
    if (startDate) r = r.filter(x=>x.completeDate>=startDate);
    if (endDate) r = r.filter(x=>x.completeDate<=endDate);
    if (techPaid) r = r.filter(x=>x.techPaid);
    if (cancelled) r = r.filter(x=>x.cancelled);
    return r;
  }, [location, tech, startDate, endDate, techPaid, cancelled]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Payment Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Payment Report</h1>
      </div>
      <div className="panel panel-filter mb-3 py-2 px-4">
        <p className="text-xs text-muted-foreground">*Note: On-Hold means the bill claim is not approved yet. When it is approved, it goes to Not-Paid status automatically.</p>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-40">
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
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Technician</span>
            <div ref={techRef} className="relative flex-1">
              <button aria-label="Select technician" aria-expanded={techOpen} onClick={()=>setTechOpen(o=>!o)}
                className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={tech?"":"text-muted-foreground"}>{tech||"All Technicians"}</span>
                <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${techOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {techOpen && (
                <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
                  <button onClick={()=>{setTech("");setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===""?"bg-blue-600 text-white":"text-muted-foreground"}`}>— All Technicians —</button>
                  {TECHS_FULL.map((t,i)=>(
                    <button key={i} onClick={()=>{setTech(t);setTechOpen(false);}}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===t?"bg-blue-600 text-white":""}`}>{t}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Payroll Date</span>
            <select value={payrollDate} onChange={e=>setPayrollDate(e.target.value)} aria-label="Payroll date" className="glass-input text-sm py-1.5 px-2 rounded-md w-52">
              {PAYROLL_DATES.map(d=><option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Complete Date</span>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={techPaid} onChange={e=>setTechPaid(e.target.checked)} className="accent-blue-500"/>Tech Paid
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={cancelled} onChange={e=>setCancelled(e.target.checked)} className="accent-blue-500"/>Cancelled
          </label>
        </div>
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {["#","Ticket No","Location","Technician","Complete Date","Labor $","Tech Paid","Status"].map(h=>(
              <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.completeDate}</td>
                  <td className="px-3 py-2.5 text-right">${r.laborAmount.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-center">{r.techPaid?"✓":"—"}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${CHIP[r.payStatus]||""}`}>{r.payStatus}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
