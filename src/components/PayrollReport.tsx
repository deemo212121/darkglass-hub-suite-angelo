import { useState, useRef, useEffect } from "react";
import { ChevronLeft, Save } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const PAYROLL_PERIODS = ["(custom)","05/13/2026 ~ 05/26/2026","04/28/2026 ~ 05/12/2026","04/11/2026 ~ 04/27/2026",
  "03/27/2026 ~ 04/10/2026","03/11/2026 ~ 03/26/2026","02/25/2026 ~ 03/10/2026","02/11/2026 ~ 02/24/2026",
  "01/28/2026 ~ 02/10/2026","01/13/2026 ~ 01/27/2026","12/27/2025 ~ 01/12/2026","12/11/2025 ~ 12/26/2025",
  "11/25/2025 ~ 12/10/2025","11/12/2025 ~ 11/24/2025","10/29/2025 ~ 11/11/2025",
  "10/11/2025 ~ 10/28/2025","09/26/2025 ~ 10/10/2025","09/11/2025 ~ 09/25/2025",
  "08/27/2025 ~ 09/10/2025","08/13/2025 ~ 08/26/2025"];
const locs = LOCATIONS.slice(1);
const TECH_ROWS = Array.from({length:30},(_,i)=>({
  id:i+1, tech:pick(TECHS_FULL,i), location:pick(locs,i), jobs:8+(i%12),
  laborTotal:400+(i*73)%2000, partsTotal:100+(i*37)%800, adjustments:i%4===0?-(i*5)%100:0,
  totalPay:(400+(i*73)%2000)+(100+(i*37)%800)+(i%4===0?-(i*5)%100:0),
}));
const CPA_ROWS = Array.from({length:20},(_,i)=>({
  id:i+1, location:pick(locs,i), period:PAYROLL_PERIODS[1+(i%5)],
  totalTechs:3+(i%8), grossPayroll:2000+(i*237)%8000, deductions:200+(i*47)%500,
  netPayroll:(2000+(i*237)%8000)-(200+(i*47)%500),
}));

export function PayrollReport({ mod, sub }: Props) {
  const [tab, setTab] = useState<"tech"|"cpa">("tech");
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [payrollDate, setPayrollDate] = useState("(custom)");
  const [startDate, setStartDate] = useState(offsetStr(-14));
  const [endDate, setEndDate] = useState(todayStr());
  const locRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const techRows = TECH_ROWS.filter(r=>!location||r.location===location);
  const cpaRows = CPA_ROWS.filter(r=>!location||r.location===location);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Payroll Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Payroll Report</h1>
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
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Payroll Date</span>
            <select value={payrollDate} onChange={e=>setPayrollDate(e.target.value)} aria-label="Payroll date" className="glass-input text-sm py-1.5 px-2 rounded-md w-52">
              {PAYROLL_PERIODS.map(d=><option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Complete Date</span>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4">
        {(["tech","cpa"] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab===t?"bg-blue-600 text-white":"btn"}`}>
            {t==="tech"?"Tech Payroll":"CPA Report"}
          </button>
        ))}
      </div>
      {tab==="tech" ? (
        <div className="panel overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["#","Technician","Location","Jobs","Labor","Parts","Adjustments","Total Pay"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>{techRows.map((r,idx)=>(
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                <td className="px-3 py-2.5 font-medium">{r.tech}</td>
                <td className="px-3 py-2.5">{r.location}</td>
                <td className="px-3 py-2.5 text-right">{r.jobs}</td>
                <td className="px-3 py-2.5 text-right">${r.laborTotal.toFixed(2)}</td>
                <td className="px-3 py-2.5 text-right">${r.partsTotal.toFixed(2)}</td>
                <td className={`px-3 py-2.5 text-right ${r.adjustments<0?"text-red-400":""}`}>{r.adjustments!==0?`$${r.adjustments.toFixed(2)}`:"—"}</td>
                <td className="px-3 py-2.5 text-right font-medium text-green-400">${r.totalPay.toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="panel overflow-x-auto p-0">
          <div className="px-4 py-3 flex justify-end border-b border-white/10">
            <button className="btn flex items-center gap-2 px-4"><Save className="h-3.5 w-3.5"/>Save</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["#","Location","Payroll Period","Total Techs","Gross Payroll","Deductions","Net Payroll"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>{cpaRows.map((r,idx)=>(
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                <td className="px-3 py-2.5">{r.location}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.period}</td>
                <td className="px-3 py-2.5 text-right">{r.totalTechs}</td>
                <td className="px-3 py-2.5 text-right">${r.grossPayroll.toFixed(2)}</td>
                <td className="px-3 py-2.5 text-right text-red-400">${r.deductions.toFixed(2)}</td>
                <td className="px-3 py-2.5 text-right font-medium text-green-400">${r.netPayroll.toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
