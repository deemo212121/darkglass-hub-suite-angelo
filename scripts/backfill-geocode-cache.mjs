/**
 * Geocode cache backfill
 * ---------------------
 * Reads every distinct customer address from the Supabase `tickets` +
 * `customers` tables, geocodes them via the Google Maps Geocoding API,
 * and stores the results in `geocode_cache`.
 *
 * Skips any address already in the cache so it is safe to re-run.
 * Rate-limited to 10 requests/second (well inside the 50 QPS limit).
 *
 * Run once:
 *   node scripts/backfill-geocode-cache.mjs
 *
 * Requirements:
 *   - Node 18+ (uses fetch + crypto built-ins)
 *   - Fill in SUPABASE_SERVICE_ROLE_KEY below (Settings → API in dashboard)
 */

// ── Load .env from project root ──────────────────────────────────────────
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not found — rely on process.env being set externally
}
// ─────────────────────────────────────────────────────────────────────────

// ── Config ───────────────────────────────────────────────────────────────
const SUPABASE_URL        = process.env.VITE_SUPABASE_URL        || "https://vrgeuuiygskqtrotemir.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY    || "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE";
const GMAPS_API_KEY        = process.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSyBnTWvcdQZsXsohbrHLBiA3zsMGhVZYPbc";
const REQUESTS_PER_SECOND  = 10;   // keep well under Google's 50 QPS limit
// ─────────────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function sha256hex(text) {
  const data = new TextEncoder().encode(text);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function normalise(addr) {
  return addr.toLowerCase().replace(/[.,#\-\/]/g," ").replace(/\s+/g," ").trim();
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`Supabase GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPost(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",  // upsert — skip dupes silently
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase POST ${path} → ${r.status} ${await r.text()}`);
}

async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GMAPS_API_KEY}`;
  const r   = await fetch(url);
  const j   = await r.json();
  if (j.status === "OK" && j.results?.[0]) {
    const loc = j.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}

async function main() {
  if (SUPABASE_SERVICE_KEY === "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE") {
    console.error("❌  Provide your service role key via:");
    console.error("    Option A: set env var  SUPABASE_SERVICE_KEY=eyJ...");
    console.error("    Option B: edit the script and replace YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE");
    process.exit(1);
  }

  // Resolve company_id (required by geocode_cache NOT NULL constraint)
  console.log("🏢 Fetching company ID…");
  const companies = await sbGet("companies?select=id&limit=1");
  if (!companies.length) {
    console.error("❌  No company found in the database.");
    process.exit(1);
  }
  const COMPANY_ID = companies[0].id;
  console.log(`   Using company_id: ${COMPANY_ID}`);

  console.log("📋 Fetching customer addresses from Supabase…");

  // Addresses live in the `customers` table: address, city, state, zip
  const customers = await sbGet(
    "customers?select=address,city,state,zip&not.address.is.null&limit=10000"
  );
  console.log(`   Found ${customers.length} customer rows`);

  // Build distinct full address strings
  const addressSet = new Set();
  for (const c of customers) {
    const parts = [c.address, c.city, c.state, c.zip].filter(Boolean);
    if (parts.length >= 2) addressSet.add(parts.join(", "));
  }
  const addresses = Array.from(addressSet);
  console.log(`   ${addresses.length} unique addresses`);

  // Fetch already-cached hashes so we can skip them
  console.log("🔍 Loading existing cache entries…");
  const cached = await sbGet("geocode_cache?select=address_hash&limit=50000");
  const cachedSet = new Set(cached.map(r => r.address_hash));
  console.log(`   ${cachedSet.size} already cached`);

  // Geocode the remainder
  const toProcess = [];
  for (const addr of addresses) {
    const hash = await sha256hex(normalise(addr));
    if (!cachedSet.has(hash)) toProcess.push({ addr, hash });
  }
  console.log(`\n🚀 Geocoding ${toProcess.length} addresses (skipping ${addresses.length - toProcess.length} cached)\n`);

  if (toProcess.length === 0) {
    console.log("✅  Nothing to do — all addresses already cached.");
    return;
  }

  let done = 0, errors = 0;
  const intervalMs = Math.ceil(1000 / REQUESTS_PER_SECOND);

  for (const { addr, hash } of toProcess) {
    const result = await geocode(addr);
    if (result) {
      await sbPost("geocode_cache", {
        company_id:   COMPANY_ID,
        address_hash: hash,
        address_raw:  addr,
        lat:          result.lat,
        lng:          result.lng,
        cached_at:    new Date().toISOString(),
      });
      done++;
      if (done % 25 === 0) {
        console.log(`   ✓ ${done}/${toProcess.length}  (${errors} errors)`);
      }
    } else {
      errors++;
      console.warn(`   ⚠️  Could not geocode: ${addr}`);
    }
    await delay(intervalMs);
  }

  const cost = (toProcess.length / 1000 * 5).toFixed(2);
  console.log(`\n✅  Done!`);
  console.log(`   Geocoded:  ${done}`);
  console.log(`   Errors:    ${errors}`);
  console.log(`   Est. cost: ~$${cost} (${toProcess.length} API calls × $5/1000)`);
  console.log(`\n   These addresses will now be free on every future geocode call.`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
