import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Save } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const DS:React.CSSProperties={background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:260,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

const ds=(o:number)=>{const d=new Date();d.setDate(d.getDate()+o);return d.toISOString().slice(0,10);};
const TECHS=["Bryeshawn Butler","Seven Grinis","Josh Malloch","Memphis Admin","Percy Smith","Troy Willis","Christian Newson","A. Reyes"];
const PART_DISTS=["Encompass","Marcone-162468","GE","LG","Samsung"];
const REPAIR_STATUSES_SAMPLE=["CL-Ready to Complete","OP-Reschedule Follow up"];
const PART_STATUSES_SAMPLE=["Used","Not Used & Stocked","CX Home","PO Made","Part Ready","Hold for next visit","Not received"];
const pick=<T,>(a:T[],i:number)=>a[i%a.length];
const pad=(n:number)=>String(n).padStart(5,"0");
const PARTS_D=["LOWER SPRAY ARM","DETERGENT MODULE","HEATING ELEMENT","ICE MAKER ASSEMBLY KIT","MAIN HARNESS","ASSEMBLY PCB MAIN","THERMISTOR","PC BOARD","MAIN CONTROL BOARD","REFRIGERATOR DOOR - LEFT HAND DISPENSER","REFRIGERATOR DOOR STOP LEFT","MIDDLE HINGE - LEFT","COMPRESSOR,JIAXIPERA VMH,W/O E","DRYER-FILTER","TUBE-PROCESS,35"];
const ALL=Array.from({length:30},(_,i)=>({id:i+1,techName:pick(TECHS,i),partDist:pick(PART_DISTS,i),ticketNo:"SA-"+pad(3332000+i),scheduled:ds(-1),partNo:["WD22X33499","WD12X28239","WD05X35098","AEQ73449906","WE08X38320","DC92-02388S","DC32-00010C","140171068053","WH22X37840","WR78X48789","WR02X31861","WR13X44945","5304534515","5303305677","5346309"][i%15],description:pick(PARTS_D,i),location:pick(LOCATIONS.slice(1),i),invoiceNo:i%3===0?"1-"+pad(357819+i)+"-0526":"26000"+pad(700000+i)+"DF",qty:1,coreValue:0,repairStatus:pick(REPAIR_STATUSES_SAMPLE,i),repairNote:i%4===0?"ETA 05/"+String(26+i%5).padStart(2,"0"):"",resolution:"",partStatus:pick(PART_STATUSES_SAMPLE,i),raNo:i%5===0?"WD05X"+pad(30000+i):"",note:""}));

export function TechPartInOutReport({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [startDate,setStartDate]=useState(ds(-1));const [endDate,setEndDate]=useState(ds(0));
  const locD=useP(locOpen);const locL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);};document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen]);
  const rows=useMemo(()=>location?ALL.filter(r=>r.location===location):ALL,[location]);
  const PART_STATUS_OPTS=["Used","Not Used & Stocked","CX Home","PO Made","Part Ready","Hold for next visit","Not received","TRACKING"];
  return(<div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1800px] mx-auto w-full px-6 py-8">
    <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
    <div className="panel mb-4"><div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1 min-w-[200px] flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
        <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span><Chev o={locOpen}/></button>
        {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}><button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}</div>,document.body)}
      </div>
      <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schedule Date</label>
        <div className="flex items-center gap-2"><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/><span className="text-muted-foreground text-xs">~</span><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/></div></div>
      <button className="btn flex items-center gap-2 px-4 mb-0.5"><Save className="h-3.5 w-3.5"/>Save</button>
    </div></div>
    <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
    <div className="panel overflow-x-auto p-0"><table className="w-full text-xs">
      <thead><tr className="border-b border-white/10 bg-white/5">{["Tech Name","Part Dist","Ticket #","Scheduled","PartNo","Description","Location","Invoice #","Qty","Core Value","Repair Status","Repair Note","Resolution","Part Status","RA #","Note","Actions"].map(h=><th key={h} className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r,i)=><tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i%2!==0?"bg-white/[0.02]":""}`}>
        <td className="px-2 py-2 whitespace-nowrap">{r.techName}</td>
        <td className="px-2 py-2 text-xs">{r.partDist}</td>
        <td className="px-2 py-2 whitespace-nowrap"><Link to="/ticket/$ticketNo" params={{ticketNo:r.ticketNo}} className="font-mono text-xs text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</Link></td>
        <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.scheduled}</td>
        <td className="px-2 py-2 font-mono text-xs text-blue-400">{r.partNo}</td>
        <td className="px-2 py-2 text-xs max-w-[160px] truncate" title={r.description}>{r.description}</td>
        <td className="px-2 py-2 text-xs">{r.location}</td>
        <td className="px-2 py-2 font-mono text-xs">{r.invoiceNo}</td>
        <td className="px-2 py-2 text-center">{r.qty}</td>
        <td className="px-2 py-2 text-center">{r.coreValue}</td>
        <td className="px-2 py-2 text-xs whitespace-nowrap">{r.repairStatus}</td>
        <td className="px-2 py-2 text-xs text-muted-foreground max-w-[120px] truncate" title={r.repairNote}>{r.repairNote||"—"}</td>
        <td className="px-2 py-2 text-xs text-muted-foreground max-w-[120px] truncate" title={r.resolution}>{r.resolution||"—"}</td>
        <td className="px-2 py-2"><select className="glass-input text-xs py-0.5 px-1 rounded w-28" defaultValue={r.partStatus}>{PART_STATUS_OPTS.map(s=><option key={s} value={s}>{s}</option>)}</select></td>
        <td className="px-2 py-2 font-mono text-xs">{r.raNo||""}</td>
        <td className="px-2 py-2 text-xs text-muted-foreground">{r.note}</td>
        <td className="px-2 py-2"><button className="text-red-400 hover:text-red-300 text-xs">›Delete</button></td>
      </tr>)}</tbody>
    </table></div>
  </main></div>);}
