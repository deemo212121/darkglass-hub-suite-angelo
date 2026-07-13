import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronLeft, Truck, AlertTriangle, X } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { sendNotificationToRole } from "@/lib/firebase/notifications";
import { collection, addDoc, getDocs, serverTimestamp, query, orderBy } from "firebase/firestore";
import { db, isFirebaseReady } from "@/lib/firebase/config";
import { TruckStockPanel } from "@/components/TruckStockPage";
import { TruckStockRequestsPanel } from "@/components/TruckStockRequestsPage";
import { getPartsInventoryRows, PART_INVENTORY_STATUSES, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getMyRoles } from "@/lib/supabase/users";
import { canApproveTruckStockPulls } from "@/lib/truckStockNotify";

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 125] as const;

const STATUS_STYLES: Record<string, string> = {
  "Need PO": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "PO Made": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Back Order": "bg-orange-500/15 text-orange-300 border-orange-500/30",
  "Part Ready": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Tech Pickup": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Claimed: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  Used: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  Cancelled: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const DROP_STYLE: React.CSSProperties = { background:"var(--color-card)", color:"var(--color-foreground)", border:"1px solid var(--color-panel-border)", borderRadius:6, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", zIndex:999999, position:"fixed", maxHeight:260, overflowY:"auto" };
const Chev = ({open}:{open:boolean}) => <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;

function usePortal(open: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{top:number;left:number;width:number}|null>(null);
  const reposition = useCallback(()=>{ if(!ref.current) return; const r=ref.current.getBoundingClientRect(); setPos({top:r.bottom+2,left:r.left,width:r.width}); },[]);
  useLayoutEffect(()=>{ if(open) reposition(); },[open,reposition]);
  useEffect(()=>{ if(!open) return; window.addEventListener("scroll",reposition,true); window.addEventListener("resize",reposition); return()=>{ window.removeEventListener("scroll",reposition,true); window.removeEventListener("resize",reposition); }; },[open,reposition]);
  return {ref, pos};
}

export function PartInventory({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { companyId, email, role, uid } = useAuth();
  const routeSearch = (useSearch({ strict: false }) as { tab?: string; requestId?: string }) ?? {};
  const [activeTab, setActiveTab] = useState<"inventory" | "truck-stock" | "truck-stock-requests">("inventory");
  // canApproveTruckStockPulls needs extra_roles too, which useAuth() doesn't
  // carry (it only exposes the primary role) — same pattern as HR's
  // hasHrSubRole check on the Jotform Submissions tab.
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  useEffect(() => {
    if (!uid) return;
    getMyRoles(uid).then(({ extraRoles }) => setExtraRoles(extraRoles)).catch(() => setExtraRoles([]));
  }, [uid]);
  const canApproveTruckStock = canApproveTruckStockPulls(role, extraRoles);

  // Deep link from a bell-icon notification straight into the Truck Stock
  // Requests tab (a new pull request needs review, or one was approved/
  // rejected) — same ?tab= convention as Employee Self-Service.
  useEffect(() => {
    if (routeSearch.tab === "truck-stock-requests" && canApproveTruckStock) {
      setActiveTab("truck-stock-requests");
    }
  }, [routeSearch.tab, canApproveTruckStock]);
  const [location, setLocation] = useState(""); const [locOpen, setLocOpen] = useState(false);
  const [partDist, setPartDist] = useState(""); const [distOpen, setDistOpen] = useState(false);
  const [status, setStatus] = useState(""); const [statusOpen, setStatusOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showShipping, setShowShipping] = useState(false);
  const [shippingLog, setShippingLog] = useState<any[]>([]);
  const [crossWarn, setCrossWarn] = useState<string | null>(null);
  const [shipForm, setShipForm] = useState({ fromBranch: "", toBranch: "", partNo: "", qty: "", notes: "" });

  // Real data: every part ordered on every ticket for this company.
  const [allRows, setAllRows] = useState<PartInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number | "all">(100);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const rows = await getPartsInventoryRows();
        if (!alive) return;
        setAllRows(rows);
      } catch (err) {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Load branch-to-branch shipping log from Firestore
  useEffect(() => {
    if (!showShipping || !isFirebaseReady() || !db) return;
    (async () => {
      const q = query(collection(db!, "branch_shipping_log"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setShippingLog(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    })();
  }, [showShipping]);

  // Feature 6: warn part manager when attempting to use another branch's inventory
  const handleUseCrossInventory = useCallback(async (ownerBranch: string, partDesc: string) => {
    setCrossWarn(`Using part from ${ownerBranch}'s inventory. The owner branch manager has been notified.`);
    try {
      await sendNotificationToRole("Parts Manager", companyId ?? "", {
        kind: "cross_inventory_request",
        title: "Cross-branch inventory request",
        body: `${email ?? "A user"} is attempting to use "${partDesc}" from branch ${ownerBranch}'s inventory. Please locate and ship the part.`,
      });
    } catch (err) {
      console.error("Cross-inventory notification failed:", err);
    }
    setTimeout(() => setCrossWarn(null), 6000);
  }, [companyId, email]);

  const handleShipSubmit = useCallback(async () => {
    if (!isFirebaseReady() || !db) return;
    if (!shipForm.fromBranch || !shipForm.toBranch || !shipForm.partNo) return;
    await addDoc(collection(db!, "branch_shipping_log"), {
      ...shipForm,
      shippedBy: email ?? "unknown",
      companyId: companyId ?? "",
      createdAt: serverTimestamp(),
    });
    setShipForm({ fromBranch: "", toBranch: "", partNo: "", qty: "", notes: "" });
    // Reload log
    const q = query(collection(db!, "branch_shipping_log"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    setShippingLog(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, [shipForm, email, companyId]);

  const locDrop = usePortal(locOpen); const distDrop = usePortal(distOpen); const statusDrop = usePortal(statusOpen);
  const locListRef = useRef<HTMLDivElement>(null); const distListRef = useRef<HTMLDivElement>(null); const statusListRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const fn=(e:MouseEvent)=>{
      const t=e.target as Node;
      if(locOpen&&!locDrop.ref.current?.contains(t)&&!locListRef.current?.contains(t)) setLocOpen(false);
      if(distOpen&&!distDrop.ref.current?.contains(t)&&!distListRef.current?.contains(t)) setDistOpen(false);
      if(statusOpen&&!statusDrop.ref.current?.contains(t)&&!statusListRef.current?.contains(t)) setStatusOpen(false);
    };
    document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn);
  },[locOpen,distOpen,statusOpen]);

  // Distributor options come from whatever distributors actually appear on
  // real part orders — not a hardcoded list — so the filter never drifts
  // from the data.
  const partDistOptions = useMemo(
    () => Array.from(new Set(allRows.map(r => r.partDist).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allRows]
  );

  const filteredRows = useMemo(()=>{
    let r = allRows;
    if(location) r=r.filter(x=>x.location===location);
    if(partDist) r=r.filter(x=>x.partDist===partDist);
    if(status) r=r.filter(x=>x.status===status);
    if(search){
      const s = search.toLowerCase();
      r=r.filter(x=>
        x.partNo.toLowerCase().includes(s)||
        x.partDesc.toLowerCase().includes(s)||
        x.ticketNo.toLowerCase().includes(s)||
        x.poNo.toLowerCase().includes(s)||
        x.invoiceNo.toLowerCase().includes(s)
      );
    }
    return r;
  },[allRows,location,partDist,status,search]);

  useEffect(() => { setCurrentPage(1); }, [location, partDist, status, search]);

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    if (pageSize === "all") return filteredRows;
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: "parts" }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        <div className="flex gap-2 mb-6 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("inventory")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${activeTab === "inventory" ? "border-blue-500 text-blue-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Part Inventory
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("truck-stock")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${activeTab === "truck-stock" ? "border-blue-500 text-blue-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Truck Stock
          </button>
          {canApproveTruckStock && (
            <button
              type="button"
              onClick={() => setActiveTab("truck-stock-requests")}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${activeTab === "truck-stock-requests" ? "border-blue-500 text-blue-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              Truck Stock Requests
            </button>
          )}
        </div>

        {activeTab === "truck-stock" && <TruckStockPanel />}
        {activeTab === "truck-stock-requests" && canApproveTruckStock && <TruckStockRequestsPanel highlightRequestId={routeSearch.requestId} />}

        {activeTab === "inventory" && (
        <>
        <div className="panel mb-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* Location */}
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
              <button type="button" ref={locDrop.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span><Chev open={locOpen}/>
              </button>
              {locOpen&&locDrop.pos&&createPortal(<div ref={locListRef} style={{...DROP_STYLE,top:locDrop.pos.top,left:locDrop.pos.left,width:locDrop.pos.width}}>
                <button type="button" onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All Locations —</button>
                {LOCATIONS.map((l,i)=><button type="button" key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}
              </div>,document.body)}
            </div>

            {/* Part Dist. */}
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Part Dist.</label>
              <button type="button" ref={distDrop.ref} onClick={()=>setDistOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={partDist?"":"text-muted-foreground"}>{partDist||"All Distributors"}</span><Chev open={distOpen}/>
              </button>
              {distOpen&&distDrop.pos&&createPortal(<div ref={distListRef} style={{...DROP_STYLE,top:distDrop.pos.top,left:distDrop.pos.left,width:distDrop.pos.width}}>
                <button type="button" onClick={()=>{setPartDist("");setDistOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${partDist===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All Distributors —</button>
                {partDistOptions.map((v,i)=><button type="button" key={i} onClick={()=>{setPartDist(v);setDistOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${partDist===v?"bg-blue-600 text-white":""}`}>{v}</button>)}
              </div>,document.body)}
            </div>

            {/* Status */}
            <div className="flex flex-col gap-1 min-w-[150px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
              <button type="button" ref={statusDrop.ref} onClick={()=>setStatusOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={status?"":"text-muted-foreground"}>{status||"All Statuses"}</span><Chev open={statusOpen}/>
              </button>
              {statusOpen&&statusDrop.pos&&createPortal(<div ref={statusListRef} style={{...DROP_STYLE,top:statusDrop.pos.top,left:statusDrop.pos.left,width:Math.max(statusDrop.pos.width,160)}}>
                <button type="button" onClick={()=>{setStatus("");setStatusOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${status===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All Statuses —</button>
                {PART_INVENTORY_STATUSES.map((v,i)=><button type="button" key={i} onClick={()=>{setStatus(v);setStatusOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${status===v?"bg-blue-600 text-white":""}`}>{v}</button>)}
              </div>,document.body)}
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
              <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Part #, description, ticket #, PO #, invoice #" className="glass-input text-sm py-1.5 px-3 rounded-md"/>
            </div>

            <div className="flex items-end gap-2 pb-0.5">
              <button type="button" onClick={() => setShowShipping(s => !s)} className="btn flex items-center gap-2 px-4 bg-violet-600/20 border-violet-500/30 hover:bg-violet-600/30 text-violet-300">
                <Truck className="h-3.5 w-3.5"/>Branch Shipping Log
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filteredRows.length}</span> of {allRows.length} records found</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Show:</span>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => { setPageSize(size); setCurrentPage(1); }}
                className={`px-2 py-1 rounded border transition-colors ${pageSize === size ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              >
                {size}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setPageSize("all"); setCurrentPage(1); }}
              className={`px-2 py-1 rounded border transition-colors ${pageSize === "all" ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              All
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mb-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{loadError}</div>
        )}

        <div className="panel p-0 w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["#","Ticket No","Location","Part Dist.","Part No","Description","Qty","Price","Status","PO No","Invoice No","ETA","Aging",""].map(h=>(
                <th key={h} className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading
                ? <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
                : pagedRows.length===0
                ? <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">No records found.</td></tr>
                : pagedRows.map((r,idx)=>(
                  <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/[0.02]":""}`}>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{pageSize==="all" ? idx+1 : (safePage-1)*pageSize+idx+1}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                      {r.ticketNo
                        ? <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} className="font-mono text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</Link>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{r.location || "—"}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{r.partDist || "—"}</td>
                    <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">{r.partNo || "—"}</td>
                    <td className="px-2 py-2 text-xs max-w-[220px] truncate" title={r.partDesc}>{r.partDesc || "—"}</td>
                    <td className="px-2 py-2 text-right text-xs">{r.quantity}</td>
                    <td className="px-2 py-2 text-right text-xs">${r.partPrice.toFixed(2)}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                      {r.status
                        ? <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[r.status] || "bg-white/10 text-slate-300 border-white/15"}`}>{r.status}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">{r.poNo || "—"}</td>
                    <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">{r.invoiceNo || "—"}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{r.eta || "—"}</td>
                    <td className="px-2 py-2 text-right text-xs whitespace-nowrap">{r.agingDays}d</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => handleUseCrossInventory(r.location || "unknown", r.partDesc)}
                        className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300 hover:bg-violet-500/25 transition-colors whitespace-nowrap"
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {pageSize !== "all" && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mt-4">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded border border-white/15 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-xs">Page {safePage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded border border-white/15 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {/* Cross-inventory warning banner */}
        {crossWarn && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/15 px-5 py-3 text-sm text-amber-200 shadow-2xl backdrop-blur-md max-w-lg w-full">
            <AlertTriangle className="h-4 w-4 shrink-0" />{crossWarn}
            <button type="button" title="Dismiss" onClick={() => setCrossWarn(null)} className="ml-auto"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Branch-to-Branch Shipping Log Panel */}
        {showShipping && (
          <div className="panel mt-6">
            <div className="flex items-center gap-3 mb-4">
              <Truck className="h-5 w-5 text-violet-300" />
              <h2 className="text-lg font-semibold">Branch-to-Branch Shipping Log</h2>
            </div>
            {/* Ship form */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 p-4 rounded-lg border border-white/10 bg-white/5">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From Branch</label>
                <input value={shipForm.fromBranch} onChange={e => setShipForm(f => ({...f, fromBranch: e.target.value}))} placeholder="Location" className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To Branch</label>
                <input value={shipForm.toBranch} onChange={e => setShipForm(f => ({...f, toBranch: e.target.value}))} placeholder="Location" className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Part #</label>
                <input value={shipForm.partNo} onChange={e => setShipForm(f => ({...f, partNo: e.target.value}))} placeholder="Part number" className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Qty</label>
                <input value={shipForm.qty} onChange={e => setShipForm(f => ({...f, qty: e.target.value}))} placeholder="1" className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex items-end">
                <button type="button" onClick={handleShipSubmit} className="btn bg-violet-600/30 border-violet-500/40 hover:bg-violet-600/50 text-violet-200 w-full flex items-center justify-center gap-2">
                  <Truck className="h-3.5 w-3.5" /> Log Shipment
                </button>
              </div>
            </div>
            {/* Log table */}
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 bg-white/5">
                  {["From Branch","To Branch","Part #","Qty","Shipped By","Date"].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {shippingLog.length === 0
                    ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No shipments logged yet.</td></tr>
                    : shippingLog.map((s: any) => (
                      <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2 font-mono text-xs">{s.fromBranch}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.toBranch}</td>
                        <td className="px-3 py-2 font-mono text-xs text-blue-400">{s.partNo}</td>
                        <td className="px-3 py-2 text-center">{s.qty}</td>
                        <td className="px-3 py-2 text-xs">{s.shippedBy}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString() : "—"}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
}
