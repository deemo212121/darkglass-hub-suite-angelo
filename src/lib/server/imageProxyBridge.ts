/**
 * Server-side image proxy — fetches a Firebase Storage image URL from the
 * server (a server-to-server request is never subject to browser CORS) and
 * streams the bytes back same-origin, so document-generation code
 * (src/lib/documentTemplates/generate.ts) can embed a Logo/signature image
 * into a captured PDF even though the storage bucket itself sends no
 * Access-Control-Allow-Origin header. Runtime-agnostic — same shape as the
 * other *Bridge.ts files — so it behaves identically in dev
 * (vite.config.ts's imageProxyDevPlugin), Cloudflare (src/server.ts), and
 * any other serverless target (api/image-proxy.ts).
 */

// Only ever proxy Firebase Storage's own download host — never an
// arbitrary caller-supplied URL, or this endpoint becomes an open
// proxy/SSRF vector for fetching anything on the server's behalf.
const ALLOWED_HOSTS = ["firebasestorage.googleapis.com"];

export async function handleImageProxyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) {
    return jsonError("Missing url parameter", 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonError("Invalid url parameter", 400);
  }

  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    return jsonError("URL host not allowed", 403);
  }

  try {
    const upstream = await fetch(targetUrl.toString());
    if (!upstream.ok) {
      return jsonError(`Upstream fetch failed (${upstream.status})`, 502);
    }
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/octet-stream",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Image proxy failed", 502);
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
}
