import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pick, pad, offsetStr, todayStr } from "./shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const APPLIANCES = ["Washer","Dryer","Refrigerator","Range/Oven","Dishwasher","Microwave","Freezer","Ice Maker"];
const CUSTOMERS = ["John Doe","Jane Smith","Acme LLC","Beth Larsen","Carlos Mora","Priya Shah","Tom O'Neil","Lily Park","Marcus Webb","Sara Quinn"];
const STATUSES = ["Open","Closed","Pending","Cancelled"];
const STATUS_CHIP: Record<string,string> = {
  Open:"bg-blue-500/20 text-blue-300 border border-blue-500/30",
  Closed:"bg-green-500/20 text-green-300 border border-green-500/30",
  Pending:"bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  Cancelled:"bg-red-500/20 text-red-300 border border-red-500/30",
};

function generateRows(count = 80) {
  const locs = LOCATIONS.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const sched = new Date(); sched.setDate(sched.getDate() - 3 - (i % 20));
    const comp = i % 5 === 0 ? null : new Date(sched); if (comp) comp.setDate(comp.getDate() + 2 + (i%5));
    return {
      id: i + 1, ticketNo: "TK-2026-" + pad(6000 + i),
      location: pick(locs, i), tech: pick(TECHS_FULL, i),
      scheduleDate: sched.toISOString().slice(0,10),
      completeDate: comp ? comp.toISOString().slice(0,10) : "",
      customer: pick(CUSTOMERS, i), appliance: pick(APPLIANCES, i),
      includeIw: i % 4 === 0,
      amount: 80 + (i * 33) % 800,
      status: pick(STATUSES, i),
    };
  });
}
const ALL_ROWS = generateRows(80);

function LocationSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1">
      <button aria-label="Select location" aria-expanded={open} onClick={() => setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value || "All Locations"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl">
          {LOCATIONS.map((l,i) => (
            <button key={i} onClick={() => { onChange(l); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===l?"bg-blue-600 text-white":l===""?"text-muted-foreground":""}`}>
              {l || "— All Locations —"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TechSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1">
      <button aria-label="Select technician" aria-expanded={open} onClick={() => setOpen(o=>!o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value?"":"text-muted-foreground"}>{value || "All Technicians"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open?"rotate-180":""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl">
          <button onClick={() => { onChange(""); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-white/5">— All —</button>
          {TECHS_FULL.map(t => (
            <button key={t} onClick={() => { onChange(t); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value===t?"bg-blue-600 text-white":""}`}>{t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function OowTicketReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [tech, setTech] = useState("");
  const [includeIw, setIncludeIw] = useState(true);
  const [schedStart, setSchedStart] = useState(offsetStr(-7));
  const [schedEnd, setSchedEnd] = useState(offsetStr(-1));
  const [compStart, setCompStart] = useState("");
  const [compEnd, setCompEnd] = useState("");
  const [applied, setApplied] = useState({ location:"",tech:"",includeIw:true,schedStart:offsetStr(-7),schedEnd:offsetStr(-1),compStart:"",compEnd:"" });

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (applied.location) r = r.filter(x=>x.location===applied.location);
    if (applied.tech) r = r.filter(x=>x.tech===applied.tech);
    if (!applied.includeIw) r = r.filter(x=>!x.includeIw);
    if (applied.schedStart) r = r.filter(x=>x.scheduleDate>=applied.schedStart);
    if (applied.schedEnd) r = r.filter(x=>x.scheduleDate<=applied.schedEnd);
    if (applied.compStart) r = r.filter(x=>x.completeDate && x.completeDate>=applied.compStart);
    if (applied.compEnd) r = r.filter(x=>x.completeDate && x.completeDate<=applied.compEnd);
    return r;
  }, [applied]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">OOW Ticket Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">OOW Ticket Report</h1>
      </div>

      <div className="panel mb-5">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-48">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
              <LocationSelect value={location} onChange={setLocation} />
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-48">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Technician</span>
              <TechSelect value={tech} onChange={setTech} />
            </div>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={includeIw} onChange={e=>setIncludeIw(e.target.checked)} className="accent-blue-500" title="Include IW tickets" />
              Include IW
            </label>
            <button onClick={() => setApplied({location,tech,includeIw,schedStart,schedEnd,compStart,compEnd})} className="btn btn-primary flex items-center gap-2 px-5">
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="oow-sched-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Schedule Date</label>
              <input id="oow-sched-start" type="date" value={schedStart} onChange={e=>setSchedStart(e.target.value)} title="Schedule start" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
              <span className="text-muted-foreground text-xs">~</span>
              <label htmlFor="oow-sched-end" className="sr-only">Schedule end date</label>
              <input id="oow-sched-end" type="date" value={schedEnd} onChange={e=>setSchedEnd(e.target.value)} title="Schedule end" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="oow-comp-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Complete Date</label>
              <input id="oow-comp-start" type="date" value={compStart} onChange={e=>setCompStart(e.target.value)} title="Complete start" placeholder="mm/dd/yyyy" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
              <span className="text-muted-foreground text-xs">~</span>
              <label htmlFor="oow-comp-end" className="sr-only">Complete end date</label>
              <input id="oow-comp-end" type="date" value={compEnd} onChange={e=>setCompEnd(e.target.value)} title="Complete end" placeholder="mm/dd/yyyy" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-2 text-sm text-muted-foreground"><span className="text-foreground font-medium">{rows.length}</span> records found</div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Ticket No","Location","Technician","Customer","Appliance","Schedule Date","Complete Date","Amount","Status"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No records. Adjust filters and click Refresh.</td></tr>
              : rows.map((r,idx) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx+1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.location}</td>
                  <td className="px-3 py-2.5">{r.tech}</td>
                  <td className="px-3 py-2.5">{r.customer}</td>
                  <td className="px-3 py-2.5">{r.appliance}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.scheduleDate}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.completeDate || "—"}</td>
                  <td className="px-3 py-2.5 text-right">${r.amount.toFixed(2)}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.status]}`}>{r.status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
