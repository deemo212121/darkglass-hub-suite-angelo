import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, normalizeLocationName } from "@/lib/locations";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { useAuth } from "@/lib/auth";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

// The To-Do list = follow-up tickets sitting in one of these exact statuses.
// Confirmed byte-for-byte against real production ticket.status values -
// previously had "CL-Need" here (a truncated value that never matched any
// real ticket, so every real "CL-Need Cancel" ticket was silently excluded)
// and an `|| aging > 1` fallback that pulled in unrelated statuses too.
const FOLLOWUP_STATUSES = new Set([
  "CL-Need Cancel",
  "CL-Parts Back Ordered",
  "CSR-Acknowledged",
  "CSR-Assigned to ASC",
  "CSR-Left Message for Cx",
  "CSR-Needs Scheduling",
  "OP-Ready for Service",
  "OP-Reschedule Follow up",
  "OP-UPDATE HOLD",
  "OP-Waiting for Part",
  "PT-Need PreAuthorization",
  "TR-Need PO",
  "TR-Need Triage",
]);

interface TodoRow {
  ticketNo: string;
  warranty: string;
  customer: string;
  model: string;
  customerPref: string;
  status: string;
  location: string;
  created: string;
  statusChangedAt: string;
}

function normalizeBranch(branch: string) {
  return normalizeLocationName(String(branch || "")) || "Unassigned";
}

function formatDate(value: unknown) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().slice(0, 10);
}

// Days since the ticket's status last changed - NOT days since creation.
// status_changed_at is only stamped by the DB trigger when status actually
// changes (never on insert), so a ticket still sitting in its very first
// status has a null pointer - confirmed against real data (e.g. ticket
// 054822474136: status_changed_at null, created_at 2026-06-23). Falling
// back to created date is correct there: it's been in that status since
// creation.
function daysSinceStatusChange(statusChangedAt: string, created: string): number {
  const raw = statusChangedAt || created;
  if (!raw) return 0;
  const then = new Date(raw);
  if (Number.isNaN(then.getTime())) return 0;
  const today = new Date();
  const utcThen = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((utcToday - utcThen) / 86400000));
}

function agingColor(days: number): string {
  return days <= 3 ? "text-green-400" : days <= 7 ? "text-yellow-400" : days <= 14 ? "text-orange-400" : "text-red-400";
}

// Same per-status color map as TicketList.tsx, for visual parity.
function statusColorClass(status: string): string {
  const key = (status || "").trim().toLowerCase();
  const map: Record<string, string> = {
    "pt-need preauthorization": "text-orange-600",
    "op-ready for service": "text-blue-400",
    "csr-left message for cx": "text-emerald-300",
    "op-waiting for part": "text-yellow-400",
    "csr-assigned to asc": "text-slate-200",
    "cl-parts back ordered": "text-slate-200",
    "tr-need triage": "text-slate-400",
    "cl-need cancel": "text-orange-200",
    "op-reschedule follow up": "text-pink-300",
    "csr-acknowledged": "text-rose-300",
    "op-update hold": "text-yellow-300",
    "tr-need po": "text-slate-400",
  };
  return map[key] ?? "text-blue-300";
}

const COLUMN_FILTER_KEYS = ["ticketNo", "warranty", "customer", "model", "customerPref", "status", "aging"] as const;
type ColumnFilterKey = (typeof COLUMN_FILTER_KEYS)[number];

export function TodoListPage({ mod, sub }: Props) {
  const { ready: authReady } = useAuth();
  const [rows, setRows] = useState<TodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState("");
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const tickets = await getCompanyTickets();
        const todo: TodoRow[] = tickets
          .filter((ticket) => FOLLOWUP_STATUSES.has(ticket.status))
          .map((ticket) => ({
            ticketNo: ticket.ticketNo,
            warranty: ticket.warranty || "",
            customer: ticket.customer || "",
            model: ticket.model || "",
            customerPref: ticket.customerPref || "",
            status: ticket.status || "",
            location: ticket.location || "",
            created: ticket.created || "",
            statusChangedAt: ticket.statusChangedAt || "",
          }));
        if (!cancelled) setRows(todo);
      } catch (err) {
        console.error("TodoList: failed to load tickets:", err);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (authReady) load();
    return () => { cancelled = true; };
  }, [authReady]);

  const [columnFilters, setColumnFilters] = useState<Record<ColumnFilterKey, Set<string>>>(() => {
    const init = {} as Record<ColumnFilterKey, Set<string>>;
    for (const k of COLUMN_FILTER_KEYS) init[k] = new Set<string>();
    return init;
  });
  const updateColumnFilter = (key: ColumnFilterKey, next: Set<string>) => {
    setColumnFilters((prev) => ({ ...prev, [key]: next }));
  };

  // aging's getter is the bare day count (no "d" suffix) - reads as a clean
  // list of numbers in the funnel, e.g. 0, 1, 2 ... 79.
  const columnValueGetters: Record<ColumnFilterKey, (r: TodoRow) => string> = {
    ticketNo: (r) => r.ticketNo,
    warranty: (r) => r.warranty,
    customer: (r) => r.customer,
    model: (r) => r.model,
    customerPref: (r) => r.customerPref,
    status: (r) => r.status,
    aging: (r) => String(daysSinceStatusChange(r.statusChangedAt, r.created)),
  };

  // Shared predicate so each column filter's own option list can cascade off
  // every OTHER active filter while excluding its own selection - same
  // "Excel autofilter" pattern TicketList.tsx uses.
  const matchesCommon = (row: TodoRow, opts: { skip?: ColumnFilterKey } = {}) => {
    if (branch && normalizeBranch(row.location) !== branch) return false;
    return COLUMN_FILTER_KEYS.every((key) => {
      if (key === opts.skip) return true;
      const sel = columnFilters[key];
      if (!sel || sel.size === 0) return true;
      return sel.has(columnValueGetters[key](row));
    });
  };

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesCommon(row)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, branch, columnFilters]
  );

  const columnOptions = useMemo(() => {
    const out = {} as Record<ColumnFilterKey, string[]>;
    for (const key of COLUMN_FILTER_KEYS) {
      const values = new Set<string>();
      for (const row of rows) {
        if (matchesCommon(row, { skip: key })) values.add(columnValueGetters[key](row));
      }
      out[key] = Array.from(values);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, branch, columnFilters]);

  // ---- Column sorting (mirrors TicketList.tsx's header-click sort) --------
  type SortDir = "asc" | "desc" | null;
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(key === "created" ? "desc" : "asc");
      return;
    }
    if (key === "created") {
      if (sortDir === "desc") { setSortKey(null); setSortDir(null); return; }
      setSortDir("desc");
      return;
    }
    if (sortDir === "asc") setSortDir("desc");
    else if (sortDir === "desc") { setSortKey(null); setSortDir(null); }
    else setSortDir("asc");
  };

  const sortValueFor = (row: TodoRow, key: string): string | number => {
    if (key === "aging") return daysSinceStatusChange(row.statusChangedAt, row.created);
    if (key === "created") {
      const t = Date.parse(row.created);
      return Number.isFinite(t) ? t : 0;
    }
    const getter = (columnValueGetters as Record<string, ((r: TodoRow) => string) | undefined>)[key];
    return String(getter ? getter(row) : "").toLowerCase();
  };

  const sortedRows = useMemo(() => {
    if (!sortKey || !sortDir) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const av = sortValueFor(a, sortKey);
      const bv = sortValueFor(b, sortKey);
      if (av === bv) return 0;
      const less = av < bv ? -1 : 1;
      return sortDir === "asc" ? less : -less;
    });
    return copy;
  }, [filteredRows, sortKey, sortDir]);

  const sortIndicator = (key: string) => {
    if (sortKey !== key || !sortDir) return null;
    return <span className="ml-1 text-xs text-blue-300 select-none">{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  const renderHeader = (
    key: string,
    label: string,
    opts: { filterKey?: ColumnFilterKey; align?: "left" | "center"; sortable?: boolean } = {},
  ) => {
    const align = opts.align ?? "left";
    const sortable = opts.sortable !== false;
    return (
      <th
        className={`px-2 py-1.5 ${align === "center" ? "text-center" : "text-left"} font-semibold text-blue-300${sortable ? " cursor-pointer select-none hover:text-blue-200" : ""}`}
        onClick={sortable ? () => handleSort(key) : undefined}
        title={sortable ? "Click to sort" : undefined}
      >
        <span className={`inline-flex items-center ${align === "center" ? "justify-center w-full" : ""}`}>
          {label}
          {sortIndicator(key)}
          {opts.filterKey && (
            <span onClick={(e) => e.stopPropagation()} className="inline-flex">
              <TicketColumnFilter
                options={columnOptions[opts.filterKey] || []}
                selected={columnFilters[opts.filterKey] || new Set()}
                onChange={(next) => updateColumnFilter(opts.filterKey!, next)}
                label={`Filter by ${label}`}
              />
            </span>
          )}
        </span>
      </th>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1900px] mx-auto w-full px-6 py-8">
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
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <select
              aria-label="Branch filter"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="glass-input w-auto min-w-[200px]"
            >
              <option value="">All Branches</option>
              {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
            </select>
            <span className="text-sm text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{sortedRows.length}</span> ticket{sortedRows.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div ref={tableScrollRef} className="overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full min-w-max text-xs leading-tight">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  {renderHeader("ticketNo", "Ticket No", { filterKey: "ticketNo" })}
                  {renderHeader("warranty", "Wty", { filterKey: "warranty" })}
                  {renderHeader("customer", "Cx Name", { filterKey: "customer" })}
                  {renderHeader("model", "Model", { filterKey: "model" })}
                  {renderHeader("customerPref", "Cx Prefer", { filterKey: "customerPref", align: "center" })}
                  {renderHeader("status", "Status", { filterKey: "status" })}
                  {renderHeader("aging", "Aging", { align: "center", filterKey: "aging" })}
                  {renderHeader("created", "Created")}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                ) : sortedRows.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No follow-up tickets found.</td></tr>
                ) : sortedRows.map((row) => {
                  const days = daysSinceStatusChange(row.statusChangedAt, row.created);
                  return (
                    <tr key={row.ticketNo} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className={`px-2 py-1.5 font-mono font-semibold ${statusColorClass(row.status)}`}>
                        <Link
                          to="/ticket/$ticketNo"
                          params={{ ticketNo: row.ticketNo }}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline hover:opacity-80 transition cursor-pointer"
                        >
                          {row.ticketNo}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-slate-300">{row.warranty}</td>
                      <td className="px-2 py-1.5 text-slate-300">{row.customer}</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-slate-300">{row.model}</td>
                      <td className="px-2 py-1.5 text-center text-slate-300">{row.customerPref || "—"}</td>
                      <td className={`px-2 py-1.5 font-semibold text-sm ${statusColorClass(row.status)}`}>{row.status}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`font-bold text-sm ${agingColor(days)}`}>{days}d</span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-300">{formatDate(row.created)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
        </div>
      </main>
    </div>
  );
}
