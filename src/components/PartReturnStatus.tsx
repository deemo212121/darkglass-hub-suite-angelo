import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  PART_RETURN_ACCOUNTS, PART_RETURN_REASONS, PART_RETURN_STATUSES,
  PART_RETURN_TECHS, PART_RETURN_VENDORS,
} from "@/lib/modules";
import { ChevronLeft, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

type Row = {
  __id: string;
  partNo: string;
  description: string;
  vendor: string;        // Encompass | Marcone
  ra: string;            // below Vendor
  account: string;
  uniqueId: string;      // below Account
  returnLabel: string;   // non-editable
  reason: string;
  status: string;
  returnedBy: string;
};

const KIND_KEY = (kind: "regular" | "core") => `ahs:data:parts:part-return-status:${kind}`;
const F_KEY = (kind: "regular" | "core") => `ahs:filters:parts:part-return-status:${kind}`;

function seed(kind: "regular" | "core"): Row[] {
  const base = kind === "regular" ? 30000 : 60000;
  const parts = ["Drain Pump","Door Gasket","Control Board","Thermistor","Heating Element","Compressor","Inverter Board","Door Switch"];
  return Array.from({ length: 18 }, (_, i) => ({
    __id: `${kind}-${i}`,
    partNo: (kind === "regular" ? "RR-" : "CR-") + String(base + i).padStart(6, "0"),
    description: parts[i % parts.length],
    vendor: PART_RETURN_VENDORS[i % 2],
    ra: "RA-" + String(700 + i).padStart(4, "0"),
    account: PART_RETURN_ACCOUNTS[i % PART_RETURN_ACCOUNTS.length],
    uniqueId: "U-" + String(100 + i).padStart(5, "0"),
    returnLabel: `LBL-${kind.toUpperCase()}-${1000 + i}`,
    reason: PART_RETURN_REASONS[i % PART_RETURN_REASONS.length],
    status: PART_RETURN_STATUSES[i % PART_RETURN_STATUSES.length],
    returnedBy: PART_RETURN_TECHS[i % PART_RETURN_TECHS.length],
  }));
}

export function PartReturnStatusPage() {
  const [tab, setTab] = useState<"regular" | "core">("regular");
  const [regular, setRegular] = useState<Row[]>([]);
  const [core, setCore] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [modalRow, setModalRow] = useState<Row | null>(null);
  const [modalVendorTab, setModalVendorTab] = useState<"Encompass" | "Marcone">("Encompass");

  useEffect(() => {
    const r = localStorage.getItem(KIND_KEY("regular"));
    setRegular(r ? JSON.parse(r) : seed("regular"));
    const c = localStorage.getItem(KIND_KEY("core"));
    setCore(c ? JSON.parse(c) : seed("core"));
  }, []);
  useEffect(() => {
    const f = localStorage.getItem(F_KEY(tab));
    setFilters(f ? JSON.parse(f) : {});
    setSearch("");
  }, [tab]);

  const data = tab === "regular" ? regular : core;
  const setData = (next: Row[]) => {
    if (tab === "regular") setRegular(next); else setCore(next);
    localStorage.setItem(KIND_KEY(tab), JSON.stringify(next));
  };

  const filtered = useMemo(() => {
    return data.filter((r) => {
      for (const k of Object.keys(filters)) {
        const v = filters[k]; if (!v) continue;
        if (!String((r as any)[k] ?? "").toLowerCase().includes(v.toLowerCase())) return false;
      }
      if (search) {
        const hay = Object.values(r).map(String).join(" ").toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, filters, search]);

  const update = (id: string, key: keyof Row, value: string) => {
    setData(data.map((r) => (r.__id === id ? { ...r, [key]: value } : r)));
  };
  const del = (id: string) => setData(data.filter((r) => r.__id !== id));
  const add = () => {
    const blank: Row = {
      __id: `${tab}-new-${Date.now()}`,
      partNo: "", description: "", vendor: "Encompass", ra: "",
      account: PART_RETURN_ACCOUNTS[0], uniqueId: "", returnLabel: `LBL-NEW-${Date.now()}`,
      reason: PART_RETURN_REASONS[0], status: PART_RETURN_STATUSES[0],
      returnedBy: PART_RETURN_TECHS[0],
    };
    setData([blank, ...data]);
  };
  const reset = () => { setFilters({}); setSearch(""); localStorage.removeItem(F_KEY(tab)); };
  const save = () => localStorage.setItem(F_KEY(tab), JSON.stringify(filters));

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/m/$module" params={{ module: "parts" }} className="btn">
          <ChevronLeft className="h-4 w-4" /> Parts
        </Link>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">Part Return Status</h1>
          <p className="text-sm text-muted-foreground">Track regular and core part returns separately.</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
          {(["regular","core"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`btn ${tab === t ? "btn-primary" : ""}`}
            >
              {t === "regular" ? "Regular Part Returns" : "Core Part Returns"}
            </button>
          ))}
      </div>

      <div className="panel">
        <div className="filter-grid">
          <input className="glass-input" placeholder="Search all fields…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input className="glass-input" placeholder="Part #" value={filters.partNo ?? ""} onChange={(e) => setFilters({ ...filters, partNo: e.target.value })} />
          <select className="glass-input" title="Filter by vendor" value={filters.vendor ?? ""} onChange={(e) => setFilters({ ...filters, vendor: e.target.value })}>
            <option value="">All Vendors</option>
            {PART_RETURN_VENDORS.map((v) => <option key={v}>{v}</option>)}
          </select>
          <select className="glass-input" title="Filter by account" value={filters.account ?? ""} onChange={(e) => setFilters({ ...filters, account: e.target.value })}>
            <option value="">All Accounts</option>
            {PART_RETURN_ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select className="glass-input" title="Filter by status" value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All Statuses</option>
            {PART_RETURN_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="glass-input" title="Filter by reason" value={filters.reason ?? ""} onChange={(e) => setFilters({ ...filters, reason: e.target.value })}>
            <option value="">All Reasons</option>
            {PART_RETURN_REASONS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input className="glass-input" placeholder="RA #" value={filters.ra ?? ""} onChange={(e) => setFilters({ ...filters, ra: e.target.value })} />
          <input className="glass-input" placeholder="Unique ID" value={filters.uniqueId ?? ""} onChange={(e) => setFilters({ ...filters, uniqueId: e.target.value })} />
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button className="btn" onClick={reset} title="Clear all filters"><RefreshCw className="h-4 w-4" />Refresh</button>
          <button className="btn" onClick={save} title="Save current filters"><Save className="h-4 w-4" />Save</button>
          <button className="btn btn-primary" onClick={add}><Plus className="h-4 w-4" />Add Return</button>
          <div className="ml-auto text-xs text-muted-foreground">{filtered.length} of {data.length} records</div>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Part #</th>
              <th>Description</th>
              <th>Vendor / RA #</th>
              <th>Account / Unique ID</th>
              <th>Return Label</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Returned by</th>
              <th className="w-[60px]"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.__id}>
                <td>
                  <button className="text-[oklch(0.55_0.22_255)] hover:underline" onClick={() => { setModalRow(r); setModalVendorTab(r.vendor === "Marcone" ? "Marcone" : "Encompass"); }}>
                    {r.partNo || "—"}
                  </button>
                </td>
                <td>{r.description}</td>
                <td>
                  <div>{r.vendor}</div>
                  <div className="text-xs text-muted-foreground">{r.ra}</div>
                </td>
                <td>
                  <div>{r.account}</div>
                  <div className="text-xs text-muted-foreground">{r.uniqueId}</div>
                </td>
                <td><span className="text-slate-900">{r.returnLabel}</span></td>
                <td>
                  <select title="Edit reason" value={r.reason} onChange={(e) => update(r.__id, "reason", e.target.value)}>
                    {PART_RETURN_REASONS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <select title="Edit status" value={r.status} onChange={(e) => update(r.__id, "status", e.target.value)}>
                    {PART_RETURN_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <select title="Edit returned by" value={r.returnedBy} onChange={(e) => update(r.__id, "returnedBy", e.target.value)}>
                    {PART_RETURN_TECHS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className="text-center">
                  <button className="text-destructive hover:opacity-80" onClick={() => del(r.__id)} aria-label="Delete row">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No records</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setModalRow(null)}>
          <div className="panel max-w-2xl w-full mb-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-3">
              <h2 className="text-lg font-semibold">Part {modalRow.partNo}</h2>
              <button className="ml-auto btn" title="Close dialog" onClick={() => setModalRow(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="flex gap-2 mb-3">
              {(["Encompass","Marcone"] as const).map((v) => (
                <button key={v} className={`btn ${modalVendorTab === v ? "btn-primary" : ""}`} onClick={() => setModalVendorTab(v)}>
                  {v}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Vendor">{modalVendorTab}</Field>
              <Field label="RA #">{modalRow.ra}</Field>
              <Field label="Account">{modalRow.account}</Field>
              <Field label="Unique ID">{modalRow.uniqueId}</Field>
              <Field label="Return Label">{modalRow.returnLabel}</Field>
              <Field label="Description">{modalRow.description}</Field>
              <Field label="Reason">{modalRow.reason}</Field>
              <Field label="Status">{modalRow.status}</Field>
              <Field label="Returned by">{modalRow.returnedBy}</Field>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              Vendor tab shows the routing for this RA. Edit fields inline in the table to update status, reason, or technician.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.05)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
