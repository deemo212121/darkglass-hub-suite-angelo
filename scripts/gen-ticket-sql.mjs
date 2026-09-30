// Generates a one-off ticket import SQL file from a ServicePower-format
// export CSV. Field mapping is derived from real, live tickets rows
// (confirmed via direct Supabase query) and from
// convertCallToTicket()/upsertTicketFromServicePower in
// src/lib/servicePowerSync.ts and src/lib/supabase/tickets.ts:
//   status          <- StatusDesc            (already AHS-style, e.g. "OP-Ready for Service")
//   warranty        <- WarrantyType           (IW / OW / CLPW / XW / UNK — raw code, matches live rows)
//   manufacturer    <- MfgAbbName             (e.g. "GENERAL ELECTRIC")
//   account         <- MfgName                (e.g. "GE" — short code, matches live rows' `account`)
//   account_no      <- AccountNo              (servicer account, e.g. "GSL00002")
//   product_type    <- Product                (e.g. "Refrigerator")
//   model           <- ModelCode
//   model_version   <- ModelVersion
//   serial          <- SerialNo
//   technician      <- TechName               (free text, NOT a FK — matches live rows)
//   location        <- LocationName           (free text, NOT a FK — Branch is blank in this export)
//   redo            <- Redo ("Y" -> "Yes", else "")
//   ticket_source   <- RefType: literal "NSA" for NSA-origin rows, else the
//                      claim-company name (this CSV's MfgName, e.g. "GE",
//                      "ASSURANT SOLUTIONS", "SQUARE TRADE") — matches
//                      convertCallToTicket()/nsaSync.ts, NOT a raw RefType passthrough.
//   claim_company   <- same value as ticket_source
//   schedule_date   <- ScheduleDate           (DD/MM/YYYY HH:mm -> date)
//   call_received_date <- CreateTime          (DD/MM/YYYY HH:mm -> date), falls back to PostingDate
//   problem_description <- SymptomByCx
//   internal_note   <- NoteInternal
//   diagnosed       <- DiagnosedYn ("Y"/"N")
//   aging           <- Aging (int)
//   calls           <- nCallAttempt (int)
//   customer_pref   <- boolean: true if CxPreferredDate is non-blank
//
// Customer: one new customers row per NEW ticket (matches the observed
// live pattern — every ticket has its own customer_id, no global customer
// dedupe in this codebase), built from CxUserName/CxAddress1/CxAddress2/
// CxCity/CxState/CxZipCode/CxEmail/CxPhone/CxCellPhone.
//
// Safety (both required — see below):
//   - customers/tickets both have a BEFORE INSERT trigger
//     (trg_..._company, migration 0001) that overwrites company_id with
//     auth_company_id() unless the caller is_superadmin() with an explicit
//     company_id. auth_company_id() reads request.jwt.claims->>'sub' and
//     matches it to profiles.firebase_uid. The Supabase SQL Editor has no
//     such claim, so it resolves to NULL and clobbers company_id — a plain
//     `insert into customers (company_id, ...) values ('uuid', ...)` WILL
//     fail with "null value in column company_id" no matter how correct the
//     literal is. Both tables also FORCE ROW LEVEL SECURITY.
//     Fix: impersonate a real profile for the transaction via
//     set_config('request.jwt.claims', ...) so auth_company_id() resolves
//     to that profile's real company, then insert normally.
//   - Ticket numbers already present (per company_id, matching the unique
//     index from migration 0017) are skipped via `if not exists` BEFORE the
//     customer row is even inserted — checking only the tickets insert's
//     own ON CONFLICT would still insert an orphan customer for every
//     already-existing ticket.
//   - Each ticket is its own begin/exception sub-block so one bad row logs
//     an error instead of rolling back the whole batch.
//   - Results go into a temp _ticket_import_log table — a plain do $$ block
//     always shows "Success. No rows returned" even when rows failed, so
//     query the log table after running to see what actually happened.
//
// Usage: node gen-ticket-sql.mjs <input.csv> <output.sql> [numParts]
// numParts (default 1) splits the tickets across N self-contained files —
// each gets its own header/impersonation/log-table/footer — since the
// Supabase SQL Editor rejects very large single queries ("Query is too
// large to be run via the SQL Editor") once a batch gets into the
// hundreds of tickets. Output for numParts > 1 is written to
// <output-without-.sql>.partN.sql.

import fs from "node:fs";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      // Only a quote at the very start of a field opens quoted mode — a
      // stray unescaped quote later in an otherwise-unquoted field (common
      // in real CSR note exports, e.g. `stated " We have received...`)
      // must be treated as a literal character, not a parser-state
      // toggle. Treating it as a toggle silently swallows every comma/
      // newline until the next stray quote, corrupting every field after
      // it in the row (confirmed live: shifted a free-text note into the
      // `diagnosed` boolean column and broke the insert).
      if (c === '"' && field.length === 0) inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ""));
}

function sqlStr(v) {
  if (v === undefined || v === null || v === "") return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? String(n) : "0";
}

function sqlBool(v) {
  return v ? "true" : "false";
}

// "22/09/2026 00:00" -> "2026-09-22"
function ddmmyyyyToIso(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const [, , inPath, outPath, numPartsArg] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node gen-ticket-sql.mjs <input.csv> <output.sql> [numParts]");
  process.exit(1);
}
const numParts = Math.max(1, parseInt(numPartsArg, 10) || 1);

const text = fs.readFileSync(inPath, "utf8");
const rows = parseCsv(text);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const dataRows = rows.slice(1);

// Builds one full, self-contained SQL script (own header/impersonation/log
// table/footer) for the given slice of CSV rows.
function buildSql(chunkRows, partLabel) {
const out = [];
out.push("-- Generated by gen-ticket-sql.mjs — one-off ticket import");
out.push(`-- ${chunkRows.length} ticket rows${partLabel ? ` (${partLabel})` : ""}`);
out.push("-- Run ONCE in the Supabase SQL Editor, then delete this file (and the source CSV) — both contain real customer PII.");
out.push("-- Safe to re-run after a partial failure: already-imported ticket numbers are skipped, not duplicated.");
out.push("");
out.push("drop table if exists _ticket_import_log;");
out.push("create temporary table _ticket_import_log (");
out.push("  ticket_no text,");
out.push("  result text,");
out.push("  detail text");
out.push(");");
out.push("");
out.push("do $$");
out.push("declare");
out.push("  v_company_id uuid;");
out.push("  v_firebase_uid text;");
out.push("  v_customer_id uuid;");
out.push("  v_inserted int := 0;");
out.push("  v_skipped int := 0;");
out.push("  v_errors int := 0;");
out.push("begin");
out.push("  select p.company_id, p.firebase_uid");
out.push("    into v_company_id, v_firebase_uid");
out.push("    from profiles p");
out.push("    where p.company_id is not null and p.firebase_uid is not null");
out.push("    order by p.created_at asc");
out.push("    limit 1;");
out.push("");
out.push("  if v_company_id is null then");
out.push("    raise exception 'No profile with a company_id + firebase_uid found — set v_company_id/v_firebase_uid explicitly and re-run.';");
out.push("  end if;");
out.push("");
out.push("  perform set_config('request.jwt.claims', json_build_object('sub', v_firebase_uid)::text, true);");
out.push("");

let skipped = 0;
for (const r of chunkRows) {
  const get = (col) => (idx[col] !== undefined ? (r[idx[col]] ?? "").trim() : "");

  const ticketNo = get("TicketNo");
  if (!ticketNo) { skipped++; continue; }

  const custName = get("CxUserName");
  const custFirst = custName.split(/\s+/)[0] || "";
  const custLast = custName.split(/\s+/).slice(1).join(" ");
  const custAddr1 = get("CxAddress1");
  const custAddr2 = get("CxAddress2");
  const custCity = get("CxCity");
  const custState = get("CxState");
  const custZip = get("CxZipCode");
  const custEmail = get("CxEmail");
  const custPhone = get("CxPhone") || get("CxCellPhone") || get("CxHomePhone");
  const custPhone2 = get("CxCellPhone2") || get("CxCellPhone");

  const status = get("StatusDesc");
  const warranty = get("WarrantyType");
  const manufacturer = get("MfgAbbName");
  const account = get("MfgName");
  const accountNo = get("AccountNo");
  const productType = get("Product");
  const model = get("ModelCode");
  const modelVersion = get("ModelVersion");
  const serial = get("SerialNo");
  const technician = get("TechName");
  const location = get("LocationName") || get("Branch");
  const redoRaw = get("Redo");
  const redo = /^y/i.test(redoRaw) ? "Yes" : "";
  const refType = get("RefType");
  const ticketSource = refType === "NSA" ? "NSA" : (account || refType);
  const claimCompany = ticketSource;
  const scheduleDate = ddmmyyyyToIso(get("ScheduleDate"));
  const callReceivedDate = ddmmyyyyToIso(get("CreateTime")) || ddmmyyyyToIso(get("PostingDate"));
  const problemDescription = get("SymptomByCx");
  const internalNote = get("NoteInternal");
  const diagnosed = get("DiagnosedYn");
  const aging = get("Aging");
  const calls = get("nCallAttempt");
  const cxPreferredDate = get("CxPreferredDate");

  out.push(`  -- Ticket ${ticketNo}`);
  out.push(`  begin`);
  out.push(`    if not exists (select 1 from tickets where company_id = v_company_id and ticket_no = ${sqlStr(ticketNo)}) then`);
  out.push(`      insert into customers (`);
  out.push(`        company_id, first_name, last_name, full_name, phone, second_phone,`);
  out.push(`        email, address, address2, city, state, zip, address_note`);
  out.push(`      ) values (`);
  out.push(`        v_company_id, ${sqlStr(custFirst)}, ${sqlStr(custLast)}, ${sqlStr(custName)}, ${sqlStr(custPhone)}, ${sqlStr(custPhone2)},`);
  out.push(`        ${sqlStr(custEmail)}, ${sqlStr(custAddr1)}, ${sqlStr(custAddr2)}, ${sqlStr(custCity)}, ${sqlStr(custState)}, ${sqlStr(custZip)}, null`);
  out.push(`      )`);
  out.push(`      returning id into v_customer_id;`);
  out.push(`      insert into tickets (`);
  out.push(`        company_id, ticket_no, customer_id, ticket_source, claim_company, warranty, manufacturer, account, account_no,`);
  out.push(`        model, model_version, serial, product_type, status, redo, schedule_date, call_received_date,`);
  out.push(`        technician, location, problem_description, internal_note, diagnosed, aging, calls, customer_pref,`);
  out.push(`        created_at, updated_at`);
  out.push(`      ) values (`);
  out.push(`        v_company_id, ${sqlStr(ticketNo)}, v_customer_id, ${sqlStr(ticketSource)}, ${sqlStr(claimCompany)}, ${sqlStr(warranty)}, ${sqlStr(manufacturer)}, ${sqlStr(account)}, ${sqlStr(accountNo)},`);
  out.push(`        ${sqlStr(model)}, ${sqlStr(modelVersion)}, ${sqlStr(serial)}, ${sqlStr(productType)}, ${sqlStr(status)}, ${sqlStr(redo)}, ${sqlStr(scheduleDate)}, ${sqlStr(callReceivedDate)},`);
  out.push(`        ${sqlStr(technician)}, ${sqlStr(location)}, ${sqlStr(problemDescription)}, ${sqlStr(internalNote)}, ${sqlStr(diagnosed)}, ${sqlInt(aging)}, ${sqlInt(calls)}, ${sqlBool(!!cxPreferredDate)},`);
  out.push(`        coalesce(${sqlStr(callReceivedDate)}, now()), now()`);
  out.push(`      );`);
  out.push(`      v_inserted := v_inserted + 1;`);
  out.push(`      insert into _ticket_import_log values (${sqlStr(ticketNo)}, 'inserted', null);`);
  out.push(`    else`);
  out.push(`      v_skipped := v_skipped + 1;`);
  out.push(`      insert into _ticket_import_log values (${sqlStr(ticketNo)}, 'skipped', null);`);
  out.push(`    end if;`);
  out.push(`  exception when others then`);
  out.push(`    v_errors := v_errors + 1;`);
  out.push(`    insert into _ticket_import_log values (${sqlStr(ticketNo)}, 'error', sqlerrm || ' (' || sqlstate || ')');`);
  out.push(`  end;`);
  out.push("");
}

out.push("  insert into _ticket_import_log values (null, 'summary', 'inserted=' || v_inserted || ' skipped=' || v_skipped || ' errors=' || v_errors);");
out.push("end $$;");
out.push("");
out.push("-- Run this to see what actually happened (not the \"Success. No rows returned\" the do-block itself shows):");
out.push("select result, count(*) from _ticket_import_log where result <> 'summary' group by result");
out.push("union all");
out.push("select 'TOTAL', count(*) from _ticket_import_log where result <> 'summary';");
out.push("");
out.push("-- If any errors, this shows exactly which tickets and why:");
out.push("select ticket_no, detail from _ticket_import_log where result = 'error';");

return { text: out.join("\n"), skipped, attempted: chunkRows.length - skipped };
}

if (numParts === 1) {
  const { text: sqlText, skipped, attempted } = buildSql(dataRows, null);
  fs.writeFileSync(outPath, sqlText, "utf8");
  console.log(`Wrote ${outPath} — ${attempted} ticket inserts attempted (${skipped} skipped for missing TicketNo)`);
} else {
  const base = outPath.replace(/\.sql$/i, "");
  const chunkSize = Math.ceil(dataRows.length / numParts);
  let totalAttempted = 0;
  let totalSkipped = 0;
  for (let i = 0; i < numParts; i++) {
    const chunk = dataRows.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) continue;
    const partPath = `${base}.part${i + 1}.sql`;
    const { text: sqlText, skipped, attempted } = buildSql(chunk, `part ${i + 1} of ${numParts}`);
    fs.writeFileSync(partPath, sqlText, "utf8");
    totalAttempted += attempted;
    totalSkipped += skipped;
    console.log(`Wrote ${partPath} — ${attempted} ticket inserts attempted (${skipped} skipped for missing TicketNo)`);
  }
  console.log(`Total across ${numParts} parts: ${totalAttempted} attempted, ${totalSkipped} skipped for missing TicketNo`);
}
