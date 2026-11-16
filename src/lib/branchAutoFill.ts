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
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

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
  const where = r.fromLocation || r.toLocation ? [r.fromLocation, r.toLocation].filter(Boolean).join(" → ") : "";
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
export function planExpenseRecordSync(records: AutoFillRecord[], bills: SyncBill[], knownBranches: string[]): SyncPlan {
  const used = usedRecordIds(bills);
  const canonical = new Map(knownBranches.map((b) => [b.trim().toLowerCase(), b]));
  const groups = new Map<string, SyncGroup>();
  const stray: AutoFillRecord[] = [];
  for (const r of records) {
    const category = autoFillCategoryOf(r);
    if (!category || r.status === "Rejected" || !(r.amount > 0) || used.has(r.id) || !r.expenseDate) continue;
    const branch = canonical.get(chargedBranchOf(r).trim().toLowerCase());
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
    const same = bills.filter((b) => b.category === g.category && b.expenseDate.slice(0, 7) === g.month && b.branch.trim().toLowerCase() === g.branch.toLowerCase());
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
