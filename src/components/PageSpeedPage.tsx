/**
 * AHS Server Status → Page Speed (migration 0438): how long pages take to load
 * for the people using them, measured in their own browsers
 * (src/lib/pageLoadTimings.ts). Admin and up, like the rest of the module.
 *
 *   Shown — the page's own content is on screen.
 *   Ready — its data has finished loading.
 * "Typical" is the middle load (half were faster); "Slow" is 1 load in 10.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Gauge, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isAdminOrAboveHolder } from "@/lib/roleLabels";
import { getModule } from "@/lib/modules";
import {
  getPageSpeedDaily,
  getPageSpeedSummary,
  getSlowestPageLoads,
  isMissingTable,
  type PageSpeedDay,
  type PageSpeedDevice,
  type PageSpeedSummary,
  type SlowPageLoad,
} from "@/lib/supabase/pageLoadTimings";
import { formatMs, setPageSpeedBadge, speedTone, usePageSpeedBadgeOn } from "@/components/PageLoadTracker";

const PERIODS = [
  { key: "24h", label: "Last 24 hours", hours: 24 },
  { key: "7d", label: "Last 7 days", hours: 24 * 7 },
  { key: "30d", label: "Last 30 days", hours: 24 * 30 },
] as const;

const DEVICES: { key: string; label: string; value: PageSpeedDevice }[] = [
  { key: "all", label: "All devices", value: null },
  { key: "computer", label: "Computers", value: "computer" },
  { key: "phone", label: "Phones", value: "phone" },
  { key: "tablet", label: "Tablets", value: "tablet" },
];

const OTHER_PAGES: Record<string, string> = {
  "/": "Start",
  "/home": "Home",
  "/landing": "Sign in",
  "/mobile": "Technician app",
  "/profile": "Profile",
  "/notifications": "Notifications",
  "/announcements": "Announcements",
  "/ticket/$ticketNo": "Ticket (any ticket)",
  "/m/$module/$submodule/$userId": "Person page",
};

/** "HR → HR To Do List · Hiring tab" for a module page; a plain name (or the address) otherwise. */
export function pageLabel(path: string): string {
  const [base, query] = path.split("?");
  const tab = new URLSearchParams(query ?? "").get("tab");
  const parts = base.split("/").filter(Boolean);
  let label: string;
  if (parts[0] === "m" && parts.length >= 2) {
    const mod = getModule(parts[1]);
    const sub = parts[2] && parts[2] !== "$userId" ? mod?.submodules.find((s) => s.slug === parts[2]) : undefined;
    label = mod ? (sub ? `${mod.label} → ${sub.title}` : parts[2] ? `${mod.label} → ${parts[2]}` : mod.label) : base;
    if (parts[3] === "$userId") label += " → person";
  } else {
    label = OTHER_PAGES[base] ?? base;
  }
  return tab ? `${label} · ${tab} tab` : label;
}

const TONE_TEXT = { good: "text-emerald-300", ok: "text-amber-300", slow: "text-rose-300" } as const;

function Time({ ms, strong }: { ms: number | null; strong?: boolean }) {
  if (ms === null) return <span className="text-slate-500">—</span>;
  return <span className={`${TONE_TEXT[speedTone(ms)]} ${strong ? "font-semibold" : ""}`}>{formatMs(ms)}</span>;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function PageSpeedPage() {
  const navigate = useNavigate();
  const { role, extraRoles, realRole } = useAuth();
  const allowed = isAdminOrAboveHolder(realRole ?? role, extraRoles);
  const badgeOn = usePageSpeedBadgeOn();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("7d");
  const [deviceKey, setDeviceKey] = useState("all");
  const [summary, setSummary] = useState<PageSpeedSummary[]>([]);
  const [days, setDays] = useState<PageSpeedDay[]>([]);
  const [slowest, setSlowest] = useState<SlowPageLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const device = DEVICES.find((d) => d.key === deviceKey)?.value ?? null;

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const since = new Date(Date.now() - (PERIODS.find((p) => p.key === period)?.hours ?? 168) * 3_600_000);
    setLoading(true);
    setError(null);
    Promise.all([getPageSpeedSummary(since, device), getPageSpeedDaily(since, device), getSlowestPageLoads(since, device)])
      .then(([s, d, slow]) => {
        if (cancelled) return;
        setSummary(s);
        setDays(d);
        setSlowest(slow);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(isMissingTable(msg) ? "Page Speed isn't set up yet — run migration 0438 in Supabase. Timings start being saved from then on." : msg);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [allowed, period, device, reloadKey]);

  const rows = useMemo(() => [...summary].sort((a, b) => (b.readyP90 ?? b.readyMax ?? 0) - (a.readyP90 ?? a.readyMax ?? 0)), [summary]);
  const totals = useMemo(() => {
    const opens = summary.reduce((n, s) => n + s.opens, 0);
    const slowPages = summary.filter((s) => (s.readyP90 ?? 0) >= 3000).length;
    return { opens, pages: summary.length, slowPages };
  }, [summary]);
  const maxDay = Math.max(1, ...days.map((d) => d.readyP90 ?? d.readyMedian ?? 0));

  if (!allowed) {
    return (
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
        <p className="mt-1 text-sm text-slate-400">Page Speed is only available to Admin and up.</p>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: "server-status" } })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
          aria-label="Back to AHS Server Status"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-[220px]">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <Gauge className="h-5 w-5 text-blue-400" /> Page Speed
          </h1>
          <p className="text-sm text-slate-400">How long each page takes for the people using it, measured in their own browsers.</p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
          <input type="checkbox" checked={badgeOn} onChange={(e) => setPageSpeedBadge(e.target.checked)} />
          Show each page's load time in the corner (this browser, Admins only)
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${period === p.key ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-white/10 text-slate-300 hover:bg-white/5"}`}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
        {DEVICES.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDeviceKey(d.key)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${deviceKey === d.key ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-white/10 text-slate-300 hover:bg-white/5"}`}
          >
            {d.label}
          </button>
        ))}
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</div>
      ) : loading && summary.length === 0 ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : summary.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
          No pages measured in this period yet. Timings are saved as people use the app, a few at a time.
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-300">
            {totals.opens.toLocaleString()} page{totals.opens === 1 ? "" : "s"} opened across {totals.pages} different page{totals.pages === 1 ? "" : "s"}.{" "}
            {totals.slowPages > 0 ? (
              <span className="text-rose-300">{totals.slowPages} take 3 seconds or more to be ready on a slow load.</span>
            ) : (
              <span className="text-emerald-300">None take 3 seconds or more to be ready, even on a slow load.</span>
            )}
          </p>

          <section className="rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Pages, slowest first</h2>
              <p className="text-xs text-slate-400">Typical: half of loads were faster. Slow: 1 load in 10 took at least this long.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2 font-medium">Page</th>
                    <th className="px-3 py-2 text-right font-medium">Opened</th>
                    <th className="px-3 py-2 text-right font-medium">Shown, typical</th>
                    <th className="px-3 py-2 text-right font-medium">Ready, typical</th>
                    <th className="px-3 py-2 text-right font-medium">Ready, slow</th>
                    <th className="px-3 py-2 text-right font-medium">Slowest</th>
                    <th className="px-3 py-2 text-right font-medium" title="Left before the page was ready, or still loading after a minute">Gave up</th>
                    <th className="px-4 py-2 text-right font-medium">On phones</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {rows.map((r) => (
                    <tr key={r.path} className="border-t border-white/5">
                      <td className="px-4 py-2 font-sans text-slate-200" title={r.path}>{pageLabel(r.path)}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{r.opens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right"><Time ms={r.shownMedian} /></td>
                      <td className="px-3 py-2 text-right"><Time ms={r.readyMedian} /></td>
                      <td className="px-3 py-2 text-right"><Time ms={r.readyP90} strong /></td>
                      <td className="px-3 py-2 text-right"><Time ms={r.readyMax} /></td>
                      <td className="px-3 py-2 text-right text-slate-300">{r.leftEarly + r.timedOut > 0 ? (r.leftEarly + r.timedOut).toLocaleString() : "—"}</td>
                      <td className="px-4 py-2 text-right text-slate-300">{r.onPhone > 0 ? `${Math.round((100 * r.onPhone) / r.opens)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {days.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <h2 className="mb-2 text-sm font-semibold text-white">Day by day (US Central)</h2>
              <div className="space-y-1.5">
                {days.map((d) => (
                  <div key={d.day} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-xs">
                    <span className="text-slate-300">{dayLabel(d.day)}</span>
                    <div className="relative h-3 rounded bg-white/5" aria-hidden>
                      <div className="absolute inset-y-0 left-0 rounded bg-blue-500/25" style={{ width: `${(100 * (d.readyP90 ?? 0)) / maxDay}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded bg-blue-400/70" style={{ width: `${(100 * (d.readyMedian ?? 0)) / maxDay}%` }} />
                    </div>
                    <span className="font-mono tabular-nums text-slate-300">
                      <Time ms={d.readyMedian} /> typical · <Time ms={d.readyP90} /> slow · {d.opens.toLocaleString()} opened
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {slowest.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-white/[0.02]">
              <h2 className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">Slowest single loads</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Page</th>
                      <th className="px-3 py-2 font-medium">Who</th>
                      <th className="px-3 py-2 font-medium">Device</th>
                      <th className="px-4 py-2 text-right font-medium">Ready</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slowest.map((l, i) => (
                      <tr key={`${l.createdAt}-${i}`} className="border-t border-white/5">
                        <td className="px-4 py-2 whitespace-nowrap text-slate-400">{when(l.createdAt)}</td>
                        <td className="px-3 py-2 text-slate-200">
                          {pageLabel(l.path)}
                          {l.firstLoad && <span className="ml-1.5 text-[11px] text-slate-500">full page load</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{l.personName ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-400">
                          {l.device}
                          {l.connection ? ` · ${l.connection}` : ""}
                          {l.memoryGb ? ` · ${l.memoryGb} GB` : ""}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {l.readyMs !== null ? <Time ms={l.readyMs} strong /> : <span className="text-rose-300">left at {formatMs(l.leftAfterMs ?? 0)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
