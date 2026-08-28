// Offline app shell for the mobile technician app ONLY — registered with
// scope "/mobile" by src/routes/mobile.tsx, nowhere else, so a desktop/
// admin session sharing this browser never gets one at all.
//
// Deliberately hand-written instead of using a build-time tool like
// vite-plugin-pwa/Workbox: this project's Cloudflare Workers build runs two
// separate Vite environment builds (client + ssr), and vite-plugin-pwa's
// generateSW step never fired against either output (confirmed empirically
// — no sw.js/workbox output anywhere in dist/, even with its debug logging
// on) — a real incompatibility with that setup, not a config mistake.
//
// Runtime caching instead of a precache manifest sidesteps the actual
// problem that would have needed solving anyway (JS/CSS filenames are
// content-hashed per build, so a static file can't list them up front):
// every GET response this SW sees while online gets cached as a side
// effect of normal use, so "reopen what was already loaded" works offline
// without any build-time asset-list injection at all.
//
// Writes (On-Site Check-In, Visit Log saves) are NOT this file's job —
// those go through the offline queue in src/lib/offlineQueue.ts, which is
// resilient by design regardless of whether this SW is even active.

const CACHE_NAME = "ahs-mobile-shell-v1";
const SHELL_URL = "/mobile";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only cache-manage same-origin GETs — writes and cross-origin requests
  // (Supabase, Firebase, etc.) pass straight through untouched.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (opening/reloading the app itself): network first, with
  // the cached shell as the offline fallback — always fall back to
  // SHELL_URL specifically, since /mobile is the only real document here
  // (every "screen" is an in-page view-state switch, not a separate URL).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(SHELL_URL, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(SHELL_URL);
          if (cached) return cached;
          throw new Error("Offline and no cached shell available yet");
        }
      })(),
    );
    return;
  }

  // Everything else same-origin (JS/CSS/image chunks): stale-while-
  // revalidate — instant from cache when present, silently refreshed in
  // the background, falls back to a real network fetch on a cold cache.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      return cached || (await network) || Response.error();
    })(),
  );
});
