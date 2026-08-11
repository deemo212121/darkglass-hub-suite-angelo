/**
 * Online/Idle/Offline presence (migration 0163) — shared by every page
 * that shows it (Team Messenger, Attendance Monitoring; deliberately NOT
 * Master List, which doesn't need it). Works off the raw snake_case
 * shape already present on ProfileRow (getCompanyUsers() populates
 * presence_seen_at/presence_active_at for free — see users.ts), so any
 * ProfileRow can be passed straight in with no mapping.
 *
 * presence_seen_at is a heartbeat written every ~60s while the app is
 * open, regardless of activity. presence_active_at only moves on real
 * interaction (see usePresenceHeartbeat in lib/auth.tsx). A stale
 * heartbeat means the tab isn't open at all (Offline); a fresh heartbeat
 * but a stale activity timestamp means it's open but untouched (Idle).
 */
const PRESENCE_OFFLINE_AFTER_MS = 3 * 60 * 1000;
const PRESENCE_IDLE_AFTER_MS = 10 * 60 * 1000;

export type PresenceStatus = "online" | "idle" | "offline";

export function resolvePresenceStatus(p: { presence_seen_at?: string | null; presence_active_at?: string | null }): PresenceStatus {
  const seenAt = p.presence_seen_at ? new Date(p.presence_seen_at).getTime() : null;
  if (seenAt === null || Date.now() - seenAt > PRESENCE_OFFLINE_AFTER_MS) return "offline";
  const activeAt = p.presence_active_at ? new Date(p.presence_active_at).getTime() : null;
  if (activeAt === null || Date.now() - activeAt > PRESENCE_IDLE_AFTER_MS) return "idle";
  return "online";
}

export const PRESENCE_LABEL: Record<PresenceStatus, string> = { online: "Online", idle: "Idle", offline: "Offline" };
export const PRESENCE_DOT_CLASS: Record<PresenceStatus, string> = {
  online: "bg-emerald-400",
  idle: "bg-yellow-400",
  offline: "bg-slate-500",
};
