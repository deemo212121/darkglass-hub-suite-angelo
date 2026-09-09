/**
 * Ticket Attendance — did each technician actually check into their
 * scheduled tickets (On-Site Check-In), separate from clock In/Out
 * attendance? Self-contained: fetches its own data independently (own
 * employees list, own ticket-time-dispute lookup, own mileage entries)
 * rather than depending on a parent page's unrelated state, so the exact
 * same tab can be rendered from more than one page — Accounting
 * Dashboard's "Ticket Attendance" tab and Attendance Monitoring's tab of
 * the same name both mount this directly.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Check, Pencil, ExternalLink, Columns3, Filter } from "lucide-react";
import {
  getCompanyTicketAttendance,
  slotSortKey,
  type TicketAttendanceRow,
} from "@/lib/supabase/technicianWhereabouts";
import { getCompanyTimecardEntries, getProfileIdByFirebaseUid, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getVisitDiagnosisByTicketIds, getVisitResolutionByTicketIds } from "@/lib/supabase/tickets";
import { getMileageEntries, setMileageEstimateTime, type MileageEntry } from "@/lib/supabase/mileage";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyEmployeeRequests } from "@/lib/supabase/employeeRequests";
import { getCompanyTicketReschedules, type TicketRescheduleRow } from "@/lib/supabase/ticketReschedules";
import { getAttendanceNotes, upsertAttendanceNote, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { ATTENDANCE_GRACE_MINUTES, toSeconds } from "@/lib/attendanceGrace";
import { useAuth } from "@/lib/auth";

/**
 * Time Out vs the employee's own scheduled check-out (profiles.
 * required_check_out) — same ATTENDANCE_GRACE_MINUTES tolerance Attendance
 * Monitoring already uses for lateness alerts, applied symmetrically here
 * (early leaving is "Undertime", late leaving is "Overtime"). Null when
 * there's nothing to compare (no punch yet, or no schedule on file for
 * that employee).
 */
type TimeOutStatus = "ok" | "overtime" | "undertime";
function timeOutStatus(timeOut: string | null, requiredCheckOut: string | null): TimeOutStatus | null {
  if (!timeOut || !requiredCheckOut) return null;
  const deltaSeconds = toSeconds(timeOut) - toSeconds(requiredCheckOut);
  const graceSeconds = ATTENDANCE_GRACE_MINUTES * 60;
  if (deltaSeconds > graceSeconds) return "overtime";
  if (deltaSeconds < -graceSeconds) return "undertime";
  return "ok";
}
/** How far past/before the scheduled check-out Time Out landed — the raw
 *  magnitude timeOutStatus's own overtime/undertime split is based on,
 *  surfaced separately so the Overtime/Undertime label can show "how much"
 *  (see formatDeltaHM) alongside "which direction". */
function timeOutDeltaSeconds(timeOut: string | null, requiredCheckOut: string | null): number | null {
  if (!timeOut || !requiredCheckOut) return null;
  return toSeconds(timeOut) - toSeconds(requiredCheckOut);
}
/** "5:00" — hours:minutes, zero-padded, always non-negative (callers pass
 *  an already-signed delta and only render this for overtime/undertime,
 *  where the direction is already conveyed by the Overtime/Undertime label
 *  itself, not by a +/- sign here). */
function formatDeltaHM(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(Math.abs(seconds) / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
/**
 * Google Maps directions link for one stop, built live from the visit order
 * shown in this table — origin is the PREVIOUS stop's address, so the route
 * is stop-to-stop (matching the leg mileage beside it) instead of "from
 * wherever the viewer is sitting", which is what Google falls back to when a
 * link has no origin. Computed here rather than read from the stored
 * mileage-entry link so it's correct immediately, without waiting on a full
 * mileage re-sync. The first stop of a day has no previous ticket: fall back
 * to the stored link (branch origin) when there is one, else destination
 * only. `rows` must be in per-day stop order; `idx` is the row's position.
 */
function stopToStopMapLink(rows: TicketAttendanceRow[], idx: number, storedLink?: string | null): string | null {
  const dest = rows[idx]?.address?.trim();
  if (!dest) return storedLink ?? null;
  const prev = rows[idx - 1];
  const prevAddr = prev && prev.scheduleDate === rows[idx].scheduleDate ? prev.address?.trim() : "";
  if (prevAddr) {
    return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(prevAddr)}&destination=${encodeURIComponent(dest)}`;
  }
  return storedLink ?? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(dest)}`;
}

const TIME_OUT_STATUS_LABEL: Record<TimeOutStatus, string> = { ok: "OK", overtime: "Overtime", undertime: "Undertime" };
const TIME_OUT_STATUS_CLASS: Record<TimeOutStatus, string> = {
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  overtime: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  undertime: "border-red-400/30 bg-red-400/10 text-red-300",
};

export function TicketAttendanceTab() {
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [dateFrom, setDateFrom] = useState(todayISO);
  const [dateTo, setDateTo] = useState(todayISO);
  // Matches technician name OR location/branch — a location like "Columbus"
  // typed here filters down to that branch just as typing a name does.
  const [search, setSearch] = useState("");
  // Based on the general clock Time In/Time Out columns (not the ticket-level
  // Scheduled/Checked In counts) — "present" has both, "presentNoTimeOut" has
  // clocked in but not out yet, "absent" has neither. Same isSingleDay
  // caveat those columns themselves already have: only meaningful when
  // dateFrom === dateTo, since Time In/Out has no single value across a
  // multi-day range.
  const [statusFilter, setStatusFilter] = useState<"all" | "present" | "presentNoTimeOut" | "absent">("all");
  type ColumnKey = "location" | "timeIn" | "timeOut" | "scheduled" | "checkedIn" | "missingCheckIn" | "missingCheckOut" | "notes";
  const COLUMN_LABELS: Record<ColumnKey, string> = {
    location: "Location",
    timeIn: "Time In",
    timeOut: "Time Out",
    scheduled: "Scheduled",
    checkedIn: "Checked In",
    missingCheckIn: "Missing Check-In",
    missingCheckOut: "Missing Check-Out",
    notes: "Notes",
  };
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>({
    location: true,
    timeIn: true,
    timeOut: true,
    scheduled: true,
    checkedIn: true,
    missingCheckIn: true,
    missingCheckOut: true,
    notes: true,
  });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  // Per-column funnel filters, in the header row — separate from the
  // top-bar Search/Status filters. Location is a multi-select (empty set =
  // no restriction); the tri-state ones are "all" / "has" (>0, or a note
  // present) / "none".
  type TriState = "all" | "has" | "none";
  type FilterMenuKey = "location" | "missingCheckIn" | "missingCheckOut" | "notes";
  const [openFilterMenu, setOpenFilterMenu] = useState<FilterMenuKey | null>(null);
  const [locationFilter, setLocationFilter] = useState<Set<string>>(new Set());
  const [missingCheckInFilter, setMissingCheckInFilter] = useState<TriState>("all");
  const [missingCheckOutFilter, setMissingCheckOutFilter] = useState<TriState>("all");
  const [notesFilter, setNotesFilter] = useState<TriState>("all");
  const anyColumnFilterActive = locationFilter.size > 0 || missingCheckInFilter !== "all" || missingCheckOutFilter !== "all" || notesFilter !== "all";
  const visibleColumnCount = 1 + Object.values(visibleColumns).filter(Boolean).length; // +1 for Technician, always shown
  const [rows, setRows] = useState<TicketAttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedTech, setExpandedTech] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<CompanyTimecardEntry[]>([]);
  const [diagnoses, setDiagnoses] = useState<Map<string, string>>(new Map());
  const [resolutions, setResolutions] = useState<Map<string, string>>(new Map());
  // Keyed by `${ticketId}|${workDate}` — a technician's own "Reschedule"
  // flag (migration 0215) takes priority over the diagnosis waterfall
  // below, since it directly explains why there's no diagnosis.
  const [reschedules, setReschedules] = useState<Map<string, TicketRescheduleRow>>(new Map());
  const [employees, setEmployees] = useState<ProfileRow[]>([]);
  const [disputedTicketNosApproved, setDisputedTicketNosApproved] = useState<Set<string>>(new Set());
  const [mileageEntries, setMileageEntries] = useState<MileageEntry[]>([]);
  // "Why they're absent" notes — same (profile, day) note the Attendance
  // Monitoring tab already writes to (attendanceNotes.ts), so a note added
  // from either tab shows up in both. Only meaningful/editable for a single
  // selected day (see isSingleDay below), same limitation Time In/Out here
  // already has.
  const [notes, setNotes] = useState<AttendanceNoteRow[]>([]);
  const { uid } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  const load = () => {
    setLoading(true);
    Promise.all([
      getCompanyTicketAttendance(dateFrom, dateTo),
      getCompanyTimecardEntries(dateFrom, dateTo).catch((err) => {
        console.error("Failed to load timecard entries for Ticket Attendance:", err);
        return [] as CompanyTimecardEntry[];
      }),
      getAttendanceNotes(dateFrom, dateTo).catch((err) => {
        console.error("Failed to load attendance notes for Ticket Attendance:", err);
        return [] as AttendanceNoteRow[];
      }),
    ])
      .then(([ticketRows, tc, noteRows]) => {
        setRows(ticketRows);
        setTimecards(tc);
        setNotes(noteRows);
        // Diagnosis text isn't needed to render the tab at all — fetched
        // separately so a slow/failed lookup never blocks the rows/times
        // that ARE already back. Same for reschedule reasons.
        getVisitDiagnosisByTicketIds(ticketRows.map((r) => r.ticketId))
          .then(setDiagnoses)
          .catch((err) => console.error("Failed to load ticket diagnoses:", err));
        getVisitResolutionByTicketIds(ticketRows.map((r) => r.ticketId))
          .then(setResolutions)
          .catch((err) => console.error("Failed to load ticket resolutions:", err));
        getCompanyTicketReschedules(dateFrom, dateTo)
          .then((rescheduleRows) => setReschedules(new Map(rescheduleRows.map((r) => [`${r.ticketId}|${r.workDate}`, r]))))
          .catch((err) => console.error("Failed to load ticket reschedules:", err));
      })
      .catch((err) => console.error("Failed to load ticket attendance:", err))
      .finally(() => setLoading(false));
  };

  // Re-fetches whenever the date changes (also fires once on mount, since
  // dateFrom/dateTo already have their initial value then) — no separate
  // click needed after picking a new date.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  // Loaded once on mount — employees/mileage/disputes don't depend on the
  // date range.
  useEffect(() => {
    getCompanyUsers()
      .then(setEmployees)
      .catch((err) => console.error("Failed to load employees for Ticket Attendance:", err));
    getMileageEntries()
      .then(setMileageEntries)
      .catch((err) => console.error("Failed to load mileage entries for Ticket Attendance:", err));
    getCompanyEmployeeRequests()
      .then((requests) =>
        setDisputedTicketNosApproved(
          new Set(
            requests
              .filter((r) => r.requestType === "ticket_time_dispute" && r.status === "approved" && r.ticketNo)
              .map((r) => r.ticketNo!)
          )
        )
      )
      .catch((err) => console.error("Failed to load ticket time disputes for Ticket Attendance:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Technician (raw ticket-assignment name) -> profile, for joining the
  // timecard map below and reading a technician's assigned branch — same
  // normalized-name matching mileage sync uses.
  const employeeByNormalizedName = useMemo(
    () => new Map(employees.map((e) => [(e.display_name || "").trim().toLowerCase(), e])),
    [employees]
  );
  // Every distinct branch on file — the Location filter's checklist options.
  // Sourced from the full employee roster (not just today's rows) so the
  // list stays stable regardless of what's currently filtered/scheduled.
  const branchOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.assigned_branch).filter((b): b is string => !!b))).sort(),
    [employees]
  );
  const timecardByProfileDate = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    for (const tc of timecards) map.set(`${tc.profileId}|${tc.workDate}`, tc);
    return map;
  }, [timecards]);
  const noteByProfileDate = useMemo(() => {
    const map = new Map<string, AttendanceNoteRow>();
    for (const n of notes) map.set(`${n.profileId}|${n.noteDate}`, n);
    return map;
  }, [notes]);
  // One non-deleted mileage entry per ticket # (auto-synced entries are
  // already one row per ticket). legMileage (this ticket's own leg of its
  // day's route) is what's shown; a ticket not yet mileage-synced, or
  // whose day hasn't been recalculated since legMileage shipped, has none.
  const mileageByTicketNo = useMemo(() => {
    const map = new Map<string, MileageEntry>();
    for (const e of mileageEntries) {
      if (e.deletedAt || !e.ticketNo || map.has(e.ticketNo)) continue;
      map.set(e.ticketNo, e);
    }
    return map;
  }, [mileageEntries]);

  // Time In/Out (and Notes, below) only mean one specific value when the
  // selected range is a single day — across multiple days there's no one
  // "Time In" to show at the summary level (that's what the per-date rows
  // in the expanded panel below are for).
  const isSingleDay = dateFrom === dateTo;
  const byTechnician = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byTech = new Map<string, TicketAttendanceRow[]>();
    for (const row of rows) {
      if (!byTech.has(row.technician)) byTech.set(row.technician, []);
      byTech.get(row.technician)!.push(row);
    }
    return Array.from(byTech.entries())
      .map(([technician, techRows]) => {
        const scheduled = techRows.length;
        const checkedIn = techRows.filter((r) => r.arrivedAt).length;
        const missingCheckIn = techRows.filter((r) => !r.arrivedAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length;
        const missingCheckOut = techRows.filter((r) => r.arrivedAt && !r.doneAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length;
        const employee = employeeByNormalizedName.get(technician.trim().toLowerCase());
        const timecard = isSingleDay && employee ? timecardByProfileDate.get(`${employee.id}|${dateFrom}`) : undefined;
        const note = isSingleDay && employee ? noteByProfileDate.get(`${employee.id}|${dateFrom}`) : undefined;
        // Date then route order (slotSortKey) — same helper Technician
        // Whereabouts' numbered Stops list sorts by, so a technician's stop
        // #3 there lines up with row #3 here.
        return {
          technician,
          rows: techRows.sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate) || slotSortKey(a.timeSlot).localeCompare(slotSortKey(b.timeSlot))),
          scheduled,
          checkedIn,
          missingCheckIn,
          missingCheckOut,
          branch: employee?.assigned_branch || null,
          timeIn: timecard?.checkIn || null,
          timeOut: timecard?.checkOut || null,
          requiredCheckOut: employee?.required_check_out || null,
          profileId: employee?.id || null,
          note: note?.content || "",
        };
      })
      .filter((t) => {
        if (q && !t.technician.toLowerCase().includes(q) && !(t.branch || "").toLowerCase().includes(q)) return false;
        if (statusFilter !== "all") {
          const bucket = t.timeIn && t.timeOut ? "present" : t.timeIn ? "presentNoTimeOut" : "absent";
          if (bucket !== statusFilter) return false;
        }
        if (locationFilter.size > 0 && !(t.branch && locationFilter.has(t.branch))) return false;
        if (missingCheckInFilter === "has" && t.missingCheckIn === 0) return false;
        if (missingCheckInFilter === "none" && t.missingCheckIn > 0) return false;
        if (missingCheckOutFilter === "has" && t.missingCheckOut === 0) return false;
        if (missingCheckOutFilter === "none" && t.missingCheckOut > 0) return false;
        if (notesFilter === "has" && !t.note) return false;
        if (notesFilter === "none" && t.note) return false;
        return true;
      })
      .sort((a, b) => a.technician.localeCompare(b.technician));
  }, [
    rows,
    search,
    statusFilter,
    locationFilter,
    missingCheckInFilter,
    missingCheckOutFilter,
    notesFilter,
    disputedTicketNosApproved,
    employeeByNormalizedName,
    timecardByProfileDate,
    noteByProfileDate,
    dateFrom,
    dateTo,
    isSingleDay,
  ]);

  // Estimate Time column — inline pencil-icon edit, one free-text field, no
  // formula/source. Which mileage entry id is currently being edited, plus
  // the in-progress text.
  const [editingEstimateTimeId, setEditingEstimateTimeId] = useState<string | null>(null);
  const [estimateTimeDraft, setEstimateTimeDraft] = useState("");
  const [savingEstimateTimeId, setSavingEstimateTimeId] = useState<string | null>(null);
  const handleSaveEstimateTime = async (entry: MileageEntry) => {
    const value = estimateTimeDraft;
    setSavingEstimateTimeId(entry.id);
    try {
      await setMileageEstimateTime(entry.id, value);
      setMileageEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, estimateTime: value.trim() || null } : e)));
      setEditingEstimateTimeId(null);
    } catch (err) {
      alert(`Failed to save Estimate Time: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingEstimateTimeId(null);
    }
  };

  // Notes column — same (profile, day) note Attendance Monitoring's own
  // note/notify flow writes to (attendanceNotes.ts), used here as a plain
  // "why are they absent" free-text field. Deliberately doesn't touch
  // notify_individual/notify_team_lead (left false) — those trigger actual
  // notification sends over on that other tab, out of scope for a quick
  // note here.
  const [editingNoteProfileId, setEditingNoteProfileId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNoteProfileId, setSavingNoteProfileId] = useState<string | null>(null);
  const handleSaveNote = async (profileId: string) => {
    const content = noteDraft;
    setSavingNoteProfileId(profileId);
    try {
      await upsertAttendanceNote({
        profileId,
        noteDate: dateFrom,
        content,
        notifyIndividual: false,
        notifyTeamLead: false,
        createdBy: myProfileId,
      });
      setNotes((prev) => {
        const existingHrNote = prev.find((n) => n.profileId === profileId && n.noteDate === dateFrom)?.hrNote || "";
        const next = prev.filter((n) => !(n.profileId === profileId && n.noteDate === dateFrom));
        next.push({ profileId, noteDate: dateFrom, content, hrNote: existingHrNote, notifyIndividual: false, notifyTeamLead: false, createdBy: myProfileId });
        return next;
      });
      setEditingNoteProfileId(null);
    } catch (err) {
      alert(`Failed to save note: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingNoteProfileId(null);
    }
  };

  // Export — mirrors the on-screen layout AND colors exactly (one sectioned
  // block per technician: a summary header line, then that technician's
  // ticket table, then a Total Mileage line), so opening it in Excel reads
  // the same as the page does. This is an HTML table saved with an .xls
  // extension, not a real .xlsx/.csv — Excel opens and renders HTML tables
  // (including inline colors) natively when given that extension, and the
  // `xlsx` package already in this project (the free/Community edition,
  // used elsewhere in the app for plain exports) can't actually WRITE
  // colored cells — that requires the paid Pro tier. This sidesteps that
  // limitation with zero new dependencies. Excel may show a one-time "the
  // file format and extension don't match" warning — that's expected and
  // safe to click through, it's just Excel noting the file is HTML.
  const handleExportCsv = () => {
    const esc = (v: string | number) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    type CellDesc = { text: string | number; color?: string; bold?: boolean; align?: "right" | "center" };
    const cell = (v: string | number, opts?: { color?: string; bold?: boolean; align?: "right" | "center" }): CellDesc => ({
      text: v,
      ...opts,
    });
    // Address, Diagnosis, and Resolution can carry a long free-text
    // sentence from a single row — without a cap, that one row would
    // stretch the column for every technician/ticket, leaving huge blank
    // space around every short "Missing"/"—" cell in that same column. Cap
    // those and let them wrap instead; every other column (times,
    // statuses, numbers) is short and fixed-format, so it's safe to fit
    // tightly and keep on one line.
    const WRAP_COLS = new Set([3, 9, 10]); // ticket-table column indexes: Address, Diagnosis, Resolution
    const MAX_W: Record<number, number> = { 3: 220, 9: 260, 10: 260 };
    const cellHtml = (c: CellDesc, colIdx?: number) => {
      const wrap = colIdx != null && WRAP_COLS.has(colIdx);
      const styles = [
        c.color ? `color:${c.color}` : "",
        c.bold ? "font-weight:bold" : "",
        c.align ? `text-align:${c.align}` : "",
        wrap ? "white-space:normal;word-break:break-word" : "white-space:nowrap",
      ].filter(Boolean).join(";");
      return `<td style="${styles}">${esc(c.text)}</td>`;
    };
    const headerRow = (cells: string[]) =>
      `<tr>${cells.map((c) => `<th style="background:#e2e8f0;text-align:left;padding:4px 8px;white-space:nowrap;">${esc(c)}</th>`).join("")}</tr>`;
    // Column widths are sized to the longest entry actually present in that
    // column (header included) — Excel doesn't auto-fit HTML-imported
    // tables on its own, so we compute it ourselves and set it explicitly.
    const CH_PX = 6; // approx px per character at 12pt Calibri
    const colgroup = (widths: number[], maxByIdx?: Record<number, number>) =>
      `<colgroup>${widths.map((w, i) => `<col style="width:${Math.min(maxByIdx?.[i] ?? Infinity, Math.max(40, w * CH_PX + 10))}px;">`).join("")}</colgroup>`;
    const track = (widths: number[], idx: number, text: string | number) => {
      widths[idx] = Math.max(widths[idx] ?? 0, String(text ?? "").length);
    };

    // Same readable colors used on screen, adapted for a white spreadsheet
    // background instead of the app's dark theme.
    const GREEN = "#15803d";
    const RED = "#dc2626";
    const AMBER = "#b45309";
    const BLUE = "#2563eb";
    const GRAY = "#64748b";
    const SKY = "#0369a1";

    const summaryHeaders = ["Technician", "Location", "Time In", "Time Out", "Alert", "Scheduled", "Checked In", "Missing Check-In", "Missing Check-Out"];
    const ticketHeaders = ["#", "Ticket", "Status", "Address", "Estimate Time", "Arrived", "Done", "Mileage (mi)", "Map Link", "Diagnosis", "Resolution"];
    const summaryWidths = summaryHeaders.map((h) => h.length);
    const ticketWidths = ticketHeaders.map((h) => h.length);

    // Pass 1: derive every cell's text/color once, tracking the longest
    // entry per column along the way, before any HTML is built.
    const perTech = byTechnician.map((t) => {
      const outStatus = timeOutStatus(t.timeOut, t.requiredCheckOut);
      const outStatusColor = outStatus === "overtime" ? AMBER : outStatus === "undertime" ? RED : outStatus === "ok" ? GREEN : GRAY;
      const outDeltaSeconds = timeOutDeltaSeconds(t.timeOut, t.requiredCheckOut);
      const outStatusText = outStatus
        ? `${TIME_OUT_STATUS_LABEL[outStatus]}${outStatus !== "ok" && outDeltaSeconds != null ? ` ${formatDeltaHM(outDeltaSeconds)} hours` : ""}`
        : "—";
      const summary: CellDesc[] = [
        cell(t.technician, { bold: true }),
        cell(t.branch || "—", { color: t.branch ? undefined : GRAY }),
        cell(t.timeIn || "—", { color: t.timeIn ? GREEN : GRAY }),
        cell(t.timeOut || "—", { color: t.timeOut ? RED : GRAY }),
        cell(outStatusText, { color: outStatusColor, bold: !!outStatus && outStatus !== "ok" }),
        cell(t.scheduled, { align: "right" }),
        cell(t.checkedIn, { color: GREEN, align: "right" }),
        cell(t.missingCheckIn, { color: t.missingCheckIn > 0 ? RED : GRAY, bold: t.missingCheckIn > 0, align: "right" }),
        cell(t.missingCheckOut, { color: t.missingCheckOut > 0 ? AMBER : GRAY, bold: t.missingCheckOut > 0, align: "right" }),
      ];
      summary.forEach((c, i) => track(summaryWidths, i, c.text));

      let totalMileage = 0;
      const tickets = t.rows.map((r, i) => {
        const mEntry = mileageByTicketNo.get(r.ticketNo);
        if (mEntry?.legMileage != null) totalMileage += mEntry.legMileage;
        const diagnosis = diagnoses.get(r.ticketId) || "";
        const resolution = resolutions.get(r.ticketId) || "";
        const reschedule = reschedules.get(`${r.ticketId}|${r.scheduleDate}`);
        const dayHasPassed = r.scheduleDate < todayISO;
        const didNotGo = !diagnosis && !r.arrivedAt && dayHasPassed && r.statusGroup !== "cancelled";
        const noDiagnosisFound = !diagnosis && !!r.arrivedAt;
        const diagnosisText = reschedule
          ? `RESCHEDULED: ${reschedule.reason}`
          : diagnosis || (didNotGo ? "DID NOT GO" : noDiagnosisFound ? "NO DIAGNOSIS FOUND" : "—");
        const diagnosisColor = reschedule ? SKY : diagnosis ? undefined : didNotGo ? RED : noDiagnosisFound ? AMBER : GRAY;
        const isDisputed = disputedTicketNosApproved.has(r.ticketNo);
        const arrivedText = r.arrivedAt
          ? new Date(r.arrivedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : isDisputed
          ? "Fixed via dispute"
          : r.statusGroup === "cancelled"
          ? "—"
          : "Missing";
        const arrivedColor = r.arrivedAt ? GREEN : isDisputed ? BLUE : r.statusGroup === "cancelled" ? GRAY : RED;
        const doneText = r.doneAt
          ? new Date(r.doneAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : isDisputed
          ? "Fixed via dispute"
          : !r.arrivedAt || r.statusGroup === "cancelled"
          ? "—"
          : "Missing";
        const doneColor = r.doneAt ? GREEN : isDisputed ? BLUE : !r.arrivedAt || r.statusGroup === "cancelled" ? GRAY : AMBER;
        const row: CellDesc[] = [
          cell(i + 1, { align: "center" }),
          cell(r.ticketNo),
          cell(r.timeSlot ? `${r.timeSlot} · ${r.status}` : r.status),
          cell(r.address || "—"),
          cell(mEntry?.estimateTime || "—", { color: mEntry?.estimateTime ? undefined : GRAY }),
          cell(arrivedText, { color: arrivedColor }),
          cell(doneText, { color: doneColor }),
          cell(mEntry?.legMileage != null ? mEntry.legMileage.toFixed(1) : "—", { align: "right" }),
          (() => {
            const mapLink = stopToStopMapLink(t.rows, i, mEntry?.googleMapLink);
            return cell(mapLink || "—", { color: mapLink ? BLUE : GRAY });
          })(),
          cell(diagnosisText, { color: diagnosisColor, bold: !!reschedule || (!diagnosis && (didNotGo || noDiagnosisFound)) }),
          cell(resolution || "—", { color: resolution ? undefined : GRAY }),
        ];
        row.forEach((c, ci) => track(ticketWidths, ci, c.text));
        return row;
      });
      return { technician: t.technician, summary, tickets, totalMileage };
    });

    // Pass 2: build the HTML now that column widths are known.
    const summaryColgroup = colgroup(summaryWidths);
    const ticketColgroup = colgroup(ticketWidths, MAX_W);
    const parts: string[] = [
      `<h2>Ticket Attendance — ${esc(dateFrom)} to ${esc(dateTo)}</h2>`,
    ];
    for (const t of perTech) {
      parts.push('<table cellspacing="0" cellpadding="4" border="1" style="border-collapse:collapse;margin-bottom:4px;">');
      parts.push(summaryColgroup);
      parts.push(headerRow(summaryHeaders));
      parts.push("<tr>" + t.summary.map((c) => cellHtml(c)).join("") + "</tr>");
      parts.push("</table>");

      parts.push('<table cellspacing="0" cellpadding="4" border="1" style="border-collapse:collapse;margin-bottom:16px;">');
      parts.push(ticketColgroup);
      parts.push(headerRow(ticketHeaders));
      t.tickets.forEach((row) => parts.push("<tr>" + row.map((c, ci) => cellHtml(c, ci)).join("") + "</tr>"));
      parts.push(
        "<tr>" +
          `<td colspan="6" style="text-align:right;font-weight:bold;">Total Mileage</td>` +
          cellHtml(cell(`${t.totalMileage.toFixed(1)} mi`, { bold: true, align: "right" })) +
          `<td colspan="3"></td>` +
          "</tr>"
      );
      parts.push("</table>");
    }
    const html = `<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:12pt;">${parts.join("")}</body></html>`;
    const element = document.createElement("a");
    element.setAttribute("href", "data:application/vnd.ms-excel;charset=utf-8," + encodeURIComponent(html));
    element.setAttribute("download", `ticket-attendance-${dateFrom}_to_${dateTo}.xls`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Shared markup for the three tri-state ("All"/"Has"/"None") header
  // funnel filters (Missing Check-In, Missing Check-Out, Notes) — the
  // Location filter is its own multi-select checklist, built inline above
  // since it doesn't fit this same shape.
  const renderTriStateFilterHeader = (
    key: FilterMenuKey,
    label: string,
    value: TriState,
    setValue: (v: TriState) => void,
    hasLabel: string,
    noneLabel: string,
    align: "left" | "right" = "right"
  ) => (
    <>
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end w-full" : ""}`}>
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
          <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 w-44 bg-slate-900 border border-white/15 rounded-lg shadow-2xl z-50 p-1 normal-case font-normal text-left`}>
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
    <div className="space-y-6">
      <p className="text-xs text-slate-400">
        Did each technician actually check into their scheduled tickets (On-Site Check-In) — a different thing from clock In/Out attendance. A ticket already covered by an approved Ticket Time Dispute doesn't count as missing here.
      </p>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <div className="grid gap-3 md:grid-cols-6 items-end">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Date From</label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Date To</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Search</label>
            <input
              type="text"
              placeholder="Technician or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="present">Present (Time In &amp; Time Out)</option>
              <option value="presentNoTimeOut">Present, No Time Out</option>
              <option value="absent">Absent (No Time In)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={loading || byTechnician.length === 0}
              title="Download this range as a colored Excel (.xls) file"
              className="px-3 py-2 border border-white/15 text-slate-300 hover:bg-white/5 disabled:opacity-40 rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
            >
              <Download className="h-4 w-4" /> Export
            </button>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnMenuOpen((v) => !v)}
              className="w-full px-3 py-2 border border-white/15 text-slate-300 hover:bg-white/5 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-1.5"
            >
              <Columns3 className="h-4 w-4" /> Columns
            </button>
            {columnMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColumnMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-white/15 rounded-lg shadow-2xl z-50 p-2">
                  {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
                    <label key={key} className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleColumns[key]}
                        onChange={() => setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }))}
                        className="h-3.5 w-3.5 accent-blue-500"
                      />
                      {COLUMN_LABELS[key]}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Technician</th>
              {visibleColumns.location && (
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase relative">
                  <span className="inline-flex items-center gap-1">
                    Location
                    <button
                      type="button"
                      onClick={() => setOpenFilterMenu((cur) => (cur === "location" ? null : "location"))}
                      title="Filter by location"
                      className={locationFilter.size > 0 ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}
                    >
                      <Filter className="h-3 w-3" />
                    </button>
                  </span>
                  {openFilterMenu === "location" && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setOpenFilterMenu(null)} />
                      <div className="absolute left-0 top-full mt-1 w-56 max-h-72 overflow-y-auto bg-slate-900 border border-white/15 rounded-lg shadow-2xl z-50 p-2 normal-case font-normal text-left">
                        {branchOptions.length === 0 ? (
                          <div className="text-xs text-slate-500 px-2 py-1.5">No branches on file.</div>
                        ) : (
                          <>
                            {branchOptions.map((b) => (
                              <label key={b} className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5 rounded cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={locationFilter.has(b)}
                                  onChange={() =>
                                    setLocationFilter((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(b)) next.delete(b);
                                      else next.add(b);
                                      return next;
                                    })
                                  }
                                  className="h-3.5 w-3.5 accent-blue-500"
                                />
                                {b}
                              </label>
                            ))}
                            {locationFilter.size > 0 && (
                              <button
                                type="button"
                                onClick={() => setLocationFilter(new Set())}
                                className="mt-1 w-full text-left text-xs text-blue-300 hover:text-blue-200 px-2 py-1"
                              >
                                Clear
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </th>
              )}
              {visibleColumns.timeIn && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Time In</th>}
              {visibleColumns.timeOut && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Time Out</th>}
              {visibleColumns.scheduled && <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Scheduled</th>}
              {visibleColumns.checkedIn && <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Checked In</th>}
              {visibleColumns.missingCheckIn && (
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase relative">
                  {renderTriStateFilterHeader("missingCheckIn", "Missing Check-In", missingCheckInFilter, setMissingCheckInFilter, "Has missing (>0)", "None (0)")}
                </th>
              )}
              {visibleColumns.missingCheckOut && (
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase relative">
                  {renderTriStateFilterHeader("missingCheckOut", "Missing Check-Out", missingCheckOutFilter, setMissingCheckOutFilter, "Has missing (>0)", "None (0)")}
                </th>
              )}
              {visibleColumns.notes && (
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase relative">
                  {renderTriStateFilterHeader("notes", "Notes", notesFilter, setNotesFilter, "Has note", "No note", "left")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleColumnCount} className="px-3 py-8 text-center text-slate-400">Loading ticket attendance…</td></tr>
            ) : byTechnician.length === 0 ? (
              <tr><td colSpan={visibleColumnCount} className="px-3 py-8 text-center text-slate-400">No tickets scheduled in this range.</td></tr>
            ) : byTechnician.map((t) => (
              <Fragment key={t.technician}>
                <tr
                  className="border-b border-white/5 hover:bg-white/5 transition cursor-pointer"
                  onClick={() => setExpandedTech((cur) => (cur === t.technician ? null : t.technician))}
                >
                  <td className="px-3 py-3 text-white font-medium">{t.technician}</td>
                  {visibleColumns.location && (
                    <td className="px-3 py-3 text-slate-300">{t.branch || <span className="text-slate-600">—</span>}</td>
                  )}
                  {visibleColumns.timeIn && (
                    <td className="px-3 py-3">{t.timeIn ? <span className="text-emerald-300">{t.timeIn}</span> : <span className="text-slate-600">—</span>}</td>
                  )}
                  {visibleColumns.timeOut && (
                    <td className="px-3 py-3">
                      {t.timeOut ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-red-300">{t.timeOut}</span>
                          {(() => {
                            const status = timeOutStatus(t.timeOut, t.requiredCheckOut);
                            if (!status) return null;
                            const deltaSeconds = timeOutDeltaSeconds(t.timeOut, t.requiredCheckOut);
                            return (
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIME_OUT_STATUS_CLASS[status]}`}
                                title={
                                  status === "ok"
                                    ? `Within ${ATTENDANCE_GRACE_MINUTES} min of scheduled check-out (${t.requiredCheckOut})`
                                    : status === "overtime"
                                    ? `More than ${ATTENDANCE_GRACE_MINUTES} min after scheduled check-out (${t.requiredCheckOut})`
                                    : `More than ${ATTENDANCE_GRACE_MINUTES} min before scheduled check-out (${t.requiredCheckOut})`
                                }
                              >
                                {TIME_OUT_STATUS_LABEL[status]}
                                {status !== "ok" && deltaSeconds != null && ` ${formatDeltaHM(deltaSeconds)} hours`}
                              </span>
                            );
                          })()}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  )}
                  {visibleColumns.scheduled && <td className="px-3 py-3 text-right text-slate-300">{t.scheduled}</td>}
                  {visibleColumns.checkedIn && <td className="px-3 py-3 text-right text-emerald-300">{t.checkedIn}</td>}
                  {visibleColumns.missingCheckIn && (
                    <td className={`px-3 py-3 text-right font-semibold ${t.missingCheckIn > 0 ? "text-red-300" : "text-slate-500"}`}>{t.missingCheckIn}</td>
                  )}
                  {visibleColumns.missingCheckOut && (
                    <td className={`px-3 py-3 text-right font-semibold ${t.missingCheckOut > 0 ? "text-yellow-300" : "text-slate-500"}`}>{t.missingCheckOut}</td>
                  )}
                  {visibleColumns.notes && (
                    <td className="px-3 py-3 max-w-[220px]" onClick={(e) => e.stopPropagation()}>
                      {!isSingleDay ? (
                        <span className="text-slate-600" title="Switch Date From/Date To to the same day to add a note">—</span>
                      ) : !t.profileId ? (
                        <span className="text-slate-600" title="No matching profile for this technician — can't attach a note">—</span>
                      ) : editingNoteProfileId === t.profileId ? (
                        <div className="flex items-start gap-1">
                          <textarea
                            autoFocus
                            rows={2}
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingNoteProfileId(null);
                            }}
                            placeholder="Why are they absent?"
                            className="w-48 rounded border border-white/15 bg-slate-800 px-1.5 py-1 text-xs text-white placeholder-slate-500 resize-none"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveNote(t.profileId!)}
                            disabled={savingNoteProfileId === t.profileId}
                            className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 mt-1"
                          >
                            {savingNoteProfileId === t.profileId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNoteProfileId(t.profileId);
                            setNoteDraft(t.note);
                          }}
                          className="flex items-start gap-1 text-left text-slate-300 hover:text-white"
                        >
                          {t.note ? <span className="truncate block max-w-[190px]">{t.note}</span> : <span className="text-slate-600">Add note</span>}
                          <Pencil className="h-2.5 w-2.5 text-slate-500 shrink-0 mt-0.5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {expandedTech === t.technician && (
                  <tr>
                    <td colSpan={visibleColumnCount} className="px-3 py-3 bg-white/[0.02]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500">
                            <th className="px-2 py-1 text-left">#</th>
                            <th className="px-2 py-1 text-left">Ticket</th>
                            <th className="px-2 py-1 text-left">Status</th>
                            <th className="px-2 py-1 text-left">Address</th>
                            <th className="px-2 py-1 text-left">Estimate Time</th>
                            <th className="px-2 py-1 text-left">Arrived</th>
                            <th className="px-2 py-1 text-left">Done</th>
                            <th className="px-2 py-1 text-right">Mileage</th>
                            <th className="px-2 py-1 text-left">Map Link</th>
                            <th className="px-2 py-1 text-left">Diagnosis</th>
                            <th className="px-2 py-1 text-left">Resolution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Grouped by date (usually just one — the date filters default to
                              today only) purely to reset stop numbering per day, matching
                              Technician Whereabouts' "Stops" list (so a technician's stop #3
                              there is also row #3 in that day's block here). Check In/Meal/
                              Check Out/Location for the day live in the summary row above,
                              not repeated here. */}
                          {(() => {
                            const dateGroups = new Map<string, TicketAttendanceRow[]>();
                            for (const r of t.rows) {
                              if (!dateGroups.has(r.scheduleDate)) dateGroups.set(r.scheduleDate, []);
                              dateGroups.get(r.scheduleDate)!.push(r);
                            }
                            return Array.from(dateGroups.entries()).map(([date, dateRows]) => {
                              return (
                                <Fragment key={date}>
                                  {dateRows.map((r, i) => {
                                    const mEntry = mileageByTicketNo.get(r.ticketNo);
                                    const diagnosis = diagnoses.get(r.ticketId);
                                    const resolution = resolutions.get(r.ticketId);
                                    const reschedule = reschedules.get(`${r.ticketId}|${r.scheduleDate}`);
                                    // No Cause of Failure recorded (mobile app's required "CAUSE OF
                                    // FAILURE (TECH)" field, per visit). Two distinct empty-diagnosis
                                    // cases: never arrived at all (once the scheduled day has fully
                                    // passed — flagged, not just "pending") vs. arrived (and usually
                                    // done) but simply never wrote up a diagnosis.
                                    const dayHasPassed = r.scheduleDate < todayISO;
                                    const didNotGo = !diagnosis && !r.arrivedAt && dayHasPassed && r.statusGroup !== "cancelled";
                                    const noDiagnosisFound = !diagnosis && !!r.arrivedAt;
                                    const isEditingEstimate = mEntry && editingEstimateTimeId === mEntry.id;
                                    return (
                                      <tr key={r.ticketNo} className="border-t border-white/5">
                                        <td className="px-2 py-1.5 text-slate-500 font-semibold text-center">{i + 1}</td>
                                        <td className="px-2 py-1.5">
                                          <a href={`/ticket/${r.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 hover:underline">
                                            {r.ticketNo}
                                          </a>
                                        </td>
                                        <td className="px-2 py-1.5 text-slate-300">
                                          {r.timeSlot && <span className="text-slate-500">{r.timeSlot} · </span>}
                                          {r.status}
                                        </td>
                                        <td className="px-2 py-1.5 text-slate-400">{r.address || "—"}</td>
                                        <td className="px-2 py-1.5">
                                          {isEditingEstimate ? (
                                            <div className="flex items-center gap-1">
                                              <input
                                                type="text"
                                                autoFocus
                                                value={estimateTimeDraft}
                                                onChange={(e) => setEstimateTimeDraft(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") void handleSaveEstimateTime(mEntry!); if (e.key === "Escape") setEditingEstimateTimeId(null); }}
                                                className="w-20 rounded border border-white/15 bg-slate-800 px-1 py-0.5 text-[11px] text-white"
                                              />
                                              <button
                                                onClick={() => void handleSaveEstimateTime(mEntry!)}
                                                disabled={savingEstimateTimeId === mEntry!.id}
                                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                                              >
                                                {savingEstimateTimeId === mEntry!.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                if (!mEntry) return;
                                                setEditingEstimateTimeId(mEntry.id);
                                                setEstimateTimeDraft(mEntry.estimateTime ?? "");
                                              }}
                                              disabled={!mEntry}
                                              title={mEntry ? "Click to edit" : "Sync mileage first"}
                                              className="flex items-center gap-1 text-slate-300 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed"
                                            >
                                              {mEntry?.estimateTime || <span className="text-slate-600">—</span>}
                                              {mEntry && <Pencil className="h-2.5 w-2.5 text-slate-500 shrink-0" />}
                                            </button>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          {r.arrivedAt ? (
                                            <span className="text-emerald-300">{new Date(r.arrivedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                                          ) : disputedTicketNosApproved.has(r.ticketNo) ? (
                                            <span className="text-blue-300">Fixed via dispute</span>
                                          ) : r.statusGroup === "cancelled" ? (
                                            <span className="text-slate-500">—</span>
                                          ) : (
                                            <span className="text-red-300">Missing</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          {r.doneAt ? (
                                            <span className="text-emerald-300">{new Date(r.doneAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                                          ) : disputedTicketNosApproved.has(r.ticketNo) ? (
                                            <span className="text-blue-300">Fixed via dispute</span>
                                          ) : !r.arrivedAt || r.statusGroup === "cancelled" ? (
                                            <span className="text-slate-500">—</span>
                                          ) : (
                                            <span className="text-yellow-300">Missing</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-slate-300">
                                          {mEntry?.legMileage != null
                                            ? `${mEntry.legMileage.toFixed(1)} mi`
                                            : <span className="text-slate-600">—</span>}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          {(() => {
                                            const mapLink = stopToStopMapLink(dateRows, i, mEntry?.googleMapLink);
                                            return mapLink ? (
                                              <a href={mapLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline">
                                                Open <ExternalLink className="h-3 w-3" />
                                              </a>
                                            ) : (
                                              <span className="text-slate-600">—</span>
                                            );
                                          })()}
                                        </td>
                                        <td className="px-2 py-1.5 max-w-[220px]">
                                          {reschedule ? (
                                            <div className="relative group inline-block max-w-full align-top">
                                              <span className="block truncate text-sky-300 font-semibold cursor-default">RESCHEDULED: {reschedule.reason}</span>
                                              <div className="pointer-events-none absolute left-0 bottom-full z-50 mb-1.5 w-72 max-w-[min(24rem,80vw)] rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-200 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity whitespace-normal">
                                                <p className="text-[9px] font-semibold uppercase tracking-wide text-sky-400 mb-1">Rescheduled by {reschedule.createdByName || "technician"} — {r.ticketNo}</p>
                                                {reschedule.reason}
                                              </div>
                                            </div>
                                          ) : diagnosis ? (
                                            <div className="relative group inline-block max-w-full align-top">
                                              <span className="block truncate text-slate-400 cursor-default">{diagnosis}</span>
                                              <div className="pointer-events-none absolute left-0 bottom-full z-50 mb-1.5 w-72 max-w-[min(24rem,80vw)] rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-200 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity whitespace-normal">
                                                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Diagnosis — {r.ticketNo}</p>
                                                {diagnosis}
                                              </div>
                                            </div>
                                          ) : didNotGo ? (
                                            <span className="text-red-300 font-semibold">DID NOT GO</span>
                                          ) : noDiagnosisFound ? (
                                            <span className="text-amber-300 font-semibold">NO DIAGNOSIS FOUND</span>
                                          ) : (
                                            <span className="text-slate-600">—</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 max-w-[220px]">
                                          {resolution ? (
                                            <div className="relative group inline-block max-w-full align-top">
                                              <span className="block truncate text-slate-400 cursor-default">{resolution}</span>
                                              <div className="pointer-events-none absolute left-0 bottom-full z-50 mb-1.5 w-72 max-w-[min(24rem,80vw)] rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-200 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity whitespace-normal">
                                                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Resolution — {r.ticketNo}</p>
                                                {resolution}
                                              </div>
                                            </div>
                                          ) : (
                                            <span className="text-slate-600">—</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            });
                          })()}
                          <tr className="border-t border-white/10">
                            <td colSpan={6} className="px-2 py-1.5 text-right text-slate-400 font-semibold uppercase tracking-wide text-[10px]">Total Mileage</td>
                            <td className="px-2 py-1.5 text-right text-white font-semibold">
                              {t.rows.reduce((sum, r) => sum + (mileageByTicketNo.get(r.ticketNo)?.legMileage ?? 0), 0).toFixed(1)} mi
                            </td>
                            <td colSpan={4}></td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
