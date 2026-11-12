import { supabase } from "./client";
import type { BranchExpense, BranchExpenseCategory, BranchExpenseFile } from "@/lib/branchExpenses";

/** Accounting → Expenses → Other Expenses (migration 0444). */

const SELECT =
  "id, branch, category, other_label, vendor, amount, expense_date, period_start, period_end, notes, receipts, created_by_name, created_at, updated_by_name, updated_at";

function mapRow(r: any): BranchExpense {
  return {
    id: r.id,
    branch: r.branch,
    category: r.category,
    otherLabel: r.other_label ?? "",
    vendor: r.vendor ?? "",
    amount: Number(r.amount) || 0,
    expenseDate: r.expense_date,
    periodStart: r.period_start ?? null,
    periodEnd: r.period_end ?? null,
    notes: r.notes ?? "",
    receipts: Array.isArray(r.receipts) ? r.receipts : [],
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
    updatedByName: r.updated_by_name ?? null,
    updatedAt: r.updated_at,
  };
}

const friendly = (message: string) =>
  /branch_expenses|relation .* does not exist|schema cache/i.test(message) ? "Run migration 0444 in Supabase first." : message;

export async function getBranchExpenses(): Promise<BranchExpense[]> {
  const out: BranchExpense[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("branch_expenses")
      .select(SELECT)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(friendly(error.message));
    out.push(...(data ?? []).map(mapRow));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface BranchExpenseInput {
  branch: string;
  category: BranchExpenseCategory;
  otherLabel: string;
  vendor: string;
  amount: number;
  expenseDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string;
  receipts: BranchExpenseFile[];
}

const toRow = (i: BranchExpenseInput) => ({
  branch: i.branch.trim(),
  category: i.category,
  other_label: i.category === "other" ? i.otherLabel.trim() : "",
  vendor: i.vendor.trim(),
  amount: Math.round(i.amount * 100) / 100,
  expense_date: i.expenseDate,
  period_start: i.periodStart || null,
  period_end: i.periodEnd || null,
  notes: i.notes.trim(),
  receipts: i.receipts,
});

/**
 * company_id and who added it are stamped by the database (trigger, from the
 * signed-in profile) — never sent from here: the app's companyId is the
 * company's code (e.g. "COMP001"), not the uuid the column holds.
 */
export async function addBranchExpense(input: BranchExpenseInput): Promise<string> {
  const { data, error } = await supabase.from("branch_expenses").insert(toRow(input)).select("id").single();
  if (error) throw new Error(friendly(error.message));
  return (data as { id: string }).id;
}

export async function updateBranchExpense(id: string, input: BranchExpenseInput): Promise<void> {
  const { error } = await supabase.from("branch_expenses").update(toRow(input)).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

export async function setBranchExpenseReceipts(id: string, receipts: BranchExpenseFile[]): Promise<void> {
  const { error } = await supabase.from("branch_expenses").update({ receipts }).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

export async function deleteBranchExpense(id: string): Promise<void> {
  const { error } = await supabase.from("branch_expenses").delete().eq("id", id);
  if (error) throw new Error(friendly(error.message));
}
