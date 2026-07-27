import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { syncServicePowerToSupabase } from "@/lib/servicePowerSync";
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
  const [startDate, setStartDate] = useState(isoDaysAgo(7));
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
      caption="Pulls all ServicePower calls from this date through today."
      running={running}
      result={result}
      onSubmit={() => void handleSubmit()}
    >
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Start Date</label>
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

function NsaMigrationCard() {
  const [startDate, setStartDate] = useState(isoDaysAgo(7));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const handleSubmit = async () => {
    if (!window.confirm(`Sync NSA tickets from ${startDate} to ${endDate} into Supabase?`)) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await syncNsaToSupabase({ startDate, endDate });
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
      caption="Pulls all NSA dispatches in this date range."
      running={running}
      result={result}
      onSubmit={() => void handleSubmit()}
    >
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Start Date</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="glass-input mt-1 w-full"
        />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">End Date</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="glass-input mt-1 w-full"
        />
      </div>
    </MigrationCard>
  );
}

export function DataMigrationPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        <Link
          to="/m/$module"
          params={{ module: mod.slug }}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-white/70 hover:text-white transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Admin
        </Link>
        <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md mb-6">
          <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
          <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ServicePowerMigrationCard />
          <NsaMigrationCard />
        </div>
      </div>
    </main>
  );
}
