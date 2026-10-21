import { useCallback, useEffect, useMemo, useState } from "react";
import { randomId } from "@/lib/utils";
import { todayISO, timestampParts } from "@/lib/localDate";
import { uploadExpenseReceipt, deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import {
  getProfileExpenses,
  getExpensePeopleNames,
  createExpense,
  updateExpense,
  deleteExpense,
  REIMBURSEMENT_TYPES,
  reimbursementTypeLabel,
  type ExpenseRow,
  type ExpenseCategory,
  type ReimbursementType,
} from "@/lib/supabase/expenses";
import { EMPLOYEE_EXPENSE_CATEGORY } from "@/components/ExpenseFormModal";
import { ReceiptLightbox } from "@/components/ReceiptLightbox";

/**
 * Mobile "My Expenses" — the phone version of Employee Self-Service →
 * My Expenses: send an expense to Accounting (amount and receipt required,
 * receipt straight from the camera), see what's in review / approved /
 * reimbursed / rejected, with Accounting's decision and rejection reason.
 * Same data as desktop: requests land in Accounting → Expenses → Employee
 * Requests.
 */

const STATUS_PILL: Record<ExpenseRow["status"], { bg: string; fg: string; label: string }> = {
  Pending: { bg: "rgba(234,179,8,0.18)", fg: "#fde047", label: "In Review" },
  Approved: { bg: "rgba(56,189,248,0.18)", fg: "#7dd3fc", label: "Approved — to be paid" },
  Reimbursed: { bg: "rgba(16,185,129,0.18)", fg: "#6ee7b7", label: "Reimbursed" },
  Rejected: { bg: "rgba(239,68,68,0.18)", fg: "#fca5a5", label: "Rejected" },
};

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const emptyForm = () => ({
  category: EMPLOYEE_EXPENSE_CATEGORY as ExpenseCategory,
  expenseDate: todayISO(),
  amount: "",
  orNumber: "",
  fromLocation: "",
  toLocation: "",
  description: "",
  reimbursementType: "" as ReimbursementType | "",
  reimbursementOther: "",
});

export function MobileExpensesView({ profileId, companyId }: { profileId: string | null; companyId: string | null }) {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | ExpenseRow["status"]>("all");

  const [form, setForm] = useState(emptyForm);
  // A new receipt picked on this phone (uploaded on submit), or — when
  // editing — the one already on the expense.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [existingReceipt, setExistingReceipt] = useState<{ url: string; path: string | null } | null>(null);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);

  // Flash Tech trip expenses (company-booked hotel/travel) aren't the
  // employee's to claim back — same filter as desktop My Expenses.
  const refresh = useCallback(async () => {
    if (!profileId) return;
    const rows = (await getProfileExpenses(profileId)).filter((e) => !e.flashTechTripId && !e.expenseSubtype);
    setExpenses(rows);
    setNames(await getExpensePeopleNames(rows.map((r) => r.reviewedBy ?? "")));
  }, [profileId]);

  useEffect(() => {
    if (!profileId) { setLoading(false); return; }
    setLoading(true);
    refresh().catch((e) => console.error("my expenses: load failed", e)).finally(() => setLoading(false));
  }, [profileId, refresh]);

  const totals = useMemo(() => {
    const of = (s: ExpenseRow["status"]) => expenses.filter((e) => e.status === s);
    const sum = (rows: ExpenseRow[]) => rows.reduce((t, e) => t + e.amount, 0);
    return {
      due: sum(of("Approved")), dueCount: of("Approved").length,
      review: sum(of("Pending")), reviewCount: of("Pending").length,
      paid: sum(of("Reimbursed")), paidCount: of("Reimbursed").length,
      rejectedCount: of("Rejected").length,
    };
  }, [expenses]);
  const visible = filter === "all" ? expenses : expenses.filter((e) => e.status === filter);

  const resetForm = () => {
    setForm(emptyForm());
    setReceiptFile(null);
    setExistingReceipt(null);
    setEditing(null);
  };

  const startEdit = (e: ExpenseRow) => {
    setEditing(e);
    setForm({
      category: EMPLOYEE_EXPENSE_CATEGORY,
      expenseDate: e.expenseDate,
      amount: String(e.amount),
      orNumber: e.orNumber || "",
      fromLocation: e.fromLocation || "",
      toLocation: e.toLocation || "",
      description: e.description || "",
      reimbursementType: e.reimbursementType ?? "",
      reimbursementOther: e.reimbursementOther || "",
    });
    setReceiptFile(null);
    setExistingReceipt(e.receiptUrl ? { url: e.receiptUrl, path: e.receiptPath } : null);
    setMsg("");
    document.querySelector('[data-tour="m-view-expenses"]')?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    setMsg("");
    if (!profileId) { setMsg("Your account isn't linked to an employee profile yet."); return; }
    const amount = Number(form.amount);
    if (form.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) { setMsg("Please enter the amount (more than $0)."); return; }
    if (!form.expenseDate) { setMsg("Please pick the date."); return; }
    if (!form.reimbursementType) { setMsg("Please pick the type of reimbursement (Gas, Food or Other)."); return; }
    if (form.reimbursementType === "Other" && !form.reimbursementOther.trim()) { setMsg("Please specify what the Other reimbursement is for."); return; }
    if (!receiptFile && !existingReceipt) { setMsg("Please attach a receipt (photo or PDF)."); return; }
    setSubmitting(true);
    try {
      let receiptUrl = existingReceipt?.url ?? null;
      let receiptPath = existingReceipt?.path ?? null;
      if (receiptFile) {
        const up = await uploadExpenseReceipt(companyId || "COMP001", editing?.id ?? randomId(), receiptFile);
        receiptUrl = up.url;
        receiptPath = up.fullPath;
      }
      const fields = {
        category: form.category,
        expenseDate: form.expenseDate,
        amount,
        description: form.description,
        receiptUrl,
        receiptPath,
        orNumber: form.orNumber,
        fromLocation: form.fromLocation,
        toLocation: form.toLocation,
        reimbursementType: form.reimbursementType || null,
        reimbursementOther: form.reimbursementOther,
      };
      if (editing) {
        await updateExpense(editing.id, fields);
        // A replaced receipt's old file is cleaned up once the save has worked.
        if (receiptFile && editing.receiptPath && editing.receiptPath !== receiptPath) {
          deleteExpenseReceiptFile(editing.receiptPath).catch((err) => console.error("old receipt cleanup failed", err));
        }
      } else {
        await createExpense({ profileId, createdBy: profileId, ...fields });
      }
      const wasEditing = !!editing;
      resetForm();
      await refresh();
      setFilter("all");
      setMsg(wasEditing ? "Changes saved ✓" : "Sent to Accounting ✓");
    } catch (err) {
      setMsg(`Couldn't save the expense: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (e: ExpenseRow) => {
    if (!confirm("Delete this expense request? This cannot be undone.")) return;
    setDeletingId(e.id);
    try {
      await deleteExpense(e.id);
      if (e.receiptPath) deleteExpenseReceiptFile(e.receiptPath).catch((err) => console.error("receipt cleanup failed", err));
      if (editing?.id === e.id) resetForm();
      await refresh();
    } catch (err) {
      alert(`Couldn't delete the expense: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const tile = (label: string, value: string, sub: string, color: string, onTap: () => void) => (
    <button
      type="button"
      onClick={onTap}
      style={{ textAlign: "left", background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "0.65rem 0.75rem", color: "#e2e8f0" }}
    >
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1.3 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b" }}>{sub}</div>
    </button>
  );

  const previewSrc = useMemo(() => (receiptFile && receiptFile.type.startsWith("image/") ? URL.createObjectURL(receiptFile) : null), [receiptFile]);
  useEffect(() => () => { if (previewSrc) URL.revokeObjectURL(previewSrc); }, [previewSrc]);

  return (
    <div data-tour="m-view-expenses" className="mtech-scroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">My Expenses</div>
        <div className="mtech-payroll-sub">Send an expense with its receipt — Accounting approves and reimburses it</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {tile("Reimbursement Due", fmtMoney(totals.due), `${totals.dueCount} approved, to be paid`, "#7dd3fc", () => setFilter("Approved"))}
        {tile("In Review", fmtMoney(totals.review), `${totals.reviewCount} waiting for Accounting`, "#fde047", () => setFilter("Pending"))}
        {tile("Reimbursed", fmtMoney(totals.paid), `${totals.paidCount} paid back to you`, "#6ee7b7", () => setFilter("Reimbursed"))}
        {tile("Rejected", String(totals.rejectedCount), "see the reason on each one", "#fca5a5", () => setFilter("Rejected"))}
      </div>

      <div className="mtech-panel" style={{ marginTop: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9" }}>{editing ? "Edit Expense" : "Expense Request"}</div>

        <div className="mtech-section-title">Category</div>
        {/* Sent by the employee — always a Reimbursement Form (migration 0386). */}
        <div className="mtech-bill-input full" style={{ opacity: 0.8 }}>{EMPLOYEE_EXPENSE_CATEGORY}</div>

        <div className="mtech-section-title">Type of Reimbursement *</div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {REIMBURSEMENT_TYPES.map((t) => {
            const on = form.reimbursementType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, reimbursementType: t })}
                className="mtech-bill-input"
                style={{ flex: 1, textAlign: "center", cursor: "pointer", borderColor: on ? "#3b82f6" : undefined, background: on ? "rgba(59,130,246,0.2)" : undefined, color: on ? "#fff" : undefined, fontWeight: on ? 700 : 500 }}
              >
                {t === "Other" ? "Other (specify)" : t}
              </button>
            );
          })}
        </div>
        {form.reimbursementType === "Other" && (
          <input className="mtech-bill-input full" style={{ marginTop: "0.4rem" }} type="text" placeholder="What is it for? e.g. Parking, Tolls" value={form.reimbursementOther} onChange={(e) => setForm({ ...form, reimbursementOther: e.target.value })} />
        )}

        <div className="mtech-section-title">Date</div>
        <input className="mtech-bill-input full" type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />

        <div className="mtech-section-title">Amount ($) *</div>
        <input className="mtech-bill-input full" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />

        <div className="mtech-section-title">OR / Transaction Number</div>
        <input className="mtech-bill-input full" type="text" value={form.orNumber} onChange={(e) => setForm({ ...form, orNumber: e.target.value })} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div>
            <div className="mtech-section-title">From</div>
            <input className="mtech-bill-input full" type="text" value={form.fromLocation} onChange={(e) => setForm({ ...form, fromLocation: e.target.value })} />
          </div>
          <div>
            <div className="mtech-section-title">To</div>
            <input className="mtech-bill-input full" type="text" value={form.toLocation} onChange={(e) => setForm({ ...form, toLocation: e.target.value })} />
          </div>
        </div>

        <div className="mtech-section-title">Description</div>
        <textarea className="mtech-bill-input full" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ resize: "none" }} />

        <div className="mtech-section-title">Receipt (photo or PDF) *</div>
        <label className="mtech-bill-input full" style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", borderStyle: "dashed" }}>
          <input
            type="file"
            accept="image/*,application/pdf"
            style={{ display: "none" }}
            disabled={submitting}
            onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f) setReceiptFile(f); e.target.value = ""; }}
          />
          {previewSrc ? (
            <img src={previewSrc} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
          ) : (
            <span aria-hidden="true">📎</span>
          )}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {receiptFile ? receiptFile.name : existingReceipt ? "Receipt attached — tap to replace" : "Take a photo or choose a file…"}
          </span>
          {receiptFile && (
            <button type="button" onClick={(e) => { e.preventDefault(); setReceiptFile(null); }} aria-label="Remove receipt" style={{ padding: "0.2rem 0.4rem" }}>✕</button>
          )}
        </label>

        <button type="button" data-tour="m-expense-submit" className="mtech-save-btn" onClick={submit} disabled={submitting}>
          {submitting ? "Sending…" : editing ? "Save Changes" : "Send to Accounting"}
        </button>
        {editing && (
          <button type="button" className="mtech-save-btn" onClick={() => { resetForm(); setMsg(""); }} disabled={submitting} style={{ background: "rgba(100,116,139,0.35)", marginTop: "0.5rem" }}>
            Cancel Edit
          </button>
        )}
        {msg && <div className="mtech-save-msg">{msg}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", margin: "0.4rem 0 0.4rem" }}>
        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9" }}>My Expenses</div>
        <select className="mtech-bill-input" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: "auto", padding: "0.3rem 0.5rem", fontSize: 13 }}>
          <option value="all">All</option>
          <option value="Pending">In Review</option>
          <option value="Approved">Approved — to be paid</option>
          <option value="Reimbursed">Reimbursed</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>
      {loading ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>Loading expenses…</div>
      ) : visible.length === 0 ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>{expenses.length === 0 ? "No expenses sent yet." : "No expenses with this status."}</div>
      ) : (
        <div className="mtech-payroll-list">
          {visible.map((e) => {
            const pill = STATUS_PILL[e.status];
            const reviewer = e.reviewedBy ? names.get(e.reviewedBy) || "Accounting" : "Accounting";
            const reviewedOn = timestampParts(e.reviewedAt)?.date;
            const route = [e.fromLocation, e.toLocation].filter(Boolean).join(" → ");
            const canChange = e.status === "Pending" && e.createdBy === profileId;
            return (
              <div key={e.id} className="mtech-payroll-row">
                <div className="mtech-payroll-row-head">
                  <div className="mtech-payroll-row-date">{fmtMoney(e.amount)} · {e.expenseDate}</div>
                  <div className="mtech-payroll-status" style={{ background: pill.bg, color: pill.fg }}>{pill.label}</div>
                </div>
                <div className="mtech-payroll-row-body" style={{ display: "block", padding: "0.4rem 0.85rem 0.7rem" }}>
                  <p className="mtech-muted" style={{ padding: "0.25rem 0", fontWeight: 600 }}>{e.category}{reimbursementTypeLabel(e) ? ` · ${reimbursementTypeLabel(e)}` : ""}{e.description ? ` — ${e.description}` : ""}</p>
                  {(route || e.orNumber) && (
                    <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{[route, e.orNumber ? `OR# ${e.orNumber}` : ""].filter(Boolean).join(" · ")}</p>
                  )}
                  <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                    {e.status === "Pending" && "Waiting for Accounting to review"}
                    {e.status === "Approved" && `Approved by ${reviewer}${reviewedOn ? ` · ${reviewedOn}` : ""} · waiting to be reimbursed`}
                    {e.status === "Reimbursed" && `Approved by ${reviewer}${reviewedOn ? ` · ${reviewedOn}` : ""} · reimbursed ✓`}
                    {e.status === "Rejected" && `Rejected by ${reviewer}${reviewedOn ? ` · ${reviewedOn}` : ""}`}
                  </p>
                  {e.status === "Rejected" && (
                    <p className="mtech-muted" style={{ color: "#fca5a5", fontWeight: 600, padding: "0.25rem 0", whiteSpace: "pre-line" }}>
                      Reason rejected: {e.reviewNote || "No reason was given."}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "0.9rem", paddingTop: "0.35rem", fontSize: 13 }}>
                    {e.receiptUrl && (
                      <button type="button" onClick={() => setPreviewReceiptUrl(e.receiptUrl)} style={{ color: "#93c5fd", fontWeight: 600 }}>📎 View receipt</button>
                    )}
                    {canChange && (
                      <>
                        <button type="button" onClick={() => startEdit(e)} style={{ color: "#e2e8f0", fontWeight: 600 }}>✎ Edit</button>
                        <button type="button" onClick={() => remove(e)} disabled={deletingId === e.id} style={{ color: "#fca5a5", fontWeight: 600 }}>
                          {deletingId === e.id ? "Deleting…" : "🗑 Delete"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewReceiptUrl && <ReceiptLightbox url={previewReceiptUrl} onClose={() => setPreviewReceiptUrl(null)} />}
    </div>
  );
}
