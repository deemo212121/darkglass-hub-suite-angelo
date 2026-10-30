/**
 * Supabase expenses service — Tracking Expenses Dashboard.
 * Rows are keyed by profile_id (see migration 0030), company-scoped by RLS.
 */

import { supabase } from "./client";

/**
 * Hotel / Car Rental / Office Supply — entered by Accounting (Add Expense;
 * Flash Tech trips create Hotel + Car Rental lines). Reimbursement Form —
 * sent by the employee themselves. Travel / Supplies / Meals / Other are
 * the old categories, kept for rows from before migration 0386.
 */
export type ExpenseCategory = "Hotel" | "Car Rental" | "Office Supply" | "Reimbursement Form" | "Travel" | "Supplies" | "Meals" | "Other";
export type ExpenseStatus = "Pending" | "Approved" | "Reimbursed" | "Rejected";
/**
 * What a Reimbursement Form was for (migration 0401) — Other carries the
 * employee's own words. Flash Tech Allowance (migration 0414 — 0413 in Angelo's repo) shows under
 * Expenses → Flash Tech, not Employee Requests.
 */
export const REIMBURSEMENT_TYPES = ["Gas", "Food", "Flash Tech Allowance", "Other"] as const;
export type ReimbursementType = (typeof REIMBURSEMENT_TYPES)[number];

/** A type's button / badge text — "Flash Tech / Allowance" for the allowance. */
export function reimbursementTypeName(t: ReimbursementType): string {
  return t === "Flash Tech Allowance" ? "Flash Tech / Allowance" : t;
}

/** "Gas", "Food", "Other — Parking", or "" when the expense has no type (not a reimbursement, or sent before 0401). */
export function reimbursementTypeLabel(e: Pick<ExpenseRow, "reimbursementType" | "reimbursementOther">): string {
  if (!e.reimbursementType) return "";
  return e.reimbursementType === "Other" && e.reimbursementOther ? `Other — ${e.reimbursementOther}` : reimbursementTypeName(e.reimbursementType);
}

/** One attached receipt — its Firebase Storage download URL and full path (to delete the file). */
export interface ExpenseReceipt {
  url: string;
  path: string | null;
}
/** How many photos / PDFs one expense can carry. */
export const MAX_EXPENSE_RECEIPTS = 10;

export interface ExpenseRow {
  id: string;
  profileId: string;
  category: ExpenseCategory;
  expenseDate: string; // "YYYY-MM-DD"
  amount: number;
  description: string;
  status: ExpenseStatus;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Firebase Storage download URL for an attached receipt, if any — see migration 0104. */
  receiptUrl: string | null;
  /** Full Firebase Storage path for the receipt (needed to delete it if replaced/removed). */
  receiptPath: string | null;
  /** Every receipt on the expense, the one above first, then extra_receipts (migration 0415). */
  receipts: ExpenseReceipt[];
  /** The Official Receipt / transaction number printed on the receipt itself — see migration 0132. */
  orNumber: string | null;
  /** Origin/destination text, carried over from a Flash Tech trip's locations when auto-created — see migration 0136. */
  fromLocation: string | null;
  toLocation: string | null;
  /** Set when this expense was auto-created from a Flash Tech Calendar trip — see migration 0130. */
  flashTechTripId: string | null;
  /** "hotel" | "transportation" on an expense auto-created from a Flash Tech trip — stays set even after
   *  the trip itself is deleted (flash_tech_trip_id goes null then), so it's the reliable "company-booked" marker. */
  expenseSubtype: string | null;
  /** Why Accounting rejected it — required on Reject, shown to the employee in Self-Service (migration 0372). */
  reviewNote: string | null;
  /** Gas / Food / Other on a Reimbursement Form (migration 0401); null otherwise. */
  reimbursementType: ReimbursementType | null;
  /** The employee's own words when the type is Other. */
  reimbursementOther: string | null;
  createdAt: string;
}

function mapRow(row: any): ExpenseRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    category: row.category,
    expenseDate: row.expense_date,
    amount: Number(row.amount) || 0,
    description: row.description ?? "",
    status: row.status,
    createdBy: row.created_by ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    receiptUrl: row.receipt_url ?? null,
    receiptPath: row.receipt_path ?? null,
    receipts: [
      ...(row.receipt_url ? [{ url: row.receipt_url as string, path: (row.receipt_path ?? null) as string | null }] : []),
      ...(Array.isArray(row.extra_receipts) ? row.extra_receipts : [])
        .filter((r: any) => r && typeof r.url === "string")
        .map((r: any) => ({ url: r.url as string, path: typeof r.path === "string" ? r.path : null })),
    ],
    orNumber: row.or_number ?? null,
    fromLocation: row.from_location ?? null,
    toLocation: row.to_location ?? null,
    flashTechTripId: row.flash_tech_trip_id ?? null,
    expenseSubtype: row.expense_subtype ?? null,
    reviewNote: row.review_note ?? null,
    reimbursementType: row.reimbursement_type ?? null,
    reimbursementOther: row.reimbursement_other ?? null,
    createdAt: row.created_at,
  };
}

// Supabase caps an unbounded select at 1000 rows — a company's full expense
// history can exceed that. Page through in chunks of 1000.
const PAGE_SIZE = 1000;
const EXPENSE_COLUMNS = "id, profile_id, category, expense_date, amount, description, status, created_by, reviewed_by, reviewed_at, receipt_url, receipt_path, or_number, from_location, to_location, flash_tech_trip_id, expense_subtype, created_at";

// review_note (migration 0372) is read best-effort: until that migration has
// been run, the select retries without it instead of blanking every expense
// list — reviewNote just comes back null.
let reviewNoteColumnMissing = false;
// Same for reimbursement_type / reimbursement_other (migration 0401).
let reimbursementColumnsMissing = false;
// Same for extra_receipts (migration 0415).
let extraReceiptsColumnMissing = false;

async function selectExpensePages(filter: (query: any) => any): Promise<ExpenseRow[]> {
  const all: ExpenseRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const columns = `${EXPENSE_COLUMNS}${reviewNoteColumnMissing ? "" : ", review_note"}${reimbursementColumnsMissing ? "" : ", reimbursement_type, reimbursement_other"}${extraReceiptsColumnMissing ? "" : ", extra_receipts"}`;
    const { data, error } = await filter(supabase.from("expenses").select(columns)).range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (!reviewNoteColumnMissing && /review_note/.test(error.message)) {
        reviewNoteColumnMissing = true;
        from -= PAGE_SIZE;
        continue;
      }
      if (!reimbursementColumnsMissing && /reimbursement_/.test(error.message)) {
        reimbursementColumnsMissing = true;
        from -= PAGE_SIZE;
        continue;
      }
      if (!extraReceiptsColumnMissing && /extra_receipts/.test(error.message)) {
        extraReceiptsColumnMissing = true;
        from -= PAGE_SIZE;
        continue;
      }
      throw new Error(error.message);
    }
    all.push(...((data ?? []) as any[]).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** The reimbursement type columns, only when a type is given — so other expenses still save before migration 0401 is run. */
function reimbursementFields(f: { reimbursementType?: ReimbursementType | null; reimbursementOther?: string | null }) {
  if (f.reimbursementType === undefined) return {};
  return {
    reimbursement_type: f.reimbursementType || null,
    reimbursement_other: f.reimbursementType === "Other" ? f.reimbursementOther?.trim() || null : null,
  };
}
const reimbursementError = (msg: string) =>
  /reimbursement_/.test(msg) ? "Saving the reimbursement type needs migration 0401 — run it in the Supabase SQL Editor first."
    : /extra_receipts/.test(msg) ? "Saving more than one receipt needs migration 0415 — run it in the Supabase SQL Editor first."
    : msg;

/**
 * The receipt columns from a list of receipts: the first in receipt_url /
 * receipt_path, the rest in extra_receipts (migration 0415). extra_receipts is
 * only sent when there's more than one, or to clear old extras — so a single
 * receipt still saves before 0415 is run.
 */
function receiptFields(receipts: ExpenseReceipt[] | undefined, clearExtras: boolean) {
  if (!receipts) return {};
  const [first, ...rest] = receipts;
  return {
    receipt_url: first?.url ?? null,
    receipt_path: first?.path ?? null,
    ...(rest.length > 0 || clearExtras ? { extra_receipts: rest.map((r) => ({ url: r.url, path: r.path })) } : {}),
  };
}

/** All expenses for the caller's company (RLS-scoped), newest first. */
export async function getCompanyExpenses(): Promise<ExpenseRow[]> {
  try {
    return await selectExpensePages((q) => q.not("profile_id", "is", null).order("expense_date", { ascending: false }));
  } catch (error) {
    console.error("getCompanyExpenses error:", error instanceof Error ? error.message : error);
    return [];
  }
}

/** One employee's expenses (Employee Self-Service → My Requests), newest first. */
export async function getProfileExpenses(profileId: string): Promise<ExpenseRow[]> {
  try {
    return await selectExpensePages((q) => q.eq("profile_id", profileId).order("expense_date", { ascending: false }).order("created_at", { ascending: false }));
  } catch (error) {
    console.error("getProfileExpenses error:", error instanceof Error ? error.message : error);
    throw error;
  }
}

/** Display names for the people on a set of expenses (who reviewed them), without loading the whole roster — the mobile My Expenses screen. */
export async function getExpensePeopleNames(profileIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("profiles").select("id, display_name, email").in("id", ids.slice(i, i + 100));
    if (error) {
      console.error("getExpensePeopleNames error:", error.message);
      continue;
    }
    for (const p of data ?? []) names.set(p.id, p.display_name || p.email || "Accounting");
  }
  return names;
}

/** File a new expense on behalf of an employee (profileId). */
export async function createExpense(input: {
  profileId: string;
  category: ExpenseCategory;
  expenseDate: string;
  amount: number;
  description: string;
  createdBy: string | null;
  receiptUrl?: string | null;
  receiptPath?: string | null;
  /** Every receipt (first one becomes receiptUrl / receiptPath) — overrides those two when given. */
  receipts?: ExpenseReceipt[];
  orNumber?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  /** Set when this expense was auto-created from a Flash Tech Calendar trip — see migration 0130/flashTechTrips.ts. Never set from the ordinary Expense Tracking "Add Expense" form. */
  flashTechTripId?: string | null;
  expenseSubtype?: "hotel" | "transportation" | null;
  /** Reimbursement Form only (migration 0401). */
  reimbursementType?: ReimbursementType | null;
  reimbursementOther?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      profile_id: input.profileId,
      category: input.category,
      expense_date: input.expenseDate,
      amount: input.amount,
      description: input.description || null,
      status: "Pending",
      created_by: input.createdBy,
      receipt_url: input.receiptUrl ?? null,
      receipt_path: input.receiptPath ?? null,
      or_number: input.orNumber || null,
      from_location: input.fromLocation || null,
      to_location: input.toLocation || null,
      flash_tech_trip_id: input.flashTechTripId ?? null,
      expense_subtype: input.expenseSubtype ?? null,
      ...reimbursementFields(input),
      ...receiptFields(input.receipts, false),
    })
    .select("id")
    .single();
  if (error) {
    console.error("createExpense error:", error.message);
    throw new Error(reimbursementError(error.message));
  }
  return data.id as string;
}

/** Edit an expense's fields (only sensible while still Pending). */
export async function updateExpense(
  id: string,
  fields: {
    category: ExpenseCategory;
    expenseDate: string;
    amount: number;
    description: string;
    receiptUrl?: string | null;
    receiptPath?: string | null;
    /** Every receipt (first one becomes receiptUrl / receiptPath) — overrides those two when given. */
    receipts?: ExpenseReceipt[];
    /** The expense had extra receipts before this edit — clear them even if none are left. */
    hadExtraReceipts?: boolean;
    orNumber?: string | null;
    fromLocation?: string | null;
    toLocation?: string | null;
    reimbursementType?: ReimbursementType | null;
    reimbursementOther?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({
      category: fields.category,
      expense_date: fields.expenseDate,
      amount: fields.amount,
      description: fields.description || null,
      receipt_url: fields.receiptUrl ?? null,
      receipt_path: fields.receiptPath ?? null,
      or_number: fields.orNumber || null,
      from_location: fields.fromLocation || null,
      to_location: fields.toLocation || null,
      ...reimbursementFields(fields),
      ...receiptFields(fields.receipts, !!fields.hadExtraReceipts),
    })
    .eq("id", id);
  if (error) {
    console.error("updateExpense error:", error.message);
    throw new Error(reimbursementError(error.message));
  }
}

/**
 * Approve, reimburse, or reject an expense. reviewed_by/reviewed_at record
 * who approved or rejected it (the "Approved / Rejected By" column), so
 * marking an approved expense Reimbursed leaves them alone. A rejection
 * carries its reason in review_note (migration 0372).
 */
export async function updateExpenseStatus(id: string, status: ExpenseStatus, reviewedBy: string | null, rejectionReason?: string): Promise<void> {
  const update =
    status === "Reimbursed"
      ? { status }
      : status === "Rejected"
        ? { status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString(), review_note: rejectionReason?.trim() || null }
        : { status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() };
  const { error } = await supabase.from("expenses").update(update).eq("id", id);
  if (error) {
    console.error("updateExpenseStatus error:", error.message);
    throw new Error(
      /review_note/.test(error.message)
        ? "Saving a rejection reason needs migration 0372 (expenses.review_note) — run it in the Supabase SQL Editor first."
        : /expenses_status_check/.test(error.message)
          ? "Rejecting expenses needs migration 0374 (allows the Rejected status) — run it in the Supabase SQL Editor first."
          : error.message
    );
  }
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) {
    console.error("deleteExpense error:", error.message);
    throw new Error(error.message);
  }
}
