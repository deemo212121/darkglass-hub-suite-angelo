import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const DS: React.CSSProperties = { background:"rgb(22,28,52)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", zIndex:999999, position:"fixed", maxHeight:280, overflowY:"auto" };
const Chev = ({o}:{o:boolean}) => <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function usePortal(open:boolean){ const ref=useRef<HTMLButtonElement>(null); const [pos,setPos]=useState<any>(null); const r=useCallback(()=>{ if(!ref.current)return; const b=ref.current.getBoundingClientRect(); setPos({top:b.bottom+2,left:b.left,width:b.width}); },[]); useLayoutEffect(()=>{if(open)r();},[open,r]); useEffect(()=>{if(!open)return; window.addEventListener("scroll",r,true); window.addEventListener("resize",r); return()=>{window.removeEventListener("scroll",r,true); window.removeEventListener("resize",r);};},[open,r]); return{ref,pos}; }

const AUTH_STATUSES = ["Approved","Automatically Closed","Open","Rejected","Waiting for Estimate"];
const MANUFACTURERS = ["ASSURANT SOLUTIONS","SQUARE TRADE","GE WARRANTY","LG WARRANTY","CENTRICITY","NSA","SAMSUNG","AIG WARRANTY","ELECTROLUX","MIELE","MIDEA","HISENSE","FIDELITY"];
const ACCOUNT_NOS = ["GSL00002","OMB00003","272467","273746","43195200","162468","gsleerepair","4930403","6488757"];
const pick = <T,>(a:T[],i:number) => a[i%a.length];
const pad = (n:number,l=6) => String(n).padStart(l,"0");
const ds = (o:number) => { const d=new Date(); d.setDate(d.getDate()+o); return d.toISOString().slice(0,10); };

function makeRows(count=50) {
  const locs = LOCATIONS.slice(1);
  return Array.from({length:count},(_,i)=>{
    const reqLabor = i%4===0?135:i%4===1?230:i%4===2?0:185;
    const reqParts = i%4===0?457.46:i%4===1?282.16:i%4===2?0:312.50;
    const reqTotal = reqLabor+reqParts;
    const appLabor = reqLabor; // approved same as requested for sample
    const appParts = reqParts;
    const appTotal = reqTotal;
    return {
      id: i+1, selected: false,
      ticketNo: i%3===0?"26000"+pad(600000+i)+"DF":i%3===1?"26000"+pad(680000+i)+"57DF":"SA-"+pad(3000000+i,7),
      accountNo: pick(ACCOUNT_NOS,i),
      manufacturer: pick(MANUFACTURERS,i),
      location: pick(locs,i),
      redo: i%5===0?"Y":"N",
      rfaStatus: pick(AUTH_STATUSES,i),
      // Requested
      reqLabor, reqParts, reqMileage:0, reqShip:0, reqTravel:0, reqOther:0, reqTax:0, reqTotal,
      requested: ds(-(i%15)+1),
      // Approved
      appLabor, appParts, appMileage:0, appShip:0, appTravel:0, appOther:0, appTax:0, appTotal,
      approved: ds(-(i%15)),
    };
  });
}
const ALL_ROWS = makeRows(50);

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
      {open&&d.pos&&createPortal(<div ref={listRef} style={{...DS,top:d.pos.top,left:d.pos.left,width:Math.max(d.pos.width,220)}}>
        <button onClick={()=>{onChange("");setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>
        {options.map((o,i)=><button key={i} onClick={()=>{onChange(o);setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===o?"bg-blue-600 text-white":""}`}>{o}</button>)}
      </div>,document.body)}
    </>
  );
}

export function AuthorizationStatus({ mod, sub }: Props) {
  const [location, setLocation] = useState(""); const [locOpen, setLocOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const [ticketNo, setTicketNo] = useState("");
  const [startDate, setStartDate] = useState(ds(-7));
  const [endDate, setEndDate] = useState(ds(0));
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const locD = usePortal(locOpen); const locL = useRef<HTMLDivElement>(null);
  const authD = usePortal(authStatus!==""); 
  useEffect(()=>{ const fn=(e:MouseEvent)=>{ const t=e.target as Node; if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false); }; document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn); },[locOpen]);

  const filtered = useMemo(()=>{
    let r=ALL_ROWS;
    if(location) r=r.filter(x=>x.location===location);
    if(authStatus) r=r.filter(x=>x.rfaStatus===authStatus);
    if(ticketNo) r=r.filter(x=>x.ticketNo.toLowerCase().includes(ticketNo.toLowerCase()));
    if(startDate) r=r.filter(x=>x.requested>=startDate);
    if(endDate) r=r.filter(x=>x.requested<=endDate);
    if(search) r=r.filter(x=>x.ticketNo.toLowerCase().includes(search.toLowerCase())||x.accountNo.toLowerCase().includes(search.toLowerCase())||x.manufacturer.toLowerCase().includes(search.toLowerCase()));
    return r.slice(0,pageSize);
  },[location,authStatus,ticketNo,startDate,endDate,search,pageSize]);

  const toggleRow=(id:number)=>setSelectedRows(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAll=()=>setSelectedRows(selectedRows.size===filtered.length?new Set():new Set(filtered.map(r=>r.id)));

  const fmt=(v:number)=>v>0?`$${v.toFixed(2)}`:"$0.00";

  const AMOUNT_COLS = [
    {label:"Req. Labor",  reqKey:"reqLabor",   appKey:"appLabor"},
    {label:"Req. Parts",  reqKey:"reqParts",   appKey:"appParts"},
    {label:"Req. Mileage",reqKey:"reqMileage", appKey:"appMileage"},
    {label:"Req. Ship",   reqKey:"reqShip",    appKey:"appShip"},
    {label:"Req. Travel", reqKey:"reqTravel",  appKey:"appTravel"},
    {label:"Req. Other",  reqKey:"reqOther",   appKey:"appOther"},
    {label:"Req. Tax",    reqKey:"reqTax",     appKey:"appTax"},
    {label:"Req. Total",  reqKey:"reqTotal",   appKey:"appTotal"},
  ];

  return (
    <main className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Authorization Status</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Authorization Status</h1>
      </div>

      {/* Filter panel */}
      <div className="panel mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Location portal */}
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

          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
              <span className="text-muted-foreground text-xs">~</span>
              <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
            </div>
          </div>

          {/* Auth Status */}
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auth. Status</label>
            <PortalDropdown label="Auth. Status" options={AUTH_STATUSES} value={authStatus} onChange={setAuthStatus}/>
          </div>

          {/* Ticket No */}
          <div className="flex flex-col gap-1 min-w-[160px] flex-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</label>
            <input value={ticketNo} onChange={e=>setTicketNo(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md"/>
          </div>
        </div>
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
            {/* Row 1 header */}
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-2 w-8" rowSpan={2}><input type="checkbox" checked={selectedRows.size===filtered.length&&filtered.length>0} onChange={toggleAll} className="accent-blue-500"/></th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Ticket No</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Account No</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Manufacturer</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase" rowSpan={2}>Redo</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>RfaStatus</th>
              {/* Amount columns group header */}
              {AMOUNT_COLS.map(c=>(
                <th key={c.label} className="px-2 py-1 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap border-l border-white/10">{c.label}</th>
              ))}
              <th className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Requested</th>
              <th className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Approved</th>
            </tr>
            {/* Row 2: App. sub-headers */}
            <tr className="border-b border-white/10 bg-white/3">
              {AMOUNT_COLS.map(c=>(
                <th key={c.appKey} className="px-2 py-1 text-center text-xs text-muted-foreground border-l border-white/5">{c.appKey.replace("app","App. ").replace(/([A-Z])/g," $1").trim()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0
              ?<tr><td colSpan={16} className="px-4 py-12 text-center text-muted-foreground">No records found.</td></tr>
              :filtered.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${selectedRows.has(r.id)?"bg-blue-500/5":idx%2!==0?"bg-white/[0.02]":""}`}>
                  <td className="px-2 py-2"><input type="checkbox" checked={selectedRows.has(r.id)} onChange={()=>toggleRow(r.id)} className="accent-blue-500"/></td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <Link to="/ticket/$ticketNo" params={{ticketNo:r.ticketNo}} className="font-mono text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</Link>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.accountNo}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">{r.manufacturer}</td>
                  <td className="px-2 py-2 text-center">{r.redo}</td>
                  <td className="px-2 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${r.rfaStatus==="Approved"?"bg-green-500/20 text-green-300 border border-green-500/30":r.rfaStatus==="Rejected"?"bg-red-500/20 text-red-300 border border-red-500/30":r.rfaStatus==="Open"?"bg-blue-500/20 text-blue-300 border border-blue-500/30":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"}`}>
                      {r.rfaStatus}
                    </span>
                  </td>
                  {/* Two-row amount cells */}
                  {AMOUNT_COLS.map(c=>(
                    <td key={c.reqKey} className="px-2 py-0 border-l border-white/5 text-right">
                      <div className="py-0.5 text-muted-foreground">{fmt((r as any)[c.reqKey])}</div>
                      <div className="py-0.5 font-medium">{fmt((r as any)[c.appKey])}</div>
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center text-muted-foreground whitespace-nowrap">{r.requested}</td>
                  <td className="px-2 py-2 text-center text-muted-foreground whitespace-nowrap">{r.approved}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        {[10,20,50,100,500].map(n=>(
          <button key={n} onClick={()=>setPageSize(n)} className={`px-2 py-0.5 rounded ${pageSize===n?"bg-blue-600 text-white":"hover:text-foreground"}`}>{n}</button>
        ))}
      </div>
    </main>
  );
}
