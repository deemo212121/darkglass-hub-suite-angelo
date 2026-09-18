import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Plus, Trash2, Loader2, Printer, History, Download, FileSpreadsheet, Package, DollarSign, Tag, CheckCircle2, Building2, Users, CreditCard, ListChecks, ClipboardList } from "lucide-react";
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
  type EbayOrderRow,
  type EbayListingRow,
  type EbayBranchSetting,
  type EbayBranchDailyNote,
  type EbayBranchStatusChange,
  type EbayAccount,
} from "@/lib/supabase/partDailyReportEbay";

// Color coding per order status, reused for status chips/dropdown-adjacent
// badges wherever a status shows up on this page.
const ORDER_STATUS_TONE: Record<string, { border: string; bg: string; text: string }> = {
  Shipped: { border: "border-green-500/30", bg: "bg-green-500/5", text: "text-green-400" },
  Cancelled: { border: "border-slate-500/30", bg: "bg-slate-500/5", text: "text-slate-300" },
  Returned: { border: "border-orange-500/30", bg: "bg-orange-500/5", text: "text-orange-400" },
  Refunded: { border: "border-rose-500/30", bg: "bg-rose-500/5", text: "text-rose-400" },
  Pending: { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-400" },
};

// Each branch's assigned "cent value" — the fixed cents a listing price
// always ends in for that branch (e.g. Atlanta always prices at $X.97).
// Whenever the branch or the dollar amount changes, the cents get
// auto-set from here so listings never need it typed by hand.
const EBAY_BRANCH_CENT_VALUES: Record<string, number> = {
  "Atlanta": 97,
  "Columbus": 96,
  "Jackson, TN": 86,
  "Jonesboro": 82,
  "Jacksonville": 80,
  "Jackson, MS": 76,
  "Chattanooga": 74,
  "Memphis": 93,
  "Tallahassee": 95,
  "Savannah": 92,
  "Raleigh": 78,
  "Mobile": 89,
  "Nashville": 91,
  "Knoxville": 88,
};

// The branches that actually do eBay listings — exactly the ones with a
// cent value assigned above. Who covers each one is NOT hardcoded — it's
// the per-branch "Assigned To" setting on the Assignments tab.
const EBAY_BRANCHES: string[] = Object.keys(EBAY_BRANCH_CENT_VALUES);

function applyBranchCents(price: number, branch: string): number {
  const cents = EBAY_BRANCH_CENT_VALUES[branch];
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
    out.push(d.toISOString().slice(0, 10));
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
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type Tab = "orders" | "listings" | "summary" | "assignments";

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
  branch: (EBAY_BRANCHES[0] || "") as string,
  notes: "",
});

const emptyListingDraft = () => ({
  partNo: "",
  ebayAccount: EBAY_SALES_ACCOUNTS[0] as string,
  branch: (EBAY_BRANCHES[0] || "") as string,
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
  const [branchFilter, setBranchFilter] = useState("");

  const [orders, setOrders] = useState<EbayOrderRow[]>([]);
  const [listings, setListings] = useState<EbayListingRow[]>([]);
  const [allActiveListings, setAllActiveListings] = useState<EbayListingRow[]>([]);
  const [branchSettings, setBranchSettings] = useState<EbayBranchSetting[]>([]);
  const [branchNotes, setBranchNotes] = useState<EbayBranchDailyNote[]>([]);
  const [branchStatusHistory, setBranchStatusHistory] = useState<EbayBranchStatusChange[]>([]);
  const [partsStaffNames, setPartsStaffNames] = useState<string[]>([]);
  const [ebayAccounts, setEbayAccounts] = useState<EbayAccount[]>([]);
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
      setError(err instanceof Error ? err.message : "Failed to add eBay account");
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
      setError(err instanceof Error ? err.message : "Failed to delete eBay account");
      loadEbayAccounts();
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
    // Union with EBAY_BRANCHES so the 14 known branches always show (even
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
  const [addingOrder, setAddingOrder] = useState(false);
  const [addingListing, setAddingListing] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

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
      .catch((err) => setActivityLogError(err instanceof Error ? err.message : "Failed to load activity log"))
      .finally(() => setActivityLogLoading(false));
  };

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
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const filteredOrders = useMemo(
    () => (branchFilter ? orders.filter((o) => o.branch === branchFilter) : orders),
    [orders, branchFilter]
  );
  const filteredListings = useMemo(
    () => (branchFilter ? listings.filter((l) => l.branch === branchFilter) : listings),
    [listings, branchFilter]
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
    const history = statusHistoryByBranch.get(branch);
    if (history) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].date <= date) return history[i].status;
      }
    }
    return "All Listed";
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
      setError(err instanceof Error ? err.message : "Failed to save listings status");
      loadBranchStatusHistory();
    }
  };

  // Regroups branches by whoever's currently assigned (Assignments tab),
  // so reassigning a branch there is all it takes — no code change needed.
  const dynamicGroups = useMemo(() => {
    const branches = branchFilter ? EBAY_BRANCHES.filter((b) => b === branchFilter) : EBAY_BRANCHES;
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
      setError(err instanceof Error ? err.message : "Failed to save branch setting");
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
      setError(err instanceof Error ? err.message : "Failed to save comment");
    }
  };

  const handleAddOrder = async () => {
    setAddingOrder(true);
    setError(null);
    try {
      const created = await createEbayOrder(orderDraft);
      setOrders((prev) => [created, ...prev]);
      setOrderDraft({ ...emptyOrderDraft(), branch: orderDraft.branch });
      logActivity({
        action: "ebay_order_added",
        targetType: EBAY_ACTIVITY_TARGET_TYPE,
        targetId: created.id,
        targetLabel: `${created.branch} — ${created.partNo || created.orderExtId || created.id}`,
        details: { branch: created.branch, orderDate: created.orderDate, earnings: created.orderEarnings },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add order");
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
      logActivity({
        action: "ebay_listing_added",
        targetType: EBAY_ACTIVITY_TARGET_TYPE,
        targetId: created.id,
        targetLabel: `${created.branch} — ${created.partNo || created.id}`,
        details: { branch: created.branch, listedDate: created.listedDate, price: created.price },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add listing");
    } finally {
      setAddingListing(false);
    }
  };

  const patchOrder = (id: string, patch: Partial<EbayOrderRow>) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };
  const patchListing = (id: string, patch: Partial<EbayListingRow>) => {
    setListings((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const saveOrderField = async (row: EbayOrderRow, patch: Partial<EbayOrderRow>) => {
    setSavingRowId(row.id);
    try {
      await updateEbayOrder(row.id, patch);
      if (patch.status !== undefined && patch.status !== row.status) {
        logActivity({
          action: "ebay_order_status_changed",
          targetType: EBAY_ACTIVITY_TARGET_TYPE,
          targetId: row.id,
          targetLabel: `${row.branch} — ${row.partNo || row.orderExtId || row.id}`,
          details: { from: row.status, to: patch.status },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order");
    } finally {
      setSavingRowId(null);
    }
  };
  const saveListingField = async (row: EbayListingRow, patch: Partial<EbayListingRow>) => {
    setSavingRowId(row.id);
    try {
      await updateEbayListing(row.id, patch);
      if (patch.status !== undefined || patch.quantity !== undefined) loadActiveListings();
      if (patch.status !== undefined && patch.status !== row.status) {
        logActivity({
          action: "ebay_listing_status_changed",
          targetType: EBAY_ACTIVITY_TARGET_TYPE,
          targetId: row.id,
          targetLabel: `${row.branch} — ${row.partNo || row.id}`,
          details: { from: row.status, to: patch.status },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save listing");
    } finally {
      setSavingRowId(null);
    }
  };

  const removeOrder = async (id: string) => {
    if (!confirm("Delete this order row?")) return;
    const row = orders.find((o) => o.id === id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
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
      setError(err instanceof Error ? err.message : "Failed to delete order");
      load();
    }
  };
  const removeListing = async (id: string) => {
    if (!confirm("Delete this listing row?")) return;
    const row = listings.find((l) => l.id === id);
    setListings((prev) => prev.filter((l) => l.id !== id));
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
      setError(err instanceof Error ? err.message : "Failed to delete listing");
      load();
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

  const periodLabel = () => `${startDate} to ${endDate}${branchFilter ? ` · ${branchFilter}` : ""}`;
  const REPORT_COLS = 4 + EBAY_ORDER_STATUSES.length; // widest section (By Branch) sets the banner colspan

  const byBranchRowsHtml = (): string => {
    let rows = `<tr>${th("Branch")}${th("Orders", "right")}${th("Earnings", "right")}${EBAY_ORDER_STATUSES.map((s) => th(s, "right")).join("")}${th("Listed", "right")}</tr>`;
    if (branchBreakdown.length === 0) {
      rows += `<tr>${td("No data for this date range.", "center", "color:#6b7280;", REPORT_COLS)}</tr>`;
    } else {
      branchBreakdown.forEach((b, i) => {
        const bg = i % 2 === 1 ? "background:#f9fafb;" : "";
        rows +=
          `<tr>` +
          td(escapeHtml(b.branch), "left", `${bg}font-weight:bold;`) +
          td(String(b.orders), "right", bg) +
          td(`$${b.earnings.toFixed(2)}`, "right", `${bg}color:#16a34a;font-weight:bold;`) +
          EBAY_ORDER_STATUSES.map((s) => td(String(b[s]), "right", bg)).join("") +
          td(String(b.listed), "right", bg) +
          `</tr>`;
      });
    }
    return rows;
  };
  const byBranchTableHtml = (): string => `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">${byBranchRowsHtml()}</table>`;

  // Shared by both PDF (wrapped per-date in its own <table>) and Excel
  // (all dates folded into the one master <table>) — `perDateTable`
  // picks which.
  const dailyBranchReportDates = (): { date: string; dateLabel: string; rows: string; totalsRow: string }[] =>
    dateList.map((date) => {
      let dayTotals = { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 };
      const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
      let rows = "";
      for (const group of dynamicGroups) {
        for (const branch of group.branches) {
          const t = dailyBranchTotals.get(`${branch}|${date}`) || { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 };
          dayTotals = {
            salesQty: dayTotals.salesQty + t.salesQty,
            salesValue: dayTotals.salesValue + t.salesValue,
            returnQty: dayTotals.returnQty + t.returnQty,
            returnsValue: dayTotals.returnsValue + t.returnsValue,
          };
          const note = getBranchNote(branch, date);
          rows +=
            `<tr>` +
            td(escapeHtml(branch), "left", "font-weight:bold;") +
            td(escapeHtml(group.label === "Unassigned" ? "—" : group.label)) +
            td(escapeHtml(resolveListingsStatus(branch, date))) +
            td(String(t.salesQty), "center") +
            td(`$${t.salesValue.toFixed(2)}`, "right", "color:#16a34a;font-weight:bold;") +
            td(String(t.returnQty), "center") +
            td(`$${t.returnsValue.toFixed(2)}`, "right", t.returnsValue < 0 ? "color:#dc2626;" : "") +
            td(escapeHtml(note || "—")) +
            `</tr>`;
        }
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
    rows += `<tr>${td("By Branch (Totals for Range)", "left", "background:#1e40af;color:white;font-weight:bold;padding:8px;font-size:13px;", REPORT_COLS)}</tr>`;
    rows += byBranchRowsHtml();
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
            <h2 class="section-title">By Branch (Totals for Range)</h2>
            ${byBranchTableHtml()}
            <h2 class="section-title">Daily Branch Report</h2>
            ${dailyBranchReportHtml()}
            <div class="footer">Generated by AHS System &middot; ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </body>
      </html>
    `);
  };

  const [exportBusy, setExportBusy] = useState<"excel" | "pdf" | null>(null);
  const handleExport = async (format: "excel" | "pdf") => {
    setExportBusy(format);
    try {
      if (format === "excel") downloadEbayReportExcel();
      else await downloadEbayReportPdf();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to generate ${format === "excel" ? "Excel" : "PDF"} report`);
    } finally {
      setExportBusy(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
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
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md">
                <option value="">— All Branches —</option>
                {EBAY_BRANCHES.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
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

            <div className="panel p-0 border-l-4 border-l-indigo-500">
              <h2 className="text-sm font-semibold px-4 pt-4 mb-2 text-indigo-300 flex items-center gap-2"><Building2 className="h-4 w-4" /> By Branch (totals for range)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Branch</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wide">Orders</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wide">Earnings</th>
                      {EBAY_ORDER_STATUSES.map((s) => (
                        <th key={s} className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{s}</th>
                      ))}
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wide">Listed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchBreakdown.length === 0 ? (
                      <tr><td colSpan={4 + EBAY_ORDER_STATUSES.length} className="px-3 py-6 text-center text-muted-foreground">No data for this date range.</td></tr>
                    ) : (
                      branchBreakdown.map((b) => (
                        <tr key={b.branch} className="border-b border-white/5">
                          <td className="px-3 py-2 font-medium">{b.branch}</td>
                          <td className="px-3 py-2 text-right">{b.orders}</td>
                          <td className="px-3 py-2 text-right font-medium text-green-400">${b.earnings.toFixed(2)}</td>
                          {EBAY_ORDER_STATUSES.map((s) => (
                            <td key={s} className="px-3 py-2 text-right">{b[s]}</td>
                          ))}
                          <td className="px-3 py-2 text-right">{b.listed}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold mb-2 text-teal-300 flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Daily Branch Report</h2>
              {dateList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Pick a valid date range to see the daily branch report.</p>
              ) : (
                <div className="space-y-4">
                  {dateList.map((date) => {
                    const groups = dynamicGroups;
                    let dayTotals = { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 };
                    for (const g of groups) {
                      for (const b of g.branches) {
                        const t = dailyBranchTotals.get(`${b}|${date}`);
                        if (t) {
                          dayTotals = {
                            salesQty: dayTotals.salesQty + t.salesQty,
                            salesValue: dayTotals.salesValue + t.salesValue,
                            returnQty: dayTotals.returnQty + t.returnQty,
                            returnsValue: dayTotals.returnsValue + t.returnsValue,
                          };
                        }
                      }
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
                                  <th key={h} className={`px-2 py-2 ${align} text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap`}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {groups.length === 0 ? (
                                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No branches match this filter.</td></tr>
                              ) : (
                                groups.map((group, gi) => (
                                  <Fragment key={`${date}-group-${gi}`}>
                                    {group.branches.map((branch) => {
                                      const t = dailyBranchTotals.get(`${branch}|${date}`) || { salesQty: 0, salesValue: 0, returnQty: 0, returnsValue: 0 };
                                      return (
                                        <tr key={branch} className="border-b border-white/5 hover:bg-white/5">
                                          <td className="px-2 py-2 font-medium whitespace-nowrap">{branch}</td>
                                          <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                                            {group.label === "Unassigned" ? "—" : group.label}
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
                                    })}
                                    {gi < groups.length - 1 && (
                                      <tr key={`${date}-spacer-${gi}`} className="h-3">
                                        <td colSpan={8}></td>
                                      </tr>
                                    )}
                                  </Fragment>
                                ))
                              )}
                            </tbody>
                            {groups.length > 0 && (
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
                  <input placeholder="Optional" value={orderDraft.notes} onChange={(e) => setOrderDraft((d) => ({ ...d, notes: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
                </Field>
                <button onClick={handleAddOrder} disabled={addingOrder} className="btn flex items-center gap-2 px-4 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {addingOrder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                </button>
              </div>
            </div>

            <div className="panel p-0 border-l-4 border-l-slate-500">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {[
                        { h: "Date", align: "text-left" },
                        { h: "Order ID", align: "text-left" },
                        { h: "Part #", align: "text-left" },
                        { h: "Qty", align: "text-center" },
                        { h: "Status", align: "text-left" },
                        { h: "Earnings", align: "text-right" },
                        { h: "Account", align: "text-left" },
                        { h: "Branch", align: "text-left" },
                        { h: "Notes", align: "text-left" },
                        { h: "Date Added", align: "text-left" },
                        { h: "", align: "text-center" },
                      ].map(({ h, align }) => (
                        <th key={h || "actions"} className={`px-2 py-3 ${align} text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length === 0 ? (
                      <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">No orders match these filters.</td></tr>
                    ) : (
                      filteredOrders.map((o) => (
                        <tr key={o.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-2 py-2 whitespace-nowrap">{o.orderDate}</td>
                          <td className="px-2 py-2 font-mono whitespace-nowrap">
                            {(() => {
                              const ref = parseEbayOrderRef(o.orderExtId);
                              return ref.href ? (
                                <a href={ref.href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2" title="Open this order on eBay">
                                  {ref.display}
                                </a>
                              ) : (
                                "—"
                              );
                            })()}
                          </td>
                          <td className="px-2 py-2 font-mono whitespace-nowrap">{o.partNo || "—"}</td>
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
                            <input value={o.notes} onChange={(e) => patchOrder(o.id, { notes: e.target.value })} onBlur={() => saveOrderField(o, { notes: o.notes })} className="glass-input text-xs py-0.5 px-2 rounded w-28" />
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{formatDateAdded(o.createdAt)}</td>
                          <td className="px-2 py-2 text-center">
                            {savingRowId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : (
                              <button onClick={() => removeOrder(o.id)} className="text-red-400 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
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
                <Field label={EBAY_BRANCH_CENT_VALUES[listingDraft.branch] !== undefined ? `Price ($ — cents auto-set to .${EBAY_BRANCH_CENT_VALUES[listingDraft.branch]})` : "Price ($)"}>
                  <input type="number" step="0.01" value={listingDraft.price} onChange={(e) => setListingDraft((d) => ({ ...d, price: applyBranchCents(Number(e.target.value), d.branch) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-24 text-green-400 font-medium" />
                </Field>
                <Field label="Qty">
                  <input type="number" min={1} value={listingDraft.quantity} onChange={(e) => setListingDraft((d) => ({ ...d, quantity: Number(e.target.value) }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-20" />
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
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {[
                        { h: "Date", align: "text-left" },
                        { h: "Part #", align: "text-left" },
                        { h: "Account", align: "text-left" },
                        { h: "Branch", align: "text-left" },
                        { h: "Price", align: "text-right" },
                        { h: "Qty", align: "text-center" },
                        { h: "Status", align: "text-left" },
                        { h: "Date Added", align: "text-left" },
                        { h: "", align: "text-center" },
                      ].map(({ h, align }) => (
                        <th key={h || "actions"} className={`px-2 py-3 ${align} text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredListings.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No listings match these filters.</td></tr>
                    ) : (
                      filteredListings.map((l) => (
                        <tr key={l.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-2 py-2 whitespace-nowrap">{l.listedDate}</td>
                          <td className="px-2 py-2 font-mono whitespace-nowrap">{l.partNo || "—"}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{l.ebayAccount}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{l.branch}</td>
                          <td className="px-2 py-2 text-right">
                            <input type="number" step="0.01" value={l.price} onChange={(e) => patchListing(l.id, { price: applyBranchCents(Number(e.target.value), l.branch) })} onBlur={() => saveListingField(l, { price: l.price })} className="glass-input text-xs py-0.5 px-1.5 rounded w-20 text-right font-medium text-green-400" title={EBAY_BRANCH_CENT_VALUES[l.branch] !== undefined ? `Cents auto-set to .${EBAY_BRANCH_CENT_VALUES[l.branch]} for ${l.branch}` : undefined} />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <input type="number" value={l.quantity} onChange={(e) => patchListing(l.id, { quantity: Number(e.target.value) })} onBlur={() => saveListingField(l, { quantity: l.quantity })} className="glass-input text-xs py-0.5 px-1.5 rounded w-14 text-center" />
                          </td>
                          <td className="px-2 py-2">
                            <select value={l.status} onChange={(e) => { patchListing(l.id, { status: e.target.value }); saveListingField(l, { status: e.target.value }); }} className="glass-input text-xs py-0.5 px-1.5 rounded">
                              {EBAY_LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{formatDateAdded(l.createdAt)}</td>
                          <td className="px-2 py-2 text-center">
                            {savingRowId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : (
                              <button onClick={() => removeListing(l.id)} className="text-red-400 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
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
              <h2 className="text-sm font-semibold text-indigo-300 flex items-center gap-2"><Users className="h-4 w-4" /> Branch Assignments</h2>
              <p className="text-xs text-muted-foreground mt-1">Who currently handles each branch's eBay listings. The Daily Branch Report on the Summary tab groups branches by whoever is assigned here — change it any time coverage moves to a different person. Listings Status is edited per day on that same Daily Branch Report, not here.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Branch</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Assigned To</th>
                  </tr>
                </thead>
                <tbody>
                  {EBAY_BRANCHES.map((branch) => {
                    const setting = getBranchSetting(branch);
                    const assignedOptions = setting.assignedTo && !partsStaffNames.includes(setting.assignedTo)
                      ? [setting.assignedTo, ...partsStaffNames]
                      : partsStaffNames;
                    return (
                      <tr key={branch} className="border-b border-white/5 hover:bg-white/5">
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
