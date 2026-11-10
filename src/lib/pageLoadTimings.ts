/**
 * Page Speed (migration 0433) — measures every page people open, in their own
 * browser, and saves it for AHS Server Status → Page Speed. The rules for
 * "shown" and "ready" are in pageLoadMeter.ts; this file wires them to the
 * real browser:
 *
 *   - page changes come from the router (onBeforeNavigate / onRendered);
 *   - a module page says when its own component has rendered (markPageShown);
 *   - requests are counted by wrapping fetch, but only the ones a page waits
 *     on: Supabase (/rest/v1, /storage/v1, /functions/v1, /auth/v1) and the
 *     app's own server (/api/). Firebase's long-lived connections aren't
 *     counted, or no page would ever look finished. Saving the timings
 *     themselves isn't counted either.
 *
 * Timings are only kept for someone signed in. They're saved in small
 * batches (every 30 seconds, or 10 at a time) and kept in this browser
 * between visits until saved — a page closed while loading is saved next
 * time. Signing out (or in as someone else) drops anything unsaved, so one
 * person's timings are never saved as another's.
 */
import type { AnyRouter } from "@tanstack/react-router";
import { PageLoadMeter, pagePath, deviceKind, type PageTiming } from "./pageLoadMeter";
import { insertPageTimings, isMissingTable, PAGE_TIMINGS_TABLE, type PageTimingRow } from "./supabase/pageLoadTimings";

export type PageSpeedEvent = { state: "measuring"; path: string | null } | { state: "done"; timing: PageTiming };

const MODULE_PAGE_ROUTE = "/m/$module/$submodule";
const QUEUE_KEY = "ahs:page-timings";
const FLUSH_EVERY_MS = 30_000;
const FLUSH_AT = 10;
const MAX_QUEUE = 200;
const SUPABASE_HOST = (() => {
  try {
    return new URL(String(import.meta.env.VITE_SUPABASE_URL ?? "")).host;
  } catch {
    return "";
  }
})();

let meter: PageLoadMeter | null = null;
let installed = false;
let fetchWrapped = false;
let lastMarkerAt: number | null = null;
let measuringPathname: string | null = null;
let lastRenderedPathname: string | null = null;
let ticking: ReturnType<typeof setInterval> | null = null;
let userId: string | null = null;
let queue: PageTimingRow[] = [];
let saving = false;
let unavailable = false;
let lastEvent: PageSpeedEvent | null = null;
const listeners = new Set<(e: PageSpeedEvent) => void>();

const now = () => performance.now();

function notify(e: PageSpeedEvent) {
  lastEvent = e;
  for (const l of listeners) l(e);
}

/** For the live badge: the page being measured, then its result. */
export function subscribePageSpeed(listener: (e: PageSpeedEvent) => void): () => void {
  listeners.add(listener);
  if (lastEvent) listener(lastEvent);
  return () => listeners.delete(listener);
}

/** A module page's own (lazily loaded) component has rendered — see m.$module.$submodule.tsx. */
export function markPageShown(): void {
  const t = now();
  lastMarkerAt = t;
  meter?.marker(t);
}

/** Should this request hold a page's "ready" back? */
export function isTrackedRequest(url: string, origin: string, supabaseHost: string = SUPABASE_HOST): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  if (u.pathname.includes(`/rest/v1/${PAGE_TIMINGS_TABLE}`)) return false;
  if (supabaseHost && u.host === supabaseHost) return /^\/(rest|storage|functions|auth)\/v1\//.test(u.pathname);
  return u.origin === new URL(origin).origin && u.pathname.startsWith("/api/");
}

function wrapFetch() {
  if (fetchWrapped || typeof window === "undefined" || typeof window.fetch !== "function") return;
  fetchWrapped = true;
  const original = window.fetch;
  const wrapped: typeof window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!meter || !isTrackedRequest(url, window.location.origin)) return original.call(this ?? window, input, init);
    const startedBy = meter.requestStarted();
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      meter?.requestEnded(now(), startedBy);
    };
    try {
      const p = original.call(this ?? window, input, init);
      p.then(end, end);
      return p;
    } catch (err) {
      end();
      throw err;
    }
  };
  window.fetch = wrapped;
}

function device(): Pick<PageTimingRow, "device" | "connection" | "memory_gb" | "cores" | "screen_width"> {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string }; deviceMemory?: number };
  const w = window.screen?.width ?? 0;
  const h = window.screen?.height ?? 0;
  return {
    device: deviceKind(nav.userAgent, nav.maxTouchPoints ?? 0, w, h),
    connection: nav.connection?.effectiveType?.slice(0, 20) ?? null,
    memory_gb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    screen_width: w ? Math.min(w, 20000) : null,
  };
}

function onTiming(t: PageTiming) {
  notify({ state: "done", timing: t });
  if (!userId || unavailable) return;
  const sha = (globalThis as { __GIT_SHA__?: string }).__GIT_SHA__;
  queue.push({
    path: t.path,
    first_load: t.firstLoad,
    shown_ms: Math.min(t.shownMs, 600000),
    ready_ms: t.readyMs === null ? null : Math.min(t.readyMs, 600000),
    left_after_ms: t.leftAfterMs === null ? null : Math.min(t.leftAfterMs, 600000),
    timed_out: t.timedOut,
    requests: Math.min(t.requests, 100000),
    git_sha: sha ? String(sha).slice(0, 64) : null,
    ...device(),
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  remember();
  if (queue.length >= FLUSH_AT) void flush();
}

function remember() {
  try {
    if (queue.length && userId) localStorage.setItem(QUEUE_KEY, JSON.stringify({ userId, rows: queue }));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* storage blocked: they're just saved from memory */
  }
}

async function flush() {
  if (saving || unavailable || !userId || queue.length === 0) return;
  saving = true;
  const batch = queue.slice(0, 50);
  try {
    await insertPageTimings(batch);
    queue = queue.slice(batch.length);
    remember();
  } catch (err) {
    // Migration 0433 not run yet: stop measuring-to-save for this visit instead of retrying forever.
    if (isMissingTable(err instanceof Error ? err.message : String(err))) {
      unavailable = true;
      queue = [];
      remember();
    }
  } finally {
    saving = false;
  }
}

/** Who's signed in. Changing person drops anything unsaved from the one before. */
export function setPageSpeedUser(uid: string | null) {
  if (uid === userId) return;
  if (userId !== null) queue = [];
  userId = uid;
  if (uid) {
    try {
      const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) || "null");
      if (saved && saved.userId === uid && Array.isArray(saved.rows)) queue = [...saved.rows, ...queue].slice(-MAX_QUEUE);
    } catch {
      /* nothing saved */
    }
  }
  remember();
  if (uid) void flush();
}

function ensureTicking() {
  if (ticking || !meter) return;
  ticking = setInterval(() => {
    meter?.tick(now());
    if (!meter?.active && ticking) {
      clearInterval(ticking);
      ticking = null;
    }
  }, 150);
}

function currentPage(router: AnyRouter): { path: string; pathname: string; isModulePage: boolean } {
  const state = router.state;
  const match = state.matches[state.matches.length - 1];
  const pathname = state.location.pathname;
  return {
    path: pagePath(match?.routeId, (match?.params ?? {}) as Record<string, unknown>, (state.location.search ?? {}) as Record<string, unknown>, pathname),
    pathname,
    isModulePage: match?.routeId === MODULE_PAGE_ROUTE,
  };
}

/** Starts measuring. Returns a stop function; starting again after it (React's development double-mount) is fine. */
export function installPageLoadTracking(router: AnyRouter): () => void {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;
  wrapFetch();
  meter = new PageLoadMeter(onTiming);

  // The page this full load opened on: timed from the browser's own start.
  meter.firstLoad();
  const first = currentPage(router);
  measuringPathname = first.pathname;
  lastRenderedPathname = first.pathname;
  notify({ state: "measuring", path: first.path });
  meter.rendered(now(), first.path, first.isModulePage);
  if (lastMarkerAt !== null) meter.marker(lastMarkerAt);
  ensureTicking();

  const stopNavigate = router.subscribe("onBeforeNavigate", (e: { toLocation: { pathname: string } }) => {
    // Same address still loading (a page adding ?tab= to itself): the same load.
    if (meter?.active && e.toLocation.pathname === measuringPathname) return;
    meter?.navigate(now());
    measuringPathname = e.toLocation.pathname;
    notify({ state: "measuring", path: null });
    ensureTicking();
  });
  const stopRendered = router.subscribe("onRendered", () => {
    const page = currentPage(router);
    const newPage = page.pathname !== lastRenderedPathname;
    lastRenderedPathname = page.pathname;
    meter?.rendered(now(), page.path, page.isModulePage && newPage);
  });
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      meter?.hidden();
      remember();
      void flush();
    }
  };
  const onPageHide = () => {
    meter?.leave(now());
    remember();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  const flusher = setInterval(() => void flush(), FLUSH_EVERY_MS);

  return () => {
    stopNavigate();
    stopRendered();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    clearInterval(flusher);
    if (ticking) clearInterval(ticking);
    ticking = null;
    meter = null;
    installed = false;
  };
}
