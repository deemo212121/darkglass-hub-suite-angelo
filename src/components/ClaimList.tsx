import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown, Save } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const ACCOUNTS = ["272467","273746","43195200","162468","162468","162468bp","104268","gsleerepair","MEMPHISUAI","1033418796","1276506820","1249079150","GSL00002","OMB00003","4930403","6488757"];
const CLAIM_STATUSES = ["Approved","ASC to Reiview","Business Loss","Claim Submitted to Vendor","Hold by ASC","Paid","Paid by Customer","Preauth","Preauth Authorized","REDO (Not Claimed)","REJECTED","Rejected by Vendor","Review by Vendor","UNDER_REVIEW"];
const CHANGE_STATUSES = ["Approved","ASC to Reiview","Business Loss","Claim Submitted to Vendor","Hold by ASC","Paid","Paid by Customer","Preauth","Preauth Authorized","REDO (Not Claimed)","REJECTED","Rejected by Vendor","Review by Vendor","UNDER_REVIEW"];
const COMPLETE_DATE_TYPES = ["Complete Date","Schedule Date","Claim Date"];
const CLAIM_COMPANIES = ["Samsung","LG","Whirlpool","GE Appliances","Bosch","Electrolux"];
const TECHS = ["Damon Ottley","Marc James","Nathan Wagner","Christian Clark","Gabriel Talley","Jaylon Yarbrough","Josh Malloch","Justin Alvarez"];

function generateRows(count = 60) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const comp = new Date(); comp.setDate(comp.getDate()-(i%30));
    return {
      id: i+1, selected: false,
      claimNo: "CLM-"+pad(90000+i), ticketNo: "TK-2026-"+pad(1000+i),
      location: pick(locs,i), account: pick(ACCOUNTS,i),
      claimCompany: pick(CLAIM_COMPANIES,i), tech: pick(TECHS,i),
      completeDate: comp.toISOString().slice(0,10),
      claimStatus: pick(CLAIM_STATUSES,i),
      invoiceAmount: 100+(i*43)%900, paidAmount: i%4===3?0:80+(i*37)%800,
    };
  });
}
const ALL_ROWS = generateRows(60);

function SimpleDropdown({ label, options, value, onChange, placeholder }: { label: string; options: string[]; value: string; onChange: (v: string) => void; placeholder?: string }) {
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
        <span className={value?"":"text-muted-foreground"}>{value||(placeholder||`All ${label}`)}</span>
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

const STATUS_CHIP: Record<string,string> = {
  "Approved":"bg-green-500/20 text-green-300 border border-green-500/30",
  "Paid":"bg-blue-500/20 text-blue-300 border border-blue-500/30",
  "REJECTED":"bg-red-500/20 text-red-300 border border-red-500/30",
  "Rejected by Vendor":"bg-red-500/20 text-red-300 border border-red-500/30",
  "UNDER_REVIEW":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  "Review by Vendor":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  "Preauth":"bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
  "Preauth Authorized":"bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
};

export function ClaimList({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [account, setAccount] = useState("");
  const [ticketNo, setTicketNo] = useState("");
  const [claimNo, setClaimNo] = useState("");
  const [claimStatus, setClaimStatus] = useState("");
  const [completeDateType, setCompleteDateType] = useState("Complete Date");
  const [startDate, setStartDate] = useState(offsetStr(-7));
  const [endDate, setEndDate] = useState(todayStr());
  const [includeUnclaimed, setIncludeUnclaimed] = useState(false);
  const [includePartInfo, setIncludePartInfo] = useState(false);
  const [changeToStatus, setChangeToStatus] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState({ location:"", account:"", ticketNo:"", claimNo:"", claimStatus:"", startDate:offsetStr(-7), endDate:todayStr(), includeUnclaimed:false });

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (applied.location) r = r.filter(x=>x.location===applied.location);
    if (applied.account) r = r.filter(x=>x.account===applied.account);
    if (applied.ticketNo) r = r.filter(x=>x.ticketNo.includes(applied.ticketNo));
    if (applied.claimNo) r = r.filter(x=>x.claimNo.includes(applied.claimNo));
    if (applied.claimStatus) r = r.filter(x=>x.claimStatus===applied.claimStatus);
    if (applied.startDate) r = r.filter(x=>x.completeDate>=applied.startDate);
    if (applied.endDate) r = r.filter(x=>x.completeDate<=applied.endDate);
    return r;
  }, [applied]);

  const toggleRow = (id: number) => setSelectedRows(prev => { const n = new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const toggleAll = () => setSelectedRows(selectedRows.size===rows.length ? new Set() : new Set(rows.map(r=>r.id)));

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Claim List</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Claim List</h1>
      </div>

      <div className="panel mb-4">
        <div className="grid gap-3">
          {/* Row 1 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-36">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
              <SimpleDropdown label="Location" options={LOCATIONS.slice(1)} value={location} onChange={setLocation}/>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-36">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Ticket No</span>
              <label htmlFor="cl-ticket" className="sr-only">Ticket No</label>
              <input id="cl-ticket" type="text" value={ticketNo} onChange={e=>setTicketNo(e.target.value)} title="Ticket number" placeholder="" className="glass-input text-sm py-1.5 px-2 rounded-md flex-1"/>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-36">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Claim No</span>
              <label htmlFor="cl-claim" className="sr-only">Claim No</label>
              <input id="cl-claim" type="text" value={claimNo} onChange={e=>setClaimNo(e.target.value)} title="Claim number" placeholder="" className="glass-input text-sm py-1.5 px-2 rounded-md flex-1"/>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-36">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Claim Status</span>
              <SimpleDropdown label="Claim Status" options={CLAIM_STATUSES} value={claimStatus} onChange={setClaimStatus}/>
            </div>
            <button onClick={()=>setApplied({location,account,ticketNo,claimNo,claimStatus,startDate,endDate,includeUnclaimed})} className="btn btn-primary flex items-center gap-2 px-4">
              <RefreshCw className="h-3.5 w-3.5"/>Refresh
            </button>
            <button className="btn flex items-center gap-2 px-4">
              <Save className="h-3.5 w-3.5"/>Save
            </button>
          </div>
          {/* Row 2 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-36">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Account</span>
              <SimpleDropdown label="Account" options={ACCOUNTS} value={account} onChange={setAccount}/>
            </div>
            <div className="flex items-center gap-2">
              <select value={completeDateType} onChange={e=>setCompleteDateType(e.target.value)} title="Date type" aria-label="Date type" className="glass-input text-sm py-1.5 px-2 rounded-md">
                {COMPLETE_DATE_TYPES.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
              <button onClick={()=>{setStartDate("");setEndDate("");}} className="btn text-xs px-2 py-1">Clear</button>
              <label htmlFor="cl-start" className="sr-only">Start date</label>
              <input id="cl-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
              <span className="text-muted-foreground text-xs">~</span>
              <label htmlFor="cl-end" className="sr-only">End date</label>
              <input id="cl-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
              <select title="Date range preset" aria-label="Date range preset" className="glass-input text-sm py-1.5 px-2 rounded-md">
                {["7 days","14 days","30 days","60 days","90 days"].map(d=><option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Option</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={includeUnclaimed} onChange={e=>setIncludeUnclaimed(e.target.checked)} className="accent-blue-500" title="Include un-claimed tickets"/>
                Include un-claimed tickets
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={includePartInfo} onChange={e=>setIncludePartInfo(e.target.checked)} className="accent-blue-500" title="Include part info (slow)"/>
                Include part info (slow)
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk status change bar */}
      <div className="flex items-center gap-3 mb-3 justify-end">
        <span className="text-xs text-muted-foreground">Change the selected claims to the status</span>
        <SimpleDropdown label="Status" options={CHANGE_STATUSES} value={changeToStatus} onChange={setChangeToStatus} placeholder="Select status…"/>
        <button className="btn btn-primary px-4 text-sm">Change</button>
      </div>

      <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-3 py-3 w-8">
                <input type="checkbox" checked={selectedRows.size===rows.length && rows.length>0} onChange={toggleAll} className="accent-blue-500" title="Select all"/>
              </th>
              {["Claim No","Ticket No","Location","Account","Claim Company","Tech","Complete Date","Claim Status","Invoice $","Paid $"].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">No records. Adjust filters and click Refresh.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${selectedRows.has(r.id)?"bg-blue-500/5":idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={selectedRows.has(r.id)} onChange={()=>toggleRow(r.id)} className="accent-blue-500" title={`Select ${r.claimNo}`}/>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.claimNo}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.account}</td>
                  <td className="px-3 py-2.5">{r.claimCompany}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.completeDate}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.claimStatus]||"bg-white/10 text-muted-foreground border border-white/15"}`}>
                      {r.claimStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">${r.invoiceAmount.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right">${r.paidAmount.toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
