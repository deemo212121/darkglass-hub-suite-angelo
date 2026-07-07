/**
 * Supabase tickets service.
 *
 * Maps the app's flat `Ticket` shape (from src/lib/ticketData.ts) to the
 * normalized Supabase tables: `tickets` (+ linked `customers`).
 * All reads/writes are company-scoped automatically by RLS.
 *
 * Customer details (name, phone, address...) are stored in `customers` and
 * linked via tickets.customer_id, but exposed flat on the returned Ticket so
 * existing UI components keep working unchanged.
 */

import { supabase } from "./client";
import type { Ticket } from "@/lib/ticketData";
import { mapSource, mapSourceFromTicketNumber } from "@/lib/mfgSource";

// ---- helpers ---------------------------------------------------------------

const yn = (v: unknown) => (v === true || v === "Y" || v === "y" ? "Y" : "N");
const bool = (v: unknown) => v === "Y" || v === "y" || v === true;

/**
 * Coerce whatever ServicePower handed us as a schedule date into a
 * Postgres-friendly `YYYY-MM-DD` string (the `tickets.schedule_date`
 * column is a `date`, not a `timestamp`).
 *
 * SP serialises the value in a handful of shapes — we already format
 * it down to `MM/DD/YY` upstream in formatServicePowerDate, but for
 * defensive parsing we accept either form here.
 *
 * Returns null when the input is empty or unparseable so the column
 * stores SQL NULL rather than a garbled date string.
 */
function parseScheduleDateForSql(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  // YYYY-MM-DD (with optional time tail we ignore).
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const m = iso[2].padStart(2, "0");
    const d = iso[3].padStart(2, "0");
    return `${iso[1]}-${m}-${d}`;
  }
  // MM/DD/YY or MM/DD/YYYY (US format, our formatter's output).
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const m = us[1].padStart(2, "0");
    const d = us[2].padStart(2, "0");
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${m}-${d}`;
  }
  // Compact YYYYMMDD.
  const c = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (c) return `${c[1]}-${c[2]}-${c[3]}`;
  return null;
}

// Per-ticket-number serialization. Multiple concurrent calls to
// upsertTicketFromServicePower for the same ticket_no would race their
// "look up by ticket_no -> insert if missing" sequence and could create
// duplicate rows. We chain them through a Map of in-flight promises so the
// second caller waits for the first to finish, then does its own lookup
// (which by then sees the row and updates instead of inserting).
const _ticketLocks = new Map<string, Promise<unknown>>();
function runUnderTicketLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _ticketLocks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  // Keep the rejection contained inside `next`; the lock chain only cares
  // about completion order.
  _ticketLocks.set(key, next.catch(() => undefined));
  return next.finally(() => {
    if (_ticketLocks.get(key) === next.catch(() => undefined)) {
      _ticketLocks.delete(key);
    }
  });
}

// ServicePower's ServiceLocation codes (IH = In Home, OS = On Site, DO = Drop
// Off, etc.) used to leak into ticket.location in an older sync. They're NOT
// valid branch names — strip them at read time so the UI shows "—" instead
// while we wait for the next sync to overwrite the column with the real
// resolved branch. Both upper- and lower-case forms are listed so a
// case-insensitive check via toLowerCase actually matches the short codes.
const SP_SERVICE_LOCATION_CODES = new Set([
  "ih","os","do","on","dc","dr","is","od",
  "in home","on site","drop off","drop-off","in-home","unknown",
]);

function sanitizeLocation(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (SP_SERVICE_LOCATION_CODES.has(v.toLowerCase())) return "";
  return v;
}

// Re-resolve a stored ticket_source value through the MfgId map. Rows synced
// before a code was mapped will have raw codes like "I990" persisted; this
// keeps the UI display consistent without forcing a re-sync.
//
// Also applies the ticket-number-prefix override so historical rows that
// were saved with a stale Work Order Source (e.g. an Electrolux ticket
// stored as "ASSURANT SOLUTIONS" because SP filed it under Assurant's
// MfgId) self-correct on read without needing an SP re-sync.
//
// Skipped when the row was manually edited (source_edited_by_user = true)
// so an admin's correction is honored above every automatic rule.
function resolveSource(
  raw: string,
  ticketNo?: string | null,
  sourceEditedByUser?: boolean,
): string {
  const v = String(raw || "").trim();
  if (sourceEditedByUser) return v;
  // Ticket-number prefix override wins (e.g. numbers starting with
  // "1007" are Electrolux even when SP tagged them Assurant).
  const byTicket = mapSourceFromTicketNumber(ticketNo);
  if (byTicket) return byTicket;
  if (!v) return "";
  // If the value looks like a code (e.g. "I990", "K100"), try mapping it.
  if (/^[A-Z]\d{2,4}$/.test(v.toUpperCase())) {
    return mapSource(v, null, ticketNo) || v;
  }
  return v;
}

/**
 * Map a joined Supabase row (ticket + customer) back to the flat UI Ticket.
 */
function rowToTicket(row: any): Ticket {
  const c = row.customer ?? {};
  return {
    ticketNo: row.ticket_no,
    ticketSource: resolveSource(
      row.ticket_source ?? "",
      row.ticket_no ?? "",
      Boolean(row.source_edited_by_user),
    ),
    warranty: row.warranty ?? "",
    manufacturer: row.manufacturer ?? "",
    customer: c.full_name ?? "",
    city: c.city ?? "",
    location: sanitizeLocation(row.location ?? ""),
    model: row.model ?? "",
    internalNote: row.internal_note ?? "",
    problemDescription: row.problem_description ?? "",
    diagnosed: row.diagnosed ? "Y" : "N",
    technician: row.technician ?? "",
    customerPref: row.customer_pref ? "Y" : "N",
    schedule: row.schedule_date ?? "",
    schedulePeriod: row.time_slot ?? "",
    status: row.status ?? "",
    phone: c.phone ?? "",
    redo: row.redo ? "Y" : "N",
    aging: row.aging ?? 0,
    calls: row.calls ?? 0,
    partOrder: row.part_order ?? "",
    created: row.created_at ? String(row.created_at).slice(0, 10) : "",
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedBy: row.status_changed_by ?? undefined,
    account: row.account ?? "",
    type: row.type ?? "",
    delay: row.delay ?? 0,
    // customer details
    firstName: c.first_name ?? "",
    lastName: c.last_name ?? "",
    address: c.address ?? "",
    address2: c.address2 ?? "",
    zip: c.zip ?? "",
    state: c.state ?? "",
    email: c.email ?? "",
    secondPhone: c.second_phone ?? "",
    altPhone: c.alt_phone ?? "",
    addressNote: c.address_note ?? "",
    // product details
    serial: row.serial ?? "",
    modelVersion: row.model_version ?? "",
    productType: row.product_type ?? "",
    purchaseDate: row.purchase_date ?? "",
    // tracking
    fakeTicket: row.fake_ticket ?? false,
    originalTicketNo: row.original_ticket_no ?? "",
    callReceivedDate: row.call_received_date ?? "",
    claimCompany: row.claim_company ?? "",
    // planner slot (persisted)
    // @ts-expect-error extra field consumed by the Work Planner
    slot: row.time_slot ?? undefined,
    // The internal Supabase ids (handy for updates); not part of the UI type.
    // @ts-expect-error attach internal ids for service use
    _id: row.id,
    // @ts-expect-error
    _customerId: row.customer_id,
  };
}

const SELECT = `
  *,
  customer:customers ( id, first_name, last_name, full_name, phone, second_phone, alt_phone, email, address, address2, city, state, zip, address_note )
`;

// ---- reads -----------------------------------------------------------------

/**
 * Backfill ticket.location for rows where it's blank or stuck on a bad SP
 * service-location code ("IH"/"OS"/"DO"/etc.). Re-resolves the branch from
 * the linked customer's zip → city → state using the same logic the SP sync
 * uses, but without touching ServicePower. Safe to run repeatedly — only
 * rows that change are written. Returns how many rows were updated.
 */
export async function backfillTicketLocations(): Promise<{ scanned: number; updated: number }> {
  const { resolveBranchFromCustomer } = await import("../servicePowerSync");

  const { data, error } = await supabase
    .from("tickets")
    .select("id, location, customer:customers ( zip, city, state )");

  if (error) {
    console.error("backfillTicketLocations select error:", error.message);
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    location: string | null;
    customer: { zip: string | null; city: string | null; state: string | null } | null;
  }>;

  let updated = 0;
  for (const r of rows) {
    const current = sanitizeLocation(String(r.location ?? "")); // strips IH/OS/etc.
    if (current) continue; // already has a good branch label
    const c = r.customer ?? { zip: null, city: null, state: null };
    const resolved = resolveBranchFromCustomer({
      postcode: c.zip ?? "",
      postcodeLevel3: c.city ?? "",
      postcodeLevel1: c.state ?? "",
    });
    if (!resolved) continue; // couldn't figure it out — leave blank, don't churn
    if (resolved === r.location) continue;
    const { error: uErr } = await supabase
      .from("tickets")
      .update({ location: resolved, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (uErr) {
      console.warn("backfillTicketLocations update failed for", r.id, uErr.message);
      continue;
    }
    updated++;
  }

  return { scanned: rows.length, updated };
}

/**
 * Get all tickets for the caller's company (RLS-scoped).
 */
export async function getCompanyTickets(): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from("tickets")
    .select(SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getCompanyTickets error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToTicket);
}

/**
 * Get one ticket by its ticket number (company-scoped).
 */
export async function getTicketByNumber(ticketNo: string): Promise<Ticket | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select(SELECT)
    .eq("ticket_no", ticketNo)
    .maybeSingle();

  if (error) {
    console.error("getTicketByNumber error:", error.message);
    throw new Error(error.message);
  }
  return data ? rowToTicket(data) : null;
}

// ---- writes ----------------------------------------------------------------

/**
 * Generate a ticket number (TK-XXXXXXXX). Real claims usually carry an
 * external number; this is the fallback for app-created tickets.
 */
export function generateTicketNumber(): string {
  return `TK-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Create a ticket (and its customer record) from the flat UI shape.
 * company_id is auto-stamped server-side by the set_company_id trigger.
 */
export async function createTicket(input: Partial<Ticket>): Promise<Ticket> {
  // 1. Create the customer (if any identifying info provided).
  let customerId: string | null = null;
  const hasCustomer =
    input.customer || input.firstName || input.lastName || input.phone || input.address;

  if (hasCustomer) {
    const { data: cust, error: custErr } = await supabase
      .from("customers")
      .insert({
        first_name: input.firstName ?? "",
        last_name: input.lastName ?? "",
        full_name: input.customer ?? [input.firstName, input.lastName].filter(Boolean).join(" "),
        phone: input.phone ?? "",
        second_phone: input.secondPhone ?? "",
        email: input.email ?? "",
        address: input.address ?? "",
        address2: input.address2 ?? "",
        city: input.city ?? "",
        state: input.state ?? "",
        zip: input.zip ?? "",
        address_note: input.addressNote ?? "",
      })
      .select("id")
      .single();
    if (custErr) {
      console.error("createTicket customer error:", custErr.message);
      throw new Error(custErr.message);
    }
    customerId = cust.id;
  }

  // 2. Create the ticket.
  const ticketNo = input.ticketNo || generateTicketNumber();
  const { data: ticket, error: tErr } = await supabase
    .from("tickets")
    .insert({
      ticket_no: ticketNo,
      customer_id: customerId,
      location: input.location ?? null,
      ticket_source: input.ticketSource ?? null,
      warranty: input.warranty ?? null,
      manufacturer: input.manufacturer ?? null,
      account: input.account ?? null,
      claim_company: input.claimCompany ?? null,
      model: input.model ?? null,
      model_version: input.modelVersion ?? null,
      serial: input.serial ?? null,
      product_type: input.productType ?? null,
      purchase_date: input.purchaseDate || null,
      status: input.status ?? "CSR-Needs Scheduling",
      part_order: input.partOrder ?? null,
      diagnosed: bool(input.diagnosed),
      customer_pref: bool(input.customerPref),
      redo: bool(input.redo),
      type: input.type ?? null,
      schedule_date: input.schedule || null,
      call_received_date: input.callReceivedDate || null,
      aging: Number(input.aging ?? 0),
      calls: Number(input.calls ?? 0),
      delay: Number(input.delay ?? 0),
      internal_note: input.internalNote ?? null,
      problem_description: input.problemDescription ?? null,
      fake_ticket: input.fakeTicket ?? false,
      original_ticket_no: input.originalTicketNo ?? null,
    })
    .select(SELECT)
    .single();

  if (tErr) {
    console.error("createTicket error:", tErr.message);
    throw new Error(tErr.message);
  }
  return rowToTicket(ticket);
}

/**
 * Update a ticket's status (the audit trigger records who/when automatically).
 */
export async function updateTicketStatus(ticketNo: string, status: string): Promise<void> {
  const { error } = await supabase
    .from("tickets")
    .update({ status })
    .eq("ticket_no", ticketNo);
  if (error) {
    console.error("updateTicketStatus error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Update a ticket's assignment fields (technician name / schedule date) used by
 * the Daily Schedule drag-drop. company-scoped via RLS; audit trigger records
 * the change.
 */
export async function updateTicketAssignment(
  ticketNo: string,
  fields: { technician?: string; scheduleDate?: string; timeSlot?: string }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.technician !== undefined) update.technician = fields.technician;
  if (fields.scheduleDate !== undefined) update.schedule_date = fields.scheduleDate || null;
  if (fields.timeSlot !== undefined) update.time_slot = fields.timeSlot || null;
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from("tickets")
    .update(update)
    .eq("ticket_no", ticketNo);
  if (error) {
    console.error("updateTicketAssignment error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Delete a ticket by ticket number (company-scoped).
 */
export async function deleteTicket(ticketNo: string): Promise<void> {
  const { error } = await supabase.from("tickets").delete().eq("ticket_no", ticketNo);
  if (error) {
    console.error("deleteTicket error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Update the customer details linked to a ticket. Customer info lives in the
 * `customers` table (linked via tickets.customer_id). If the ticket has no
 * linked customer yet, one is created and linked. Accepts the flat UI fields.
 */
export async function updateTicketCustomer(
  ticketNo: string,
  fields: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    phone?: string;
    secondPhone?: string;
    altPhone?: string;
    email?: string;
    address?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
  },
  options: {
    /** When true, save the phones AND mark them as edited by a user so the
     * ServicePower auto-sync won't overwrite them later. Defaults to true so
     * UI-driven calls (the Edit Customer Info form) lock in their changes by
     * default; pass false from background sync code. */
    markEdited?: boolean;
  } = { markEdited: true }
): Promise<void> {
  // Find the ticket + its current customer link.
  const { data: ticketRow, error: tErr } = await supabase
    .from("tickets")
    .select("id, customer_id")
    .eq("ticket_no", ticketNo)
    .maybeSingle();
  if (tErr) {
    console.error("updateTicketCustomer ticket lookup error:", tErr.message);
    throw new Error(tErr.message);
  }
  if (!ticketRow) throw new Error(`Ticket ${ticketNo} not found`);

  // Build the column payload (only defined fields).
  const payload: Record<string, unknown> = {};
  if (fields.firstName !== undefined) payload.first_name = fields.firstName;
  if (fields.lastName !== undefined) payload.last_name = fields.lastName;
  if (fields.phone !== undefined) payload.phone = fields.phone;
  if (fields.secondPhone !== undefined) payload.second_phone = fields.secondPhone;
  if (fields.altPhone !== undefined) payload.alt_phone = fields.altPhone;
  // Whenever a user saves the Edit Customer Info form (any field), lock the
  // entire customer record so the ServicePower auto-sync can't overwrite it.
  // Background sync code passes markEdited=false so its own writes stay
  // overwritable by future SP refreshes.
  if (options.markEdited) {
    payload.edited_by_user = true;
    // Legacy column from the original phone-only design — kept in sync.
    payload.phone_edited_by_user = true;
  }
  if (fields.email !== undefined) payload.email = fields.email;
  if (fields.address !== undefined) payload.address = fields.address;
  if (fields.address2 !== undefined) payload.address2 = fields.address2;
  if (fields.city !== undefined) payload.city = fields.city;
  if (fields.state !== undefined) payload.state = fields.state;
  if (fields.zip !== undefined) payload.zip = fields.zip;
  // Keep full_name in sync when name parts change.
  const fullName =
    fields.fullName ??
    [fields.firstName, fields.lastName].filter(Boolean).join(" ").trim();
  if (fullName) payload.full_name = fullName;

  if (ticketRow.customer_id) {
    const { error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", ticketRow.customer_id);
    if (error) {
      console.error("updateTicketCustomer update error:", error.message);
      throw new Error(error.message);
    }
  } else {
    // No customer yet — create one and link it. company_id auto-stamped.
    const { data: cust, error: insErr } = await supabase
      .from("customers")
      .insert(payload)
      .select("id")
      .single();
    if (insErr) {
      console.error("updateTicketCustomer insert error:", insErr.message);
      throw new Error(insErr.message);
    }
    const { error: linkErr } = await supabase
      .from("tickets")
      .update({ customer_id: cust.id })
      .eq("id", ticketRow.id);
    if (linkErr) {
      console.error("updateTicketCustomer link error:", linkErr.message);
      throw new Error(linkErr.message);
    }
  }
}

/**
 * Update editable ticket-level fields (e.g. problem description, internal
 * note, product info). Used by both the Edit Internal Note flow and the
 * Edit Product Info flow on the ticket detail page.
 *
 * When any product-info field is included in the update the row's
 * `product_edited_by_user` flag is flipped to true so the ServicePower
 * sync stops overwriting those columns on future runs.
 */
export async function updateTicketFields(
  ticketNo: string,
  fields: {
    problemDescription?: string;
    internalNote?: string;
    manufacturer?: string;
    model?: string;
    serial?: string;
    modelVersion?: string;
    productType?: string;
    purchaseDate?: string;
    warranty?: string;
    claimCompany?: string;
    originalTicketNo?: string;
  }
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.problemDescription !== undefined) payload.problem_description = fields.problemDescription;
  if (fields.internalNote !== undefined) payload.internal_note = fields.internalNote;

  // Product-info fields. Any update to any of these flips the lock flag.
  const productKeys: Array<keyof typeof fields> = [
    "manufacturer",
    "model",
    "serial",
    "modelVersion",
    "productType",
    "purchaseDate",
    "warranty",
    "claimCompany",
    "originalTicketNo",
  ];
  const touchedProductInfo = productKeys.some((k) => fields[k] !== undefined);

  if (fields.manufacturer !== undefined) payload.manufacturer = fields.manufacturer;
  if (fields.model !== undefined) payload.model = fields.model;
  if (fields.serial !== undefined) payload.serial = fields.serial;
  if (fields.modelVersion !== undefined) payload.model_version = fields.modelVersion;
  if (fields.productType !== undefined) payload.product_type = fields.productType;
  if (fields.purchaseDate !== undefined) {
    // Empty string -> NULL so the column never holds a malformed date.
    payload.purchase_date = fields.purchaseDate.trim() ? fields.purchaseDate : null;
  }
  if (fields.warranty !== undefined) payload.warranty = fields.warranty;
  if (fields.claimCompany !== undefined) payload.claim_company = fields.claimCompany;
  if (fields.originalTicketNo !== undefined) payload.original_ticket_no = fields.originalTicketNo;
  if (touchedProductInfo) payload.product_edited_by_user = true;

  const { error } = await supabase.from("tickets").update(payload).eq("ticket_no", ticketNo);
  if (error) {
    console.error("updateTicketFields error:", error.message);
    throw new Error(error.message);
  }
}

// ---- visits ----------------------------------------------------------------

type UIVisit = NonNullable<Ticket["visits"]>[number];

/** Map a Supabase visit row to the flat UI visit shape. */
function rowToVisit(row: any): UIVisit {
  return {
    id: row.id,
    visitNo: row.visit_no ?? "",
    timestamp: row.created_at ?? "",
    updatedAt: row.updated_at ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    updateReason: row.update_reason ?? undefined,
    by: row.created_by ?? "",
    scheduleDate: row.schedule_date ?? "",
    technician: row.technician ?? "",
    timeSlot: row.time_slot ?? "",
    activity: row.activity ?? "",
    actionType: row.action_type ?? "",
    repairStatus: row.repair_status ?? "",
    repairType: row.repair_type ?? "",
    schedNotes: row.sched_notes ?? "",
    reclaim: "",
    visited: "",
    notCompleted: "",
    symptomCx: row.symptom_csr ?? "",
    diagnosis: row.cause_of_failure ?? "",
    symptomTech: "",
    resolution: row.repair_notes ?? "",
    nonCompletionReason: row.non_completion_reason ?? "",
    triageNote: row.triage_note ?? "",
    status: row.status ?? "",
    note: row.note ?? "",
  };
}

/** Resolve a ticket's internal UUID from its ticket number (company-scoped). */
async function getTicketId(ticketNo: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id")
    .eq("ticket_no", ticketNo)
    .maybeSingle();
  if (error) {
    console.error("getTicketId error:", error.message);
    throw new Error(error.message);
  }
  return data?.id ?? null;
}

/**
 * Bulk-fetch the most recent visit-level schedule date for a set of tickets.
 *
 * Returns a `Map<ticket_id, latestScheduleDate>` keyed by the internal
 * ticket UUID. Used by the Work Map to override the SP-supplied schedule
 * date with whatever the CSR last saved in the Visit Log — a CSR-added
 * visit reschedules the call from dispatch's point of view, so the map
 * should bucket the ticket under the visit date, not the original SP date.
 *
 * Visits with a null/empty `schedule_date` are ignored.
 */
/**
 * Bulk-fetch the derived "Part Order" state per ticket for the
 * Ticket List column. Runs two lightweight queries against `visits`
 * and `parts` and reduces them to one of four labels:
 *
 *   • "Not Diagnosed"     — no visit has cause_of_failure filled yet
 *   • "Part Not Needed"   — diagnosed but the ticket has zero parts logged
 *   • "Part Ordered"      — diagnosed, every part row is past Need PO
 *   • "Partially Ordered" — diagnosed, some parts past Need PO, some still at it
 *
 * Returns a `Map<ticket_id, label>` for the requested ticket UUIDs.
 */
export type PartOrderState =
  | "Not Diagnosed"
  | "Part Not Needed"
  | "Part Ordered"
  | "Partially Ordered";

export async function getPartOrderStateByTicketIds(
  ticketIds: string[],
): Promise<Map<string, PartOrderState>> {
  const out = new Map<string, PartOrderState>();
  const uniq = Array.from(new Set(ticketIds.filter(Boolean)));
  if (uniq.length === 0) return out;

  // 1. Diagnosed set — every ticket that has at least one visit with a
  //    non-empty cause_of_failure.
  const diagnosed = new Set<string>();
  {
    const { data, error } = await supabase
      .from("visits")
      .select("ticket_id, cause_of_failure")
      .in("ticket_id", uniq)
      .not("cause_of_failure", "is", null);
    if (error) {
      console.error("getPartOrderStateByTicketIds visits error:", error.message);
    } else {
      for (const row of data ?? []) {
        const tid = (row as any).ticket_id as string | null;
        const cf = String((row as any).cause_of_failure ?? "").trim();
        if (tid && cf) diagnosed.add(tid);
      }
    }
  }

  // 2. Parts per ticket, with each row's status. Statuses that count as
  //    "still needs a PO" — anything else is considered "past ordering".
  const needsPo = new Set(["", "need po"]);
  const partsByTicket = new Map<string, { total: number; needPo: number }>();
  {
    const { data, error } = await supabase
      .from("parts")
      .select("ticket_id, status")
      .in("ticket_id", uniq);
    if (error) {
      console.error("getPartOrderStateByTicketIds parts error:", error.message);
    } else {
      for (const row of data ?? []) {
        const tid = (row as any).ticket_id as string | null;
        if (!tid) continue;
        const statusRaw = String((row as any).status ?? "").trim().toLowerCase();
        const bucket = partsByTicket.get(tid) ?? { total: 0, needPo: 0 };
        bucket.total += 1;
        if (needsPo.has(statusRaw)) bucket.needPo += 1;
        partsByTicket.set(tid, bucket);
      }
    }
  }

  for (const tid of uniq) {
    if (!diagnosed.has(tid)) {
      out.set(tid, "Not Diagnosed");
      continue;
    }
    const parts = partsByTicket.get(tid);
    if (!parts || parts.total === 0) {
      out.set(tid, "Part Not Needed");
      continue;
    }
    if (parts.needPo === 0) out.set(tid, "Part Ordered");
    else if (parts.needPo < parts.total) out.set(tid, "Partially Ordered");
    else out.set(tid, "Not Diagnosed");
    // The last branch fires when a ticket is diagnosed but no part has
    // moved past Need PO yet. Treated as "not yet ordered" to match the
    // spec's 4-value list.
  }

  return out;
}

/**
 * Bulk-fetch CSR-added "extra route days" per ticket.
 *
 * Returns a `Map<ticket_id, Set<YYYY-MM-DD>>` covering days the CSR has
 * EXPLICITLY booked outside of the ServicePower schedule_date. Only
 * `RESCHEDULE` and `OSR` visits count — a plain `SCHEDULE` visit is
 * the act of recording the SP-issued date and is treated as "no extra
 * day". This matches dispatch's rule:
 *
 *   "Just because two tickets share a technician doesn't mean they're
 *   on today's route — only same-day SP date OR a real CSR re-book
 *   pulls a ticket onto a given day."
 *
 * Other action types (CALL ATTEMPT, UPDATE INFO, TRIAGE, CANCEL, etc.)
 * are ignored so they can't pollute the route plan.
 */
export async function getCsrVisitDatesByTicketIds(
  ticketIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const uniq = Array.from(new Set(ticketIds.filter(Boolean)));
  if (uniq.length === 0) return out;
  const RESCHEDULE_ACTIONS = ["RESCHEDULE", "OSR"];
  const { data, error } = await supabase
    .from("visits")
    .select("ticket_id, schedule_date, action_type")
    .in("ticket_id", uniq)
    .not("schedule_date", "is", null)
    .in("action_type", RESCHEDULE_ACTIONS);
  if (error) {
    console.error("getCsrVisitDatesByTicketIds error:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    const tid = (row as any).ticket_id as string | null;
    const raw = (row as any).schedule_date as string | null;
    if (!tid || !raw) continue;
    const ymd = String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    let set = out.get(tid);
    if (!set) {
      set = new Set<string>();
      out.set(tid, set);
    }
    set.add(ymd);
  }
  return out;
}

/**
 * Backwards-compatible single-date helper. Returns just the latest
 * CSR-scheduled date per ticket. Some older callers still use this
 * shape — they should switch to `getCsrVisitDatesByTicketIds` for the
 * full set when they care about multi-day routing.
 */
export async function getLatestVisitScheduleByTicketIds(
  ticketIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const multi = await getCsrVisitDatesByTicketIds(ticketIds);
  for (const [tid, set] of multi) {
    const sorted = Array.from(set).sort();
    if (sorted.length > 0) out.set(tid, sorted[sorted.length - 1]);
  }
  return out;
}

/**
 * Bulk-fetch the latest technician name recorded in the Visit Log for
 * a set of tickets. Used by the Work Map / planner views as a fallback
 * when the ticket itself has no `technician` assigned — the CSR may
 * have only set the technician inside a visit row, in which case both
 * views should still attribute the work to the same person.
 *
 * Returns a `Map<ticket_id, technicianName>` for tickets that have at
 * least one visit with a non-empty `technician`. Visits without a
 * technician are skipped. Ordered newest-first so the most recent
 * assignment wins.
 */
export async function getLatestVisitTechnicianByTicketIds(
  ticketIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(ticketIds.filter(Boolean)));
  if (uniq.length === 0) return out;
  const { data, error } = await supabase
    .from("visits")
    .select("ticket_id, technician, created_at")
    .in("ticket_id", uniq)
    .not("technician", "is", null)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getLatestVisitTechnicianByTicketIds error:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    const tid = (row as any).ticket_id as string | null;
    const tech = String((row as any).technician ?? "").trim();
    if (!tid || !tech) continue;
    if (!out.has(tid)) out.set(tid, tech);
  }
  return out;
}

/** Get all visits for a ticket (newest first). */
export async function getTicketVisits(ticketNo: string): Promise<UIVisit[]> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) return [];
  const { data, error } = await supabase
    .from("visits")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getTicketVisits error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToVisit);
}

/** Add a visit to a ticket. company_id auto-stamped server-side. */
export async function addTicketVisit(ticketNo: string, visit: Partial<UIVisit>): Promise<UIVisit> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) throw new Error(`Ticket ${ticketNo} not found`);

  const { data, error } = await supabase
    .from("visits")
    .insert({
      ticket_id: ticketId,
      visit_no: visit.visitNo ?? null,
      technician: visit.technician ?? null,
      schedule_date: visit.scheduleDate || null,
      time_slot: visit.timeSlot ?? null,
      activity: visit.activity ?? null,
      action_type: visit.actionType ?? null,
      repair_status: visit.repairStatus ?? null,
      repair_type: visit.repairType ?? null,
      sched_notes: visit.schedNotes ?? null,
      symptom_csr: visit.symptomCx ?? null,
      cause_of_failure: visit.diagnosis ?? null,
      repair_notes: visit.resolution ?? null,
      non_completion_reason: visit.nonCompletionReason ?? null,
      triage_note: visit.triageNote ?? null,
      status: visit.status ?? null,
      note: visit.note ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("addTicketVisit error:", error.message);
    throw new Error(error.message);
  }
  return rowToVisit(data);
}

/** Update an existing visit by its id. */
export async function updateTicketVisit(visitId: string, visit: Partial<UIVisit>): Promise<void> {
  const { error } = await supabase
    .from("visits")
    .update({
      technician: visit.technician ?? null,
      schedule_date: visit.scheduleDate || null,
      time_slot: visit.timeSlot ?? null,
      activity: visit.activity ?? null,
      action_type: visit.actionType ?? null,
      repair_status: visit.repairStatus ?? null,
      repair_type: visit.repairType ?? null,
      sched_notes: visit.schedNotes ?? null,
      symptom_csr: visit.symptomCx ?? null,
      cause_of_failure: visit.diagnosis ?? null,
      repair_notes: visit.resolution ?? null,
      non_completion_reason: visit.nonCompletionReason ?? null,
      triage_note: visit.triageNote ?? null,
      status: visit.status ?? null,
      note: visit.note ?? null,
      update_reason: visit.updateReason ?? null,
    })
    .eq("id", visitId);
  if (error) {
    console.error("updateTicketVisit error:", error.message);
    throw new Error(error.message);
  }
}

/** Delete a visit by id. */
export async function deleteTicketVisit(visitId: string): Promise<void> {
  const { error } = await supabase.from("visits").delete().eq("id", visitId);
  if (error) {
    console.error("deleteTicketVisit error:", error.message);
    throw new Error(error.message);
  }
}

// ---- parts ------------------------------------------------------------------

// Flat UI part-row shape used by the ticket detail page.
export interface UIPartRow {
  id: string;
  partNo: string;
  partDist: string;
  partDesc: string;
  poNo: string;
  poDate: string;
  invoiceNo: string;
  invoiceDate: string;
  quantity: string;
  partPrice: string;
  coreValue: string;
  shipCost: string;
  markup: string;
  totalMarkup: string;
  claimTo: string;
  status: string;
  note: string;
  visitId: string;
  orderNo: string;
  eta: string;
  inTracking: string;
  raDate: string;
  raNo: string;
  outTracking: string;
  creditNo: string;
  hold: string;
  cxPaid: string;
  createdBy: string;
  lastModifiedBy: string;
}

const numOrNull = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const dateOrNull = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** Map a Supabase parts row to the flat UI part-row shape. */
function rowToPart(row: any): UIPartRow {
  return {
    id: row.id,
    partNo: row.part_no ?? "",
    partDist: row.part_dist ?? "",
    partDesc: row.part_desc ?? "",
    poNo: row.po_no ?? "",
    poDate: row.po_date ?? "",
    invoiceNo: row.invoice_no ?? "",
    invoiceDate: row.invoice_date ?? "",
    quantity: row.quantity != null ? String(row.quantity) : "",
    partPrice: row.part_price != null ? String(row.part_price) : "",
    coreValue: row.core_value != null ? String(row.core_value) : "",
    shipCost: row.ship_cost != null ? String(row.ship_cost) : "",
    markup: row.markup != null ? String(row.markup) : "",
    totalMarkup: row.total_markup != null ? String(row.total_markup) : "",
    claimTo: row.claim_to ?? "",
    status: row.status ?? "",
    note: row.note ?? "",
    visitId: row.visit_id ?? "",
    orderNo: row.order_no ?? "",
    eta: row.eta ?? "",
    inTracking: row.in_tracking ?? "",
    raDate: row.ra_date ?? "",
    raNo: row.ra_no ?? "",
    outTracking: row.out_tracking ?? "",
    creditNo: row.credit_no ?? "",
    hold: row.hold ? "Y" : "",
    cxPaid: row.cx_paid ? "Y" : "",
    createdBy: row.created_by ?? "",
    lastModifiedBy: row.last_modified_by ?? "",
  };
}

// Build the DB column payload from a flat UI part row.
function partToColumns(part: Partial<UIPartRow>) {
  return {
    part_no: part.partNo ?? null,
    part_dist: part.partDist ?? null,
    part_desc: part.partDesc ?? null,
    po_no: part.poNo ?? null,
    po_date: dateOrNull(part.poDate),
    invoice_no: part.invoiceNo ?? null,
    invoice_date: dateOrNull(part.invoiceDate),
    quantity: numOrNull(part.quantity) ?? 1,
    part_price: numOrNull(part.partPrice) ?? 0,
    core_value: numOrNull(part.coreValue) ?? 0,
    ship_cost: numOrNull(part.shipCost) ?? 0,
    markup: numOrNull(part.markup) ?? 0,
    total_markup: numOrNull(part.totalMarkup) ?? 0,
    claim_to: part.claimTo ?? null,
    status: part.status ?? null,
    note: part.note ?? null,
    order_no: part.orderNo ?? null,
    eta: dateOrNull(part.eta),
    in_tracking: part.inTracking ?? null,
    ra_date: dateOrNull(part.raDate),
    ra_no: part.raNo ?? null,
    out_tracking: part.outTracking ?? null,
    credit_no: part.creditNo ?? null,
    hold: part.hold === "Y" || part.hold === "Yes",
    cx_paid: part.cxPaid === "Y" || part.cxPaid === "Yes",
  };
}

/** Get all parts for a ticket. */
export async function getTicketParts(ticketNo: string): Promise<UIPartRow[]> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) return [];
  const { data, error } = await supabase
    .from("parts")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getTicketParts error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToPart);
}

/** Add a part to a ticket. company_id auto-stamped server-side. */
export async function addTicketPart(ticketNo: string, part: Partial<UIPartRow>): Promise<UIPartRow> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) throw new Error(`Ticket ${ticketNo} not found`);

  const { data, error } = await supabase
    .from("parts")
    .insert({ ticket_id: ticketId, ...partToColumns(part) })
    .select("*")
    .single();
  if (error) {
    console.error("addTicketPart error:", error.message);
    throw new Error(error.message);
  }
  return rowToPart(data);
}

/** Update an existing part by id. */
export async function updateTicketPart(partId: string, part: Partial<UIPartRow>): Promise<void> {
  const { error } = await supabase
    .from("parts")
    .update(partToColumns(part))
    .eq("id", partId);
  if (error) {
    console.error("updateTicketPart error:", error.message);
    throw new Error(error.message);
  }
}

/** Delete a part by id. */
export async function deleteTicketPart(partId: string): Promise<void> {
  const { error } = await supabase.from("parts").delete().eq("id", partId);
  if (error) {
    console.error("deleteTicketPart error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Upsert a ticket pulled from ServicePower (by ticket_no).
 *
 * Creates or updates the linked customer record and the ticket row, syncing
 * only the fields ServicePower owns: source, customer details, address,
 * product details, and work order details. Local-only fields (visits, parts,
 * internal notes, billing) are left untouched on updates.
 *
 * Returns 'added' | 'updated' so callers can tally sync results.
 */
export async function upsertTicketFromServicePower(
  input: Partial<Ticket>
): Promise<"added" | "updated"> {
  if (!input.ticketNo) throw new Error("upsertTicketFromServicePower requires a ticketNo");

  // Serialize concurrent upserts for the same ticket number inside this
  // browser tab so the race "lookup → not found → insert" can't run twice
  // in parallel. Cross-tab / cross-server races are blocked by the unique
  // index on (company_id, ticket_no) added in migration 0017.
  return runUnderTicketLock(String(input.ticketNo).trim(), () =>
    upsertTicketFromServicePowerImpl(input),
  );
}

async function upsertTicketFromServicePowerImpl(
  input: Partial<Ticket>
): Promise<"added" | "updated"> {

  // Customer payload (ServicePower-owned fields).
  const customerPayload = {
    first_name: input.firstName ?? "",
    last_name: input.lastName ?? "",
    full_name:
      input.customer || [input.firstName, input.lastName].filter(Boolean).join(" "),
    phone: input.phone ?? "",
    second_phone: input.secondPhone ?? "",
    email: input.email ?? "",
    address: input.address ?? "",
    address2: input.address2 ?? "",
    city: input.city ?? "",
    state: input.state ?? "",
    zip: input.zip ?? "",
  };

  // Ticket payload (source, product, work order details).
  const ticketPayload: Record<string, unknown> = {
    ticket_source: input.ticketSource ?? "ServicePower",
    warranty: input.warranty ?? null,
    manufacturer: input.manufacturer ?? null,
    account: input.account ?? null,
    claim_company: input.claimCompany ?? null,
    location: sanitizeLocation(String(input.location ?? "")) || null,
    model: input.model ?? null,
    model_version: input.modelVersion ?? null,
    serial: input.serial ?? null,
    product_type: input.productType ?? null,
    purchase_date: input.purchaseDate || null,
    status: input.status ?? null,
    type: input.type ?? null,
    technician: input.technician ?? null,
    // Schedule date sync rule:
    //   - On the first import (no existing row), we honor SP's
    //     ScheduleDate so the Work Map / ticket detail header
    //     immediately reflect when SP says the appointment is.
    //   - On re-sync we never overwrite a date the CSR may have
    //     edited (see the "preserve CSR date" branch below).
    //   - Empty SP dates are stored as null so the UI shows "—".
    schedule_date: parseScheduleDateForSql(input.schedule),
    // ServicePower's appointment window — stored on tickets.time_slot.
    // Prefer the caller-provided frame-normalised value (e.g. "8-12") so
    // the Work Planner column matches; fall back to the raw schedulePeriod
    // string if the caller didn't normalise. Empty values become null so
    // the column doesn't accumulate "" placeholders.
    time_slot: (() => {
      const raw =
        ((input as any).timeSlot as string | undefined) ||
        (input.schedulePeriod as string | undefined) ||
        "";
      const trimmed = String(raw).trim();
      return trimmed ? trimmed : null;
    })(),
    call_received_date: input.callReceivedDate || null,
    customer_pref: bool(input.customerPref),
    redo: bool(input.redo),
    problem_description: input.problemDescription ?? input.internalNote ?? null,
    updated_at: new Date().toISOString(),
  };

  // Does the ticket already exist (company-scoped)? Use `limit(1)` rather
  // than `maybeSingle()` so historic duplicates (if any) don't make the
  // lookup throw — we just take the first row and update it.
  const { data: existingRows, error: findErr } = await supabase
    .from("tickets")
    .select("id, customer_id, status, product_edited_by_user, source_edited_by_user, schedule_date, time_slot")
    .eq("ticket_no", input.ticketNo)
    .order("created_at", { ascending: true })
    .limit(1);
  if (findErr) {
    console.error("upsertTicketFromServicePower lookup error:", findErr.message);
    throw new Error(findErr.message);
  }
  const existing = (existingRows && existingRows[0]) || null;

  if (existing) {
    // Preserve any AHS-side status change on re-sync (e.g. once a CSR clicks
    // Acknowledge the ticket should stay CSR-Acknowledged, not get reset).
    if (existing.status) {
      ticketPayload.status = existing.status;
    }
    // Schedule date sync rule on re-sync:
    //   - If we already have a date AND SP didn't send one, keep ours.
    //   - If we already have a date AND SP sent a different one,
    //     trust SP (this is the case the user hit on 015789584139:
    //     SP shows 7/2 but Supabase had 6/30 from a stale sync, and
    //     the Work Map keeps showing the stale day).
    //   - On a fresh ticket the initial assignment above already
    //     handled it.
    const incomingSchedule = ticketPayload.schedule_date as string | null;
    const existingSchedule = (existing as any).schedule_date as string | null;
    if (!incomingSchedule && existingSchedule) {
      // SP didn't push a date this round → keep what we have.
      ticketPayload.schedule_date = existingSchedule;
    }
    // Same rule for the Schedule Period (time_slot column). If SP returns
    // a window string we trust it; if SP comes back empty we preserve
    // whatever was previously stored so a transient empty response doesn't
    // wipe the user-visible window.
    const incomingPeriod = ticketPayload.time_slot as string | null;
    const existingPeriod = (existing as any).time_slot as string | null;
    if (!incomingPeriod && existingPeriod) {
      ticketPayload.time_slot = existingPeriod;
    }
    // Honor the product-info lock flag: if a user edited Product Info via
    // the ticket detail page, SP must NOT overwrite their values. Drop every
    // product-related field from the payload so this update only touches
    // SP-owned columns (ticket_source, account, location, schedule, etc.).
    if ((existing as any).product_edited_by_user) {
      delete ticketPayload.manufacturer;
      delete ticketPayload.model;
      delete ticketPayload.model_version;
      delete ticketPayload.serial;
      delete ticketPayload.product_type;
      delete ticketPayload.purchase_date;
      delete ticketPayload.warranty;
      delete ticketPayload.claim_company;
      delete ticketPayload.original_ticket_no;
    }
    // Honor the ticket-source lock flag. When an admin corrects a
    // mis-classified Work Order Source (e.g. an Electrolux ticket SP
    // filed under Assurant's MfgId), the correction is stored with
    // source_edited_by_user = true. SP must not overwrite the Work
    // Order Source / claim company / account on re-sync from that
    // point on.
    if ((existing as any).source_edited_by_user) {
      delete ticketPayload.ticket_source;
      delete ticketPayload.account;
      delete ticketPayload.claim_company;
    }
    // Update the linked customer (or create one if missing). If a user has
    // manually edited any customer field (Edit Customer Info → Save), the
    // edited_by_user flag is set and we skip the customer overwrite entirely.
    // Their values stay; SP changes only apply on the ticket itself.
    if (existing.customer_id) {
      const { data: lockRow } = await supabase
        .from("customers")
        .select("edited_by_user")
        .eq("id", existing.customer_id)
        .maybeSingle();
      const userEdited = Boolean((lockRow as any)?.edited_by_user);
      if (!userEdited) {
        const { error: cErr } = await supabase
          .from("customers")
          .update(customerPayload)
          .eq("id", existing.customer_id);
        if (cErr) {
          console.error("upsertTicketFromServicePower customer update error:", cErr.message);
          throw new Error(cErr.message);
        }
      }
    } else {
      const { data: cust, error: cErr } = await supabase
        .from("customers")
        .insert(customerPayload)
        .select("id")
        .single();
      if (cErr) {
        console.error("upsertTicketFromServicePower customer insert error:", cErr.message);
        throw new Error(cErr.message);
      }
      ticketPayload.customer_id = cust.id;
    }

    const { error: tErr } = await supabase
      .from("tickets")
      .update(ticketPayload)
      .eq("id", existing.id);
    if (tErr) {
      console.error("upsertTicketFromServicePower ticket update error:", tErr.message);
      throw new Error(tErr.message);
    }
    return "updated";
  }

  // New ticket: create the customer first, then the ticket.
  const { data: cust, error: cErr } = await supabase
    .from("customers")
    .insert(customerPayload)
    .select("id")
    .single();
  if (cErr) {
    console.error("upsertTicketFromServicePower customer create error:", cErr.message);
    throw new Error(cErr.message);
  }

  const { error: tErr } = await supabase.from("tickets").insert({
    ticket_no: input.ticketNo,
    customer_id: cust.id,
    ...ticketPayload,
  });
  if (tErr) {
    // Unique violation on (company_id, ticket_no): another concurrent sync
    // beat us to it. Re-look up the row and update instead.
    const code = (tErr as any)?.code ?? "";
    if (code === "23505" || /duplicate key|unique constraint/i.test(tErr.message)) {
      const { data: rows } = await supabase
        .from("tickets")
        .select("id, customer_id")
        .eq("ticket_no", input.ticketNo)
        .order("created_at", { ascending: true })
        .limit(1);
      const row = rows?.[0];
      if (row) {
        const { error: updErr } = await supabase
          .from("tickets")
          .update(ticketPayload)
          .eq("id", row.id);
        if (updErr) {
          console.error("upsertTicketFromServicePower race-recovery update error:", updErr.message);
          throw new Error(updErr.message);
        }
        return "updated";
      }
    }
    console.error("upsertTicketFromServicePower ticket create error:", tErr.message);
    throw new Error(tErr.message);
  }
  return "added";
}

// suppress unused warning for yn helper (kept for future field mapping)
void yn;

export interface TicketAuditEntry {
  ticketId: string;
  action: string;
  field: string;
  beforeValue: string | null;
  afterValue: string | null;
  changedBy: string | null;
  createdAt: string;
}

/**
 * Read the ticket_audit_log (company-scoped via RLS). This is the real,
 * trigger-written trail of who changed a ticket's status/tech/schedule and
 * when — the live substitute for any "who did what" reporting (Daily
 * Activity Report, CSR Dashboard per-agent counts) since there is no
 * separate user-activity table.
 */
export async function getTicketAuditLog(opts?: { startDate?: string; endDate?: string }): Promise<TicketAuditEntry[]> {
  let query = supabase
    .from("ticket_audit_log")
    .select("ticket_id, action, field, before_value, after_value, changed_by, created_at")
    .order("created_at", { ascending: false });
  if (opts?.startDate) query = query.gte("created_at", opts.startDate);
  if (opts?.endDate) query = query.lte("created_at", `${opts.endDate}T23:59:59.999Z`);

  const { data, error } = await query;
  if (error) {
    console.error("getTicketAuditLog error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map((r: any) => ({
    ticketId: r.ticket_id,
    action: r.action ?? "",
    field: r.field ?? "",
    beforeValue: r.before_value,
    afterValue: r.after_value,
    changedBy: r.changed_by,
    createdAt: r.created_at,
  }));
}
