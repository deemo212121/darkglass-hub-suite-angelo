/**
 * NSA Platform API bridge (runtime-agnostic server-side proxy).
 *
 * Credentials are read from globalThis compile-time constants (injected by
 * vite.config.ts) or process.env — never exposed to the browser.
 *
 * Authentication:
 *   Default: Basic base64(key:secret) on every data request.
 *   Bearer:  POST /authorizations with Basic base64(user:password) → JWT.
 *
 * All endpoints verified against the full NSA SF API spec.
 */

type NsaAction =
  // Auth
  | "authenticate"
  // Users
  | "getUser" | "updateUser"
  // Dispatches
  | "getDispatches" | "getDispatch" | "updateDispatch" | "confirmDispatch"
  | "updateDispatchAddress" | "scheduleDispatch" | "logTrip"
  // Attachments
  | "getAttachments" | "addAttachment"
  // Notes
  | "getNotes" | "addNotes"
  // Communications
  | "getCommunications" | "addCommunications"
  // Parts
  | "getDispatchParts" | "getDispatchPart" | "addDispatchPart"
  | "updateDispatchPart" | "getDispatchBOM"
  // Estimates
  | "getEstimates" | "getEstimate" | "addEstimate" | "deleteEstimate"
  // Rule Sets
  | "getRuleSet" | "submitRuleSet" | "getMaskRules"
  // Payments
  | "getPayments" | "getBatchDetails" | "getCallDetails" | "updateLocation"
  // Part Returns
  | "getPartReturns"
  // Codes & Lookups
  | "getCommunicationCodes" | "getAttachmentTypes" | "getModels" | "getSerials";

interface NsaRequestBody {
  action: NsaAction;
  params?: Record<string, any>;
}

function buildBasicAuth(key: string, secret: string): string {
  const encoded = Buffer.from(`${key}:${secret}`).toString("base64");
  return `Basic ${encoded}`;
}

function nsaHeaders(auth: string): Record<string, string> {
  return {
    Authorization: auth,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function qs(params: Record<string, any>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function handleNsaRequest(
  request: Request,
  env?: Record<string, string | undefined>
): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Credentials — compile-time globals take priority
  const g = globalThis as any;
  const BASE_URL =
    (g.__NSA_BASE_URL__ && g.__NSA_BASE_URL__ !== "") ? g.__NSA_BASE_URL__
    : env?.NSA_BASE_URL ?? "https://dev-api.nationalservicealliance.com";
  const API_KEY =
    (g.__NSA_API_KEY__ && g.__NSA_API_KEY__ !== "") ? g.__NSA_API_KEY__
    : env?.NSA_API_KEY ?? "";
  const SECRET =
    (g.__NSA_SECRET__ && g.__NSA_SECRET__ !== "") ? g.__NSA_SECRET__
    : env?.NSA_SECRET ?? "";

  if (!API_KEY || !SECRET) {
    return new Response(
      JSON.stringify({ error: "NSA credentials not configured (NSA_API_KEY / NSA_SECRET)" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: NsaRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = buildBasicAuth(API_KEY, SECRET);
  const { action, params = {} } = body;

  try {
    let url: string;
    let method = "GET";
    let nsaBody: string | undefined;
    const headers = nsaHeaders(auth);

    const dn = encodeURIComponent(params.dispatchNumber ?? "");

    switch (action) {
      // ── Auth ──────────────────────────────────────────────────────────────
      case "authenticate": {
        const userAuth = "Basic " + Buffer.from(`${params.username}:${params.password}`).toString("base64");
        url = `${BASE_URL}/authorizations`;
        method = "POST";
        headers.Authorization = userAuth;
        if (params.latitude) headers.latitude = String(params.latitude);
        if (params.longitude) headers.longitude = String(params.longitude);
        headers["Content-Length"] = "0";
        nsaBody = "";
        break;
      }

      // ── Users ─────────────────────────────────────────────────────────────
      case "getUser":
        url = `${BASE_URL}/users/${params.userID}`;
        break;
      case "updateUser": {
        url = `${BASE_URL}/users/${params.userID}`;
        method = "PUT";
        const { userID: _, ...ud } = params;
        nsaBody = JSON.stringify(ud);
        break;
      }

      // ── Dispatch list ─────────────────────────────────────────────────────
      case "getDispatches": {
        const { dispatchNumbers, ...qParams } = params;
        const queryStr = qs(qParams);
        if (dispatchNumbers?.length) {
          url = `${BASE_URL}/dispatches${queryStr}`;
          method = "POST";
          nsaBody = JSON.stringify(dispatchNumbers);
        } else {
          url = `${BASE_URL}/dispatches${queryStr}`;
        }
        break;
      }

      // ── Single dispatch ───────────────────────────────────────────────────
      case "getDispatch":
        url = `${BASE_URL}/dispatches/${dn}`;
        break;

      case "updateDispatch": {
        url = `${BASE_URL}/dispatches/${dn}`;
        method = "PATCH";
        const { dispatchNumber: _d, ...fields } = params;
        nsaBody = JSON.stringify(fields);
        break;
      }

      case "confirmDispatch":
        // PUT /dispatches/{dispatchNumber}/{confirmID}
        url = `${BASE_URL}/dispatches/${dn}/${params.confirmID}`;
        method = "PUT";
        break;

      case "updateDispatchAddress": {
        url = `${BASE_URL}/dispatches/${dn}/address`;
        method = "PATCH";
        const { dispatchNumber: _da, ...addr } = params;
        nsaBody = JSON.stringify(addr);
        break;
      }

      case "scheduleDispatch": {
        url = `${BASE_URL}/dispatches/${dn}/schedules`;
        method = "POST";
        const { dispatchNumber: _ds, ...sched } = params;
        nsaBody = JSON.stringify(sched);
        break;
      }

      case "logTrip": {
        url = `${BASE_URL}/dispatches/${dn}/trip`;
        method = "POST";
        const { dispatchNumber: _dt, ...trip } = params;
        nsaBody = JSON.stringify(trip);
        break;
      }

      // ── Attachments ───────────────────────────────────────────────────────
      case "getAttachments":
        url = `${BASE_URL}/dispatches/${dn}/attachments`;
        break;

      case "addAttachment": {
        url = `${BASE_URL}/dispatches/${dn}/attachments`;
        method = "POST";
        const { dispatchNumber: _att, ...att } = params;
        nsaBody = JSON.stringify(att);
        break;
      }

      // ── Notes ─────────────────────────────────────────────────────────────
      case "getNotes":
        url = `${BASE_URL}/dispatches/${dn}/notes`;
        break;

      case "addNotes": {
        url = `${BASE_URL}/dispatches/${dn}/notes`;
        method = "POST";
        nsaBody = JSON.stringify(params.notes);
        break;
      }

      // ── Communications ────────────────────────────────────────────────────
      case "getCommunications":
        url = `${BASE_URL}/dispatches/${dn}/communications`;
        break;

      case "addCommunications": {
        url = `${BASE_URL}/dispatches/${dn}/communications`;
        method = "POST";
        nsaBody = JSON.stringify(params.logs);
        break;
      }

      // ── Parts ─────────────────────────────────────────────────────────────
      case "getDispatchParts":
        url = `${BASE_URL}/dispatches/${dn}/parts`;
        break;

      case "getDispatchPart":
        url = `${BASE_URL}/dispatches/${dn}/part/${params.partID}`;
        break;

      case "addDispatchPart": {
        url = `${BASE_URL}/dispatches/${dn}/part/add`;
        method = "POST";
        const { dispatchNumber: _ap, ...part } = params;
        nsaBody = JSON.stringify(part);
        break;
      }

      case "updateDispatchPart": {
        url = `${BASE_URL}/dispatches/${dn}/part/update`;
        method = "PATCH";
        const { dispatchNumber: _up, ...upd } = params;
        nsaBody = JSON.stringify(upd);
        break;
      }

      case "getDispatchBOM":
        url = `${BASE_URL}/dispatches/${dn}/parts/bom`;
        if (params.latitude) headers.latitude = String(params.latitude);
        if (params.longitude) headers.longitude = String(params.longitude);
        break;

      // ── Estimates ─────────────────────────────────────────────────────────
      case "getEstimates":
        url = `${BASE_URL}/dispatches/${dn}/estimates`;
        break;

      case "getEstimate":
        url = `${BASE_URL}/dispatches/${dn}/estimates/${params.estimateID}`;
        break;

      case "addEstimate": {
        url = `${BASE_URL}/dispatches/${dn}/estimates`;
        method = "POST";
        const { dispatchNumber: _ae, ...est } = params;
        nsaBody = JSON.stringify(est);
        break;
      }

      case "deleteEstimate":
        url = `${BASE_URL}/dispatches/${dn}/estimates/${params.estimateID}`;
        method = "DELETE";
        break;

      // ── Rule Sets ─────────────────────────────────────────────────────────
      case "getRuleSet":
        url = `${BASE_URL}/ruleset/${params.ruleSetID}`;
        break;

      case "submitRuleSet": {
        url = `${BASE_URL}/ruleset/submit`;
        method = "POST";
        nsaBody = JSON.stringify(params);
        break;
      }

      case "getMaskRules":
        url = `${BASE_URL}/dispatch/maskrules/${dn}`;
        break;

      // ── Payments ──────────────────────────────────────────────────────────
      case "getPayments": {
        const { fromDate, page, pageSize, sort } = params;
        url = `${BASE_URL}/payments${qs({ fromDate, page, pageSize, sort })}`;
        break;
      }

      case "getBatchDetails":
        url = `${BASE_URL}/payments/batches/${params.batchID}`;
        break;

      case "getCallDetails":
        url = `${BASE_URL}/payments/calls/${params.callID}`;
        break;

      case "updateLocation": {
        url = `${BASE_URL}/location`;
        method = "POST";
        nsaBody = JSON.stringify({ latitude: params.latitude, longitude: params.longitude });
        break;
      }

      // ── Part Returns ──────────────────────────────────────────────────────
      case "getPartReturns": {
        url = `${BASE_URL}/partReturns`;
        // Spec shows GET with body — send as POST with body if filters provided
        const hasFilters = Object.keys(params).some(k => params[k] !== undefined && params[k] !== "");
        if (hasFilters) {
          method = "POST";
          nsaBody = JSON.stringify(params);
        }
        if (params.latitude) headers.latitude = String(params.latitude);
        if (params.longitude) headers.longitude = String(params.longitude);
        break;
      }

      // ── Codes & Lookups ───────────────────────────────────────────────────
      case "getCommunicationCodes":
        url = `${BASE_URL}/codes/communications`;
        break;

      case "getAttachmentTypes":
        url = `${BASE_URL}/codes/attachmentTypes`;
        break;

      case "getModels":
        url = `${BASE_URL}/codes/models/${encodeURIComponent(params.masterCode)}/`;
        break;

      case "getSerials":
        url = `${BASE_URL}/codes/models/${encodeURIComponent(params.masterCode)}/${encodeURIComponent(params.model)}/`;
        break;

      default:
        return new Response(JSON.stringify({ error: `Unknown NSA action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const fetchOptions: RequestInit = { method, headers };
    if (nsaBody !== undefined) fetchOptions.body = nsaBody;

    const nsaResponse = await fetch(url, fetchOptions);
    const responseText = await nsaResponse.text();

    let responseData: any;
    try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

    return new Response(
      JSON.stringify({ success: nsaResponse.ok, data: responseData, status: nsaResponse.status }),
      {
        status: nsaResponse.ok ? 200 : nsaResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
