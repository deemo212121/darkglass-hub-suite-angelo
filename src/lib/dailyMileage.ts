/**
 * Accounting → Daily Mileage: the arithmetic behind the grid, kept pure so
 * it can be tested. A technician's day is priced at the Car IQ rate in
 * effect that day (with / without a Car IQ device, from their Car IQ
 * history and the company's rate history), and a day over 200 / 300 / 400
 * miles counts toward that threshold.
 */

/** The mile thresholds a long day is counted against. A 450-mile day counts as >400 only. */
export const MILEAGE_THRESHOLDS = [400, 300, 200] as const;

export interface ThresholdCounts {
  over200: number;
  over300: number;
  over400: number;
}

/** Days over 200 / 300 / 400 miles — each day lands in its highest band only. */
export function thresholdCounts(dailyMiles: number[]): ThresholdCounts {
  const out: ThresholdCounts = { over200: 0, over300: 0, over400: 0 };
  for (const m of dailyMiles) {
    if (m > 400) out.over400++;
    else if (m > 300) out.over300++;
    else if (m > 200) out.over200++;
  }
  return out;
}

export interface DayPricing {
  /** null when nobody has set this technician's Car IQ status yet. */
  hasCarIq: boolean | null;
  rate: number | null;
}

/**
 * A technician's miles priced day by day. `priceOn` gives the status and
 * rate for one date; days with no known rate are left out of the pay and
 * counted in `unpricedMiles` so the page can say so.
 */
export function priceMiles(days: { date: string; miles: number }[], priceOn: (date: string) => DayPricing): { miles: number; pay: number; unpricedMiles: number; rates: number[] } {
  let miles = 0, pay = 0, unpricedMiles = 0;
  const rates = new Set<number>();
  for (const d of days) {
    miles += d.miles;
    const p = priceOn(d.date);
    if (p.rate == null) { unpricedMiles += d.miles; continue; }
    pay += d.miles * p.rate;
    rates.add(p.rate);
  }
  return { miles: round1(miles), pay: Math.round(pay * 100) / 100, unpricedMiles: round1(unpricedMiles), rates: [...rates].sort((a, b) => a - b) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A miles value typed or pasted into a cell: "212", "1,248.5", "" (clears).
 * null = clear the day; NaN = not a number (the cell is left as it was).
 */
export function parseMiles(raw: string): number | null {
  const v = raw.replace(/[,\s]/g, "").replace(/mi(les)?$/i, "");
  if (v === "" || v === "-" || v === "—") return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? round1(n) : NaN;
}

/** A block copied from a spreadsheet: rows split by line breaks, cells by tabs. */
export function parsePastedBlock(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map((l) => l.split("\t"));
}
