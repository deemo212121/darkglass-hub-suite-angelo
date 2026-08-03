import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { PART_DISTRIBUTORS, pick, pad, offsetStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const PARTS_LIST = ["Motor Assembly","Pump Assembly","Control Board","Door Latch","Thermostat","Heating Element","Belt","Drain Hose","Water Valve","Timer","Lid Switch","Agitator"];

function generateRows(count = 80) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (i % 365) - 30);
    return {
      id: i + 1, invoiceDate: d.toISOString().slice(0,10),
      partNo: "PT-" + pad(70000 + i),
      description: pick(PARTS_LIST, i),
      distributor: pick(PART_DISTRIBUTORS.slice(1), i),
      qty: 1 + (i % 5),
      unitCost: 25 + (i * 17) % 400,
      totalCost: (1 + i % 5) * (25 + (i * 17) % 400),
    };
  });
}
const ALL_ROWS = generateRows(80);

function DistributorDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1 min-w-48">
      <button aria-label="Select part distributor" aria-expanded={open} onClick={() => setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value || "Select Distributor…"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`} />
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-full rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          <button onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full text-left px-3 py-3 text-sm hover:bg-white/5 ${value===""?"bg-blue-600 text-white":""}`}>&nbsp;</button>
          {PART_DISTRIBUTORS.slice(1).map(d => (
            <button key={d} onClick={() => { onChange(d); setOpen(false); }}
              className={`w-full text-left px-3 py-2.5 text-sm hover:bg-white/5 ${value===d?"bg-blue-600 text-white":""}`}>{d}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PartPurchaseReport({ mod, sub }: Props) {
  const [distributor, setDistributor] = useState("");
  const [startMonth, setStartMonth] = useState(offsetStr(-365));
  const [endMonth, setEndMonth] = useState(offsetStr(0));

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (distributor) r = r.filter(x=>x.distributor===distributor);
    if (startMonth) r = r.filter(x=>x.invoiceDate>=startMonth);
    if (endMonth) r = r.filter(x=>x.invoiceDate<=endMonth);
    return r;
  }, [distributor, endMonth, startMonth]);

  const totalCost = rows.reduce((s,r)=>s+r.totalCost,0);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Part Purchase Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Part Purchase Report</h1>
      </div>

      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Part Distributor</span>
            <DistributorDropdown value={distributor} onChange={setDistributor} />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="ppr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Invoice Month</label>
            <input id="ppr-start" type="date" value={startMonth} onChange={e=>setStartMonth(e.target.value)} title="Invoice start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="ppr-end" className="sr-only">Invoice end date</label>
            <input id="ppr-end" type="date" value={endMonth} onChange={e=>setEndMonth(e.target.value)} title="Invoice end date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
          </div>
          
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
        {[
          { label:"Records", value: rows.length, color:"text-blue-400" },
          { label:"Total Qty", value: rows.reduce((s,r)=>s+r.qty,0).toLocaleString(), color:"text-cyan-400" },
          { label:"Total Cost", value:"$"+totalCost.toLocaleString(), color:"text-green-400" },
        ].map(k => (
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
              {["#","Invoice Date","Part No","Description","Distributor","Qty","Unit Cost","Total Cost"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.invoiceDate}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.partNo}</td>
                  <td className="px-3 py-2.5">{r.description}</td>
                  <td className="px-3 py-2.5">{r.distributor}</td>
                  <td className="px-3 py-2.5 text-right">{r.qty}</td>
                  <td className="px-3 py-2.5 text-right">${r.unitCost.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right font-medium">${r.totalCost.toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/5 font-semibold">
                <td colSpan={5} className="px-3 py-2.5 text-xs text-muted-foreground uppercase">Totals</td>
                <td className="px-3 py-2.5 text-right">{rows.reduce((s,r)=>s+r.qty,0)}</td>
                <td className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5 text-right text-green-400">${totalCost.toLocaleString()}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </main>
  );
}
