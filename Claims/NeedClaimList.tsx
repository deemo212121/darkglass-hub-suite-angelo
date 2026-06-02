import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const DS: React.CSSProperties = { background:"rgb(22,28,52)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", zIndex:999999, position:"fixed", maxHeight:280, overflowY:"auto" };
const Chev = ({o}:{o:boolean}) => <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function usePortal(open:boolean){ const ref=useRef<HTMLButtonElement>(null); const [pos,setPos]=useState<any>(null); const r=useCallback(()=>{ if(!ref.current)return; const b=ref.current.getBoundingClientRect(); setPos({top:b.bottom+2,left:b.left,width:b.width}); },[]); useLayoutEffect(()=>{if(open)r();},[open,r]); useEffect(()=>{if(!open)return; window.addEventListener("scroll",r,true); window.addEventListener("resize",r); return()=>{window.removeEventListener("scroll",r,true); window.removeEventListener("resize",r);};},[open,r]); return{ref,pos}; }

const DAY_OPTIONS = ["30 days","60 days","90 days","120 days","180 days","365 days"];
const PRE_CLAIM_STATUSES = ["Holding","Need Claim","Claim Not Needed","Claimed"];
const WTY_TYPES = ["IW","OOW","SC"];
const CLAIM_TOS = ["AIG WARRANTY","ASSURANT SOLUTIONS","SQUARE TRADE","GE WARRANTY","LG WARRANTY","CENTRICITY","NSA","SAMSUNG","ELECTROLUX","MIELE","MIDEA","HISENSE","FIDELITY","BUILDER","INTERNAL","OOW"];
const PRODUCTS = ["Washer","Dryer","Refrigerator","Range/Oven","Dishwasher","Microwave","Home Laundry - Electric","Home Laundry - Gas","French Door Refrigerator","Cooktop"];
const REPAIR_TYPES = ["IW","OOW","SC","NS"];
const pick = <T,>(a:T[],i:number) => a[i%a.length];
const pad = (n:number,l=4) => String(n).padStart(l,"0");
const ds = (o:number) => { const d=new Date(); d.setDate(d.getDate()+o); return d.toISOString().slice(0,10); };
const TECHS = ["Lashamus Dowell","Kevin Khaiphanliane","Brye'shawn Butler","Josh Malloch","Matt Simmons","Percy Smith","Jonathon Allen","Seven Grinis","Brandon Phillips","Alexxis Henry","Leo Sun","Matthew Mccrary"];

function makeRows(count=80) {
  const locs = LOCATIONS.slice(1);
  return Array.from({length:count},(_,i)=>({
    id:i+1, selected:false,
    ticketNo: (i%3===0?"SA-"+pad(3000000+i,7):(i%3===1?"26000"+pad(600000+i,6)+"DF":"1007"+pad(100000+i,6)+"-10")),
    location: pick(locs,i),
    wtyType: pick(WTY_TYPES,i),
    status: i%7===0?"CL-Parts Back Ordered":i%5===0?"CL-Need Cancel":"CL-Ready to Complete",
    statusDot: i%4===0?2:i%3===0?1:0, // 0=none,1=orange,2=red
    tech: pick(TECHS,i),
    product: pick(PRODUCTS,i),
    compCancel: ds(-(i%45)),
    repairType: pick(REPAIR_TYPES,i),
    parts: Math.floor(Math.random()*5),
    redo: i%8===0?"Y":"",
    saw: i%6===0?"Y":"",
    mile: Math.round(10+(i*7.3)%100),
    claimTo: pick(CLAIM_TOS,i),
    claimNo: i%3===0?"CLM-"+pad(90000+i):"",
    preClaimStatus: pick(PRE_CLAIM_STATUSES,i),
    claimNote: "",
    tat: Math.floor(i%30),
    paidByCx: i%8===0?"Y":"N",
  }));
}
const ALL_ROWS = makeRows(80);

export function NeedClaimList({ mod, sub }: Props) {
  const def = () => { const e=new Date(); const s=new Date(); s.setDate(e.getDate()-90); return {start:s.toISOString().slice(0,10), end:e.toISOString().slice(0,10)}; };
  const {start:defStart, end:defEnd} = def();

  const [location, setLocation] = useState(""); const [locOpen, setLocOpen] = useState(false);
  const [startDate, setStartDate] = useState(defStart);
  const [endDate, setEndDate] = useState(defEnd);
  const [dayRange, setDayRange] = useState("90 days");
  const [ticketSearch, setTicketSearch] = useState("");
  const [readyToComplete, setReadyToComplete] = useState(true);
  const [cancelled, setCancelled] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(ALL_ROWS);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const locD = usePortal(locOpen); const locL = useRef<HTMLDivElement>(null);
  useEffect(()=>{ const fn=(e:MouseEvent)=>{ const t=e.target as Node; if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false); }; document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn); },[locOpen]);

  const handleDayChange = (val:string) => { setDayRange(val); const days=parseInt(val); const e=new Date(); const s=new Date(); s.setDate(e.getDate()-days); setStartDate(s.toISOString().slice(0,10)); setEndDate(e.toISOString().slice(0,10)); };

  const filtered = useMemo(()=>{
    let r = rows;
    if(location) r=r.filter(x=>x.location===location);
    if(ticketSearch) r=r.filter(x=>x.ticketNo.toLowerCase().includes(ticketSearch.toLowerCase()));
    if(startDate) r=r.filter(x=>x.compCancel>=startDate);
    if(endDate) r=r.filter(x=>x.compCancel<=endDate);
    const sf=[readyToComplete&&"CL-Ready to Complete",cancelled&&"CL-Need Cancel",claimed&&"CLM"].filter(Boolean) as string[];
    if(sf.length) r=r.filter(x=>sf.some(s=>s==="CLM"?x.claimNo!=="":x.status===s));
    if(search) r=r.filter(x=>x.ticketNo.toLowerCase().includes(search.toLowerCase())||x.tech.toLowerCase().includes(search.toLowerCase())||x.location.toLowerCase().includes(search.toLowerCase()));
    return r;
  },[rows,location,ticketSearch,startDate,endDate,readyToComplete,cancelled,claimed,search]);

  const updatePreClaim=(id:number,val:string)=>setRows(r=>r.map(row=>row.id===id?{...row,preClaimStatus:val}:row));
  const updateClaimNote=(id:number,val:string)=>setRows(r=>r.map(row=>row.id===id?{...row,claimNote:val}:row));
  const toggleRow=(id:number)=>setSelectedRows(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAll=()=>setSelectedRows(selectedRows.size===filtered.length?new Set():new Set(filtered.map(r=>r.id)));

  const dotColor=(d:number)=>d===0?"":d===1?"bg-orange-400":"bg-red-500";

  return (
    <main className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold flex items-center gap-2">Need Claim List <span className="text-muted-foreground cursor-help text-base" title="Tickets completed or cancelled requiring claim processing">ⓘ</span></h1>
      </div>

      {/* Filter bar */}
      <div className="panel mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Location portal */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
            <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span><Chev o={locOpen}/>
            </button>
            {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}>
              <button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All Locations —</button>
              {LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}
            </div>,document.body)}
          </div>

          {/* Completed/Cancelled date range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Completed / Cancelled</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
              <span className="text-muted-foreground text-xs">~</span>
              <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
              <select value={dayRange} onChange={e=>handleDayChange(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md">
                {DAY_OPTIONS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Ticket No */}
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</label>
            <input type="text" value={ticketSearch} onChange={e=>setTicketSearch(e.target.value)} placeholder="" className="glass-input text-sm py-1.5 px-2 rounded-md"/>
          </div>

          {/* Status checkboxes */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground invisible uppercase tracking-wide">Status</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={readyToComplete} onChange={e=>setReadyToComplete(e.target.checked)} className="accent-blue-500"/>Ready to Complete</label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={cancelled} onChange={e=>setCancelled(e.target.checked)} className="accent-blue-500"/>Cancelled</label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={claimed} onChange={e=>setClaimed(e.target.checked)} className="accent-blue-500"/>Claimed</label>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-end gap-2 ml-auto pb-0.5">
            <button className="px-3 py-1.5 rounded text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white">Sync Ticket (SS)</button>
            <button className="px-3 py-1.5 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white">Auto Claim for checked records (SS)</button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> tickets found</span>
        <div className="flex items-center gap-2">
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="search in result" className="glass-input text-xs py-1 px-2 rounded-md w-36"/>
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-3 w-8"><input type="checkbox" checked={selectedRows.size===filtered.length&&filtered.length>0} onChange={toggleAll} className="accent-blue-500"/></th>
              {["Location","Ticket No","Wty Type","Status","Technician","Product","Comp/Cancel","Repair Type","Parts","REDO","SAW","Mile","Claim To","Claim #","","Pre-Claim Status","Claim Note","TAT","Paid full by Cx","Actions"].map((h,i)=>(
                <th key={i} className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0
              ?<tr><td colSpan={21} className="px-4 py-12 text-center text-muted-foreground">No records found.</td></tr>
              :filtered.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${selectedRows.has(r.id)?"bg-blue-500/5":idx%2!==0?"bg-white/[0.02]":""}`}>
                  <td className="px-2 py-2"><input type="checkbox" checked={selectedRows.has(r.id)} onChange={()=>toggleRow(r.id)} className="accent-blue-500"/></td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.location}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <Link to="/ticket/$ticketNo" params={{ticketNo:r.ticketNo}} className="font-mono text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</Link>
                    {r.statusDot>0&&<span className={`inline-block w-2 h-2 rounded-full ml-1 ${dotColor(r.statusDot)}`}/>}
                  </td>
                  <td className="px-2 py-2 text-center">{r.wtyType}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-xs text-muted-foreground">{r.status}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.tech}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.product.toUpperCase()}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{r.compCancel}</td>
                  <td className="px-2 py-2 text-center">{r.repairType}</td>
                  <td className="px-2 py-2 text-center">{r.parts>0?<span className="text-blue-400 hover:underline cursor-pointer">{r.parts}</span>:""}</td>
                  <td className="px-2 py-2 text-center">{r.redo}</td>
                  <td className="px-2 py-2 text-center">{r.saw}</td>
                  <td className="px-2 py-2 text-right">{r.mile}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-xs">{r.claimTo}</td>
                  <td className="px-2 py-2"><input type="checkbox" className="accent-blue-500" title="Claim #"/></td>
                  <td className="px-2 py-2">
                    {/* Pre-Claim Status dropdown */}
                    <select value={r.preClaimStatus} onChange={e=>updatePreClaim(r.id,e.target.value)}
                      className="glass-input text-xs py-0.5 px-1 rounded w-36">
                      {PRE_CLAIM_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input type="text" value={r.claimNote} onChange={e=>updateClaimNote(r.id,e.target.value)} className="glass-input text-xs py-0.5 px-1 rounded w-24"/>
                  </td>
                  <td className="px-2 py-2 text-center">{r.tat} d</td>
                  <td className="px-2 py-2 text-center">{r.paidByCx}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <Link to="/ticket/$ticketNo" params={{ticketNo:r.ticketNo}} className="text-blue-400 hover:text-blue-300 text-xs">›Pre-Claim (SP)</Link>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Caution note */}
      <div className="mt-4 text-xs text-muted-foreground">
        * Caution: result message from verify button may not fully verify information entered for claim process. Make sure to check with your claim companies when your claim request is denied.
      </div>
    </main>
  );
}
