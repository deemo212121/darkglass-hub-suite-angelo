/**
 * NSA → Supabase: sync ONE test dispatch from the mock API.
 * Now that set_company_id() is fixed, direct REST inserts work with service role.
 * Run:  node scripts/sync-nsa-one-ticket.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
try {
  for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
} catch { /* no .env */ }

const NSA_BASE   = env.NSA_BASE_URL || "https://private-anon-729e178652-nsasfapi.apiary-mock.com";
const NSA_KEY    = env.NSA_API_KEY  || "";
const NSA_SECRET = env.NSA_SECRET   || "";
const SB_URL     = env.VITE_SUPABASE_URL || "https://vrgeuuiygskqtrotemir.supabase.co";
const SB_SERVICE = env.SUPABASE_SERVICE_KEY || "";

if (!NSA_KEY || !NSA_SECRET) { console.error("❌  NSA_API_KEY / NSA_SECRET missing"); process.exit(1); }
if (!SB_SERVICE || SB_SERVICE.includes("YOUR_")) { console.error("❌  SUPABASE_SERVICE_KEY missing"); process.exit(1); }

const nsaAuth = "Basic " + Buffer.from(`${NSA_KEY}:${NSA_SECRET}`).toString("base64");
const sbH = {
  apikey: SB_SERVICE,
  Authorization: `Bearer ${SB_SERVICE}`,
  "Content-Type": "application/json",
};

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbH });
  if (!r.ok) throw new Error(`SB GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPost(path, body, prefer = "return=representation") {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...sbH, Prefer: prefer },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SB POST ${path} → ${r.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...sbH, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`SB PATCH ${path} → ${r.status} ${await r.text()}`);
}

// ── Step 1: Pull dispatch from NSA mock ───────────────────────────────────
console.log(`\n━━━ NSA → Supabase: 1-ticket sync ━━━`);
console.log(`Source: ${NSA_BASE}\n`);

const nsaR = await fetch(`${NSA_BASE}/dispatches/AAN20260636059439`, {
  headers: { Authorization: nsaAuth, Accept: "application/json" },
});
if (!nsaR.ok) { console.error(`❌  NSA pull failed: ${nsaR.status}`); process.exit(1); }
const d = await nsaR.json();

console.log(`✅  Pulled from NSA mock:`);
console.log(`   Dispatch : ${d.dispatchNumber}  (case: ${d.caseNumber})`);
console.log(`   Customer : ${d.firstName} ${d.lastName}`);
console.log(`   Address  : ${[d.address1, d.city, d.stateProvince, d.postalCode].filter(Boolean).join(", ")}`);
console.log(`   Product  : ${d.brand} ${d.model} / serial: ${d.serial}`);
console.log(`   Schedule : ${d.scheduleDate} slot: ${d.timeSlot}`);
console.log(`   Complaint: ${d.complaint}`);
console.log(`   Route    : ${d.routeName}`);
console.log(`   PreAuth  : LABOR:${d.preAuthLabor} PARTS:${d.preAuthParts} TOTAL:${d.preAuthTotal}`);

// ── Step 2: Get company_id ────────────────────────────────────────────────
const companies = await sbGet("companies?select=id,company_name&limit=1");
if (!companies.length) { console.error("❌  No company in Supabase"); process.exit(1); }
const COMPANY_ID = companies[0].id;
console.log(`\n🏢  Company: ${companies[0].company_name} (${COMPANY_ID})`);

// ── Step 3: Upsert customer ───────────────────────────────────────────────
const fullName = `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim();
const custPayload = {
  company_id:   COMPANY_ID,
  first_name:   d.firstName  ?? "",
  last_name:    d.lastName   ?? "",
  full_name:    fullName,
  phone:        d.homePhone  ?? "",
  second_phone: d.cellPhone  ?? "",
  email:        "",
  address:      d.address1   ?? "",
  address2:     d.address2   ?? "",
  city:         d.city       ?? "",
  state:        d.stateProvince ?? "",
  zip:          d.postalCode ?? "",
};

let custId;
const existingCust = await sbGet(
  `customers?select=id&company_id=eq.${COMPANY_ID}&full_name=eq.${encodeURIComponent(fullName)}&zip=eq.${encodeURIComponent(d.postalCode ?? "")}&limit=1`
);
if (existingCust.length) {
  custId = existingCust[0].id;
  console.log(`\n👤  Customer exists: ${fullName} (id: ${custId})`);
} else {
  const inserted = await sbPost("customers", custPayload);
  custId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
  console.log(`\n👤  Customer created: ${fullName} (id: ${custId})`);
}

// ── Step 4: Build ticket payload ──────────────────────────────────────────
const timeBlockMap = { A: "8-12", P: "1-5", D: "ANYTIME", E: "EVENING" };
const timeSlot = timeBlockMap[String(d.timeSlot || "").toUpperCase()] || "ANYTIME";

const preAuth = [
  d.preAuthLabor != null ? `LABOR: ${d.preAuthLabor}` : "",
  d.preAuthParts != null ? `PARTS: ${d.preAuthParts}` : "",
  d.preAuthTotal != null ? `TOTAL: ${d.preAuthTotal}` : "",
].filter(Boolean).join("  ");

const validCoverage    = (d.estimateRules?.validCoverageTypeCodes  || []).join(", ");
const requiredCoverage = (d.estimateRules?.requiredCoverageTypeCodes || []).join(", ");

const internalNote = [
  preAuth,
  d.specialInstructions ? `⚡ ${d.specialInstructions}` : "",
  validCoverage    ? `Coverage: ${validCoverage}`    : "",
  requiredCoverage ? `Required: ${requiredCoverage}` : "",
].filter(Boolean).join(" | ");

const ticketPayload = {
  company_id:          COMPANY_ID,
  customer_id:         custId,
  ticket_no:           d.dispatchNumber,
  ticket_source:       "NSA",
  claim_company:       "NSA",
  account:             "NSA",
  original_ticket_no:  d.caseNumber        ?? "",
  manufacturer:        d.brand             ?? "",
  model:               d.model             ?? "",
  model_version:       d.version           ?? d.modelVersion ?? "",
  serial:              d.serial            ?? "",
  product_type:        d.productCategory   ?? "",
  schedule_date:       d.scheduleDate      || null,
  time_slot:           timeSlot,
  status:              "CSR-Needs Scheduling",
  location:            "",
  problem_description: d.complaint         ?? "",
  internal_note:       internalNote,
  updated_at:          new Date().toISOString(),
};

// ── Step 5: Upsert ticket ─────────────────────────────────────────────────
const existingTicket = await sbGet(
  `tickets?select=id&company_id=eq.${COMPANY_ID}&ticket_no=eq.${encodeURIComponent(d.dispatchNumber)}&limit=1`
);

if (existingTicket.length) {
  const ticketId = existingTicket[0].id;
  const { company_id: _, customer_id: __, ...updatePayload } = ticketPayload;
  await sbPatch(`tickets?id=eq.${ticketId}`, updatePayload);
  console.log(`\n🎫  Ticket updated (id: ${ticketId})`);
} else {
  const inserted = await sbPost("tickets", ticketPayload);
  const ticketId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
  console.log(`\n🎫  Ticket created (id: ${ticketId})`);
}

console.log(`\n✅  Done! Dispatch "${d.dispatchNumber}" is now in Supabase.`);
console.log(`   Search for it in the ticket list, or open: /ticket/${d.dispatchNumber}`);
