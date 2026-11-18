/**
 * Overall Expenses ← Daily Mileage (approved trips), run with the Expense
 * Records sync when the page opens. Plan in lib/mileageExpenseSync.ts.
 * Reads Daily Mileage, Car IQ history / settings and rates; writes ONLY
 * Branch Bills (its own "AHS Daily Mileage" bills — and only those are ever
 * removed, when no approved trip is left and no receipt is on them). Never payroll.
 */

import { getCompanyUsersLite } from "./users";
import { addBranchExpense, appendBranchExpenseLines, deleteBranchExpense, getBranchExpenses } from "./branchExpenses";
import { getApprovedTechMileage, getCarIqFlags } from "./techDailyMileage";
import { getCompanyCarIqHistory, carIqEntryEffectiveOn } from "./carIqHistory";
import { getCarIqMileageRateHistory, carIqRatesOn } from "./companySettings";
import type { BranchExpense } from "@/lib/branchExpenses";
import { CAR_IQ_MILEAGE_RATE_WITH, CAR_IQ_MILEAGE_RATE_WITHOUT } from "@/lib/roleLabels";
import { eligibleMiles, entryCheck } from "@/lib/dailyMileage";
import {
  DAILY_MILEAGE_VENDOR,
  mileageBillLine,
  mileageNote,
  planMileageSync,
  type MileageSyncPlan,
  type MileageSyncTrip,
} from "@/lib/mileageExpenseSync";

export interface MileageSyncResult {
  /** Bills made, changed or removed this time. */
  saved: number;
  /** Trips on the bills made / changed this time. */
  trips: number;
  manual: MileageSyncPlan["manual"];
  stray: MileageSyncPlan["stray"];
}

async function planNow(existing: BranchExpense[], knownBranches: string[]): Promise<MileageSyncPlan | null> {
  const trips = await getApprovedTechMileage();
  // Daily Mileage isn't set up (migrations 0451 / 0453) — do nothing at all, never remove a bill.
  if (trips === null) return null;
  if (!trips.length) return planMileageSync([], existing, knownBranches);
  const [users, history, rates, flags] = await Promise.all([
    getCompanyUsersLite(),
    getCompanyCarIqHistory().catch(() => []),
    getCarIqMileageRateHistory({ with: CAR_IQ_MILEAGE_RATE_WITH, without: CAR_IQ_MILEAGE_RATE_WITHOUT }),
    getCarIqFlags().catch(() => new Map<string, boolean>()),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const priced: MileageSyncTrip[] = trips.map((t) => {
    const p = byId.get(t.profileId);
    // Same as Daily Mileage / payroll: Car IQ history on that date, else the current setting.
    const hasCarIq = carIqEntryEffectiveOn(history, t.profileId, t.workDate)?.hasCarIq ?? flags.get(t.profileId) ?? null;
    const r = rates.length ? carIqRatesOn(rates, t.workDate) : null;
    return {
      id: t.id,
      profileId: t.profileId,
      person: p?.display_name || p?.email || "Unknown",
      workDate: t.workDate,
      eligibleMiles: eligibleMiles(t),
      tripBranch: t.branch,
      homeBranch: p?.assigned_branch || "",
      hasCarIq,
      rate: hasCarIq == null || !r ? null : hasCarIq ? r.with : r.without,
      vehicle: t.vehicle,
      ticketRefs: t.ticketRefs,
      problem: entryCheck(t),
    };
  });
  return planMileageSync(priced, existing, knownBranches);
}

/** Fresh bills → plan → save. */
export async function autoSyncDailyMileage(knownBranches: string[]): Promise<MileageSyncResult> {
  const existing = await getBranchExpenses();
  const plan = await planNow(existing, knownBranches);
  if (!plan) return { saved: 0, trips: 0, manual: [], stray: [] };
  let saved = 0;
  for (const g of plan.create) {
    await addBranchExpense({
      branch: g.branch, category: g.category, otherLabel: "", vendor: DAILY_MILEAGE_VENDOR, amount: g.total,
      expenseDate: `${g.month}-01`, periodStart: null, periodEnd: null, notes: mileageNote(g), receipts: [],
    }, g.trips.map(mileageBillLine));
    saved++;
  }
  for (const g of plan.update) {
    await appendBranchExpenseLines(g.billId, g.total, g.trips.map(mileageBillLine), mileageNote(g));
    saved++;
  }
  for (const id of plan.remove) {
    await deleteBranchExpense(id);
    saved++;
  }
  const trips = [...plan.create, ...plan.update].reduce((s, g) => s + g.trips.length, 0);
  return { saved, trips, manual: plan.manual, stray: plan.stray };
}
