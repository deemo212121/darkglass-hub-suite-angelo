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

// ── Trips: the workbook's review fields ──────────────────────────────────

export type MileageStatus = "pending" | "approved" | "rejected" | "needs_review";

export const MILEAGE_STATUSES: { value: MileageStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "needs_review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
export const statusLabel = (s: MileageStatus) => MILEAGE_STATUSES.find((x) => x.value === s)?.label ?? s;

/** The workbook's Lists tab: vehicle types and exclusion reasons (free text is allowed too). */
export const VEHICLE_TYPES = ["Personal vehicle", "Rental", "Company car", "Other"];
export const EXCLUSION_REASONS = ["Missing photos", "Duplicate trip", "Unapproved miles", "Personal mileage", "Missing documentation", "Other"];

/** The fields the arithmetic needs from a trip. */
export interface TripLike {
  miles: number;
  excludedMiles: number;
  exclusionReason: string;
  status: MileageStatus;
}

/** Total − excluded, never below 0. A rejected trip pays nothing. */
export const eligibleMiles = (t: TripLike) => (t.status === "rejected" ? 0 : round1(Math.max(0, t.miles - (t.excludedMiles || 0))));

/**
 * The workbook's Entry Check, minus what AHS fills in itself (branch, Car IQ,
 * approver, pay period): "" when the trip is fine, else what to fix.
 */
export function entryCheck(t: TripLike): string {
  if (!(t.miles > 0)) return "No miles";
  if (t.excludedMiles < 0 || t.excludedMiles > t.miles) return "Check miles";
  if (t.excludedMiles > 0 && !t.exclusionReason.trim()) return "Add reason";
  return "";
}

/** A day's trips added up: total, excluded and eligible miles, and the day's status at a glance. */
export function dayTotals(trips: TripLike[]): { miles: number; excluded: number; eligible: number; status: MileageStatus | "mixed" | null; problems: number } {
  let miles = 0, excluded = 0, eligible = 0, problems = 0;
  const statuses = new Set<MileageStatus>();
  for (const t of trips) {
    miles += t.miles;
    excluded += t.status === "rejected" ? t.miles : t.excludedMiles || 0;
    eligible += eligibleMiles(t);
    statuses.add(t.status);
    if (entryCheck(t)) problems++;
  }
  const status = statuses.size === 0 ? null : statuses.size === 1 ? [...statuses][0] : "mixed";
  return { miles: round1(miles), excluded: round1(excluded), eligible: round1(eligible), status, problems };
}

/** A block copied from a spreadsheet: rows split by line breaks, cells by tabs. */
export function parsePastedBlock(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map((l) => l.split("\t"));
}
