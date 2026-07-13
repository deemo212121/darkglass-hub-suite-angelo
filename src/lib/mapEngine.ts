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

import L from "leaflet";
import { lookupGeocode, storeGeocode } from "@/lib/supabase/geocodeCache";

export type LatLng = { lat: number; lng: number };

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
export function attachLeafletResizeFix(map: L.Map, container: HTMLElement): () => void {
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
  innerHtml: string,
  opts: { className?: string; anchor?: "center" | "bottom" } = {},
): L.DivIcon {
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

async function geocodeWithGoogle(query: string): Promise<LatLng | null> {
  await loadGoogleMapsScript();
  const maps = (window as any).google?.maps;
  if (!maps) return null;
  const geocoder = new maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address: query }, (results: any, status: string) => {
      if (status === "OK" && results?.[0]) {
        const pos = results[0].geometry.location;
        resolve({ lat: pos.lat(), lng: pos.lng() });
      } else {
        resolve(null);
      }
    });
  });
}

async function geocodeWithGeoapify(query: string): Promise<LatLng | null> {
  if (!GEOAPIFY_API_KEY) {
    console.warn("geocodeWithGeoapify: VITE_GEOAPIFY_API_KEY is not set — cannot geocode in Leaflet mode.");
    return null;
  }
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&limit=1&apiKey=${GEOAPIFY_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data?.features?.[0];
    const coords = feature?.geometry?.coordinates; // [lng, lat]
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return { lat: coords[1], lng: coords[0] };
  } catch (err) {
    console.warn("geocodeWithGeoapify failed:", err);
    return null;
  }
}

/**
 * Resolve an address string to coordinates. Checks the in-memory `cache`
 * (caller-provided, scoped to one render pass) then the Supabase DB cache
 * before hitting the live provider — a given address is only ever geocoded
 * once, ever, regardless of which provider does it.
 */
export function makeGeocoder(provider: "google" | "leaflet", cache: Map<string, LatLng | null> = new Map()) {
  return async function geocode(query: string): Promise<LatLng | null> {
    if (!query) return null;
    if (cache.has(query)) return cache.get(query)!;
    const dbHit = await lookupGeocode(query);
    if (dbHit) {
      cache.set(query, dbHit);
      return dbHit;
    }
    const result = provider === "google" ? await geocodeWithGoogle(query) : await geocodeWithGeoapify(query);
    cache.set(query, result);
    if (result) void storeGeocode(query, result); // fire-and-forget
    return result;
  };
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
export function addRouteDirectionArrow(map: L.Map, points: LatLng[], color: string, fraction = 0.6): L.Marker | null {
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
