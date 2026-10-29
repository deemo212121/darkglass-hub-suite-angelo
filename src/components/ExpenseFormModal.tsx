import { useState } from "react";
import { Paperclip, X } from "lucide-react";
import { randomId } from "@/lib/utils";
import type { ProfileRow } from "@/lib/supabase/users";
import { uploadExpenseReceipt, deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import { createExpense, updateExpense, REIMBURSEMENT_TYPES, reimbursementTypeName, type ExpenseRow, type ExpenseCategory, type ReimbursementType } from "@/lib/supabase/expenses";
import { todayISO } from "@/lib/localDate";

/** What Accounting picks from on Add Expense. */
export const ACCOUNTING_EXPENSE_CATEGORIES: ExpenseCategory[] = ["Hotel", "Car Rental", "Office Supply"];
/** Sent by the employee themselves (Self-Service / mobile) — always this category. */
export const EMPLOYEE_EXPENSE_CATEGORY: ExpenseCategory = "Reimbursement Form";
/** Every current category — the Category filter (old rows' categories are added from the data). */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [...ACCOUNTING_EXPENSE_CATEGORIES, EMPLOYEE_EXPENSE_CATEGORY];

/**
 * Add / Edit Expense dialog, shared by Accounting → Expenses (files for any
 * employee — pass `profiles` for the Employee picker) and Employee
 * Self-Service → My Requests (an employee sending their own — pass
 * `fixedProfileId` instead and the picker is hidden).
 */
export function ExpenseFormModal({
  editing,
  profiles,
  fixedProfileId,
  requireReceipt,
  createdBy,
  companyId,
  onClose,
  onSaved,
  defaultCategory,
}: {
  editing: ExpenseRow | null;
  profiles?: ProfileRow[];
  fixedProfileId?: string;
  /** Employee Self-Service: a request can't be sent (or saved) without a receipt attached. */
  requireReceipt?: boolean;
  createdBy: string | null;
  companyId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  /** A new expense starts on this category (e.g. the Expenses module's Hotel / Car Rental tab). */
  defaultCategory?: ExpenseCategory;
}) {
  const [form, setForm] = useState(() => ({
    profileId: editing?.profileId ?? fixedProfileId ?? "",
    category: fixedProfileId ? EMPLOYEE_EXPENSE_CATEGORY : editing?.category ?? defaultCategory ?? ("Hotel" as ExpenseCategory),
    expenseDate: editing?.expenseDate ?? todayISO(),
    amount: editing ? String(editing.amount) : "",
    description: editing?.description ?? "",
    receiptUrl: editing?.receiptUrl ?? (null as string | null),
    receiptPath: editing?.receiptPath ?? (null as string | null),
    orNumber: editing?.orNumber || "",
    fromLocation: editing?.fromLocation || "",
    toLocation: editing?.toLocation || "",
    reimbursementType: (editing?.reimbursementType ?? "") as ReimbursementType | "",
    reimbursementOther: editing?.reimbursementOther || "",
  }));
  // A Reimbursement Form says what it was for: Gas, Food or Other (specify).
  const isReimbursement = form.category === EMPLOYEE_EXPENSE_CATEGORY;
  // Storage folder key for the receipt upload — a brand-new expense has no
  // row id yet, so a client-generated key stands in until it's saved; an
  // existing expense being edited just uses its own real id.
  const [folderKey] = useState(() => editing?.id ?? randomId());
  // The receipt path this expense had BEFORE this edit session, so a
  // replace/remove can clean up the old Storage file once the save succeeds.
  const originalReceiptPath = editing?.receiptPath ?? null;
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleReceiptSelect = async (file: File) => {
    setUploadingReceipt(true);
    try {
      const { url, fullPath } = await uploadExpenseReceipt(companyId || "COMP001", folderKey, file);
      setForm((f) => ({ ...f, receiptUrl: url, receiptPath: fullPath }));
    } catch (error) {
      alert(`Failed to upload receipt: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (form.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
      alert("Please enter the amount (more than $0).");
      return;
    }
    if (!form.profileId || !form.expenseDate) {
      alert(profiles ? "Please select an employee and a date." : "Please enter a date.");
      return;
    }
    if (isReimbursement && !form.reimbursementType) {
      alert("Please pick the type of reimbursement (Gas, Food, Flash Tech / Allowance or Other).");
      return;
    }
    if (isReimbursement && form.reimbursementType === "Other" && !form.reimbursementOther.trim()) {
      alert("Please specify what the Other reimbursement is for.");
      return;
    }
    if (requireReceipt && !form.receiptUrl) {
      alert("Please attach a receipt (image or PDF).");
      return;
    }
    // Only a Reimbursement Form carries a type; other categories clear it.
    const typeFields = isReimbursement
      ? { reimbursementType: form.reimbursementType || null, reimbursementOther: form.reimbursementOther }
      : editing?.reimbursementType ? { reimbursementType: null } : {};
    setSaving(true);
    try {
      if (editing) {
        await updateExpense(editing.id, {
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
          receiptUrl: form.receiptUrl,
          receiptPath: form.receiptPath,
          orNumber: form.orNumber,
          fromLocation: form.fromLocation,
          toLocation: form.toLocation,
          ...typeFields,
        });
      } else {
        await createExpense({
          profileId: form.profileId,
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
          createdBy,
          receiptUrl: form.receiptUrl,
          receiptPath: form.receiptPath,
          orNumber: form.orNumber,
          fromLocation: form.fromLocation,
          toLocation: form.toLocation,
          ...typeFields,
        });
      }
      // Best-effort: if a receipt was replaced or removed during this edit,
      // clean up the old Storage file now that the save succeeded.
      if (originalReceiptPath && originalReceiptPath !== form.receiptPath) {
        deleteExpenseReceiptFile(originalReceiptPath).catch((err) => console.error("Failed to delete old receipt file:", err));
      }
      await onSaved();
      onClose();
    } catch (error) {
      alert(`Failed to save expense: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-white">{editing ? "Edit Expense" : "Add Expense"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1">✕</button>
        </div>
        <div className="space-y-3 mb-6">
          {profiles && (
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Employee</label>
              <select
                value={form.profileId}
                disabled={Boolean(editing)}
                onChange={(e) => setForm({ ...form, profileId: e.target.value })}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60"
              >
                <option value="">Select employee</option>
                {profiles.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Category</label>
              {fixedProfileId ? (
                // An employee sending their own expense — always a Reimbursement Form.
                <p className="w-full rounded-lg border border-white/10 bg-slate-800/30 p-2 text-sm text-slate-300">{EMPLOYEE_EXPENSE_CATEGORY}</p>
              ) : (
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                  {(ACCOUNTING_EXPENSE_CATEGORIES.includes(form.category) ? ACCOUNTING_EXPENSE_CATEGORIES : [...ACCOUNTING_EXPENSE_CATEGORIES, form.category]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Date</label>
              <input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
          {isReimbursement && (
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">
                Type of Reimbursement <span className="text-red-400 normal-case">* required</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {REIMBURSEMENT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, reimbursementType: t })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${form.reimbursementType === t ? "border-blue-500 bg-blue-600/20 text-white" : "border-white/10 bg-slate-800/50 text-slate-300 hover:border-white/30"}`}
                  >
                    {t === "Other" ? "Other (specify)" : reimbursementTypeName(t)}
                  </button>
                ))}
              </div>
              {form.reimbursementType === "Other" && (
                <input
                  type="text"
                  autoFocus
                  value={form.reimbursementOther}
                  onChange={(e) => setForm({ ...form, reimbursementOther: e.target.value })}
                  placeholder="What is it for? e.g. Parking, Tolls"
                  className="mt-2 w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">
              Amount ($) <span className="text-red-400 normal-case">* required</span>
            </label>
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
            <label className="block text-xs text-slate-400 uppercase mb-1">
              Receipt{requireReceipt && <span className="text-red-400 normal-case"> * required</span>}
            </label>
            {form.receiptUrl ? (
              <div className="flex items-center justify-between gap-2 bg-slate-800/50 border border-white/10 rounded-lg p-2">
                <a href={form.receiptUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200 truncate">
                  <Paperclip className="h-4 w-4 shrink-0" /> View attached receipt
                </a>
                <button type="button" onClick={() => setForm((f) => ({ ...f, receiptUrl: null, receiptPath: null }))} className="text-slate-400 hover:text-white shrink-0" title="Remove receipt">
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
          <button onClick={handleSubmit} disabled={uploadingReceipt || saving} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition font-semibold text-sm">{saving ? "Saving…" : editing ? "Save Changes" : "Submit"}</button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
