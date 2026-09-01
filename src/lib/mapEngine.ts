/**
 * Shared map-provider engine — every map-bearing page (Ticket Map, Work
 * Planner, Work Map, Location Management coverage, Add Branch, the mobile
 * tech route view, ticket mileage) reads the company's map provider setting
 * (see @/lib/supabase/companySettings, migration 0050) and renders on either
 * Google Maps or Leaflet+OpenStreetMap.
 *
 * Geocoding is provider-matched too, not just the basemap: Google mode uses
 * google.maps.Geocoder, Leaflet mode uses Geoapify (VITE_GEOAPIFY_API_KEY) —
 * so toggling to Leaflet means zero reliance on any Google API, not just a
 * different-looking map. Both paths check the Supabase geocode cache
 * (lookupGeocode/storeGeocode) first, so a given address is only ever
 * geocoded once, by whichever provider was active the first time.
 *
 * Distance/routing: MobileTechApp's turn-by-turn view and the ticket page's
 * mileage calc use Google's DirectionsService/DistanceMatrixService in
 * Google mode, and Geoapify's Routing API (same key as geocoding) in
 * Leaflet mode — real driving distance/routes either way, not a straight-line
 * approximation. haversineMiles() below is kept only as a last-resort
 * fallback for the rare case the routing call itself fails.
 */

import type * as Leaflet from "leaflet";
import { lookupGeocode, storeGeocode, bulkLookupGeocode } from "@/lib/supabase/geocodeCache";
import { normalizeLocationForRegionMatch, normalizeLocationName } from "@/lib/locations";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";

export type LatLng = { lat: number; lng: number };

// ─────────────────────────────────────────────────────────────────────────
// Leaflet is a browser-only library — its module touches `window` the
// moment it's loaded, not just when its API is called. A static top-level
// `import L from "leaflet"` therefore gets pulled into the SSR bundle too
// (every map-bearing page is server-rendered), and Cloudflare Workers has
// no `window` — the whole Worker fails to even start, before any request
// is handled. This lazy loader is the only way to touch Leaflet: the
// dynamic import() is code-split into a chunk that's never evaluated
// unless something actually awaits getLeaflet(), which only ever happens
// client-side (inside useEffect). Every caller keeps `import type * as
// Leaflet from "leaflet"` for type positions (erased at compile time, so
// it never reaches the SSR bundle) and gets the real module from here.
// ─────────────────────────────────────────────────────────────────────────
let leafletPromise: Promise<typeof Leaflet> | null = null;
export function getLeaflet(): Promise<typeof Leaflet> {
  if (typeof window === "undefined") return Promise.reject(new Error("Leaflet is client-only"));
  // The CSS side-effect import is bundled here too, not as a static import in
  // each caller — Vite ties a CSS chunk to whichever JS chunk shares its
  // name, and a static `import "leaflet/dist/leaflet.css"` anywhere was
  // enough to pull a static reference to the *JS* chunk back in too,
  // defeating the lazy-load above.
  // CSS and JS don't depend on each other — load them in parallel instead
  // of chaining, so switching to Leaflet doesn't pay for both round-trips
  // back to back.
  if (!leafletPromise) leafletPromise = Promise.all([import("leaflet/dist/leaflet.css"), import("leaflet")]).then(([, mod]) => mod);
  return leafletPromise;
}

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
export const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY as string;

export const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Leaflet (unlike Google Maps) doesn't notice when its container div
 * resizes after the map was created — it keeps rendering tiles against
 * whatever size the container was AT INIT TIME. In a flex/grid layout
 * where the container settles into its final size a beat after mount
 * (e.g. once sibling content like a sidebar/legend finishes laying out),
 * this makes the tile grid come out wrong and the map visually spill
 * outside its box, "overlapping" neighboring UI. This keeps it in sync:
 * one initial invalidateSize() (deferred a tick for layout to settle) plus
 * a ResizeObserver for every subsequent size change. Call once right after
 * `L.map(...)`; the returned function disconnects the observer on cleanup.
 */
export function attachLeafletResizeFix(map: Leaflet.Map, container: HTMLElement): () => void {
  const t = window.setTimeout(() => map.invalidateSize(), 0);
  const observer = new ResizeObserver(() => map.invalidateSize());
  observer.observe(container);
  return () => {
    window.clearTimeout(t);
    observer.disconnect();
  };
}

/**
 * Auto-sizing Leaflet divIcon for label/badge markers with variable-width
 * HTML content (ticket badges, zip labels, house/office pins, ...).
 * L.divIcon defaults to a fixed 12x12px box (Leaflet's own built-in
 * default, applied even if you never mention `iconSize`), which clips or
 * mis-positions anything wider — the actual cause of ticket IDs/labels
 * getting cut off. This instead gives the icon zero intrinsic size,
 * anchored exactly at the marker's point, and renders the inner HTML at
 * its natural size positioned via a CSS transform, so content of any
 * length shows in full.
 *
 * `anchor`:
 *  - "center" (default) - content is centered on the point (zip labels)
 *  - "bottom" - content's bottom-center sits on the point, like a pin
 *    pointing down at its location (ticket badges, house/office pins)
 */
export function createBadgeDivIcon(
  L: typeof Leaflet,
  innerHtml: string,
  opts: { className?: string; anchor?: "center" | "bottom" } = {},
): Leaflet.DivIcon {
  const transform = opts.anchor === "bottom" ? "translate(-50%, -100%)" : "translate(-50%, -50%)";
  return L.divIcon({
    html: `<div style="position:absolute;transform:${transform};">${innerHtml}</div>`,
    className: opts.className ?? "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Google Maps script loading — one shared marker so every page reuses the
// same <script> tag instead of each racing to inject its own.
// ─────────────────────────────────────────────────────────────────────────
let googleMapsLoadPromise: Promise<void> | null = null;

export function loadGoogleMapsScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  const w = window as any;
  if (w.google?.maps) return Promise.resolve();
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps="app"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps failed to load.")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.dataset.googleMaps = "app";
    s.async = true;
    s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.52`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google Maps failed to load."));
    document.head.appendChild(s);
  });
  return googleMapsLoadPromise;
}

// ─────────────────────────────────────────────────────────────────────────
// Geocoding — cache-first, then provider-matched.
// ─────────────────────────────────────────────────────────────────────────

/** LatLng plus a flag set when the provider itself signalled the match is
 *  fuzzy / not address-precise (Google partial_match or APPROXIMATE
 *  location_type; Geoapify street/postcode/city result_type or low rank
 *  confidence). geocodeAddress folds this into its `approximate` output. */
type ProviderHit = LatLng & { fuzzy: boolean };

async function geocodeWithGoogle(query: string): Promise<ProviderHit | null> {
  await loadGoogleMapsScript();
  const maps = (window as any).google?.maps;
  if (!maps) return null;
  const geocoder = new maps.Geocoder();
  return new Promise((resolve) => {
    // Every ticket/office address in this app is US-only — without this,
    // a small town that happens to share a name with a well-known place
    // abroad (e.g. "Canton, NC" vs. Guangzhou, historically "Canton") can
    // resolve to entirely the wrong country.
    geocoder.geocode({ address: query, componentRestrictions: { country: "US" } }, (results: any, status: string) => {
      if (status === "OK" && results?.[0]) {
        const r = results[0];
        const pos = r.geometry.location;
        const fuzzy = r.partial_match === true || r.geometry?.location_type === "APPROXIMATE";
        resolve({ lat: pos.lat(), lng: pos.lng(), fuzzy });
      } else {
        resolve(null);
      }
    });
  });
}

async function geocodeWithGeoapify(query: string): Promise<ProviderHit | null> {
  if (!GEOAPIFY_API_KEY) {
    console.warn("geocodeWithGeoapify: VITE_GEOAPIFY_API_KEY is not set — cannot geocode in Leaflet mode.");
    return null;
  }
  // Every ticket/office address in this app is US-only. Without this filter,
  // a small town whose name coincides with a much more prominent place
  // abroad — e.g. "Canton, NC" vs. Guangzhou (historically "Canton" in
  // English) — can resolve to the wrong country entirely, which is exactly
  // what put a technician's actual route on the map somewhere overseas.
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&filter=countrycode:us&limit=1&apiKey=${GEOAPIFY_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data?.features?.[0];
    const coords = feature?.geometry?.coordinates; // [lng, lat]
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const rt = feature?.properties?.result_type;
    const conf = feature?.properties?.rank?.confidence;
    const fuzzy =
      (typeof rt === "string" && ["street", "postcode", "city", "district", "state"].includes(rt)) ||
      (typeof conf === "number" && conf < 0.5);
    return { lat: coords[1], lng: coords[0], fuzzy };
  } catch (err) {
    console.warn("geocodeWithGeoapify failed:", err);
    return null;
  }
}

/**
 * Resolve a bare US ZIP code straight from the USPS-sourced zippopotam.us
 * database (free, keyless) instead of a general-purpose address geocoder.
 * Both Google's and Geoapify's geocoders resolve postcodes through general
 * address-search indexes (OSM-derived for Geoapify) that can carry stale or
 * wrong postcode-boundary data — e.g. Geoapify placed ZIP 28750 (Lynn, NC,
 * near Asheville) in Halifax County, NC, ~200mi away near the VA border,
 * for both a free-text and a structured postcode query. zippopotam.us is a
 * dedicated ZIP lookup, so coverage-map zip plotting no longer depends on
 * a general geocoder's postcode data being right.
 */
async function geocodeZipCode(zip: string): Promise<LatLng | null> {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) return null;
    const data = await res.json();
    const place = data?.places?.[0];
    const lat = parseFloat(place?.latitude);
    const lng = parseFloat(place?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.warn("geocodeZipCode (zippopotam) failed:", err);
    return null;
  }
}

// Uncommon USPS street-suffix abbreviations that actually trip the
// geocoders — "109 BRONCO RDG PLEASANTON TX" misses where "…BRONCO RIDGE…"
// hits (Geoapify/OSM especially). Deliberately NOT the everyday ones
// (RD/ST/AVE/DR/LN/CT/BLVD/CIR…) — every geocoder already handles those,
// and expanding "ST" would wreck "ST CHARLES". Word-boundary, case-
// insensitive; each entry here is unambiguous in an address.
const US_ADDR_SUFFIX_ABBREV: Record<string, string> = {
  RDG: "RIDGE", HWY: "HIGHWAY", XING: "CROSSING", HOLW: "HOLLOW",
  TRCE: "TRACE", CRK: "CREEK", BRK: "BROOK", BLF: "BLUFF", MDW: "MEADOW",
  MDWS: "MEADOWS", GRV: "GROVE", GLN: "GLEN", HLS: "HILLS", KNL: "KNOLL",
  LNDG: "LANDING", MTN: "MOUNTAIN", PNES: "PINES", SPGS: "SPRINGS",
  VLY: "VALLEY", VLG: "VILLAGE", CTR: "CENTER", PLZ: "PLAZA", HBR: "HARBOR",
  EXPY: "EXPRESSWAY", FWY: "FREEWAY", TPKE: "TURNPIKE", PSGE: "PASSAGE",
  FRST: "FOREST", MNR: "MANOR", XRD: "CROSSROAD", CSWY: "CAUSEWAY",
};
function expandAddrAbbrev(s: string): string {
  let out = s
    // County / state / US highway forms, before the generic suffix pass.
    .replace(/\bCO(?:UNTY)?\.?\s+RD\b\.?/gi, "COUNTY ROAD")
    .replace(/\bCR\s+(\d)/gi, "COUNTY ROAD $1")
    .replace(/\bCO(?:UNTY)?\.?\s+HWY\b\.?/gi, "COUNTY HIGHWAY")
    // Directional right after the house number ("80 S Nixon Ave").
    .replace(/\b(\d+)\s+(N|S|E|W|NE|NW|SE|SW)\s+/gi, (_m, n, d) => {
      const full: Record<string, string> = {
        N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST",
        NE: "NORTHEAST", NW: "NORTHWEST", SE: "SOUTHEAST", SW: "SOUTHWEST",
      };
      return `${n} ${full[String(d).toUpperCase()]} `;
    });
  for (const [abbr, expanded] of Object.entries(US_ADDR_SUFFIX_ABBREV)) {
    out = out.replace(new RegExp(`\\b${abbr}\\b`, "gi"), expanded);
  }
  return out;
}

/** Strip junk the address feeds carry ("NULL"/"N/A" segments, doubled unit
 *  text, stray punctuation) and expand abbreviations, so the geocoder sees a
 *  clean string. */
function cleanAddressQuery(s: string): string {
  return expandAddrAbbrev(
    s
      .replace(/\b(NULL|N\/A|NA|UNKNOWN)\b/gi, " ")
      .replace(/\s*#\s*/g, " ")
      .replace(/[.]/g, " "),
  )
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/(^[\s,]+|[\s,]+$)/g, "")
    .trim();
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** true when only a coarse anchor could be found — street centroid, city,
   *  or ZIP centroid — because the exact address wouldn't resolve. Callers
   *  that gate on being physically *at* a point (the On-Site Check-In
   *  geofence) must not hard-pass on an approximate result. */
  approximate: boolean;
}

/**
 * Progressively-coarser queries to try when the exact address won't
 * geocode. Only the first (full, cleaned address) is exact; every fallback
 * is flagged approximate. Operates on the comma-joined "street, city,
 * state zip" form that fmtAddress()/getLocationManagementZoomAddress() emit.
 */
function deriveQueryTiers(query: string): Array<{ q: string; zip?: string; approximate: boolean }> {
  const cleaned = cleanAddressQuery(query);
  const tiers: Array<{ q: string; zip?: string; approximate: boolean }> = [
    { q: cleaned, approximate: false },
  ];
  const segs = cleaned.split(",").map((x) => x.trim()).filter(Boolean);
  if (segs.length >= 2) {
    // Drop the house number → street centroid.
    const noNumber = segs[0].replace(/^\d+\s+/, "");
    if (noNumber && noNumber !== segs[0]) {
      tiers.push({ q: [noNumber, ...segs.slice(1)].join(", "), approximate: true });
    }
    // City + state (+ zip) only.
    tiers.push({ q: segs.slice(1).join(", "), approximate: true });
  }
  // ZIP is the trailing token on a fmtAddress() string ("…, TX 78064") —
  // end-anchored so a 5-digit house number ("12483 NW 139TH CT…") isn't
  // mistaken for one.
  const zip = cleaned.match(/(\d{5})(?:-\d{4})?\s*$/);
  if (zip) tiers.push({ q: zip[1], zip: zip[1], approximate: true });
  return tiers;
}

const BARE_ZIP_QUERY = /^(\d{5})(?:-\d{4})?,\s*USA$/i;

async function providerGeocode(provider: "google" | "leaflet", q: string): Promise<ProviderHit | null> {
  const primary = provider === "google" ? await geocodeWithGoogle(q) : await geocodeWithGeoapify(q);
  if (primary && !primary.fuzzy) return primary;
  // Secondary provider — Google mode falls back to Geoapify (when the key is
  // set); Leaflet mode does NOT fall back to Google, to keep "Leaflet =
  // zero Google API reliance" true. Different indexes, so one often has a
  // rural road the other is missing. A non-fuzzy secondary hit beats a fuzzy
  // primary one.
  if (provider === "google" && GEOAPIFY_API_KEY) {
    const secondary = await geocodeWithGeoapify(q);
    if (secondary && !secondary.fuzzy) return secondary;
    return primary ?? secondary;
  }
  return primary;
}

const sessionDetailedCache = new Map<string, GeocodeResult | null>();

/**
 * Resolve an address to coordinates with a precision flag and a fallback
 * chain. Order: session cache → bare-ZIP shortcut → Supabase DB cache
 * (exact hits only) → tiered attempts (full cleaned address, then street /
 * city / ZIP-centroid, each flagged approximate), with a cross-provider
 * retry per tier. Only exact hits are written back to the DB cache — a ZIP
 * centroid must not get promoted to "the address" on the next session.
 */
export async function geocodeAddress(
  provider: "google" | "leaflet",
  query: string,
): Promise<GeocodeResult | null> {
  if (!query) return null;
  if (sessionDetailedCache.has(query)) return sessionDetailedCache.get(query)!;

  const zipShortcut = query.match(BARE_ZIP_QUERY);
  if (zipShortcut) {
    const p = await geocodeZipCode(zipShortcut[1]);
    const res = p ? { ...p, approximate: false } : null;
    sessionDetailedCache.set(query, res);
    return res;
  }

  const dbHit = await lookupGeocode(query);
  if (dbHit) {
    const res: GeocodeResult = { ...dbHit, approximate: false };
    sessionDetailedCache.set(query, res);
    return res;
  }

  for (const tier of deriveQueryTiers(query)) {
    if (!tier.q) continue;
    const hit = tier.zip ? await geocodeZipCode(tier.zip) : await providerGeocode(provider, tier.q);
    if (!hit) continue;
    const fuzzy = "fuzzy" in hit ? Boolean(hit.fuzzy) : false;
    const approximate: boolean = tier.approximate || fuzzy;
    const res: GeocodeResult = { lat: hit.lat, lng: hit.lng, approximate };
    sessionDetailedCache.set(query, res);
    // Only a clean, address-precise hit is written back to the shared DB
    // cache — a ZIP centroid or a fuzzy match must not get promoted to
    // "the address" for every other session and caller.
    if (!approximate) void storeGeocode(query, { lat: hit.lat, lng: hit.lng });
    return res;
  }

  sessionDetailedCache.set(query, null);
  return null;
}

/**
 * Resolve an address string to coordinates. Back-compat wrapper over
 * geocodeAddress that drops the precision flag — every existing map/route
 * caller keeps its `LatLng | null` contract while transparently gaining the
 * abbreviation-expansion + street/city/ZIP fallback chain (a pin at a ZIP
 * centroid still beats no pin on a route map). The `cache` param is kept for
 * call-site compatibility and written through as the LatLng view.
 */
const sessionGeocodeCache = new Map<string, LatLng | null>();

// Callers throw a `Promise.all` over every visible ticket's address at once
// (Work Map, Work Planner) -- fine for a handful of tickets, but a location/
// day with a couple thousand tickets fires that many concurrent geocode()
// calls in one shot, which blows past what the browser can even track
// (net::ERR_INSUFFICIENT_RESOURCES) and floods Geoapify/Google well past
// their rate limits. Capping in-flight geocode() calls here protects every
// caller automatically instead of requiring each Promise.all site to batch
// its own tickets -- module-level so it's a real global cap, not just
// per-geocoder-instance (multiple components can hold a geocoder at once).
const MAX_CONCURRENT_GEOCODES = 8;
let activeGeocodes = 0;
const geocodeQueue: Array<() => void> = [];
async function acquireGeocodeSlot(): Promise<void> {
  if (activeGeocodes < MAX_CONCURRENT_GEOCODES) {
    activeGeocodes++;
    return;
  }
  await new Promise<void>((resolve) => geocodeQueue.push(resolve));
  activeGeocodes++;
}
function releaseGeocodeSlot(): void {
  activeGeocodes--;
  const next = geocodeQueue.shift();
  if (next) next();
}

export function makeGeocoder(provider: "google" | "leaflet", cache: Map<string, LatLng | null> = sessionGeocodeCache) {
  return async function geocode(query: string): Promise<LatLng | null> {
    if (!query) return null;
    if (cache.has(query)) return cache.get(query)!;
    await acquireGeocodeSlot();
    try {
      const detailed = await geocodeAddress(provider, query);
      const result: LatLng | null = detailed ? { lat: detailed.lat, lng: detailed.lng } : null;
      cache.set(query, result);
      return result;
    } finally {
      releaseGeocodeSlot();
    }
  };
}

/**
 * Pre-warms `cache` with every already-cached address's coordinates via one
 * bulk DB query (bulkLookupGeocode), instead of each address paying its own
 * network round-trip through geocode()'s per-call DB lookup -- that lookup
 * happens inside the same concurrency-throttled path as a live provider
 * call, so on a page with hundreds of tickets whose addresses are already
 * known, that throttle was the actual bottleneck, not Geoapify/Google.
 *
 * Call this with every query string a page is about to geocode, BEFORE
 * looping geocode() over the list -- cache hits resolve synchronously with
 * zero network calls once this resolves; genuine misses still fall through
 * to geocode()'s normal (throttled) live-provider path unchanged.
 */
export async function warmGeocodeCache(queries: string[], cache: Map<string, LatLng | null> = sessionGeocodeCache): Promise<void> {
  const uncached = queries.filter((q) => q && !cache.has(q));
  if (uncached.length === 0) return;
  const results = await bulkLookupGeocode(uncached);
  for (const q of uncached) {
    const hit = results.get(q);
    if (hit) cache.set(q, hit);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Distance / routing.
// ─────────────────────────────────────────────────────────────────────────

/** Haversine straight-line distance in miles between two lat/lng points — last-resort fallback only. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const metersToMiles = (m: number): number => m / 1609.344;
export const milesToMeters = (mi: number): number => mi * 1609.344;

/**
 * On-Site Check-In geofence radius — how close a technician must be to a
 * ticket's address before "I'm Here"/"I'm Done" become tappable in
 * MobileTechApp.tsx's On-Site Check-In card, and the radius drawn around
 * each stop on TechnicianDayRouteModal's admin route map. Single shared
 * constant so the two stay in sync. Kept in miles (distanceFor/haversineMiles
 * compare against it directly) but defined in metres for precision.
 *
 * Widened from the original 200 m: address geocoding interpolates a street
 * number along a road segment, which on long rural/highway addresses lands
 * the pin hundreds of metres — sometimes over a mile — from the actual
 * building, so a 200 m circle around the geocoded point routinely excluded a
 * technician who was genuinely standing at the door. The check-in card also
 * adds the GPS fix's own reported accuracy on top of this (capped — see
 * ON_SITE_CHECKIN_ACCURACY_SLACK_CAP_MILES).
 */
export const ON_SITE_CHECKIN_RADIUS_MILES = metersToMiles(400);

/**
 * Extra slack the On-Site Check-In card adds to the geofence test, equal to
 * the GPS fix's own reported accuracy but no more than this cap. A fix that
 * reports "±120 m" means the technician may already be inside the base radius
 * even when the point-to-point distance reads a little over it; a coarse
 * cell-tower fix that reports "±3 km" tells us almost nothing, so the benefit
 * of the doubt is capped rather than letting it swallow the whole check.
 */
export const ON_SITE_CHECKIN_ACCURACY_SLACK_CAP_MILES = metersToMiles(250);

/**
 * How far out the On-Site Check-In card still offers a manual "I'm here
 * anyway" override for a ticket the automatic geofence rejected. Covers the
 * real failure modes — a street number interpolated along a rural road
 * segment, a coarse GPS fix that never sharpened — which are off by hundreds
 * of metres to about a mile, never tens of miles. Outside this the override
 * is hidden, so it can't double as "check in from home". (An address that
 * didn't geocode at all is handled separately: the override shows regardless
 * of distance since there's nothing to measure against.)
 */
export const ON_SITE_CHECKIN_MANUAL_OVERRIDE_MAX_MILES = 3;

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  /** One entry per consecutive waypoint pair — legs[0] is waypoints[0]→waypoints[1], etc. */
  legs: RouteLeg[];
  /** GeoJSON LineString/MultiLineString — feed straight into L.geoJSON(). */
  geometry: GeoJSON.Geometry;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

/**
 * Real driving route via Geoapify's Routing API (same key as geocoding) —
 * the Leaflet-mode equivalent of Google's DirectionsService/
 * DistanceMatrixService. Needs at least 2 waypoints; returns null on any
 * failure (missing key, network error, no route found) so callers can fall
 * back to haversineMiles() rather than crash.
 */
export async function routeGeoapify(waypoints: LatLng[], mode: "drive" = "drive"): Promise<RouteResult | null> {
  if (!GEOAPIFY_API_KEY) {
    console.warn("routeGeoapify: VITE_GEOAPIFY_API_KEY is not set — cannot route in Leaflet mode.");
    return null;
  }
  if (waypoints.length < 2) return null;
  const wp = waypoints.map((p) => `${p.lat},${p.lng}`).join("|");
  const url = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(wp)}&mode=${mode}&apiKey=${GEOAPIFY_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data?.features?.[0];
    if (!feature) return null;
    const legsRaw: any[] = feature.properties?.legs ?? [];
    const legs: RouteLeg[] = legsRaw.map((l) => ({ distanceMeters: l.distance ?? 0, durationSeconds: l.time ?? 0 }));
    return {
      legs,
      geometry: feature.geometry,
      totalDistanceMeters: feature.properties?.distance ?? legs.reduce((s, l) => s + l.distanceMeters, 0),
      totalDurationSeconds: feature.properties?.time ?? legs.reduce((s, l) => s + l.durationSeconds, 0),
    };
  } catch (err) {
    console.warn("routeGeoapify failed:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Office-to-customer driving distance ("ticket mileage") — shared by the
// ticket detail page (one ticket at a time) and Need Claim List (many
// tickets at once, called with a concurrency limit by the caller).
// ─────────────────────────────────────────────────────────────────────────

export interface MileageTicketInput {
  location?: string;
  city?: string;
  address?: string;
  state?: string;
  zip?: string;
  account?: string;
}

// Resolve the office coordinates for a location: prefer Location Management
// coordinates, fall back to the static LOCATIONS_DATA lat/lng.
// Same localStorage key LocationManagementPage.tsx saves its rows under.
// Duplicated here (rather than importing getLocationManagementCoordinates
// from that component) deliberately: LocationManagementPage.tsx already
// imports from this file (loadGoogleMapsScript, makeGeocoder, ...), so a
// lib -> component import back the other way would make this file and
// that component circularly dependent. Rollup then has to split the pair
// across chunk boundaries, and the load order it picks can leave one side
// reading the other's export before that module's own top-level code has
// finished running — surfaced in production as `Uncaught ReferenceError:
// Cannot access 'X' before initialization` (hit exactly this with 'cva'
// in the ui-kit chunk once this import made "vendor" and "app-components"
// mutually dependent — every chunk transitively between them got swept
// into the same hazard, not just these two files).
const LOCATION_MGMT_STORAGE_KEY = "ahs:location-management:locations";
function normalizeLocationKey(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function parseLatLngString(coordinates?: string): LatLng | null {
  if (!coordinates) return null;
  const parts = String(coordinates).split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 2) return null;
  const [lat, lng] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
function getSavedLocationCoordinates(location: string): LatLng | null {
  const normalizedLocation = normalizeLocationName(location);
  if (!normalizedLocation) return null;
  const key = normalizeLocationKey(normalizedLocation);
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOCATION_MGMT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { rows?: Array<{ location: string; coordinates?: string }> };
    const savedRow = parsed.rows?.find((row) => normalizeLocationKey(row.location) === key);
    return parseLatLngString(savedRow?.coordinates);
  } catch {
    return null;
  }
}

export function getOfficeCoordinates(location: string): LatLng | null {
  const fromMgmt = getSavedLocationCoordinates(location);
  if (fromMgmt) return fromMgmt;
  // LOCATIONS_DATA stores a few branches (Jackson,MS / Jackson,TN) without
  // the space canonicalBranchLabel() puts in real ticket.location values —
  // normalize both sides the same way locationRegion() already does, or
  // those branches silently never resolve an office and mileage shows "—".
  const normalized = normalizeLocationForRegionMatch(location).toLowerCase();
  const match = LOCATIONS_DATA.find((l) => normalizeLocationForRegionMatch(l.location).toLowerCase() === normalized);
  if (match && match.lat && match.lng) {
    const lat = parseFloat(match.lat);
    const lng = parseFloat(match.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

// Electrolux tickets logged under the "Huntsville" location actually
// dispatch from one of two different real offices depending on which state
// the customer is in — the branch name alone doesn't disambiguate this.
// Overrides the normal location-based mileage starting point for just this
// account + location + state combination; every other account's Huntsville
// tickets keep using the location's own stored coordinates. Returns a plain
// address string (not lat/lng) so the Distance Matrix API geocodes it the
// same way it already does for destinations, instead of us hand-typing
// coordinates for a calculation that affects mileage reimbursement.
const ELECTROLUX_HUNTSVILLE_MILEAGE_ORIGIN: Record<string, string> = {
  AL: "631 Beacon Pkwy W #106, Birmingham, AL 35209, USA",
  TN: "163 N Mt Juliet Rd, Mt. Juliet, TN 37122, USA",
};
function getElectroluxHuntsvilleMileageOrigin(ticket: MileageTicketInput): string | null {
  const account = String(ticket.account || "").trim().toLowerCase();
  const location = String(ticket.location || "").trim().toLowerCase();
  const state = String(ticket.state || "").trim().toUpperCase();
  if (!account.includes("electrolux") || location !== "huntsville") return null;
  return ELECTROLUX_HUNTSVILLE_MILEAGE_ORIGIN[state] ?? null;
}

async function computeOfficeDistanceMilesLeaflet(
  overrideOrigin: string | null,
  office: LatLng | null,
  destinationCandidates: string[],
): Promise<number | null> {
  // Geocode via Geoapify, then get real driving distance via Geoapify's
  // Routing API (same key) — falls back to straight-line only if the
  // routing call itself fails.
  const geocode = makeGeocoder("leaflet");
  let destCoords: LatLng | null = null;
  for (const candidate of destinationCandidates) {
    destCoords = await geocode(candidate);
    if (destCoords) break;
  }
  if (!destCoords) return null;
  const originCoords = overrideOrigin ? await geocode(overrideOrigin) : office;
  if (!originCoords) return null;
  const route = await routeGeoapify([originCoords, destCoords], "drive");
  return route ? metersToMiles(route.totalDistanceMeters) : haversineMiles(originCoords, destCoords);
}

async function computeOfficeDistanceMilesGoogle(
  overrideOrigin: string | null,
  office: LatLng | null,
  destinationCandidates: string[],
): Promise<number | null> {
  const apiKey = GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  await loadGoogleMapsScript();
  const maps = (window as any).google?.maps;
  if (!maps) return null;
  const service = new maps.DistanceMatrixService();
  // The Distance Matrix API accepts a plain address string for origins too
  // (it geocodes it the same way it does destinations), so the Electrolux/
  // Huntsville override just passes its address straight through — no need
  // to resolve it to lat/lng ourselves.
  const origin = overrideOrigin ?? new maps.LatLng(office!.lat, office!.lng);

  for (const candidate of destinationCandidates) {
    const miles = await new Promise<number | null>((resolve) => {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [candidate],
          travelMode: maps.TravelMode.DRIVING,
          unitSystem: maps.UnitSystem.IMPERIAL,
        },
        (response: any, status: string) => {
          const element = response?.rows?.[0]?.elements?.[0];
          if (status === "OK" && element?.status === "OK" && element.distance?.value != null) {
            resolve(element.distance.value / 1609.344);
          } else {
            resolve(null);
          }
        },
      );
    });
    if (miles != null) return miles;
  }

  // Last resort: straight-line distance via geocoding the best candidate string.
  const geocoder = new maps.Geocoder();
  const destCoords = await new Promise<LatLng | null>((resolve) => {
    geocoder.geocode({ address: destinationCandidates[0] }, (results: any, status: string) => {
      if (status !== "OK" || !results?.[0]) { resolve(null); return; }
      const pos = results[0].geometry.location;
      resolve({ lat: pos.lat(), lng: pos.lng() });
    });
  });
  if (!destCoords) return null;
  if (!overrideOrigin) return haversineMiles(office!, destCoords);
  // Origin is an address string here — geocode it too so the Haversine
  // fallback has coordinates to work with.
  const originCoords = await new Promise<LatLng | null>((resolve) => {
    geocoder.geocode({ address: overrideOrigin }, (results: any, status: string) => {
      if (status !== "OK" || !results?.[0]) { resolve(null); return; }
      const pos = results[0].geometry.location;
      resolve({ lat: pos.lat(), lng: pos.lng() });
    });
  });
  return originCoords ? haversineMiles(originCoords, destCoords) : null;
}

/**
 * Compute real driving miles from the office to a ticket's address — matches
 * what Google Maps shows. Falls back through progressively looser
 * destination strings so a slightly-off address still resolves instead of
 * showing null. Returns null when the ticket/office can't be resolved at
 * all, or the map provider isn't loaded yet.
 */
function destinationCandidatesFor(ticket: MileageTicketInput): string[] {
  return [
    [ticket.address, ticket.city, ticket.state, ticket.zip, "USA"].filter(Boolean).join(", "),
    [ticket.city, ticket.state, ticket.zip, "USA"].filter(Boolean).join(", "),
    [ticket.zip, "USA"].filter(Boolean).join(", "),
    [ticket.city, ticket.state, "USA"].filter(Boolean).join(", "),
  ]
    .map((s) => s.trim())
    .filter((s) => s && s !== "USA");
}

export async function computeOfficeDistanceMiles(
  ticket: MileageTicketInput,
  mapProvider: "google" | "leaflet" | null,
): Promise<number | null> {
  if (!mapProvider) return null;
  const overrideOrigin = getElectroluxHuntsvilleMileageOrigin(ticket);
  const office = overrideOrigin ? null : getOfficeCoordinates(ticket.location || ticket.city || "");
  if (!overrideOrigin && !office) return null;

  const destinationCandidates = destinationCandidatesFor(ticket);
  if (destinationCandidates.length === 0) return null;

  return mapProvider === "leaflet"
    ? computeOfficeDistanceMilesLeaflet(overrideOrigin, office, destinationCandidates)
    : computeOfficeDistanceMilesGoogle(overrideOrigin, office, destinationCandidates);
}

// ─────────────────────────────────────────────────────────────────────────
// Full-day route mileage ("branch -> stop 1 -> stop 2 -> ... -> stop N ->
// home address, or back to the branch if none on file") — what payroll
// actually pays for is the technician's real drive that day, not each
// ticket's own independent distance from the branch. Used by
// syncMileageFromTickets (mileage.ts), which groups a technician's tickets
// by work date and sorts them into visit order before calling this.
// ─────────────────────────────────────────────────────────────────────────

async function distanceMatrixLeg(
  service: any,
  maps: any,
  origin: any,
  destinationCandidates: string[],
): Promise<{ miles: number; destination: string } | null> {
  for (const candidate of destinationCandidates) {
    const miles = await new Promise<number | null>((resolve) => {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [candidate],
          travelMode: maps.TravelMode.DRIVING,
          unitSystem: maps.UnitSystem.IMPERIAL,
        },
        (response: any, status: string) => {
          const element = response?.rows?.[0]?.elements?.[0];
          if (status === "OK" && element?.status === "OK" && element.distance?.value != null) {
            resolve(element.distance.value / 1609.344);
          } else {
            resolve(null);
          }
        },
      );
    });
    if (miles != null) return { miles, destination: candidate };
  }
  return null;
}

async function computeDailyRouteMilesGoogle(
  overrideOrigin: string | null,
  office: LatLng | null,
  stopCandidates: string[][],
  homeCandidates: string[],
): Promise<number | null> {
  const apiKey = GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  await loadGoogleMapsScript();
  const maps = (window as any).google?.maps;
  if (!maps) return null;
  const service = new maps.DistanceMatrixService();
  const startPoint = overrideOrigin ?? new maps.LatLng(office!.lat, office!.lng);

  let currentOrigin: any = startPoint;
  let total = 0;
  let anyLegSucceeded = false;
  for (const candidates of stopCandidates) {
    const leg = await distanceMatrixLeg(service, maps, currentOrigin, candidates);
    if (!leg) continue; // stop couldn't be resolved — skip it, keep the route going from the last good point
    total += leg.miles;
    currentOrigin = leg.destination;
    anyLegSucceeded = true;
  }
  if (!anyLegSucceeded) return null;

  // Final leg home — or back to the starting point if no home address is on file.
  const homeLeg = homeCandidates.length > 0 ? await distanceMatrixLeg(service, maps, currentOrigin, homeCandidates) : null;
  if (homeLeg) {
    total += homeLeg.miles;
  } else if (homeCandidates.length === 0) {
    const backLeg = await new Promise<number | null>((resolve) => {
      service.getDistanceMatrix(
        { origins: [currentOrigin], destinations: [startPoint], travelMode: maps.TravelMode.DRIVING, unitSystem: maps.UnitSystem.IMPERIAL },
        (response: any, status: string) => {
          const element = response?.rows?.[0]?.elements?.[0];
          if (status === "OK" && element?.status === "OK" && element.distance?.value != null) resolve(element.distance.value / 1609.344);
          else resolve(null);
        },
      );
    });
    if (backLeg != null) total += backLeg;
  }
  return total;
}

async function computeDailyRouteMilesLeaflet(
  overrideOrigin: string | null,
  office: LatLng | null,
  stopCandidates: string[][],
  homeCandidates: string[],
): Promise<number | null> {
  const geocode = makeGeocoder("leaflet");
  const originPt = overrideOrigin ? await geocode(overrideOrigin) : office;
  if (!originPt) return null;

  const points: LatLng[] = [originPt];
  for (const candidates of stopCandidates) {
    let pt: LatLng | null = null;
    for (const candidate of candidates) {
      pt = await geocode(candidate);
      if (pt) break;
    }
    if (pt) points.push(pt); // stop couldn't be resolved — skip it, keep the route going
  }
  if (points.length < 2) return null; // not even one stop resolved

  let homePt: LatLng | null = null;
  for (const candidate of homeCandidates) {
    homePt = await geocode(candidate);
    if (homePt) break;
  }
  points.push(homePt ?? originPt); // no home address on file — route back to the branch

  const route = await routeGeoapify(points, "drive");
  if (route) return metersToMiles(route.totalDistanceMeters);
  // Routing call itself failed — sum consecutive straight-line legs rather than losing the whole day's mileage.
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMiles(points[i - 1], points[i]);
  return total;
}

/**
 * Real driving miles for a technician's full day route: branch -> stop 1 ->
 * stop 2 -> ... -> stop N -> home address (or back to the branch if none on
 * file). `stops` must already be in visit order — this just chains
 * consecutive legs and sums them, it doesn't re-sequence anything.
 * `originStop` (typically the day's first stop) is only used to resolve the
 * Electrolux/Huntsville branch override, same as computeOfficeDistanceMiles.
 */
export async function computeDailyRouteMiles(
  officeLocation: string,
  originStop: MileageTicketInput,
  stops: MileageTicketInput[],
  homeAddress: string | undefined,
  mapProvider: "google" | "leaflet" | null,
): Promise<number | null> {
  if (!mapProvider || stops.length === 0) return null;
  const overrideOrigin = getElectroluxHuntsvilleMileageOrigin(originStop);
  const office = overrideOrigin ? null : getOfficeCoordinates(officeLocation);
  if (!overrideOrigin && !office) return null;

  const stopCandidates = stops.map(destinationCandidatesFor).filter((c) => c.length > 0);
  if (stopCandidates.length === 0) return null;
  const homeCandidates =
    homeAddress && homeAddress.trim() && homeAddress !== "(no address on file)" ? [homeAddress.trim()] : [];

  return mapProvider === "leaflet"
    ? computeDailyRouteMilesLeaflet(overrideOrigin, office, stopCandidates, homeCandidates)
    : computeDailyRouteMilesGoogle(overrideOrigin, office, stopCandidates, homeCandidates);
}

// ─────────────────────────────────────────────────────────────────────────
// Route direction arrows — Google's Polyline supports a built-in
// `icons: [{ icon: { path: SymbolPath.FORWARD_CLOSED_ARROW }, offset: "60%" }]`
// to show which way a route travels. Leaflet's Polyline has no equivalent
// built in (would otherwise need a plugin like leaflet-polylinedecorator),
// so this reproduces just that one piece: a small triangle marker placed
// at a given fraction of the route's total length, rotated to match the
// direction of travel there.
// ─────────────────────────────────────────────────────────────────────────

function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Position + direction at `fraction` (0-1) of the total length along a
 * multi-point path — mirrors Google Polyline icon `offset` percentage
 * placement, so the arrow lands at the same relative spot on the route
 * regardless of how many stops it has.
 */
function pointAlongPath(points: LatLng[], fraction: number): { pos: LatLng; bearingDeg: number } | null {
  if (points.length < 2) return null;
  const segLengths = points.slice(1).map((p, i) => haversineMiles(points[i], p));
  const total = segLengths.reduce((s, l) => s + l, 0);
  const clamped = Math.min(1, Math.max(0, fraction));
  if (total === 0) return { pos: points[0], bearingDeg: 0 };
  const target = total * clamped;
  let covered = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (covered + segLen >= target || i === segLengths.length - 1) {
      const t = segLen === 0 ? 0 : (target - covered) / segLen;
      return { pos: lerpLatLng(points[i], points[i + 1], t), bearingDeg: bearingDegrees(points[i], points[i + 1]) };
    }
    covered += segLen;
  }
  return { pos: points[points.length - 1], bearingDeg: 0 };
}

/**
 * Adds a small direction-arrow marker at `fraction` (default 60%, matching
 * the Google routes elsewhere in the app) along a multi-point route,
 * colored to match the route line. Returns null if the path is too short
 * to place one. Caller owns the returned marker's lifecycle (remove it
 * alongside the route line on redraw).
 */
export function addRouteDirectionArrow(L: typeof Leaflet, map: Leaflet.Map, points: LatLng[], color: string, fraction = 0.6): Leaflet.Marker | null {
  const hit = pointAlongPath(points, fraction);
  if (!hit) return null;
  return L.marker([hit.pos.lat, hit.pos.lng], {
    icon: L.divIcon({
      html: `<div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid ${color};transform:rotate(${hit.bearingDeg}deg);transform-origin:50% 60%;filter:drop-shadow(0 0 1px rgba(0,0,0,0.6));"></div>`,
      className: "route-direction-arrow",
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    }),
    interactive: false,
    zIndexOffset: 400,
  }).addTo(map);
}
