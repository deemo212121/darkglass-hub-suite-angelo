/**
 * After a deploy, every page's code file gets a new name and the old ones
 * are gone. A browser still running the version from before the deploy asks
 * for the old name, gets nothing back, and the page fails with "Failed to
 * fetch dynamically imported module: …/AccountingDashboard-DLAtC0wV.js".
 * Reloading once picks up the new version — done here automatically, at
 * most once a minute per tab, so a file that's really missing still shows
 * its error instead of reloading forever.
 */

const RELOADED_AT_KEY = "ahs:stale-chunk-reload-at";

/** A page's code file that couldn't be loaded — the stale-version case above. */
export function isStaleChunkError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk \S+ failed/i.test(message);
}

/** Reloads the page to get the new version; false (no reload) when it already did within the last minute. */
export function reloadForNewVersion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_AT_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    // No session storage (private mode, blocked): still reload, once per page load.
    const w = window as unknown as { __ahsStaleChunkReloaded?: boolean };
    if (w.__ahsStaleChunkReloaded) return false;
    w.__ahsStaleChunkReloaded = true;
  }
  window.location.reload();
  return true;
}

/** App-wide: Vite's own failed-preload event, and a stale file that fails outside any page's error screen. */
export function installStaleChunkReload(): () => void {
  if (typeof window === "undefined") return () => {};
  const onPreloadError = (event: Event) => {
    if (reloadForNewVersion()) event.preventDefault();
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isStaleChunkError(event.reason)) reloadForNewVersion();
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
