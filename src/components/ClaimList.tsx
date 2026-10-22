import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { ChevronLeft, Check, Loader2, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { createPortal } from "react-dom";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import { loadOpenedTickets, markTicketOpened } from "@/lib/openedTickets";
import { localISODate } from "@/lib/localDate";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { getCompanyTicketsWithStatuses, getLatestVisitTriageNoteByTicketIds, updateTicketStatus } from "@/lib/supabase/tickets";
import { getCompanyTicketClaimDetails, upsertTicketClaimDetails, type TicketClaimDetails } from "@/lib/supabase/claimDetails";
import { getMyProfileId } from "@/lib/supabase/users";
import type { Ticket } from "@/lib/ticketData";
import { isClaimablePart } from "@/lib/servicePowerClaimPayload";
import { isShortPaid } from "@/lib/spClaimLookup";
import { syncServicePowerClaimStatus } from "@/lib/servicePowerClaimStatus";
import { claimToColor, OTHER_CLAIM_TO, type ClaimToColor } from "@/lib/claimToColors";
import { PreClaimModal } from "@/components/PreClaimModal";

/*
 * Claim List — every claim-stage ticket (CL-Claimed and CL-Data-Closed; the
 * other CL- statuses with "Include un-claimed tickets"), with what was
 * requested (the Pre-Claim window's fees, when it has them) next to what
 * ServicePower paid (saved by the hourly paid-claim check or Sync Status —
 * migration 0397). Claims filed on the ServicePower website have no Pre-Claim
 * fees, so their Requested line shows "—".
 */

const DAY_OPTIONS = ["7 days", "30 days", "60 days", "90 days", "120 days", "180 days", "365 days"];
const DATE_TYPES = ["Claimed Date", "Completed Date", "Payment Date"] as const;
type DateType = (typeof DATE_TYPES)[number];
const CLAIMED_STATUSES = new Set(["cl-claimed", "cl-data-closed", "cl-data closed"]);
const CLOSED_STATUSES = new Set(["cl-data-closed", "cl-data closed"]);
/** Statuses the bulk "Change" can set (the claim-stage ones). */
const CHANGE_TO_STATUSES = ["CL-Claimed", "CL-Data-Closed", "CL-Ready to Complete", "CL-Need Cancel"];
const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
const NOT_CHECKED = "Not checked yet";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const DS: React.CSSProperties = { background:"rgb(22,28,52)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", zIndex:999999, position:"fixed", maxHeight:280, overflowY:"auto" };
const Chev = ({o}:{o:boolean}) => <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>;
function usePortal(open:boolean){ const ref=useRef<HTMLButtonElement>(null); const [pos,setPos]=useState<any>(null); const r=useCallback(()=>{ if(!ref.current)return; const b=ref.current.getBoundingClientRect(); setPos({top:b.bottom+2,left:b.left,width:b.width}); },[]); useLayoutEffect(()=>{if(open)r();},[open,r]); useEffect(()=>{if(!open)return; window.addEventListener("scroll",r,true); window.addEventListener("resize",r); return()=>{window.removeEventListener("scroll",r,true); window.removeEventListener("resize",r);};},[open,r]); return{ref,pos}; }
const ds = (o:number) => { const d=new Date(); d.setDate(d.getDate()+o); return localISODate(d); };

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
      {open&&d.pos&&createPortal(<div ref={listRef} style={{...DS,top:d.pos.top,left:d.pos.left,width:Math.max(d.pos.width,200)}}>
        <button onClick={()=>{onChange("");setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>
        {options.map((o,i)=><button key={i} onClick={()=>{onChange(o);setOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===o?"bg-blue-600 text-white":""}`}>{o}</button>)}
      </div>,document.body)}
    </>
  );
}

/** Checkbox version of PortalDropdown — pick any number of values; none ticked = all. */
function PortalMultiDropdown({label,options,selected,onChange}:{label:string;options:string[];selected:Set<string>;onChange:(next:Set<string>)=>void}) {
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState("");
  const d=usePortal(open);
  const listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{ const fn=(e:MouseEvent)=>{ const t=e.target as Node; if(open&&!d.ref.current?.contains(t)&&!listRef.current?.contains(t))setOpen(false); }; document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn); },[open]);
  const shown=options.filter(o=>o.toLowerCase().includes(q.toLowerCase()));
  const toggle=(o:string)=>{ const n=new Set(selected); n.has(o)?n.delete(o):n.add(o); onChange(n); };
  const summary=selected.size===0?`All ${label}s`:selected.size===1?Array.from(selected)[0]:`${selected.size} ${label}s selected`;
  return(
    <>
      <button ref={d.ref} onClick={()=>setOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={selected.size?"":"text-muted-foreground"}>{summary}</span><Chev o={open}/>
      </button>
      {open&&d.pos&&createPortal(<div ref={listRef} style={{...DS,top:d.pos.top,left:d.pos.left,width:Math.max(d.pos.width,220)}}>
        <div className="p-2 border-b border-white/10">
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${label}…`} className="glass-input w-full text-xs py-1 px-2 rounded"/>
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-white/10">
          <button onClick={()=>onChange(new Set(options))} className="text-blue-400 hover:text-blue-300">Select all</button>
          <button onClick={()=>onChange(new Set())} className="text-slate-400 hover:text-white">Clear (show all)</button>
        </div>
        {shown.length===0?<p className="px-3 py-2 text-xs text-slate-500">No matches.</p>:shown.map(o=>(
          <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/5 cursor-pointer">
            <input type="checkbox" checked={selected.has(o)} onChange={()=>toggle(o)} className="accent-blue-500"/>{o}
          </label>
        ))}
      </div>,document.body)}
    </>
  );
}

interface Amounts { labor: number; part: number; ship: number; mile: number; other: number; tax: number; total: number; }
const AMOUNT_KEYS: { key: keyof Amounts; label: string }[] = [
  { key: "labor", label: "Labor" }, { key: "part", label: "Part" }, { key: "ship", label: "Ship" },
  { key: "mile", label: "Mile" }, { key: "other", label: "Other" }, { key: "tax", label: "Tax" }, { key: "total", label: "Total" },
];

interface ClaimRow {
  ticket: Ticket;
  tid: string;
  status: string;
  isClaimed: boolean;
  claimNo: string;
  /** YYYY-MM-DD the ticket last turned CL-Claimed. */
  claimedAt: string;
  claimedBy: string;
  completed: string;
  paymentDate: string;
  /** Pre-Claim fees; null when the claim wasn't prepared in the Pre-Claim window. */
  req: Amounts | null;
  /** What ServicePower paid; null until it's been read back. */
  paid: Amounts | null;
  spCode: string;
  spStatus: string;
  shortPaid: boolean;
  aging: number | null;
  internalNote: string;
  triageNote: string;
  claimNote: string;
  claimTo: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const isoDay = (v: string | null | undefined) => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : localISODate(d);
};
const usDay = (iso: string) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const daysBetween = (fromIso: string, toIso: string) =>
  Math.max(0, Math.round((Date.parse(`${toIso}T00:00:00`) - Date.parse(`${fromIso}T00:00:00`)) / 86400000));
function wtyCode(warranty: string): string {
  const v = String(warranty || "").toLowerCase();
  if (!v) return "—";
  if (v.includes("in")) return "IW";
  if (v.includes("oow") || v.includes("out")) return "OOW";
  if (v.includes("service contract") || v === "sc") return "SC";
  return v.slice(0, 3).toUpperCase();
}
/**
 * Who the claim goes to. ServicePower imports often carry the SP login
 * ("GSL00002") as both account and claim company, with the real company
 * (ASSURANT SOLUTIONS, SQUARE TRADE, GE…) in the brand field — the login is
 * skipped.
 */
const claimToFor = (t: Ticket) =>
  [t.claimCompany, t.account, t.manufacturer].map((v) => String(v ?? "").trim()).find((v) => v && !/^GSL\d/i.test(v)) ?? "";
const hasFees = (d: TicketClaimDetails | undefined) =>
  !!d && d.laborFee + d.otherFee + d.shippingFee + d.extraMileFee > 0; // mileageFee is miles, not money

function spStatusChip(code: string, shortPaid: boolean): string {
  if (shortPaid) return "bg-red-500/20 text-red-300 border border-red-500/30";
  if (code === "P") return "bg-green-500/20 text-green-300 border border-green-500/30";
  if (code === "R") return "bg-red-500/20 text-red-300 border border-red-500/30";
  if (!code) return "bg-white/10 text-muted-foreground border border-white/15";
  return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30";
}

/** When each ticket last turned CL-Claimed, and who did it (ticket history), keyed by ticket id. */
async function loadClaimedBy(ticketIds: string[]): Promise<Record<string, { at: string; by: string }>> {
  const latest: Record<string, { at: string; byId: string | null }> = {};
  const BATCH = 200;
  const PAGE = 1000;
  const batches: string[][] = [];
  for (let i = 0; i < ticketIds.length; i += BATCH) batches.push(ticketIds.slice(i, i + BATCH));
  const fetchBatch = async (batch: string[]) => {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("ticket_audit_log")
        .select("ticket_id, created_at, changed_by")
        .eq("field", "status")
        .eq("after_value", "CL-Claimed")
        .in("ticket_id", batch)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of (data ?? []) as Array<{ ticket_id: string; created_at: string; changed_by: string | null }>) {
        if (!latest[r.ticket_id]) latest[r.ticket_id] = { at: r.created_at, byId: r.changed_by };
      }
      if (!data || data.length < PAGE) break;
    }
  };
  for (let i = 0; i < batches.length; i += 4) await Promise.all(batches.slice(i, i + 4).map(fetchBatch));
  const personIds = Array.from(new Set(Object.values(latest).map((v) => v.byId).filter((v): v is string => !!v)));
  const names = new Map<string, string>();
  for (let i = 0; i < personIds.length; i += BATCH) {
    const { data } = await supabase.from("profiles").select("id, display_name").in("id", personIds.slice(i, i + BATCH));
    for (const p of (data ?? []) as Array<{ id: string; display_name: string | null }>) names.set(p.id, p.display_name || "");
  }
  const out: Record<string, { at: string; by: string }> = {};
  for (const [tid, v] of Object.entries(latest)) out[tid] = { at: isoDay(v.at), by: v.byId ? names.get(v.byId) || "—" : "System" };
  return out;
}

/** Part Fee per ticket (markup price of Used / Claimed parts — same as the Pre-Claim window), keyed by ticket id. */
async function loadPartFees(ticketIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ticketIds.length; i += 200) {
    const { data, error } = await supabase.from("parts").select("ticket_id, part_price, markup, status").in("ticket_id", ticketIds.slice(i, i + 200));
    if (error) throw error;
    for (const p of (data ?? []) as Array<{ ticket_id: string; part_price: number | null; markup: number | null; status: string | null }>) {
      if (!isClaimablePart(p)) continue;
      out[p.ticket_id] = (out[p.ticket_id] ?? 0) + (Number(p.part_price) || 0) * (1 + (Number(p.markup) || 0) / 100);
    }
  }
  return out;
}

export function ClaimList({ mod, sub }: Props) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const auth = useAuth();
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // ── Data ──
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [details, setDetails] = useState<Map<string, TicketClaimDetails>>(new Map());
  const [claimedBy, setClaimedBy] = useState<Record<string, { at: string; by: string }>>({});
  const [triageNotes, setTriageNotes] = useState<Record<string, string>>({});
  const [partFees, setPartFees] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (auth.uid) void getMyProfileId(auth.uid).then(setMyProfileId);
  }, [auth.uid]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Every claim-stage ticket ("CL-" statuses); the database narrows it.
      const all = await getCompanyTicketsWithStatuses(["cl-"]);
      const claimStage = all.filter((t) => String(t.status || "").trim().toLowerCase().startsWith("cl-"));
      setTickets(claimStage);
      const det = await getCompanyTicketClaimDetails();
      setDetails(det);
      const ids = claimStage.map((t) => String((t as { _id?: string })._id ?? "")).filter(Boolean);
      // Filled in while the table already shows.
      void loadClaimedBy(ids).then(setClaimedBy).catch((err) => console.warn("[ClaimList] claimed dates failed:", err));
      void getLatestVisitTriageNoteByTicketIds(ids)
        .then((m) => setTriageNotes(Object.fromEntries(m)))
        .catch((err) => console.warn("[ClaimList] triage notes failed:", err));
      void loadPartFees(ids.filter((id) => hasFees(det.get(id))))
        .then(setPartFees)
        .catch((err) => console.warn("[ClaimList] part fees failed:", err));
    } catch (err) {
      console.error("[ClaimList] load failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ── Filters ──
  const [location, setLocation] = useState(""); const [locOpen, setLocOpen] = useState(false);
  const [accounts, setAccounts] = useState<Set<string>>(new Set());
  /** One funnel filter per column (TicketColumnFilter): column key → selected values; empty = no filter. */
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  // Claim To company chips in the toolbar — click one or more to show only those companies.
  const [claimToPicked, setClaimToPicked] = useState<Set<string>>(new Set());
  const [ticketNo, setTicketNo] = useState("");
  const [claimNo, setClaimNo] = useState("");
  const [claimStatus, setClaimStatus] = useState("");
  const [dateType, setDateType] = useState<DateType>("Claimed Date");
  const [startDate, setStartDate] = useState(ds(-90));
  const [endDate, setEndDate] = useState(ds(0));
  const [dayRange, setDayRange] = useState("90 days");
  const [includeUnclaimed, setIncludeUnclaimed] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openedTicketNos, setOpenedTicketNos] = useState<Set<string>>(() => loadOpenedTickets());
  const markOpened = (t: string) => setOpenedTicketNos((prev) => markTicketOpened(t, prev));

  const handleDayChange = (val: string) => {
    setDayRange(val);
    const days = parseInt(val, 10);
    if (!Number.isFinite(days)) return;
    setStartDate(ds(-days));
    setEndDate(ds(0));
  };

  // ── Rows ──
  const rows = useMemo<ClaimRow[]>(() => {
    const today = ds(0);
    return tickets.map((t) => {
      const tid = String((t as { _id?: string })._id ?? "");
      const d = details.get(tid);
      const status = String(t.status || "").trim();
      const statusLower = status.toLowerCase();
      const claimed = claimedBy[tid];
      const req: Amounts | null = hasFees(d)
        ? (() => {
            const part = Math.round((partFees[tid] ?? 0) * 100) / 100;
            const a = { labor: d!.laborFee, part, ship: d!.shippingFee, mile: d!.extraMileFee, other: d!.otherFee, tax: 0, total: 0 };
            a.total = Math.round((a.labor + a.part + a.ship + a.mile + a.other) * 100) / 100;
            return a;
          })()
        : null;
      // Shown once ServicePower has paid something; an unpaid claim's zeros show as "—".
      const paid: Amounts | null =
        d && d.spPaidTotal != null && (d.spClaimStatusCode === "P" || d.spPaidTotal > 0)
          ? { labor: d.spPaidLabor ?? 0, part: d.spPaidParts ?? 0, ship: d.spPaidShipping ?? 0, mile: d.spPaidMileage ?? 0, other: d.spPaidOther ?? 0, tax: d.spPaidTax ?? 0, total: d.spPaidTotal }
          : null;
      const spCode = d?.spClaimStatusCode ?? "";
      const claimedAt = claimed?.at ?? "";
      const paymentDate = d?.spPaymentDate ?? "";
      return {
        ticket: t,
        tid,
        status,
        isClaimed: CLAIMED_STATUSES.has(statusLower),
        claimNo: d?.spClaimBatchNumber ? `${d.spClaimBatchNumber}${String(d.spClaimSequenceNumber ?? "").padStart(6, "0")}` : "",
        claimedAt,
        claimedBy: claimed?.by ?? "",
        completed: isoDay(d?.completeDate) || isoDay(t.schedule),
        paymentDate,
        req,
        paid,
        spCode,
        spStatus: d?.spClaimStatusDescription || (spCode ? spCode : NOT_CHECKED),
        shortPaid: spCode === "P" && !!paid && !!req && isShortPaid(paid.total, req.total),
        aging: claimedAt ? daysBetween(claimedAt, paymentDate || today) : null,
        internalNote: String(t.internalNote ?? "").trim(),
        triageNote: triageNotes[tid] ?? "",
        claimNote: d?.claimNote ?? "",
        claimTo: claimToFor(t),
      };
    });
  }, [tickets, details, claimedBy, triageNotes, partFees]);

  const accountOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.ticket.account || "").filter(Boolean))).sort(), [rows]);
  const statusOptions = useMemo(() => Array.from(new Set(rows.filter((r) => r.isClaimed).map((r) => r.spStatus))).sort(), [rows]);

  // Every filterable column's value as its funnel sees it.
  const COLS: Record<string, (r: ClaimRow) => string> = {
    ticketNo: (r) => r.ticket.ticketNo, source: (r) => r.ticket.ticketSource || "", brand: (r) => r.ticket.manufacturer || "",
    state: (r) => r.ticket.state || "", location: (r) => r.ticket.location || "", completed: (r) => usDay(r.completed),
    wty: (r) => wtyCode(r.ticket.warranty), claimTo: (r) => r.claimTo, claimed: (r) => usDay(r.claimedAt), by: (r) => r.claimedBy,
    claimNo: (r) => r.claimNo, reqTotal: (r) => (r.req ? money(r.req.total) : "—"), paidTotal: (r) => (r.paid ? money(r.paid.total) : "—"),
    spStatus: (r) => (r.shortPaid ? "Short-paid" : r.spStatus), status: (r) => r.status, paymentReceived: (r) => usDay(r.paymentDate),
    internalNote: (r) => r.internalNote, triageNote: (r) => r.triageNote, claimNote: (r) => r.claimNote,
    cAging: (r) => (r.aging == null ? "" : String(r.aging)),
  };
  const matchesCols = (r: ClaimRow, skip?: string) =>
    Object.entries(COLS).every(([k, fn]) => k === skip || !colFilters[k]?.size || colFilters[k].has(fn(r)));

  const baseFiltered = useMemo(() => {
    const tq = ticketNo.toLowerCase();
    const cq = claimNo.toLowerCase();
    const q = search.toLowerCase();
    const dateOf = (r: ClaimRow) => (dateType === "Claimed Date" ? r.claimedAt : dateType === "Completed Date" ? r.completed : r.paymentDate);
    return rows.filter((r) => {
      if (!r.isClaimed && !includeUnclaimed) return false;
      if (!includeClosed && CLOSED_STATUSES.has(r.status.toLowerCase())) return false;
      if (location && r.ticket.location !== location) return false;
      if (accounts.size && !accounts.has(r.ticket.account || "")) return false;
      if (tq && !r.ticket.ticketNo.toLowerCase().includes(tq)) return false;
      if (cq && !r.claimNo.toLowerCase().includes(cq)) return false;
      if (claimStatus && r.spStatus !== claimStatus) return false;
      // A ticket with no date of that kind isn't dropped by the date range
      // (a claim with no payment yet still shows under "Payment Date").
      const day = dateOf(r);
      if (day && startDate && day < startDate) return false;
      if (day && endDate && day > endDate) return false;
      if (q) {
        const blob = [r.ticket.ticketNo, r.ticket.location, r.claimTo, r.claimNo, r.spStatus, r.internalNote, r.triageNote, r.claimNote].join(" ").toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rows, includeUnclaimed, includeClosed, location, accounts, ticketNo, claimNo, claimStatus, dateType, startDate, endDate, search]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colFiltered = useMemo(() => baseFiltered.filter((r) => matchesCols(r)), [baseFiltered, colFilters]);
  const filtered = useMemo(
    () => (claimToPicked.size === 0 ? colFiltered : colFiltered.filter((r) => !!r.claimTo && claimToPicked.has(claimToColor(r.claimTo).label))),
    [colFiltered, claimToPicked],
  );
  // Claim To colour key: companies in the current list, most claims first ("Other" last).
  const claimToKey = useMemo(() => {
    const counts = new Map<string, { color: ClaimToColor; count: number }>();
    for (const r of colFiltered) {
      if (!r.claimTo) continue;
      const color = claimToColor(r.claimTo);
      const e = counts.get(color.label) ?? { color, count: 0 };
      e.count++;
      counts.set(color.label, e);
    }
    return Array.from(counts.values()).sort((a, b) => (a.color === OTHER_CLAIM_TO ? 1 : b.color === OTHER_CLAIM_TO ? -1 : b.count - a.count));
  }, [colFiltered]);
  /** A column's funnel options: its distinct values after every OTHER filter. */
  const colOptions = (key: string) => {
    const list = Array.from(new Set(baseFiltered.filter((r) => matchesCols(r, key)).map(COLS[key])));
    return list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };
  const anyColFilter = Object.values(colFilters).some((v) => v.size > 0);
  /** Header label + funnel for one column. */
  const colHeader = (k: string, label: string) => (
    <span className="inline-flex items-center">
      {label}
      <TicketColumnFilter options={colOptions(k)} selected={colFilters[k] ?? new Set()} onChange={(next) => setColFilters((prev) => ({ ...prev, [k]: next }))} label={`Filter by ${label}`} />
    </span>
  );

  // ── Paging ── (same as Need Claim List)
  const [pageSize, setPageSize] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => filtered.slice((safePage - 1) * pageSize, safePage * pageSize), [filtered, safePage, pageSize]);
  useEffect(() => { setCurrentPage(1); }, [includeUnclaimed, includeClosed, location, accounts, ticketNo, claimNo, claimStatus, dateType, startDate, endDate, search, colFilters, claimToPicked]);

  const toggleRow = (tid: string) => setSelectedRows((prev) => { const n = new Set(prev); n.has(tid) ? n.delete(tid) : n.add(tid); return n; });
  const allChecked = filtered.length > 0 && filtered.every((r) => selectedRows.has(r.tid));
  const toggleAll = () => setSelectedRows(allChecked ? new Set() : new Set(filtered.map((r) => r.tid)));

  // ── Actions ──
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [syncingTid, setSyncingTid] = useState<string | null>(null);
  const [bulkSync, setBulkSync] = useState<{ done: number; total: number } | null>(null);
  const bulkSyncStopRef = useRef(false);

  const applySync = (r: ClaimRow, res: Awaited<ReturnType<typeof syncServicePowerClaimStatus>>) => {
    if (res.details) setDetails((prev) => new Map(prev).set(r.tid, res.details!));
    if (res.closed) setTickets((prev) => prev.map((t) => (t.ticketNo === r.ticket.ticketNo ? { ...t, status: "CL-Data-Closed" } : t)));
  };

  const syncOne = async (r: ClaimRow) => {
    setSyncingTid(r.tid);
    setMessage(null);
    try {
      const res = await syncServicePowerClaimStatus(r.ticket, r.req?.total ?? null, myProfileId);
      applySync(r, res);
      setMessage({ type: res.found && !res.shortPaid ? "success" : "error", text: `${r.ticket.ticketNo}: ${res.message}` });
    } catch (err) {
      setMessage({ type: "error", text: `${r.ticket.ticketNo}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSyncingTid(null);
    }
  };

  /** Sync Status for every claimed ticket on this page, one at a time (each is 2–4 ServicePower lookups). */
  const syncPage = async () => {
    const targets = pagedRows.filter((r) => r.isClaimed);
    if (targets.length === 0) return;
    if (!window.confirm(`Check ${targets.length} claim${targets.length === 1 ? "" : "s"} on ServicePower? Paid CL-Claimed tickets move to CL-Data-Closed (short-paid ones stay). This takes a few seconds per ticket.`)) return;
    bulkSyncStopRef.current = false;
    setMessage(null);
    let closed = 0, notFound = 0, failed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (bulkSyncStopRef.current) break;
      setBulkSync({ done: i, total: targets.length });
      try {
        const res = await syncServicePowerClaimStatus(targets[i].ticket, targets[i].req?.total ?? null, myProfileId);
        applySync(targets[i], res);
        if (res.closed) closed++;
        if (!res.found) notFound++;
      } catch {
        failed++;
      }
    }
    setBulkSync(null);
    setMessage({ type: failed ? "error" : "success", text: `Checked ${targets.length} on ServicePower: ${closed} moved to CL-Data-Closed${notFound ? `, ${notFound} not on ServicePower` : ""}${failed ? `, ${failed} failed` : ""}.` });
  };

  const [changeToStatus, setChangeToStatus] = useState("");
  const [changing, setChanging] = useState(false);
  const changeSelected = async () => {
    const picked = rows.filter((r) => selectedRows.has(r.tid));
    if (!changeToStatus || picked.length === 0) {
      setMessage({ type: "error", text: picked.length === 0 ? "Tick the tickets to change first." : "Pick the status to change them to." });
      return;
    }
    if (!window.confirm(`Change ${picked.length} ticket${picked.length === 1 ? "" : "s"} to ${changeToStatus}?`)) return;
    setChanging(true);
    let done = 0;
    const failedNos: string[] = [];
    for (const r of picked) {
      try {
        await updateTicketStatus(r.ticket.ticketNo, changeToStatus);
        done++;
      } catch {
        failedNos.push(r.ticket.ticketNo);
      }
    }
    const changed = new Set(picked.map((r) => r.ticket.ticketNo).filter((no) => !failedNos.includes(no)));
    setTickets((prev) => prev.map((t) => (changed.has(t.ticketNo) ? { ...t, status: changeToStatus } : t)));
    setSelectedRows(new Set());
    setChanging(false);
    setMessage({ type: failedNos.length ? "error" : "success", text: `${done} changed to ${changeToStatus}${failedNos.length ? `; couldn't change ${failedNos.join(", ")}` : ""}.` });
  };

  const saveClaimNote = async (r: ClaimRow, value: string) => {
    if (value === r.claimNote) return;
    try {
      const saved = await upsertTicketClaimDetails(r.ticket.ticketNo, { claimNote: value }, myProfileId);
      setDetails((prev) => new Map(prev).set(r.tid, saved));
    } catch (err) {
      setMessage({ type: "error", text: `${r.ticket.ticketNo}: claim note not saved — ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  // Same popup-block-aware bulk open as Need Claim List's "Open All Filtered".
  const onOpenAllFiltered = () => {
    if (filtered.length === 0) return;
    if (filtered.length > 20 && !window.confirm(`This opens ${filtered.length} tickets in new tabs — continue?`)) return;
    let blockedCount = 0;
    filtered.forEach((r, i) => {
      setTimeout(() => {
        const win = window.open(`/ticket/${encodeURIComponent(r.ticket.ticketNo)}`, "_blank", "noopener,noreferrer");
        if (!win) blockedCount++;
        else markOpened(r.ticket.ticketNo);
      }, i * 60);
    });
    setTimeout(() => {
      if (blockedCount > 0) {
        alert(
          `Your browser blocked ${blockedCount} of ${filtered.length} tickets as popups. ` +
            `Look for a popup-blocked icon in the address bar and choose "Always allow popups from this site," then click Open All Filtered again.`
        );
      }
    }, filtered.length * 60 + 300);
  };

  const [preClaimTicketNo, setPreClaimTicketNo] = useState<string | null>(null);

  const locD = usePortal(locOpen); const locL = useRef<HTMLDivElement>(null);
  useEffect(()=>{ const fn=(e:MouseEvent)=>{ const t=e.target as Node; if(locOpen&&!locD.ref.current?.contains(t)&&!locL.current?.contains(t))setLocOpen(false); }; document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn); },[locOpen]);

  const amountCell = (a: Amounts | null, k: keyof Amounts, paidLine: boolean, shortPaid = false) => {
    if (!a) return <span className="text-muted-foreground">—</span>;
    const v = a[k];
    if (!paidLine) return <span className="text-muted-foreground">{v.toFixed(2)}</span>;
    if (k === "total") return <span className={`inline-block px-1 py-0.5 rounded text-xs font-medium ${shortPaid ? "bg-red-500 text-white" : "bg-emerald-500/20 text-emerald-300"}`}>{v.toFixed(2)}</span>;
    return <span className={v > 0 ? "text-emerald-300" : "text-muted-foreground"}>{v.toFixed(2)}</span>;
  };

  const th = "px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap";

  return (
    <div className="min-h-screen flex flex-col">
    <main className="flex-1 max-w-[1900px] mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <button type="button" onClick={goBack} className="btn"><ChevronLeft className="h-4 w-4"/></button>
        <h1 className="text-xl font-bold">Claim List</h1>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn ml-auto flex items-center gap-2 text-sm disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}/>Refresh
        </button>
      </div>

      {/* Filter panel */}
      <div className="panel mb-4">
        <div className="grid gap-3">
          {/* Row 1 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
              <button ref={locD.ref} onClick={()=>setLocOpen(o=>!o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
                <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span><Chev o={locOpen}/>
              </button>
              {locOpen&&locD.pos&&createPortal(<div ref={locL} style={{...DS,top:locD.pos.top,left:locD.pos.left,width:locD.pos.width}}>
                <button onClick={()=>{setLocation("");setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===""?"bg-blue-600 text-white":"text-slate-400"}`}>— All —</button>
                {LOCATIONS.map((l,i)=><button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":""}`}>{l}</button>)}
              </div>,document.body)}
            </div>
            <div className="flex flex-col gap-1 min-w-[140px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</label>
              <input value={ticketNo} onChange={e=>setTicketNo(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md"/>
            </div>
            <div className="flex flex-col gap-1 min-w-[140px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim No</label>
              <input value={claimNo} onChange={e=>setClaimNo(e.target.value)} placeholder="ServicePower claim #" className="glass-input text-sm py-1.5 px-2 rounded-md"/>
            </div>
            <div className="flex flex-col gap-1 min-w-[180px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim Status</label>
              <PortalDropdown label="Claim Status" options={statusOptions} value={claimStatus} onChange={setClaimStatus}/>
            </div>
          </div>
          {/* Row 2 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Account</label>
              <PortalMultiDropdown label="Account" options={accountOptions} selected={accounts} onChange={setAccounts}/>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Range</label>
              <div className="flex items-center gap-1.5">
                <select value={dateType} onChange={e=>setDateType(e.target.value as DateType)} className="glass-input text-sm py-1.5 px-2 rounded-md min-w-[150px]">
                  {DATE_TYPES.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
                <button onClick={()=>{setStartDate("");setEndDate("");}} className="btn text-xs px-2 py-1">Clear</button>
                <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
                <span className="text-muted-foreground text-xs">~</span>
                <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32"/>
                <select value={dayRange} onChange={e=>handleDayChange(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {DAY_OPTIONS.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Option</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={includeClosed} onChange={e=>setIncludeClosed(e.target.checked)} className="accent-blue-500"/>Include closed (CL-Data-Closed)</label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={includeUnclaimed} onChange={e=>setIncludeUnclaimed(e.target.checked)} className="accent-blue-500"/>Include un-claimed tickets</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk status change */}
      <div className="flex items-center gap-3 mb-3 justify-end">
        <span className="text-xs text-muted-foreground">Change the selected tickets to the status</span>
        <div className="w-48"><PortalDropdown label="Status" options={CHANGE_TO_STATUSES} value={changeToStatus} onChange={setChangeToStatus}/></div>
        <button onClick={() => void changeSelected()} disabled={changing} className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2">
          {changing && <Loader2 className="h-3.5 w-3.5 animate-spin"/>}Change
        </button>
      </div>

      {message && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${message.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}>
          {message.text}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">
          <span className="text-foreground font-medium">{filtered.length}</span> records found
          {loading ? " · loading…" : null}
          {error ? <span className="text-red-300 ml-3">⚠ {error}</span> : null}
        </span>
        {/* Claim To companies in this list, with their count — click to show only those. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 px-4 text-[11px] text-muted-foreground">
          {claimToKey.map(({ color, count }) => {
            const on = claimToPicked.has(color.label);
            return (
              <button
                key={color.label}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setClaimToPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(color.label)) next.delete(color.label);
                    else next.add(color.label);
                    return next;
                  })
                }
                title={on ? `Showing ${color.label} — click to remove` : `Show only ${color.label} (${count} claim${count === 1 ? "" : "s"})`}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 transition ${
                  on ? `${color.pill} font-semibold ring-1 ring-current` : "border-white/10 bg-white/[0.03] hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-sm ${color.dot}`} />
                {color.label} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
          {claimToPicked.size > 0 && (
            <button type="button" onClick={() => setClaimToPicked(new Set())} className="rounded-md px-1.5 py-0.5 text-slate-400 hover:text-white">
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {bulkSync ? (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin"/>Checking ServicePower {bulkSync.done + 1} of {bulkSync.total}…
              <button onClick={() => { bulkSyncStopRef.current = true; }} className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white">Stop</button>
            </span>
          ) : (
            <button
              onClick={() => void syncPage()}
              disabled={pagedRows.length === 0 || !!syncingTid}
              title="Check every claimed ticket on this page on ServicePower and save what it paid"
              className="px-3 py-1 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
            >
              Sync Status (this page)
            </button>
          )}
          <button
            onClick={onOpenAllFiltered}
            disabled={filtered.length === 0}
            title="Open every ticket currently shown in a new tab"
            className="px-3 py-1 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
          >
            Open All Filtered ({filtered.length})
          </button>
          {anyColFilter && (
            <button onClick={()=>setColFilters({})} className="px-3 py-1 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white">Clear column filters</button>
          )}
          <span className="text-[11px] text-muted-foreground">Show:</span>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => { setPageSize(size); setCurrentPage(1); }}
              className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${pageSize === size ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground"}`}
            >
              {size}
            </button>
          ))}
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search in result" className="glass-input text-xs py-1 px-2 rounded-md w-36"/>
        </div>
      </div>

      {/* Table */}
      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
      <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
        <table className="w-full min-w-max text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-2 w-8" rowSpan={2}><input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-blue-500"/></th>
              <th className={th} rowSpan={2}>{colHeader("ticketNo","Ticket No")}</th>
              <th className={th} rowSpan={2}>{colHeader("source","Source")}</th>
              <th className={th} rowSpan={2}>{colHeader("brand","Brand")}</th>
              <th className={th} rowSpan={2}>{colHeader("state","State")}</th>
              <th className={th} rowSpan={2}>{colHeader("location","Location")}</th>
              <th className={th} rowSpan={2}>{colHeader("completed","Completed")}</th>
              <th className={th} rowSpan={2}>{colHeader("wty","Wty")}</th>
              <th className={th} rowSpan={2}>{colHeader("claimTo","Claim To")}</th>
              <th className={th} rowSpan={2}>{colHeader("claimed","Claimed")}</th>
              <th className={th} rowSpan={2}>{colHeader("by","By")}</th>
              <th className={th} rowSpan={2}>{colHeader("claimNo","Claim #")}</th>
              <th className="px-2 py-1 text-center text-xs font-semibold text-muted-foreground uppercase border-l border-white/10" colSpan={AMOUNT_KEYS.length}>
                <span className="inline-flex items-center gap-2">Requested (Pre-Claim) / Paid (ServicePower) · {colHeader("reqTotal","Req. Total")} · {colHeader("paidTotal","Paid Total")}</span>
              </th>
              <th className={th} rowSpan={2}>{colHeader("spStatus","Claim Status")}</th>
              <th className={th} rowSpan={2}>{colHeader("status","AHS Status")}</th>
              <th className={th} rowSpan={2}>{colHeader("paymentReceived","Payment Received")}</th>
              <th className={th} rowSpan={2}>{colHeader("internalNote","Internal Note")}</th>
              <th className={th} rowSpan={2}>{colHeader("triageNote","Triage Note")}</th>
              <th className={th} rowSpan={2}>{colHeader("claimNote","Claim Note")}</th>
              <th className={th} rowSpan={2} title="Days from claimed to paid (or to today when not paid yet)">{colHeader("cAging","C.Aging")}</th>
              <th className={th} rowSpan={2}>Actions</th>
            </tr>
            <tr className="border-b border-white/10 bg-white/3">
              {AMOUNT_KEYS.map(({ key, label }) => (
                <th key={key} className="px-2 py-1 text-center text-xs text-muted-foreground border-l border-white/5">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0
              ?<tr><td colSpan={21 + AMOUNT_KEYS.length} className="px-4 py-12 text-center text-muted-foreground">{loading ? "Loading claims…" : "No records found."}</td></tr>
              :pagedRows.map((r,idx)=>(
                <tr key={r.tid || r.ticket.ticketNo} className={`border-b border-white/5 hover:bg-white/5 ${selectedRows.has(r.tid)?"bg-blue-500/5":idx%2!==0?"bg-white/[0.02]":""}`}>
                  <td className="px-2 py-1.5"><input type="checkbox" checked={selectedRows.has(r.tid)} onChange={()=>toggleRow(r.tid)} className="accent-blue-500"/></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {openedTicketNos.has(r.ticket.ticketNo) && <Check className="h-3 w-3 text-emerald-400 shrink-0" aria-label="Already opened" />}
                      <Link to="/ticket/$ticketNo" params={{ticketNo:r.ticket.ticketNo}} onClick={()=>markOpened(r.ticket.ticketNo)} className="font-mono text-blue-400 hover:text-blue-300 hover:underline text-xs">{r.ticket.ticketNo}</Link>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap">{r.ticket.ticketSource || "—"}</td>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap">{r.ticket.manufacturer || "—"}</td>
                  <td className="px-2 py-1.5">{r.ticket.state || "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.ticket.location || "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{usDay(r.completed) || "—"}</td>
                  <td className="px-2 py-1.5">{wtyCode(r.ticket.warranty)}</td>
                  <td className="px-2 py-1.5 text-xs max-w-[120px]">
                    {r.claimTo ? <span className={`inline-block max-w-full truncate rounded border px-1.5 align-middle ${claimToColor(r.claimTo).pill}`} title={r.claimTo}>{r.claimTo}</span> : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{usDay(r.claimedAt) || "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap max-w-[110px] truncate" title={r.claimedBy || undefined}>{r.claimedBy || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-blue-400">{r.claimNo || "—"}</td>
                  {AMOUNT_KEYS.map(({ key }, i) => (
                    <td key={key} className={`px-2 py-0 text-right ${i === 0 ? "border-l border-white/5" : ""}`}>
                      <div className="py-0.5">{amountCell(r.req, key, false)}</div>
                      <div className="py-0.5">{amountCell(r.paid, key, true, r.shortPaid)}</div>
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${spStatusChip(r.spCode, r.shortPaid)}`}>{r.shortPaid ? `Short-paid · ${r.spStatus}` : r.spStatus}</span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{r.status}</td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{usDay(r.paymentDate) || "—"}</td>
                  <td className="px-2 py-1.5 max-w-[160px] truncate text-muted-foreground" title={r.internalNote || undefined}>{r.internalNote || "—"}</td>
                  <td className="px-2 py-1.5 max-w-[160px] truncate text-muted-foreground" title={r.triageNote || undefined}>{r.triageNote || "—"}</td>
                  <td className="px-2 py-1.5">
                    <input
                      key={`note:${r.tid}:${r.claimNote}`}
                      defaultValue={r.claimNote}
                      onBlur={(e) => void saveClaimNote(r, e.target.value)}
                      placeholder="Note"
                      title={r.claimNote || undefined}
                      className="glass-input text-xs py-0.5 px-1 rounded w-24"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">{r.aging == null ? "—" : `${r.aging} d`}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => void syncOne(r)}
                        disabled={!!syncingTid || !!bulkSync}
                        title="Read this claim back from ServicePower and save what it paid"
                        className="text-blue-400 hover:text-blue-300 text-xs text-left disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        {syncingTid === r.tid && <Loader2 className="h-3 w-3 animate-spin"/>}›Sync Status
                      </button>
                      <button onClick={() => setPreClaimTicketNo(r.ticket.ticketNo)} className="text-blue-400 hover:text-blue-300 text-xs text-left">›Pre-Claim</button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length} claims
            {selectedRows.size > 0 ? ` (${selectedRows.size} selected)` : ""}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="btn hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
              <span>Page {safePage} of {totalPages}</span>
              <button type="button" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="btn hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Requested is the Pre-Claim window's Claim Amount (blank for claims filed on the ServicePower website). Paid is what ServicePower paid, read back hourly and by Sync Status.
      </p>

      {preClaimTicketNo && (() => {
        const row = rows.find((r) => r.ticket.ticketNo === preClaimTicketNo);
        if (!row) return null;
        return (
          <PreClaimModal
            ticket={row.ticket}
            ticketNumbers={filtered.map((r) => r.ticket.ticketNo)}
            onNavigate={setPreClaimTicketNo}
            onSaved={(no, saved) => {
              const tid = rows.find((r) => r.ticket.ticketNo === no)?.tid;
              if (tid) setDetails((prev) => new Map(prev).set(tid, saved));
            }}
            onStatusChanged={(no, status) => setTickets((prev) => prev.map((t) => (t.ticketNo === no ? { ...t, status } : t)))}
            onTicketUpdated={(no, patch) => setTickets((prev) => prev.map((t) => (t.ticketNo === no ? { ...t, ...patch } : t)))}
            onClose={() => setPreClaimTicketNo(null)}
          />
        );
      })()}
    </main>
    </div>
  );
}
