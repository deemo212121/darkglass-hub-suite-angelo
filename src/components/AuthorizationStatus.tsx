import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const AUTH_STATUSES = ["Approved","Atomatically Closed","Open","Rejected","Waiting for Estimate"];
const CLAIM_COMPANIES = ["Samsung","LG","Whirlpool","GE Appliances","Bosch","Electrolux"];

function generateRows(count = 50) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate()-(i%30));
    const approved = 75+(i*29)%700;
    return {
      id: i+1, authNo: "AUTH-"+pad(5000+i), ticketNo: "TK-2026-"+pad(1000+i),
      location: pick(locs,i), claimCompany: pick(CLAIM_COMPANIES,i),
      date: d.toISOString().slice(0,10),
      authStatus: pick(AUTH_STATUSES,i),
      approvedAmount: i%4===2?0:approved,
    };
  });
}
const ALL_ROWS = generateRows(50);

const STATUS_CHIP: Record<string,string> = {
  "Approved":"bg-green-500/20 text-green-300 border border-green-500/30",
  "Open":"bg-blue-500/20 text-blue-300 border border-blue-500/30",
  "Rejected":"bg-red-500/20 text-red-300 border border-red-500/30",
  "Waiting for Estimate":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  "Atomatically Closed":"bg-white/10 text-muted-foreground border border-white/15",
};

function SimpleDropdown({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1">
      <button aria-label={`Select ${label}`} aria-expanded={open} onClick={()=>setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value||`All`}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`}/>
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl">
          <button onClick={()=>{onChange("");setOpen(false);}} className={`w-full text-left px-3 py-2.5 text-sm hover:bg-white/5 ${value===""?"bg-blue-600 text-white":"text-muted-foreground"}`}>&nbsp;</button>
          {options.map(o=>(
            <button key={o} onClick={()=>{onChange(o);setOpen(false);}}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===o?"bg-blue-600 text-white":""}`}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AuthorizationStatus({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [ticketNo, setTicketNo] = useState("");
  const [startDate, setStartDate] = useState(offsetStr(-7));
  const [endDate, setEndDate] = useState(todayStr());
  const [applied, setApplied] = useState({ location:"", authStatus:"", ticketNo:"", startDate:offsetStr(-7), endDate:todayStr() });

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (applied.location) r = r.filter(x=>x.location===applied.location);
    if (applied.authStatus) r = r.filter(x=>x.authStatus===applied.authStatus);
    if (applied.ticketNo) r = r.filter(x=>x.ticketNo.includes(applied.ticketNo));
    if (applied.startDate) r = r.filter(x=>x.date>=applied.startDate);
    if (applied.endDate) r = r.filter(x=>x.date<=applied.endDate);
    return r;
  }, [applied]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Authorization Status</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Authorization Status</h1>
      </div>
      <div className="panel mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-36">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <SimpleDropdown label="Location" options={LOCATIONS.slice(1)} value={location} onChange={setLocation}/>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="auth-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
            <input id="auth-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="auth-end" className="sr-only">End date</label>
            <input id="auth-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-36">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Auth. Status</span>
            <SimpleDropdown label="Auth Status" options={AUTH_STATUSES} value={authStatus} onChange={setAuthStatus}/>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-36">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Ticket No</span>
            <label htmlFor="auth-ticket" className="sr-only">Ticket No</label>
            <input id="auth-ticket" type="text" value={ticketNo} onChange={e=>setTicketNo(e.target.value)} title="Ticket number" placeholder="" className="glass-input text-sm py-1.5 px-2 rounded-md flex-1"/>
          </div>
          <button onClick={()=>setApplied({location,authStatus,ticketNo,startDate,endDate})} className="btn btn-primary flex items-center gap-2 px-5">
            <RefreshCw className="h-3.5 w-3.5"/>Refresh
          </button>
        </div>
      </div>
      <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Auth No","Ticket No","Location","Claim Company","Date","Auth Status","Approved $"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records. Adjust filters and click Refresh.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.authNo}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.claimCompany}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.date}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.authStatus]||"bg-white/10 text-muted-foreground border border-white/15"}`}>
                      {r.authStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">{r.approvedAmount>0?`$${r.approvedAmount.toFixed(2)}`:"—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
