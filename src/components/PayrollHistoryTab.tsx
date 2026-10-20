import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { getPayrollReviewBreakdowns, getPayrollReviewPeriods, reviewBreakdownTotal, type PayrollReviewAmounts, type PayrollReviewBreakdown } from "@/lib/supabase/payrollReviewBreakdowns";
import { getPayrollReviewDatesByPeriod, getPayrollReviewMarks, type PayrollReviewMark } from "@/lib/supabase/payrollReviewMarks";

export interface PayrollHistoryRun {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  generated_at: string | null;
}

export interface PayrollHistoryLineItem {
  payroll_run_id: string;
  profile_id: string;
  hours_worked: number;
  overtime_hours: number;
  hourly_rate: number;
  regular_pay: number;
  overtime_pay: number;
  gross_pay: number;
  currency: string;
  extra_pay: number;
  notes: string | null;
  paid: boolean;
  paid_at: string | null;
  compensation_type: "hourly" | "fixed";
  annual_salary: number | null;
}

export interface PayrollHistoryPerson {
  id: string;
  full_name: string;
  department: string | null;
  roleLabel: string | null;
  assigned_branch?: string;
  country: string | null;
}

// Same categories and order as Reviewed Periods (Finance's summary format).
const REVIEW_LINES: { key: keyof PayrollReviewAmounts; label: string; subtract?: boolean }[] = [
  { key: "regularPay", label: "Regular hours (incl. state reg match)" },
  { key: "otPay", label: "OT hours (incl. OT premium match)" },
  { key: "bonus", label: "Bonus (LTP, Performance, OW Incentive)" },
  { key: "commission", label: "Commission (tickets / piece rate)" },
  { key: "ptoPay", label: "PTO" },
  { key: "salaryMatch", label: "Salary match" },
  { key: "mileageOtherReimb", label: "Mileage + other reimbursements" },
  { key: "deduction", label: "Deduction", subtract: true },
  { key: "pretaxInsurance", label: "Pre-tax insurance", subtract: true },
];

interface HistoryRow {
  id: string;
  /** null = reviewed/broken down but not in the saved payroll run. */
  li: PayrollHistoryLineItem | null;
  name: string;
  department: string;
  role: string;
  branch: string;
  isPH: boolean;
  rate: number;
  regularPay: number;
  overtimePay: number;
  annualSalary: number | null;
  /** null = no pay recorded anywhere for this person yet. */
  grossPay: number | null;
  extraPay: number;
  totalPay: number | null;
}

// Pay periods run two weeks, Sunday through Saturday, on the cycle that
// includes Sep 27 – Oct 10, 2026.
const PAY_PERIOD_ANCHOR = Date.UTC(2026, 8, 27);
const DAY_MS = 86_400_000;
function isPayPeriod(key: string): boolean {
  const [start, end] = key.split("|");
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  const offsetDays = Math.round((s - PAY_PERIOD_ANCHOR) / DAY_MS);
  return Math.round((e - s) / DAY_MS) === 13 && ((offsetDays % 14) + 14) % 14 === 0;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const hrs = (n: number) => n.toFixed(2);
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtStamp = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Accounting Dashboard → Payroll History: a past payroll run, read-only.
 * Pick the period (labelled with when it was reviewed), filter by
 * department, and click a name to see what made up that person's pay —
 * the run's stored hours/rate/regular/OT/extra, plus Finance's reviewed
 * breakdown (bonus, commission, mileage, deductions…) when one was saved.
 */
export function PayrollHistoryTab({
  runs,
  lineItems,
  employees,
  currentPeriodStart,
  exchangeRate,
}: {
  runs: PayrollHistoryRun[];
  lineItems: PayrollHistoryLineItem[];
  /** Every profile, active or not, so past line items still resolve a name. */
  employees: PayrollHistoryPerson[];
  /** The Payroll tab's period start — the default pick is the latest run that ended before it. */
  currentPeriodStart: string;
  /** For old line items recorded in PHP. */
  exchangeRate: number;
}) {
  const [reviewDates, setReviewDates] = useState<Map<string, { lastReviewedAt: string; count: number }>>(new Map());
  const [breakdownPeriods, setBreakdownPeriods] = useState<string[]>([]);
  useEffect(() => {
    getPayrollReviewDatesByPeriod()
      .then(setReviewDates)
      .catch((err) => console.error("Failed to load payroll review dates:", err));
    getPayrollReviewPeriods()
      .then((list) => setBreakdownPeriods(list.map((p) => `${p.periodStart}|${p.periodEnd}`)))
      .catch((err) => console.error("Failed to load reviewed periods:", err));
  }, []);

  // A period shows up once it has a saved run, a review mark, or a saved
  // reviewed breakdown — reviewing doesn't create a run line, so a period
  // can be fully reviewed while its run holds only a few people (or none).
  const runByPeriod = useMemo(() => {
    const m = new Map<string, PayrollHistoryRun>();
    for (const r of runs) {
      const key = `${r.period_start}|${r.period_end}`;
      const prev = m.get(key);
      if (!prev || (r.generated_at ?? "") > (prev.generated_at ?? "")) m.set(key, r);
    }
    return m;
  }, [runs]);
  const allPeriodKeys = useMemo(
    () =>
      [...new Set([...runByPeriod.keys(), ...reviewDates.keys(), ...breakdownPeriods])].sort((a, b) => {
        const [as, ae] = a.split("|");
        const [bs, be] = b.split("|");
        return bs.localeCompare(as) || be.localeCompare(ae);
      }),
    [runByPeriod, reviewDates, breakdownPeriods]
  );
  // Every ad-hoc range picked on the Payroll tab leaves review marks behind,
  // so by default only real pay periods are listed; the rest stay reachable
  // behind "Show all date ranges".
  const [showAllRanges, setShowAllRanges] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const periodKeys = useMemo(
    () => (showAllRanges ? allPeriodKeys : allPeriodKeys.filter((k) => isPayPeriod(k) || k === selectedKey)),
    [allPeriodKeys, showAllRanges, selectedKey]
  );
  const hiddenRangeCount = allPeriodKeys.filter((k) => !isPayPeriod(k)).length;

  useEffect(() => {
    if (selectedKey && allPeriodKeys.includes(selectedKey)) return;
    const candidates = allPeriodKeys.filter(isPayPeriod);
    const pool = candidates.length > 0 ? candidates : allPeriodKeys;
    const previous = currentPeriodStart ? pool.find((k) => k.split("|")[1] < currentPeriodStart) : undefined;
    setSelectedKey(previous ?? pool[0] ?? "");
  }, [allPeriodKeys, currentPeriodStart, selectedKey]);
  const [periodStart, periodEnd] = selectedKey ? selectedKey.split("|") : ["", ""];
  const run = runByPeriod.get(selectedKey) ?? null;

  // Per-period detail: who was marked reviewed (and when), and Finance's
  // saved category breakdown for reviewed technicians.
  const [marks, setMarks] = useState<Map<string, PayrollReviewMark>>(new Map());
  const [breakdowns, setBreakdowns] = useState<Map<string, PayrollReviewBreakdown>>(new Map());
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    setMarks(new Map());
    setBreakdowns(new Map());
    if (!periodStart || !periodEnd) return;
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      getPayrollReviewMarks(periodStart, periodEnd).catch((err) => {
        console.error("Failed to load payroll review marks:", err);
        return new Map<string, PayrollReviewMark>();
      }),
      getPayrollReviewBreakdowns(periodStart, periodEnd).catch((err) => {
        console.error("Failed to load payroll review breakdowns:", err);
        return [] as PayrollReviewBreakdown[];
      }),
    ])
      .then(([m, b]) => {
        if (cancelled) return;
        setMarks(m);
        setBreakdowns(new Map(b.map((r) => [r.profileId, r])));
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [periodStart, periodEnd]);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const rows = useMemo((): HistoryRow[] => {
    const lineByProfile = new Map(run ? lineItems.filter((li) => li.payroll_run_id === run.id).map((li) => [li.profile_id, li] as const) : []);
    const ids = new Set([...lineByProfile.keys(), ...marks.keys(), ...breakdowns.keys()]);
    return [...ids]
      .map((id): HistoryRow => {
        const emp = employeeById.get(id);
        const li = lineByProfile.get(id) ?? null;
        const review = breakdowns.get(id);
        const base = {
          id,
          li,
          name: emp?.full_name || review?.technicianName || "Unknown employee",
          department: emp?.department || "Unspecified",
          role: emp?.roleLabel || "",
          branch: emp?.assigned_branch || review?.branch || "",
          isPH: emp?.country === "PH",
        };
        if (!li) {
          // Not in the saved run — the reviewed breakdown is the only pay record.
          const total = review ? reviewBreakdownTotal(review) : null;
          return { ...base, rate: 0, regularPay: 0, overtimePay: 0, annualSalary: null, grossPay: total, extraPay: 0, totalPay: total };
        }
        const d = li.currency === "PHP" ? exchangeRate : 1;
        const grossPay = li.gross_pay / d;
        const extraPay = (li.extra_pay || 0) / d;
        return {
          ...base,
          rate: li.hourly_rate / d,
          regularPay: li.regular_pay / d,
          overtimePay: li.overtime_pay / d,
          annualSalary: li.annual_salary != null ? li.annual_salary / d : null,
          grossPay,
          extraPay,
          totalPay: grossPay + extraPay,
        };
      })
      .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
  }, [run, lineItems, marks, breakdowns, employeeById, exchangeRate]);

  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => { setExpanded(new Set()); }, [selectedKey]);
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department))].sort(), [rows]);
  useEffect(() => { if (department && !departments.includes(department)) setDepartment(""); }, [departments, department]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => (!department || r.department === department) && (!q || r.name.toLowerCase().includes(q)));
  const visibleTotal = visible.reduce((s, r) => s + (r.totalPay ?? 0), 0);
  const notInRun = visible.filter((r) => !r.li).length;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const periodLabel = (key: string) => {
    const [start, end] = key.split("|");
    const reviewed = reviewDates.get(key);
    const generatedAt = runByPeriod.get(key)?.generated_at;
    const when = reviewed
      ? `reviewed ${fmtStamp(reviewed.lastReviewedAt)}`
      : generatedAt
        ? `generated ${fmtStamp(generatedAt)}`
        : "not reviewed";
    return `${fmtDay(start)} – ${fmtDay(end)} · ${when}`;
  };

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-semibold text-sm text-white">Payroll History</h2>
          <p className="text-xs text-slate-400">Past pay periods. Click a name to see what made up their pay.</p>
        </div>
        {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        <span className="ml-auto text-xs text-slate-400">
          {visible.length} {visible.length === 1 ? "person" : "people"} · <span className="text-green-300 font-semibold">{money(visibleTotal)}</span>
          {notInRun > 0 && <span className="block text-[10px] text-amber-300/80">{notInRun} not in the saved payroll run</span>}
        </span>
      </div>

      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-400">
          Payroll period
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white normal-case tracking-normal min-w-[18rem]"
          >
            {periodKeys.length === 0 && <option value="">No pay periods yet</option>}
            {periodKeys.map((k) => (
              <option key={k} value={k}>{periodLabel(k)}</option>
            ))}
          </select>
        </label>
        {hiddenRangeCount > 0 && (
          <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-400 cursor-pointer" title="Ranges that aren't a Sunday–Saturday two-week pay period, e.g. dates picked for a one-off check">
            <input type="checkbox" checked={showAllRanges} onChange={(e) => setShowAllRanges(e.target.checked)} />
            Show all date ranges ({hiddenRangeCount} more)
          </label>
        )}
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-400">
          Department
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white normal-case tracking-normal min-w-[12rem]"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-400">
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee…"
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white normal-case tracking-normal w-56"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="w-8" />
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Name</th>
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Department</th>
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Branch</th>
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Reviewed</th>
              <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Gross Pay</th>
              <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Total Pay</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                  {periodKeys.length === 0 ? "No pay periods yet. Generate or review payroll from the Payroll tab." : detailLoading ? "Loading…" : "No one matches these filters for this period."}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const id = r.id;
              const open = expanded.has(id);
              const mark = marks.get(id);
              const review = breakdowns.get(id);
              return (
                <Fragment key={id}>
                  <tr className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => toggle(id)}>
                    <td className="pl-4 text-slate-400">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-blue-300 hover:underline">{r.name}</div>
                      {r.role && <div className="text-[10px] text-slate-500">{r.role}</div>}
                      {!r.li && <div className="text-[10px] text-amber-300/80">Not in saved payroll run</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{r.department}</td>
                    <td className="px-3 py-2.5 text-slate-300">{r.branch || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {mark ? <span className="text-green-300">{fmtStamp(mark.reviewedAt)}</span> : <span className="text-slate-500">Not reviewed</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{r.grossPay != null ? money(r.grossPay) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-green-300">{r.totalPay != null ? money(r.totalPay) : <span className="text-slate-500 font-normal">—</span>}</td>
                  </tr>
                  {open && (
                    <tr className="border-b border-white/5">
                      <td colSpan={7} className="bg-slate-800/60 px-6 py-4">
                        <PayBreakdown row={r} mark={mark} review={review} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Line({ label, detail, amount, strong, negative }: { label: string; detail?: string; amount: number; strong?: boolean; negative?: boolean }) {
  return (
    <div className={`flex items-baseline gap-3 py-1 ${strong ? "border-t border-white/10 mt-1 pt-2 font-semibold text-white" : "text-slate-300"}`}>
      <span className="flex-1">
        {label}
        {detail && <span className="ml-2 text-xs text-slate-500">{detail}</span>}
      </span>
      <span className={`tabular-nums ${negative ? "text-red-300" : strong ? "text-green-300" : ""}`}>
        {negative ? `−${money(amount)}` : money(amount)}
      </span>
    </div>
  );
}

function PayBreakdown({
  row: r,
  mark,
  review,
}: {
  row: HistoryRow;
  mark: PayrollReviewMark | undefined;
  review: PayrollReviewBreakdown | undefined;
}) {
  const li = r.li;
  const fixed = li?.compensation_type === "fixed";
  // Technicians' gross includes tickets, bonuses, mileage, etc. on top of
  // their hourly pay — the run only stores regular/OT separately, so the
  // rest shows as one line (itemised below when a reviewed breakdown exists).
  const gross = r.grossPay ?? 0;
  const other = gross - r.regularPay - r.overtimePay;
  const otMultiplier = r.isPH ? 1 : 1.5;
  const reviewTotal = review ? reviewBreakdownTotal(review) : 0;

  return (
    <div className="grid gap-6 md:grid-cols-2 text-sm">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Payroll run</div>
        {li ? (
          <>
            {fixed ? (
              <Line label="Salary for this period" detail={r.annualSalary != null ? `${money(r.annualSalary)}/yr` : undefined} amount={r.regularPay} />
            ) : (
              <>
                <Line label="Regular hours" detail={`${hrs(li.hours_worked)} hrs × ${money(r.rate)}`} amount={r.regularPay} />
                <Line label="Overtime" detail={`${hrs(li.overtime_hours)} hrs × ${money(r.rate)}${otMultiplier !== 1 ? " × 1.5" : ""}`} amount={r.overtimePay} />
              </>
            )}
            {Math.abs(other) >= 0.01 && (
              <Line label="Other earnings" detail="tickets, bonuses, mileage, matches" amount={Math.abs(other)} negative={other < 0} />
            )}
            <Line label="Gross pay" amount={gross} strong />
            {Math.abs(r.extraPay) >= 0.01 && <Line label="Extra pay" amount={Math.abs(r.extraPay)} negative={r.extraPay < 0} />}
            {li.notes && <div className="text-xs text-slate-400 py-1">Note: {li.notes}</div>}
            <Line label="Total pay" amount={r.totalPay ?? 0} strong />
          </>
        ) : (
          <div className="text-xs text-amber-300/80 py-1">
            No saved payroll line for this period. They were reviewed, but their pay was never saved, or was removed when payroll was regenerated without them ticked. To fix: on the Payroll tab, pick this period, tick them, and click Generate Payroll.
            {review ? " Until then, the pay shown here comes from their reviewed breakdown." : ""}
          </div>
        )}
        <div className="mt-2 text-xs text-slate-500">
          {li ? (li.paid ? `Paid${li.paid_at ? ` ${fmtStamp(li.paid_at)}` : ""}` : "Not marked paid") : "No run line"}
          {" · "}
          {mark ? `Reviewed ${fmtStamp(mark.reviewedAt)}${mark.reviewedByName ? ` by ${mark.reviewedByName}` : ""}` : "Not reviewed"}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Reviewed breakdown</div>
        {review ? (
          <>
            {REVIEW_LINES.filter((l) => Math.abs(review[l.key]) >= 0.01).map((l) => (
              <Line key={l.key} label={l.label} amount={review[l.key]} negative={l.subtract} />
            ))}
            <Line label="Breakdown total" amount={reviewTotal} strong />
            {li && Math.abs(reviewTotal - gross) >= 0.01 && (
              <div className="text-xs text-amber-300/80 mt-1">Differs from the run's gross pay by {money(Math.abs(reviewTotal - gross))}.</div>
            )}
            <div className="mt-2 text-xs text-slate-500">
              {review.source === "manual" ? "Added by hand" : "Saved at review"}
              {review.updatedByName ? ` · last edited by ${review.updatedByName}` : ""}
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500 py-1">
            No category breakdown was saved for this person. Breakdowns are saved when a technician's payroll is marked Done in the Tech Activity Report.
          </div>
        )}
      </div>
    </div>
  );
}
