/**
 * "Adjustments" on Accounting → Payroll's employee popup (migration 0386) —
 * reimbursements (+) and deductions (−) for this employee in the page's pay
 * period. PH payroll and US Office staff only (see payrollAdjustmentsEligible).
 * Net pay = gross + reimbursements − deductions; the payslip lists each line.
 */
import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  addPayrollAdjustment,
  deletePayrollAdjustment,
  sumPayrollAdjustments,
  updatePayrollAdjustment,
  type PayrollAdjustment,
  type PayrollAdjustmentKind,
} from "@/lib/supabase/payrollAdjustments";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Draft {
  kind: PayrollAdjustmentKind;
  description: string;
  amount: string;
}
const EMPTY: Draft = { kind: "reimbursement", description: "", amount: "" };

export function PayrollAdjustmentsSection({
  profileId,
  periodStart,
  periodEnd,
  items,
  grossPay,
  createdByName,
  onChanged,
}: {
  profileId: string;
  periodStart: string;
  periodEnd: string;
  items: PayrollAdjustment[];
  /** Gross pay for the same period, for the Net line. Omit to hide it (e.g. the popup is showing a different date range). */
  grossPay?: number | null;
  createdByName?: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sums = sumPayrollAdjustments(items);

  const startAdd = () => {
    setEditingId(null);
    setDraft({ ...EMPTY });
    setError(null);
  };
  const startEdit = (a: PayrollAdjustment) => {
    setEditingId(a.id);
    setDraft({ kind: a.kind, description: a.description, amount: String(a.amount) });
    setError(null);
  };
  const cancel = () => {
    setDraft(null);
    setEditingId(null);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    const amount = Number(draft.amount);
    if (!draft.description.trim()) { setError("Add a description (e.g. Internet allowance, Cash advance)."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter an amount above $0."); return; }
    setBusy(true);
    setError(null);
    try {
      if (editingId) await updatePayrollAdjustment(editingId, { kind: draft.kind, description: draft.description, amount });
      else await addPayrollAdjustment({ profileId, periodStart, periodEnd, kind: draft.kind, description: draft.description, amount, createdByName });
      await onChanged();
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: PayrollAdjustment) => {
    if (!confirm(`Remove "${a.description}" (${a.kind === "deduction" ? "−" : "+"}${money(a.amount)})?`)) return;
    setBusy(true);
    try {
      await deletePayrollAdjustment(a.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove.");
    } finally {
      setBusy(false);
    }
  };

  const form = draft && (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2">
      <select
        value={draft.kind}
        onChange={(e) => setDraft({ ...draft, kind: e.target.value as PayrollAdjustmentKind })}
        className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white"
        aria-label="Type"
      >
        <option value="reimbursement">Reimbursement (+)</option>
        <option value="deduction">Deduction (−)</option>
      </select>
      <input
        autoFocus
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder="Description — e.g. Internet allowance, Cash advance"
        className="min-w-[220px] flex-1 rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white placeholder-slate-500"
      />
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-400">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={draft.amount}
          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          placeholder="0.00"
          className="w-24 rounded border border-white/10 bg-slate-800 px-2 py-1 text-right text-xs text-white tabular-nums"
          aria-label="Amount"
        />
      </div>
      <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy && <Loader2 className="h-3 w-3 animate-spin" />} {editingId ? "Save" : "Add"}
      </button>
      <button type="button" onClick={cancel} className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600">Cancel</button>
    </div>
  );

  return (
    <div className="bg-slate-800/30 border border-white/10 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Adjustments</h3>
          <p className="text-[11px] text-slate-500">Reimbursements and deductions for {periodStart} to {periodEnd} — shown on the payslip.</p>
        </div>
        {!draft && (
          <button type="button" onClick={startAdd} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        )}
      </div>

      {items.length === 0 && !draft ? (
        <p className="mt-2 text-xs text-slate-500">No reimbursements or deductions for this period.</p>
      ) : (
        <ul className="mt-2 divide-y divide-white/5">
          {items.map((a) =>
            editingId === a.id ? (
              <li key={a.id}>{form}</li>
            ) : (
              <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="min-w-0 text-slate-200">
                  <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${a.kind === "deduction" ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                    {a.kind === "deduction" ? "Deduction" : "Reimbursement"}
                  </span>
                  {a.description}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`tabular-nums font-semibold ${a.kind === "deduction" ? "text-red-300" : "text-emerald-300"}`}>
                    {a.kind === "deduction" ? "−" : "+"}{money(a.amount)}
                  </span>
                  <button type="button" onClick={() => startEdit(a)} disabled={busy} title="Edit" className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => void remove(a)} disabled={busy} title="Remove" className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-red-300 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            )
          )}
        </ul>
      )}
      {draft && !editingId && form}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      {(items.length > 0 || grossPay != null) && (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 border-t border-white/10 pt-2 text-xs tabular-nums">
          {grossPay != null && (<><span className="text-slate-400">Gross pay</span><span className="text-right text-slate-200">{money(grossPay)}</span></>)}
          <span className="text-slate-400">+ Reimbursements</span><span className="text-right text-emerald-300">{money(sums.reimbursements)}</span>
          <span className="text-slate-400">− Deductions</span><span className="text-right text-red-300">{money(sums.deductions)}</span>
          {grossPay != null && (<><span className="font-semibold text-white">= Net pay</span><span className="text-right font-bold text-white">{money(grossPay + sums.net)}</span></>)}
        </div>
      )}
    </div>
  );
}
