import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Clock, CheckCircle, XCircle, Paperclip, Pencil, Trash2, Loader2, Plus } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import { getProfileExpenses, getExpensePeopleNames, deleteExpense, type ExpenseRow } from "@/lib/supabase/expenses";
import { ExpenseFormModal } from "@/components/ExpenseFormModal";
import { ReceiptLightbox, isPdfReceipt } from "@/components/ReceiptLightbox";
import { expenseStatusColor, fmtExpenseReviewedAt, isSelfFiledExpense } from "@/components/ExpenseTrackingPage";

/** The filter chips. Approved includes Reimbursed — both mean Accounting said yes. */
type StatusFilter = "all" | "pending" | "approved" | "rejected";

function statusBucket(e: ExpenseRow): Exclude<StatusFilter, "all"> {
  if (e.status === "Pending") return "pending";
  if (e.status === "Rejected") return "rejected";
  return "approved";
}

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-10-12" → "Oct 12, 2026" without a timezone shift. */
function fmtExpenseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Branch/Technician → Technician Expenses. A technician files their own
 * expenses (same form Accounting uses, minus the Employee picker) and sees
 * every expense on their name with its status and who approved or rejected
 * it. Accounting reviews these under Accounting → Expenses → Technician
 * Requests.
 */
export function TechnicianExpensesPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, ready, companyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [formState, setFormState] = useState<{ editing: ExpenseRow | null } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);

  const refresh = useCallback(async (profileId: string) => {
    const rows = await getProfileExpenses(profileId);
    setExpenses(rows);
    setNames(await getExpensePeopleNames(rows.flatMap((r) => [r.createdBy ?? "", r.reviewedBy ?? ""])));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!uid) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const profileId = await getMyProfileId(uid);
        if (cancelled) return;
        setMyProfileId(profileId);
        if (profileId) await refresh(profileId);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load your expenses.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, refresh]);

  const counts = useMemo(() => {
    const c = { all: expenses.length, pending: 0, approved: 0, rejected: 0 };
    for (const e of expenses) c[statusBucket(e)]++;
    return c;
  }, [expenses]);
  const pendingTotal = useMemo(() => expenses.filter((e) => e.status === "Pending").reduce((s, e) => s + e.amount, 0), [expenses]);
  const visible = useMemo(() => (filter === "all" ? expenses : expenses.filter((e) => statusBucket(e) === filter)), [expenses, filter]);

  const nameOf = (id: string | null) => (id ? names.get(id) || "—" : "—");

  const handleDelete = async (row: ExpenseRow) => {
    if (!myProfileId || !confirm("Delete this expense request? This cannot be undone.")) return;
    setDeletingId(row.id);
    try {
      await deleteExpense(row.id);
      if (row.receiptPath) {
        deleteExpenseReceiptFile(row.receiptPath).catch((err) => console.error("Failed to delete receipt file:", err));
      }
      await refresh(myProfileId);
    } catch (error) {
      alert(`Failed to delete expense: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const chips: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={goBack} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </button>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                {sub.title}
              </h1>
              <p className="text-sm text-muted-foreground">{sub.description}</p>
            </div>
            <button
              type="button"
              onClick={() => setFormState({ editing: null })}
              disabled={!myProfileId}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition inline-flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> Add Expense
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-3">
            <p className="text-xs text-slate-400 uppercase flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-yellow-400" /> Pending</p>
            <p className="text-xl font-bold text-white mt-1">{loading ? "…" : counts.pending}</p>
            <p className="text-xs text-slate-500">{loading ? "" : `${fmtMoney(pendingTotal)} waiting`}</p>
          </div>
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-3">
            <p className="text-xs text-slate-400 uppercase flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5 text-blue-400" /> Approved</p>
            <p className="text-xl font-bold text-white mt-1">{loading ? "…" : counts.approved}</p>
            <p className="text-xs text-slate-500">incl. reimbursed</p>
          </div>
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-3">
            <p className="text-xs text-slate-400 uppercase flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-400" /> Rejected</p>
            <p className="text-xl font-bold text-white mt-1">{loading ? "…" : counts.rejected}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`btn text-sm px-3 py-1.5 ${filter === c.key ? "bg-primary/20 text-primary" : ""}`}
            >
              {c.label} <span className="ml-1 text-xs opacity-70">{loading ? "" : counts[c.key]}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-8 text-center text-slate-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading your expenses…
          </div>
        ) : loadError ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">{loadError}</div>
        ) : !myProfileId ? (
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-8 text-center text-slate-400 text-sm">Your account isn't linked to an employee profile yet, so expenses can't be filed. Ask HR to check your profile.</div>
        ) : visible.length === 0 ? (
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-8 text-center text-slate-400 text-sm">
            {expenses.length === 0 ? "You haven't sent any expenses yet. Use Add Expense to send one to Accounting." : "No expenses with this status."}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((e) => {
              const canChange = e.status === "Pending" && isSelfFiledExpense(e) && e.profileId === myProfileId;
              const route = [e.fromLocation, e.toLocation].filter(Boolean).join(" → ");
              return (
                <li key={e.id} className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-white font-mono">{fmtMoney(e.amount)}</span>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${expenseStatusColor(e.status)}`}>{e.status}</span>
                      </div>
                      <p className="text-sm text-slate-300 mt-0.5">{e.category} · {fmtExpenseDate(e.expenseDate)}</p>
                      {e.description && <p className="text-sm text-slate-400 mt-1 break-words">{e.description}</p>}
                      {(route || e.orNumber) && (
                        <p className="text-xs text-slate-500 mt-1">
                          {route}
                          {route && e.orNumber ? " · " : ""}
                          {e.orNumber ? `OR# ${e.orNumber}` : ""}
                        </p>
                      )}
                      <p className="text-xs mt-2">
                        {e.status === "Pending" ? (
                          <span className="text-slate-500">Waiting for Accounting to review</span>
                        ) : (
                          <span className={e.status === "Rejected" ? "text-red-300" : "text-blue-300"}>
                            {e.status === "Rejected" ? "Rejected" : "Approved"} by {nameOf(e.reviewedBy)}
                            {e.reviewedAt ? ` · ${fmtExpenseReviewedAt(e.reviewedAt)}` : ""}
                          </span>
                        )}
                        {!isSelfFiledExpense(e) && (
                          <span className="text-slate-500"> · {e.flashTechTripId ? "From a Flash Tech trip" : `Added by ${nameOf(e.createdBy)}`}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {e.receiptUrl ? (
                        <button
                          type="button"
                          onClick={() => e.receiptUrl && setPreviewReceiptUrl(e.receiptUrl)}
                          title="View receipt"
                          className="block h-12 w-12 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
                        >
                          {isPdfReceipt(e.receiptUrl) ? (
                            <span className="flex h-full w-full items-center justify-center text-slate-400"><Paperclip className="h-4 w-4" /></span>
                          ) : (
                            <img src={e.receiptUrl} alt="Receipt" className="h-full w-full object-cover" />
                          )}
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-600">No receipt</span>
                      )}
                      {canChange && (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setFormState({ editing: e })} title="Edit" className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button type="button" onClick={() => handleDelete(e)} disabled={deletingId === e.id} title="Delete" className="px-2 py-1 bg-slate-700 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition">
                            {deletingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {previewReceiptUrl && <ReceiptLightbox url={previewReceiptUrl} onClose={() => setPreviewReceiptUrl(null)} />}

      {formState && myProfileId && (
        <ExpenseFormModal
          editing={formState.editing}
          fixedProfileId={myProfileId}
          createdBy={myProfileId}
          companyId={companyId}
          onClose={() => setFormState(null)}
          onSaved={() => refresh(myProfileId)}
        />
      )}
    </div>
  );
}
