import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { ChevronLeft, Loader2, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import { getRFAStatusLabel } from "@/lib/servicePowerApi";
import type { RFARequest } from "@/types/servicePower";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const DS: React.CSSProperties = { background:"rgb(22,28,52)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", zIndex:999999, position:"fixed", maxHeight:280, overflowY:"auto" };
const Chev = ({o}:{o:boolean}) => <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function usePortal(open:boolean){ const ref=useRef<HTMLButtonElement>(null); const [pos,setPos]=useState<any>(null); const r=useCallback(()=>{ if(!ref.current)return; const b=ref.current.getBoundingClientRect(); setPos({top:b.bottom+2,left:b.left,width:b.width}); },[]); useLayoutEffect(()=>{if(open)r();},[open,r]); useEffect(()=>{if(!open)return; window.addEventListener("scroll",r,true); window.addEventListener("resize",r); return()=>{window.removeEventListener("scroll",r,true); window.removeEventListener("resize",r);};},[open,r]); return{ref,pos}; }

// Real RFA status codes only (OPN/APV/REJ/WAI/CLS) — mirrors
// getRFAStatusLabel in servicePowerApi.ts, the single source of truth for
// these labels so the filter list can't drift from what the table shows.
const AUTH_STATUSES = ["Open", "Approved", "Rejected", "Waiting for Information", "Closed"];
const ds = (o: number) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };

/** "YYYY-MM-DD" (date input) -> ServicePower's CCYYMMDDHHMM, at day start/end. */
function toChangedOnParam(dateStr: string, endOfDay: boolean): string {
  const digits = dateStr.replace(/-/g, "");
  return digits + (endOfDay ? "2359" : "0000");
}

/** ServicePower timestamp (YYYYMMDDHHMMSS or YYYYMMDD...) -> "YYYY-MM-DD", "—" if absent/unparseable. */
function formatSpDate(raw?: string): string {
  if (!raw || raw.length < 8) return "—";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * ServicePower's own docs disagree with themselves on the error-wrapper
 * shape: the generic "4.3 Errors" boilerplate (shared across every
 * ServicePower integration guide) shows lowercase `messages: [{ message }]`,
 * but the RFA-retrieve endpoint's own Response Elements table — and the
 * real server response observed live — actually returns capitalized
 * `Messages: [{ messageText }]`. Check both shapes rather than trust either
 * doc section alone.
 */
function extractSpErrorMessages(data: any): string[] {
  const collection = data?.messages ?? data?.Messages;
  if (!Array.isArray(collection)) return [];
  return collection
    .map((m: any) => m?.message ?? m?.messageText ?? m?.Message ?? m?.MessageText)
    .filter((m: unknown): m is string => typeof m === "string" && m.length > 0);
}

interface Row {
  key: string;
  callNumber: string;
  manufacturer: string;
  rfaStatus: string;
  reqLabor: number; reqParts: number; reqMileage: number; reqShip: number; reqTravel: number; reqOther: number; reqTax: number; reqTotal: number;
  requested: string;
  appLabor: number; appParts: number; appMileage: number; appShip: number; appTravel: number; appOther: number; appTax: number; appTotal: number;
  approved: string;
}

function toRow(r: RFARequest, index: number): Row {
  const a = r.amounts;
  const reqLabor = a?.requestedLabor ?? 0;
  const reqParts = a?.requestedParts ?? 0;
  const reqMileage = a?.requestedMileage ?? 0;
  const reqShip = a?.requestedShipping ?? 0;
  const reqTravel = a?.requestedTravel ?? 0;
  const reqOther = a?.requestedOther ?? 0;
  const reqTax = a?.requestedTax ?? 0;
  const reqTotal = a?.requestedTotal ?? (reqLabor + reqParts + reqMileage + reqShip + reqTravel + reqOther + reqTax);
  const appLabor = a?.authorizedLabor ?? 0;
  const appParts = a?.authorizedParts ?? 0;
  const appMileage = a?.authorizedMileage ?? 0;
  const appShip = a?.authorizedShipping ?? 0;
  const appTravel = a?.authorizedTravel ?? 0;
  const appOther = a?.authorizedOther ?? 0;
  const appTax = a?.authorizedTax ?? 0;
  const appTotal = a?.authorizedTotal ?? (appLabor + appParts + appMileage + appShip + appTravel + appOther + appTax);
  return {
    key: `${r.callNumber || "unknown"}-${index}`,
    callNumber: r.callNumber || "—",
    manufacturer: r.manufacturerName || "—",
    rfaStatus: getRFAStatusLabel(r.coreInfo?.rfaStatusCode),
    reqLabor, reqParts, reqMileage, reqShip, reqTravel, reqOther, reqTax, reqTotal,
    requested: formatSpDate(r.auditInfo?.createdOn),
    appLabor, appParts, appMileage, appShip, appTravel, appOther, appTax, appTotal,
    approved: formatSpDate(r.auditInfo?.approvedOn),
  };
}

function PortalDropdown({label,options,value,onChange}:{label:string;options:string[];value:string;onChange:(v:string)=>void}) {
  const [open,setOpen]=useState(false);
  const d=usePortal(open);
  const listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{ const fn=(e:MouseEvent)=>{ const t=e.target as Node; if(open&&!d.ref.current?.contains(t)&&!listRef.current?.contains(t))setOpen(false); }; document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn); },[open]);
  return(
    <>
      <button ref={d.ref} onClick={()=>setOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value||`All ${label}`}</span><Chev o={open}/>
      </button>
      {open&&d.pos&&createPortal(<div ref={listRef} style={{...DS,top:d.pos.top,left:d.pos.left,width:Math.max(d.pos.width,220)}}>
        <button onClick={()=>{onChange("");setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>
        {options.map((o,i)=><button key={i} onClick={()=>{onChange(o);setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===o?"bg-blue-600 text-white":""}`}>{o}</button>)}
      </div>,document.body)}
    </>
  );
}

export function AuthorizationStatus({ mod }: Props) {
  const [authStatus, setAuthStatus] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [callNumber, setCallNumber] = useState("");
  const [startDate, setStartDate] = useState(ds(-7));
  const [endDate, setEndDate] = useState(ds(0));
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreExist, setMoreExist] = useState(false);

  // Pulls every RFA changed within the selected date range — ServicePower's
  // retrieveRFA supports fromChangedOn/toChangedOn without requiring a
  // specific call number, so this is a real bulk company-wide query, not a
  // per-ticket lookup. Runs on mount and whenever "Search" is clicked
  // (not on every keystroke, to avoid hammering the production API).
  const loadRfas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        fromChangedOn: toChangedOnParam(startDate, false),
        toChangedOn: toChangedOnParam(endDate, true),
      };
      if (callNumber.trim()) params.callNumber = callNumber.trim();
      const res = await fetch("/api/servicepower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retrieveRFA", params }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      if (data?.responseCode === "ER" || data?.ResponseCode === "ER") {
        throw new Error(extractSpErrorMessages(data).join(", ") || "ServicePower returned an error");
      }
      const requests: RFARequest[] = Array.isArray(data?.requests) ? data.requests : Array.isArray(data?.Requests) ? data.Requests : [];
      setRows(requests.map(toRow));
      setMoreExist(data?.moreCallsExist === "Y" || data?.MoreCallsExist === "Y");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load authorization requests");
      setRows([]);
      setMoreExist(false);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, callNumber]);

  useEffect(() => { void loadRfas(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const manufacturers = useMemo(
    () => Array.from(new Set(rows.map(r => r.manufacturer).filter(m => m && m !== "—"))).sort(),
    [rows]
  );

  const filtered = useMemo(()=>{
    let r=rows;
    if(authStatus) r=r.filter(x=>x.rfaStatus===authStatus);
    if(manufacturer) r=r.filter(x=>x.manufacturer===manufacturer);
    if(search) r=r.filter(x=>x.callNumber.toLowerCase().includes(search.toLowerCase())||x.manufacturer.toLowerCase().includes(search.toLowerCase()));
    return r.slice(0,pageSize);
  },[rows,authStatus,manufacturer,search,pageSize]);

  const toggleRow=(key:string)=>setSelectedRows(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n;});
  const toggleAll=()=>setSelectedRows(selectedRows.size===filtered.length?new Set():new Set(filtered.map(r=>r.key)));

  const fmt=(v:number)=>v>0?`$${v.toFixed(2)}`:"$0.00";

  const AMOUNT_COLS = [
    {label:"Req. Labor",  reqKey:"reqLabor",   appKey:"appLabor"},
    {label:"Req. Parts",  reqKey:"reqParts",   appKey:"appParts"},
    {label:"Req. Mileage",reqKey:"reqMileage", appKey:"appMileage"},
    {label:"Req. Ship",   reqKey:"reqShip",    appKey:"appShip"},
    {label:"Req. Travel", reqKey:"reqTravel",  appKey:"appTravel"},
    {label:"Req. Other",  reqKey:"reqOther",   appKey:"appOther"},
    {label:"Req. Tax",    reqKey:"reqTax",     appKey:"appTax"},
    {label:"Req. Total",  reqKey:"reqTotal",   appKey:"appTotal"},
  ];

  return (
    <div className="min-h-screen flex flex-col">
    <main className="flex-1 max-w-[1900px] mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Authorization Status</h1>
        <span className="text-xs text-muted-foreground">Live from ServicePower</span>
      </div>

      {/* Filter panel */}
      <div className="panel mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Changed Date</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
              <span className="text-muted-foreground text-xs">~</span>
              <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
            </div>
          </div>

          {/* Auth Status */}
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auth. Status</label>
            <PortalDropdown label="Auth. Status" options={AUTH_STATUSES} value={authStatus} onChange={setAuthStatus}/>
          </div>

          {/* Manufacturer */}
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Manufacturer</label>
            <PortalDropdown label="Manufacturer" options={manufacturers} value={manufacturer} onChange={setManufacturer}/>
          </div>

          {/* Call Number */}
          <div className="flex flex-col gap-1 min-w-[160px] flex-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Call Number</label>
            <input value={callNumber} onChange={e=>setCallNumber(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md"/>
          </div>

          <button
            onClick={() => void loadRfas()}
            disabled={loading}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {loading ? "Loading…" : "Search"}
          </button>
        </div>
      </div>

      {error && (
        <div className="panel mb-4 border-red-500/30 bg-red-500/10 text-red-300 text-sm px-4 py-3">
          Failed to load from ServicePower: {error}
        </div>
      )}
      {moreExist && !error && (
        <div className="panel mb-4 border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm px-4 py-3">
          More requests exist beyond what's shown — narrow the date range to see them all.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> of {rows.length} records</span>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search in result" className="glass-input text-xs py-1 px-2 rounded-md w-36"/>
        </div>
      </div>

      {/* Table */}
      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
      <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
        <table className="w-full min-w-max text-xs">
          <thead>
            {/* Row 1 header */}
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-2 w-8" rowSpan={2}><input type="checkbox" checked={selectedRows.size===filtered.length&&filtered.length>0} onChange={toggleAll} className="accent-blue-500"/></th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Call Number</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Manufacturer</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>RfaStatus</th>
              {/* Amount columns group header */}
              {AMOUNT_COLS.map(c=>(
                <th key={c.label} className="px-2 py-1 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap border-l border-white/10">{c.label}</th>
              ))}
              <th className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Requested</th>
              <th className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" rowSpan={2}>Approved</th>
            </tr>
            {/* Row 2: App. sub-headers */}
            <tr className="border-b border-white/10 bg-white/3">
              {AMOUNT_COLS.map(c=>(
                <th key={c.appKey} className="px-2 py-1 text-center text-xs text-muted-foreground border-l border-white/5">{c.appKey.replace("app","App. ").replace(/([A-Z])/g," $1").trim()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">Loading from ServicePower…</td></tr>
            ) : filtered.length===0
              ?<tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">No records found.</td></tr>
              :filtered.map((r,idx)=>(
                <tr key={r.key} className={`border-b border-white/5 hover:bg-white/5 ${selectedRows.has(r.key)?"bg-blue-500/5":idx%2!==0?"bg-white/[0.02]":""}`}>
                  <td className="px-2 py-2"><input type="checkbox" checked={selectedRows.has(r.key)} onChange={()=>toggleRow(r.key)} className="accent-blue-500"/></td>
                  <td className="px-2 py-2 whitespace-nowrap font-mono">{r.callNumber}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">{r.manufacturer}</td>
                  <td className="px-2 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${r.rfaStatus==="Approved"?"bg-green-500/20 text-green-300 border border-green-500/30":r.rfaStatus==="Rejected"?"bg-red-500/20 text-red-300 border border-red-500/30":r.rfaStatus==="Open"?"bg-blue-500/20 text-blue-300 border border-blue-500/30":"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"}`}>
                      {r.rfaStatus}
                    </span>
                  </td>
                  {/* Two-row amount cells */}
                  {AMOUNT_COLS.map(c=>(
                    <td key={c.reqKey} className="px-2 py-0 border-l border-white/5 text-right">
                      <div className="py-0.5 text-muted-foreground">{fmt((r as any)[c.reqKey])}</div>
                      <div className="py-0.5 font-medium">{fmt((r as any)[c.appKey])}</div>
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center text-muted-foreground whitespace-nowrap">{r.requested}</td>
                  <td className="px-2 py-2 text-center text-muted-foreground whitespace-nowrap">{r.approved}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        {[10,20,50,100,500].map(n=>(
          <button key={n} onClick={()=>setPageSize(n)} className={`px-2 py-0.5 rounded ${pageSize===n?"bg-blue-600 text-white":"hover:text-foreground"}`}>{n}</button>
        ))}
      </div>
    </main>
    </div>
  );
}
