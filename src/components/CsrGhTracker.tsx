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
 *
 * Duplicates (numbers compared digits-only — normalizeGhPhone) are flagged,
 * never blocked or dropped — they still count toward GH. The agent sees a
 * warning while typing a number already logged today and a "Duplicate" tag
 * on repeats; the manager view flags a number one CSR logged more than once
 * (red) and a number several CSRs logged the same day (amber).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronLeft as ChevronLeftNav, Loader2, Phone, Plus, Trash2 } from "lucide-react";
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
  normalizeGhPhone,
  type CsrGhTrackerEntry,
} from "@/lib/supabase/csrGhTracker";
import { todayIso } from "@/components/CSRTeamDailyReport";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const phoneKey = (phone: string) => normalizeGhPhone(phone) || phone.trim().toLowerCase();

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

  // How many times each number appears in today's list (2+ = duplicate).
  const keyCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(phoneKey(e.phoneNumber), (m.get(phoneKey(e.phoneNumber)) ?? 0) + 1);
    return m;
  }, [entries]);
  const typedIsDuplicate = phone.trim() !== "" && (keyCounts.get(phoneKey(phone)) ?? 0) > 0;

  const handleAdd = async () => {
    const trimmed = phone.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
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
    setError(null);
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
            className={`glass-input flex-1 ${typedIsDuplicate ? "border-amber-500/60" : ""}`}
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
        {typedIsDuplicate && (
          <p className="mt-2 text-xs text-amber-400 inline-flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Already logged today — it will be flagged as a duplicate.
          </p>
        )}
      </div>

      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10 bg-white/5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Today's Numbers</h2>
          <span className="text-xs text-muted-foreground">
            {entries.length} logged
            {entries.length > keyCounts.size && (
              <span className="text-red-400 ml-1">
                ({entries.length - keyCounts.size} duplicate{entries.length - keyCounts.size === 1 ? "" : "s"})
              </span>
            )}
          </span>
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
                      {(keyCounts.get(phoneKey(e.phoneNumber)) ?? 0) > 1 && (
                        <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">Duplicate</span>
                      )}
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

  // Duplicate detection for the day: per CSR (same number logged twice by
  // one person) and across CSRs (same number logged by several people).
  const dupes = useMemo(() => {
    const perAgent = new Map<string, number>(); // `${profileId}|${key}` → count
    const agentsByKey = new Map<string, Set<string>>();
    for (const e of entries) {
      const k = phoneKey(e.phoneNumber);
      perAgent.set(`${e.profileId}|${k}`, (perAgent.get(`${e.profileId}|${k}`) ?? 0) + 1);
      if (!agentsByKey.has(k)) agentsByKey.set(k, new Set());
      agentsByKey.get(k)!.add(e.profileId);
    }
    let repeatEntries = 0;
    for (const n of perAgent.values()) if (n > 1) repeatEntries += n - 1;
    let sharedNumbers = 0;
    for (const set of agentsByKey.values()) if (set.size > 1) sharedNumbers++;
    return { perAgent, agentsByKey, repeatEntries, sharedNumbers };
  }, [entries]);

  return (
    <main className="w-full px-6 py-4">
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
      <div className="mb-3 ml-[52px] flex flex-wrap items-center gap-3 text-xs">
        <span className="text-sm text-muted-foreground">Every CSR&apos;s logged numbers for {date}, read-only here.</span>
      {!loading && (dupes.repeatEntries > 0 || dupes.sharedNumbers > 0) && (
        <>
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          {dupes.repeatEntries > 0 && (
            <span className="rounded bg-red-500/15 px-2 py-0.5 font-semibold text-red-400">
              {dupes.repeatEntries} repeated entr{dupes.repeatEntries === 1 ? "y" : "ies"} (same CSR, same number)
            </span>
          )}
          {dupes.sharedNumbers > 0 && (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-400">
              {dupes.sharedNumbers} number{dupes.sharedNumbers === 1 ? "" : "s"} logged by more than one CSR
            </span>
          )}
        </>
      )}
      </div>

      {error && (
        <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>
      )}

      <div className="panel p-0 overflow-hidden">
        {loading ? (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
        ) : columns.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm">No numbers logged by anyone for this date yet.</div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="divide-x divide-white/10">
                  {columns.map((c) => (
                    <th key={c.profileId} className="px-3 py-2 bg-blue-950 text-blue-100 font-semibold text-left whitespace-nowrap sticky top-0 min-w-[200px] border-b border-blue-500/30">
                      {c.name}{" "}
                      <span className="font-normal text-blue-200/70">
                        ({c.rows.length})
                      </span>
                      {c.rows.length > new Set(c.rows.map((r) => phoneKey(r.phoneNumber))).size && (
                        <span className="ml-1.5 rounded bg-red-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-red-300">
                          {c.rows.length - new Set(c.rows.map((r) => phoneKey(r.phoneNumber))).size} dup
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxRows }, (_, i) => (
                  <tr key={i} className="divide-x divide-white/10 odd:bg-blue-500/5">
                    {columns.map((c) => {
                      const row = c.rows[i];
                      const k = row ? phoneKey(row.phoneNumber) : "";
                      const repeated = row ? (dupes.perAgent.get(`${c.profileId}|${k}`) ?? 0) > 1 : false;
                      const others = row ? Array.from(dupes.agentsByKey.get(k) ?? []).filter((id) => id !== c.profileId) : [];
                      const otherNames = others.map((id) => profileById.get(id)?.display_name || profileById.get(id)?.email || "another CSR");
                      return (
                        <td
                          key={c.profileId}
                          className={`px-3 py-1.5 whitespace-nowrap ${repeated ? "bg-red-500/15 text-red-300" : others.length ? "bg-amber-500/15 text-amber-200" : ""}`}
                          title={repeated ? `Logged more than once by ${c.name}` : others.length ? `Also logged by ${otherNames.join(", ")}` : undefined}
                        >
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
