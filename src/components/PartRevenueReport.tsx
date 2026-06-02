import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const PARTS_LIST = ["Motor Assembly","Pump Assembly","Control Board","Door Latch","Thermostat","Heating Element","Belt","Drain Hose","Water Valve","Timer","Lid Switch","Agitator"];
type DateType = "monthly"|"weekly"|"biweekly"|"daily";

function generateRows(count = 80) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (i % 30) - 1);
    const cost = 20 + (i * 13) % 200;
    const revenue = cost * (1.4 + (i % 5) * 0.1);
    return {
      id: i + 1, poDate: d.toISOString().slice(0,10),
      partNo: "PT-" + pad(80000 + i),
      description: pick(PARTS_LIST, i),
      location: pick(locs, i),
      qtySold: 1 + (i % 6),
      cost, revenue: +revenue.toFixed(2),
      margin: +((revenue - cost) / revenue * 100).toFixed(1),
      adjustAmount: i % 5 === 0 ? -(i % 50) : 0,
      balanceAmount: cost * (1 + (i % 3) * 0.1),
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
    <div ref={ref} className="relative min-w-32">
      <button aria-label="Select location" aria-expanded={open} onClick={() => setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value || "All"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`} />
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-48 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          {LOCATIONS.map((l,i) => (
            <button key={i} onClick={() => { onChange(l); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===l?"bg-blue-600 text-white":l===""?"text-muted-foreground":""}`}>
              {l || "— All Locations —"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PartRevenueReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [dateType, setDateType] = useState<DateType>("daily");
  const [startDate, setStartDate] = useState(offsetStr(-7));
  const [endDate, setEndDate] = useState(todayStr());

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.poDate>=startDate);
    if (endDate) r = r.filter(x=>x.poDate<=endDate);
    return r;
  }, [endDate, location, startDate]);

  const totalRevenue = rows.reduce((s,r)=>s+r.revenue,0);
  const totalCost = rows.reduce((s,r)=>s+r.cost,0);
  const avgMargin = rows.length ? +(rows.reduce((s,r)=>s+r.margin,0)/rows.length).toFixed(1) : 0;

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Part Revenue Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Part Revenue Report</h1>
      </div>

      {/* Note */}
      <div className="mb-3 text-xs text-muted-foreground">
        <span>* Adjust Amount: the adjusted margin (Labor Screen) * (Part Price)</span><br/>
        <span>* Balance Amount: Used Amount</span>
      </div>

      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="prr-location" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
            <LocationDropdown value={location} onChange={setLocation} />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Type</span>
            {(["monthly","weekly","biweekly","daily"] as DateType[]).map(dt => (
              <label key={dt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="prr-datetype" value={dt} checked={dateType===dt} onChange={()=>setDateType(dt)} className="accent-blue-500" />
                {dt.charAt(0).toUpperCase() + dt.slice(1)}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <label htmlFor="prr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">P/O Date</label>
            <input id="prr-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="PO start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5 ml-2" />
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="prr-end" className="sr-only">PO end date</label>
            <input id="prr-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="PO end date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
          </div>
          
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label:"Records", value:rows.length, color:"text-blue-400" },
          { label:"Total Revenue", value:"$"+totalRevenue.toLocaleString(undefined,{maximumFractionDigits:0}), color:"text-green-400" },
          { label:"Total Cost", value:"$"+totalCost.toLocaleString(undefined,{maximumFractionDigits:0}), color:"text-cyan-400" },
          { label:"Avg Margin", value:avgMargin+"%", color:avgMargin>=30?"text-green-400":avgMargin>=20?"text-yellow-400":"text-red-400" },
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
              {["#","P/O Date","Part No","Description","Location","Qty Sold","Cost","Revenue","Margin %","Adjust Amt","Balance Amt"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.poDate}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.partNo}</td>
                  <td className="px-3 py-2.5">{r.description}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 text-right">{r.qtySold}</td>
                  <td className="px-3 py-2.5 text-right">${r.cost.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right text-green-400 font-medium">${r.revenue.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={r.margin>=30?"text-green-400":r.margin>=20?"text-yellow-400":"text-red-400"}>{r.margin}%</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{r.adjustAmount !== 0 ? r.adjustAmount.toFixed(2) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">${r.balanceAmount.toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/5 font-semibold">
                <td colSpan={5} className="px-3 py-2.5 text-xs text-muted-foreground uppercase">Totals</td>
                <td className="px-3 py-2.5 text-right">{rows.reduce((s,r)=>s+r.qtySold,0)}</td>
                <td className="px-3 py-2.5 text-right">${totalCost.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                <td className="px-3 py-2.5 text-right text-green-400">${totalRevenue.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                <td className="px-3 py-2.5 text-right">{avgMargin}%</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </main>
  );
}
