/**
 * Employee Monitoring → Attendance Status. Every active employee for one
 * day, filterable by department and role, with a status derived from what's
 * already recorded — no manual step:
 *   Completed  — checked in and out (meal, if started, also ended)
 *   Missing    — no check-in / no check-out / meal not ended on a work day
 *   Pending    — a Time Correction or PTO / Sick / Unpaid request for that day awaiting approval
 *   On Leave   — approved PTO / Sick / Unpaid etc. covering the day
 *   Rest Day   — the employee's own scheduled day off (profiles.off_days)
 * A day HR edited directly (Payroll detail stamps timecard_entries.clocked_in_by
 * with the editor) shows "Corrected by: <name>"; an approved Time Correction
 * shows "Corrected via Time Correction".
 * Clicking a name opens that employee's last 14 days of punches.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid, getCompanyTimecardEntries, getEntryForDate, saveEntry, appendEntryNote, addDaysISO, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getCompanyTimecardCorrections, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { getCompanyPtoRequests, type PtoRequestRow, type PtoType } from "@/lib/supabase/pto";
import { getAttendanceNotes, upsertAttendanceNote, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { ROLE_LABELS, normalizeRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { correctionApproverId, autoClockOutInfo, AUTO_CLOCKOUT_REVIEWED_PREFIX } from "@/lib/attendanceStatusCode";
import { getTicketAttendanceForTechnician, type TicketAttendanceRow } from "@/lib/supabase/technicianWhereabouts";
import { getCompanyEmployeeRequests, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";

type StatusKind = "completed" | "corrected" | "review" | "missing" | "pending" | "leave" | "rest" | "working" | "upcoming";

interface DayStatus {
  kind: StatusKind;
  detail: string;
  correctedBy?: string;
  /** A manager clocked them in on their behalf (proxy clock-in) — not a correction. */
  clockedInBy?: string;
}

const HISTORY_DAYS = 14;

const PTO_LABEL: Record<PtoType, string> = {
  vacation: "PTO",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

const STATUS_LABEL: Record<StatusKind, string> = {
  completed: "Completed",
  corrected: "Corrected",
  review: "Pending for Review",
  missing: "Missing",
  pending: "Pending",
  leave: "On Leave",
  rest: "Rest Day",
  working: "Clocked In",
  upcoming: "—",
};

const STATUS_CLASS: Record<StatusKind, string> = {
  completed: "bg-green-500/20 text-green-300 border-green-500/40",
  corrected: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  review: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  missing: "bg-red-500/20 text-red-300 border-red-500/40",
  pending: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  leave: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  rest: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  working: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  upcoming: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const weekdayOf = (iso: string) => new Date(iso + "T00:00:00").getDay();

const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** "13:05" / "13:05:00" → "1:05 PM"; passes anything else through. */
function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return t || "—";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

function computeStatus(args: {
  profile: ProfileRow;
  date: string;
  today: string;
  entry: CompanyTimecardEntry | undefined;
  corrections: TimecardCorrectionRow[];
  ptos: PtoRequestRow[];
  nameOf: (id: string) => string;
}): DayStatus {
  const { profile, date, today, entry, corrections, ptos, nameOf } = args;
  if (date > today) return { kind: "upcoming", detail: "" };

  const pendingCorrection = corrections.find((c) => c.status === "pending");
  if (pendingCorrection) return { kind: "pending", detail: "Time Correction awaiting approval" };
  const pendingPto = ptos.find((r) => r.status === "pending");
  if (pendingPto) return { kind: "pending", detail: `${PTO_LABEL[pendingPto.ptoType]} leave · Pending approval` };

  // Who changed the day: HR editing it directly stamps clocked_in_by with the
  // editor; an approved Time Correction names whoever approved it last.
  const approvedCorrection = corrections.find((c) => c.status === "approved");
  const approverId = approvedCorrection ? correctionApproverId(approvedCorrection) : null;
  // Corrected = someone changed the times directly (corrected_by, migration 0331 —
  // counts even on HR's own timecard) or an approved Time Correction.
  // A manager's proxy clock-in (clocked_in_by) is only "Clocked in by".
  const correctedBy = entry?.correctedBy
    ? nameOf(entry.correctedBy)
    : approvedCorrection
    ? approverId
      ? nameOf(approverId)
      : "Time Correction"
    : undefined;
  const clockedInBy = entry?.clockedInBy && entry.clockedInBy !== profile.id ? nameOf(entry.clockedInBy) : undefined;

  if (entry?.checkIn && entry.checkOut) {
    if (entry.mealStart && !entry.mealEnd) return { kind: "missing", detail: "Meal end missing", correctedBy };
    if (!entry.mealStart && entry.mealEnd) return { kind: "missing", detail: "Meal start missing", correctedBy };
    if (correctedBy) return { kind: "corrected", detail: approvedCorrection && !entry.correctedBy ? "via Time Correction" : "", correctedBy, clockedInBy };
    // The system clocked them out — HR reviews it (Mark reviewed), or edits the times (→ Corrected).
    const auto = autoClockOutInfo(entry.notes);
    if (auto.auto && !auto.reviewedBy) return { kind: "review", detail: `Auto clock-out${auto.time ? ` at ${fmtTime(auto.time)}` : ""} — HR to review`, clockedInBy };
    if (auto.auto) return { kind: "completed", detail: `Auto clock-out reviewed by ${auto.reviewedBy}`, clockedInBy };
    return { kind: "completed", detail: "", clockedInBy };
  }

  const approvedPto = ptos.find((r) => r.status === "approved");
  if (approvedPto) return { kind: "leave", detail: `${PTO_LABEL[approvedPto.ptoType]} leave · Approved ✓` };

  if (entry?.checkIn) {
    if (date === today) return { kind: "working", detail: "No check-out yet", clockedInBy };
    return { kind: "missing", detail: "Check-out missing", correctedBy };
  }
  if (entry?.checkOut) return { kind: "missing", detail: "Check-in missing", correctedBy };

  const restDays = profile.off_days && profile.off_days.length > 0 ? profile.off_days : [0, 6];
  if (restDays.includes(weekdayOf(date))) return { kind: "rest", detail: "" };
  return { kind: "missing", detail: date === today ? "Not checked in yet" : "No check-in / check-out" };
}

export function EmployeeAttendanceStatusTab() {
  const { uid, role, extraRoles } = useAuth();
  // HR (and Admin/SuperAdmin) can fix punches straight from the name popup.
  const canEditPunches = [role, ...(extraRoles ?? [])].some((r) => ["HR", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"].includes(normalizeRole(r)));
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [draft, setDraft] = useState({ checkIn: "", mealStart: "", mealEnd: "", checkOut: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const today = todayISO();
  // End of the range; the single-day view is startDate === date.
  const [date, setDate] = useState(today);
  const [startDate, setStartDate] = useState(today);
  const isRange = startDate < date;
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  // Same attendance_notes rows the Absent List reads/writes — a note saved in either place shows in both.
  const [notes, setNotes] = useState<AttendanceNoteRow[]>([]);
  const [noteEditKey, setNoteEditKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKind | "">("");
  const [search, setSearch] = useState("");
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);

  // A range fetches exactly that range (the name popup shows it); a single
  // day also fetches the 13 days before it for the popup's history.
  const rangeStart = isRange ? startDate : addDaysISO(date, -(HISTORY_DAYS - 1));

  const load = async () => {
    setLoading(true);
    try {
      const [profileRows, composition, entryRows, correctionRows, ptoRows, myId, noteRows] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getCompanyTimecardEntries(rangeStart, date),
        getCompanyTimecardCorrections(),
        getCompanyPtoRequests(),
        uid ? getProfileIdByFirebaseUid(uid) : Promise.resolve(null),
        getAttendanceNotes(rangeStart, date),
      ]);
      setNotes(noteRows);
      setProfiles(profileRows);
      setCsrComposition(composition);
      setEntries(entryRows);
      setCorrections(correctionRows);
      setPtoRequests(ptoRows);
      setMyProfileId(myId);
    } catch (err) {
      console.error("EmployeeAttendanceStatusTab: load failed", err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, startDate, uid]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const nameOf = (id: string) => profileById.get(id)?.display_name || profileById.get(id)?.email || "Unknown";

  // Managers see their own team only; HR/Admin/Finance see everyone — same scoping as the other Employee Monitoring tabs.
  const myProfile = myProfileId ? profileById.get(myProfileId) ?? null : null;
  const teamScopedIds = useMemo(
    () => (myProfile ? visibleAttendanceProfileIds(myProfile, profiles, csrComposition) : null),
    [myProfile, profiles, csrComposition]
  );

  const entryByKey = useMemo(() => new Map(entries.map((e) => [`${e.profileId}|${e.workDate}`, e])), [entries]);
  const correctionsFor = (profileId: string, day: string) =>
    corrections.filter((c) => c.profileId === profileId && c.workDate === day && c.status !== "rejected");
  const ptosFor = (profileId: string, day: string) =>
    ptoRequests.filter((r) => r.profileId === profileId && r.startDate <= day && r.endDate >= day && (r.status === "pending" || r.status === "approved"));

  const statusFor = (p: ProfileRow, day: string) =>
    computeStatus({
      profile: p,
      date: day,
      today,
      entry: entryByKey.get(`${p.id}|${day}`),
      corrections: correctionsFor(p.id, day),
      ptos: ptosFor(p.id, day),
      nameOf,
    });

  const visibleProfiles = useMemo(
    () =>
      profiles
        .filter((p) => p.is_active && (teamScopedIds === null || teamScopedIds.has(p.id)))
        .sort((a, b) => (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "")),
    [profiles, teamScopedIds]
  );

  const departmentOf = (p: ProfileRow) => getRoleDepartmentBreakdown(p.role).department || "Other";
  const departments = useMemo(() => [...new Set(visibleProfiles.map(departmentOf))].sort(), [visibleProfiles]);
  const roles = useMemo(
    () =>
      [...new Set(visibleProfiles.filter((p) => !department || departmentOf(p) === department).map((p) => normalizeRole(p.role)))]
        .sort((a, b) => (ROLE_LABELS[a] ?? a).localeCompare(ROLE_LABELS[b] ?? b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleProfiles, department]
  );

  const rangeDays: string[] = [];
  if (isRange) for (let d = startDate; d <= date; d = addDaysISO(d, 1)) rangeDays.push(d);

  const rows = visibleProfiles
    .filter((p) => !department || departmentOf(p) === department)
    .filter((p) => !roleFilter || normalizeRole(p.role) === roleFilter)
    .filter((p) => {
      const q = search.trim().toLowerCase();
      return !q || (p.display_name || "").toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q);
    })
    .map((p) => {
      const status = statusFor(p, date);
      // Range: how many days of each status the employee had in it.
      const dayCounts: Partial<Record<StatusKind, number>> = {};
      if (isRange) {
        for (const day of rangeDays) {
          const k = statusFor(p, day).kind;
          dayCounts[k] = (dayCounts[k] ?? 0) + 1;
        }
      }
      return { profile: p, status, dayCounts };
    });

  const hasKind = (r: (typeof rows)[number], k: StatusKind) => (isRange ? (r.dayCounts[k] ?? 0) > 0 : r.status.kind === k);
  // Range: an employee counts toward a chip if any day in the range had that status.
  const counts = (["completed", "corrected", "review", "missing", "pending", "working", "leave", "rest"] as StatusKind[]).reduce<Record<string, number>>((acc, k) => {
    acc[k] = rows.filter((r) => hasKind(r, k)).length;
    return acc;
  }, {});
  const shownRows = statusFilter ? rows.filter((r) => hasKind(r, statusFilter)) : rows;

  // Newest first, from the end date back to the range start (or 14 days for a single day).
  const historyDays: string[] = [];
  for (let d = date; d >= rangeStart; d = addDaysISO(d, -1)) historyDays.push(d);

  const hhmm = (t: string | undefined) => (t ? t.slice(0, 5) : "");
  const startEdit = (day: string, e: CompanyTimecardEntry | undefined) => {
    setEditError(null);
    setEditingDay(day);
    setDraft({ checkIn: hhmm(e?.checkIn), mealStart: hhmm(e?.mealStart), mealEnd: hhmm(e?.mealEnd), checkOut: hhmm(e?.checkOut) });
  };
  const closeProfile = () => {
    setOpenProfileId(null);
    setEditingDay(null);
  };

  /** HR direct edit — stamped with the editor (clocked_in_by) so the day shows "Corrected by: <HR name>". Keeps the day's existing notes. */
  const saveEdit = async (profileId: string, day: string) => {
    if (!myProfileId) return;
    if (draft.checkIn && draft.checkOut && draft.checkOut <= draft.checkIn) {
      setEditError("Time Out must be after Time In.");
      return;
    }
    if ((draft.mealStart && !draft.mealEnd) || (!draft.mealStart && draft.mealEnd)) {
      setEditError("Fill in both Meal Start and Meal End, or leave both blank.");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const existing = await getEntryForDate(profileId, day);
      await saveEntry(profileId, day, { ...draft, notes: existing?.notes ?? "" }, { correctedBy: myProfileId });
      setEditingDay(null);
      setEntries(await getCompanyTimecardEntries(rangeStart, date));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingEdit(false);
    }
  };

  // Technicians: their scheduled tickets for the open person's days — the Date
  // cell lists them, and a worked day with none gets a "No tickets" flag (same
  // idea as Ticket Attendance).
  const isTechnician = (p: ProfileRow) =>
    getRoleDepartmentBreakdown(p.role).department === "Technician" || normalizeRole(p.role).startsWith("TECHNICIAN");
  const [ticketsFor, setTicketsFor] = useState<{ profileId: string; loading: boolean; rows: TicketAttendanceRow[] } | null>(null);
  const [openTicketDay, setOpenTicketDay] = useState<string | null>(null);
  // The open technician's Ticket Time Disputes — a ticket with no Work Start but a
  // dispute still awaiting approval counts as Pending, not Missing.
  const [ticketDisputes, setTicketDisputes] = useState<EmployeeRequestRow[]>([]);
  const pendingDisputeFor = (ticketNo: string) =>
    ticketDisputes.find((d) => d.status === "pending" && (d.ticketNo || "").trim().toUpperCase() === ticketNo.trim().toUpperCase()) ?? null;
  /** Tickets with no on-site Work Start (cancelled tickets don't count), split by whether a dispute is pending. */
  const ticketGaps = (rows: TicketAttendanceRow[]) => {
    const noStart = rows.filter((t) => !t.arrivedAt && t.statusGroup !== "cancelled");
    const pending = noStart.filter((t) => pendingDisputeFor(t.ticketNo));
    return { missing: noStart.length - pending.length, pending: pending.length };
  };
  useEffect(() => {
    setOpenTicketDay(null);
    const prof = openProfileId ? profileById.get(openProfileId) : null;
    if (!prof || !isTechnician(prof) || !prof.display_name) {
      setTicketsFor(null);
      return;
    }
    let cancelled = false;
    setTicketsFor({ profileId: prof.id, loading: true, rows: [] });
    getTicketAttendanceForTechnician(prof.display_name, rangeStart, date)
      .then((rows) => !cancelled && setTicketsFor({ profileId: prof.id, loading: false, rows }))
      .catch(() => !cancelled && setTicketsFor({ profileId: prof.id, loading: false, rows: [] }));
    getCompanyEmployeeRequests()
      .then((reqs) => !cancelled && setTicketDisputes(reqs.filter((r) => r.requestType === "ticket_time_dispute" && r.profileId === prof.id)))
      .catch(() => !cancelled && setTicketDisputes([]));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openProfileId, rangeStart, date, profiles]);
  const ticketsOn = (profileId: string, day: string) =>
    ticketsFor && ticketsFor.profileId === profileId && !ticketsFor.loading ? ticketsFor.rows.filter((t) => t.scheduleDate === day) : null;
  const fmtStamp = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");

  const noteByKey = useMemo(() => new Map(notes.map((n) => [`${n.profileId}|${n.noteDate}`, n])), [notes]);

  const saveNote = async (profileId: string, day: string) => {
    const key = `${profileId}|${day}`;
    const existing = noteByKey.get(key);
    setSavingNote(true);
    try {
      await upsertAttendanceNote({
        profileId,
        noteDate: day,
        content: noteDraft.trim(),
        notifyIndividual: existing?.notifyIndividual ?? false,
        notifyTeamLead: existing?.notifyTeamLead ?? false,
        createdBy: myProfileId,
      });
      setNotes(await getAttendanceNotes(rangeStart, date));
      setNoteEditKey(null);
    } catch (err) {
      alert(`Failed to save note: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingNote(false);
    }
  };

  const notesCell = (profileId: string, day: string) => {
    const key = `${profileId}|${day}`;
    const n = noteByKey.get(key);
    if (noteEditKey === key) {
      return (
        <div className="flex items-start gap-1 min-w-[220px]">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Add a note…"
            className="glass-input text-xs py-1 px-1.5 rounded flex-1 min-w-0 resize-y"
          />
          <button type="button" onClick={() => saveNote(profileId, day)} disabled={savingNote} title="Save note" className="p-1.5 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
            {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={() => setNoteEditKey(null)} disabled={savingNote} title="Cancel" className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-1.5 min-w-[160px] max-w-[320px]">
        <div className="flex-1 min-w-0 space-y-0.5">
          {n?.hrNote && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-violet-500/15 text-violet-300 border-violet-500/30">HR: {n.hrNote}</span>
          )}
          {n?.content ? (
            <div className="text-xs text-slate-300 whitespace-pre-wrap break-words">{n.content}</div>
          ) : !n?.hrNote ? (
            <span className="text-xs text-slate-600">—</span>
          ) : null}
          {n?.attachmentPath && (
            <a href={n.attachmentPath} target="_blank" rel="noreferrer noopener" className="block text-[11px] text-blue-300 hover:underline">Attachment</a>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setNoteEditKey(key); setNoteDraft(n?.content ?? ""); }}
          title={n?.content ? "Edit note" : "Add note"}
          className="shrink-0 p-1 rounded hover:bg-white/10 text-slate-500 hover:text-white"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  };

  const [reviewingKey, setReviewingKey] = useState<string | null>(null);
  /** HR marks a system auto clock-out as reviewed (times kept as-is) — appends a line to the day's notes. */
  const markReviewed = async (profileId: string, day: string) => {
    const key = `${profileId}|${day}`;
    setReviewingKey(key);
    try {
      const me = myProfileId ? nameOf(myProfileId) : "HR";
      await appendEntryNote(profileId, day, `${AUTO_CLOCKOUT_REVIEWED_PREFIX}${me}]`);
      setEntries(await getCompanyTimecardEntries(rangeStart, date));
    } catch (err) {
      alert(`Failed to mark reviewed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setReviewingKey(null);
    }
  };
  const reviewButton = (profileId: string, s: DayStatus, day: string) =>
    canEditPunches && s.kind === "review" ? (
      <button
        type="button"
        onClick={() => markReviewed(profileId, day)}
        disabled={reviewingKey === `${profileId}|${day}`}
        title="Keep the system's Time Out and mark this day reviewed. To change the time instead, use the pencil."
        className="mt-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-orange-600/80 hover:bg-orange-600 text-white disabled:opacity-50"
      >
        {reviewingKey === `${profileId}|${day}` ? "Saving…" : "Mark reviewed"}
      </button>
    ) : null;

  const statusBadge = (s: DayStatus) => (
    <div className="flex flex-col items-start gap-0.5">
      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${STATUS_CLASS[s.kind]}`}>{STATUS_LABEL[s.kind]}</span>
      {s.detail && <span className="text-[11px] text-slate-400">{s.detail}</span>}
      {s.correctedBy && <span className="text-[11px] text-violet-300">Corrected by: {s.correctedBy}</span>}
      {s.clockedInBy && <span className="text-[11px] text-sky-300">Clocked in by: {s.clockedInBy}</span>}
    </div>
  );

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date Range</label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => { setStartDate((d) => addDaysISO(d, -1)); setDate((d) => addDaysISO(d, -1)); }} className="btn px-2 py-1.5" aria-label="Previous day" title="Shift back a day">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={startDate}
              max={today}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setStartDate(v);
                if (v > date) setDate(v);
              }}
              style={{ width: "9.5rem", flex: "0 0 9.5rem" }}
              className="glass-input text-sm py-1 px-2 rounded-md [color-scheme:dark]"
              aria-label="From"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={date}
              min={startDate}
              max={today}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setDate(v);
                if (v < startDate) setStartDate(v);
              }}
              style={{ width: "9.5rem", flex: "0 0 9.5rem" }}
              className="glass-input text-sm py-1 px-2 rounded-md [color-scheme:dark]"
              aria-label="To"
            />
            <button type="button" onClick={() => { setStartDate((d) => addDaysISO(d, 1)); setDate((d) => addDaysISO(d, 1)); }} disabled={date >= today} className="btn px-2 py-1.5 disabled:opacity-40" aria-label="Next day" title="Shift forward a day">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => { setStartDate(today); setDate(today); }} className={`btn text-xs px-2 py-1.5 ${!isRange && date === today ? "bg-primary/20 text-primary" : ""}`}>Today</button>
            <button type="button" onClick={() => { setStartDate(addDaysISO(today, -6)); setDate(today); }} className="btn text-xs px-2 py-1.5">Last 7 days</button>
            <button type="button" onClick={() => { setStartDate(today.slice(0, 8) + "01"); setDate(today); }} className="btn text-xs px-2 py-1.5">This month</button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Department</label>
          <select value={department} onChange={(e) => { setDepartment(e.target.value); setRoleFilter(""); }} className="glass-input text-sm py-1.5 px-2.5 rounded-md min-w-[150px]">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Role</label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="glass-input text-sm py-1.5 px-2.5 rounded-md min-w-[170px]">
            <option value="">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Employee name…" className="glass-input text-sm py-1.5 px-2.5 rounded-md w-52" />
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([["", "All", rows.length], ...(["completed", "corrected", "review", "missing", "pending", "working", "leave", "rest"] as StatusKind[]).map((k) => [k, isRange ? `Had ${STATUS_LABEL[k]}` : STATUS_LABEL[k], counts[k] ?? 0])] as [StatusKind | "", string, number][]).map(([key, label, n]) => (
          <button
            key={key || "all"}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition ${statusFilter === key ? "bg-primary/20 text-primary border-primary/40" : "border-white/10 text-slate-300 hover:bg-white/5"}`}
          >
            {label} <span className="ml-1 tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-slate-400">
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">{isRange ? `Days — ${fmtDay(startDate)} to ${fmtDay(date)}` : `Status — ${fmtDay(date)}`}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : shownRows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No employees match these filters.</td></tr>
            ) : shownRows.map(({ profile: p, status, dayCounts }) => {
              const expanded = openProfileId === p.id;
              return (
              <Fragment key={p.id}>
              <tr className={`border-b border-white/5 hover:bg-white/5 align-top ${expanded ? "bg-white/5" : ""}`}>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => (expanded ? closeProfile() : (setEditingDay(null), setOpenProfileId(p.id)))}
                    aria-expanded={expanded}
                    className="text-blue-400 hover:text-blue-300 hover:underline font-medium text-left inline-flex items-center gap-1"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
                    {p.display_name || p.email}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-slate-300">{departmentOf(p)}</td>
                <td className="px-3 py-2.5 text-slate-300">{ROLE_LABELS[normalizeRole(p.role)] ?? p.role}</td>
                <td className="px-3 py-2.5 text-slate-300">{p.assigned_branch || "—"}</td>
                <td className="px-3 py-2.5">
                  {isRange ? (
                    <div className="flex flex-wrap gap-1">
                      {(["completed", "corrected", "review", "missing", "pending", "working", "leave", "rest"] as StatusKind[]).filter((k) => dayCounts[k]).map((k) => (
                        <span key={k} className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${STATUS_CLASS[k]}`}>
                          {STATUS_LABEL[k]} <span className="tabular-nums">{dayCounts[k]}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <>
                      {statusBadge(status)}
                      {reviewButton(p.id, status, date)}
                    </>
                  )}
                </td>
              </tr>
              {expanded && (
                <tr className="border-b border-white/10 bg-slate-950/40">
                  <td colSpan={5} className="px-3 pb-3 pt-1">
                    <div className="text-[11px] text-slate-400 mb-1 pl-5">
                      {isRange ? `${fmtDay(startDate)} to ${fmtDay(date)}` : `Last ${HISTORY_DAYS} days to ${fmtDay(date)}`}
                    </div>
                    <div className="ml-5 overflow-x-auto rounded border border-white/10">
                    <table className="w-full text-sm">
                      <thead className="bg-white/5">
                        <tr className="border-b border-white/10 text-left text-xs uppercase text-slate-400">
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Time In</th>
                          <th className="px-3 py-2">Meal Start</th>
                          <th className="px-3 py-2">Meal End</th>
                          <th className="px-3 py-2">Time Out</th>
                          <th className="px-3 py-2">Status</th><th className="px-3 py-2">Notes</th>
                          {canEditPunches && <th className="px-3 py-2"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {historyDays.map((day) => {
                          const e = entryByKey.get(`${p.id}|${day}`);
                          if (editingDay === day) {
                            const timeInput = (field: keyof typeof draft) => (
                              <input
                                type="time"
                                value={draft[field]}
                                onChange={(ev) => setDraft((d) => ({ ...d, [field]: ev.target.value }))}
                                className="glass-input text-xs py-1 px-1.5 rounded [color-scheme:dark] w-[110px]"
                              />
                            );
                            return (
                              <tr key={day} className="border-b border-white/5 align-top bg-violet-500/5">
                                <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{fmtDay(day)}</td>
                                <td className="px-2 py-1.5">{timeInput("checkIn")}</td>
                                <td className="px-2 py-1.5">{timeInput("mealStart")}</td>
                                <td className="px-2 py-1.5">{timeInput("mealEnd")}</td>
                                <td className="px-2 py-1.5">{timeInput("checkOut")}</td>
                                <td className="px-3 py-2 text-[11px] text-rose-300">{editError}</td><td className="px-3 py-2">{notesCell(p.id, day)}</td>
                                <td className="px-2 py-1.5 whitespace-nowrap">
                                  <button type="button" onClick={() => saveEdit(p.id, day)} disabled={savingEdit} title="Save" className="p-1.5 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 mr-1">
                                    {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                  </button>
                                  <button type="button" onClick={() => setEditingDay(null)} disabled={savingEdit} title="Cancel" className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-200">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          }
                          const tech = isTechnician(p);
                          const dayTickets = tech ? ticketsOn(p.id, day) : null;
                          const dayStatus = statusFor(p, day);
                          const worked = ["completed", "corrected", "review", "working"].includes(dayStatus.kind);
                          const ticketOpen = openTicketDay === day;
                          return (
                            <Fragment key={day}>
                            <tr className={`border-b border-white/5 align-top ${day === date ? "bg-primary/5" : ""} ${ticketOpen ? "bg-white/5" : ""}`}>
                              <td className="px-3 py-2 text-slate-200 whitespace-nowrap">
                                {tech ? (
                                  <button
                                    type="button"
                                    onClick={() => setOpenTicketDay(ticketOpen ? null : day)}
                                    title="Show this day's tickets"
                                    className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline"
                                  >
                                    <ChevronRight className={`h-3 w-3 transition-transform ${ticketOpen ? "rotate-90" : ""}`} />
                                    {fmtDay(day)}
                                    {dayTickets && dayTickets.length > 0 && <span className="ml-1 text-[10px] text-slate-400">({dayTickets.length})</span>}
                                  </button>
                                ) : (
                                  fmtDay(day)
                                )}
                              </td>
                              <td className="px-3 py-2 tabular-nums text-slate-200">{e?.checkIn ? fmtTime(e.checkIn) : "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-300">{e?.mealStart ? fmtTime(e.mealStart) : "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-300">{e?.mealEnd ? fmtTime(e.mealEnd) : "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-200">{e?.checkOut ? fmtTime(e.checkOut) : "—"}</td>
                              <td className="px-3 py-2">
                                {statusBadge(dayStatus)}
                                {worked && dayTickets && dayTickets.length === 0 && (
                                  <span className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-rose-500/15 text-rose-300 border-rose-500/30" title="Clocked in this day but had no scheduled tickets">
                                    No tickets
                                  </span>
                                )}
                                {worked && dayTickets && dayTickets.length > 0 && (() => {
                                  const gaps = ticketGaps(dayTickets);
                                  return (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {gaps.missing > 0 && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-rose-500/15 text-rose-300 border-rose-500/30" title="Tickets with no on-site Work Start and no dispute filed">
                                          Missing {gaps.missing} ticket{gaps.missing === 1 ? "" : "s"}
                                        </span>
                                      )}
                                      {gaps.pending > 0 && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-500/15 text-amber-300 border-amber-500/30" title="Tickets with no Work Start that have a Ticket Time Dispute awaiting approval">
                                          Pending {gaps.pending} ticket{gaps.pending === 1 ? "" : "s"}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                                {reviewButton(p.id, dayStatus, day)}
                              </td><td className="px-3 py-2">{notesCell(p.id, day)}</td>
                              {canEditPunches && (
                                <td className="px-2 py-2">
                                  {day <= today && (
                                    <button type="button" onClick={() => startEdit(day, e)} disabled={editingDay !== null} title="Edit times" className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white disabled:opacity-30">
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                            {ticketOpen && (
                              <tr className="border-b border-white/5 bg-slate-950/60">
                                <td colSpan={canEditPunches ? 8 : 7} className="px-3 py-2 pl-8">
                                  {ticketsFor?.loading ? (
                                    <span className="text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />Loading tickets…</span>
                                  ) : !dayTickets || dayTickets.length === 0 ? (
                                    <span className="text-xs text-slate-400">No tickets scheduled for {fmtDay(day)}.</span>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-left text-[10px] uppercase text-slate-500">
                                          <th className="px-2 py-1">Ticket #</th>
                                          <th className="px-2 py-1">Status</th>
                                          <th className="px-2 py-1">Time Slot</th>
                                          <th className="px-2 py-1">Work Start</th>
                                          <th className="px-2 py-1">Work Done</th>
                                          <th className="px-2 py-1">Address</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {dayTickets.map((t) => (
                                          <tr key={t.ticketId} className="border-t border-white/5">
                                            <td className="px-2 py-1">
                                              <a href={`/ticket/${encodeURIComponent(t.ticketNo)}`} target="_blank" rel="noreferrer" className="text-blue-300 hover:underline font-medium">{t.ticketNo}</a>
                                            </td>
                                            <td className="px-2 py-1 text-slate-300">{t.status || "—"}</td>
                                            <td className="px-2 py-1 text-slate-300">{t.timeSlot || "—"}</td>
                                            <td className={`px-2 py-1 tabular-nums ${t.arrivedAt ? "text-slate-200" : t.statusGroup === "cancelled" ? "text-slate-500" : pendingDisputeFor(t.ticketNo) ? "text-amber-300" : "text-rose-300"}`}>
                                              {t.arrivedAt ? fmtStamp(t.arrivedAt) : t.statusGroup === "cancelled" ? "—" : pendingDisputeFor(t.ticketNo) ? "Dispute pending" : "No check-in"}
                                            </td>
                                            <td className={`px-2 py-1 tabular-nums ${t.doneAt ? "text-slate-200" : "text-slate-500"}`}>{fmtStamp(t.doneAt)}</td>
                                            <td className="px-2 py-1 text-slate-400">{t.address || "—"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
