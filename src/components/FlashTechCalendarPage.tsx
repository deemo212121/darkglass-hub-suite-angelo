import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RefreshCw, Plus, X, Trash2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import {
  getCompanyFlashTechTrips,
  createFlashTechTrip,
  updateFlashTechTrip,
  deleteFlashTechTrip,
  type FlashTechTrip,
} from "@/lib/supabase/flashTechTrips";
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CHIP_COLORS = ["bg-blue-500/80", "bg-purple-500/80", "bg-emerald-500/80", "bg-amber-500/80", "bg-pink-500/80", "bg-cyan-500/80"];

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function shiftMonth(monthValue: string, offset: number): string {
  const [y, m] = monthValue.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthLabel(monthValue: string): string {
  const [y, m] = monthValue.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Full weeks (Sun-Sat) covering `monthValue`, including the leading/trailing days of neighboring months needed to complete each row — same shape as WorkCalendarPage.tsx's buildCalendarWeeks(). */
function buildMonthWeeks(monthValue: string): Array<Array<{ date: Date; iso: string; inMonth: boolean }>> {
  const [y, m] = monthValue.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const lastOfMonth = new Date(y, m, 0);
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const end = new Date(lastOfMonth);
  end.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));

  const weeks: Array<Array<{ date: Date; iso: string; inMonth: boolean }>> = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(cursor);
      date.setDate(cursor.getDate() + i);
      return { date, iso: toIso(date), inMonth: date.getMonth() === m - 1 };
    });
    weeks.push(week);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function todayIso(): string {
  return toIso(new Date());
}

type TripFormState = {
  technicianProfileId: string | null;
  technicianName: string;
  originLocation: string;
  destinationLocation: string;
  startDate: string;
  endDate: string;
  notes: string;
  includeHotelExpense: boolean;
  includeTransportationExpense: boolean;
};

function emptyForm(): TripFormState {
  const today = todayIso();
  return {
    technicianProfileId: null,
    technicianName: "",
    originLocation: "",
    destinationLocation: "",
    startDate: today,
    endDate: today,
    notes: "",
    includeHotelExpense: true,
    includeTransportationExpense: true,
  };
}

function expenseBadge(label: string, expense: FlashTechTrip["hotelExpense"]) {
  if (!expense) return null;
  const statusColor =
    expense.status === "Reimbursed"
      ? "text-emerald-300 border-emerald-400/40 bg-emerald-500/10"
      : expense.status === "Approved"
      ? "text-blue-300 border-blue-400/40 bg-blue-500/10"
      : expense.status === "Rejected"
      ? "text-red-300 border-red-400/40 bg-red-500/10"
      : "text-amber-300 border-amber-400/40 bg-amber-500/10";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${statusColor}`}>
      {label}: {expense.status} · ${expense.amount.toFixed(2)}
    </span>
  );
}

export function FlashTechCalendarPage({ mod, sub }: Props) {
  const { uid, role, extraRoles, displayName } = useAuth();
  const canManage = [role, ...extraRoles].some((r) => ["ADMIN", "SUPERADMIN", "FINANCE"].includes(normalizeRole(r)));

  const [monthValue, setMonthValue] = useState(todayMonthValue());
  const [trips, setTrips] = useState<FlashTechTrip[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [form, setForm] = useState<TripFormState>(emptyForm());
  const [technicianQuery, setTechnicianQuery] = useState("");
  const [technicianDropdownOpen, setTechnicianDropdownOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tripRows, userRows] = await Promise.all([getCompanyFlashTechTrips(), getCompanyUsers()]);
      setTrips(tripRows);
      setUsers(userRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!uid) return;
    getMyProfileId(uid).then(setMyProfileId);
  }, [uid]);

  const monthWeeks = useMemo(() => buildMonthWeeks(monthValue), [monthValue]);

  // Sorted once so a given trip always renders in the same color / list
  // position across every day cell it touches.
  const sortedTrips = useMemo(
    () => [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.technicianName.localeCompare(b.technicianName)),
    [trips]
  );
  const tripColorIndex = useMemo(() => new Map(sortedTrips.map((t, i) => [t.id, i % CHIP_COLORS.length])), [sortedTrips]);
  const tripsByDay = useMemo(() => {
    const map = new Map<string, FlashTechTrip[]>();
    for (const week of monthWeeks) {
      for (const day of week) {
        if (!day.inMonth) continue;
        const dayTrips = sortedTrips.filter((t) => t.startDate <= day.iso && t.endDate >= day.iso);
        if (dayTrips.length > 0) map.set(day.iso, dayTrips);
      }
    }
    return map;
  }, [monthWeeks, sortedTrips]);

  const filteredTechnicianOptions = useMemo(() => {
    const q = technicianQuery.trim().toLowerCase();
    const active = users.filter((u) => u.display_name);
    return q ? active.filter((u) => (u.display_name || "").toLowerCase().includes(q)) : active;
  }, [users, technicianQuery]);

  const openCreateModal = () => {
    setEditingTripId(null);
    setForm(emptyForm());
    setTechnicianQuery("");
    setShowModal(true);
  };

  const openEditModal = (trip: FlashTechTrip) => {
    setEditingTripId(trip.id);
    setForm({
      technicianProfileId: trip.technicianProfileId,
      technicianName: trip.technicianName,
      originLocation: trip.originLocation,
      destinationLocation: trip.destinationLocation,
      startDate: trip.startDate,
      endDate: trip.endDate,
      notes: trip.notes || "",
      includeHotelExpense: Boolean(trip.hotelExpense),
      includeTransportationExpense: Boolean(trip.transportationExpense),
    });
    setTechnicianQuery(trip.technicianName);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTripId(null);
  };

  const handleSelectTechnician = (u: ProfileRow) => {
    setForm((f) => ({ ...f, technicianProfileId: u.id, technicianName: u.display_name || u.email }));
    setTechnicianQuery(u.display_name || u.email);
    setTechnicianDropdownOpen(false);
  };

  const handleSave = async () => {
    if (!form.technicianName.trim()) return alert("Pick a technician.");
    if (!form.originLocation.trim() || !form.destinationLocation.trim()) return alert("Enter both origin and destination.");
    if (form.endDate < form.startDate) return alert("End date can't be before the start date.");

    setSaving(true);
    try {
      if (editingTripId) {
        await updateFlashTechTrip(editingTripId, {
          technicianProfileId: form.technicianProfileId,
          technicianName: form.technicianName.trim(),
          originLocation: form.originLocation.trim(),
          destinationLocation: form.destinationLocation.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          notes: form.notes,
        });
      } else {
        await createFlashTechTrip({
          technicianProfileId: form.technicianProfileId,
          technicianName: form.technicianName.trim(),
          originLocation: form.originLocation.trim(),
          destinationLocation: form.destinationLocation.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          notes: form.notes,
          createdBy: myProfileId,
          createdByName: displayName,
          includeHotelExpense: form.includeHotelExpense,
          includeTransportationExpense: form.includeTransportationExpense,
        });
      }
      closeModal();
      await loadData();
    } catch (err) {
      alert(`Failed to save trip: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTripId) return;
    if (!window.confirm("Remove this trip from the calendar? Any linked expense rows stay in Expense Tracking, just unlinked.")) return;
    setDeleting(true);
    try {
      await deleteFlashTechTrip(editingTripId);
      closeModal();
      await loadData();
    } catch (err) {
      alert(`Failed to delete trip: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeleting(false);
    }
  };

  const editingTrip = editingTripId ? trips.find((t) => t.id === editingTripId) ?? null : null;

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1600px] mx-auto px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-white">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </Link>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-2 btn hover:bg-white/15 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading…" : "Refresh"}
          </button>
          {canManage && (
            <button onClick={openCreateModal} className="btn btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Schedule Trip
            </button>
          )}
        </div>

        {!canManage && (
          <div className="panel mb-4 text-sm text-slate-300">
            Only SuperAdmin, Admin, and Accounting can schedule or edit trips here — you can still view the calendar.
          </div>
        )}

        <div className="mb-4 flex items-center gap-3">
          <button onClick={() => setMonthValue((m) => shiftMonth(m, -1))} className="btn">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-lg font-semibold text-white min-w-[180px] text-center">{monthLabel(monthValue)}</div>
          <button onClick={() => setMonthValue((m) => shiftMonth(m, 1))} className="btn">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={() => setMonthValue(todayMonthValue())} className="btn text-sm">
            Today
          </button>
        </div>

        <div className="panel overflow-x-auto p-0">
          <table className="w-full text-sm border-collapse table-fixed">
            <thead>
              <tr className="bg-slate-700/80">
                {WEEKDAY_LABELS.map((d, i) => (
                  <th
                    key={d}
                    className={`px-2 py-1.5 text-xs font-semibold text-center border-r border-white/10 last:border-r-0 ${
                      i === 0 || i === 6 ? "text-blue-300" : "text-slate-200"
                    }`}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : (
                monthWeeks.map((week) => (
                  <tr key={week[0].iso} className="border-b border-white/10">
                    {week.map((day, dow) => {
                      const dayTrips = tripsByDay.get(day.iso) ?? [];
                      const isToday = day.iso === todayIso();
                      return (
                        <td
                          key={day.iso}
                          className={`px-1.5 py-1 border-r border-white/10 last:border-r-0 align-top h-14 max-h-14 overflow-hidden ${
                            !day.inMonth ? "bg-white/2" : ""
                          }`}
                        >
                          <div
                            className={`text-[10px] font-medium text-right mb-0.5 ${
                              isToday
                                ? "text-blue-400 font-bold"
                                : !day.inMonth
                                ? "text-slate-600"
                                : dow === 0 || dow === 6
                                ? "text-blue-300"
                                : "text-slate-400"
                            }`}
                          >
                            {day.date.getDate()}
                          </div>
                          <div className="space-y-0.5">
                            {dayTrips.slice(0, 2).map((trip) => (
                              <button
                                key={trip.id}
                                onClick={() => (canManage ? openEditModal(trip) : undefined)}
                                title={`${trip.technicianName}: ${trip.originLocation} → ${trip.destinationLocation} (${trip.startDate} – ${trip.endDate})${
                                  canManage ? " — click to edit" : ""
                                }`}
                                className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight text-white ${
                                  CHIP_COLORS[tripColorIndex.get(trip.id) ?? 0]
                                } ${canManage ? "cursor-pointer hover:brightness-110" : "cursor-default"}`}
                              >
                                {trip.technicianName}
                              </button>
                            ))}
                            {dayTrips.length > 2 && (
                              <div className="text-[10px] text-slate-400 px-1">+{dayTrips.length - 2} more</div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!loading && tripsByDay.size === 0 && (
            <div className="py-6 text-center text-slate-400 text-sm border-t border-white/10">
              No flash tech trips scheduled for {monthLabel(monthValue)}.
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeModal}>
          <div className="panel w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{editingTripId ? "Edit Trip" : "Schedule Trip"}</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <label className="text-xs font-semibold uppercase text-slate-400">Technician</label>
                <input
                  value={technicianQuery}
                  onChange={(e) => {
                    setTechnicianQuery(e.target.value);
                    setForm((f) => ({ ...f, technicianProfileId: null, technicianName: e.target.value }));
                    setTechnicianDropdownOpen(true);
                  }}
                  onFocus={() => setTechnicianDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setTechnicianDropdownOpen(false), 150)}
                  placeholder="Search by name..."
                  className="glass-input mt-1 w-full"
                />
                {technicianDropdownOpen && filteredTechnicianOptions.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-white/15 bg-slate-900 shadow-lg">
                    {filteredTechnicianOptions.slice(0, 50).map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={() => handleSelectTechnician(u)}
                        className="block w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-white/10"
                      >
                        {u.display_name || u.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Origin</label>
                  <input
                    value={form.originLocation}
                    onChange={(e) => setForm((f) => ({ ...f, originLocation: e.target.value }))}
                    placeholder="e.g. Jackson, MS"
                    className="glass-input mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Destination</label>
                  <input
                    value={form.destinationLocation}
                    onChange={(e) => setForm((f) => ({ ...f, destinationLocation: e.target.value }))}
                    placeholder="e.g. New Orleans"
                    className="glass-input mt-1 w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="glass-input mt-1 w-full"
                />
              </div>

              {!editingTripId && (
                <div className="rounded-lg border border-white/10 p-3 space-y-2">
                  <p className="text-xs text-slate-400">
                    Creates matching Pending expense rows in Expense Tracking — amount/receipt filled in later once the actual cost is known.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={form.includeHotelExpense}
                      onChange={(e) => setForm((f) => ({ ...f, includeHotelExpense: e.target.checked }))}
                      className="h-4 w-4 accent-blue-500"
                    />
                    Add Hotel expense
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={form.includeTransportationExpense}
                      onChange={(e) => setForm((f) => ({ ...f, includeTransportationExpense: e.target.checked }))}
                      className="h-4 w-4 accent-blue-500"
                    />
                    Add Transportation expense
                  </label>
                </div>
              )}

              {editingTrip && (editingTrip.hotelExpense || editingTrip.transportationExpense) && (
                <div className="flex flex-wrap gap-2">
                  {expenseBadge("Hotel", editingTrip.hotelExpense)}
                  {expenseBadge("Transportation", editingTrip.transportationExpense)}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center gap-2">
              {editingTripId && (
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting || saving}
                  className="btn btn-danger inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Removing…" : "Remove"}
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button onClick={closeModal} className="btn">
                  Cancel
                </button>
                <button onClick={() => void handleSave()} disabled={saving || deleting} className="btn btn-primary disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
