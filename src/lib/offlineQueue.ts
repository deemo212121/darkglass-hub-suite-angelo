/**
 * Offline action queue for the mobile technician app — On-Site Check-In
 * ("I'm Here"/"I'm Done") and Visit Log saves. When a write fails (offline,
 * or any transient network error — the two look identical from here), the
 * caller enqueues it here instead of just alerting and giving up; drainQueue
 * replays every queued row once back online.
 *
 * A separate Dexie database from src/lib/db.ts's AHSDatabase on purpose —
 * that one is unrelated legacy dummy/demo data for a handful of never-
 * fully-wired generic CRUD modules, not a real write path. Reuses the
 * `dexie` library already in package.json rather than adding a second one.
 */
import { useEffect, useState } from "react";
import Dexie, { type Table } from "dexie";
import { addTicketComment } from "@/lib/supabase/comments";
import { setTicketOnsiteCheckIn, updateTicketVisit } from "@/lib/supabase/tickets";
import type { UIVisit } from "@/lib/supabase/tickets";

export type QueuedActionType = "onsite_checkin" | "visit_save";

export interface OnsiteCheckinPayload {
  ticketNo: string;
  event: "arrived" | "done";
  at: string;
  commentBody: string;
  authorName: string;
  authorRole: string;
}

export interface VisitSavePayload {
  visitId: string;
  visit: Partial<UIVisit>;
}

export interface QueuedAction {
  id?: number;
  type: QueuedActionType;
  payload: OnsiteCheckinPayload | VisitSavePayload;
  createdAt: string;
  status: "pending" | "failed";
  lastError?: string;
}

class OfflineQueueDatabase extends Dexie {
  queuedActions!: Table<QueuedAction, number>;

  constructor() {
    super("AHSOfflineQueue");
    this.version(1).stores({
      queuedActions: "++id, type, status, createdAt",
    });
  }
}

const db = new OfflineQueueDatabase();

export async function enqueueOnsiteCheckin(payload: OnsiteCheckinPayload): Promise<void> {
  await db.queuedActions.add({
    type: "onsite_checkin",
    payload,
    createdAt: new Date().toISOString(),
    status: "pending",
  });
}

export async function enqueueVisitSave(payload: VisitSavePayload): Promise<void> {
  await db.queuedActions.add({
    type: "visit_save",
    payload,
    createdAt: new Date().toISOString(),
    status: "pending",
  });
}

/** Live count of everything still waiting to sync — drives the "Pending sync" badge. */
export async function pendingQueueCount(): Promise<number> {
  return db.queuedActions.count();
}

async function replay(action: QueuedAction): Promise<void> {
  if (action.type === "onsite_checkin") {
    const p = action.payload as OnsiteCheckinPayload;
    await Promise.all([
      addTicketComment(p.ticketNo, p.commentBody, p.authorName, p.authorRole),
      setTicketOnsiteCheckIn(p.ticketNo, p.event, p.at),
    ]);
  } else {
    const p = action.payload as VisitSavePayload;
    await updateTicketVisit(p.visitId, p.visit);
  }
}

let draining = false;

/**
 * Replays every queued row, oldest first. Safe to call from multiple
 * triggers (online event, periodic interval, on-mount) at once — the
 * `draining` guard makes overlapping calls a no-op rather than double-
 * sending the same queued writes.
 */
export async function drainQueue(): Promise<void> {
  if (draining) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  draining = true;
  try {
    const rows = await db.queuedActions.orderBy("createdAt").toArray();
    for (const row of rows) {
      if (row.id === undefined) continue;
      try {
        await replay(row);
        await db.queuedActions.delete(row.id);
      } catch (err) {
        console.warn("[offlineQueue] replay failed, staying queued:", err);
        await db.queuedActions.update(row.id, {
          status: "failed",
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    draining = false;
  }
}

/**
 * Wires up the whole "auto-sync when back online" behavior for the mobile
 * app: drains once on mount (covers "was online the whole time but a
 * previous attempt silently failed"), on every browser `online` event, and
 * on a periodic fallback interval (mobile Safari's `online` event is known
 * to be unreliable — this is the safety net for a missed firing). Returns
 * a live pending-item count for the "Pending sync" badge.
 */
export function useOfflineQueueSync(pollMs = 15_000): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      pendingQueueCount().then((n) => {
        if (!cancelled) setCount(n);
      });
    };

    const sync = async () => {
      await drainQueue();
      refresh();
    };

    void sync();
    refresh();

    window.addEventListener("online", sync);
    const interval = window.setInterval(sync, pollMs);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
      window.clearInterval(interval);
    };
  }, [pollMs]);

  return count;
}
