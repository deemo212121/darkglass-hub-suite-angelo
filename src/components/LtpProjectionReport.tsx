import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, REPAIR_STATUSES, pick, pad, offsetStr, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const ACCOUNTS = ["1033418796","104268","1249079150","1276506820","162468","162468bp","272467","273746","43195200","49384","49392","50011","50234","60881","72940"];
const SERVICE_TYPES = ["Before Service","Carry In","Demo Service","Exchange Repair","In Home","Initial Installation","Inspection","Installation Check","Mail In","Pickup","Remote Assist","Warranty Exchange"];
const WARRANTY_TYPES = ["Concession L","Concession LP","Concession P","Ext Labor Wty","Ext Part Wty","Ext Wty","In warranty","Labor only Wty","Parts only Wty","Samsung Care+","Service Contract","Standard Wty"];
const ALERT_COLORS: Record<number,string> = { 1:"text-green-400",2:"text-yellow-400",3:"text-orange-400",4:"text-red-400" };

const TICKET_PREFIXES = ["SNWV54E","SNWV44E","SA-","BN21394RGB","H","2418483","1007","2600","4185077565","727268"];

function genTicketNo(i: number) {
  const prefix = pick(TICKET_PREFIXES, i);
  if (prefix.startsWith("SA-") || prefix.startsWith("BN") || prefix === "H") return prefix + (30000 + i * 7);
  if (prefix === "2418483" || prefix === "4185077565" || prefix === "727268") return String(Number(prefix) + i);
  return prefix + String(92000 + i * 13).slice(0, 8) + pick(["-2","-3","-10","DF","HS"], i);
}

function generateRows(count = 100) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const post = new Date(); post.setDate(post.getDate() - 10 - (i % 40));
    const imp = new Date(post); imp.setDate(imp.getDate() + (i % 5));
    const sched = new Date(); sched.setDate(sched.getDate() + 2 + (i % 14));
    const lateImport = i % 7 === 0 ? 0 : 2 + (i * 3) % 25;
    const ltp = 7 + (i * 7) % 60;
    const alertLevel = ltp >= 30 ? 4 : ltp >= 20 ? 3 : ltp >= 10 ? 2 : 1;
    return {
      id: i + 1, ticketNo: genTicketNo(i),
      postingDate: post.toISOString().slice(0,10),
      importedDate: imp.toISOString().slice(0,10),
      repairStatus: pick(REPAIR_STATUSES, i),
      scheduleDate: i % 8 === 0 ? "" : sched.toISOString().slice(0,10),
      location: pick(locs, i),
      lateImport, ltp, alertLevel,
      account: pick(ACCOUNTS, i),
      serviceType: pick(SERVICE_TYPES, i),
      warrantyType: pick(WARRANTY_TYPES, i),
      isLateScheduled: i % 3 === 0,
    };
  });
}
const ALL_ROWS = generateRows(100);

function MultiSelect({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  const all = selected.length === options.length;
  const display = all ? "All selected" : selected.length === 0 ? "None" : selected.slice(0,2).join(", ") + (selected.length > 2 ? ` +${selected.length-2}` : "");
  return (
    <div ref={ref} className="relative flex-1">
      <button aria-label={`Select ${label}`} aria-expanded={open} onClick={() => setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className="truncate text-xs">{display}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`} />
      </button>
      {open && (
        <div className="absolute z-[99999] top-full mt-1 left-0 w-64 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
          <label className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer border-b border-white/10 text-sm font-medium">
            <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : [...options])} className="accent-blue-500" title="Select all" />
            [ Select All ]
          </label>
          {options.map(o => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-sm">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => onChange(selected.includes(o)?selected.filter(x=>x!==o):[...selected,o])} className="accent-blue-500" title={o} />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function LtpProjectionReport({ mod, sub }: Props) {
  const [accounts, setAccounts] = useState([...ACCOUNTS]);
  const [serviceTypes, setServiceTypes] = useState([...SERVICE_TYPES]);
  const [warrantyTypes, setWarrantyTypes] = useState([...WARRANTY_TYPES]);
  const [location, setLocation] = useState("");
  const [activeTab, setActiveTab] = useState<"imported"|"scheduled">("imported");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);

  const rows = useMemo(() => ALL_ROWS.filter(r =>
    accounts.includes(r.account) &&
    serviceTypes.includes(r.serviceType) &&
    warrantyTypes.includes(r.warrantyType) &&
    (location ? r.location === location : true) &&
    (activeTab === "imported" ? !r.isLateScheduled : r.isLateScheduled)
  ), [applied, activeTab]);

  const filtered = search ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(search.toLowerCase()))) : rows;
  const paged = filtered.slice(0, pageSize);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">LTP Projection Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">LTP Projection Report</h1>
      </div>

      <div className="panel panel-filter mb-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 w-16">Accounts</span>
              <MultiSelect label="Accounts" options={ACCOUNTS} selected={accounts} onChange={setAccounts} />
            </div>
            <div className="flex items-center gap-2 flex-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap cursor-pointer">
                <input type="checkbox" className="accent-blue-500" title="Service Type SS" /> Service Type (SS)
              </label>
              <MultiSelect label="Service Type (SS)" options={SERVICE_TYPES} selected={serviceTypes} onChange={setServiceTypes} />
            </div>
            
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 w-16">Warranty Type</span>
              <MultiSelect label="Warranty Type" options={WARRANTY_TYPES} selected={warrantyTypes} onChange={setWarrantyTypes} />
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
              <select value={location} onChange={e => setLocation(e.target.value)} title="Location filter" aria-label="Location filter" className="glass-input text-sm py-1.5 px-2 rounded-md flex-1">
                {LOCATIONS.map(l => <option key={l} value={l}>{l || "— All Locations —"}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {(["imported","scheduled"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab===tab?"bg-blue-600 text-white":"btn"}`}>
            {tab === "imported" ? "Late Imported Tickets" : "Late Scheduled Tickets"}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> records found</span>
        <div className="flex items-center gap-2">
          <label htmlFor="ltp-proj-search" className="sr-only">Search results</label>
          <input id="ltp-proj-search" type="search" placeholder="search in result…" value={search} onChange={e => setSearch(e.target.value)} title="Search results" className="glass-input text-sm py-1.5 px-3 rounded-md w-44" />
        </div>
      </div>

      <div className="panel overflow-x-auto p-0 mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-700/80">
              {["Ticket No","Posting Date","Imported Date","Repair Status","Schedule Date","Location","Late Import (days)","LTP","Alert Level"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-200 whitespace-nowrap border-r border-white/10 last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0
              ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No records match filters.</td></tr>
              : paged.map((r, idx) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2 text-blue-400 font-mono text-xs">{r.ticketNo}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.postingDate}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.importedDate}</td>
                  <td className="px-3 py-2 text-xs">{r.repairStatus}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.scheduleDate}</td>
                  <td className="px-3 py-2">{r.location}</td>
                  <td className="px-3 py-2 text-right">{r.lateImport}</td>
                  <td className="px-3 py-2 text-right font-medium">{r.ltp}</td>
                  <td className={`px-3 py-2 text-right font-bold ${ALERT_COLORS[r.alertLevel]}`}>{r.alertLevel || ""}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {[10,20,50,100,500].map(n => (
          <button key={n} onClick={() => setPageSize(n)}
            className={`px-3 py-1 rounded text-xs font-medium ${pageSize===n?"bg-blue-600 text-white":"btn"}`}>{n}</button>
        ))}
        <span className="ml-auto text-muted-foreground">Page 1</span>
      </div>
    </main>
  );
}
