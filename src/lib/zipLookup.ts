/**
 * Live US zip → city/state lookup.
 *
 * Uses zippopotam.us (free, no API key, CORS-enabled) to resolve a 5-digit
 * ZIP to its official place + state. Results cached in memory + sessionStorage
 * so repeat hits on the same ZIP are instant.
 *
 * NOTE: zippopotam.us returns a "places" array — usually one entry, but
 * some ZIPs span multiple post-office cities. We surface the primary
 * (first) entry as the canonical match, plus the full list so the UI
 * can warn when the user's typed city matches an alternate place.
 */

export interface ZipLookupPlace {
  /** Official place name from USPS. */
  city: string;
  /** Full state name ("Texas"). */
  state: string;
  /** 2-letter state abbreviation ("TX"). */
  stateCode: string;
  /** Optional latitude / longitude. */
  latitude?: string;
  longitude?: string;
}

export interface ZipLookupResult {
  zip: string;
  /** Canonical (first) place — what we pre-fill into the form. */
  primary: ZipLookupPlace;
  /** Every place this ZIP covers (often just one). */
  places: ZipLookupPlace[];
}

const CACHE = new Map<string, ZipLookupResult | null>();
const STORAGE_PREFIX = "ahs:ziplookup:";

function readCache(zip: string): ZipLookupResult | null | undefined {
  if (CACHE.has(zip)) return CACHE.get(zip);
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(STORAGE_PREFIX + zip) : null;
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as ZipLookupResult | null;
    CACHE.set(zip, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function writeCache(zip: string, value: ZipLookupResult | null): void {
  CACHE.set(zip, value);
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_PREFIX + zip, JSON.stringify(value));
    }
  } catch {
    // sessionStorage quota / disabled — fine, in-memory cache still holds.
  }
}

/**
 * Resolve a 5-digit US ZIP to its canonical city + state. Returns null
 * when the ZIP is invalid or the lookup service is unreachable.
 */
export async function lookupZipCityState(zip: string): Promise<ZipLookupResult | null> {
  const clean = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (clean.length !== 5) return null;

  const cached = readCache(clean);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(`https://api.zippopotam.us/us/${clean}`, {
      method: "GET",
      // Public endpoint — no credentials, no auth.
    });
    if (!response.ok) {
      // 404 = ZIP not found; cache the negative result so we don't
      // hammer the API.
      writeCache(clean, null);
      return null;
    }
    const data = (await response.json()) as {
      "post code": string;
      country: string;
      "country abbreviation": string;
      places: Array<{
        "place name": string;
        state: string;
        "state abbreviation": string;
        latitude?: string;
        longitude?: string;
      }>;
    };
    const places: ZipLookupPlace[] = (data.places || []).map((p) => ({
      city: p["place name"],
      state: p.state,
      stateCode: p["state abbreviation"],
      latitude: p.latitude,
      longitude: p.longitude,
    }));
    if (places.length === 0) {
      writeCache(clean, null);
      return null;
    }
    const result: ZipLookupResult = { zip: clean, primary: places[0], places };
    writeCache(clean, result);
    return result;
  } catch {
    // Network blip — don't cache so the next attempt can retry.
    return null;
  }
}

/**
 * Strict comparison helper: does the user-typed city/state look like a
 * match for the resolved ZIP? Tolerant of casing and minor whitespace.
 * Accepts either the full state name ("Texas") or the 2-letter code
 * ("TX") on the input side.
 */
export function cityStateMatchesZip(
  result: ZipLookupResult,
  userCity: string,
  userState: string,
): boolean {
  const c = String(userCity || "").trim().toLowerCase();
  const s = String(userState || "").trim().toLowerCase();
  if (!c && !s) return true; // nothing typed yet
  const matchCity = !c || result.places.some((p) => p.city.toLowerCase() === c);
  const matchState =
    !s ||
    result.places.some(
      (p) => p.state.toLowerCase() === s || p.stateCode.toLowerCase() === s,
    );
  return matchCity && matchState;
}
