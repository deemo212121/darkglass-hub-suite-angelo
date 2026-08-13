import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer, Save, CheckCircle, Loader2, Undo2, ScanLine } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { sendNotificationToRole } from "@/lib/firebase/notifications";
import { getCompanyTechnicians } from "@/lib/supabase/users";
import { getPartsForDailyCollection, updatePartCollectionRow, suggestCollectType, type PartCollectionRow } from "@/lib/supabase/partDailyCollection";

const DS:React.CSSProperties={background:"var(--color-card)",color:"var(--color-foreground)",border:"1px solid var(--color-panel-border)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:260,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

const DATE_TYPES=["Pickup Date","Collect Date"] as const;
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
  const [dateType,setDateType]=useState<typeof DATE_TYPES[number]>("Pickup Date");const [dtOpen,setDtOpen]=useState(false);
  const [collectType,setCollectType]=useState("");const [ctOpen,setCtOpen]=useState(false);
  const [startDate,setStartDate]=useState(getDefaultCollectionDate);const [endDate,setEndDate]=useState(getDefaultCollectionDate);
  const [ticketNo,setTicketNo]=useState(""); const [notCollected,setNotCollected]=useState(true);const [collected,setCollected]=useState(false);
  const [restockToast,setRestockToast]=useState("");
  const [technicianRoster,setTechnicianRoster]=useState<string[]>([]);
  const [rows,setRows]=useState<PartCollectionRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState<string|null>(null);
  const [saved,setSaved]=useState(false);
  const [scanUniqueId,setScanUniqueId]=useState("");
  const scanRef=useRef<HTMLInputElement>(null);
  useEffect(() => {
    getCompanyTechnicians()
      .then((techs) => setTechnicianRoster(techs.map((t) => t.name)))
      .catch((err) => console.error("Failed to load technician roster:", err));
  }, []);

  const loadRows = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getPartsForDailyCollection({
      location: location || undefined,
      technician: tech || undefined,
      dateType,
      startDate,
      endDate,
      ticketNo: ticketNo || undefined,
      notCollected,
      collected,
      collectType: collectType || undefined,
    })
      .then(setRows)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [location, tech, dateType, startDate, endDate, ticketNo, notCollected, collected, collectType]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const updateRowField = (id: string, patch: Partial<PartCollectionRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const toggleCollected = (id: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      if (r.collected) return { ...r, collected: false, collectedDate: "" };
      return {
        ...r,
        collected: true,
        collectedDate: TODAY,
        collectType: r.collectType || suggestCollectType(r.partStatus),
      };
    }));
  };

  // Scan a Unique ID (matches the row's id prefix, same placeholder
  // convention Part Daily Pickup already uses — this schema has no real
  // formatted business tracking code) to mark it Collected in one step.
  const handleScan = () => {
    const q = scanUniqueId.trim().toLowerCase();
    if (!q) return;
    const match = rows.find((r) => r.uniqueId.toLowerCase() === q && !r.collected);
    if (match) {
      toggleCollected(match.id);
      setScanUniqueId("");
    } else {
      setSaveError(`No un-collected row matches Unique ID "${scanUniqueId}".`);
      setTimeout(() => setSaveError(null), 3000);
    }
    scanRef.current?.focus();
  };

  // When collect type is set to "Restock" and saved, fire a notification
  // to the Parts Manager role that this part is back in stock.
  const notifyRestock = useCallback(async (row: PartCollectionRow) => {
    try {
      await sendNotificationToRole("Parts Manager", companyId ?? "", {
        kind: "restock_auto",
        title: "Part back in stock",
        body: `Ticket ${row.ticketNo} — part ${row.partNo} marked as Restock by tech ${row.techName || "unknown"}.`,
        ticketNo: row.ticketNo,
        link: `/ticket/${row.ticketNo}`,
      });
      setRestockToast("Part marked as back in stock — Parts Manager notified.");
      setTimeout(() => setRestockToast(""), 4000);
    } catch (err) {
      console.error("Restock notification failed:", err);
    }
  }, [companyId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all(rows.map((r) =>
        updatePartCollectionRow(r.id, {
          collected: r.collected,
          collectedDate: r.collectedDate,
          usedQty: r.usedQty,
          restockQty: r.restockQty,
          collectType: r.collectType,
          lotNo: r.lotNo,
          comment: r.comment,
        })
      ));
      const restocked = rows.filter((r) => r.collected && r.collectType === "Restock");
      for (const r of restocked) await notifyRestock(r);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }, [rows, notifyRestock]);

  const locD=useP(locOpen);const techD=useP(techOpen);const dtD=useP(dtOpen);const ctD=useP(ctOpen);
  const locL=useRef<HTMLDivElement>(null);const techL=useRef<HTMLDivElement>(null);const dtL=useRef<HTMLDivElement>(null);const ctL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;
    if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);
    if(techOpen&&!techD.ref.current?.contains(t)&&!techL.current?.contains(t))setTechOpen(false);
    if(dtOpen&&!dtD.ref.current?.contains(t)&&!dtL.current?.contains(t))setDtOpen(false);
    if(ctOpen&&!ctD.ref.current?.contains(t)&&!ctL.current?.contains(t))setCtOpen(false);
  };document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen,techOpen,dtOpen,ctOpen]);

  const COLS=["Technician","Picked Up","Collected","Part No","Description","Unique ID","Core Value","Ticket #","Repair Status","Qty","Used Qty","Restock Qty","Collect Type","Lot #","Comment","Part Status","Action"];

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
        <div className="flex flex-col gap-1 min-w-[140px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{dateType}</label>
          <button ref={dtD.ref} onClick={()=>setDtOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span>{dateType}</span><Chev o={dtOpen}/></button>
          {dtOpen&&dtD.pos&&createPortal(<div ref={dtL} style={{...DS,top:dtD.pos.top,left:dtD.pos.left,width:dtD.pos.width}}>{DATE_TYPES.map((d,i)=><button key={i} onClick={()=>{setDateType(d);setDtOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${dateType===d?"bg-blue-600 text-white":""}`}>{d}</button>)}</div>,document.body)}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          <span className="text-muted-foreground text-xs">~</span>
          <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
        </div>
        <div className="flex items-end gap-2 pb-0.5">
          <button onClick={handleSave} disabled={saving||loading} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"><Save className="h-3.5 w-3.5"/>{saving?"Saving…":"Save"}</button>
          <button onClick={()=>window.print()} className="btn flex items-center gap-2 px-4"><Printer className="h-3.5 w-3.5"/>Print</button>
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
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scan Parts Here (Unique ID)</label>
          <div className="flex gap-2">
            <input ref={scanRef} value={scanUniqueId} onChange={e=>setScanUniqueId(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleScan();}} placeholder="Unique ID" className="glass-input text-sm py-1.5 px-3 rounded-md flex-1"/>
            <button onClick={handleScan} className="btn flex items-center gap-2 px-3 bg-blue-600 hover:bg-blue-700 text-white"><ScanLine className="h-3.5 w-3.5"/>Collect</button>
          </div>
        </div>
      </div>
    </div>

    <div className="panel p-0 w-full">
      {loadError ? (
        <p className="text-sm text-red-400 px-4 py-6">Failed to load parts: {loadError}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground px-4 py-6">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground px-4 py-6">No parts match these filters.</p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {COLS.map(h=><th key={h} className="px-2 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r,idx)=>(
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/[0.02]":""}`}>
                <td className="px-2 py-2 whitespace-nowrap">{r.techName||"—"}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.pickedUpDate||"—"}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.collectedDate||"—"}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.partNo}</td>
                <td className="px-2 py-2 max-w-[160px] truncate" title={r.description}>{r.description}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap text-[10px] text-muted-foreground" title={r.id}>{r.uniqueId}</td>
                <td className="px-2 py-2 text-center">{r.coreValue > 0 ? `$${r.coreValue.toFixed(2)}` : "—"}</td>
                <td className="px-2 py-2 font-mono text-blue-400 whitespace-nowrap">{r.ticketNo}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.repairStatus||"—"}</td>
                <td className="px-2 py-2 text-center">{r.quantity}</td>
                <td className="px-2 py-2 text-center">
                  <input type="number" value={r.usedQty} onChange={e=>updateRowField(r.id,{usedQty:Number(e.target.value)})} className="glass-input text-xs py-0.5 px-1.5 rounded w-14 text-center"/>
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="number" value={r.restockQty} onChange={e=>updateRowField(r.id,{restockQty:Number(e.target.value)})} className="glass-input text-xs py-0.5 px-1.5 rounded w-14 text-center"/>
                </td>
                <td className="px-2 py-2">
                  <select value={r.collectType} onChange={e=>updateRowField(r.id,{collectType:e.target.value})} className="glass-input text-xs py-0.5 px-1.5 rounded w-full">
                    <option value="">—</option>
                    {COLLECT_TYPES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input value={r.lotNo} onChange={e=>updateRowField(r.id,{lotNo:e.target.value})} placeholder="—" className="glass-input text-xs py-0.5 px-2 rounded w-20"/>
                </td>
                <td className="px-2 py-2">
                  <input value={r.comment} onChange={e=>updateRowField(r.id,{comment:e.target.value})} placeholder="—" className="glass-input text-xs py-0.5 px-2 rounded w-32"/>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-500/20 text-slate-300">{r.partStatus||"—"}</span>
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={()=>toggleCollected(r.id)}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium border transition-colors ${r.collected?"border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20":"border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20"}`}
                    title={r.collected?"Revert — mark as not collected":"Mark as collected"}
                  >
                    {r.collected ? <><Undo2 className="h-3 w-3"/>Revert</> : "Collect"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>

    {saveError && <p className="text-xs text-red-400 mt-2 text-center">{saveError}</p>}
    <div className="flex justify-end mt-4 gap-3 items-center">
      {saved&&<span className="text-green-400 text-sm flex items-center gap-1"><CheckCircle className="h-4 w-4"/>Saved successfully</span>}
      <button onClick={handleSave} disabled={saving||loading||rows.length===0} className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-8 disabled:opacity-50">{saving?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Save className="h-3.5 w-3.5"/>}{saving?"Saving…":"Save All Changes"}</button>
    </div>
    {restockToast&&<div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/15 px-4 py-3 text-sm text-green-300 shadow-2xl backdrop-blur-md"><CheckCircle className="h-4 w-4"/>{restockToast}</div>}
  </main></div>);}
