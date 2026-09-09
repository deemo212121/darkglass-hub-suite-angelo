/**
 * HR Dashboard "Calendar" tab — a branch-grouped, day-by-day PTO/time-off
 * tracker modeled on the team's existing CSR Tracker spreadsheet (rows =
 * technician grouped by branch, columns = individual days spanning a couple
 * of months, colored cells mark time off). Cell color reflects how much
 * notice the request gave, the same distinction the spreadsheet's legend
 * uses: requested a week or more ahead ("planned") vs. requested less than
 * a week ahead or a same-day call-out ("late").
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
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import {
  getCompanyPtoRequests,
  createPtoRequest,
  updatePtoRequest,
  updatePtoRequestStatus,
  type PtoRequestRow,
  type PtoType,
} from "@/lib/supabase/pto";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";

export interface CalendarEmployee {
  id: string;
  name: string;
  branch: string;
  status: string;
  role: string;
}

interface Props {
  employees: CalendarEmployee[];
  myProfileId: string | null;
  myDisplayName: string | null;
}

type CellColor = "planned" | "late";

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const PTO_TYPE_LABELS: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};
const PTO_TYPES = Object.keys(PTO_TYPE_LABELS) as PtoType[];

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
  const noticeDays = daysBetween(toDateOnly(r.createdAt), r.startDate);
  return noticeDays >= 7 ? "planned" : "late";
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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getCompanyPtoRequests();
      setRequests(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load time-off requests.");
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
    if (request) {
      setModal({ mode: "view", employee, date, request });
    } else {
      setFormType("vacation");
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
    setModal({ ...modal, mode: "edit" });
  };

  const closeModal = () => {
    setModal(null);
    setFormError(null);
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
      await createPtoRequest({
        profileId: modal.employee.id,
        ptoType: formType,
        startDate: formStart,
        endDate: formEnd,
        reason: formReason,
        requestedBy: myProfileId,
      });
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

  const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <CalendarIcon className="h-4 w-4 text-blue-300" /> Calendar
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
          <span className="h-3 w-3 rounded-sm bg-yellow-400/80 inline-block" /> Requested a week or more in advance
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-red-500/80 inline-block" /> Call-out / requested less than a week ahead
        </span>
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
                <th className="sticky left-0 z-20 bg-slate-900 border-b border-r border-white/10 px-3 py-1.5 text-left font-semibold w-48">
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
                        {e.name}
                      </td>
                      {days.map((d) => {
                        const request = cellsByProfile.get(e.id)?.get(d.date);
                        const color = request ? colorForRequest(request) : undefined;
                        return (
                          <td
                            key={d.date}
                            onClick={() => openCell(e, d.date)}
                            title={request ? `${PTO_TYPE_LABELS[request.ptoType]} — click for details` : "Click to add time off"}
                            className={`border-b border-l border-white/5 h-6 w-7 cursor-pointer hover:ring-1 hover:ring-blue-400/60 hover:ring-inset ${
                              color === "planned"
                                ? "bg-yellow-400/80"
                                : color === "late"
                                ? "bg-red-500/80"
                                : d.date === todayStr
                                ? "bg-blue-500/10"
                                : ""
                            }`}
                          />
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

                {formError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{formError}</p>}

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
