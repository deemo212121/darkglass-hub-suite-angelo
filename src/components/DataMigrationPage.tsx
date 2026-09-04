import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { syncServicePowerToSupabase, syncServicePowerTicketsByCallNo } from "@/lib/servicePowerSync";
import { syncNsaToSupabase } from "@/lib/nsaSync";

interface SyncResult {
  success: boolean;
  added: number;
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
  running: boolean;
  result: SyncResult | null;
  onSubmit: () => void;
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
            Added: {result.added} · Updated: {result.updated} · Skipped: {result.skipped} · Total: {result.total}
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

  const handleSubmit = async () => {
    if (!window.confirm(`Sync ServicePower tickets from ${startDate} through today into Supabase?`)) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await syncServicePowerToSupabase(7, { startDate });
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
      title="(Ticket) Service Power Migration"
      caption="Pulls all ServicePower calls from this date through today. Pick an earlier date to catch up on a day you forgot to sync."
      running={running}
      result={result}
      onSubmit={() => void handleSubmit()}
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
        </div>
      </div>
    </main>
  );
}
