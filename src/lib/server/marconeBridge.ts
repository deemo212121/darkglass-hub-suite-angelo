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
 * burn an auth round-trip. It also proxies arbitrary read-only mSupply calls
 * so the client side can issue them without exposing the secret.
 *
 * Secrets resolve from (in order):
 *   1. Vite build-time constants (globalThis.__MARCONE_* — baked into the
 *      server bundle only, NEVER the client bundle).
 *   2. Runtime env (Cloudflare Workers binding or process.env).
 */

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

/**
 * Handle a POST /api/marcone request. Returns a standard Response.
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

  const getEnv = (k: string): string | undefined =>
    env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const pick = (injected: unknown, envKey: string): string | undefined => {
    if (typeof injected === "string" && injected !== "") return injected;
    return getEnv(envKey);
  };

  try {
    const body = (await request.json()) as MarconeRequestBody;
    const envName =
      pick((globalThis as any).__MARCONE_ENV__, "VITE_MARCONE_ENV") || "integration";

    const clientId =
      envName === "production"
        ? pick((globalThis as any).__MARCONE_PROD_CLIENT_ID__, "VITE_MARCONE_PROD_CLIENT_ID")
        : pick((globalThis as any).__MARCONE_INT_CLIENT_ID__, "VITE_MARCONE_INT_CLIENT_ID");
    const clientSecret =
      envName === "production"
        ? pick((globalThis as any).__MARCONE_PROD_CLIENT_SECRET__, "VITE_MARCONE_PROD_CLIENT_SECRET")
        : pick((globalThis as any).__MARCONE_INT_CLIENT_SECRET__, "VITE_MARCONE_INT_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      // Help us debug which path failed (build-time define vs runtime env).
      // Values are only flagged present/missing — never logged in the clear.
      const probe = {
        injectedEnv: (globalThis as any).__MARCONE_ENV__ ?? null,
        injectedIntIdLen:
          typeof (globalThis as any).__MARCONE_INT_CLIENT_ID__ === "string"
            ? (globalThis as any).__MARCONE_INT_CLIENT_ID__.length
            : null,
        injectedIntSecretLen:
          typeof (globalThis as any).__MARCONE_INT_CLIENT_SECRET__ === "string"
            ? (globalThis as any).__MARCONE_INT_CLIENT_SECRET__.length
            : null,
        injectedProdIdLen:
          typeof (globalThis as any).__MARCONE_PROD_CLIENT_ID__ === "string"
            ? (globalThis as any).__MARCONE_PROD_CLIENT_ID__.length
            : null,
        injectedProdSecretLen:
          typeof (globalThis as any).__MARCONE_PROD_CLIENT_SECRET__ === "string"
            ? (globalThis as any).__MARCONE_PROD_CLIENT_SECRET__.length
            : null,
        envHasIntId: Boolean(getEnv("VITE_MARCONE_INT_CLIENT_ID")),
        envHasIntSecret: Boolean(getEnv("VITE_MARCONE_INT_CLIENT_SECRET")),
        envHasProdId: Boolean(getEnv("VITE_MARCONE_PROD_CLIENT_ID")),
        envHasProdSecret: Boolean(getEnv("VITE_MARCONE_PROD_CLIENT_SECRET")),
        chosenEnv: envName,
        envKeysAvailable: env ? Object.keys(env).filter((k) => k.startsWith("VITE_MARCONE")) : [],
      };
      return json(
        {
          success: false,
          error: `Marcone ${envName} credentials not configured on server`,
          debug: probe,
        },
        500,
      );
    }

    if (body.action === "getToken") {
      // Surfaced as a separate action mostly for debugging / health checks.
      // Returns whether auth works without exposing the bearer to the client.
      try {
        const token = await getCachedToken(envName, clientId, clientSecret);
        return json({
          success: true,
          env: envName,
          baseUrl: getBaseUrl(envName),
          // Just a fingerprint, not the actual token.
          tokenFingerprint: `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars)`,
          expiresAt: tokenCache?.expiresAt ?? null,
        });
      } catch (err) {
        return json(
          { success: false, error: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    }

    if (body.action === "request") {
      const path = String(body.path || "");
      if (!path || !path.startsWith("/")) {
        return json({ success: false, error: "request.path must start with '/'" }, 400);
      }
      const method = (body.method || "GET").toUpperCase();
      let token: string;
      try {
        token = await getCachedToken(envName, clientId, clientSecret);
      } catch (err) {
        return json(
          { success: false, error: err instanceof Error ? err.message : String(err) },
          500,
        );
      }

      const url = new URL(getBaseUrl(envName) + path);
      if (body.query) {
        for (const [k, v] of Object.entries(body.query)) {
          if (v === undefined || v === null || v === "") continue;
          url.searchParams.set(k, String(v));
        }
      }

      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body.body !== undefined ? JSON.stringify(body.body) : undefined,
      };

      const upstream = await fetch(url.toString(), init);
      const text = await upstream.text();
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        /* not JSON — return as text */
      }

      // Token expired mid-flight? Try ONCE more after a refresh.
      if (upstream.status === 401 && tokenCache) {
        tokenCache = null;
        try {
          const fresh = await getCachedToken(envName, clientId, clientSecret);
          const retry = await fetch(url.toString(), {
            ...init,
            headers: { ...init.headers, Authorization: `Bearer ${fresh}` },
          });
          const retryText = await retry.text();
          let retryPayload: unknown = retryText;
          try {
            retryPayload = JSON.parse(retryText);
          } catch {
            /* not JSON */
          }
          return json({ success: retry.ok, status: retry.status, data: retryPayload }, 200);
        } catch (err) {
          return json(
            { success: false, error: err instanceof Error ? err.message : String(err) },
            500,
          );
        }
      }

      // Always reply 200 to the browser — the inner `success` field tells the
      // client whether the upstream call worked. This stops harmless 4xx
      // results (e.g. "part not found") from being logged as 502 in DevTools.
      return json({ success: upstream.ok, status: upstream.status, data: payload }, 200);
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
