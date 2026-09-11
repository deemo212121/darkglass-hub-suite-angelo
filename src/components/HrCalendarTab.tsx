/**
 * HR Dashboard "Time Off Calendar" tab — a branch-grouped, day-by-day PTO/time-off
 * tracker modeled on the team's existing CSR Tracker spreadsheet (rows =
 * technician grouped by branch, columns = individual days spanning a couple
 * of months, colored cells mark time off). Cell color reflects approval
 * status — green once approved, yellow while still pending (denied/
 * cancelled requests never populate a cell at all, see cellsByProfile),
 * orange when HR set a matching HR Status on the Absent List page for that
 * (person, day) but no formal pto_requests entry exists yet (see
 * hrPlottedByProfile) — with a single letter (V/S/P/H/U/B, see
 * PTO_TYPE_LETTER) marking which leave type it is.
 *
 * Editable directly from the grid: click any cell — an empty one opens an
 * "Add time off" form for that employee/date, a filled one opens a detail
 * view (type, status, dates, reason, notice given) with Edit/Cancel. Uses
 * createPtoRequest/updatePtoRequest/updatePtoRequestStatus from pto.ts, so
 * writes land in the same pto_requests table the Attendance Monitoring "PTO
 * Management" tab already reviews — entries created here still start
 * `pending` and go through the normal approval chain, this just gives HR a
 * fast way to log one directly against a date instead of filling out the
 * full request form.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Search, X, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getCompanyPtoRequests,
  createPtoRequest,
  updatePtoRequest,
  updatePtoRequestStatus,
  ptoYearWindow,
  ptoDaysUsed,
  sickYearWindow,
  sickDaysUsed,
  reviewPtoStage,
  canReviewPtoStage,
  uploadPtoAttachment,
  getPtoAttachmentUrl,
  type PtoRequestRow,
  type PtoType,
  type PtoStage,
} from "@/lib/supabase/pto";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { getAttendanceNotes, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";

export interface CalendarEmployee {
  id: string;
  name: string;
  branch: string;
  status: string;
  role: string;
  /** Hire date ("YYYY-MM-DD") — drives the Sick Leave/Vacation PTO badges next to each name, same ptoYearWindow/sickYearWindow tenure logic Master List uses. Null/missing just hides those badges for that person. */
  startDate?: string | null;
  /** profiles.manager_name — feeds canReviewPtoStage's "requester's CURRENT manager" fallback (the PTO request's own managerId is a one-time snapshot from submission, see that function's comment). */
  managerName?: string | null;
}

interface Props {
  employees: CalendarEmployee[];
  myProfileId: string | null;
  myDisplayName: string | null;
}

type CellColor = "approved" | "pending" | "hrPlotted";

// Absent List's HR Status dropdown (AbsentListPage.tsx's HR_STATUS_OPTIONS)
// shares these 6 leave-type values with PTO_TYPE_LABELS below — when HR
// sets one of them for a (person, day) with no formal pto_requests entry
// covering that date, it still shows up here as an orange cell (see
// hrPlottedByProfile) so the two "who's out" tools never disagree. The
// other 3 HR Status options (Unnoticed/Resigned/Terminated) aren't leave
// types and never populate a cell.
const HR_STATUS_TO_PTO_TYPE: Partial<Record<string, PtoType>> = {
  Vacation: "vacation",
  Sick: "sick",
  Personal: "personal",
  Holiday: "holiday",
  Unpaid: "unpaid",
  Bereavement: "bereavement",
};

// Thursday gets "Th" (not "T") so it's distinct from Tuesday in this narrow column header.
const DOW_LABELS = ["S", "M", "T", "W", "Th", "F", "S"];

const PTO_TYPE_LABELS: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};
const PTO_TYPES = Object.keys(PTO_TYPE_LABELS) as PtoType[];
// Single-letter code shown on each colored calendar cell, since the cell
// itself is too small for a label — cell color already conveys notice
// (planned/late), this conveys which type of leave it is.
const PTO_TYPE_LETTER: Record<PtoType, string> = {
  vacation: "V",
  sick: "S",
  personal: "P",
  holiday: "H",
  unpaid: "U",
  bereavement: "B",
};

function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function toDateOnly(iso: string): string {
  return (iso || "").slice(0, 10);
}

/** Whole days between two "YYYY-MM-DD" strings (b - a). */
function daysBetween(a: string, b: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / MS_PER_DAY);
}

function nextDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function colorForRequest(r: PtoRequestRow): CellColor {
  return r.status === "approved" ? "approved" : "pending";
}

const STATUS_BADGE: Record<PtoRequestRow["status"], string> = {
  pending: "bg-yellow-500/15 text-yellow-300 border-yellow-500/25",
  approved: "bg-green-500/15 text-green-300 border-green-500/25",
  denied: "bg-red-500/15 text-red-300 border-red-500/25",
  cancelled: "bg-white/10 text-muted-foreground border-white/15",
};

interface CellModalState {
  mode: "create" | "view" | "edit";
  employee: CalendarEmployee;
  date: string;
  request?: PtoRequestRow;
}

export function HrCalendarTab({ employees, myProfileId, myDisplayName }: Props) {
  const { role, extraRoles, companyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<PtoRequestRow[]>([]);
  const [monthOffset, setMonthOffset] = useState(0);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<PtoType | "all">("all");
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  const [modal, setModal] = useState<CellModalState | null>(null);
  const [formType, setFormType] = useState<PtoType>("vacation");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formReason, setFormReason] = useState("");
  // Optional photo attached to a request (e.g. a doctor's note) — uploaded
  // right after the request itself is created/saved, since the upload path
  // needs a real request id (see uploadPtoAttachment).
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachmentUrlLoading, setAttachmentUrlLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async (): Promise<PtoRequestRow[]> => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getCompanyPtoRequests();
      setRequests(rows);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load time-off requests.");
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Two-month rolling window, same span the reference tracker shows —
  // Prev/Next slides it a month at a time, Today snaps back.
  const months = useMemo(() => {
    const base = addMonths(new Date(), monthOffset);
    return [base, addMonths(base, 1)];
  }, [monthOffset]);

  const days = useMemo(() => {
    const out: { date: string; day: number; dow: string; monthLabel: string }[] = [];
    for (const m of months) {
      const count = daysInMonth(m.getFullYear(), m.getMonth());
      for (let day = 1; day <= count; day++) {
        const dt = new Date(m.getFullYear(), m.getMonth(), day);
        out.push({
          date: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          day,
          dow: DOW_LABELS[dt.getDay()],
          monthLabel: m.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        });
      }
    }
    return out;
  }, [months]);

  // profileId -> Map<date, request> — only requests matching the active
  // type filter are included, so a filtered-out request behaves like an
  // empty cell (colorless, clicking it opens "Add time off" rather than
  // showing a request the filter is hiding).
  const cellsByProfile = useMemo(() => {
    const map = new Map<string, Map<string, PtoRequestRow>>();
    for (const r of requests) {
      if (r.status !== "approved" && r.status !== "pending") continue;
      if (!r.startDate || !r.endDate) continue;
      if (typeFilter !== "all" && r.ptoType !== typeFilter) continue;
      let byDate = map.get(r.profileId);
      if (!byDate) {
        byDate = new Map();
        map.set(r.profileId, byDate);
      }
      for (let cur = r.startDate; cur <= r.endDate; cur = nextDate(cur)) {
        byDate.set(cur, r);
      }
    }
    return map;
  }, [requests, typeFilter]);

  // Absent List's HR Status (attendance_notes.hr_note) for whichever
  // (person, day) cells fall inside the visible 2-month window — the
  // "orange = HR plotted this, no formal request on file" signal. Only
  // fetches the visible range, not every attendance note ever, same reason
  // requests above isn't range-scoped (that one needs the full history for
  // the allowance badges; this one only ever needs what's on screen).
  const [hrStatusNotes, setHrStatusNotes] = useState<AttendanceNoteRow[]>([]);
  useEffect(() => {
    if (days.length === 0) return;
    let cancelled = false;
    getAttendanceNotes(days[0].date, days[days.length - 1].date)
      .then((rows) => { if (!cancelled) setHrStatusNotes(rows); })
      .catch((err) => console.error("Failed to load HR Status for Time Off Calendar:", err));
    return () => { cancelled = true; };
  }, [days]);

  // profileId -> Map<date, {type, addedBy}> — only cells with NO formal
  // pto_requests entry get an orange fallback here; a real request (green/
  // yellow) always wins if one exists for that date, so the two never
  // visually conflict. addedBy (attendance_notes.created_by) drives the
  // "Added by: {name}" line shown when opening one of these cells.
  const hrPlottedByProfile = useMemo(() => {
    const map = new Map<string, Map<string, { type: PtoType; addedBy: string | null }>>();
    for (const n of hrStatusNotes) {
      const type = HR_STATUS_TO_PTO_TYPE[n.hrNote];
      if (!type) continue;
      if (typeFilter !== "all" && type !== typeFilter) continue;
      if (cellsByProfile.get(n.profileId)?.has(n.noteDate)) continue;
      let byDate = map.get(n.profileId);
      if (!byDate) {
        byDate = new Map();
        map.set(n.profileId, byDate);
      }
      byDate.set(n.noteDate, { type, addedBy: n.createdBy });
    }
    return map;
  }, [hrStatusNotes, cellsByProfile, typeFilter]);

  // Wider, separate fetch just for the PTO/Sick balance badges below — those
  // need a full tenure-year's worth of HR-plotted days (an employee's
  // allowance window can start anywhere in the past year, same reason
  // requests below loads every request ever rather than just what's on
  // screen), not just the visible 2-month grid hrStatusNotes covers. Fixed
  // ~14-month lookback plus a short forward buffer — a bounded window
  // rather than truly unbounded, since attendance_notes is a much
  // higher-volume table than pto_requests.
  const balanceNotesRange = useMemo(() => {
    const start = addMonths(new Date(), -14);
    const endBase = addMonths(new Date(), 1);
    const endCount = daysInMonth(endBase.getFullYear(), endBase.getMonth());
    return {
      start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`,
      end: `${endBase.getFullYear()}-${String(endBase.getMonth() + 1).padStart(2, "0")}-${String(endCount).padStart(2, "0")}`,
    };
  }, []);
  const [hrBalanceNotes, setHrBalanceNotes] = useState<AttendanceNoteRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    getAttendanceNotes(balanceNotesRange.start, balanceNotesRange.end)
      .then((rows) => { if (!cancelled) setHrBalanceNotes(rows); })
      .catch((err) => console.error("Failed to load HR Status history for PTO/Sick balances:", err));
    return () => { cancelled = true; };
  }, [balanceNotesRange]);

  // profileId -> synthetic "requests" (one per HR-plotted day, 8 hours =
  // one day, always "approved" — HR recording it already IS the approval)
  // fed into ptoDaysUsed/sickDaysUsed below alongside the real requests, so
  // a day HR marked via Absent List actually draws against the employee's
  // official balance instead of silently not counting. Same real-request
  // exclusion cellsByProfile-based dedup as hrPlottedByProfile above, so a
  // date already covered by a formal request is never counted twice.
  const hrPlottedDaysForBalance = useMemo(() => {
    const map = new Map<string, { ptoType: PtoType; status: "approved"; startDate: string; hoursRequested: number }[]>();
    for (const n of hrBalanceNotes) {
      const type = HR_STATUS_TO_PTO_TYPE[n.hrNote];
      if (!type) continue;
      if (cellsByProfile.get(n.profileId)?.has(n.noteDate)) continue;
      const arr = map.get(n.profileId) ?? [];
      arr.push({ ptoType: type, status: "approved", startDate: n.noteDate, hoursRequested: 8 });
      map.set(n.profileId, arr);
    }
    return map;
  }, [hrBalanceNotes, cellsByProfile]);

  // Sick Leave / Vacation PTO badges next to each name — same
  // ptoYearWindow/sickYearWindow tenure math and remaining-vs-allowance
  // shape Master List's own Sick Leave/Vacation Leave columns use, so the
  // numbers always agree with what HR sees there. Uses every request ever
  // made (not just what's on screen in the current 2-month window), since
  // the allowance year rarely lines up with the visible months.
  const requestsByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of requests) {
      const arr = map.get(r.profileId);
      if (arr) arr.push(r);
      else map.set(r.profileId, [r]);
    }
    return map;
  }, [requests]);
  const remainingPtoByProfile = useMemo(() => {
    const map = new Map<string, { remaining: number; allowance: number } | null>();
    for (const e of employees) {
      const window = ptoYearWindow(e.startDate, null);
      if (!window) {
        map.set(e.id, null);
        continue;
      }
      const combined = [...(requestsByProfile.get(e.id) ?? []), ...(hrPlottedDaysForBalance.get(e.id) ?? [])];
      const used = ptoDaysUsed(combined, window);
      map.set(e.id, { remaining: Math.max(0, window.allowance - used), allowance: window.allowance });
    }
    return map;
  }, [employees, requestsByProfile, hrPlottedDaysForBalance]);
  const remainingSickByProfile = useMemo(() => {
    const map = new Map<string, { remaining: number; allowance: number } | null>();
    for (const e of employees) {
      const window = sickYearWindow(e.startDate, null);
      if (!window) {
        map.set(e.id, null);
        continue;
      }
      const combined = [...(requestsByProfile.get(e.id) ?? []), ...(hrPlottedDaysForBalance.get(e.id) ?? [])];
      const used = sickDaysUsed(combined, window);
      map.set(e.id, { remaining: Math.max(0, window.allowance - used), allowance: window.allowance });
    }
    return map;
  }, [employees, requestsByProfile, hrPlottedDaysForBalance]);

  const availableRoles = useMemo(() => {
    const set = new Set(employees.filter((e) => e.status === "active").map((e) => e.role));
    return [...set].sort((a, b) => (ROLE_LABELS[normalizeRole(a)] ?? a).localeCompare(ROLE_LABELS[normalizeRole(b)] ?? b));
  }, [employees]);

  const toggleRole = (role: string) => {
    setRoleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const branchGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<string, CalendarEmployee[]>();
    for (const e of employees) {
      if (e.status !== "active") continue;
      if (roleFilter.size > 0 && !roleFilter.has(e.role)) continue;
      if (q && !e.name.toLowerCase().includes(q)) continue;
      const key = e.branch || "Unassigned";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([branch, emps]) => [branch, [...emps].sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [employees, roleFilter, search]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const openCell = (employee: CalendarEmployee, date: string) => {
    const request = cellsByProfile.get(employee.id)?.get(date);
    setFormError(null);
    setAttachFile(null);
    if (request) {
      setModal({ mode: "view", employee, date, request });
    } else {
      // Pre-select the leave type HR already plotted via Absent List, if
      // any, so formalizing an orange cell into a real request is one less
      // click.
      setFormType(hrPlottedByProfile.get(employee.id)?.get(date)?.type ?? "vacation");
      setFormStart(date);
      setFormEnd(date);
      setFormReason("");
      setModal({ mode: "create", employee, date });
    }
  };

  const startEdit = () => {
    if (!modal?.request) return;
    setFormType(modal.request.ptoType);
    setFormStart(modal.request.startDate);
    setFormEnd(modal.request.endDate);
    setFormReason(modal.request.reason);
    setFormError(null);
    setAttachFile(null);
    setModal({ ...modal, mode: "edit" });
  };

  const closeModal = () => {
    setModal(null);
    setFormError(null);
    setAttachFile(null);
  };

  const handleCreate = async () => {
    if (!modal) return;
    if (!formStart || !formEnd) {
      setFormError("Pick a start and end date.");
      return;
    }
    if (formEnd < formStart) {
      setFormError("End date can't be before the start date.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const created = await createPtoRequest({
        profileId: modal.employee.id,
        ptoType: formType,
        startDate: formStart,
        endDate: formEnd,
        reason: formReason,
        requestedBy: myProfileId,
      });
      if (attachFile && companyId) {
        await uploadPtoAttachment(created.id, companyId, attachFile);
      }
      await load();
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!modal?.request) return;
    if (!formStart || !formEnd) {
      setFormError("Pick a start and end date.");
      return;
    }
    if (formEnd < formStart) {
      setFormError("End date can't be before the start date.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await updatePtoRequest(modal.request.id, { ptoType: formType, startDate: formStart, endDate: formEnd, reason: formReason });
      if (attachFile && companyId) {
        await uploadPtoAttachment(modal.request.id, companyId, attachFile);
      }
      await load();
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!modal?.request) return;
    setSaving(true);
    setFormError(null);
    try {
      await updatePtoRequestStatus(modal.request.id, "cancelled", myProfileId, `Cancelled from Calendar by ${myDisplayName || "HR"}`);
      await load();
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to cancel.");
    } finally {
      setSaving(false);
    }
  };

  // Manager/HR/Accounting stage approvals — same reviewPtoStage/
  // canReviewPtoStage flow (and the same pto_requests rows) Attendance
  // Monitoring's own PTO Management tab uses, so approving here is really
  // just doing it from this calendar instead of that table.
  const [busyStageId, setBusyStageId] = useState<string | null>(null);
  const handleStageAction = async (request: PtoRequestRow, stage: PtoStage, decision: "approved" | "rejected") => {
    setBusyStageId(request.id);
    setFormError(null);
    try {
      await reviewPtoStage(request, stage, decision, myProfileId || "", myDisplayName || "HR");
      const freshRows = await load();
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: myDisplayName || "HR",
        action: decision === "approved" ? "pto_request_approved" : "pto_request_rejected",
        targetType: "pto_request",
        targetId: request.id,
        targetLabel: `${modal?.employee.name ?? ""} (${request.startDate} – ${request.endDate})`,
        details: { stage, ptoType: request.ptoType },
      });
      // Re-open on the freshly-saved row so the badges/buttons reflect the
      // decision immediately instead of showing stale pending state until
      // the modal is closed and reopened.
      setModal((cur) => {
        if (!cur) return cur;
        const updated = freshRows.find((r) => r.id === request.id);
        return updated ? { ...cur, request: updated } : cur;
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update request.");
    } finally {
      setBusyStageId(null);
    }
  };

  const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <CalendarIcon className="h-4 w-4 text-blue-300" /> Time Off Calendar
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Click any cell to add or view time-off. Approved and pending requests, by branch and technician.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMonthOffset((o) => o - 1)} className="btn text-xs px-2 py-1.5">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-medium min-w-[13rem] text-center">
            {months[0].toLocaleDateString(undefined, { month: "long", year: "numeric" })} – {months[1].toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button type="button" onClick={() => setMonthOffset((o) => o + 1)} className="btn text-xs px-2 py-1.5">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          {monthOffset !== 0 && (
            <button type="button" onClick={() => setMonthOffset(0)} className="btn text-xs px-2.5 py-1.5">
              Today
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a technician…"
              className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as PtoType | "all")} className={`${inputCls} w-40`}>
            <option value="all">All Types</option>
            {PTO_TYPES.map((t) => (
              <option key={t} value={t}>{PTO_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 relative">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Roles</label>
          <button
            type="button"
            onClick={() => setRoleDropdownOpen((o) => !o)}
            className="btn text-sm py-1.5 px-3 w-48 text-left flex items-center justify-between"
          >
            <span>{roleFilter.size === 0 ? "All Roles" : `${roleFilter.size} role${roleFilter.size === 1 ? "" : "s"} selected`}</span>
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${roleDropdownOpen ? "rotate-90" : ""}`} />
          </button>
          {roleDropdownOpen && (
            <div className="absolute z-30 top-full mt-1 w-56 max-h-72 overflow-y-auto rounded-md border border-white/15 bg-slate-900 shadow-2xl p-1.5">
              {roleFilter.size > 0 && (
                <button type="button" onClick={() => setRoleFilter(new Set())} className="w-full text-left px-2 py-1 text-xs text-blue-300 hover:bg-white/10 rounded">
                  Clear filter
                </button>
              )}
              {availableRoles.map((r) => (
                <label key={r} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-white/10 rounded cursor-pointer">
                  <input type="checkbox" checked={roleFilter.has(r)} onChange={() => toggleRole(r)} className="h-3.5 w-3.5" />
                  {ROLE_LABELS[normalizeRole(r)] ?? r}
                </label>
              ))}
            </div>
          )}
        </div>

        {(search || typeFilter !== "all" || roleFilter.size > 0) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setTypeFilter("all"); setRoleFilter(new Set()); }}
            className="btn text-xs px-3 py-1.5 flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      <div className="px-4 py-2 border-b border-white/10 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-green-500/80 inline-block" /> Approved
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-yellow-400/80 inline-block" /> Pending approval
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-orange-500/80 inline-block" /> Set by HR (Absent List), no formal request
        </span>
        <span className="text-slate-600">•</span>
        {PTO_TYPES.map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span className="font-bold text-slate-300">{PTO_TYPE_LETTER[t]}</span> = {PTO_TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="p-4 text-sm text-red-300">{error}</div>
      ) : (
        <div className="overflow-x-auto" onClick={() => roleDropdownOpen && setRoleDropdownOpen(false)}>
          <table className="border-collapse text-xs min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-900 border-b border-r border-white/10 px-3 py-1.5 text-left font-semibold w-64">
                  Technician
                </th>
                {days.map((d) => (
                  <th
                    key={d.date}
                    className={`border-b border-l border-white/5 px-1 py-1 text-center font-normal w-7 ${
                      d.date === todayStr ? "bg-blue-500/20" : ""
                    }`}
                    title={d.monthLabel}
                  >
                    <div className="text-[9px] text-muted-foreground">{d.dow}</div>
                    <div>{d.day}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branchGroups.map(([branch, emps]) => (
                <Fragment key={branch}>
                  <tr>
                    <td colSpan={days.length + 1} className="sticky left-0 bg-blue-500/10 border-b border-white/10 px-3 py-1 font-semibold text-blue-300">
                      {branch}
                    </td>
                  </tr>
                  {emps.map((e) => (
                    <tr key={e.id}>
                      <td className="sticky left-0 z-10 bg-slate-900 border-b border-r border-white/10 px-3 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{e.name}</span>
                          {(() => {
                            const sick = remainingSickByProfile.get(e.id);
                            const pto = remainingPtoByProfile.get(e.id);
                            return (
                              <span className="flex items-center gap-1 shrink-0">
                                {sick && (
                                  <span
                                    className="bg-teal-500/20 text-teal-300 px-1 py-0.5 rounded text-[9px] font-semibold"
                                    title={`Sick Leave remaining/allowance: ${sick.remaining}/${sick.allowance}`}
                                  >
                                    {sick.remaining}/{sick.allowance}
                                  </span>
                                )}
                                {pto && (
                                  <span
                                    className="bg-yellow-500/20 text-yellow-300 px-1 py-0.5 rounded text-[9px] font-semibold"
                                    title={`Vacation PTO remaining/allowance: ${pto.remaining}/${pto.allowance}`}
                                  >
                                    {pto.remaining}/{pto.allowance}
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      {days.map((d) => {
                        const request = cellsByProfile.get(e.id)?.get(d.date);
                        const hrPlotted = !request ? hrPlottedByProfile.get(e.id)?.get(d.date) : undefined;
                        const color: CellColor | undefined = request ? colorForRequest(request) : hrPlotted ? "hrPlotted" : undefined;
                        const addedByName = hrPlotted?.addedBy ? employees.find((emp) => emp.id === hrPlotted.addedBy)?.name : undefined;
                        return (
                          <td
                            key={d.date}
                            onClick={() => openCell(e, d.date)}
                            title={
                              request
                                ? `${PTO_TYPE_LABELS[request.ptoType]} (${request.status}) — click for details`
                                : hrPlotted
                                ? `${PTO_TYPE_LABELS[hrPlotted.type]} — set by HR via Absent List${addedByName ? ` (added by ${addedByName})` : ""}, no formal request yet. Click to formalize.`
                                : "Click to add time off"
                            }
                            className={`border-b border-l border-white/5 h-6 w-7 cursor-pointer hover:ring-1 hover:ring-blue-400/60 hover:ring-inset text-center align-middle text-[10px] font-bold ${
                              color === "approved"
                                ? "bg-green-500/80 text-green-950"
                                : color === "pending"
                                ? "bg-yellow-400/80 text-yellow-950"
                                : color === "hrPlotted"
                                ? "bg-orange-500/80 text-orange-950"
                                : d.date === todayStr
                                ? "bg-blue-500/10"
                                : ""
                            }`}
                          >
                            {request ? PTO_TYPE_LETTER[request.ptoType] : hrPlotted ? PTO_TYPE_LETTER[hrPlotted.type] : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {branchGroups.length === 0 && (
                <tr>
                  <td colSpan={days.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                    No matching employees.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && createPortal(
        // Portaled straight to <body> — this panel's own overflow-hidden
        // (needed to clip the rounded corners around the wide day-grid)
        // otherwise clips a nested position:fixed modal to the panel's own
        // box on some mobile browsers instead of the real viewport, which
        // is exactly what put the popup down near the bottom of a long
        // table instead of centered on screen.
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="panel w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{modal.employee.name}</h3>
              <button type="button" onClick={closeModal} className="text-muted-foreground hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {modal.mode === "view" && modal.request && (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_BADGE[modal.request.status]}`}>
                    {modal.request.status[0].toUpperCase() + modal.request.status.slice(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">{PTO_TYPE_LABELS[modal.request.ptoType]}</span>
                </div>
                <p><span className="text-muted-foreground">Dates:</span> {modal.request.startDate} – {modal.request.endDate}</p>
                <p><span className="text-muted-foreground">Hours:</span> {modal.request.hoursRequested}</p>
                <p><span className="text-muted-foreground">Requested:</span> {toDateOnly(modal.request.createdAt)} ({daysBetween(toDateOnly(modal.request.createdAt), modal.request.startDate)} day{daysBetween(toDateOnly(modal.request.createdAt), modal.request.startDate) === 1 ? "" : "s"} notice)</p>
                {modal.request.reason && <p><span className="text-muted-foreground">Reason:</span> {modal.request.reason}</p>}
                {modal.request.attachmentPath && (
                  <p>
                    <span className="text-muted-foreground">Attachment:</span>{" "}
                    <button
                      type="button"
                      disabled={attachmentUrlLoading}
                      onClick={async () => {
                        if (!modal.request?.attachmentPath) return;
                        setAttachmentUrlLoading(true);
                        try {
                          const url = await getPtoAttachmentUrl(modal.request.attachmentPath);
                          window.open(url, "_blank", "noopener,noreferrer");
                        } catch (err) {
                          setFormError(err instanceof Error ? err.message : "Failed to open attachment.");
                        } finally {
                          setAttachmentUrlLoading(false);
                        }
                      }}
                      className="text-blue-400 hover:text-blue-300 underline disabled:opacity-50"
                    >
                      {attachmentUrlLoading ? "Opening…" : "View photo"}
                    </button>
                  </p>
                )}

                {(() => {
                  const request = modal.request!;
                  // request.managerId is a one-time snapshot from submission
                  // — canReviewPtoStage's fallback needs the requester's
                  // CURRENT manager (and that manager's own manager, one
                  // level up) in case they've been reassigned since, looked
                  // up fresh from the same roster the grid itself uses.
                  const requesterManagerName = modal.employee.managerName ?? null;
                  const requesterManagersManagerName = requesterManagerName
                    ? employees.find((e) => e.name.trim().toLowerCase() === requesterManagerName.trim().toLowerCase())?.managerName ?? null
                    : null;
                  const stageBadge = (label: string, stageStatus: "pending" | "approved" | "rejected", reviewedBy: string | null) => (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold border ${
                        stageStatus === "approved"
                          ? "bg-green-500/20 text-green-300 border-green-500/30"
                          : stageStatus === "rejected"
                          ? "bg-red-500/20 text-red-300 border-red-500/30"
                          : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                      }`}
                    >
                      {label}: {stageStatus[0].toUpperCase() + stageStatus.slice(1)}
                      {reviewedBy ? ` — ${employees.find((e) => e.id === reviewedBy)?.name ?? "someone"}` : ""}
                    </span>
                  );
                  const stageAction = (label: string, stage: PtoStage, stageStatus: "pending" | "approved" | "rejected") => {
                    if (stageStatus !== "pending") return null;
                    // A cancelled/denied request can still have an
                    // untouched "pending" stage (e.g. cancelled before
                    // anyone reviewed it) — don't offer to approve/reject
                    // something the employee already withdrew or that's
                    // already been turned down at another stage.
                    if (request.status === "cancelled" || request.status === "denied") return null;
                    if (!canReviewPtoStage(request, stage, myProfileId, role, extraRoles, myDisplayName, requesterManagerName, requesterManagersManagerName)) return null;
                    const busy = busyStageId === request.id;
                    return (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground w-12 shrink-0">{label}:</span>
                        <button
                          type="button"
                          title={`Approve as ${label}`}
                          onClick={() => void handleStageAction(request, stage, "approved")}
                          disabled={busy}
                          className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1"
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />} Approve
                        </button>
                        <button
                          type="button"
                          title={`Reject as ${label}`}
                          onClick={() => void handleStageAction(request, stage, "rejected")}
                          disabled={busy}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1"
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Reject
                        </button>
                      </div>
                    );
                  };
                  const notWithdrawn = request.status !== "cancelled" && request.status !== "denied";
                  const anyActionable =
                    notWithdrawn &&
                    ((request.managerStatus === "pending" && canReviewPtoStage(request, "manager", myProfileId, role, extraRoles, myDisplayName, requesterManagerName, requesterManagersManagerName)) ||
                      (request.hrStatus === "pending" && canReviewPtoStage(request, "hr", myProfileId, role, extraRoles, myDisplayName, requesterManagerName, requesterManagersManagerName)) ||
                      (request.accountingStatus === "pending" && canReviewPtoStage(request, "accounting", myProfileId, role, extraRoles, myDisplayName, requesterManagerName, requesterManagersManagerName)));
                  return (
                    <div className="space-y-2 pt-1 border-t border-white/10">
                      <div className="flex flex-col gap-1 pt-2">
                        {stageBadge("Manager", request.managerStatus, request.managerReviewedBy)}
                        {stageBadge("HR", request.hrStatus, request.hrReviewedBy)}
                        {stageBadge("Accounting", request.accountingStatus, request.accountingReviewedBy)}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {stageAction("Manager", "manager", request.managerStatus)}
                        {stageAction("HR", "hr", request.hrStatus)}
                        {stageAction("Accounting", "accounting", request.accountingStatus)}
                        {!anyActionable && notWithdrawn && (request.managerStatus === "pending" || request.hrStatus === "pending" || request.accountingStatus === "pending") && (
                          <span className="text-[11px] text-muted-foreground">
                            {request.managerStatus === "pending" ? "Awaiting manager approval." : "Awaiting HR or Accounting approval."}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {formError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{formError}</p>}

                {modal.request.reviewedBy && (
                  <p className="text-[11px] text-muted-foreground">
                    Reviewed by: {employees.find((e) => e.id === modal.request!.reviewedBy)?.name ?? "someone"}
                    {modal.request.reviewedAt ? ` on ${toDateOnly(modal.request.reviewedAt)}` : ""}
                  </p>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <button type="button" onClick={startEdit} className="btn text-xs px-3 py-1.5">Edit</button>
                  {modal.request.status !== "cancelled" && modal.request.status !== "denied" && (
                    <button type="button" disabled={saving} onClick={handleCancelRequest} className="btn text-xs px-3 py-1.5 text-red-300 disabled:opacity-50">
                      {saving ? "Cancelling…" : "Cancel Request"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {(modal.mode === "create" || modal.mode === "edit") && (
              <div className="space-y-2.5">
                {modal.mode === "create" && (() => {
                  const plotted = hrPlottedByProfile.get(modal.employee.id)?.get(modal.date);
                  if (!plotted) return null;
                  const addedByName = plotted.addedBy ? employees.find((emp) => emp.id === plotted.addedBy)?.name : null;
                  return (
                    <p className="text-[11px] text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-md px-2.5 py-2">
                      Already marked {PTO_TYPE_LABELS[plotted.type]} via Absent List — no formal request yet.
                      {addedByName ? ` Added by: ${addedByName}.` : ""} Saving below files a real request for it.
                    </p>
                  );
                })()}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Type</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value as PtoType)} className={inputCls}>
                    {PTO_TYPES.map((t) => (
                      <option key={t} value={t}>{PTO_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Start</label>
                    <input type="date" value={formStart} onChange={(e) => setFormStart(e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">End</label>
                    <input type="date" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reason</label>
                  <textarea value={formReason} onChange={(e) => setFormReason(e.target.value)} rows={2} className={inputCls} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Attach photo (optional)</label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)}
                    className="text-xs text-muted-foreground file:mr-2 file:btn file:text-xs file:px-2 file:py-1"
                  />
                  {modal.mode === "edit" && modal.request?.attachmentPath && !attachFile && (
                    <p className="text-[10px] text-muted-foreground">Already has an attachment — choosing a new file replaces it.</p>
                  )}
                  {attachFile && <p className="text-[10px] text-blue-300 truncate">{attachFile.name}</p>}
                </div>

                {formError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{formError}</p>}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={modal.mode === "create" ? handleCreate : handleEditSave}
                    className="btn text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={closeModal} className="btn text-xs px-3 py-1.5">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
