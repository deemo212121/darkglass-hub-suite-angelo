/**
 * Absent List — HR module. Everyone with no recorded clock-in on any day in
 * the selected date range (defaults to just today), company-wide, excluding
 * scheduled rest days (profiles.off_days) and anyone on approved PTO/leave
 * that day (not a genuine miss). Same "no Time In = absent" convention
 * Ticket Attendance's own Status filter already uses, for consistency
 * across the app — this page is the general-purpose "who's missing today
 * (or over a stretch of days)" lookup HR itself reaches for, distinct from
 * Attendance Warning Settings' live grace-window alerting (a different,
 * narrower tool for a different purpose).
 *
 * A row is one (person, day) absence — spanning a range can put the same
 * person in multiple rows, each with its own independently editable
 * Note/HR Status for that specific day.
 *
 * Also hosts the Time Off Calendar (HrCalendarTab, moved in from HR &
 * Recruitment Dashboard's own sidebar) as a second view toggled from the
 * buttons up top — both pages answer "who's out and why", so they live
 * together now instead of in two different modules.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Pencil, Check, Loader2, Filter, CalendarDays, ListChecks, ClipboardList, Paperclip } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { getCompanyUsers, getEmployeeInfoByProfileIds, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, getProfileIdByFirebaseUid, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getAttendanceNotes, upsertAttendanceNote, upsertAttendanceHrNote, uploadAttendanceNoteAttachment, removeAttendanceNoteAttachment, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { getCompanyPtoRequests, type PtoRequestRow } from "@/lib/supabase/pto";
import { HrCalendarTab } from "@/components/HrCalendarTab";
import { TicketAttendanceTab } from "@/components/TicketAttendanceTab";
import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every "YYYY-MM-DD" from start to end, inclusive — local calendar days, not
 * UTC (toISOString() would shift a date backward a day for anyone east of
 * UTC, e.g. the Philippines). */
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const endD = new Date(end + "T00:00:00");
  for (let d = new Date(start + "T00:00:00"); d <= endD; d.setDate(d.getDate() + 1)) {
    out.push(toDateStr(d));
  }
  return out;
}

// HR Status — replaces what used to be a free-text HR Note with a fixed
// reason list, still stored in the same attendance_notes.hr_note column
// (no migration needed, it was already a plain string).
const HR_STATUS_OPTIONS = [
  "Vacation",
  "Sick",
  "Personal",
  "Holiday",
  "Unpaid",
  "Bereavement",
  "Absent",
  "Present (No Clock-In)",
  "Admin",
  "Unnoticed",
  "Resigned",
  "Terminated",
];
// Resigned/Terminated end employment entirely and Unnoticed flags a no-call/
// no-show — meaningfully different severity from an ordinary leave type, so
// they get their own color instead of blending into the rest. Absent is the
// default for every row on this page (see absentRows above) — plain,
// unexcused absence, not a leave type, so it also gets its own color rather
// than blending in with Vacation/Sick/etc. "Present (No Clock-In)" is the
// opposite correction — HR confirming the person WAS actually there that
// day, just never clocked in (forgot, bad wifi, manual timecard later,
// etc.). "Admin" covers a day spent on administrative/office duty rather
// than their usual clock-in work. Neither is a leave type either, so both
// are excluded from HR_STATUS_TO_PTO_TYPE the same way Unnoticed/Resigned/
// Terminated are (see HrCalendarTab.tsx) and never plot on the Time Off
// Calendar.
const HR_STATUS_COLOR: Record<string, string> = {
  Absent: "text-red-300",
  "Present (No Clock-In)": "text-cyan-300",
  Admin: "text-sky-300",
  Unnoticed: "text-amber-300",
  Resigned: "text-red-300",
  Terminated: "text-red-300",
};

interface AbsentRow {
  profile: ProfileRow;
  date: string;
  note: string;
  hrNote: string;
}

export function AbsentListPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, displayName, companyId } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  // Time Off Calendar moved in here from HR & Recruitment Dashboard's own
  // sidebar — they're both "who's out and why" tools, so it's a toggle on
  // this page now rather than a separate module tab. Ticket Attendance is
  // the same self-contained tab Accounting Dashboard and Attendance
  // Monitoring already mount (TicketAttendanceTab.tsx takes no props and
  // fetches its own data), added as a third view so HR can check on-site
  // check-ins without leaving this page.
  const [view, setView] = useState<"list" | "calendar" | "ticketAttendance">("list");
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
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
  const [hrStatusFilter, setHrStatusFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  // Employee roster + PTO requests don't depend on the selected date —
  // loaded once, separately from the per-date timecard/notes fetch below.
  const [hireDateByProfileId, setHireDateByProfileId] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    getCompanyUsers()
      .then((rows) => {
        setProfiles(rows);
        // Hire dates power the Time Off Calendar's Sick Leave/Vacation PTO
        // badges (same tenure math Master List uses) — a separate fetch
        // since it isn't part of getCompanyUsers' own select.
        return getEmployeeInfoByProfileIds(rows.map((p) => p.id));
      })
      .then((infoByProfile) => {
        const m = new Map<string, string>();
        for (const [id, info] of infoByProfile) if (info.hireDate) m.set(id, info.hireDate);
        setHireDateByProfileId(m);
      })
      .catch((err) => console.error("Failed to load employees for Absent List:", err));
    getCompanyPtoRequests()
      .then(setPtoRequests)
      .catch((err) => console.error("Failed to load PTO requests for Absent List:", err));
  }, []);

  const load = () => {
    if (dateTo < dateFrom) return; // invalid range mid-edit (e.g. only "From" typed so far) — wait for a valid one
    setLoading(true);
    Promise.all([getCompanyTimecardEntries(dateFrom, dateTo), getAttendanceNotes(dateFrom, dateTo)])
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
  }, [dateFrom, dateTo]);

  // Keyed "profileId|date" — check-in and notes are both per (profile, day),
  // same as everything else on this page once it spans more than one day.
  const checkedInSet = useMemo(
    () => new Set(entries.filter((e) => e.checkIn).map((e) => `${e.profileId}|${e.workDate}`)),
    [entries]
  );
  const noteByKey = useMemo(() => new Map(notes.map((n) => [`${n.profileId}|${n.noteDate}`, n])), [notes]);
  // Approved, paid or unpaid leave covering a given date — not counted as
  // absent (it's scheduled and already reviewed), just excluded outright.
  const isOnLeave = (profileId: string, d: string) =>
    ptoRequests.some((r) => r.profileId === profileId && r.status === "approved" && r.startDate <= d && d <= r.endDate);

  // Every date in the selected range, oldest first.
  const rangeDates = useMemo(() => (dateTo >= dateFrom ? enumerateDates(dateFrom, dateTo) : []), [dateFrom, dateTo]);

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

  // Name/Role/Branch/Manager filters don't depend on the date — narrow the
  // roster once, then apply the per-day checks (rest day/leave/check-in)
  // per date in the range against that same narrowed list.
  const activeFilteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles
      .filter((p) => p.is_active)
      .filter((p) => !q || (p.display_name || p.email).toLowerCase().includes(q))
      .filter((p) => roleFilter.size === 0 || roleFilter.has(p.role))
      .filter((p) => branchFilter.size === 0 || (p.assigned_branch && branchFilter.has(p.assigned_branch)))
      .filter((p) => managerFilter.size === 0 || (p.manager_name && managerFilter.has(p.manager_name)));
  }, [profiles, search, roleFilter, branchFilter, managerFilter]);

  const absentRows: AbsentRow[] = useMemo(() => {
    const rows: AbsentRow[] = [];
    for (const d of rangeDates) {
      const dow = new Date(d + "T00:00:00").getDay();
      for (const p of activeFilteredProfiles) {
        if ((p.off_days ?? []).includes(dow)) continue; // scheduled rest day
        if (isOnLeave(p.id, d)) continue; // approved PTO/leave
        if (checkedInSet.has(`${p.id}|${d}`)) continue; // checked in that day
        const entry = noteByKey.get(`${p.id}|${d}`);
        const note = entry?.content || "";
        // Every row here is, by definition, absent that day — default to
        // "Absent" instead of leaving it blank. The auto-fill effect below
        // persists this to attendance_notes.hr_note in the background (so
        // the Time Off Calendar's hrPlottedByProfile picks it up too); this
        // default just means the dropdown shows the right value immediately
        // instead of flashing blank until that write lands.
        const hrNote = entry?.hrNote || "Absent";
        if (notesColFilter !== "all" && (notesColFilter === "has" ? !note : !!note)) continue;
        if (hrStatusFilter.size > 0 && !hrStatusFilter.has(hrNote)) continue;
        rows.push({ profile: p, date: d, note, hrNote });
      }
    }
    return rows.sort(
      (a, b) => a.date.localeCompare(b.date) || (a.profile.display_name || a.profile.email).localeCompare(b.profile.display_name || b.profile.email)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDates, activeFilteredProfiles, checkedInSet, noteByKey, notesColFilter, hrStatusFilter, ptoRequests]);

  // Same absence conditions as absentRows above, but WITHOUT the
  // notesColFilter/hrStatusFilter narrowing — those filter the on-screen
  // list by the very column this effect exists to auto-fill, so using the
  // filtered list here would mean rows hidden by an active HR Status filter
  // never get defaulted.
  const rawAbsentKeys = useMemo(() => {
    const keys: { profileId: string; date: string }[] = [];
    for (const d of rangeDates) {
      const dow = new Date(d + "T00:00:00").getDay();
      for (const p of activeFilteredProfiles) {
        if ((p.off_days ?? []).includes(dow)) continue;
        if (isOnLeave(p.id, d)) continue;
        if (checkedInSet.has(`${p.id}|${d}`)) continue;
        keys.push({ profileId: p.id, date: d });
      }
    }
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDates, activeFilteredProfiles, checkedInSet, ptoRequests]);

  // Persists the "Absent" default (see absentRows above) to
  // attendance_notes.hr_note for every row that has no explicit status yet —
  // without this, the default is only a display trick and the Time Off
  // Calendar (which reads hr_note straight from the DB, not this page's
  // derived state) would never see these absences. No createdBy is stamped
  // (unlike a manual HR selection) since nobody actually chose this — it's
  // a system default, and an explicit override still attributes normally
  // via handleSaveHrStatus.
  const autoAbsentInFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!companyId || loading) return;
    for (const { profileId, date } of rawAbsentKeys) {
      const key = `${profileId}|${date}`;
      if (noteByKey.get(key)?.hrNote) continue; // already has a real status
      if (autoAbsentInFlight.current.has(key)) continue;
      autoAbsentInFlight.current.add(key);
      upsertAttendanceHrNote(profileId, date, "Absent", null, companyId)
        .then(() => {
          setNotes((prev) => {
            const existing = prev.find((n) => n.profileId === profileId && n.noteDate === date);
            if (existing) return prev.map((n) => (n.profileId === profileId && n.noteDate === date ? { ...n, hrNote: "Absent" } : n));
            return [
              ...prev,
              {
                profileId,
                noteDate: date,
                content: "",
                hrNote: "Absent",
                notifyIndividual: false,
                notifyTeamLead: false,
                createdBy: null,
                attachmentPath: null,
                attachmentAddedBy: null,
                attachmentAddedAt: null,
                attachmentRemovedBy: null,
                attachmentRemovedAt: null,
              },
            ];
          });
        })
        .catch((err) => console.error(`Failed to auto-default HR Status to Absent for ${key}:`, err))
        .finally(() => autoAbsentInFlight.current.delete(key));
    }
  }, [rawAbsentKeys, noteByKey, companyId, loading]);

  const onLeaveCount = useMemo(() => {
    let count = 0;
    for (const d of rangeDates) {
      const dow = new Date(d + "T00:00:00").getDay();
      count += profiles.filter((p) => p.is_active && !(p.off_days ?? []).includes(dow) && isOnLeave(p.id, d)).length;
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, rangeDates, ptoRequests]);

  // absentRows is already sorted date-then-name, so grouping preserves that
  // order — one section per day, in range order, names beneath each.
  const groupedAbsentRows = useMemo(() => {
    const groups = new Map<string, AbsentRow[]>();
    for (const r of absentRows) {
      const list = groups.get(r.date) ?? [];
      list.push(r);
      groups.set(r.date, list);
    }
    return Array.from(groups.entries());
  }, [absentRows]);

  // Shape HrCalendarTab expects — same roster this page already loads, just
  // remapped field names.
  const calendarEmployees = useMemo(
    () =>
      profiles.map((p) => ({
        id: p.id,
        name: p.display_name || p.email,
        branch: p.assigned_branch || "",
        status: p.is_active ? "active" : "inactive",
        role: p.role,
        startDate: hireDateByProfileId.get(p.id) || p.created_at?.slice(0, 10) || null,
        managerName: p.manager_name || null,
        offDays: p.off_days ?? null,
      })),
    [profiles, hireDateByProfileId]
  );

  // Keyed "profileId|date" (not just profileId) — a person can now appear
  // in several rows at once (one per absent day in the range), each with
  // its own independently editable note/status.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const handleSaveNote = async (profileId: string, noteDate: string) => {
    if (!companyId) return;
    const content = noteDraft;
    const key = `${profileId}|${noteDate}`;
    setSavingNoteId(key);
    try {
      await upsertAttendanceNote({
        profileId,
        noteDate,
        content,
        notifyIndividual: false,
        notifyTeamLead: false,
        createdBy: myProfileId,
        companyId,
      });
      setNotes((prev) => {
        const existing = prev.find((n) => n.profileId === profileId && n.noteDate === noteDate);
        return [
          ...prev.filter((n) => !(n.profileId === profileId && n.noteDate === noteDate)),
          {
            profileId,
            noteDate,
            content,
            hrNote: existing?.hrNote || "",
            notifyIndividual: false,
            notifyTeamLead: false,
            createdBy: myProfileId,
            attachmentPath: existing?.attachmentPath ?? null,
            attachmentAddedBy: existing?.attachmentAddedBy ?? null,
            attachmentAddedAt: existing?.attachmentAddedAt ?? null,
            attachmentRemovedBy: existing?.attachmentRemovedBy ?? null,
            attachmentRemovedAt: existing?.attachmentRemovedAt ?? null,
          },
        ];
      });
      setEditingId(null);
    } catch (err) {
      alert(`Failed to save note: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingNoteId(null);
    }
  };

  const [savingHrNoteId, setSavingHrNoteId] = useState<string | null>(null);
  const handleSaveHrStatus = async (profileId: string, noteDate: string, hrNote: string) => {
    const key = `${profileId}|${noteDate}`;
    setSavingHrNoteId(key);
    try {
      await upsertAttendanceHrNote(profileId, noteDate, hrNote, myProfileId, companyId);
      setNotes((prev) => {
        const existing = prev.find((n) => n.profileId === profileId && n.noteDate === noteDate);
        if (existing) return prev.map((n) => (n.profileId === profileId && n.noteDate === noteDate ? { ...n, hrNote, createdBy: myProfileId ?? n.createdBy } : n));
        return [...prev, { profileId, noteDate, content: "", hrNote, notifyIndividual: false, notifyTeamLead: false, createdBy: myProfileId, attachmentPath: null, attachmentAddedBy: null, attachmentAddedAt: null, attachmentRemovedBy: null, attachmentRemovedAt: null }];
      });
    } catch (err) {
      alert(`Failed to save HR status: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingHrNoteId(null);
    }
  };

  // Photo/file backing up an HR Status (e.g. a doctor's note) — shows up on
  // the Time Off Calendar's own orange-cell popup too (see
  // hrPlottedByProfile in HrCalendarTab.tsx), since both read/write the
  // same attendance_notes row.
  const [uploadingAttachmentId, setUploadingAttachmentId] = useState<string | null>(null);
  const handleAttachFile = async (profileId: string, noteDate: string, file: File) => {
    if (!companyId) return;
    const key = `${profileId}|${noteDate}`;
    setUploadingAttachmentId(key);
    try {
      const path = await uploadAttendanceNoteAttachment(profileId, noteDate, companyId, file, myProfileId);
      const now = new Date().toISOString();
      setNotes((prev) => {
        const existing = prev.find((n) => n.profileId === profileId && n.noteDate === noteDate);
        if (existing)
          return prev.map((n) =>
            n.profileId === profileId && n.noteDate === noteDate
              ? { ...n, attachmentPath: path, attachmentAddedBy: myProfileId, attachmentAddedAt: now, attachmentRemovedBy: null, attachmentRemovedAt: null }
              : n
          );
        return [
          ...prev,
          {
            profileId,
            noteDate,
            content: "",
            hrNote: "",
            notifyIndividual: false,
            notifyTeamLead: false,
            createdBy: myProfileId,
            attachmentPath: path,
            attachmentAddedBy: myProfileId,
            attachmentAddedAt: now,
            attachmentRemovedBy: null,
            attachmentRemovedAt: null,
          },
        ];
      });
    } catch (err) {
      alert(`Failed to attach file: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploadingAttachmentId(null);
    }
  };
  const [previewAttachmentUrl, setPreviewAttachmentUrl] = useState<string | null>(null);
  const handleViewAttachment = (attachmentPath: string) => {
    setPreviewAttachmentUrl(attachmentPath);
  };
  const handleRemoveAttachment = async (profileId: string, noteDate: string, attachmentPath: string) => {
    if (!confirm("Remove this attachment?")) return;
    const key = `${profileId}|${noteDate}`;
    setUploadingAttachmentId(key);
    try {
      await removeAttendanceNoteAttachment(profileId, noteDate, attachmentPath, myProfileId);
      const now = new Date().toISOString();
      setNotes((prev) =>
        prev.map((n) => (n.profileId === profileId && n.noteDate === noteDate ? { ...n, attachmentPath: null, attachmentRemovedBy: myProfileId, attachmentRemovedAt: now } : n))
      );
    } catch (err) {
      alert(`Failed to remove attachment: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploadingAttachmentId(null);
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

  const renderAbsentRow = ({ profile: p, date: rowDate, note, hrNote }: AbsentRow) => {
    const key = `${p.id}|${rowDate}`;
    const isEditing = editingId === key;
    return (
      <tr key={key} className="border-b border-white/5">
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
                  if (e.key === "Enter") void handleSaveNote(p.id, rowDate);
                  if (e.key === "Escape") setEditingId(null);
                }}
                placeholder="Why are they absent?"
                className="glass-input text-xs py-1"
              />
              <button
                type="button"
                onClick={() => void handleSaveNote(p.id, rowDate)}
                disabled={savingNoteId === key}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 shrink-0"
              >
                {savingNoteId === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingId(key);
                setNoteDraft(note);
              }}
              className="flex items-center gap-1.5 text-left text-slate-300 hover:text-white"
            >
              {note ? <span className="truncate max-w-[260px]">{note}</span> : <span className="text-slate-600">Add note</span>}
              <Pencil className="h-3 w-3 text-slate-500 shrink-0" />
            </button>
          )}
        </td>
        <td className="py-2 pr-3 min-w-[160px]">
          <div className="flex items-center gap-1.5">
            <select
              value={hrNote}
              onChange={(e) => void handleSaveHrStatus(p.id, rowDate, e.target.value)}
              disabled={savingHrNoteId === key}
              className={`glass-input text-xs py-1 disabled:opacity-50 ${HR_STATUS_COLOR[hrNote] || "text-slate-300"}`}
            >
              {/* Explicit dark background on every option — the dropdown
                  popup is browser chrome, not this page, so without it the
                  light status text renders on the browser's own near-white
                  popup and becomes nearly unreadable. */}
              <option value="" className="bg-slate-800 text-slate-400">—</option>
              {HR_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} className={`bg-slate-800 ${HR_STATUS_COLOR[s] || "text-slate-200"}`}>{s}</option>
              ))}
            </select>
            {savingHrNoteId === key && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500 shrink-0" />}
          </div>
          {hrNote && (() => {
            const addedById = noteByKey.get(key)?.createdBy;
            if (!addedById) return null;
            const addedByName = profiles.find((pr) => pr.id === addedById)?.display_name || profiles.find((pr) => pr.id === addedById)?.email;
            return addedByName ? <p className="mt-1 text-[10px] text-slate-500">Added by: {addedByName}</p> : null;
          })()}
        </td>
        <td className="py-2">
          <div className="flex items-center gap-1.5">
            <label
              title="Attach a photo/file (e.g. a doctor's note)"
              className="cursor-pointer text-slate-500 hover:text-slate-300 shrink-0"
            >
              {uploadingAttachmentId === key ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" />
              )}
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                disabled={uploadingAttachmentId === key}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleAttachFile(p.id, rowDate, file);
                }}
              />
            </label>
            {(() => {
              const attachmentPath = noteByKey.get(key)?.attachmentPath;
              if (!attachmentPath) return null;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => handleViewAttachment(attachmentPath)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 underline disabled:opacity-50 whitespace-nowrap"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    disabled={uploadingAttachmentId === key}
                    onClick={() => void handleRemoveAttachment(p.id, rowDate, attachmentPath)}
                    className="text-[10px] text-red-400 hover:text-red-300 underline disabled:opacity-50 whitespace-nowrap"
                  >
                    Remove
                  </button>
                </>
              );
            })()}
          </div>
          {(() => {
            const note = noteByKey.get(key);
            if (!note) return null;
            const nameOf = (id: string | null) => (id ? profiles.find((pr) => pr.id === id)?.display_name || profiles.find((pr) => pr.id === id)?.email : null);
            const addedByName = note.attachmentPath ? nameOf(note.attachmentAddedBy) : null;
            const removedByName = !note.attachmentPath ? nameOf(note.attachmentRemovedBy) : null;
            if (!addedByName && !removedByName) return null;
            return (
              <p className="mt-1 text-[10px] text-slate-500">
                {addedByName && `Added by: ${addedByName}`}
                {removedByName && `Removed by: ${removedByName}`}
              </p>
            );
          })()}
        </td>
      </tr>
    );
  };

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

        <div className="flex gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "list" ? "bg-primary/20 text-primary" : ""}`}
          >
            <ListChecks className="h-3.5 w-3.5" /> Absent List
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "calendar" ? "bg-primary/20 text-primary" : ""}`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Time Off Calendar
          </button>
          <button
            type="button"
            onClick={() => setView("ticketAttendance")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "ticketAttendance" ? "bg-primary/20 text-primary" : ""}`}
          >
            <ClipboardList className="h-3.5 w-3.5" /> Ticket Attendance
          </button>
        </div>

        {view === "calendar" && (
          <HrCalendarTab employees={calendarEmployees} myProfileId={myProfileId} myDisplayName={displayName} />
        )}

        {view === "ticketAttendance" && <TicketAttendanceTab />}

        {view === "list" && (
        <div className="panel">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-2">From</label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => setDateFrom(e.target.value)}
                className="glass-input"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-2">To</label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => setDateTo(e.target.value)}
                className="glass-input"
              />
            </div>
            <button
              type="button"
              onClick={() => { setDateFrom(todayISO()); setDateTo(todayISO()); }}
              className="btn text-sm py-1.5 mb-0.5"
            >
              Today
            </button>
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
                  <span className="text-red-300 font-semibold">{absentRows.length}</span> absent{rangeDates.length > 1 ? " (instances)" : ""}
                  {onLeaveCount > 0 && <span className="ml-2 text-slate-500">({onLeaveCount} on approved leave, not counted)</span>}
                </>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : absentRows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              No one is marked absent {dateFrom === dateTo ? `for ${dateFrom}` : `between ${dateFrom} and ${dateTo}`}.
            </p>
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
                    <th className="py-2 pr-3 relative">
                      {renderMultiSelectFilterHeader("hrNote", "HR Status", HR_STATUS_OPTIONS, hrStatusFilter, setHrStatusFilter)}
                    </th>
                    <th className="py-2">Attachment</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeDates.length > 1
                    ? groupedAbsentRows.map(([groupDate, rows]) => (
                        <Fragment key={groupDate}>
                          <tr className="bg-white/10 border-t-2 border-b border-blue-500/30">
                            <td colSpan={7} className="py-3 px-2 text-base font-bold text-blue-300 uppercase tracking-wide">
                              {groupDate} <span className="text-slate-400 font-normal normal-case text-sm">({rows.length})</span>
                            </td>
                          </tr>
                          {rows.map(renderAbsentRow)}
                        </Fragment>
                      ))
                    : absentRows.map(renderAbsentRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
      </div>
      {previewAttachmentUrl && (
        <AttachmentPreviewModal url={previewAttachmentUrl} title="HR Status attachment" onClose={() => setPreviewAttachmentUrl(null)} />
      )}
    </main>
  );
}
