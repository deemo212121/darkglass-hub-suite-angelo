/**
 * Absent List — HR module. Everyone with no recorded clock-in on the
 * selected date, company-wide, excluding scheduled rest days (profiles.
 * off_days) and anyone on approved PTO/leave that day (not a genuine
 * miss). Same "no Time In = absent" convention Ticket Attendance's own
 * Status filter already uses, for consistency across the app — this page
 * is the general-purpose "who's missing today (or any day)" lookup HR
 * itself reaches for, distinct from Attendance Warning Settings' live
 * grace-window alerting (a different, narrower tool for a different
 * purpose).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Pencil, Check, Loader2, Filter } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, getProfileIdByFirebaseUid, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getAttendanceNotes, upsertAttendanceNote, upsertAttendanceHrNote, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { getCompanyPtoRequests, type PtoRequestRow } from "@/lib/supabase/pto";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AbsentRow {
  profile: ProfileRow;
  note: string;
  hrNote: string;
}

export function AbsentListPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [notes, setNotes] = useState<AttendanceNoteRow[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-column funnel filters in the header row — Role/Branch/Manager are
  // multi-select (empty set = no restriction), Note is tri-state (All/Has
  // note/No note). Same pattern Ticket Attendance's own header filters use.
  type TriState = "all" | "has" | "none";
  type FilterMenuKey = "role" | "branch" | "manager" | "notes" | "hrNote";
  const [openFilterMenu, setOpenFilterMenu] = useState<FilterMenuKey | null>(null);
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [branchFilter, setBranchFilter] = useState<Set<string>>(new Set());
  const [managerFilter, setManagerFilter] = useState<Set<string>>(new Set());
  const [notesColFilter, setNotesColFilter] = useState<TriState>("all");
  const [hrNoteColFilter, setHrNoteColFilter] = useState<TriState>("all");

  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  // Employee roster + PTO requests don't depend on the selected date —
  // loaded once, separately from the per-date timecard/notes fetch below.
  useEffect(() => {
    getCompanyUsers()
      .then(setProfiles)
      .catch((err) => console.error("Failed to load employees for Absent List:", err));
    getCompanyPtoRequests()
      .then(setPtoRequests)
      .catch((err) => console.error("Failed to load PTO requests for Absent List:", err));
  }, []);

  const load = () => {
    setLoading(true);
    Promise.all([getCompanyTimecardEntries(date, date), getAttendanceNotes(date, date)])
      .then(([tc, n]) => {
        setEntries(tc);
        setNotes(n);
      })
      .catch((err) => console.error("Failed to load Absent List:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const checkedInProfileIds = useMemo(
    () => new Set(entries.filter((e) => e.checkIn).map((e) => e.profileId)),
    [entries]
  );
  const noteByProfileId = useMemo(() => new Map(notes.map((n) => [n.profileId, n])), [notes]);
  // Approved, paid or unpaid leave covering this date — not counted as
  // absent (it's scheduled and already reviewed), just excluded outright.
  const onLeaveProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of ptoRequests) {
      if (r.status === "approved" && r.startDate <= date && date <= r.endDate) ids.add(r.profileId);
    }
    return ids;
  }, [ptoRequests, date]);

  // Filter-menu option lists — sourced from the full active roster (not
  // just today's absent rows) so the checklists stay stable regardless of
  // what's currently filtered.
  const roleOptions = useMemo(
    () => Array.from(new Set(profiles.filter((p) => p.is_active).map((p) => p.role))).sort((a, b) => (ROLE_LABELS[a] || a).localeCompare(ROLE_LABELS[b] || b)),
    [profiles]
  );
  const branchOptions = useMemo(
    () => Array.from(new Set(profiles.filter((p) => p.is_active).map((p) => p.assigned_branch).filter((b): b is string => !!b))).sort(),
    [profiles]
  );
  const managerOptions = useMemo(
    () => Array.from(new Set(profiles.filter((p) => p.is_active).map((p) => p.manager_name).filter((m): m is string => !!m))).sort(),
    [profiles]
  );

  const absentRows: AbsentRow[] = useMemo(() => {
    const dow = new Date(date + "T00:00:00").getDay();
    const q = search.trim().toLowerCase();
    return profiles
      .filter((p) => p.is_active)
      .filter((p) => !(p.off_days ?? []).includes(dow)) // not a scheduled rest day
      .filter((p) => !onLeaveProfileIds.has(p.id)) // not on approved PTO/leave
      .filter((p) => !checkedInProfileIds.has(p.id)) // no check-in recorded
      .filter((p) => !q || (p.display_name || p.email).toLowerCase().includes(q))
      .filter((p) => roleFilter.size === 0 || roleFilter.has(p.role))
      .filter((p) => branchFilter.size === 0 || (p.assigned_branch && branchFilter.has(p.assigned_branch)))
      .filter((p) => managerFilter.size === 0 || (p.manager_name && managerFilter.has(p.manager_name)))
      .map((p) => ({ profile: p, note: noteByProfileId.get(p.id)?.content || "", hrNote: noteByProfileId.get(p.id)?.hrNote || "" }))
      .filter((r) => notesColFilter === "all" || (notesColFilter === "has" ? !!r.note : !r.note))
      .filter((r) => hrNoteColFilter === "all" || (hrNoteColFilter === "has" ? !!r.hrNote : !r.hrNote))
      .sort((a, b) => (a.profile.display_name || a.profile.email).localeCompare(b.profile.display_name || b.profile.email));
  }, [profiles, checkedInProfileIds, onLeaveProfileIds, noteByProfileId, date, search, roleFilter, branchFilter, managerFilter, notesColFilter, hrNoteColFilter]);

  const onLeaveCount = useMemo(() => {
    const dow = new Date(date + "T00:00:00").getDay();
    return profiles.filter((p) => p.is_active && !(p.off_days ?? []).includes(dow) && onLeaveProfileIds.has(p.id)).length;
  }, [profiles, onLeaveProfileIds, date]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const handleSaveNote = async (profileId: string) => {
    const content = noteDraft;
    setSavingNoteId(profileId);
    try {
      await upsertAttendanceNote({
        profileId,
        noteDate: date,
        content,
        notifyIndividual: false,
        notifyTeamLead: false,
        createdBy: myProfileId,
      });
      setNotes((prev) => [
        ...prev.filter((n) => n.profileId !== profileId),
        { profileId, noteDate: date, content, hrNote: prev.find((n) => n.profileId === profileId)?.hrNote || "", notifyIndividual: false, notifyTeamLead: false, createdBy: myProfileId },
      ]);
      setEditingId(null);
    } catch (err) {
      alert(`Failed to save note: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingNoteId(null);
    }
  };

  const [editingHrNoteId, setEditingHrNoteId] = useState<string | null>(null);
  const [hrNoteDraft, setHrNoteDraft] = useState("");
  const [savingHrNoteId, setSavingHrNoteId] = useState<string | null>(null);
  const handleSaveHrNote = async (profileId: string) => {
    const hrNote = hrNoteDraft;
    setSavingHrNoteId(profileId);
    try {
      await upsertAttendanceHrNote(profileId, date, hrNote);
      setNotes((prev) => {
        const existing = prev.find((n) => n.profileId === profileId);
        if (existing) return prev.map((n) => (n.profileId === profileId ? { ...n, hrNote } : n));
        return [...prev, { profileId, noteDate: date, content: "", hrNote, notifyIndividual: false, notifyTeamLead: false, createdBy: myProfileId }];
      });
      setEditingHrNoteId(null);
    } catch (err) {
      alert(`Failed to save HR note: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingHrNoteId(null);
    }
  };

  // Shared markup for the Role/Branch/Manager multi-select header filters.
  const renderMultiSelectFilterHeader = (
    key: FilterMenuKey,
    label: string,
    options: string[],
    selected: Set<string>,
    setSelected: (s: Set<string>) => void,
    optionLabel: (v: string) => string = (v) => v
  ) => (
    <>
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => setOpenFilterMenu((cur) => (cur === key ? null : key))}
          title={`Filter by ${label}`}
          className={selected.size > 0 ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}
        >
          <Filter className="h-3 w-3" />
        </button>
      </span>
      {openFilterMenu === key && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenFilterMenu(null)} />
          <div className="absolute left-0 top-full mt-1 w-56 max-h-72 overflow-y-auto bg-slate-900 border border-white/15 rounded-lg shadow-2xl z-50 p-2 normal-case font-normal text-left">
            {options.length === 0 ? (
              <div className="text-xs text-slate-500 px-2 py-1.5">No options.</div>
            ) : (
              <>
                {options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(opt)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(opt)) next.delete(opt);
                        else next.add(opt);
                        setSelected(next);
                      }}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    {optionLabel(opt)}
                  </label>
                ))}
                {selected.size > 0 && (
                  <button type="button" onClick={() => setSelected(new Set())} className="mt-1 w-full text-left text-xs text-blue-300 hover:text-blue-200 px-2 py-1">
                    Clear
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  // Shared markup for the Note/HR Note tri-state ("All"/"Has"/"None") header filters.
  const renderTriStateFilterHeader = (
    key: FilterMenuKey,
    label: string,
    value: TriState,
    setValue: (v: TriState) => void,
    hasLabel: string,
    noneLabel: string
  ) => (
    <>
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => setOpenFilterMenu((cur) => (cur === key ? null : key))}
          title={`Filter by ${label}`}
          className={value !== "all" ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}
        >
          <Filter className="h-3 w-3" />
        </button>
      </span>
      {openFilterMenu === key && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenFilterMenu(null)} />
          <div className="absolute left-0 top-full mt-1 w-40 bg-slate-900 border border-white/15 rounded-lg shadow-2xl z-50 p-1 normal-case font-normal text-left">
            {([
              ["all", "All"],
              ["has", hasLabel],
              ["none", noneLabel],
            ] as [TriState, string][]).map(([v, vLabel]) => (
              <button
                key={v}
                type="button"
                onClick={() => { setValue(v); setOpenFilterMenu(null); }}
                className={`block w-full text-left px-2 py-1.5 text-sm rounded hover:bg-white/5 ${value === v ? "text-blue-300 font-semibold" : "text-slate-200"}`}
              >
                {vLabel}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );

  return (
    <main className="flex-1 bg-slate-950">
      <div className="mx-auto max-w-[1400px] px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-white">
          <button type="button" onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <h1 className="text-xl font-semibold">{sub.title}</h1>
          <p className="text-sm text-slate-400">{sub.description}</p>
        </div>

        <div className="panel">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-2">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="glass-input"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-2">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Employee name..."
                className="glass-input"
              />
            </div>
            <div className="ml-auto text-right text-sm text-slate-400">
              {loading ? (
                "Loading…"
              ) : (
                <>
                  <span className="text-red-300 font-semibold">{absentRows.length}</span> absent
                  {onLeaveCount > 0 && <span className="ml-2 text-slate-500">({onLeaveCount} on approved leave, not counted)</span>}
                </>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : absentRows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No one is marked absent for {date}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10 text-left">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("role", "Role", roleOptions, roleFilter, setRoleFilter, (v) => ROLE_LABELS[v] || v)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("branch", "Branch", branchOptions, branchFilter, setBranchFilter)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("manager", "Manager", managerOptions, managerFilter, setManagerFilter)}
                    </th>
                    <th className="py-2 pr-3 relative">
                      {renderTriStateFilterHeader("notes", "Note", notesColFilter, setNotesColFilter, "Has note", "No note")}
                    </th>
                    <th className="py-2 relative">
                      {renderTriStateFilterHeader("hrNote", "HR Note", hrNoteColFilter, setHrNoteColFilter, "Has note", "No note")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {absentRows.map(({ profile: p, note, hrNote }) => {
                    const isEditing = editingId === p.id;
                    const isEditingHr = editingHrNoteId === p.id;
                    return (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-2 pr-3 text-white font-medium whitespace-nowrap">{p.display_name || p.email}</td>
                        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{ROLE_LABELS[p.role] || p.role}</td>
                        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{p.assigned_branch || "—"}</td>
                        <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{p.manager_name || "—"}</td>
                        <td className="py-2 pr-3 min-w-[220px]">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                type="text"
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleSaveNote(p.id);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                placeholder="Why are they absent?"
                                className="glass-input text-xs py-1"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveNote(p.id)}
                                disabled={savingNoteId === p.id}
                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 shrink-0"
                              >
                                {savingNoteId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(p.id);
                                setNoteDraft(note);
                              }}
                              className="flex items-center gap-1.5 text-left text-slate-300 hover:text-white"
                            >
                              {note ? <span className="truncate max-w-[260px]">{note}</span> : <span className="text-slate-600">Add note</span>}
                              <Pencil className="h-3 w-3 text-slate-500 shrink-0" />
                            </button>
                          )}
                        </td>
                        <td className="py-2 min-w-[220px]">
                          {isEditingHr ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                type="text"
                                value={hrNoteDraft}
                                onChange={(e) => setHrNoteDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleSaveHrNote(p.id);
                                  if (e.key === "Escape") setEditingHrNoteId(null);
                                }}
                                placeholder="HR notes (internal)"
                                className="glass-input text-xs py-1"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveHrNote(p.id)}
                                disabled={savingHrNoteId === p.id}
                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 shrink-0"
                              >
                                {savingHrNoteId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingHrNoteId(p.id);
                                setHrNoteDraft(hrNote);
                              }}
                              className="flex items-center gap-1.5 text-left text-slate-300 hover:text-white"
                            >
                              {hrNote ? <span className="truncate max-w-[260px]">{hrNote}</span> : <span className="text-slate-600">Add HR note</span>}
                              <Pencil className="h-3 w-3 text-slate-500 shrink-0" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
