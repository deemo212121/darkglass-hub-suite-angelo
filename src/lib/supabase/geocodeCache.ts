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
 *
 * SubtleCrypto only exists in a secure context (HTTPS, or the special-cased
 * localhost/127.0.0.1) — it's `undefined` when the dev server is reached
 * over plain http:// from another device on the LAN (e.g. http://192.168.x.x:8080),
 * which is fine for local testing but means the geocode cache can't hash
 * anything there. Warn once per session instead of once per address.
 */
let warnedNoSubtleCrypto = false;
function hasSubtleCrypto(): boolean {
  const available = typeof crypto !== "undefined" && !!crypto.subtle;
  if (!available && !warnedNoSubtleCrypto) {
    warnedNoSubtleCrypto = true;
    console.warn(
      "geocodeCache: crypto.subtle unavailable (not a secure context — http:// on a non-localhost address) — geocode caching disabled for this session, addresses will be re-geocoded every time."
    );
  }
  return available;
}

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
  if (!hasSubtleCrypto()) return null;
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
 * Bulk version of lookupGeocode for many addresses at once -- one batched
 * query against geocode_cache instead of a network round-trip per address.
 * Used to pre-warm the in-memory geocode cache before a page geocodes a
 * whole ticket list (Work Map, Work Planner): already-cached addresses
 * resolve instantly with zero network calls afterward, instead of each one
 * paying its own round-trip through geocode()'s throttled per-call path.
 *
 * Returns a Map keyed by the exact input address string (not normalized/
 * hashed) -> GeoPoint. An address absent from the map is a cache miss --
 * caller falls through to a live geocode() + storeGeocode() for it as usual.
 */
const GEOCODE_LOOKUP_BATCH_SIZE = 200;
const GEOCODE_LOOKUP_CONCURRENCY = 5;

export async function bulkLookupGeocode(addresses: string[]): Promise<Map<string, GeoPoint>> {
  const out = new Map<string, GeoPoint>();
  const uniqueAddresses = Array.from(new Set(addresses.filter((a) => a?.trim())));
  if (uniqueAddresses.length === 0 || !hasSubtleCrypto()) return out;

  // Multiple raw address strings can normalize to the same hash (e.g.
  // "123 Main St." vs "123 main st") -- keep every original so all of them
  // get the resolved point, not just whichever happened to hash last.
  const hashToAddresses = new Map<string, string[]>();
  await Promise.all(
    uniqueAddresses.map(async (addr) => {
      const hash = await sha256hex(normalise(addr));
      const list = hashToAddresses.get(hash) ?? [];
      list.push(addr);
      hashToAddresses.set(hash, list);
    })
  );

  const hashes = Array.from(hashToAddresses.keys());
  const batches: string[][] = [];
  for (let i = 0; i < hashes.length; i += GEOCODE_LOOKUP_BATCH_SIZE) batches.push(hashes.slice(i, i + GEOCODE_LOOKUP_BATCH_SIZE));

  for (let i = 0; i < batches.length; i += GEOCODE_LOOKUP_CONCURRENCY) {
    await Promise.all(
      batches.slice(i, i + GEOCODE_LOOKUP_CONCURRENCY).map(async (batch) => {
        const { data, error } = await supabase
          .from("geocode_cache")
          .select("address_hash, lat, lng")
          .in("address_hash", batch);
        if (error) {
          console.warn("bulkLookupGeocode error:", error.message);
          return;
        }
        for (const row of data ?? []) {
          const point = { lat: Number((row as any).lat), lng: Number((row as any).lng) };
          for (const addr of hashToAddresses.get((row as any).address_hash) ?? []) out.set(addr, point);
        }
      })
    );
  }
  return out;
}

/**
 * Store a geocoded address in the Supabase cache.
 * Silently ignores errors (e.g. if RLS blocks the insert for unauthenticated
 * routes) so the geocode result still works even if caching fails.
 */
export async function storeGeocode(address: string, point: GeoPoint): Promise<void> {
  if (!address?.trim()) return;
  if (!hasSubtleCrypto()) return;
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
      // Must match the actual unique constraint (company_id, address_hash)
      // from 0026 — "address_hash" alone isn't a real constraint and
      // PostgREST rejects the upsert with a 400 if the target doesn't
      // match one exactly. company_id itself is left off the payload
      // deliberately; 0054 defaults it to auth_company_id() at the DB
      // level, since RLS scopes reads per-company anyway.
      { onConflict: "company_id,address_hash", ignoreDuplicates: true }
    );
  } catch (err) {
    // Non-fatal — worst case we geocode the same address again next time.
    console.warn("geocodeCache store failed:", err);
  }
}
