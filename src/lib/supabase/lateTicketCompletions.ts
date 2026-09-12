/**
 * Late ticket completions — a ticket that reached CL-Claimed/CL-Completed
 * after the Sunday-Saturday week it was scheduled in had already ended.
 * Rows are inserted server-side only (trg_late_ticket_completion,
 * 0246_late_ticket_completions.sql) the moment that transition happens — this
 * file only reads/resolves them and later folds confirmed ones into payroll.
 *
 * Flow: LateTicketCompletionModal.tsx (blocking popup for Claims-role users)
 * calls getPendingLateTicketCompletions()/resolveLateTicketCompletion();
 * confirming also fires the Accounting alert via notifyRequestReviewers()
 * (employeeRequests.ts). techPayroll.ts's getCarryoverRepairCounts() reads
 * confirmed-but-not-yet-paid rows directly (joined against tickets/visits
 * for pricing) so AccountingDashboard.tsx can fold them into whichever
 * payroll run generates next for that technician; its Generate Payroll
 * handler then calls markCarryoversConsumed() here so they're only ever
 * paid once.
 */
import { supabase } from "./client";

export interface LateTicketCompletion {
  id: string;
  ticketId: string;
  ticketNo: string;
  technicianName: string | null;
  scheduleDate: string | null;
  periodStart: string;
  periodEnd: string;
  status: "pending" | "confirmed" | "rejected";
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  carryoverPayrollRunId: string | null;
  createdAt: string;
}

function mapRow(r: any): LateTicketCompletion {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    ticketNo: r.ticket_no,
    technicianName: r.technician_name,
    scheduleDate: r.schedule_date,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at,
    carryoverPayrollRunId: r.carryover_payroll_run_id,
    createdAt: r.created_at,
  };
}

/** Every still-open row for the current user's company (RLS-scoped) — what LateTicketCompletionModal shows a Claims-role viewer. */
export async function getPendingLateTicketCompletions(): Promise<LateTicketCompletion[]> {
  const { data, error } = await supabase
    .from("late_ticket_completions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getPendingLateTicketCompletions error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(mapRow);
}

/** Claims (or admin/company-superadmin) confirms or rejects one row. */
export async function resolveLateTicketCompletion(
  id: string,
  status: "confirmed" | "rejected",
  reviewedBy: string | null,
  reviewedByName: string | null
): Promise<void> {
  const { error } = await supabase
    .from("late_ticket_completions")
    .update({ status, reviewed_by: reviewedBy, reviewed_by_name: reviewedByName, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("resolveLateTicketCompletion error:", error.message);
    throw new Error(error.message);
  }
}

/** Stamps the rows actually included in a just-generated payroll run so they're never paid twice. */
export async function markCarryoversConsumed(ids: string[], payrollRunId: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("late_ticket_completions")
    .update({ carryover_payroll_run_id: payrollRunId })
    .in("id", ids);
  if (error) {
    console.error("markCarryoversConsumed error:", error.message);
    throw new Error(error.message);
  }
}
