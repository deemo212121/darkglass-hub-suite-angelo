/**
 * NSA Platform API — client-side functions.
 *
 * All calls go through /api/nsa (server-side proxy) so credentials
 * are never exposed to the browser and CORS is bypassed.
 *
 * NSA API docs overview:
 *  - Authentication: Basic auth (base64 key:secret) — handled server-side
 *  - GET /dispatches            list work orders
 *  - GET /dispatches/{id}       single dispatch detail + part rules
 *  - GET /dispatches/{id}/parts parts on a dispatch
 *  - GET /dispatches/{id}/parts/bom  bill of materials
 *  - GET /partReturns           parts that need to be returned
 *  - PUT /dispatches/{id}/confirm   accept/reject/cancel
 *  - POST /dispatches/{id}/notes    add a note
 */

const API_ENDPOINT = "/api/nsa";

async function nsaCall(action: string, params: Record<string, any> = {}): Promise<any> {
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `NSA API error: ${res.status}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.data?.message || json.data?.error || `NSA error ${json.status}`);
  }
  return json.data;
}

// ─── Dispatch types ───────────────────────────────────────────────────────────

export interface NsaDispatch {
  dispatchNumber: string;
  caseNumber?: string;
  serial?: string;
  model?: string;
  brandCode?: string;
  brandName?: string;
  productType?: string;
  customerName?: string;
  customerAddress?: string;
  customerCity?: string;
  customerState?: string;
  customerZip?: string;
  customerPhone?: string;
  scheduleDate?: string;
  timeBlock?: string; // A=AM, P=PM, D=DAY, E=EVENING
  status?: string;
  serviceClass?: string; // MA=Major Appliances, CE=Consumer Electronics, etc.
  // Part ordering rules
  canOrderOwnParts?: boolean;
  canOrderPartsThroughNSA?: boolean;
  hasPartsBOM?: boolean;
  partOrdersMustBeOnBOM?: boolean;
  // Part IDs on this dispatch
  partIDs?: string[];
  [key: string]: any;
}

export interface NsaDispatchPart {
  partID?: string;
  partNumber?: string;
  description?: string;
  mfgCode?: string;
  quantity?: number;
  costEach?: number;
  status?: string;
  orderedThroughNSA?: boolean;
  inboundTracking?: string;
  inboundShipCo?: string;
  receivedDate?: string;
  backOrdered?: number;
  [key: string]: any;
}

export interface NsaPartReturn {
  partID?: string;
  dispatchNumber?: string;
  partNumber?: string;
  description?: string;
  returnReason?: string; // Core, Damaged, Defective, New Unused
  returnStatus?: string;
  [key: string]: any;
}

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Get list of dispatches.
 * @param options.status   Filter by status (e.g. "open", "accepted")
 * @param options.startDate  ISO date string (yyyy-mm-dd)
 * @param options.endDate    ISO date string (yyyy-mm-dd)
 * @param options.page     Page number (1-based)
 * @param options.limit    Results per page
 */
export async function getNsaDispatches(options: {
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
} = {}): Promise<NsaDispatch[]> {
  const data = await nsaCall("getDispatches", options);
  // NSA returns either an array or an object with a data/dispatches key
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.dispatches)) return data.dispatches;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

/**
 * Get full details for a single dispatch.
 */
export async function getNsaDispatch(dispatchNumber: string): Promise<NsaDispatch> {
  return nsaCall("getDispatch", { dispatchNumber });
}

/**
 * Get parts list for a dispatch.
 */
export async function getNsaDispatchParts(dispatchNumber: string): Promise<NsaDispatchPart[]> {
  const data = await nsaCall("getDispatchParts", { dispatchNumber });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.parts)) return data.parts;
  return [];
}

/**
 * Get the bill of materials (BOM) for the product on a dispatch.
 * Only available when dispatch.hasPartsBOM === true.
 */
export async function getNsaDispatchBOM(dispatchNumber: string): Promise<NsaDispatchPart[]> {
  const data = await nsaCall("getDispatchPartsBOM", { dispatchNumber });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.bom)) return data.bom;
  return [];
}

/**
 * Get all part returns (pending, in-progress, charged).
 */
export async function getNsaPartReturns(status?: string): Promise<NsaPartReturn[]> {
  const data = await nsaCall("getPartReturns", status ? { status } : {});
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.partReturns)) return data.partReturns;
  return [];
}

/**
 * Accept a dispatch (confirmID=1), reject (confirmID=2), or cancel/transfer (confirmID=6).
 */
export async function confirmNsaDispatch(
  dispatchNumber: string,
  confirmID: 1 | 2 | 6,
  reason?: string
): Promise<void> {
  await nsaCall("acceptDispatch", { dispatchNumber, confirmID, reason });
}

/**
 * Add a note to a dispatch.
 */
export async function addNsaDispatchNote(dispatchNumber: string, note: string): Promise<void> {
  await nsaCall("addDispatchNote", { dispatchNumber, note });
}

/**
 * Get notes for a dispatch.
 */
export async function getNsaDispatchNotes(dispatchNumber: string): Promise<any[]> {
  const data = await nsaCall("getDispatchNotes", { dispatchNumber });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.notes)) return data.notes;
  return [];
}

// ─── Time block label ────────────────────────────────────────────────────────

export function nsaTimeBlockLabel(code: string | undefined): string {
  const map: Record<string, string> = {
    A: "AM (8am–12pm)",
    P: "PM (12pm–5pm)",
    D: "DAY (8am–5pm)",
    E: "Evening (After 5pm)",
  };
  return map[String(code ?? "").toUpperCase()] ?? code ?? "";
}

// ─── Service class label ─────────────────────────────────────────────────────

export function nsaServiceClassLabel(code: string | undefined): string {
  const map: Record<string, string> = {
    AC: "HVAC",
    CE: "Consumer Electronics",
    CP: "Computer",
    EL: "Electrical",
    FR: "Furniture",
    GA: "Garage",
    GC: "Golf Cart",
    HM: "Handyman",
    IN: "Installations",
    IS: "Inspection",
    MA: "Major Appliances",
    OT: "Other",
    PL: "Plumbing",
    PO: "Pool/Spa",
    SH: "Special HVAC",
    SP: "Special",
  };
  return map[String(code ?? "").toUpperCase()] ?? code ?? "";
}
