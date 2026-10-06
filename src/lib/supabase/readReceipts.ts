/**
 * Read receipts for direct messages — Sent / Delivered / Seen — shared by
 * the Team Messenger page, the floating messenger and the header drop-down.
 *
 *  - Sent: the message is saved.
 *  - Delivered: the other person has had the app open since it was sent
 *    (their presence heartbeat, profiles.presence_seen_at, is newer).
 *  - Seen: they've opened the conversation since it was sent (their
 *    message_reads.last_read_at for the thread is newer) — shown with the time.
 *
 * message_reads is readable company-wide (0001_init.sql), so no migration is
 * needed. It isn't on the realtime feed, so an open conversation re-checks
 * every few seconds (useDmReceipt) — and both sides mark a thread read the
 * moment a message lands in an open conversation, so Seen appears quickly.
 */
import { useEffect, useState } from "react";
import { supabase } from "./client";

export type ReceiptStatus = "sent" | "delivered" | "seen";

export interface DmReceiptState {
  /** When the other person last opened this conversation. */
  otherReadAt: string | null;
  /** When the other person's app last checked in (presence heartbeat). */
  otherOnlineAt: string | null;
}

export function receiptFor(sentAt: string, state: DmReceiptState | null | undefined): ReceiptStatus {
  if (!state) return "sent";
  if (state.otherReadAt && state.otherReadAt >= sentAt) return "seen";
  if (state.otherOnlineAt && state.otherOnlineAt >= sentAt) return "delivered";
  return "sent";
}

export const RECEIPT_LABEL: Record<ReceiptStatus, string> = { sent: "Sent", delivered: "Delivered", seen: "Seen" };

/** The other person's read pointer + presence for each DM thread, in two queries. */
export async function getDmReceipts(threads: { threadId: string; otherProfileId: string }[]): Promise<Map<string, DmReceiptState>> {
  const out = new Map<string, DmReceiptState>();
  if (threads.length === 0) return out;
  const threadIds = threads.map((t) => t.threadId);
  const otherIds = Array.from(new Set(threads.map((t) => t.otherProfileId)));
  const [readsRes, presenceRes] = await Promise.all([
    supabase.from("message_reads").select("profile_id, dm_thread_id, last_read_at").in("dm_thread_id", threadIds).in("profile_id", otherIds),
    supabase.from("profiles").select("id, presence_seen_at").in("id", otherIds),
  ]);
  const readAt = new Map<string, string>();
  for (const r of readsRes.data ?? []) readAt.set(`${r.dm_thread_id}|${r.profile_id}`, r.last_read_at as string);
  const onlineAt = new Map<string, string | null>((presenceRes.data ?? []).map((p) => [p.id as string, (p.presence_seen_at as string | null) ?? null]));
  for (const t of threads) {
    out.set(t.threadId, { otherReadAt: readAt.get(`${t.threadId}|${t.otherProfileId}`) ?? null, otherOnlineAt: onlineAt.get(t.otherProfileId) ?? null });
  }
  return out;
}

const POLL_MS = 5000;

/**
 * Live receipt state for one open DM. Re-checks every few seconds while the
 * tab is visible, and right away when `bump` changes (e.g. a new message).
 */
export function useDmReceipt(threadId: string | null | undefined, otherProfileId: string | null | undefined, bump?: unknown): DmReceiptState | null {
  const [state, setState] = useState<DmReceiptState | null>(null);
  useEffect(() => {
    setState(null);
    if (!threadId || !otherProfileId) return;
    let alive = true;
    const load = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      getDmReceipts([{ threadId, otherProfileId }])
        .then((m) => alive && setState(m.get(threadId) ?? null))
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [threadId, otherProfileId, bump]);
  return state;
}

/** "Seen 3:25 PM", "Seen Mon", "Delivered", "Sent". */
export function receiptText(status: ReceiptStatus, state: DmReceiptState | null | undefined): string {
  if (status !== "seen" || !state?.otherReadAt) return RECEIPT_LABEL[status];
  const d = new Date(state.otherReadAt);
  const today = new Date().toDateString() === d.toDateString();
  return `Seen ${today ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
