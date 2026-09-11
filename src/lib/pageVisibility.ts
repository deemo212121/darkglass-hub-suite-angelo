/**
 * Shared "is this tab actually being looked at" signal for gating
 * freshness-polling setIntervals — plain functions, not a hook/Context,
 * since every consumer here is an interval callback inside a useEffect,
 * not something that needs a re-render. Mirrors isOnline.ts's shape.
 *
 * Motivation: this app is commonly left open in 2-3 tabs by the same
 * person. Every tab's fallback polls (Team Messenger's 2s peek, the
 * Messages menu's 20s peek, etc.) used to keep firing at full cadence even
 * while backgrounded, multiplying real Supabase query load for updates
 * nobody was looking at — see the doc comments on those polls themselves
 * for the query-cost history that made this worth fixing.
 */

/** True unless the tab is hidden/backgrounded/minimized. */
export function isTabVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Fires `callback` once whenever the tab transitions TO visible (not on
 * hide) — the "catch up immediately" half of isTabVisible() above, so
 * switching back to a backgrounded tab refreshes right away instead of
 * waiting out the rest of its poll interval. Returns an unsubscribe
 * function for cleanup in a useEffect.
 */
export function onTabVisible(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (document.visibilityState === "visible") callback();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
