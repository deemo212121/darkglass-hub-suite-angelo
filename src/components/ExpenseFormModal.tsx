import { useState } from "react";
import { Paperclip, X } from "lucide-react";
import { randomId } from "@/lib/utils";
import type { ProfileRow } from "@/lib/supabase/users";
import { uploadExpenseReceipt, deleteExpenseReceiptFile } from "@/lib/firebase/storage";
import { createExpense, updateExpense, REIMBURSEMENT_TYPES, reimbursementTypeName, MAX_EXPENSE_RECEIPTS, type ExpenseRow, type ExpenseCategory, type ExpenseReceipt, type ReimbursementType } from "@/lib/supabase/expenses";
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
    receipts: (editing?.receipts ?? []) as ExpenseReceipt[],
    orNumber: editing?.orNumber || "",
    fromLocation: editing?.fromLocation || "",
    toLocation: editing?.toLocation || "",
    pickupDate: editing?.pickupDate || "",
    returnDate: editing?.returnDate || "",
    reimbursementType: (editing?.reimbursementType ?? "") as ReimbursementType | "",
    reimbursementOther: editing?.reimbursementOther || "",
  }));
  // A Reimbursement Form says what it was for: Gas, Food or Other (specify).
  const isReimbursement = form.category === EMPLOYEE_EXPENSE_CATEGORY;
  // A Car Rental records when the car was picked up and returned.
  const isCarRental = form.category === "Car Rental";
  // Storage folder key for the receipt upload — a brand-new expense has no
  // row id yet, so a client-generated key stands in until it's saved; an
  // existing expense being edited just uses its own real id.
  const [folderKey] = useState(() => editing?.id ?? randomId());
  // The receipt files this expense had BEFORE this edit session, so removed
  // ones can be cleaned up from Storage once the save succeeds.
  const originalReceiptPaths = (editing?.receipts ?? []).map((r) => r.path).filter((p): p is string => !!p);
  const [uploadingReceipt, setUploadingReceipt] = useState(0);
  const [saving, setSaving] = useState(false);

  // Several photos / PDFs at once — each uploaded as its own file, up to MAX_EXPENSE_RECEIPTS.
  const handleReceiptSelect = async (files: File[]) => {
    const room = MAX_EXPENSE_RECEIPTS - form.receipts.length;
    if (room <= 0) {
      alert(`An expense can have up to ${MAX_EXPENSE_RECEIPTS} receipts.`);
      return;
    }
    const picked = files.slice(0, room);
    if (files.length > room) alert(`Only ${room} more receipt${room === 1 ? "" : "s"} can be added (up to ${MAX_EXPENSE_RECEIPTS}).`);
    setUploadingReceipt(picked.length);
    const failed: string[] = [];
    for (const file of picked) {
      try {
        const { url, fullPath } = await uploadExpenseReceipt(companyId || "COMP001", folderKey, file);
        setForm((f) => ({ ...f, receipts: [...f.receipts, { url, path: fullPath }] }));
      } catch (error) {
        failed.push(`${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        setUploadingReceipt((n) => n - 1);
      }
    }
    if (failed.length) alert(`Failed to upload:\n${failed.join("\n")}`);
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
    if (isCarRental && form.pickupDate && form.returnDate && form.returnDate < form.pickupDate) {
      alert("The return date can't be before the pick-up date.");
      return;
    }
    if (requireReceipt && form.receipts.length === 0) {
      alert("Please attach a receipt (image or PDF).");
      return;
    }
    // Only a Reimbursement Form carries a type; other categories clear it.
    const typeFields = isReimbursement
      ? { reimbursementType: form.reimbursementType || null, reimbursementOther: form.reimbursementOther }
      : editing?.reimbursementType ? { reimbursementType: null } : {};
    // Only a Car Rental carries pick-up / return dates; other categories clear them.
    const rentalFields = isCarRental
      ? { pickupDate: form.pickupDate || null, returnDate: form.returnDate || null }
      : editing?.pickupDate || editing?.returnDate ? { pickupDate: null, returnDate: null } : {};
    setSaving(true);
    try {
      if (editing) {
        await updateExpense(editing.id, {
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
          receipts: form.receipts,
          hadExtraReceipts: (editing.receipts?.length ?? 0) > 1,
          orNumber: form.orNumber,
          fromLocation: form.fromLocation,
          toLocation: form.toLocation,
          ...typeFields,
          ...rentalFields,
        });
      } else {
        await createExpense({
          profileId: form.profileId,
          category: form.category,
          expenseDate: form.expenseDate,
          amount,
          description: form.description,
          createdBy,
          receipts: form.receipts,
          orNumber: form.orNumber,
          fromLocation: form.fromLocation,
          toLocation: form.toLocation,
          ...typeFields,
          ...rentalFields,
        });
      }
      // Best-effort: receipts removed during this edit — clean up their
      // Storage files now that the save succeeded.
      const kept = new Set(form.receipts.map((r) => r.path));
      for (const path of originalReceiptPaths) {
        if (!kept.has(path)) deleteExpenseReceiptFile(path).catch((err) => console.error("Failed to delete old receipt file:", err));
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
          {isCarRental && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Pick-up Date</label>
                <input type="date" value={form.pickupDate} max={form.returnDate || undefined} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Return Date</label>
                <input type="date" value={form.returnDate} min={form.pickupDate || undefined} onChange={(e) => setForm({ ...form, returnDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">
              Receipts{requireReceipt && <span className="text-red-400 normal-case"> * required</span>}
              {form.receipts.length > 0 && <span className="ml-1 normal-case text-slate-500">({form.receipts.length}/{MAX_EXPENSE_RECEIPTS})</span>}
            </label>
            {form.receipts.length > 0 && (
              <div className="mb-2 grid grid-cols-4 gap-2">
                {form.receipts.map((r, i) => (
                  <div key={r.url} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-slate-800/50">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" title={`Open receipt ${i + 1}`} className="block h-full w-full">
                      {/\.pdf(\?|$)/i.test(r.path || r.url) ? (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
                          <Paperclip className="h-5 w-5" />
                          <span className="text-[10px]">PDF</span>
                        </span>
                      ) : (
                        <img src={r.url} alt={`Receipt ${i + 1}`} className="h-full w-full object-cover" />
                      )}
                    </a>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, receipts: f.receipts.filter((x) => x.url !== r.url) }))}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-slate-200 hover:text-white"
                      title="Remove this receipt"
                      aria-label={`Remove receipt ${i + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {form.receipts.length < MAX_EXPENSE_RECEIPTS && (
              <label className="flex items-center justify-center gap-2 bg-slate-800/50 border border-dashed border-white/20 rounded-lg p-3 text-sm text-slate-400 hover:border-blue-500 hover:text-slate-300 cursor-pointer transition">
                <Paperclip className="h-4 w-4" />
                {uploadingReceipt > 0
                  ? `Uploading ${uploadingReceipt} file${uploadingReceipt === 1 ? "" : "s"}…`
                  : form.receipts.length > 0
                    ? "Add more receipts (images or PDFs)"
                    : "Attach receipts — pick one or several (images or PDFs)"}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  className="hidden"
                  disabled={uploadingReceipt > 0}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) void handleReceiptSelect(files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={uploadingReceipt > 0 || saving} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition font-semibold text-sm">{saving ? "Saving…" : editing ? "Save Changes" : "Submit"}</button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
