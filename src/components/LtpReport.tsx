import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const ACCOUNTS = [
  "1033418796","104268","1249079150","1276506820","162468","162468","162468bp",
  "272467","273746","43195200","49384","49392","50011","50234","60881","72940",
  "81023","91045","91234","93310",
];

const SERVICE_TYPES = [
  "Before Service","Carry In","Demo Service","Exchange Repair","In Home",
  "Initial Installation","Inspection","Installation Check","Mail In","Pickup",
  "Remote Assist","Warranty Exchange",
];

const WARRANTY_TYPES = [
  "Concession L","Concession LP","Concession P","Ext Labor Wty","Ext Part Wty",
  "Ext Wty","In warranty","Labor only Wty","Parts only Wty","Samsung Care+",
  "Service Contract","Standard Wty",
];

const DATA_LEVELS = ["Location","Technician","Branch"] as const;
type DataLevel = typeof DATA_LEVELS[number];

const TECHS = ["A. Reyes","M. Patel","J. Kim","S. Brown","L. Ortiz","R. Chen"];
const BRANCHES = ["Houston HQ","Dallas","Austin","San Antonio","Memphis","Atlanta"];
const APPLIANCES = ["Washer","Dryer","Refrigerator","Range/Oven","Dishwasher","Microwave"];
const pick = <T,>(a: T[], i: number) => a[i % a.length];
const pad = (n: number) => String(n).padStart(4,"0");

function dateStr(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0,10);
}

function generateRows(count = 80) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (i * 4) % 180);
    const aging = 5 + (i * 7) % 60;
    return {
      id: i + 1,
      ticketNo: "TK-2026-" + pad(1000 + i),
      account: pick(ACCOUNTS, i),
      serviceType: pick(SERVICE_TYPES, i),
      warrantyType: pick(WARRANTY_TYPES, i),
      tech: pick(TECHS, i),
      branch: pick(BRANCHES, i),
      appliance: pick(APPLIANCES, i),
      openDate: dateStr(-(i * 4) % 180),
      month: d.toISOString().slice(0,7),
      monthLabel: d.toLocaleString("default",{month:"short",year:"numeric"}),
      aging,
      status: aging > 14 ? "Overdue" : aging > 7 ? "At Risk" : "On Track",
    };
  });
}
const ALL_ROWS = generateRows(80);

// ── Multi-select dropdown ─────────────────────────────────────────────────────
function MultiSelect({
  label, options, selected, onChange,
}: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const allSelected = selected.length === options.length;
  const toggleAll = () => onChange(allSelected ? [] : [...options]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  const display = selected.length === 0
    ? "None selected"
    : selected.length === options.length
    ? "All selected"
    : selected.slice(0,3).join(", ") + (selected.length > 3 ? `, +${selected.length - 3} more` : "");

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        aria-label={`Select ${label}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(o => !o)}
        className="glass-input w-full text-sm py-1.5 px-2 rounded-md flex items-center justify-between gap-2 text-left truncate"
      >
        <span className="truncate text-xs">{display}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="absolute z-[99999] top-full mt-1 left-0 w-64 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}
        >
          <label className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer border-b border-white/10 text-sm font-medium">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-blue-500" title="Select all" />
            [ Select All ]
          </label>
          {options.map(o => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-sm">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="accent-blue-500" title={o} />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Monthly stats table ───────────────────────────────────────────────────────
function MonthlyStats({ rows }: { rows: typeof ALL_ROWS }) {
  const byMonth: Record<string, { label: string; total: number; overdue: number; atRisk: number; onTrack: number; avgAging: number }> = {};
  rows.forEach(r => {
    if (!byMonth[r.month]) byMonth[r.month] = { label: r.monthLabel, total: 0, overdue: 0, atRisk: 0, onTrack: 0, avgAging: 0 };
    byMonth[r.month].total++;
    if (r.status === "Overdue") byMonth[r.month].overdue++;
    else if (r.status === "At Risk") byMonth[r.month].atRisk++;
    else byMonth[r.month].onTrack++;
    byMonth[r.month].avgAging += r.aging;
  });
  const months = Object.entries(byMonth).sort((a,b) => a[0].localeCompare(b[0]));
  months.forEach(([k]) => { byMonth[k].avgAging = Math.round(byMonth[k].avgAging / byMonth[k].total); });

  if (months.length === 0) return <p className="text-muted-foreground text-sm px-2">No data.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            {["Month","Total","Overdue","At Risk","On Track","Avg Aging (days)"].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map(([k, v], idx) => (
            <tr key={k} className={`border-b border-white/5 hover:bg-white/5 ${idx % 2 !== 0 ? "bg-white/2" : ""}`}>
              <td className="px-3 py-2">{v.label}</td>
              <td className="px-3 py-2 font-medium">{v.total}</td>
              <td className="px-3 py-2 text-red-400 font-medium">{v.overdue}</td>
              <td className="px-3 py-2 text-yellow-400 font-medium">{v.atRisk}</td>
              <td className="px-3 py-2 text-green-400 font-medium">{v.onTrack}</td>
              <td className="px-3 py-2">
                <span className={v.avgAging > 14 ? "text-red-400 font-semibold" : v.avgAging > 7 ? "text-yellow-400" : "text-green-400"}>
                  {v.avgAging}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/10 bg-white/5 font-semibold">
            <td className="px-3 py-2 text-xs text-muted-foreground uppercase">Total</td>
            <td className="px-3 py-2">{rows.length}</td>
            <td className="px-3 py-2 text-red-400">{rows.filter(r => r.status==="Overdue").length}</td>
            <td className="px-3 py-2 text-yellow-400">{rows.filter(r => r.status==="At Risk").length}</td>
            <td className="px-3 py-2 text-green-400">{rows.filter(r => r.status==="On Track").length}</td>
            <td className="px-3 py-2">{rows.length ? Math.round(rows.reduce((s,r)=>s+r.aging,0)/rows.length) : 0}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const STATUS_CHIP: Record<string,string> = {
  "Overdue": "bg-red-500/20 text-red-300 border border-red-500/30",
  "At Risk": "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  "On Track": "bg-green-500/20 text-green-300 border border-green-500/30",
};

export function LtpReport({ mod, sub }: Props) {
  const [accounts, setAccounts] = useState<string[]>([...ACCOUNTS]);
  const [serviceTypes, setServiceTypes] = useState<string[]>([...SERVICE_TYPES]);
  const [warrantyTypes, setWarrantyTypes] = useState<string[]>([...WARRANTY_TYPES]);
  const [dataLevel, setDataLevel] = useState<DataLevel>("Location");
  const [ltpAging, setLtpAging] = useState(14);
  const [showDetail, setShowDetail] = useState(false);

  const handleRefresh = () => {
    setShowDetail(false);
  };

  const rows = useMemo(() => ALL_ROWS.filter(r =>
    accounts.includes(r.account) &&
    serviceTypes.includes(r.serviceType) &&
    warrantyTypes.includes(r.warrantyType) &&
    r.aging >= ltpAging
  ), [applied]);

  const avgAging = rows.length ? Math.round(rows.reduce((s,r)=>s+r.aging,0)/rows.length) : 0;

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground transition-colors">🏠</Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground transition-colors">Report</Link>
        <span>›</span>
        <span className="text-foreground font-medium">LTP Report</span>
      </div>

      {/* Title */}
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Long Term Pending (LTP) Report</h1>
      </div>

      {/* Filter Panel */}
      <div className="panel panel-filter mb-5">
        <div className="grid gap-3">
          {/* Row 1: Accounts + Service Type + Refresh */}
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 w-20">Accounts</span>
              <MultiSelect label="Accounts" options={ACCOUNTS} selected={accounts} onChange={setAccounts} />
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 whitespace-nowrap">Service Type (SS)</span>
              <MultiSelect label="Service Type (SS)" options={SERVICE_TYPES} selected={serviceTypes} onChange={setServiceTypes} />
            </div>
            
          </div>

          {/* Row 2: Warranty Type + Data Level + LTP Aging */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 w-20">Warranty Type</span>
              <MultiSelect label="Warranty Type" options={WARRANTY_TYPES} selected={warrantyTypes} onChange={setWarrantyTypes} />
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data Level</span>
              {DATA_LEVELS.map(dl => (
                <label key={dl} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="ltpDataLevel" value={dl} checked={dataLevel===dl} onChange={() => setDataLevel(dl)} className="accent-blue-500" />
                  {dl}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="ltp-aging" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                LTP aging (max {ltpAging})
              </label>
              <input
                id="ltp-aging"
                type="number"
                min={1}
                max={365}
                value={ltpAging}
                onChange={e => setLtpAging(Math.max(1, +e.target.value))}
                title="LTP aging threshold in days"
                placeholder="14"
                className="glass-input text-sm py-1 px-2 rounded-md w-16 text-center"
              />
              <span className="text-sm text-muted-foreground">day(s)</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Total Pending", value: rows.length, color: "text-blue-400" },
          { label: "Overdue", value: rows.filter(r=>r.status==="Overdue").length, color: "text-red-400" },
          { label: "At Risk", value: rows.filter(r=>r.status==="At Risk").length, color: "text-yellow-400" },
          { label: "Avg Aging (days)", value: avgAging, color: avgAging > 14 ? "text-red-400" : avgAging > 7 ? "text-yellow-400" : "text-green-400" },
        ].map(k => (
          <div key={k.label} className="panel py-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Statistics Monthly */}
      <div className="panel panel-filter mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Statistics (Monthly)</h2>
          <button onClick={() => setShowDetail(d => !d)} className="btn text-xs">
            {showDetail ? "Hide Detail" : "Show Detail"}
          </button>
        </div>
        <MonthlyStats rows={rows} />
      </div>

      {/* Detail Table */}
      {showDetail && (
        <div className="panel overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold">
              Detail Records
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                ({rows.length} records · aging ≥ {ltpAging} days)
              </span>
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["#","Ticket No","Account","Service Type","Warranty Type","Tech","Branch","Appliance","Open Date","Aging (days)","Status"].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    No records match the current filters. Adjust and click Refresh.
                  </td>
                </tr>
              ) : rows.map((row, idx) => (
                <tr key={row.id} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${idx % 2 !== 0 ? "bg-white/2" : ""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{row.ticketNo}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{row.account}</td>
                  <td className="px-3 py-2.5">{row.serviceType}</td>
                  <td className="px-3 py-2.5 text-xs">{row.warrantyType}</td>
                  <td className="px-3 py-2.5">{row.tech}</td>
                  <td className="px-3 py-2.5">{row.branch}</td>
                  <td className="px-3 py-2.5">{row.appliance}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.openDate}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={row.aging > 14 ? "text-red-400 font-semibold" : row.aging > 7 ? "text-yellow-400" : "text-green-400"}>
                      {row.aging}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CHIP[row.status]}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
