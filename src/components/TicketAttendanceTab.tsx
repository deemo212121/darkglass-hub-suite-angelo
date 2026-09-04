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
import { Download, Loader2, Check, Pencil, ExternalLink } from "lucide-react";
import {
  getCompanyTicketAttendance,
  slotSortKey,
  type TicketAttendanceRow,
} from "@/lib/supabase/technicianWhereabouts";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getVisitDiagnosisByTicketIds } from "@/lib/supabase/tickets";
import { getMileageEntries, setMileageEstimateTime, type MileageEntry } from "@/lib/supabase/mileage";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyEmployeeRequests } from "@/lib/supabase/employeeRequests";
import { ATTENDANCE_GRACE_MINUTES, toSeconds } from "@/lib/attendanceGrace";

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
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<TicketAttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedTech, setExpandedTech] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<CompanyTimecardEntry[]>([]);
  const [diagnoses, setDiagnoses] = useState<Map<string, string>>(new Map());
  const [employees, setEmployees] = useState<ProfileRow[]>([]);
  const [disputedTicketNosApproved, setDisputedTicketNosApproved] = useState<Set<string>>(new Set());
  const [mileageEntries, setMileageEntries] = useState<MileageEntry[]>([]);

  const load = () => {
    setLoading(true);
    Promise.all([
      getCompanyTicketAttendance(dateFrom, dateTo),
      getCompanyTimecardEntries(dateFrom, dateTo).catch((err) => {
        console.error("Failed to load timecard entries for Ticket Attendance:", err);
        return [] as CompanyTimecardEntry[];
      }),
    ])
      .then(([ticketRows, tc]) => {
        setRows(ticketRows);
        setTimecards(tc);
        // Diagnosis text isn't needed to render the tab at all — fetched
        // separately so a slow/failed lookup never blocks the rows/times
        // that ARE already back.
        getVisitDiagnosisByTicketIds(ticketRows.map((r) => r.ticketId))
          .then(setDiagnoses)
          .catch((err) => console.error("Failed to load ticket diagnoses:", err));
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
  const timecardByProfileDate = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    for (const tc of timecards) map.set(`${tc.profileId}|${tc.workDate}`, tc);
    return map;
  }, [timecards]);
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

  const byTechnician = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byTech = new Map<string, TicketAttendanceRow[]>();
    for (const row of rows) {
      if (q && !row.technician.toLowerCase().includes(q)) continue;
      if (!byTech.has(row.technician)) byTech.set(row.technician, []);
      byTech.get(row.technician)!.push(row);
    }
    // Time In/Out only means one specific pair of times when the selected
    // range is a single day — across multiple days there's no one "Time
    // In" to show at the summary level (that's what the per-date rows in
    // the expanded panel below are for).
    const isSingleDay = dateFrom === dateTo;
    return Array.from(byTech.entries())
      .map(([technician, techRows]) => {
        const scheduled = techRows.length;
        const checkedIn = techRows.filter((r) => r.arrivedAt).length;
        const missingCheckIn = techRows.filter((r) => !r.arrivedAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length;
        const missingCheckOut = techRows.filter((r) => r.arrivedAt && !r.doneAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length;
        const employee = employeeByNormalizedName.get(technician.trim().toLowerCase());
        const timecard = isSingleDay && employee ? timecardByProfileDate.get(`${employee.id}|${dateFrom}`) : undefined;
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
        };
      })
      .sort((a, b) => a.technician.localeCompare(b.technician));
  }, [rows, search, disputedTicketNosApproved, employeeByNormalizedName, timecardByProfileDate, dateFrom, dateTo]);

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
    // Address and Diagnosis can carry a long free-text sentence from a
    // single row — without a cap, that one row would stretch the column
    // for every technician/ticket, leaving huge blank space around every
    // short "Missing"/"—" cell in that same column. Cap those two and let
    // them wrap instead; every other column (times, statuses, numbers) is
    // short and fixed-format, so it's safe to fit tightly and keep on one
    // line.
    const WRAP_COLS = new Set([3, 9]); // ticket-table column indexes: Address, Diagnosis
    const MAX_W: Record<number, number> = { 3: 220, 9: 260 };
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

    const summaryHeaders = ["Technician", "Location", "Time In", "Time Out", "Alert", "Scheduled", "Checked In", "Missing Check-In", "Missing Check-Out"];
    const ticketHeaders = ["#", "Ticket", "Status", "Address", "Estimate Time", "Arrived", "Done", "Mileage (mi)", "Map Link", "Diagnosis"];
    const summaryWidths = summaryHeaders.map((h) => h.length);
    const ticketWidths = ticketHeaders.map((h) => h.length);

    // Pass 1: derive every cell's text/color once, tracking the longest
    // entry per column along the way, before any HTML is built.
    const perTech = byTechnician.map((t) => {
      const outStatus = timeOutStatus(t.timeOut, t.requiredCheckOut);
      const outStatusColor = outStatus === "overtime" ? AMBER : outStatus === "undertime" ? RED : outStatus === "ok" ? GREEN : GRAY;
      const summary: CellDesc[] = [
        cell(t.technician, { bold: true }),
        cell(t.branch || "—", { color: t.branch ? undefined : GRAY }),
        cell(t.timeIn || "—", { color: t.timeIn ? GREEN : GRAY }),
        cell(t.timeOut || "—", { color: t.timeOut ? RED : GRAY }),
        cell(outStatus ? TIME_OUT_STATUS_LABEL[outStatus] : "—", { color: outStatusColor, bold: !!outStatus && outStatus !== "ok" }),
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
        const dayHasPassed = r.scheduleDate < todayISO;
        const didNotGo = !diagnosis && !r.arrivedAt && dayHasPassed && r.statusGroup !== "cancelled";
        const noDiagnosisFound = !diagnosis && !!r.arrivedAt;
        const diagnosisText = diagnosis || (didNotGo ? "DID NOT GO" : noDiagnosisFound ? "NO DIAGNOSIS FOUND" : "—");
        const diagnosisColor = diagnosis ? undefined : didNotGo ? RED : noDiagnosisFound ? AMBER : GRAY;
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
          cell(mEntry?.googleMapLink || "—", { color: mEntry?.googleMapLink ? BLUE : GRAY }),
          cell(diagnosisText, { color: diagnosisColor, bold: !diagnosis && (didNotGo || noDiagnosisFound) }),
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
          `<td colspan="2"></td>` +
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

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400">
        Did each technician actually check into their scheduled tickets (On-Site Check-In) — a different thing from clock In/Out attendance. A ticket already covered by an approved Ticket Time Dispute doesn't count as missing here.
      </p>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <div className="grid gap-3 md:grid-cols-4 items-end">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setDateTo(e.target.value);
              }}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Search Technician</label>
            <input
              type="text"
              placeholder="Enter technician name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
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
        </div>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Technician</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Location</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Time In</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Time Out</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Scheduled</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Checked In</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Missing Check-In</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Missing Check-Out</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Loading ticket attendance…</td></tr>
            ) : byTechnician.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No tickets scheduled in this range.</td></tr>
            ) : byTechnician.map((t) => (
              <Fragment key={t.technician}>
                <tr
                  className="border-b border-white/5 hover:bg-white/5 transition cursor-pointer"
                  onClick={() => setExpandedTech((cur) => (cur === t.technician ? null : t.technician))}
                >
                  <td className="px-3 py-3 text-white font-medium">{t.technician}</td>
                  <td className="px-3 py-3 text-slate-300">{t.branch || <span className="text-slate-600">—</span>}</td>
                  <td className="px-3 py-3">{t.timeIn ? <span className="text-emerald-300">{t.timeIn}</span> : <span className="text-slate-600">—</span>}</td>
                  <td className="px-3 py-3">
                    {t.timeOut ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-red-300">{t.timeOut}</span>
                        {(() => {
                          const status = timeOutStatus(t.timeOut, t.requiredCheckOut);
                          if (!status) return null;
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
                            </span>
                          );
                        })()}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-300">{t.scheduled}</td>
                  <td className="px-3 py-3 text-right text-emerald-300">{t.checkedIn}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${t.missingCheckIn > 0 ? "text-red-300" : "text-slate-500"}`}>{t.missingCheckIn}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${t.missingCheckOut > 0 ? "text-yellow-300" : "text-slate-500"}`}>{t.missingCheckOut}</td>
                </tr>
                {expandedTech === t.technician && (
                  <tr>
                    <td colSpan={8} className="px-3 py-3 bg-white/[0.02]">
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
                                          {mEntry?.googleMapLink ? (
                                            <a href={mEntry.googleMapLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline">
                                              Open <ExternalLink className="h-3 w-3" />
                                            </a>
                                          ) : (
                                            <span className="text-slate-600">—</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 max-w-[220px]">
                                          {diagnosis ? (
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
                            <td colSpan={3}></td>
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
