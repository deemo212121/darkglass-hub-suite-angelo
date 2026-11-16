/**
 * Overall Expenses ← Expense Records, automatically: every Expense Record not in a
 * bill yet (Hotel, Food / Flash Tech Allowance, Car Rental, Gas, Office Supplies) is
 * saved into Branch Bills — one bill per branch × month × line, Flash Tech trips under
 * their destination branch (lib/branchAutoFill.ts → planExpenseRecordSync).
 *
 * Runs when Accounting opens the page. It reads the bills fresh right before planning,
 * and a record already in a bill (its id on a line) is never added twice — so running
 * it again, or on two screens, only picks up what's new.
 */

import { getCompanyExpenses } from "./expenses";
import { getCompanyUsers } from "./users";
import { addBranchExpense, appendBranchExpenseLines, getBranchExpenses } from "./branchExpenses";
import { getCompanyFlashTechTrips } from "./flashTechTrips";
import type { BranchExpense } from "@/lib/branchExpenses";
import {
  EXPENSE_RECORDS_VENDOR,
  autoFillNote,
  planExpenseRecordSync,
  toBillLine,
  type AutoFillRecord,
  type SyncPlan,
  type TripWindow,
} from "@/lib/branchAutoFill";

export async function planExpenseRecordSyncNow(existing: BranchExpense[], knownBranches: string[]): Promise<SyncPlan> {
  const [expenses, users, tripRows] = await Promise.all([getCompanyExpenses(), getCompanyUsers(), getCompanyFlashTechTrips().catch(() => [])]);
  // Reimbursements sent during a Flash Tech trip are charged to the trip's destination (matched by dates).
  const trips: TripWindow[] = tripRows
    .filter((t) => t.technicianProfileId)
    .map((t) => ({ profileId: t.technicianProfileId!, origin: t.originLocation, destination: t.destinationLocation, start: t.startDate, end: t.endDate }));
  const byId = new Map(users.map((u) => [u.id, u]));
  const records = expenses.map((e): AutoFillRecord => {
    const p = byId.get(e.profileId);
    return {
      id: e.id, category: e.category, reimbursementType: e.reimbursementType, status: e.status, expenseDate: e.expenseDate,
      amount: e.amount, branch: p?.assigned_branch || "", destination: e.toLocation, person: p?.display_name || p?.email || "Unknown",
      description: e.description || "", fromLocation: e.fromLocation, toLocation: e.toLocation, pickupDate: e.pickupDate, returnDate: e.returnDate,
      flashTechTripId: e.flashTechTripId,
      profileId: e.profileId,
      recordTab: e.flashTechTripId || e.category === "Hotel" || e.category === "Car Rental" || e.reimbursementType === "Flash Tech Allowance" ? "flashTech" : "employeeRequests",
    };
  });
  return planExpenseRecordSync(records, existing, knownBranches, trips);
}

export async function saveExpenseRecordSync(plan: SyncPlan, existing: BranchExpense[]): Promise<number> {
  let done = 0;
  for (const g of plan.create) {
    await addBranchExpense({
      branch: g.branch, category: g.category, otherLabel: "", vendor: EXPENSE_RECORDS_VENDOR, amount: g.total,
      expenseDate: `${g.month}-01`, periodStart: null, periodEnd: null, notes: autoFillNote(g), receipts: [],
    }, g.records.map(toBillLine));
    done++;
  }
  for (const g of plan.append) {
    const bill = existing.find((b) => b.id === g.billId);
    if (!bill) continue;
    const lines = [...bill.lineItems, ...g.records.map(toBillLine)];
    const records = lines.filter((l) => l.sourceId).length;
    const pending = lines.filter((l) => /\(pending\)$/.test(l.service)).length;
    await appendBranchExpenseLines(g.billId, bill.amount + g.total, lines, autoFillNote({ records: new Array(records), pending }));
    done++;
  }
  return done;
}

export interface AutoSyncResult {
  /** Bills made or added to this time. */
  saved: number;
  /** Records added this time. */
  records: number;
  /** Left alone: the line was typed in by hand for that branch and month. */
  manual: SyncPlan["manual"];
  /** Can't be placed: destination / branch isn't a branch. */
  stray: SyncPlan["stray"];
}

/** Fresh bills → plan → save. */
export async function autoSyncExpenseRecords(knownBranches: string[]): Promise<AutoSyncResult> {
  const existing = await getBranchExpenses();
  const plan = await planExpenseRecordSyncNow(existing, knownBranches);
  const saved = plan.create.length + plan.append.length ? await saveExpenseRecordSync(plan, existing) : 0;
  const records = [...plan.create, ...plan.append].reduce((s, g) => s + g.records.length, 0);
  return { saved, records, manual: plan.manual, stray: plan.stray };
}
