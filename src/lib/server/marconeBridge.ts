/**
 * Marcone mSupply API server bridge.
 *
 * Marcone exposes a REST API at https://api.msupply.com (production) and
 * https://int-api.msupply.com (integration). Auth is client_credentials: you
 * POST `clientId` + `clientSecret` to `/AccessToken`, you get back a bearer
 * token, and you use that token for every subsequent call until it expires.
 *
 * This bridge keeps the secret on the server only (never shipped to the
 * browser) and caches the token across requests so each user action doesn't
 * burn an auth round-trip. It also proxies the mSupply calls the app makes
 * (BROWSER_ALLOWED below), for signed-in active users only, so the client
 * side can issue them without exposing the secret. Server jobs call
 * marconeServerRequest directly.
 *
 * Secrets resolve from (in order):
 *   1. Vite build-time constants (globalThis.__MARCONE_* — baked into the
 *      server bundle only, NEVER the client bundle).
 *   2. Runtime env (Cloudflare Workers binding or process.env).
 */

import { requireActiveCaller } from "./requireActiveCaller";

const MARCONE_PROD_BASE = "https://api.msupply.com";
const MARCONE_INT_BASE = "https://int-api.msupply.com";

interface MarconeRequestBody {
  action: "getToken" | "request";
  /** For action="request": HTTP method (defaults to GET). */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** For action="request": path relative to the base URL (e.g. "/Catalog/12345"). */
  path?: string;
  /** For action="request": query parameters (will be URL-encoded). */
  query?: Record<string, string | number | boolean | undefined>;
  /** For action="request": JSON body (POST/PUT/PATCH). */
  body?: unknown;
}

// In-memory token cache. The bridge is shared across requests within a Worker
// instance, so this cache survives between API calls in the same instance.
let tokenCache: { token: string; expiresAt: number; env: string } | null = null;

function getBaseUrl(envName: string): string {
  return envName === "production" ? MARCONE_PROD_BASE : MARCONE_INT_BASE;
}

async function fetchToken(
  envName: string,
  clientId: string,
  clientSecret: string,
): Promise<{ token: string; expiresAt: number }> {
  const base = getBaseUrl(envName);
  const url = `${base}/AccessToken`;

  // mSupply uses standard OAuth 2.0 client_credentials with the credentials
  // sent as a Basic Auth header (NOT in the body). The body contains only
  // grant_type=client_credentials. This matches the Postman "Send as Basic
  // Auth header" / "Client Credentials" preset in their integration PDF.
  const basic = (() => {
    const raw = `${clientId}:${clientSecret}`;
    if (typeof btoa === "function") return btoa(raw);
    // Node fallback (server bundle, edge worker has btoa).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return Buffer.from(raw, "utf8").toString("base64");
  })();

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  const text = await res.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Marcone /AccessToken returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const detail = payload?.error_description || payload?.message || payload?.error || text.slice(0, 200);
    throw new Error(`Marcone /AccessToken ${res.status}: ${detail}`);
  }

  const token: string =
    payload.access_token || payload.accessToken || payload.token || payload.Token || "";
  if (!token) {
    throw new Error(`Marcone /AccessToken returned no token: ${text.slice(0, 200)}`);
  }
  // mSupply returns `expires_in` in seconds (1199 ≈ 20 minutes in the PDF).
  const expiresIn: number = Number(
    payload.expires_in ?? payload.expiresIn ?? payload.ExpiresIn ?? 3600,
  );
  // 30s safety buffer so we never use a token that's about to expire.
  const expiresAt = Date.now() + Math.max(60, expiresIn - 30) * 1000;
  return { token, expiresAt };
}

async function getCachedToken(
  envName: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (tokenCache && tokenCache.env === envName && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  const { token, expiresAt } = await fetchToken(envName, clientId, clientSecret);
  tokenCache = { token, expiresAt, env: envName };
  return token;
}

/** Marcone env + credentials (build-time constants first, then runtime env). */
function resolveMarconeConfig(env?: Record<string, string | undefined>):
  | { ok: true; envName: string; clientId: string; clientSecret: string }
  | { ok: false; envName: string; probe: Record<string, unknown> } {
  const getEnv = (k: string): string | undefined =>
    env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const pick = (injected: unknown, envKey: string): string | undefined => {
    if (typeof injected === "string" && injected !== "") return injected;
    return getEnv(envKey);
  };
  const envName = pick((globalThis as any).__MARCONE_ENV__, "VITE_MARCONE_ENV") || "integration";
  const clientId =
    envName === "production"
      ? pick((globalThis as any).__MARCONE_PROD_CLIENT_ID__, "VITE_MARCONE_PROD_CLIENT_ID")
      : pick((globalThis as any).__MARCONE_INT_CLIENT_ID__, "VITE_MARCONE_INT_CLIENT_ID");
  const clientSecret =
    envName === "production"
      ? pick((globalThis as any).__MARCONE_PROD_CLIENT_SECRET__, "VITE_MARCONE_PROD_CLIENT_SECRET")
      : pick((globalThis as any).__MARCONE_INT_CLIENT_SECRET__, "VITE_MARCONE_INT_CLIENT_SECRET");
  if (clientId && clientSecret) return { ok: true, envName, clientId, clientSecret };
  // Which path failed (build-time define vs runtime env) — values are only
  // flagged present/missing, never logged in the clear.
  const len = (v: unknown) => (typeof v === "string" ? v.length : null);
  return {
    ok: false,
    envName,
    probe: {
      injectedEnv: (globalThis as any).__MARCONE_ENV__ ?? null,
      injectedIntIdLen: len((globalThis as any).__MARCONE_INT_CLIENT_ID__),
      injectedIntSecretLen: len((globalThis as any).__MARCONE_INT_CLIENT_SECRET__),
      injectedProdIdLen: len((globalThis as any).__MARCONE_PROD_CLIENT_ID__),
      injectedProdSecretLen: len((globalThis as any).__MARCONE_PROD_CLIENT_SECRET__),
      envHasIntId: Boolean(getEnv("VITE_MARCONE_INT_CLIENT_ID")),
      envHasIntSecret: Boolean(getEnv("VITE_MARCONE_INT_CLIENT_SECRET")),
      envHasProdId: Boolean(getEnv("VITE_MARCONE_PROD_CLIENT_ID")),
      envHasProdSecret: Boolean(getEnv("VITE_MARCONE_PROD_CLIENT_SECRET")),
      chosenEnv: envName,
      envKeysAvailable: env ? Object.keys(env).filter((k) => k.startsWith("VITE_MARCONE")) : [],
    },
  };
}

export interface MarconeServerResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/**
 * One mSupply call with the company's credentials — server-side only. Shared
 * by the /api/marcone browser bridge below and server jobs (e.g.
 * partCreditSync.ts), so neither has to go through the other.
 */
export async function marconeServerRequest(
  env: Record<string, string | undefined> | undefined,
  req: { method?: string; path: string; query?: MarconeRequestBody["query"]; body?: unknown },
): Promise<MarconeServerResult> {
  const config = resolveMarconeConfig(env);
  if (!config.ok) return { success: false, error: `Marcone ${config.envName} credentials not configured on server` };
  const { envName, clientId, clientSecret } = config;
  const method = (req.method || "GET").toUpperCase();
  let token: string;
  try {
    token = await getCachedToken(envName, clientId, clientSecret);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  const url = new URL(getBaseUrl(envName) + req.path);
  if (req.query) {
    for (const [k, v] of Object.entries(req.query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  };

  const upstream = await fetch(url.toString(), init);

  // Some endpoints (e.g. /returns/reaQrCode) return raw binary
  // (application/octet-stream) instead of JSON — .text() would corrupt
  // that. Detect it up front and base64-encode instead of parsing.
  const upstreamContentType = upstream.headers.get("content-type") || "";
  const isBinary = !upstreamContentType.includes("json") && !upstreamContentType.includes("text");
  if (isBinary) {
    const buf = await upstream.arrayBuffer();
    const base64 =
      typeof Buffer !== "undefined"
        ? Buffer.from(buf).toString("base64")
        : btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { success: upstream.ok, status: upstream.status, data: { base64, contentType: upstreamContentType || "application/octet-stream" } };
  }

  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return text; // not JSON — return as text
    }
  };
  const payload = parse(await upstream.text());

  // Token expired mid-flight? Try ONCE more after a refresh.
  if (upstream.status === 401 && tokenCache) {
    tokenCache = null;
    try {
      const fresh = await getCachedToken(envName, clientId, clientSecret);
      const retry = await fetch(url.toString(), { ...init, headers: { ...init.headers, Authorization: `Bearer ${fresh}` } });
      return { success: retry.ok, status: retry.status, data: parse(await retry.text()) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { success: upstream.ok, status: upstream.status, data: payload };
}

/**
 * The mSupply calls the app itself makes from the browser (marconeApi.ts,
 * partOrders.ts) — nothing else passes, so a signed-in user still can't use
 * this bridge as a general Marcone console.
 */
const BROWSER_ALLOWED: Record<string, string[]> = {
  "/parts/lookup": ["POST"],
  "/orders/orderstatus": ["POST"],
  "/orders/purchaseorder": ["POST"],
  "/orders/trackpackage": ["POST"],
  "/returns/findreturnableitems": ["POST"],
  "/returns/requestreturnauthorization": ["POST"],
  "/returns/reaQrCode": ["GET"],
};

/**
 * Handle a POST /api/marcone request. Returns a standard Response. Signed-in,
 * active users only (requireActiveCaller), and only BROWSER_ALLOWED calls.
 */
export async function handleMarconeRequest(
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
    const body = (await request.json()) as MarconeRequestBody & { idToken?: string };
    const caller = await requireActiveCaller(body.idToken, env);
    if (!caller.ok) return json({ success: false, error: caller.error }, caller.status);

    const config = resolveMarconeConfig(env);
    if (!config.ok) {
      return json({ success: false, error: `Marcone ${config.envName} credentials not configured on server`, debug: config.probe }, 500);
    }

    if (body.action === "getToken") {
      // Surfaced as a separate action mostly for debugging / health checks.
      // Returns whether auth works without exposing the bearer to the client.
      try {
        const token = await getCachedToken(config.envName, config.clientId, config.clientSecret);
        return json({
          success: true,
          env: config.envName,
          baseUrl: getBaseUrl(config.envName),
          // Just a fingerprint, not the actual token.
          tokenFingerprint: `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars)`,
          expiresAt: tokenCache?.expiresAt ?? null,
        });
      } catch (err) {
        return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (body.action === "request") {
      const path = String(body.path || "");
      if (!path || !path.startsWith("/")) {
        return json({ success: false, error: "request.path must start with '/'" }, 400);
      }
      const method = (body.method || "GET").toUpperCase();
      if (!BROWSER_ALLOWED[path]?.includes(method)) {
        return json({ success: false, error: `Not allowed: ${method} ${path}` }, 403);
      }
      const result = await marconeServerRequest(env, { method, path, query: body.query, body: body.body });
      // Always reply 200 to the browser — the inner `success` field tells the
      // client whether the upstream call worked. This stops harmless 4xx
      // results (e.g. "part not found") from being logged as 502 in DevTools.
      return json(result, result.error && result.status === undefined ? 500 : 200);
    }

    return json({ success: false, error: `Unknown action: ${(body as any).action}` }, 400);
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Marcone request failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
