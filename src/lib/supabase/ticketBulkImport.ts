/**
 * Import Bulk Tickets (Tickets → Create New Ticket) — reads a ServicePower
 * ticket export (.csv or .xlsx/.xls, same columns as the files that used to
 * be turned into SQL by scripts/gen-ticket-sql.mjs) and creates one customer
 * + one ticket per row, in the signed-in user's company (the insert triggers
 * stamp company_id from the session, RLS keeps it company-scoped).
 *
 * Field mapping is the same as gen-ticket-sql.mjs:
 *   ticket_no <- TicketNo            status <- StatusDesc
 *   warranty <- WarrantyType         manufacturer <- MfgAbbName
 *   account <- MfgName               account_no <- AccountNo
 *   ticket_source / claim_company <- "NSA" for NSA rows, else MfgName (or RefType)
 *   product_type <- Product          model / model_version / serial <- ModelCode / ModelVersion / SerialNo
 *   technician <- TechName           location <- LocationName (or Branch)
 *   schedule_date <- ScheduleDate    call_received_date <- CreateTime (or PostingDate)
 *   problem_description <- SymptomByCx   internal_note <- NoteInternal
 *   diagnosed <- DiagnosedYn         redo <- Redo   aging <- Aging   calls <- nCallAttempt
 *   customer_pref <- CxPreferredDate present
 *   customer <- CxUserName / CxAddress1/2 / CxCity / CxState / CxZipCode / CxEmail / phones
 *
 * A ticket number already in the system is UPDATED, not duplicated — only:
 *   status         when the file has one and it differs
 *   schedule_date  when the file has one and it differs
 *   technician     when the ticket has none yet; replacing an existing
 *                  assignment only with `updateTechnicians` (off by default —
 *                  the file is a snapshot and may be older than a dispatch
 *                  reassignment made in the app)
 * Blank file values never overwrite anything, and customer details / notes /
 * visits / parts are never touched. Updates go through import_ticket_updates
 * (migration 0367) so they're recorded as system changes, not credited to the
 * person importing.
 *
 * Skipped (never inserted): no TicketNo, or a ticket number repeated later in
 * the same file.
 *
 * Excel-changed ticket numbers: opening or saving the export in Excel turns
 * ticket numbers into numbers — an AIG "3890096E1" becomes 38900960
 * (scientific notation) and a 12-digit "061747484133" loses its leading zero.
 * Before this check every such row was "new" and got inserted as a duplicate
 * ticket with a duplicate customer (141 of them, 10/21–10/23). Now a row is
 * matched to the existing ticket in either direction (file changed, or the
 * system holding the changed copy) when the customer ZIP agrees, and the
 * update goes to that ticket's real number. When the file shows it went
 * through Excel (an .xlsx storing TicketNo as a number, or a row that only
 * matched after undoing Excel's change), a NEW all-digit number isn't trusted
 * — it's listed instead of inserted.
 */
import * as XLSX from "xlsx";
import { supabase } from "./client";
import { invalidateCompanyTicketsCache } from "./tickets";

export type ImportRow = Record<string, string>;

export interface ImportOptions {
  /** Replace a technician already assigned in the system with the file's. Off by default. */
  updateTechnicians?: boolean;
}

export type ImportOutcome =
  | { kind: "added"; ticketNo: string }
  | { kind: "skipped"; ticketNo: string; reason: "exists" | "duplicate-in-file" | "missing-ticket-no"; line: number }
  | { kind: "failed"; ticketNo: string; error: string };

export interface ImportSummary {
  totalRows: number;
  added: string[];
  /** Existing tickets changed by the file, with what changed ("Status: A → B"). */
  updated: { ticketNo: string; changes: string[] }[];
  /** Existing tickets where the file had nothing new. */
  unchanged: string[];
  skippedExisting: string[];
  skippedDuplicate: string[];
  skippedMissing: number[]; // spreadsheet line numbers
  /** Rows matched to an existing ticket only after undoing Excel's change to the number. */
  matchedExcelNumbers: { fileNo: string; ticketNo: string }[];
  /** New all-digit numbers not added because the file went through Excel (they may be changed). */
  skippedExcelNumbers: string[];
  failed: { ticketNo: string; error: string }[];
}

/** Reserved row key: this row's TicketNo cell was stored as a number in the .xlsx. */
const TICKET_NO_WAS_NUMBER = "__ticketNoWasNumber";

/** What Excel turns a real ticket number into: "3890096E1" → "38900960", "061747484133" → "61747484133". null when Excel leaves it alone. */
export function excelChangedTicketNo(no: string): string | null {
  if (/^\d{7}E\d+$/i.test(no)) {
    const n = Number(no);
    return Number.isSafeInteger(n) ? String(n) : null;
  }
  if (/^0\d{11}$/.test(no)) return no.replace(/^0+/, "");
  return null;
}

/** Real ticket numbers an Excel-changed one could have come from (the reverse of excelChangedTicketNo) — e.g. 390780000 is "3907800E2" or "000390780000". */
export function excelOriginalTicketNos(no: string): string[] {
  const out: string[] = [];
  const e = no.match(/^([1-9]\d{6})(0+)$/);
  if (e) out.push(`${e[1]}E${e[2].length}`);
  if (/^[1-9]\d{8,10}$/.test(no)) out.push(no.padStart(12, "0"));
  return out;
}

/** Same CSV rules as gen-ticket-sql.mjs: only a quote at the start of a field opens a quoted field (stray quotes inside CSR notes are literal). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field.length === 0) inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ""));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel cell → text. Real date cells become "DD/MM/YYYY HH:mm" so they parse the same as the CSV export's text dates. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    return `${pad(v.getDate())}/${pad(v.getMonth() + 1)}/${v.getFullYear()} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
  }
  return String(v);
}

/** Reads the uploaded file into header-keyed rows. */
export async function readImportFile(file: File): Promise<ImportRow[]> {
  let table: string[][];
  let ticketNoWasNumber: boolean[] = [];
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    table = parseCsv(await file.text());
  } else {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    const ticketCol = (raw[0] ?? []).findIndex((h) => String(h).trim().replace(/^﻿/, "") === "TicketNo");
    ticketNoWasNumber = raw.map((r) => ticketCol >= 0 && typeof r[ticketCol] === "number");
    table = raw.map((r) => r.map(cellText));
  }
  if (table.length === 0) return [];
  const header = table[0].map((h) => h.trim().replace(/^﻿/, ""));
  return table.slice(1).map((r, i) => {
    const row: ImportRow = Object.fromEntries(header.map((h, j) => [h, (r[j] ?? "").trim()]));
    if (ticketNoWasNumber[i + 1]) row[TICKET_NO_WAS_NUMBER] = "1";
    return row;
  });
}

/** True when the file has the ServicePower export's key columns. */
export function looksLikeTicketExport(rows: ImportRow[]): boolean {
  if (rows.length === 0) return false;
  const cols = Object.keys(rows[0]);
  return ["TicketNo", "StatusDesc", "CxUserName"].every((c) => cols.includes(c));
}

/** "22/09/2026 00:00" → "2026-09-22" (the export is day-first). */
function ddmmyyyyToIso(v: string): string | null {
  const m = (v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

const int = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

function toRecords(r: ImportRow) {
  const get = (c: string) => (r[c] ?? "").trim();
  const name = get("CxUserName");
  const account = get("MfgName");
  const refType = get("RefType");
  const ticketSource = refType === "NSA" ? "NSA" : account || refType || null;
  const callReceived = ddmmyyyyToIso(get("CreateTime")) || ddmmyyyyToIso(get("PostingDate"));
  const customer = {
    first_name: name.split(/\s+/)[0] || "",
    last_name: name.split(/\s+/).slice(1).join(" "),
    full_name: name,
    phone: get("CxPhone") || get("CxCellPhone") || get("CxHomePhone"),
    second_phone: get("CxCellPhone2") || get("CxCellPhone"),
    email: get("CxEmail"),
    address: get("CxAddress1"),
    address2: get("CxAddress2"),
    city: get("CxCity"),
    state: get("CxState"),
    zip: get("CxZipCode"),
  };
  const ticket = {
    ticket_no: get("TicketNo"),
    ticket_source: ticketSource,
    claim_company: ticketSource,
    warranty: get("WarrantyType") || null,
    manufacturer: get("MfgAbbName") || null,
    account: account || null,
    account_no: get("AccountNo") || null,
    model: get("ModelCode") || null,
    model_version: get("ModelVersion") || null,
    serial: get("SerialNo") || null,
    product_type: get("Product") || null,
    status: get("StatusDesc") || "CSR-Needs Scheduling",
    redo: /^y/i.test(get("Redo")),
    schedule_date: ddmmyyyyToIso(get("ScheduleDate")),
    call_received_date: callReceived,
    technician: get("TechName") || null,
    location: get("LocationName") || get("Branch") || null,
    problem_description: get("SymptomByCx") || null,
    internal_note: get("NoteInternal") || null,
    diagnosed: /^y/i.test(get("DiagnosedYn")),
    aging: int(get("Aging")),
    calls: int(get("nCallAttempt")),
    customer_pref: !!get("CxPreferredDate"),
    created_at: callReceived ? new Date(`${callReceived}T12:00:00`).toISOString() : new Date().toISOString(),
  };
  // rawStatus: the file's own StatusDesc — ticket.status defaults a blank one
  // for NEW tickets, but only a real value may change an existing ticket.
  return { customer, ticket, rawStatus: get("StatusDesc") };
}

interface ExistingTicket {
  ticketNo: string;
  status: string;
  scheduleDate: string;
  technician: string;
  /** Customer ZIP (first 5) — the check that an Excel-changed number really is this ticket. */
  zip: string;
}

const zip5 = (v: string | null | undefined) => String(v ?? "").trim().slice(0, 5);

/** The tickets (from `ticketNos`) that already exist in the signed-in company, with the fields an import may update. */
async function existingTickets(ticketNos: string[]): Promise<Map<string, ExistingTicket>> {
  const found = new Map<string, ExistingTicket>();
  for (let i = 0; i < ticketNos.length; i += 200) {
    const { data, error } = await supabase
      .from("tickets")
      .select("ticket_no, status, schedule_date, technician, customers(zip)")
      .in("ticket_no", ticketNos.slice(i, i + 200));
    if (error) throw new Error(`Couldn't check existing tickets: ${error.message}`);
    for (const r of (data ?? []) as Array<{ ticket_no: string; status: string | null; schedule_date: string | null; technician: string | null; customers: { zip: string | null } | { zip: string | null }[] | null }>) {
      const customer = Array.isArray(r.customers) ? r.customers[0] : r.customers;
      found.set(r.ticket_no, {
        ticketNo: r.ticket_no,
        status: (r.status ?? "").trim(),
        scheduleDate: r.schedule_date ? String(r.schedule_date).slice(0, 10) : "",
        technician: (r.technician ?? "").trim(),
        zip: zip5(customer?.zip),
      });
    }
  }
  return found;
}

/**
 * The existing ticket a file row is, if any. An Excel-changed number in the
 * file goes to the real ticket first (even while the changed copy still
 * exists); then an exact match; then a real number in the file whose ticket
 * the system only holds under Excel's changed copy. Either Excel match needs
 * the customer ZIP to agree when both sides have one.
 */
function resolveExisting(rec: ReturnType<typeof toRecords>, existing: Map<string, ExistingTicket>): { ticket: ExistingTicket; fileWasChanged: boolean; viaExcel: boolean } | null {
  const no = rec.ticket.ticket_no;
  const zipAgrees = (t: ExistingTicket) => !t.zip || !zip5(rec.customer.zip) || t.zip === zip5(rec.customer.zip);
  for (const original of excelOriginalTicketNos(no)) {
    const t = existing.get(original);
    if (t && zipAgrees(t)) return { ticket: t, fileWasChanged: true, viaExcel: true };
  }
  const exact = existing.get(no);
  if (exact) return { ticket: exact, fileWasChanged: false, viaExcel: false };
  const changed = excelChangedTicketNo(no);
  const t = changed ? existing.get(changed) : undefined;
  if (t && zipAgrees(t)) return { ticket: t, fileWasChanged: false, viaExcel: true };
  return null;
}

type UpdatePayload = { ticket_no: string; status?: string; schedule_date?: string; technician?: string };

/** What the file would change on an existing ticket (no changes = nothing new). */
function diffExisting(rec: ReturnType<typeof toRecords>, cur: ExistingTicket, opts: ImportOptions): { payload: UpdatePayload; changes: string[] } {
  const payload: UpdatePayload = { ticket_no: cur.ticketNo };
  const changes: string[] = [];
  const fileStatus = rec.rawStatus;
  if (fileStatus && fileStatus !== cur.status) {
    payload.status = fileStatus;
    changes.push(`Status: ${cur.status || "—"} → ${fileStatus}`);
  }
  const fileSched = rec.ticket.schedule_date ?? "";
  if (fileSched && fileSched !== cur.scheduleDate) {
    payload.schedule_date = fileSched;
    changes.push(`Schedule: ${cur.scheduleDate || "—"} → ${fileSched}`);
  }
  const fileTech = (rec.ticket.technician ?? "").trim();
  if (fileTech && fileTech.toLowerCase() !== cur.technician.toLowerCase() && (!cur.technician || opts.updateTechnicians)) {
    payload.technician = fileTech;
    changes.push(`Technician: ${cur.technician || "—"} → ${fileTech}`);
  }
  return { payload, changes };
}

function isMissingFunction(err: { code?: string; message?: string }): boolean {
  return err.code === "PGRST202" || err.code === "42883" || /import_ticket_updates/i.test(err.message ?? "");
}

async function insertOne(rec: ReturnType<typeof toRecords>): Promise<ImportOutcome> {
  const ticketNo = rec.ticket.ticket_no;
  const { data: cust, error: custErr } = await supabase.from("customers").insert(rec.customer).select("id").single();
  if (custErr) return { kind: "failed", ticketNo, error: `Customer: ${custErr.message}` };
  const { error } = await supabase.from("tickets").insert({ ...rec.ticket, customer_id: cust.id });
  if (error) {
    // Don't leave an orphan customer behind (company staff may delete their
    // own company's customers — 0001's tenant policy). If that delete fails
    // too, say so instead of leaving it silently.
    const { error: delErr } = await supabase.from("customers").delete().eq("id", cust.id);
    const orphanNote = delErr ? ` (its new customer record couldn't be removed: ${delErr.message})` : "";
    if (error.code === "23505" && !delErr) return { kind: "skipped", ticketNo, reason: "exists", line: 0 };
    return { kind: "failed", ticketNo, error: `${error.code === "23505" ? "Already in the system" : error.message}${orphanNote}` };
  }
  return { kind: "added", ticketNo };
}

/**
 * Imports every row. `onProgress(done, total)` fires as tickets are written.
 * Rows are written a few at a time (not one giant insert) so one bad row only
 * fails itself.
 */
export async function importTickets(
  rows: ImportRow[],
  onProgress?: (done: number, total: number) => void,
  opts: ImportOptions = {}
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    totalRows: rows.length,
    added: [],
    updated: [],
    unchanged: [],
    skippedExisting: [],
    skippedDuplicate: [],
    skippedMissing: [],
    matchedExcelNumbers: [],
    skippedExcelNumbers: [],
    failed: [],
  };

  // An .xlsx that stores any TicketNo as a number has been through Excel.
  let fileWentThroughExcel = rows.some((r) => r[TICKET_NO_WAS_NUMBER] === "1");
  const seen = new Set<string>();
  const toInsert: ReturnType<typeof toRecords>[] = [];
  rows.forEach((r, i) => {
    const rec = toRecords(r);
    const no = rec.ticket.ticket_no;
    if (!no) {
      summary.skippedMissing.push(i + 2); // +1 header, +1 one-based
      return;
    }
    if (seen.has(no)) {
      summary.skippedDuplicate.push(no);
      return;
    }
    seen.add(no);
    toInsert.push(rec);
  });

  // Look up each number as given, plus what Excel would have changed it from / to.
  const lookupNos = new Set<string>();
  for (const r of toInsert) {
    const no = r.ticket.ticket_no;
    lookupNos.add(no);
    for (const original of excelOriginalTicketNos(no)) lookupNos.add(original);
    const changed = excelChangedTicketNo(no);
    if (changed) lookupNos.add(changed);
  }
  const existing = await existingTickets(Array.from(lookupNos));
  const resolved = toInsert.map((r) => ({ rec: r, match: resolveExisting(r, existing) }));
  if (resolved.some((x) => x.match?.fileWasChanged)) fileWentThroughExcel = true;

  const updates: { payload: UpdatePayload; changes: string[] }[] = [];
  const updatedNos = new Set<string>();
  const fresh: ReturnType<typeof toRecords>[] = [];
  for (const { rec, match } of resolved) {
    const fileNo = rec.ticket.ticket_no;
    if (!match) {
      // Excel drops leading zeros and expands "E" numbers into plain digits, so
      // in a file it touched, a NEW all-digit number may not be the real one.
      if (fileWentThroughExcel && /^[1-9]\d*$/.test(fileNo)) summary.skippedExcelNumbers.push(fileNo);
      else fresh.push(rec);
      continue;
    }
    const cur = match.ticket;
    // The real and the changed number can both be in one file — the ticket is updated once.
    if (updatedNos.has(cur.ticketNo)) {
      summary.skippedDuplicate.push(fileNo);
      continue;
    }
    updatedNos.add(cur.ticketNo);
    if (match.viaExcel) summary.matchedExcelNumbers.push({ fileNo, ticketNo: cur.ticketNo });
    const d = diffExisting(rec, cur, opts);
    if (d.changes.length === 0) summary.unchanged.push(cur.ticketNo);
    else updates.push(d);
  }

  const UPDATE_BATCH = 100;
  const total = fresh.length + updates.length;
  let done = 0;
  onProgress?.(0, total);
  const POOL = 4;
  for (let i = 0; i < fresh.length; i += POOL) {
    const results = await Promise.all(fresh.slice(i, i + POOL).map(insertOne));
    for (const res of results) {
      if (res.kind === "added") summary.added.push(res.ticketNo);
      else if (res.kind === "skipped") summary.skippedExisting.push(res.ticketNo);
      else if (res.kind === "failed") summary.failed.push({ ticketNo: res.ticketNo, error: res.error });
    }
    done += results.length;
    onProgress?.(done, total);
  }

  // Existing tickets — written as system changes (migration 0367), in batches.
  for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
    const batch = updates.slice(i, i + UPDATE_BATCH);
    const { data, error } = await supabase.rpc("import_ticket_updates", { p_updates: batch.map((u) => u.payload) });
    if (error) {
      const msg = isMissingFunction(error)
        ? "Updating existing tickets needs migration 0367 in Supabase — run it, then import the file again (new tickets were still added)."
        : error.message;
      for (const u of updates.slice(i)) summary.failed.push({ ticketNo: u.payload.ticket_no, error: msg });
      break;
    }
    const ok = new Set<string>((data as string[] | null) ?? []);
    for (const u of batch) {
      if (ok.has(u.payload.ticket_no)) summary.updated.push({ ticketNo: u.payload.ticket_no, changes: u.changes });
      else summary.failed.push({ ticketNo: u.payload.ticket_no, error: "Not updated (no access to this ticket)" });
    }
    done += batch.length;
    onProgress?.(done, total);
  }

  if (summary.added.length > 0 || summary.updated.length > 0) invalidateCompanyTicketsCache();
  return summary;
}
