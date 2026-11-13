/**
 * Other Expenses → Import Car IQ: Car IQ's fuel-card transaction report
 * (US_APPLIANCE,_INC._.TRX.<start>_<end>.xlsx — sheets Summary / ALL / FUEL /
 * TOLLS) → one CarIQ Transactions amount per branch: every transaction's
 * TOTAL (the last column, USD) summed by the branch of the driver.
 *
 * The branch comes from the driver's own profile (Master List branch),
 * matched by name; a driver who can't be matched gets a guess from the
 * fuel station's city / state, and either can be changed before saving.
 * Pure — the page reads the file with the xlsx library and hands the rows
 * in here.
 */

export interface CarIqTransaction {
  driver: string;
  total: number;
  /** "YYYY-MM-DD" (local date of the purchase). */
  date: string;
  /** "07:55" local time, or "". */
  time: string;
  city: string;
  state: string;
  vehicle: string;
  /** FUEL / TOLLS … */
  service: string;
  merchant: string;
  /** "1890 Kingsley Ave, Orange Park, FL 32073" */
  address: string;
}

export interface CarIqReport {
  periodStart: string | null;
  periodEnd: string | null;
  transactions: CarIqTransaction[];
  /** Rows skipped — not USD, or no TOTAL. */
  skipped: number;
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Excel day number (46309) or "2026-10-14" → "YYYY-MM-DD". */
export function excelDate(v: unknown): string {
  if (typeof v === "number" && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = clean(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

/**
 * `summary`: the Summary sheet as rows of cells (label in the first column,
 * value in the last) — gives the report's Start / End Date.
 * `all`: the ALL sheet as objects keyed by its header row.
 */
export function parseCarIqReport(summary: unknown[][], all: Record<string, unknown>[]): CarIqReport {
  const field = (label: string) => {
    const row = summary.find((r) => clean(r[0]).toLowerCase() === label.toLowerCase());
    return row ? excelDate(row[row.length - 1]) || null : null;
  };
  const transactions: CarIqTransaction[] = [];
  let skipped = 0;
  for (const r of all) {
    const total = Number(r["TOTAL"]);
    const currency = clean(r["CURRENCY"]).toUpperCase();
    if (!isFinite(total) || r["TOTAL"] === "" || (currency && currency !== "USD")) { skipped++; continue; }
    const driver = [clean(r["DRIVER FIRST NAME"]), clean(r["DRIVER LAST NAME"])].filter(Boolean).join(" ") || clean(r["VEHICLE GROUP NAME"]) || "Unknown driver";
    const city = clean(r["MERCHANT CITY"]);
    const state = clean(r["MERCHANT STATE"]).toUpperCase();
    const local = !!excelDate(r["LOCAL DATE"]);
    transactions.push({
      driver,
      total,
      date: excelDate(r["LOCAL DATE"]) || excelDate(r["PACIFIC DATE"]),
      time: (/^(\d{1,2}:\d{2})/.exec(clean(local ? r["LOCAL TIME"] : r["PACIFIC TIME"])) ?? [])[1] ?? "",
      city,
      state,
      vehicle: clean(r["VEHICLE DESCRIPTION"]) || [clean(r["VEHICLE YEAR"]), clean(r["VEHICLE MAKE"]), clean(r["VEHICLE MODEL"])].filter(Boolean).join(" "),
      service: clean(r["SERVICE TYPE"]).toUpperCase(),
      merchant: clean(r["MERCHANT NAME"]) || clean(r["MERCHANT BRAND"]).replace(/_/g, " "),
      address: [titleCase(clean(r["MERCHANT ADDRESS"])), titleCase(city), [state, clean(r["MERCHANT ZIP"])].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    });
  }
  return { periodStart: field("Start Date"), periodEnd: field("End Date"), transactions, skipped };
}

/** Does this look like Car IQ's report (an ALL sheet with DRIVER and TOTAL columns)? */
export function looksLikeCarIqReport(allHeader: unknown[]): boolean {
  const h = allHeader.map((c) => clean(c).toUpperCase());
  return h.includes("TOTAL") && h.includes("DRIVER LAST NAME") && h.includes("DRIVER FIRST NAME");
}

export interface CarIqPerson {
  name: string;
  branch: string;
  isActive: boolean;
}

const tokens = (s: string) => clean(s).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * The person a Car IQ driver is: same first and last name (middle names /
 * suffixes ignored), else same last name and first initial when only one
 * person fits. Active people win over deactivated ones.
 */
export function matchDriver(driver: string, people: CarIqPerson[]): CarIqPerson | null {
  const d = tokens(driver);
  if (d.length < 2) return null;
  const first = d[0];
  const last = d[d.length - 1];
  const pick = (list: CarIqPerson[]) => {
    const active = list.filter((p) => p.isActive);
    const pool = active.length ? active : list;
    return pool.length === 1 ? pool[0] : null;
  };
  const full = people.filter((p) => { const t = tokens(p.name); return t.length >= 2 && t[0] === first && t[t.length - 1] === last; });
  if (full.length) return pick(full);
  const initial = people.filter((p) => { const t = tokens(p.name); return t.length >= 2 && t[t.length - 1] === last && t[0][0] === first[0]; });
  return pick(initial);
}

export interface CarIqBranchPlace {
  branch: string;
  city: string;
  state: string;
}

/** A branch whose city / state is where the driver fueled most often — only a guess, shown as one. */
export function guessBranchFromStations(txs: Pick<CarIqTransaction, "city" | "state">[], places: CarIqBranchPlace[]): string | null {
  const votes = new Map<string, number>();
  for (const t of txs) {
    const hit = places.find((p) => p.city.toLowerCase() === t.city.toLowerCase() && p.state.toUpperCase() === t.state);
    if (hit) votes.set(hit.branch, (votes.get(hit.branch) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [b, v] of votes) if (v > n) { best = b; n = v; }
  return best;
}

export interface CarIqDriverRow {
  driver: string;
  count: number;
  total: number;
  /** The matched person's name, when matched. */
  matchedName: string | null;
  branch: string;
  /** How the branch was found — "manual" once picked on the import screen. */
  source: "profile" | "station" | "manual" | "none";
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** One row per driver: their transactions, total and branch. Biggest spender first. */
export function groupByDriver(report: CarIqReport, people: CarIqPerson[], places: CarIqBranchPlace[]): CarIqDriverRow[] {
  const byDriver = new Map<string, CarIqTransaction[]>();
  for (const t of report.transactions) (byDriver.get(t.driver) ?? byDriver.set(t.driver, []).get(t.driver)!).push(t);
  const rows: CarIqDriverRow[] = [];
  for (const [driver, txs] of byDriver) {
    const person = matchDriver(driver, people);
    const guess = person?.branch ? null : guessBranchFromStations(txs, places);
    rows.push({
      driver,
      count: txs.length,
      total: cents(txs.reduce((s, t) => s + t.total, 0)),
      matchedName: person?.name ?? null,
      branch: person?.branch || guess || "",
      source: person?.branch ? "profile" : guess ? "station" : "none",
    });
  }
  return rows.sort((a, b) => b.total - a.total || a.driver.localeCompare(b.driver));
}

export interface CarIqBranchTotal {
  branch: string;
  total: number;
  count: number;
  drivers: { driver: string; total: number; count: number }[];
}

/** Sum the drivers' totals per branch (drivers without a branch are left out — the page blocks saving until each has one). */
export function totalsByBranch(rows: Pick<CarIqDriverRow, "driver" | "count" | "total" | "branch">[]): CarIqBranchTotal[] {
  const map = new Map<string, CarIqBranchTotal>();
  for (const r of rows) {
    if (!r.branch) continue;
    const b = map.get(r.branch) ?? { branch: r.branch, total: 0, count: 0, drivers: [] };
    b.total = cents(b.total + r.total);
    b.count += r.count;
    b.drivers.push({ driver: r.driver, total: r.total, count: r.count });
    map.set(r.branch, b);
  }
  return Array.from(map.values()).sort((a, b) => a.branch.localeCompare(b.branch));
}

export interface CarIqMonthTotal extends CarIqBranchTotal {
  /** "2026-10" — the month the transactions were made in. */
  month: string;
  /** The report's period cut to this month — e.g. Oct 14 – Oct 31, Nov 1 – Nov 13. */
  periodStart: string;
  periodEnd: string;
  /** Every transaction in this branch + month, oldest first — saved with the bill. */
  transactions: CarIqTransaction[];
}

const lastDayOf = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * One total per branch per month: a report that crosses months (Oct 14 –
 * Nov 13) is split by each transaction's own date, so Oct 14–31 lands in
 * October and Nov 1–13 in November. Each total's billing period is the
 * report's period cut to that month. Drivers without a branch are left out.
 */
export function totalsByBranchAndMonth(
  report: CarIqReport,
  branchOfDriver: (driver: string) => string,
): CarIqMonthTotal[] {
  const map = new Map<string, CarIqMonthTotal & { byDriver: Map<string, { total: number; count: number }> }>();
  for (const t of report.transactions) {
    const branch = branchOfDriver(t.driver);
    const date = t.date || report.periodEnd || "";
    if (!branch || !date) continue;
    const month = date.slice(0, 7);
    const key = `${month}|${branch}`;
    let row = map.get(key);
    if (!row) {
      const first = `${month}-01`;
      const last = lastDayOf(month);
      row = {
        month,
        branch,
        total: 0,
        count: 0,
        drivers: [],
        periodStart: report.periodStart && report.periodStart > first ? report.periodStart : first,
        periodEnd: report.periodEnd && report.periodEnd < last ? report.periodEnd : last,
        transactions: [],
        byDriver: new Map(),
      };
      map.set(key, row);
    }
    row.transactions.push(t);
    row.total = cents(row.total + t.total);
    row.count++;
    const d = row.byDriver.get(t.driver) ?? { total: 0, count: 0 };
    d.total = cents(d.total + t.total);
    d.count++;
    row.byDriver.set(t.driver, d);
  }
  return Array.from(map.values())
    .map(({ byDriver, ...r }) => ({
      ...r,
      transactions: r.transactions.slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
      drivers:Array.from(byDriver, ([driver, v]) => ({ driver, ...v })).sort((a, b) => b.total - a.total) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.branch.localeCompare(b.branch));
}

/** "Title Case" for the all-caps names in the report. */
export const titleCase = (s: string) => clean(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
