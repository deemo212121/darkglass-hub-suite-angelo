/**
 * The date bar used on the Expenses pages: Pay period | Monthly | Date picker.
 *
 *  - Pay period — the company's two-week pay periods (lib/payPeriods), with ‹ › to step.
 *  - Monthly    — one calendar month, with ‹ ›.
 *  - Date picker — any From / To (blank = all dates).
 *
 * It only sets a From / To range; the page filters with it as before.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { payPeriodContaining, type PayPeriod } from "@/lib/payPeriods";
import { addDaysISO, localISODate } from "@/lib/localDate";

type Mode = "payPeriod" | "monthly" | "custom";

const fmtDay = (iso: string, withYear = true) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
};
const periodLabel = (p: PayPeriod) => `${fmtDay(p.start, false)} – ${fmtDay(p.end)}`;
const monthBounds = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: localISODate(new Date(y, m, 0)) };
};
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

/** Next pay period, the current one, and about two years back — newest first. */
function payPeriodOptions(): PayPeriod[] {
  const out: PayPeriod[] = [];
  let p = payPeriodContaining(addDaysISO(payPeriodContaining(localISODate()).end, 1));
  for (let i = 0; i < 54; i++) {
    out.push(p);
    p = payPeriodContaining(addDaysISO(p.start, -1));
  }
  return out;
}

/** Which mode a From / To already is — so the bar opens on the right tab. */
function modeOf(from: string, to: string): Mode {
  if (!from || !to) return "custom";
  const p = payPeriodContaining(from);
  if (p.start === from && p.end === to) return "payPeriod";
  const b = monthBounds(from.slice(0, 7));
  if (b.from === from && b.to === to) return "monthly";
  return "custom";
}

export function DateModeBar({ from, to, onChange, label = "Date" }: { from: string; to: string; onChange: (from: string, to: string) => void; label?: string }) {
  const [mode, setMode] = useState<Mode>(() => modeOf(from, to));
  const periods = useMemo(payPeriodOptions, []);

  const pickMode = (m: Mode) => {
    setMode(m);
    const anchor = from || localISODate();
    if (m === "payPeriod") { const p = payPeriodContaining(anchor); onChange(p.start, p.end); }
    if (m === "monthly") { const b = monthBounds(anchor.slice(0, 7)); onChange(b.from, b.to); }
  };

  const period = from ? payPeriodContaining(from) : payPeriodContaining(localISODate());
  const stepPeriod = (n: number) => {
    const p = payPeriodContaining(n < 0 ? addDaysISO(period.start, -1) : addDaysISO(period.end, 1));
    onChange(p.start, p.end);
  };
  const month = (from || localISODate()).slice(0, 7);
  const setMonth = (ym: string) => { const b = monthBounds(ym); onChange(b.from, b.to); };

  const showing =
    mode === "payPeriod" ? `Pay period ${periodLabel(period)}`
    : mode === "monthly" ? monthName(month)
    : from && to ? `${fmtDay(from)} – ${fmtDay(to)}` : from ? `From ${fmtDay(from)}` : to ? `Until ${fmtDay(to)}` : "All dates";

  const field = "rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none [color-scheme:dark]";
  const step = "rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div role="tablist" aria-label="How to pick dates" className="flex rounded-lg border border-white/10 bg-slate-800/60 p-0.5">
        {([["payPeriod", "Pay period"], ["monthly", "Monthly"], ["custom", "Date picker"]] as const).map(([m, text]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => pickMode(m)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${mode === m ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"}`}
          >
            {text}
          </button>
        ))}
      </div>

      {mode === "payPeriod" && (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => stepPeriod(-1)} aria-label="Previous pay period" className={step}><ChevronLeft className="h-4 w-4" /></button>
          <select
            value={`${period.start}|${period.end}`}
            onChange={(e) => { const [s, t] = e.target.value.split("|"); onChange(s, t); }}
            aria-label="Pay period"
            className={field}
          >
            {!periods.some((p) => p.start === period.start) && <option value={`${period.start}|${period.end}`}>{periodLabel(period)}</option>}
            {periods.map((p) => <option key={p.start} value={`${p.start}|${p.end}`}>{periodLabel(p)}</option>)}
          </select>
          <button type="button" onClick={() => stepPeriod(1)} aria-label="Next pay period" className={step}><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}

      {mode === "monthly" && (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className={step}><ChevronLeft className="h-4 w-4" /></button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" className={field} />
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" className={step}><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}

      {mode === "custom" && (
        <>
          <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} aria-label="From date" className={field} />
          <span className="text-xs text-slate-500">to</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} aria-label="To date" className={field} />
          <button type="button" onClick={() => onChange("", "")} className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700">All dates</button>
        </>
      )}

      <span className="ml-auto text-xs text-slate-400">Showing: <span className="font-semibold text-white">{showing}</span></span>
    </div>
  );
}
