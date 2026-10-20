import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { getTechCustomPayItems, type TechCustomPayItem } from "@/lib/supabase/techPayroll";
import { getPayrollReviewBreakdowns, type PayrollReviewBreakdown } from "@/lib/supabase/payrollReviewBreakdowns";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

type Kind = "tickets" | "bonus" | "mileage" | "reimbursement" | "deduction";
const KIND_TITLES: Record<Kind, string> = {
  tickets: "Tickets",
  bonus: "Bonuses",
  mileage: "Mileage",
  reimbursement: "Reimbursements",
  deduction: "Deductions",
};

function kindOf(item: TechCustomPayItem): Kind {
  const amount = item.value * item.rate;
  if (/bonus|ltp|performance|incentive/i.test(item.label)) return "bonus";
  if (/deduct|insur|pre-?tax|overpaid/i.test(item.label) || (!item.isWageIncludable && amount < 0)) return "deduction";
  if (/mileage/i.test(item.label)) return "mileage";
  if (!item.isWageIncludable) return "reimbursement";
  return "tickets";
}

/** "W1 Minor", "Minor x", "minor" → "Minor"; "carry over" → "Carryover" — so both weeks' lines merge. */
function displayLabel(label: string): string {
  const cleaned = label
    .trim()
    .replace(/^w(?:ee)?k?\s*\d+\s+/i, "")
    .replace(/\s+x$/i, "")
    .replace(/\bcarry\s+over\b/i, "carryover")
    .replace(/\s+/g, " ");
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Other";
}

interface Combined {
  label: string;
  kind: Kind;
  /** Total quantity when every merged line has the same per-unit rate; null when they're lump sums at different amounts. */
  quantity: number | null;
  rate: number | null;
  amount: number;
}

/**
 * The employee-facing pay breakdown (Finance, 2026-10-20): the same item
 * merged across both weeks ("Minor 50 × $25"), plus hours, OT hours, tickets
 * and miles — what Self-Service shows under a payslip. Finance's own view
 * (Payroll History) keeps the per-week detail.
 */
export function MyPayDetails({
  profileId,
  periodStart,
  periodEnd,
  fallbackHours,
}: {
  profileId: string;
  periodStart: string;
  periodEnd: string;
  /** Hours from the payslip itself, used when the review didn't save hours. */
  fallbackHours?: { regular: number; overtime: number } | null;
}) {
  const [items, setItems] = useState<TechCustomPayItem[] | null>(null);
  const [review, setReview] = useState<PayrollReviewBreakdown | null>(null);
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    Promise.all([
      getTechCustomPayItems(profileId, periodStart, periodEnd).catch(() => [] as TechCustomPayItem[]),
      getPayrollReviewBreakdowns(periodStart, periodEnd, profileId).catch(() => [] as PayrollReviewBreakdown[]),
    ]).then(([lines, breakdowns]) => {
      if (cancelled) return;
      setItems(lines);
      setReview(breakdowns.find((b) => b.profileId === profileId) ?? null);
    });
    return () => { cancelled = true; };
  }, [profileId, periodStart, periodEnd]);

  const combined = useMemo(() => {
    const byKey = new Map<string, { label: string; kind: Kind; lines: TechCustomPayItem[] }>();
    for (const item of items ?? []) {
      const kind = kindOf(item);
      const label = displayLabel(item.label);
      // Mileage merges into one line; everything else by label within its kind.
      const key = kind === "mileage" ? "mileage" : `${kind}|${label.toLowerCase()}`;
      const entry = byKey.get(key) ?? { label: kind === "mileage" ? "Mileage" : label, kind, lines: [] };
      entry.lines.push(item);
      byKey.set(key, entry);
    }
    return [...byKey.values()].map(({ label, kind, lines }): Combined => {
      const amount = lines.reduce((s, i) => s + i.value * i.rate, 0);
      const rates = new Set(lines.map((i) => i.rate));
      const sameRate = rates.size === 1;
      return { label, kind, quantity: sameRate ? lines.reduce((s, i) => s + i.value, 0) : null, rate: sameRate ? lines[0].rate : null, amount };
    });
  }, [items]);

  const tickets = (items ?? []).filter((i) => kindOf(i) === "tickets" && i.rate > 0).reduce((s, i) => s + i.value, 0);
  const miles = (items ?? []).filter((i) => kindOf(i) === "mileage" && i.rate > 0 && i.rate < 1).reduce((s, i) => s + i.value, 0);
  const regular = review?.regularHours ?? fallbackHours?.regular ?? null;
  const overtime = review?.otHours ?? fallbackHours?.overtime ?? null;

  if (items == null) {
    return <div className="text-xs text-slate-400 flex items-center gap-2 py-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading pay details…</div>;
  }

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-white font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Hours" value={regular != null ? regular.toFixed(2) : "—"} />
        <Stat label="OT hours" value={overtime != null ? overtime.toFixed(2) : "—"} />
        <Stat label="Tickets" value={tickets > 0 ? qty(tickets) : "—"} />
        <Stat label="Miles driven" value={miles > 0 ? `${qty(miles)} mi` : "—"} />
      </div>
      {combined.length > 0 && (
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          {(Object.keys(KIND_TITLES) as Kind[]).filter((k) => combined.some((c) => c.kind === k)).map((k) => (
            <div key={k}>
              <div className="text-xs text-slate-400 mb-1">{KIND_TITLES[k]}</div>
              <table className="w-full text-xs">
                <tbody>
                  {combined.filter((c) => c.kind === k).map((c) => (
                    <tr key={c.label} className="border-b border-white/5">
                      <td className="py-1 text-slate-200">{c.label}</td>
                      <td className="py-1 text-right text-slate-400 tabular-nums">
                        {c.quantity != null && c.rate != null && !(c.quantity === 1) ? `${qty(c.quantity)}${k === "mileage" && c.rate < 1 ? " mi" : ""} × ${money(c.rate)}` : ""}
                      </td>
                      <td className={`py-1 text-right tabular-nums ${c.amount < 0 ? "text-red-300" : "text-slate-200"}`}>
                        {c.amount < 0 ? `−${money(-c.amount)}` : money(c.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
