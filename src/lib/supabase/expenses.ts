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
    createdAt: row.created_at,
  };
}

/** All expenses for the caller's company (RLS-scoped), newest first. */
export async function getCompanyExpenses(): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select("id, profile_id, category, expense_date, amount, description, status, created_by, reviewed_by, reviewed_at, created_at")
    .not("profile_id", "is", null)
    .order("expense_date", { ascending: false });
  if (error) {
    console.error("getCompanyExpenses error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** File a new expense on behalf of an employee (profileId). */
export async function createExpense(input: {
  profileId: string;
  category: ExpenseCategory;
  expenseDate: string;
  amount: number;
  description: string;
  createdBy: string | null;
}): Promise<void> {
  const { error } = await supabase.from("expenses").insert({
    profile_id: input.profileId,
    category: input.category,
    expense_date: input.expenseDate,
    amount: input.amount,
    description: input.description || null,
    status: "Pending",
    created_by: input.createdBy,
  });
  if (error) {
    console.error("createExpense error:", error.message);
    throw new Error(error.message);
  }
}

/** Edit an expense's fields (only sensible while still Pending). */
export async function updateExpense(
  id: string,
  fields: { category: ExpenseCategory; expenseDate: string; amount: number; description: string }
): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({
      category: fields.category,
      expense_date: fields.expenseDate,
      amount: fields.amount,
      description: fields.description || null,
    })
    .eq("id", id);
  if (error) {
    console.error("updateExpense error:", error.message);
    throw new Error(error.message);
  }
}

/** Approve, reimburse, or reject an expense. */
export async function updateExpenseStatus(id: string, status: ExpenseStatus, reviewedBy: string | null): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("updateExpenseStatus error:", error.message);
    throw new Error(error.message);
  }
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) {
    console.error("deleteExpense error:", error.message);
    throw new Error(error.message);
  }
}
