/**
 * Overall Expenses ← Accounting → Daily Mileage, automatically: every APPROVED
 * trip goes into its branch's monthly bill on the sheet line
 *
 *   CarIQ Mileage Reimbursement ($0.20)       — the tech had Car IQ that day
 *   NON CarIQ Mileage Reimbursement ($0.50)   — they didn't
 *
 * Car IQ and rate are worked out per trip date exactly like Daily Mileage and
 * payroll: the tech's Car IQ history on that date, else their current Car IQ
 * setting; the rate in effect that day from the company's rate history.
 * Amount = eligible miles (total − excluded) × rate.
 *
 * Branch: the trip's own branch, else the technician's branch.
 *
 * Bills it makes carry the vendor "AHS Daily Mileage" and every trip's id on
 * its line, and are rebuilt from the approved trips each time — so a trip is
 * never counted twice, and editing / un-approving a trip updates its bill.
 * A bill it made that has no approved trips left is removed — unless someone
 * attached a receipt to it, then it stays at $0 so the file isn't lost.
 * A bill typed by hand for that branch × month × line is left alone (and
 * listed) instead of being counted twice. Read-only towards Daily Mileage and
 * payroll — only Branch Bills are written. Pure — the loader hands the data in.
 */

import type { BranchExpenseLine } from "./branchExpenses";
import { branchKey, matchBranch } from "./branchAutoFill";

export const DAILY_MILEAGE_VENDOR = "AHS Daily Mileage";

export type MileageCategory = "cariq_mileage" | "non_cariq_mileage";
export const MILEAGE_CATEGORIES: MileageCategory[] = ["cariq_mileage", "non_cariq_mileage"];

/** An approved trip, priced for its date. */
export interface MileageSyncTrip {
  id: string;
  profileId: string;
  person: string;
  /** "YYYY-MM-DD" */
  workDate: string;
  /** Total − excluded (what's paid). */
  eligibleMiles: number;
  /** The branch typed on the trip ("" = the tech's own). */
  tripBranch: string;
  /** The technician's branch. */
  homeBranch: string;
  /** null = nobody has set this tech's Car IQ status. */
  hasCarIq: boolean | null;
  /** $ per mile that day (with / without Car IQ). */
  rate: number | null;
  vehicle: string;
  ticketRefs: string;
  /** Daily Mileage's Entry Check ("Add reason", "Check miles"…) — "" when fine. */
  problem: string;
}

/** Why an approved trip couldn't go in a bill, and where to fix it. */
export interface MileageStray {
  trip: MileageSyncTrip;
  reason: string;
  /** "carIq" = the tech's Car IQ status; "branch" = the tech's branch (User Management); "trip" = the trip itself (Daily Mileage). */
  fix: "carIq" | "branch" | "trip";
}

export interface MileageGroup {
  branch: string;
  /** "2026-11" */
  month: string;
  category: MileageCategory;
  trips: MileageSyncTrip[];
  total: number;
}

export interface MileageSyncPlan {
  create: MileageGroup[];
  /** A bill it made before whose trips changed — its lines and amount are replaced. Empty `trips` = none approved any more ($0, it has a receipt). */
  update: (MileageGroup & { billId: string })[];
  /** Bills it made with no approved trips left and no receipt — deleted. Only ever its own "AHS Daily Mileage" bills. */
  remove: string[];
  /** Typed by hand for that branch × month × line — left alone. */
  manual: (MileageGroup & { billAmounts: number[] })[];
  stray: MileageStray[];
}

type SyncBill = { id: string; branch: string; category: string; expenseDate: string; amount: number; vendor: string; lineItems: BranchExpenseLine[]; receipts?: unknown[] };

const cents = (n: number) => Math.round(n * 100) / 100;
export const tripAmount = (t: Pick<MileageSyncTrip, "eligibleMiles" | "rate">) => cents(t.eligibleMiles * (t.rate ?? 0));
const fmtRate = (r: number) => `$${r.toFixed(2)}`;

/** One trip as one line of the bill. */
export function mileageBillLine(t: MileageSyncTrip): BranchExpenseLine {
  return {
    date: t.workDate,
    time: "",
    driver: t.person,
    vehicle: t.vehicle,
    service: `${t.hasCarIq ? "CarIQ" : "NON CarIQ"} mileage · ${t.eligibleMiles} mi × ${fmtRate(t.rate ?? 0)}`,
    merchant: t.ticketRefs ? `Tickets ${t.ticketRefs}` : "",
    address: t.tripBranch ? `Trip branch: ${t.tripBranch}` : "",
    amount: tripAmount(t),
    sourceId: t.id,
  };
}

export function mileageNote(g: Pick<MileageGroup, "trips">): string {
  const n = g.trips.length;
  const miles = Math.round(g.trips.reduce((s, t) => s + t.eligibleMiles, 0) * 10) / 10;
  return n ? `From AHS Daily Mileage: ${n} approved trip${n === 1 ? "" : "s"}, ${miles} mi` : "From AHS Daily Mileage: no approved trips now";
}

/** Lines as "id:amount" — to tell whether a bill needs rewriting. */
const fingerprint = (lines: BranchExpenseLine[]) =>
  lines.map((l) => `${l.sourceId ?? ""}:${l.amount.toFixed(2)}:${l.service}:${l.driver}:${l.date}`).sort().join("|");

export function planMileageSync(trips: MileageSyncTrip[], bills: SyncBill[], knownBranches: string[]): MileageSyncPlan {
  const groups = new Map<string, MileageGroup>();
  const stray: MileageStray[] = [];
  for (const t of trips) {
    if (!t.workDate || !(t.eligibleMiles > 0)) continue;
    if (t.problem) { stray.push({ trip: t, reason: `Approved, but the trip says "${t.problem}"`, fix: "trip" }); continue; }
    if (t.hasCarIq == null) { stray.push({ trip: t, reason: "Car IQ status not set for this technician", fix: "carIq" }); continue; }
    if (t.rate == null) { stray.push({ trip: t, reason: "No mileage rate for this date", fix: "carIq" }); continue; }
    let branch: string | null;
    if (t.tripBranch.trim()) {
      branch = matchBranch(t.tripBranch, knownBranches);
      if (!branch) { stray.push({ trip: t, reason: `Trip branch "${t.tripBranch.trim()}" isn't one of our branches`, fix: "trip" }); continue; }
    } else {
      branch = matchBranch(t.homeBranch, knownBranches);
      if (!branch) {
        stray.push({ trip: t, reason: t.homeBranch.trim() ? `Technician's branch "${t.homeBranch.trim()}" isn't one of our branches` : "No trip branch, and the technician has no branch", fix: "branch" });
        continue;
      }
    }
    const category: MileageCategory = t.hasCarIq ? "cariq_mileage" : "non_cariq_mileage";
    const month = t.workDate.slice(0, 7);
    const key = `${branchKey(branch)}|${month}|${category}`;
    const g = groups.get(key) ?? { branch, month, category, trips: [], total: 0 };
    g.trips.push(t);
    g.total = cents(g.total + tripAmount(t));
    groups.set(key, g);
  }

  const plan: MileageSyncPlan = { create: [], update: [], remove: [], manual: [], stray };
  const mine = bills.filter((b) => b.vendor === DAILY_MILEAGE_VENDOR && (MILEAGE_CATEGORIES as string[]).includes(b.category));
  const keyOf = (b: SyncBill) => `${branchKey(b.branch)}|${b.expenseDate.slice(0, 7)}|${b.category}`;
  const handled = new Set<string>();

  for (const [key, g] of groups) {
    g.trips.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.person.localeCompare(b.person));
    const synced = mine.find((b) => keyOf(b) === key);
    if (synced) {
      handled.add(synced.id);
      if (fingerprint(synced.lineItems) !== fingerprint(g.trips.map(mileageBillLine)) || cents(synced.amount) !== g.total) plan.update.push({ ...g, billId: synced.id });
      continue;
    }
    const typed = bills.filter((b) => b.vendor !== DAILY_MILEAGE_VENDOR && keyOf(b) === key);
    if (typed.length) plan.manual.push({ ...g, billAmounts: typed.map((b) => b.amount) });
    else plan.create.push(g);
  }
  // A bill it made whose trips are all gone now (un-approved / moved): removed — or, if someone attached a receipt, kept at $0.
  for (const b of mine) {
    if (handled.has(b.id)) continue;
    if (!(b.receipts?.length)) { plan.remove.push(b.id); continue; }
    if (b.lineItems.length === 0 && cents(b.amount) === 0) continue;
    plan.update.push({ branch: b.branch, month: b.expenseDate.slice(0, 7), category: b.category as MileageCategory, trips: [], total: 0, billId: b.id });
  }

  const order = (a: MileageGroup, b: MileageGroup) => a.month.localeCompare(b.month) || a.branch.localeCompare(b.branch) || a.category.localeCompare(b.category);
  plan.create.sort(order);
  plan.update.sort(order);
  plan.manual.sort(order);
  plan.stray.sort((a, b) => a.reason.localeCompare(b.reason) || a.trip.workDate.localeCompare(b.trip.workDate));
  return plan;
}
