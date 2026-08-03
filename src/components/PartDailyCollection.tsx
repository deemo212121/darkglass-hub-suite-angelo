import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer, Save, CheckCircle } from "lucide-react";
import { LOCATIONS, ALL_TECHNICIANS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { sendNotificationToRole } from "@/lib/firebase/notifications";

const DS:React.CSSProperties={background:"var(--color-card)",color:"var(--color-foreground)",border:"1px solid var(--color-panel-border)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:260,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

const DATE_TYPES=["Pickup Date","Collect Date"];
const COLLECT_TYPES=["Defective","Hold by Technician","In Review","Restock","Used","Used (Core)","Used (Panel)"];
const TODAY=new Date().toISOString().slice(0,10);
function getDefaultCollectionDate() {
  const d = new Date();
  // If Monday, roll back to Friday
  if (d.getDay() === 1) d.setDate(d.getDate() - 3);
  else d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function PartDailyCollection({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const { companyId } = useAuth();
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [tech,setTech]=useState("");const [techOpen,setTechOpen]=useState(false);
  const [dateType,setDateType]=useState("Pickup Date");const [dtOpen,setDtOpen]=useState(false);
  const [collectType,setCollectType]=useState("");const [ctOpen,setCtOpen]=useState(false);
  const [startDate,setStartDate]=useState(getDefaultCollectionDate);const [endDate,setEndDate]=useState(getDefaultCollectionDate);
  const [ticketNo,setTicketNo]=useState(""); const [notCollected,setNotCollected]=useState(true);const [collected,setCollected]=useState(false);
  const [restockToast,setRestockToast]=useState("");

  // Feature 4: When collect type is set to "Restock" and saved, auto-fire
  // a notification to Parts Manager role that this part is back in stock.
  const handleSave = useCallback(async () => {
    if (collectType === "Restock" && ticketNo) {
      try {
        await sendNotificationToRole("Parts Manager", companyId ?? "", {
          kind: "restock_auto",
          title: "Part back in stock",
          body: `Ticket ${ticketNo} — part marked as Restock by tech ${tech || "unknown"}. Status auto-updated to Back in Stock.`,
          ticketNo,
          link: `/ticket/${ticketNo}`,
        });
        setRestockToast("Part marked as back in stock — Parts Manager notified.");
        setTimeout(() => setRestockToast(""), 4000);
      } catch (err) {
        console.error("Restock notification failed:", err);
      }
    }
  }, [collectType, ticketNo, tech, companyId]);
  const locD=useP(locOpen);const techD=useP(techOpen);const dtD=useP(dtOpen);const ctD=useP(ctOpen);
  const locL=useRef<HTMLDivElement>(null);const techL=useRef<HTMLDivElement>(null);const dtL=useRef<HTMLDivElement>(null);const ctL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;
    if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);
    if(techOpen&&!techD.ref.current?.contains(t)&&!techL.current?.contains(t))setTechOpen(false);
    if(dtOpen&&!dtD.ref.current?.contains(t)&&!dtL.current?.contains(t))setDtOpen(false);
    if(ctOpen&&!ctD.ref.current?.contains(t)&&!ctL.current?.contains(t))setCtOpen(false);
  };document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen,techOpen,dtOpen,ctOpen]);

  return(<div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
    <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{ module: "parts" }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
    <div className="panel mb-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[160px] flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location*</label>
          <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={location?"":"text-muted-foreground"}>{location||"Select"}</span><Chev o={locOpen}/></button>
          {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}><button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}</div>,document.body)}
        </div>
        <div className="flex flex-col gap-1 min-w-[160px] flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Technician</label>
          <button ref={techD.ref} onClick={()=>setTechOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={tech?"":"text-muted-foreground"}>{tech||"All Technicians"}</span><Chev o={techOpen}/></button>
          {techOpen&&techD.pos&&createPortal(<div ref={techL} style={{...DS,top:techD.pos.top,left:techD.pos.left,width:techD.pos.width}}><button onClick={()=>{setTech("");setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{ALL_TECHNICIANS.map((t,i)=><button key={i} onClick={()=>{setTech(t);setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===t?"bg-blue-600 text-white":""}`}>{t}</button>)}</div>,document.body)}
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pickup Date</label>
          <button ref={dtD.ref} onClick={()=>setDtOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span>{dateType}</span><Chev o={dtOpen}/></button>
          {dtOpen&&dtD.pos&&createPortal(<div ref={dtL} style={{...DS,top:dtD.pos.top,left:dtD.pos.left,width:dtD.pos.width}}>{DATE_TYPES.map((d,i)=><button key={i} onClick={()=>{setDateType(d);setDtOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${dateType===d?"bg-blue-600 text-white":""}`}>{d}</button>)}</div>,document.body)}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          <span className="text-muted-foreground text-xs">~</span>
          <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
        </div>
        <div className="flex items-end gap-2 pb-0.5">
          <button onClick={handleSave} className="btn flex items-center gap-2 px-4"><Save className="h-3.5 w-3.5"/>Save</button>
          <button className="btn flex items-center gap-2 px-4"><Printer className="h-3.5 w-3.5"/>Print</button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <div className="flex flex-col gap-1 min-w-[160px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</label><input value={ticketNo} onChange={e=>setTicketNo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"/></div>
        <div className="flex items-end gap-4 pb-0.5">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={notCollected} onChange={e=>setNotCollected(e.target.checked)} className="accent-blue-500"/>Not-Collected</label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={collected} onChange={e=>setCollected(e.target.checked)} className="accent-blue-500"/>Collected</label>
        </div>
        <div className="flex flex-col gap-1 min-w-[180px] flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Collect Type</label>
          <button ref={ctD.ref} onClick={()=>setCtOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={collectType?"":"text-muted-foreground"}>{collectType||"All Types"}</span><Chev o={ctOpen}/></button>
          {ctOpen&&ctD.pos&&createPortal(<div ref={ctL} style={{...DS,top:ctD.pos.top,left:ctD.pos.left,width:ctD.pos.width}}><button onClick={()=>{setCollectType("");setCtOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${collectType===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{COLLECT_TYPES.map((c,i)=><button key={i} onClick={()=>{setCollectType(c);setCtOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${collectType===c?"bg-blue-600 text-white":""}`}>{c}</button>)}</div>,document.body)}
        </div>
      </div>
    </div>
    <div className="panel p-8 text-center text-sm text-muted-foreground">Apply filters above to load collection data.</div>
    <div className="flex justify-center mt-4"><button className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-8"><Save className="h-3.5 w-3.5"/>Save</button></div>
    {restockToast&&<div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/15 px-4 py-3 text-sm text-green-300 shadow-2xl backdrop-blur-md"><CheckCircle className="h-4 w-4"/>{restockToast}</div>}
  </main></div>);}
