import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, Plus, Trash2, Loader2 } from "lucide-react";
import type { EmployeePayrollRow } from "@/components/AccountingDashboard";
import {
  REPAIR_TYPES,
  DEFAULT_REPAIR_TYPE,
  getTechRedoTickets,
  getTechAssistedTickets,
  getTechCustomPayItems,
  addTechCustomPayItem,
  updateTechCustomPayItem,
  deleteTechCustomPayItem,
  upsertResolvedTechRepairRate,
  type TechRepairRate,
  type TechRedoTicket,
  type TechAssistedTicket,
  type TechCustomPayItem,
} from "@/lib/supabase/techPayroll";

interface Props {
  row: EmployeePayrollRow;
  periodStart: string;
  periodEnd: string;
  techRepairRates: TechRepairRate[];
  /** Re-fetches the parent's rate table (and everything derived from it) after an inline rate edit here. */
  onRatesChanged: () => void;
  onManualPayBlur: (
    row: EmployeePayrollRow,
    field: "ldtCount" | "mileage" | "trainingValue" | "owIncentivePct",
    value: string
  ) => Promise<void>;
  savingManualKey: string | null;
  /** Corrects an auto-counted category's Value (a REPAIR_TYPES entry or "Two Tech") — see tech_category_overrides, migration 0133. */
  onCategoryOverrideBlur: (profileId: string, category: string, value: string) => Promise<void>;
  savingCategoryOverrideKey: string | null;
  onClose: () => void;
}

function fmt(amount: number) {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * The legacy "Tech Activity Report" — a per-technician payroll breakdown
 * opened from the Tech Payroll table's Action column. Restyled in this
 * app's dark theme rather than the legacy light UI, but keeps the same
 * report structure: an itemized Payment Item / Value / Pay Rate / Payment
 * table plus a stats + Redo/2nd-Tech side panel. The Activity Calendar
 * section of the legacy report isn't built here — see conversation history
 * for why (needs new daily-granularity data this app doesn't collect yet).
 *
 * Every rate cell here is directly editable (upsertResolvedTechRepairRate) —
 * unlike Tech Payroll Setup's rate editor, which always edits/creates a
 * specific (repairType, branch) row, this edits whichever rate is actually
 * in effect for this technician's branch, falling back to creating one
 * scoped to their branch if nothing configured applies yet.
 */
export function TechActivityReportModal({
  row,
  periodStart,
  periodEnd,
  techRepairRates,
  onRatesChanged,
  onManualPayBlur,
  savingManualKey,
  onCategoryOverrideBlur,
  savingCategoryOverrideKey,
  onClose,
}: Props) {
  const { employee, techManual, techCategoryCounts, ticketsAssigned, ticketsCompleted, workingDays, twoTechCount } = row;
  const branch = employee.assigned_branch || "";

  const techRateFor = (category: string): number => {
    const exact = techRepairRates.find((r) => r.repairType === category && r.branch === branch);
    if (exact) return exact.amount;
    const anyBranch = techRepairRates.find((r) => r.repairType === category && !r.branch);
    return anyBranch ? anyBranch.amount : 0;
  };

  const [redoTickets, setRedoTickets] = useState<TechRedoTicket[]>([]);
  const [assistedTickets, setAssistedTickets] = useState<TechAssistedTicket[]>([]);
  const [customItems, setCustomItems] = useState<TechCustomPayItem[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingExtras(true);
    const nameKey = employee.full_name.trim().toLowerCase();
    Promise.all([
      getTechRedoTickets(periodStart, periodEnd),
      getTechAssistedTickets(periodStart, periodEnd),
      getTechCustomPayItems(employee.id, periodStart, periodEnd),
    ])
      .then(([redoByTech, assistedByTech, custom]) => {
        if (cancelled) return;
        setRedoTickets(redoByTech.get(nameKey) ?? []);
        setAssistedTickets(assistedByTech.get(nameKey) ?? []);
        setCustomItems(custom);
      })
      .catch((err) => console.error("Failed to load Tech Activity Report extras:", err))
      .finally(() => { if (!cancelled) setLoadingExtras(false); });
    return () => { cancelled = true; };
  }, [employee.id, employee.full_name, periodStart, periodEnd]);

  const [savingRateKey, setSavingRateKey] = useState<string | null>(null);
  const handleRateBlur = async (category: string, value: string) => {
    const amount = Number(value) || 0;
    if (amount === techRateFor(category)) return;
    setSavingRateKey(category);
    try {
      await upsertResolvedTechRepairRate(techRepairRates, category, branch, amount);
      onRatesChanged();
    } catch (err) {
      alert(`Failed to save rate: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingRateKey(null);
    }
  };

  const [savingCustomId, setSavingCustomId] = useState<string | null>(null);
  const handleAddCustomLine = async () => {
    try {
      const created = await addTechCustomPayItem(employee.id, periodStart, periodEnd, customItems.length);
      setCustomItems((prev) => [...prev, created]);
    } catch (err) {
      alert(`Failed to add line: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };
  const handleCustomLineBlur = async (item: TechCustomPayItem, fields: { label?: string; value?: number; rate?: number }) => {
    setSavingCustomId(item.id);
    try {
      await updateTechCustomPayItem(item.id, fields);
      setCustomItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...fields } : i)));
    } catch (err) {
      alert(`Failed to save line: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingCustomId(null);
    }
  };
  const handleDeleteCustomLine = async (item: TechCustomPayItem) => {
    setSavingCustomId(item.id);
    try {
      await deleteTechCustomPayItem(item.id);
      setCustomItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      alert(`Failed to remove line: ${err instanceof Error ? err.message : "Unknown error"}`);
      setSavingCustomId(null);
    }
  };

  const mcaThreshold = techRateFor("MCA Threshold");
  const mcaBonusRate = techRateFor("MCA Bonus");
  const mcaMet = mcaThreshold > 0 && ticketsCompleted >= mcaThreshold;
  const mcaPayment = mcaMet ? mcaBonusRate : 0;

  // Includes DEFAULT_REPAIR_TYPE so its $ still counts toward the totals below
  // (it was already part of Total Net before this report existed) — just not
  // rendered as its own row, since almost every completed ticket falls into
  // it and it isn't part of the legacy report this is modeled on.
  const categoryPayments = useMemo(
    () => REPAIR_TYPES.map((type) => ({ type, count: techCategoryCounts[type] ?? 0, rate: techRateFor(type), payment: (techCategoryCounts[type] ?? 0) * techRateFor(type) })),
    [techCategoryCounts, techRepairRates, branch]
  );
  const visibleCategoryPayments = categoryPayments.filter((c) => c.type !== DEFAULT_REPAIR_TYPE);
  const twoTechRate = techRateFor("Two Tech");
  const twoTechPayment = twoTechCount * twoTechRate;
  const customLinesTotal = customItems.reduce((s, i) => s + i.value * i.rate, 0);

  // ticketsCompleted (from the parent row) is already net of Redo Reduction
  // (getTechCompletedRepairCounts excludes redo'd tickets outright) — grossCompleted
  // is derived back out just so this row can show the "gross − redo = net" arithmetic.
  const grossCompleted = ticketsCompleted + redoTickets.length;
  const completedTicketsRate = techRateFor("Completed Tickets");
  const completedTicketsPayment = ticketsCompleted * completedTicketsRate;

  const subtotal =
    categoryPayments.reduce((s, c) => s + c.payment, 0) +
    techManual.ldtPay + techManual.mileagePay + techManual.trainingPay +
    twoTechPayment + mcaPayment + completedTicketsPayment + customLinesTotal;
  const owIncentivePay = (techManual.owIncentivePct / 100) * subtotal;
  const totalPayment = subtotal + owIncentivePay;

  const ratioPct = ticketsAssigned > 0 ? (ticketsCompleted / ticketsAssigned) * 100 : 0;
  const avgDailyCompletion = ticketsCompleted / Math.max(1, workingDays);
  const avgDailyMiles = techManual.mileage / Math.max(1, workingDays);

  const rateCellClass = "w-20 bg-slate-800/50 border border-white/10 rounded px-1.5 py-1 text-right text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
          <div>
            <p className="font-semibold text-white">Tech Activity Report of {employee.full_name}</p>
            <p className="text-xs text-slate-400">{periodStart} – {periodEnd}{branch ? ` · ${branch}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            {/* Payroll Detail Report */}
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Payment Item</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Value</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Pay Rate</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr title="Completed visits excluded because the underlying ticket was flagged as a redo — see the Redo list on the right.">
                    <td className="px-3 py-2 text-slate-300">Redo Reduction</td>
                    <td className="px-3 py-2 text-right text-slate-300">{redoTickets.length}</td>
                    <td className="px-3 py-2 text-right text-slate-600">—</td>
                    <td className="px-3 py-2 text-right text-slate-600">—</td>
                  </tr>
                  <tr title="Completed tickets minus Redo Reduction. This rate is paid flat on every one of them, in addition to each ticket's own repair-type rate below.">
                    <td className="px-3 py-2 text-slate-300">Completed Tickets</td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {grossCompleted} − {redoTickets.length} = {ticketsCompleted}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingRateKey === "Completed Tickets" && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`Completed Tickets:${completedTicketsRate}`}
                          type="number" min={0} step={0.01}
                          defaultValue={completedTicketsRate}
                          disabled={savingRateKey === "Completed Tickets"}
                          onBlur={(e) => handleRateBlur("Completed Tickets", e.target.value)}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">{fmt(completedTicketsPayment)}</td>
                  </tr>

                  {(["ldtCount", "mileage", "trainingValue"] as const).map((field) => {
                    const meta = {
                      ldtCount: { label: "LDT", rateKey: "LDT", value: techManual.ldtCount, pay: techManual.ldtPay },
                      mileage: { label: "Mileage", rateKey: "Mileage", value: techManual.mileage, pay: techManual.mileagePay },
                      trainingValue: { label: "Training Paid", rateKey: "Training Paid", value: techManual.trainingValue, pay: techManual.trainingPay },
                    }[field];
                    const savingValue = savingManualKey === `${employee.id}:${field}`;
                    const savingRate = savingRateKey === meta.rateKey;
                    return (
                      <tr key={field}>
                        <td className="px-3 py-2 text-slate-300">{meta.label}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingValue && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${field}:${meta.value}`}
                              type="number" min={0}
                              defaultValue={meta.value || ""}
                              disabled={savingValue}
                              placeholder="0"
                              onBlur={(e) => onManualPayBlur(row, field, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingRate && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${meta.rateKey}:${techRateFor(meta.rateKey)}`}
                              type="number" min={0} step={0.01}
                              defaultValue={techRateFor(meta.rateKey)}
                              disabled={savingRate}
                              onBlur={(e) => handleRateBlur(meta.rateKey, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(meta.pay)}</td>
                      </tr>
                    );
                  })}

                  {visibleCategoryPayments.map(({ type, count, rate, payment }) => {
                    const savingValue = savingCategoryOverrideKey === `${employee.id}:${type}`;
                    return (
                      <tr key={type}>
                        <td className="px-3 py-2 text-slate-300">{type}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingValue && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${type}:count:${count}`}
                              type="number" min={0}
                              defaultValue={count || ""}
                              placeholder="0"
                              disabled={savingValue}
                              onBlur={(e) => onCategoryOverrideBlur(employee.id, type, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingRateKey === type && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${type}:${rate}`}
                              type="number" min={0} step={0.01}
                              defaultValue={rate}
                              disabled={savingRateKey === type}
                              onBlur={(e) => handleRateBlur(type, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(payment)}</td>
                      </tr>
                    );
                  })}

                  <tr title="Completed visits this period where this technician was the assisting (2nd) technician on someone else's ticket.">
                    <td className="px-3 py-2 text-slate-300">Two Tech</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingCategoryOverrideKey === `${employee.id}:Two Tech` && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`Two Tech:count:${twoTechCount}`}
                          type="number" min={0}
                          defaultValue={twoTechCount || ""}
                          placeholder="0"
                          disabled={savingCategoryOverrideKey === `${employee.id}:Two Tech`}
                          onBlur={(e) => onCategoryOverrideBlur(employee.id, "Two Tech", e.target.value)}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingRateKey === "Two Tech" && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`Two Tech:${twoTechRate}`}
                          type="number" min={0} step={0.01}
                          defaultValue={twoTechRate}
                          disabled={savingRateKey === "Two Tech"}
                          onBlur={(e) => handleRateBlur("Two Tech", e.target.value)}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">{fmt(twoTechPayment)}</td>
                  </tr>

                  <tr title="Flat bonus paid when Completed Tickets meets the configured minimum for the period.">
                    <td className="px-3 py-2 text-slate-300">MCA (Min. Complete Achievement)</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1 text-xs text-slate-400">
                        {savingRateKey === "MCA Threshold" && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`MCA Threshold:${mcaThreshold}`}
                          type="number" min={0}
                          defaultValue={mcaThreshold || ""}
                          placeholder="0"
                          disabled={savingRateKey === "MCA Threshold"}
                          onBlur={(e) => handleRateBlur("MCA Threshold", e.target.value)}
                          className="w-14 bg-slate-800/50 border border-white/10 rounded px-1.5 py-1 text-right text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        />
                        <span>req.</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingRateKey === "MCA Bonus" && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`MCA Bonus:${mcaBonusRate}`}
                          type="number" min={0} step={0.01}
                          defaultValue={mcaBonusRate}
                          disabled={savingRateKey === "MCA Bonus"}
                          onBlur={(e) => handleRateBlur("MCA Bonus", e.target.value)}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right ${mcaMet ? "text-green-300" : "text-slate-500"}`}>
                      {mcaThreshold > 0 ? (mcaMet ? fmt(mcaPayment) : "Not met") : "—"}
                    </td>
                  </tr>

                  {customItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <input
                          key={`label:${item.id}:${item.label}`}
                          type="text"
                          defaultValue={item.label}
                          placeholder="(custom program)"
                          disabled={savingCustomId === item.id}
                          onBlur={(e) => handleCustomLineBlur(item, { label: e.target.value })}
                          className="w-full bg-slate-800/50 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          key={`value:${item.id}:${item.value}`}
                          type="number"
                          defaultValue={item.value || ""}
                          placeholder="0"
                          disabled={savingCustomId === item.id}
                          onBlur={(e) => handleCustomLineBlur(item, { value: Number(e.target.value) || 0 })}
                          className={rateCellClass}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            key={`rate:${item.id}:${item.rate}`}
                            type="number" step={0.01}
                            defaultValue={item.rate || ""}
                            placeholder="0"
                            disabled={savingCustomId === item.id}
                            onBlur={(e) => handleCustomLineBlur(item, { rate: Number(e.target.value) || 0 })}
                            className={rateCellClass}
                          />
                          <button
                            onClick={() => handleDeleteCustomLine(item)}
                            disabled={savingCustomId === item.id}
                            title="Remove line"
                            className="text-red-400 hover:text-red-300 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(item.value * item.rate)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} className="px-3 py-2">
                      <button
                        onClick={handleAddCustomLine}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add custom line
                      </button>
                    </td>
                  </tr>

                  <tr title="Percentage bonus applied on top of everything above.">
                    <td className="px-3 py-2 text-slate-300">OW Incentive</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {savingManualKey === `${employee.id}:owIncentivePct` && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`owIncentivePct:${techManual.owIncentivePct}`}
                          type="number" min={0} max={100} step={0.1}
                          defaultValue={techManual.owIncentivePct || ""}
                          placeholder="0"
                          disabled={savingManualKey === `${employee.id}:owIncentivePct`}
                          onBlur={(e) => onManualPayBlur(row, "owIncentivePct", e.target.value)}
                          className="w-16 bg-slate-800/50 border border-white/10 rounded px-1.5 py-1 text-right text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">—</td>
                    <td className="px-3 py-2 text-right text-slate-200">{fmt(owIncentivePay)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/20 bg-white/5">
                    <td colSpan={3} className="px-3 py-3 text-sm font-semibold text-slate-200">Total Payment</td>
                    <td className="px-3 py-3 text-right text-base font-bold text-green-300">{fmt(totalPayment)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Stats + Redo / 2nd Tech panel */}
            <div className="space-y-3">
              {[
                ["Total Working Days", workingDays],
                ["Total Assigned Tickets", ticketsAssigned],
                ["Complete Ratio", ticketsAssigned > 0 ? `${ratioPct.toFixed(1)}%` : "—"],
                ["Avg. Daily Completion", `${avgDailyCompletion.toFixed(1)} tickets`],
                ["Avg. Daily Miles", `${avgDailyMiles.toFixed(1)} miles`],
              ].map(([label, value]) => (
                <div key={label as string} className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
                  <p className="text-lg font-bold text-white mt-0.5">{value}</p>
                </div>
              ))}

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Redo</p>
                {loadingExtras ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : redoTickets.length === 0 ? (
                  <p className="text-xs text-slate-500">None</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {redoTickets.map((t) => (
                      <Link key={t.ticketId} to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                        {t.ticketNo}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">2nd Tech (assisted this tech)</p>
                {loadingExtras ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : assistedTickets.length === 0 ? (
                  <p className="text-xs text-slate-500">None</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {assistedTickets.map((t) => (
                      <Link key={t.ticketId} to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                        {t.secondTechnician} · {t.ticketNo}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
