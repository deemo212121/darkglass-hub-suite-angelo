/**
 * Per-company overrides for which role(s) get notified by each of the
 * app's role-configurable notification triggers — see migration 0171
 * (notification_role_gates), same shape/semantics as
 * module_role_gate_overrides (moduleRoleGates.ts): a trigger with no
 * override rows falls back to its own hardcoded defaultRoles below, and
 * editing a trigger always replaces its whole allowed-role set, never a
 * partial diff.
 *
 * Scope is deliberately limited to notifications that are genuinely
 * "which role should hear about this" in nature — not every notification
 * in the app fits that shape. Some go to named individuals (e.g. the
 * unauthorized-part-edit alert on the ticket page) or back to whoever
 * originally requested something (Truck Stock approve/reject/received) —
 * those aren't role-configurable and aren't listed here.
 */
import { supabase } from "./client";

export interface NotificationTrigger {
  key: string;
  label: string;
  description: string;
  defaultRoles: string[];
}

export const NOTIFICATION_TRIGGERS: NotificationTrigger[] = [
  {
    key: "parts_restock",
    label: "Part Restock Notice",
    description: "Sent when a Daily Collection entry is marked \"Restock\" — a part is back in stock.",
    defaultRoles: ["PARTS_MANAGER"],
  },
  {
    key: "parts_cross_inventory",
    label: "Cross-Branch Inventory Request",
    description: "Sent when someone uses a part from another branch's inventory.",
    defaultRoles: ["PARTS_MANAGER"],
  },
  {
    key: "parts_done_digest",
    label: "Parts \"Done\" Branch Digest",
    description: "Sent when the Parts hub's Done button reports a branch's Collections/Pickup/Received progress.",
    defaultRoles: ["PARTS_MANAGER"],
  },
  {
    key: "truck_stock_approver",
    label: "Truck Stock Approval Request",
    description: "Who gets notified about a new Truck Stock pull/transfer request for their branch.",
    defaultRoles: ["PARTS_MANAGER", "ADMIN", "SUPERADMIN"],
  },
  {
    key: "jotform_submission_hr",
    label: "Custom Form Submission (HR)",
    description:
      "Sent when any custom (Jotform) form gets a submission. Note: who can see the Jotform Submissions tab on the HR Dashboard is a separate hardcoded check (isJotformHrRole in roleLabels.ts), kept in sync with this list by default — widening/narrowing this can let someone get notified without being able to open the tab, or vice versa.",
    defaultRoles: ["HR", "ADMIN", "SUPERADMIN", "MANAGER", "SENIOR_MANAGER"],
  },
];

export async function getNotificationRoleGateOverrides(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from("notification_role_gates").select("trigger_key, role");
  if (error) {
    console.error("getNotificationRoleGateOverrides error:", error.message);
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const row of data ?? []) {
    (out[row.trigger_key] ??= []).push(row.role);
  }
  return out;
}

/** Replaces the complete allowed-role set for one trigger. Admin/SuperAdmin only — enforced by RLS. */
export async function setNotificationRoleGateOverride(triggerKey: string, allowedRoles: string[]): Promise<void> {
  const { error: deleteError } = await supabase.from("notification_role_gates").delete().eq("trigger_key", triggerKey);
  if (deleteError) throw new Error(deleteError.message);
  if (allowedRoles.length === 0) return;
  const { error: insertError } = await supabase
    .from("notification_role_gates")
    .insert(allowedRoles.map((role) => ({ trigger_key: triggerKey, role })));
  if (insertError) throw new Error(insertError.message);
}

/** Effective role list for one trigger — its override if it has any rows, else its hardcoded default. */
export async function getEffectiveNotificationRoles(triggerKey: string): Promise<string[]> {
  const overrides = await getNotificationRoleGateOverrides();
  if (overrides[triggerKey]) return overrides[triggerKey];
  return NOTIFICATION_TRIGGERS.find((t) => t.key === triggerKey)?.defaultRoles ?? [];
}
