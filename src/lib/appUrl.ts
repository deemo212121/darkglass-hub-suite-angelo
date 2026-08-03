/**
 * Canonical public origin for links sent to other people (e.g. the
 * "sign this document" link in Team Messenger). window.location.origin
 * is NOT safe for this — it reflects whatever host is currently serving
 * the page, so a link sent while running the dev server locally would be
 * "http://localhost:5173" and unusable for the recipient. Set
 * VITE_APP_URL to the real deployed domain; falls back to the current
 * origin only when it isn't set (local dev).
 */
export function getAppUrl(): string {
  const configured = import.meta.env.VITE_APP_URL as string | undefined;
  return (configured || window.location.origin).replace(/\/+$/, "");
}
