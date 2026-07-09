import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Download, DollarSign, Clock, CheckCircle, Wallet, Pencil, Trash2, XCircle } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
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
};

function statusColor(status: ExpenseStatus): string {
  switch (status) {
    case "Pending": return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    case "Approved": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "Reimbursed": return "bg-green-500/20 text-green-300 border-green-500/30";
    case "Rejected": return "bg-red-500/20 text-red-300 border-red-500/30";
  }
}

export function ExpenseTrackingPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid, ready } = useAuth();
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

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };
  const openEdit = (e: ExpenseRow) => {
    setForm({
      profileId: e.profileId,
      category: e.category,
      expenseDate: e.expenseDate,
      amount: String(e.amount),
      description: e.description,
    });
    setEditingId(e.id);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (!form.profileId || !form.expenseDate || !Number.isFinite(amount) || amount <= 0) {
      alert("Please select an employee, date, and a valid amount.");
      return;
    }
    try {
      if (editingId) {
        await updateExpense(editingId, {
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
        });
      } else {
        await createExpense({
          profileId: form.profileId,
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
          createdBy: myProfileId,
        });
      }
      setExpenses(await getCompanyExpenses());
      resetForm();
    } catch (error) {
      alert(`Failed to save expense: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleStatusChange = async (id: string, status: ExpenseStatus) => {
    try {
      await updateExpenseStatus(id, status, myProfileId);
      setExpenses(await getCompanyExpenses());
    } catch (error) {
      alert(`Failed to update expense: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this expense record? This cannot be undone.")) return;
    try {
      await deleteExpense(id);
      setExpenses(await getCompanyExpenses());
    } catch (error) {
      alert(`Failed to delete expense: ${error instanceof Error ? error.message : "Unknown error"}`);
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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              {sub.title}
            </h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
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
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading expenses…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No expense records match this filter.</td></tr>
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
                      <div className="flex flex-wrap gap-1">
                        {e.status === "Pending" && (
                          <>
                            <button onClick={() => handleStatusChange(e.id, "Approved")} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" /> Approve
                            </button>
                            <button onClick={() => handleStatusChange(e.id, "Rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition flex items-center gap-1">
                              <XCircle className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                        {e.status === "Approved" && (
                          <button onClick={() => handleStatusChange(e.id, "Reimbursed")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition flex items-center gap-1">
                            <Wallet className="h-3 w-3" /> Mark Reimbursed
                          </button>
                        )}
                        <button onClick={() => openEdit(e)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition flex items-center gap-1">
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button onClick={() => handleDelete(e.id)} className="px-2 py-1 bg-slate-700 hover:bg-red-700 text-white rounded text-xs transition flex items-center gap-1">
                          <Trash2 className="h-3 w-3" />
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
                <label className="block text-xs text-slate-400 uppercase mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm">{editingId ? "Save Changes" : "Submit"}</button>
              <button onClick={resetForm} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
