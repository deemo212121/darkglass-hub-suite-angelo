import { supabase } from "./client";

/** Human-readable label for each action code — new codes just show as-is (title-cased) if not listed here, so logging a new action never needs a UI change to be readable. */
export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  candidate_added: "Added candidate",
  candidate_status_changed: "Changed candidate status",
  candidate_deleted: "Deleted candidate",
  candidate_cv_forwarded: "Forwarded CV",
  staffing_target_updated: "Updated Staff Needed",
  onboarding_document_added: "Filed onboarding document",
  onboarding_document_deleted: "Removed onboarding document",
  employee_status_changed: "Changed employee status",
  warning_note_reviewed: "Reviewed warning/mistake",
  warning_note_retracted: "Retracted warning/mistake",
  coe_sent: "Sent Certificate of Employment",
  warning_form_sent: "Sent Employee Warning Form",
  warning_form_signed: "Signed Employee Warning Form",
  warning_form_confirmed: "Confirmed Employee Warning Form",
  warning_form_reverted: "Reverted Employee Warning Form",
  warning_form_cancelled: "Cancelled Employee Warning Form",
  warning_form_deleted: "Deleted Employee Warning Form",
  warning_form_reassigned: "Sent Warning Form to next recipient",
  jotform_submission_deleted: "Deleted Jotform submission",
  jotform_submission_restored: "Restored Jotform submission",
};

export function activityActionLabel(action: string): string {
  return ACTIVITY_ACTION_LABELS[action] ?? action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export interface HrActivityLogEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  details: Record<string, any>;
  createdAt: string;
}

const SELECT =
  "id, actor_id, action, target_type, target_id, target_label, details, created_at, actor:actor_id (display_name, username)";

function mapRow(r: any): HrActivityLogEntry {
  return {
    id: r.id,
    actorId: r.actor_id,
    actorName: r.actor?.display_name || r.actor?.username || null,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    details: r.details ?? {},
    createdAt: r.created_at,
  };
}

/** 42P01 = relation doesn't exist yet (0051 not applied) — swallow so logging can never break the action it's attached to. */
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

export interface LogActivityInput {
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  details?: Record<string, any>;
}

/**
 * Fire-and-forget audit log write — logging a click should never be able
 * to break the actual feature it's attached to, so failures here are
 * swallowed (and reported to the console) rather than thrown.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const { error } = await supabase.from("hr_activity_log").insert({
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      details: input.details ?? {},
    });
    if (error && !isMissingTableError(error)) throw new Error(error.message);
  } catch (err) {
    console.error("Failed to write HR activity log entry:", err);
  }
}

export interface GetActivityLogFilters {
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
}

export async function getActivityLog(filters?: GetActivityLogFilters): Promise<HrActivityLogEntry[]> {
  let query = supabase.from("hr_activity_log").select(SELECT).order("created_at", { ascending: false });
  if (filters?.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters?.action) query = query.eq("action", filters.action);
  if (filters?.from) query = query.gte("created_at", filters.from);
  if (filters?.to) query = query.lt("created_at", filters.to);
  query = query.limit(filters?.limit ?? 500);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  let rows = (data ?? []).map(mapRow);
  if (filters?.search) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.actorName ?? "").toLowerCase().includes(q) ||
        (r.targetLabel ?? "").toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q)
    );
  }
  return rows;
}
