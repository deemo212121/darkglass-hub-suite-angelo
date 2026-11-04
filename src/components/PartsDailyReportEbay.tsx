import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronDown, Plus, Trash2, Loader2, Printer, History, Download, FileSpreadsheet, Package, DollarSign, Tag, CheckCircle2, Users, CreditCard, ListChecks, ClipboardList, Pencil, Search, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { normalizeRole } from "@/lib/roleLabels";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";
import {
  EBAY_ORDER_STATUSES,
  EBAY_LISTING_STATUSES,
  EBAY_LISTINGS_STATUSES,
  EBAY_SALES_ACCOUNTS,
  getEbayOrders,
  getEbayOrdersAddedBetween,
  searchEbayOrders,
  searchEbayListings,
  EBAY_SEARCH_LIMIT,
  createEbayOrder,
  updateEbayOrder,
  deleteEbayOrder,
  getEbayListings,
  getActiveEbayListings,
  createEbayListing,
  updateEbayListing,
  deleteEbayListing,
  getEbayBranchSettings,
  upsertEbayBranchSetting,
  getEbayBranchDailyNotes,
  upsertEbayBranchDailyNote,
  getEbayBranchStatusHistory,
  getEbayAccounts,
  createEbayAccount,
  deleteEbayAccount,
  getEbayBranchCents,
  upsertEbayBranchCent,
  deleteEbayBranchCent,
  type EbayOrderRow,
  type EbayListingRow,
  type EbayBranchSetting,
  type EbayBranchDailyNote,
  type EbayBranchStatusChange,
  type EbayAccount,
  type EbayBranchCent,
} from "@/lib/supabase/partDailyReportEbay";
import { LOCATIONS } from "@/lib/locations";
import { EbayImportModal } from "@/components/EbayImportModal";
import { localISODate, todayISO } from "@/lib/localDate";
import { useColumnFunnels } from "@/hooks/useColumnFunnels";

// Color coding per order status, reused for status chips/dropdown-adjacent
// badges wherever a status shows up on this page.
const ORDER_STATUS_TONE: Record<string, { border: string; bg: string; text: string }> = {
  Shipped: { border: "border-green-500/30", bg: "bg-green-500/5", text: "text-green-400" },
  Cancelled: { border: "border-slate-500/30", bg: "bg-slate-500/5", text: "text-slate-300" },
  Returned: { border: "border-orange-500/30", bg: "bg-orange-500/5", text: "text-orange-400" },
  Refunded: { border: "border-rose-500/30", bg: "bg-rose-500/5", text: "text-rose-400" },
  Pending: { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-400" },
};

// Human-readable labels for every editable field, shared by the inline
// quick-edit inputs and the full-row Edit modal — both log per-field
// changes to the activity log using these same names.
const ORDER_FIELD_LABELS: Record<string, string> = {
  orderExtId: "Order ID", partNo: "Part #", quantity: "Qty", status: "Status",
  orderEarnings: "Earnings", salesAccount: "Account", branch: "Branch", orderDate: "Order Date", notes: "Notes",
};
const LISTING_FIELD_LABELS: Record<string, string> = {
  partNo: "Part #", ebayAccount: "Account", branch: "Branch", price: "Price", quantity: "Qty", listedDate: "Listed Date", status: "Status",
};

// `err instanceof Error` silently misses plain objects with a `message`
// field (Supabase surfaces some failures that way), which was hiding the
// real cause behind a generic fallback string. This checks for `.message`
// on anything, and always logs the full raw error so hint/code/details
// (the actually useful part of a Postgres error) aren't lost either.
function errMsg(err: unknown, fallback: string): string {
  console.error(fallback, err);
  if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string" && (err as any).message) {
    return (err as any).message;
  }
  if (typeof err === "string" && err) return err;
  return fallback;
}

function applyCents(price: number, cents: number | undefined): number {
  if (cents === undefined || !Number.isFinite(price)) return price;
  const whole = Math.floor(Math.max(0, price));
  return Number((whole + cents / 100).toFixed(2));
}

const EBAY_ACTIVITY_TARGET_TYPE = "ebay_daily_report";

// Same "Parts department" role set ReportPartsDaily.tsx uses — Parts
// staff and Parts Managers, not Parts Team Leader/Parts Order (those
// are separate access tiers, not people who'd cover branch listings).
const PARTS_ROLES = new Set(["PARTS", "PARTS_MANAGER"]);
function isPartsProfile(p: ProfileRow): boolean {
  if (PARTS_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => PARTS_ROLES.has(normalizeRole(r)));
}

function dateRangeList(start: string, end: string, max = 31): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  if (Number.isNaN(d.getTime()) || Number.isNaN(endD.getTime()) || d > endD) return out;
  while (d <= endD && out.length < max) {
    out.push(localISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// Excel's "Order I.D" column is a =HYPERLINK(url, "10-15047-97413") formula:
// the cell DISPLAYS the short order id, but its real stored value is the
// long eBay URL. Pasting that cell here can hand us either form, so always
// resolve both to { the short id to show, the url to link to }.
function parseEbayOrderRef(raw: string): { display: string; href: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { display: "", href: null };
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const orderId = url.searchParams.get("orderid") || url.searchParams.get("orderId");
      return { display: orderId || trimmed, href: trimmed };
    } catch {
      return { display: trimmed, href: trimmed };
    }
  }
  return { display: trimmed, href: `https://www.ebay.com/sh/ord/details?orderid=${encodeURIComponent(trimmed)}` };
}

function formatDateAdded(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function todayIso() {
  return todayISO();
}
function daysAgoIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localISODate(d);
}

type Tab = "orders" | "listings" | "summary" | "assignments";

/** Which date the page's Start/End range filters the Orders table by. */
type OrderDateBasis = "order" | "added";
const ORDER_DATE_BASIS_KEY = "ahs.ebayReport.orderDateBasis";

/** Search box above the Orders / Listings tables — Esc or the × clears it. */
function TableSearch({ value, onChange, placeholder, busy, className = "" }: { value: string; onChange: (v: string) => void; placeholder: string; busy: boolean; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onChange(""); }}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="glass-input w-full rounded-md py-1.5 pl-8 pr-8 text-sm font-mono placeholder:font-sans"
      />
      {busy ? (
        <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : value ? (
        <button type="button" onClick={() => onChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground" title="Clear search (Esc)" aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** "Clear column filters (n)" — shows only while a table has funnel filters on. */
function ClearFunnels({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" onClick={onClear} className="inline-flex items-center gap-1 rounded-md border border-blue-400/30 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/20" title="Remove every column (funnel) filter on this table">
      <X className="h-3 w-3" /> Clear column filters ({count})
    </button>
  );
}

/**
 * A notes box that grows as you type — wider first (up to maxRem), then onto
 * more lines — so a long note stays readable instead of scrolling out of view.
 */
function GrowingTextarea({
  value,
  onChange,
  minRem = 8,
  maxRem = 22,
  className = "",
  ...rest
}: { value: string; onChange: (v: string) => void; minRem?: number; maxRem?: number; className?: string } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "className">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const longestLine = Math.max(0, ...value.split("\n").map((line) => line.length));
  const width = `clamp(${minRem}rem, ${longestLine + 3}ch, ${maxRem}rem)`;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + border}px`;
  }, [value, width]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width }}
      className={`resize-none overflow-hidden align-top ${className}`}
      {...rest}
    />
  );
}

/**
 * Orders-table Notes cell: shows the start of the note (whole note on hover);
 * click it to open the full note in a bigger box and edit it there. Clicking
 * outside or Save keeps the change, Esc / Cancel drops it.
 */
function NotesCell({ value, label, onSave }: { value: string; label: string; onSave: (next: string) => void }) {
  const PANEL_W = 320;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    // Below the cell, or above it when there isn't room below.
    setPos(window.innerHeight - r.bottom < 240 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, []);

  const finish = useCallback(
    (save: boolean) => {
      setOpen(false);
      if (save && draft !== value) onSave(draft);
    },
    [draft, value, onSave]
  );

  const openPanel = () => {
    setDraft(value);
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      finish(true);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, finish, place]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? finish(true) : openPanel())}
        title={value ? `${value}\n\nClick to open the full note` : "Click to add a note"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="glass-input block w-32 truncate rounded px-2 py-0.5 text-left text-xs hover:border-blue-400/50"
      >
        {value || <span className="text-muted-foreground">—</span>}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={`Notes — ${label}`}
              style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: PANEL_W, zIndex: 9999 }}
              className="rounded-md border border-[var(--color-panel-border)] bg-[var(--color-card)] p-3 text-foreground shadow-2xl"
            >
              <div className="mb-1.5 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes · {label}</div>
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => {
                  const end = e.currentTarget.value.length;
                  e.currentTarget.setSelectionRange(end, end);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    finish(false);
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    finish(true);
                  }
                }}
                rows={6}
                placeholder="Add a note…"
                className="glass-input w-full resize-y rounded-md px-2 py-1.5 text-sm leading-relaxed"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">Ctrl+Enter save · Esc cancel</span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => finish(false)} className="btn px-2.5 py-1 text-xs">Cancel</button>
                  <button type="button" onClick={() => finish(true)} className="btn bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700">Save</button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/** The searched-for text, marked inside a cell (case-insensitive, first match). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-400/25 text-amber-200">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const emptyOrderDraft = () => ({
  orderExtId: "",
  partNo: "",
  quantity: 1,
  status: "Shipped" as string,
  orderEarnings: 0,
  orderDate: todayIso(),
  salesAccount: EBAY_SALES_ACCOUNTS[0] as string,
  branch: "", // backfilled once the company's branch/cents list loads — see the effect near the other loaders
  notes: "",
});

const emptyListingDraft = () => ({
  partNo: "",
  ebayAccount: EBAY_SALES_ACCOUNTS[0] as string,
  branch: "",
  price: 0,
  quantity: 1,
  listedDate: todayIso(),
  status: "Listed" as string,
});

export function PartsDailyReportEbay({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: "parts" } }));

  const [tab, setTab] = useState<Tab>("summary");
  const [startDate, setStartDate] = useState(daysAgoIso(6));
  const [endDate, setEndDate] = useState(todayIso());
  const [branchFilter, setBranchFilter] = useState<string[]>([]);
  const [branchFilterOpen, setBranchFilterOpen] = useState(false);
  const [branchFilterPos, setBranchFilterPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const branchFilterBtnRef = useRef<HTMLButtonElement>(null);
  const branchFilterPanelRef = useRef<HTMLDivElement>(null);
  const updateBranchFilterPos = useCallback(() => {
    const rect = branchFilterBtnRef.current?.getBoundingClientRect();
    if (rect) setBranchFilterPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);
  useEffect(() => {
    if (!branchFilterOpen) return;
    updateBranchFilterPos();
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!branchFilterBtnRef.current?.contains(t) && !branchFilterPanelRef.current?.contains(t)) setBranchFilterOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("scroll", updateBranchFilterPos, true);
    window.addEventListener("resize", updateBranchFilterPos);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("scroll", updateBranchFilterPos, true);
      window.removeEventListener("resize", updateBranchFilterPos);
    };
  }, [branchFilterOpen, updateBranchFilterPos]);
  const toggleBranchFilter = (branch: string) => {
    setBranchFilter((prev) => (prev.includes(branch) ? prev.filter((b) => b !== branch) : [...prev, branch]));
  };

  const [orders, setOrders] = useState<EbayOrderRow[]>([]);
  const [listings, setListings] = useState<EbayListingRow[]>([]);
  const [allActiveListings, setAllActiveListings] = useState<EbayListingRow[]>([]);
  const [branchSettings, setBranchSettings] = useState<EbayBranchSetting[]>([]);
  const [branchNotes, setBranchNotes] = useState<EbayBranchDailyNote[]>([]);
  const [branchStatusHistory, setBranchStatusHistory] = useState<EbayBranchStatusChange[]>([]);
  const [partsStaffNames, setPartsStaffNames] = useState<string[]>([]);
  const [ebayAccounts, setEbayAccounts] = useState<EbayAccount[]>([]);
  // Import Excel — the team's Google Sheets workbook (EbayImportModal).
  const [importOpen, setImportOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);

  const loadEbayAccounts = useCallback(() => {
    getEbayAccounts()
      .then(setEbayAccounts)
      .catch((err) => console.error("Failed to load eBay accounts:", err));
  }, []);
  useEffect(() => { loadEbayAccounts(); }, [loadEbayAccounts]);

  const ebayAccountNames = useMemo(
    () => (ebayAccounts.length > 0 ? ebayAccounts.map((a) => a.name) : EBAY_SALES_ACCOUNTS),
    [ebayAccounts]
  );

  const handleAddAccount = async () => {
    const name = newAccountName.trim();
    if (!name) return;
    setAddingAccount(true);
    setError(null);
    try {
      const created = await createEbayAccount(name);
      setEbayAccounts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewAccountName("");
    } catch (err) {
      setError(errMsg(err, "Failed to add eBay account"));
    } finally {
      setAddingAccount(false);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm("Delete this eBay account? Existing orders/listings that used it keep their text value.")) return;
    setEbayAccounts((prev) => prev.filter((a) => a.id !== id));
    try {
      await deleteEbayAccount(id);
    } catch (err) {
      setError(errMsg(err, "Failed to delete eBay account"));
      loadEbayAccounts();
    }
  };

  // The branches this whole feature offers (Orders/Listings branch pickers,
  // Assignments, Daily Branch Report, Total Listed by Branch) are exactly
  // the branches with a cent value here — company-managed on the
  // Assignments tab instead of a hardcoded list.
  const [branchCents, setBranchCents] = useState<EbayBranchCent[]>([]);
  const [newCentBranch, setNewCentBranch] = useState("");
  const [newCentValue, setNewCentValue] = useState<number>(0);
  const [addingBranchCent, setAddingBranchCent] = useState(false);

  const loadBranchCents = useCallback(() => {
    getEbayBranchCents()
      .then(setBranchCents)
      .catch((err) => console.error("Failed to load branch cent pricing:", err));
  }, []);
  useEffect(() => { loadBranchCents(); }, [loadBranchCents]);

  const branchCentMap = useMemo(() => Object.fromEntries(branchCents.map((b) => [b.branch, b.cents])), [branchCents]);
  const EBAY_BRANCHES = useMemo(() => branchCents.map((b) => b.branch).sort((a, b) => a.localeCompare(b)), [branchCents]);
  const branchesAvailableToAdd = useMemo(() => LOCATIONS.filter((l) => !(l in branchCentMap)), [branchCentMap]);

  const applyBranchCents = useCallback((price: number, branch: string) => applyCents(price, branchCentMap[branch]), [branchCentMap]);

  const handleAddBranchCent = async () => {
    const branch = newCentBranch || branchesAvailableToAdd[0];
    if (!branch) return;
    setAddingBranchCent(true);
    setError(null);
    try {
      await upsertEbayBranchCent(branch, newCentValue);
      setBranchCents((prev) => [...prev.filter((b) => b.branch !== branch), { branch, cents: newCentValue }].sort((a, b) => a.branch.localeCompare(b.branch)));
      setNewCentBranch("");
      setNewCentValue(0);
    } catch (err) {
      setError(errMsg(err, "Failed to add branch"));
    } finally {
      setAddingBranchCent(false);
    }
  };

  const handleUpdateBranchCent = async (branch: string, cents: number) => {
    setBranchCents((prev) => prev.map((b) => (b.branch === branch ? { ...b, cents } : b)));
    try {
      await upsertEbayBranchCent(branch, cents);
    } catch (err) {
      setError(errMsg(err, "Failed to update branch cents"));
      loadBranchCents();
    }
  };

  const handleDeleteBranchCent = async (branch: string) => {
    if (!confirm(`Remove ${branch}? It will no longer appear in the branch pickers.`)) return;
    setBranchCents((prev) => prev.filter((b) => b.branch !== branch));
    try {
      await deleteEbayBranchCent(branch);
    } catch (err) {
      setError(errMsg(err, "Failed to remove branch"));
      loadBranchCents();
    }
  };

  const loadBranchStatusHistory = useCallback(() => {
    getEbayBranchStatusHistory()
      .then(setBranchStatusHistory)
      .catch((err) => console.error("Failed to load branch status history:", err));
  }, []);
  useEffect(() => { loadBranchStatusHistory(); }, [loadBranchStatusHistory]);

  const loadActiveListings = useCallback(() => {
    getActiveEbayListings()
      .then(setAllActiveListings)
      .catch((err) => console.error("Failed to load active listings:", err));
  }, []);
  useEffect(() => { loadActiveListings(); }, [loadActiveListings]);

  const totalListedByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of allActiveListings) map.set(l.branch, (map.get(l.branch) || 0) + 1);
    // Union with EBAY_BRANCHES so every managed branch always shows (even
    // at 0), but any branch that actually has listings shows up too —
    // never silently drop real data just because it's outside that list.
    const allBranches = new Set([...EBAY_BRANCHES, ...map.keys()]);
    return Array.from(allBranches).map((branch) => ({ branch, count: map.get(branch) || 0 })).sort((a, b) => b.count - a.count);
  }, [allActiveListings]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompanyUsers()
      .then((profiles) => {
        const names = profiles
          .filter((p) => p.is_active && isPartsProfile(p))
          .map((p) => p.display_name || p.email)
          .filter((n): n is string => !!n);
        setPartsStaffNames(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
      })
      .catch((err) => console.error("Failed to load Parts staff:", err));
  }, []);

  const [orderDraft, setOrderDraft] = useState(emptyOrderDraft);
  const [listingDraft, setListingDraft] = useState(emptyListingDraft);

  // Once the real branch list loads, backfill the Add Order/Listing forms'
  // default branch (they start blank since this list isn't known yet at
  // module load time — see emptyOrderDraft/emptyListingDraft).
  useEffect(() => {
    if (EBAY_BRANCHES.length === 0) return;
    setOrderDraft((d) => (d.branch ? d : { ...d, branch: EBAY_BRANCHES[0] }));
    setListingDraft((d) => (d.branch ? d : { ...d, branch: EBAY_BRANCHES[0], price: applyBranchCents(0, EBAY_BRANCHES[0]) }));
  }, [EBAY_BRANCHES, applyBranchCents]);

  const [addingOrder, setAddingOrder] = useState(false);
  const [addingListing, setAddingListing] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  // Clicking a row's "Changed By" cell shows that row's full change
  // history — every field edit, newest first, each with its own
  // from/to values, actor, and timestamp.
  const [rowHistoryTarget, setRowHistoryTarget] = useState<{ id: string; label: string } | null>(null);
  const [rowHistoryEntries, setRowHistoryEntries] = useState<HrActivityLogEntry[]>([]);
  const [rowHistoryLoading, setRowHistoryLoading] = useState(false);
  const [rowHistoryError, setRowHistoryError] = useState<string | null>(null);
  const openRowHistory = (id: string, label: string) => {
    setRowHistoryTarget({ id, label });
    setRowHistoryLoading(true);
    setRowHistoryError(null);
    getActivityLog({ targetId: id, targetType: EBAY_ACTIVITY_TARGET_TYPE, limit: 100 })
      .then(setRowHistoryEntries)
      .catch((err) => setRowHistoryError(errMsg(err, "Failed to load history")))
      .finally(() => setRowHistoryLoading(false));
  };
  const rowHistoryFieldLabel = (entry: HrActivityLogEntry): string => {
    if (entry.action === "ebay_order_status_changed" || entry.action === "ebay_listing_status_changed") return "Status";
    const m = entry.targetLabel?.match(/\(([^)]+)\)\s*$/);
    return m?.[1] || activityActionLabel(entry.action);
  };

  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [activityLogEntries, setActivityLogEntries] = useState<HrActivityLogEntry[]>([]);
  const [activityLogLoading, setActivityLogLoading] = useState(false);
  const [activityLogError, setActivityLogError] = useState<string | null>(null);
  const openActivityLog = () => {
    setActivityLogOpen(true);
    setActivityLogLoading(true);
    setActivityLogError(null);
    getActivityLog({ targetType: EBAY_ACTIVITY_TARGET_TYPE, limit: 200 })
      .then(setActivityLogEntries)
      .catch((err) => setActivityLogError(errMsg(err, "Failed to load activity log")))
      .finally(() => setActivityLogLoading(false));
  };

  // Who most recently touched each Order/Listing row — one activity-log
  // fetch (already ordered newest-first), collapsed to the first entry
  // seen per row id, feeds the "Changed By" column on both tables.
  const [rowActivity, setRowActivity] = useState<HrActivityLogEntry[]>([]);
  const loadRowActivity = useCallback(() => {
    getActivityLog({ targetType: EBAY_ACTIVITY_TARGET_TYPE, limit: 500 })
      .then(setRowActivity)
      .catch((err) => console.error("Failed to load row activity:", err));
  }, []);
  useEffect(() => { loadRowActivity(); }, [loadRowActivity]);
  const changedByRowId = useMemo(() => {
    const map = new Map<string, HrActivityLogEntry>();
    for (const e of rowActivity) {
      if (e.targetId && !map.has(e.targetId)) map.set(e.targetId, e);
    }
    return map;
  }, [rowActivity]);

  // Snapshots of what's currently saved on the server, keyed by id — every
  // inline edit diffs against this (not the row object handed to the
  // onBlur handler, which by then already reflects the newly-typed value)
  // so "Changed By" logging compares the real before/after instead of a
  // value against itself.
  const originalOrdersRef = useRef<Map<string, EbayOrderRow>>(new Map());
  const originalListingsRef = useRef<Map<string, EbayListingRow>>(new Map());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getEbayOrders(startDate, endDate),
      getEbayListings(startDate, endDate),
      getEbayBranchSettings(),
      getEbayBranchDailyNotes(startDate, endDate),
    ])
      .then(([o, l, bs, bn]) => {
        setOrders(o);
        setListings(l);
        setBranchSettings(bs);
        setBranchNotes(bn);
        // Merge (not replace): rows shown by a search or the Date Added view
        // keep their saved snapshot, so their edits still log before → after.
        for (const r of o) originalOrdersRef.current.set(r.id, r);
        for (const r of l) originalListingsRef.current.set(r.id, r);
      })
      .catch((err) => setError(errMsg(err, String(err))))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const filteredOrders = useMemo(
    () => (branchFilter.length === 0 ? orders : orders.filter((o) => branchFilter.includes(o.branch))),
    [orders, branchFilter]
  );
  const filteredListings = useMemo(
    () => (branchFilter.length === 0 ? listings : listings.filter((l) => branchFilter.includes(l.branch))),
    [listings, branchFilter]
  );

  // ---------- Orders tab: "Dates by" Order Date / Date Added, and a search
  // by Order # or Part # across every date. ----------
  const [orderDateBasis, setOrderDateBasisState] = useState<OrderDateBasis>(() => {
    try {
      return localStorage.getItem(ORDER_DATE_BASIS_KEY) === "added" ? "added" : "order";
    } catch {
      return "order";
    }
  });
  const setOrderDateBasis = (b: OrderDateBasis) => {
    setOrderDateBasisState(b);
    try { localStorage.setItem(ORDER_DATE_BASIS_KEY, b); } catch { /* not remembered */ }
  };
  const [addedOrders, setAddedOrders] = useState<EbayOrderRow[]>([]);
  const [addedOrdersLoading, setAddedOrdersLoading] = useState(false);
  const loadAddedOrders = useCallback(() => {
    if (orderDateBasis !== "added") return;
    setAddedOrdersLoading(true);
    getEbayOrdersAddedBetween(startDate, endDate)
      .then((rows) => {
        for (const r of rows) originalOrdersRef.current.set(r.id, r);
        setAddedOrders(rows);
      })
      .catch((err) => setError(errMsg(err, "Failed to load orders by Date Added")))
      .finally(() => setAddedOrdersLoading(false));
  }, [orderDateBasis, startDate, endDate]);
  useEffect(() => { loadAddedOrders(); }, [loadAddedOrders]);

  const [orderQuery, setOrderQuery] = useState("");
  const [orderResults, setOrderResults] = useState<EbayOrderRow[] | null>(null);
  const [orderSearching, setOrderSearching] = useState(false);
  const [listingQuery, setListingQuery] = useState("");
  const [listingResults, setListingResults] = useState<EbayListingRow[] | null>(null);
  const [listingSearching, setListingSearching] = useState(false);
  const [listingStatusFilter, setListingStatusFilter] = useState<string>("all");
  // Bumped after a delete so an open search re-runs.
  const [searchNonce, setSearchNonce] = useState(0);

  useEffect(() => {
    const q = orderQuery.trim();
    if (!q) { setOrderResults(null); setOrderSearching(false); return; }
    setOrderSearching(true);
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchEbayOrders(q)
        .then((rows) => {
          if (cancelled) return;
          for (const r of rows) originalOrdersRef.current.set(r.id, r);
          setOrderResults(rows);
        })
        .catch((err) => { if (!cancelled) setError(errMsg(err, "Order search failed")); })
        .finally(() => { if (!cancelled) setOrderSearching(false); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [orderQuery, searchNonce]);

  useEffect(() => {
    const q = listingQuery.trim();
    if (!q) { setListingResults(null); setListingSearching(false); return; }
    setListingSearching(true);
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchEbayListings(q)
        .then((rows) => {
          if (cancelled) return;
          for (const r of rows) originalListingsRef.current.set(r.id, r);
          setListingResults(rows);
        })
        .catch((err) => { if (!cancelled) setError(errMsg(err, "Part # search failed")); })
        .finally(() => { if (!cancelled) setListingSearching(false); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [listingQuery, searchNonce]);

  const orderSearchOn = orderQuery.trim() !== "";
  const listingSearchOn = listingQuery.trim() !== "";
  const byBranch = <T extends { branch: string }>(rows: T[]) => (branchFilter.length === 0 ? rows : rows.filter((r) => branchFilter.includes(r.branch)));
  // Both tables lead with Date Added, so they list the most recently entered row first.
  const newestAddedFirst = <T extends { createdAt: string }>(rows: T[]) =>
    [...rows].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  // The Orders table: search hits (any date), else the range by Order Date or Date Added.
  const orderTableRows = useMemo(
    () => newestAddedFirst(byBranch(orderSearchOn ? orderResults ?? [] : orderDateBasis === "added" ? addedOrders : orders)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderSearchOn, orderResults, orderDateBasis, addedOrders, orders, branchFilter]
  );
  // The Listings table: search hits (any date) or the range, then the Status chips.
  const listingRowsBeforeStatus = useMemo(
    () => newestAddedFirst(byBranch(listingSearchOn ? listingResults ?? [] : listings)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listingSearchOn, listingResults, listings, branchFilter]
  );

  const totalEarnings = useMemo(
    () => filteredOrders.reduce((sum, o) => sum + o.orderEarnings, 0),
    [filteredOrders]
  );
  const soldListings = useMemo(() => filteredListings.filter((l) => l.status === "Sold").length, [filteredListings]);
  const activeListings = useMemo(() => filteredListings.filter((l) => l.status === "Listed").length, [filteredListings]);

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of filteredOrders) map.set(o.status, (map.get(o.status) || 0) + 1);
    return EBAY_ORDER_STATUSES.map((s) => ({ status: s, count: map.get(s) || 0 }));
  }, [filteredOrders]);

  const branchBreakdown = useMemo(() => {
    type Row = { branch: string; orders: number; earnings: number; listed: number } & Record<string, any>;
    const map = new Map<string, Row>();
    const ensure = (branch: string) => {
      if (!map.has(branch)) {
        const row: Row = { branch, orders: 0, earnings: 0, listed: 0 };
        for (const s of EBAY_ORDER_STATUSES) row[s] = 0;
        map.set(branch, row);
      }
      return map.get(branch)!;
    };
    for (const o of orders) {
      const row = ensure(o.branch || "—");
      row.orders += 1;
      row.earnings += o.orderEarnings;
      if (o.status in row) row[o.status] += 1;
    }
    for (const l of listings) {
      if (l.status === "Listed") ensure(l.branch || "—").listed += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.earnings - a.earnings);
  }, [orders, listings]);

  const settingsByBranch = useMemo(() => new Map(branchSettings.map((s) => [s.branch, s])), [branchSettings]);
  const notesByKey = useMemo(() => new Map(branchNotes.map((n) => [`${n.branch}|${n.noteDate}`, n.comment])), [branchNotes]);
  const dateList = useMemo(() => dateRangeList(startDate, endDate), [startDate, endDate]);

  // Each branch's dated status overrides, oldest first — resolveListingsStatus
  // walks these to find what was actually true on a given day, instead of
  // reading one shared "current" value for every day.
  const statusHistoryByBranch = useMemo(() => {
    const map = new Map<string, EbayBranchStatusChange[]>();
    for (const c of branchStatusHistory) {
      if (!map.has(c.branch)) map.set(c.branch, []);
      map.get(c.branch)!.push(c);
    }
    for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return map;
  }, [branchStatusHistory]);

  const resolveListingsStatus = useCallback((branch: string, date: string): string => {
    // Each day is independent — a status set on one date must never leak
    // into another date that was never explicitly set, so this looks for
    // an exact (branch, date) match only, no carrying forward.
    const exact = statusHistoryByBranch.get(branch)?.find((h) => h.date === date);
    return exact?.status || "All Listed";
  }, [statusHistoryByBranch]);

  const saveDailyListingsStatus = async (branch: string, date: string, status: string) => {
    setBranchStatusHistory((prev) => {
      const next = prev.filter((c) => !(c.branch === branch && c.date === date));
      next.push({ branch, date, status });
      return next;
    });
    try {
      await upsertEbayBranchDailyNote(branch, date, { listingsStatus: status });
      logActivity({
        action: "ebay_branch_daily_status_changed",
        targetType: EBAY_ACTIVITY_TARGET_TYPE,
        targetId: `${branch}|${date}`,
        targetLabel: `${branch} — ${date}`,
        details: { to: status },
      });
    } catch (err) {
      setError(errMsg(err, "Failed to save listings status"));
      loadBranchStatusHistory();
    }
  };

  // Regroups branches by whoever's currently assigned (Assignments tab),
  // so reassigning a branch there is all it takes — no code change needed.
  const dynamicGroups = useMemo(() => {
    const branches = branchFilter.length === 0 ? EBAY_BRANCHES : EBAY_BRANCHES.filter((b) => branchFilter.includes(b));
    const map = new Map<string, string[]>();
    for (const b of branches) {
      const assigned = (settingsByBranch.get(b)?.assignedTo || "").trim();
      const key = assigned || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      if (a[0] === "Unassigned") return 1;
      if (b[0] === "Unassigned") return -1;
      return a[0].localeCompare(b[0]);
    });
    return entries.map(([label, branches]) => ({ label, branches }));
  }, [settingsByBranch, branchFilter]);

  // The Daily Branch Report lists branches alphabetically (not clustered
  // by assigned person — that grouping lives in "By Assigned Person"
  // instead). EBAY_BRANCHES is already alphabetical.
  const dailyReportBranches = useMemo(
    () => (branchFilter.length === 0 ? EBAY_BRANCHES : EBAY_BRANCHES.filter((b) => branchFilter.includes(b))),
    [branchFilter, EBAY_BRANCHES]
  );

  // Same totals as "By Branch" (orders/earnings/listed), just regrouped by
  // whoever's assigned to each branch instead of by branch itself. Keeps
  // each person's own branch rows too, so the table can expand to show
  // the per-branch breakdown behind a person's total.
  const byPersonBreakdown = useMemo(() => {
    const branchByName = new Map(branchBreakdown.map((b) => [b.branch, b]));
    type StatusCounts = Record<string, number>;
    return dynamicGroups
      .map(({ label, branches }) => {
        const statuses: StatusCounts = {};
        for (const s of EBAY_ORDER_STATUSES) statuses[s] = 0;
        const row = { person: label, branches: branches.length, orders: 0, earnings: 0, listed: 0, statuses, branchRows: [] as { branch: string; orders: number; earnings: number; listed: number; statuses: StatusCounts }[] };
        for (const b of branches) {
          const stats = branchByName.get(b);
          const branchStatuses: StatusCounts = {};
          for (const s of EBAY_ORDER_STATUSES) {
            const v = stats?.[s] || 0;
            branchStatuses[s] = v;
            row.statuses[s] += v;
          }
          const branchRow = { branch: b, orders: stats?.orders || 0, earnings: stats?.earnings || 0, listed: stats?.listed || 0, statuses: branchStatuses };
          row.branchRows.push(branchRow);
          row.orders += branchRow.orders;
          row.earnings += branchRow.earnings;
          row.listed += branchRow.listed;
        }
        row.branchRows.sort((a, b) => b.earnings - a.earnings);
        return row;
      })
      .filter((r) => r.orders > 0 || r.earnings > 0 || r.listed > 0 || r.person !== "Unassigned")
      .sort((a, b) => b.earnings - a.earnings);
  }, [dynamicGroups, branchBreakdown]);

  const [expandedPersons, setExpandedPersons] = useState<Set<string>>(new Set());
  // Summary → By Assigned Person: a branch row clicked open — the orders and
  // Listed items behind that row's numbers (same range, so totals match).
  const [branchDetail, setBranchDetail] = useState<{ branch: string; person: string } | null>(null);
  useEffect(() => {
    if (!branchDetail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBranchDetail(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [branchDetail]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const togglePersonExpanded = (person: string) => {
    setExpandedPersons((prev) => {
      const next = new Set(prev);
      if (next.has(person)) next.delete(person); else next.add(person);
      return next;
    });
  };

  const dailyBranchTotals = useMemo(() => {
    const map = new Map<string, { salesQty: number; salesValue: number; returnQty: number; returnsValue: number }>();
    const ensure = (key: string) => {
      if (!map.has(key)) map.set(key, { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 });
      return map.get(key)!;
    };
    for (const o of orders) {
      const row = ensure(`${o.branch}|${o.orderDate}`);
      if (o.status === "Returned" || o.status === "Refunded") {
        row.returnQty += o.quantity;
        row.returnsValue -= o.orderEarnings;
      } else if (o.status === "Shipped") {
        row.salesQty += o.quantity;
        row.salesValue += o.orderEarnings;
      }
    }
    return map;
  }, [orders]);

  const getBranchSetting = (branch: string) =>
    settingsByBranch.get(branch) || { branch, assignedTo: "" };

  const setLocalBranchSetting = (branch: string, patch: Partial<Pick<EbayBranchSetting, "assignedTo">>) => {
    setBranchSettings((prev) => {
      const idx = prev.findIndex((s) => s.branch === branch);
      if (idx === -1) return [...prev, { branch, assignedTo: "", ...patch }];
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const saveBranchSetting = async (branch: string, patch: Partial<Pick<EbayBranchSetting, "assignedTo">>) => {
    try {
      await upsertEbayBranchSetting(branch, patch);
      if (patch.assignedTo !== undefined) {
        logActivity({
          action: "ebay_branch_assigned",
          targetType: EBAY_ACTIVITY_TARGET_TYPE,
          targetId: branch,
          targetLabel: branch,
          details: { to: patch.assignedTo || "(unassigned)" },
        });
      }
    } catch (err) {
      setError(errMsg(err, "Failed to save branch setting"));
    }
  };

  const getBranchNote = (branch: string, date: string) => notesByKey.get(`${branch}|${date}`) || "";

  const setLocalBranchNote = (branch: string, date: string, comment: string) => {
    setBranchNotes((prev) => {
      const idx = prev.findIndex((n) => n.branch === branch && n.noteDate === date);
      if (idx === -1) return [...prev, { branch, noteDate: date, comment, listingsStatus: null }];
      const next = [...prev];
      next[idx] = { ...next[idx], comment };
      return next;
    });
  };

  const saveBranchNote = async (branch: string, date: string, comment: string) => {
    try {
      await upsertEbayBranchDailyNote(branch, date, { comment });
    } catch (err) {
      setError(errMsg(err, "Failed to save comment"));
    }
  };

  const handleAddOrder = async () => {
    setAddingOrder(true);
    setError(null);
    try {
      const created = await createEbayOrder(orderDraft);
      setOrders((prev) => [created, ...prev]);
      loadAddedOrders();
      setOrderDraft({ ...emptyOrderDraft(), branch: orderDraft.branch });
      originalOrdersRef.current.set(created.id, created);
      await logActivity({
        action: "ebay_order_added",
        targetType: EBAY_ACTIVITY_TARGET_TYPE,
        targetId: created.id,
        targetLabel: `${created.branch} — ${created.partNo || created.orderExtId || created.id}`,
        details: { branch: created.branch, orderDate: created.orderDate, earnings: created.orderEarnings },
      });
      loadRowActivity();
    } catch (err) {
      setError(errMsg(err, "Failed to add order"));
    } finally {
      setAddingOrder(false);
    }
  };

  const handleAddListing = async () => {
    setAddingListing(true);
    setError(null);
    try {
      const created = await createEbayListing(listingDraft);
      setListings((prev) => [created, ...prev]);
      setListingDraft({ ...emptyListingDraft(), branch: listingDraft.branch, price: applyBranchCents(0, listingDraft.branch) });
      loadActiveListings();
      originalListingsRef.current.set(created.id, created);
      await logActivity({
        action: "ebay_listing_added",
        targetType: EBAY_ACTIVITY_TARGET_TYPE,
        targetId: created.id,
        targetLabel: `${created.branch} — ${created.partNo || created.id}`,
        details: { branch: created.branch, listedDate: created.listedDate, price: created.price },
      });
      loadRowActivity();
    } catch (err) {
      setError(errMsg(err, "Failed to add listing"));
    } finally {
      setAddingListing(false);
    }
  };

  // A row can be on screen from the date range, the Date Added view or a
  // search — keep every copy in step.
  const patchOrder = (id: string, patch: Partial<EbayOrderRow>) => {
    const apply = (rows: EbayOrderRow[]) => rows.map((o) => (o.id === id ? { ...o, ...patch } : o));
    setOrders(apply);
    setAddedOrders(apply);
    setOrderResults((prev) => (prev ? apply(prev) : prev));
  };
  const patchListing = (id: string, patch: Partial<EbayListingRow>) => {
    const apply = (rows: EbayListingRow[]) => rows.map((l) => (l.id === id ? { ...l, ...patch } : l));
    setListings(apply);
    setListingResults((prev) => (prev ? apply(prev) : prev));
  };

  const saveOrderField = async (row: EbayOrderRow, patch: Partial<EbayOrderRow>) => {
    setSavingRowId(row.id);
    try {
      await updateEbayOrder(row.id, patch);
      const before = originalOrdersRef.current.get(row.id) || row;
      const changes: { field: string; from: any; to: any }[] = [];
      for (const f of Object.keys(patch) as (keyof EbayOrderRow)[]) {
        const to = (patch as any)[f];
        if (before[f] !== to) changes.push({ field: f as string, from: before[f], to });
      }
      originalOrdersRef.current.set(row.id, { ...before, ...patch });
      if (changes.length > 0) {
        await Promise.all(changes.map((c) =>
          logActivity({
            action: c.field === "status" ? "ebay_order_status_changed" : "ebay_order_edited",
            targetType: EBAY_ACTIVITY_TARGET_TYPE,
            targetId: row.id,
            targetLabel: `${row.branch} — ${row.partNo || row.orderExtId || row.id}${c.field === "status" ? "" : ` (${ORDER_FIELD_LABELS[c.field] || c.field})`}`,
            details: { from: c.from, to: c.to },
          })
        ));
        loadRowActivity();
      }
    } catch (err) {
      setError(errMsg(err, "Failed to save order"));
    } finally {
      setSavingRowId(null);
    }
  };
  const saveListingField = async (row: EbayListingRow, patch: Partial<EbayListingRow>) => {
    setSavingRowId(row.id);
    try {
      await updateEbayListing(row.id, patch);
      if (patch.status !== undefined || patch.quantity !== undefined) loadActiveListings();
      const before = originalListingsRef.current.get(row.id) || row;
      const changes: { field: string; from: any; to: any }[] = [];
      for (const f of Object.keys(patch) as (keyof EbayListingRow)[]) {
        const to = (patch as any)[f];
        if (before[f] !== to) changes.push({ field: f as string, from: before[f], to });
      }
      originalListingsRef.current.set(row.id, { ...before, ...patch });
      if (changes.length > 0) {
        await Promise.all(changes.map((c) =>
          logActivity({
            action: c.field === "status" ? "ebay_listing_status_changed" : "ebay_listing_edited",
            targetType: EBAY_ACTIVITY_TARGET_TYPE,
            targetId: row.id,
            targetLabel: `${row.branch} — ${row.partNo || row.id}${c.field === "status" ? "" : ` (${LISTING_FIELD_LABELS[c.field] || c.field})`}`,
            details: { from: c.from, to: c.to },
          })
        ));
        loadRowActivity();
      }
    } catch (err) {
      setError(errMsg(err, "Failed to save listing"));
    } finally {
      setSavingRowId(null);
    }
  };

  const removeOrder = async (id: string) => {
    if (!confirm("Delete this order row?")) return;
    const row = [...orders, ...addedOrders, ...(orderResults ?? [])].find((o) => o.id === id);
    const drop = (rows: EbayOrderRow[]) => rows.filter((o) => o.id !== id);
    setOrders(drop);
    setAddedOrders(drop);
    setOrderResults((prev) => (prev ? drop(prev) : prev));
    try {
      await deleteEbayOrder(id);
      if (row) {
        logActivity({
          action: "ebay_order_deleted",
          targetType: EBAY_ACTIVITY_TARGET_TYPE,
          targetId: id,
          targetLabel: `${row.branch} — ${row.partNo || row.orderExtId || id}`,
        });
      }
    } catch (err) {
      setError(errMsg(err, "Failed to delete order"));
      load();
      loadAddedOrders();
      setSearchNonce((n) => n + 1);
    }
  };
  const removeListing = async (id: string) => {
    if (!confirm("Delete this listing row?")) return;
    const row = [...listings, ...(listingResults ?? [])].find((l) => l.id === id);
    const drop = (rows: EbayListingRow[]) => rows.filter((l) => l.id !== id);
    setListings(drop);
    setListingResults((prev) => (prev ? drop(prev) : prev));
    try {
      await deleteEbayListing(id);
      loadActiveListings();
      if (row) {
        logActivity({
          action: "ebay_listing_deleted",
          targetType: EBAY_ACTIVITY_TARGET_TYPE,
          targetId: id,
          targetLabel: `${row.branch} — ${row.partNo || id}`,
        });
      }
    } catch (err) {
      setError(errMsg(err, "Failed to delete listing"));
      load();
      setSearchNonce((n) => n + 1);
    }
  };

  // ---------- Edit modals — full-row edit with a per-field audit trail.
  // Each changed field gets its own activity log entry (from -> to), so
  // "who changed it" is answered by the existing View Activity log
  // instead of needing a new UI surface. ----------
  const [editingOrder, setEditingOrder] = useState<EbayOrderRow | null>(null);
  const [orderEditDraft, setOrderEditDraft] = useState<EbayOrderRow | null>(null);
  const [savingOrderEdit, setSavingOrderEdit] = useState(false);
  const openEditOrder = (o: EbayOrderRow) => { setEditingOrder(o); setOrderEditDraft({ ...o }); };

  const handleSaveOrderEdit = async () => {
    if (!editingOrder || !orderEditDraft) return;
    const fields = Object.keys(ORDER_FIELD_LABELS) as (keyof EbayOrderRow)[];
    const patch: Partial<EbayOrderRow> = {};
    const changes: { field: string; from: any; to: any }[] = [];
    for (const f of fields) {
      if (editingOrder[f] !== orderEditDraft[f]) {
        (patch as any)[f] = orderEditDraft[f];
        changes.push({ field: f as string, from: editingOrder[f], to: orderEditDraft[f] });
      }
    }
    if (changes.length === 0) { setEditingOrder(null); return; }
    setSavingOrderEdit(true);
    setError(null);
    try {
      await updateEbayOrder(editingOrder.id, patch);
      patchOrder(editingOrder.id, patch);
      originalOrdersRef.current.set(editingOrder.id, { ...editingOrder, ...patch });
      await Promise.all(changes.map((c) =>
        logActivity({
          action: "ebay_order_edited",
          targetType: EBAY_ACTIVITY_TARGET_TYPE,
          targetId: editingOrder.id,
          targetLabel: `${orderEditDraft.branch} — ${orderEditDraft.partNo || orderEditDraft.orderExtId || editingOrder.id} (${ORDER_FIELD_LABELS[c.field]})`,
          details: { from: c.from, to: c.to },
        })
      ));
      loadRowActivity();
      setEditingOrder(null);
    } catch (err) {
      setError(errMsg(err, "Failed to save order"));
    } finally {
      setSavingOrderEdit(false);
    }
  };

  const [editingListing, setEditingListing] = useState<EbayListingRow | null>(null);
  const [listingEditDraft, setListingEditDraft] = useState<EbayListingRow | null>(null);
  const [savingListingEdit, setSavingListingEdit] = useState(false);
  const openEditListing = (l: EbayListingRow) => { setEditingListing(l); setListingEditDraft({ ...l }); };

  const handleSaveListingEdit = async () => {
    if (!editingListing || !listingEditDraft) return;
    const fields = Object.keys(LISTING_FIELD_LABELS) as (keyof EbayListingRow)[];
    const patch: Partial<EbayListingRow> = {};
    const changes: { field: string; from: any; to: any }[] = [];
    for (const f of fields) {
      if (editingListing[f] !== listingEditDraft[f]) {
        (patch as any)[f] = listingEditDraft[f];
        changes.push({ field: f as string, from: editingListing[f], to: listingEditDraft[f] });
      }
    }
    if (changes.length === 0) { setEditingListing(null); return; }
    setSavingListingEdit(true);
    setError(null);
    try {
      await updateEbayListing(editingListing.id, patch);
      patchListing(editingListing.id, patch);
      if (patch.status !== undefined) loadActiveListings();
      originalListingsRef.current.set(editingListing.id, { ...editingListing, ...patch });
      await Promise.all(changes.map((c) =>
        logActivity({
          action: "ebay_listing_edited",
          targetType: EBAY_ACTIVITY_TARGET_TYPE,
          targetId: editingListing.id,
          targetLabel: `${listingEditDraft.branch} — ${listingEditDraft.partNo || editingListing.id} (${LISTING_FIELD_LABELS[c.field]})`,
          details: { from: c.from, to: c.to },
        })
      ));
      loadRowActivity();
      setEditingListing(null);
    } catch (err) {
      setError(errMsg(err, "Failed to save listing"));
    } finally {
      setSavingListingEdit(false);
    }
  };

  // ---------- Download Excel / PDF — same HTML-table-as-file convention
  // ReportHRDaily.tsx uses for every report export in this app (Blob +
  // "application/vnd.ms-excel" for Excel; an isolated print window for
  // PDF, since every browser's print dialog offers "Save as PDF"). ----------
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const loadLogoDataUrl = async (): Promise<string> => {
    try {
      const logoModule = await import("@/assets/logo.png");
      const res = await fetch(logoModule.default);
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return "";
    }
  };

  const openPrintWindow = (html: string) => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
    win.onafterprint = () => win.close();
  };

  const td = (content: string, align: "left" | "right" | "center" = "left", extra = "", colspan?: number) =>
    `<td${colspan ? ` colspan="${colspan}"` : ""} style="border:1px solid #e5e7eb;padding:6px;font-size:11px;text-align:${align};${extra}">${content}</td>`;
  const th = (content: string, align: "left" | "right" | "center" = "left") =>
    `<th style="background:#1e40af;color:white;font-weight:bold;border:1px solid #1e40af;padding:6px;font-size:11px;text-align:${align};">${escapeHtml(content)}</th>`;

  const periodLabel = () => `${startDate} to ${endDate}${branchFilter.length > 0 ? ` · ${branchFilter.join(", ")}` : ""}`;
  const REPORT_COLS = 5 + EBAY_ORDER_STATUSES.length; // widest section (By Assigned Person) sets the banner colspan

  const byPersonRowsHtml = (): string => {
    let rows = `<tr>${th("Person")}${th("Branches", "right")}${th("Orders", "right")}${th("Earnings", "right")}${EBAY_ORDER_STATUSES.map((s) => th(s, "right")).join("")}${th("Listed", "right")}</tr>`;
    if (byPersonBreakdown.length === 0) {
      rows += `<tr>${td("No data for this date range.", "center", "color:#6b7280;", REPORT_COLS)}</tr>`;
    } else {
      byPersonBreakdown.forEach((p, i) => {
        const bg = i % 2 === 1 ? "background:#f9fafb;" : "";
        rows +=
          `<tr>` +
          td(escapeHtml(p.person), "left", `${bg}font-weight:bold;`) +
          td(String(p.branches), "right", bg) +
          td(String(p.orders), "right", bg) +
          td(`$${p.earnings.toFixed(2)}`, "right", `${bg}color:#16a34a;font-weight:bold;`) +
          EBAY_ORDER_STATUSES.map((s) => td(String(p.statuses[s]), "right", bg)).join("") +
          td(String(p.listed), "right", `${bg}color:#0891b2;font-weight:bold;`) +
          `</tr>`;
      });
    }
    return rows;
  };
  const byPersonTableHtml = (): string => `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">${byPersonRowsHtml()}</table>`;

  // Shared by both PDF (wrapped per-date in its own <table>) and Excel
  // (all dates folded into the one master <table>) — `perDateTable`
  // picks which.
  const dailyBranchReportDates = (): { date: string; dateLabel: string; rows: string; totalsRow: string }[] =>
    dateList.map((date) => {
      let dayTotals = { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 };
      const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
      let rows = "";
      for (const branch of dailyReportBranches) {
        const t = dailyBranchTotals.get(`${branch}|${date}`) || { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 };
        dayTotals = {
          salesQty: dayTotals.salesQty + t.salesQty,
          salesValue: dayTotals.salesValue + t.salesValue,
          returnQty: dayTotals.returnQty + t.returnQty,
          returnsValue: dayTotals.returnsValue + t.returnsValue,
        };
        const note = getBranchNote(branch, date);
        const assignedTo = settingsByBranch.get(branch)?.assignedTo || "";
        rows +=
          `<tr>` +
          td(escapeHtml(branch), "left", "font-weight:bold;") +
          td(escapeHtml(assignedTo || "—")) +
          td(escapeHtml(resolveListingsStatus(branch, date))) +
          td(String(t.salesQty), "center") +
          td(`$${t.salesValue.toFixed(2)}`, "right", "color:#16a34a;font-weight:bold;") +
          td(String(t.returnQty), "center") +
          td(`$${t.returnsValue.toFixed(2)}`, "right", t.returnsValue < 0 ? "color:#dc2626;" : "") +
          td(escapeHtml(note || "—")) +
          `</tr>`;
      }
      const totalsRow =
        `<tr style="background:#f3f4f6;font-weight:bold;">` +
        td("Totals") + td("") + td("") +
        td(String(dayTotals.salesQty), "center") +
        td(`$${dayTotals.salesValue.toFixed(2)}`, "right", "color:#16a34a;") +
        td(String(dayTotals.returnQty), "center") +
        td(`$${dayTotals.returnsValue.toFixed(2)}`, "right", dayTotals.returnsValue < 0 ? "color:#dc2626;" : "") +
        td("") +
        `</tr>`;
      return { date, dateLabel, rows, totalsRow };
    });

  const dailyBranchHeaderRow = () => `<tr>${th("Branch")}${th("Assigned")}${th("Listings")}${th("Sales Qty", "center")}${th("Sales", "right")}${th("Return Qty", "center")}${th("Returns Value", "right")}${th("Comments")}</tr>`;

  const dailyBranchReportHtml = (): string => {
    const dates = dailyBranchReportDates();
    if (dates.length === 0) return `<p style="color:#6b7280;">No dates in range.</p>`;
    return dates
      .map(
        ({ dateLabel, rows, totalsRow }) =>
          `<div style="margin-bottom:16px;">` +
          `<div style="background:#1e40af;color:white;font-weight:bold;padding:6px 10px;font-size:12px;">${escapeHtml(dateLabel)}</div>` +
          `<table style="width:100%;border-collapse:collapse;">${dailyBranchHeaderRow()}${rows}${totalsRow}</table></div>`
      )
      .join("");
  };

  const downloadEbayReportExcel = () => {
    const dates = dailyBranchReportDates();
    let rows = "";
    rows += `<tr>${td("AHS SYSTEM", "left", "background:#1e40af;color:white;font-size:18px;font-weight:bold;padding:10px;", REPORT_COLS)}</tr>`;
    rows += `<tr>${td("Parts Daily Report — eBay", "left", "background:#1e40af;color:#e0e7ff;font-size:13px;padding:4px 10px 10px;", REPORT_COLS)}</tr>`;
    rows += `<tr>${td("Period", "left", "font-weight:bold;color:#1e40af;")}${td(escapeHtml(periodLabel()), "left", "", REPORT_COLS - 1)}</tr>`;
    rows += `<tr>${td("Generated", "left", "font-weight:bold;color:#1e40af;")}${td(escapeHtml(new Date().toLocaleString()), "left", "", REPORT_COLS - 1)}</tr>`;
    rows += `<tr>${td("&nbsp;", "left", "", REPORT_COLS)}</tr>`;
    rows += `<tr>${td("By Assigned Person (Totals for Range)", "left", "background:#1e40af;color:white;font-weight:bold;padding:8px;font-size:13px;", REPORT_COLS)}</tr>`;
    rows += byPersonRowsHtml();
    rows += `<tr>${td("&nbsp;", "left", "", REPORT_COLS)}</tr>`;
    rows += `<tr>${td("Daily Branch Report", "left", "background:#1e40af;color:white;font-weight:bold;padding:8px;font-size:13px;", REPORT_COLS)}</tr>`;
    if (dates.length === 0) {
      rows += `<tr>${td("No dates in range.", "center", "color:#6b7280;", REPORT_COLS)}</tr>`;
    } else {
      for (const { dateLabel, rows: dayRows, totalsRow } of dates) {
        rows += `<tr>${td(dateLabel, "left", "background:#1e3a8a;color:white;font-weight:bold;", REPORT_COLS)}</tr>`;
        rows += dailyBranchHeaderRow();
        rows += dayRows;
        rows += totalsRow;
        rows += `<tr>${td("&nbsp;", "left", "", REPORT_COLS)}</tr>`;
      }
    }
    const html = `
      <html><head><meta charset="UTF-8"></head><body>
        <table border="0" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">${rows}</table>
      </body></html>
    `;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parts-daily-report-ebay-${startDate}-to-${endDate}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadEbayReportPdf = async () => {
    const logoDataUrl = await loadLogoDataUrl();
    openPrintWindow(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Parts Daily Report — eBay</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: white; padding: 10px; color: #1f2937; }
            .container { max-width: 1400px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; padding: 20px; }
            .header { display: flex; gap: 15px; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 8px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); }
            .header img { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
            .header h1 { color: white; font-size: 22px; letter-spacing: 0.5px; }
            .header p { color: #e0e7ff; font-size: 12px; margin-top: 2px; }
            .info-section { display: flex; flex-direction: column; gap: 4px; background: #eff6ff; border-left: 4px solid #1e40af; padding: 12px 14px; border-radius: 4px; margin-bottom: 20px; }
            .info-section label { font-size: 11px; color: #1e40af; text-transform: uppercase; font-weight: 700; }
            .info-section span { font-size: 15px; font-weight: 600; color: #1f2937; }
            h2.section-title { font-size: 13px; font-weight: bold; color: #1e40af; margin: 18px 0 8px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; page-break-inside: avoid; }
            .footer { text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10px; }
            @media print {
              body { padding: 0; }
              .container { border: none; padding: 20px; }
              .header, td { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" />` : ""}
              <div>
                <h1>PARTS DAILY REPORT — EBAY</h1>
                <p>${escapeHtml(periodLabel())}</p>
              </div>
            </div>
            <div class="info-section">
              <label>Period</label>
              <span>${escapeHtml(periodLabel())}</span>
            </div>
            <h2 class="section-title">By Assigned Person (Totals for Range)</h2>
            ${byPersonTableHtml()}
            <h2 class="section-title">Daily Branch Report</h2>
            ${dailyBranchReportHtml()}
            <div class="footer">Generated by AHS System &middot; ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </body>
      </html>
    `);
  };

  // ---------- Funnel (column) filters on every table on this page ----------
  const money = (n: number) => `${n.toFixed(2)}`;
  const dayAdded = (iso: string) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? localISODate(d) : "";
  };
  const changedByName = (id: string) => changedByRowId.get(id)?.actorName || "";

  const orderFunnels = useColumnFunnels(orderTableRows, {
    "Order Date": (o) => o.orderDate,
    "Order ID": (o) => parseEbayOrderRef(o.orderExtId).display,
    "Part #": (o) => o.partNo,
    Qty: (o) => String(o.quantity),
    Status: (o) => o.status,
    Earnings: (o) => money(o.orderEarnings),
    Account: (o) => o.salesAccount,
    Branch: (o) => o.branch,
    Notes: (o) => o.notes,
    "Date Added": (o) => dayAdded(o.createdAt),
    "Changed By": (o) => changedByName(o.id),
  }, (o) => o.id);

  const listingFunnels = useColumnFunnels(listingRowsBeforeStatus, {
    "Listed Date": (l) => l.listedDate,
    "Part #": (l) => l.partNo,
    Account: (l) => l.ebayAccount,
    Branch: (l) => l.branch,
    Price: (l) => money(l.price),
    Qty: (l) => String(l.quantity),
    Status: (l) => l.status,
    "Date Added": (l) => dayAdded(l.createdAt),
    "Changed By": (l) => changedByName(l.id),
  }, (l) => l.id);
  // Status chips (All / Listed / Sold) count what the funnels leave, then narrow it.
  const listingStatusCounts = new Map<string, number>();
  for (const l of listingFunnels.visible) listingStatusCounts.set(l.status, (listingStatusCounts.get(l.status) || 0) + 1);
  const listingTableRows = listingStatusFilter === "all"
    ? listingFunnels.visible
    : listingFunnels.visible.filter((l) => l.status === listingStatusFilter || l.id === listingFunnels.pinned);

  type PersonRow = (typeof byPersonBreakdown)[number];
  const personFunnels = useColumnFunnels(byPersonBreakdown, {
    Person: (p) => p.person,
    Branches: (p) => String(p.branches),
    Orders: (p) => String(p.orders),
    Earnings: (p) => money(p.earnings),
    ...Object.fromEntries(EBAY_ORDER_STATUSES.map((st) => [st, (p: PersonRow) => String(p.statuses[st] ?? 0)])),
    Listed: (p) => String(p.listed),
  }, (p) => p.person);

  // Daily Branch Report: one funnel set across every day's table.
  const dailyRows = useMemo(
    () => dateList.flatMap((date) => dailyReportBranches.map((branch) => ({
      date,
      branch,
      t: dailyBranchTotals.get(`${branch}|${date}`) || { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 },
    }))),
    [dateList, dailyReportBranches, dailyBranchTotals]
  );
  const dailyFunnels = useColumnFunnels(dailyRows, {
    Branch: (r) => r.branch,
    Assigned: (r) => settingsByBranch.get(r.branch)?.assignedTo || "",
    Listings: (r) => resolveListingsStatus(r.branch, r.date),
    "Sales Qty": (r) => String(r.t.salesQty),
    Sales: (r) => money(r.t.salesValue),
    "Return Qty": (r) => String(r.t.returnQty),
    "Returns Value": (r) => money(r.t.returnsValue),
    Comments: (r) => getBranchNote(r.branch, r.date),
  }, (r) => `${r.branch}|${r.date}`);
  const dailyVisibleByDate = new Map<string, typeof dailyRows>();
  for (const r of dailyFunnels.visible) {
    const list = dailyVisibleByDate.get(r.date);
    if (list) list.push(r); else dailyVisibleByDate.set(r.date, [r]);
  }

  const assignFunnels = useColumnFunnels(EBAY_BRANCHES, {
    Branch: (b) => b,
    "Assigned To": (b) => getBranchSetting(b).assignedTo,
  }, (b) => b);
  const centFunnels = useColumnFunnels(branchCents, {
    Branch: (b) => b.branch,
    "Cents (.XX)": (b) => `.${String(b.cents).padStart(2, "0")}`,
  }, (b) => b.branch);

  // From the branch popup: jump to Orders / Listings showing exactly that branch.
  const openBranchIn = (where: "orders" | "listings", branch: string) => {
    setBranchDetail(null);
    if (where === "orders") {
      setOrderQuery("");
      setOrderDateBasis("order");
      orderFunnels.only("Branch", [branch]);
    } else {
      setListingQuery("");
      setListingStatusFilter("Listed");
      listingFunnels.only("Branch", [branch]);
    }
    setTab(where);
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [exportBusy, setExportBusy] = useState<"excel" | "pdf" | null>(null);
  const handleExport = async (format: "excel" | "pdf") => {
    setExportBusy(format);
    try {
      if (format === "excel") downloadEbayReportExcel();
      else await downloadEbayReportPdf();
    } catch (err) {
      setError(errMsg(err, `Failed to generate ${format === "excel" ? "Excel" : "PDF"} report`));
    } finally {
      setExportBusy(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 w-full min-w-0 px-4 lg:px-6 py-8">
      {importOpen && (
        <EbayImportModal
          accounts={ebayAccountNames}
          activityTargetType={EBAY_ACTIVITY_TARGET_TYPE}
          onClose={() => setImportOpen(false)}
          onImported={() => { load(); loadActiveListings(); loadAddedOrders(); }}
        />
      )}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={goBack} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={openActivityLog} className="btn hover:bg-white/15 inline-flex items-center gap-2 text-xs">
              <History className="h-3.5 w-3.5" /> View Activity
            </button>
            <button type="button" onClick={() => setImportOpen(true)} className="btn flex items-center gap-2 px-3 text-sm" title="Upload the team's eBay sheet (.xlsx) instead of typing it in">
              <FileSpreadsheet className="h-3.5 w-3.5 text-green-400" /> Import Excel
            </button>
            <button type="button" onClick={() => handleExport("excel")} disabled={exportBusy !== null} className="btn flex items-center gap-2 px-3 text-sm disabled:opacity-50">
              <FileSpreadsheet className="h-3.5 w-3.5" /> {exportBusy === "excel" ? "Generating…" : "Download Excel"}
            </button>
            <button type="button" onClick={() => handleExport("pdf")} disabled={exportBusy !== null} className="btn flex items-center gap-2 px-3 text-sm disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> {exportBusy === "pdf" ? "Generating…" : "Download PDF"}
            </button>
            <button type="button" onClick={() => window.print()} className="btn flex items-center gap-2 px-4">
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
          </div>
        </div>

        <div className="panel mb-4 border-l-4 border-l-blue-500/70">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md" />
            </div>
            <div className="flex flex-col gap-1 min-w-[220px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
              <button
                ref={branchFilterBtnRef}
                type="button"
                onClick={() => setBranchFilterOpen((o) => !o)}
                className="glass-input text-sm py-1.5 px-2 rounded-md flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {branchFilter.length === 0
                    ? "— All Branches —"
                    : branchFilter.length <= 2
                    ? branchFilter.join(", ")
                    : `${branchFilter.length} branches selected`}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${branchFilterOpen ? "rotate-180" : ""}`} />
              </button>
              {branchFilterOpen && branchFilterPos && createPortal(
                <div
                  ref={branchFilterPanelRef}
                  style={{ position: "fixed", top: branchFilterPos.top, left: branchFilterPos.left, width: branchFilterPos.width, zIndex: 999999 }}
                  className="max-h-72 overflow-y-auto rounded-md border border-white/10 bg-slate-900 shadow-2xl"
                >
                  <button
                    type="button"
                    onClick={() => setBranchFilter([])}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2 border-b border-white/10 ${branchFilter.length === 0 ? "text-blue-300 font-semibold" : ""}`}
                  >
                    <input type="checkbox" readOnly checked={branchFilter.length === 0} className="accent-blue-500" />
                    — All Branches —
                  </button>
                  {EBAY_BRANCHES.map((b) => (
                    <label key={b} className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={branchFilter.includes(b)} onChange={() => toggleBranchFilter(b)} className="accent-blue-500" />
                      {b}
                    </label>
                  ))}
                </div>,
                document.body
              )}
            </div>
          </div>
        </div>

        <div ref={tabsRef} className="flex gap-2 mb-4 scroll-mt-4">
          {(["summary", "orders", "listings", "assignments"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-semibold capitalize transition-colors ${
                tab === t ? "bg-blue-600 text-white" : "bg-white/5 text-muted-foreground hover:bg-white/10"
              }`}
            >
              {t === "summary" ? "Summary" : t === "orders" ? "Orders" : t === "listings" ? "Listings" : "Assignments"}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground mb-3">Loading…</p>}

        {tab === "summary" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="panel border-l-4 border-l-blue-500 bg-blue-500/5 flex items-center gap-3">
                <div className="rounded-full bg-blue-500/15 p-2"><Package className="h-4 w-4 text-blue-400" /></div>
                <div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Orders</div><div className="text-2xl font-bold text-blue-400">{filteredOrders.length}</div></div>
              </div>
              <div className="panel border-l-4 border-l-green-500 bg-green-500/5 flex items-center gap-3">
                <div className="rounded-full bg-green-500/15 p-2"><DollarSign className="h-4 w-4 text-green-400" /></div>
                <div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Total Earnings</div><div className="text-2xl font-bold text-green-400">${totalEarnings.toFixed(2)}</div></div>
              </div>
              <div className="panel border-l-4 border-l-cyan-500 bg-cyan-500/5 flex items-center gap-3">
                <div className="rounded-full bg-cyan-500/15 p-2"><Tag className="h-4 w-4 text-cyan-400" /></div>
                <div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Active Listings</div><div className="text-2xl font-bold text-cyan-400">{activeListings}</div></div>
              </div>
              <div className="panel border-l-4 border-l-purple-500 bg-purple-500/5 flex items-center gap-3">
                <div className="rounded-full bg-purple-500/15 p-2"><CheckCircle2 className="h-4 w-4 text-purple-400" /></div>
                <div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Sold Listings</div><div className="text-2xl font-bold text-purple-400">{soldListings}</div></div>
              </div>
            </div>

            <div className="panel border-l-4 border-l-amber-500">
              <h2 className="text-sm font-semibold mb-3 text-amber-300">Orders by Status</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {statusBreakdown.map(({ status, count }) => {
                  const tone = ORDER_STATUS_TONE[status] || ORDER_STATUS_TONE.Pending;
                  return (
                    <div key={status} className={`rounded-md border px-3 py-2 ${tone.border} ${tone.bg}`}>
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{status}</div>
                      <div className={`text-lg font-bold ${tone.text}`}>{count}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel p-0 border-l-4 border-l-pink-500">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 mb-2">
                <h2 className="text-sm font-semibold text-pink-300 flex items-center gap-2"><Users className="h-4 w-4" /> By Assigned Person (totals for range)</h2>
                <ClearFunnels count={personFunnels.activeCount} onClear={personFunnels.clear} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {[
                        { h: "Person", align: "text-left" },
                        { h: "Branches", align: "text-right" },
                        { h: "Orders", align: "text-right" },
                        { h: "Earnings", align: "text-right" },
                        ...EBAY_ORDER_STATUSES.map((st) => ({ h: st as string, align: "text-right" })),
                        { h: "Listed", align: "text-right" },
                      ].map(({ h, align }) => (
                        <th key={h} className={`px-3 py-2 ${align} font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap`}>
                          <span className="inline-flex items-center">{h}{personFunnels.funnel(h)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {personFunnels.visible.length === 0 ? (
                      <tr><td colSpan={5 + EBAY_ORDER_STATUSES.length} className="px-3 py-6 text-center text-muted-foreground">{byPersonBreakdown.length === 0 ? "No data for this date range." : "Nobody matches the column filters."}</td></tr>
                    ) : (
                      personFunnels.visible.map((p) => {
                        const isOpen = expandedPersons.has(p.person);
                        return (
                          <Fragment key={p.person}>
                            <tr className="border-b border-white/5 hover:bg-white/5 cursor-pointer select-none" onClick={() => togglePersonExpanded(p.person)}>
                              <td className="px-3 py-2 font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                  {p.person === "Unassigned" ? <span className="text-muted-foreground">Unassigned</span> : p.person}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{p.branches}</td>
                              <td className="px-3 py-2 text-right">{p.orders}</td>
                              <td className="px-3 py-2 text-right font-medium text-green-400">${p.earnings.toFixed(2)}</td>
                              {EBAY_ORDER_STATUSES.map((s) => (
                                <td key={s} className="px-3 py-2 text-right">{p.statuses[s]}</td>
                              ))}
                              <td className="px-3 py-2 text-right font-medium text-cyan-400">{p.listed}</td>
                            </tr>
                            {isOpen && p.branchRows.map((b) => (
                              <tr
                                key={`${p.person}-${b.branch}`}
                                className="border-b border-white/5 bg-white/[0.02] cursor-pointer hover:bg-blue-500/10"
                                onClick={() => setBranchDetail({ branch: b.branch, person: p.person })}
                                title={`See the orders and listings behind ${b.branch}'s numbers`}
                              >
                                <td className="px-3 py-2 pl-10">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setBranchDetail({ branch: b.branch, person: p.person }); }}
                                    className="text-blue-300/90 underline-offset-2 hover:text-blue-200 hover:underline"
                                  >
                                    {b.branch}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-right"></td>
                                <td className="px-3 py-2 text-right text-muted-foreground">{b.orders}</td>
                                <td className="px-3 py-2 text-right text-green-400/80">${b.earnings.toFixed(2)}</td>
                                {EBAY_ORDER_STATUSES.map((s) => (
                                  <td key={s} className="px-3 py-2 text-right text-muted-foreground">{b.statuses[s]}</td>
                                ))}
                                <td className="px-3 py-2 text-right text-cyan-400/80">{b.listed}</td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 className="text-sm font-semibold text-teal-300 flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Daily Branch Report</h2>
                <ClearFunnels count={dailyFunnels.activeCount} onClear={dailyFunnels.clear} />
              </div>
              {dateList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Pick a valid date range to see the daily branch report.</p>
              ) : (
                <div className="space-y-4">
                  {dateList.map((date) => {
                    // This day's rows the column filters leave — Totals add up just those.
                    const dayRows = dailyVisibleByDate.get(date) ?? [];
                    const dayTotals = { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 };
                    for (const { t } of dayRows) {
                      dayTotals.salesQty += t.salesQty;
                      dayTotals.salesValue += t.salesValue;
                      dayTotals.returnQty += t.returnQty;
                      dayTotals.returnsValue += t.returnsValue;
                    }
                    return (
                      <div key={date} className="panel p-0 overflow-hidden border-l-4 border-l-teal-500">
                        <div className="px-4 py-2 bg-teal-500/10 border-b border-white/10 font-semibold text-sm text-teal-300">
                          {new Date(date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" })}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-white/10 bg-white/5">
                                {[
                                  { h: "Branch", align: "text-left" },
                                  { h: "Assigned", align: "text-left" },
                                  { h: "Listings", align: "text-left" },
                                  { h: "Sales Qty", align: "text-center" },
                                  { h: "Sales", align: "text-right" },
                                  { h: "Return Qty", align: "text-center" },
                                  { h: "Returns Value", align: "text-right" },
                                  { h: "Comments", align: "text-left" },
                                ].map(({ h, align }) => (
                                  <th key={h} className={`px-2 py-2 ${align} text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap`}>
                                    <span className="inline-flex items-center">{h}{dailyFunnels.funnel(h)}</span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {dayRows.length === 0 ? (
                                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{dailyReportBranches.length === 0 ? "No branches match this filter." : "No branches match the column filters on this day."}</td></tr>
                              ) : (
                                dayRows.map(({ branch, t }) => {
                                  const assignedTo = settingsByBranch.get(branch)?.assignedTo || "";
                                  return (
                                    <tr key={branch} className="border-b border-white/5 hover:bg-white/5" {...dailyFunnels.rowPin(`${branch}|${date}`)}>
                                      <td className="px-2 py-2 font-medium whitespace-nowrap">{branch}</td>
                                      <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                                        {assignedTo || "—"}
                                      </td>
                                      <td className="px-2 py-2">
                                        <select
                                          value={resolveListingsStatus(branch, date)}
                                          onChange={(e) => saveDailyListingsStatus(branch, date, e.target.value)}
                                          className="glass-input text-xs py-0.5 px-1.5 rounded"
                                          title="Applies to this day only"
                                        >
                                          {EBAY_LISTINGS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                      </td>
                                      <td className="px-2 py-2 text-center">{t.salesQty}</td>
                                      <td className="px-2 py-2 text-right font-medium text-green-400">${t.salesValue.toFixed(2)}</td>
                                      <td className="px-2 py-2 text-center">{t.returnQty}</td>
                                      <td className={`px-2 py-2 text-right font-medium ${t.returnsValue < 0 ? "text-red-400" : "text-muted-foreground"}`}>${t.returnsValue.toFixed(2)}</td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getBranchNote(branch, date)}
                                          placeholder="—"
                                          onChange={(e) => setLocalBranchNote(branch, date, e.target.value)}
                                          onBlur={(e) => saveBranchNote(branch, date, e.target.value)}
                                          className="glass-input text-xs py-0.5 px-2 rounded w-full min-w-[160px]"
                                        />
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                            {dayRows.length > 0 && (
                              <tfoot>
                                <tr className="border-t border-white/10 bg-white/5 font-semibold">
                                  <td className="px-2 py-2">Totals</td>
                                  <td className="px-2 py-2"></td>
                                  <td className="px-2 py-2"></td>
                                  <td className="px-2 py-2 text-center">{dayTotals.salesQty}</td>
                                  <td className="px-2 py-2 text-right text-green-400">${dayTotals.salesValue.toFixed(2)}</td>
                                  <td className="px-2 py-2 text-center">{dayTotals.returnQty}</td>
                                  <td className={`px-2 py-2 text-right ${dayTotals.returnsValue < 0 ? "text-red-400" : ""}`}>${dayTotals.returnsValue.toFixed(2)}</td>
                                  <td className="px-2 py-2"></td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {(() => {
                const fullRange = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
                return fullRange > dateList.length ? (
                  <p className="text-xs text-muted-foreground mt-2">Showing the first {dateList.length} days of this range — narrow the dates to see the rest.</p>
                ) : null;
              })()}
            </div>
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-4">
            <div className="panel border-l-4 border-l-blue-500">
              <h2 className="text-sm font-semibold mb-3 text-blue-300 flex items-center gap-2"><Plus className="h-4 w-4" /> Add Order</h2>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Order ID (or pasted eBay link)">
                  <input placeholder="e.g. 03-12345-67890" value={orderDraft.orderExtId} onChange={(e) => setOrderDraft((d) => ({ ...d, orderExtId: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-36" />
                </Field>
                <Field label="Part #">
                  <input placeholder="Part number" value={orderDraft.partNo} onChange={(e) => setOrderDraft((d) => ({ ...d, partNo: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
                </Field>
                <Field label="Qty">
                  <input type="number" min={1} value={orderDraft.quantity} onChange={(e) => setOrderDraft((d) => ({ ...d, quantity: Number(e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-20" />
                </Field>
                <Field label="Status">
                  <select value={orderDraft.status} onChange={(e) => setOrderDraft((d) => ({ ...d, status: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                    {EBAY_ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Earnings ($)">
                  <input type="number" step="0.01" value={orderDraft.orderEarnings} onChange={(e) => setOrderDraft((d) => ({ ...d, orderEarnings: Number(e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-28 text-green-400 font-medium" />
                </Field>
                <Field label="Order Date">
                  <input type="date" value={orderDraft.orderDate} onChange={(e) => setOrderDraft((d) => ({ ...d, orderDate: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md" />
                </Field>
                <Field label="eBay Account">
                  <select value={orderDraft.salesAccount} onChange={(e) => setOrderDraft((d) => ({ ...d, salesAccount: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                    {ebayAccountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Branch">
                  <select value={orderDraft.branch} onChange={(e) => setOrderDraft((d) => ({ ...d, branch: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                    {EBAY_BRANCHES.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Notes">
                  <GrowingTextarea placeholder="Optional" value={orderDraft.notes} onChange={(v) => setOrderDraft((d) => ({ ...d, notes: v }))} className="glass-input text-sm py-1.5 px-2 rounded-md" />
                </Field>
                <button onClick={handleAddOrder} disabled={addingOrder} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {addingOrder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                </button>
              </div>
            </div>

            <div className="panel p-0 border-l-4 border-l-slate-500">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 px-3 py-2.5">
                <TableSearch value={orderQuery} onChange={setOrderQuery} placeholder="Search order # or part #" busy={orderSearching} className="w-full sm:w-72" />
                <div
                  role="group"
                  aria-label="Which date the Start / End range filters by"
                  className={`inline-flex items-center rounded-md border border-white/10 bg-white/5 p-0.5 text-xs ${orderSearchOn ? "opacity-40" : ""}`}
                  title={orderSearchOn ? "Searching looks at every date — clear the search to use the date range again" : "Which date the Start / End range above filters this table by"}
                >
                  <span className="px-2 font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">Dates by</span>
                  {(["order", "added"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      disabled={orderSearchOn}
                      aria-pressed={orderDateBasis === b}
                      onClick={() => setOrderDateBasis(b)}
                      className={`rounded px-2.5 py-1 font-semibold transition-colors disabled:cursor-not-allowed ${orderDateBasis === b ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-white/10"}`}
                    >
                      {b === "order" ? "Order Date" : "Date Added"}
                    </button>
                  ))}
                </div>
                {addedOrdersLoading && orderDateBasis === "added" && !orderSearchOn && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                <ClearFunnels count={orderFunnels.activeCount} onClear={orderFunnels.clear} />
                <p className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {orderSearchOn
                    ? orderResults === null
                      ? "Searching every date…"
                      : `${orderFunnels.visible.length} ${orderFunnels.visible.length === 1 ? "match" : "matches"} on any date${orderResults.length >= EBAY_SEARCH_LIMIT ? ` — first ${EBAY_SEARCH_LIMIT} shown, type more of the number` : ""}`
                    : `${orderFunnels.visible.length} ${orderFunnels.visible.length === 1 ? "order" : "orders"} ${orderDateBasis === "added" ? "added" : "dated"} ${startDate} to ${endDate}`}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {[
                        { h: "Date Added", align: "text-left" },
                        { h: "Order Date", align: "text-left" },
                        { h: "Order ID", align: "text-left" },
                        { h: "Part #", align: "text-left" },
                        { h: "Qty", align: "text-center" },
                        { h: "Status", align: "text-left" },
                        { h: "Earnings", align: "text-right" },
                        { h: "Account", align: "text-left" },
                        { h: "Branch", align: "text-left" },
                        { h: "Notes", align: "text-left" },
                        { h: "Changed By", align: "text-left" },
                        { h: "", align: "text-center" },
                      ].map(({ h, align }) => {
                        // The column the date range is filtering on reads in blue.
                        const active = !orderSearchOn && ((h === "Order Date" && orderDateBasis === "order") || (h === "Date Added" && orderDateBasis === "added"));
                        return (
                          <th key={h || "actions"} className={`px-2 py-3 ${align} text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${active ? "text-blue-300" : "text-muted-foreground"}`}>
                            {h ? <span className="inline-flex items-center">{h}{orderFunnels.funnel(h)}</span> : null}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {orderFunnels.visible.length === 0 ? (
                      <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">
                        {orderSearchOn && orderResults === null
                          ? "Searching every date…"
                          : orderTableRows.length > 0
                          ? "No orders match the column filters."
                          : orderSearchOn
                          ? `No order # or part # matching “${orderQuery.trim()}” on any date.`
                          : "No orders match these filters."}
                      </td></tr>
                    ) : (
                      orderFunnels.visible.map((o) => (
                        <tr key={o.id} className="border-b border-white/5 hover:bg-white/5" {...orderFunnels.rowPin(o.id)}>
                          <td className="px-2 py-2 whitespace-nowrap">{formatDateAdded(o.createdAt)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{o.orderDate}</td>
                          <td className="px-2 py-2 font-mono whitespace-nowrap">
                            {(() => {
                              const ref = parseEbayOrderRef(o.orderExtId);
                              return ref.href ? (
                                <a href={ref.href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2" title="Open this order on eBay">
                                  <Highlight text={ref.display} query={orderQuery} />
                                </a>
                              ) : (
                                "—"
                              );
                            })()}
                          </td>
                          <td className="px-2 py-2 font-mono whitespace-nowrap">{o.partNo ? <Highlight text={o.partNo} query={orderQuery} /> : "—"}</td>
                          <td className="px-2 py-2 text-center">
                            <input type="number" value={o.quantity} onChange={(e) => patchOrder(o.id, { quantity: Number(e.target.value) })} onBlur={() => saveOrderField(o, { quantity: o.quantity })} className="glass-input text-xs py-0.5 px-1.5 rounded w-14 text-center" />
                          </td>
                          <td className="px-2 py-2">
                            <select value={o.status} onChange={(e) => { patchOrder(o.id, { status: e.target.value }); saveOrderField(o, { status: e.target.value }); }} className="glass-input text-xs py-0.5 px-1.5 rounded">
                              {EBAY_ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2 text-right">
                            <input type="number" step="0.01" value={o.orderEarnings} onChange={(e) => patchOrder(o.id, { orderEarnings: Number(e.target.value) })} onBlur={() => saveOrderField(o, { orderEarnings: o.orderEarnings })} className="glass-input text-xs py-0.5 px-1.5 rounded w-20 text-right font-medium text-green-400" />
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">{o.salesAccount}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{o.branch}</td>
                          <td className="px-2 py-2">
                            <NotesCell
                              value={o.notes}
                              label={parseEbayOrderRef(o.orderExtId).display || o.partNo || "Order"}
                              onSave={(next) => {
                                patchOrder(o.id, { notes: next });
                                void saveOrderField(o, { notes: next });
                              }}
                            />
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {(() => {
                              const entry = changedByRowId.get(o.id);
                              return entry ? (
                                <button type="button" onClick={() => openRowHistory(o.id, `${o.branch} — ${o.partNo || o.orderExtId || o.id}`)} className="text-blue-300 hover:text-blue-200 hover:underline" title={`${activityActionLabel(entry.action)} · ${new Date(entry.createdAt).toLocaleString()}`}>
                                  {entry.actorName || "Unknown"}
                                </button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              );
                            })()}
                          </td>
                          <td className="px-2 py-2 text-center whitespace-nowrap">
                            {savingRowId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : (
                              <span className="inline-flex items-center gap-2">
                                <button onClick={() => openEditOrder(o)} className="text-blue-400 hover:text-blue-300" title="Edit this order"><Pencil className="h-3.5 w-3.5" /></button>
                                <button onClick={() => removeOrder(o.id)} className="text-red-400 hover:text-red-300" title="Delete this order"><Trash2 className="h-3.5 w-3.5" /></button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "listings" && (
          <div className="space-y-4">
            <div className="panel border-l-4 border-l-purple-500">
              <h2 className="text-sm font-semibold mb-3 text-purple-300 flex items-center gap-2"><Plus className="h-4 w-4" /> Add Listing</h2>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Part #">
                  <input placeholder="Part number" value={listingDraft.partNo} onChange={(e) => setListingDraft((d) => ({ ...d, partNo: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
                </Field>
                <Field label="eBay Account">
                  <select value={listingDraft.ebayAccount} onChange={(e) => setListingDraft((d) => ({ ...d, ebayAccount: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                    {ebayAccountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Branch">
                  <select value={listingDraft.branch} onChange={(e) => setListingDraft((d) => ({ ...d, branch: e.target.value, price: applyBranchCents(d.price, e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                    {EBAY_BRANCHES.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label={branchCentMap[listingDraft.branch] !== undefined ? `Price ($ — cents auto-set to .${branchCentMap[listingDraft.branch]})` : "Price ($)"}>
                  <input type="number" step="0.01" value={listingDraft.price} onChange={(e) => setListingDraft((d) => ({ ...d, price: applyBranchCents(Number(e.target.value), d.branch) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-24 text-green-400 font-medium" />
                </Field>
                <Field label="Qty">
                  <input type="number" min={1} value={listingDraft.quantity} onChange={(e) => setListingDraft((d) => ({ ...d, quantity: Number(e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-20 text-cyan-400 font-medium" />
                </Field>
                <Field label="Listed Date">
                  <input type="date" value={listingDraft.listedDate} onChange={(e) => setListingDraft((d) => ({ ...d, listedDate: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md" />
                </Field>
                <Field label="Status">
                  <select value={listingDraft.status} onChange={(e) => setListingDraft((d) => ({ ...d, status: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                    {EBAY_LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <button onClick={handleAddListing} disabled={addingListing} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {addingListing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                </button>
              </div>
            </div>

            <div className="panel p-0 border-l-4 border-l-teal-500">
              <h2 className="text-sm font-semibold px-4 pt-3 text-teal-300 flex items-center gap-2"><ListChecks className="h-4 w-4" /> Total Listed by Branch</h2>
              <p className="text-xs text-muted-foreground px-4 pb-2">All currently-Listed items, regardless of the date range above — a listing stays counted until it's marked Sold or removed.</p>
              <div className="max-h-48 overflow-y-auto px-4 pb-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
                  {totalListedByBranch.map(({ branch, count }) => (
                    <div key={branch} className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${count > 0 ? "border-teal-500/30 bg-teal-500/5" : "border-white/10 bg-white/5"}`}>
                      <span className="text-muted-foreground truncate" title={branch}>{branch}</span>
                      <span className={`font-semibold ${count > 0 ? "text-teal-300" : "text-muted-foreground"}`}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel p-0 border-l-4 border-l-slate-500">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 px-3 py-2.5">
                <TableSearch value={listingQuery} onChange={setListingQuery} placeholder="Search part #" busy={listingSearching} className="w-full sm:w-72" />
                <div role="group" aria-label="Show listings by status" className="inline-flex items-center rounded-md border border-white/10 bg-white/5 p-0.5 text-xs">
                  {(["all", ...EBAY_LISTING_STATUSES] as string[]).map((s) => {
                    const n = s === "all" ? listingFunnels.visible.length : listingStatusCounts.get(s) || 0;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={listingStatusFilter === s}
                        onClick={() => setListingStatusFilter(s)}
                        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-semibold transition-colors ${listingStatusFilter === s ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-white/10"}`}
                      >
                        {s === "all" ? "All" : s}
                        <span className={`tabular-nums ${listingStatusFilter === s ? "text-blue-100" : "text-muted-foreground/70"}`}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                <ClearFunnels count={listingFunnels.activeCount} onClear={listingFunnels.clear} />
                <p className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {listingSearchOn
                    ? listingResults === null
                      ? "Searching every date…"
                      : `${listingTableRows.length} ${listingTableRows.length === 1 ? "match" : "matches"} on any date${listingResults.length >= EBAY_SEARCH_LIMIT ? ` — first ${EBAY_SEARCH_LIMIT} shown, type more of the part #` : ""}`
                    : `${listingTableRows.length} ${listingTableRows.length === 1 ? "listing" : "listings"} listed ${startDate} to ${endDate}`}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {[
                        { h: "Date Added", align: "text-left" },
                        { h: "Listed Date", align: "text-left" },
                        { h: "Part #", align: "text-left" },
                        { h: "Account", align: "text-left" },
                        { h: "Branch", align: "text-left" },
                        { h: "Price", align: "text-right" },
                        { h: "Qty", align: "text-center" },
                        { h: "Status", align: "text-left" },
                        { h: "Changed By", align: "text-left" },
                        { h: "", align: "text-center" },
                      ].map(({ h, align }) => (
                        <th key={h || "actions"} className={`px-2 py-3 ${align} text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap`}>
                          {h ? <span className="inline-flex items-center">{h}{listingFunnels.funnel(h)}</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listingTableRows.length === 0 ? (
                      <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                        {listingSearchOn
                          ? listingResults === null
                            ? "Searching every date…"
                            : listingRowsBeforeStatus.length > 0
                            ? "No matches pass the status / column filters."
                            : `No listing with a part # matching “${listingQuery.trim()}” on any date.`
                          : listingRowsBeforeStatus.length > 0
                          ? "No listings match the status / column filters."
                          : "No listings match these filters."}
                      </td></tr>
                    ) : (
                      listingTableRows.map((l) => (
                        <tr key={l.id} className="border-b border-white/5 hover:bg-white/5" {...listingFunnels.rowPin(l.id)}>
                          <td className="px-2 py-2 whitespace-nowrap">{formatDateAdded(l.createdAt)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{l.listedDate}</td>
                          <td className="px-2 py-2 font-mono whitespace-nowrap">{l.partNo ? <Highlight text={l.partNo} query={listingQuery} /> : "—"}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{l.ebayAccount}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{l.branch}</td>
                          <td className="px-2 py-2 text-right">
                            <input type="number" step="0.01" value={l.price} onChange={(e) => patchListing(l.id, { price: applyBranchCents(Number(e.target.value), l.branch) })} onBlur={() => saveListingField(l, { price: l.price })} className="glass-input text-xs py-0.5 px-1.5 rounded w-20 text-right font-medium text-green-400" title={branchCentMap[l.branch] !== undefined ? `Cents auto-set to .${branchCentMap[l.branch]} for ${l.branch}` : undefined} />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <input type="number" value={l.quantity} onChange={(e) => patchListing(l.id, { quantity: Number(e.target.value) })} onBlur={() => saveListingField(l, { quantity: l.quantity })} className="glass-input text-xs py-0.5 px-1.5 rounded w-14 text-center text-cyan-400 font-medium" />
                          </td>
                          <td className="px-2 py-2">
                            <select value={l.status} onChange={(e) => { patchListing(l.id, { status: e.target.value }); saveListingField(l, { status: e.target.value }); }} className="glass-input text-xs py-0.5 px-1.5 rounded">
                              {EBAY_LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {(() => {
                              const entry = changedByRowId.get(l.id);
                              return entry ? (
                                <button type="button" onClick={() => openRowHistory(l.id, `${l.branch} — ${l.partNo || l.id}`)} className="text-blue-300 hover:text-blue-200 hover:underline" title={`${activityActionLabel(entry.action)} · ${new Date(entry.createdAt).toLocaleString()}`}>
                                  {entry.actorName || "Unknown"}
                                </button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              );
                            })()}
                          </td>
                          <td className="px-2 py-2 text-center whitespace-nowrap">
                            {savingRowId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : (
                              <span className="inline-flex items-center gap-2">
                                <button onClick={() => openEditListing(l)} className="text-blue-400 hover:text-blue-300" title="Edit this listing"><Pencil className="h-3.5 w-3.5" /></button>
                                <button onClick={() => removeListing(l.id)} className="text-red-400 hover:text-red-300" title="Delete this listing"><Trash2 className="h-3.5 w-3.5" /></button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "assignments" && (
          <div className="panel p-0 border-l-4 border-l-indigo-500">
            <div className="px-4 pt-4 pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-indigo-300 flex items-center gap-2"><Users className="h-4 w-4" /> Branch Assignments</h2>
                <ClearFunnels count={assignFunnels.activeCount} onClear={assignFunnels.clear} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Who currently handles each branch's eBay listings. The Daily Branch Report on the Summary tab groups branches by whoever is assigned here — change it any time coverage moves to a different person. Listings Status is edited per day on that same Daily Branch Report, not here.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"><span className="inline-flex items-center">Branch{assignFunnels.funnel("Branch")}</span></th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"><span className="inline-flex items-center">Assigned To{assignFunnels.funnel("Assigned To")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {assignFunnels.visible.length === 0 && EBAY_BRANCHES.length > 0 && (
                    <tr><td colSpan={2} className="px-3 py-4 text-center text-muted-foreground">No branches match the column filters.</td></tr>
                  )}
                  {assignFunnels.visible.map((branch) => {
                    const setting = getBranchSetting(branch);
                    const assignedOptions = setting.assignedTo && !partsStaffNames.includes(setting.assignedTo)
                      ? [setting.assignedTo, ...partsStaffNames]
                      : partsStaffNames;
                    return (
                      <tr key={branch} className="border-b border-white/5 hover:bg-white/5" {...assignFunnels.rowPin(branch)}>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{branch}</td>
                        <td className="px-3 py-2">
                          <select
                            value={setting.assignedTo}
                            onChange={(e) => {
                              setLocalBranchSetting(branch, { assignedTo: e.target.value });
                              saveBranchSetting(branch, { assignedTo: e.target.value });
                            }}
                            className="glass-input text-xs py-1 px-2 rounded w-48"
                          >
                            <option value="">— Unassigned —</option>
                            {assignedOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-white/10 px-4 py-4 bg-cyan-500/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-cyan-300 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Branches &amp; Cent Pricing</h2>
                <ClearFunnels count={centFunnels.activeCount} onClear={centFunnels.clear} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">The branches this page offers everywhere (pickers, Assignments, Daily Branch Report) — each one's cent value is the fixed cents a Listing price always ends in for that branch. Add or remove a branch here and it updates everywhere.</p>
              <div className="overflow-x-auto mt-3 rounded-md border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"><span className="inline-flex items-center">Branch{centFunnels.funnel("Branch")}</span></th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"><span className="inline-flex items-center">Cents (.XX){centFunnels.funnel("Cents (.XX)")}</span></th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchCents.length === 0 ? (
                      <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
                    ) : centFunnels.visible.length === 0 ? (
                      <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">No branches match the column filters.</td></tr>
                    ) : (
                      centFunnels.visible.map((b) => (
                        <tr key={b.branch} className="border-b border-white/5 hover:bg-white/5" {...centFunnels.rowPin(b.branch)}>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{b.branch}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">.</span>
                              <input
                                type="number"
                                min={0}
                                max={99}
                                value={b.cents}
                                onChange={(e) => setBranchCents((prev) => prev.map((x) => (x.branch === b.branch ? { ...x, cents: Number(e.target.value) } : x)))}
                                onBlur={(e) => handleUpdateBranchCent(b.branch, Number(e.target.value))}
                                className="glass-input text-xs py-1 px-2 rounded w-16"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" onClick={() => handleDeleteBranchCent(b.branch)} className="text-red-400 hover:text-red-300" title="Remove this branch">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-end gap-2 mt-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Branch</label>
                  <select value={newCentBranch} onChange={(e) => setNewCentBranch(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-56">
                    {branchesAvailableToAdd.length === 0 ? (
                      <option value="">All branches already added</option>
                    ) : (
                      branchesAvailableToAdd.map((l) => <option key={l} value={l}>{l}</option>)
                    )}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cents (.XX)</label>
                  <input type="number" min={0} max={99} value={newCentValue} onChange={(e) => setNewCentValue(Number(e.target.value))} className="glass-input text-sm py-1.5 px-2 rounded-md w-20" />
                </div>
                <button onClick={handleAddBranchCent} disabled={addingBranchCent || branchesAvailableToAdd.length === 0} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {addingBranchCent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                </button>
              </div>
            </div>

            <div className="border-t border-white/10 px-4 py-4 bg-amber-500/5">
              <h2 className="text-sm font-semibold text-amber-300 flex items-center gap-2"><CreditCard className="h-4 w-4" /> eBay Accounts</h2>
              <p className="text-xs text-muted-foreground mt-1">The eBay Account choices offered on the Orders and Listings tabs. Add or remove one here and it updates everywhere.</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {ebayAccounts.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Loading…</span>
                ) : (
                  ebayAccounts.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-3 pr-2 py-1 text-xs">
                      {a.name}
                      <button type="button" onClick={() => handleDeleteAccount(a.id)} className="text-red-400 hover:text-red-300" title="Delete this account">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex items-end gap-2 mt-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Account</label>
                  <input
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddAccount(); }}
                    placeholder="e.g. Ebay (warehouse_202)"
                    className="glass-input text-sm py-1.5 px-2 rounded-md w-56"
                  />
                </div>
                <button onClick={handleAddAccount} disabled={addingAccount || !newAccountName.trim()} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {addingAccount ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {editingOrder && orderEditDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditingOrder(null)}>
          <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2"><Pencil className="h-4 w-4 text-blue-400" /> Edit Order</h3>
              <button type="button" onClick={() => setEditingOrder(null)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Field label="Order ID (or pasted eBay link)">
                <input value={orderEditDraft.orderExtId} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, orderExtId: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-40" />
              </Field>
              <Field label="Part #">
                <input value={orderEditDraft.partNo} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, partNo: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
              </Field>
              <Field label="Qty">
                <input type="number" min={1} value={orderEditDraft.quantity} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, quantity: Number(e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-20" />
              </Field>
              <Field label="Status">
                <select value={orderEditDraft.status} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, status: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {EBAY_ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Earnings ($)">
                <input type="number" step="0.01" value={orderEditDraft.orderEarnings} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, orderEarnings: Number(e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-28" />
              </Field>
              <Field label="Order Date">
                <input type="date" value={orderEditDraft.orderDate} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, orderDate: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md" />
              </Field>
              <Field label="eBay Account">
                <select value={orderEditDraft.salesAccount} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, salesAccount: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {ebayAccountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Branch">
                <select value={orderEditDraft.branch} onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, branch: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {EBAY_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes">
                <textarea
                  value={orderEditDraft.notes}
                  onChange={(e) => setOrderEditDraft((d) => d && ({ ...d, notes: e.target.value }))}
                  rows={3}
                  placeholder="Optional"
                  className="glass-input w-full resize-y rounded-md px-2 py-1.5 text-sm leading-relaxed"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditingOrder(null)} className="btn px-4 text-sm">Cancel</button>
              <button onClick={handleSaveOrderEdit} disabled={savingOrderEdit} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 text-sm">
                {savingOrderEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {savingOrderEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {branchDetail && (() => {
        const { branch, person } = branchDetail;
        const bOrders = newestAddedFirst(orders.filter((o) => (o.branch || "—") === branch));
        const bListed = newestAddedFirst(listings.filter((l) => l.status === "Listed" && (l.branch || "—") === branch));
        const earnings = bOrders.reduce((sum, o) => sum + o.orderEarnings, 0);
        const qty = bOrders.reduce((sum, o) => sum + o.quantity, 0);
        const statusCounts = EBAY_ORDER_STATUSES.map((st) => ({ st, n: bOrders.filter((o) => o.status === st).length })).filter((x) => x.n > 0);
        const th = (h: string, align = "text-left") => (
          <th key={h} className={`px-2 py-2 ${align} text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap`}>{h}</th>
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setBranchDetail(null)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${branch} — orders and listings`}
              className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-lg border border-white/10 bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-white">{branch}</h3>
                  <p className="text-xs text-muted-foreground">
                    {person === "Unassigned" ? "Unassigned" : `Assigned to ${person}`} · {startDate} to {endDate} · orders by Order Date
                  </p>
                </div>
                <button type="button" onClick={() => setBranchDetail(null)} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">×</button>
              </div>

              <div className="space-y-5 overflow-y-auto px-5 py-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md border border-blue-500/30 bg-blue-500/5 px-2.5 py-1"><span className="text-muted-foreground">Orders</span> <b className="text-blue-300 tabular-nums">{bOrders.length}</b></span>
                  <span className="rounded-md border border-green-500/30 bg-green-500/5 px-2.5 py-1"><span className="text-muted-foreground">Earnings</span> <b className="text-green-400 tabular-nums">${earnings.toFixed(2)}</b></span>
                  {statusCounts.map(({ st, n }) => {
                    const tone = ORDER_STATUS_TONE[st] || ORDER_STATUS_TONE.Pending;
                    return (
                      <span key={st} className={`rounded-md border px-2.5 py-1 ${tone.border} ${tone.bg}`}><span className="text-muted-foreground">{st}</span> <b className={`tabular-nums ${tone.text}`}>{n}</b></span>
                    );
                  })}
                  <span className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-2.5 py-1"><span className="text-muted-foreground">Listed</span> <b className="text-cyan-300 tabular-nums">{bListed.length}</b></span>
                </div>

                <section>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-blue-300"><Package className="h-4 w-4" /> Orders ({bOrders.length})</h4>
                    {bOrders.length > 0 && (
                      <button type="button" onClick={() => openBranchIn("orders", branch)} className="btn px-3 py-1 text-xs">Open in Orders tab →</button>
                    )}
                  </div>
                  {bOrders.length === 0 ? (
                    <p className="rounded-md border border-white/10 px-3 py-4 text-center text-xs text-muted-foreground">No orders for {branch} with an Order Date in this range.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-white/10">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/5">
                            {th("Date Added")}{th("Order Date")}{th("Order ID")}{th("Part #")}{th("Qty", "text-center")}{th("Status")}{th("Earnings", "text-right")}{th("Notes")}
                          </tr>
                        </thead>
                        <tbody>
                          {bOrders.map((o) => {
                            const ref = parseEbayOrderRef(o.orderExtId);
                            const tone = ORDER_STATUS_TONE[o.status] || ORDER_STATUS_TONE.Pending;
                            return (
                              <tr key={o.id} className="border-b border-white/5">
                                <td className="px-2 py-2 whitespace-nowrap">{formatDateAdded(o.createdAt)}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{o.orderDate}</td>
                                <td className="px-2 py-2 font-mono whitespace-nowrap">
                                  {ref.href ? (
                                    <a href={ref.href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline underline-offset-2 hover:text-blue-300" title="Open this order on eBay">{ref.display}</a>
                                  ) : "—"}
                                </td>
                                <td className="px-2 py-2 font-mono whitespace-nowrap">{o.partNo || "—"}</td>
                                <td className="px-2 py-2 text-center tabular-nums">{o.quantity}</td>
                                <td className="px-2 py-2"><span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${tone.border} ${tone.bg} ${tone.text}`}>{o.status}</span></td>
                                <td className="px-2 py-2 text-right font-medium text-green-400 tabular-nums">${o.orderEarnings.toFixed(2)}</td>
                                <td className="max-w-[16rem] truncate px-2 py-2 text-muted-foreground" title={o.notes || undefined}>{o.notes || "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-white/10 bg-white/5 font-semibold">
                            <td colSpan={4} className="px-2 py-2">Total</td>
                            <td className="px-2 py-2 text-center tabular-nums">{qty}</td>
                            <td className="px-2 py-2"></td>
                            <td className="px-2 py-2 text-right text-green-400 tabular-nums">${earnings.toFixed(2)}</td>
                            <td className="px-2 py-2"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-cyan-300"><Tag className="h-4 w-4" /> Listed ({bListed.length})</h4>
                    {bListed.length > 0 && (
                      <button type="button" onClick={() => openBranchIn("listings", branch)} className="btn px-3 py-1 text-xs">Open in Listings tab →</button>
                    )}
                  </div>
                  {bListed.length === 0 ? (
                    <p className="rounded-md border border-white/10 px-3 py-4 text-center text-xs text-muted-foreground">Nothing still Listed for {branch} with a Listed Date in this range.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-white/10">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/5">
                            {th("Date Added")}{th("Listed Date")}{th("Part #")}{th("Account")}{th("Price", "text-right")}{th("Qty", "text-center")}
                          </tr>
                        </thead>
                        <tbody>
                          {bListed.map((l) => (
                            <tr key={l.id} className="border-b border-white/5">
                              <td className="px-2 py-2 whitespace-nowrap">{formatDateAdded(l.createdAt)}</td>
                              <td className="px-2 py-2 whitespace-nowrap">{l.listedDate}</td>
                              <td className="px-2 py-2 font-mono whitespace-nowrap">{l.partNo || "—"}</td>
                              <td className="px-2 py-2 whitespace-nowrap">{l.ebayAccount}</td>
                              <td className="px-2 py-2 text-right font-medium text-green-400 tabular-nums">${l.price.toFixed(2)}</td>
                              <td className="px-2 py-2 text-center tabular-nums">{l.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        );
      })()}

      {editingListing && listingEditDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditingListing(null)}>
          <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2"><Pencil className="h-4 w-4 text-purple-400" /> Edit Listing</h3>
              <button type="button" onClick={() => setEditingListing(null)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Field label="Part #">
                <input value={listingEditDraft.partNo} onChange={(e) => setListingEditDraft((d) => d && ({ ...d, partNo: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
              </Field>
              <Field label="eBay Account">
                <select value={listingEditDraft.ebayAccount} onChange={(e) => setListingEditDraft((d) => d && ({ ...d, ebayAccount: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {ebayAccountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Branch">
                <select value={listingEditDraft.branch} onChange={(e) => setListingEditDraft((d) => d && ({ ...d, branch: e.target.value, price: applyBranchCents(d.price, e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {EBAY_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label={branchCentMap[listingEditDraft.branch] !== undefined ? `Price ($ — cents auto-set to .${branchCentMap[listingEditDraft.branch]})` : "Price ($)"}>
                <input type="number" step="0.01" value={listingEditDraft.price} onChange={(e) => setListingEditDraft((d) => d && ({ ...d, price: applyBranchCents(Number(e.target.value), d.branch) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-28" />
              </Field>
              <Field label="Qty">
                <input type="number" min={1} value={listingEditDraft.quantity} onChange={(e) => setListingEditDraft((d) => d && ({ ...d, quantity: Number(e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-20" />
              </Field>
              <Field label="Listed Date">
                <input type="date" value={listingEditDraft.listedDate} onChange={(e) => setListingEditDraft((d) => d && ({ ...d, listedDate: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md" />
              </Field>
              <Field label="Status">
                <select value={listingEditDraft.status} onChange={(e) => setListingEditDraft((d) => d && ({ ...d, status: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  {EBAY_LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditingListing(null)} className="btn px-4 text-sm">Cancel</button>
              <button onClick={handleSaveListingEdit} disabled={savingListingEdit} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 text-sm">
                {savingListingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {savingListingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rowHistoryTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setRowHistoryTarget(null)}>
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold text-white">Change History</h3>
              <button type="button" onClick={() => setRowHistoryTarget(null)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{rowHistoryTarget.label}</p>
            {rowHistoryLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rowHistoryError ? (
              <p className="text-sm text-red-400">{rowHistoryError}</p>
            ) : rowHistoryEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history for this row.</p>
            ) : (
              <div className="overflow-y-auto flex-1 -mx-2 px-2">
                <ul className="space-y-2">
                  {rowHistoryEntries.map((entry) => {
                    const isStatus = entry.action === "ebay_order_status_changed" || entry.action === "ebay_listing_status_changed";
                    const isAdded = entry.action === "ebay_order_added" || entry.action === "ebay_listing_added";
                    const isDeleted = entry.action === "ebay_order_deleted" || entry.action === "ebay_listing_deleted";
                    return (
                      <li key={entry.id} className="rounded border border-white/10 bg-white/5 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">{isStatus ? "Status" : isAdded || isDeleted ? activityActionLabel(entry.action) : rowHistoryFieldLabel(entry)}</span>
                          <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                        {(entry.details?.from !== undefined || entry.details?.to !== undefined) && (
                          <div className="text-xs mt-0.5">
                            <span className="text-red-300">{String(entry.details?.from ?? "—")}</span>
                            <span className="text-muted-foreground"> → </span>
                            <span className="text-green-300">{String(entry.details?.to ?? "—")}</span>
                          </div>
                        )}
                        <div className="text-xs text-slate-500 mt-0.5">{entry.actorName || "Unknown"}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {activityLogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setActivityLogOpen(false)}>
          <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">eBay Daily Report Activity</h3>
              <button type="button" onClick={() => setActivityLogOpen(false)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            {activityLogLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : activityLogError ? (
              <p className="text-sm text-red-400">{activityLogError}</p>
            ) : activityLogEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity logged yet.</p>
            ) : (
              <div className="overflow-y-auto flex-1 -mx-2 px-2">
                <ul className="space-y-2">
                  {activityLogEntries.map((entry) => (
                    <li key={entry.id} className="rounded border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">{activityActionLabel(entry.action)}</span>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                      {entry.targetLabel && <div className="text-xs text-blue-300 mt-0.5">{entry.targetLabel}</div>}
                      {(entry.details?.from !== undefined || entry.details?.to !== undefined) && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {entry.details?.from !== undefined ? `"${entry.details.from}" → ` : ""}
                          {entry.details?.to !== undefined ? `"${entry.details.to}"` : ""}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 mt-0.5">{entry.actorName || "Unknown"}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
