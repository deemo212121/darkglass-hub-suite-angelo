/**
 * Branch Rates (migration 0245) — one reference $ rate per branch, set by
 * Finance/Admin on the Accounting Dashboard's "Branch Rates" tab. Purely a
 * reference value nothing else in the app reads yet; this module is just
 * the saved row itself.
 */
import { supabase } from "./client";

export interface BranchRate {
  id: string;
  branch: string;
  rate: number;
  updatedAt: string;
}

function mapRow(row: any): BranchRate {
  return {
    id: row.id,
    branch: row.branch,
    rate: Number(row.rate) || 0,
    updatedAt: row.updated_at,
  };
}

/** Every saved branch rate for the caller's company (RLS-scoped). Branches with no row yet just aren't in this list — the caller merges against its own full branch list. */
export async function getBranchRates(): Promise<BranchRate[]> {
  const { data, error } = await supabase
    .from("branch_rates")
    .select("id, branch, rate, updated_at")
    .order("branch", { ascending: true });
  if (error) {
    console.error("getBranchRates error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Create or update the rate for one branch. */
export async function upsertBranchRate(branch: string, rate: number): Promise<void> {
  const { error } = await supabase
    .from("branch_rates")
    .upsert({ branch, rate }, { onConflict: "company_id,branch" });
  if (error) {
    console.error("upsertBranchRate error:", error.message);
    throw new Error(error.message);
  }
}
