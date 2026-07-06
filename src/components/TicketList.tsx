import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { lookupZip } from "@/lib/zipCoverage";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Clock, History, X, User, Columns3, Map as MapIcon } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, mergeLocationOptions } from "@/lib/locations";
import { 
  TICKET_SOURCES, 
  REPAIR_STATUS_OPTIONS, 
  type Ticket 
} from "@/lib/ticketData";
import {
  getCompanyTickets,
  backfillTicketLocations,
  getPartOrderStateByTicketIds,
} from "@/lib/supabase/tickets";
import { syncApprovedPortalRequests } from "@/lib/supabase/portalRequests";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

// Use the centralized Ticket interface
interface TicketItem extends Ticket {}

// All toggleable columns in the ticket list table. `key` is used for the
// visibility map + localStorage; `label` is the header text.
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

const COLUMN_VISIBILITY_KEY = "ahs:ticket-list:visible-columns";

function loadVisibleColumns(): Record<string, boolean> {
  const allVisible = Object.fromEntries(TICKET_COLUMNS.map((c) => [c.key, true]));
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY);
    if (!raw) return allVisible;
    const saved = JSON.parse(raw) as Record<string, boolean>;
    // Merge so newly added columns default to visible.
    return { ...allVisible, ...saved };
  } catch {
    return allVisible;
  }
}

// Use centralized TICKET_SOURCES and REPAIR_STATUS_OPTIONS from ticketData.ts
const LOCATION_STORAGE_KEY = "ahs:location-management:locations";
const STATUS_LOG_KEY = "ahs:ticket:status-log";
const TICKET_VISITS_KEY = "ahs:ticket:visits"; // Track who visited which tickets

// Compact acronym for the Wty column (mirrors ticket detail header ribbon).
//   In warranty -> IW, Out-of-warranty -> OOW, Service Contract -> SC, etc.
// If the value already looks like a short acronym (<= 4 upper-case chars) we
// pass it through unchanged.
function warrantyAcronym(value: string | null | undefined): string {
  const v = (value || "").trim();
  if (!v) return "";
  if (v.length <= 4 && v === v.toUpperCase()) return v;
  const lower = v.toLowerCase();
  if (lower === "in warranty") return "IW";
  if (lower.includes("out of warranty") || lower.includes("out-of-warranty")) return "OOW";
  if (lower === "concession l") return "CL";
  if (lower === "concession lp") return "CLP";
  if (lower === "concession p") return "CP";
  if (lower.includes("ext labor")) return "ELW";
  if (lower.includes("ext part")) return "EPW";
  if (lower.includes("ext wty")) return "EW";
  if (lower.includes("labor only")) return "LOW";
  if (lower.includes("part only")) return "POW";
  if (lower.includes("special part")) return "SP5";
  if (lower.includes("service contract")) return "SC";
  if (lower === "unknown") return "UNK";
  return v.toUpperCase();
}

// Per-status color for the Status cell in the ticket list. Falls back to the
// default blue for any status not listed here. Matching is case-insensitive
// and trims whitespace so minor formatting differences still color correctly.
function statusColorClass(status: string): string {
  const key = (status || "").trim().toLowerCase();
  const map: Record<string, string> = {
    // Reds / orange-red
    "pt-need preauthorization": "text-orange-600",
    "cl-ready to complete": "text-red-500",
    // Blue
    "op-ready for service": "text-blue-400",
    // Mint / green
    "csr-left message for cx": "text-emerald-300",
    // Yellow
    "op-waiting for part": "text-yellow-400",
    // Black (near-white on dark UI for legibility, semi-muted)
    "csr-assigned to asc": "text-slate-200",
    "cl-parts back ordered": "text-slate-200",
    // Grey
    "tr-need triage": "text-slate-400",
    // Peach
    "cl-need cancel": "text-orange-200",
    // Pink
    "op-reschedule follow up": "text-pink-300",
    // Coral
    "csr-acknowledged": "text-rose-300",
  };
  return map[key] ?? "text-blue-300";
}

interface StatusLogEntry {
  ticketNo: string;
  fromStatus: string;
  toStatus: string;
  changedBy: string;
  changedAt: string; // ISO string
  note?: string;
}

// Bucket a raw repair status into one of the high-level groups shown in the
// Tech Daily Report legend. Completed and Claimed are treated as one bucket
// because a Claimed ticket is functionally a completed/closed job for the
// reporting we care about here.
type StatusGroup = "open" | "completed" | "cancelled";

function statusGroupOf(status: string): StatusGroup | "other" {
  const v = String(status || "").trim().toLowerCase();
  if (!v) return "other";
  // "Need Cancel" is still an OPEN/Pending work item — CSR is asking the
  // warranty company to cancel; the ticket isn't actually cancelled yet.
  // Treat it as Open BEFORE the cancelled bucket so it doesn't get caught
  // by the broader "cancel" match.
  if (v.includes("need cancel")) return "open";
  // Cancelled (the actual terminal state).
  if (v === "cl-cancelled" || v === "cancelled" || /\bcancell?ed\b/.test(v)) return "cancelled";
  // Completed / Claimed bucket — CL-Completed, CL-Claimed, CL-Data-Closed all
  // count as a finished job.
  if (
    v === "cl-completed" ||
    v === "completed" ||
    v === "cl-claimed" ||
    v === "claimed" ||
    v.includes("data closed") ||
    v.includes("data-closed")
  ) return "completed";
  // Everything else that flows through CSR / OP / PT / TR / CL-* (Ready, Need PO,
  // Need Cancel, Parts Back Ordered, etc.) is still in-progress = Pending/Open.
  if (
    v.startsWith("csr-") ||
    v.startsWith("op-") ||
    v.startsWith("pt-") ||
    v.startsWith("tr-") ||
    v.startsWith("cl-")
  ) return "open";
  return "other";
}

interface TicketVisit {
  ticketNo: string;
  visitedBy: string;
  visitedAt: string; // ISO string
}

// Best-effort product/appliance label for a ticket. Uses an explicit
// productType when present, otherwise infers a common appliance from the
// model string (e.g. "dryer", "washer", "refrigerator").
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
  for (const [re, label] of guesses) {
    if (re.test(model)) return label;
  }
  return "—";
}

function loadStatusLog(): StatusLogEntry[] {
  try { return JSON.parse(localStorage.getItem(STATUS_LOG_KEY) || "[]"); }
  catch { return []; }
}

function saveStatusLog(log: StatusLogEntry[]) {
  try { localStorage.setItem(STATUS_LOG_KEY, JSON.stringify(log)); } catch {}
}

function loadTicketVisits(): TicketVisit[] {
  try { return JSON.parse(localStorage.getItem(TICKET_VISITS_KEY) || "[]"); }
  catch { return []; }
}

function saveTicketVisits(visits: TicketVisit[]) {
  try { localStorage.setItem(TICKET_VISITS_KEY, JSON.stringify(visits)); } catch {}
}

function markTicketAsVisited(ticketNo: string, userName: string): void {
  const visits = loadTicketVisits();
  // Check if this user already visited this ticket
  const existingVisit = visits.find(v => v.ticketNo === ticketNo && v.visitedBy === userName);
  if (!existingVisit) {
    visits.push({ ticketNo, visitedBy: userName, visitedAt: new Date().toISOString() });
    saveTicketVisits(visits);
  }
}

function getTicketVisitors(ticketNo: string): string[] {
  const visits = loadTicketVisits();
  return [...new Set(visits.filter(v => v.ticketNo === ticketNo).map(v => v.visitedBy))];
}

function daysAgo(isoString: string): number {
  const d = new Date(isoString);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// Days since a ticket was created (total time the ticket has been open).
// Accepts ISO, MM/DD/YY and MM/DD/YYYY formats.
function daysSinceCreated(created: string | undefined): number {
  if (!created) return 0;
  const raw = String(created).trim();
  let createdDate: Date | null = null;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
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
  const ms = Date.now() - createdDate.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function loadSavedLocations(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { rows?: Array<{ location?: string }> };
    return Array.isArray(parsed.rows)
      ? parsed.rows.map((row) => row.location?.trim()).filter((value): value is string => Boolean(value))
      : [];
  } catch {
    return [];
  }
}

function parseTicketDate(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  // ISO already: YYYY-MM-DD (or longer ISO that starts with it). Supabase
  // stores schedule_date as ISO so this is the common case for synced tickets.
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Two-digit-year US format: MM/DD/YY
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) return `20${m[3]}-${m[1]}-${m[2]}`;
  // Four-digit-year US format: MM/DD/YYYY
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return "";
}

function isWithinDateRange(value: string, startDate: string, endDate: string) {
  const normalized = parseTicketDate(value);
  if (!normalized) return false;
  if (startDate && normalized < startDate) return false;
  if (endDate && normalized > endDate) return false;
  return true;
}

export function TicketList({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  // Load tickets from Supabase (company-scoped via RLS).
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  // Overlay each ticket's derived "Part Order" state (from visits +
  // parts tables) onto the row. Runs in a single bulk pass so the
  // Ticket List column can show "Not Diagnosed / Part Not Needed /
  // Part Ordered / Partially Ordered" without extra round-trips per
  // ticket. Errors are logged and swallowed — the column just falls
  // back to whatever was stored on tickets.part_order.
  const overlayPartOrderState = async (rows: TicketItem[]): Promise<TicketItem[]> => {
    try {
      const ids = rows
        .map((t: any) => String(t?._id ?? "").trim())
        .filter(Boolean);
      if (ids.length === 0) return rows;
      const stateMap = await getPartOrderStateByTicketIds(ids);
      for (const t of rows as any[]) {
        const tid = String(t?._id ?? "").trim();
        const derived = tid ? stateMap.get(tid) : undefined;
        if (derived) t.partOrder = derived;
      }
    } catch (err) {
      console.warn("Ticket List: part-order overlay skipped:", err);
    }
    return rows;
  };

  const reloadTickets = useCallback(async () => {
    try {
      setTicketsLoading(true);
      const rows = await getCompanyTickets();
      const enriched = await overlayPartOrderState(rows as TicketItem[]);
      setTickets(enriched);
    } catch (err) {
      console.error("Failed to load tickets:", err);
      setTickets([]);
    } finally {
      setTicketsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setTicketsLoading(true);
        // First, pull any approved customer-portal requests into our tickets so
        // they appear in the list (best-effort; never blocks the load).
        try {
          const result = await syncApprovedPortalRequests();
          if (result.pulled > 0) {
            console.log(`📥 Pulled ${result.pulled} approved portal request(s) into tickets.`);
          }
        } catch (e) {
          console.warn("Portal request sync skipped:", e);
        }
        const rows = await getCompanyTickets();
        const enriched = await overlayPartOrderState(rows as TicketItem[]);
        if (!cancelled) setTickets(enriched);
      } catch (err) {
        console.error("Failed to load tickets:", err);
        if (!cancelled) setTickets([]);
      } finally {
        if (!cancelled) setTicketsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time per-session backfill: re-resolve ticket.location for any row
  // that's blank or stuck on a bad SP service-location code (IH/OS/DO/…).
  // Uses the linked customer's zip → city → state with the SAME resolver the
  // sync uses, but without an SP round-trip — so this fixes legacy rows even
  // when they're outside the current branch scope. Throttled to once per
  // session per browser so reloads don't keep re-scanning.
  useEffect(() => {
    const KEY = "ahs:tickets:location-backfill:done";
    try { if (sessionStorage.getItem(KEY)) return; } catch { return; }
    (async () => {
      try {
        const res = await backfillTicketLocations();
        try { sessionStorage.setItem(KEY, new Date().toISOString()); } catch {}
        if (res.updated > 0) {
          console.log(`[location backfill] scanned ${res.scanned}, fixed ${res.updated}`);
          reloadTickets();
        }
      } catch (err) {
        console.warn("[location backfill] skipped:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ServicePower auto-sync for San Antonio + Asheville (and their covered
  // zips). Scoped to "this month → today" with "skip existing" so it only
  // inserts brand-new calls. Existing tickets keep whatever CSR / employee
  // edits they have.
  //
  // Triggers:
  //   1. On mount (page load / route enter), if the throttle window has
  //      elapsed.
  //   2. Every 5 minutes after that via a background interval so a long-
  //      lived tab still pulls in newly created SP tickets without needing
  //      a manual reload.
  //
  // Throttle is per-browser via localStorage to avoid two tabs racing each
  // other; concurrent sync from two windows in the same browser is harmless
  // (DB unique index dedupes), but the throttle keeps the noise down.
  const SYNC_KEY = "ahs:sp-auto-sync:last-run";
  const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Run the ServicePower → Supabase incremental sync.
   *
   * - In background ({force: false}) the throttle prevents two consecutive
   *   syncs within SYNC_INTERVAL_MS.
   * - In manual ({force: true}) the throttle is bypassed AND the skip set
   *   is dropped, so every existing ticket within the date window gets a
   *   fresh pull from SP. Use this when re-syncing schedule_date / period
   *   onto rows that were inserted before those fields were wired up.
   */
  const runSpSync = useCallback(async (opts: { force?: boolean } = {}) => {
    const { force = false } = opts;
    if (!force) {
      const lastRun = (() => {
        try {
          const v = localStorage.getItem(SYNC_KEY);
          return v ? new Date(v).getTime() : 0;
        } catch { return 0; }
      })();
      if (Date.now() - lastRun < SYNC_INTERVAL_MS) return null;
    }

    try {
      const { syncServicePowerToSupabase } = await import("@/lib/servicePowerSync");
      // Tickets are matched by callNo / ticket_no.
      //
      // IMPORTANT: only skip tickets that already have a valid resolved
      // branch in Loc. Rows where location is blank or one of the SP
      // service-location codes ("IH","OS","DO"…) must go through the
      // re-resolver so the new lookupZip / city-override fixes can write
      // the proper branch ("Asheville", "Brunswick", etc.) back to the DB.
      const BAD_LOCATIONS = new Set([
        "", "ih","os","do","on","dc","dr","is","od",
        "in home","on site","drop off","drop-off","in-home","unknown",
      ]);
      const hasValidBranch = (loc: string) =>
        !BAD_LOCATIONS.has(String(loc || "").trim().toLowerCase());

      // Background mode: skip tickets that already have BOTH a Schedule
      // Date and a Schedule Period stored locally. Tickets missing either
      // field get re-fetched from SP so the values self-heal across syncs.
      //
      // Manual mode (force=true): clear the skip set entirely so every
      // ticket in the window gets a fresh pull from SP. This is what the
      // "Sync now" button uses — it's the only way to back-fill values
      // like ticket_source / schedule_date / time_slot onto rows that
      // were already imported before those fields were wired up.
      const hasFullSchedule = (t: any) =>
        Boolean(String(t?.schedule ?? "").trim()) &&
        Boolean(String(t?.schedulePeriod ?? "").trim());

      let existing = new Set<string>();
      if (!force) {
        existing = new Set<string>(
          (tickets ?? [])
            .filter((t) => hasValidBranch((t as any).location))
            .filter((t) => hasFullSchedule(t))
            .map((t) => String((t as any).ticketNo ?? "").trim())
            .filter(Boolean),
        );
        if (existing.size === 0) {
          try {
            const rows = await getCompanyTickets();
            for (const r of rows ?? []) {
              if (!hasValidBranch((r as any).location)) continue;
              if (!hasFullSchedule(r as any)) continue;
              const n = String((r as any).ticketNo ?? "").trim();
              if (n) existing.add(n);
            }
          } catch { /* ignore — sync still safe without skip set */ }
        }
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const startISO = monthStart.toISOString().slice(0, 10);
      const result = await syncServicePowerToSupabase(undefined as any, {
        startDate: startISO,
        locationFilters: ["San Antonio", "Asheville"],
        coveredOnly: true,
        skipTicketNos: existing,
      });
      try { localStorage.setItem(SYNC_KEY, new Date().toISOString()); } catch {}
      if (result.added > 0 || result.updated > 0) {
        console.log(
          `[SP ${force ? "manual" : "auto"}-sync] +${result.added} added, ${result.updated} updated since ${startISO}`,
        );
        reloadTickets();
      } else {
        console.log(`[SP ${force ? "manual" : "auto"}-sync] no changes since ${startISO}`);
      }
      return result;
    } catch (err) {
      console.warn("[SP sync] skipped:", err);
      return { added: 0, updated: 0, skipped: 0, total: 0, success: false, errors: [String((err as any)?.message ?? err)] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, reloadTickets]);

  // Auto-sync schedule: initial run + 5-minute interval.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void runSpSync({ force: false });
    };
    tick();
    const intervalId = window.setInterval(tick, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [runSpSync]);



  const SAMPLE_TICKETS: TicketItem[] = tickets;
  const { email, allowedLocations } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [repairStatusFilter, setRepairStatusFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [ticketSourceFilter, setTicketSourceFilter] = useState("");
  const [statusGroupFilter, setStatusGroupFilter] = useState<"" | "open" | "completed" | "cancelled">("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [statusLog, setStatusLog] = useState<StatusLogEntry[]>([]);
  // Ref to the table's horizontal-scroll container so a floating scrollbar
  // pinned to the bottom of the viewport can mirror its scroll position.
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  // Column visibility (persisted). `visibleColumns[key] === false` hides a column.
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    typeof window !== "undefined"
      ? loadVisibleColumns()
      : Object.fromEntries(TICKET_COLUMNS.map((c) => [c.key, true]))
  );
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const isColVisible = (key: TicketColumnKey) => visibleColumns[key] !== false;
  const toggleColumn = (key: TicketColumnKey) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: prev[key] === false };
      try { localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const showAllColumns = () => {
    const all = Object.fromEntries(TICKET_COLUMNS.map((c) => [c.key, true]));
    setVisibleColumns(all);
    try { localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  };
  const [agingModal, setAgingModal] = useState<{ ticketNo: string; status: string } | null>(null);
  const [changeNoteInput, setChangeNoteInput] = useState("");
  const [changeByInput, setChangeByInput] = useState("");
  const [visitedTickets, setVisitedTickets] = useState<Set<string>>(new Set());


  useEffect(() => { setStatusLog(loadStatusLog()); }, []);
  useEffect(() => { 
    // Load visited tickets from localStorage whenever component mounts
    const visits = loadTicketVisits();
    const visited = new Set(visits.map(v => v.ticketNo));
    setVisitedTickets(visited);
    
    // Also listen for storage changes from other tabs/windows
    const handleStorageChange = () => {
      const updatedVisits = loadTicketVisits();
      const updatedVisited = new Set(updatedVisits.map(v => v.ticketNo));
      setVisitedTickets(updatedVisited);
    };
    
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const logStatusChange = useCallback((ticketNo: string, fromStatus: string, toStatus: string) => {
    const entry: StatusLogEntry = {
      ticketNo,
      fromStatus,
      toStatus,
      changedBy: changeByInput.trim() || "System",
      changedAt: new Date().toISOString(),
      note: changeNoteInput.trim() || undefined,
    };
    const updated = [entry, ...statusLog];
    setStatusLog(updated);
    saveStatusLog(updated);
    setChangeNoteInput("");
  }, [statusLog, changeByInput, changeNoteInput]);

  const ticketAgingDays = useCallback((ticket: { ticketNo: string; aging: number; statusChangedAt?: string }) => {
    // Find most recent status change for this ticket
    const lastChange = statusLog
      .filter(l => l.ticketNo === ticket.ticketNo)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
    if (lastChange) return daysAgo(lastChange.changedAt);
    // If statusChangedAt recorded on the ticket itself
    if (ticket.statusChangedAt) return daysAgo(ticket.statusChangedAt);
    // Fallback to seed data aging
    return ticket.aging;
  }, [statusLog]);

  const ticketStatusLog = useCallback((ticketNo: string) => {
    return statusLog.filter(l => l.ticketNo === ticketNo).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  }, [statusLog]);

  const locationOptions = useMemo(
    () => mergeLocationOptions(LOCATIONS, loadSavedLocations(), SAMPLE_TICKETS.map((ticket) => ticket.location)),
    [tickets],
  );
  const ticketSourceOptions = useMemo(
    () => Array.from(new Set(SAMPLE_TICKETS.map((ticket) => ticket.ticketSource || "").filter(Boolean)))
      .sort((a, b) => a.localeCompare(b)),
    [tickets],
  );

  // ---- Per-column filters --------------------------------------------------
  // Each column the user can filter has an entry here. Empty set = show all.
  // Adding a new column? Add its key to COLUMN_FILTER_KEYS and a getter to
  // columnValueGetters below.
  const COLUMN_FILTER_KEYS = [
    "ticketNo","warranty","ticketSource","customer","city","location",
    "product","model","internalNote","repair","technician","customerPref",
    "schedule","status","phone","redo","partOrder","posting",
  ] as const;
  type ColumnFilterKey = (typeof COLUMN_FILTER_KEYS)[number];

  const [columnFilters, setColumnFilters] = useState<Record<ColumnFilterKey, Set<string>>>(() => {
    const init = {} as Record<ColumnFilterKey, Set<string>>;
    for (const k of COLUMN_FILTER_KEYS) init[k] = new Set<string>();
    return init;
  });

  const updateColumnFilter = (key: ColumnFilterKey, next: Set<string>) => {
    setColumnFilters((prev) => ({ ...prev, [key]: next }));
  };

  // How to read each filterable column off a TicketItem. Anything returning
  // an empty string is treated as a "(blank)" bucket.
  const columnValueGetters: Record<ColumnFilterKey, (t: TicketItem) => string> = {
    ticketNo: (t) => t.ticketNo || "",
    warranty: (t) => warrantyAcronym(t.warranty) || "",
    ticketSource: (t) => t.ticketSource || (t as any).manufacturer || "",
    customer: (t) => t.customer || "",
    city: (t) => t.city || "",
    location: (t) => t.location || "",
    product: (t) => productLabel(t) || "",
    model: (t) => t.model || "",
    internalNote: (t) => t.internalNote || "",
    repair: (t) => t.diagnosed || "",
    technician: (t) => t.technician || "",
    customerPref: (t) => t.customerPref || "",
    schedule: (t) => t.schedule || "",
    status: (t) => t.status || "",
    phone: (t) => t.phone || "",
    redo: (t) => t.redo || "",
    partOrder: (t) => t.partOrder || "",
    posting: (t) => t.created || "",
  };

  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
    const repairNeedle = norm(repairStatusFilter);
    const locationNeedle = norm(locationFilter);
    const sourceNeedle = norm(ticketSourceFilter);
    return SAMPLE_TICKETS.filter((ticket) => {
      // Work-plan location restriction: if allowedLocations is set (non-null),
      // only show tickets whose location is in the allowed set.
      const matchesAccess = allowedLocations === null || allowedLocations.includes(ticket.location);
      const matchesSearch = !query || [ticket.ticketNo, ticket.customer, ticket.city, ticket.phone, ticket.model, ticket.location, ticket.status, ticket.ticketSource || ""].some((value) => value.toLowerCase().includes(query));
      const matchesRepairStatus = !repairNeedle || norm(ticket.status) === repairNeedle;
      const matchesDate = (!startDateFilter && !endDateFilter) || isWithinDateRange(ticket.schedule, startDateFilter, endDateFilter);
      const matchesLocation = !locationNeedle || norm(ticket.location) === locationNeedle;
      const matchesSource = !sourceNeedle || norm(ticket.ticketSource) === sourceNeedle;
      // High-level status bucket (Open/Completed/Claimed/Cancelled).
      const matchesStatusGroup = !statusGroupFilter || statusGroupOf(ticket.status) === statusGroupFilter;
      // Per-column filters
      const matchesColumns = COLUMN_FILTER_KEYS.every((key) => {
        const selected = columnFilters[key];
        if (!selected || selected.size === 0) return true;
        return selected.has(columnValueGetters[key](ticket));
      });
      return matchesAccess && matchesSearch && matchesRepairStatus && matchesDate && matchesLocation && matchesSource && matchesStatusGroup && matchesColumns;
    });
  }, [endDateFilter, locationFilter, repairStatusFilter, searchQuery, startDateFilter, ticketSourceFilter, statusGroupFilter, tickets, allowedLocations, columnFilters]);

  // Build option lists per column from the data set **before** that column's own
  // filter is applied — so opening Loc still shows every Loc value present in
  // tickets that pass every OTHER filter. This mirrors Excel's autofilter UX.
  const buildOptionsExcluding = (excludeKey: ColumnFilterKey): string[] => {
    const query = searchQuery.toLowerCase();
    const values = new Set<string>();
    for (const ticket of SAMPLE_TICKETS) {
      const matchesAccess = allowedLocations === null || allowedLocations.includes(ticket.location);
      const matchesSearch = !query || [ticket.ticketNo, ticket.customer, ticket.city, ticket.phone, ticket.model, ticket.location, ticket.status, ticket.ticketSource || ""].some((v) => v.toLowerCase().includes(query));
      const matchesRepairStatus = !repairStatusFilter || ticket.status === repairStatusFilter;
      const matchesDate = (!startDateFilter && !endDateFilter) || isWithinDateRange(ticket.schedule, startDateFilter, endDateFilter);
      const matchesLocation = !locationFilter || ticket.location === locationFilter;
      const matchesSource = !ticketSourceFilter || (ticket.ticketSource || "") === ticketSourceFilter;
      const matchesOtherCols = COLUMN_FILTER_KEYS.every((key) => {
        if (key === excludeKey) return true;
        const sel = columnFilters[key];
        if (!sel || sel.size === 0) return true;
        return sel.has(columnValueGetters[key](ticket));
      });
      if (matchesAccess && matchesSearch && matchesRepairStatus && matchesDate && matchesLocation && matchesSource && matchesOtherCols) {
        values.add(columnValueGetters[excludeKey](ticket));
      }
    }
    return Array.from(values);
  };

  const columnOptions = useMemo(() => {
    const out = {} as Record<ColumnFilterKey, string[]>;
    for (const key of COLUMN_FILTER_KEYS) out[key] = buildOptionsExcluding(key);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, columnFilters, allowedLocations, searchQuery, repairStatusFilter, startDateFilter, endDateFilter, locationFilter, ticketSourceFilter]);

  const renderColFilter = (key: ColumnFilterKey, label: string) => (
    <TicketColumnFilter
      options={columnOptions[key] || []}
      selected={columnFilters[key] || new Set()}
      onChange={(next) => updateColumnFilter(key, next)}
      label={`Filter by ${label}`}
    />
  );

  // ---- Column sorting -------------------------------------------------------
  // Click a header to sort by that column. Text/number columns cycle through
  // asc → desc → none. Date columns are single-state: clicking once sorts by
  // newest-first; clicking again clears the sort.
  type SortDir = "asc" | "desc" | null;
  const DATE_SORT_KEYS = new Set<string>(["schedule", "posting", "callReceivedDate"]);
  const NUMERIC_SORT_KEYS = new Set<string>(["aging", "statusSpend", "calls"]);
  const SORTABLE_KEYS = new Set<string>([
    "ticketNo","warranty","ticketSource","customer","city","location",
    "product","model","internalNote","repair","technician","customerPref",
    "schedule","status","phone","redo","aging","statusSpend","calls",
    "partOrder","posting",
  ]);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleHeaderSort = (key: string) => {
    if (!SORTABLE_KEYS.has(key)) return;
    const isDateCol = DATE_SORT_KEYS.has(key);
    if (sortKey !== key) {
      // First click on a fresh column. Dates go straight to newest-first.
      setSortKey(key);
      setSortDir(isDateCol ? "desc" : "asc");
      return;
    }
    if (isDateCol) {
      // Date columns toggle between desc and off.
      if (sortDir === "desc") { setSortKey(null); setSortDir(null); return; }
      setSortDir("desc");
      return;
    }
    // Text/number cycle: asc → desc → off.
    if (sortDir === "asc") setSortDir("desc");
    else if (sortDir === "desc") { setSortKey(null); setSortDir(null); }
    else setSortDir("asc");
  };

  const sortIndicator = (key: string) => {
    if (sortKey !== key || !sortDir) return null;
    return (
      <span className="ml-1 text-xs text-blue-300 select-none">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  // Sort getters: numeric/date columns return a Number so JS comparison sorts
  // correctly. Everything else returns a lowercased string for case-insensitive
  // alphabetical sort.
  const sortValueFor = (ticket: TicketItem, key: string): string | number => {
    if (NUMERIC_SORT_KEYS.has(key)) {
      const v = (ticket as any)[key];
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (DATE_SORT_KEYS.has(key)) {
      const raw = key === "posting"
        ? String(ticket.created || "")
        : String((ticket as any)[key] || "");
      const iso = parseTicketDate(raw);
      if (!iso) return 0;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? t : 0;
    }
    const getter = (columnValueGetters as any)[key];
    const raw = getter ? getter(ticket) : (ticket as any)[key];
    return String(raw ?? "").toLowerCase();
  };

  const sortedItems = useMemo(() => {
    if (!sortKey || !sortDir) return filteredItems;
    const rows = [...filteredItems];
    rows.sort((a, b) => {
      const av = sortValueFor(a, sortKey);
      const bv = sortValueFor(b, sortKey);
      if (av === bv) return 0;
      const less = av < bv ? -1 : 1;
      return sortDir === "asc" ? less : -less;
    });
    return rows;
  }, [filteredItems, sortKey, sortDir]);

  // Header builder: wraps the header label + filter funnel in a clickable
  // span. Clicking the label triggers the sort; the filter button stops
  // propagation so it never doubles as a sort click.
  const renderHeader = (
    key: string,
    label: string,
    options?: { filterKey?: ColumnFilterKey; align?: "left" | "center"; title?: string },
  ) => {
    const align = options?.align ?? "left";
    const sortable = SORTABLE_KEYS.has(key);
    const filterKey = options?.filterKey;
    const baseClass = `px-2 py-1.5 ${align === "center" ? "text-center" : "text-left"} font-semibold text-blue-300${sortable ? " cursor-pointer select-none hover:text-blue-200" : ""}`;
    const handleClick = sortable ? () => handleHeaderSort(key) : undefined;
    return (
      <th
        className={baseClass}
        onClick={handleClick}
        title={options?.title || (sortable ? "Click to sort" : undefined)}
      >
        <span className={`inline-flex items-center ${align === "center" ? "justify-center w-full" : ""}`}>
          {label}
          {sortIndicator(key)}
          {filterKey && (
            <span onClick={(e) => e.stopPropagation()} className="inline-flex">
              {renderColFilter(filterKey, label)}
            </span>
          )}
        </span>
      </th>
    );
  };

  const toggleItemSelection = (ticketNo: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(ticketNo)) {
      newSelected.delete(ticketNo);
    } else {
      newSelected.add(ticketNo);
    }
    setSelectedItems(newSelected);
  };

  const toggleAllItems = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.ticketNo)));
    }
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
          <div className="mb-6 space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <input
                type="text"
                placeholder="ticket, zip code, address, name, etc" onKeyDown={(e)=>{if(e.key==="Enter"&&(e.target as HTMLInputElement).value.length===5){const z=lookupZip((e.target as HTMLInputElement).value);if(z)console.log("Zip",e.target,"→",z.location);}}}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="glass-input w-full"
                aria-label="Search tickets"
              />
              <select aria-label="Repair status filter" value={repairStatusFilter} onChange={(e) => setRepairStatusFilter(e.target.value)} className="glass-input w-full">
                <option value="">All Repair Status</option>
                {REPAIR_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select aria-label="Location filter" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="glass-input w-full">
                <option value="">All Locations</option>
                {locationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              <input aria-label="Start date" type="date" value={startDateFilter} onChange={(e) => setStartDateFilter(e.target.value)} className="glass-input w-full" />
              <input aria-label="End date" type="date" value={endDateFilter} onChange={(e) => setEndDateFilter(e.target.value)} className="glass-input w-full" />
              <select aria-label="Ticket source filter" value={ticketSourceFilter} onChange={(e) => setTicketSourceFilter(e.target.value)} className="glass-input w-full">
                <option value="">All Ticket Sources</option>
                {ticketSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              {/* High-level Tech-Daily-Report group: Pending / Completed /
                  Claimed / Cancelled. Buckets every individual status
                  (CSR-*, OP-*, PT-*, TR-*, CL-*) into one of those four. */}
              <select
                aria-label="Status group filter"
                value={statusGroupFilter}
                onChange={(e) => setStatusGroupFilter(e.target.value as any)}
                className="glass-input w-full"
              >
                <option value="">All (Open + Closed)</option>
                <option value="open">Open / Pending</option>
                <option value="completed">Completed / Claimed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Column visibility filter + Map View shortcut */}
            <div className="relative flex justify-end items-center gap-2">
              <Link
                to="/tickets/map"
                search={{
                  repairStatus: repairStatusFilter || undefined,
                  location: locationFilter || undefined,
                  source: ticketSourceFilter || undefined,
                  group: statusGroupFilter || undefined,
                  startDate: startDateFilter || undefined,
                  endDate: endDateFilter || undefined,
                } as any}
                className="btn hover:bg-white/15 inline-flex items-center gap-2"
                title="Open the geographic view with your current filters applied (defaults to this week's tickets)"
              >
                <MapIcon className="h-4 w-4" /> Map View
              </Link>
              <button
                type="button"
                onClick={() => setColumnsMenuOpen((open) => !open)}
                className="btn hover:bg-white/15 inline-flex items-center gap-2"
                aria-haspopup="true"
                aria-expanded={columnsMenuOpen}
              >
                <Columns3 className="h-4 w-4" /> Columns
                <span className="text-xs text-muted-foreground">
                  ({TICKET_COLUMNS.filter((c) => isColVisible(c.key)).length}/{TICKET_COLUMNS.length})
                </span>
              </button>
              {columnsMenuOpen && (
                <>
                  {/* click-away overlay */}
                  <div className="fixed inset-0 z-40" onClick={() => setColumnsMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10 mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Show columns</span>
                      <button type="button" onClick={showAllColumns} className="text-xs text-blue-400 hover:text-blue-300">Show all</button>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {TICKET_COLUMNS.map((col) => (
                        <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={isColVisible(col.key)}
                            onChange={() => toggleColumn(col.key)}
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

          {/* Ticket Table */}
          <div ref={tableScrollRef} className="overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full min-w-max text-xs leading-tight">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-2 py-1.5 text-center font-semibold text-blue-300 w-12">✓</th>
                  {isColVisible("ticketNo") && renderHeader("ticketNo", "Ticket No", { filterKey: "ticketNo" })}
                  {isColVisible("warranty") && renderHeader("warranty", "Wty", { filterKey: "warranty" })}
                  {isColVisible("ticketSource") && renderHeader("ticketSource", "Ticket Source", { filterKey: "ticketSource" })}
                  {isColVisible("customer") && renderHeader("customer", "Cx Name", { filterKey: "customer" })}
                  {isColVisible("city") && renderHeader("city", "City", { filterKey: "city" })}
                  {isColVisible("location") && renderHeader("location", "Loc", { filterKey: "location" })}
                  {isColVisible("product") && renderHeader("product", "Product", { filterKey: "product" })}
                  {isColVisible("model") && renderHeader("model", "Model", { filterKey: "model" })}
                  {isColVisible("internalNote") && renderHeader("internalNote", "Internal Note", { filterKey: "internalNote" })}
                  {isColVisible("repair") && renderHeader("repair", "Repair", { filterKey: "repair" })}
                  {isColVisible("technician") && renderHeader("technician", "Technician", { filterKey: "technician" })}
                  {isColVisible("customerPref") && renderHeader("customerPref", "Cx Prefer", { filterKey: "customerPref" })}
                  {isColVisible("schedule") && renderHeader("schedule", "Schedule", { filterKey: "schedule" })}
                  {isColVisible("status") && renderHeader("status", "Status", { filterKey: "status" })}
                  {isColVisible("phone") && renderHeader("phone", "Phone", { filterKey: "phone" })}
                  {isColVisible("redo") && renderHeader("redo", "Redo", { filterKey: "redo" })}
                  {isColVisible("aging") && renderHeader("aging", "Aging", { align: "center" })}
                  {isColVisible("statusSpend") && renderHeader("statusSpend", "Status Spend", { align: "center" })}
                  {isColVisible("calls") && renderHeader("calls", "Calls", { align: "center" })}
                  {isColVisible("partOrder") && renderHeader("partOrder", "Part Order", { filterKey: "partOrder" })}
                  {isColVisible("posting") && renderHeader("posting", "Posting", { filterKey: "posting" })}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((ticket) => (
                  <tr key={ticket.ticketNo} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-2 py-1.5 text-center font-bold text-green-400 w-12" title={visitedTickets.has(ticket.ticketNo) ? `Visited by: ${getTicketVisitors(ticket.ticketNo).join(", ")}` : "Not visited"}>
                      {visitedTickets.has(ticket.ticketNo) ? "✓" : ""}
                    </td>
                    {isColVisible("ticketNo") && (
                    <td className={`px-2 py-1.5 font-mono font-semibold ${statusColorClass(ticket.status)}`}>
                      <a
                        href={`/ticket/${ticket.ticketNo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          console.log("Ticket clicked, email:", email);
                          if (email) {
                            console.log("Marking ticket as visited:", ticket.ticketNo, email);
                            markTicketAsVisited(ticket.ticketNo, email);
                            setVisitedTickets(prev => {
                              const newSet = new Set([...prev, ticket.ticketNo]);
                              console.log("Updated visitedTickets:", newSet);
                              return newSet;
                            });
                          } else {
                            console.warn("No email available");
                          }
                        }}
                        className="hover:underline hover:opacity-80 transition cursor-pointer"
                      >
                        {ticket.ticketNo}
                      </a>
                    </td>
                    )}
                    {isColVisible("warranty") && <td className="px-2 py-1.5 text-slate-300">{warrantyAcronym(ticket.warranty)}</td>}
                    {isColVisible("ticketSource") && <td className="px-2 py-1.5 text-slate-300">{ticket.ticketSource || ticket.manufacturer}</td>}
                    {isColVisible("customer") && <td className="px-2 py-1.5 text-slate-300">{ticket.customer}</td>}
                    {isColVisible("city") && <td className="px-2 py-1.5 text-slate-300">{ticket.city}</td>}
                    {isColVisible("location") && <td className="px-2 py-1.5 text-slate-300">{ticket.location}</td>}
                    {isColVisible("product") && <td className="px-2 py-1.5 text-slate-300">{productLabel(ticket)}</td>}
                    {isColVisible("model") && <td className="px-2 py-1.5 font-mono text-xs text-slate-300">{ticket.model}</td>}
                    {isColVisible("internalNote") && (
                    <td className="px-2 py-1.5 text-slate-400 text-xs max-w-xs truncate" title={ticket.internalNote}>
                      {ticket.internalNote || "—"}
                    </td>
                    )}
                    {isColVisible("repair") && <td className="px-2 py-1.5 text-slate-300">{ticket.diagnosed}</td>}
                    {isColVisible("technician") && <td className="px-2 py-1.5 text-slate-300">{ticket.technician || "—"}</td>}
                    {isColVisible("customerPref") && <td className="px-2 py-1.5 text-center text-slate-300">{ticket.customerPref}</td>}
                    {isColVisible("schedule") && <td className="px-2 py-1.5 text-slate-300">{ticket.schedule}</td>}
                    {isColVisible("status") && <td className={`px-2 py-1.5 font-semibold text-sm ${statusColorClass(ticket.status)}`}>{ticket.status}</td>}
                    {isColVisible("phone") && <td className="px-2 py-1.5 text-slate-300">{ticket.phone}</td>}
                    {isColVisible("redo") && <td className="px-2 py-1.5 text-center text-slate-300">{ticket.redo}</td>}
                    {isColVisible("aging") && (
                    <td className="px-2 py-1.5 text-center">
                      {(() => {
                        const days = daysSinceCreated(ticket.created);
                        const color = days <= 3 ? "text-green-400" : days <= 7 ? "text-yellow-400" : days <= 14 ? "text-orange-400" : "text-red-400";
                        return <span className={`font-bold text-sm ${color}`}>{days}d</span>;
                      })()}
                    </td>
                    )}
                    {isColVisible("statusSpend") && (
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => setAgingModal({ ticketNo: ticket.ticketNo, status: ticket.status })}
                        title="View status change log"
                        className="group flex flex-col items-center gap-0.5 mx-auto hover:opacity-80 transition-opacity"
                      >
                        {(() => {
                          const days = ticketAgingDays(ticket);
                          const color = days <= 3 ? "text-green-400" : days <= 7 ? "text-yellow-400" : days <= 14 ? "text-orange-400" : "text-red-400";
                          return (
                            <>
                              <span className={`font-bold text-sm ${color}`}>{days}d</span>
                              <History className="h-3 w-3 text-white/20 group-hover:text-white/50 transition-colors" />
                            </>
                          );
                        })()}
                      </button>
                    </td>
                    )}
                    {isColVisible("calls") && <td className="px-2 py-1.5 text-center text-slate-300">{ticket.calls}</td>}
                    {isColVisible("partOrder") && <td className="px-2 py-1.5 text-slate-300">{ticket.partOrder}</td>}
                    {isColVisible("posting") && <td className="px-2 py-1.5 text-slate-300">{ticket.created}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredItems.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No tickets found matching "{searchQuery}"</p>
            </div>
          )}

          {/* Floating horizontal scrollbar — pinned to the bottom of the
              viewport so the user can scroll the wide ticket table
              sideways without first scrolling all the way down. Hides
              itself automatically when the table's own native scrollbar
              comes into view. */}
          <FloatingHorizontalScrollbar targetRef={tableScrollRef} />

          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredItems.length} of {SAMPLE_TICKETS.length} tickets ({selectedItems.size} selected)
          </div>
        </div>

        {/* ── Status Change Log Modal ── */}
        {agingModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setAgingModal(null)}>
            <div className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-400" />
                  <span className="font-semibold">Status Change Log</span>
                  <span className="text-xs text-muted-foreground font-mono">{agingModal.ticketNo}</span>
                </div>
                <button onClick={() => setAgingModal(null)} className="text-white/30 hover:text-white/70 transition-colors"><X className="h-5 w-5" /></button>
              </div>

              {/* Current status + aging */}
              <div className="px-5 py-3 border-b border-white/10 bg-white/[0.02] flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Current Status</p>
                  <p className="text-sm font-semibold text-blue-300">{agingModal.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Days in Status</p>
                  {(() => {
                    const lastChange = statusLog.filter(l => l.ticketNo === agingModal.ticketNo).sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
                    const days = lastChange ? daysAgo(lastChange.changedAt) : null;
                    const color = days === null ? "text-muted-foreground" : days <= 3 ? "text-green-400" : days <= 7 ? "text-yellow-400" : days <= 14 ? "text-orange-400" : "text-red-400";
                    return <p className={`text-2xl font-bold ${color}`}>{days !== null ? `${days}d` : "—"}</p>;
                  })()}
                </div>
              </div>

              {/* Log entries */}
              <div className="flex-1 overflow-y-auto divide-y divide-white/5">
                {ticketStatusLog(agingModal.ticketNo).length === 0
                  ? <div className="px-5 py-8 text-center text-muted-foreground text-sm">No status changes recorded yet.<br /><span className="text-xs opacity-60">Use the form below to log a change.</span></div>
                  : ticketStatusLog(agingModal.ticketNo).map((entry, i) => (
                    <div key={i} className="px-5 py-3 hover:bg-white/[0.02]">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20 line-through opacity-60">{entry.fromStatus}</span>
                          <span className="text-white/30 text-xs">→</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">{entry.toStatus}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtTimestamp(entry.changedAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />{entry.changedBy}
                        {entry.note && <span className="ml-2 text-white/40 italic">"{entry.note}"</span>}
                      </div>
                    </div>
                  ))
                }
              </div>

              {/* Add new entry */}
              <div className="px-5 py-4 border-t border-white/10 bg-white/[0.02] rounded-b-xl">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Log Status Change</p>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input value={changeByInput} onChange={e => setChangeByInput(e.target.value)} placeholder="Your name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md flex-1" />
                    <input value={changeNoteInput} onChange={e => setChangeNoteInput(e.target.value)} placeholder="Note (optional)…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md flex-1" />
                  </div>
                  <button
                    onClick={() => {
                      const prev = ticketStatusLog(agingModal.ticketNo)[0]?.toStatus || agingModal.status;
                      logStatusChange(agingModal.ticketNo, prev, agingModal.status);
                    }}
                    className="w-full py-1.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                    <Clock className="h-3.5 w-3.5" />Record Status Change Now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}