/**
 * Truck Stock — usage notifications for the Parts Manager.
 *
 * When a Triage or Parts (non-manager) user pulls inventory from the
 * Truck Stock, the Parts Manager should hear about it so they can
 * keep the field stock topped up. Admins / Parts Managers /
 * Naveen / Ian / Tina are also looped in for visibility.
 *
 * This is a thin wrapper on top of the existing Firestore notification
 * helpers in `src/lib/firebase/notifications.ts`. Fire-and-forget by
 * design — the caller never awaits and we never throw.
 */

import type { NotifKind } from "./firebase/notifications";

/**
 * Canonical UserRole codes that should trigger a "truck stock pulled"
 * notification when they confirm the Truck Stock modal. Parts Manager,
 * Admin, Manager and Claims (and anyone above) don't trigger because
 * they're either the notification target or already privileged.
 */
const TRIGGERING_ROLE_CODES = new Set<string>([
  "TRIAGE_USER",
  "TRIAGE_MANAGER",
  "PARTS",
]);

/**
 * Returns true when the actor's role (primary + extras) is one we want
 * to notify the Parts Manager about. Case-insensitive on the input.
 */
export function shouldNotifyOnTruckStockUse(
  primaryRole: string | null | undefined,
  extraRoles: string[] | null | undefined,
): boolean {
  const all = [primaryRole, ...(extraRoles ?? [])]
    .map((r) => String(r ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (all.length === 0) return false;
  // If the user already holds a Parts Manager / Admin / Manager role
  // we don't need to ping the parts manager — they ARE the audience.
  const PRIVILEGED = new Set([
    "PARTS_MANAGER",
    "ADMIN",
    "SUPERADMIN",
    "MANAGER",
    "BIZOPS_MANAGER",
    "BIZOPS_SENIOR_MANAGER",
    "BRANCH_MANAGER",
    "SENIOR_BRANCH_MANAGER",
  ]);
  if (all.some((r) => PRIVILEGED.has(r))) return false;
  return all.some((r) => TRIGGERING_ROLE_CODES.has(r));
}

export interface TruckStockUsagePayload {
  /** Display name of the user pulling the stock. */
  actorName: string;
  /** Email of the user pulling the stock (fallback when actorName blank). */
  actorEmail: string;
  /** Canonical UserRole code of the user pulling the stock. */
  actorRole: string;
  /** The work order this stock is being pulled for. */
  ticketNo: string;
  /** Branch (truck stock owner) the parts were drawn from. */
  branch: string;
  /** One line per part: "PARTNO ×2 (Birmingham)" etc. */
  items: Array<{ partNo: string; qty: number; branch: string; storageLocation?: string }>;
  /** Company id used to scope the Firestore notification lookup. */
  companyId: string;
}

/** Roles that should receive a truck-stock-usage alert in addition to named users. */
const ALERT_ROLES = ["Parts Manager", "Admin", "Manager"];
/** Named users always copied (parts ops leadership). */
const ALERT_USERS = ["Naveen", "Ian", "Tina"];

/**
 * Send the in-app notification. Fire-and-forget — never throws.
 */
export async function notifyPartsManagerOfTruckStockUse(
  payload: TruckStockUsagePayload,
): Promise<void> {
  try {
    if (!payload.companyId) return;
    const { sendNotificationToRole, sendNotificationToUsers } = await import(
      "./firebase/notifications"
    );
    const lines = payload.items.map(
      (i) =>
        `• ${i.partNo} ×${i.qty} from ${i.branch}${
          i.storageLocation ? ` @ ${i.storageLocation}` : ""
        }`,
    );
    const actorLabel = payload.actorName?.trim() || payload.actorEmail || "Unknown user";
    const body =
      `${actorLabel} (${payload.actorRole || "—"}) pulled from Truck Stock for ` +
      `ticket ${payload.ticketNo}:\n${lines.join("\n")}\n` +
      `Source branch: ${payload.branch}.`;
    const data = {
      kind: "system" as NotifKind,
      title: `Truck Stock used by ${actorLabel}`,
      body,
      ticketNo: payload.ticketNo,
      link: `/ticket/${payload.ticketNo}`,
    };
    await Promise.all([
      ...ALERT_ROLES.map((role) =>
        sendNotificationToRole(role, payload.companyId, data).catch((e) =>
          console.warn(`[truckStockNotify] role ${role} failed:`, e),
        ),
      ),
      sendNotificationToUsers(ALERT_USERS, payload.companyId, data).catch((e) =>
        console.warn("[truckStockNotify] users failed:", e),
      ),
    ]);
  } catch (err) {
    console.warn("[truckStockNotify] notification skipped:", err);
  }
}
