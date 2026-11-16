/**
 * Other Expenses → Add branch expenses → "Auto-fill from AHS": the sheet
 * lines AHS already has the numbers for, taken from Expense Records for one
 * branch and month:
 *
 *   Flash Tech Travel / Lodging  ← Hotel
 *   Flash Tech Food Reimbursement ← Reimbursement Food / Flash Tech Allowance
 *   Rental Car                   ← Car Rental
 *   Gas                          ← Reimbursement Gas (employee paid, paid back)
 *   Equipment / Office Supplies  ← Office Supply / Supplies
 *
 * A record counts in the month of its date (the same date Expense Records
 * filters on), under the branch it was spent for: a Flash Tech trip's
 * destination branch (the tech was covering it), else the employee's branch. Rejected and $0.00 records are
 * left out; Pending ones count (company-booked hotels and rentals stay
 * Pending) and are counted so the note can say so.
 *
 * No double counting: every record pulled is saved with the bill (its id in
 * the bill's line items), and a record already in a saved bill is skipped.
 * Pure — the form loads the records and hands them in.
 */

import type { BranchExpenseCategory, BranchExpenseLine } from "./branchExpenses";
import { BRANCH_ABBREV } from "./branchDisplay";

export type AutoFillCategory = Extract<BranchExpenseCategory, "travel_lodging" | "food" | "rental_car" | "gas" | "equipment_supplies">;
export const AUTO_FILL_CATEGORIES: AutoFillCategory[] = ["travel_lodging", "food", "rental_car", "gas", "equipment_supplies"];

export interface AutoFillRecord {
  id: string;
  /** Expense Records category: "Hotel", "Car Rental", "Reimbursement Form" … */
  category: string;
  /** Reimbursement Form type: "Gas", "Food", "Flash Tech Allowance", "Other". */
  reimbursementType: string | null;
  status: string;
  /** "YYYY-MM-DD" */
  expenseDate: string;
  amount: number;
  /** The employee's own branch. */
  branch: string;
  /** Flash Tech trip destination (Destination Branch) — the branch the money is charged to when set. */
  destination?: string | null;
  person: string;
  description: string;
  fromLocation: string | null;
  toLocation: string | null;
  pickupDate: string | null;
  returnDate: string | null;
  /** The Flash Tech trip it came from, if any — so a record that can't be placed links to the trip to fix. */
  flashTechTripId?: string | null;
  /** The Expenses tab that lists it — where "Edit" jumps to. */
  recordTab?: "flashTech" | "employeeRequests";
  /** The employee — to find their Flash Tech trips. */
  profileId?: string;
  /** Set by the sync when the branch came from a Flash Tech trip the dates fall in ("Trip Columbus → Savannah, Nov 8 – Nov 14"). */
  tripNote?: string;
}

/** A Flash Tech trip, as the sync needs it. */
export interface TripWindow {
  profileId: string;
  origin: string;
  destination: string;
  /** "YYYY-MM-DD" */
  start: string;
  end: string;
}

/** "11/8", "11/14/26", "2026-11-08" → "YYYY-MM-DD" (year from `ref` when not typed; a date far after `ref` is last year's). */
export function looseDate(text: string | null | undefined, ref: string): string | null {
  const t = (text ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(t);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(ref.slice(0, 4));
  const iso = (yy: number) => `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!m[3] && iso(y) > ref && Number(iso(y).slice(5, 7)) - Number(ref.slice(5, 7)) > 6) y -= 1;
  return iso(y);
}

const DAY = 86400000;
const dayNum = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / DAY;
const short = (ymd: string) => new Date(dayNum(ymd) * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The days a record covers: the dates typed in From / To (employees put "11/8" → "11/14" there), else its own date. */
export function recordDays(r: Pick<AutoFillRecord, "expenseDate" | "fromLocation" | "toLocation">): { start: string; end: string } {
  const a = looseDate(r.fromLocation, r.expenseDate);
  const b = looseDate(r.toLocation, r.expenseDate);
  if (a && b) return a <= b ? { start: a, end: b } : { start: b, end: a };
  const one = a ?? b ?? r.expenseDate;
  return { start: one, end: one };
}

/**
 * The Flash Tech trip a reimbursement belongs to: the employee's trip whose dates
 * overlap the record's days the most (and whose destination is a branch). null when
 * none overlaps, or two different destinations overlap equally (can't tell).
 */
export function tripFor(
  r: Pick<AutoFillRecord, "profileId" | "expenseDate" | "fromLocation" | "toLocation">,
  trips: TripWindow[],
  knownBranches: string[],
): { branch: string; trip: TripWindow } | null {
  if (!r.profileId) return null;
  const days = recordDays(r);
  let best: { branch: string; trip: TripWindow; overlap: number } | null = null;
  let tie = false;
  for (const t of trips) {
    if (t.profileId !== r.profileId || !t.start) continue;
    const overlap = Math.min(dayNum(days.end), dayNum(t.end || t.start)) - Math.max(dayNum(days.start), dayNum(t.start)) + 1;
    if (overlap < 1) continue;
    const branch = matchBranch(t.destination, knownBranches);
    if (!branch) continue;
    if (!best || overlap > best.overlap) { best = { branch, trip: t, overlap }; tie = false; }
    else if (overlap === best.overlap && branch !== best.branch) tie = true;
  }
  return best && !tie ? { branch: best.branch, trip: best.trip } : null;
}

const isDateText = (s: string | null | undefined) => !!s && /^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(s.trim());

/** "Jackson, MS" / "Jackson,MS" / "jackson ms" → "jacksonms" — spacing, commas and case never matter. */
export const branchKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/**
 * The branch a typed name means: same letters ignoring spacing / commas / case
 * ("Jackson, MS" = "Jackson,MS"), else one clear near-miss typo ("Talahasse" →
 * Tallahassee, "Hunstville" → Huntsville — up to 2 letters off, names of 6+
 * letters, and only when no other branch is as close). null when it isn't one.
 */
export function matchBranch(name: string | null | undefined, knownBranches: string[]): string | null {
  const key = branchKey(name ?? "");
  if (!key) return null;
  const exact = knownBranches.find((b) => branchKey(b) === key);
  if (exact) return exact;
  // The company's branch codes (Parts pages' table): "SV" = Savannah, "WM" = Wilmington, "JS" = Jackson, MS…
  const coded = Object.entries(BRANCH_ABBREV).find(([, code]) => code.toLowerCase() === key);
  if (coded) return knownBranches.find((b) => branchKey(b) === branchKey(coded[0])) ?? null;
  if (key.length < 6) return null;
  let best: string | null = null;
  let bestD = 3;
  let tie = false;
  for (const b of knownBranches) {
    const d = editDistance(key, branchKey(b));
    if (d < bestD) { best = b; bestD = d; tie = false; }
    else if (d === bestD) tie = true;
  }
  return best && !tie ? best : null;
}

/** Why a record can't be placed — shown next to it in What's new → Can't place. */
export function strayReason(r: Pick<AutoFillRecord, "branch" | "destination">): { field: "destination" | "branch"; text: string } {
  const dest = r.destination?.trim();
  if (dest) {
    if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(dest)) return { field: "destination", text: `Destination is a date ("${dest}"), not a branch` };
    return { field: "destination", text: `Destination "${dest}" isn't one of our branches` };
  }
  if (!r.branch?.trim()) return { field: "branch", text: "No destination, and the employee has no branch" };
  return { field: "branch", text: `Employee's branch "${r.branch}" isn't one of our branches` };
}

/** The branch a record's money goes to: the trip's destination, else the employee's branch. */
export const chargedBranchOf = (r: Pick<AutoFillRecord, "branch" | "destination">) => r.destination?.trim() || r.branch;

/** Which sheet line an Expense Record belongs on, if any. */
export function autoFillCategoryOf(r: Pick<AutoFillRecord, "category" | "reimbursementType">): AutoFillCategory | null {
  if (r.category === "Hotel") return "travel_lodging";
  if (r.category === "Car Rental") return "rental_car";
  if (r.category === "Office Supply" || r.category === "Supplies") return "equipment_supplies";
  if (r.reimbursementType === "Gas") return "gas";
  if (r.reimbursementType === "Food" || r.reimbursementType === "Flash Tech Allowance") return "food";
  return null;
}

export interface AutoFillLine {
  total: number;
  records: AutoFillRecord[];
  /** How many of `records` are still Pending in Expense Records. */
  pending: number;
  /** Records skipped because a saved bill already has them. */
  alreadyUsed: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const same = (a: string, b: string) => branchKey(a) === branchKey(b);

/** The four lines for one branch and month ("2026-11"); `usedIds` = records already in a saved bill. */
export function buildAutoFill(
  records: AutoFillRecord[],
  branch: string,
  month: string,
  usedIds: Set<string>,
): Record<AutoFillCategory, AutoFillLine> {
  const empty = (): AutoFillLine => ({ total: 0, records: [], pending: 0, alreadyUsed: 0 });
  const out: Record<AutoFillCategory, AutoFillLine> = { travel_lodging: empty(), food: empty(), rental_car: empty(), gas: empty(), equipment_supplies: empty() };
  for (const r of records) {
    const cat = autoFillCategoryOf(r);
    if (!cat || r.status === "Rejected" || !(r.amount > 0)) continue;
    if (!same(chargedBranchOf(r), branch) || (r.expenseDate || "").slice(0, 7) !== month) continue;
    const line = out[cat];
    if (usedIds.has(r.id)) { line.alreadyUsed++; continue; }
    line.records.push(r);
    line.total = cents(line.total + r.amount);
    if (r.status === "Pending") line.pending++;
  }
  for (const c of AUTO_FILL_CATEGORIES) out[c].records.sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.person.localeCompare(b.person));
  return out;
}

/** Every Expense Record id already pulled into a saved bill. */
export function usedRecordIds(bills: { lineItems: BranchExpenseLine[] }[]): Set<string> {
  const ids = new Set<string>();
  for (const b of bills) for (const l of b.lineItems) if (l.sourceId) ids.add(l.sourceId);
  return ids;
}

const typeText = (r: AutoFillRecord) =>
  r.category === "Reimbursement Form" || r.reimbursementType ? (r.reimbursementType === "Flash Tech Allowance" ? "Flash Tech Allowance" : r.reimbursementType || r.category) : r.category;

/** A pulled record as one line of the bill — shown when the branch is opened in Branch Bills. */
export function toBillLine(r: AutoFillRecord): BranchExpenseLine {
  const where = r.tripNote || (r.fromLocation || r.toLocation ? [r.fromLocation, r.toLocation].filter(Boolean).join(" → ") : "");
  const dates = r.pickupDate || r.returnDate ? `${r.pickupDate ?? "…"} – ${r.returnDate ?? "…"}` : "";
  return {
    date: r.expenseDate,
    time: "",
    driver: r.person,
    vehicle: "",
    service: r.status === "Pending" ? `${typeText(r)} (pending)` : typeText(r),
    merchant: r.description,
    address: [where, dates].filter(Boolean).join(" · "),
    amount: r.amount,
    sourceId: r.id,
  };
}

/** Bills made from Expense Records carry this as their vendor. */
export const EXPENSE_RECORDS_VENDOR = "AHS Expense Records";

export interface SyncGroup {
  branch: string;
  /** "2026-11" */
  month: string;
  category: AutoFillCategory;
  records: AutoFillRecord[];
  total: number;
  pending: number;
}

export interface SyncPlan {
  /** New bills to save — one per branch × month × line. */
  create: SyncGroup[];
  /** New records for a bill that came from Expense Records before — added to that bill. */
  append: (SyncGroup & { billId: string; billAmount: number })[];
  /** Branch × month × line already typed in by hand — left alone so it isn't counted twice. */
  manual: (SyncGroup & { billAmounts: number[] })[];
  /** Trip records whose destination isn't a branch — can't be placed. */
  stray: AutoFillRecord[];
}

type SyncBill = { id: string; branch: string; category: string; expenseDate: string; amount: number; vendor: string; lineItems: BranchExpenseLine[] };

/**
 * Every Expense Record not in a bill yet, grouped by the branch it's charged
 * to, its month and its sheet line — what "Sync Expense Records" saves into
 * Other Expenses. Records already in a bill are skipped, so running it again
 * only picks up what's new. A branch × month × line that someone typed in by
 * hand is left alone (and listed) instead of being counted twice.
 */
export function planExpenseRecordSync(records: AutoFillRecord[], bills: SyncBill[], knownBranches: string[], trips: TripWindow[] = []): SyncPlan {
  const used = usedRecordIds(bills);
  const groups = new Map<string, SyncGroup>();
  const stray: AutoFillRecord[] = [];
  for (let r of records) {
    const category = autoFillCategoryOf(r);
    if (!category || r.status === "Rejected" || !(r.amount > 0) || used.has(r.id) || !r.expenseDate) continue;
    // Which branch pays:
    //  1. a destination typed that is a branch (or a branch code / near-miss) → that branch;
    //  2. otherwise, a Flash Tech trip of the employee's that the record's days fall in → the trip's destination
    //     (Food / Gas sent with "11/8" → "11/14" in From / To while on a trip);
    //  3. otherwise, when nothing real was typed (empty or a date) → the employee's own branch.
    let branch = r.flashTechTripId ? matchBranch(chargedBranchOf(r), knownBranches) : matchBranch(r.destination, knownBranches);
    if (!branch && !r.flashTechTripId) {
      const hit = tripFor(r, trips, knownBranches);
      if (hit) {
        branch = hit.branch;
        r = { ...r, tripNote: `Flash Tech trip ${hit.trip.origin || "?"} → ${hit.trip.destination}, ${short(hit.trip.start)} – ${short(hit.trip.end || hit.trip.start)}` };
      } else if (!r.destination?.trim() || isDateText(r.destination)) {
        branch = matchBranch(r.branch, knownBranches);
      }
    }
    if (!branch) { stray.push(r); continue; }
    const month = r.expenseDate.slice(0, 7);
    const key = `${branch}|${month}|${category}`;
    const g = groups.get(key) ?? { branch, month, category, records: [], total: 0, pending: 0 };
    g.records.push(r);
    g.total = cents(g.total + r.amount);
    if (r.status === "Pending") g.pending++;
    groups.set(key, g);
  }
  const plan: SyncPlan = { create: [], append: [], manual: [], stray };
  for (const g of groups.values()) {
    g.records.sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.person.localeCompare(b.person));
    const same = bills.filter((b) => b.category === g.category && b.expenseDate.slice(0, 7) === g.month && branchKey(b.branch) === branchKey(g.branch));
    const synced = same.find((b) => b.vendor === EXPENSE_RECORDS_VENDOR);
    if (synced) plan.append.push({ ...g, billId: synced.id, billAmount: synced.amount });
    else if (same.length) plan.manual.push({ ...g, billAmounts: same.map((b) => b.amount) });
    else plan.create.push(g);
  }
  const order = (a: SyncGroup, b: SyncGroup) => a.month.localeCompare(b.month) || a.branch.localeCompare(b.branch) || AUTO_FILL_CATEGORIES.indexOf(a.category) - AUTO_FILL_CATEGORIES.indexOf(b.category);
  plan.create.sort(order);
  plan.append.sort(order);
  plan.manual.sort(order);
  return plan;
}

/** The line's note: "From Expense Records: 4 records (1 pending)". */
export function autoFillNote(line: Pick<AutoFillLine, "records" | "pending">): string {
  const n = line.records.length;
  return `From AHS Expense Records: ${n} record${n === 1 ? "" : "s"}${line.pending ? ` (${line.pending} pending)` : ""}`;
}
