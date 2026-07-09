import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer, Save, Check } from "lucide-react";
import { LOCATIONS, ALL_TECHNICIANS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const DS:React.CSSProperties={background:"var(--color-card)",color:"var(--color-foreground)",border:"1px solid var(--color-panel-border)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:260,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

const REPAIR_STATUSES=["Pending","Scheduled","In Progress","Completed","Cancelled","On Hold"];
const PART_STATUSES=["PO Made","Not Used & Stocked","CX Home","Part Ready","Used","Hold for next visit","Not received"];

// Seed rows for demo
const SEED_ROWS = Array.from({length:8},(_,i)=>({
  id: i+1,
  techName: ALL_TECHNICIANS[i % ALL_TECHNICIANS.length] ?? "Tech "+i,
  ticketNo: "01715"+String(1000000+i*137),
  repairStatus: REPAIR_STATUSES[i%REPAIR_STATUSES.length],
  partNo: "PT-"+String(70000+i),
  description: ["Drain Pump","Door Gasket","Control Board","Thermistor","Heating Element","Compressor","Inverter Board","Door Switch"][i%8],
  po: "PO-"+String(6000+i),
  uniqueId: "UID-"+String(10000+i),
  qty: (i%4)+1,
  coreValue: i%3===0?"$25.00":"—",
  partStatus: PART_STATUSES[i%PART_STATUSES.length],
  pickedUp: false,
  action: "",
  comment: "",
  inTransit: i%2===0,
}));

const TODAY=new Date().toISOString().slice(0,10);

export function PartDailyPickup({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [tech,setTech]=useState("");const [techOpen,setTechOpen]=useState(false);
  const [pickupDate,setPickupDate]=useState(TODAY);
  const [rows,setRows]=useState(SEED_ROWS);
  const [saved,setSaved]=useState(false);
  const locD=useP(locOpen);const techD=useP(techOpen);
  const locL=useRef<HTMLDivElement>(null);const techL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;
    if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);
    if(techOpen&&!techD.ref.current?.contains(t)&&!techL.current?.contains(t))setTechOpen(false);
  };document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen,techOpen]);

  const togglePickedUp = (id:number) => {
    setRows(prev=>prev.map(r=>r.id===id?{...r,pickedUp:!r.pickedUp}:r));
  };
  const updateRow = (id:number,field:string,value:string) => {
    setRows(prev=>prev.map(r=>r.id===id?{...r,[field]:value}:r));
  };
  const handleSave = () => {
    setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  };

  const COLS=["Tech Name","Ticket #","Repair Status","Part No","Description","PO","Unique ID","Qty","Core Value","Part Status","Picked Up","Action","Comment","In Transit"];

  return(<div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-8">
    <div className="flex items-center gap-3 mb-6">
      <Link to="/m/$module" params={{module:"parts"}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link>
      <h1 className="text-2xl font-bold">{sub.title}</h1>
    </div>

    {/* Filters */}
    <div className="panel mb-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location*</label>
          <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={location?"":"text-muted-foreground"}>{location||"Select"}</span><Chev o={locOpen}/></button>
          {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}><button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}</div>,document.body)}
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Technician</label>
          <button ref={techD.ref} onClick={()=>setTechOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={tech?"":"text-muted-foreground"}>{tech||"All"}</span><Chev o={techOpen}/></button>
          {techOpen&&techD.pos&&createPortal(<div ref={techL} style={{...DS,top:techD.pos.top,left:techD.pos.left,width:techD.pos.width}}><button onClick={()=>{setTech("");setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{ALL_TECHNICIANS.map((t,i)=><button key={i} onClick={()=>{setTech(t);setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===t?"bg-blue-600 text-white":""}`}>{t}</button>)}</div>,document.body)}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pickup Date*</label>
          <input type="date" value={pickupDate} onChange={e=>setPickupDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-36"/>
        </div>
        <div className="flex items-end gap-2 pb-0.5">
          <button onClick={handleSave} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white"><Save className="h-3.5 w-3.5"/>Save</button>
          <button className="btn flex items-center gap-2 px-4"><Printer className="h-3.5 w-3.5"/>Print</button>
        </div>
      </div>
    </div>

    {/* Table */}
    <div className="panel p-0 w-full">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {COLS.map(h=><th key={h} className="px-2 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r,idx)=>(
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/[0.02]":""}`}>
                <td className="px-2 py-2 whitespace-nowrap">{r.techName}</td>
                <td className="px-2 py-2 font-mono text-blue-400 whitespace-nowrap">{r.ticketNo}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.repairStatus==="Completed"?"bg-green-500/20 text-green-300":r.repairStatus==="Cancelled"?"bg-red-500/20 text-red-300":"bg-blue-500/20 text-blue-300"}`}>{r.repairStatus}</span>
                </td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.partNo}</td>
                <td className="px-2 py-2 max-w-[160px] truncate" title={r.description}>{r.description}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.po}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.uniqueId}</td>
                <td className="px-2 py-2 text-center">{r.qty}</td>
                <td className="px-2 py-2 text-center">{r.coreValue}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-500/20 text-slate-300">{r.partStatus}</span>
                </td>
                {/* Picked Up — clickable toggle, NOT auto-saved */}
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={()=>togglePickedUp(r.id)}
                    className={`h-6 w-6 rounded-md border flex items-center justify-center mx-auto transition-colors ${r.pickedUp?"bg-green-500/30 border-green-500/50 text-green-300":"border-white/20 text-transparent hover:border-white/40"}`}
                    title={r.pickedUp?"Mark as NOT picked up":"Mark as picked up"}
                  >
                    <Check className="h-3.5 w-3.5"/>
                  </button>
                </td>
                <td className="px-2 py-2">
                  <input value={r.action} onChange={e=>updateRow(r.id,"action",e.target.value)} placeholder="—" className="glass-input text-xs py-0.5 px-2 rounded w-24"/>
                </td>
                <td className="px-2 py-2">
                  <input value={r.comment} onChange={e=>updateRow(r.id,"comment",e.target.value)} placeholder="—" className="glass-input text-xs py-0.5 px-2 rounded w-28"/>
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.inTransit?"bg-amber-500/20 text-amber-300":"bg-slate-500/10 text-slate-500"}`}>{r.inTransit?"Yes":"No"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* Global Save */}
    <div className="flex justify-end mt-4 gap-3 items-center">
      {saved&&<span className="text-green-400 text-sm flex items-center gap-1"><Check className="h-4 w-4"/>Saved successfully</span>}
      <button onClick={handleSave} className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-8"><Save className="h-3.5 w-3.5"/>Save All Changes</button>
    </div>
  </main></div>);
}
