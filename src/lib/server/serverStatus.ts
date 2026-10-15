/**
 * AHS Server Status (SuperAdmin module) — checks every service the app
 * depends on, runtime-agnostic (plain fetch, Web APIs only):
 *
 *  - Databases: Supabase Database + Auth, Firebase Auth + Firestore + Storage.
 *  - Hosting: the Cloudflare Worker serving the app (this code running IS
 *    the check) and when each cron schedule last ran.
 *  - Provider status pages: Supabase, Cloudflare, Firebase — their own
 *    reported incidents, so an outage on their side is visible as such.
 *  - Outside services: ServicePower, Marcone, Encompass, Google Maps,
 *    Geoapify — reachability only. Nothing is logged into, ordered or
 *    billed: each probe is a plain request any public client could make.
 *
 * The 5-minute cron (src/server.ts) runs runServerStatusChecks and saves
 * one row per service (server_status_checks, migration 0377) for uptime %
 * and the 30-day history. The page calls POST /api/server-status.
 */
import { verifyFirebaseToken } from "./supabaseTokenBridge";

export type ServiceGroup = "database" | "hosting" | "provider" | "integration";
export type ServiceState = "up" | "slow" | "down";

export interface ServiceCheck {
  key: string;
  label: string;
  group: ServiceGroup;
  status: ServiceState;
  /** Response time in ms (null for provider status pages / not measured). */
  ms: number | null;
  /** Short human detail — e.g. "HTTP 200", the provider's incident title. */
  detail: string;
  checkedAt: string;
}

interface StatusEnv {
  supabaseUrl: string;
  supabaseServiceKey: string;
  supabaseAnonKey?: string;
  firebaseProjectId?: string;
  firebaseApiKey?: string;
  firebaseStorageBucket?: string;
}

/** Slower than this (ms) reads as "Slow" instead of "Operational". */
export const SLOW_MS = 2000;
const TIMEOUT_MS = 8000;
const HISTORY_DAYS = 30;

function getEnvValue(env: Record<string, string | undefined> | undefined, k: string): string | undefined {
  return env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
}

function viteEnv(k: string): string | undefined {
  try {
    return (import.meta as any).env?.[k] || undefined;
  } catch {
    return undefined;
  }
}

export function readStatusEnv(rawEnv?: Record<string, string | undefined>): StatusEnv | null {
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? getEnvValue(rawEnv, "VITE_SUPABASE_URL") ?? viteEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? getEnvValue(rawEnv, "SUPABASE_SERVICE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return {
    supabaseUrl,
    supabaseServiceKey,
    supabaseAnonKey: getEnvValue(rawEnv, "VITE_SUPABASE_ANON_KEY") ?? viteEnv("VITE_SUPABASE_ANON_KEY"),
    firebaseProjectId: (g.__FIREBASE_PROJECT_ID__ || undefined) ?? getEnvValue(rawEnv, "VITE_FIREBASE_PROJECT_ID") ?? viteEnv("VITE_FIREBASE_PROJECT_ID"),
    firebaseApiKey: getEnvValue(rawEnv, "VITE_FIREBASE_API_KEY") ?? viteEnv("VITE_FIREBASE_API_KEY"),
    firebaseStorageBucket: getEnvValue(rawEnv, "VITE_FIREBASE_STORAGE_BUCKET") ?? viteEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  };
}

async function sb(env: StatusEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.supabaseServiceKey,
      Authorization: `Bearer ${env.supabaseServiceKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * Times one request. `isUp(res)` decides whether the answer means the
 * service is working — e.g. a 401/403 from Firebase Storage still proves it
 * is up and answering; only a 5xx, a timeout or no connection is "down".
 */
async function probe(
  key: string,
  label: string,
  group: ServiceGroup,
  url: string,
  init: RequestInit = {},
  isUp: (res: Response) => boolean = (res) => res.status < 500
): Promise<ServiceCheck> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
    const ms = Date.now() - started;
    // Drain the body so the connection is released (Workers count open sockets).
    await res.arrayBuffer().catch(() => undefined);
    if (!isUp(res)) return { key, label, group, status: "down", ms, detail: `HTTP ${res.status}`, checkedAt };
    return { key, label, group, status: ms > SLOW_MS ? "slow" : "up", ms, detail: `HTTP ${res.status}`, checkedAt };
  } catch (err) {
    const ms = Date.now() - started;
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { key, label, group, status: "down", ms, detail: timedOut ? `No answer in ${TIMEOUT_MS / 1000}s` : "Couldn't connect", checkedAt };
  }
}

function notConfigured(key: string, label: string, group: ServiceGroup, what: string): ServiceCheck {
  return { key, label, group, status: "down", ms: null, detail: `Not configured on the server (${what})`, checkedAt: new Date().toISOString() };
}

/**
 * Atlassian Statuspage summary (Supabase, Cloudflare) → our state.
 *
 * `components` (optional) limits it to the parts this app actually uses.
 * Needed for Cloudflare: its overall indicator is almost never "none" —
 * with 300+ data centers, a few are always rerouted for maintenance, which
 * marks whole regions "major outage" and the page "Partial System Outage"
 * even when Workers/DNS/SSL are fine. With `components`, only those
 * components' statuses and the incidents touching them count.
 */
async function statuspage(key: string, label: string, url: string, components?: RegExp): Promise<ServiceCheck> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { key, label, group: "provider", status: "slow", ms: null, detail: `Status page unavailable (HTTP ${res.status})`, checkedAt };
    const body = (await res.json()) as {
      status?: { indicator?: string; description?: string };
      incidents?: { name?: string; status?: string; impact?: string; components?: { name?: string }[] }[];
      components?: { name?: string; status?: string; group?: boolean }[];
    };
    let open = (body.incidents ?? []).filter((i) => i.status !== "resolved" && i.status !== "postmortem");
    let status: ServiceState;
    if (components) {
      const used = (body.components ?? []).filter((c) => !c.group && components.test(c.name ?? ""));
      const worst = used.map((c) => c.status ?? "operational");
      status = worst.some((s) => s === "major_outage" || s === "partial_outage")
        ? "down"
        : worst.some((s) => s === "degraded_performance" || s === "under_maintenance")
          ? "slow"
          : "up";
      open = open.filter((i) => (i.components ?? []).some((c) => components.test(c.name ?? "")));
      const affected = used.filter((c) => c.status && c.status !== "operational").map((c) => `${c.name}: ${c.status!.replace(/_/g, " ")}`);
      const detail =
        open.length > 0
          ? open.slice(0, 2).map((i) => i.name).filter(Boolean).join(" · ")
          : affected.length > 0
            ? affected.slice(0, 3).join(" · ")
            : `${used.map((c) => c.name).join(", ")} operational`;
      return { key, label, group: "provider", status, ms: null, detail, checkedAt };
    }
    const indicator = body.status?.indicator ?? "none";
    status = indicator === "none" ? "up" : indicator === "minor" || indicator === "maintenance" ? "slow" : "down";
    const detail = open.length > 0 ? open.slice(0, 2).map((i) => i.name).filter(Boolean).join(" · ") : body.status?.description || "All Systems Operational";
    return { key, label, group: "provider", status, ms: null, detail, checkedAt };
  } catch {
    return { key, label, group: "provider", status: "slow", ms: null, detail: "Status page unreachable", checkedAt };
  }
}

/** Firebase's own incident feed — ongoing incidents for the products this app uses. */
async function firebaseStatus(): Promise<ServiceCheck> {
  const key = "firebase-status";
  const label = "Firebase (Google)";
  const checkedAt = new Date().toISOString();
  const used = /auth|firestore|storage|hosting|functions/i;
  try {
    const res = await fetch("https://status.firebase.google.com/incidents.json", { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { key, label, group: "provider", status: "slow", ms: null, detail: `Status page unavailable (HTTP ${res.status})`, checkedAt };
    const incidents = (await res.json()) as { end?: string | null; service_name?: string; external_desc?: string; severity?: string }[];
    const ongoing = incidents.filter((i) => !i.end && used.test(i.service_name ?? ""));
    if (ongoing.length === 0) return { key, label, group: "provider", status: "up", ms: null, detail: "No ongoing incidents", checkedAt };
    const status: ServiceState = ongoing.some((i) => i.severity === "high") ? "down" : "slow";
    const detail = ongoing.slice(0, 2).map((i) => `${i.service_name}: ${i.external_desc ?? "incident"}`).join(" · ");
    return { key, label, group: "provider", status, ms: null, detail, checkedAt };
  } catch {
    return { key, label, group: "provider", status: "slow", ms: null, detail: "Status page unreachable", checkedAt };
  }
}

/** Runs every check in parallel. `colo` = the Cloudflare data center serving this request (when known). */
export async function runServerStatusChecks(env: StatusEnv, opts: { colo?: string } = {}): Promise<ServiceCheck[]> {
  const fbKey = env.firebaseApiKey;
  const fbProject = env.firebaseProjectId;
  const fbBucket = env.firebaseStorageBucket;
  const supabaseKey = env.supabaseAnonKey || env.supabaseServiceKey;

  const checks = await Promise.all([
    // --- Databases ---
    probe("supabase-db", "Supabase Database", "database", `${env.supabaseUrl}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` },
    }, (res) => res.ok),
    probe("supabase-auth", "Supabase Auth", "database", `${env.supabaseUrl}/auth/v1/health`, { headers: { apikey: supabaseKey } }, (res) => res.ok),
    fbKey
      ? probe("firebase-auth", "Firebase Auth (logins)", "database", `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: "status-check" }),
        })
      : Promise.resolve(notConfigured("firebase-auth", "Firebase Auth (logins)", "database", "VITE_FIREBASE_API_KEY")),
    fbProject
      ? probe("firestore", "Firestore (notifications)", "database", `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(fbProject)}/databases/(default)/documents/__status__/ping${fbKey ? `?key=${encodeURIComponent(fbKey)}` : ""}`)
      : Promise.resolve(notConfigured("firestore", "Firestore (notifications)", "database", "VITE_FIREBASE_PROJECT_ID")),
    fbBucket
      ? probe("firebase-storage", "Firebase Storage (files)", "database", `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(fbBucket)}/o?maxResults=1`)
      : Promise.resolve(notConfigured("firebase-storage", "Firebase Storage (files)", "database", "VITE_FIREBASE_STORAGE_BUCKET")),

    // --- Provider status pages ---
    statuspage("supabase-status", "Supabase", "https://status.supabase.com/api/v2/summary.json"),
    // Only what the app runs on: Workers (the app), DNS, SSL and the CDN in front of it.
    statuspage("cloudflare-status", "Cloudflare", "https://www.cloudflarestatus.com/api/v2/summary.json", /^(Workers|Workers Assets|Authoritative DNS|SSL Certificate Provisioning|CDN\/Cache)$/),
    firebaseStatus(),

    // --- Outside services (reachability only — no login, no orders, no billed calls) ---
    probe("servicepower", "ServicePower", "integration", "https://claimworks.servicepower.com/"),
    probe("marcone", "Marcone", "integration", "https://api.msupply.com/"),
    probe("encompass", "Encompass", "integration", "https://encompass.com/"),
    probe("google-maps", "Google Maps", "integration", "https://maps.googleapis.com/maps/api/geocode/json?address=status"),
    probe("geoapify", "Geoapify", "integration", "https://api.geoapify.com/v1/geocode/search?text=status"),
  ]);

  // Hosting: this code running on the Worker is the check.
  const hosting: ServiceCheck = {
    key: "hosting",
    label: "Cloudflare Worker (app hosting)",
    group: "hosting",
    status: "up",
    ms: null,
    detail: opts.colo ? `Serving from data center ${opts.colo}` : "Serving requests",
    checkedAt: new Date().toISOString(),
  };
  return [hosting, ...checks];
}

/** Saves one row per service and prunes rows older than HISTORY_DAYS. Errors are logged, never thrown (0377 may not be run yet). */
export async function recordServerStatusChecks(env: StatusEnv, checks: ServiceCheck[]): Promise<void> {
  const rows = checks.map((c) => ({ checked_at: c.checkedAt, service: c.key, status: c.status, response_ms: c.ms, detail: c.detail.slice(0, 300) }));
  const res = await sb(env, "server_status_checks", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
  if (!res.ok) {
    console.warn("[server-status] save failed:", res.status, await res.text().catch(() => ""));
    return;
  }
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
  await sb(env, `server_status_checks?checked_at=lt.${encodeURIComponent(cutoff)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => undefined);
}

/** "When did this cron schedule last run" — upserted at the start of every scheduled tick. */
export async function recordCronHeartbeat(env: StatusEnv, job: string, detail?: string): Promise<void> {
  await sb(env, "server_cron_heartbeats?on_conflict=job", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ job, last_run_at: new Date().toISOString(), ok: true, detail: detail ?? null }),
  }).catch(() => undefined);
}

/** The 5-minute cron's job: check everything, save it. */
export async function runAndRecordServerStatus(rawEnv: Record<string, string | undefined>): Promise<{ saved: number; down: string[] }> {
  const env = readStatusEnv(rawEnv);
  if (!env) return { saved: 0, down: ["server not configured"] };
  const checks = await runServerStatusChecks(env);
  await recordServerStatusChecks(env, checks);
  return { saved: checks.length, down: checks.filter((c) => c.status === "down").map((c) => c.key) };
}

interface DailyRow { service: string; day: string; total: number; up: number; slow: number; down: number }
interface UptimeRow { service: string; total: number; reachable: number }

async function rpc<T>(env: StatusEnv, fn: string, args: Record<string, unknown>): Promise<T[] | null> {
  const res = await sb(env, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  if (!res.ok) return null;
  return (await res.json()) as T[];
}

/**
 * POST /api/server-status   body: { idToken }
 * SuperAdmin only. Runs every check live (and saves it to the history),
 * then returns the checks + uptime % (24h / 7d / 30d) + daily history +
 * recent problems + cron heartbeats.
 */
export async function handleServerStatusRequest(request: Request, rawEnv?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readStatusEnv(rawEnv);
  if (!env || !env.firebaseProjectId) return json({ error: "Server not configured" }, 500);

  try {
    const payload = (await request.json().catch(() => ({}))) as { idToken?: string };
    if (!payload.idToken) return json({ error: "Not signed in." }, 401);
    const claims = await verifyFirebaseToken(payload.idToken, env.firebaseProjectId);
    const meRes = await sb(env, `profiles?firebase_uid=eq.${encodeURIComponent(claims.sub)}&select=id,role,extra_roles&limit=1`);
    const me = meRes.ok ? ((await meRes.json()) as { id: string; role: string | null; extra_roles: string[] | null }[])[0] : undefined;
    const held = me ? [me.role, ...(me.extra_roles ?? [])].map((r) => String(r ?? "").trim().toUpperCase()) : [];
    if (!held.includes("SUPERADMIN") && !held.includes("SUPERSUPERADMIN")) return json({ error: "Only SuperAdmin can view the server status." }, 403);

    const colo = (request as any).cf?.colo as string | undefined;
    const checks = await runServerStatusChecks(env, { colo });
    await recordServerStatusChecks(env, checks);

    const [daily, up24, up7, up30, problemsRes, beatsRes] = await Promise.all([
      rpc<DailyRow>(env, "server_status_daily", { p_days: HISTORY_DAYS }),
      rpc<UptimeRow>(env, "server_status_uptime", { p_hours: 24 }),
      rpc<UptimeRow>(env, "server_status_uptime", { p_hours: 24 * 7 }),
      rpc<UptimeRow>(env, "server_status_uptime", { p_hours: 24 * HISTORY_DAYS }),
      sb(env, `server_status_checks?status=neq.up&select=checked_at,service,status,response_ms,detail&order=checked_at.desc&limit=150`),
      sb(env, "server_cron_heartbeats?select=job,last_run_at,ok,detail"),
    ]);
    const pct = (rows: UptimeRow[] | null) =>
      Object.fromEntries((rows ?? []).map((r) => [r.service, Number(r.total) > 0 ? (Number(r.reachable) / Number(r.total)) * 100 : null]));

    return json({
      checkedAt: new Date().toISOString(),
      checks,
      historyEnabled: daily !== null,
      uptime: { h24: pct(up24), d7: pct(up7), d30: pct(up30) },
      daily: (daily ?? []).map((r) => ({ ...r, total: Number(r.total), up: Number(r.up), slow: Number(r.slow), down: Number(r.down) })),
      problems: problemsRes.ok ? await problemsRes.json() : [],
      heartbeats: beatsRes.ok ? await beatsRes.json() : [],
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Server status check failed" }, 500);
  }
}
