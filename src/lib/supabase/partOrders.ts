/**
 * Supabase part orders service — the PO Management data layer.
 * Mirrors the old localStorage poDataStore API but persists to the
 * `part_orders` table (company-scoped via RLS).
 */

import { supabase } from "./client";

/**
 * Return true if a Part Distributor value refers to Marcone in any of its
 * known variants ("Marcone", "Marcone-162468", "Marcone- Birmingham /
 * Montgomery", etc.). Case-insensitive whole-word match so "Encompass" or
 * other distributors that happen to contain similar substrings don't
 * accidentally trigger Marcone-specific flows.
 */
export function isMarconeDist(value: string | null | undefined): boolean {
  return /\bmarcone\b/i.test(String(value || ""));
}

/** Address used as the ship-to on a Marcone order. */
export interface ShipToAddress {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
}

/**
 * Payload handed from the Marcone Parts Order modal to the persistence
 * layer. Shape mirrors what Marcone's documented mSupply `POST /orders`
 * endpoint expects so a future swap to a real REST call is mechanical
 * rather than a refactor.
 */
export interface MarconeOrderPayload {
  ticketNo: string;
  /** PO number to write on the order + back onto every line's parts row. */
  purchaseOrderNumber: string;
  shipMethod: string;
  shipTo: ShipToAddress;
  lineItems: Array<{
    /** Local parts.id — used by placeMarconeOrder to write back PO Made. */
    partId: string;
    partNumber: string;
    description: string;
    quantity: number;
    unitPrice: number;
    coreValue: number;
  }>;
}

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


/**
 * Place a Marcone Parts Order.
 *
 * Calls Marcone's `POST /orders/purchaseorder` through the server bridge
 * (so client_id/client_secret stay on the server) and writes the result
 * back to Supabase:
 *
 * 1. Build the Marcone PurchaseOrderRequest payload from the modal's
 *    selected lines + ship-to.
 * 2. POST it to Marcone. On a non-success response, throw — nothing
 *    is written locally so the user can fix the form and retry.
 * 3. Insert a single `part_orders` summary row (one per PO) carrying
 *    Marcone's invoice / order# / ETA / tracking back into our system.
 * 4. Stamp every parts row referenced by `lineItems[].partId` with the
 *    PO no, ETA, in-tracking, order# and status='PO Made' so the
 *    ticket detail grid reflects the live order info.
 * 5. On any partial failure (a parts row update throws after step 3
 *    succeeded), best-effort delete the inserted summary so the user
 *    can retry without an orphan.
 *
 * Returns the PO number plus Marcone's invoice / order# / ETA / tracking
 * so the modal can surface them in the success toast.
 */
export interface MarconeOrderResult {
  poNo: string;
  affectedPartIds: string[];
  /** Marcone's order number (their system's id, distinct from our PO no). */
  marconeOrderNo?: string;
  /** Marcone's invoice number, if returned at order time. */
  invoiceNo?: string;
  /** Estimated ship / arrival date from Marcone, ISO YYYY-MM-DD. */
  eta?: string;
  /** Carrier tracking # if Marcone returned one. */
  tracking?: string;
  /** Raw response payload kept for debugging / future enrichment. */
  raw?: unknown;
}

/**
 * Shape of the response Marcone's `/orders/purchaseorder` returns.
 * Names taken straight from the Marcone Swagger schema so we don't have
 * to guess again. `orderNumbers` is plural because Marcone may split an
 * order across multiple warehouses and return one number per shipment.
 */
interface MarconePurchaseOrderResponseRaw {
  transactionId?: string;
  orderNumbers?: string[];
  substitutions?: Array<{
    make?: string;
    partNumber?: string;
    subMake?: string;
    subPartNumber?: string;
  }>;
  status?: string;
  reason?: string;
  success?: boolean;
  errorCode?: string;
  /** Some endpoints still use this even when the schema doesn't list it. */
  errorMessage?: string;
}

function pick<T>(obj: Record<string, any>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k] as T;
  }
  return undefined;
}

export async function placeMarconeOrder(payload: MarconeOrderPayload): Promise<MarconeOrderResult> {
  const poNo = (payload.purchaseOrderNumber || "").trim() || generatePoNumber();
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Build the Marcone PurchaseOrderRequest body ──────────────────
  //
  // Schema (from Marcone Swagger, /orders/purchaseorder):
  //   custNo             integer       — Marcone customer account number (required)
  //   poNumber           string        — your reference PO number
  //   warehouseNumber    string        — preferred warehouse (blank = Marcone optimises)
  //   shippingMethod     string        — e.g. "FedEx Ground", "UPS Ground"
  //   shipTo             { name, address1, address2, city, state, zip }
  //   purchaseOrderItems [{ make, partNumber, quantity, reference, warehouseNumber }]
  //   eP_*               servicer-extension fields (optional, useful metadata)
  //
  // `custNo` is the only field Marcone is strict about — without it the
  // sandbox returns "Unknown error; retry again later." which is what
  // bit us before. Configure it via VITE_MARCONE_ACCOUNT_NUMBER in the
  // env (or VITE_MARCONE_CUST_NO if you prefer the Marcone-doc spelling
  // — both names are accepted).
  const env = (import.meta as any).env || {};
  const custNoStr = env.VITE_MARCONE_ACCOUNT_NUMBER || env.VITE_MARCONE_CUST_NO;
  const custNo = custNoStr ? Number(custNoStr) : 0;
  if (!custNo || Number.isNaN(custNo)) {
    throw new Error(
      "Marcone customer number not configured. " +
      "Set VITE_MARCONE_ACCOUNT_NUMBER in the Cloudflare Worker secrets to " +
      "your Marcone account number (e.g. 162468).",
    );
  }

  // Marcone /orders/purchaseorder REQUIRES `make` on each line item
  // (their internal brand code like "GEH", "WP", "FRG"). For /parts/lookup
  // it's optional, but for ordering it isn't. Pre-resolve each part's make
  // by calling /parts/lookup so we don't have to maintain a brand→code
  // table on our side. If any part can't be resolved we abort the whole
  // order with a clear error rather than sending a bad request.
  const { marconeLookupPart } = await import("@/lib/marconeApi");
  const resolvedItems: Array<{
    make: string;
    partNumber: string;
    quantity: number;
    reference: string;
    warehouseNumber: string;
  }> = [];
  for (const line of payload.lineItems) {
    const lookup = await marconeLookupPart({
      partNumber: line.partNumber,
      quantity: line.quantity || 1,
    });
    const make = lookup.success && lookup.data?.make ? lookup.data.make.trim() : "";
    if (!make) {
      throw new Error(
        `Could not resolve Marcone make for part ${line.partNumber}. ` +
        `Lookup result: ${lookup.error || lookup.data?.errorMessage || "no make returned"}.`,
      );
    }
    resolvedItems.push({
      make,
      partNumber: line.partNumber,
      quantity: line.quantity || 1,
      reference: payload.ticketNo,
      warehouseNumber: "",
    });
  }

  const marconeBody = {
    custNo,
    poNumber: poNo,
    warehouseNumber: "", // let Marcone pick the closest fulfilment warehouse
    shippingMethod: payload.shipMethod,
    shipTo: {
      name: payload.shipTo.name,
      address1: payload.shipTo.street1,
      address2: payload.shipTo.street2,
      city: payload.shipTo.city,
      state: payload.shipTo.state,
      zip: payload.shipTo.zip,
    },
    purchaseOrderItems: resolvedItems,
    // eP_* are servicer-extension fields: free-form metadata that Marcone
    // echoes back on the order so the warehouse can see who placed it.
    eP_ShipToCustomer: 0,
    eP_ShipToBranch: "",
    eP_InternalNotes: `Ticket ${payload.ticketNo}`,
    eP_ShippingInstructions: `Ship via ${payload.shipMethod} to ${payload.shipTo.name}`,
    eP_OrderBy: "",
    eP_Writer: "",
    eP_RequiredDate: "",
    eP_BusinessUnit: "",
  };

  // ── 2. POST through the server bridge (keeps secrets server-side) ──
  // We only require the env var to be set; the bridge will return a
  // structured error if it isn't. We deliberately don't fall back to a
  // mock here — the user explicitly asked for a real order.
  const { marconeRequest } = await import("@/lib/marconeApi");
  const apiResult = await marconeRequest<MarconePurchaseOrderResponseRaw>(
    "/orders/purchaseorder",
    { method: "POST", body: marconeBody },
  );

  if (!apiResult.success || !apiResult.data) {
    const data = (apiResult.data as MarconePurchaseOrderResponseRaw) || {};
    console.error("[placeMarconeOrder] Marcone HTTP error:", {
      status: apiResult.status,
      error: apiResult.error,
      data,
    });
    const detail =
      data.errorMessage ||
      data.reason ||
      apiResult.error ||
      `HTTP ${apiResult.status || "?"} — ${JSON.stringify(data).slice(0, 300)}`;
    throw new Error(`Marcone /orders/purchaseorder failed: ${detail}`);
  }
  const resp = apiResult.data;
  // Marcone's response carries `success: boolean` but it's unreliable —
  // they sometimes return `success: false` on orders that actually
  // placed (saw it in production with orderNumbers populated). The real
  // signal is whether `orderNumbers` came back with at least one entry:
  // if Marcone gave us an order number, the order is in their system.
  // We only treat it as a failure when there are no numbers AND we have
  // a reason / error code / message to surface.
  const orderNumbers = Array.isArray(resp.orderNumbers) ? resp.orderNumbers.filter(Boolean) : [];
  if (orderNumbers.length === 0) {
    const detail = resp.reason || resp.errorMessage || resp.errorCode || resp.status || "Marcone declined the order";
    console.error("[placeMarconeOrder] Marcone declined the order:", resp);
    throw new Error(`Marcone /orders/purchaseorder failed: ${detail}`);
  }

  // Marcone may split an order across warehouses and return one number per
  // shipment. We keep all of them but use the first as the primary id; the
  // full list is stamped into the note so the user can see splits.
  const marconeOrderNo = orderNumbers[0];
  const orderNumbersLabel = orderNumbers.length > 1 ? orderNumbers.join(", ") : marconeOrderNo;

  // Substitutions: Marcone may swap a part number for a current equivalent
  // (e.g. legacy WH part replaced by a WP supersede). Surface that on the
  // success path so the CSR knows to update the ticket's part record.
  const substitutionNotes = (resp.substitutions || [])
    .filter((s) => s.partNumber && s.subPartNumber && s.partNumber !== s.subPartNumber)
    .map((s) => `${s.partNumber} → ${s.subPartNumber}`)
    .join(", ");

  // ── 3. Persist a summary part_orders row with the live values ──────
  // Marcone's create response only gives us order numbers + substitution
  // info. ETA / tracking / invoice come from `/orders/orderstatus` after
  // the order ships — wire that as a polling/refresh action later if the
  // user wants live updates. For now we stamp what we know.
  const totalQty = payload.lineItems.reduce((sum, l) => sum + (l.quantity || 0), 0);
  const totalPrice = payload.lineItems.reduce((sum, l) => sum + (l.quantity || 0) * (l.unitPrice || 0), 0);
  const partNoSummary = payload.lineItems.map((l) => l.partNumber).filter(Boolean).join(", ");
  const partDescSummary = payload.lineItems.map((l) => l.description).filter(Boolean).join(" | ");
  const orderNoteParts = [
    `Ship via ${payload.shipMethod} to ${payload.shipTo.name}`,
    orderNumbers.length > 1 ? `Marcone split into ${orderNumbers.length} orders: ${orderNumbersLabel}` : null,
    substitutionNotes ? `Substitutions: ${substitutionNotes}` : null,
    resp.transactionId ? `mSupply txn: ${resp.transactionId}` : null,
  ].filter(Boolean);

  const order: StoredPartOrder = {
    poNo,
    ticketNo: payload.ticketNo,
    partNo: partNoSummary || (payload.lineItems[0]?.partNumber ?? ""),
    partDist: "Marcone",
    partDesc: partDescSummary,
    quantity: totalQty || 1,
    partPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
    poDate: today,
    eta: "",
    orderNo: marconeOrderNo || "",
    invoiceNo: "",
    inTracking: "",
    note: orderNoteParts.join(" | "),
    status: "PO Made",
    itemStatus: "No-Invoice",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await savePartOrder(order);

  // ── 4. Stamp every selected parts row with the live values ─────────
  const affectedPartIds: string[] = [];
  try {
    for (const line of payload.lineItems) {
      const patch: Record<string, unknown> = {
        status: "PO Made",
        po_no: poNo,
        po_date: today,
      };
      if (marconeOrderNo) patch.order_no = marconeOrderNo;

      const { error } = await supabase.from("parts").update(patch).eq("id", line.partId);
      if (error) {
        throw new Error(`Failed to update part ${line.partNumber}: ${error.message}`);
      }
      affectedPartIds.push(line.partId);
    }
  } catch (err) {
    // Best-effort rollback of the PO row so we don't leave an orphan.
    try {
      await deletePartOrder(poNo);
    } catch (rollbackErr) {
      console.warn("placeMarconeOrder rollback failed:", rollbackErr);
    }
    throw err;
  }

  return {
    poNo,
    affectedPartIds,
    marconeOrderNo,
    invoiceNo: undefined,
    eta: undefined,
    tracking: undefined,
    raw: resp,
  };
}
