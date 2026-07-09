import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { CSR_NAMES, pick, pad, todayStr, offsetStr } from "./shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const ACTION_TYPES = ["Call Out","Schedule","Reschedule","Cancel","Confirm","Note Added","Status Change","Part Order","Reassign"];

function generateRows(count = 80) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (i % 14));
    return {
      id: i + 1,
      ticketNo: "TK-2026-" + pad(2000 + i),
      csr: pick(CSR_NAMES, i),
      actionDate: d.toISOString().slice(0, 10),
      actionTime: `${String(8 + (i % 9)).padStart(2,"0")}:${String((i * 7) % 60).padStart(2,"0")}`,
      action: pick(ACTION_TYPES, i),
      note: pick(["Customer called back","Scheduled for next week","Part backordered","Tech unavailable","Confirmed appt","Left voicemail"], i),
      csrOnly: i % 3 !== 0,
    };
  });
}
const ALL_ROWS = generateRows(80);

function Dropdown({ options, value, onChange, placeholder }: {
  options: string[]; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1 min-w-40">
      <button
        aria-label={placeholder ?? "Select option"}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"
      >
        <span className={value ? "" : "text-muted-foreground"}>{value || placeholder || "Select…"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl">
          <button onClick={() => { onChange(""); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-white/5">— All —</button>
          {options.map(o => (
            <button key={o} onClick={() => { onChange(o); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value === o ? "bg-blue-600 text-white" : ""}`}>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CsrDailyWork({ mod, sub }: Props) {
  const [csr, setCsr] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [csrOnly, setCsrOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState({ csr: "", startDate: todayStr(), endDate: todayStr(), csrOnly: true });

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (applied.csr) r = r.filter(x => x.csr === applied.csr);
    if (applied.startDate) r = r.filter(x => x.actionDate >= applied.startDate);
    if (applied.endDate) r = r.filter(x => x.actionDate <= applied.endDate);
    if (applied.csrOnly) r = r.filter(x => x.csrOnly);
    return r;
  }, [applied]);

  const filtered = search ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(search.toLowerCase()))) : rows;

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">CSR Daily Work</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">CSR Daily Work</h1>
      </div>

      <div className="panel mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 w-8">CSR</span>
            <Dropdown options={CSR_NAMES} value={csr} onChange={setCsr} placeholder="Select CSR…" />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="csr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Action Date</label>
            <input id="csr-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="csr-end" className="sr-only">End date</label>
            <input id="csr-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
          </div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={csrOnly} onChange={e => setCsrOnly(e.target.checked)} className="accent-blue-500" title="CSR Actions only" />
            CSR Actions only
          </label>
          <button onClick={() => setApplied({ csr, startDate, endDate, csrOnly })} className="btn btn-primary flex items-center gap-2 px-5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> records found</span>
        <label htmlFor="csr-search" className="sr-only">Search results</label>
        <input id="csr-search" type="search" placeholder="Search in result…" value={search} onChange={e => setSearch(e.target.value)} title="Search results" className="glass-input text-sm py-1.5 px-3 rounded-md w-48" />
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Ticket No","CSR","Action Date","Time","Action","Note"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No records. Adjust filters and click Refresh.</td></tr>
              : filtered.map((r, idx) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx % 2 !== 0 ? "bg-white/2" : ""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.csr}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.actionDate}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.actionTime}</td>
                  <td className="px-3 py-2.5">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">{r.action}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{r.note}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
