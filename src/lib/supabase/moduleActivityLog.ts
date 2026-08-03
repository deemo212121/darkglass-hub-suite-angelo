/**
 * Activity log shared by Payroll Calculation, Attendance Monitoring, IT
 * Tickets, and User Management — one table (migration 0115), partitioned by
 * the `module` column. Each page only ever fetches its own module, so in
 * practice every page's log is dedicated to that page, not a mixed feed.
 */
import { supabase } from "./client";

export type ActivityLogModule = "accounting" | "payroll" | "attendance-monitoring" | "it-tickets" | "user-management";

/** Human-readable label for each action code — new codes just show as-is (title-cased) if not listed here. */
export const MODULE_ACTIVITY_ACTION_LABELS: Record<string, string> = {
  payroll_run_generated: "Generated payroll run",
  payroll_run_regenerated: "Regenerated payroll run",
  payslip_sent: "Sent payslip",
  gmail_connected: "Connected Gmail",
  gmail_disconnected: "Disconnected Gmail",
  payroll_csv_exported: "Exported payroll CSV",
  pto_request_approved: "Approved PTO request",
  pto_request_rejected: "Rejected PTO request",
  timecard_correction_approved: "Approved time correction",
  timecard_correction_rejected: "Rejected time correction",
  conduct_warning_submitted: "Submitted conduct warning",
  attendance_note_saved: "Saved attendance note",
  it_ticket_submitted: "Submitted IT ticket",
  it_ticket_status_changed: "Changed IT ticket status",
  it_ticket_deleted: "Deleted IT ticket",
  user_created: "Created user",
  user_edited: "Edited user",
  user_activated: "Activated user",
  user_deactivated: "Deactivated user",
  user_password_reset: "Reset user password",
  working_hours_template_saved: "Saved branch/role working-hours template",
};

export function moduleActivityActionLabel(action: string): string {
  return MODULE_ACTIVITY_ACTION_LABELS[action] ?? action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export interface ModuleActivityLogEntry {
  id: string;
  module: ActivityLogModule;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  details: Record<string, any>;
  createdAt: string;
}

const SELECT = "id, module, actor_id, actor_name, action, target_type, target_id, target_label, details, created_at";

function mapRow(r: any): ModuleActivityLogEntry {
  return {
    id: r.id,
    module: r.module,
    actorId: r.actor_id,
    actorName: r.actor_name ?? null,
    action: r.action,
    targetType: r.target_type ?? null,
    targetId: r.target_id ?? null,
    targetLabel: r.target_label ?? null,
    details: r.details ?? {},
    createdAt: r.created_at,
  };
}

/** 42P01 = relation doesn't exist yet (0115 not applied) — swallow so logging can never break the action it's attached to. */
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

export interface LogModuleActivityInput {
  module: ActivityLogModule;
  actorName?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  details?: Record<string, any>;
}

/**
 * Fire-and-forget audit log write — logging an action should never be able
 * to break the actual feature it's attached to, so failures here are
 * swallowed (and reported to the console) rather than thrown.
 */
export async function logModuleActivity(input: LogModuleActivityInput): Promise<void> {
  try {
    const { error } = await supabase.from("module_activity_log").insert({
      module: input.module,
      actor_name: input.actorName ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      details: input.details ?? {},
    });
    if (error && !isMissingTableError(error)) throw new Error(error.message);
  } catch (err) {
    console.error("Failed to write module activity log entry:", err);
  }
}

export async function getModuleActivityLog(module: ActivityLogModule, limit = 200): Promise<ModuleActivityLogEntry[]> {
  const { data, error } = await supabase
    .from("module_activity_log")
    .select(SELECT)
    .eq("module", module)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(mapRow);
}
