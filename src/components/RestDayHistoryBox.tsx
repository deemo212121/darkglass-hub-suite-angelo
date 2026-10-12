import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getRestDayHistoryFor, upsertRestDayPeriod, deleteRestDayPeriod, type RestDayHistoryRow } from "@/lib/supabase/restDayHistory";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDays = (d: number[]) => (d.length ? [...d].sort((a, b) => a - b).map((i) => DAY_SHORT[i]).join(", ") : "No rest days");
const fmtDate = (iso: string) =>
  iso <= "2000-01-01" ? "the beginning" : new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Rest day history (migration 0371) on a user's edit page — which rest days
 * applied when, so a change in October doesn't rewrite September. HR can add
 * an earlier schedule here for someone whose rest days were changed before
 * the history existed. `reloadKey` changes after a save so it refreshes.
 */
export function RestDayHistoryBox({ profileId, companyId, reloadKey }: { profileId: string; companyId: string | null; reloadKey?: unknown }) {
  const { uid } = useAuth();
  const [rows, setRows] = useState<RestDayHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newDays, setNewDays] = useState<number[]>([0, 6]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRows(await getRestDayHistoryFor(profileId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error && /rest_day_history/.test(err.message) ? "Run migration 0371 in Supabase to turn on rest day history." : "Couldn't load the history.");
      setRows([]);
    }
  };
  useEffect(() => {
    if (profileId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, reloadKey]);

  const add = async () => {
    if (!newFrom || !companyId) return;
    setBusy(true);
    try {
      const me = uid ? await getMyProfileId(uid) : null;
      await upsertRestDayPeriod(profileId, companyId, newDays, newFrom, me);
      toast.success(`Saved: ${fmtDays(newDays)} from ${fmtDate(newFrom)}.`);
      setAdding(false);
      setNewFrom("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: RestDayHistoryRow) => {
    if (!confirm(`Remove "${fmtDays(r.offDays)} from ${fmtDate(r.effectiveFrom)}" from the history?`)) return;
    setBusy(true);
    try {
      await deleteRestDayPeriod(r.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rest day history</span>
        {!adding && rows && !error && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-blue-200">
            <Plus className="h-3.5 w-3.5" /> Add an earlier schedule
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Each day is checked against the rest days in force on that day — changing them doesn't rewrite past months.</p>

      {rows === null ? (
        <p className="mt-2 text-xs text-slate-400"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Loading…</p>
      ) : error ? (
        <p className="mt-2 text-xs text-amber-300">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No history yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((r, i) => {
            const next = rows[i + 1];
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded bg-white/5 px-2.5 py-1.5 text-xs">
                <span>
                  <span className="font-semibold text-slate-100">{fmtDays(r.offDays)}</span>
                  <span className="text-slate-400">
                    {" "}· from {fmtDate(r.effectiveFrom)}
                    {next ? ` until ${dayBefore(next.effectiveFrom)}` : " — current"}
                  </span>
                </span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => void remove(r)} disabled={busy} title="Remove" className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-red-300 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <div className="mt-3 space-y-2 rounded border border-white/10 p-2.5">
          <p className="text-[11px] text-slate-400">
            E.g. they had Sat &amp; Sun before switching to Thu &amp; Fri on Oct 1: pick Sat + Sun, effective from their start (or the date that schedule began).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_SHORT.map((d, idx) => {
              const off = newDays.includes(idx);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setNewDays((prev) => (off ? prev.filter((x) => x !== idx) : [...prev, idx]))}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${off ? "border border-red-500/40 bg-red-500/20 text-red-300" : "border border-white/10 bg-slate-800 text-slate-300"}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <label className="block text-xs text-slate-400">
            Effective from
            <input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} className="ml-2 rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white [color-scheme:dark]" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void add()} disabled={!newFrom || busy} className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
