/**
 * True when the app is currently being served from a local/dev address —
 * localhost, 127.0.0.1, or a private LAN IP (192.168.x.x / 10.x.x.x /
 * 172.16-31.x.x, the ranges `npm run dev --host` binds to for phone/other-
 * device testing on the same network) — as opposed to the real deployed
 * domain.
 */
function isLocalOrigin(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/**
 * Canonical public origin for links sent to other people (e.g. the
 * "sign this document" link in Team Messenger). window.location.origin
 * is NOT safe for this in general — it reflects whatever host is currently
 * serving the page, so a link sent while running the dev server locally
 * would be "http://localhost:5173" and unusable for a remote recipient.
 * Set VITE_APP_URL to the real deployed domain; used whenever the app is
 * actually running there.
 *
 * The one deliberate exception: while developing locally (isLocalOrigin),
 * the current local origin wins over VITE_APP_URL — per the user's
 * explicit request, so a link generated while testing on your own machine
 * opens locally instead of pointing at the deployed site. Once actually
 * deployed, window.location.hostname is the real domain (not local), so
 * this exception never applies there and VITE_APP_URL (or the current
 * origin, if that's unset) is used as before.
 */
export function getAppUrl(): string {
  const configured = import.meta.env.VITE_APP_URL as string | undefined;
  if (configured && isLocalOrigin(window.location.hostname)) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return (configured || window.location.origin).replace(/\/+$/, "");
}
