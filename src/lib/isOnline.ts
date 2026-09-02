/**
 * Shared "are we online right now" signal for the mobile app — a module-
 * level singleton (not a Context, since there's no external writer to share,
 * just poll/listener state) so every mounted consumer (header pill, anything
 * else that wants it) shares one 15s reachability poll instead of each
 * starting its own.
 *
 * navigator.onLine alone is known-unreliable, especially on Safari/iOS (see
 * offlineQueue.ts's own comments on the same issue) — it can read "online"
 * while the device actually has no real connectivity, or miss the "offline"
 * transition entirely. So this combines three signals: navigator.onLine as
 * a cheap initial guess, the browser's online/offline events for a fast
 * reaction when they do fire correctly, and a periodic real reachability
 * check (a same-origin fetch, cheap, no Supabase quota cost) that overrides
 * a stale navigator.onLine reading — that poll result is authoritative.
 *
 * Deliberately independent from offlineQueue.ts's own 15s drain timer —
 * not unified with it in this pass; two small independent intervals is an
 * acceptable simple cost.
 */
import { useSyncExternalStore } from "react";

const POLL_MS = 15_000;
const POLL_TIMEOUT_MS = 5_000;

let online = typeof navigator === "undefined" ? true : navigator.onLine;
// Dev/QA-only simulator (see the header's "Offline Mode" menu item, gated
// behind import.meta.env.DEV) for testing the offline flow on a real
// connection without needing to actually kill wifi/data. When on, this
// isn't just a display flag — every write call site (see MobileTechApp.tsx's
// send/persist/on-site check-in) checks isManualOfflineModeActive() BEFORE
// attempting its real Supabase call and skips straight to the offline-queue
// path if it's true, and drainQueue() (offlineQueue.ts) refuses to sync
// while it's on — so queued items genuinely stay queued, a full simulation
// of a real outage rather than just a UI label. Independent of (and wins
// over) the detected `online` state above.
let manualOffline = false;
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let onlineHandler: (() => void) | null = null;
let offlineHandler: (() => void) | null = null;

function setOnline(next: boolean) {
  if (online === next) return;
  online = next;
  for (const l of listeners) l();
}

async function pollReachability() {
  try {
    const res = await fetch("/api/server-time", { cache: "no-store", signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
    setOnline(res.ok);
  } catch {
    setOnline(false);
  }
}

function start() {
  if (typeof window === "undefined") return;
  online = navigator.onLine;
  onlineHandler = () => setOnline(true);
  offlineHandler = () => setOnline(false);
  window.addEventListener("online", onlineHandler);
  window.addEventListener("offline", offlineHandler);
  void pollReachability();
  intervalId = setInterval(pollReachability, POLL_MS);
}

function stop() {
  if (typeof window === "undefined") return;
  if (onlineHandler) window.removeEventListener("online", onlineHandler);
  if (offlineHandler) window.removeEventListener("offline", offlineHandler);
  onlineHandler = null;
  offlineHandler = null;
  if (intervalId !== null) clearInterval(intervalId);
  intervalId = null;
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): boolean {
  return manualOffline ? false : online;
}

/** True when the app believes it has real connectivity (or the technician hasn't manually forced offline mode) — false shows the mobile header's offline pill and routes writes to the queue. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

/** True while the technician has manually forced offline mode on — independent of (and overrides) detected connectivity. */
export function useManualOfflineMode(): boolean {
  return useSyncExternalStore(subscribe, () => manualOffline, () => false);
}

/** Toggles the dev/QA offline simulator. */
export function setManualOfflineMode(forced: boolean): void {
  if (manualOffline === forced) return;
  manualOffline = forced;
  for (const l of listeners) l();
}

/** Plain (non-hook) read for use inside async handlers/non-component code — write call sites and drainQueue check this before touching the network. */
export function isManualOfflineModeActive(): boolean {
  return manualOffline;
}
