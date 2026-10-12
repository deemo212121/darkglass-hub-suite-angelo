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
  type ExpenseRow,
  type ExpenseStatus,
} from "@/lib/supabase/expenses";
import { localISODate, todayISO } from "@/lib/localDate";
import { ExpenseFormModal, EXPENSE_CATEGORIES } from "@/components/ExpenseFormModal";
import { ReceiptLightbox, isPdfReceipt } from "@/components/ReceiptLightbox";

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
  return !e.flashTechTripId && e.createdBy != null && e.createdBy === e.profileId;
}

export function ExpenseTrackingPage({
  mod,
  sub,
  embedded,
  flashTechOnly,
  selfFiledOnly,
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
}) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, ready, companyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  const [search, setSearch] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // null = closed; { editing: null } = Add; { editing: row } = Edit.
  const [formState, setFormState] = useState<{ editing: ExpenseRow | null } | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Receipt clicked in the table's dedicated Receipt column — shown in a
  // lightbox instead of navigating away.
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready || !uid) { setLoading(false); return; }
    setLoading(true);
    try {
      const [profileId, profileRows, expenseRows] = await Promise.all([
        getMyProfileId(uid),
        getCompanyUsers(),
        getCompanyExpenses(),
      ]);
      setMyProfileId(profileId);
      setProfiles(profileRows);
      setExpenses(expenseRows);
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
    return expenses;
  }, [expenses, flashTechOnly, selfFiledOnly]);

  const filtered = useMemo(() => {
    return scopedExpenses.filter((e) => {
      if (filterEmployee !== "all" && e.profileId !== filterEmployee) return false;
      if (filterCategory !== "all" && e.category !== filterCategory) return false;
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (search) {
        const blob = `${profileName(e.profileId)} ${e.createdBy ? profileName(e.createdBy) : ""} ${e.description}`.toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [scopedExpenses, filterEmployee, filterCategory, filterStatus, search, profileById]);

  const totalPending = scopedExpenses.filter((e) => e.status === "Pending");
  const totalApproved = scopedExpenses.filter((e) => e.status === "Approved");
  const totalReimbursed = scopedExpenses.filter((e) => e.status === "Reimbursed");
  const sum = (rows: ExpenseRow[]) => rows.reduce((s, r) => s + r.amount, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartISO = localISODate(monthStart);
  const thisMonthTotal = sum(scopedExpenses.filter((e) => e.expenseDate >= monthStartISO));

  const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /** "Approved / Rejected By" — who approved or rejected it; blank while Pending. */
  const reviewerName = (e: ExpenseRow) => (e.status !== "Pending" && e.reviewedBy ? profileName(e.reviewedBy) : "");

  const handleStatusChange = async (id: string, status: ExpenseStatus) => {
    setStatusChangingId(id);
    try {
      await updateExpenseStatus(id, status, myProfileId);
      setExpenses(await getCompanyExpenses());
    } catch (error) {
      alert(`Failed to update expense: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setStatusChangingId(null);
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
    let csv = "Employee,Category,Date,Amount,Description,Status,Sent By,Approved / Rejected By,Reviewed On\n";
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
                  <p className="text-xs text-slate-400 uppercase">This Month</p>
                  <p className="text-2xl font-bold text-white mt-2">{loading ? "…" : fmtMoney(thisMonthTotal)}</p>
                  <p className="text-xs text-slate-500 mt-1">all statuses</p>
                </div>
                <DollarSign className="h-8 w-8 text-purple-400 opacity-50" />
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <input
                type="text"
                placeholder="Search employee, sender or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                <option value="all">All Employees</option>
                {profiles.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email}</option>)}
              </select>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                <option value="all">All Categories</option>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                <option value="all">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Reimbursed">Reimbursed</option>
                <option value="Rejected">Rejected</option>
              </select>
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
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Category</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Date</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Amount</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Description</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Sent By</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Approved / Rejected By</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Receipt</th>
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
                        </>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {e.receiptUrl ? (
                        <button
                          type="button"
                          onClick={() => e.receiptUrl && setPreviewReceiptUrl(e.receiptUrl)}
                          title="View receipt"
                          className="block h-10 w-10 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
                        >
                          {isPdfReceipt(e.receiptUrl) ? (
                            <span className="flex h-full w-full items-center justify-center text-slate-400">
                              <Paperclip className="h-4 w-4" />
                            </span>
                          ) : (
                            <img src={e.receiptUrl} alt="Receipt thumbnail" className="h-full w-full object-cover" />
                          )}
                        </button>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {e.status === "Pending" && (
                          <>
                            <button onClick={() => handleStatusChange(e.id, "Approved")} disabled={statusChangingId === e.id} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                              {statusChangingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />} Approve
                            </button>
                            <button onClick={() => handleStatusChange(e.id, "Rejected")} disabled={statusChangingId === e.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
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

      {formState && (
        <ExpenseFormModal
          editing={formState.editing}
          profiles={profiles}
          createdBy={myProfileId}
          companyId={companyId}
          onClose={() => setFormState(null)}
          onSaved={async () => setExpenses(await getCompanyExpenses())}
        />
      )}
    </div>
  );
}
