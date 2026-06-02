import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { ChevronLeft, Save } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const DS: React.CSSProperties = { background:"rgb(22,28,52)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", zIndex:999999, position:"fixed", maxHeight:280, overflowY:"auto" };
const Chev = ({o}:{o:boolean}) => <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function usePortal(open:boolean){ const ref=useRef<HTMLButtonElement>(null); const [pos,setPos]=useState<any>(null); const r=useCallback(()=>{ if(!ref.current)return; const b=ref.current.getBoundingClientRect(); setPos({top:b.bottom+2,left:b.left,width:b.width}); },[]); useLayoutEffect(()=>{if(open)r();},[open,r]); useEffect(()=>{if(!open)return; window.addEventListener("scroll",r,true); window.addEventListener("resize",r); return()=>{window.removeEventListener("scroll",r,true); window.removeEventListener("resize",r);};},[open,r]); return{ref,pos}; }

const ACCOUNTS = ["272467","273746","43195200","162468","162468bp","104268","gsleerepair","MEMPHISUAI","1033418796","1276506820","1249079150","GSL00002","OMB00003","4930403","6488757"];
const CLAIM_STATUSES = ["Approved","ASC to Review","Business Loss","Claim Submitted to Vendor","Hold by ASC","Paid","Paid by Customer","Preauth","Preauth Authorized","REDO (Not Claimed)","REJECTED","Rejected by Vendor","Review by Vendor","UNDER_REVIEW"];
const DATE_TYPES = ["Complete Date","Schedule Date","Claim Date"];
const CLAIM_TOS = ["AIG WARRANTY","ASSURANT SOLUTIONS","SQUARE TRADE","GE WARRANTY","LG WARRANTY","CENTRICITY","NSA","SAMSUNG","ELECTROLUX","MIELE","MIDEA","HISENSE","FIDELITY","BUILDER","INTERNAL","OOW"];
const BRANDS = ["SQUARE TRADE","ASSURANT SOLUTIONS","GE","LG","ELECTROLUX","SAMSUNG","CENTRICITY","AIG","NSA","MIELE"];
const STATES = ["NC","GA","AL","TN","FL","MS","AR","TX","LA","VA","KY","MO"];
const TECHS = ["Brye'shawn Butler","Lashamus Dowell","Kevin Khaiphanliane","Josh Malloch","Matt Simmons","Percy Smith","Jonathon Allen","Seven Grinis","Brandon Phillips","Alexxis Henry"];
const pick = <T,>(a:T[],i:number) => a[i%a.length];
const pad = (n:number,l=6) => String(n).padStart(l,"0");
const ds = (o:number) => { const d=new Date(); d.setDate(d.getDate()+o); return d.toISOString().slice(0,10); };

function makeRows(count=80) {
  const locs = LOCATIONS.slice(1);
  return Array.from({length:count},(_,i)=>{
    const labor = i%3===0?135:i%3===1?230:0;
    const part = i%3===0?pick([303.13,205.95,623.95,92.32],i):i%3===1?282.16:0;
    const approved_labor = labor;
    const approved_part = part;
    const total = labor+part;
    const approved_total = approved_labor+approved_part;
    const hasPaid = i%5!==0;
    return {
      id:i+1, selected:false,
      ticketNo: i%3===0?"065"+pad(800000+i)+String(i%9+1)+"33":i%3===1?"26000"+pad(600000+i)+"DF":"1007"+pad(200000+i)+"-10",
      srcBrand: pick(BRANDS,i),
      state: pick(STATES,i),
      location: pick(locs,i),
      completed: ds(-(i%15)),
      wty: pick(["IW","SC","OOW"],i),
      ccPaid: "$0.00",
      claimTo: pick(CLAIM_TOS,i),
      claimed: ds(-(i%14)),
      by: pick(["JM","NN","AM","SC"],i),
      claimNo: "CLM-"+pad(90000+i),
      // amount cols (req)
      labor, part, diag:0, ship:0, mile:0, other:0, tax:0, total,
      // approved
      aLabor:approved_labor, aPart:approved_part, aDiag:0, aShip:0, aMile:0, aOther:0, aTax:0, aTotal:approved_total,
      receivedAmt: hasPaid&&i%3!==2?null:null,
      status: pick(["Claim Submitted to Vendor","Paid","Review by Vendor"],i),
      paymentReceived: hasPaid?pick(["05/28/2026","05/30/2026","06/01/2026"],i):"",
      internalNote:"", triageNote:"", claimNote:"", paidNote:"",
      cAging: Math.floor(i%5),
      image: i%4===0?1:0,
    };
  });
}
const ALL_ROWS = makeRows(80);

const STATUS_CHIP: Record<string,string> = {
  "Approved":"bg-green-500/20 text-green-300 border border-green-500/30",
  "Paid":"bg-blue-500/20 text-blue-300 border border-blue-500/30",
  "REJECTED":"bg-red-500/20 text-red-300 border border-red-500/30",
  "Rejected by Vendor":"bg-red-500/20 text-red-300 border border-red-500/30",
  "Review by Vendor":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  "Claim Submitted to Vendor":"bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
  "Preauth":"bg-purple-500/20 text-purple-300 border border-purple-500/30",
};

function PortalDropdown({label,options,value,onChange}:{label:string;options:string[];value:string;onChange:(v:string)=>void}) {
  const [open,setOpen]=useState(false);
  const d=usePortal(open);
  const listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{ const fn=(e:MouseEvent)=>{ const t=e.target as Node; if(open&&!d.ref.current?.contains(t)&&!listRef.current?.contains(t))setOpen(false); }; document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn); },[open]);
  return(
    <>
      <button ref={d.ref} onClick={()=>setOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value||`All ${label}`}</span><Chev o={open}/>
      </button>
      {open&&d.pos&&createPortal(<div ref={listRef} style={{...DS,top:d.pos.top,left:d.pos.left,width:Math.max(d.pos.width,200)}}>
        <button onClick={()=>{onChange("");setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>
        {options.map((o,i)=><button key={i} onClick={()=>{onChange(o);setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===o?"bg-blue-600 text-white":""}`}>{o}</button>)}
      </div>,document.body)}
    </>
  );
}

export function ClaimList({ mod, sub }: Props) {
  const [location, setLocation] = useState(""); const [locOpen, setLocOpen] = useState(false);
  const [account, setAccount] = useState("");
  const [ticketNo, setTicketNo] = useState("");
  const [claimNo, setClaimNo] = useState("");
  const [claimStatus, setClaimStatus] = useState("");
  const [dateType, setDateType] = useState("Complete Date");
  const [startDate, setStartDate] = useState(ds(-7));
  const [endDate, setEndDate] = useState(ds(0));
  const [includeUnclaimed, setIncludeUnclaimed] = useState(false);
  const [includePartInfo, setIncludePartInfo] = useState(false);
  const [changeToStatus, setChangeToStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [rows, setRows] = useState(ALL_ROWS);

  const locD = usePortal(locOpen); const locL = useRef<HTMLDivElement>(null);
  useEffect(()=>{ const fn=(e:MouseEvent)=>{ const t=e.target as Node; if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false); }; document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn); },[locOpen]);

  const filtered = useMemo(()=>{
    let r=rows;
    if(location) r=r.filter(x=>x.location===location);
    if(account) r=r.filter(x=>x.claimNo.includes(account));
    if(ticketNo) r=r.filter(x=>x.ticketNo.toLowerCase().includes(ticketNo.toLowerCase()));
    if(claimNo) r=r.filter(x=>x.claimNo.toLowerCase().includes(claimNo.toLowerCase()));
    if(claimStatus) r=r.filter(x=>x.status===claimStatus);
    if(startDate) r=r.filter(x=>x.completed>=startDate);
    if(endDate) r=r.filter(x=>x.completed<=endDate);
    if(search) r=r.filter(x=>x.ticketNo.toLowerCase().includes(search.toLowerCase())||x.location.toLowerCase().includes(search.toLowerCase())||x.claimNo.toLowerCase().includes(search.toLowerCase()));
    return r;
  },[rows,location,account,ticketNo,claimNo,claimStatus,startDate,endDate,search]);

  const toggleRow=(id:number)=>setSelectedRows(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAll=()=>setSelectedRows(selectedRows.size===filtered.length?new Set():new Set(filtered.map(r=>r.id)));
  const updateNote=(id:number,field:string,val:string)=>setRows(r=>r.map(row=>row.id===id?{...row,[field]:val}:row));

  const RedAmt=({v}:{v:number})=>v>0?<span className="inline-block bg-red-500 text-white px-1 py-0.5 rounded text-xs font-medium">{v.toFixed(2)}</span>:<span className="text-muted-foreground text-xs">0.00</span>;

  return (
    <main className="max-w-[1900px] mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Claim List</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Claim List</h1>
      </div>

      {/* Filter panel */}
      <div className="panel mb-4">
        <div className="grid gap-3">
          {/* Row 1 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
              <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span><Chev o={locOpen}/>
              </button>
              {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}>
                <button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>
                {LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}
              </div>,document.body)}
            </div>
            <div className="flex flex-col gap-1 min-w-[140px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</label>
              <input value={ticketNo} onChange={e=>setTicketNo(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md"/>
            </div>
            <div className="flex flex-col gap-1 min-w-[140px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim No</label>
              <input value={claimNo} onChange={e=>setClaimNo(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md"/>
            </div>
            <div className="flex flex-col gap-1 min-w-[180px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim Status</label>
              <PortalDropdown label="Claim Status" options={CLAIM_STATUSES} value={claimStatus} onChange={setClaimStatus}/>
            </div>
            <div className="flex items-end pb-0.5">
              <button className="btn flex items-center gap-2 px-4"><Save className="h-3.5 w-3.5"/>Save</button>
            </div>
          </div>
          {/* Row 2 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Account</label>
              <PortalDropdown label="Account" options={ACCOUNTS} value={account} onChange={setAccount}/>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Range</label>
              <div className="flex items-center gap-1.5">
                <select value={dateType} onChange={e=>setDateType(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {DATE_TYPES.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
                <button onClick={()=>{setStartDate("");setEndDate("");}} className="btn text-xs px-2 py-1">Clear</button>
                <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
                <span className="text-muted-foreground text-xs">~</span>
                <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Option</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={includeUnclaimed} onChange={e=>setIncludeUnclaimed(e.target.checked)} className="accent-blue-500"/>Include un-claimed tickets</label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={includePartInfo} onChange={e=>setIncludePartInfo(e.target.checked)} className="accent-blue-500"/>Include part info (slow)</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk status change */}
      <div className="flex items-center gap-3 mb-3 justify-end">
        <span className="text-xs text-muted-foreground">Change the selected claims to the status</span>
        <div className="w-48"><PortalDropdown label="Status" options={CLAIM_STATUSES} value={changeToStatus} onChange={setChangeToStatus}/></div>
        <button className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">Change</button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> records found</span>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search in result" className="glass-input text-xs py-1 px-2 rounded-md w-36"/>
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            {/* Header row 1 */}
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-2 w-8" rowSpan={2}><input type="checkbox" checked={selectedRows.size===filtered.length&&filtered.length>0} onChange={toggleAll} className="accent-blue-500"/></th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Ticket No</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Src/Brand</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase" rowSpan={2}>State</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Location</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Completed</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase" rowSpan={2}>Wty</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>CC Paid</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Claim To</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Claimed</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase" rowSpan={2}>By</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Claim #</th>
              {/* Amount group headers */}
              <th className="px-2 py-1 text-center text-xs font-semibold text-muted-foreground uppercase border-l border-white/10" colSpan={8}>Labor / Part / Diag / Ship / Mile / Other / Tax / Total</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Received Amt</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase" rowSpan={2}>Status</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Payment Received</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Internal Note</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Triage Note</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Claim Note</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Paid Note</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>C.Aging</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase" rowSpan={2}>Image</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase" rowSpan={2}>Actions</th>
            </tr>
            {/* Sub-header for amount cols */}
            <tr className="border-b border-white/10 bg-white/3">
              {["A. Labor","A. Part","A. Diag","A. Ship","A. Mile","A. Other","A. Tax","A. Total"].map(h=>(
                <th key={h} className="px-2 py-1 text-center text-xs text-muted-foreground border-l border-white/5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0
              ?<tr><td colSpan={30} className="px-4 py-12 text-center text-muted-foreground">No records found.</td></tr>
              :filtered.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${selectedRows.has(r.id)?"bg-blue-500/5":idx%2!==0?"bg-white/[0.02]":""}`}>
                  <td className="px-2 py-1.5"><input type="checkbox" checked={selectedRows.has(r.id)} onChange={()=>toggleRow(r.id)} className="accent-blue-500"/></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Link to="/ticket/$ticketNo" params={{ticketNo:r.ticketNo}} className="font-mono text-blue-400 hover:text-blue-300 hover:underline text-xs">{r.ticketNo}</Link>
                      <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0"/>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap">{r.srcBrand}</td>
                  <td className="px-2 py-1.5">{r.state}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.location}</td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{r.completed}</td>
                  <td className="px-2 py-1.5">{r.wty}</td>
                  <td className="px-2 py-1.5">{r.ccPaid}</td>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap">{r.claimTo}</td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{r.claimed}</td>
                  <td className="px-2 py-1.5">{r.by}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-blue-400">{r.claimNo}</td>
                  {/* Amount cols — two rows per record */}
                  <td className="px-2 py-0 border-l border-white/5">
                    <div className="py-0.5 text-right text-muted-foreground">{r.labor.toFixed(2)}</div>
                    <div className="py-0.5 text-right"><RedAmt v={r.aLabor}/></div>
                  </td>
                  <td className="px-2 py-0">
                    <div className="py-0.5 text-right text-muted-foreground">{r.part.toFixed(2)}</div>
                    <div className="py-0.5 text-right"><RedAmt v={r.aPart}/></div>
                  </td>
                  {["diag","ship","mile","other","tax"].map(f=>(
                    <td key={f} className="px-2 py-0">
                      <div className="py-0.5 text-right text-muted-foreground">0.00</div>
                      <div className="py-0.5 text-right text-muted-foreground">0.00</div>
                    </td>
                  ))}
                  <td className="px-2 py-0">
                    <div className="py-0.5 text-right text-muted-foreground">{r.total>0?`$${r.total.toFixed(2)}`:"$0.00"}</div>
                    <div className="py-0.5 text-right">{r.aTotal>0?<span className="inline-block bg-red-500 text-white px-1 py-0.5 rounded text-xs font-medium">{r.aTotal.toFixed(2)}</span>:<span className="text-muted-foreground">0.00</span>}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" className="accent-blue-500"/>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STATUS_CHIP[r.status]||"bg-white/10 text-muted-foreground border border-white/15"}`}>{r.status}</span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{r.paymentReceived}</td>
                  <td className="px-2 py-1.5"><input value={r.internalNote} onChange={e=>updateNote(r.id,"internalNote",e.target.value)} className="glass-input text-xs py-0.5 px-1 rounded w-20"/></td>
                  <td className="px-2 py-1.5"><input value={r.triageNote} onChange={e=>updateNote(r.id,"triageNote",e.target.value)} className="glass-input text-xs py-0.5 px-1 rounded w-20"/></td>
                  <td className="px-2 py-1.5"><input value={r.claimNote} onChange={e=>updateNote(r.id,"claimNote",e.target.value)} className="glass-input text-xs py-0.5 px-1 rounded w-20"/></td>
                  <td className="px-2 py-1.5"><input value={r.paidNote} onChange={e=>updateNote(r.id,"paidNote",e.target.value)} className="glass-input text-xs py-0.5 px-1 rounded w-16"/></td>
                  <td className="px-2 py-1.5 text-center">{r.cAging}</td>
                  <td className="px-2 py-1.5 text-center">{r.image>0?<span className="text-blue-400 cursor-pointer">📎</span>:""}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <button className="text-blue-400 hover:text-blue-300 text-xs text-left">›Sync Status</button>
                      <button className="text-blue-400 hover:text-blue-300 text-xs text-left">›Upload Document</button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </main>
  );
}
