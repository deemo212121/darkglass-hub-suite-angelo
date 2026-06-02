import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function generateRows(count = 80) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate()-((i*3)%45)-15);
    const taxable = 100+(i*23)%600; const rate = 6+(i%4)/10;
    return {
      id: i+1, ticketNo: "TK-2026-"+pad(5000+i),
      location: pick(locs,i), claimDate: d.toISOString().slice(0,10),
      taxableAmount: taxable, taxRate: rate,
      taxCollected: +(taxable*rate/100).toFixed(2),
      taxProcessed: i%5===0,
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

export function TaxReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(offsetStr(-14));
  const [endDate, setEndDate] = useState(todayStr());
  const [includeTaxProcessed, setIncludeTaxProcessed] = useState(false);

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.claimDate>=startDate);
    if (endDate) r = r.filter(x=>x.claimDate<=endDate);
    if (!includeTaxProcessed) r = r.filter(x=>!x.taxProcessed);
    return r;
  }, [endDate, location, startDate]);

  const totalTaxable = rows.reduce((s,r)=>s+r.taxableAmount,0);
  const totalTax = rows.reduce((s,r)=>s+r.taxCollected,0);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Tax Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Tax Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <LocationDropdown value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="tax-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Claim Date</label>
            <input id="tax-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="tax-end" className="sr-only">End date</label>
            <input id="tax-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={includeTaxProcessed} onChange={e=>setIncludeTaxProcessed(e.target.checked)} className="accent-blue-500" title="Include Tax Processed"/>
            Include Tax Processed
          </label>
          
          <button className="btn px-4 text-sm">Save Processed Status</button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          {label:"Records",value:rows.length,color:"text-blue-400"},
          {label:"Total Taxable",value:"$"+totalTaxable.toLocaleString(undefined,{maximumFractionDigits:0}),color:"text-cyan-400"},
          {label:"Total Tax",value:"$"+totalTax.toFixed(2),color:"text-green-400"},
        ].map(k=>(
          <div key={k.label} className="panel py-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Ticket No","Location","Claim Date","Taxable $","Tax Rate %","Tax Collected","Processed"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.claimDate}</td>
                  <td className="px-3 py-2.5 text-right">${r.taxableAmount.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right">{r.taxRate}%</td>
                  <td className="px-3 py-2.5 text-right font-medium">${r.taxCollected}</td>
                  <td className="px-3 py-2.5 text-center">{r.taxProcessed?"✓":"—"}</td>
                </tr>
              ))}
          </tbody>
          {rows.length>0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/5 font-semibold">
                <td colSpan={4} className="px-3 py-2.5 text-xs text-muted-foreground uppercase">Totals</td>
                <td className="px-3 py-2.5 text-right">${totalTaxable.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                <td></td>
                <td className="px-3 py-2.5 text-right text-green-400">${totalTax.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </main>
  );
}
