/**
 * GH Tracker — replaces CSR Self Service (CsrSelfServiceTally.tsx, deleted).
 * A real per-CSR log of phone numbers called/attempted for the day, instead
 * of a blunt "+1" counter. GH on the Daily Report (CSRTeamDailyReport.tsx)
 * is now just how many numbers a CSR logged that day (see
 * getGhCountsByProfileForRange, csrGhTracker.ts) — no separate stored total.
 *
 * Two views, gated by isCsrManagerRole (roleLabels.ts — CSR_MANAGER only,
 * deliberately NOT CSR_TEAM_LEADER, same narrower tier that function uses
 * elsewhere):
 *   - CSR_MANAGER sees every CSR's numbers for the picked date, one column
 *     per agent, matching the reference spreadsheet layout exactly.
 *   - Everyone else (CSR_AGENT/CSR_TEAM_LEADER) sees only their own list for
 *     today — add a number (+ optional note), edit or delete it same-day.
 *     migration 0317's RLS enforces this at the row level too, not just in
 *     this component, since this page is opened directly by individual
 *     agents rather than gated behind a manager-only page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronRight, ChevronLeft as ChevronLeftNav, Loader2, Phone, Plus, Trash2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { isCsrManagerRole } from "@/lib/roleLabels";
import { getMyProfileId, getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import {
  getMyGhTrackerEntries,
  getCompanyGhTrackerEntries,
  addGhTrackerEntry,
  updateGhTrackerEntry,
  deleteGhTrackerEntry,
  type CsrGhTrackerEntry,
} from "@/lib/supabase/csrGhTracker";
import { todayIso } from "@/components/CSRTeamDailyReport";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function addDaysISO(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function AgentView({ mod, sub, profileId }: { mod: ModuleDef; sub: SubModuleDef; profileId: string }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const today = todayIso();
  const [entries, setEntries] = useState<CsrGhTrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editNote, setEditNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await getMyGhTrackerEntries(profileId, today));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your GH Tracker for today.");
    } finally {
      setLoading(false);
    }
  }, [profileId, today]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    const trimmed = phone.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const created = await addGhTrackerEntry(profileId, today, trimmed, note.trim() || null);
      setEntries((prev) => [...prev, created]);
      setPhone("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add.");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (e: CsrGhTrackerEntry) => {
    setEditingId(e.id);
    setEditPhone(e.phoneNumber);
    setEditNote(e.note ?? "");
  };

  const saveEdit = async (id: string) => {
    const trimmed = editPhone.trim();
    if (!trimmed) return;
    setBusyId(id);
    try {
      await updateGhTrackerEntry(id, { phoneNumber: trimmed, note: editNote.trim() || null });
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, phoneNumber: trimmed, note: editNote.trim() || null } : e)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await deleteGhTrackerEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove.");
    } finally {
      setBusyId(null);
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
        <h1 className="text-xl font-bold">GH Tracker</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5 ml-[52px]">
        Log the numbers you've called or attempted to reach today ({today}). Your GH count on the Daily Report is however many you log here.
      </p>

      {error && (
        <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>
      )}

      <div className="panel p-4 mb-5">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            placeholder="Phone number"
            className="glass-input flex-1"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            placeholder="Note (optional)"
            className="glass-input flex-1"
          />
          <button
            type="button"
            disabled={adding || !phone.trim()}
            onClick={() => void handleAdd()}
            className="btn btn-primary inline-flex items-center justify-center gap-1.5 disabled:opacity-50 px-4"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
        </div>
      </div>

      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10 bg-white/5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Today's Numbers</h2>
          <span className="text-xs text-muted-foreground">{entries.length} logged</span>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm">No numbers logged yet today.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-2.5 flex items-center gap-3">
                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {editingId === e.id ? (
                  <>
                    <input value={editPhone} onChange={(ev) => setEditPhone(ev.target.value)} className="glass-input flex-1 text-sm py-1" />
                    <input value={editNote} onChange={(ev) => setEditNote(ev.target.value)} placeholder="Note" className="glass-input flex-1 text-sm py-1" />
                    <button type="button" disabled={busyId === e.id} onClick={() => void saveEdit(e.id)} className="btn text-xs px-2 py-1">Save</button>
                    <button type="button" onClick={() => setEditingId(null)} className="btn text-xs px-2 py-1">Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm">
                      {e.phoneNumber}
                      {e.note && <span className="text-muted-foreground ml-2 text-xs">— {e.note}</span>}
                    </span>
                    <button type="button" onClick={() => startEdit(e)} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
                    <button type="button" disabled={busyId === e.id} onClick={() => void handleDelete(e.id)} className="text-red-400 hover:text-red-300 p-1" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function ManagerView({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [date, setDate] = useState(todayIso());
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CsrGhTrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allProfiles, dayEntries] = await Promise.all([
        getCompanyUsers(),
        getCompanyGhTrackerEntries(date, date),
      ]);
      setProfiles(allProfiles);
      setEntries(dayEntries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the GH Tracker.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  // One column per CSR who actually logged something this day — sorted by
  // first name, matching the reference sheet's plain alphabetical columns.
  const columns = useMemo(() => {
    const byProfile = new Map<string, CsrGhTrackerEntry[]>();
    for (const e of entries) {
      const arr = byProfile.get(e.profileId) ?? [];
      arr.push(e);
      byProfile.set(e.profileId, arr);
    }
    return Array.from(byProfile.entries())
      .map(([profileId, rows]) => ({
        profileId,
        name: profileById.get(profileId)?.display_name || profileById.get(profileId)?.username || profileById.get(profileId)?.email || "Unknown",
        rows,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, profileById]);

  const maxRows = columns.reduce((m, c) => Math.max(m, c.rows.length), 0);

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">{mod.label}</Link><span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <button type="button" onClick={goBack} className="btn"><ChevronLeft className="h-4 w-4" /></button>
        <h1 className="text-xl font-bold">GH Tracker</h1>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setDate((d) => addDaysISO(d, -1))} className="btn" title="Previous day">
            <ChevronLeftNav className="h-4 w-4" />
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md" />
          <button type="button" onClick={() => setDate((d) => addDaysISO(d, 1))} className="btn" title="Next day">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setDate(todayIso())} className="btn text-sm">Today</button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-5 ml-[52px]">Every CSR's logged numbers for {date}, read-only here.</p>

      {error && (
        <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>
      )}

      <div className="panel p-0 overflow-hidden">
        {loading ? (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
        ) : columns.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm">No numbers logged by anyone for this date yet.</div>
        ) : (
          <div className="overflow-auto max-h-[75vh]">
            <table className="text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="divide-x divide-white/10">
                  {columns.map((c) => (
                    <th key={c.profileId} className="px-3 py-2 bg-blue-500/20 text-blue-100 font-semibold text-left whitespace-nowrap sticky top-0">
                      {c.name} <span className="font-normal text-blue-200/70">({c.rows.length})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxRows }, (_, i) => (
                  <tr key={i} className="divide-x divide-white/10 odd:bg-blue-500/5">
                    {columns.map((c) => {
                      const row = c.rows[i];
                      return (
                        <td key={c.profileId} className="px-3 py-1.5 whitespace-nowrap">
                          {row ? (
                            <>
                              {row.phoneNumber}
                              {row.note && <span className="text-muted-foreground text-xs ml-1.5">- {row.note}</span>}
                            </>
                          ) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

export function CsrGhTracker({ mod, sub }: Props) {
  const { ready, uid, role, extraRoles } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    if (!ready || !uid) return;
    getMyProfileId(uid)
      .then(setMyProfileId)
      .finally(() => setResolving(false));
  }, [ready, uid]);

  if (isCsrManagerRole(role, extraRoles)) {
    return <ManagerView mod={mod} sub={sub} />;
  }

  if (!ready || resolving) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }
  if (!myProfileId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Couldn't resolve your profile — try reloading.
      </div>
    );
  }
  return <AgentView mod={mod} sub={sub} profileId={myProfileId} />;
}
