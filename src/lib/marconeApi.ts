/**
 * Marcone mSupply API client.
 *
 * Browser-side wrapper around `POST /api/marcone`. The bridge keeps secrets
 * on the server, manages auth (cached bearer token), and proxies actual REST
 * calls. The browser never sees `client_id`, `client_secret`, or the bearer.
 *
 * Quick reference for the full mSupply API:
 *   https://api.msupply.com/swagger/index.html?url=/swagger/v1/swagger.jsonAttached
 *
 * Usage:
 *   const res = await marconePing();
 *   if (res.success) console.log("Auth OK", res.tokenFingerprint);
 *
 *   const part = await marconeRequest("/Catalog/by-model", { method: "GET",
 *     query: { modelNumber: "WR60X10141" } });
 *   if (part.success) console.log(part.data);
 */

export interface MarconePingResult {
  success: boolean;
  error?: string;
  env?: "integration" | "production" | string;
  baseUrl?: string;
  tokenFingerprint?: string;
  expiresAt?: number | null;
}

export interface MarconeApiResult<T = unknown> {
  success: boolean;
  status?: number;
  data?: T;
  error?: string;
}

interface MarconeRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

async function postJson<T>(payload: unknown): Promise<T> {
  const res = await fetch("/api/marcone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Marcone bridge returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Quick health check — confirms the token endpoint works for the configured env. */
export async function marconePing(): Promise<MarconePingResult> {
  try {
    return await postJson<MarconePingResult>({ action: "getToken" });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Make authenticated REST call against mSupply through the server proxy. */
export async function marconeRequest<T = unknown>(
  path: string,
  options: MarconeRequestOptions = {},
): Promise<MarconeApiResult<T>> {
  // Tracker key uses the path so each endpoint streaks independently
  // (e.g. /parts/lookup vs /orders/orderstatus). Failures + logical
  // failures both feed into apiHealth.runWithApiHealth → admins get a
  // notification once a single endpoint fails three times in a row.
  const { runWithApiHealth } = await import("./apiHealth");
  return runWithApiHealth(
    `marcone${path}`,
    async () => {
      try {
        return await postJson<MarconeApiResult<T>>({
          action: "request",
          path,
          method: options.method || "GET",
          query: options.query,
          body: options.body,
        });
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) } as MarconeApiResult<T>;
      }
    },
    {
      isFailure: (r) => Boolean(r && (r as any).success === false),
      describeFailure: (r) => String((r as any)?.error ?? "Marcone request failed"),
    },
  );
}

// ─── Parts ──────────────────────────────────────────────────────────────────

/**
 * Marcone /parts/lookup raw response shape (subset of fields we use).
 * The real Swagger response is wrapped in `partResults: [...]` with each
 * entry carrying its own description / price / inventory rows. We surface a
 * normalised view on top via marconeLookupPart so callers don't have to know.
 */
interface MarconePartResultRaw {
  make?: string;
  partNumber?: string;
  description?: string;
  /** Dealer cost (your account's net). */
  price?: number;
  dealer?: number;
  list?: number;
  retail?: number;
  coreCost?: number | null;
  isDiscontinued?: boolean;
  isDropShipOnly?: boolean;
  inventory?: Array<{
    warehouseNumber?: string;
    warehouseName?: string;
    timeInTransitDays?: number | null;
    quantityAvailable?: number;
  }>;
  subParts?: unknown[];
  crossReferenceParts?: unknown[];
  totalWarehouseQty?: number;
}
interface MarconeLookupRawResponse {
  transactionId?: string;
  partResults?: MarconePartResultRaw[];
  errorMessage?: string;
}

/** Normalised part info we hand back to the UI. */
export interface MarconePartInfo {
  transactionId?: string;
  make?: string;
  partNumber?: string;
  description?: string;
  /** Net price for this account (dealer if present, falls back to price/list). */
  netPrice?: number;
  listPrice?: number;
  coreValue?: number;
  /** True if at least one warehouse has stock. */
  inStock?: boolean;
  /** Total quantity across warehouses. */
  totalAvailable?: number;
  /** Per-warehouse breakdown for tooltips / detail views. */
  inventory?: Array<{
    warehouseName?: string;
    quantityAvailable?: number;
  }>;
  isDiscontinued?: boolean;
  errorMessage?: string;
}

export interface MarconePartLookupResult extends MarconeApiResult<MarconePartInfo> {
  notFound?: boolean;
}

/**
 * Look up a single part by part number, optionally constrained to a make.
 * The `make` argument is OPTIONAL — Marcone will resolve the brand on its
 * end if omitted, which is more reliable than passing a possibly-wrong make
 * (e.g. they use codes like "GEH" instead of "GE").
 *
 * Returns `{ success: false, notFound: true }` for 400 "not found" so callers
 * can treat that as a clean negative without it looking like an error.
 */
export async function marconeLookupPart(args: {
  partNumber: string;
  make?: string;
  quantity?: number;
}): Promise<MarconePartLookupResult> {
  if (!args.partNumber?.trim()) {
    return { success: false, error: "partNumber is required" };
  }
  // Build body — only include `make` if the caller passed something.
  const body: Record<string, unknown> = {
    partNumber: args.partNumber.trim(),
    quantity: args.quantity ?? 1,
  };
  if (args.make?.trim()) body.make = args.make.trim();

  const result = await marconeRequest<MarconeLookupRawResponse>("/parts/lookup", {
    method: "POST",
    body,
  });
  if (!result.success) {
    const data = (result.data as MarconeLookupRawResponse) || {};
    const msg = String(data.errorMessage || result.error || "").toLowerCase();
    if (msg.includes("not found")) {
      return {
        success: false,
        notFound: true,
        data: { errorMessage: data.errorMessage || result.error } as MarconePartInfo,
        error: data.errorMessage || result.error,
      };
    }
    return { success: false, error: data.errorMessage || result.error };
  }

  // Pull the first match out of partResults and normalise the shape.
  const raw = (result.data as MarconeLookupRawResponse) || {};
  const first = raw.partResults?.[0];
  if (!first) {
    return {
      success: false,
      notFound: true,
      error: "No part results returned by Marcone",
    };
  }
  const total =
    typeof first.totalWarehouseQty === "number"
      ? first.totalWarehouseQty
      : (first.inventory ?? []).reduce(
          (sum, inv) => sum + (Number(inv.quantityAvailable ?? 0) || 0),
          0,
        );
  const info: MarconePartInfo = {
    transactionId: raw.transactionId,
    make: first.make,
    partNumber: first.partNumber,
    description: first.description,
    // `price` is your account's net cost (your pricing-group rate). `dealer`
    // is Marcone's standard dealer price for accounts WITHOUT special pricing
    // — it's higher and would over-charge your tickets if used. Always
    // prefer `price`; fall back to `dealer` then `list` only if missing.
    netPrice: first.price ?? first.dealer ?? first.list ?? undefined,
    listPrice: first.list ?? undefined,
    coreValue: first.coreCost ?? undefined,
    isDiscontinued: first.isDiscontinued,
    inventory: (first.inventory ?? []).map((inv) => ({
      warehouseName: inv.warehouseName,
      quantityAvailable: inv.quantityAvailable,
    })),
    totalAvailable: total,
    inStock: total > 0,
  };
  return { success: true, status: result.status, data: info };
}


// ─── Order Status ───────────────────────────────────────────────────────

/**
 * Subset of fields we pull from Marcone /orders/orderstatus. Marcone's
 * raw response is deeply nested (OrderInformation[] → items[], warehouse,
 * shipments, etc.) — we flatten the bits the UI cares about so callers
 * don't have to walk the tree themselves.
 */
export interface MarconeOrderStatusInfo {
  orderNumber?: string;
  warehouseNumber?: string;
  warehouseName?: string;
  /** Top-level order status (e.g. "Open", "Picked", "Shipped", "Invoiced"). */
  status?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  /** Most-confident ETA we could find (ISO YYYY-MM-DD). */
  eta?: string;
  /** Tracking numbers from the order's shipments, joined with commas. */
  trackingNumbers?: string;
  /** Per-line statuses for diagnostics. */
  itemStatuses?: Array<{
    partNumber?: string;
    status?: string;
    quantity?: number;
    eta?: string;
  }>;
  /** The raw payload, kept so future fields can be surfaced without changing the API surface. */
  raw?: unknown;
}

interface MarconeOrderStatusRawItem {
  partNumber?: string;
  status?: string;
  quantity?: number;
  eta?: string;
  ETA?: string;
  // Some Marcone payloads attach the tracking number on the item rather
  // than on a shipments[] array — keep these as accepted aliases so the
  // extractor can find them either way.
  trackingNumber?: string;
  TrackingNumber?: string;
  tracking?: string;
  carrier?: string;
  shippingProvider?: string;
}

interface MarconeOrderStatusRawShipment {
  trackingNumber?: string;
  TrackingNumber?: string;
  tracking?: string;
  carrier?: string;
  shippingProvider?: string;
  shipDate?: string;
}

interface MarconeOrderInformationRaw {
  orderNumber?: string;
  OrderNumber?: string;
  status?: string;
  Status?: string;
  warehouseNumber?: string;
  warehouseName?: string;
  warehouseInformation?: { warehouseNumber?: string; warehouseName?: string; eta?: string };
  invoiceNumber?: string;
  InvoiceNumber?: string;
  invoiceDate?: string;
  eta?: string;
  ETA?: string;
  estimatedArrival?: string;
  items?: MarconeOrderStatusRawItem[];
  orderInformationItems?: MarconeOrderStatusRawItem[];
  shipments?: MarconeOrderStatusRawShipment[];
  // Marcone has been seen flattening the tracking number onto the order
  // header for single-line orders (e.g. the Atlanta / Jacksonville one
  // displayed on marcone.com). Accept those names too.
  trackingNumber?: string;
  TrackingNumber?: string;
  tracking?: string;
  trackingNumbers?: string;
  carrier?: string;
  shippingProvider?: string;
  shippingMethod?: string;
}

interface MarconeOrderStatusResponseRaw {
  transactionId?: string;
  orderInformation?: MarconeOrderInformationRaw[];
  orders?: MarconeOrderInformationRaw[];
  errorMessage?: string;
}

function normIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

/**
 * Look up live status for an order Marcone is fulfilling. Used by the
 * "Refresh from Marcone" button on a PO Made part row so the CSR can
 * pull ETA / invoice # / tracking # back to the local record without
 * waiting for Marcone to push.
 *
 * Marcone wants `custNo` + at least one `orderNumber`. We always use the
 * customer number that placed the original order (VITE_MARCONE_CUST_NO
 * or VITE_MARCONE_ACCOUNT_NUMBER).
 */
export async function marconeOrderStatus(args: {
  orderNumber: string;
  custNo?: number;
}): Promise<MarconeApiResult<MarconeOrderStatusInfo>> {
  const orderNumber = args.orderNumber?.trim();
  if (!orderNumber) {
    return { success: false, error: "orderNumber is required" };
  }

  // Resolve custNo from env when the caller didn't pass one explicitly.
  const env = (import.meta as any).env || {};
  const custNo =
    args.custNo ||
    Number(env.VITE_MARCONE_ACCOUNT_NUMBER || env.VITE_MARCONE_CUST_NO || 0);
  if (!custNo || Number.isNaN(custNo)) {
    return {
      success: false,
      error: "Marcone customer number not configured (VITE_MARCONE_CUST_NO).",
    };
  }

  // Marcone's /orders/orderstatus accepts a single `orderNumber` string,
  // not the `orderNumbers[]` array that /orders/purchaseorder returns.
  // Confusing but consistent across their sandbox + production. We also
  // send `orderNumbers` defensively in case a future version flips to
  // batch lookups — Marcone ignores unknown fields.
  const body = {
    custNo,
    orderNumber,
    orderNumbers: [orderNumber],
  };

  const result = await marconeRequest<MarconeOrderStatusResponseRaw>(
    "/orders/orderstatus",
    { method: "POST", body },
  );
  if (!result.success) {
    const data = (result.data as MarconeOrderStatusResponseRaw) || {};
    return {
      success: false,
      status: result.status,
      error: data.errorMessage || result.error || `HTTP ${result.status || "?"}`,
    };
  }

  // Marcone's response shape on this endpoint is inconsistent between
  // sandboxes; we've seen `orderResults[]` (production today),
  // `orderInformation[]` (some docs), `orders[]` (other docs), plus a
  // direct single-object response with no wrapper. Walk every known
  // shape and pick the first non-empty match.
  const raw = (result.data as MarconeOrderStatusResponseRaw & {
    orderResults?: MarconeOrderInformationRaw[];
    orderStatusInfo?: MarconeOrderInformationRaw[];
    orderStatuses?: MarconeOrderInformationRaw[];
    Orders?: MarconeOrderInformationRaw[];
    OrderInformation?: MarconeOrderInformationRaw[];
    orderNumber?: string;
    status?: string;
  }) || {};

  const candidates: MarconeOrderInformationRaw[] = [];
  for (const arr of [
    raw.orderResults,
    raw.orderInformation,
    raw.OrderInformation,
    raw.orders,
    raw.Orders,
    raw.orderStatusInfo,
    raw.orderStatuses,
  ]) {
    if (Array.isArray(arr) && arr.length > 0) candidates.push(...arr);
  }
  // Some sandboxes return the order info inline at the top level
  // (no array wrapper). Treat that as a one-element candidate.
  if (candidates.length === 0 && (raw.orderNumber || raw.status)) {
    candidates.push(raw as MarconeOrderInformationRaw);
  }

  const info = candidates[0] || null;
  if (!info) {
    // Surface both the keys at the root AND the full raw payload so the
    // parser can be extended once we know what wrapper Marcone is using
    // this time. Console.dir keeps the object expandable in DevTools.
    console.error(
      "[marconeOrderStatus] Unrecognised response shape. Root keys:",
      Object.keys(raw),
    );
    try {
      console.dir(raw, { depth: 4 });
    } catch {
      console.error("[marconeOrderStatus] Raw payload:", raw);
    }
    return {
      success: false,
      status: result.status,
      error:
        "Marcone returned no order information for that order number. " +
        "Open DevTools Console for the raw payload so the parser can be extended.",
    };
  }

  const items = info.items || info.orderInformationItems || [];
  // Pick the soonest ETA across the order header, per-item ETAs, and the
  // warehouseInformation block; Marcone scatters them depending on stock.
  const etaCandidates = [
    info.eta,
    info.ETA,
    info.estimatedArrival,
    info.warehouseInformation?.eta,
    ...items.map((it) => it.eta || it.ETA),
  ]
    .map((v) => (v ? new Date(v) : null))
    .filter((d): d is Date => !!d && !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const eta = etaCandidates[0] ? etaCandidates[0].toISOString().slice(0, 10) : undefined;

  // Tracking number can show up on the order header, on individual
  // items, or under shipments[]. Marcone moves it around depending on
  // the order shape (single-line vs multi-line, single warehouse vs
  // split). Pull from all known locations, de-dupe, join with commas.
  const seenTracking = new Set<string>();
  const collectTracking = (value: string | undefined | null) => {
    if (!value) return;
    String(value)
      .split(/[,\s/;|]+/)
      .map((v) => v.trim())
      .filter((v) => v && /\d/.test(v))
      .forEach((v) => seenTracking.add(v));
  };
  collectTracking(info.trackingNumber);
  collectTracking(info.TrackingNumber);
  collectTracking(info.tracking);
  collectTracking(info.trackingNumbers);
  for (const s of info.shipments ?? []) {
    collectTracking(s.trackingNumber);
    collectTracking(s.TrackingNumber);
    collectTracking(s.tracking);
  }
  for (const it of items) {
    collectTracking(it.trackingNumber);
    collectTracking(it.TrackingNumber);
    collectTracking(it.tracking);
  }
  const trackingNumbers = Array.from(seenTracking).join(", ");

  const flat: MarconeOrderStatusInfo = {
    orderNumber: info.orderNumber || info.OrderNumber || orderNumber,
    warehouseNumber: info.warehouseNumber || info.warehouseInformation?.warehouseNumber,
    warehouseName: info.warehouseName || info.warehouseInformation?.warehouseName,
    status: info.status || info.Status,
    invoiceNumber: info.invoiceNumber || info.InvoiceNumber,
    invoiceDate: normIso(info.invoiceDate),
    eta,
    trackingNumbers: trackingNumbers || undefined,
    itemStatuses: items.map((it) => ({
      partNumber: it.partNumber,
      status: it.status,
      quantity: it.quantity,
      eta: normIso(it.eta || it.ETA),
    })),
    raw: info,
  };

  return { success: true, status: result.status, data: flat };
}
