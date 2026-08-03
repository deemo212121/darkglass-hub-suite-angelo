import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const ACCOUNTS = ["1033418796","104268","1249079150","1276506820","162468","272467","273746","43195200","49384"];
const OVERALL_STATUSES = ["Open / Pending","Completed","Cancelled"];
const REPAIR_STATUSES = [
  "Archived","CL-Cancelled","CL-Claimed","CL-Completed","CL-Data-Closed","CL-Need Cancel",
  "CL-Parts Back Ordered","CL-Ready to Complete","CSR-Acknowledged","CSR-Assigned to ASC",
  "CSR-Left Message for Cx","CSR-Needs Scheduling","Needs Auto Claim","OP-Ready for Service",
  "OP-Reschedule Follow up","OP-UPDATE HOLD","OP-Waiting for Part","PT-Need PreAuthorization",
  "Redo Cancelled","TR-Need PO","TR-Need Triage",
];
const COMPLETE_MODES = ["Completed","Cancelled","All"];

function generateRows(count = 60) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const comp = new Date(); comp.setDate(comp.getDate()-1-(i%30));
    return {
      id: i+1, ticketNo: "TK-2026-"+pad(8000+i),
      account: pick(ACCOUNTS,i), location: pick(locs,i),
      tech: pick(TECHS_FULL,i), overallStatus: pick(OVERALL_STATUSES,i),
      repairStatus: pick(REPAIR_STATUSES,i),
      completedDate: comp.toISOString().slice(0,10),
    };
  });
}
const ALL_ROWS = generateRows(60);

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
        <span className={value?"":"text-muted-foreground"}>{value||`All ${label}`}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`}/>
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          <button onClick={()=>{onChange("");setOpen(false);}} className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-white/5">— All —</button>
          {options.map(o=>(
            <button key={o} onClick={()=>{onChange(o);setOpen(false);}}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===o?"bg-blue-600 text-white":""}`}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RedoReport({ mod, sub }: Props) {
  const [account, setAccount] = useState("");
  const [location, setLocation] = useState("");
  const [tech, setTech] = useState("");
  const [overallStatus, setOverallStatus] = useState("");
  const [repairStatus, setRepairStatus] = useState("");
  const [completeMode, setCompleteMode] = useState("Completed");
  const [startDate, setStartDate] = useState(offsetStr(-30));
  const [endDate, setEndDate] = useState(todayStr());

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (account) r = r.filter(x=>x.account===account);
    if (location) r = r.filter(x=>x.location===location);
    if (tech) r = r.filter(x=>x.tech===tech);
    if (overallStatus) r = r.filter(x=>x.overallStatus===overallStatus);
    if (repairStatus) r = r.filter(x=>x.repairStatus===repairStatus);
    if (startDate) r = r.filter(x=>x.completedDate>=startDate);
    if (endDate) r = r.filter(x=>x.completedDate<=endDate);
    return r;
  }, [account, endDate, location, overallStatus, repairStatus, startDate, tech]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">REDO Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">REDO Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Account</span>
              <SimpleDropdown label="Account" options={ACCOUNTS} value={account} onChange={setAccount}/>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
              <SimpleDropdown label="Location" options={LOCATIONS.slice(1)} value={location} onChange={setLocation}/>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Technician</span>
              <SimpleDropdown label="Technician" options={TECHS_FULL} value={tech} onChange={setTech}/>
            </div>
            <div className="flex items-center gap-2">
              <select value={completeMode} onChange={e=>setCompleteMode(e.target.value)} title="Completion filter" aria-label="Completion filter" className="glass-input text-sm py-1.5 px-2 rounded-md">
                {COMPLETE_MODES.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={()=>setCompleteMode("")} className="btn text-xs px-2 py-1">Clear</button>
              <label htmlFor="redo-start" className="sr-only">Start date</label>
              <input id="redo-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
              <span className="text-muted-foreground text-xs">~</span>
              <label htmlFor="redo-end" className="sr-only">End date</label>
              <input id="redo-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            </div>
            
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Overall Status</span>
              <SimpleDropdown label="Overall Status" options={OVERALL_STATUSES} value={overallStatus} onChange={setOverallStatus}/>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-48">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Repair Status</span>
              <SimpleDropdown label="Repair Status" options={REPAIR_STATUSES} value={repairStatus} onChange={setRepairStatus}/>
            </div>
          </div>
        </div>
      </div>
      <div className="panel panel-filter mb-4">
        <h2 className="text-base font-semibold mb-3">Redo Tickets <span className="text-sm text-muted-foreground font-normal">({rows.length} records)</span></h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["#","Ticket No","Account","Location","Technician","Overall Status","Repair Status","Completed Date"].map(h=>(
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
                    <td className="px-3 py-2.5 font-mono text-xs">{r.account}</td>
                    <td className="px-3 py-2.5">{r.location}</td>
                    <td className="px-3 py-2.5">{r.tech}</td>
                    <td className="px-3 py-2.5 text-xs">{r.overallStatus}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.repairStatus}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.completedDate}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
