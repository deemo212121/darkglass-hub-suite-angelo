/**
 * Offline action queue for the mobile technician app — On-Site Check-In
 * ("I'm Here"/"I'm Done"), Visit Log saves, ticket comments, and timecard
 * punches. When a write fails (offline, or any transient network error —
 * the two look identical from here), the caller enqueues it here instead of
 * just alerting and giving up; drainQueue replays every queued row once back
 * online. See src/lib/isOnline.ts for the app's shared "are we online right
 * now" signal — this file doesn't expose one of its own beyond the cheap
 * navigator.onLine early-out in drainQueue below.
 *
 * Also holds a small local cache of resolved ticket lat/lng (cacheTicketGeocode/
 * getCachedTicketGeocode) so the On-Site Check-In radius gate — pure
 * client-side math (haversineMiles in mapEngine.ts) — can keep working with
 * zero network once a technician's route has loaded for the day.
 *
 * And a generic fallback READ cache (cacheRead/getCachedRead — ticket list,
 * comments, on-site check-in status) so closing the app/tab while offline and
 * reopening it still has real data to render instead of a blank screen. This
 * one is a pure fallback: a real fetch is always tried first and always wins
 * when it succeeds; the cache is only read after that fetch has already
 * failed. See MobileTechApp.tsx's ticket-list/comments/check-in-status fetch
 * effects for the exact call sites.
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
import { saveEntry as saveTimecardEntry, type UITimeEntry } from "@/lib/supabase/timecards";
import { isManualOfflineModeActive } from "@/lib/isOnline";

export type QueuedActionType = "onsite_checkin" | "visit_save" | "ticket_comment" | "timecard_punch";

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

export interface TicketCommentPayload {
  ticketNo: string;
  body: string;
  authorName: string;
  authorRole: string;
}

export interface TimecardPunchPayload {
  scheduleProfileId: string;
  dateKey: string;
  entry: UITimeEntry;
}

export interface QueuedAction {
  id?: number;
  type: QueuedActionType;
  payload: OnsiteCheckinPayload | VisitSavePayload | TicketCommentPayload | TimecardPunchPayload;
  createdAt: string;
  status: "pending" | "failed";
  lastError?: string;
}

/** One cached lat/lng per ticket, resolved while online (RouteMapView/On-Site
 * Check-In's own geocodeAddress calls) so the check-in radius gate — pure
 * client-side math, see haversineMiles in mapEngine.ts — can still run with
 * zero network once a technician has loaded their route for the day, even if
 * they go fully offline afterward. Overwritten on every fresh resolve; never
 * expired by itself (a ticket's address doesn't move). */
export interface CachedTicketGeocode {
  ticketNo: string;
  lat: number;
  lng: number;
  approximate: boolean;
  cachedAt: string;
}

/** Generic key-value fallback cache for READ data (ticket list, comments,
 * on-site check-in status) — separate from the write-queue above, which is
 * for actions still waiting to happen. This is for data already fetched
 * successfully once, kept around so reopening the app while genuinely
 * offline (a closed tab, an OS-killed app) still has something to render
 * instead of a blank/stuck-loading screen. Always tried as a fallback only —
 * a real fetch, when one succeeds, wins and refreshes this. */
export interface CachedReadRow {
  key: string;
  value: unknown;
  cachedAt: string;
}

class OfflineQueueDatabase extends Dexie {
  queuedActions!: Table<QueuedAction, number>;
  ticketGeocodes!: Table<CachedTicketGeocode, string>;
  cachedReads!: Table<CachedReadRow, string>;

  constructor() {
    super("AHSOfflineQueue");
    this.version(1).stores({
      queuedActions: "++id, type, status, createdAt",
    });
    this.version(2).stores({
      queuedActions: "++id, type, status, createdAt",
      ticketGeocodes: "ticketNo",
    });
    this.version(3).stores({
      queuedActions: "++id, type, status, createdAt",
      ticketGeocodes: "ticketNo",
      cachedReads: "key",
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

export async function enqueueTicketComment(payload: TicketCommentPayload): Promise<void> {
  await db.queuedActions.add({
    type: "ticket_comment",
    payload,
    createdAt: new Date().toISOString(),
    status: "pending",
  });
}

export async function enqueueTimecardPunch(payload: TimecardPunchPayload): Promise<void> {
  await db.queuedActions.add({
    type: "timecard_punch",
    payload,
    createdAt: new Date().toISOString(),
    status: "pending",
  });
}

/** Persists a ticket's resolved address point for offline reuse — call this
 * every time geocodeAddress() successfully resolves one, same key (ticketNo)
 * overwriting any prior value. */
export async function cacheTicketGeocode(ticketNo: string, lat: number, lng: number, approximate: boolean): Promise<void> {
  await db.ticketGeocodes.put({ ticketNo, lat, lng, approximate, cachedAt: new Date().toISOString() });
}

/** Reads a previously cached ticket geocode, if any — works with zero network. */
export async function getCachedTicketGeocode(ticketNo: string): Promise<CachedTicketGeocode | undefined> {
  return db.ticketGeocodes.get(ticketNo);
}

/** Writes/overwrites a fallback read cache entry — call this on every SUCCESSFUL fetch of ticket lists, comments, or check-in status (see cachedReads' own doc comment above). */
export async function cacheRead(key: string, value: unknown): Promise<void> {
  await db.cachedReads.put({ key, value, cachedAt: new Date().toISOString() });
}

/** Reads a fallback cache entry, if any — only meant to be tried after a real fetch has already failed. */
export async function getCachedRead<T>(key: string): Promise<T | undefined> {
  const row = await db.cachedReads.get(key);
  return row?.value as T | undefined;
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
  } else if (action.type === "visit_save") {
    const p = action.payload as VisitSavePayload;
    await updateTicketVisit(p.visitId, p.visit);
  } else if (action.type === "ticket_comment") {
    const p = action.payload as TicketCommentPayload;
    await addTicketComment(p.ticketNo, p.body, p.authorName, p.authorRole);
  } else {
    const p = action.payload as TimecardPunchPayload;
    await saveTimecardEntry(p.scheduleProfileId, p.dateKey, p.entry);
  }
}

let draining = false;

/**
 * Replays every queued row, oldest first. Safe to call from multiple
 * triggers (online event, periodic interval, on-mount) at once — the
 * `draining` guard makes overlapping calls a no-op rather than double-
 * sending the same queued writes.
 *
 * Known limitation (deferred, not fixed here): a row that keeps failing
 * retries forever on every drain, with no backoff or max-attempt cutoff —
 * e.g. a queued write replayed after a long offline stretch whose auth
 * session has since expired will sit "failed" and keep retrying rather than
 * surfacing as a dead item needing manual attention.
 */
export async function drainQueue(): Promise<void> {
  if (draining) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  // Dev/QA offline simulator (isOnline.ts) — refuses to sync while it's on,
  // same as a real outage, so a tester can confirm queued items genuinely
  // stay queued instead of quietly draining over the still-real connection.
  if (isManualOfflineModeActive()) return;
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
