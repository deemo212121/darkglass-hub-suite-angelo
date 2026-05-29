import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { CSR_NAMES, pick, pad, todayStr, offsetStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const SUBJECTS = ["Schedule Update","Parts ETA","Customer Note","Escalation","Approval Needed","Callback Request","Status Check","Redo Request","Tech Availability","General"];

function generateRows(count = 60) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (i % 14));
    return {
      id: i + 1, sentDate: d.toISOString().slice(0, 10),
      sender: pick(CSR_NAMES, i), receiver: pick(CSR_NAMES, i + 3),
      subject: pick(SUBJECTS, i),
      message: pick(["Please check on ticket status","Parts should arrive Thursday","Customer requested earlier time","Need supervisor approval","Tech is available tomorrow"], i),
      status: pick(["Sent","Read","Replied","Archived"], i),
    };
  });
}
const ALL_ROWS = generateRows(60);

function PersonDropdown({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  return (
    <div ref={ref} className="relative flex-1 min-w-40">
      <button aria-label={`Select ${label}`} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
        <span className={value ? "" : "text-muted-foreground text-xs"}>{value || `Select ${label}…`}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl">
          <button onClick={() => { onChange(""); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-white/5">— All —</button>
          {CSR_NAMES.map(n => (
            <button key={n} onClick={() => { onChange(n); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${value === n ? "bg-blue-600 text-white" : ""}`}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_CHIP: Record<string,string> = {
  Sent: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  Read: "bg-green-500/20 text-green-300 border border-green-500/30",
  Replied: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
  Archived: "bg-white/10 text-muted-foreground border border-white/15",
};

export function InternalMessageReport({ mod, sub }: Props) {
  const [startDate, setStartDate] = useState(offsetStr(-7));
  const [endDate, setEndDate] = useState(todayStr());
  const [sender, setSender] = useState("");
  const [receiver, setReceiver] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState({ startDate: offsetStr(-7), endDate: todayStr(), sender: "", receiver: "" });

  const rows = useMemo(() => {
    let r = ALL_ROWS;
    if (applied.sender) r = r.filter(x => x.sender === applied.sender);
    if (applied.receiver) r = r.filter(x => x.receiver === applied.receiver);
    if (applied.startDate) r = r.filter(x => x.sentDate >= applied.startDate);
    if (applied.endDate) r = r.filter(x => x.sentDate <= applied.endDate);
    return r;
  }, [applied]);

  const filtered = search ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(search.toLowerCase()))) : rows;

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Internal Message Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Internal Message Report</h1>
      </div>

      <div className="panel mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="imr-start" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Sent Date</label>
            <input id="imr-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
            <span className="text-muted-foreground text-xs">~</span>
            <label htmlFor="imr-end" className="sr-only">End date</label>
            <input id="imr-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Sender</span>
            <PersonDropdown label="Sender" value={sender} onChange={setSender} />
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Receiver</span>
            <PersonDropdown label="Receiver" value={receiver} onChange={setReceiver} />
          </div>
          <button onClick={() => setApplied({ startDate, endDate, sender, receiver })} className="btn btn-primary flex items-center gap-2 px-5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> records found</span>
        <label htmlFor="imr-search" className="sr-only">Search results</label>
        <input id="imr-search" type="search" placeholder="Search in result…" value={search} onChange={e => setSearch(e.target.value)} title="Search results" className="glass-input text-sm py-1.5 px-3 rounded-md w-48" />
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#","Sent Date","Sender","Receiver","Subject","Message","Status"].map(h => (
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
                  <td className="px-3 py-2.5 text-muted-foreground">{r.sentDate}</td>
                  <td className="px-3 py-2.5">{r.sender}</td>
                  <td className="px-3 py-2.5">{r.receiver}</td>
                  <td className="px-3 py-2.5 font-medium">{r.subject}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{r.message}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[r.status]}`}>{r.status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
