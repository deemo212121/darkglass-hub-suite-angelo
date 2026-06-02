import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const PO_DATE_TYPES = ["P/O Date","Received Date","Return Date"];
const PARTS = ["Motor Assembly","Pump Assembly","Control Board","Door Latch","Thermostat","Heating Element","Belt","Drain Hose","Water Valve","Timer","Lid Switch","Agitator"];
const TRANS_TYPES = ["Order","Return","Transfer","Adjustment","Received"];
const TECHS = ["Damon Ottley","Marc James","Nathan Wagner","Christian Clark","Gabriel Talley","Jaylon Yarbrough","Andres Mota","Jordan Davis","Josh Malloch","Justin Alvarez"];

function generateRows(count = 80) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (i % 30));
    return {
      id: i+1, partNo: "PT-"+pad(70000+i), description: pick(PARTS,i),
      location: pick(locs,i), tech: pick(TECHS,i),
      transType: pick(TRANS_TYPES,i), qty: 1+(i%5),
      unitCost: 25+(i*17)%400, date: d.toISOString().slice(0,10),
      total: (1+(i%5))*(25+(i*17)%400),
    };
  });
}
const ALL_ROWS = generateRows(80);

function LocationDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1">
      <button aria-label="Select location" aria-expanded={open} onClick={() => setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value||"All Locations"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`}/>
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          {LOCATIONS.map((l,i) => (
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

export function PartTransactionReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [dateType, setDateType] = useState("P/O Date");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.date>=startDate);
    if (endDate) r = r.filter(x=>x.date<=endDate);
    return r;
  }, [endDate, location, startDate]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Part Transaction Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Part Transaction Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <LocationDropdown value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2">
            <select value={dateType} onChange={e=>setDateType(e.target.value)} title="Date type" aria-label="Date type" className="glass-input text-sm py-1.5 px-2 rounded-md">
              {PO_DATE_TYPES.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
            <label htmlFor="ptr-start" className="sr-only">Start date</label>
            <input id="ptr-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="ptr-end" className="sr-only">End date</label>
            <input id="ptr-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          
        </div>
      </div>
      <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Date","Part No","Description","Location","Tech","Type","Qty","Unit Cost","Total"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.date}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.partNo}</td>
                  <td className="px-3 py-2.5">{r.description}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">{r.transType}</span></td>
                  <td className="px-3 py-2.5 text-right">{r.qty}</td>
                  <td className="px-3 py-2.5 text-right">${r.unitCost.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right font-medium">${r.total.toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
