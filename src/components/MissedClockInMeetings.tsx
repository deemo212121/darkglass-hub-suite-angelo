import { useEffect, useMemo, useState } from "react";
import { CalendarX2, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { ProfileRow } from "@/lib/supabase/users";
import { getPendingClockInMeetings, markClockInMeetingDone, type ClockInMeeting } from "@/lib/supabase/clockInMeetings";

/**
 * Clock-In Codes page → "Meetings required": technicians who missed a
 * scheduled clock-in (migration 0348, written by the Worker's hourly job).
 * Marking one done keeps the record — the missed day still counts as 1
 * error on the Technician Performance Report.
 */
export function MissedClockInMeetings({ profiles }: { profiles: ProfileRow[] }) {
  const { displayName } = useAuth();
  const [meetings, setMeetings] = useState<ClockInMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [doneFor, setDoneFor] = useState<ClockInMeeting | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMeetings(await getPendingClockInMeetings());
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  // Technicians with more than one open meeting are listed together.
  const grouped = useMemo(() => {
    const map = new Map<string, ClockInMeeting[]>();
    for (const m of meetings) {
      if (!map.has(m.profileId)) map.set(m.profileId, []);
      map.get(m.profileId)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [meetings]);

  const markDone = async () => {
    if (!doneFor) return;
    setSaving(true);
    setError(null);
    try {
      await markClockInMeetingDone(doneFor.id, displayName || "Manager", note);
      setDoneFor(null);
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel p-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <CalendarX2 className="h-4 w-4 text-red-300" />
        <span className="text-sm font-semibold">Meetings required ({meetings.length})</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="mx-4 mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
        <p className="font-semibold">Critical rules</p>
        <ol className="mt-1 list-decimal pl-4 space-y-0.5">
          <li>Correct errors by the next day — a missed Time Out must be fixed (Time Correction request) the very next morning, before heading out to the field.</li>
          <li>Avoid accumulating error counts.</li>
        </ol>
        <p className="mt-1">Maverick Team will support with time card adjustments.</p>
      </div>
      <p className="px-4 pt-2 text-[11px] text-muted-foreground">
        <span className="font-semibold text-slate-300">Missed clock-in:</span> a scheduled work day with no Time In (not a day off, approved PTO or a holiday).{" "}
        <span className="font-semibold text-slate-300">Missed Time Out:</span> the day was closed by an automatic clock-out and no correction was sent before the next Time In —
        a minor error with a mandatory correction meeting with the Branch Manager or above. Each one is 1 error on the Technician Performance Report;
        marking the meeting done doesn't remove it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Technician</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && meetings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No meetings needed.</td>
              </tr>
            )}
            {grouped.map(([profileId, list]) =>
              list.map((m, i) => (
                <tr key={m.id} className="border-b border-white/5">
                  <td className="px-3 py-2 whitespace-nowrap font-medium">
                    {i === 0 ? (
                      <>
                        {byId.get(profileId)?.display_name || "Unknown"}
                        {list.length > 1 && <span className="ml-2 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">{list.length} missed</span>}
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{i === 0 ? byId.get(profileId)?.assigned_branch || "—" : ""}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDate(m.missedDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {m.kind === "missed_time_out" ? (
                      <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300" title="Auto clock-out, no correction sent before the next Time In">Missed Time Out — not corrected</span>
                    ) : (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">Missed clock-in</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => { setDoneFor(m); setNote(""); setError(null); }} className="btn text-xs px-2 py-1 inline-flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Meeting done
                    </button>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {doneFor && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setDoneFor(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[var(--color-panel,#0f172a)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Meeting done</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {byId.get(doneFor.profileId)?.display_name || "Technician"} · {doneFor.kind === "missed_time_out" ? "missed Time Out" : "missed clock-in"} {fmtDate(doneFor.missedDate)}
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notes from the meeting (optional)"
              rows={3}
              className="glass-input mt-3 w-full rounded-md px-3 py-2 text-sm"
            />
            {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDoneFor(null)} disabled={saving} className="btn text-sm px-3 py-1.5">Cancel</button>
              <button type="button" onClick={() => void markDone()} disabled={saving} className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50">
                {saving ? "Saving…" : "Mark done"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
