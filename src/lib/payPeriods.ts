import { addDaysISO, localISODate } from "@/lib/localDate";

/**
 * Bi-weekly pay periods: two weeks, Sunday through Saturday, on the cycle
 * that includes Sep 13 – Sep 26 and Sep 27 – Oct 10, 2026 (the periods
 * Finance has already worked).
 */
export const PAY_PERIOD_ANCHOR = "2026-09-27";
/** First period offered in the Payroll tab's period picker. */
export const FIRST_PAY_PERIOD_START = "2026-09-13";

export interface PayPeriod {
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);

/** The pay period containing `iso` ("YYYY-MM-DD"). */
export function payPeriodContaining(iso: string): PayPeriod {
  const offset = dayNumber(iso) - dayNumber(PAY_PERIOD_ANCHOR);
  const start = addDaysISO(PAY_PERIOD_ANCHOR, offset - (((offset % 14) + 14) % 14));
  return { start, end: addDaysISO(start, 13) };
}

/** True when start/end are exactly one pay period on the cycle. */
export function isPayPeriod(start: string, end: string): boolean {
  if (!start || !end) return false;
  const p = payPeriodContaining(start);
  return p.start === start && p.end === end;
}

/** The pay period still in progress (the one containing yesterday — today's clock-ins aren't finished yet). */
export function currentPayPeriod(): PayPeriod {
  return payPeriodContaining(addDaysISO(localISODate(), -1));
}

/** Every pay period from FIRST_PAY_PERIOD_START through the current one, newest first. */
export function listPayPeriods(): PayPeriod[] {
  const out: PayPeriod[] = [];
  for (let p = currentPayPeriod(); p.start >= FIRST_PAY_PERIOD_START; p = payPeriodContaining(addDaysISO(p.start, -1))) out.push(p);
  return out;
}
