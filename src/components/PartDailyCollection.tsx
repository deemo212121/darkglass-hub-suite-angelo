import { PartsDoneBanner } from "@/components/PartsDoneBanner";
import { PartsDoneButton } from "@/components/PartsDoneButton";
import { CollectionStatusSummary } from "@/components/CollectionStatusSummary";
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Printer, Save, CheckCircle, Loader2, Undo2, ScanLine, History, PackageCheck } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { branchDonutHex } from "@/lib/branchDisplay";
import { BranchBarChart } from "@/components/BranchBarChart";
import { DonutSummaryCard, CATEGORICAL_DONUT_HEX, DONUT_OTHER_COLOR, DONUT_TOP_N, topDonutSlices } from "@/components/DonutSummaryCard";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyTechnicians } from "@/lib/supabase/users";
import { addPendingDoneItem, removePendingDoneItem } from "@/lib/partsDoneQueue";
import { getEffectiveNotificationRoles } from "@/lib/supabase/notificationRoleGates";
import { notifyPartsManagers } from "@/lib/partsNotify";
import { getPartsForDailyCollection, updatePartCollectionRow, suggestCollectType, type PartCollectionRow } from "@/lib/supabase/partDailyCollection";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";

const PARTS_DONE_QUEUE_SOURCE = "Part Daily Collection";
const PART_DAILY_COLLECTION_ACTIVITY_TARGET_TYPE = "part_daily_collection";
function partDailyCollectionActivityLabel(item: Pick<PartCollectionRow, "partNo" | "ticketNo" | "id">): string {
  return `${item.partNo || item.id} (Ticket ${item.ticketNo || "—"})`;
}

const DS:React.CSSProperties={background:"var(--color-card)",color:"var(--color-foreground)",border:"1px solid var(--color-panel-border)",borderRadius:6,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:999999,position:"fixed",maxHeight:260,overflowY:"auto"};
const Chev=({o}:{o:boolean})=><svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function useP(open:boolean){const ref=useRef<HTMLButtonElement>(null);const [pos,setPos]=useState<any>(null);const r=useCallback(()=>{if(!ref.current)return;const b=ref.current.getBoundingClientRect();setPos({top:b.bottom+2,left:b.left,width:b.width});},[]);useLayoutEffect(()=>{if(open)r();},[open,r]);useEffect(()=>{if(!open)return;window.addEventListener("scroll",r,true);window.addEventListener("resize",r);return()=>{window.removeEventListener("scroll",r,true);window.removeEventListener("resize",r);};},[open,r]);return{ref,pos};}

// Same amber/green pairing Part Receive/Part Return's own Branch Summary
// donuts use for their own "not X / X" split.
const DONUT_NOT_COLLECTED_COLOR = "#f59e0b";
const DONUT_COLLECTED_COLOR = "#22c55e";
// Location value for parts whose ticket has no location — distinct from ""
// (which means "all locations" in the Location filter).
const NO_LOCATION = "(No location)";
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
// Collect first (pinned while scrolling sideways), then what identifies the part, then the fields you edit.
const COLS=["Collect","Technician","Part","Ticket","Dates","Qty","Collect Type","Used Qty","Restock Qty","Lot #","Comment","Part Status","Core Value"];
// Fields Save writes — a row differing from its last-loaded copy in any of these is an unsaved change.
const EDIT_FIELDS=["collected","collectedDate","usedQty","restockQty","collectType","lotNo","comment"] as const;
// When a Collect Type is picked and no quantities are entered yet, fill the
// part's full quantity into the matching column (still editable).
function qtyForType(r:PartCollectionRow,type:string):Partial<PartCollectionRow>{
  if(r.usedQty||r.restockQty)return {};
  if(type==="Restock")return {restockQty:r.quantity};
  if(type.startsWith("Used"))return {usedQty:r.quantity};
  return {};
}

export function PartDailyCollection({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: "parts" } }));
  const { companyId } = useAuth();
  const [location,setLocation]=useState("");const [locOpen,setLocOpen]=useState(false);
  const [tech,setTech]=useState("");const [techOpen,setTechOpen]=useState(false);
  const [dateType,setDateType]=useState<typeof DATE_TYPES[number]>("Pickup Date");const [dtOpen,setDtOpen]=useState(false);
  const [collectType,setCollectType]=useState("");const [ctOpen,setCtOpen]=useState(false);
  const [startDate,setStartDate]=useState(getDefaultCollectionDate);const [endDate,setEndDate]=useState(getDefaultCollectionDate);
  const [ticketNo,setTicketNo]=useState("");
  // One "Show" switch instead of two checkboxes that could both be off.
  const [show,setShow]=useState<"open"|"done"|"all">("open");
  const notCollected=show!=="done";const collected=show!=="open";
  const [flashId,setFlashId]=useState<string|null>(null);
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
  // Snapshot of what was last loaded/saved, keyed by id — diffed against
  // current `rows` on Save so only real collected flips get logged, same
  // "log the meaningful state change" spirit as Part Receive's activity
  // log (see hrActivityLog.ts).
  const originalRowsRef = useRef<Map<string, PartCollectionRow>>(new Map());
  const isRowDirty = (r: PartCollectionRow) => {
    const o = originalRowsRef.current.get(r.id);
    return !!o && EDIT_FIELDS.some((f) => o[f] !== r[f]);
  };
  const rowsRef = useRef<PartCollectionRow[]>([]);
  rowsRef.current = rows;
  const dirtyCount = rows.filter(isRowDirty).length;
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [activityLogEntries, setActivityLogEntries] = useState<HrActivityLogEntry[]>([]);
  const [activityLogLoading, setActivityLogLoading] = useState(false);
  const [activityLogError, setActivityLogError] = useState<string | null>(null);
  const openActivityLog = () => {
    setActivityLogOpen(true);
    setActivityLogLoading(true);
    setActivityLogError(null);
    getActivityLog({ targetType: PART_DAILY_COLLECTION_ACTIVITY_TARGET_TYPE, limit: 200 })
      .then(setActivityLogEntries)
      .catch((err) => setActivityLogError(err instanceof Error ? err.message : "Failed to load activity log"))
      .finally(() => setActivityLogLoading(false));
  };
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
      .then((data) => {
        // Keep unsaved edits across a filter change / reload instead of silently dropping them.
        const kept = rowsRef.current.filter(isRowDirty);
        const orig = new Map(data.map((r) => [r.id, r] as const));
        const editedById = new Map(kept.map((r) => [r.id, r] as const));
        const merged = data.map((r) => editedById.get(r.id) ?? r);
        for (const k of kept) {
          if (orig.has(k.id)) continue;
          const o = originalRowsRef.current.get(k.id);
          if (o) { orig.set(k.id, o); merged.push(k); }
        }
        originalRowsRef.current = orig;
        setRows(merged);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [location, tech, dateType, startDate, endDate, ticketNo, notCollected, collected, collectType]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // Branch Summary's own data — a second, broader fetch (not derived from
  // `rows` above) because `rows` is already server-filtered to the current
  // Location/Collect Type/Collected selection, and the summary needs the
  // full picture regardless of those two specifically (same reasoning as
  // Part Receive/Part Return's own branchScoped: respects Technician/Date/
  // Ticket No, deliberately ignores Location and the Not-Collected/
  // Collected checkboxes so both counts always show side by side).
  const [summaryRows, setSummaryRows] = useState<PartCollectionRow[]>([]);
  const loadSummaryRows = useCallback(() => {
    getPartsForDailyCollection({
      technician: tech || undefined,
      dateType,
      startDate,
      endDate,
      ticketNo: ticketNo || undefined,
      notCollected: true,
      collected: true,
      collectType: collectType || undefined,
    })
      .then(setSummaryRows)
      .catch((err) => console.error("Branch Summary load failed:", err));
  }, [tech, dateType, startDate, endDate, ticketNo, collectType]);
  useEffect(() => { loadSummaryRows(); }, [loadSummaryRows]);

  // Built from the locations actually on these parts, not the LOCATIONS
  // list — a ticket whose location is spelled differently or blank would
  // otherwise be dropped from the chart and totals.
  const branchSummary = Array.from(new Set(summaryRows.map((r) => r.location || NO_LOCATION))).map((loc) => {
    const items = summaryRows.filter((r) => (r.location || NO_LOCATION) === loc);
    return {
      location: loc,
      notCollected: items.filter((r) => !r.collected).length,
      collected: items.filter((r) => r.collected).length,
    };
  })
    .filter((b) => b.notCollected + b.collected > 0)
    .sort((a, b) => b.notCollected - a.notCollected || a.location.localeCompare(b.location));
  const scopedSummary = location ? summaryRows.filter((r) => r.location === location) : summaryRows;
  const statusCounts = { open: scopedSummary.filter((r) => !r.collected).length, done: scopedSummary.filter((r) => r.collected).length };
  const allBranchTotals = {
    notCollected: summaryRows.filter((r) => !r.collected).length,
    collected: summaryRows.filter((r) => r.collected).length,
  };
  const locationDonutData = topDonutSlices(
    Object.fromEntries(branchSummary.map((b) => [b.location, b.notCollected + b.collected])),
    DONUT_TOP_N
  );
  // Not its own separate fetch (unlike Location above) — Collect Type is a
  // much lower-traffic filter here, so reusing the same broader summaryRows
  // (which already ignores Location too) is a fine simplification rather
  // than a third full-table fetch just for this one chart.
  const collectTypeCounts: Record<string, number> = {};
  for (const r of summaryRows) {
    const key = r.collectType?.trim() || "Unspecified";
    collectTypeCounts[key] = (collectTypeCounts[key] ?? 0) + 1;
  }
  const collectTypeDonutData = topDonutSlices(collectTypeCounts, DONUT_TOP_N);

  const updateRowField = (id: string, patch: Partial<PartCollectionRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const setRowCollectType = (id: string, type: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, collectType: type, ...qtyForType(r, type) } : r)));
  };
  const discardChanges = () => {
    if (!window.confirm(`Discard ${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}?`)) return;
    for (const r of rowsRef.current) {
      const o = originalRowsRef.current.get(r.id);
      if (o && r.collected && !o.collected) removePendingDoneItem(PARTS_DONE_QUEUE_SOURCE, r.id);
    }
    setRows((prev) => prev.map((r) => originalRowsRef.current.get(r.id) ?? r));
  };
  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const fn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirtyCount]);

  const toggleCollected = (id: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      if (r.collected) {
        removePendingDoneItem(PARTS_DONE_QUEUE_SOURCE, id);
        return { ...r, collected: false, collectedDate: "" };
      }
      const collectType = r.collectType || suggestCollectType(r.partStatus);
      const next = {
        ...r,
        collected: true,
        collectedDate: TODAY,
        collectType,
        ...qtyForType(r, collectType),
      };
      addPendingDoneItem(PARTS_DONE_QUEUE_SOURCE, id, `${next.partNo || next.id} (Ticket ${next.ticketNo || "—"})`, next.location);
      return next;
    }));
  };

  // Scan a Unique ID (matches the row's id prefix, same placeholder
  // convention Part Daily Pickup already uses — this schema has no real
  // formatted business tracking code) to mark it Collected in one step.
  const handleScan = () => {
    const q = scanUniqueId.trim().toLowerCase();
    if (!q) return;
    const any = rows.find((r) => r.uniqueId.toLowerCase() === q);
    const match = any && !any.collected ? any : undefined;
    if (match) {
      toggleCollected(match.id);
      setScanUniqueId("");
      // Show which row was just collected.
      setFlashId(match.id);
      requestAnimationFrame(() => document.querySelector(`[data-row-id="${match.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      setTimeout(() => setFlashId((cur) => (cur === match.id ? null : cur)), 2000);
    } else {
      setSaveError(any ? `${any.partNo || "That part"} (Unique ID "${scanUniqueId}") is already collected.` : `No part in this list matches Unique ID "${scanUniqueId}".`);
      setTimeout(() => setSaveError(null), 3000);
    }
    scanRef.current?.focus();
  };

  // When collect type is set to "Restock" and saved, fire a notification
  // to the Parts Manager role that this part is back in stock. Configurable
  // via Accessibility Management > Notification Access by Role (trigger
  // "parts_restock") — defaults to Parts Manager. Per-user opt-outs (same
  // page's opt-out grid) apply too.
  const notifyRestock = useCallback(async (row: PartCollectionRow) => {
    try {
      const roles = await getEffectiveNotificationRoles("parts_restock");
      await notifyPartsManagers(companyId, roles, "parts_restock", {
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
      const changed = rows.filter(isRowDirty);
      await Promise.all(changed.map((r) =>
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
      const restocked = changed.filter((r) => {
        const before = originalRowsRef.current.get(r.id);
        return r.collected && r.collectType === "Restock" && !(before?.collected && before.collectType === "Restock");
      });
      for (const r of restocked) await notifyRestock(r);
      for (const r of changed) {
        const before = originalRowsRef.current.get(r.id);
        if (before && before.collected !== r.collected) {
          logActivity({
            action: r.collected ? "part_daily_collection_marked_collected" : "part_daily_collection_unmarked_collected",
            targetType: PART_DAILY_COLLECTION_ACTIVITY_TARGET_TYPE,
            targetId: r.id,
            targetLabel: partDailyCollectionActivityLabel(r),
          });
        }
      }
      originalRowsRef.current = new Map(rows.map((r) => [r.id, r]));
      loadSummaryRows();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }, [rows, notifyRestock, loadSummaryRows]);

  const locD=useP(locOpen);const techD=useP(techOpen);const dtD=useP(dtOpen);const ctD=useP(ctOpen);
  const locL=useRef<HTMLDivElement>(null);const techL=useRef<HTMLDivElement>(null);const dtL=useRef<HTMLDivElement>(null);const ctL=useRef<HTMLDivElement>(null);
  useEffect(()=>{const fn=(e:MouseEvent)=>{const t=e.target as Node;
    if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false);
    if(techOpen&&!techD.ref.current?.contains(t)&&!techL.current?.contains(t))setTechOpen(false);
    if(dtOpen&&!dtD.ref.current?.contains(t)&&!dtL.current?.contains(t))setDtOpen(false);
    if(ctOpen&&!ctD.ref.current?.contains(t)&&!ctL.current?.contains(t))setCtOpen(false);
  };document.addEventListener("mousedown",fn);return()=>document.removeEventListener("mousedown",fn);},[locOpen,techOpen,dtOpen,ctOpen]);

  return(<div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
    <PartsDoneBanner />
    <div className="flex items-center justify-between gap-3 mb-6">
      <div className="flex items-center gap-3"><button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></button><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      <div className="flex items-center gap-2">
        <PartsDoneButton />
        <button type="button" onClick={openActivityLog} className="btn hover:bg-white/15 inline-flex items-center gap-2 text-xs">
          <History className="h-3.5 w-3.5" /> View Activity
        </button>
      </div>
    </div>

    <div className="panel mb-6">
      <div className="flex items-center gap-2.5 mb-4">
        <PackageCheck className="h-4 w-4 text-blue-400 shrink-0" />
        <div>
          <h3 className="text-[0.95rem] font-semibold uppercase tracking-wide" style={{ color: "#64b5f6" }}>Branch Summary</h3>
          <p className="text-xs text-muted-foreground -mt-0.5">Click a branch to filter the table below</p>
        </div>
      </div>
      <div className="flex flex-col lg:flex-row gap-4 items-stretch">
        <BranchBarChart
          title="Parts for Collection by Branch"
          totalLabel="Total Parts for Collection"
          unitLabel="Number of Parts"
          bars={branchSummary.map((b) => ({
            location: b.location,
            total: b.notCollected + b.collected,
            detail: `${b.notCollected} not collected · ${b.collected} collected`,
          }))}
          selected={location}
          onSelect={(l) => setLocation(l === NO_LOCATION ? "" : l)}
          noLocationKey={NO_LOCATION}
        />

        <div className="flex-1 flex flex-wrap gap-4 lg:self-start">
          <DonutSummaryCard
            title="Status"
            data={[
              { name: "Collected", value: allBranchTotals.collected },
              { name: "Not collected", value: allBranchTotals.notCollected },
            ]}
            colorFor={(name) => (name === "Collected" ? DONUT_COLLECTED_COLOR : DONUT_NOT_COLLECTED_COLOR)}
            centerValue={String(allBranchTotals.notCollected + allBranchTotals.collected)}
            centerLabel="Total Parts"
          />
          {/* Replaces the By Location / By Collect Type donuts: the written per-branch summary with each technician's attendance. */}
          <CollectionStatusSummary items={summaryRows.map((r) => ({ location: r.location, techName: r.techName, done: r.collected }))} />
        </div>
      </div>
    </div>

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
          <button onClick={()=>window.print()} className="btn flex items-center gap-2 px-4"><Printer className="h-3.5 w-3.5"/>Print</button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <div className="flex flex-col gap-1 min-w-[160px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</label><input value={ticketNo} onChange={e=>setTicketNo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"/></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Show</label>
          <div className="inline-flex rounded-md border border-white/10 overflow-hidden text-sm">
            {([["open", "Not collected", statusCounts.open], ["done", "Collected", statusCounts.done], ["all", "All", statusCounts.open + statusCounts.done]] as const).map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setShow(k)} className={`px-3 py-1.5 flex items-center gap-1.5 ${show === k ? "bg-blue-600 text-white" : "hover:bg-white/5 text-slate-300"}`}>
                {label}<span className={`rounded-full px-1.5 text-[11px] ${show === k ? "bg-white/20" : "bg-white/10"}`}>{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 min-w-[180px] flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Collect Type</label>
          <button ref={ctD.ref} onClick={()=>setCtOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={collectType?"":"text-muted-foreground"}>{collectType||"All Types"}</span><Chev o={ctOpen}/></button>
          {ctOpen&&ctD.pos&&createPortal(<div ref={ctL} style={{...DS,top:ctD.pos.top,left:ctD.pos.left,width:ctD.pos.width}}><button onClick={()=>{setCollectType("");setCtOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${collectType===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>{COLLECT_TYPES.map((c,i)=><button key={i} onClick={()=>{setCollectType(c);setCtOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${collectType===c?"bg-blue-600 text-white":""}`}>{c}</button>)}</div>,document.body)}
        </div>
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scan Parts Here (Unique ID)</label>
          <div className="flex gap-2">
            <input ref={scanRef} value={scanUniqueId} onChange={e=>setScanUniqueId(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleScan();}} placeholder="Scan or type, then Enter" className="glass-input text-sm py-1.5 px-3 rounded-md flex-1"/>
            <button onClick={handleScan} className="btn flex items-center gap-2 px-3 bg-blue-600 hover:bg-blue-700 text-white"><ScanLine className="h-3.5 w-3.5"/>Collect</button>
          </div>
        </div>
      </div>
    </div>

    <div className="panel p-0 w-full">
      {loadError ? (
        <p className="text-sm text-red-400 px-4 py-6">Failed to load parts: {loadError}</p>
      ) : loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground px-4 py-6">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          {show === "open" && statusCounts.done > 0 ? (
            <>Nothing left to collect here. {statusCounts.done} collected {statusCounts.done === 1 ? "part is" : "parts are"} hidden. <button type="button" onClick={() => setShow("done")} className="text-blue-400 hover:underline">Show collected</button></>
          ) : show === "done" && statusCounts.open > 0 ? (
            <>No collected parts yet. {statusCounts.open} not collected. <button type="button" onClick={() => setShow("open")} className="text-blue-400 hover:underline">Show not collected</button></>
          ) : (
            "No parts match these filters. Parts show here after they're picked up on Part Daily Pickup."
          )}
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {COLS.map((h, i) => <th key={h} className={`px-2 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${i === 0 ? "sticky left-0 z-10 bg-slate-900" : ""}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const dirty = isRowDirty(r);
              return (
              <tr key={r.id} data-row-id={r.id} className={`border-b border-white/5 transition-colors ${flashId === r.id ? "bg-green-500/20" : r.collected ? "bg-green-500/[0.06]" : "hover:bg-white/5"}`}>
                <td className="px-2 py-2 sticky left-0 z-[1] bg-slate-900">
                  {r.collected ? (
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold bg-green-500/15 text-green-300 border border-green-500/30"><CheckCircle className="h-3.5 w-3.5" />Collected</span>
                      <button type="button" onClick={() => toggleCollected(r.id)} className="rounded p-1 text-slate-400 hover:text-orange-300 hover:bg-orange-500/10" title="Undo — mark as not collected"><Undo2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => toggleCollected(r.id)} className="inline-flex items-center gap-1 rounded px-3 py-1 text-[11px] font-semibold border border-blue-500/50 bg-blue-600 text-white hover:bg-blue-700" title="Mark as collected">
                      Collect
                    </button>
                  )}
                  {dirty && <div className="mt-1 text-[10px] text-amber-300">Not saved</div>}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{r.techName || "—"}</td>
                <td className="px-2 py-2 min-w-[180px]">
                  <div className="font-mono font-semibold whitespace-nowrap">{r.partNo}</div>
                  <div className="text-muted-foreground max-w-[220px] truncate" title={r.description}>{r.description}</div>
                  <div className="font-mono text-[10px] text-slate-500" title={`Unique ID — full id ${r.id}`}>ID {r.uniqueId}</div>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {r.ticketNo ? (
                    <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</Link>
                  ) : "—"}
                  <div className="text-muted-foreground">{r.repairStatus || "—"}</div>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <div><span className="text-muted-foreground">Picked up </span>{r.pickedUpDate || "—"}</div>
                  <div><span className="text-muted-foreground">Collected </span>{r.collectedDate || "—"}</div>
                </td>
                <td className="px-2 py-2 text-center font-semibold">{r.quantity}</td>
                <td className="px-2 py-2">
                  <select value={r.collectType} onChange={e => setRowCollectType(r.id, e.target.value)} className="glass-input text-xs py-1 px-1.5 rounded w-full min-w-[120px]">
                    <option value="">—</option>
                    {COLLECT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="number" min={0} value={r.usedQty} onChange={e => updateRowField(r.id, { usedQty: Math.max(0, Number(e.target.value)) })} className="glass-input text-xs py-1 px-1.5 rounded w-14 text-center" />
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="number" min={0} value={r.restockQty} onChange={e => updateRowField(r.id, { restockQty: Math.max(0, Number(e.target.value)) })} className="glass-input text-xs py-1 px-1.5 rounded w-14 text-center" />
                </td>
                <td className="px-2 py-2">
                  <input value={r.lotNo} onChange={e => updateRowField(r.id, { lotNo: e.target.value })} placeholder="—" className="glass-input text-xs py-1 px-2 rounded w-20" />
                </td>
                <td className="px-2 py-2">
                  <input value={r.comment} onChange={e => updateRowField(r.id, { comment: e.target.value })} placeholder="Add a note" className="glass-input text-xs py-1 px-2 rounded w-40" />
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-500/20 text-slate-300">{r.partStatus || "—"}</span>
                </td>
                <td className="px-2 py-2 text-center whitespace-nowrap">{r.coreValue > 0 ? `$${r.coreValue.toFixed(2)}` : "—"}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>

    {saveError && <p className="text-xs text-red-400 mt-2 text-center">{saveError}</p>}
    {/* Sticky save bar — always in reach, and says how many edits are waiting. */}
    <div className={`sticky bottom-0 z-20 mt-4 flex flex-wrap items-center justify-end gap-3 rounded-lg border px-4 py-3 backdrop-blur-md ${dirtyCount > 0 ? "border-amber-500/40 bg-amber-500/10" : "border-white/10 bg-slate-900/80"}`}>
      {dirtyCount > 0 ? (
        <span className="text-sm text-amber-200 mr-auto">{dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}</span>
      ) : saved ? (
        <span className="text-green-400 text-sm flex items-center gap-1 mr-auto"><CheckCircle className="h-4 w-4" />Saved</span>
      ) : (
        <span className="text-xs text-muted-foreground mr-auto">Click Collect on each part (or scan its Unique ID), then Save.</span>
      )}
      {dirtyCount > 0 && <button type="button" onClick={discardChanges} disabled={saving} className="btn text-sm px-4">Discard</button>}
      <button onClick={handleSave} disabled={saving || dirtyCount === 0} className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-8 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{saving ? "Saving…" : "Save"}</button>
    </div>
    {restockToast&&<div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/15 px-4 py-3 text-sm text-green-300 shadow-2xl backdrop-blur-md"><CheckCircle className="h-4 w-4"/>{restockToast}</div>}
  </main>

  {activityLogOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setActivityLogOpen(false)}>
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Part Daily Collection Activity</h3>
          <button type="button" onClick={() => setActivityLogOpen(false)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>
        {activityLogLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : activityLogError ? (
          <p className="text-sm text-red-400">{activityLogError}</p>
        ) : activityLogEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity logged yet.</p>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-2 px-2">
            <ul className="space-y-2">
              {activityLogEntries.map((entry) => (
                <li key={entry.id} className="rounded border border-white/10 bg-white/5 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{activityActionLabel(entry.action)}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  {entry.targetLabel && <div className="text-xs text-blue-300 mt-0.5">{entry.targetLabel}</div>}
                  <div className="text-xs text-slate-500 mt-0.5">{entry.actorName || "Unknown"}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )}
  </div>);}
