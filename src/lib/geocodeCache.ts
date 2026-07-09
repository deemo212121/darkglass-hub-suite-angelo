/**
 * Supabase-backed geocode cache.
 *
 * Every address→lat/lng result is stored in `geocode_cache` after the first
 * Google Geocoding API call. Subsequent calls for the same normalised address
 * (company-scoped) hit Supabase for free instead of Google.
 *
 * This is Phase 1 of the Google Maps cost reduction plan (see
 * GMAPS_COST_BREAKDOWN_JUN2026.txt). Expected savings: ~40–60% on the
 * Geocoding bill because the mobile route-view re-geocodes the same customer
 * addresses dozens of times per day.
 */

import { supabase } from "./supabase/client";

export interface LatLng {
  lat: number;
  lng: number;
}

// ── Address normalisation ─────────────────────────────────────────────────
// Strip punctuation, collapse whitespace, lower-case.  "123 Main St." and
// "123 main st" should resolve to the same cache key.
function normaliseAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,#\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple (non-cryptographic) 32-bit hash → 8-char hex string.
// Good enough for a cache key; the full normalised address is also stored so
// accidental collisions are detectable.
function hashString(s: string): string {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
    h >>>= 0; // keep unsigned 32-bit
  }
  return h.toString(16).padStart(8, "0");
}

// ── Cache read ────────────────────────────────────────────────────────────
export async function getCachedLatLng(address: string): Promise<LatLng | null> {
  if (!address) return null;
  const hash = hashString(normaliseAddress(address));
  const { data, error } = await supabase
    .from("geocode_cache")
    .select("lat, lng")
    .eq("address_hash", hash)
    .maybeSingle();
  if (error) {
    // Cache miss or RLS error — treat as a miss; caller will re-geocode.
    console.warn("geocodeCache read skipped:", error.message);
    return null;
  }
  if (!data) return null;
  return { lat: Number(data.lat), lng: Number(data.lng) };
}

// ── Cache write ───────────────────────────────────────────────────────────
export async function setCachedLatLng(
  address: string,
  point: LatLng
): Promise<void> {
  if (!address || !point) return;
  const normalised = normaliseAddress(address);
  const hash = hashString(normalised);
  const { error } = await supabase.from("geocode_cache").upsert(
    {
      address_hash: hash,
      address_raw: address,
      lat: point.lat,
      lng: point.lng,
    },
    { onConflict: "company_id,address_hash", ignoreDuplicates: true }
  );
  if (error) {
    // Non-fatal: cache write failure doesn't break the map.
    console.warn("geocodeCache write skipped:", error.message);
  }
}

// ── Convenience wrapper for Google Maps Geocoder objects ─────────────────
/**
 * Geocodes an address using `getCachedLatLng` first.  On a cache miss,
 * calls the provided `geocodeFn` (which wraps the real Google Maps call),
 * then stores the result.
 *
 * @param address   The raw address string.
 * @param geocodeFn  Async function that calls Google and returns LatLng|null.
 * @returns LatLng or null.
 */
export async function geocodeWithCache(
  address: string,
  geocodeFn: (address: string) => Promise<LatLng | null>
): Promise<LatLng | null> {
  // 1. Try cache.
  const cached = await getCachedLatLng(address);
  if (cached) return cached;

  // 2. Cache miss — call Google.
  const result = await geocodeFn(address);
  if (!result) return null;

  // 3. Store in cache (best-effort, fire & forget).
  void setCachedLatLng(address, result);

  return result;
}
