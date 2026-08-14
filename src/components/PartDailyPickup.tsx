import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer, Save, Check } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { getCompanyUsers } from "@/lib/supabase/users";
import { getPartsForDailyPickup, updatePartPickupRow, EXAMPLE_PICKUP_ROWS, type PartPickupRow } from "@/lib/supabase/partDailyPickup";
import { addPendingDoneItem, removePendingDoneItem } from "@/lib/partsDoneQueue";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const PARTS_DONE_QUEUE_SOURCE = "Part Daily Pickup";

const DS:React.CSSProperties={background:"var(--color-card)",color:"var(--color-foreground)",border:"1px solid var(--color-panel-border)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:260,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

// Real ticket.status values are free-form ("OP-Ready for Service",
// "CL-Claimed", ...), not the fixed category set this page used to fake.
function repairStatusClass(status: string): string {
  const s = status.toUpperCase();
  if (s.includes("CANCEL")) return "bg-red-500/20 text-red-300";
  if (s.startsWith("CL-")) return "bg-green-500/20 text-green-300";
  return "bg-blue-500/20 text-blue-300";
}

const TODAY=new Date().toISOString().slice(0,10);

export function PartDailyPickup({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [tech,setTech]=useState("");const [techOpen,setTechOpen]=useState(false);
  const [pickupDate,setPickupDate]=useState(TODAY);
  const [rows,setRows]=useState<PartPickupRow[]>([]);
  const [technicianRoster,setTechnicianRoster]=useState<string[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [saveError,setSaveError]=useState<string|null>(null);
  const [saved,setSaved]=useState(false);
  const [usingExampleData,setUsingExampleData]=useState(false);
  const locD=useP(locOpen);const techD=useP(techOpen);
  const locL=useRef<HTMLDivElement>(null);const techL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;
    if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);
    if(techOpen&&!techD.ref.current?.contains(t)&&!techL.current?.contains(t))setTechOpen(false);
  };document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen,techOpen]);

  // Real active technician roster (same source as the Admin "Default
  // Technician" panel) instead of the static ALL_TECHNICIANS seed list,
  // so the filter dropdown only offers names that can actually match a
  // real ticket.technician value.
  useEffect(() => {
    getCompanyUsers().then((users) => {
      const names = users
        .filter((u) => {
          const roles = [u.role, ...(u.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
          return u.is_active && (roles.includes("TECHNICIAN") || roles.includes("TECHNICIAN_MANAGER"));
        })
        .map((u) => u.display_name || u.email)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setTechnicianRoster(names);
    }).catch((err) => console.error("Failed to load technician roster:", err));
  }, []);

  const loadRows = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getPartsForDailyPickup({ location: location || undefined, technician: tech || undefined, pickupDate })
      .then((data) => {
        if (data.length === 0) {
          setRows(
            EXAMPLE_PICKUP_ROWS.filter((r) => (!location || r.location === location) && (!tech || r.techName === tech))
          );
          setUsingExampleData(true);
        } else {
          setRows(data);
          setUsingExampleData(false);
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [location, tech, pickupDate]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const togglePickedUp = (id:string) => {
    setRows(prev=>prev.map(r=>{
      if(r.id!==id) return r;
      const next={...r,pickedUp:!r.pickedUp};
      const label=`${next.partNo||next.id} (Ticket ${next.ticketNo||"—"})`;
      if(next.pickedUp) addPendingDoneItem(PARTS_DONE_QUEUE_SOURCE,id,label,next.location);
      else removePendingDoneItem(PARTS_DONE_QUEUE_SOURCE,id);
      return next;
    }));
  };
  const updateRow = (id:string,field:"action"|"comment",value:string) => {
    setRows(prev=>prev.map(r=>r.id===id?{...r,[field]:value}:r));
  };
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Example rows (id starts "ex-") aren't real part records — never
      // send those to Supabase, just let the toggle/Save UX work locally.
      await Promise.all(
        rows.filter((r) => !r.id.startsWith("ex-")).map((r) =>
          updatePartPickupRow(r.id, { pickedUp: r.pickedUp, action: r.action, comment: r.comment })
        )
      );
      setSaved(true);
      setTimeout(()=>setSaved(false),3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
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
          {techOpen&&techD.pos&&createPortal(<div ref={techL} style={{...DS,top:techD.pos.top,left:techD.pos.left,width:techD.pos.width}}><button onClick={()=>{setTech("");setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{technicianRoster.map((t,i)=><button key={i} onClick={()=>{setTech(t);setTechOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech===t?"bg-blue-600 text-white":""}`}>{t}</button>)}</div>,document.body)}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pickup Date*</label>
          <input type="date" value={pickupDate} onChange={e=>setPickupDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-36"/>
        </div>
        <div className="flex items-end gap-2 pb-0.5">
          <button onClick={handleSave} disabled={saving||loading} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"><Save className="h-3.5 w-3.5"/>{saving?"Saving…":"Save"}</button>
          <button onClick={()=>window.print()} className="btn flex items-center gap-2 px-4"><Printer className="h-3.5 w-3.5"/>Print</button>
        </div>
      </div>
      {saveError && <p className="text-xs text-red-400 mt-2">{saveError}</p>}
    </div>

    {/* Table */}
    {usingExampleData && !loading && (
      <p className="text-xs text-amber-400 mb-2">No real parts scheduled for pickup on this date — showing example data instead.</p>
    )}
    <div className="panel p-0 w-full">
      {loadError ? (
        <p className="text-sm text-red-400 px-4 py-6">Failed to load parts: {loadError}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground px-4 py-6">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground px-4 py-6">No parts need pickup for these filters.</p>
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
                <td className="px-2 py-2 font-mono text-blue-400 whitespace-nowrap">{r.ticketNo}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${repairStatusClass(r.repairStatus)}`}>{r.repairStatus}</span>
                </td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.partNo}</td>
                <td className="px-2 py-2 max-w-[160px] truncate" title={r.description}>{r.description}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap">{r.po}</td>
                <td className="px-2 py-2 font-mono whitespace-nowrap text-[10px] text-muted-foreground" title={r.id}>{r.id.slice(0,8)}</td>
                <td className="px-2 py-2 text-center">{r.quantity}</td>
                <td className="px-2 py-2 text-center">{r.coreValue > 0 ? `$${r.coreValue.toFixed(2)}` : "—"}</td>
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
      )}
    </div>

    {/* Global Save */}
    <div className="flex justify-end mt-4 gap-3 items-center">
      {saved&&<span className="text-green-400 text-sm flex items-center gap-1"><Check className="h-4 w-4"/>Saved successfully</span>}
      <button onClick={handleSave} disabled={saving||loading||rows.length===0} className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-8 disabled:opacity-50"><Save className="h-3.5 w-3.5"/>{saving?"Saving…":"Save All Changes"}</button>
    </div>
  </main></div>);
}
