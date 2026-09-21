/**
 * CSR Self Service — lets an individual CSR agent tally their own GH/
 * Schedule/Attempt/Update for a day themselves, instead of a team lead
 * typing it in for them on the Daily Report grid (CSRTeamDailyReport.tsx,
 * /m/csr/daily-report). Writes into the exact same csr_daily_report_entries
 * row that grid reads (upsertCsrDailyReportEntry, keyed on the agent's own
 * profile id + the selected date) — no new table, so a lead opening that
 * grid sees whatever gets tallied here immediately.
 *
 * Total is computed as Schedule + Attempt + Update (GH tracked separately,
 * not summed in) and written back to the row's own `total` field on every
 * change, so the grid's Total column reflects it without anyone needing to
 * type it separately.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronRight, ChevronLeft as ChevronLeftNav, Pencil, Plus, Loader2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getCsrDailyReportEntries, upsertCsrDailyReportEntry, type CsrDailyReportEntry } from "@/lib/supabase/csrDailyReportEntries";
import { todayIso } from "@/components/CSRTeamDailyReport";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function addDaysISO(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type TallyField = "gh" | "schedule" | "attempt" | "updateCount";
const TALLY_FIELDS: { field: TallyField; label: string }[] = [
  { field: "gh", label: "GH" },
  { field: "schedule", label: "Schedule" },
  { field: "attempt", label: "Attempt" },
  { field: "updateCount", label: "Update" },
];

function TallyCard({
  label, value, busy, onAdd, onSet,
}: {
  label: string;
  value: number;
  busy: boolean;
  onAdd: () => void;
  onSet: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  return (
    <div className="panel p-4 flex flex-col items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        <button type="button" onClick={() => setEditing((e) => !e)} className="text-slate-500 hover:text-blue-300" title="Edit directly">
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      {editing ? (
        <input
          type="number"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onSet(Math.max(0, Number(draft) || 0)); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="glass-input text-2xl font-bold text-center w-20 py-1 rounded-md"
        />
      ) : (
        <div className="text-3xl font-bold tabular-nums">{value}</div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onAdd}
        className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        +1
      </button>
    </div>
  );
}

export function CsrSelfServiceTally({ mod, sub }: Props) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, displayName, email } = useAuth();

  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [reportDate, setReportDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<TallyField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<Pick<CsrDailyReportEntry, "gh" | "schedule" | "attempt" | "updateCount" | "total">>({
    gh: 0, schedule: 0, attempt: 0, updateCount: 0, total: 0,
  });

  useEffect(() => {
    if (!uid) return;
    getMyProfileId(uid).then(setMyProfileId).catch((err) => setError(err instanceof Error ? err.message : "Failed to load your profile."));
  }, [uid]);

  const loadForDate = useCallback(async (profileId: string, date: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getCsrDailyReportEntries(date);
      const mine = rows.find((r) => r.profileId === profileId);
      setEntry({
        gh: mine?.gh ?? 0,
        schedule: mine?.schedule ?? 0,
        attempt: mine?.attempt ?? 0,
        updateCount: mine?.updateCount ?? 0,
        total: mine?.total ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your tally for this date.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (myProfileId) void loadForDate(myProfileId, reportDate);
  }, [myProfileId, reportDate, loadForDate]);

  const commit = async (field: TallyField, value: number) => {
    if (!myProfileId) return;
    setSavingField(field);
    const next = { ...entry, [field]: value };
    const total = (next.schedule ?? 0) + (next.attempt ?? 0) + (next.updateCount ?? 0);
    next.total = total;
    setEntry(next);
    try {
      await upsertCsrDailyReportEntry(myProfileId, reportDate, { [field]: value, total });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingField(null);
    }
  };

  return (
    <main className="max-w-160 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">{mod.label}</Link><span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>
      <div className="flex items-center gap-3 mb-1">
        <button type="button" onClick={goBack} className="btn"><ChevronLeft className="h-4 w-4" /></button>
        <h1 className="text-xl font-bold">Hello, {displayName || email || "there"}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5 ml-[52px]">Tally your GH, Schedule, Attempt, and Update for the day.</p>

      <div className="flex items-center justify-center gap-2 mb-6">
        <button type="button" onClick={() => setReportDate((d) => addDaysISO(d, -1))} className="btn" title="Previous day">
          <ChevronLeftNav className="h-4 w-4" />
        </button>
        <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md" />
        <button type="button" onClick={() => setReportDate((d) => addDaysISO(d, 1))} className="btn" title="Next day">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setReportDate(todayIso())} className="btn text-sm">Today</button>
      </div>

      {error && (
        <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="panel px-4 py-12 text-center text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            {TALLY_FIELDS.map(({ field, label }) => (
              <TallyCard
                key={field}
                label={label}
                value={entry[field] ?? 0}
                busy={savingField === field}
                onAdd={() => void commit(field, (entry[field] ?? 0) + 1)}
                onSet={(next) => void commit(field, next)}
              />
            ))}
          </div>
          <div className="panel p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="text-[10px] text-muted-foreground">Schedule + Attempt + Update</div>
            </div>
            <div className="text-3xl font-bold tabular-nums text-blue-300">{entry.total ?? 0}</div>
          </div>
        </>
      )}
    </main>
  );
}
