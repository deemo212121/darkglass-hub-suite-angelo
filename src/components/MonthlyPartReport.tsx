import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const REPORT_TYPES = ["by Unique ID","by Part #"];
const PARTS = ["Motor Assembly","Pump Assembly","Control Board","Door Latch","Thermostat","Heating Element","Belt","Drain Hose","Water Valve","Timer","Lid Switch","Agitator"];
const ALL_ROWS = Array.from({length:60},(_,i)=>{
  const d=new Date(); d.setDate(d.getDate()-(i*5)%180);
  return { id:i+1, uniqueId:"UID-"+pad(10000+i), partNo:"PT-"+pad(70000+i),
    description:pick(PARTS,i), location:pick(LOCATIONS.slice(1),i),
    month:d.toISOString().slice(0,7), qty:1+(i%8),
    unitCost:25+(i*17)%400, totalCost:(1+(i%8))*(25+(i*17)%400) };
});

export function MonthlyPartReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [reportType, setReportType] = useState("by Unique ID");
  const [rtOpen, setRtOpen] = useState(false);
  const [dateMode, setDateMode] = useState<"month"|"date">("month");
  const [monthVal, setMonthVal] = useState(todayStr().slice(0,7));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const locRef = useRef<HTMLDivElement>(null);
  const rtRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
      if (rtRef.current && !rtRef.current.contains(e.target as Node)) setRtOpen(false);
    };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const rows = useMemo(()=>{
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (dateMode==="month" && monthVal) r = r.filter(x=>x.month===monthVal);
    if (dateMode==="date") {
      if (startDate) r = r.filter(x=>x.month>=startDate.slice(0,7));
      if (endDate) r = r.filter(x=>x.month<=endDate.slice(0,7));
    }
    return r;
  }, [location, reportType, dateMode, monthVal, startDate, endDate]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Monthly Part Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Monthly Part Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 min-w-40 flex-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location*</span>
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
          <div className="flex items-center gap-2 min-w-40 flex-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Report Type*</span>
            <div ref={rtRef} className="relative flex-1">
              <button aria-label="Select report type" aria-expanded={rtOpen} onClick={()=>setRtOpen(o=>!o)}
                className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span>{reportType}</span>
                <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${rtOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {rtOpen && (
                <div className="absolute z-[99999] top-full mt-1 left-0 w-full rounded-md shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
                  {REPORT_TYPES.map((t,i)=>(
                    <button key={i} onClick={()=>{setReportType(t);setRtOpen(false);}}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${reportType===t?"bg-blue-600 text-white":""}`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="mpr-mode" checked={dateMode==="month"} onChange={()=>setDateMode("month")} className="accent-blue-500"/>Month
            </label>
            <input type="month" value={monthVal} onChange={e=>setMonthVal(e.target.value)}
              disabled={dateMode!=="month"}
              className={`glass-input text-sm py-1.5 px-2 rounded-md w-36 ${dateMode!=="month"?"opacity-40":""}`}/>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2">
              <input type="radio" name="mpr-mode" checked={dateMode==="date"} onChange={()=>setDateMode("date")} className="accent-blue-500"/>Date
            </label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
              disabled={dateMode!=="date"} placeholder="mm/dd/yyyy"
              className={`glass-input text-sm py-1.5 px-2 rounded-md w-32.5 ${dateMode!=="date"?"opacity-40":""}`}/>
            <span className="text-muted-foreground text-xs">~</span>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}
              disabled={dateMode!=="date"} placeholder="mm/dd/yyyy"
              className={`glass-input text-sm py-1.5 px-2 rounded-md w-32.5 ${dateMode!=="date"?"opacity-40":""}`}/>
          </div>
        </div>
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {["#", reportType==="by Unique ID"?"Unique ID":"Part #","Description","Location","Month","Qty","Unit Cost","Total"].map(h=>(
              <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{reportType==="by Unique ID"?r.uniqueId:r.partNo}</td>
                  <td className="px-3 py-2.5">{r.description}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.month}</td>
                  <td className="px-3 py-2.5 text-right">{r.qty}</td>
                  <td className="px-3 py-2.5 text-right">${r.unitCost.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right font-medium">${r.totalCost.toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
