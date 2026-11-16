import { supabase } from "./client";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { isEligibleForTechnicianFormChecklist } from "@/lib/roleLabels";
import type { ProfileRow } from "./users";
import type { PayrollGroup, PayrollPay } from "@/lib/branchPayroll";

/** Overall Expenses: generated payroll runs → each person's Grand Total per pay period (lib/branchPayroll.ts). */

const PH_BRANCHES = new Set(LOCATIONS_DATA.filter((l) => l.isPhilippines).map((l) => l.location));
const MX_BRANCHES = new Set(LOCATIONS_DATA.filter((l) => l.isMexico).map((l) => l.location));

/** Same groups as New Hires: PH / Mexico by branch, then technicians, else US office. */
export function payrollGroupOf(p: Pick<ProfileRow, "assigned_branch" | "role" | "extra_roles">): PayrollGroup {
  const branch = p.assigned_branch ?? "";
  if (PH_BRANCHES.has(branch)) return "PH";
  if (MX_BRANCHES.has(branch)) return "MX";
  if (isEligibleForTechnicianFormChecklist(p.role ?? "", p.extra_roles ?? null)) return "TECH";
  return "US";
}

/** Every payslip in runs whose pay period ends between `from` and `to` (reads amounts only — no breakdowns). */
export async function getPayrollPays(from: string, to: string, people: ProfileRow[]): Promise<PayrollPay[]> {
  const { data: runs, error: runErr } = await supabase
    .from("payroll_runs")
    .select("id, period_start, period_end")
    .gte("period_end", from)
    .lte("period_end", to);
  if (runErr) throw new Error(runErr.message);
  if (!runs?.length) return [];
  const runById = new Map((runs as { id: string; period_start: string; period_end: string }[]).map((r) => [r.id, r]));
  const byProfile = new Map(people.map((p) => [p.id, p]));
  const out: PayrollPay[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("payroll_line_items")
      .select("id, payroll_run_id, profile_id, gross_pay, extra_pay")
      .in("payroll_run_id", [...runById.keys()])
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const li of (data ?? []) as { id: string; payroll_run_id: string; profile_id: string | null; gross_pay: number | null; extra_pay: number | null }[]) {
      const run = runById.get(li.payroll_run_id);
      const person = li.profile_id ? byProfile.get(li.profile_id) : undefined;
      if (!run || !person) continue;
      out.push({
        id: li.id,
        periodStart: run.period_start,
        periodEnd: run.period_end,
        profileId: person.id,
        name: person.display_name || person.email || "Unknown",
        branch: person.assigned_branch || "",
        group: payrollGroupOf(person),
        amount: Math.round(((Number(li.gross_pay) || 0) + (Number(li.extra_pay) || 0)) * 100) / 100,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}
