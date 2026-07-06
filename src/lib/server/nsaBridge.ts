/**
 * NSA Platform API bridge (runtime-agnostic server-side proxy).
 *
 * Handles CORS bypass and keeps API key/secret server-only.
 * Client calls /api/nsa with an action payload; this bridge
 * translates that into authenticated NSA REST requests.
 *
 * Authentication: Basic auth using base64(key:secret), OR Bearer token.
 * We use Basic auth directly on every request (simpler, no token refresh needed).
 *
 * Supported actions:
 *  - getDispatches          GET /dispatches
 *  - getDispatch            GET /dispatches/{dispatchNumber}
 *  - getDispatchParts       GET /dispatches/{dispatchNumber}/parts
 *  - getDispatchPartsBOM    GET /dispatches/{dispatchNumber}/parts/bom
 *  - getPartReturns         GET /partReturns
 *  - updateDispatch         PUT /dispatches/{dispatchNumber}
 *  - acceptDispatch         PUT /dispatches/{dispatchNumber}/confirm  (confirmID=1 accept, 2 reject, 6 cancel)
 *  - addDispatchNote        POST /dispatches/{dispatchNumber}/notes
 *  - getDispatchNotes       GET /dispatches/{dispatchNumber}/notes
 */

interface NsaRequestBody {
  action:
    | "getDispatches"
    | "getDispatch"
    | "getDispatchParts"
    | "getDispatchPartsBOM"
    | "getPartReturns"
    | "updateDispatch"
    | "acceptDispatch"
    | "addDispatchNote"
    | "getDispatchNotes";
  params?: Record<string, any>;
}

function buildBasicAuth(key: string, secret: string): string {
  const encoded = btoa(`${key}:${secret}`);
  return `Basic ${encoded}`;
}

function nsaHeaders(auth: string): Record<string, string> {
  return {
    Authorization: auth,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function handleNsaRequest(
  request: Request,
  env?: Record<string, string | undefined>
): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Read credentials from env (server-only — never sent to browser)
  const NSA_BASE_URL =
    (typeof (globalThis as any).__NSA_BASE_URL__ !== "undefined" ? (globalThis as any).__NSA_BASE_URL__ : null) ||
    env?.NSA_BASE_URL ?? process.env?.NSA_BASE_URL ?? "https://api.nsaweb.com";
  const NSA_API_KEY =
    (typeof (globalThis as any).__NSA_API_KEY__ !== "undefined" ? (globalThis as any).__NSA_API_KEY__ : null) ||
    env?.NSA_API_KEY ?? process.env?.NSA_API_KEY ?? "";
  const NSA_SECRET =
    (typeof (globalThis as any).__NSA_SECRET__ !== "undefined" ? (globalThis as any).__NSA_SECRET__ : null) ||
    env?.NSA_SECRET ?? process.env?.NSA_SECRET ?? "";

  if (!NSA_API_KEY || !NSA_SECRET) {
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
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = buildBasicAuth(NSA_API_KEY, NSA_SECRET);
  const { action, params = {} } = body;

  try {
    let nsaUrl: string;
    let method = "GET";
    let nsaBody: string | undefined;

    switch (action) {
      case "getDispatches": {
        // GET /dispatches?status=...&startDate=...&endDate=...&page=...&limit=...
        const qs = new URLSearchParams();
        if (params.status) qs.set("status", params.status);
        if (params.startDate) qs.set("startDate", params.startDate);
        if (params.endDate) qs.set("endDate", params.endDate);
        if (params.page) qs.set("page", String(params.page));
        if (params.limit) qs.set("limit", String(params.limit));
        nsaUrl = `${NSA_BASE_URL}/dispatches${qs.toString() ? "?" + qs.toString() : ""}`;
        break;
      }

      case "getDispatch": {
        if (!params.dispatchNumber) throw new Error("dispatchNumber required");
        nsaUrl = `${NSA_BASE_URL}/dispatches/${encodeURIComponent(params.dispatchNumber)}`;
        break;
      }

      case "getDispatchParts": {
        if (!params.dispatchNumber) throw new Error("dispatchNumber required");
        nsaUrl = `${NSA_BASE_URL}/dispatches/${encodeURIComponent(params.dispatchNumber)}/parts`;
        break;
      }

      case "getDispatchPartsBOM": {
        if (!params.dispatchNumber) throw new Error("dispatchNumber required");
        nsaUrl = `${NSA_BASE_URL}/dispatches/${encodeURIComponent(params.dispatchNumber)}/parts/bom`;
        break;
      }

      case "getPartReturns": {
        const qs = new URLSearchParams();
        if (params.status) qs.set("status", params.status);
        nsaUrl = `${NSA_BASE_URL}/partReturns${qs.toString() ? "?" + qs.toString() : ""}`;
        break;
      }

      case "updateDispatch": {
        if (!params.dispatchNumber) throw new Error("dispatchNumber required");
        method = "PUT";
        nsaUrl = `${NSA_BASE_URL}/dispatches/${encodeURIComponent(params.dispatchNumber)}`;
        const { dispatchNumber: _, ...updatePayload } = params;
        nsaBody = JSON.stringify(updatePayload);
        break;
      }

      case "acceptDispatch": {
        // confirmID: 1=accept, 2=reject, 6=cancel/transfer
        if (!params.dispatchNumber) throw new Error("dispatchNumber required");
        if (!params.confirmID) throw new Error("confirmID required (1=accept, 2=reject, 6=cancel)");
        method = "PUT";
        nsaUrl = `${NSA_BASE_URL}/dispatches/${encodeURIComponent(params.dispatchNumber)}/confirm`;
        nsaBody = JSON.stringify({ confirmID: params.confirmID, reason: params.reason });
        break;
      }

      case "addDispatchNote": {
        if (!params.dispatchNumber) throw new Error("dispatchNumber required");
        if (!params.note) throw new Error("note text required");
        method = "POST";
        nsaUrl = `${NSA_BASE_URL}/dispatches/${encodeURIComponent(params.dispatchNumber)}/notes`;
        nsaBody = JSON.stringify({ note: params.note });
        break;
      }

      case "getDispatchNotes": {
        if (!params.dispatchNumber) throw new Error("dispatchNumber required");
        nsaUrl = `${NSA_BASE_URL}/dispatches/${encodeURIComponent(params.dispatchNumber)}/notes`;
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const fetchOptions: RequestInit = {
      method,
      headers: nsaHeaders(auth),
    };
    if (nsaBody) fetchOptions.body = nsaBody;

    const nsaResponse = await fetch(nsaUrl, fetchOptions);
    const responseText = await nsaResponse.text();

    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    return new Response(JSON.stringify({ success: nsaResponse.ok, data: responseData, status: nsaResponse.status }), {
      status: nsaResponse.ok ? 200 : nsaResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
