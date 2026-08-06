import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Download, DollarSign, Clock, CheckCircle, Wallet, Pencil, Trash2, XCircle, Paperclip, X, Loader2, CalendarDays } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { randomId } from "@/lib/utils";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { uploadExpenseReceipt, deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import {
  getCompanyExpenses,
  createExpense,
  updateExpense,
  updateExpenseStatus,
  deleteExpense,
  type ExpenseRow,
  type ExpenseCategory,
  type ExpenseStatus,
} from "@/lib/supabase/expenses";

const CATEGORIES: ExpenseCategory[] = ["Travel", "Supplies", "Meals", "Other"];

const emptyForm = {
  profileId: "",
  category: "Travel" as ExpenseCategory,
  expenseDate: new Date().toISOString().slice(0, 10),
  amount: "",
  description: "",
  receiptUrl: null as string | null,
  receiptPath: null as string | null,
  orNumber: "",
  fromLocation: "",
  toLocation: "",
};

function statusColor(status: ExpenseStatus): string {
  switch (status) {
    case "Pending": return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    case "Approved": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "Reimbursed": return "bg-green-500/20 text-green-300 border-green-500/30";
    case "Rejected": return "bg-red-500/20 text-red-300 border-red-500/30";
  }
}

// receiptUrl is a Firebase Storage download URL — the original filename
// (with extension) survives in its path component, before the "?" query
// string that carries the access token, so a plain extension check still
// works despite the URL not literally ending in ".pdf".
function isPdfReceipt(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

export function ExpenseTrackingPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid, ready, companyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  const [search, setSearch] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Storage folder key for the receipt upload — a brand-new expense has no
  // row id yet, so a client-generated key stands in until it's saved; an
  // existing expense being edited just uses its own real id.
  const [newExpenseKey, setNewExpenseKey] = useState("");
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // The receipt path this expense had BEFORE this edit session, so a
  // replace/remove can clean up the old Storage file once the save succeeds.
  const [originalReceiptPath, setOriginalReceiptPath] = useState<string | null>(null);
  // Receipt clicked in the table's dedicated Receipt column — shown in a
  // lightbox instead of navigating away, so reviewing a receipt doesn't
  // lose your place in the table. Same zoom/pan mechanics as TicketPhotos.tsx's
  // lightbox (scroll/pinch/double-click to zoom, drag to pan when zoomed).
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const lastTouchDist = useRef<number | null>(null);
  const openReceiptPreview = (url: string) => {
    setPreviewReceiptUrl(url);
    setZoomScale(1);
    setZoomPos({ x: 0, y: 0 });
  };
  const closeReceiptPreview = () => {
    setPreviewReceiptUrl(null);
    setZoomScale(1);
    setZoomPos({ x: 0, y: 0 });
  };

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

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (filterEmployee !== "all" && e.profileId !== filterEmployee) return false;
      if (filterCategory !== "all" && e.category !== filterCategory) return false;
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (search) {
        const blob = `${profileName(e.profileId)} ${e.description}`.toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [expenses, filterEmployee, filterCategory, filterStatus, search, profileById]);

  const totalPending = expenses.filter((e) => e.status === "Pending");
  const totalApproved = expenses.filter((e) => e.status === "Approved");
  const totalReimbursed = expenses.filter((e) => e.status === "Reimbursed");
  const sum = (rows: ExpenseRow[]) => rows.reduce((s, r) => s + r.amount, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartISO = monthStart.toISOString().slice(0, 10);
  const thisMonthTotal = sum(expenses.filter((e) => e.expenseDate >= monthStartISO));

  const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setShowForm(false); };

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setNewExpenseKey(randomId());
    setOriginalReceiptPath(null);
    setShowForm(true);
  };
  const openEdit = (e: ExpenseRow) => {
    setForm({
      profileId: e.profileId,
      category: e.category,
      expenseDate: e.expenseDate,
      amount: String(e.amount),
      description: e.description,
      receiptUrl: e.receiptUrl,
      receiptPath: e.receiptPath,
      orNumber: e.orNumber || "",
      fromLocation: e.fromLocation || "",
      toLocation: e.toLocation || "",
    });
    setEditingId(e.id);
    setOriginalReceiptPath(e.receiptPath);
    setShowForm(true);
  };

  const handleReceiptSelect = async (file: File) => {
    setUploadingReceipt(true);
    try {
      const folderKey = editingId ?? newExpenseKey;
      const { url, fullPath } = await uploadExpenseReceipt(companyId || "COMP001", folderKey, file);
      setForm((f) => ({ ...f, receiptUrl: url, receiptPath: fullPath }));
    } catch (error) {
      alert(`Failed to upload receipt: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleRemoveReceipt = () => {
    setForm((f) => ({ ...f, receiptUrl: null, receiptPath: null }));
  };

  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (!form.profileId || !form.expenseDate || !Number.isFinite(amount) || amount <= 0) {
      alert("Please select an employee, date, and a valid amount.");
      return;
    }
    setSavingExpense(true);
    try {
      if (editingId) {
        await updateExpense(editingId, {
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
          receiptUrl: form.receiptUrl,
          receiptPath: form.receiptPath,
          orNumber: form.orNumber,
          fromLocation: form.fromLocation,
          toLocation: form.toLocation,
        });
      } else {
        await createExpense({
          profileId: form.profileId,
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
          createdBy: myProfileId,
          receiptUrl: form.receiptUrl,
          receiptPath: form.receiptPath,
          orNumber: form.orNumber,
          fromLocation: form.fromLocation,
          toLocation: form.toLocation,
        });
      }
      // Best-effort: if a receipt was replaced or removed during this edit,
      // clean up the old Storage file now that the save succeeded.
      if (originalReceiptPath && originalReceiptPath !== form.receiptPath) {
        deleteExpenseReceiptFile(originalReceiptPath).catch((err) => console.error("Failed to delete old receipt file:", err));
      }
      setExpenses(await getCompanyExpenses());
      resetForm();
    } catch (error) {
      alert(`Failed to save expense: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSavingExpense(false);
    }
  };

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
    let csv = "Employee,Category,Date,Amount,Description,Status\n";
    filtered.forEach((e) => {
      csv += `"${profileName(e.profileId)}","${e.category}","${e.expenseDate}","${e.amount.toFixed(2)}","${e.description}","${e.status}"\n`;
    });
    const el = document.createElement("a");
    el.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csv));
    el.setAttribute("download", `expenses-${new Date().toISOString().slice(0, 10)}.csv`);
    el.style.display = "none";
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div className="flex items-start gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                {sub.title}
              </h1>
              <p className="text-sm text-muted-foreground">{sub.description}</p>
            </div>
            <Link
              to="/m/$module/$submodule"
              params={{ module: mod.slug, submodule: "flash-tech-calendar" }}
              className="ml-auto btn hover:bg-white/15 shrink-0 inline-flex items-center gap-2"
              title="Flash Tech Calendar"
            >
              <CalendarDays className="h-4 w-4" />
              Flash Tech
            </Link>
          </div>
        </div>

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
                placeholder="Search employee or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                <option value="all">All Employees</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email}</option>)}
              </select>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                <option value="all">All Categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
              <button onClick={openAdd} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition">
                + Add Expense
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
            <h2 className="text-lg font-bold text-white mb-4">Expense Records</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Category</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Date</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Amount</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Description</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Receipt</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Loading expenses…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No expense records match this filter.</td></tr>
                ) : filtered.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/5 transition">
                    <td className="px-3 py-3 text-white font-medium">{profileName(e.profileId)}</td>
                    <td className="px-3 py-3 text-slate-300">{e.category}</td>
                    <td className="px-3 py-3 text-slate-300">{e.expenseDate}</td>
                    <td className="px-3 py-3 text-right text-slate-200 font-mono">{fmtMoney(e.amount)}</td>
                    <td className="px-3 py-3 text-slate-400 max-w-xs truncate" title={e.description}>{e.description || "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${statusColor(e.status)}`}>{e.status}</span>
                    </td>
                    <td className="px-3 py-3">
                      {e.receiptUrl ? (
                        <button
                          type="button"
                          onClick={() => e.receiptUrl && openReceiptPreview(e.receiptUrl)}
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
                        <button onClick={() => openEdit(e)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition flex items-center gap-1">
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

      {/* Receipt Lightbox — same zoom/pan mechanics as TicketPhotos.tsx */}
      {previewReceiptUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={closeReceiptPreview}>
          {/* Toolbar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/60 z-10">
            <div className="text-sm text-slate-200 truncate max-w-xs">Receipt</div>
            <div className="flex items-center gap-2">
              {!isPdfReceipt(previewReceiptUrl) && (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setZoomScale((s) => Math.max(1, +(s - 0.5).toFixed(1))); if (zoomScale <= 1.5) setZoomPos({ x: 0, y: 0 }); }}
                    className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center"
                    title="Zoom out"
                  >
                    −
                  </button>
                  <span className="text-xs text-slate-300 w-10 text-center">{Math.round(zoomScale * 100)}%</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setZoomScale((s) => Math.min(5, +(s + 0.5).toFixed(1))); }}
                    className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center"
                    title="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}
                    className="px-2 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-xs"
                    title="Reset zoom"
                  >
                    Reset
                  </button>
                </>
              )}
              <a
                href={previewReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="px-2 h-8 rounded bg-blue-600/40 hover:bg-blue-600/60 text-blue-200 text-xs flex items-center"
              >
                Open original ↗
              </a>
              <button type="button" onClick={closeReceiptPreview} className="w-8 h-8 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm flex items-center justify-center">
                ✕
              </button>
            </div>
          </div>

          {isPdfReceipt(previewReceiptUrl) ? (
            <iframe src={previewReceiptUrl} title="Receipt" className="w-full h-full pt-12 pb-8" onClick={(e) => e.stopPropagation()} />
          ) : (
            <div
              className="overflow-hidden w-full h-full flex items-center justify-center cursor-zoom-in pt-12 pb-8"
              onDoubleClick={(e) => { e.stopPropagation(); if (zoomScale > 1) { setZoomScale(1); setZoomPos({ x: 0, y: 0 }); } else { setZoomScale(2.5); } }}
              onWheel={(e) => { e.stopPropagation(); const delta = e.deltaY > 0 ? -0.2 : 0.2; setZoomScale((s) => Math.min(5, Math.max(1, +(s + delta).toFixed(1)))); if (zoomScale + delta <= 1) setZoomPos({ x: 0, y: 0 }); }}
              onTouchStart={(e) => { if (e.touches.length === 2) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; lastTouchDist.current = Math.sqrt(dx * dx + dy * dy); } }}
              onTouchMove={(e) => { if (e.touches.length === 2 && lastTouchDist.current !== null) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; const dist = Math.sqrt(dx * dx + dy * dy); setZoomScale((s) => Math.min(5, Math.max(1, +(s * (dist / lastTouchDist.current!)).toFixed(2)))); lastTouchDist.current = dist; } }}
              onTouchEnd={() => { lastTouchDist.current = null; }}
            >
              <img
                src={previewReceiptUrl}
                alt="Receipt"
                draggable={false}
                style={{
                  transform: `scale(${zoomScale}) translate(${zoomPos.x / zoomScale}px, ${zoomPos.y / zoomScale}px)`,
                  transition: zoomScale === 1 ? "transform 0.2s ease" : "none",
                  maxHeight: "calc(100vh - 80px)",
                  maxWidth: "100%",
                  objectFit: "contain",
                  userSelect: "none",
                  cursor: zoomScale > 1 ? "grab" : "zoom-in",
                }}
                onMouseDown={(e) => {
                  if (zoomScale <= 1) return;
                  e.preventDefault();
                  const startX = e.clientX - zoomPos.x;
                  const startY = e.clientY - zoomPos.y;
                  const onMove = (mv: MouseEvent) => { setZoomPos({ x: mv.clientX - startX, y: mv.clientY - startY }); };
                  const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              />
            </div>
          )}

          {/* Caption */}
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-black/60 text-xs text-slate-400 text-center">
            {isPdfReceipt(previewReceiptUrl) ? "PDF receipt" : "Scroll to zoom · Double-click to zoom in/out · Drag to pan when zoomed"}
          </div>
        </div>
      )}

      {/* Add / Edit Expense Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-white">{editingId ? "Edit Expense" : "Add Expense"}</h3>
              <button onClick={resetForm} className="text-slate-400 hover:text-white transition p-1">✕</button>
            </div>
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Employee</label>
                <select
                  value={form.profileId}
                  disabled={Boolean(editingId)}
                  onChange={(e) => setForm({ ...form, profileId: e.target.value })}
                  className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60"
                >
                  <option value="">Select employee</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Date</label>
                  <input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Amount ($)</label>
                <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">OR/Transaction Number</label>
                <input type="text" value={form.orNumber} onChange={(e) => setForm({ ...form, orNumber: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">From</label>
                  <input type="text" value={form.fromLocation} onChange={(e) => setForm({ ...form, fromLocation: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">To</label>
                  <input type="text" value={form.toLocation} onChange={(e) => setForm({ ...form, toLocation: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Receipt</label>
                {form.receiptUrl ? (
                  <div className="flex items-center justify-between gap-2 bg-slate-800/50 border border-white/10 rounded-lg p-2">
                    <a href={form.receiptUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200 truncate">
                      <Paperclip className="h-4 w-4 shrink-0" /> View attached receipt
                    </a>
                    <button type="button" onClick={handleRemoveReceipt} className="text-slate-400 hover:text-white shrink-0" title="Remove receipt">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 bg-slate-800/50 border border-dashed border-white/20 rounded-lg p-3 text-sm text-slate-400 hover:border-blue-500 hover:text-slate-300 cursor-pointer transition">
                    <Paperclip className="h-4 w-4" />
                    {uploadingReceipt ? "Uploading…" : "Attach a receipt (image or PDF)"}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      disabled={uploadingReceipt}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleReceiptSelect(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={uploadingReceipt || savingExpense} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition font-semibold text-sm">{savingExpense ? "Saving…" : editingId ? "Save Changes" : "Submit"}</button>
              <button onClick={resetForm} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
