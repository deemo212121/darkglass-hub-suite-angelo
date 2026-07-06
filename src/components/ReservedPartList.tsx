import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { LOCATIONS, ALL_TECHNICIANS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const DS:React.CSSProperties={background:"var(--color-card)",color:"var(--color-foreground)",border:"1px solid var(--color-panel-border)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:260,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

const ds=(o:number)=>{const d=new Date();d.setDate(d.getDate()+o);return d.toISOString().slice(0,10);};
const pad=(n:number)=>String(n).padStart(5,"0");
const pick=<T,>(a:T[],i:number)=>a[i%a.length];
const PARTS=["Drain Pump","Door Gasket","Control Board","Thermistor","Heating Element","Compressor","Inverter Board","Door Switch"];
const ALL=Array.from({length:25},(_,i)=>({id:i+1,partNo:"PT-"+pad(70000+i),description:pick(PARTS,i),ticketNo:"TK-2026-"+pad(1000+i),tech:pick(ALL_TECHNICIANS,i),location:pick(LOCATIONS.slice(1),i),invoiceNo:i%3===0?"INV-"+pad(100000+i):"",scheduleDate:ds((i%14)-3),qty:1+(i%3)}));

export function ReservedPartList({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [tech,setTech]=useState("");const [techOpen,setTechOpen]=useState(false);
  const [scheduleDate,setScheduleDate]=useState(false);const [scheduleDateVal,setScheduleDateVal]=useState(ds(1));
  const [partNo,setPartNo]=useState("");const [invoiceNo,setInvoiceNo]=useState("");
  const [showAllStatus,setShowAllStatus]=useState(false);const [startDate,setStartDate]=useState("2026-05-01");const [endDate,setEndDate]=useState("2026-05-31");
  const locD=useP(locOpen);const techD=useP(techOpen);const locL=useRef<HTMLDivElement>(null);const techL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);if(techOpen&&!techD.ref.current?.contains(t)&&!techL.current?.contains(t))setTechOpen(false);};document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen,techOpen]);
  const rows=useMemo(()=>{let r=ALL;if(location)r=r.filter(x=>x.location===location);if(tech)r=r.filter(x=>x.tech===tech);if(partNo)r=r.filter(x=>x.partNo.toLowerCase().includes(partNo.toLowerCase()));if(invoiceNo)r=r.filter(x=>x.invoiceNo.toLowerCase().includes(invoiceNo.toLowerCase()));return r;},[location,tech,partNo,invoiceNo]);
  return(<div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
    <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
    <div className="panel mb-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[160px] flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
          <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={location?"":"text-muted-foreground"}>{location||"All"}</span><Chev o={locOpen}/></button>
          {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}><button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}</div>,document.body)}
        </div>
        <div className="flex flex-col gap-1 min-w-[160px] flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Technician</label>
          <button ref={techD.ref} onClick={()=>setTechOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={tech?"":"text-muted-foreground"}>{tech||"All"}</span><Chev o={techOpen}/></button>
          {techOpen&&techD.pos&&createPortal(<div ref={techL} style={{...DS,top:techD.pos.top,left:techD.pos.left,width:techD.pos.width}}><button onClick={()=>{setTech("");setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{ALL_TECHNICIANS.map((t,i)=><button key={i} onClick={()=>{setTech(t);setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===t?"bg-blue-600 text-white":""}`}>{t}</button>)}</div>,document.body)}
        </div>
        <div className="flex items-end gap-3 pb-0.5">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={scheduleDate} onChange={e=>setScheduleDate(e.target.checked)} className="accent-blue-500"/>Schedule Date</label>
          {scheduleDate&&<input type="date" value={scheduleDateVal} onChange={e=>setScheduleDateVal(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Part #</label><input value={partNo} onChange={e=>setPartNo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"/></div>
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invoice #</label><input value={invoiceNo} onChange={e=>setInvoiceNo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"/></div>
        <div className="flex items-end gap-3 pb-0.5">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={showAllStatus} onChange={e=>setShowAllStatus(e.target.checked)} className="accent-blue-500"/>Show All Repair Status (Cancel/Complete Date)</label>
          {showAllStatus&&<><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/><span className="text-muted-foreground text-xs">~</span><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/></>}
        </div>
      </div>
    </div>
    <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
    <div className="panel overflow-x-auto p-0"><table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">{["#","Part #","Description","Ticket No","Technician","Location","Invoice #","Schedule Date","Qty"].map(h=><th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i%2!==0?"bg-white/[0.02]":""}`}><td className="px-3 py-2.5 text-muted-foreground">{i+1}</td><td className="px-3 py-2.5 font-mono text-xs">{r.partNo}</td><td className="px-3 py-2.5 text-xs">{r.description}</td><td className="px-3 py-2.5 font-mono text-xs"><a href={`/ticket/${r.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</a></td><td className="px-3 py-2.5 text-xs">{r.tech}</td><td className="px-3 py-2.5 text-xs">{r.location}</td><td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.invoiceNo||"—"}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{r.scheduleDate}</td><td className="px-3 py-2.5 text-right">{r.qty}</td></tr>)}</tbody></table></div>
  </main></div>);}
