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
  customer:customers ( id, first_name, last_name, full_name, phone, second_phone, email, address, city, state, zip, address_note )
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

// suppress unused warning for yn helper (kept for future field mapping)
void yn;
