/**
 * CSR To Do List tab (CSRMainDashboard.tsx) — the four CSR work queues in
 * the same layout as Tickets → Ticket List (search/branch row, Total
 * Tickets + Show N, blue-header table with column filters + sort, pager).
 * A slim row of queue filters sits above the table:
 *
 *   Left Voicemail      (CSR-Left Message for Cx)  — every ticket in the status
 *   CS Need Scheduling  (CSR-Needs Scheduling)     — 0 days status spent / beyond 0
 *   CSR Acknowledge     (CSR-Acknowledged)         — 0 days aging / beyond 0
 *   OP Waiting          (OP-Waiting for Part)      — 3 or more status spent days
 *
 * Only tickets NO CSR has touched yet today (Central time): once a CSR
 * changes its status / technician / schedule, comments on it, or edits a
 * visit, it drops off until tomorrow — and comes back then if it's still in
 * one of these queues. A ticket a technician or the system moved into a
 * queue today hasn't been touched by CSR, so it still shows.
 *
 * No queue selected = every to-do ticket. "Aging" = calendar days since the
 * ticket was created; "status spent" = calendar days since its last status
 * change (status_changed_at is only stamped on a change, so a ticket still
 * in its first status falls back to created).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import type { Ticket } from "@/lib/ticketData";
import { getCompanyTickets, getTicketTouchersSince } from "@/lib/supabase/tickets";
import { getCompanyUsers } from "@/lib/supabase/users";
import { normalizeRole } from "@/lib/roleLabels";
import { LOCATIONS, normalizeLocationName } from "@/lib/locations";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

const OP_WAITING_MIN_DAYS = 3;
const CSR_ROLES = new Set(["CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"]);
const COMPANY_TZ = "America/Chicago";

/** Today's midnight in Central time, as a UTC ISO timestamp. */
function centralMidnightIso(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: COMPANY_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  // Central wall-clock time read as if it were UTC, minus the real instant = the zone offset.
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetMs).toISOString();
}
const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 125] as const;

type BucketKey = "voicemail" | "sched-0" | "sched-over" | "ack-0" | "ack-over" | "op-3plus";

interface BucketDef {
  key: BucketKey;
  /** Short label inside its queue group, e.g. "0 days". */
  label: string;
  title: string;
  test: (t: Ticket) => boolean;
  tone?: "ok" | "warn";
}

/** Whole calendar days from `raw` to today (local). Date-only values are read as that local date, not UTC midnight. */
function calendarDaysSince(raw: string | undefined): number {
  if (!raw) return 0;
  const text = String(raw).trim();
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  let then: Date;
  if (ymd) then = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  else if (mdy) then = new Date(Number(mdy[3]) < 100 ? Number(mdy[3]) + 2000 : Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  else then = new Date(text);
  if (Number.isNaN(then.getTime())) return 0;
  const today = new Date();
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
}

const agingDays = (t: Ticket) => calendarDaysSince(t.created);
const statusSpentDays = (t: Ticket) => calendarDaysSince(t.statusChangedAt || t.created);
const statusIs = (t: Ticket, status: string) => (t.status || "").trim().toLowerCase() === status.toLowerCase();

const QUEUES: { name: string; buckets: BucketDef[] }[] = [
  {
    name: "Left Voicemail",
    buckets: [{ key: "voicemail", label: "All", title: "Every ticket in CSR-Left Message for Cx", test: (t) => statusIs(t, "CSR-Left Message for Cx") }],
  },
  {
    name: "CS Need Scheduling",
    buckets: [
      { key: "sched-0", label: "0 days", title: "CSR-Needs Scheduling — 0 days status spent", tone: "ok", test: (t) => statusIs(t, "CSR-Needs Scheduling") && statusSpentDays(t) === 0 },
      { key: "sched-over", label: "Beyond 0", title: "CSR-Needs Scheduling — beyond 0 days status spent", tone: "warn", test: (t) => statusIs(t, "CSR-Needs Scheduling") && statusSpentDays(t) > 0 },
    ],
  },
  {
    name: "CSR Acknowledge",
    buckets: [
      { key: "ack-0", label: "0 days aging", title: "CSR-Acknowledged — 0 days aging", tone: "ok", test: (t) => statusIs(t, "CSR-Acknowledged") && agingDays(t) === 0 },
      { key: "ack-over", label: "Beyond 0", title: "CSR-Acknowledged — beyond 0 days aging", tone: "warn", test: (t) => statusIs(t, "CSR-Acknowledged") && agingDays(t) > 0 },
    ],
  },
  {
    name: "OP Waiting",
    buckets: [
      { key: "op-3plus", label: `${OP_WAITING_MIN_DAYS}+ days`, title: `OP-Waiting for Part — ${OP_WAITING_MIN_DAYS} or more status spent days`, tone: "warn", test: (t) => statusIs(t, "OP-Waiting for Part") && statusSpentDays(t) >= OP_WAITING_MIN_DAYS },
    ],
  },
];
const ALL_BUCKETS = QUEUES.flatMap((q) => q.buckets);

interface Row {
  ticket: Ticket;
  bucket: BucketKey;
  aging: number;
  spent: number;
}

function agingColor(days: number): string {
  return days <= 3 ? "text-green-400" : days <= 7 ? "text-yellow-400" : days <= 14 ? "text-orange-400" : "text-red-400";
}

// Same per-status colors as TicketList.tsx.
function statusColorClass(status: string): string {
  const map: Record<string, string> = {
    "op-waiting for part": "text-yellow-400",
    "csr-left message for cx": "text-emerald-300",
    "csr-acknowledged": "text-rose-300",
  };
  return map[(status || "").trim().toLowerCase()] ?? "text-blue-300";
}

const COLUMN_FILTER_KEYS = ["ticketNo", "warranty", "ticketSource", "customer", "city", "location", "product", "model", "technician", "schedule", "status", "aging", "spent"] as const;
type ColumnKey = (typeof COLUMN_FILTER_KEYS)[number];

const columnValue: Record<ColumnKey, (r: Row) => string> = {
  ticketNo: (r) => r.ticket.ticketNo,
  warranty: (r) => (r.ticket.warranty || "").toUpperCase(),
  ticketSource: (r) => r.ticket.ticketSource || r.ticket.manufacturer || "",
  customer: (r) => r.ticket.customer || "",
  city: (r) => r.ticket.city || "",
  location: (r) => r.ticket.location || "",
  product: (r) => r.ticket.productType || "",
  model: (r) => r.ticket.model || "",
  technician: (r) => r.ticket.technician || "",
  schedule: (r) => r.ticket.schedule || "",
  status: (r) => r.ticket.status || "",
  aging: (r) => String(r.aging),
  spent: (r) => String(r.spent),
};
const NUMERIC_SORT = new Set<ColumnKey>(["aging", "spent"]);

export function CSRToDoListContent() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [touchedToday, setTouchedToday] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [bucket, setBucket] = useState<BucketKey | null>(null);
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [currentPage, setCurrentPage] = useState(1);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getCompanyTickets(),
      // A failure here just means nothing gets hidden — better than an empty list.
      getTicketTouchersSince(centralMidnightIso()).catch((err) => {
        console.error("CSR To Do List: failed to load today's ticket activity:", err);
        return new Map<string, Set<string>>();
      }),
      getCompanyUsers().catch(() => []),
    ])
      .then(([rows, touchers, users]) => {
        if (cancelled) return;
        // Every CSR role counts, primary or extra.
        const csrIds = new Set(
          users.filter((u) => [u.role, ...(u.extra_roles ?? [])].some((r) => CSR_ROLES.has(normalizeRole(r)))).map((u) => u.id)
        );
        const touched = new Set<string>();
        for (const [ticketNo, actors] of touchers) {
          for (const a of actors) if (csrIds.has(a)) { touched.add(ticketNo); break; }
        }
        setTouchedToday(touched);
        setTickets(rows);
      })
      .catch((err) => {
        console.error("CSR To Do List: failed to load tickets:", err);
        if (!cancelled) setTickets([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Every to-do ticket, tagged with the one queue bucket it falls in (buckets don't overlap).
  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const t of tickets) {
      if (touchedToday.has(t.ticketNo)) continue;
      const b = ALL_BUCKETS.find((def) => def.test(t));
      if (b) out.push({ ticket: t, bucket: b.key, aging: agingDays(t), spent: statusSpentDays(t) });
    }
    return out;
  }, [tickets, touchedToday]);

  const doneToday = useMemo(
    () => tickets.filter((t) => touchedToday.has(t.ticketNo) && ALL_BUCKETS.some((def) => def.test(t))).length,
    [tickets, touchedToday]
  );

  // Search + branch narrow everything, including the queue counts.
  const scopedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (branch && (normalizeLocationName(r.ticket.location || "") || "Unassigned") !== branch) return false;
      if (!q) return true;
      const t = r.ticket;
      return [t.ticketNo, t.customer, t.phone, t.address, t.zip, t.city, t.model, t.technician].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [allRows, branch, search]);

  const counts = useMemo(() => {
    const c = {} as Record<BucketKey, number>;
    for (const b of ALL_BUCKETS) c[b.key] = 0;
    for (const r of scopedRows) c[r.bucket]++;
    return c;
  }, [scopedRows]);

  // ---- Column filters (same Excel-autofilter pattern as TicketList.tsx) ----
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, Set<string>>>(() => {
    const init = {} as Record<ColumnKey, Set<string>>;
    for (const k of COLUMN_FILTER_KEYS) init[k] = new Set<string>();
    return init;
  });

  const matches = (r: Row, skip?: ColumnKey) => {
    if (bucket && r.bucket !== bucket) return false;
    return COLUMN_FILTER_KEYS.every((k) => k === skip || columnFilters[k].size === 0 || columnFilters[k].has(columnValue[k](r)));
  };

  const filteredRows = useMemo(
    () => scopedRows.filter((r) => matches(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedRows, bucket, columnFilters]
  );

  const columnOptions = useMemo(() => {
    const out = {} as Record<ColumnKey, string[]>;
    for (const k of COLUMN_FILTER_KEYS) {
      const values = new Set<string>();
      for (const r of scopedRows) if (matches(r, k)) values.add(columnValue[k](r));
      out[k] = Array.from(values);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedRows, bucket, columnFilters]);

  // ---- Header-click sort (asc → desc → off); default: longest status spent first ----
  const [sortKey, setSortKey] = useState<ColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const handleSort = (key: ColumnKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") setSortDir("desc");
    else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows];
    if (!sortKey || !sortDir) return copy.sort((a, b) => b.spent - a.spent);
    const val = (r: Row) => (NUMERIC_SORT.has(sortKey) ? Number(columnValue[sortKey](r)) : columnValue[sortKey](r).toLowerCase());
    copy.sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av === bv) return 0;
      const less = av < bv ? -1 : 1;
      return sortDir === "asc" ? less : -less;
    });
    return copy;
  }, [filteredRows, sortKey, sortDir]);

  useEffect(() => setCurrentPage(1), [bucket, branch, search, columnFilters, pageSize]);
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = pageSize === "all" ? sortedRows : sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const renderHeader = (key: ColumnKey, label: string, align: "left" | "center" = "left") => (
    <th
      className={`px-2 py-1.5 ${align === "center" ? "text-center" : "text-left"} font-semibold text-blue-300 cursor-pointer select-none hover:text-blue-200`}
      onClick={() => handleSort(key)}
      title="Click to sort"
    >
      <span className={`inline-flex items-center ${align === "center" ? "justify-center w-full" : ""}`}>
        {label}
        {sortKey === key && sortDir && <span className="ml-1 text-xs text-blue-300 select-none">{sortDir === "asc" ? "▲" : "▼"}</span>}
        <span onClick={(e) => e.stopPropagation()} className="inline-flex">
          <TicketColumnFilter
            options={columnOptions[key] || []}
            selected={columnFilters[key]}
            onChange={(next) => setColumnFilters((prev) => ({ ...prev, [key]: next }))}
            label={`Filter by ${label}`}
          />
        </span>
      </span>
    </th>
  );

  const pill = (active: boolean) =>
    `px-2 py-1 rounded border transition-colors inline-flex items-center gap-1.5 ${
      active ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground"
    }`;

  return (
    <div className="panel">
      <div className="mb-6 space-y-3">
        <div className="grid gap-3 lg:grid-cols-3">
          <input
            type="text"
            placeholder="ticket, zip code, address, name, etc"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input w-full"
            aria-label="Search tickets"
          />
          <select aria-label="Branch filter" value={branch} onChange={(e) => setBranch(e.target.value)} className="glass-input w-full">
            <option value="">All Branches</option>
            {LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>

        {/* Queue filters — click one to show only those tickets, click again for all. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {QUEUES.map((q) => (
            <div key={q.name} className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-foreground">{q.name}</span>
              {q.buckets.map((b) => {
                const n = counts[b.key] ?? 0;
                const active = bucket === b.key;
                const numColor = active ? "" : n === 0 ? "text-muted-foreground" : b.tone === "warn" ? "text-amber-400" : b.tone === "ok" ? "text-emerald-400" : "text-foreground";
                return (
                  <button key={b.key} type="button" title={b.title} onClick={() => setBucket(active ? null : b.key)} className={pill(active)}>
                    {q.buckets.length > 1 || b.label !== "All" ? <span>{b.label}</span> : null}
                    <span className={`font-semibold tabular-nums ${numColor}`}>{loading ? "—" : n}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Total + page size (same as Ticket List) */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2 text-sm">
        <span className="text-muted-foreground">
          Total Tickets: <span className="font-semibold text-foreground">{sortedRows.length}</span>
          {doneToday > 0 && (
            <span className="ml-3 text-xs" title="Tickets in these queues a CSR already worked on today — they come back tomorrow if still open">
              · <span className="text-emerald-400 font-semibold">{doneToday}</span> already touched today
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <button type="button" onClick={() => setReloadKey((n) => n + 1)} className={pill(false)} title="Reload tickets">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <span>Show:</span>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <button key={size} type="button" onClick={() => setPageSize(size)} className={pill(pageSize === size)}>
              {size}
            </button>
          ))}
          <button type="button" onClick={() => setPageSize("all")} className={pill(pageSize === "all")}>
            All
          </button>
        </div>
      </div>

      <div ref={tableScrollRef} className="overflow-x-auto border border-white/10 rounded-lg">
        <table className="w-full min-w-max text-xs leading-tight">
          <thead>
            <tr className="bg-blue-900/50 border-b border-blue-500/30">
              {renderHeader("ticketNo", "Ticket No")}
              {renderHeader("warranty", "Wty")}
              {renderHeader("ticketSource", "Ticket Source")}
              {renderHeader("customer", "Cx Name")}
              {renderHeader("city", "City")}
              {renderHeader("location", "Loc")}
              {renderHeader("product", "Product")}
              {renderHeader("model", "Model")}
              {renderHeader("technician", "Technician")}
              {renderHeader("schedule", "Schedule")}
              {renderHeader("status", "Status")}
              {renderHeader("aging", "Aging", "center")}
              {renderHeader("spent", "Status Spend", "center")}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={13} className="text-center py-8 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-center py-8 text-muted-foreground">
                  No tickets found.
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr key={r.ticket.ticketNo} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className={`px-2 py-1.5 font-mono font-semibold ${statusColorClass(r.ticket.status)}`}>
                    <Link
                      to="/ticket/$ticketNo"
                      params={{ ticketNo: r.ticket.ticketNo }}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline hover:opacity-80 transition cursor-pointer"
                    >
                      {r.ticket.ticketNo}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-slate-300">{columnValue.warranty(r)}</td>
                  <td className="px-2 py-1.5 text-slate-300 max-w-[130px] truncate" title={columnValue.ticketSource(r)}>{columnValue.ticketSource(r)}</td>
                  <td className="px-2 py-1.5 text-slate-300 max-w-[180px] truncate" title={r.ticket.customer}>{r.ticket.customer}</td>
                  <td className="px-2 py-1.5 text-slate-300 max-w-[130px] truncate" title={r.ticket.city}>{r.ticket.city}</td>
                  <td className="px-2 py-1.5 text-slate-300">{r.ticket.location}</td>
                  <td className="px-2 py-1.5 text-slate-300 max-w-[140px] truncate" title={r.ticket.productType || ""}>{r.ticket.productType || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-slate-300">{r.ticket.model}</td>
                  <td className="px-2 py-1.5 text-slate-300 max-w-[150px] truncate" title={r.ticket.technician || ""}>{r.ticket.technician || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-300">{r.ticket.schedule}</td>
                  <td className={`px-2 py-1.5 font-semibold text-sm whitespace-nowrap ${statusColorClass(r.ticket.status)}`}>{r.ticket.status}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`font-bold text-sm ${agingColor(r.aging)}`}>{r.aging}d</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`font-bold text-sm ${agingColor(r.spent)}`}>{r.spent}d</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="text-xs">
          {pageSize === "all" || sortedRows.length === 0
            ? `Showing all ${sortedRows.length} tickets`
            : `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sortedRows.length)} of ${sortedRows.length} tickets`}
        </span>
        {pageSize !== "all" && totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="btn hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-xs">
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="btn hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
