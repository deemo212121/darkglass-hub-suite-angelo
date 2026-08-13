/**
 * Encompass Supply Chain Solutions API client.
 *
 * Browser-side wrapper around `POST /api/encompass`. The bridge keeps
 * jsonUser/jsonPassword on the server; the browser never sees them.
 *
 * Every Encompass endpoint is POST, wants a body shaped
 * `{ settings: {...}, data: {...} }`, and replies
 * `{ status: { errorCode, errorMessage }, data: {...} }` — errorCode "100"
 * means success, anything else (including negative codes) is a failure.
 * The bridge assembles `settings` server-side; callers here only ever deal
 * with the endpoint-specific `data` object.
 *
 * Docs: https://app.swaggerhub.com/apis-docs/Encompass.com/RestfulServices/1
 */

export interface EncompassApiResult<T = unknown> {
  success: boolean;
  status?: number;
  data?: T;
  error?: string;
}

async function postJson<T>(payload: unknown): Promise<T> {
  const res = await fetch("/api/encompass", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Encompass bridge returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

export interface EncompassStatus {
  errorCode?: string;
  errorMessage?: string;
}

/** Every Encompass response is wrapped this way, regardless of endpoint. */
export interface EncompassEnvelope<T> {
  status?: EncompassStatus;
  data?: T;
}

function isEncompassSuccess(status: EncompassStatus | undefined): boolean {
  return String(status?.errorCode ?? "").trim() === "100";
}

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Low-level proxy — hits any documented `/restfulservice/*` path through the
 * server bridge. `data` is the endpoint-specific body; jsonUser/jsonPassword
 * get merged in server-side. Transport-level failures (network error, bridge
 * misconfigured) come back as `success: false` at THIS level; a reachable
 * request that Encompass itself rejected (bad part number, etc.) still comes
 * back `success: true` here with the real answer inside `data.status`.
 */
export async function encompassRequest<T = unknown>(
  path: string,
  data: Record<string, unknown> = {},
): Promise<EncompassApiResult<EncompassEnvelope<T>>> {
  try {
    return await postJson<EncompassApiResult<EncompassEnvelope<T>>>({ path, data });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Quick health check — confirms the configured credentials actually authenticate. */
export async function encompassPing(): Promise<{ success: boolean; error?: string }> {
  // Brand List is the cheapest real call in the API (just returns the
  // manufacturer code table) — no part number needed, so it doubles as an
  // auth/connectivity check the same way marconePing() uses /AccessToken.
  const result = await encompassRequest<{ manufacturers?: unknown[] }>("/restfulservice/brandList", {});
  if (!result.data) return { success: false, error: result.error || "No response from Encompass bridge" };
  const status = result.data.status;
  if (!isEncompassSuccess(status)) {
    return { success: false, error: status?.errorMessage || `Encompass error ${status?.errorCode ?? "?"}` };
  }
  return { success: true };
}

// ---------------------------------------------------------------------
// Parts Information (lookup) — POST /restfulservice/partsInformation
// ---------------------------------------------------------------------

export interface EncompassPartInfo {
  basePN?: string;
  /** 3-character manufacturer code Encompass uses internally — required on createOrder's parts[].mfgCode. */
  mfgCode?: string;
  mfgName?: string;
  partNumber?: string;
  description?: string;
  listPrice?: number;
  corePrice?: number;
  partPrice?: number;
  totalPrice?: number;
  eta?: string;
  estimatedDeliveryDate?: string;
  inStock: boolean;
  totalAvailable: number;
  availabilityByLocation: Array<{ name?: string; number?: string; available: number }>;
}

export interface EncompassPartLookupResult {
  success: boolean;
  notFound?: boolean;
  data?: EncompassPartInfo;
  error?: string;
}

/**
 * Look up a single part by part number. Mirrors marconeLookupPart's shape
 * so callers (the ticket page's Lookup button) can treat both vendors the
 * same way.
 */
export async function encompassLookupPart(args: {
  partNumber: string;
  destinationZipCode?: string;
}): Promise<EncompassPartLookupResult> {
  if (!args.partNumber?.trim()) {
    return { success: false, error: "partNumber is required" };
  }
  const result = await encompassRequest<{ parts?: any[] }>("/restfulservice/partsInformation", {
    searchPartNumber: args.partNumber.trim(),
    destinationZipCode: args.destinationZipCode || "",
  });
  // Encompass replies with real non-2xx HTTP statuses for ordinary
  // business-logic rejections ("program not authorized", "not found",
  // etc.) — NOT just for true transport failures like Marcone's bridge.
  // `result.success` reflects the HTTP-level outcome, but data.status
  // still carries the real answer whenever a response was actually
  // received; only bail early on `result.error` when there's no data at
  // all (a genuine network/bridge failure).
  if (!result.data) {
    return { success: false, error: result.error || "No response from Encompass bridge" };
  }
  const status = result.data.status;
  if (!isEncompassSuccess(status)) {
    const msg = status?.errorMessage || "";
    if (/not found|no match|no result/i.test(msg)) {
      return { success: false, notFound: true, error: msg };
    }
    return { success: false, error: msg || `Encompass error ${status?.errorCode ?? "?"}` };
  }
  const first = result.data?.data?.parts?.[0];
  if (!first) {
    return { success: false, notFound: true, error: "No part results returned by Encompass" };
  }
  const locations: Array<{ name?: string; number?: string; available: number }> = Array.isArray(first.availabilityByLocation)
    ? first.availabilityByLocation.map((l: any) => ({ name: l.name, number: l.number, available: toNum(l.available) || 0 }))
    : [];
  const totalAvailable = locations.reduce((sum, l) => sum + l.available, 0);
  const info: EncompassPartInfo = {
    basePN: first.basePN,
    mfgCode: first.mfgCode,
    mfgName: first.mfgName,
    partNumber: first.partNumber,
    description: first.partDescription || first.detailedPartDescription,
    listPrice: toNum(first.listPrice),
    corePrice: toNum(first.corePrice),
    partPrice: toNum(first.partPrice),
    totalPrice: toNum(first.totalPrice),
    eta: first.eta,
    estimatedDeliveryDate: first.estimatedDeliveryDate,
    inStock: totalAvailable > 0,
    totalAvailable,
    availabilityByLocation: locations,
  };
  return { success: true, data: info };
}

// ---------------------------------------------------------------------
// Order creation — POST /restfulservice/createOrder
// ---------------------------------------------------------------------

export interface EncompassShipToAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zipCode: string;
  countryCode?: string;
  phoneNumber?: string;
}

export interface EncompassOrderPartLine {
  basePN?: string;
  /** Required — resolve via encompassLookupPart first if not already known. */
  mfgCode: string;
  partNumber: string;
  orderQuantity: number;
  authorizationOrReferenceNumber?: string;
}

/**
 * Places an order. The response only ever confirms status — Encompass
 * doesn't hand back an order number here, unlike Marcone. Callers must
 * follow up with encompassOrderStatus(referenceNumber1) to get the real
 * order number, ETA, and tracking once it's in their system.
 */
export async function encompassCreateOrder(args: {
  /** Your own reference number — also what you'll query orderStatus with afterward. */
  referenceNumber1: string;
  shippingMethod?: string;
  shipToAddress: EncompassShipToAddress;
  parts: EncompassOrderPartLine[];
}): Promise<{ success: boolean; error?: string }> {
  if (!args.referenceNumber1?.trim()) return { success: false, error: "referenceNumber1 is required" };
  if (!args.parts?.length) return { success: false, error: "At least one part is required" };

  const result = await encompassRequest("/restfulservice/createOrder", {
    referenceNumber1: args.referenceNumber1.trim(),
    shippingMethod: args.shippingMethod || "",
    shipToAddress: {
      name: args.shipToAddress.name,
      address1: args.shipToAddress.address1,
      address2: args.shipToAddress.address2 || "",
      city: args.shipToAddress.city,
      state: args.shipToAddress.state,
      zipCode: args.shipToAddress.zipCode,
      countryCode: args.shipToAddress.countryCode || "US",
      phoneNumber: args.shipToAddress.phoneNumber || "",
    },
    parts: args.parts.map((p) => ({
      basePN: p.basePN || "",
      mfgCode: p.mfgCode,
      partNumber: p.partNumber,
      orderQuantity: String(p.orderQuantity),
      authorizationOrReferenceNumber: p.authorizationOrReferenceNumber || "",
    })),
  });
  if (!result.data) {
    return { success: false, error: result.error || "No response from Encompass bridge" };
  }
  const status = result.data.status;
  if (!isEncompassSuccess(status)) {
    return { success: false, error: status?.errorMessage || `Encompass error ${status?.errorCode ?? "?"}` };
  }
  return { success: true };
}

// ---------------------------------------------------------------------
// Order status — POST /restfulservice/orderStatus
// ---------------------------------------------------------------------

export interface EncompassOrderStatusPart {
  status?: string;
  lineNumber?: number;
  partNumber?: string;
  description?: string;
  orderQuantity?: number;
  shipQuantity?: number;
  backorderQuantity?: number;
  eta?: string;
  inboundTracking?: string;
  outboundTrackings: Array<{ trackingNumber?: string; link?: string }>;
}

export interface EncompassOrderStatusRecord {
  open?: boolean;
  orderNumber?: string;
  orderDate?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalAmount?: number;
  carrierName?: string;
  shippingMethod?: string;
  parts: EncompassOrderStatusPart[];
}

export async function encompassOrderStatus(args: {
  referenceNumber: string;
}): Promise<{ success: boolean; records: EncompassOrderStatusRecord[]; error?: string }> {
  if (!args.referenceNumber?.trim()) return { success: false, records: [], error: "referenceNumber is required" };

  const result = await encompassRequest<{ open?: boolean; records?: any[] }>("/restfulservice/orderStatus", {
    referenceNumber: args.referenceNumber.trim(),
  });
  if (!result.data) {
    return { success: false, records: [], error: result.error || "No response from Encompass bridge" };
  }
  const status = result.data.status;
  if (!isEncompassSuccess(status)) {
    return { success: false, records: [], error: status?.errorMessage || `Encompass error ${status?.errorCode ?? "?"}` };
  }
  const rawRecords = result.data?.data?.records || [];
  const records: EncompassOrderStatusRecord[] = rawRecords.map((r: any) => ({
    open: r.open === "true" || r.open === true,
    orderNumber: r.orderNumber,
    orderDate: r.orderDate,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    totalAmount: toNum(r.totalAmount),
    carrierName: r.carrierName,
    shippingMethod: r.shippingMethod,
    parts: Array.isArray(r.parts)
      ? r.parts.map((p: any) => ({
          status: p.status,
          lineNumber: toNum(p.lineNumber),
          partNumber: p.partNumber,
          description: p.description,
          orderQuantity: toNum(p.orderQuantity),
          shipQuantity: toNum(p.shipQuantity),
          backorderQuantity: toNum(p.backorderQuantity),
          eta: p.eta,
          inboundTracking: p.inboundTracking,
          outboundTrackings: Array.isArray(p.outboundTrackings) ? p.outboundTrackings : [],
        }))
      : [],
  }));
  return { success: true, records };
}
