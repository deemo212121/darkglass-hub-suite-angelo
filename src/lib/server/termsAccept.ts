/**
 * /api/terms-accept — records a Terms & Conditions acceptance (migration
 * 0455) with where it came from (0456): the IP Cloudflare saw, its city /
 * region / country, the browser, and the person's most-used sign-in IP over
 * the last 90 days (login_events, 0089), so Who accepted can flag an
 * acceptance from somewhere unusual (Sir Naveen, 11/06).
 *
 * Done here rather than by terms_accept() from the browser so the IP comes
 * from the same Cloudflare header sign-ins use — comparable, and not
 * something the page can make up. Same rules as terms_accept(): the version
 * must belong to the caller's company, and accepting twice is a no-op.
 * Before 0456 is run, the acceptance is still saved, without the new fields.
 */
import { clientIpFrom, geoFromRequest, parseUserAgent, verifyFirebaseToken } from "./supabaseTokenBridge";

const USUAL_IP_DAYS = 90;

/** The most common IP; a tie goes to the more recent one (rows come newest first). */
export function mostUsedIp(ips: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const ip of ips) if (ip) counts.set(ip, (counts.get(ip) ?? 0) + 1);
  let best: string | null = null;
  for (const [ip, n] of counts) if (best === null || n > counts.get(best)!) best = ip;
  return best;
}

export async function handleTermsAcceptRequest(request: Request, env: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const g = globalThis as any;
  const url = (g.__SUPABASE_URL__ || undefined) ?? env.VITE_SUPABASE_URL;
  const key = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? env.SUPABASE_SERVICE_KEY;
  const projectId = (g.__FIREBASE_PROJECT_ID__ || undefined) ?? env.VITE_FIREBASE_PROJECT_ID;
  if (!url || !key || !projectId) return json({ error: "Server sign-in check isn't configured." }, 500);
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const get = async <T,>(path: string): Promise<T[]> => {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as T[];
  };

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    const versionId = typeof payload.versionId === "string" ? payload.versionId : "";
    if (!idToken) return json({ error: "Sign in to use this." }, 401);
    if (!/^[0-9a-f-]{36}$/i.test(versionId)) return json({ error: "Terms not found." }, 400);
    let uid: string;
    try {
      uid = (await verifyFirebaseToken(idToken, projectId)).sub;
    } catch {
      return json({ error: "Your session expired — sign in again." }, 401);
    }
    const me = (
      await get<{ id: string; company_id: string; display_name: string | null; email: string | null; is_active: boolean }>(
        `profiles?select=id,company_id,display_name,email,is_active&firebase_uid=eq.${encodeURIComponent(uid)}&limit=1`,
      )
    )[0];
    if (!me?.is_active) return json({ error: "Your account isn't active." }, 403);
    const version = (await get<{ id: string; document_id: string }>(`terms_versions?select=id,document_id&id=eq.${versionId}&company_id=eq.${me.company_id}&limit=1`))[0];
    if (!version) return json({ error: "Terms not found." }, 404);

    const ip = clientIpFrom(request);
    const geo = geoFromRequest(request);
    const userAgent = request.headers.get("user-agent");
    const ua = parseUserAgent(userAgent);
    const since = new Date(Date.now() - USUAL_IP_DAYS * 86400000).toISOString();
    const usualIp = mostUsedIp(
      (await get<{ ip: string | null }>(`login_events?select=ip&profile_id=eq.${me.id}&created_at=gte.${since}&order=created_at.desc&limit=1000`).catch(() => [])).map((e) => e.ip),
    );

    const base = {
      company_id: me.company_id,
      document_id: version.document_id,
      version_id: version.id,
      profile_id: me.id,
      display_name: (me.display_name || "").trim() || me.email,
      device: payload.device === "mobile" ? "mobile" : "web",
    };
    const where = {
      email: me.email,
      ip,
      ip_city: geo.city,
      ip_region: geo.region,
      ip_country: geo.country,
      browser: `${ua.browser} · ${ua.device}`,
      user_agent: userAgent,
      usual_ip: usualIp,
      ip_matches: ip && usualIp ? ip === usualIp : null,
    };
    const insert = (row: Record<string, unknown>) =>
      fetch(`${url}/rest/v1/terms_acceptances?on_conflict=version_id,profile_id`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal,resolution=ignore-duplicates" },
        body: JSON.stringify(row),
      });
    let res = await insert({ ...base, ...where });
    // 0456 not run yet: still record the acceptance.
    if (!res.ok && res.status === 400 && /column/i.test(await res.clone().text())) res = await insert(base);
    if (!res.ok) throw new Error(`Saving the acceptance failed (${res.status}): ${await res.text()}`);
    return json({ ok: true, ip, usualIp, ipMatches: where.ip_matches });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
