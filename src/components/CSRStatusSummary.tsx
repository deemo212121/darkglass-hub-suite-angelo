import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Columns3, Filter, History, Search, X } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { exportToCSV } from "@/lib/csvExport";
import { REPAIR_STATUS_OPTIONS, TICKET_SOURCES, type Ticket } from "@/lib/ticketData";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { LOCATIONS, mergeLocationOptions } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const STATUS_COLORS: Record<string, string> = {
  "CSR-Assigned to ASC": "#3b82f6",
  "CSR-Left Message for Cx": "#f59e0b",
  "CSR-Needs Scheduling": "#a78bfa",
  "CSR-Acknowledged": "#34d399",
  "CSR-Pending Callback": "#fb923c",
  "CSR-Escalated": "#ef4444",
  "CSR-Resolved": "#22c55e",
  "OP-Waiting for Part": "#60a5fa",
  "OP-Ready for Service": "#06b6d4",
  "OP-Reschedule Follow up": "#818cf8",
  "OP-UPDATE HOLD": "#fbbf24",
  "TR-Need Triage": "#f472b6",
  "TR-Need PO": "#c084fc",
  "CL-Need": "#facc15",
  "CL-Parts Back Ordered": "#94a3b8",
  "CL-Ready to Complete": "#10b981",
  "CL-Claimed": "#a3e635",
  "PT-Need PreAuthorization": "#fca5a5",
  Cancel: "#9ca3af",
  "Data Closed": "#64748b",
  Completed: "#16a34a",
};

const colorFor = (status: string) => STATUS_COLORS[status] || "#94a3b8";

// High-contrast tooltip — always readable in both light & dark mode
const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
} as const;

const TICKET_COLUMNS = [
  { key: "ticketNo", label: "Ticket No" },
  { key: "warranty", label: "Wty" },
  { key: "ticketSource", label: "Ticket Source" },
  { key: "customer", label: "Cx Name" },
  { key: "city", label: "City" },
  { key: "location", label: "Loc" },
  { key: "product", label: "Product" },
  { key: "model", label: "Model" },
  { key: "internalNote", label: "Internal Note" },
  { key: "repair", label: "Repair" },
  { key: "technician", label: "Technician" },
  { key: "customerPref", label: "Cx Prefer" },
  { key: "schedule", label: "Schedule" },
  { key: "status", label: "Status" },
  { key: "phone", label: "Phone" },
  { key: "redo", label: "Redo" },
  { key: "aging", label: "Aging" },
  { key: "statusSpend", label: "Status Spend" },
  { key: "calls", label: "Calls" },
  { key: "partOrder", label: "Part Order" },
  { key: "posting", label: "Posting" },
] as const;
type TicketColumnKey = (typeof TICKET_COLUMNS)[number]["key"];

const FILTERABLE = [
  "ticketSource",
  "warranty",
  "customer",
  "city",
  "location",
  "product",
  "technician",
  "customerPref",
  "schedule",
  "status",
  "redo",
  "partOrder",
] as const;

// ── Ticket-List display helpers (ported for visual parity) ──
function warrantyAcronym(value: string | null | undefined): string {
  const v = (value || "").trim();
  if (!v) return "";
  if (v.length <= 4 && v === v.toUpperCase()) return v;
  return v.toUpperCase();
}

function statusTextColor(status: string): string {
  const key = (status || "").trim().toLowerCase();
  const map: Record<string, string> = {
    "op-waiting for part": "text-yellow-400",
    "op-ready for service": "text-blue-400",
    "csr-left message for cx": "text-green-400",
    "cl-ready to complete": "text-red-400",
    "cl-parts back ordered": "text-slate-100",
  };
  return map[key] ?? "text-blue-300";
}

function productLabel(ticket: { productType?: string; model?: string }): string {
  const explicit = (ticket.productType || "").trim();
  if (explicit) return explicit;
  const model = (ticket.model || "").toLowerCase();
  const guesses: Array<[RegExp, string]> = [
    [/dryer/, "Dryer"],
    [/washer|washing/, "Washer"],
    [/refrig|fridge/, "Refrigerator"],
    [/freezer/, "Freezer"],
    [/dishwash/, "Dishwasher"],
    [/range|stove|oven|cooktop/, "Range/Oven"],
    [/microwave/, "Microwave"],
    [/ice\s*maker/, "Ice Maker"],
    [/disposal/, "Disposal"],
    [/water\s*heater/, "Water Heater"],
  ];
  for (const [re, label] of guesses) if (re.test(model)) return label;
  return "—";
}

function daysSinceCreated(created: string | undefined): number {
  if (!created) return 0;
  const raw = String(created).trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  let createdDate: Date | null = null;
  if (slash) {
    const mm = parseInt(slash[1], 10) - 1;
    const dd = parseInt(slash[2], 10);
    let yy = parseInt(slash[3], 10);
    if (yy < 100) yy += 2000;
    createdDate = new Date(yy, mm, dd);
  } else {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) createdDate = parsed;
  }
  if (!createdDate || isNaN(createdDate.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - createdDate.getTime()) / 86400000));
}

const agingColor = (d: number) =>
  d <= 3 ? "text-green-400" : d <= 7 ? "text-yellow-400" : d <= 14 ? "text-orange-400" : "text-red-400";

function colValue(ticket: Ticket, field: string): string {
  switch (field) {
    case "ticketSource":
      return ticket.ticketSource || ticket.manufacturer || "";
    case "warranty":
      return ticket.warranty || "";
    case "customer":
      return ticket.customer || "";
    case "city":
      return ticket.city || "";
    case "location":
      return ticket.location || "";
    case "product":
      return productLabel(ticket);
    case "technician":
      return ticket.technician || "";
    case "status":
      return ticket.status || "";
    case "customerPref":
      return ticket.customerPref || "";
    case "redo":
      return ticket.redo || "";
    case "partOrder":
      return ticket.partOrder || "";
    case "schedule":
      return ticket.schedule || "";
    default:
      return ((ticket as any)[field] ?? "").toString();
  }
}

function parseTicketDate(s?: string): number | null {
  if (!s) return null;
  const p = s.split("/");
  if (p.length < 3) return null;
  const parts = p.map((x) => parseInt(x, 10));
  let [m, d, y] = parts;
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  if (y < 100) y += 2000;
  return y * 10000 + m * 100 + d;
}
function parseInputDate(v: string): number | null {
  if (!v) return null;
  const p = v.split("-");
  if (p.length < 3) return null;
  const [y, m, d] = p.map((x) => parseInt(x, 10));
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  return y * 10000 + m * 100 + d;
}

// ── Per-column funnel filter (ported from Ticket List) ──
function ColumnFilter({
  field,
  label,
  options,
  selected,
  onChange,
}: {
  field: string;
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const visible = useMemo(
    () => options.filter((o) => !search || o.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );
  const allChecked = selected.size === 0 || selected.size === options.length;
  const active = selected.size > 0 && selected.size < options.length;

  const toggle = (opt: string) => {
    const base = selected.size === 0 ? new Set(options) : new Set(selected);
    if (base.has(opt)) base.delete(opt);
    else base.add(opt);
    onChange(base.size === options.length ? new Set<string>() : base);
  };
  const toggleAll = () => {
    if (allChecked) onChange(new Set(["__none__"]));
    else onChange(new Set<string>());
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = document.getElementById(`colfilter-${field}`);
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, field]);

  return (
    <span id={`colfilter-${field}`} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`ml-1 inline-grid h-4 w-4 place-items-center rounded ${active ? "text-blue-200" : "text-blue-400/60"} hover:text-white`}
        title={`Filter by ${label}`}
      >
        <Filter className="h-3 w-3" fill={active ? "currentColor" : "none"} />
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-50 w-60 rounded-lg border border-white/15 bg-slate-900 shadow-2xl p-2 text-left normal-case">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Filter by {label}
          </div>
          <div className="relative mb-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded border border-white/15 bg-slate-800 pl-7 pr-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <label className="flex items-center gap-2 px-1 py-1 text-xs text-white cursor-pointer hover:bg-white/5 rounded">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="accent-blue-500 h-3.5 w-3.5"
              />
              <span className="font-semibold">(Select All)</span>
            </label>
            {visible.map((opt) => {
              const checked = selected.size === 0 || selected.size === options.length || selected.has(opt);
              return (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-1 py-1 text-xs text-slate-200 cursor-pointer hover:bg-white/5 rounded"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    className="accent-blue-500 h-3.5 w-3.5"
                  />
                  <span className="truncate">{opt || "(blank)"}</span>
                </label>
              );
            })}
            {visible.length === 0 && (
              <div className="px-1 py-2 text-xs text-slate-500">No matches</div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

export function CSRStatusSummary({ sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  // Live tickets from Supabase (company-scoped via RLS) — replaces the old
  // hardcoded dummy TICKETS import.
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setTicketsLoading(true);
        const rows = await getCompanyTickets();
        if (!cancelled) setTickets(rows);
      } catch (err) {
        console.error("Failed to load tickets:", err);
        if (!cancelled) setTickets([]);
      } finally {
        if (!cancelled) setTicketsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [repairStatusFilter, setRepairStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [ticketSourceFilter, setTicketSourceFilter] = useState("");

  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [showPieLabels, setShowPieLabels] = useState(true);

  // Per-column funnel filters
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (field: string, next: Set<string>) =>
    setColFilters((prev) => ({ ...prev, [field]: next }));

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TICKET_COLUMNS.map((c) => [c.key, true])),
  );
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const isColVisible = (key: TicketColumnKey) => visibleColumns[key] !== false;
  const toggleColumn = (key: TicketColumnKey) =>
    setVisibleColumns((prev) => ({ ...prev, [key]: prev[key] === false }));
  const showAllColumns = () =>
    setVisibleColumns(Object.fromEntries(TICKET_COLUMNS.map((c) => [c.key, true])));

  const locationOptions = useMemo(
    () => mergeLocationOptions(LOCATIONS, tickets.map((t) => t.location)),
    [tickets],
  );
  const ticketSourceOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...TICKET_SOURCES,
          ...(tickets.map((t) => t.ticketSource).filter(Boolean) as string[]),
        ]),
      ),
    [tickets],
  );

  // ── Top-filter the real ticket list ──
  const filteredTickets = useMemo(() => {
    const fromN = parseInputDate(startDateFilter);
    const toN = parseInputDate(endDateFilter);
    return tickets.filter((t) => {
      if (repairStatusFilter && t.status !== repairStatusFilter) return false;
      if (locationFilter && t.location !== locationFilter) return false;
      if (ticketSourceFilter && t.ticketSource !== ticketSourceFilter) return false;
      if (fromN || toN) {
        const dn = parseTicketDate(t.schedule) ?? parseTicketDate(t.created);
        if (dn == null) return false;
        if (fromN && dn < fromN) return false;
        if (toN && dn > toN) return false;
      }
      return true;
    });
  }, [tickets, repairStatusFilter, locationFilter, ticketSourceFilter, startDateFilter, endDateFilter]);

  // ── Group filtered tickets by status (drives cards + charts) ──
  const statusGroups = useMemo(() => {
    const map: Record<string, Ticket[]> = {};
    filteredTickets.forEach((t) => {
      (map[t.status] = map[t.status] || []).push(t);
    });
    return Object.entries(map).sort(([, a], [, b]) => b.length - a.length);
  }, [filteredTickets]);

  const totalCount = filteredTickets.length;

  const hasFilters = !!(
    repairStatusFilter ||
    locationFilter ||
    startDateFilter ||
    endDateFilter ||
    ticketSourceFilter
  );
  const clearFilters = () => {
    setRepairStatusFilter("");
    setLocationFilter("");
    setStartDateFilter("");
    setEndDateFilter("");
    setTicketSourceFilter("");
    setSelectedStatus("");
    setColFilters({});
  };

  const pieData = statusGroups.map(([name, list]) => ({ name, value: list.length }));
  const barData = statusGroups.map(([name, list]) => ({
    name: name
      .replace("CSR-", "")
      .replace("OP-", "OP: ")
      .replace("TR-", "TR: ")
      .replace("CL-", "CL: ")
      .replace("PT-", "PT: "),
    value: list.length,
    fill: colorFor(name),
  }));

  // Column-filter option lists (built from the top-filtered set)
  const columnOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const f of FILTERABLE) {
      map[f] = Array.from(new Set(filteredTickets.map((t) => colValue(t, f)).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      );
    }
    return map;
  }, [filteredTickets]);

  // Tickets shown in the bottom table: top filters → selected status → per-column filters
  const listTickets = useMemo(() => {
    let rows = selectedStatus ? filteredTickets.filter((t) => t.status === selectedStatus) : filteredTickets;
    rows = rows.filter((t) =>
      Object.entries(colFilters).every(([field, sel]) => {
        if (!sel || sel.size === 0) return true;
        if (sel.has("__none__")) return false;
        return sel.has(colValue(t, field));
      }),
    );
    return rows;
  }, [selectedStatus, filteredTickets, colFilters]);

  const visibleColCount = TICKET_COLUMNS.filter((c) => isColVisible(c.key)).length;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link
            to="/m/$module/$submodule"
            params={{ module: "dashboard", submodule: "csr-dashboard" }}
            className="btn hover:bg-white/15"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        {/* Filters */}
        <div className="panel mb-6">
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <select
                aria-label="Repair status filter"
                value={repairStatusFilter}
                onChange={(e) => setRepairStatusFilter(e.target.value)}
                className="glass-input w-full"
              >
                <option value="">All Repair Status</option>
                {REPAIR_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select
                aria-label="Location filter"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="glass-input w-full"
              >
                <option value="">All Locations</option>
                {locationOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <input
                aria-label="Start date"
                type="date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="glass-input w-full"
              />
              <input
                aria-label="End date"
                type="date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="glass-input w-full"
              />
              <select
                aria-label="Ticket source filter"
                value={ticketSourceFilter}
                onChange={(e) => setTicketSourceFilter(e.target.value)}
                className="glass-input w-full"
              >
                <option value="">All Ticket Sources</option>
                {ticketSourceOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              {(hasFilters || Object.keys(colFilters).length > 0) && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-white/10 border border-white/10 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />Clear
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {totalCount} total tickets · {statusGroups.length} statuses
                </span>
                <button
                  onClick={() =>
                    exportToCSV(
                      "csr_status_summary",
                      ["Status", "Count", "Sample Tickets"],
                      statusGroups.map(([s, list]) => [
                        s,
                        list.length,
                        list.slice(0, 3).map((t) => t.ticketNo).join(", "),
                      ]),
                    )
                  }
                  title="Download CSV"
                  className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Status Distribution</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ left: -10 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 9 }}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(148,163,184,0.1)" }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Tickets">
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Pie Breakdown</p>
              <button
                onClick={() => setShowPieLabels((v) => !v)}
                className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition-colors ${showPieLabels ? "border-white/20 bg-white/10 text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
              >
                {showPieLabels ? "Hide %" : "Show %"}
              </button>
            </div>
            {/* On-slice labels overlap once there are more than a handful of
                statuses — instead the pie sits label-free on the left and
                every slice gets its own compact row (name + %) on the right,
                sized to fit all of them in one view without scrolling. */}
            <div className="flex gap-3 items-center">
              <ResponsiveContainer width="55%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    label={false}
                    labelLine={false}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={colorFor(entry.name)} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: any) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                {pieData.map((entry, i) => {
                  const pct = totalCount > 0 ? (entry.value / totalCount) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] leading-tight">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: colorFor(entry.name) }} />
                      <span className="truncate flex-1" style={{ color: "var(--foreground)" }}>{entry.name}</span>
                      <span className="text-muted-foreground shrink-0">
                        {entry.value}{showPieLabels ? ` · ${pct.toFixed(0)}%` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Status count cards */}
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 mb-6">
          <button
            onClick={() => setSelectedStatus("")}
            className={`panel p-2.5 text-left border transition-colors ${!selectedStatus ? "border-white/30 bg-white/10" : "border-transparent hover:border-white/10 hover:bg-white/5"}`}
          >
            <div className="w-1.5 h-1.5 rounded-full mb-1.5 bg-foreground/70" />
            <p className="text-lg font-bold leading-none">{totalCount}</p>
            <p className="text-[9px] text-muted-foreground mt-1 leading-tight uppercase tracking-wide">Total</p>
          </button>
          {statusGroups.length === 0 ? (
            <p className="col-span-full text-center text-muted-foreground py-6">
              {ticketsLoading ? "Loading tickets…" : "No tickets match filters."}
            </p>
          ) : (
            statusGroups.map(([status, list]) => (
              <button
                key={status}
                onClick={() => setSelectedStatus(selectedStatus === status ? "" : status)}
                className={`panel p-2.5 text-left border transition-colors ${selectedStatus === status ? "border-white/30 bg-white/10" : "border-transparent hover:border-white/10 hover:bg-white/5"}`}
              >
                <div className="w-1.5 h-1.5 rounded-full mb-1.5" style={{ background: colorFor(status) }} />
                <p className="text-lg font-bold leading-none" style={{ color: colorFor(status) }}>
                  {list.length}
                </p>
                <p className="text-[9px] text-muted-foreground mt-1 leading-tight">{status}</p>
              </button>
            ))
          )}
        </div>

        {/* ── Ticket list ── */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2 flex-wrap">
            {selectedStatus ? (
              <>
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(selectedStatus) }} />
                <span className="font-semibold text-sm">{selectedStatus}</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-muted-foreground border border-white/10">
                  {listTickets.length} tickets
                </span>
                <button
                  onClick={() => setSelectedStatus("")}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />Show all
                </button>
              </>
            ) : (
              <>
                <span className="font-semibold text-sm">All Tickets</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-muted-foreground border border-white/10">
                  {listTickets.length} tickets
                </span>
              </>
            )}

            {/* Columns visibility menu */}
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setColumnsMenuOpen((o) => !o)}
                className="btn hover:bg-white/15 inline-flex items-center gap-2"
                aria-haspopup="true"
                aria-expanded={columnsMenuOpen}
              >
                <Columns3 className="h-4 w-4" /> Columns
                <span className="text-xs text-muted-foreground">
                  ({visibleColCount}/{TICKET_COLUMNS.length})
                </span>
              </button>
              {columnsMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setColumnsMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10 mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Show columns</span>
                      <button
                        type="button"
                        onClick={showAllColumns}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Show all
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {TICKET_COLUMNS.map((col) => (
                        <label
                          key={col.key}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={isColVisible(col.key)}
                            onChange={() => toggleColumn(col.key)}
                            className="accent-blue-500"
                          />
                          <span className="text-slate-200">{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] leading-tight">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-2 py-1.5 text-center font-semibold text-blue-300">✓</th>
                  {isColVisible("ticketNo") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300 whitespace-nowrap">Ticket No</th>
                  )}
                  {isColVisible("warranty") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Wty
                        <ColumnFilter
                          field="warranty"
                          label="Wty"
                          options={columnOptions["warranty"] || []}
                          selected={colFilters["warranty"] || new Set()}
                          onChange={(n) => setColFilter("warranty", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("ticketSource") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Ticket Source
                        <ColumnFilter
                          field="ticketSource"
                          label="Ticket Source"
                          options={columnOptions["ticketSource"] || []}
                          selected={colFilters["ticketSource"] || new Set()}
                          onChange={(n) => setColFilter("ticketSource", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("customer") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Cx Name
                        <ColumnFilter
                          field="customer"
                          label="Cx Name"
                          options={columnOptions["customer"] || []}
                          selected={colFilters["customer"] || new Set()}
                          onChange={(n) => setColFilter("customer", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("city") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        City
                        <ColumnFilter
                          field="city"
                          label="City"
                          options={columnOptions["city"] || []}
                          selected={colFilters["city"] || new Set()}
                          onChange={(n) => setColFilter("city", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("location") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Loc
                        <ColumnFilter
                          field="location"
                          label="Loc"
                          options={columnOptions["location"] || []}
                          selected={colFilters["location"] || new Set()}
                          onChange={(n) => setColFilter("location", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("product") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Product
                        <ColumnFilter
                          field="product"
                          label="Product"
                          options={columnOptions["product"] || []}
                          selected={colFilters["product"] || new Set()}
                          onChange={(n) => setColFilter("product", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("model") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300 whitespace-nowrap">Model</th>
                  )}
                  {isColVisible("internalNote") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300 whitespace-nowrap">Internal Note</th>
                  )}
                  {isColVisible("repair") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300 whitespace-nowrap">Repair</th>
                  )}
                  {isColVisible("technician") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Technician
                        <ColumnFilter
                          field="technician"
                          label="Technician"
                          options={columnOptions["technician"] || []}
                          selected={colFilters["technician"] || new Set()}
                          onChange={(n) => setColFilter("technician", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("customerPref") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Cx Prefer
                        <ColumnFilter
                          field="customerPref"
                          label="Cx Prefer"
                          options={columnOptions["customerPref"] || []}
                          selected={colFilters["customerPref"] || new Set()}
                          onChange={(n) => setColFilter("customerPref", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("schedule") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300 whitespace-nowrap">Schedule</th>
                  )}
                  {isColVisible("status") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Status
                        <ColumnFilter
                          field="status"
                          label="Status"
                          options={columnOptions["status"] || []}
                          selected={colFilters["status"] || new Set()}
                          onChange={(n) => setColFilter("status", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("phone") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300 whitespace-nowrap">Phone</th>
                  )}
                  {isColVisible("redo") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Redo
                        <ColumnFilter
                          field="redo"
                          label="Redo"
                          options={columnOptions["redo"] || []}
                          selected={colFilters["redo"] || new Set()}
                          onChange={(n) => setColFilter("redo", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("aging") && (
                    <th className="px-2 py-1.5 text-center font-semibold text-blue-300">Aging</th>
                  )}
                  {isColVisible("statusSpend") && (
                    <th className="px-2 py-1.5 text-center font-semibold text-blue-300">Status Spend</th>
                  )}
                  {isColVisible("calls") && (
                    <th className="px-2 py-1.5 text-center font-semibold text-blue-300">Calls</th>
                  )}
                  {isColVisible("partOrder") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300">
                      <span className="inline-flex items-center">
                        Part Order
                        <ColumnFilter
                          field="partOrder"
                          label="Part Order"
                          options={columnOptions["partOrder"] || []}
                          selected={colFilters["partOrder"] || new Set()}
                          onChange={(n) => setColFilter("partOrder", n)}
                        />
                      </span>
                    </th>
                  )}
                  {isColVisible("posting") && (
                    <th className="px-2 py-1.5 text-left font-semibold text-blue-300 whitespace-nowrap">Posting</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {listTickets.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColCount + 1} className="px-4 py-10 text-center text-muted-foreground">
                      {ticketsLoading ? "Loading tickets…" : "No tickets match filters."}
                    </td>
                  </tr>
                ) : (
                  listTickets.map((t, i) => {
                    const aging = daysSinceCreated(t.created);
                    const spend = t.statusChangedAt ? daysSinceCreated(t.statusChangedAt) : (t.aging ?? aging);
                    return (
                      <tr key={t.ticketNo + i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-2 py-1.5 text-center font-bold text-green-400">{""}</td>
                        {isColVisible("ticketNo") && (
                          <td className="px-2 py-1.5 font-mono text-blue-400 font-semibold whitespace-nowrap">
                            <a
                              href={`/ticket/${t.ticketNo}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-blue-300 hover:underline transition cursor-pointer"
                            >
                              {t.ticketNo}
                            </a>
                          </td>
                        )}
                        {isColVisible("warranty") && (
                          <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{warrantyAcronym(t.warranty)}</td>
                        )}
                        {isColVisible("ticketSource") && (
                          <td
                            className="px-2 py-1.5 text-slate-300 max-w-[110px] truncate"
                            title={t.ticketSource || t.manufacturer}
                          >
                            {t.ticketSource || t.manufacturer}
                          </td>
                        )}
                        {isColVisible("customer") && (
                          <td className="px-2 py-1.5 text-slate-300 max-w-[120px] truncate" title={t.customer}>
                            {t.customer}
                          </td>
                        )}
                        {isColVisible("city") && (
                          <td className="px-2 py-1.5 text-slate-300 max-w-[90px] truncate" title={t.city}>
                            {t.city}
                          </td>
                        )}
                        {isColVisible("location") && (
                          <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{t.location}</td>
                        )}
                        {isColVisible("product") && (
                          <td className="px-2 py-1.5 text-slate-300 max-w-[120px] truncate" title={productLabel(t)}>
                            {productLabel(t)}
                          </td>
                        )}
                        {isColVisible("model") && (
                          <td className="px-2 py-1.5 font-mono text-slate-300 max-w-[90px] truncate" title={t.model}>
                            {t.model}
                          </td>
                        )}
                        {isColVisible("internalNote") && (
                          <td className="px-2 py-1.5 text-slate-400 max-w-[140px] truncate" title={t.internalNote}>
                            {t.internalNote || "—"}
                          </td>
                        )}
                        {isColVisible("repair") && (
                          <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{t.diagnosed}</td>
                        )}
                        {isColVisible("technician") && (
                          <td className="px-2 py-1.5 text-slate-300 max-w-[110px] truncate" title={t.technician}>
                            {t.technician || "—"}
                          </td>
                        )}
                        {isColVisible("customerPref") && (
                          <td className="px-2 py-1.5 text-center text-slate-300">{t.customerPref}</td>
                        )}
                        {isColVisible("schedule") && (
                          <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{t.schedule}</td>
                        )}
                        {isColVisible("status") && (
                          <td
                            className={`px-2 py-1.5 font-semibold max-w-[130px] truncate ${statusTextColor(t.status)}`}
                            title={t.status}
                          >
                            {t.status}
                          </td>
                        )}
                        {isColVisible("phone") && (
                          <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{t.phone}</td>
                        )}
                        {isColVisible("redo") && (
                          <td className="px-2 py-1.5 text-center text-slate-300">{t.redo}</td>
                        )}
                        {isColVisible("aging") && (
                          <td className="px-2 py-1.5 text-center">
                            <span className={`font-bold text-sm ${agingColor(aging)}`}>{aging}d</span>
                          </td>
                        )}
                        {isColVisible("statusSpend") && (
                          <td className="px-2 py-1.5 text-center">
                            <span className="inline-flex flex-col items-center gap-0.5">
                              <span className={`font-bold text-sm ${agingColor(spend)}`}>{spend}d</span>
                              <History className="h-3 w-3 text-white/20" />
                            </span>
                          </td>
                        )}
                        {isColVisible("calls") && (
                          <td className="px-2 py-1.5 text-center text-slate-300">{t.calls}</td>
                        )}
                        {isColVisible("partOrder") && (
                          <td className="px-2 py-1.5 text-slate-300 max-w-[110px] truncate" title={t.partOrder}>
                            {t.partOrder}
                          </td>
                        )}
                        {isColVisible("posting") && (
                          <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{t.created}</td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
