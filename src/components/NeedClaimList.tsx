import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";
import { getCompanyMapProvider, type MapProvider } from "@/lib/supabase/companySettings";
import { computeOfficeDistanceMiles } from "@/lib/mapEngine";
import { getCompanyTicketClaimDetails, upsertTicketClaimDetails, type TicketClaimDetails } from "@/lib/supabase/claimDetails";
import { PreClaimModal } from "@/components/PreClaimModal";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { loadOpenedTickets, markTicketOpened } from "@/lib/openedTickets";
import { resolveTierCode } from "@/lib/tierCodes";
import { Check } from "lucide-react";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

// ─── Portal-positioned dropdown helper (preserved from the original) ───
const DROPDOWN_STYLE: React.CSSProperties = {
  background: "var(--color-card)",
  color: "var(--color-foreground)",
  border: "1px solid var(--color-panel-border)",
  borderRadius: 6,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  zIndex: 999999,
  position: "fixed",
  maxHeight: 280,
  overflowY: "auto",
};

const Chev = ({ open }: { open: boolean }) => (
  <svg
    className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function usePortalPosition(open: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const recalc = useCallback(() => {
    if (!ref.current) return;
    const b = ref.current.getBoundingClientRect();
    setPos({ top: b.bottom + 2, left: b.left, width: b.width });
  }, []);
  useLayoutEffect(() => {
    if (open) recalc();
  }, [open, recalc]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, recalc]);
  return { ref, pos };
}

const DAY_OPTIONS = ["7 days", "30 days", "60 days", "90 days", "120 days", "180 days", "365 days"];
const PRE_CLAIM_STATUSES = ["Holding", "Need Claim", "Claim Not Needed", "Claimed"];

// Statuses we treat as "needs claim review" — the ticket is finished
// (or cancelled / parts back-ordered) on the operations side and is now
// ready for the claims team to file or close out.
const NEED_CLAIM_STATUSES = new Set([
  "cl-ready to complete",
  "cl-need cancel",
  "cl-parts back ordered",
  "cl-claimed",
  "cl-data closed",
  "completed",
  "cancel",
  "cancelled",
]);

// ─── Helpers ───
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Parse a date that might come in MM/DD/YY or YYYY-MM-DD or "" form. */
function parseFlexibleDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // YYYY-MM-DD or YYYY/MM/DD
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!isNaN(d.getTime())) return d;
  }
  // MM/DD/YY or MM/DD/YYYY
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(us[1]) - 1, Number(us[2]));
    if (!isNaN(d.getTime())) return d;
  }
  // Last resort
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function toIsoDay(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Days since `from` (returns 0 when from is null). */
function daysBetween(from: Date | null, to: Date = new Date()): number {
  if (!from) return 0;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

/** Map a ticket status to a small dot indicator (0=none, 1=warn, 2=overdue). */
function statusDotFor(status: string, aging: number): 0 | 1 | 2 {
  const s = (status || "").toLowerCase();
  if (s.includes("back ordered")) return 1;
  if (aging >= 30) return 2;
  if (aging >= 14) return 1;
  return 0;
}

/** Warranty code in the table column. */
function wtyCode(warranty: string): string {
  const v = String(warranty || "").toLowerCase();
  if (!v) return "—";
  if (v.includes("in")) return "IW";
  if (v.includes("oow") || v.includes("out")) return "OOW";
  if (v.includes("service contract") || v === "sc") return "SC";
  return v.slice(0, 3).toUpperCase();
}

/** Same lookup + "N/A" fallback as the ticket detail page's General Information > Tier Code field. */
function tierCodeForTicket(t: Ticket): string {
  const tier = resolveTierCode(t.account, t.zip, t.accountNo);
  return tier && tier.code && tier.code.toLowerCase() !== "base" ? tier.code : "N/A";
}

interface ClaimRow {
  ticket: Ticket;
  partsCount: number;
  /** "MM/DD/YYYY" string for the comp/cancel column. */
  compCancelIso: string;
  compCancelDate: Date | null;
  aging: number;
  /** UI-only locally-edited values. */
  preClaimStatus: string;
  claimNote: string;
  claimVerified: boolean;
}

export function NeedClaimList({ mod, sub }: Props) {
  const auth = useAuth();

  // ── Server state ──
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [partCounts, setPartCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Filters ──
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [startDate, setStartDate] = useState(daysAgo(90));
  const [endDate, setEndDate] = useState(today());
  const [dayRange, setDayRange] = useState("90 days");
  const [ticketSearch, setTicketSearch] = useState("");
  const [readyToComplete, setReadyToComplete] = useState(true);
  const [cancelled, setCancelled] = useState(true);
  const [claimed, setClaimed] = useState(true);
  const [search, setSearch] = useState("");

  // ── Selection + per-row editable fields ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // "claim # verified" has no persisted column (out of scope for the Pre-Claim
  // modal's DB work) — stays UI-only like before.
  const [rowOverrides, setRowOverrides] = useState<Record<string, { claimVerified?: boolean }>>({});
  // Pre-Claim Status / Claim Note now come from ticket_claim_details
  // (migration 0135) via the Pre-Claim modal, keyed by the ticket's
  // internal UUID (Ticket._id) — replaces what used to be pure useState
  // that reset on every reload.
  const [claimDetailsByTicketId, setClaimDetailsByTicketId] = useState<Map<string, TicketClaimDetails>>(new Map());
  const [preClaimTicketNo, setPreClaimTicketNo] = useState<string | null>(null);

  // "Already opened" checkmark — a personal, per-browser mark (see
  // openedTickets.ts), not a shared/DB-backed status.
  const [openedTicketNos, setOpenedTicketNos] = useState<Set<string>>(() => loadOpenedTickets());
  const markOpened = (ticketNo: string) => setOpenedTicketNos((prev) => markTicketOpened(ticketNo, prev));

  const locDropdown = usePortalPosition(locOpen);
  const locListRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Close location dropdown on outside click
  useEffect(() => {
    if (!locOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!locDropdown.ref.current?.contains(t) && !locListRef.current?.contains(t)) {
        setLocOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [locOpen, locDropdown]);

  const handleDayChange = (val: string) => {
    setDayRange(val);
    const days = parseInt(val, 10);
    if (!Number.isFinite(days)) return;
    setStartDate(daysAgo(days));
    setEndDate(today());
  };

  // ── Load tickets + part counts ──
  const loadData = useCallback(async () => {
    if (!auth.companyId) return;
    setLoading(true);
    setError(null);
    try {
      const all = await getCompanyTickets();
      // Narrow to claims-relevant statuses up front so the filter bar
      // operates on a clean working set.
      const claimsRelated = all.filter((t) => {
        const s = String(t.status || "").trim().toLowerCase();
        return NEED_CLAIM_STATUSES.has(s);
      });
      setTickets(claimsRelated);

      // Fire-and-forget: real Pre-Claim Status/Claim Note, keyed by ticket
      // UUID, replacing what used to reset to defaults on every reload.
      getCompanyTicketClaimDetails()
        .then(setClaimDetailsByTicketId)
        .catch((err) => console.warn("[NeedClaimList] claim details fetch failed:", err));

      // Bulk part counts grouped by ticket_id so we don't fire a query
      // per row. We grab the ticket_id + 1 column to keep the payload
      // tiny.
      const ticketIds = (claimsRelated as Array<Ticket & { _id?: string }>)
        .map((t) => t._id)
        .filter((id): id is string => !!id);
      if (ticketIds.length === 0) {
        setPartCounts({});
      } else {
        const { data: partRows, error: partsError } = await supabase
          .from("parts")
          .select("ticket_id")
          .in("ticket_id", ticketIds);
        if (partsError) {
          console.warn("[NeedClaimList] part count fetch failed:", partsError.message);
          setPartCounts({});
        } else {
          const counts: Record<string, number> = {};
          for (const row of partRows ?? []) {
            const tid = String((row as any).ticket_id ?? "");
            if (!tid) continue;
            counts[tid] = (counts[tid] ?? 0) + 1;
          }
          setPartCounts(counts);
        }
      }
    } catch (err) {
      console.error("[NeedClaimList] load failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [auth.companyId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Compose rows ──
  const rows = useMemo<ClaimRow[]>(() => {
    return tickets.map((t) => {
      const tid = (t as any)._id as string | undefined;
      const partsCount = tid ? partCounts[tid] ?? 0 : 0;
      // Comp/Cancel reflects the most-relevant claim date: SP-status
      // change → schedule date → call received date.
      const date =
        parseFlexibleDate(t.statusChangedAt) ||
        parseFlexibleDate(t.schedule) ||
        parseFlexibleDate(t.callReceivedDate) ||
        parseFlexibleDate(t.created);
      const compCancelIso = date ? toIsoDay(date) : "";
      const aging = daysBetween(date);
      // Map status → default Pre-Claim Status.
      const s = String(t.status || "").toLowerCase();
      const isAlreadyClaimed = s.includes("claim");
      const isCancelled = s.includes("cancel");
      const defaultPreClaim = isAlreadyClaimed
        ? "Claimed"
        : isCancelled
        ? "Claim Not Needed"
        : "Need Claim";
      const override = rowOverrides[t.ticketNo] ?? {};
      const saved = tid ? claimDetailsByTicketId.get(tid) : undefined;
      return {
        ticket: t,
        partsCount,
        compCancelIso,
        compCancelDate: date,
        aging,
        preClaimStatus: saved?.preClaimStatus || defaultPreClaim,
        claimNote: saved?.claimNote ?? "",
        claimVerified: override.claimVerified ?? false,
      };
    });
  }, [tickets, partCounts, rowOverrides, claimDetailsByTicketId]);

  // Declared here (rather than down with the rest of the mileage-fetch
  // logic below) so columnValueGetters/filtered above can reference it —
  // the effect that actually POPULATES it still lives further down, using
  // `filtered` once it exists; only the state itself needs to exist first.
  const [mileageByTicket, setMileageByTicket] = useState<Record<string, number | null>>({});

  // ── Per-column Excel-style filters (funnel icon in each header) ──
  // Every real data column gets one; Claim # (always a placeholder "—"),
  // the verify checkbox, and Actions don't since there's nothing to filter.
  const COLUMN_FILTER_KEYS = [
    "location", "ticketNo", "wty", "status", "technician", "product", "compCancel",
    "mileage", "parts", "redo", "claimTo", "tierCode", "preClaimStatus", "claimNote", "tat",
  ] as const;
  type ColumnFilterKey = (typeof COLUMN_FILTER_KEYS)[number];

  const [columnFilters, setColumnFilters] = useState<Record<ColumnFilterKey, Set<string>>>(() => {
    const init = {} as Record<ColumnFilterKey, Set<string>>;
    for (const k of COLUMN_FILTER_KEYS) init[k] = new Set<string>();
    return init;
  });
  const updateColumnFilter = (key: ColumnFilterKey, next: Set<string>) =>
    setColumnFilters((prev) => ({ ...prev, [key]: next }));

  const columnValueGetters: Record<ColumnFilterKey, (r: ClaimRow) => string> = {
    location: (r) => r.ticket.location || "",
    ticketNo: (r) => r.ticket.ticketNo || "",
    wty: (r) => wtyCode(r.ticket.warranty),
    status: (r) => r.ticket.status || "",
    technician: (r) => r.ticket.technician || "",
    product: (r) => (r.ticket.productType || "").toUpperCase() || "",
    compCancel: (r) => r.compCancelIso || "",
    mileage: (r) => {
      const m = mileageByTicket[r.ticket.ticketNo];
      return m == null ? "" : `${m.toFixed(1)} mi`;
    },
    parts: (r) => (r.partsCount > 0 ? String(r.partsCount) : ""),
    redo: (r) => r.ticket.redo || "",
    claimTo: (r) => r.ticket.account || r.ticket.claimCompany || "",
    tierCode: (r) => tierCodeForTicket(r.ticket),
    preClaimStatus: (r) => r.preClaimStatus || "",
    claimNote: (r) => r.claimNote || "",
    tat: (r) => `${r.aging} d`,
  };

  // ── Filtered view ──
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const t = row.ticket;
      const compCancelIso = row.compCancelIso;
      // Location filter
      if (location && t.location !== location) return false;

      // Ticket # filter (top-bar)
      if (ticketSearch && !t.ticketNo.toLowerCase().includes(ticketSearch.toLowerCase())) return false;

      // Comp/Cancel date range — uses the same comp date the row shows.
      if (startDate && compCancelIso && compCancelIso < startDate) return false;
      if (endDate && compCancelIso && compCancelIso > endDate) return false;

      // Status checkbox group. At least one of the three must include
      // this ticket's status; if all three are off, treat as "show all"
      // so the table never goes blank by accident.
      const status = String(t.status || "").toLowerCase();
      const isClaimedRow = status.includes("claim");
      const isCancelledRow = status.includes("cancel");
      const isReady = status.includes("ready to complete") || status.includes("back ordered");
      const allOff = !readyToComplete && !cancelled && !claimed;
      if (!allOff) {
        const matches =
          (readyToComplete && isReady) ||
          (cancelled && isCancelledRow) ||
          (claimed && isClaimedRow);
        if (!matches) return false;
      }

      // Free-text search across visible columns.
      if (search) {
        const q = search.toLowerCase();
        const blob = [
          t.ticketNo,
          t.location,
          t.technician,
          t.productType,
          t.account,
          t.claimCompany,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(q)) return false;
      }

      // Per-column funnel filters
      const matchesColumns = COLUMN_FILTER_KEYS.every((key) => {
        const selected = columnFilters[key];
        if (!selected || selected.size === 0) return true;
        return selected.has(columnValueGetters[key](row));
      });
      if (!matchesColumns) return false;

      return true;
    });
  }, [
    rows,
    location,
    ticketSearch,
    startDate,
    endDate,
    readyToComplete,
    cancelled,
    claimed,
    search,
    columnFilters,
    mileageByTicket,
  ]);

  // Build option lists per column from the full row set **before** that
  // column's own filter is applied (but after every other active filter) —
  // so opening a funnel still shows every value present in rows that pass
  // everything else. Mirrors Excel's autofilter UX (same convention as
  // TicketList.tsx's COLUMN_FILTER_KEYS pattern).
  const buildOptionsExcluding = (excludeKey: ColumnFilterKey): string[] => {
    const values = new Set<string>();
    for (const row of rows) {
      const t = row.ticket;
      if (location && t.location !== location) continue;
      if (ticketSearch && !t.ticketNo.toLowerCase().includes(ticketSearch.toLowerCase())) continue;
      if (startDate && row.compCancelIso && row.compCancelIso < startDate) continue;
      if (endDate && row.compCancelIso && row.compCancelIso > endDate) continue;
      const status = String(t.status || "").toLowerCase();
      const isClaimedRow = status.includes("claim");
      const isCancelledRow = status.includes("cancel");
      const isReady = status.includes("ready to complete") || status.includes("back ordered");
      const allOff = !readyToComplete && !cancelled && !claimed;
      if (!allOff) {
        const matches = (readyToComplete && isReady) || (cancelled && isCancelledRow) || (claimed && isClaimedRow);
        if (!matches) continue;
      }
      if (search) {
        const q = search.toLowerCase();
        const blob = [t.ticketNo, t.location, t.technician, t.productType, t.account, t.claimCompany]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(q)) continue;
      }
      const matchesOtherCols = COLUMN_FILTER_KEYS.every((key) => {
        if (key === excludeKey) return true;
        const sel = columnFilters[key];
        if (!sel || sel.size === 0) return true;
        return sel.has(columnValueGetters[key](row));
      });
      if (!matchesOtherCols) continue;
      values.add(columnValueGetters[excludeKey](row));
    }
    return Array.from(values);
  };

  const columnOptions = useMemo(() => {
    const out = {} as Record<ColumnFilterKey, string[]>;
    for (const key of COLUMN_FILTER_KEYS) out[key] = buildOptionsExcluding(key);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columnFilters, location, ticketSearch, startDate, endDate, readyToComplete, cancelled, claimed, search, mileageByTicket]);

  const renderColFilter = (key: ColumnFilterKey, label: string) => (
    <TicketColumnFilter
      options={columnOptions[key] || []}
      selected={columnFilters[key] || new Set()}
      onChange={(next) => updateColumnFilter(key, next)}
      label={`Filter by ${label}`}
    />
  );

  // ── Office-to-customer mileage ──
  // Real driving distance, same calculation the ticket detail page shows
  // (see computeOfficeDistanceMiles in mapEngine.ts) — but this page can
  // have dozens of tickets visible at once, and each mileage figure is a
  // real geocoding/distance-matrix API call, so they're kicked off a few at
  // a time instead of all at once. `mileageStartedRef` marks a ticket the
  // moment it's kicked off and is never cleared, so re-filtering (which
  // gives `filtered` a new array reference) never re-fetches a ticket
  // that's already resolved or still in flight.
  const [mapProvider, setMapProvider] = useState<MapProvider | null>(null);
  const mileageStartedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    getCompanyMapProvider().then(setMapProvider);
  }, []);

  useEffect(() => {
    if (!mapProvider) return;
    const toFetch = filtered
      .map((r) => r.ticket)
      .filter((t) => !mileageStartedRef.current.has(t.ticketNo));
    if (toFetch.length === 0) return;
    toFetch.forEach((t) => mileageStartedRef.current.add(t.ticketNo));

    const CONCURRENCY = 5;
    let idx = 0;
    const runNext = () => {
      if (idx >= toFetch.length) return;
      const t = toFetch[idx++];
      computeOfficeDistanceMiles(t, mapProvider)
        .then((miles) => setMileageByTicket((prev) => ({ ...prev, [t.ticketNo]: miles })))
        .catch(() => setMileageByTicket((prev) => ({ ...prev, [t.ticketNo]: null })))
        .finally(runNext);
    };
    for (let i = 0; i < CONCURRENCY; i++) runNext();
  }, [filtered, mapProvider]);

  // ── Selection helpers ──
  const toggleRow = (ticketNo: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketNo)) next.delete(ticketNo);
      else next.add(ticketNo);
      return next;
    });
  const toggleAll = () => {
    if (filtered.every((r) => selectedIds.has(r.ticket.ticketNo))) {
      const next = new Set(selectedIds);
      filtered.forEach((r) => next.delete(r.ticket.ticketNo));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filtered.forEach((r) => next.add(r.ticket.ticketNo));
      setSelectedIds(next);
    }
  };
  const allChecked = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.ticket.ticketNo));

  // ── Per-row editors ──
  const updateRow = (
    ticketNo: string,
    patch: { claimVerified?: boolean },
  ) => setRowOverrides((prev) => ({ ...prev, [ticketNo]: { ...prev[ticketNo], ...patch } }));

  // Pre-Claim Status / Claim Note save straight to ticket_claim_details —
  // optimistic local update first (keyed by ticket UUID, same as the bulk
  // fetch) so the row reflects the edit immediately, then persist.
  const [savingClaimRowTicketNo, setSavingClaimRowTicketNo] = useState<string | null>(null);
  const updateClaimDetails = async (ticketNo: string, patch: { preClaimStatus?: string; claimNote?: string }) => {
    const tid = (tickets.find((t) => t.ticketNo === ticketNo) as any)?._id as string | undefined;
    if (!tid) return;
    const prevSaved = claimDetailsByTicketId.get(tid);
    setClaimDetailsByTicketId((prev) => {
      const next = new Map(prev);
      next.set(tid, { ...(prevSaved ?? ({} as TicketClaimDetails)), ...patch } as TicketClaimDetails);
      return next;
    });
    setSavingClaimRowTicketNo(ticketNo);
    try {
      const saved = await upsertTicketClaimDetails(ticketNo, patch, auth.email || auth.displayName || null);
      setClaimDetailsByTicketId((prev) => new Map(prev).set(tid, saved));
    } catch (err) {
      console.error("Failed to save claim details:", err);
      if (prevSaved) setClaimDetailsByTicketId((prev) => new Map(prev).set(tid, prevSaved));
    } finally {
      setSavingClaimRowTicketNo(null);
    }
  };

  // ── Status-dot helper ──
  const dotColor = (d: 0 | 1 | 2) => (d === 0 ? "" : d === 1 ? "bg-orange-400" : "bg-red-500");

  // ── Open every currently-filtered ticket in its own tab ── e.g. filter to
  // "7 days" then open all of them at once instead of clicking each row.
  // Browsers can block a burst of window.open calls, but this runs inside a
  // real click handler so each call still counts as user-initiated.
  const onOpenAllFiltered = () => {
    if (filtered.length === 0) return;
    if (
      filtered.length > 20 &&
      !window.confirm(`This opens ${filtered.length} tickets in new tabs — continue?`)
    ) {
      return;
    }
    // Browsers only ever guarantee ONE window.open() per user gesture — every
    // one after that in a synchronous loop gets treated as an unrequested
    // popup and silently blocked, even though this whole thing runs inside a
    // real click handler. Staggering them a beat apart lets a few more
    // through in some browsers, but the real fix is detecting what actually
    // got blocked (window.open returns null for those) and telling the user
    // to allow popups for this site instead of leaving them guessing why
    // only one tab showed up.
    let blockedCount = 0;
    filtered.forEach((r, i) => {
      setTimeout(() => {
        const win = window.open(`/ticket/${encodeURIComponent(r.ticket.ticketNo)}`, "_blank", "noopener,noreferrer");
        if (!win) blockedCount++;
        else markOpened(r.ticket.ticketNo);
      }, i * 60);
    });
    // Checked once, after every staggered attempt above has had its turn —
    // not right after the first blocked one, which would report a
    // still-in-progress (too-low) count for a large batch.
    setTimeout(() => {
      if (blockedCount > 0) {
        alert(
          `Your browser blocked ${blockedCount} of ${filtered.length} tickets as popups. ` +
            `Look for a popup-blocked icon in the address bar and choose "Always allow popups from this site," then click Open All Filtered again.`
        );
      }
    }, filtered.length * 60 + 300);
  };

  // ── Auto-claim handler (selected rows only) ──
  const onAutoClaim = () => {
    const pickedTickets = filtered.filter((r) => selectedIds.has(r.ticket.ticketNo));
    if (pickedTickets.length === 0) {
      alert("Select at least one ticket before submitting a claim.");
      return;
    }
    const assurant = pickedTickets.filter((r) =>
      String(r.ticket.account || "").toLowerCase().includes("assurant"),
    );
    if (assurant.length === 0) {
      alert(
        "Auto-claim is currently only wired up for Assurant tickets. The selected rows aren't Assurant — open each ticket and use 'Sync from Claim' instead.",
      );
      return;
    }
    alert(
      `Submitting ${assurant.length} ticket${assurant.length === 1 ? "" : "s"} for Assurant auto-claim is coming next — this button will queue them and surface a per-row result. ` +
      `For now, open each ticket and use the 'Sync from Claim' button in Claim Transactions.`,
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
    <main className="flex-1 max-w-[1800px] mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          Need Claim List
          <span
            className="text-muted-foreground cursor-help text-base"
            title="Tickets completed or cancelled requiring claim processing"
          >
            ⓘ
          </span>
        </h1>
        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 btn hover:bg-white/15 disabled:opacity-60"
          title="Re-read tickets from Supabase"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="panel mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Location (portal dropdown) */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
            <button
              ref={locDropdown.ref}
              onClick={() => setLocOpen((o) => !o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"
            >
              <span className={location ? "" : "text-muted-foreground"}>{location || "All Locations"}</span>
              <Chev open={locOpen} />
            </button>
            {locOpen && locDropdown.pos && createPortal(
              <div
                ref={locListRef}
                style={{
                  ...DROPDOWN_STYLE,
                  top: locDropdown.pos.top,
                  left: locDropdown.pos.left,
                  width: locDropdown.pos.width,
                }}
              >
                <button
                  onClick={() => { setLocation(""); setLocOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location === "" ? "bg-blue-600 text-white" : "text-slate-400"}`}
                >
                  — All Locations —
                </button>
                {LOCATIONS.map((l) => (
                  <button
                    key={l}
                    onClick={() => { setLocation(l); setLocOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location === l ? "bg-blue-600 text-white" : ""}`}
                  >
                    {l}
                  </button>
                ))}
              </div>,
              document.body,
            )}
          </div>

          {/* Completed/Cancelled date range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Completed / Cancelled</label>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="glass-input text-sm py-1.5 px-2 rounded-md w-32"
              />
              <span className="text-muted-foreground text-xs">~</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="glass-input text-sm py-1.5 px-2 rounded-md w-32"
              />
              <select
                value={dayRange}
                onChange={(e) => handleDayChange(e.target.value)}
                className="glass-input text-sm py-1.5 px-2 rounded-md"
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Ticket No */}
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket No</label>
            <input
              type="text"
              value={ticketSearch}
              onChange={(e) => setTicketSearch(e.target.value)}
              placeholder=""
              className="glass-input text-sm py-1.5 px-2 rounded-md"
            />
          </div>

          {/* Status checkboxes */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground invisible uppercase tracking-wide">Status</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={readyToComplete}
                  onChange={(e) => setReadyToComplete(e.target.checked)}
                  className="accent-blue-500"
                />
                Ready to Complete
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelled}
                  onChange={(e) => setCancelled(e.target.checked)}
                  className="accent-blue-500"
                />
                Cancelled
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={claimed}
                  onChange={(e) => setClaimed(e.target.checked)}
                  className="accent-blue-500"
                />
                Claimed
              </label>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-end gap-2 ml-auto pb-0.5">
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="px-3 py-1.5 rounded text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-60"
            >
              Sync Tickets
            </button>
            <button
              onClick={onAutoClaim}
              className="px-3 py-1.5 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white"
            >
              Auto Claim ({selectedIds.size})
            </button>
            <button
              onClick={onOpenAllFiltered}
              disabled={filtered.length === 0}
              title="Open every ticket currently shown in a new tab"
              className="px-3 py-1.5 rounded text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
            >
              Open All Filtered ({filtered.length})
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">
          <span className="text-foreground font-medium">{filtered.length}</span> tickets found
          {loading ? " · loading…" : null}
          {error ? <span className="text-red-300 ml-3">⚠ {error}</span> : null}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search in result"
            className="glass-input text-xs py-1 px-2 rounded-md w-36"
          />
        </div>
      </div>

      {/* Table */}
      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
      <div ref={tableScrollRef} className="overflow-x-auto border border-white/10 rounded-lg">
        <table className="w-full min-w-max text-[11px]">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-1 py-1.5 w-6">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="accent-blue-500"
                />
              </th>
              {([
                ["Location", "location"],
                ["Ticket No", "ticketNo"],
                ["Wty", "wty"],
                ["Status", "status"],
                ["Technician", "technician"],
                ["Product", "product"],
                ["Comp/Cancel", "compCancel"],
                ["Mileage", "mileage"],
                ["Parts", "parts"],
                ["REDO", "redo"],
                ["Claim To", "claimTo"],
                ["Tier Code", "tierCode"],
                ["Claim #", null],
                ["", null],
                ["Pre-Claim Status", "preClaimStatus"],
                ["Claim Note", "claimNote"],
                ["TAT", "tat"],
                ["Actions", null],
              ] as [string, ColumnFilterKey | null][]).map(([h, key], i) => (
                <th
                  key={i}
                  className="px-1 py-1.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                >
                  <span className="inline-flex items-center">
                    {h}
                    {key && renderColFilter(key, h)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={19} className="px-4 py-12 text-center text-muted-foreground">
                  {loading
                    ? "Loading tickets…"
                    : tickets.length === 0
                    ? "No tickets in claim-ready status yet."
                    : "No records match the current filters."}
                </td>
              </tr>
            ) : (
              filtered.map((r, idx) => {
                const t = r.ticket;
                const dot = statusDotFor(t.status, r.aging);
                return (
                  <tr
                    key={t.ticketNo}
                    className={`border-b border-white/5 hover:bg-white/5 ${selectedIds.has(t.ticketNo) ? "bg-blue-500/5" : idx % 2 !== 0 ? "bg-white/[0.02]" : ""}`}
                  >
                    <td className="px-1 py-1">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.ticketNo)}
                        onChange={() => toggleRow(t.ticketNo)}
                        className="accent-blue-500"
                      />
                    </td>
                    <td className="px-1 py-1 max-w-[70px] truncate" title={t.location || undefined}>{t.location || "—"}</td>
                    <td className="px-1 py-1 whitespace-nowrap">
                      {openedTicketNos.has(t.ticketNo) && (
                        <Check className="inline-block h-3 w-3 text-emerald-400 mr-1 align-middle" aria-label="Already opened" />
                      )}
                      <a
                        href={`/ticket/${encodeURIComponent(t.ticketNo)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => markOpened(t.ticketNo)}
                        className="font-mono text-blue-400 hover:text-blue-300 hover:underline"
                        title={`Open ${t.ticketNo} in a new tab`}
                      >
                        {t.ticketNo}
                      </a>
                      {dot > 0 && (
                        <span className={`inline-block w-2 h-2 rounded-full ml-1 ${dotColor(dot)}`} />
                      )}
                    </td>
                    <td className="px-1 py-1 text-center">{wtyCode(t.warranty)}</td>
                    <td className="px-1 py-1 max-w-[110px] truncate text-muted-foreground" title={t.status || undefined}>
                      {t.status || "—"}
                    </td>
                    <td className="px-1 py-1 max-w-[90px] truncate" title={t.technician || undefined}>{t.technician || "—"}</td>
                    <td className="px-1 py-1 max-w-[80px] truncate" title={(t.productType || "").toUpperCase() || undefined}>
                      {(t.productType || "").toUpperCase() || "—"}
                    </td>
                    <td className="px-1 py-1 whitespace-nowrap text-muted-foreground">
                      {r.compCancelIso || "—"}
                    </td>
                    <td className="px-1 py-1 whitespace-nowrap text-center text-muted-foreground">
                      {!(t.ticketNo in mileageByTicket)
                        ? "…"
                        : mileageByTicket[t.ticketNo] != null
                        ? `${mileageByTicket[t.ticketNo]!.toFixed(1)} mi`
                        : "—"}
                    </td>
                    <td className="px-1 py-1 text-center">
                      {r.partsCount > 0 ? (
                        <a
                          href={`/ticket/${encodeURIComponent(t.ticketNo)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                          title={`Open ${t.ticketNo} parts in a new tab`}
                        >
                          {r.partsCount}
                        </a>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="px-1 py-1 text-center">{t.redo || ""}</td>
                    <td className="px-1 py-1 max-w-[80px] truncate text-xs" title={t.account || t.claimCompany || undefined}>
                      {t.account || t.claimCompany || "—"}
                    </td>
                    <td className="px-1 py-1 whitespace-nowrap text-xs">{tierCodeForTicket(t)}</td>
                    <td className="px-1 py-1 whitespace-nowrap text-xs">—</td>
                    <td className="px-1 py-1">
                      <input
                        type="checkbox"
                        className="accent-blue-500"
                        title="Mark claim # as verified"
                        checked={r.claimVerified}
                        onChange={(e) =>
                          updateRow(t.ticketNo, { claimVerified: e.target.checked })
                        }
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={r.preClaimStatus}
                        disabled={savingClaimRowTicketNo === t.ticketNo}
                        onChange={(e) => void updateClaimDetails(t.ticketNo, { preClaimStatus: e.target.value })}
                        className="glass-input text-[10px] py-0.5 px-1 rounded w-24 disabled:opacity-50"
                      >
                        {PRE_CLAIM_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        key={`note:${t.ticketNo}:${r.claimNote}`}
                        type="text"
                        defaultValue={r.claimNote}
                        disabled={savingClaimRowTicketNo === t.ticketNo}
                        onBlur={(e) => void updateClaimDetails(t.ticketNo, { claimNote: e.target.value })}
                        className="glass-input text-[10px] py-0.5 px-1 rounded w-20 disabled:opacity-50"
                        placeholder="Note"
                        title={r.claimNote || undefined}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">{r.aging} d</td>
                    <td className="px-1 py-1 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setPreClaimTicketNo(t.ticketNo)}
                        className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                      >
                        Pre Claim
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Caution note */}
      <div className="mt-4 text-xs text-muted-foreground">
        * Caution: verification messages may not fully confirm a claim is accepted. Check with the warranty company when any claim is denied.
      </div>

      {preClaimTicketNo && (() => {
        const row = filtered.find((r) => r.ticket.ticketNo === preClaimTicketNo);
        if (!row) return null;
        return (
          <PreClaimModal
            ticket={row.ticket}
            ticketNumbers={filtered.map((r) => r.ticket.ticketNo)}
            onNavigate={setPreClaimTicketNo}
            onSaved={(ticketNo, details) => {
              const tid = (tickets.find((t) => t.ticketNo === ticketNo) as any)?._id as string | undefined;
              if (tid) setClaimDetailsByTicketId((prev) => new Map(prev).set(tid, details));
            }}
            onClose={() => setPreClaimTicketNo(null)}
          />
        );
      })()}
    </main>
    </div>
  );
}
