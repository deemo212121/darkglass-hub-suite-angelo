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

// ---- helpers ---------------------------------------------------------------

const yn = (v: unknown) => (v === true || v === "Y" || v === "y" ? "Y" : "N");
const bool = (v: unknown) => v === "Y" || v === "y" || v === true;

/**
 * Map a joined Supabase row (ticket + customer) back to the flat UI Ticket.
 */
function rowToTicket(row: any): Ticket {
  const c = row.customer ?? {};
  return {
    ticketNo: row.ticket_no,
    ticketSource: row.ticket_source ?? "",
    warranty: row.warranty ?? "",
    manufacturer: row.manufacturer ?? "",
    customer: c.full_name ?? "",
    city: c.city ?? "",
    location: row.location ?? "",
    model: row.model ?? "",
    internalNote: row.internal_note ?? "",
    problemDescription: row.problem_description ?? "",
    diagnosed: row.diagnosed ? "Y" : "N",
    technician: row.technician ?? "",
    customerPref: row.customer_pref ? "Y" : "N",
    schedule: row.schedule_date ?? "",
    status: row.status ?? "",
    phone: c.phone ?? "",
    redo: row.redo ? "Y" : "N",
    aging: row.aging ?? 0,
    calls: row.calls ?? 0,
    partOrder: row.part_order ?? "",
    created: row.created_at ? String(row.created_at).slice(0, 10) : "",
    statusChangedAt: row.status_changed_at ?? undefined,
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
  customer:customers ( id, first_name, last_name, full_name, phone, second_phone, email, address, address2, city, state, zip, address_note )
`;

// ---- reads -----------------------------------------------------------------

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
    email?: string;
    address?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
  }
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
 * Update editable ticket-level fields (e.g. problem description, internal note).
 */
export async function updateTicketFields(
  ticketNo: string,
  fields: { problemDescription?: string; internalNote?: string }
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.problemDescription !== undefined) payload.problem_description = fields.problemDescription;
  if (fields.internalNote !== undefined) payload.internal_note = fields.internalNote;
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

// suppress unused warning for yn helper (kept for future field mapping)
void yn;
