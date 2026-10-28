/**
 * AHS Server Status (Admin and up) — live status of every service the
 * app depends on, with uptime % and a 30-day history. Each load (and every
 * 60 seconds while the page is open) runs the checks live through
 * POST /api/server-status (src/lib/server/serverStatus.ts); the Worker's
 * 5-minute cron fills the history in between (migration 0385).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, Clock, Database, FileSignature, Globe, Loader2, Plug, RefreshCw, Server, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { isAdminOrAboveHolder } from "@/lib/roleLabels";
import { zonedDateKey } from "@/lib/serverTime";
import { runBrowserUploadTest } from "@/lib/firebase/storage";

type State = "up" | "slow" | "down";
type Group = "database" | "documents" | "hosting" | "provider" | "integration";

interface Check {
  key: string;
  label: string;
  group: Group;
  status: State;
  ms: number | null;
  detail: string;
  checkedAt: string;
}
interface DailyRow { service: string; day: string; total: number; up: number; slow: number; down: number }
interface Problem { checked_at: string; service: string; status: State; response_ms: number | null; detail: string | null }
interface Heartbeat { job: string; last_run_at: string; ok: boolean; detail: string | null }
/** A failed upload / signing step for one person (app_error_log, migration 0387). */
interface AppError {
  id: number;
  created_at: string;
  profile_id: string | null;
  user_name: string | null;
  area: "upload" | "signing";
  action: string;
  message: string | null;
  device: string | null;
  page: string | null;
}

/** Which rows get the per-person error dropdown, and which errors they show. */
const ERROR_AREA_FOR_ROW: Record<string, AppError["area"]> = { "file-upload": "upload", "signing-papers": "signing" };

interface StatusResponse {
  checkedAt: string;
  checks: Check[];
  historyEnabled: boolean;
  uptime: { h24: Record<string, number | null>; d7: Record<string, number | null>; d30: Record<string, number | null> };
  daily: DailyRow[];
  problems: Problem[];
  heartbeats: Heartbeat[];
  /** False until migration 0387 (app_error_log) is run. */
  errorsEnabled?: boolean;
  errors?: AppError[];
}

const REFRESH_MS = 60_000;
const HISTORY_DAYS = 30;

const GROUPS: { key: Group; title: string; blurb: string; icon: typeof Database }[] = [
  { key: "database", title: "Databases", blurb: "Where the app's data, logins and files live.", icon: Database },
  { key: "documents", title: "Uploads & signing papers", blurb: "A real test file is uploaded, read back and removed; plus signing activity.", icon: FileSignature },
  { key: "hosting", title: "Hosting & scheduled jobs", blurb: "The Cloudflare Worker serving the app and its cron jobs.", icon: Server },
  { key: "provider", title: "Provider status pages", blurb: "What Supabase, Cloudflare and Firebase report about their own systems.", icon: Globe },
  { key: "integration", title: "Outside services", blurb: "Reachability only — nothing is logged into, ordered or billed.", icon: Plug },
];

const STATE_LABEL: Record<State, string> = { up: "Operational", slow: "Slow / degraded", down: "Down" };
const PROVIDER_STATE_LABEL: Record<State, string> = { up: "Operational", slow: "Minor incident", down: "Major outage" };
const STATE_DOT: Record<State, string> = { up: "bg-emerald-400", slow: "bg-amber-400", down: "bg-red-500" };
const STATE_TEXT: Record<State, string> = { up: "text-emerald-300", slow: "text-amber-300", down: "text-red-300" };
const STATE_PILL: Record<State, string> = {
  up: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  slow: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  down: "border-red-500/40 bg-red-500/15 text-red-300",
};

/** How late a cron schedule can be before it's flagged. */
const CRON_JOBS: { job: string; label: string; every: string; lateAfterMin: number }[] = [
  { job: "every-5-min", label: "Every 5 minutes", every: "Attendance alerts, forced Time Out, late clock-out check, server status", lateAfterMin: 12 },
  { job: "hourly", label: "Hourly", every: "NSA parts sync, Flash Tech alerts, missed clock-in meetings, weekly password reset", lateAfterMin: 75 },
];

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CST";
const fmtAgo = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h} h ${mins % 60} min ago` : `${Math.floor(h / 24)} days ago`;
};
const fmtPct = (v: number | null | undefined) => (v == null ? "—" : v >= 99.995 ? "100%" : `${v.toFixed(2)}%`);

export function ServerStatusPage() {
  const navigate = useNavigate();
  const { role, extraRoles, realRole, companyId } = useAuth();
  const allowed = isAdminOrAboveHolder(realRole ?? role, extraRoles);

  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [hostingUnreachable, setHostingUnreachable] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);
  /** Live upload test from this browser (not saved to the history). */
  const [browserUpload, setBrowserUpload] = useState<Check | null>(null);

  const runBrowserTest = useCallback(async () => {
    const base = { key: "browser-upload", label: "Upload from your browser", group: "documents" as Group, checkedAt: new Date().toISOString() };
    if (!companyId) {
      setBrowserUpload({ ...base, status: "down", ms: null, detail: "No company on your account — can't pick a folder to test" });
      return;
    }
    try {
      const r = await runBrowserUploadTest(companyId);
      const ms = r.uploadMs + r.linkMs;
      let removed = r.removed;
      if (!removed) {
        // The browser isn't allowed to delete it (storage.rules) — the server removes it.
        try {
          const idToken = await firebaseAuth?.currentUser?.getIdToken();
          const res = await fetch("/api/server-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken, action: "cleanup-browser-test", path: r.path }),
          });
          removed = res.ok && (await res.json().catch(() => ({}))).removed === true;
        } catch {
          removed = false;
        }
      }
      setBrowserUpload({
        ...base,
        status: ms > 4000 ? "slow" : "up",
        ms,
        detail: `Upload ${r.uploadMs} ms · link ${r.linkMs} ms${removed ? " · test file removed" : " · test file not removed"} — same path as users' uploads`,
      });
    } catch (err) {
      setBrowserUpload({ ...base, status: "down", ms: null, detail: `Upload failed — ${err instanceof Error ? err.message : "unknown error"}` });
    }
  }, [companyId]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Your session expired — sign in again.");
      const started = performance.now();
      let res: Response;
      try {
        res = await fetch("/api/server-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      } catch {
        setHostingUnreachable(true);
        throw new Error("Couldn't reach the app server (Cloudflare Worker).");
      }
      setHostingUnreachable(false);
      setRoundTripMs(Math.round(performance.now() - started));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Status check failed (HTTP ${res.status})`);
      setData(body as StatusResponse);
      setError(null);
      void runBrowserTest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status check failed");
    } finally {
      inFlight.current = false;
      setLoading(false);
      setNow(Date.now());
    }
  }, [runBrowserTest]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  useEffect(() => {
    if (!allowed || !autoRefresh) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [allowed, autoRefresh, load]);

  // Keeps "x min ago" fresh between checks.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const checks = useMemo(() => {
    const list = [...(data?.checks ?? []), ...(browserUpload ? [browserUpload] : [])];
    if (!hostingUnreachable) return list;
    return list.map((c) => (c.group === "hosting" ? { ...c, status: "down" as State, detail: "The app server didn't answer" } : c));
  }, [data, hostingUnreachable, browserUpload]);

  const dayKeys = useMemo(() => {
    const keys: string[] = [];
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) keys.push(zonedDateKey(new Date(now - i * 86400000), "CST"));
    return keys;
  }, [now]);

  const dailyByService = useMemo(() => {
    const map = new Map<string, Map<string, DailyRow>>();
    for (const r of data?.daily ?? []) {
      const m = map.get(r.service) ?? new Map<string, DailyRow>();
      m.set(String(r.day).slice(0, 10), r);
      map.set(r.service, m);
    }
    return map;
  }, [data]);

  const labelOf = useMemo(() => new Map(checks.map((c) => [c.key, c.label])), [checks]);

  // Headline: our own databases / hosting decide "outage"; provider pages and
  // outside services only ever make it "degraded".
  const overall = useMemo(() => {
    if (hostingUnreachable) return { state: "down" as State, text: "The app server isn't answering" };
    if (!data) return null;
    // Signing activity is informational — it never makes the page say "down".
    const core = checks.filter((c) => c.group === "database" || c.group === "hosting" || (c.group === "documents" && c.key !== "signing-papers"));
    const coreDown = core.filter((c) => c.status === "down");
    if (coreDown.length) return { state: "down" as State, text: `${coreDown.map((c) => c.label).join(", ")} ${coreDown.length === 1 ? "is" : "are"} down` };
    const issues = checks.filter((c) => c.status !== "up");
    if (issues.length) return { state: "slow" as State, text: `${issues.length} service${issues.length === 1 ? "" : "s"} need${issues.length === 1 ? "s" : ""} attention` };
    return { state: "up" as State, text: "All systems operational" };
  }, [checks, data, hostingUnreachable]);

  if (!allowed) {
    return (
      <main className="max-w-3xl mx-auto w-full px-6 py-16 text-center">
        <XCircle className="mx-auto h-10 w-10 text-red-400" />
        <h1 className="mt-3 text-lg font-bold text-white">Admin and up only</h1>
        <p className="mt-1 text-sm text-slate-400">The server status page is only available to Admin and up.</p>
      </main>
    );
  }

  const heartbeatFor = (job: string) => data?.heartbeats.find((h) => h.job === job) ?? null;

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/home" })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
          aria-label="Back to home"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-[220px]">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <Activity className="h-5 w-5 text-emerald-400" /> AHS Server Status
          </h1>
          <p className="text-sm text-slate-400">Live checks every 60 seconds while this page is open · history from the 5-minute server check.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-emerald-500" />
          Auto-refresh
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Check now
        </button>
      </div>

      {/* Overall banner */}
      {overall ? (
        <section className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${STATE_PILL[overall.state]}`}>
          {overall.state === "up" ? <CheckCircle2 className="h-6 w-6" /> : overall.state === "slow" ? <AlertTriangle className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
          <div className="flex-1 min-w-[200px]">
            <p className="text-base font-bold">{overall.text}</p>
            {data && <p className="text-xs opacity-80">Last checked {fmtAgo(data.checkedAt, now)} · {fmtTime(data.checkedAt)}</p>}
          </div>
          {roundTripMs != null && (
            <span className="text-xs opacity-80 tabular-nums">Page ↔ server round trip: {roundTripMs} ms</span>
          )}
        </section>
      ) : (
        <section className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking every service…
        </section>
      )}

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {data && !data.historyEnabled && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Uptime history is off — run migration <span className="font-mono">0385_server_status.sql</span> in Supabase. Live checks still work.
        </p>
      )}

      {data && data.errorsEnabled === false && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Upload and signing errors per person are off — run migration <span className="font-mono">0387_app_error_log.sql</span> in Supabase.
        </p>
      )}

      {/* Groups */}
      {GROUPS.map((g) => {
        const list = checks.filter((c) => c.group === g.key);
        if (!list.length && g.key !== "hosting") return null;
        const Icon = g.icon;
        return (
          <section key={g.key} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <Icon className="h-4 w-4 translate-y-0.5 text-slate-400" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">{g.title}</h2>
              <span className="text-xs text-slate-500">{g.blurb}</span>
            </div>
            <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-slate-900/50">
              {list.map((c) => (
                <ServiceRow
                  key={c.key}
                  check={c}
                  isProvider={g.key === "provider"}
                  extraMs={c.group === "hosting" ? roundTripMs : null}
                  uptime={{ h24: data?.uptime.h24[c.key], d7: data?.uptime.d7[c.key], d30: data?.uptime.d30[c.key] }}
                  days={dayKeys}
                  daily={dailyByService.get(c.key)}
                  showHistory={!!data?.historyEnabled && c.key !== "browser-upload"}
                  errors={(() => {
                    // Upload errors go on the server's File uploads row, or on
                    // the browser row when that one isn't there.
                    const area = ERROR_AREA_FOR_ROW[c.key] ?? (c.key === "browser-upload" && !list.some((x) => x.key === "file-upload") ? "upload" : undefined);
                    return area && data?.errorsEnabled ? (data.errors ?? []).filter((e) => e.area === area) : undefined;
                  })()}
                  errorsArea={ERROR_AREA_FOR_ROW[c.key] ?? "upload"}
                  now={now}
                />
              ))}
              {g.key === "hosting" &&
                CRON_JOBS.map((j) => {
                  const hb = heartbeatFor(j.job);
                  const lateMin = hb ? (now - new Date(hb.last_run_at).getTime()) / 60000 : null;
                  const state: State | null = hb == null ? null : lateMin! > j.lateAfterMin ? "down" : "up";
                  return (
                    <div key={j.job} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${state ? STATE_DOT[state] : "bg-slate-600"}`} />
                      <div className="min-w-[220px] flex-1">
                        <p className="text-sm font-semibold text-white">
                          <Clock className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-slate-400" />
                          Cron · {j.label}
                        </p>
                        <p className="text-xs text-slate-500">{j.every}</p>
                      </div>
                      <div className="text-right text-xs">
                        {hb ? (
                          <>
                            <p className={state ? STATE_TEXT[state] : "text-slate-400"}>{state === "down" ? "Late — hasn't run on time" : "Running on schedule"}</p>
                            <p className="text-slate-500">Last ran {fmtAgo(hb.last_run_at, now)} · {fmtTime(hb.last_run_at)}</p>
                          </>
                        ) : (
                          <p className="text-slate-500">No runs recorded yet{data?.historyEnabled ? " — the next tick will show here" : " (needs migration 0385)"}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        );
      })}

      {/* Recent problems */}
      {data?.historyEnabled && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Recent problems</h2>
          {data.problems.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-slate-900/50 px-4 py-6 text-center text-sm text-slate-400">No slow or failed checks in the last {HISTORY_DAYS} days.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-900/50">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-semibold">When</th>
                    <th className="px-3 py-2 font-semibold">Service</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold text-right">Response</th>
                    <th className="px-3 py-2 font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.problems.map((p, i) => (
                    <tr key={`${p.checked_at}-${p.service}-${i}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{fmtTime(p.checked_at)}</td>
                      <td className="px-3 py-2 text-white">{labelOf.get(p.service) ?? p.service}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${STATE_PILL[p.status]}`}>{STATE_LABEL[p.status]}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{p.response_ms != null ? `${p.response_ms} ms` : "—"}</td>
                      <td className="px-3 py-2 text-slate-400">{p.detail || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function ServiceRow({
  check,
  isProvider,
  extraMs,
  uptime,
  days,
  daily,
  showHistory,
  errors,
  errorsArea,
  now,
}: {
  check: Check;
  isProvider: boolean;
  extraMs: number | null;
  uptime: { h24?: number | null; d7?: number | null; d30?: number | null };
  days: string[];
  daily?: Map<string, DailyRow>;
  showHistory: boolean;
  /** Set on File uploads / Signing papers: that area's per-person errors (the dropdown). */
  errors?: AppError[];
  errorsArea?: AppError["area"];
  now: number;
}) {
  const ms = check.ms ?? extraMs;
  const [showErrors, setShowErrors] = useState(false);
  const errors24h = errors ? errors.filter((e) => now - new Date(e.created_at).getTime() < 86400000) : [];
  const people24h = new Set(errors24h.map((e) => e.profile_id ?? e.user_name ?? "?")).size;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[check.status]}`} />
        <div className="min-w-[200px] flex-1">
          <p className="text-sm font-semibold text-white">{check.label}</p>
          <p className="break-words text-xs text-slate-500">{check.detail}</p>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${STATE_PILL[check.status]}`}>
          {(isProvider ? PROVIDER_STATE_LABEL : STATE_LABEL)[check.status]}
        </span>
        {!isProvider && <span className="w-20 text-right text-xs tabular-nums text-slate-300">{ms != null ? `${ms} ms` : "—"}</span>}
        {errors && (
          <button
            type="button"
            onClick={() => setShowErrors((v) => !v)}
            aria-expanded={showErrors}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
              errors24h.length ? "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showErrors ? "rotate-180" : ""}`} />
            {errors24h.length
              ? `${errors24h.length} error${errors24h.length === 1 ? "" : "s"} · ${people24h} ${people24h === 1 ? "person" : "people"} today`
              : `Errors (${errors.length} in 30 days)`}
          </button>
        )}
        {showHistory && (
          <div className="flex gap-3 text-right text-[11px] tabular-nums">
            <span className="text-slate-500">24h <span className="font-semibold text-slate-200">{fmtPct(uptime.h24)}</span></span>
            <span className="text-slate-500">7d <span className="font-semibold text-slate-200">{fmtPct(uptime.d7)}</span></span>
            <span className="text-slate-500">30d <span className="font-semibold text-slate-200">{fmtPct(uptime.d30)}</span></span>
          </div>
        )}
      </div>
      {showHistory && (
        <div className="mt-2 flex gap-[2px]" aria-label={`${check.label}: last ${days.length} days`}>
          {days.map((d) => {
            const r = daily?.get(d);
            const cls = !r || r.total === 0 ? "bg-slate-700/60" : r.down > 0 ? "bg-red-500" : r.slow > 0 ? "bg-amber-400" : "bg-emerald-500/80";
            const title = !r || r.total === 0
              ? `${d}: no data`
              : `${d}: ${r.total} checks — ${r.up} ok${r.slow ? `, ${r.slow} slow` : ""}${r.down ? `, ${r.down} down` : ""}`;
            return <span key={d} title={title} className={`h-6 flex-1 rounded-[2px] ${cls}`} />;
          })}
        </div>
      )}
      {errors && showErrors && <ErrorsPanel errors={errors} area={errorsArea ?? "upload"} now={now} />}
    </div>
  );
}

const RANGES: { key: string; label: string; ms: number }[] = [
  { key: "24h", label: "Last 24 hours", ms: 86400000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 86400000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 86400000 },
];

/** The dropdown under File uploads / Signing papers: errors per person, newest first. */
function ErrorsPanel({ errors, area, now }: { errors: AppError[]; area: AppError["area"]; now: number }) {
  const [person, setPerson] = useState("all");
  const [range, setRange] = useState("7d");
  const personKey = (e: AppError) => e.profile_id ?? `name:${e.user_name ?? "Unknown"}`;
  const rangeMs = RANGES.find((r) => r.key === range)?.ms ?? 7 * 86400000;
  const inRange = errors.filter((e) => now - new Date(e.created_at).getTime() <= rangeMs);
  const counts = new Map<string, { name: string; count: number }>();
  for (const e of inRange) {
    const k = personKey(e);
    counts.set(k, { name: e.user_name || "Unknown", count: (counts.get(k)?.count ?? 0) + 1 });
  }
  const people = Array.from(counts).sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));
  const shown = person === "all" ? inRange : inRange.filter((e) => personKey(e) === person);
  const noun = area === "upload" ? "upload" : "signing";

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400" htmlFor={`err-person-${area}`}>Person</label>
        <select
          id={`err-person-${area}`}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          className="min-w-[200px] rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="all">Everyone ({inRange.length})</option>
          {people.map(([key, p]) => (
            <option key={key} value={key}>{p.name} ({p.count})</option>
          ))}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          aria-label="Time range"
          className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
        >
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <span className="text-[11px] text-slate-500">{people.length} {people.length === 1 ? "person" : "people"} with {noun} errors</span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-center text-xs text-slate-500">No {noun} errors {person === "all" ? "" : "for this person "}in this time range.</p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
          {shown.slice(0, 200).map((e) => (
            <li key={e.id} className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">
              <p className="text-xs text-slate-400">
                <span className="tabular-nums">{fmtTime(e.created_at)}</span>
                {" · "}
                <span className="font-semibold text-white">{e.user_name || "Unknown"}</span>
                {e.device ? ` · ${e.device}` : ""}
              </p>
              <p className="mt-0.5 text-sm text-slate-200">{e.action}</p>
              <p className="mt-0.5 break-words text-xs text-red-300">{e.message || "No error message"}</p>
              {e.page && <p className="mt-0.5 break-all text-[11px] text-slate-500">Page: {e.page}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
