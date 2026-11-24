import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { syncServicePowerToSupabase, syncServicePowerTicketsByCallNo } from "@/lib/servicePowerSync";
import { syncNsaToSupabase } from "@/lib/nsaSync";
import { localISODate } from "@/lib/localDate";
import { getSpPullLogForCallDate, getSpAutoPullSettings, setSpAutoPullSettings, type SpPullLogRow } from "@/lib/supabase/spPullLog";
import { AUTO_PULL_LOOKBACK_DAYS, AUTO_PULL_SOURCE_CHOICES, type SpAutoPullSettings } from "@/lib/servicePowerAutoPullRules";

interface SyncResult {
  success: boolean;
  added: number;
  updated: number;
  skipped: number;
  total: number;
  /** New-only pulls: open calls that were already tickets (left unchanged). */
  alreadyInAhs?: number;
  errors: string[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localISODate(d);
}

/** Shared card chrome for a migration source: title/caption, a date-input
 * slot, a Submit button, and a color-coded result panel once it's run.
 * Only two call sites exist (ServicePower, NSA) - not worth a standalone
 * exported component for that. */
function MigrationCard({
  title,
  caption,
  children,
  running,
  result,
  onSubmit,
  footer,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
  running: boolean;
  result: SyncResult | null;
  onSubmit: () => void;
  /** Shown under the result (e.g. the pulled-tickets list). */
  footer?: React.ReactNode;
}) {
  return (
    <div className="panel">
      <h2 className="text-lg font-semibold text-white mb-1">{title}</h2>
      <p className="text-xs text-slate-400 mb-3">{caption}</p>

      <div className="space-y-3">{children}</div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={running}
        className="btn btn-primary mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {running ? "Syncing…" : "Submit"}
      </button>

      {result && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            result.success && result.errors.length === 0
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-400/40 bg-red-500/10 text-red-200"
          }`}
        >
          <div className="font-semibold">
            {result.success && result.errors.length === 0 ? "✓ Synced successfully" : "⚠ Completed with errors"}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {result.alreadyInAhs != null
              ? <>Added: {result.added} · Already in AHS (left unchanged): {result.alreadyInAhs} · Skipped (not open): {result.skipped} · Total: {result.total}</>
              : <>Added: {result.added} · Updated: {result.updated} · Skipped: {result.skipped} · Total: {result.total}</>}
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-xs space-y-0.5">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {footer && <div className="mt-4">{footer}</div>}
    </div>
  );
}

function ServicePowerMigrationCard() {
  // Defaults to today (this is meant to run daily) but stays freely
  // changeable - pick an earlier date to catch up on a day that was
  // missed. ServicePower's API has no independent end date, so it always
  // walks forward from whatever date you pick through today - handy here,
  // since it means picking the earliest missed day also catches every day
  // after it in one go, not just that one.
  const [startDate, setStartDate] = useState(isoDaysAgo(0));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  // Tickets the pulls (hourly auto-pull + this button) added for calls
  // ServicePower received on the picked date (sp_pull_log, migration 0475).
  const [pulled, setPulled] = useState<SpPullLogRow[] | null>(null);
  const [pulledError, setPulledError] = useState<string | null>(null);
  const loadPulled = useCallback(async (date: string) => {
    setPulledError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setPulled([]); return; }
    setPulled(null);
    try {
      setPulled(await getSpPullLogForCallDate(date));
    } catch (err) {
      setPulledError(err instanceof Error ? err.message : "Couldn't load the pulled tickets.");
      setPulled([]);
    }
  }, []);
  useEffect(() => { void loadPulled(startDate); }, [startDate, loadPulled]);

  const handleSubmit = async () => {
    if (!window.confirm(`Add the open ServicePower tickets from ${startDate} through today that aren't in AHS yet?`)) return;
    setRunning(true);
    setResult(null);
    try {
      // Open calls only (Accepted / Open: never Claimed, Completed, Cancelled
      // or Rejected), and only the ones not in AHS yet. Re-updating an
      // existing ticket from SP would overwrite its technician and clear its
      // check-ins, so existing tickets are left alone.
      const r = await syncServicePowerToSupabase(7, { startDate, openOnly: true, newOnly: true });
      setResult(r);
    } catch (err) {
      setResult({
        success: false,
        added: 0,
        updated: 0,
        skipped: 0,
        total: 0,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      });
    } finally {
      setRunning(false);
      void loadPulled(startDate);
    }
  };

  return (
    <MigrationCard
      title="(Ticket) Service Power Migration"
      caption="Adds the open ServicePower calls (Accepted / Open) from this date through today that aren't in AHS yet. Claimed, Completed, Cancelled and Rejected calls are left out, and tickets already in AHS are never changed. Pick an earlier date to catch up on a day you forgot to sync."
      running={running}
      result={result}
      onSubmit={() => void handleSubmit()}
      footer={<PulledTicketsList date={startDate} rows={pulled} error={pulledError} />}
    >
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Date</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="glass-input mt-1 w-full"
        />
      </div>
    </MigrationCard>
  );
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${m}/${d}/${y}` : iso;
};

/** Count + list of the tickets pulled for calls received on `date`. */
function PulledTicketsList({ date, rows, error }: { date: string; rows: SpPullLogRow[] | null; error: string | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/40">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Pulled for calls received {date ? fmtDate(date) : "—"}
        </div>
        <div className="text-sm font-semibold text-white">
          {rows === null ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : `${rows.length} ticket${rows.length === 1 ? "" : "s"}`}
        </div>
      </div>
      {error ? (
        <p className="px-3 py-2 text-xs text-amber-300">{error}</p>
      ) : rows && rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-slate-400">No tickets pulled from ServicePower for this date yet.</p>
      ) : rows ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs text-white">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Ticket #</th>
                <th className="px-3 py-1.5 text-left font-medium">Source</th>
                <th className="px-3 py-1.5 text-left font-medium">Branch</th>
                <th className="px-3 py-1.5 text-left font-medium">Pulled</th>
                <th className="px-3 py-1.5 text-left font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-1.5">
                    <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
                      {r.ticketNo}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-slate-300">{r.source || "—"}</td>
                  <td className="px-3 py-1.5 text-slate-300">{r.branch || "—"}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-slate-300">{r.pulledAt ? new Date(r.pulledAt).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" }) : "—"}</td>
                  <td className="px-3 py-1.5 text-slate-300">{r.mode === "auto" ? "Auto pull" : r.pulledByName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The hourly ServicePower auto-pull (server/servicePowerAutoPull.ts): which
 * sources it adds, and from which call date. Admin / Super Admin change it
 * (set_company_sp_auto_pull, migration 0475); no sources = off.
 */
function ServicePowerAutoPullCard() {
  const [settings, setSettings] = useState<SpAutoPullSettings | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await getSpAutoPullSettings();
      setSettings(s);
      setDraft(s?.sources ?? []);
      setFrom(s?.from ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the auto-pull settings.");
      setSettings(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const choices = [...new Set([...AUTO_PULL_SOURCE_CHOICES, ...(settings?.sources ?? [])])];
  const toggle = (s: string) => setDraft((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  const dirty =
    settings !== undefined &&
    (draft.slice().sort().join("|") !== (settings?.sources ?? []).slice().sort().join("|") || from !== (settings?.from ?? ""));

  const save = async (sources: string[]) => {
    const what = sources.length === 0 ? "Turn the ServicePower auto-pull off?" : `Auto-pull ${sources.join(", ")} every hour${from ? ` (calls received from ${fmtDate(from)} on)` : ""}?`;
    if (!window.confirm(what)) return;
    setSaving(true);
    try {
      await setSpAutoPullSettings(sources, from || undefined);
      await load();
    } catch (err) {
      alert(`Couldn't save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const on = !!settings && settings.sources.length > 0;
  return (
    <div className="panel">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-white mb-1">(Ticket) ServicePower Auto-Pull</h2>
        {settings !== undefined && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30" : "bg-slate-700/60 text-slate-300"}`}>
            {on ? "On" : "Off"}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Every hour, adds the open ServicePower calls (Accepted / Open) from the checked sources that aren't in AHS yet, looking at calls received in the last {AUTO_PULL_LOOKBACK_DAYS} days (never before the From date). Tickets already in AHS are never changed. What it adds shows in Service Power Migration's pulled list as "Auto pull".
      </p>
      {error && <p className="mb-2 text-xs text-amber-300">{error}</p>}
      {settings === undefined ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sources</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {choices.map((s) => (
                <label key={s} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${draft.includes(s) ? "border-blue-400/50 bg-blue-500/15 text-white" : "border-white/10 text-slate-300 hover:bg-white/5"}`}>
                  <input type="checkbox" checked={draft.includes(s)} onChange={() => toggle(s)} disabled={saving} className="accent-blue-500" />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">From (call received)</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={saving} className="glass-input mt-1 w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save(draft)} disabled={saving || !dirty || draft.length === 0} className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Saving…" : on ? "Save" : "Turn on"}
            </button>
            {on && (
              <button type="button" onClick={() => void save([])} disabled={saving} className="btn disabled:opacity-50">
                Turn off
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface TicketPullResult {
  success: boolean;
  added: number;
  updated: number;
  notFound: string[];
  errors: string[];
}

/**
 * Re-pull specific ticket(s) by their exact ticket/call number, straight
 * from ServicePower — for a ticket whose local data looks wrong or
 * incomplete (a mangled address, a stale status) rather than a whole day's
 * worth of new calls. Goes through the exact same conversion/merge pipeline
 * as the date-range card above (syncServicePowerTicketsByCallNo), so a
 * locally-edited field isn't clobbered here either.
 */
function ServicePowerTicketPullCard() {
  const [ticketNosText, setTicketNosText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TicketPullResult | null>(null);

  const parsedTicketNos = ticketNosText
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const handleSubmit = async () => {
    if (parsedTicketNos.length === 0) return;
    if (!window.confirm(`Re-pull ${parsedTicketNos.length} ticket${parsedTicketNos.length === 1 ? "" : "s"} from ServicePower?\n\n${parsedTicketNos.join(", ")}`)) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await syncServicePowerTicketsByCallNo(parsedTicketNos);
      setResult(r);
    } catch (err) {
      setResult({ success: false, added: 0, updated: 0, notFound: [], errors: [err instanceof Error ? err.message : "Unknown error"] });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="panel">
      <h2 className="text-lg font-semibold text-white mb-1">(Ticket) Pull Specific Tickets</h2>
      <p className="text-xs text-slate-400 mb-3">
        Re-fetches specific ticket number(s) straight from ServicePower — for a ticket whose local data looks wrong (e.g. a bad address), not a whole day's sync. One per line, or comma-separated.
      </p>
      <textarea
        value={ticketNosText}
        onChange={(e) => setTicketNosText(e.target.value)}
        placeholder={"1007891642-11\n1008230266-10\nSA-4620943"}
        rows={5}
        className="glass-input w-full font-mono text-xs"
      />
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={running || parsedTicketNos.length === 0}
        className="btn btn-primary mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {running ? "Pulling…" : `Pull ${parsedTicketNos.length || ""} Ticket${parsedTicketNos.length === 1 ? "" : "s"}`}
      </button>

      {result && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            result.success ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-red-400/40 bg-red-500/10 text-red-200"
          }`}
        >
          <div className="font-semibold">{result.success ? "✓ Pulled successfully" : "⚠ Completed with issues"}</div>
          <div className="mt-1 text-xs text-slate-300">
            Added: {result.added} · Updated: {result.updated}
          </div>
          {result.notFound.length > 0 && (
            <div className="mt-2 text-xs">
              <span className="font-semibold">Not found in ServicePower:</span> {result.notFound.join(", ")}
            </div>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-xs space-y-0.5">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NsaMigrationCard() {
  // One date, defaulting to today but freely changeable - pick an earlier
  // day to catch up on tickets that were missed that day (startDate and
  // endDate both get set to it, so this pulls exactly that single day).
  const [date, setDate] = useState(isoDaysAgo(0));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const handleSubmit = async () => {
    if (!window.confirm(`Sync NSA tickets for ${date} into Supabase?`)) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await syncNsaToSupabase({ startDate: date, endDate: date });
      setResult(r);
    } catch (err) {
      setResult({
        success: false,
        added: 0,
        updated: 0,
        skipped: 0,
        total: 0,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <MigrationCard
      title="(Ticket) NSA Migration"
      caption="Pulls all NSA dispatches for this day. Pick an earlier date to catch up on a day you forgot to sync."
      running={running}
      result={result}
      onSubmit={() => void handleSubmit()}
    >
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="glass-input mt-1 w-full"
        />
      </div>
    </MigrationCard>
  );
}

export function DataMigrationPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        <div className="mb-6 flex items-center gap-3 text-white">
          <button type="button" onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
            <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ServicePowerMigrationCard />
          <NsaMigrationCard />
          <ServicePowerTicketPullCard />
          <ServicePowerAutoPullCard />
        </div>
      </div>
    </main>
  );
}
