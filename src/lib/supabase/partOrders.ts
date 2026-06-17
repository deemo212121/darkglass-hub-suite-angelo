/**
 * Supabase part orders service — the PO Management data layer.
 * Mirrors the old localStorage poDataStore API but persists to the
 * `part_orders` table (company-scoped via RLS).
 */

import { supabase } from "./client";

export interface StoredPartOrder {
  poNo: string;
  ticketNo: string;
  partNo: string;
  partDist: string;
  partDesc: string;
  quantity: number;
  partPrice: number;
  poDate: string;
  eta: string;
  invoiceNo?: string;
  invoiceDate?: string;
  orderNo?: string;
  inTracking?: string;
  outTracking?: string;
  status: 'Need PO' | 'PO Made' | 'Back Order' | 'Part Ready' | 'Tech Pickup' | 'Claimed' | 'Used' | 'Cancelled';
  itemStatus: 'No-Invoice' | 'Invoiced' | 'Received' | 'Claimed';
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** Generate PO number in format PO-YYMMDD-XXX */
export function generatePoNumber(index: number = 0): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq = String(index + 1).padStart(3, '0');
  return `PO-${yy}${mm}${dd}-${seq}`;
}

/** Convert a ticket part draft to the stored part order shape. */
export function createPartOrderFromTicket(ticketNo: string, partDraft: any): StoredPartOrder {
  return {
    poNo: partDraft.poNo || generatePoNumber(),
    ticketNo,
    partNo: partDraft.partNo,
    partDist: partDraft.partDist,
    partDesc: partDraft.partDesc,
    quantity: parseInt(partDraft.quantity) || 1,
    partPrice: parseFloat(partDraft.partPrice) || 0,
    poDate: partDraft.poDate || new Date().toISOString().split('T')[0],
    eta: partDraft.eta || '',
    invoiceNo: partDraft.invoiceNo,
    invoiceDate: partDraft.invoiceDate,
    orderNo: partDraft.orderNo,
    inTracking: partDraft.inTracking,
    outTracking: partDraft.outTracking,
    status: (partDraft.status || 'Need PO') as StoredPartOrder['status'],
    itemStatus: (partDraft.invoiceNo ? 'Invoiced' : 'No-Invoice') as StoredPartOrder['itemStatus'],
    note: partDraft.note,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const dateOrNull = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

function rowToOrder(row: any): StoredPartOrder {
  return {
    poNo: row.po_no,
    ticketNo: row.ticket_no ?? "",
    partNo: row.part_no ?? "",
    partDist: row.part_dist ?? "",
    partDesc: row.part_desc ?? "",
    quantity: row.quantity != null ? Number(row.quantity) : 1,
    partPrice: row.part_price != null ? Number(row.part_price) : 0,
    poDate: row.po_date ?? "",
    eta: row.eta ?? "",
    invoiceNo: row.invoice_no ?? undefined,
    invoiceDate: row.invoice_date ?? undefined,
    orderNo: row.order_no ?? undefined,
    inTracking: row.in_tracking ?? undefined,
    outTracking: row.out_tracking ?? undefined,
    status: (row.status ?? 'Need PO') as StoredPartOrder['status'],
    itemStatus: (row.item_status ?? 'No-Invoice') as StoredPartOrder['itemStatus'],
    note: row.note ?? undefined,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

function orderToColumns(o: StoredPartOrder) {
  return {
    po_no: o.poNo,
    ticket_no: o.ticketNo ?? null,
    part_no: o.partNo ?? null,
    part_dist: o.partDist ?? null,
    part_desc: o.partDesc ?? null,
    quantity: Number.isFinite(o.quantity) ? o.quantity : 1,
    part_price: Number.isFinite(o.partPrice) ? o.partPrice : 0,
    po_date: dateOrNull(o.poDate),
    eta: dateOrNull(o.eta),
    invoice_no: o.invoiceNo ?? null,
    invoice_date: dateOrNull(o.invoiceDate),
    order_no: o.orderNo ?? null,
    in_tracking: o.inTracking ?? null,
    out_tracking: o.outTracking ?? null,
    status: o.status ?? 'Need PO',
    item_status: o.itemStatus ?? 'No-Invoice',
    note: o.note ?? null,
  };
}

/** Get all part orders for the company (RLS-scoped). */
export async function getAllPartOrders(): Promise<StoredPartOrder[]> {
  const { data, error } = await supabase
    .from("part_orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getAllPartOrders error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToOrder);
}

/** Save or update a part order (upsert on company_id + po_no). */
export async function savePartOrder(order: StoredPartOrder): Promise<void> {
  // Does this PO already exist for the company?
  const { data: existing } = await supabase
    .from("part_orders")
    .select("id")
    .eq("po_no", order.poNo)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("part_orders")
      .update(orderToColumns(order))
      .eq("id", existing.id);
    if (error) {
      console.error("savePartOrder update error:", error.message);
      throw new Error(error.message);
    }
  } else {
    const { error } = await supabase
      .from("part_orders")
      .insert(orderToColumns(order)); // company_id auto-stamped by trigger
    if (error) {
      console.error("savePartOrder insert error:", error.message);
      throw new Error(error.message);
    }
  }
}

/** Get part orders for a specific ticket. */
export async function getTicketPartOrders(ticketNo: string): Promise<StoredPartOrder[]> {
  const { data, error } = await supabase
    .from("part_orders")
    .select("*")
    .eq("ticket_no", ticketNo)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getTicketPartOrders error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToOrder);
}

/** Delete a part order by PO number. */
export async function deletePartOrder(poNo: string): Promise<void> {
  const { error } = await supabase.from("part_orders").delete().eq("po_no", poNo);
  if (error) {
    console.error("deletePartOrder error:", error.message);
    throw new Error(error.message);
  }
}

/** Get part orders with optional filters (client-side filtering after fetch). */
export async function getFilteredPartOrders(filters: {
  ticketNo?: string;
  status?: string;
  partDist?: string;
  dateRange?: { start: string; end: string };
}): Promise<StoredPartOrder[]> {
  let orders = await getAllPartOrders();

  if (filters.ticketNo) orders = orders.filter(o => o.ticketNo === filters.ticketNo);
  if (filters.status) orders = orders.filter(o => o.status === filters.status);
  if (filters.partDist) orders = orders.filter(o => o.partDist === filters.partDist);
  if (filters.dateRange?.start && filters.dateRange?.end) {
    const start = new Date(filters.dateRange.start);
    const end = new Date(filters.dateRange.end);
    orders = orders.filter(o => {
      const d = new Date(o.poDate);
      return d >= start && d <= end;
    });
  }
  return orders;
}
