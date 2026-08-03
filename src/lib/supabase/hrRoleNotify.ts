/**
 * Fan-out helper for the "also notify HR" notification settings (see
 * companySettings.ts's getHrNotificationSettings / migration 0090). Warning
 * Form, COE, and W-8BEN/W-4/W-9 are otherwise strictly one-to-one DMs
 * between HR/the employee and whoever sent or is signing the document —
 * this is the opt-in broadcast layered on top, reusing the same Team
 * Messenger DM mechanism rather than a new channel.
 *
 * Recipients are whoever carries the HR role — as their primary `role` OR
 * as one of their `extra_roles` — so an Admin, Manager, or Technician can
 * be looped in just by tagging them with the HR secondary role, without
 * this helper needing its own separate "who's an Admin" concept.
 */
import { supabase } from "./client";
import { getOrCreateDmThread, sendMessage } from "./messaging";

async function getCompanyHrRoleProfileIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, extra_roles")
    .eq("is_active", true)
    .or("role.eq.HR,extra_roles.cs.{HR}");
  if (error) {
    console.error("getCompanyHrRoleProfileIds error:", error.message);
    return [];
  }
  return (data ?? []).map((p) => p.id as string);
}

/**
 * Sends `body` as a DM from `senderId` to every company user carrying the
 * HR role (primary or extra_roles) except anyone in `excludeIds` (whoever
 * already got their own direct DM for this same event). Best-effort per
 * recipient — one failed DM never blocks the rest, and the caller is
 * expected to fire this off without awaiting it (matches the rest of this
 * app's "notify" calls).
 */
export async function notifyHrRoleUsers(senderId: string, senderName: string, excludeIds: string[], body: string): Promise<void> {
  const hrIds = await getCompanyHrRoleProfileIds();
  const targets = hrIds.filter((id) => id !== senderId && !excludeIds.includes(id));
  await Promise.all(
    targets.map(async (hrId) => {
      try {
        const thread = await getOrCreateDmThread(senderId, hrId);
        await sendMessage({ dmThreadId: thread.id, senderId, senderName, body });
      } catch (err) {
        console.error("[notifyHrRoleUsers] failed to notify", hrId, err);
      }
    })
  );
}
