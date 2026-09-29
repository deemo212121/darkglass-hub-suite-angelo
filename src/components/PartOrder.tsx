import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Download, CalendarRange, Filter } from "lucide-react";
import { getPartOrderRows, type PartOrderRow } from "@/lib/supabase/partOrder";
import { marconeLookupPart } from "@/lib/marconeApi";
import { useAuth } from "@/lib/auth";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { exportToCSV } from "@/lib/csvExport";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

/**
 * Part Order — every ticket that needs a part ordered: Repair Status
 * "TR-Need PO", or any other status with a part still marked "Need PO" (see
 * getPartOrderRows), with a Schedule Date range and per-column funnel
 * filters. Nothing is hidden by default.
 *
 * Warranty is filtered from the values actually on the tickets, never a
 * fixed list: tickets store both short codes ("IW") and long names
 * ("In warranty"), and the old fixed-list Warranty Type filter silently
 * dropped every ticket whose value wasn't on it — 9 of 17 TR-Need PO
 * tickets were missing from this page because of it.
 */

const todayStr = () => new Date().toISOString().slice(0, 10);

const COLUMNS = [
  { key: "ticketNo", label: "Ticket #", value: (o: PartOrderRow) => o.ticketNo },
  { key: "location", label: "Location", value: (o: PartOrderRow) => o.location || "—" },
  { key: "warranty", label: "Warranty", value: (o: PartOrderRow) => o.warranty || "—" },
  { key: "scheduleDate", label: "Schedule Date", value: (o: PartOrderRow) => o.scheduleDate || "—" },
  { key: "status", label: "Status", value: (o: PartOrderRow) => o.status },
  { key: "partDist", label: "Part Dist.", value: (o: PartOrderRow) => o.partDist || "—" },
  { key: "partNo", label: "Part No", value: (o: PartOrderRow) => o.partNo || "—" },
  { key: "description", label: "Description", value: (o: PartOrderRow) => o.description || "—" },
  { key: "eta", label: "ETA", value: (o: PartOrderRow) => o.eta?.trim() || "—" },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];

export function PartOrder({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { ready: authReady } = useAuth();

  const [orders, setOrders] = useState<PartOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Schedule Date range. Blank From/To = no limit on that side. Tickets with
  // no schedule date yet are kept unless unchecked — plenty of TR-Need PO
  // tickets aren't scheduled at all.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeNoDate, setIncludeNoDate] = useState(true);
  // "No date" quick filter — only tickets with no schedule date at all.
  const [noDateOnly, setNoDateOnly] = useState(false);
  const rangeActive = Boolean(dateFrom || dateTo) || noDateOnly;

  // Summary-tile filter — which group of tickets the table is narrowed to.
  type TicketGroup = "all" | "trAll" | "trWith" | "trWithout" | "other";
  const [ticketGroup, setTicketGroup] = useState<TicketGroup>("all");
  const matchesGroup = (o: PartOrderRow) => {
    const isTr = o.status === "TR-Need PO";
    if (ticketGroup === "trAll") return isTr;
    if (ticketGroup === "trWith") return isTr && !o.noPartLogged;
    if (ticketGroup === "trWithout") return isTr && o.noPartLogged;
    if (ticketGroup === "other") return !isTr;
    return true;
  };

  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnKey, Set<string>>>>({});
  const hasColumnFilters = Object.values(columnFilters).some((s) => s && s.size > 0);
  const hasAnyFilter = hasColumnFilters || rangeActive || !includeNoDate || ticketGroup !== "all";
  const clearAll = () => {
    setTicketGroup("all");
    setColumnFilters({});
    setDateFrom("");
    setDateTo("");
    setIncludeNoDate(true);
    setNoDateOnly(false);
  };

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [availByPartNo, setAvailByPartNo] = useState<Record<string, number | null>>({});
  const [availLoading, setAvailLoading] = useState<Set<string>>(new Set());
  const fetchedPartNosRef = useRef<Set<string>>(new Set());

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

  const matchesDate = (o: PartOrderRow) => {
    if (noDateOnly) return !o.scheduleDate;
    if (!o.scheduleDate) return includeNoDate;
    const d = o.scheduleDate.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };
  const matchesColumns = (o: PartOrderRow, exceptKey?: ColumnKey) =>
    COLUMNS.every(({ key, value }) => {
      if (key === exceptKey) return true;
      const selected = columnFilters[key];
      return !selected || selected.size === 0 || selected.has(value(o));
    });

  const filteredOrders = useMemo(
    () => orders.filter((o) => matchesGroup(o) && matchesDate(o) && matchesColumns(o)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, dateFrom, dateTo, includeNoDate, noDateOnly, columnFilters, ticketGroup],
  );

  // TR-Need PO tickets split by whether their Part Transaction has any
  // record yet, plus the other-status tickets listed for a Need PO part.
  // Counted per ticket across everything loaded (not the filtered view).
  const summary = useMemo(() => {
    const tr = new Set<string>();
    const trWithout = new Set<string>();
    const other = new Set<string>();
    for (const o of orders) {
      if (o.status === "TR-Need PO") {
        tr.add(o.ticketNo);
        if (o.noPartLogged) trWithout.add(o.ticketNo);
      } else {
        other.add(o.ticketNo);
      }
    }
    return { tr: tr.size, trWith: tr.size - trWithout.size, trWithout: trWithout.size, other: other.size };
  }, [orders]);

  // Each funnel lists the values among rows that pass every OTHER filter
  // (Excel autofilter behavior, same as TicketList.tsx).
  const columnOptions = useMemo(() => {
    const out = {} as Record<ColumnKey, string[]>;
    for (const { key, value } of COLUMNS) {
      out[key] = orders.filter((o) => matchesGroup(o) && matchesDate(o) && matchesColumns(o, key)).map(value);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, dateFrom, dateTo, includeNoDate, noDateOnly, columnFilters, ticketGroup]);

  const ticketCount = useMemo(() => new Set(filteredOrders.map((o) => o.ticketNo)).size, [filteredOrders]);
  const totalTicketCount = useMemo(() => new Set(orders.map((o) => o.ticketNo)).size, [orders]);

  // Live Marcone stock per distinct part number on screen — fetched once per
  // part number and cached. No Encompass/NSA stock API exists here, so
  // parts from those distributors show "—".
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

  const setQuickRange = (preset: "today" | "past" | "noDate" | "all") => {
    const today = todayStr();
    setNoDateOnly(preset === "noDate");
    if (preset === "today") { setDateFrom(today); setDateTo(today); setIncludeNoDate(false); }
    if (preset === "past") {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      setDateFrom(""); setDateTo(yesterday); setIncludeNoDate(false);
    }
    if (preset === "noDate" || preset === "all") { setDateFrom(""); setDateTo(""); setIncludeNoDate(true); }
  };
  // Which quick option the current date settings match, if any — lit up as
  // the selected one, like the old radio buttons. A hand-picked range is none.
  const activePreset = (() => {
    const today = todayStr();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (noDateOnly) return "noDate";
    if (!dateFrom && !dateTo && includeNoDate) return "all";
    if (dateFrom === today && dateTo === today && !includeNoDate) return "today";
    if (!dateFrom && dateTo === yesterday && !includeNoDate) return "past";
    return null;
  })();

  const handleExport = () => {
    if (filteredOrders.length === 0) return;
    exportToCSV(
      "part_order",
      ["Ticket #", "Location", "Warranty", "Schedule Date", "Status", "Part Dist.", "Part No", "Description", "ETA", "Request Qty", "Avail Qty"],
      filteredOrders.map((o) => [
        o.ticketNo, o.location, o.warranty, o.scheduleDate, o.status, o.partDist, o.partNo, o.description,
        o.eta?.trim() || "", o.partNo ? o.requestQty : "", availByPartNo[o.partNo] ?? "",
      ]),
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 w-full min-w-0 px-4 lg:px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={goBack} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </button>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">
            Every ticket that needs a part ordered: Repair Status <span className="font-semibold text-blue-300">TR-Need PO</span> (all its parts, or a blank row if none is logged yet), plus any other ticket with a part still marked <span className="font-semibold text-amber-300">Need PO</span>.
          </p>
        </div>

        <div className="panel mb-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {([
              { group: "trAll", label: "TR-Need PO tickets", value: summary.tr, hint: "Repair Status is TR-Need PO", tone: "border-l-blue-500 text-blue-300" },
              { group: "trWith", label: "With part transaction", value: summary.trWith, hint: "TR-Need PO with at least one Part Transaction record", tone: "border-l-emerald-500 text-emerald-300" },
              { group: "trWithout", label: "No part transaction", value: summary.trWithout, hint: "TR-Need PO with no Part Transaction record yet — part still needs to be added", tone: "border-l-amber-500 text-amber-300" },
              { group: "other", label: "Other status, part Need PO", value: summary.other, hint: "Not TR-Need PO, but a part is still marked Need PO", tone: "border-l-slate-400 text-slate-300" },
            ] as const).map((t) => {
              const active = ticketGroup === t.group;
              return (
                <button
                  key={t.group}
                  type="button"
                  aria-pressed={active}
                  title={`${t.hint}. Click to ${active ? "show all" : "filter the table to these"}.`}
                  onClick={() => setTicketGroup(active ? "all" : t.group)}
                  className={`rounded-lg border border-white/10 border-l-4 px-4 py-3 text-left transition ${t.tone} ${
                    active ? "bg-white/10 ring-1 ring-white/25" : "bg-white/[0.03] hover:bg-white/[0.07]"
                  }`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">{loading ? "…" : t.value}</div>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="po-date-from" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schedule Date From</label>
              <input
                id="po-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setNoDateOnly(false); }}
                className="glass-input text-sm py-1.5 px-3 rounded-md [color-scheme:dark]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="po-date-to" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schedule Date To</label>
              <input
                id="po-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setNoDateOnly(false); }}
                className="glass-input text-sm py-1.5 px-3 rounded-md [color-scheme:dark]"
              />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
              <input type="checkbox" checked={includeNoDate || noDateOnly} disabled={noDateOnly} onChange={(e) => setIncludeNoDate(e.target.checked)} />
              Include tickets with no schedule date
            </label>
            <div className="flex items-center gap-1.5 pb-1">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              {([
                ["all", "All Need PO"],
                ["today", "Today"],
                ["past", "Past Schedule Date"],
                ["noDate", "No Schedule Date"],
              ] as const).map(([preset, label]) => {
                const active = activePreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setQuickRange(preset)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      active
                        ? "border-blue-400/60 bg-blue-600 text-white"
                        : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {hasAnyFilter && (
              <button type="button" onClick={clearAll} className="ml-auto text-xs text-blue-400 hover:text-blue-300 pb-2">
                Clear all filters
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Every column is also filterable from its header — click the <Filter className="inline h-3 w-3 align-text-bottom" /> icon.
          </p>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-blue-300">
            {loading
              ? "Loading…"
              : `${ticketCount} ticket${ticketCount === 1 ? "" : "s"} · ${filteredOrders.length} part line${filteredOrders.length === 1 ? "" : "s"} need PO`}
            {!loading && hasAnyFilter && (
              <span className="ml-2 font-normal text-muted-foreground">(of {totalTicketCount} tickets needing a PO)</span>
            )}
          </div>
          <button
            type="button"
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
          <div ref={tableScrollRef} className="panel p-0 overflow-x-auto">
            <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  {COLUMNS.map(({ key, label }) => (
                    <th key={key} className="px-4 py-3 text-left font-semibold text-blue-300 whitespace-nowrap">
                      <span className="inline-flex items-center">
                        {label}
                        <TicketColumnFilter
                          options={columnOptions[key] || []}
                          selected={columnFilters[key] ?? new Set()}
                          onChange={(next) => setColumnFilters((prev) => ({ ...prev, [key]: next }))}
                          label={`Filter by ${label}`}
                        />
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-semibold text-blue-300 whitespace-nowrap">Request Qty</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300 whitespace-nowrap" title="Live Marcone stock availability">Avail. Qty</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={COLUMNS.length + 3} className="px-4 py-8 text-center text-slate-400">Loading part orders…</td></tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 3} className="px-4 py-8 text-center text-slate-400">
                      {orders.length === 0 ? "No tickets need a PO right now." : "No tickets match these filters."}
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o) => {
                    const avail = availByPartNo[o.partNo];
                    const availDisplay = availLoading.has(o.partNo) ? "…" : avail == null ? "—" : avail;
                    const pastDue = !!o.scheduleDate && o.scheduleDate.slice(0, 10) < todayStr();
                    return (
                      <tr key={o.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 font-mono whitespace-nowrap">
                          <a href={`/ticket/${o.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline font-semibold">
                            {o.ticketNo}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{o.location || "—"}</td>
                        <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{o.warranty || "—"}</td>
                        <td className={`px-4 py-3 whitespace-nowrap ${pastDue ? "text-amber-300 font-semibold" : "text-slate-300"}`} title={pastDue ? "Schedule date has passed" : undefined}>
                          {o.scheduleDate || "—"}
                        </td>
                        <td
                          className={`px-4 py-3 font-semibold whitespace-nowrap ${o.status === "TR-Need PO" ? "text-blue-400" : "text-amber-300"}`}
                          title={o.status === "TR-Need PO" ? undefined : "Listed because a part on this ticket is still marked Need PO"}
                        >
                          {o.status || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-300">{o.partDist || "—"}</td>
                        <td className="px-4 py-3 font-mono text-slate-300">{o.partNo || <span className="text-slate-500 font-sans italic">No part logged</span>}</td>
                        <td className="px-4 py-3 text-slate-300">{o.description || "—"}</td>
                        <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{o.eta?.trim() || "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-400">{o.partNo ? o.requestQty : "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-400">{availDisplay}</td>
                        <td className="px-4 py-3 text-center">
                          <a
                            href={`/ticket/${o.ticketNo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block px-2 py-1 text-xs font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/40 hover:bg-blue-500/30 transition-colors whitespace-nowrap"
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
      </main>
    </div>
  );
}
