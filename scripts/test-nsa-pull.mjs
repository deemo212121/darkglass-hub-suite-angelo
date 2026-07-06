/**
 * NSA API test — pulls 1 dispatch by number to verify auth + response shape.
 * Run:  node scripts/test-nsa-pull.mjs
 *
 * Reads NSA_BASE_URL / NSA_API_KEY / NSA_SECRET from .env automatically.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
const env = {};
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
} catch { /* .env not found */ }

const BASE_URL = env.NSA_BASE_URL || "https://api.nsaweb.com";
const API_KEY  = env.NSA_API_KEY  || "";
const SECRET   = env.NSA_SECRET   || "";

if (!API_KEY || !SECRET) {
  console.error("❌  NSA_API_KEY / NSA_SECRET not set in .env");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${API_KEY}:${SECRET}`).toString("base64");
const headers = { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" };

async function get(path) {
  const url = `${BASE_URL}${path}`;
  console.log(`→ GET ${url}`);
  const r = await fetch(url, { headers });
  const text = await r.text();
  console.log(`← ${r.status} ${r.statusText}`);
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, ok: r.ok, body: json, raw: text };
}

async function main() {
  console.log("\n━━━ NSA API Test ━━━");
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Auth     : Basic ***${API_KEY.slice(-4)}:***${SECRET.slice(-4)}\n`);

  // ── Step 1: Try to get a list of dispatches (no date filter) ─────────────
  console.log("1️⃣  GET /dispatches (no filters — first page)\n");
  const list = await get("/dispatches?limit=1");
  console.log(JSON.stringify(list.body, null, 2).slice(0, 2000));

  if (!list.ok) {
    console.error("\n❌  List call failed — check base URL and credentials.");
    console.log("\nRaw response:", list.raw.slice(0, 500));

    // Try alternate common base URLs
    const alternates = [
      "https://api.nsaweb.com/v1",
      "https://api.nsaweb.com/api",
      "https://sfapi.nsaweb.com",
      "https://sfapi.nsaweb.com/v1",
    ];
    console.log("\n🔍  Trying alternate base URLs...");
    for (const alt of alternates) {
      const r = await fetch(`${alt}/dispatches?limit=1`, { headers }).catch(() => null);
      if (r) {
        console.log(`   ${alt}/dispatches → ${r.status}`);
        if (r.ok || r.status === 200) {
          console.log(`   ✅  WORKS: ${alt}`);
          const body = await r.json().catch(() => r.text());
          console.log(JSON.stringify(body, null, 2).slice(0, 1000));
          break;
        }
      }
    }
    return;
  }

  // ── Step 2: Pull the specific dispatch from the sample ───────────────────
  const SAMPLE_DISPATCH = "AAN20260636059439";
  console.log(`\n2️⃣  GET /dispatches/${SAMPLE_DISPATCH}\n`);
  const detail = await get(`/dispatches/${SAMPLE_DISPATCH}`);
  console.log(JSON.stringify(detail.body, null, 2).slice(0, 3000));

  if (detail.ok) {
    console.log("\n✅  Successfully pulled dispatch detail!");
    const d = detail.body?.data ?? detail.body;
    console.log(`\n   dispatchNumber : ${d?.dispatchNumber ?? "—"}`);
    console.log(`   caseNumber     : ${d?.caseNumber ?? "—"}`);
    console.log(`   status         : ${d?.status ?? "—"}`);
    console.log(`   customer       : ${[d?.firstName, d?.lastName].filter(Boolean).join(" ") || "—"}`);
    console.log(`   brand/model    : ${d?.brand ?? "—"} / ${d?.model ?? "—"}`);
    console.log(`   serial         : ${d?.serial ?? "—"}`);
    console.log(`   address        : ${[d?.address1, d?.city, d?.stateProvince, d?.postalCode].filter(Boolean).join(", ") || "—"}`);
    console.log(`   scheduleDate   : ${d?.scheduleDate ?? "—"} (timeSlot: ${d?.timeSlot ?? "—"})`);
    console.log(`   routeName      : ${d?.routeName ?? "—"}`);
    console.log(`   deductible     : ${d?.deductible ?? "—"}`);
    console.log(`   preAuth        : LABOR:${d?.preAuthLabor} PARTS:${d?.preAuthParts} TOTAL:${d?.preAuthTotal}`);
    console.log(`   validCoverage  : ${d?.estimateRules?.validCoverageTypeCodes?.join(", ") ?? "—"}`);

    // ── Step 3: Sync this dispatch into Supabase ─────────────────────────────
    console.log("\n3️⃣  Syncing dispatch into Supabase…\n");
    const SUPABASE_URL = env.VITE_SUPABASE_URL || "https://vrgeuuiygskqtrotemir.supabase.co";
    const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY || "";

    if (!SUPABASE_SERVICE_KEY || SUPABASE_SERVICE_KEY === "YOUR_SERVICE_ROLE_KEY_HERE") {
      console.warn("   ⚠️  SUPABASE_SERVICE_KEY not set — skipping Supabase sync (read-only test)");
      console.log("\n✅  Mock API pull succeeded. Set SUPABASE_SERVICE_KEY to test full sync.");
      return;
    }

    // Look up company_id
    const compR = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const comps = await compR.json();
    if (!comps?.length) { console.error("❌  No company found"); return; }
    const companyId = comps[0].id;

    // Build customer + ticket payload matching upsert structure
    const dispatch = detail.body;
    const firstName = dispatch.firstName ?? "";
    const lastName  = dispatch.lastName  ?? "";
    const fullName  = [firstName, lastName].filter(Boolean).join(" ");

    // Upsert customer
    const custPayload = {
      first_name: firstName, last_name: lastName, full_name: fullName,
      phone: dispatch.homePhone ?? "", second_phone: dispatch.cellPhone ?? "", email: "",
      address: dispatch.address1 ?? "", address2: dispatch.address2 ?? "",
      city: dispatch.city ?? "", state: dispatch.stateProvince ?? "", zip: dispatch.postalCode ?? "",
    };
    const custR = await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(custPayload),
    });
    const custData = await custR.json();
    const custId = custData?.[0]?.id ?? custData?.id;
    console.log(`   Customer upsert → ${custR.status} (id: ${custId ?? "—"})`);

    // Upsert ticket
    const preAuth = [
      dispatch.preAuthLabor != null ? `LABOR: ${dispatch.preAuthLabor}` : "",
      dispatch.preAuthParts != null ? `PARTS: ${dispatch.preAuthParts}` : "",
      dispatch.preAuthTotal != null ? `TOTAL: ${dispatch.preAuthTotal}` : "",
    ].filter(Boolean).join("  ");

    const ticketPayload = {
      ticket_no: dispatch.dispatchNumber,
      company_id: companyId,
      customer_id: custId,
      ticket_source: "NSA",
      claim_company: "NSA",
      account: "NSA",
      original_ticket_no: dispatch.caseNumber ?? "",
      manufacturer: dispatch.brand ?? "",
      model: dispatch.model ?? "",
      serial: dispatch.serial ?? "",
      product_type: dispatch.productCategory ?? "",
      model_version: dispatch.version ?? "",
      schedule_date: dispatch.scheduleDate ?? null,
      time_slot: dispatch.timeSlot === "A" ? "8-12" : dispatch.timeSlot === "P" ? "1-5" : "ANYTIME",
      status: "CSR-Needs Scheduling",
      location: "",
      problem_description: dispatch.complaint ?? "",
      internal_note: preAuth,
      updated_at: new Date().toISOString(),
    };

    const tickR = await fetch(`${SUPABASE_URL}/rest/v1/tickets`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(ticketPayload),
    });
    const tickBody = await tickR.text();
    if (tickR.ok) {
      console.log(`   Ticket upsert → ${tickR.status} ✅`);
      console.log(`\n✅  Dispatch ${dispatch.dispatchNumber} is now in Supabase!`);
      console.log(`   Open the ticket list and search for: ${dispatch.dispatchNumber}`);
    } else {
      console.error(`   Ticket upsert → ${tickR.status} ❌`);
      console.error(`   ${tickBody.substring(0, 300)}`);
    }
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
