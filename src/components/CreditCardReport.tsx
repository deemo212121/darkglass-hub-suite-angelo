import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const CARD_TYPES = ["Visa","Mastercard","Amex","Discover"];
const TRANS_TYPES = ["Charge","Refund","Authorization","Void"];
const STATUSES = ["Approved","Declined","Pending","Voided"];

function generateRows(count = 50) {
  const locs = LOCATIONS.slice(1);
  return Array.from({length:count},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-(i%30));
    return {
      id:i+1, location:pick(locs,i),
      transDate:d.toISOString().slice(0,10),
      cardType:pick(CARD_TYPES,i), lastFour:String(1000+(i*137)%9000),
      transType:pick(TRANS_TYPES,i),
      amount:50+(i*27)%800,
      status:pick(STATUSES,i),
      ticketNo:i%3===0?"TK-2026-"+pad(1000+i):"",
    };
  });
}
const ALL_ROWS = generateRows(50);

const STATUS_CHIP: Record<string,string> = {
  Approved:"bg-green-500/20 text-green-300 border border-green-500/30",
  Declined:"bg-red-500/20 text-red-300 border border-red-500/30",
  Pending:"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  Voided:"bg-white/10 text-muted-foreground border border-white/15",
};

export function CreditCardReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(offsetStr(-5));
  const [endDate, setEndDate] = useState(todayStr());
  const [applied, setApplied] = useState({ location:"", startDate:offsetStr(-5), endDate:todayStr() });
  const [locOpen, setLocOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setLocOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const rows = useMemo(()=>{
    let r = ALL_ROWS;
    if (applied.location) r = r.filter(x=>x.location===applied.location);
    if (applied.startDate) r = r.filter(x=>x.transDate>=applied.startDate);
    if (applied.endDate) r = r.filter(x=>x.transDate<=applied.endDate);
    return r;
  }, [applied]);

  const totalApproved = rows.filter(r=>r.status==="Approved").reduce((s,r)=>s+r.amount,0);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Credit Card Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Credit Card Report</h1>
      </div>

      <div className="panel mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <div ref={ref} className="relative flex-1">
              <button aria-label="Select location" aria-expanded={locOpen} onClick={()=>setLocOpen(o=>!o)}
                className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${locOpen?"rotate-180":""}`}/>
              </button>
              {locOpen && (
                <div className="absolute z-50 top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl">
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
            <label htmlFor="ccr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Transaction Date</label>
            <input id="ccr-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="ccr-end" className="sr-only">End date</label>
            <input id="ccr-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          <button onClick={()=>setApplied({location,startDate,endDate})} className="btn btn-primary flex items-center gap-2 px-5">
            <RefreshCw className="h-3.5 w-3.5"/>Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          {label:"Records",value:rows.length,color:"text-blue-400"},
          {label:"Approved",value:rows.filter(r=>r.status==="Approved").length,color:"text-green-400"},
          {label:"Declined",value:rows.filter(r=>r.status==="Declined").length,color:"text-red-400"},
          {label:"Total Approved",value:"$"+totalApproved.toLocaleString(undefined,{maximumFractionDigits:0}),color:"text-cyan-400"},
        ].map(k=>(
          <div key={k.label} className="panel py-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Trans Date","Location","Card Type","Last 4","Trans Type","Amount","Status","Ticket No"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No records. Adjust filters and click Refresh.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.transDate}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.cardType}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">****{r.lastFour}</td>
                  <td className="px-3 py-2.5 text-xs">{r.transType}</td>
                  <td className="px-3 py-2.5 text-right font-medium">${r.amount.toFixed(2)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.ticketNo||"—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
