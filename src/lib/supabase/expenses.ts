/**
 * Supabase expenses service — Tracking Expenses Dashboard.
 * Rows are keyed by profile_id (see migration 0030), company-scoped by RLS.
 */

import { supabase } from "./client";

export type ExpenseCategory = "Travel" | "Supplies" | "Meals" | "Other";
export type ExpenseStatus = "Pending" | "Approved" | "Reimbursed" | "Rejected";

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
    orNumber: row.or_number ?? null,
    fromLocation: row.from_location ?? null,
    toLocation: row.to_location ?? null,
    flashTechTripId: row.flash_tech_trip_id ?? null,
    expenseSubtype: row.expense_subtype ?? null,
    reviewNote: row.review_note ?? null,
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

async function selectExpensePages(filter: (query: any) => any): Promise<ExpenseRow[]> {
  const all: ExpenseRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const columns = reviewNoteColumnMissing ? EXPENSE_COLUMNS : `${EXPENSE_COLUMNS}, review_note`;
    const { data, error } = await filter(supabase.from("expenses").select(columns)).range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (!reviewNoteColumnMissing && /review_note/.test(error.message)) {
        reviewNoteColumnMissing = true;
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
  orNumber?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  /** Set when this expense was auto-created from a Flash Tech Calendar trip — see migration 0130/flashTechTrips.ts. Never set from the ordinary Expense Tracking "Add Expense" form. */
  flashTechTripId?: string | null;
  expenseSubtype?: "hotel" | "transportation" | null;
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
    })
    .select("id")
    .single();
  if (error) {
    console.error("createExpense error:", error.message);
    throw new Error(error.message);
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
    orNumber?: string | null;
    fromLocation?: string | null;
    toLocation?: string | null;
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
    })
    .eq("id", id);
  if (error) {
    console.error("updateExpense error:", error.message);
    throw new Error(error.message);
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
    throw new Error(/review_note/.test(error.message) ? "Saving a rejection reason needs migration 0372 (expenses.review_note) — run it in the Supabase SQL Editor first." : error.message);
  }
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) {
    console.error("deleteExpense error:", error.message);
    throw new Error(error.message);
  }
}
