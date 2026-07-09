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

const DAY_OPTIONS = ["30 days", "60 days", "90 days", "120 days", "180 days", "365 days"];
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

  // ── Selection + per-row editable fields (UI only for now) ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowOverrides, setRowOverrides] = useState<
    Record<string, { preClaimStatus?: string; claimNote?: string; claimVerified?: boolean }>
  >({});

  const locDropdown = usePortalPosition(locOpen);
  const locListRef = useRef<HTMLDivElement>(null);

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
        parseFlexibleDate(t.scheduleDate) ||
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
      return {
        ticket: t,
        partsCount,
        compCancelIso,
        compCancelDate: date,
        aging,
        preClaimStatus: override.preClaimStatus ?? defaultPreClaim,
        claimNote: override.claimNote ?? "",
        claimVerified: override.claimVerified ?? false,
      };
    });
  }, [tickets, partCounts, rowOverrides]);

  // ── Filtered view ──
  const filtered = useMemo(() => {
    return rows.filter(({ ticket: t, compCancelIso }) => {
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
          t.product,
          t.productType,
          t.account,
          t.claimCompany,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(q)) return false;
      }
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
  ]);

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
    patch: { preClaimStatus?: string; claimNote?: string; claimVerified?: boolean },
  ) => setRowOverrides((prev) => ({ ...prev, [ticketNo]: { ...prev[ticketNo], ...patch } }));

  // ── Status-dot helper ──
  const dotColor = (d: 0 | 1 | 2) => (d === 0 ? "" : d === 1 ? "bg-orange-400" : "bg-red-500");

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
    <main className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Claim</Link>
        <span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>
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
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="accent-blue-500"
                />
              </th>
              {[
                "Location",
                "Ticket No",
                "Wty",
                "Status",
                "Technician",
                "Product",
                "Comp/Cancel",
                "Parts",
                "REDO",
                "Claim To",
                "Claim #",
                "",
                "Pre-Claim Status",
                "Claim Note",
                "TAT",
                "Actions",
              ].map((h, i) => (
                <th
                  key={i}
                  className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-4 py-12 text-center text-muted-foreground">
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
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.ticketNo)}
                        onChange={() => toggleRow(t.ticketNo)}
                        className="accent-blue-500"
                      />
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{t.location || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <a
                        href={`/ticket/${encodeURIComponent(t.ticketNo)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-blue-400 hover:text-blue-300 hover:underline"
                        title={`Open ${t.ticketNo} in a new tab`}
                      >
                        {t.ticketNo}
                      </a>
                      {dot > 0 && (
                        <span className={`inline-block w-2 h-2 rounded-full ml-1 ${dotColor(dot)}`} />
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">{wtyCode(t.warranty)}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {t.status || "—"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{t.technician || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {(t.productType || t.product || "").toUpperCase() || "—"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                      {r.compCancelIso || "—"}
                    </td>
                    <td className="px-2 py-2 text-center">
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
                    <td className="px-2 py-2 text-center">{t.redo || ""}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs">
                      {t.account || t.claimCompany || "—"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs">—</td>
                    <td className="px-2 py-2">
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
                    <td className="px-2 py-2">
                      <select
                        value={r.preClaimStatus}
                        onChange={(e) => updateRow(t.ticketNo, { preClaimStatus: e.target.value })}
                        className="glass-input text-xs py-0.5 px-1 rounded w-36"
                      >
                        {PRE_CLAIM_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={r.claimNote}
                        onChange={(e) => updateRow(t.ticketNo, { claimNote: e.target.value })}
                        className="glass-input text-xs py-0.5 px-1 rounded w-32"
                        placeholder="Note"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">{r.aging} d</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <a
                        href={`/ticket/${encodeURIComponent(t.ticketNo)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-xs"
                      >
                        Open ticket ›
                      </a>
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
    </main>
  );
}
