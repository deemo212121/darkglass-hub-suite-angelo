/**
 * "Adjustments" on Accounting → Payroll's employee popup (migrations 0386 +
 * 0387) — reimbursements (+), deductions (−) and tax (a % of gross pay, −)
 * for this employee in the page's pay period. PH payroll and US Office staff
 * only (see payrollAdjustmentsEligible).
 * Net pay = gross − tax + reimbursements − deductions; the payslip lists each line.
 */
import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  addPayrollAdjustment,
  deletePayrollAdjustment,
  resolveAdjustmentLines,
  sumPayrollAdjustments,
  updatePayrollAdjustment,
  type PayrollAdjustment,
  type PayrollAdjustmentKind,
} from "@/lib/supabase/payrollAdjustments";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Tax amounts show 3 decimals ($61.673). */
const money3 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;

const KIND_LABEL: Record<PayrollAdjustmentKind, string> = {
  reimbursement: "Reimbursement",
  deduction: "Deduction",
  tax: "Tax",
};
const KIND_BADGE: Record<PayrollAdjustmentKind, string> = {
  reimbursement: "bg-emerald-500/15 text-emerald-300",
  deduction: "bg-red-500/15 text-red-300",
  tax: "bg-amber-500/15 text-amber-300",
};

interface Draft {
  kind: PayrollAdjustmentKind;
  description: string;
  amount: string;
  /** Tax only — percent of gross, e.g. "13". */
  percent: string;
}
const EMPTY: Draft = { kind: "reimbursement", description: "", amount: "", percent: "" };

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
  /** Gross pay for the same period — tax is worked out from it, and it's the start of the Net line. */
  grossPay?: number | null;
  createdByName?: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gross = grossPay ?? 0;
  const lines = resolveAdjustmentLines(items, grossPay);
  const sums = sumPayrollAdjustments(lines);
  const draftTaxAmount = draft?.kind === "tax" ? round3(gross * ((Number(draft.percent) || 0) / 100)) : 0;

  const startAdd = () => {
    setEditingId(null);
    setDraft({ ...EMPTY });
    setError(null);
  };
  const startEdit = (a: PayrollAdjustment) => {
    setEditingId(a.id);
    setDraft({ kind: a.kind, description: a.description, amount: String(a.amount), percent: a.percent != null ? String(a.percent) : "" });
    setError(null);
  };
  const cancel = () => {
    setDraft(null);
    setEditingId(null);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    let amount: number;
    let percent: number | null = null;
    if (draft.kind === "tax") {
      percent = Number(draft.percent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) { setError("Enter the tax rate as a percent between 0 and 100 (e.g. 13)."); return; }
      amount = round3(gross * (percent / 100));
    } else {
      amount = Number(draft.amount);
      if (!draft.description.trim()) { setError("Add a description (e.g. Internet allowance, Cash advance)."); return; }
      if (!Number.isFinite(amount) || amount <= 0) { setError("Enter an amount above $0."); return; }
    }
    setBusy(true);
    setError(null);
    try {
      const fields = { kind: draft.kind, description: draft.description, amount, percent };
      if (editingId) await updatePayrollAdjustment(editingId, fields);
      else await addPayrollAdjustment({ profileId, periodStart, periodEnd, ...fields, createdByName });
      await onChanged();
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: PayrollAdjustment) => {
    const shown = lines.find((l) => l.id === a.id) ?? a;
    const label = a.kind === "tax" ? `Tax ${a.percent ?? 0}%` : a.description;
    if (!confirm(`Remove "${label}" (${a.kind === "reimbursement" ? "+" : "−"}${a.kind === "tax" ? money3(shown.amount) : money(shown.amount)})?`)) return;
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
        <option value="tax">Tax (% of gross)</option>
      </select>
      <input
        autoFocus
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder={draft.kind === "tax" ? "Description (optional) — e.g. Withholding tax" : "Description — e.g. Internet allowance, Cash advance"}
        className="min-w-[200px] flex-1 rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white placeholder-slate-500"
      />
      {draft.kind === "tax" ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={draft.percent}
            onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
            placeholder="13"
            className="w-20 rounded border border-white/10 bg-slate-800 px-2 py-1 text-right text-xs text-white tabular-nums"
            aria-label="Tax percent"
          />
          <span className="text-xs text-slate-400">%</span>
          <span className="text-[11px] tabular-nums text-amber-300" title="Gross pay × tax %">
            = {money3(draftTaxAmount)} <span className="text-slate-500">of {money(gross)}</span>
          </span>
        </div>
      ) : (
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
      )}
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
          <p className="text-[11px] text-slate-500">Tax, reimbursements and deductions for {periodStart} to {periodEnd} — shown on the payslip.</p>
        </div>
        {!draft && (
          <button type="button" onClick={startAdd} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        )}
      </div>

      {lines.length === 0 && !draft ? (
        <p className="mt-2 text-xs text-slate-500">No tax, reimbursements or deductions for this period.</p>
      ) : (
        <ul className="mt-2 divide-y divide-white/5">
          {lines.map((a) =>
            editingId === a.id ? (
              <li key={a.id}>{form}</li>
            ) : (
              <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="min-w-0 text-slate-200">
                  <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_BADGE[a.kind]}`}>
                    {a.kind === "tax" ? `Tax ${a.percent ?? 0}%` : KIND_LABEL[a.kind]}
                  </span>
                  {a.description || (a.kind === "tax" ? <span className="text-slate-500">of gross pay</span> : null)}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`tabular-nums font-semibold ${a.kind === "reimbursement" ? "text-emerald-300" : a.kind === "tax" ? "text-amber-300" : "text-red-300"}`}>
                    {a.kind === "reimbursement" ? "+" : "−"}{a.kind === "tax" ? money3(a.amount) : money(a.amount)}
                  </span>
                  <button type="button" onClick={() => startEdit(items.find((i) => i.id === a.id) ?? a)} disabled={busy} title="Edit" className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40">
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

      {(lines.length > 0 || grossPay != null) && (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 border-t border-white/10 pt-2 text-xs tabular-nums">
          {grossPay != null && (<><span className="text-slate-400">Gross pay</span><span className="text-right text-slate-200">{money(grossPay)}</span></>)}
          {sums.tax > 0 && (<><span className="text-slate-400">− Tax</span><span className="text-right text-amber-300">{money3(sums.tax)}</span></>)}
          <span className="text-slate-400">+ Reimbursements</span><span className="text-right text-emerald-300">{money(sums.reimbursements)}</span>
          <span className="text-slate-400">− Deductions</span><span className="text-right text-red-300">{money(sums.deductions)}</span>
          {grossPay != null && (<><span className="font-semibold text-white">= Net pay</span><span className="text-right font-bold text-green-300">{money(grossPay + sums.net)}</span></>)}
        </div>
      )}
    </div>
  );
}
