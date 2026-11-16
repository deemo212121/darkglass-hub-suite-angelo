/**
 * Other Expenses → "Sync Expense Records": saves what AHS already has into
 * Branch Bills in one go — every Expense Record not in a bill yet (Hotel →
 * Travel / Lodging, Food / Flash Tech Allowance → Food, Car Rental → Rental
 * Car, Gas → Gas, Office Supply / Supplies → Equipment / Office Supplies),
 * one bill per branch × month × line, Flash Tech trips under their
 * destination branch. Shows the whole plan first; nothing saves until
 * "Save". Safe to run again — records already in a bill are never added twice.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { getCompanyExpenses } from "@/lib/supabase/expenses";
import { getCompanyUsers } from "@/lib/supabase/users";
import { addBranchExpense, appendBranchExpenseLines } from "@/lib/supabase/branchExpenses";
import { BRANCH_EXPENSE_LABEL, type BranchExpense } from "@/lib/branchExpenses";
import {
  EXPENSE_RECORDS_VENDOR,
  autoFillNote,
  planExpenseRecordSync,
  toBillLine,
  type AutoFillRecord,
  type SyncGroup,
  type SyncPlan,
} from "@/lib/branchAutoFill";

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export function ExpenseRecordsSyncModal({
  existing,
  knownBranches,
  onClose,
  onSaved,
}: {
  existing: BranchExpense[];
  knownBranches: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getCompanyExpenses(), getCompanyUsers()])
      .then(([expenses, users]) => {
        const byId = new Map(users.map((u) => [u.id, u]));
        const records = expenses.map((e): AutoFillRecord => {
          const p = byId.get(e.profileId);
          return {
            id: e.id, category: e.category, reimbursementType: e.reimbursementType, status: e.status, expenseDate: e.expenseDate,
            amount: e.amount, branch: p?.assigned_branch || "", destination: e.toLocation, person: p?.display_name || p?.email || "Unknown",
            description: e.description || "", fromLocation: e.fromLocation, toLocation: e.toLocation, pickupDate: e.pickupDate, returnDate: e.returnDate,
          };
        });
        if (alive) setPlan(planExpenseRecordSync(records, existing, knownBranches));
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [existing, knownBranches]);

  const toSave = plan ? plan.create.length + plan.append.length : 0;
  const saveTotal = plan ? [...plan.create, ...plan.append].reduce((s, g) => s + g.total, 0) : 0;
  const strayDest = useMemo(() => (plan ? Array.from(new Set(plan.stray.map((r) => r.destination?.trim() || r.branch || "No branch"))) : []), [plan]);

  const save = async () => {
    if (!plan || saving || !toSave) return;
    setSaveError(null);
    let done = 0;
    setSaving({ done, total: toSave });
    try {
      for (const g of plan.create) {
        await addBranchExpense({
          branch: g.branch, category: g.category, otherLabel: "", vendor: EXPENSE_RECORDS_VENDOR, amount: g.total,
          expenseDate: `${g.month}-01`, periodStart: null, periodEnd: null, notes: autoFillNote(g), receipts: [],
        }, g.records.map(toBillLine));
        setSaving({ done: ++done, total: toSave });
      }
      for (const g of plan.append) {
        const bill = existing.find((b) => b.id === g.billId)!;
        const lines = [...bill.lineItems, ...g.records.map(toBillLine)];
        const records = lines.filter((l) => l.sourceId).length;
        const pending = lines.filter((l) => /\(pending\)$/.test(l.service)).length;
        await appendBranchExpenseLines(g.billId, bill.amount + g.total, lines, autoFillNote({ records: new Array(records), pending }));
        setSaving({ done: ++done, total: toSave });
      }
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(done ? `Saved ${done} of ${toSave}, then: ${msg}. Open Sync again — it picks up where it stopped.` : msg);
      setSaving(null);
    }
  };

  const groupRows = (list: (SyncGroup & { note?: string })[], tone: string) =>
    list.map((g) => (
      <tr key={`${g.month}|${g.branch}|${g.category}`} className="border-t border-white/5">
        <td className="whitespace-nowrap px-2 py-1.5 text-slate-300">{monthLabel(g.month)}</td>
        <td className="whitespace-nowrap px-2 py-1.5 font-medium text-white">{g.branch}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-slate-300">{BRANCH_EXPENSE_LABEL[g.category]}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-slate-400">
          {g.records.length} record{g.records.length === 1 ? "" : "s"}{g.pending ? <span className="text-amber-300"> · {g.pending} pending</span> : null}
        </td>
        <td className={`whitespace-nowrap px-2 py-1.5 text-[11px] ${tone}`}>{g.note}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-emerald-300">{fmtMoney(g.total)}</td>
      </tr>
    ));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="sync-title" className="flex max-h-[94vh] w-full max-w-6xl flex-col rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 id="sync-title" className="flex items-center gap-2 text-lg font-bold text-white"><RefreshCw className="h-4 w-4 text-emerald-300" /> Sync Expense Records</h3>
            <p className="text-xs text-slate-400">
              Saves every Expense Record that isn't in a bill yet into Branch Bills — one bill per branch, month and line (Travel / Lodging, Food, Rental Car, Gas, Equipment / Office Supplies).
              Flash Tech trips go to their destination branch. Rejected and $0.00 left out. Safe to run again: a record is never added twice.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={!!saving} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10">
          {loadError ? (
            <p className="p-4 text-sm text-red-300">Couldn't load Expense Records: {loadError}</p>
          ) : !plan ? (
            <p className="p-6 text-center text-sm text-slate-400"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading Expense Records…</p>
          ) : !toSave && !plan.manual.length && !plan.stray.length ? (
            <p className="p-6 text-center text-sm text-slate-400">Everything in Expense Records is in Branch Bills already. Nothing new to save.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-left text-[10px] font-semibold uppercase text-slate-500">
                  <th className="px-2 py-2">Month</th>
                  <th className="px-2 py-2">Branch</th>
                  <th className="px-2 py-2">Line</th>
                  <th className="px-2 py-2">Records</th>
                  <th className="px-2 py-2">What happens</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {groupRows(plan.create.map((g) => ({ ...g, note: "New bill" })), "text-emerald-300")}
                {groupRows(plan.append.map((g) => ({ ...g, note: `Added to its bill (${fmtMoney(g.billAmount)} → ${fmtMoney(g.billAmount + g.total)})` })), "text-sky-300")}
                {plan.manual.length > 0 && (
                  <tr><td colSpan={6} className="border-t border-white/10 bg-amber-500/5 px-2 py-1.5 text-[11px] font-semibold text-amber-300">Skipped — typed in by hand already (so not counted twice). Check these and delete the typed one if the records should be used instead:</td></tr>
                )}
                {groupRows(plan.manual.map((g) => ({ ...g, note: `Skipped · typed: ${g.billAmounts.map(fmtMoney).join(" + ")}` })), "text-amber-300")}
              </tbody>
            </table>
          )}
        </div>

        {plan && plan.stray.length > 0 && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            ⚠ {plan.stray.length} record{plan.stray.length === 1 ? "" : "s"} ({fmtMoney(plan.stray.reduce((s, r) => s + r.amount, 0))}) can't be placed — the trip's destination (or the employee's branch) isn't a branch: <b>{strayDest.join(", ")}</b>.
            Fix the Destination on the Flash Tech Calendar (or the employee's branch), then Sync again.
          </p>
        )}
        {saveError && <p className="mt-3 text-xs text-red-300">{saveError}</p>}

        <div className="mt-4 flex gap-3">
          <button type="button" onClick={() => void save()} disabled={!toSave || !!saving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving {saving.done} of {saving.total}…</> : toSave ? `Save ${toSave} bill${toSave === 1 ? "" : "s"} · ${fmtMoney(saveTotal)}` : "Nothing to save"}
          </button>
          <button type="button" onClick={onClose} disabled={!!saving} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
