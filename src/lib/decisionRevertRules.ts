/**
 * Who can revert a decision, and what a multi-step record's status becomes. The
 * database functions (migration 0429) enforce the same rule, so this only
 * decides which buttons to show and what the popup tells the person.
 */

export type RevertRecordType = "pto_request" | "ticket_time_dispute" | "timecard_correction";
export type RevertStage = "manager" | "hr" | "accounting";
type StageDecision = "pending" | "approved" | "rejected";

export const REVERT_STAGE_LABEL: Record<RevertStage, string> = { manager: "Manager", hr: "HR", accounting: "Accounting" };
export const REVERT_RECORD_LABEL: Record<RevertRecordType, string> = { pto_request: "Time-Off", ticket_time_dispute: "Ticket Dispute", timecard_correction: "Time Correction" };

const normalize = (role: string | null | undefined) => (role ?? "").trim().toUpperCase().replace(/\s+/g, "_");

export const isRevertSuperAdmin = (roles: readonly (string | null | undefined)[]) =>
  roles.some((r) => normalize(r) === "SUPERADMIN" || normalize(r) === "SUPERSUPERADMIN");

/** The person who made the decision, or a Super Admin. */
export function canRevertDecision(decidedBy: string | null | undefined, myProfileId: string | null | undefined, isSuperAdmin: boolean): boolean {
  return isSuperAdmin || (!!myProfileId && decidedBy === myProfileId);
}

/** Mirrors the Time-Off and Time Correction status triggers: any rejection rejects it, any two approvals approve it. */
export function statusAfterRevert(stages: Record<RevertStage, StageDecision>, stage: RevertStage): "pending" | "approved" | "rejected" {
  const after = { ...stages, [stage]: "pending" as const };
  const values = Object.values(after);
  if (values.includes("rejected")) return "rejected";
  return values.filter((v) => v === "approved").length >= 2 ? "approved" : "pending";
}
