/**
 * Ticket audit-log action classification — the same real taxonomy Daily
 * Activity Report (DailyActivityPage.tsx) uses for its per-user columns,
 * shared here so lib-side aggregators (universalActivityLog.ts) can use
 * the identical classification without importing a page component. A
 * component-to-component import of this (e.g. Triage Daily Report's own
 * Activity panel) is fine — the split only matters for lib code, which
 * lives in a different Rollup chunk than src/components (see
 * vite.config.ts's manualChunks): a lib file importing from a component
 * creates a "vendor -> app-components" edge that, combined with the
 * existing "app-components -> tanstack -> app-components" one, produces
 * genuine circular chunks.
 */

import type { TicketAuditEntry } from "@/lib/supabase/tickets";

// Every audit action bucketed into exactly one of these, so a user's TOTAL
// always equals the sum of their columns (matches the reference report).
export type ActionBucket =
  | "schedule" | "reschedule" | "cancel" | "callAttempt" | "csrUpdate"
  | "infoUpdate" | "completed" | "acknowledge" | "claimRequested" | "triageSupport";

export const BUCKET_LABEL: Record<ActionBucket, string> = {
  schedule: "* SCHEDULE",
  reschedule: "RESCHEDULE",
  cancel: "CANCEL",
  callAttempt: "CALL ATTEMPT",
  csrUpdate: "CSR UPDATE",
  infoUpdate: "INFO. UPDATE",
  completed: "COMPLETED",
  acknowledge: "ACKNOWLEDGE",
  claimRequested: "CLAIM REQUESTED",
  triageSupport: "TRIAGE SUPPORT",
};
// One distinct color per action type, reused for both the per-user trend
// chart's lines and its legend/tooltip.
export const BUCKET_COLOR: Record<ActionBucket, string> = {
  schedule: "#3b82f6",
  reschedule: "#818cf8",
  cancel: "#ef4444",
  callAttempt: "#f59e0b",
  csrUpdate: "#34d399",
  infoUpdate: "#06b6d4",
  completed: "#22c55e",
  acknowledge: "#f472b6",
  claimRequested: "#a78bfa",
  triageSupport: "#fb923c",
};
export const BUCKET_ORDER: ActionBucket[] = [
  "schedule", "reschedule", "cancel", "callAttempt", "csrUpdate",
  "infoUpdate", "completed", "acknowledge", "claimRequested", "triageSupport",
];

// Classify a raw ticket_audit_log entry into one report column. `reschedule`
// actions split on before_value: no prior schedule_date means this is the
// first time the ticket was scheduled ("* SCHEDULE"); a prior value means an
// existing schedule is being moved ("RESCHEDULE"). status_change actions are
// bucketed off the new status's naming convention (CSR-/OP-/PT-/TR-/CL-
// prefixes, same taxonomy used everywhere else in this app). There is no
// tracked "call attempt" action anywhere in the schema, so that column has
// no live source and always reads 0 — kept in the table only so the layout
// matches the reference; it isn't fabricated.
export function classify(entry: TicketAuditEntry): ActionBucket {
  if (entry.action === "reschedule") {
    return entry.beforeValue ? "reschedule" : "schedule";
  }
  if (entry.action === "reassign") return "infoUpdate";
  const after = (entry.afterValue || "").toLowerCase();
  if (/cancel/.test(after)) return "cancel";
  if (/claim/.test(after)) return "claimRequested";
  if (/completed|data.?closed/.test(after)) return "completed";
  if (/acknowledged/.test(after)) return "acknowledge";
  if (/triage/.test(after)) return "triageSupport";
  if (after.startsWith("csr-")) return "csrUpdate";
  return "infoUpdate";
}
