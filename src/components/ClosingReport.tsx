import { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Save } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, pick, pad, offsetStr, todayStr } from "@/components/shared";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

/** Shared portal-dropdown positioning — button ref + fixed-position coords, recalculated on scroll/resize. Used for Account/Location/Status here. */
function useDropdownPortal(open: boolean) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const update = useCallback(() => {
    if (!btnRef.current) return;
    const b = btnRef.current.getBoundingClientRect();
    setPos({ top: b.bottom + 4, left: b.left, width: b.width });
  }, []);
  useLayoutEffect(() => { if (open) update(); }, [open, update]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, update]);
  return { btnRef, listRef, pos };
}

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const ACCOUNTS = ["EarlyRepair","Encompass","Encompass-Birmingham","LG","M2-162468","MCN-162468","MCN-162468bp","Midea-104268","NSA GSLEE","NSA MEMPHIS","SB","SB-1276506820","SB-Miele","SP","SP1","SS","SS-6488757"];
const CLAIM_STATUSES = ["Approved","Claim Closed","Credit Issued","Paid","Rejected","Review by Vendor"];
const STATUS_CHIP: Record<string,string> = {
  "Claim Closed":"bg-green-500/20 text-green-300 border border-green-500/30",
  "Credit Issued":"bg-blue-500/20 text-blue-300 border border-blue-500/30",
  Paid:"bg-green-500/20 text-green-300 border border-green-500/30",
  Rejected:"bg-red-500/20 text-red-300 border border-red-500/30",
};
const ALL_ROWS = Array.from({length:50},(_,i)=>{
  const d=new Date(); d.setDate(d.getDate()-(i%30));
  return { id:i+1, ticketNo:"TK-2026-"+pad(1000+i), claimNo:"CLM-"+pad(90000+i),
    location:pick(LOCATIONS.slice(1),i), account:pick(ACCOUNTS,i),
    paidDate:d.toISOString().slice(0,10), amount:200+(i*43)%1200, status:pick(CLAIM_STATUSES,i) };
});

export function ClosingReport({ mod, sub }: Props) {
  const [ticketNo, setTicketNo] = useState("");
  const [account, setAccount] = useState("");
  const [accOpen, setAccOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [startDate, setStartDate] = useState(offsetStr(-7));
  const [endDate, setEndDate] = useState(todayStr());
  const [hqPaidDate, setHqPaidDate] = useState(offsetStr(-7));
  const [changeToStatus, setChangeToStatus] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const accD = useDropdownPortal(accOpen);
  const locD = useDropdownPortal(locOpen);
  const statusD = useDropdownPortal(statusOpen);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (accOpen && !accD.btnRef.current?.contains(t) && !accD.listRef.current?.contains(t)) setAccOpen(false);
      if (locOpen && !locD.btnRef.current?.contains(t) && !locD.listRef.current?.contains(t)) setLocOpen(false);
      if (statusOpen && !statusD.btnRef.current?.contains(t) && !statusD.listRef.current?.contains(t)) setStatusOpen(false);
    };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, [accOpen, locOpen, statusOpen, accD.btnRef, accD.listRef, locD.btnRef, locD.listRef, statusD.btnRef, statusD.listRef]);

  const rows = useMemo(()=>{
    let r = ALL_ROWS;
    if (ticketNo) r = r.filter(x=>x.ticketNo.includes(ticketNo));
    if (account) r = r.filter(x=>x.account===account);
    if (location) r = r.filter(x=>x.location===location);
    if (startDate) r = r.filter(x=>x.paidDate>=startDate);
    if (endDate) r = r.filter(x=>x.paidDate<=endDate);
    return r;
  }, [ticketNo, account, location, startDate, endDate]);

  const toggleAll = () => setSelected(selected.size===rows.length?new Set():new Set(rows.map(r=>r.id)));
  const toggleRow = (id:number) => setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});

  return (
    <div className="min-h-screen flex flex-col">
    <main className="flex-1 max-w-[1900px] mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Closing Report</h1>
      </div>
      <div className="panel mb-3 py-2 px-4">
        <p className="text-xs text-muted-foreground">* Note: This report shows all claim transactions in the status, "Claim Closed" and "Credit Issued", which are the paid statuses. If you have independant branches, you can pay it to them using this report.</p>
      </div>
      <div className="panel panel-filter mb-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Ticket No</span>
              <input type="text" value={ticketNo} onChange={e=>setTicketNo(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md flex-1"/>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Paid Date</span>
              <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
              <span className="text-muted-foreground text-xs">~</span>
              <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
            </div>
            <button className="btn flex items-center gap-2 px-4 ml-auto"><Save className="h-3.5 w-3.5"/>Save</button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Account</span>
              <div className="flex-1">
                <button ref={accD.btnRef} aria-label="Select account" aria-expanded={accOpen} onClick={()=>setAccOpen(o=>!o)}
                  className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                  <span className={account?"":"text-muted-foreground"}>{account||"All Accounts"}</span>
                  <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${accOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {accOpen && accD.pos && createPortal(
                  <div
                    ref={accD.listRef}
                    style={{ position: "fixed", top: accD.pos.top, left: accD.pos.left, width: accD.pos.width, zIndex: 99999, background: "rgb(22,28,52)", border: "1px solid rgba(255,255,255,0.15)" }}
                    className="max-h-64 overflow-y-auto rounded-md shadow-xl"
                  >
                    <button onClick={()=>{setAccount("");setAccOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${account===""?"bg-blue-600 text-white":"text-muted-foreground"}`}>— All Accounts —</button>
                    {ACCOUNTS.map((a,i)=>(
                      <button key={i} onClick={()=>{setAccount(a);setAccOpen(false);}}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${account===a?"bg-blue-600 text-white":""}`}>{a}</button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
              <div className="flex-1">
                <button ref={locD.btnRef} aria-label="Select location" aria-expanded={locOpen} onClick={()=>setLocOpen(o=>!o)}
                  className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                  <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span>
                  <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${locOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {locOpen && locD.pos && createPortal(
                  <div
                    ref={locD.listRef}
                    style={{ position: "fixed", top: locD.pos.top, left: locD.pos.left, width: locD.pos.width, zIndex: 99999, background: "rgb(22,28,52)", border: "1px solid rgba(255,255,255,0.15)" }}
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
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">HQ Paid Date</span>
          <input type="date" value={hqPaidDate} onChange={e=>setHqPaidDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5"/>
        </div>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Change the selected claims to the status</span>
          <div className="flex-1 min-w-40">
            <button ref={statusD.btnRef} aria-label="Select status" aria-expanded={statusOpen} onClick={()=>setStatusOpen(o=>!o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className={changeToStatus?"":"text-muted-foreground"}>{changeToStatus||"Select status…"}</span>
              <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${statusOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {statusOpen && statusD.pos && createPortal(
              <div
                ref={statusD.listRef}
                style={{ position: "fixed", top: statusD.pos.top, left: statusD.pos.left, width: statusD.pos.width, zIndex: 99999, background: "rgb(22,28,52)", border: "1px solid rgba(255,255,255,0.15)" }}
                className="rounded-md shadow-xl"
              >
                <button onClick={()=>{setChangeToStatus("");setStatusOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${changeToStatus===""?"bg-blue-600 text-white":"text-muted-foreground"}`}>— Select status… —</button>
                {CLAIM_STATUSES.map((s,i)=>(
                  <button key={i} onClick={()=>{setChangeToStatus(s);setStatusOpen(false);}}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${changeToStatus===s?"bg-blue-600 text-white":""}`}>{s}</button>
                ))}
              </div>,
              document.body
            )}
          </div>
          <button className="btn btn-primary px-4 text-sm">Change</button>
        </div>
      </div>
      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
      <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
        <table className="w-full min-w-max text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">
            <th className="px-3 py-3 w-8"><input type="checkbox" checked={selected.size===rows.length&&rows.length>0} onChange={toggleAll} className="accent-blue-500" title="Select all"/></th>
            {["Ticket No","Claim No","Location","Account","Paid Date","Amount","Status"].map(h=>(
              <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : rows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${selected.has(r.id)?"bg-blue-500/5":idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggleRow(r.id)} className="accent-blue-500" title="Select row"/></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-400">{r.claimNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.account}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.paidDate}</td>
                  <td className="px-3 py-2.5 text-right">${r.amount.toFixed(2)}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.status]||"bg-white/10 text-muted-foreground border border-white/15"}`}>{r.status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
    </div>
  );
}
