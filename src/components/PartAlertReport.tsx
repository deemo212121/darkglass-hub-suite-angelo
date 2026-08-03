import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const DS:React.CSSProperties={background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:280,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

const pad=(n:number)=>String(n).padStart(5,"0");
const pick=<T,>(a:T[],i:number)=>a[i%a.length];
const PARTS=["Drain Pump","Door Gasket","Control Board","Thermistor","Heating Element","Compressor","Inverter Board","Door Switch"];
const DR_DATA=Array.from({length:15},(_,i)=>({id:i+1,ticketNo:"TK-2026-"+pad(1000+i),partNo:"PT-"+pad(70000+i),description:pick(PARTS,i),location:pick(LOCATIONS.slice(1),i),reservedCount:2+(i%3),issue:"Double Reserved"}));
const PO_DATA=Array.from({length:12},(_,i)=>({id:i+1,ticketNo:"TK-2026-"+pad(2000+i),partNo:"PT-"+pad(80000+i),description:pick(PARTS,i),location:pick(LOCATIONS.slice(1),i),issue:["PO Missing","PO Mismatch","No Invoice"][i%3]}));

export function PartAlertReport({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [tab,setTab]=useState<"dr"|"po">("dr");
  const locD=useP(locOpen);const locL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);};document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen]);
  const rows=useMemo(()=>{const data=tab==="dr"?DR_DATA:PO_DATA;return location?data.filter(x=>x.location===location):data;},[location,tab]);
  return(<div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
    <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
    <div className="panel mb-4"><div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1 flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location*</label>
        <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span><Chev o={locOpen}/></button>
        {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}><button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}</div>,document.body)}
      </div>
    </div></div>
    <div className="flex items-center gap-2 mb-4">
      <button onClick={()=>setTab("dr")} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab==="dr"?"bg-blue-600 text-white":"btn"}`}>Double Reserved</button>
      <button onClick={()=>setTab("po")} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab==="po"?"bg-blue-600 text-white":"btn"}`}>P/O Problem found</button>
    </div>
    <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
    <div className="panel overflow-x-auto p-0"><table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">{["#","Ticket No","Part No","Description","Location","Issue"].map(h=><th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
    <tbody>{rows.length===0?<tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No alerts found.</td></tr>:rows.map((r,idx)=><tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/[0.02]":""}`}><td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td><td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.ticketNo}</td><td className="px-3 py-2.5 font-mono text-xs">{r.partNo}</td><td className="px-3 py-2.5 text-xs">{r.description}</td><td className="px-3 py-2.5 text-xs">{r.location}</td><td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30">{r.issue}</span></td></tr>)}</tbody></table></div>
  </main></div>);}
