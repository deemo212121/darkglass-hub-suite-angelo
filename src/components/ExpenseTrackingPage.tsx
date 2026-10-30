import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Download, DollarSign, Clock, CheckCircle, Wallet, Pencil, Trash2, XCircle, Paperclip, Loader2, Receipt, TrendingUp, Building2, Plane, BedDouble, Car } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import { reimbursementTypeLabel,
  getCompanyExpenses,
  updateExpenseStatus,
  deleteExpense,
  type ExpenseCategory,
  type ExpenseRow,
  type ExpenseStatus,
} from "@/lib/supabase/expenses";
import { localISODate, todayISO } from "@/lib/localDate";
import { ExpenseFormModal } from "@/components/ExpenseFormModal";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { ReceiptLightbox, isPdfReceipt } from "@/components/ReceiptLightbox";
import { getFlashTechTripReceipts } from "@/lib/supabase/flashTechTrips";

function expenseStatusColor(status: ExpenseStatus): string {
  switch (status) {
    case "Pending": return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    case "Approved": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "Reimbursed": return "bg-green-500/20 text-green-300 border-green-500/30";
    case "Rejected": return "bg-red-500/20 text-red-300 border-red-500/30";
  }
}

/** "Oct 12, 2026" — when an expense was approved or rejected. */
export function fmtExpenseReviewedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * An expense the employee sent themselves (Employee Self-Service → My
 * Requests → Expense Request) rather than one Accounting filed on their behalf or
 * one auto-created from a Flash Tech trip.
 */
function isSelfFiledExpense(e: ExpenseRow): boolean {
  return !e.flashTechTripId && !e.expenseSubtype && e.createdBy != null && e.createdBy === e.profileId;
}

/** Summary card colors — the icon chip, the value, the thin top bar and the border. */
const KPI_TONES: Record<string, { chip: string; text: string; bar: string; border: string }> = {
  amber: { chip: "bg-amber-500/15 text-amber-300", text: "text-amber-300", bar: "bg-amber-400/70", border: "border-amber-500/20" },
  sky: { chip: "bg-sky-500/15 text-sky-300", text: "text-sky-300", bar: "bg-sky-400/70", border: "border-sky-500/20" },
  emerald: { chip: "bg-emerald-500/15 text-emerald-300", text: "text-emerald-300", bar: "bg-emerald-400/70", border: "border-emerald-500/20" },
  violet: { chip: "bg-violet-500/15 text-violet-300", text: "text-white", bar: "bg-violet-400/70", border: "border-violet-500/20" },
};

/** Flash Tech view buttons — each its own color, tinted when off and filled when picked. */
const FT_VIEW_TONES: Record<"violet" | "sky" | "amber" | "rose" | "emerald", { on: string; off: string; icon: string; countOn: string; countOff: string }> = {
  violet: { on: "border-violet-400/70 bg-violet-500/25 text-white shadow-[0_0_0_1px_rgba(167,139,250,0.25)]", off: "border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20", icon: "text-violet-300", countOn: "bg-violet-400/40 text-white", countOff: "bg-violet-500/20 text-violet-200" },
  sky: { on: "border-sky-400/70 bg-sky-500/25 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.25)]", off: "border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20", icon: "text-sky-300", countOn: "bg-sky-400/40 text-white", countOff: "bg-sky-500/20 text-sky-200" },
  amber: { on: "border-amber-400/70 bg-amber-500/25 text-white shadow-[0_0_0_1px_rgba(251,191,36,0.25)]", off: "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20", icon: "text-amber-300", countOn: "bg-amber-400/40 text-white", countOff: "bg-amber-500/20 text-amber-200" },
  rose: { on: "border-rose-400/70 bg-rose-500/25 text-white shadow-[0_0_0_1px_rgba(251,113,133,0.25)]", off: "border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20", icon: "text-rose-300", countOn: "bg-rose-400/40 text-white", countOff: "bg-rose-500/20 text-rose-200" },
  emerald: { on: "border-emerald-400/70 bg-emerald-500/25 text-white shadow-[0_0_0_1px_rgba(52,211,153,0.25)]", off: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20", icon: "text-emerald-300", countOn: "bg-emerald-400/40 text-white", countOff: "bg-emerald-500/20 text-emerald-200" },
};

/** A Flash Tech / Allowance reimbursement — listed under Flash Tech, not Employee Requests. */
const isFlashTechAllowance = (e: ExpenseRow) => e.reimbursementType === "Flash Tech Allowance";
/**
 * Everything on Expenses → Flash Tech: trip lines, every Hotel and Car Rental
 * expense (from a trip or added by Accounting) and the Flash Tech /
 * Allowance requests.
 */
const isFlashTechViewExpense = (e: ExpenseRow) => !!e.flashTechTripId || e.category === "Hotel" || e.category === "Car Rental" || isFlashTechAllowance(e);

// Car Rental pick-up / return (migration 0420) — "Nov 2 → Nov 7, 2026" and the number of days.
const fmtRentalDate = (d: string, withYear: boolean) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
const rentalLabel = (e: ExpenseRow): string => {
  if (!e.pickupDate && !e.returnDate) return "";
  if (e.pickupDate && e.returnDate) return fmtRentalDate(e.pickupDate, false) + " → " + fmtRentalDate(e.returnDate, true);
  return e.pickupDate ? "Picked up " + fmtRentalDate(e.pickupDate, true) : "Returned " + fmtRentalDate(e.returnDate!, true);
};
const rentalDays = (e: ExpenseRow): number | null =>
  e.pickupDate && e.returnDate ? Math.max(0, Math.round((Date.parse(e.returnDate) - Date.parse(e.pickupDate)) / 86_400_000)) : null;

export function ExpenseTrackingPage({
  mod,
  sub,
  embedded,
  flashTechOnly,
  selfFiledOnly,
  categoryOnly,
}: {
  mod: ModuleDef;
  sub: SubModuleDef;
  embedded?: boolean;
  /** Scopes every list/total on the page to only expenses linked to a Flash
   *  Tech trip (flashTechTripId set) — used by the new Accounting "Expenses"
   *  module's Flash Tech tab. Doesn't change what a manually-added expense
   *  here gets linked to (there's no trip picker) — this only narrows what's
   *  already shown, same rows Accounting Dashboard's own Flash Tech tab
   *  creates via Schedule Trip's Hotel/Transportation checkboxes. */
  flashTechOnly?: boolean;
  /** Scopes the page to requests employees filed for themselves from
   *  Employee Self-Service → My Requests (see isSelfFiledExpense) — the
   *  Accounting "Expenses" module's Employee Requests tab. Add Expense is
   *  hidden here: an expense Accounting files for someone isn't a request. */
  selfFiledOnly?: boolean;
  /** Scopes the page to one category — the Expenses module's Hotel / Car Rental tabs. Add Expense starts on that category. */
  categoryOnly?: ExpenseCategory;
}) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, ready, companyId, role, extraRoles } = useAuth();
  // Approve / Reject / Mark Reimbursed are Accounting's call (Admin / SuperAdmin too) — primary or extra role.
  // The database enforces the same rule (migration 0396).
  const canReviewExpenses = [role, ...(extraRoles ?? [])].some((r) =>
    ["FINANCE", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"].includes(String(r || "").trim().toUpperCase().replace(/\s+/g, "_"))
  );
  const [loading, setLoading] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  const [search, setSearch] = useState("");
  /** Date range (YYYY-MM-DD, inclusive) — limits the summary cards, the totals and the list. Blank = all dates. */
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  /** One funnel filter per column (TicketColumnFilter): column key → selected values; empty = no filter. */
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  /** Employee Requests only: PH (assigned branch Philippines) or US staff. */
  const [country, setCountry] = useState<"all" | "PH" | "US">("all");
  /** The employee's assigned branch — "" = every branch. Totals follow it, to see what each branch costs. */
  const [branch, setBranch] = useState("");
  // The table's sideways scroll — mirrored by a scrollbar pinned to the bottom of the screen.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  /** Spend by branch order: biggest spend first, or A → Z. */
  const [branchSort, setBranchSort] = useState<"amount" | "name">("amount");
  /** Flash Tech only: trip lines, the Flash Tech / Allowance requests employees send, or both. */
  const [flashTechView, setFlashTechView] = useState<"all" | "trips" | "hotel" | "carRental" | "allowance">("all");
  /** Rows whose Description is opened in full (clicked). */
  const [openDescriptions, setOpenDescriptions] = useState<Set<string>>(new Set());
  const toggleDescription = (id: string) =>
    setOpenDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // null = closed; { editing: null } = Add; { editing: row } = Edit.
  const [formState, setFormState] = useState<{ editing: ExpenseRow | null } | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Receipt clicked in the table's dedicated Receipt column — shown in a
  // lightbox instead of navigating away.
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);
  // Every receipt on the expense being viewed — Previous / Next in the lightbox.
  const [previewReceiptList, setPreviewReceiptList] = useState<string[]>([]);
  /** Flash Tech trip id → receipts uploaded on the trip, for its expense lines with no receipt of their own. */
  const [tripReceipts, setTripReceipts] = useState<Map<string, string[]>>(new Map());

  const load = useCallback(async () => {
    if (!ready || !uid) { setLoading(false); return; }
    setLoading(true);
    try {
      const [profileId, profileRows, expenseRows, tripReceiptMap] = await Promise.all([
        getMyProfileId(uid),
        getCompanyUsers(),
        getCompanyExpenses(),
        getFlashTechTripReceipts().catch(() => new Map<string, string[]>()),
      ]);
      setMyProfileId(profileId);
      setProfiles(profileRows);
      setExpenses(expenseRows);
      setTripReceipts(tripReceiptMap);
    } catch (error) {
      console.error("Failed to load expenses:", error);
    } finally {
      setLoading(false);
    }
  }, [ready, uid]);

  useEffect(() => { load(); }, [load]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const profileName = (id: string) => profileById.get(id)?.display_name || profileById.get(id)?.email || "—";

  // Every total/list below reads from this instead of raw `expenses` — the
  // only place flashTechOnly/selfFiledOnly's scoping actually applies.
  const scopedExpenses = useMemo(() => {
    if (flashTechOnly) {
      return expenses.filter((e) =>
        flashTechView === "trips" ? !!e.flashTechTripId
          : flashTechView === "hotel" ? e.category === "Hotel"
          : flashTechView === "carRental" ? e.category === "Car Rental"
          : flashTechView === "allowance" ? isFlashTechAllowance(e)
          : isFlashTechViewExpense(e)
      );
    }
    if (selfFiledOnly) {
      return expenses.filter((e) => isSelfFiledExpense(e) && !isFlashTechAllowance(e)).filter((e) => {
        if (country === "all") return true;
        const isPh = profileById.get(e.profileId)?.assigned_branch === "Philippines";
        return country === "PH" ? isPh : !isPh;
      });
    }
    if (categoryOnly) return expenses.filter((e) => e.category === categoryOnly);
    return expenses;
  }, [expenses, flashTechOnly, selfFiledOnly, categoryOnly, country, profileById, flashTechView]);

  const branchOf = (e: ExpenseRow) => profileById.get(e.profileId)?.assigned_branch || "No branch";
  const branchOptions = useMemo(() => Array.from(new Set(scopedExpenses.map(branchOf))).sort((a, b) => a.localeCompare(b)), [scopedExpenses, profileById]);
  // The date range and branch apply to the summary cards, the totals and the list alike.
  const rangeExpenses = useMemo(
    () => scopedExpenses.filter((e) => (!dateFrom || (e.expenseDate || "") >= dateFrom) && (!dateTo || (e.expenseDate || "") <= dateTo) && (!branch || branchOf(e) === branch)),
    [scopedExpenses, dateFrom, dateTo, branch, profileById]
  );

  const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /** "Approved / Rejected By" — who approved or rejected it; blank while Pending. */
  const reviewerName = (e: ExpenseRow) => (e.status !== "Pending" && e.reviewedBy ? profileName(e.reviewedBy) : "");
  // Its own receipts (several since migration 0415), else the ones uploaded on its Flash Tech trip.
  const receiptUrlsOf = (e: ExpenseRow) => (e.receipts.length ? e.receipts.map((r) => r.url) : e.flashTechTripId ? tripReceipts.get(e.flashTechTripId) ?? [] : []);
  const receiptCount = (e: ExpenseRow) => receiptUrlsOf(e).length;

  // Status, Approved / Rejected By and the Pending / Approved / Reimbursed
  // cards are for employees' own requests — Flash Tech, Hotel and Car Rental
  // are added straight by Accounting, so those tabs leave them out.
  // Flash Tech keeps them when it lists Flash Tech / Allowance requests (those need approving).
  const showStatus = !categoryOnly && (!flashTechOnly || scopedExpenses.some(isSelfFiledExpense));
  // Every column's value as its funnel filter sees it.
  const ALL_COLUMNS: { key: string; label: string; value: (e: ExpenseRow) => string }[] = [
    { key: "employee", label: "Employee", value: (e) => profileName(e.profileId) },
    { key: "branch", label: "Branch", value: (e) => branchOf(e) },
    { key: "category", label: "Category", value: (e) => e.category || "" },
    // Gas / Food / Other on a Reimbursement Form (migration 0401). Every "Other — …" is one filter choice, "Other".
    { key: "type", label: "Type", value: (e) => e.reimbursementType || "—" },
    { key: "date", label: "Date", value: (e) => e.expenseDate || "" },
    { key: "rental", label: "Pick-up / Return", value: (e) => rentalLabel(e) || "—" },
    { key: "amount", label: "Amount", value: (e) => fmtMoney(e.amount) },
    { key: "description", label: "Description", value: (e) => e.description || "" },
    { key: "sentBy", label: "Sent By", value: (e) => (e.createdBy ? profileName(e.createdBy) : "") },
    { key: "status", label: "Status", value: (e) => e.status },
    { key: "reviewer", label: "Approved / Rejected By", value: (e) => reviewerName(e) },
    { key: "receipt", label: "Receipt", value: (e) => (receiptCount(e) ? "Has receipt" : "No receipt") },
  ];
  // Pick-up / Return only when the view has Car Rentals in it.
  const showRental = scopedExpenses.some((e) => e.category === "Car Rental");
  const COLUMNS = ALL_COLUMNS.filter((c) => (showStatus || (c.key !== "status" && c.key !== "reviewer")) && (showRental || c.key !== "rental"));
  const matchesSearch = (e: ExpenseRow) =>
    !search || `${profileName(e.profileId)} ${e.createdBy ? profileName(e.createdBy) : ""} ${e.description}`.toLowerCase().includes(search.toLowerCase());
  const matchesColumns = (e: ExpenseRow, skipKey?: string) =>
    COLUMNS.every((c) => c.key === skipKey || !colFilters[c.key]?.size || colFilters[c.key].has(c.value(e)));

  const filtered = rangeExpenses.filter((e) => matchesSearch(e) && matchesColumns(e));
  /** A column's funnel options: its distinct values after every OTHER filter. */
  const columnOptions = (key: string) => {
    const col = COLUMNS.find((c) => c.key === key)!;
    const list = Array.from(new Set(rangeExpenses.filter((e) => matchesSearch(e) && matchesColumns(e, key)).map(col.value)));
    if (key === "date") return list.sort().reverse();
    if (key === "amount") return list.sort((a, b) => Number(a.replace(/[$,]/g, "")) - Number(b.replace(/[$,]/g, "")));
    return list.sort((a, b) => a.localeCompare(b));
  };
  const setColFilter = (key: string, next: Set<string>) => setColFilters((prev) => ({ ...prev, [key]: next }));
  const anyColumnFilter = Object.values(colFilters).some((v) => v.size > 0);

  const flashTechCounts = (() => {
    const counts = { all: 0, trips: 0, hotel: 0, carRental: 0, allowance: 0 };
    if (flashTechOnly) {
      for (const e of expenses) {
        if ((dateFrom && (e.expenseDate || "") < dateFrom) || (dateTo && (e.expenseDate || "") > dateTo)) continue;
        if (!isFlashTechViewExpense(e)) continue;
        counts.all++;
        if (e.flashTechTripId) counts.trips++;
        if (e.category === "Hotel") counts.hotel++;
        if (e.category === "Car Rental") counts.carRental++;
        if (isFlashTechAllowance(e)) counts.allowance++;
      }
    }
    return counts;
  })();

  // Largest single expense in view, and how many people it covers (the non-status tabs' cards).
  const largest = filtered.reduce<ExpenseRow | null>((top, e) => (!top || e.amount > top.amount ? e : top), null);
  const employeeCount = new Set(filtered.map((e) => e.profileId)).size;
  // Spend per branch over everything in view except the branch choice itself, biggest first.
  const branchSpend = (() => {
    const map = new Map<string, { branch: string; amount: number; count: number }>();
    for (const e of scopedExpenses) {
      if ((dateFrom && (e.expenseDate || "") < dateFrom) || (dateTo && (e.expenseDate || "") > dateTo)) continue;
      if (!matchesSearch(e) || !matchesColumns(e, "branch")) continue;
      const b = branchOf(e);
      const row = map.get(b) ?? { branch: b, amount: 0, count: 0 };
      row.amount += e.amount;
      row.count += 1;
      map.set(b, row);
    }
    return Array.from(map.values()).sort((a, b) => (branchSort === "name" ? a.branch.localeCompare(b.branch) : b.amount - a.amount || a.branch.localeCompare(b.branch)));
  })();
  const maxBranchSpend = branchSpend.reduce((m, b) => Math.max(m, b.amount), 0);

  // Summary cards + total follow the date range and the column filters.
  // On Flash Tech only the Flash Tech / Allowance requests have a status — trip lines don't.
  const withStatus = flashTechOnly ? filtered.filter(isSelfFiledExpense) : filtered;
  const totalPending = withStatus.filter((e) => e.status === "Pending");
  const totalApproved = withStatus.filter((e) => e.status === "Approved");
  const totalReimbursed = withStatus.filter((e) => e.status === "Reimbursed");
  const sum = (rows: ExpenseRow[]) => rows.reduce((s, r) => s + r.amount, 0);
  const fmtRangeDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const rangeLabel =
    dateFrom && dateTo ? `${fmtRangeDate(dateFrom)} – ${fmtRangeDate(dateTo)}` : dateFrom ? `From ${fmtRangeDate(dateFrom)}` : dateTo ? `Until ${fmtRangeDate(dateTo)}` : "All dates";
  const setRangePreset = (preset: "thisMonth" | "lastMonth" | "all") => {
    if (preset === "all") { setDateFrom(""); setDateTo(""); return; }
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - (preset === "lastMonth" ? 1 : 0), 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    setDateFrom(localISODate(first));
    setDateTo(localISODate(last));
  };

  const handleStatusChange = async (id: string, status: ExpenseStatus, rejectionReason?: string): Promise<boolean> => {
    setStatusChangingId(id);
    try {
      await updateExpenseStatus(id, status, myProfileId, rejectionReason);
      setExpenses(await getCompanyExpenses());
      return true;
    } catch (error) {
      alert(`Failed to update expense: ${error instanceof Error ? error.message : "Unknown error"}`);
      return false;
    } finally {
      setStatusChangingId(null);
    }
  };

  // Reject asks for a reason first — the employee sees it on the request in
  // Employee Self-Service → My Requests.
  const [rejecting, setRejecting] = useState<ExpenseRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const confirmReject = async () => {
    if (!rejecting || !rejectReason.trim()) return;
    if (await handleStatusChange(rejecting.id, "Rejected", rejectReason)) {
      setRejecting(null);
      setRejectReason("");
    }
  };

  const handleDelete = async (row: ExpenseRow) => {
    if (!confirm("Delete this expense record? This cannot be undone.")) return;
    setDeletingId(row.id);
    try {
      await deleteExpense(row.id);
      for (const r of row.receipts) {
        if (r.path) deleteExpenseReceiptFile(r.path).catch((err) => console.error("Failed to delete receipt file:", err));
      }
      setExpenses(await getCompanyExpenses());
    } catch (error) {
      alert(`Failed to delete expense: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = () => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    let csv = "Employee,Category,Date,Pick-up,Return,Amount,Description,Status,Sent By,Approved / Rejected By,Reviewed On,Rejection Reason\n";
    filtered.forEach((e) => {
      csv += [
        q(profileName(e.profileId)),
        q(e.category),
        q(e.expenseDate),
        q(e.pickupDate ?? ""),
        q(e.returnDate ?? ""),
        q(e.amount.toFixed(2)),
        q(e.description),
        q(e.status),
        q(e.createdBy ? profileName(e.createdBy) : ""),
        q(reviewerName(e)),
        q(reviewerName(e) ? fmtExpenseReviewedAt(e.reviewedAt) : ""),
        q(e.status === "Rejected" ? e.reviewNote ?? "" : ""),
      ].join(",") + "\n";
    });
    const el = document.createElement("a");
    // Leading BOM — without it Excel mis-decodes any non-ASCII character as
    // Windows-1252 instead of the UTF-8 the charset=utf-8 above declares.
    el.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(String.fromCharCode(0xfeff) + csv));
    el.setAttribute("download", `expenses-${todayISO()}.csv`);
    el.style.display = "none";
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  };

  return (
    <div className={embedded ? "" : "min-h-screen flex flex-col"}>
      <main className={embedded ? "" : "flex-1 max-w-[1400px] mx-auto w-full px-6 py-8"}>
        {!embedded && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-6">
              <button type="button" onClick={goBack} className="btn hover:bg-white/15">
                <ChevronLeft className="h-4 w-4" /> {mod.label}
              </button>
            </div>
            <div className="flex items-start gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                  {sub.title}
                </h1>
                <p className="text-sm text-muted-foreground">{sub.description}</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {/* Date range — drives the summary cards, the totals and the list below. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Date</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
              className="rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none [color-scheme:dark]"
            />
            <span className="text-xs text-slate-500">to</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
              className="rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none [color-scheme:dark]"
            />
            <div className="flex gap-1">
              <button type="button" onClick={() => setRangePreset("thisMonth")} className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700">This month</button>
              <button type="button" onClick={() => setRangePreset("lastMonth")} className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700">Last month</button>
              <button type="button" onClick={() => setRangePreset("all")} className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700">All dates</button>
            </div>
            <span className="ml-auto text-xs text-slate-400">Showing: <span className="font-semibold text-white">{rangeLabel}</span></span>
          </div>

          {/* Flash Tech: trip lines vs the Flash Tech / Allowance requests employees send — with counts for the date range. */}
          {flashTechOnly && (
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Flash Tech view">
              {([
                ["all", "All", Receipt, flashTechCounts.all, "violet"],
                ["trips", "Trips", Plane, flashTechCounts.trips, "sky"],
                ["hotel", "Hotel", BedDouble, flashTechCounts.hotel, "amber"],
                ["carRental", "Car Rental", Car, flashTechCounts.carRental, "rose"],
                ["allowance", "Allowance", Wallet, flashTechCounts.allowance, "emerald"],
              ] as const).map(([key, label, Icon, count, tone]) => {
                const on = flashTechView === key;
                const c = FT_VIEW_TONES[tone];
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setFlashTechView(key)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${on ? c.on : c.off}`}
                  >
                    <Icon className={`h-4 w-4 ${c.icon}`} />
                    {label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${on ? c.countOn : c.countOff}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(showStatus
              ? [
                  { label: "Pending", value: fmtMoney(sum(totalPending)), sub: `${totalPending.length} request${totalPending.length === 1 ? "" : "s"}`, Icon: Clock, tone: "amber" },
                  { label: "Approved", value: fmtMoney(sum(totalApproved)), sub: `${totalApproved.length} awaiting reimbursement`, Icon: CheckCircle, tone: "sky" },
                  { label: "Reimbursed", value: fmtMoney(sum(totalReimbursed)), sub: `${totalReimbursed.length} paid out`, Icon: Wallet, tone: "emerald" },
                  { label: "Total", value: fmtMoney(sum(filtered)), sub: `${filtered.length} record${filtered.length === 1 ? "" : "s"} · ${rangeLabel}${branch ? ` · ${branch}` : ""}`, Icon: DollarSign, tone: "violet" },
                ]
              : [
                  { label: "Total Spend", value: fmtMoney(sum(filtered)), sub: `${rangeLabel}${branch ? ` · ${branch}` : ""}`, Icon: DollarSign, tone: "violet" },
                  { label: "Records", value: filtered.length.toLocaleString(), sub: `${employeeCount} employee${employeeCount === 1 ? "" : "s"}`, Icon: Receipt, tone: "sky" },
                  { label: "Average", value: fmtMoney(filtered.length ? sum(filtered) / filtered.length : 0), sub: "per record", Icon: TrendingUp, tone: "emerald" },
                  { label: "Largest", value: largest ? fmtMoney(largest.amount) : "—", sub: largest ? `${profileName(largest.profileId)} · ${largest.expenseDate}` : "No records", Icon: Building2, tone: "amber" },
                ]
            ).map(({ label, value, sub, Icon, tone }) => (
              <div key={label} className={`relative overflow-hidden rounded-xl border bg-slate-900/60 p-4 ${KPI_TONES[tone].border}`}>
                <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 ${KPI_TONES[tone].bar}`} />
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KPI_TONES[tone].chip}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className={`mt-0.5 text-2xl font-bold tabular-nums ${KPI_TONES[tone].text}`}>{loading ? "…" : value}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500" title={sub}>{sub}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Spend by branch — what each branch costs in this view; click one to filter to it. */}
          {!loading && branchSpend.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-white">Spend by branch</p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-slate-500">{branch ? "Click the branch again to show every branch" : "Click a branch to see only its expenses"}</p>
                  <div className="flex gap-1" role="group" aria-label="Sort branches">
                    {([["amount", "Most → least"], ["name", "A → Z"]] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setBranchSort(key)}
                        aria-pressed={branchSort === key}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${branchSort === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Reads down the first column, then the second. */}
              <div
                className="grid gap-x-6 gap-y-1 md:grid-flow-col"
                style={{ gridTemplateRows: `repeat(${Math.ceil(branchSpend.length / 2)}, auto)` }}
              >
                {branchSpend.map((b) => {
                  const on = branch === b.branch;
                  return (
                    <button
                      key={b.branch}
                      type="button"
                      onClick={() => setBranch(on ? "" : b.branch)}
                      aria-pressed={on}
                      className={`group grid grid-cols-[9rem_1fr_7.5rem] items-center gap-3 rounded-md px-2 py-1 text-left text-xs transition ${on ? "bg-blue-500/15 ring-1 ring-blue-500/40" : "hover:bg-white/5"}`}
                    >
                      <span className={`truncate ${on ? "font-semibold text-white" : "text-slate-300"}`} title={b.branch}>{b.branch}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-white/5">
                        <span className={`block h-full rounded-full ${on ? "bg-blue-400" : "bg-blue-500/60 group-hover:bg-blue-400/80"}`} style={{ width: `${maxBranchSpend > 0 ? Math.max(2, (b.amount / maxBranchSpend) * 100) : 2}%` }} />
                      </span>
                      <span className="text-right tabular-nums text-slate-200">
                        {fmtMoney(b.amount)} <span className="text-slate-500">· {b.count}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search employee, sender or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-[260px] flex-1 bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                aria-label="Branch"
                className="rounded-lg border border-white/10 bg-slate-800/50 px-2 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">All branches</option>
                {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              {selfFiledOnly && (
                <div className="flex gap-1" role="group" aria-label="Country">
                  {(["all", "PH", "US"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCountry(c)}
                      aria-pressed={country === c}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${country === c ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
                    >
                      {c === "all" ? "All" : c}
                    </button>
                  ))}
                </div>
              )}
              {anyColumnFilter && (
                <button type="button" onClick={() => setColFilters({})} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
                  Clear column filters
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={handleDownload} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-semibold transition inline-flex items-center gap-2">
                <Download className="h-4 w-4" /> Export CSV
              </button>
              {!selfFiledOnly && (
                <button onClick={() => setFormState({ editing: null })} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition">
                  + Add Expense
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div ref={tableScrollRef} className="bg-slate-900/50 border border-white/10 rounded-lg p-4 max-w-full overflow-x-auto">
            <h2 className="text-lg font-bold text-white mb-3">{selfFiledOnly ? "Employee Requests" : "Expense Records"}</h2>
            <table className="w-full min-w-max text-xs">
              <thead>
                <tr className="border-b border-white/10">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`px-2 py-2 text-[10px] font-semibold text-slate-400 uppercase whitespace-nowrap ${c.key === "amount" ? "text-right" : "text-left"}`}>
                      <span className={`inline-flex items-center ${c.key === "amount" ? "justify-end" : ""}`}>
                        {c.label}
                        <TicketColumnFilter
                          options={columnOptions(c.key)}
                          selected={colFilters[c.key] ?? new Set()}
                          onChange={(next) => setColFilter(c.key, next)}
                          label={`Filter by ${c.label}`}
                        />
                      </span>
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-400">Loading expenses…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-400">{selfFiledOnly && scopedExpenses.length === 0 ? "No employee has sent an expense request yet." : "No expense records match this filter."}</td></tr>
                ) : filtered.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/5 transition">
                    <td className="px-2 py-1.5 text-white font-medium whitespace-nowrap">{profileName(e.profileId)}</td>
                    <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{branchOf(e)}</td>
                    <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{e.category}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {e.reimbursementType ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${e.reimbursementType === "Gas" ? "border-sky-400/40 bg-sky-500/10 text-sky-200" : e.reimbursementType === "Food" ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : isFlashTechAllowance(e) ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-violet-400/40 bg-violet-500/10 text-violet-200"}`} title={reimbursementTypeLabel(e)}>
                          {reimbursementTypeLabel(e)}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap tabular-nums">{e.expenseDate}</td>
                    {showRental && (
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                        {rentalLabel(e) ? (
                          <>
                            <div className="text-slate-200">{rentalLabel(e)}</div>
                            {rentalDays(e) != null && <div className="text-[11px] text-slate-500">{rentalDays(e)} day{rentalDays(e) === 1 ? "" : "s"}</div>}
                          </>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right text-slate-200 font-mono">{fmtMoney(e.amount)}</td>
                    <td className="px-2 py-1.5 text-slate-400 w-[260px] max-w-[260px] whitespace-normal">
                      {e.description ? (
                        <button
                          type="button"
                          onClick={() => toggleDescription(e.id)}
                          aria-expanded={openDescriptions.has(e.id)}
                          title={openDescriptions.has(e.id) ? "Click to collapse" : "Click to read it all"}
                          className={`block w-full text-left hover:text-slate-200 ${openDescriptions.has(e.id) ? "whitespace-pre-wrap break-words text-slate-200" : "truncate"}`}
                        >
                          {e.description}
                        </button>
                      ) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{e.createdBy ? profileName(e.createdBy) : "—"}</td>
                    {showStatus && (<>
                    <td className="px-3 py-3">
                      {isSelfFiledExpense(e) || !flashTechOnly ? (
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${expenseStatusColor(e.status)}`}>{e.status}</span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {reviewerName(e) ? (
                        <>
                          <div className="text-slate-200">{reviewerName(e)}</div>
                          <div className="text-[11px] text-slate-500">
                            {e.status === "Rejected" ? "Rejected" : "Approved"}
                            {e.reviewedAt ? ` · ${fmtExpenseReviewedAt(e.reviewedAt)}` : ""}
                          </div>
                          {e.status === "Rejected" && e.reviewNote && (
                            <div className="text-[11px] text-red-300 max-w-[220px] truncate" title={e.reviewNote}>Reason: {e.reviewNote}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    </>)}
                    <td className="px-3 py-3">
                      {(() => {
                        const urls = receiptUrlsOf(e);
                        if (urls.length === 0) return <span className="text-slate-600 text-xs">—</span>;
                        return (
                          <div className="flex items-center gap-1">
                            {urls.slice(0, 2).map((url) => (
                              <button
                                key={url}
                                type="button"
                                onClick={() => { setPreviewReceiptList(urls); setPreviewReceiptUrl(url); }}
                                title={e.receipts.length ? `View receipt${urls.length > 1 ? `s (${urls.length})` : ""}` : "View receipt (uploaded on the Flash Tech trip)"}
                                className="block h-8 w-8 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
                              >
                                {isPdfReceipt(url) ? (
                                  <span className="flex h-full w-full items-center justify-center text-slate-400">
                                    <Paperclip className="h-4 w-4" />
                                  </span>
                                ) : (
                                  <img src={url} alt="Receipt thumbnail" className="h-full w-full object-cover" />
                                )}
                              </button>
                            ))}
                            {urls.length > 2 && (
                              <button
                                type="button"
                                onClick={() => { setPreviewReceiptList(urls); setPreviewReceiptUrl(urls[2]); }}
                                className="rounded bg-slate-800 px-1.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
                                title={`View all ${urls.length} receipts`}
                              >
                                +{urls.length - 2}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
                        {/* Approve / Reject only on employees' own requests — Flash Tech, Hotel and Car Rental are added straight by Accounting. */}
                        {isSelfFiledExpense(e) && e.status === "Pending" && !canReviewExpenses && (
                          <span className="text-[11px] text-slate-500" title="Only Accounting can approve or reject expenses">Awaiting Accounting</span>
                        )}
                        {isSelfFiledExpense(e) && e.status === "Pending" && canReviewExpenses && (
                          <>
                            <button onClick={() => handleStatusChange(e.id, "Approved")} disabled={statusChangingId === e.id} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                              {statusChangingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />} Approve
                            </button>
                            <button onClick={() => { setRejecting(e); setRejectReason(""); }} disabled={statusChangingId === e.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                              {statusChangingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Reject
                            </button>
                          </>
                        )}
                        {/* Flash Tech-linked expenses stop at Approved/Rejected — no Reimbursed stage. */}
                        {e.status === "Approved" && !e.flashTechTripId && canReviewExpenses && (
                          <button onClick={() => handleStatusChange(e.id, "Reimbursed")} disabled={statusChangingId === e.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                            {statusChangingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wallet className="h-3 w-3" />} Mark Reimbursed
                          </button>
                        )}
                        <button onClick={() => setFormState({ editing: e })} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition flex items-center gap-1">
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button onClick={() => handleDelete(e)} disabled={deletingId === e.id} className="px-2 py-1 bg-slate-700 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {deletingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />

      {previewReceiptUrl && <ReceiptLightbox url={previewReceiptUrl} urls={previewReceiptList} onClose={() => setPreviewReceiptUrl(null)} />}

      {rejecting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => statusChangingId !== rejecting.id && setRejecting(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-bold text-white">Reject Expense</h3>
              <button onClick={() => setRejecting(null)} className="text-slate-400 hover:text-white transition p-1">✕</button>
            </div>
            <p className="text-sm text-slate-300 mb-3">
              {profileName(rejecting.profileId)} · {rejecting.category} · {fmtMoney(rejecting.amount)} on {rejecting.expenseDate}
            </p>
            <label className="block text-xs text-slate-400 uppercase mb-1">
              Reason for rejection <span className="text-red-400 normal-case">* required</span>
            </label>
            <textarea
              autoFocus
              value={rejectReason}
              onChange={(ev) => setRejectReason(ev.target.value)}
              rows={4}
              placeholder="e.g. Receipt is unreadable — please resend a clear photo."
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">The employee sees this on their request in Employee Self-Service.</p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={confirmReject}
                disabled={!rejectReason.trim() || statusChangingId === rejecting.id}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition font-semibold text-sm inline-flex items-center justify-center gap-2"
              >
                {statusChangingId === rejecting.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
              </button>
              <button onClick={() => setRejecting(null)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {formState && (
        <ExpenseFormModal
          editing={formState.editing}
          profiles={profiles}
          createdBy={myProfileId}
          companyId={companyId}
          defaultCategory={categoryOnly ?? (flashTechOnly && flashTechView === "hotel" ? "Hotel" : flashTechOnly && flashTechView === "carRental" ? "Car Rental" : undefined)}
          onClose={() => setFormState(null)}
          onSaved={async () => setExpenses(await getCompanyExpenses())}
        />
      )}
    </div>
  );
}
