/**
 * Supabase-backed geocode cache.
 *
 * Every address string is normalised (lowercase, strip punctuation, collapse
 * whitespace) before hashing so "123 Main St." and "123 main st" both map to
 * the same cache key.  The actual Google Geocoding API is only called on a
 * cache miss; hits return instantly with $0 API cost.
 *
 * Table: geocode_cache (created by 0026_geocode_cache.sql)
 * Columns: id, company_id, address_hash, address_raw, lat, lng, cached_at
 * RLS: company-scoped via auth_company_id()
 */

import { supabase } from "./client";

/** Normalise an address string for stable hashing. */
function normalise(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[.,#\-\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cheap browser-side hash — not cryptographic, but collision-resistant enough
 * for an address-key lookup.  Uses the Web Crypto API (SubtleCrypto) so it
 * works in Cloudflare Workers, modern browsers, and Node 18+.
 */
async function sha256hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Look up an address in the Supabase geocode cache.
 * Returns `null` on a miss (caller should geocode then call `storeGeocode`).
 */
export async function lookupGeocode(address: string): Promise<GeoPoint | null> {
  if (!address?.trim()) return null;
  try {
    const hash = await sha256hex(normalise(address));
    const { data, error } = await supabase
      .from("geocode_cache")
      .select("lat, lng")
      .eq("address_hash", hash)
      .maybeSingle();
    if (error) {
      console.warn("geocodeCache lookup error:", error.message);
      return null;
    }
    if (!data) return null;
    return { lat: Number(data.lat), lng: Number(data.lng) };
  } catch (err) {
    console.warn("geocodeCache lookup failed:", err);
    return null;
  }
}

/**
 * Store a geocoded address in the Supabase cache.
 * Silently ignores errors (e.g. if RLS blocks the insert for unauthenticated
 * routes) so the geocode result still works even if caching fails.
 */
export async function storeGeocode(address: string, point: GeoPoint): Promise<void> {
  if (!address?.trim()) return;
  try {
    const hash = await sha256hex(normalise(address));
    await supabase.from("geocode_cache").upsert(
      {
        address_hash: hash,
        address_raw: address,
        lat: point.lat,
        lng: point.lng,
        cached_at: new Date().toISOString(),
      },
      { onConflict: "address_hash", ignoreDuplicates: true }
    );
  } catch (err) {
    // Non-fatal — worst case we geocode the same address again next time.
    console.warn("geocodeCache store failed:", err);
  }
}
