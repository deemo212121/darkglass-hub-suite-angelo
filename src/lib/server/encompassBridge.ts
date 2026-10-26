/**
 * Encompass Supply Chain Solutions API server bridge.
 *
 * Encompass exposes a REST API at https://test.encompass.com (test — no
 * real orders placed, per their docs) and https://encompass.com
 * (production — live data, orders placed). Auth is much simpler than
 * Marcone's OAuth client_credentials flow: every single request body just
 * needs `jsonUser` + `jsonPassword` merged in — no token exchange, no
 * caching, no expiry to track.
 *
 * This bridge keeps those credentials on the server only (never shipped to
 * the browser) and proxies the documented /restfulservice/* calls
 * (PROGRAM_NAME_BY_PATH), for signed-in active users only, so the client
 * side can issue them without ever seeing the password. Server jobs call
 * encompassServerRequest directly.
 *
 * Secrets resolve from (in order):
 *   1. Vite build-time constants (globalThis.__ENCOMPASS_* — baked into the
 *      server bundle only, NEVER the client bundle).
 *   2. Runtime env (Cloudflare Workers binding or process.env).
 */

import { requireActiveCaller } from "./requireActiveCaller";

const ENCOMPASS_PROD_BASE = "https://encompass.com";
const ENCOMPASS_TEST_BASE = "https://test.encompass.com";

// `programName` is NOT one account-wide value — Encompass assigns a
// distinct one per service (confirmed against their SwaggerHub docs and
// live-tested against test.encompass.com), rejecting every other endpoint's
// value with "-104 program not authorized" even though the account/
// credentials are otherwise fully valid. Keyed by the same `path` callers
// already pass through this bridge.
const PROGRAM_NAME_BY_PATH: Record<string, string> = {
  "/restfulservice/brandList": "JSON.MFG.LIST",
  "/restfulservice/modelPartList": "JSON.MODEL.INFORMATION",
  "/restfulservice/partsInformation": "JSON.ITEM.INFORMATION",
  "/restfulservice/frequentlyPurchasedParts": "JSON.FBT",
  "/restfulservice/shipto": "JSONShipTo",
  "/restfulservice/createOrder": "JSON.ORDER.CREATE",
  "/restfulservice/orderStatus": "JSON.ORDER.STATUS",
  "/restfulservice/cancelOrder": "JSON.ORDER.CANCEL",
  "/restfulservice/AvailableReturns": "JSONAvailableReturns",
  "/restfulservice/returnRequest": "JSON.RETURN.REQUEST",
};

interface EncompassRequestBody {
  /** Path relative to the base URL, e.g. "/restfulservice/search". Every documented Encompass endpoint is POST. */
  path?: string;
  /** The endpoint-specific `data` object — settings (jsonUser/jsonPassword) gets assembled server-side and wrapped around this. */
  data?: Record<string, unknown>;
  /** Optional customerNumber/customerPassword for account-specific operations — jsonUser/jsonPassword here are ignored; only the server-side ones are ever used. */
  settings?: Record<string, unknown>;
}

function getBaseUrl(envName: string): string {
  return envName === "production" ? ENCOMPASS_PROD_BASE : ENCOMPASS_TEST_BASE;
}

// On some error paths Encompass's backend appends raw PHP-style debug/log
// text AFTER the JSON body on the same response (observed: a legitimate
// `{"status":{...},"data":{}}` object followed by "** Error [ NOT_FILE_VAR
// ] ** ..."), which fails a plain JSON.parse even though the actual answer
// (status.errorCode / errorMessage) is sitting right there. Scans for the
// first balanced top-level `{...}` (brace-depth counting, string/escape
// aware) and parses just that; falls back to the raw text if nothing
// balanced is found at all.
function parseEncompassResponse(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return text;
        }
      }
    }
  }
  return text;
}

export interface EncompassServerResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/**
 * One Encompass call with the company's credentials — server-side only.
 * Shared by the /api/encompass browser bridge below and server jobs (e.g.
 * partCreditSync.ts). Only the documented services in PROGRAM_NAME_BY_PATH.
 */
export async function encompassServerRequest(
  env: Record<string, string | undefined> | undefined,
  req: { path: string; data?: Record<string, unknown>; settings?: Record<string, unknown> },
): Promise<EncompassServerResult> {
  const getEnv = (k: string): string | undefined =>
    env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const pick = (injected: unknown, envKey: string): string | undefined => {
    if (typeof injected === "string" && injected !== "") return injected;
    return getEnv(envKey);
  };
  const envName = pick((globalThis as any).__ENCOMPASS_ENV__, "VITE_ENCOMPASS_ENV") || "test";
  const jsonUser = pick((globalThis as any).__ENCOMPASS_JSON_USER__, "VITE_ENCOMPASS_JSON_USER");
  const jsonPassword = pick((globalThis as any).__ENCOMPASS_JSON_PASSWORD__, "VITE_ENCOMPASS_JSON_PASSWORD");
  const customerNumber = pick((globalThis as any).__ENCOMPASS_CUSTOMER_NUMBER__, "VITE_ENCOMPASS_CUSTOMER_NUMBER");
  const customerPassword = pick((globalThis as any).__ENCOMPASS_CUSTOMER_PASSWORD__, "VITE_ENCOMPASS_CUSTOMER_PASSWORD");
  if (!jsonUser || !jsonPassword) return { success: false, error: "Encompass credentials not configured on server" };
  if (!PROGRAM_NAME_BY_PATH[req.path]) return { success: false, status: 403, error: `Not allowed: ${req.path}` };

  // Every Encompass endpoint wants { settings: {...}, data: {...} } —
  // settings always carries jsonUser/jsonPassword (assembled here, only
  // server-side, never accepted from the caller), the endpoint-specific
  // programName (see PROGRAM_NAME_BY_PATH — caller can still override),
  // and customerNumber/customerPassword (account 272467, needed by every
  // customer-scoped endpoint like orderStatus/createOrder — harmless to
  // send even to endpoints that ignore it, like brandList).
  const upstreamBody = {
    settings: {
      programName: PROGRAM_NAME_BY_PATH[req.path],
      customerNumber,
      customerPassword,
      ...(req.settings || {}),
      jsonUser,
      jsonPassword,
    },
    data: req.data || {},
  };

  const upstream = await fetch(getBaseUrl(envName) + req.path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(upstreamBody),
  });
  const text = await upstream.text();
  return { success: upstream.ok, status: upstream.status, data: parseEncompassResponse(text) };
}

/** POST /api/encompass — signed-in, active users only (requireActiveCaller). */
export async function handleEncompassRequest(
  request: Request,
  env?: Record<string, string | undefined>,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const reqBody = (await request.json()) as EncompassRequestBody & { idToken?: string };
    const caller = await requireActiveCaller(reqBody.idToken, env);
    if (!caller.ok) return json({ success: false, error: caller.error }, caller.status);

    const path = String(reqBody.path || "");
    if (!path || !path.startsWith("/")) {
      return json({ success: false, error: "request.path must start with '/'" }, 400);
    }
    const result = await encompassServerRequest(env, { path, data: reqBody.data, settings: reqBody.settings });
    if (result.status === 403 && result.error) return json(result, 403);
    if (result.error && result.status === undefined) return json(result, 500);

    // Always reply 200 to the browser — the inner `success` field (and, for
    // Encompass specifically, data.status.errorCode) tells the client
    // whether the upstream call actually worked. Same reasoning as the
    // Marcone bridge: keeps harmless business-logic failures (e.g. "part
    // not found") from showing up as a red 5xx in DevTools.
    return json(result, 200);
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Encompass request failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
