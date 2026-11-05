/**
 * "Remind" bell for anything still waiting on someone's approval — Time
 * Corrections, PTO / Leave requests and Ticket Time Disputes. Sends a bell
 * notification to whoever holds each pending step:
 *   manager    → the manager the request was routed to (managerId) while that
 *                account is active, else the requester's current Manager
 *                (profiles.manager_name, matched to an active account);
 *   hr         → every active HR role holder;
 *   accounting → every active Finance role holder.
 * The sender never notifies themselves. Each reminder is logged in Activity
 * Logs. Truck Stock has its own approvers (a branch's Parts Manager) — see
 * remindTruckStockApprovers in truckStockNotify.ts.
 */
import { findPersonByName } from "@/lib/personName";
import { withIncludedRoles } from "@/lib/roleLabels";
import { createNotification } from "./notifications";
import { getCompanyUsers, type ProfileRow } from "./users";
import { logModuleActivity, type ActivityLogModule } from "./moduleActivityLog";

export type ReminderStage = "manager" | "hr" | "accounting";

export const REMINDER_STAGE_LABEL: Record<ReminderStage, string> = { manager: "Manager", hr: "HR", accounting: "Accounting" };

const STAGE_ROLE: Record<Exclude<ReminderStage, "manager">, string> = { hr: "HR", accounting: "FINANCE" };

/** Holds `wanted`, primary or extra, or a role that includes it (an Accounting Manager holds Finance). */
function holdsRole(role: string | null | undefined, extraRoles: readonly (string | null)[] | null | undefined, wanted: string): boolean {
  return withIncludedRoles([role, ...(extraRoles ?? [])]).includes(wanted);
}

/**
 * The pending steps this viewer would remind — never their own: the manager
 * step is skipped when the viewer IS that manager, HR when they hold HR,
 * Accounting when they hold Finance (they'd just act on it instead).
 */
export function remindableStages(
  pending: readonly ReminderStage[],
  viewer: { id: string | null; role: string | null | undefined; extraRoles?: readonly (string | null)[] | null },
  managerId: string | null | undefined
): ReminderStage[] {
  if (!viewer.id) return [];
  return pending.filter((s) => {
    if (s === "manager") return !managerId || managerId !== viewer.id;
    return !holdsRole(viewer.role, viewer.extraRoles, STAGE_ROLE[s]);
  });
}

/** The steps still pending on a staged request (none once the request itself is decided). */
export function pendingStagesOf(r: { status: string; managerStatus: string; hrStatus: string; accountingStatus: string }): ReminderStage[] {
  if (r.status !== "pending") return [];
  const out: ReminderStage[] = [];
  if (r.managerStatus === "pending") out.push("manager");
  if (r.hrStatus === "pending") out.push("hr");
  if (r.accountingStatus === "pending") out.push("accounting");
  return out;
}

/** "Remind Manager · HR" — the button label for these steps. */
export function remindLabel(stages: readonly ReminderStage[]): string {
  return `Remind ${stages.map((s) => REMINDER_STAGE_LABEL[s]).join(" · ")}`;
}

/** The requester's manager as an active account: the routed managerId first, else their current Manager by name. */
export function resolveRequesterManager<T extends Pick<ProfileRow, "id" | "display_name" | "is_active" | "manager_name">>(
  requesterId: string,
  managerId: string | null | undefined,
  roster: readonly T[]
): T | null {
  const active = roster.filter((p) => p.is_active);
  const routed = managerId ? active.find((p) => p.id === managerId) : undefined;
  if (routed) return routed;
  const requester = roster.find((p) => p.id === requesterId);
  return requester?.manager_name ? findPersonByName(requester.manager_name, active) : null;
}

export async function sendApprovalReminder(input: {
  stages: readonly ReminderStage[];
  requesterId: string;
  managerId?: string | null;
  /** What's waiting, after "<name>'s" — e.g. "time correction for 2026-11-02 (submitted Nov 3)". */
  what: string;
  linkTo: string;
  senderId: string;
  senderName: string;
  log: { module: ActivityLogModule; targetType: string; targetId: string };
}): Promise<string> {
  const roster = await getCompanyUsers();
  const requesterName = roster.find((p) => p.id === input.requesterId)?.display_name || "An employee";
  // recipient id → the steps they're being reminded about
  const steps = new Map<string, { person: ProfileRow; stages: ReminderStage[] }>();
  const add = (person: ProfileRow, stage: ReminderStage) => {
    if (person.id === input.senderId) return;
    const cur = steps.get(person.id) ?? { person, stages: [] };
    if (!cur.stages.includes(stage)) cur.stages.push(stage);
    steps.set(person.id, cur);
  };
  const summary: string[] = [];
  const missing: string[] = [];
  for (const stage of input.stages) {
    if (stage === "manager") {
      const manager = resolveRequesterManager(input.requesterId, input.managerId, roster);
      if (manager && manager.id !== input.senderId) {
        add(manager, "manager");
        summary.push(`${manager.display_name || "the manager"} (Manager)`);
      } else if (!manager) missing.push("no active manager on file");
    } else {
      const holders = roster.filter((p) => p.is_active && p.id !== input.senderId && holdsRole(p.role, p.extra_roles, STAGE_ROLE[stage]));
      holders.forEach((p) => add(p, stage));
      if (holders.length > 0) summary.push(`${REMINDER_STAGE_LABEL[stage]} (${holders.length})`);
      else missing.push(`nobody active in ${REMINDER_STAGE_LABEL[stage]}`);
    }
  }
  if (steps.size === 0) throw new Error(`Nobody to remind — ${missing.join(", ") || "no pending step"}.`);
  await Promise.all(
    [...steps.values()].map(({ person, stages }) => {
      const whose = stages.includes("manager") ? "your approval" : `${stages.map((s) => REMINDER_STAGE_LABEL[s]).join(" / ")} approval`;
      return createNotification({
        recipientId: person.id,
        senderId: input.senderId,
        senderName: input.senderName,
        body: `🔔 Reminder: ${requesterName}'s ${input.what} is still waiting on ${whose}.`,
        linkTo: input.linkTo,
      });
    })
  );
  void logModuleActivity({
    module: input.log.module,
    actorName: input.senderName,
    action: "approval_reminder_sent",
    targetType: input.log.targetType,
    targetId: input.log.targetId,
    targetLabel: `${requesterName} — ${input.what}`,
    details: { stages: input.stages, sentTo: summary },
  });
  return `Reminder sent to ${summary.join(", ")}${missing.length ? ` — ${missing.join(", ")}` : ""}`;
}
