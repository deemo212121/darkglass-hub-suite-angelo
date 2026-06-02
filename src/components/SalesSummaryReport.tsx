import { useState, useRef, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const GROUP_BY = ["Branch (Samsung Only)","Location","State of Customer","Technician"];
const locs = LOCATIONS.slice(1);
const ALL_SUMMARY = locs.map((loc,i)=>({
  key:loc, label:loc, totalClaims:20+(i%30), approvedAmount:2000+(i*137)%8000,
  paidAmount:1800+(i*113)%7000, rejectedAmount:100+(i*37)%500, pendingAmount:200+(i*53)%1000,
}));

export function SalesSummaryReport({ mod, sub }: Props) {
  const [tab, setTab] = useState<"summary"|"detail">("summary");
  const [startDate, setStartDate] = useState(offsetStr(-30));
  const [endDate, setEndDate] = useState(todayStr());
  const [groupBy, setGroupBy] = useState("");
  const [gbOpen, setGbOpen] = useState(false);
  const gbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (gbRef.current && !gbRef.current.contains(e.target as Node)) setGbOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Sales Summary</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Sales Summary</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date*</label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Group by</span>
            <div ref={gbRef} className="relative flex-1">
              <button aria-label="Select group by" aria-expanded={gbOpen} onClick={()=>setGbOpen(o=>!o)}
                className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={groupBy?"":"text-muted-foreground"}>{groupBy||"Select group..."}</span>
                <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${gbOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {gbOpen && (
                <div className="absolute z-[99999] top-full mt-1 left-0 w-full rounded-md shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
                  <button onClick={()=>{setGroupBy("");setGbOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${groupBy===""?"bg-blue-600 text-white":"text-muted-foreground"}`}>— Select group... —</button>
                  {GROUP_BY.map((g,i)=>(
                    <button key={i} onClick={()=>{setGroupBy(g);setGbOpen(false);}}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${groupBy===g?"bg-blue-600 text-white":""}`}>{g}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4">
        {(["summary","detail"] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab===t?"bg-blue-600 text-white":"btn"}`}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {["Group","Total Claims","Approved $","Paid $","Rejected $","Pending $"].map(h=>(
              <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>{ALL_SUMMARY.map((r,idx)=>(
            <tr key={r.key} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
              <td className="px-3 py-2.5 font-medium">{r.label}</td>
              <td className="px-3 py-2.5 text-right">{r.totalClaims}</td>
              <td className="px-3 py-2.5 text-right">${r.approvedAmount.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-green-400">${r.paidAmount.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-red-400">${r.rejectedAmount.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-yellow-400">${r.pendingAmount.toLocaleString()}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </main>
  );
}
