import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer, Save, CheckCircle, Check } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { sendNotificationToRole } from "@/lib/firebase/notifications";
import { getCompanyTechnicians } from "@/lib/supabase/users";
import { addPendingDoneItem, removePendingDoneItem } from "@/lib/partsDoneQueue";

const PARTS_DONE_QUEUE_SOURCE = "Part Daily Collection";

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
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface CollectionExampleRow {
  id: string;
  techName: string;
  ticketNo: string;
  location: string;
  partNo: string;
  description: string;
  po: string;
  quantity: number;
  coreValue: number;
  collectType: string;
  pickupDate: string;
  collectDate: string;
  collected: boolean;
  comment: string;
}

// TEMPORARY — no real data source is wired up for this page yet (see
// PartDailyPickup.tsx's getPartsForDailyPickup for what a real one looks
// like). This is hardcoded placeholder data so the table has something
// to look at / iterate the design against in the meantime; nothing here
// is persisted anywhere.
export const EXAMPLE_COLLECTION_ROWS: CollectionExampleRow[] = [
  { id: "ex-1", techName: "Abel Severino", ticketNo: "26000671722HS", location: "Atlanta", partNo: "11101010016460", description: "Fixed Speed Reciprocating Comp", po: "1007567278-10-AV", quantity: 1, coreValue: 45, collectType: "Defective", pickupDate: daysAgoIso(1), collectDate: daysAgoIso(1), collected: true, comment: "Picked up at office" },
  { id: "ex-2", techName: "Darrin Stewart", ticketNo: "1007567278-10-AV", location: "Memphis", partNo: "4056017371", description: "Pipe", po: "PO-260702-001", quantity: 2, coreValue: 0, collectType: "Used", pickupDate: daysAgoIso(1), collectDate: daysAgoIso(1), collected: false, comment: "" },
  { id: "ex-3", techName: "John Godfrey", ticketNo: "SA-3349588-AV", location: "Nashville", partNo: "WE22X37340", description: "User Interface Board FL Dryer 87 & 95", po: "12-606043-0526", quantity: 1, coreValue: 0, collectType: "Hold by Technician", pickupDate: daysAgoIso(2), collectDate: daysAgoIso(2), collected: false, comment: "Waiting on tech schedule" },
  { id: "ex-4", techName: "Zonate Grant", ticketNo: "1234567", location: "Birmingham", partNo: "WE04X24719", description: "Button Start ASM", po: "75112201", quantity: 1, coreValue: 12.5, collectType: "In Review", pickupDate: daysAgoIso(2), collectDate: daysAgoIso(2), collected: false, comment: "" },
  { id: "ex-5", techName: "Erick Guzman Juarez", ticketNo: "1007685370-10-AV", location: "San Antonio", partNo: "140156010054", description: "Manifold, Water Filter, W/NO Con", po: "1-55553", quantity: 1, coreValue: 0, collectType: "Restock", pickupDate: daysAgoIso(3), collectDate: daysAgoIso(3), collected: true, comment: "Back in stock" },
  { id: "ex-6", techName: "Cole Mushinsky", ticketNo: "3868626E1", location: "New Orleans", partNo: "WE03X25285", description: "Knob Main ASM", po: "PO-260702-001", quantity: 1, coreValue: 0, collectType: "Used (Core)", pickupDate: daysAgoIso(1), collectDate: daysAgoIso(1), collected: true, comment: "Core returned" },
];

export function PartDailyCollection({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const { companyId } = useAuth();
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [tech,setTech]=useState("");const [techOpen,setTechOpen]=useState(false);
  const [dateType,setDateType]=useState("Pickup Date");const [dtOpen,setDtOpen]=useState(false);
  const [collectType,setCollectType]=useState("");const [ctOpen,setCtOpen]=useState(false);
  const [startDate,setStartDate]=useState(getDefaultCollectionDate);const [endDate,setEndDate]=useState(getDefaultCollectionDate);
  const [ticketNo,setTicketNo]=useState(""); const [notCollected,setNotCollected]=useState(true);const [collected,setCollected]=useState(false);
  const [restockToast,setRestockToast]=useState("");
  const [technicianRoster,setTechnicianRoster]=useState<string[]>([]);
  // TEMPORARY example rows — see EXAMPLE_COLLECTION_ROWS above. Toggling
  // Collected only updates this local state, nothing is saved anywhere.
  const [rows,setRows]=useState<CollectionExampleRow[]>(EXAMPLE_COLLECTION_ROWS);
  const toggleRowCollected=(id:string)=>{
    setRows(prev=>prev.map(r=>{
      if(r.id!==id) return r;
      const next={...r,collected:!r.collected};
      const label=`${next.partNo||next.id} (Ticket ${next.ticketNo||"—"})`;
      if(next.collected) addPendingDoneItem(PARTS_DONE_QUEUE_SOURCE,id,label,next.location);
      else removePendingDoneItem(PARTS_DONE_QUEUE_SOURCE,id);
      return next;
    }));
  };
  useEffect(() => {
    getCompanyTechnicians()
      .then((techs) => setTechnicianRoster(techs.map((t) => t.name)))
      .catch((err) => console.error("Failed to load technician roster:", err));
  }, []);

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

  const filteredRows = rows.filter((r) => {
    if (location && r.location !== location) return false;
    if (tech && r.techName !== tech) return false;
    if (ticketNo && !r.ticketNo.toLowerCase().includes(ticketNo.trim().toLowerCase())) return false;
    if (collectType && r.collectType !== collectType) return false;
    const rowDate = dateType === "Collect Date" ? r.collectDate : r.pickupDate;
    if (startDate && rowDate < startDate) return false;
    if (endDate && rowDate > endDate) return false;
    return r.collected ? collected : notCollected;
  });

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
          {techOpen&&techD.pos&&createPortal(<div ref={techL} style={{...DS,top:techD.pos.top,left:techD.pos.left,width:techD.pos.width}}><button onClick={()=>{setTech("");setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{technicianRoster.map((t,i)=><button key={i} onClick={()=>{setTech(t);setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===t?"bg-blue-600 text-white":""}`}>{t}</button>)}</div>,document.body)}
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
    <p className="text-xs text-amber-400 mb-2">Showing example data for now — this page isn't connected to real records yet.</p>
    <div className="panel p-0 w-full">
      {filteredRows.length===0 ? (
        <p className="text-sm text-muted-foreground px-4 py-6">No example rows match these filters.</p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {["Tech Name","Ticket #","Location","Part No","Description","PO","Qty","Core Value","Collect Type","Collected","Comment"].map(h=>
              <th key={h} className="px-2 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
            )}
          </tr></thead>
          <tbody>
            {filteredRows.map((r,idx)=>(
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/[0.02]":""}`}>
                <td className="px-2 py-2 whitespace-nowrap">{r.techName}</td>
                <td className="px-2 py-2 font-mono text-blue-400 whitespace-nowrap">{r.ticketNo}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.location}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.partNo}</td>
                <td className="px-2 py-2 max-w-[200px] truncate" title={r.description}>{r.description}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.po}</td>
                <td className="px-2 py-2 text-center">{r.quantity}</td>
                <td className="px-2 py-2 text-center">{r.coreValue > 0 ? `$${r.coreValue.toFixed(2)}` : "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-500/20 text-slate-300">{r.collectType}</span>
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={()=>toggleRowCollected(r.id)}
                    className={`h-6 w-6 rounded-md border flex items-center justify-center mx-auto transition-colors ${r.collected?"bg-green-500/30 border-green-500/50 text-green-300":"border-white/20 text-transparent hover:border-white/40"}`}
                    title={r.collected?"Mark as NOT collected":"Mark as collected"}
                  >
                    <Check className="h-3.5 w-3.5"/>
                  </button>
                </td>
                <td className="px-2 py-2 max-w-[160px] truncate" title={r.comment}>{r.comment || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
    <div className="flex justify-center mt-4"><button className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-8"><Save className="h-3.5 w-3.5"/>Save</button></div>
    {restockToast&&<div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/15 px-4 py-3 text-sm text-green-300 shadow-2xl backdrop-blur-md"><CheckCircle className="h-4 w-4"/>{restockToast}</div>}
  </main></div>);}
