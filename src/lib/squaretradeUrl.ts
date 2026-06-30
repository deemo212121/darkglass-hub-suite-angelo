/**
 * Per-ticket Squaretrade Appointment Completion URL.
 *
 * Each Squaretrade ticket carries its own unique token in the URL, so the
 * claims team needs to be able to paste the URL they receive from
 * Squaretrade for each ticket. We persist it locally keyed by ticket
 * number so the link is ready for the next visit without a server round
 * trip. A DB column can be added later if cross-device sync is needed.
 */

const STORAGE_PREFIX = "ahs:squaretrade:appointmentUrl:";

const DEFAULT_BASE =
  "https://www.squaretrade.com/frontend/schedule-appointment/#/confirmappointment?confirmappointment=true&agent=technician&token=";

/** Storage key for a given ticket number. */
function keyFor(ticketNo: string): string {
  return `${STORAGE_PREFIX}${String(ticketNo || "").trim()}`;
}

/** Best-effort guard for SSR; localStorage is browser-only. */
function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Return the saved appointment URL for a ticket, or empty string when
 * none is set. The URL is whatever the user pasted — we don't try to
 * reshape it, only basic trimming.
 */
export function getSquaretradeUrl(ticketNo: string): string {
  if (!ticketNo) return "";
  const store = getStorage();
  if (!store) return "";
  return (store.getItem(keyFor(ticketNo)) || "").trim();
}

/**
 * Persist (or clear, when value is empty) the appointment URL for a
 * ticket. Returns the normalised stored value.
 */
export function setSquaretradeUrl(ticketNo: string, url: string): string {
  if (!ticketNo) return "";
  const store = getStorage();
  if (!store) return url;
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    store.removeItem(keyFor(ticketNo));
    return "";
  }
  store.setItem(keyFor(ticketNo), trimmed);
  return trimmed;
}

/**
 * If the user only knows the token (not the full URL), this builds the
 * canonical Squaretrade completion URL. Returns empty when the token
 * doesn't look like a UUID.
 */
export function buildSquaretradeUrlFromToken(token: string): string {
  const trimmed = String(token || "").trim();
  if (!trimmed) return "";
  // Accept any non-empty token; Squaretrade tokens are UUIDs but we
  // don't want to reject manually-typed values from the user.
  return `${DEFAULT_BASE}${encodeURIComponent(trimmed)}`;
}

/** ServicePower workorders dashboard — used as the universal fallback. */
export const SERVICEPOWER_WORKORDERS_URL =
  "https://hub.servicepower.com/dashboard/workorders";

/**
 * Build the deep-link to a specific work order in ServicePower HUB.
 * Used as the fallback for Squaretrade tickets we haven't extracted
 * the Appointment Completion URL for yet — landing on the work-order
 * page in HUB lets claims see the live URL panel and copy it back to
 * us in one click rather than scrolling the dashboard.
 *
 * Returns the dashboard URL when no ticket number is provided.
 */
export function buildServicePowerWorkorderUrl(ticketNo: string): string {
  const trimmed = String(ticketNo || "").trim();
  if (!trimmed) return SERVICEPOWER_WORKORDERS_URL;
  // HUB uses /dashboard/workorders/<ticketNo> for the single-order view.
  return `${SERVICEPOWER_WORKORDERS_URL}/${encodeURIComponent(trimmed)}`;
}

/**
 * Return the URL to open for a Squaretrade ticket. Prefers the saved
 * Appointment Completion URL for that specific ticket; falls back to
 * the ServicePower HUB deep link for that work order so the claims
 * team can read the URL straight from HUB and paste it back here via
 * the pencil icon. The SP SOAP API doesn't expose the HUB-only
 * conversation thread, so this is the best automatic landing spot.
 */
export function resolveSquaretradeUrl(ticketNo: string): string {
  const saved = getSquaretradeUrl(ticketNo);
  if (saved) return saved;
  return buildServicePowerWorkorderUrl(ticketNo);
}

/**
 * Scan an arbitrary text blob for a Squaretrade Appointment Completion
 * URL. Used to auto-extract the per-ticket URL from ServicePower running
 * notes / call details so the claims team doesn't have to paste it
 * manually for every ticket.
 *
 * The scan works on both plain text and raw SOAP XML — we normalize
 * common XML entities first so the URL survives the SP encoding, then
 * apply two strategies:
 *   1. Match the full canonical confirmappointment URL anywhere in the
 *      text.
 *   2. Fall back to a bare UUID token preceded by "token=" and wrap it
 *      in the canonical URL.
 */
export function extractSquaretradeUrl(text: string): string {
  if (!text) return "";

  // Normalise XML entities + CDATA wrappers so URLs embedded in SOAP
  // payloads parse the same as plain text.
  let blob = String(text)
    // Drop the CDATA wrapper but keep its contents.
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // Common HTML/XML entities that SP can use in URLs.
    .replace(/&amp;/gi, "&")
    .replace(/&#x26;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  // 1) Direct match: the canonical confirmappointment URL with token.
  //    Allows http or https, any subdomain or no subdomain, and stops
  //    at whitespace, quote, angle bracket, or XML-tag boundary.
  const directRe =
    /(https?:\/\/[^\s"'<>()]*squaretrade\.com[^\s"'<>()]*confirmappointment[^\s"'<>()]*token=[A-Za-z0-9._~%-]+)/i;
  const direct = blob.match(directRe);
  if (direct && direct[1]) {
    return direct[1]
      // Strip trailing punctuation that sometimes follows the token in
      // plain-text notes ("...token=abc. Please" -> "...token=abc").
      .replace(/[.,);\]]+$/, "");
  }

  // 2) Looser match: any Squaretrade URL referencing a token.
  const looseRe =
    /(https?:\/\/[^\s"'<>()]*squaretrade\.com[^\s"'<>()]*token=[A-Za-z0-9._~%-]+)/i;
  const loose = blob.match(looseRe);
  if (loose && loose[1]) {
    return loose[1].replace(/[.,);\]]+$/, "");
  }

  // 3) Last resort: a bare UUID token appearing near "token=".
  const tokenOnly = blob.match(
    /token=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (tokenOnly && tokenOnly[1]) {
    return buildSquaretradeUrlFromToken(tokenOnly[1]);
  }

  return "";
}
