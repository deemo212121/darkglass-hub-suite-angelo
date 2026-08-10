import { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const CARD_TYPES = ["Visa","Mastercard","Amex","Discover"];
const TRANS_TYPES = ["Charge","Refund","Authorization","Void"];
const STATUSES = ["Approved","Declined","Pending","Voided"];
const STATUS_CHIP: Record<string,string> = {
  Approved:"bg-green-500/20 text-green-300 border border-green-500/30",
  Declined:"bg-red-500/20 text-red-300 border border-red-500/30",
  Pending:"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  Voided:"bg-white/10 text-muted-foreground border border-white/15",
};
const ALL_ROWS = Array.from({length:50},(_,i)=>{
  const d=new Date(); d.setDate(d.getDate()-(i%30));
  return { id:i+1, location:pick(LOCATIONS.slice(1),i), transDate:d.toISOString().slice(0,10),
    cardType:pick(CARD_TYPES,i), lastFour:String(1000+(i*137)%9000),
    transType:pick(TRANS_TYPES,i), amount:50+(i*27)%800,
    status:pick(STATUSES,i), ticketNo:i%3===0?"TK-2026-"+pad(1000+i):"" };
});

export function CreditCardReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [startDate, setStartDate] = useState(offsetStr(-5));
  const [endDate, setEndDate] = useState(todayStr());
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Portaled to document.body (position: fixed, computed from the button's
  // own bounding rect) instead of a locally `absolute`-positioned overlay —
  // the old version didn't reserve layout space when open, so it floated on
  // top of whatever came next in normal flow instead of cleanly above it.
  // Same pattern as ClaimList.tsx / ClaimPlanner.tsx / ClaimCalendarWeekly.tsx.
  const locBtnRef = useRef<HTMLButtonElement>(null);
  const locListRef = useRef<HTMLDivElement>(null);
  const [locPos, setLocPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateLocPos = useCallback(() => {
    if (!locBtnRef.current) return;
    const b = locBtnRef.current.getBoundingClientRect();
    setLocPos({ top: b.bottom + 4, left: b.left, width: b.width });
  }, []);

  useLayoutEffect(() => { if (locOpen) updateLocPos(); }, [locOpen, updateLocPos]);

  useEffect(() => {
    if (!locOpen) return;
    window.addEventListener("scroll", updateLocPos, true);
    window.addEventListener("resize", updateLocPos);
    return () => {
      window.removeEventListener("scroll", updateLocPos, true);
      window.removeEventListener("resize", updateLocPos);
    };
  }, [locOpen, updateLocPos]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (locOpen && !locBtnRef.current?.contains(t) && !locListRef.current?.contains(t)) setLocOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [locOpen]);

  const rows = useMemo(()=>{
    let r = ALL_ROWS;
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.transDate>=startDate);
    if (endDate) r = r.filter(x=>x.transDate<=endDate);
    return r;
  }, [location, startDate, endDate]);

  const totalApproved = rows.filter(r=>r.status==="Approved").reduce((s,r)=>s+r.amount,0);

  return (
    <div className="min-h-screen flex flex-col">
    <main className="flex-1 max-w-[1900px] mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Credit Card Report</h1>
      </div>
      <div className="panel panel-filter mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
            <div className="flex-1">
              <button ref={locBtnRef} aria-label="Select location" aria-expanded={locOpen} onClick={()=>setLocOpen(o=>!o)}
                className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span>
                <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${locOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {locOpen && locPos && createPortal(
                <div
                  ref={locListRef}
                  style={{ position: "fixed", top: locPos.top, left: locPos.left, width: locPos.width, zIndex: 99999, background: "rgb(22,28,52)", border: "1px solid rgba(255,255,255,0.15)" }}
                  className="max-h-64 overflow-y-auto rounded-md shadow-xl"
                >
                  {LOCATIONS.map((l,i)=>(
                    <button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":l===""?"text-muted-foreground":""}`}>
                      {l||"— All Locations —"}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="ccr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Transaction Date</label>
            <input id="ccr-start" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            <span className="text-muted-foreground text-xs">~</span>
            <input id="ccr-end" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[{label:"Records",value:rows.length,color:"text-blue-400"},
          {label:"Approved",value:rows.filter(r=>r.status==="Approved").length,color:"text-green-400"},
          {label:"Declined",value:rows.filter(r=>r.status==="Declined").length,color:"text-red-400"},
          {label:"Total Approved",value:"$"+totalApproved.toLocaleString(undefined,{maximumFractionDigits:0}),color:"text-cyan-400"},
        ].map(k=>(
          <div key={k.label} className="panel py-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>
      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
      <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
        <table className="w-full min-w-max text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {["#","Trans Date","Location","Card Type","Last 4","Trans Type","Amount","Status","Ticket No"].map(h=>(
              <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.transDate}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.cardType}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">****{r.lastFour}</td>
                  <td className="px-3 py-2.5 text-xs">{r.transType}</td>
                  <td className="px-3 py-2.5 text-right font-medium">${r.amount.toFixed(2)}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.status]}`}>{r.status}</span></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.ticketNo||"—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
    </div>
  );
}
