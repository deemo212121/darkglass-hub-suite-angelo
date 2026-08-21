import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Download, ChevronDown, Filter } from "lucide-react";
import {
  getPartOrderRows,
  type PartOrderRow,
} from "@/lib/supabase/partOrder";
import { marconeLookupPart } from "@/lib/marconeApi";
import { useAuth } from "@/lib/auth";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { exportToCSV } from "@/lib/csvExport";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";

// Canonical set — matches the ticket-creation form's own WARRANTY_TYPES
// (NewTicketPage.tsx) and the original part_order.html design mockup, so
// the filter always offers every real warranty type regardless of what's
// currently in use on live tickets (unlike the old live-distinct-values
// dropdown this replaces, which only ever showed values already in use).
const WARRANTY_TYPES = [
  "Concession LP", "Concession L", "Concession P", "In warranty", "Labor only Wty",
  "Out-of-warranty", "Part only Wty", "Special Part 5 year", "Unknown",
  "Ext Wty", "Ext Labor Wty", "Ext Part Wty",
];

/**
 * Checkable dropdown with a "Select All" row — kept local to PartOrder.tsx,
 * used here for Warranty Type (the one filter with no corresponding table
 * column, so it can't become a TicketColumnFilter funnel like the rest —
 * see COLUMN_FILTER_KEYS/renderColFilter below for those).
 * `selected` is always the literal, explicit set of checked values —
 * defaults to every option (see the useState(WARRANTY_TYPES) etc. call
 * sites below), so "show everything" on first load really does render
 * every box checked, not an empty-array stand-in for it. "Select All" is a
 * real toggle: all-checked -> none-checked -> all-checked, same convention
 * LtpProjectionReport.tsx's own MultiSelect already uses.
 */
function MultiSelectDropdown({
  label, options, selected, onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const allSelected = selected.length === options.length;
  const toggleOne = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
  const display = allSelected ? `All ${label}` : selected.length === 0 ? "None" : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="glass-input w-full flex items-center justify-between text-left"
      >
        <span className="truncate">{display}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
          <label className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 cursor-pointer border-b border-white/10">
            <input type="checkbox" checked={allSelected} onChange={() => onChange(allSelected ? [] : [...options])} />
            Select All
          </label>
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/10 cursor-pointer">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggleOne(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// Per-column funnel filters (Excel-style autofilter), same TicketColumnFilter
// component and pattern TicketList.tsx already uses — one Set<string> of
// selected values per column, empty = show all for that column.
const COLUMN_FILTER_KEYS = ["ticketNo", "location", "status", "partDist", "partNo", "description", "eta"] as const;
type ColumnFilterKey = (typeof COLUMN_FILTER_KEYS)[number];
const columnValueGetters: Record<ColumnFilterKey, (o: PartOrderRow) => string> = {
  ticketNo: (o) => o.ticketNo,
  location: (o) => o.location,
  status: (o) => o.status,
  partDist: (o) => o.partDist,
  partNo: (o) => o.partNo,
  description: (o) => o.description,
  eta: (o) => o.eta,
};

export function PartOrder({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { ready: authReady } = useAuth();
  // "all" (default) applies no date filtering at all — same behavior the
  // old plain date input had when left blank. "specific" filters to
  // scheduleDateValue exactly (the old input's only other behavior).
  const [scheduleDateMode, setScheduleDateMode] = useState<"all" | "specific" | "past" | "none">("all");
  const [scheduleDateValue, setScheduleDateValue] = useState("");
  const [warrantyTypes, setWarrantyTypes] = useState<string[]>(WARRANTY_TYPES);
  const [columnFilters, setColumnFilters] = useState<Record<ColumnFilterKey, Set<string>>>(
    () => Object.fromEntries(COLUMN_FILTER_KEYS.map((k) => [k, new Set<string>()])) as Record<ColumnFilterKey, Set<string>>,
  );
  const updateColumnFilter = (key: ColumnFilterKey, next: Set<string>) =>
    setColumnFilters((prev) => ({ ...prev, [key]: next }));
  const hasActiveColumnFilters = COLUMN_FILTER_KEYS.some((k) => columnFilters[k]?.size > 0);
  const clearAllColumnFilters = () =>
    setColumnFilters(Object.fromEntries(COLUMN_FILTER_KEYS.map((k) => [k, new Set<string>()])) as Record<ColumnFilterKey, Set<string>>);
  const [orders, setOrders] = useState<PartOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [availByPartNo, setAvailByPartNo] = useState<Record<string, number | null>>({});
  const [availLoading, setAvailLoading] = useState<Set<string>>(new Set());
  const fetchedPartNosRef = useRef<Set<string>>(new Set());

  // Load all "needs a PO" parts across the company's tickets from Supabase.
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getPartOrderRows()
      .then((rows) => { if (!cancelled) setOrders(rows); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authReady]);

  const matchesScheduleDate = (order: PartOrderRow, today: string) => {
    if (scheduleDateMode === "specific") return !scheduleDateValue || order.scheduleDate === scheduleDateValue;
    if (scheduleDateMode === "past") return !!order.scheduleDate && order.scheduleDate < today;
    if (scheduleDateMode === "none") return !order.scheduleDate;
    return true;
  };

  // Filter orders based on selected criteria
  const filteredOrders = useMemo(() => {
    const today = todayStr();
    return orders.filter((order) => {
      // The blank check on each comes first — an order with no data for
      // that field yet (shown as "—" in the table) should never be hidden
      // just because its empty string isn't itself one of the checkable
      // options; only a real, non-matching value gets filtered out.
      if (order.warranty && !warrantyTypes.includes(order.warranty)) return false;
      if (!matchesScheduleDate(order, today)) return false;
      return COLUMN_FILTER_KEYS.every((key) => {
        const selected = columnFilters[key];
        if (!selected || selected.size === 0) return true;
        return selected.has(columnValueGetters[key](order));
      });
    });
  }, [orders, warrantyTypes, columnFilters, scheduleDateMode, scheduleDateValue]);

  // Build option lists per column from orders that pass every OTHER filter —
  // so opening one column's funnel still shows every value present among
  // rows that already match everything else (Excel autofilter UX), same
  // buildOptionsExcluding pattern TicketList.tsx uses.
  const buildOptionsExcluding = (excludeKey: ColumnFilterKey): string[] => {
    const today = todayStr();
    const values = new Set<string>();
    for (const order of orders) {
      if (order.warranty && !warrantyTypes.includes(order.warranty)) continue;
      if (!matchesScheduleDate(order, today)) continue;
      const matchesOtherCols = COLUMN_FILTER_KEYS.every((key) => {
        if (key === excludeKey) return true;
        const selected = columnFilters[key];
        if (!selected || selected.size === 0) return true;
        return selected.has(columnValueGetters[key](order));
      });
      if (matchesOtherCols) values.add(columnValueGetters[excludeKey](order));
    }
    return Array.from(values);
  };

  const columnOptions = useMemo(() => {
    const out = {} as Record<ColumnFilterKey, string[]>;
    for (const key of COLUMN_FILTER_KEYS) out[key] = buildOptionsExcluding(key);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, warrantyTypes, columnFilters, scheduleDateMode, scheduleDateValue]);

  const renderColFilter = (key: ColumnFilterKey, label: string) => (
    <TicketColumnFilter
      options={columnOptions[key] || []}
      selected={columnFilters[key] || new Set()}
      onChange={(next) => updateColumnFilter(key, next)}
      label={`Filter by ${label}`}
    />
  );

  // Real live stock check (Marcone) per distinct part number currently on
  // screen - fetched once per part number and cached, not re-fetched on
  // every filter change. No equivalent Encompass/NSA stock API exists in
  // this app today, so parts sourced from those distributors will show "—".
  useEffect(() => {
    const distinctPartNos = Array.from(new Set(filteredOrders.map((o) => o.partNo).filter(Boolean)));
    const toFetch = distinctPartNos.filter((p) => !fetchedPartNosRef.current.has(p));
    if (toFetch.length === 0) return;
    toFetch.forEach((p) => fetchedPartNosRef.current.add(p));
    setAvailLoading((prev) => new Set([...prev, ...toFetch]));
    toFetch.forEach((partNo) => {
      marconeLookupPart({ partNumber: partNo })
        .then((result) => {
          const value = result.success && result.data ? result.data.totalAvailable ?? 0 : null;
          setAvailByPartNo((prev) => ({ ...prev, [partNo]: value }));
        })
        .catch(() => setAvailByPartNo((prev) => ({ ...prev, [partNo]: null })))
        .finally(() => setAvailLoading((prev) => {
          const next = new Set(prev);
          next.delete(partNo);
          return next;
        }));
    });
  }, [filteredOrders]);

  const handleExport = () => {
    if (filteredOrders.length === 0) return;
    exportToCSV(
      "part_order",
      ["Ticket #", "Location", "Status", "Part Dist.", "Part No", "Description", "ETA", "Request Qty", "Avail Qty"],
      filteredOrders.map((order) => [
        order.ticketNo,
        order.location,
        order.status,
        order.partDist,
        order.partNo,
        order.description,
        order.eta && order.eta.trim() !== "" ? order.eta : "",
        order.requestQty,
        availByPartNo[order.partNo] ?? "",
      ]),
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="panel">
          <style>{`
            .form-group { display: flex; flex-direction: column; gap: 0.35rem; }
            .form-group label { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; color: #e5e7eb; }
            .form-section-title { font-size: 0.95rem; font-weight: 600; color: #64b5f6; margin-bottom: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
            .info-banner { background: rgba(96, 165, 250, 0.1); border: 1px solid rgba(96, 165, 250, 0.3); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; color: #93c5fd; font-size: 0.85rem; line-height: 1.5; }
          `}</style>

          {/* Info Banner */}
          <div className="info-banner">
            <strong>📋 How Part Orders Work:</strong> Part orders are created automatically when you add parts to a ticket in Service Tracking.
            View them here to check status, track ETAs, and check live stock availability.
          </div>

          {/* Order Criteria Section */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="form-section-title mb-0">Filter Criteria</h3>
              {hasActiveColumnFilters && (
                <button type="button" onClick={clearAllColumnFilters} className="text-xs text-blue-400 hover:text-blue-300 mb-4">
                  Clear column filters
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground -mt-2 mb-4">
              Location, Status, Part Dist., Part No, Description, and ETA are filterable directly from their column header — click the <Filter className="inline h-3 w-3 align-text-bottom" /> icon.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="form-group">
                <label>Warranty Type</label>
                <MultiSelectDropdown label="Warranty Types" options={WARRANTY_TYPES} selected={warrantyTypes} onChange={setWarrantyTypes} />
              </div>
            </div>

            <div className="mt-4">
              <label className="block">Schedule Date</label>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={scheduleDateMode === "specific"}
                    onChange={() => setScheduleDateMode("specific")}
                  />
                  <input
                    type="date"
                    value={scheduleDateValue}
                    onChange={(e) => { setScheduleDateValue(e.target.value); setScheduleDateMode("specific"); }}
                    disabled={scheduleDateMode !== "specific"}
                    className="glass-input py-1 px-2 text-sm disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={scheduleDateMode === "past"} onChange={() => setScheduleDateMode("past")} />
                  Past Schedule Date
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={scheduleDateMode === "none"} onChange={() => setScheduleDateMode("none")} />
                  No Schedule Date
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={scheduleDateMode === "all"} onChange={() => setScheduleDateMode("all")} />
                  All Need PO
                </label>
              </div>
            </div>
          </div>

          {/* Order Count */}
          <div className="mt-6 mb-4 flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-blue-300">
              {loading
                ? "Loading…"
                : `${filteredOrders.length} part${filteredOrders.length === 1 ? '' : 's'} need${filteredOrders.length === 1 ? 's' : ''} PO${columnFilters.location?.size === 1 ? ` in ${Array.from(columnFilters.location)[0]}` : ''}`}
            </div>
            <button
              onClick={handleExport}
              disabled={filteredOrders.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
              title="Export the visible rows to CSV"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          {loadError ? (
            <p className="text-sm text-red-400 px-2 py-6">Failed to load part orders: {loadError}</p>
          ) : (
          /* Order Table */
          <div className="mt-4 overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Ticket # {renderColFilter("ticketNo", "Ticket #")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Location {renderColFilter("location", "Location")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Status {renderColFilter("status", "Status")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Dist. {renderColFilter("partDist", "Part Dist.")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part No {renderColFilter("partNo", "Part No")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Description {renderColFilter("description", "Description")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">ETA {renderColFilter("eta", "ETA")}</th>
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-blue-300">Inventory Qty</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Action</th>
                </tr>
                <tr className="bg-blue-900/30 border-b border-blue-500/20">
                  <th colSpan={7} className="px-4 py-2"></th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Request</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Avail.</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">View Order</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                      Loading part orders…
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                      No parts with "Need PO" status found
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const hasETA = order.eta && order.eta.trim() !== "";
                    const avail = availByPartNo[order.partNo];
                    const availDisplay = availLoading.has(order.partNo)
                      ? "…"
                      : avail === undefined
                      ? "—"
                      : avail === null
                      ? "—"
                      : avail;
                    return (
                      <tr key={order.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 font-mono">
                          <a
                            href={`/ticket/${order.ticketNo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline font-semibold transition-colors"
                          >
                            {order.ticketNo}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{order.location || "—"}</td>
                        <td className="px-4 py-3 font-semibold text-blue-400">{order.status}</td>
                        <td className="px-4 py-3 text-slate-300">{order.partDist || "—"}</td>
                        <td className="px-4 py-3 font-mono text-slate-300">{order.partNo || "—"}</td>
                        <td className="px-4 py-3 text-slate-300">{order.description || "—"}</td>
                        <td className="px-4 py-3 text-slate-300">{hasETA ? order.eta : "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-400">{order.requestQty}</td>
                        <td className="px-4 py-3 text-center text-slate-400" title="Live Marcone stock availability">{availDisplay}</td>
                        <td className="px-4 py-3 text-center">
                          <a
                            href={`/ticket/${order.ticketNo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block px-2 py-1 text-xs font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/40 hover:bg-blue-500/30 transition-colors"
                          >
                            View Order
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </main>
    </div>
  );
}
