/**
 * Site visitor log — records the IP + Cloudflare geolocation of every page
 * open on the live site, signed in or not, into site_visits (migration
 * 0340). login_events only covers sign-ins; this covers someone who opens
 * adminhubsolution.com and never logs in.
 *
 * Called from server.ts for page navigations only (never /api/* or
 * /assets/*) and run in the background via ctx.waitUntil, so it never
 * slows a page down or breaks it — every failure is swallowed.
 */

// Same IP + page within this window is logged once — a refresh or a
// client-side redirect shouldn't add a row each time. Per Worker isolate,
// so it's a best-effort de-dupe, not a guarantee.
const DEDUPE_MS = 5 * 60 * 1000;
const recent = new Map<string, number>();

function parseUserAgent(ua: string | null): { browser: string; device: string } {
  if (!ua) return { browser: "Unknown", device: "Unknown" };
  let browser = "Unknown";
  if (/bot|crawler|spider|crawling|preview|monitor/i.test(ua)) browser = "Bot";
  else if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let device = "Unknown";
  if (/iPhone/.test(ua)) device = "iPhone";
  else if (/iPad/.test(ua)) device = "iPad";
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? "Android Phone" : "Android Tablet";
  else if (/Windows/.test(ua)) device = "Windows PC";
  else if (/Macintosh/.test(ua)) device = "Mac";
  else if (/Linux/.test(ua)) device = "Linux PC";
  return { browser, device };
}

/** True for a browser opening a page (not a script, image, API call or prefetch). */
export function isPageVisit(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/")) return false;
  if (/\.[a-z0-9]{2,5}$/i.test(url.pathname)) return false; // favicon.ico, robots.txt, …
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) return false;
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  if (/prefetch/i.test(purpose)) return false;
  return true;
}

export async function logSiteVisit(request: Request, url: URL, env: Record<string, string>): Promise<void> {
  try {
    const supabaseUrl = env.VITE_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !serviceKey) return;

    const forwarded = request.headers.get("x-forwarded-for");
    const ip = request.headers.get("cf-connecting-ip") ?? (forwarded ? forwarded.split(",")[0].trim() : null);

    const now = Date.now();
    const key = `${ip ?? "?"}|${url.pathname}`;
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(key, now);
    if (recent.size > 5000) {
      for (const [k, t] of recent) if (now - t >= DEDUPE_MS) recent.delete(k);
    }

    const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
    const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
    const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? parseFloat(v) : null);
    const ua = request.headers.get("user-agent");
    const { browser, device } = parseUserAgent(ua);

    await fetch(`${supabaseUrl}/rest/v1/site_visits`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        ip,
        country: str(cf?.country),
        region: str(cf?.region),
        city: str(cf?.city),
        latitude: num(cf?.latitude),
        longitude: num(cf?.longitude),
        asn: num(cf?.asn),
        as_org: str(cf?.asOrganization),
        host: url.hostname,
        path: `${url.pathname}${url.search}`.slice(0, 500),
        referer: request.headers.get("referer")?.slice(0, 500) ?? null,
        user_agent: ua?.slice(0, 500) ?? null,
        browser,
        device,
      }),
    });
  } catch (error) {
    console.warn("[site-visit] log failed:", error);
  }
}
