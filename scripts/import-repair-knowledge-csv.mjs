/**
 * One-time bulk import: legacy ASC-style ticket export (downloadFile.csv) →
 * Supabase tickets/customers/visits, so completed repairs show up on Triage
 * → Repair Knowledge Base.
 *
 * Field mapping (source CSV column → DB column), chosen from the real
 * export's column semantics rather than guessed:
 *   - tickets.problem_description / visits.symptom_csr  ← SymptomByCx
 *       (Repair Knowledge Base's "Unit Problem")
 *   - visits.repair_type                                ← PartStatus
 *       (the export's one clean, structured repair-status vocabulary —
 *        "Not Diagnosed" / "Part Ordered" / "Partially Ordered" / etc.;
 *        this is what Repair Knowledge Base's "Part / Action" column falls
 *        back to when no `parts` rows exist for a ticket)
 *   - visits.repair_notes                                ← TriageNote +
 *       SymptomByTech + NoteInternal, joined
 *       (Repair Knowledge Base's "Outcome / Tech Support Guidance" —
 *        TriageNote in this export is literally tech-support-call-out
 *        guidance text; SymptomByTech/NoteInternal carry whatever
 *        diagnostic narrative exists)
 *   - visits.cause_of_failure                            ← SymptomByTech
 *       (secondary fallback if symptom_csr is blank)
 *
 * Deliberately NOT populated: the `parts` table / Part Number column. This
 * export has no structured part-number field — only narrative text that
 * sometimes *mentions* a part in passing. Regex-scraping part numbers out
 * of free text would fabricate data with no way to verify it's correct, so
 * imported tickets will show a real, honest "—" under Part Number rather
 * than a guessed value.
 *
 * Only rows whose StatusDesc maps to ticketData.ts's statusGroupOf() ===
 * "completed" (CL-Claimed / CL-Completed / *Data Closed*) actually show up
 * on Repair Knowledge Base — everything else still gets imported as a
 * normal ticket (so it's not silently dropped), it just won't appear on
 * that one page.
 *
 * Usage:
 *   node scripts/import-repair-knowledge-csv.mjs --dry-run [--limit=20]
 *   node scripts/import-repair-knowledge-csv.mjs [--limit=20]
 *
 * --dry-run parses + maps every row and prints a summary; makes NO network
 * calls. Drop --dry-run to actually write to Supabase. --limit caps how
 * many CSV rows are processed (handy for a small real test batch first).
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const CSV_PATH = args.find((a) => a.startsWith("--csv="))?.split("=")[1]
  || "C:/Users/user/Downloads/downloadFile.csv";

// ── Load .env ────────────────────────────────────────────────────────────
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

const SB_URL = env.VITE_SUPABASE_URL || "";
const SB_SERVICE = env.SUPABASE_SERVICE_KEY || "";

if (!DRY_RUN && (!SB_URL || !SB_SERVICE || SB_SERVICE.includes("YOUR_"))) {
  console.error("❌  VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY missing from .env (need for a real, non-dry-run import)");
  process.exit(1);
}

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

// ── RFC4180 CSV parser (handles quoted fields, embedded commas/newlines,
//    doubled "" escapes) ───────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function dateOnly(s) {
  const v = (s || "").trim();
  if (!v) return null;
  return v.slice(0, 10);
}
function tsOrNull(s) {
  const v = (s || "").trim();
  return v || null;
}
function join(...parts) {
  return parts.map((p) => (p || "").trim()).filter(Boolean).join("\n\n---\n\n");
}

// ── Parse the CSV ────────────────────────────────────────────────────────
const raw = readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/, "");
const rows = parseCsv(raw);
const header = rows[0];
const idx = (name) => {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`CSV missing expected column: ${name}`);
  return i;
};
const col = {
  refType: idx("RefType"), ticketNo: idx("TicketNo"), accountNo: idx("AccountNo"),
  accountName: idx("AccountName"), mfgName: idx("MfgName"), cxUserName: idx("CxUserName"),
  cxAddress1: idx("CxAddress1"), cxAddress2: idx("CxAddress2"), cxState: idx("CxState"),
  cxCity: idx("CxCity"), cxZip: idx("CxZipCode"), cxAddressNote: idx("CxAddressNote"),
  cxEmail: idx("CxEmail"), cxPhone: idx("CxPhone"), cxCell: idx("CxCellPhone"),
  cxCell2: idx("CxCellPhone2"), cxHome: idx("CxHomePhone"), postingDate: idx("PostingDate"),
  scheduleDate: idx("ScheduleDate"), slotDesc: idx("SlotDesc"), statusDesc: idx("StatusDesc"),
  redo: idx("Redo"), redoTicketNo: idx("RedoTicketNo"), aging: idx("Aging"),
  product: idx("Product"), modelCode: idx("ModelCode"), modelVersion: idx("ModelVersion"),
  serialNo: idx("SerialNo"), locationName: idx("LocationName"), techName: idx("TechName"),
  warrantyType: idx("WarrantyType"), warrantyTypeDesc: idx("WarrantyTypeDesc"),
  symptomByCx: idx("SymptomByCx"), symptomByTech: idx("SymptomByTech"),
  noteInternal: idx("NoteInternal"), triageNote: idx("TriageNote"), createTime: idx("CreateTime"),
  diagnosedYn: idx("DiagnosedYn"), partStatus: idx("PartStatus"), nCallAttempt: idx("nCallAttempt"),
};

const dataRows = rows.slice(1).filter((r) => (r[col.ticketNo] || "").trim());
const toProcess = dataRows.slice(0, LIMIT);

console.log(`\n━━━ Repair Knowledge CSV import ${DRY_RUN ? "(DRY RUN — no writes)" : "(LIVE)"} ━━━`);
console.log(`Source: ${CSV_PATH}`);
console.log(`CSV data rows: ${dataRows.length}   Processing: ${toProcess.length}${LIMIT !== Infinity ? ` (--limit=${LIMIT})` : ""}\n`);

function mapRow(r) {
  const ticketNo = r[col.ticketNo].trim();
  const fullName = r[col.cxUserName].trim();
  const phone = r[col.cxPhone].trim() || r[col.cxCell].trim() || r[col.cxHome].trim();
  const secondPhone = [r[col.cxCell].trim(), r[col.cxCell2].trim(), r[col.cxHome].trim()]
    .find((p) => p && p !== phone) || "";

  const customer = {
    first_name: "",
    last_name: "",
    full_name: fullName,
    phone,
    second_phone: secondPhone,
    email: r[col.cxEmail].trim(),
    address: r[col.cxAddress1].trim(),
    address2: r[col.cxAddress2].trim(),
    city: r[col.cxCity].trim(),
    state: r[col.cxState].trim(),
    zip: r[col.cxZip].trim(),
    address_note: r[col.cxAddressNote].trim(),
  };

  const ticket = {
    ticket_no: ticketNo,
    ticket_source: r[col.refType].trim(),
    warranty: r[col.warrantyTypeDesc].trim() || r[col.warrantyType].trim(),
    manufacturer: r[col.mfgName].trim(),
    account: r[col.accountNo].trim(),
    claim_company: r[col.accountName].trim(),
    model: r[col.modelCode].trim(),
    model_version: r[col.modelVersion].trim(),
    serial: r[col.serialNo].trim(),
    product_type: r[col.product].trim(),
    status: r[col.statusDesc].trim(),
    technician: r[col.techName].trim(),
    redo: r[col.redo].trim().toUpperCase() === "Y",
    original_ticket_no: r[col.redoTicketNo].trim(),
    schedule_date: dateOnly(r[col.scheduleDate]),
    time_slot: r[col.slotDesc].trim(),
    call_received_date: dateOnly(r[col.postingDate]),
    aging: parseInt(r[col.aging], 10) || 0,
    calls: parseInt(r[col.nCallAttempt], 10) || 0,
    location: r[col.locationName].trim(),
    part_order: r[col.partStatus].trim(),
    diagnosed: r[col.diagnosedYn].trim().toUpperCase() === "Y",
    problem_description: r[col.symptomByCx].trim(),
    internal_note: r[col.noteInternal].trim(),
    created_at: tsOrNull(r[col.createTime]) || tsOrNull(r[col.postingDate]) || undefined,
  };

  const visit = {
    visit_no: ticketNo,
    technician: r[col.techName].trim(),
    schedule_date: dateOnly(r[col.scheduleDate]),
    time_slot: r[col.slotDesc].trim(),
    activity: r[col.partStatus].trim(),
    repair_type: r[col.partStatus].trim(),
    repair_status: r[col.statusDesc].trim(),
    symptom_csr: r[col.symptomByCx].trim(),
    cause_of_failure: r[col.symptomByTech].trim(),
    repair_notes: join(r[col.triageNote], r[col.symptomByTech], r[col.noteInternal]),
    triage_note: r[col.triageNote].trim(),
    created_at: tsOrNull(r[col.createTime]) || undefined,
  };

  return { ticketNo, customer, ticket, visit };
}

if (DRY_RUN) {
  const mapped = toProcess.map(mapRow);
  const withModel = mapped.filter((m) => m.ticket.model);
  const completed = mapped.filter((m) => /cl-claimed|cl-completed|data.?closed/i.test(m.ticket.status));
  console.log(`Mapped ${mapped.length} rows.`);
  console.log(`  → ${withModel.length} have a Model (Repair Knowledge Base groups by model; blank-model rows are imported as tickets but won't appear on that page)`);
  console.log(`  → ${completed.length} have a "completed"-group status (these are the ones Repair Knowledge Base actually shows)\n`);
  console.log("Sample (first 3):");
  for (const m of mapped.slice(0, 3)) {
    console.log(`\n  Ticket ${m.ticketNo}`);
    console.log(`    customer.full_name : ${m.customer.full_name}`);
    console.log(`    ticket.model/status: ${m.ticket.model} / ${m.ticket.status}`);
    console.log(`    visit.symptom_csr  : ${m.visit.symptom_csr.slice(0, 100)}`);
    console.log(`    visit.repair_type  : ${m.visit.repair_type}`);
    console.log(`    visit.repair_notes : ${m.visit.repair_notes.slice(0, 150).replace(/\n/g, " ")}`);
  }
  console.log(`\nDry run complete — no data written. Re-run without --dry-run to import for real.`);
  process.exit(0);
}

// ── LIVE import ──────────────────────────────────────────────────────────
const companies = await sbGet("companies?select=id,company_name&legacy_code=eq.COMP001&limit=1");
if (!companies.length) { console.error("❌  No company found for legacy_code=COMP001"); process.exit(1); }
const COMPANY_ID = companies[0].id;
console.log(`🏢  Company: ${companies[0].company_name} (${COMPANY_ID})\n`);

let created = 0, updated = 0, skipped = 0, failed = 0;

for (let i = 0; i < toProcess.length; i++) {
  const r = toProcess[i];
  const { ticketNo, customer, ticket, visit } = mapRow(r);
  try {
    if (!ticketNo) { skipped++; continue; }

    // Customer upsert (match by company_id + full_name + zip, same pattern
    // scripts/sync-nsa-one-ticket.mjs already uses).
    let custId = null;
    if (customer.full_name) {
      const existingCust = await sbGet(
        `customers?select=id&company_id=eq.${COMPANY_ID}&full_name=eq.${encodeURIComponent(customer.full_name)}&zip=eq.${encodeURIComponent(customer.zip)}&limit=1`
      );
      if (existingCust.length) {
        custId = existingCust[0].id;
      } else {
        const inserted = await sbPost("customers", { company_id: COMPANY_ID, ...customer });
        custId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      }
    }

    // Ticket upsert (unique on company_id, ticket_no).
    const existingTicket = await sbGet(
      `tickets?select=id&company_id=eq.${COMPANY_ID}&ticket_no=eq.${encodeURIComponent(ticketNo)}&limit=1`
    );
    let ticketId;
    const ticketPayload = { company_id: COMPANY_ID, customer_id: custId, ...ticket };
    if (existingTicket.length) {
      ticketId = existingTicket[0].id;
      const { company_id: _c, customer_id: _cu, ...updatePayload } = ticketPayload;
      await sbPatch(`tickets?id=eq.${ticketId}`, updatePayload);
      updated++;
    } else {
      const inserted = await sbPost("tickets", ticketPayload);
      ticketId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      created++;
    }

    // Visit upsert (match by company_id + ticket_id + visit_no — no DB
    // unique constraint on this, so we do it manually to stay idempotent
    // on re-run).
    if (ticketId) {
      const existingVisit = await sbGet(
        `visits?select=id&company_id=eq.${COMPANY_ID}&ticket_id=eq.${ticketId}&visit_no=eq.${encodeURIComponent(visit.visit_no)}&limit=1`
      );
      const visitPayload = { company_id: COMPANY_ID, ticket_id: ticketId, ...visit };
      if (existingVisit.length) {
        await sbPatch(`visits?id=eq.${existingVisit[0].id}`, visitPayload);
      } else {
        await sbPost("visits", visitPayload);
      }
    }

    if ((i + 1) % 25 === 0 || i === toProcess.length - 1) {
      console.log(`  ${i + 1}/${toProcess.length}  (created ${created}, updated ${updated}, failed ${failed})`);
    }
  } catch (err) {
    failed++;
    console.error(`  ❌  ${ticketNo}: ${err.message}`);
  }
}

console.log(`\n✅  Done. Tickets created: ${created}  updated: ${updated}  skipped: ${skipped}  failed: ${failed}`);
console.log(`   Check: /m/triage/repair-knowledge`);
