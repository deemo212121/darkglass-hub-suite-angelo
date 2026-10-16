import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Download, DollarSign, Clock, CheckCircle, Wallet, Pencil, Trash2, XCircle, Paperclip, Loader2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import {
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
  const { uid, ready, companyId } = useAuth();
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

  // null = closed; { editing: null } = Add; { editing: row } = Edit.
  const [formState, setFormState] = useState<{ editing: ExpenseRow | null } | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Receipt clicked in the table's dedicated Receipt column — shown in a
  // lightbox instead of navigating away.
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);
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
    if (flashTechOnly) return expenses.filter((e) => e.flashTechTripId);
    if (selfFiledOnly) return expenses.filter(isSelfFiledExpense);
    if (categoryOnly) return expenses.filter((e) => e.category === categoryOnly);
    return expenses;
  }, [expenses, flashTechOnly, selfFiledOnly, categoryOnly]);

  // The date range applies to the summary cards, the totals and the list alike.
  const rangeExpenses = useMemo(
    () => scopedExpenses.filter((e) => (!dateFrom || (e.expenseDate || "") >= dateFrom) && (!dateTo || (e.expenseDate || "") <= dateTo)),
    [scopedExpenses, dateFrom, dateTo]
  );

  const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /** "Approved / Rejected By" — who approved or rejected it; blank while Pending. */
  const reviewerName = (e: ExpenseRow) => (e.status !== "Pending" && e.reviewedBy ? profileName(e.reviewedBy) : "");
  const receiptCount = (e: ExpenseRow) => (e.receiptUrl ? 1 : e.flashTechTripId ? tripReceipts.get(e.flashTechTripId)?.length ?? 0 : 0);

  // Every column's value as its funnel filter sees it.
  const COLUMNS: { key: string; label: string; value: (e: ExpenseRow) => string }[] = [
    { key: "employee", label: "Employee", value: (e) => profileName(e.profileId) },
    { key: "category", label: "Category", value: (e) => e.category || "" },
    { key: "date", label: "Date", value: (e) => e.expenseDate || "" },
    { key: "amount", label: "Amount", value: (e) => fmtMoney(e.amount) },
    { key: "description", label: "Description", value: (e) => e.description || "" },
    { key: "sentBy", label: "Sent By", value: (e) => (e.createdBy ? profileName(e.createdBy) : "") },
    { key: "status", label: "Status", value: (e) => e.status },
    { key: "reviewer", label: "Approved / Rejected By", value: (e) => reviewerName(e) },
    { key: "receipt", label: "Receipt", value: (e) => (receiptCount(e) ? "Has receipt" : "No receipt") },
  ];
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

  // Summary cards + total follow the date range and the column filters.
  const totalPending = filtered.filter((e) => e.status === "Pending");
  const totalApproved = filtered.filter((e) => e.status === "Approved");
  const totalReimbursed = filtered.filter((e) => e.status === "Reimbursed");
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
      if (row.receiptPath) {
        deleteExpenseReceiptFile(row.receiptPath).catch((err) => console.error("Failed to delete receipt file:", err));
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
    let csv = "Employee,Category,Date,Amount,Description,Status,Sent By,Approved / Rejected By,Reviewed On,Rejection Reason\n";
    filtered.forEach((e) => {
      csv += [
        q(profileName(e.profileId)),
        q(e.category),
        q(e.expenseDate),
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

          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Pending</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-2">{loading ? "…" : fmtMoney(sum(totalPending))}</p>
                  <p className="text-xs text-slate-500 mt-1">{totalPending.length} request{totalPending.length === 1 ? "" : "s"}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Approved</p>
                  <p className="text-2xl font-bold text-blue-400 mt-2">{loading ? "…" : fmtMoney(sum(totalApproved))}</p>
                  <p className="text-xs text-slate-500 mt-1">{totalApproved.length} awaiting reimbursement</p>
                </div>
                <CheckCircle className="h-8 w-8 text-blue-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Reimbursed</p>
                  <p className="text-2xl font-bold text-green-400 mt-2">{loading ? "…" : fmtMoney(sum(totalReimbursed))}</p>
                  <p className="text-xs text-slate-500 mt-1">{totalReimbursed.length} paid out</p>
                </div>
                <Wallet className="h-8 w-8 text-green-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Total</p>
                  <p className="text-2xl font-bold text-white mt-2">{loading ? "…" : fmtMoney(sum(filtered))}</p>
                  <p className="text-xs text-slate-500 mt-1">{filtered.length} record{filtered.length === 1 ? "" : "s"} · {rangeLabel}</p>
                </div>
                <DollarSign className="h-8 w-8 text-purple-400 opacity-50" />
              </div>
            </div>
          </div>

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
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
            <h2 className="text-lg font-bold text-white mb-4">{selfFiledOnly ? "Employee Requests" : "Expense Records"}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`px-3 py-3 text-xs font-semibold text-slate-400 uppercase ${c.key === "amount" ? "text-right" : "text-left"}`}>
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
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Loading expenses…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">{selfFiledOnly && scopedExpenses.length === 0 ? "No employee has sent an expense request yet." : "No expense records match this filter."}</td></tr>
                ) : filtered.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/5 transition">
                    <td className="px-3 py-3 text-white font-medium">{profileName(e.profileId)}</td>
                    <td className="px-3 py-3 text-slate-300">{e.category}</td>
                    <td className="px-3 py-3 text-slate-300">{e.expenseDate}</td>
                    <td className="px-3 py-3 text-right text-slate-200 font-mono">{fmtMoney(e.amount)}</td>
                    <td className="px-3 py-3 text-slate-400 max-w-xs truncate" title={e.description}>{e.description || "—"}</td>
                    <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{e.createdBy ? profileName(e.createdBy) : "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${expenseStatusColor(e.status)}`}>{e.status}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
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
                    <td className="px-3 py-3">
                      {(() => {
                        // Its own receipt, else the receipts uploaded on its Flash Tech trip.
                        const urls = e.receiptUrl ? [e.receiptUrl] : e.flashTechTripId ? tripReceipts.get(e.flashTechTripId) ?? [] : [];
                        if (urls.length === 0) return <span className="text-slate-600 text-xs">—</span>;
                        return (
                          <div className="flex items-center gap-1">
                            {urls.slice(0, 2).map((url) => (
                              <button
                                key={url}
                                type="button"
                                onClick={() => setPreviewReceiptUrl(url)}
                                title={e.receiptUrl ? "View receipt" : "View receipt (uploaded on the Flash Tech trip)"}
                                className="block h-10 w-10 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
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
                            {urls.length > 2 && <span className="text-[11px] text-slate-400">+{urls.length - 2}</span>}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {e.status === "Pending" && (
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
                        {e.status === "Approved" && !e.flashTechTripId && (
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

      {previewReceiptUrl && <ReceiptLightbox url={previewReceiptUrl} onClose={() => setPreviewReceiptUrl(null)} />}

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
          defaultCategory={categoryOnly}
          onClose={() => setFormState(null)}
          onSaved={async () => setExpenses(await getCompanyExpenses())}
        />
      )}
    </div>
  );
}
