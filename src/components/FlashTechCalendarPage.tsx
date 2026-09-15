import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RefreshCw, Plus, X, Trash2, CalendarDays, Table2, Paperclip, Loader2, Car, Users, Check, Minus } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { normalizeRole, isEligibleForTechnicianFormChecklist } from "@/lib/roleLabels";
import { getCompanyUsers, getMyProfileId, getTechnicianContactInfoByIds, type ProfileRow } from "@/lib/supabase/users";
import {
  getCompanyFlashTechTrips,
  createFlashTechTrip,
  updateFlashTechTrip,
  deleteFlashTechTrip,
  updateFlashTechTripTrackerFields,
  updateFlashTechTripTechnician,
  uploadFlashTechTripReceipt,
  removeFlashTechTripReceipt,
  FLASH_TECH_MAX_RECEIPTS,
  FLASH_TECH_TIER_LEVELS,
  FLASH_TECH_TRIP_TYPES,
  FLASH_TECH_STATUSES,
  type FlashTechTrip,
} from "@/lib/supabase/flashTechTrips";
import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";
import { REGIONS, REGION_LOCATIONS } from "@/lib/locations";
import { getSignableDocuments } from "@/lib/supabase/signableDocuments";
import { getDocumentReviewStatus, pickAuthoritativeDocument, type DocumentReviewStatus } from "@/lib/signableDocumentRegistry";
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CHIP_COLORS = ["bg-blue-500/80", "bg-purple-500/80", "bg-emerald-500/80", "bg-amber-500/80", "bg-pink-500/80", "bg-cyan-500/80"];
// Every real branch, for the Destination dropdown.
const ALL_BRANCHES = REGIONS.flatMap((r) => REGION_LOCATIONS[r]);

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
  /** Rendered inside another page's tab (Accounting Dashboard's Flash Tech
   *  tab) instead of as its own standalone page reached from Expense
   *  Tracking — suppresses this component's own page chrome (back-link,
   *  title/description, outer page padding) since the host page already
   *  provides those. The calendar + Schedule Trip submission flow is
   *  unchanged either way. */
  embedded?: boolean;
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
  carRentalNeeded: boolean;
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
    carRentalNeeded: false,
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

export function FlashTechCalendarPage({ mod, sub, embedded }: Props) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, role, extraRoles, displayName, companyId } = useAuth();
  const canManage = [role, ...extraRoles].some((r) => ["ADMIN", "SUPERADMIN", "FINANCE"].includes(normalizeRole(r)));
  // Tracker fields (everything beyond scheduling itself) are also editable
  // by HR — see migration 0257's widened update policy.
  const canEditTracker = canManage || [role, ...extraRoles].some((r) => normalizeRole(r) === "HR");

  const [view, setView] = useState<"calendar" | "tracker" | "availability">("calendar");
  const [availabilitySearch, setAvailabilitySearch] = useState("");
  const [availabilityStatusFilter, setAvailabilityStatusFilter] = useState<"all" | "available" | "busy" | "needsForm">("all");
  const [monthValue, setMonthValue] = useState(todayMonthValue());
  const [trips, setTrips] = useState<FlashTechTrip[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  // Each technician's Flash Technician Travel & Out-of-State Policy review
  // status (same "not_sent"/"awaiting_employee"/"awaiting_hr"/"done" states
  // Staff Form Checklist uses) — the Flash Tech List's own "Available"
  // status is meaningless for sending someone out if they haven't cleared
  // this form yet, and the Schedule Trip technician picker shows it as a
  // check/dash/X per person.
  const [flashFormStatusByProfileId, setFlashFormStatusByProfileId] = useState<Map<string, DocumentReviewStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [form, setForm] = useState<TripFormState>(emptyForm());
  const [technicianQuery, setTechnicianQuery] = useState("");
  const [technicianDropdownOpen, setTechnicianDropdownOpen] = useState(false);
  // The selected technician's home address — display-only, alongside their
  // (also auto-filled, locked) Origin branch. Fetched on selection since
  // the technician list itself (getCompanyUsers) doesn't carry it.
  const [technicianAddress, setTechnicianAddress] = useState("");
  const [technicianPhone, setTechnicianPhone] = useState("");
  const [technicianEmail, setTechnicianEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Tracker view (migration 0257) — per-cell edits, not the Schedule Trip
  // modal's full-form save. `savingCellKey` is `${tripId}:${field}`, just
  // for the small inline spinner on whichever cell is mid-save. ──
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [uploadingReceiptId, setUploadingReceiptId] = useState<string | null>(null);
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);
  // The trip a freshly-created Schedule Trip save just landed in the
  // Tracker on — scrolled to and briefly highlighted so it's obvious which
  // row to keep filling in, then cleared after a few seconds.
  const [highlightTripId, setHighlightTripId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightTripId) return;
    const t = setTimeout(() => setHighlightTripId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightTripId]);

  const patchTrip = async (tripId: string, field: string, patch: Parameters<typeof updateFlashTechTripTrackerFields>[1]) => {
    const key = `${tripId}:${field}`;
    setSavingCellKey(key);
    try {
      await updateFlashTechTripTrackerFields(tripId, patch);
      setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, ...patch } as FlashTechTrip : t)));
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingCellKey((k) => (k === key ? null : k));
    }
  };

  const handleChangeTechnician = async (tripId: string, technicianProfileId: string | null, technicianName: string) => {
    const key = `${tripId}:technician`;
    setSavingCellKey(key);
    try {
      await updateFlashTechTripTechnician(tripId, technicianProfileId, technicianName);
      setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, technicianProfileId, technicianName } : t)));
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingCellKey((k) => (k === key ? null : k));
    }
  };

  const handleUploadReceipt = async (trip: FlashTechTrip, file: File) => {
    if (!companyId) return;
    if (trip.receiptPaths.length >= FLASH_TECH_MAX_RECEIPTS) {
      alert(`Up to ${FLASH_TECH_MAX_RECEIPTS} receipts per trip.`);
      return;
    }
    setUploadingReceiptId(trip.id);
    try {
      const nextPaths = await uploadFlashTechTripReceipt(companyId, trip.id, file, trip.receiptPaths);
      setTrips((prev) => prev.map((t) => (t.id === trip.id ? { ...t, receiptPaths: nextPaths } : t)));
    } catch (err) {
      alert(`Failed to upload receipt: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploadingReceiptId(null);
    }
  };

  const handleRemoveReceipt = async (trip: FlashTechTrip, receiptUrl: string) => {
    if (!window.confirm("Remove this receipt?")) return;
    setUploadingReceiptId(trip.id);
    try {
      const nextPaths = await removeFlashTechTripReceipt(trip.id, receiptUrl, trip.receiptPaths);
      setTrips((prev) => prev.map((t) => (t.id === trip.id ? { ...t, receiptPaths: nextPaths } : t)));
    } catch (err) {
      alert(`Failed to remove receipt: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploadingReceiptId(null);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [tripRows, userRows, flashFormDocs] = await Promise.all([
        getCompanyFlashTechTrips(),
        getCompanyUsers(),
        getSignableDocuments("flash_technician_travel"),
      ]);
      setTrips(tripRows);
      setUsers(userRows);

      // Group by person (formData.employeeId, same "whose form is this"
      // identity every other checklist uses — falls back to recipientId for
      // older rows sent before that field existed), then pick whichever
      // submission actually represents the best status reached, same as
      // TechnicianFormChecklistPage.tsx does for every other form type.
      const byPerson = new Map<string, typeof flashFormDocs>();
      for (const d of flashFormDocs) {
        const personId = (d.formData as Record<string, any> | undefined)?.employeeId || d.recipientId;
        if (!personId) continue;
        const arr = byPerson.get(personId);
        if (arr) arr.push(d);
        else byPerson.set(personId, [d]);
      }
      const statusByPerson = new Map<string, DocumentReviewStatus>();
      for (const [personId, group] of byPerson) {
        const best = pickAuthoritativeDocument(group);
        statusByPerson.set(personId, getDocumentReviewStatus("flash_technician_travel", best));
      }
      setFlashFormStatusByProfileId(statusByPerson);
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
    const active = users.filter((u) => u.is_active && u.display_name);
    return q ? active.filter((u) => (u.display_name || "").toLowerCase().includes(q)) : active;
  }, [users, technicianQuery]);

  // "Available for flash tech" right now — narrowed to actual field
  // technicians (same eligibility check TechnicianFormChecklistPage.tsx's
  // own "Technician" roster and the Flash Technician Travel form use), NOT
  // the broader "any active staff member" pool the Schedule Trip picker
  // itself still offers (a trip can still be scheduled for a Branch
  // Manager covering another branch — this list just isn't the place to
  // surface non-field staff as "available"/"needs a form" for that).
  // Further narrowed to technicians who actually have at least one Flash
  // Tech Tracker record (past or current trip) — this list tracks the
  // people already in the flash tech program, not the whole technician
  // roster company-wide. Split by whether they're mid-trip TODAY
  // specifically (not just "in this month", since the calendar can browse
  // other months while this answers "who's free to send out as of right
  // now").
  const technicianAvailability = useMemo(() => {
    const today = todayIso();
    const trackedProfileIds = new Set(trips.map((t) => t.technicianProfileId).filter((id): id is string => !!id));
    const active = users.filter(
      (u) => u.is_active && u.display_name && isEligibleForTechnicianFormChecklist(u.role, u.extra_roles) && trackedProfileIds.has(u.id)
    );
    const tripByProfileId = new Map<string, FlashTechTrip>();
    for (const t of trips) {
      if (t.technicianProfileId && t.startDate <= today && t.endDate >= today) tripByProfileId.set(t.technicianProfileId, t);
    }
    return active
      .map((u) => ({ user: u, trip: tripByProfileId.get(u.id) ?? null, formFiled: flashFormStatusByProfileId.get(u.id) === "done" }))
      .sort((a, b) => {
        // Busy last, then "needs form" (not actually sendable), then
        // Available — alphabetical within each group.
        const rank = (x: (typeof a)) => (x.trip ? 2 : x.formFiled ? 0 : 1);
        const rankDiff = rank(a) - rank(b);
        if (rankDiff !== 0) return rankDiff;
        return (a.user.display_name || "").localeCompare(b.user.display_name || "");
      });
  }, [users, trips, flashFormStatusByProfileId]);

  const filteredTechnicianAvailability = useMemo(() => {
    const q = availabilitySearch.trim().toLowerCase();
    return technicianAvailability.filter(({ user, trip, formFiled }) => {
      if (availabilityStatusFilter === "available" && (trip || !formFiled)) return false;
      if (availabilityStatusFilter === "busy" && !trip) return false;
      if (availabilityStatusFilter === "needsForm" && (trip || formFiled)) return false;
      if (q && !(user.display_name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [technicianAvailability, availabilitySearch, availabilityStatusFilter]);

  // Completed trips — endDate already before today, so they're no longer
  // what's keeping anyone off the Available list above. Newest-ended first.
  const flashTechHistory = useMemo(() => {
    const today = todayIso();
    return [...trips].filter((t) => t.endDate < today).sort((a, b) => b.endDate.localeCompare(a.endDate));
  }, [trips]);

  const openCreateModal = () => {
    setEditingTripId(null);
    setForm(emptyForm());
    setTechnicianQuery("");
    setTechnicianAddress("");
    setTechnicianPhone("");
    setTechnicianEmail("");
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
      carRentalNeeded: trip.carRentalNeeded,
      includeHotelExpense: Boolean(trip.hotelExpense),
      includeTransportationExpense: Boolean(trip.transportationExpense),
    });
    setTechnicianQuery(trip.technicianName);
    setTechnicianAddress("");
    setTechnicianPhone(trip.technicianPhone || "");
    setTechnicianEmail(trip.technicianEmail || "");
    if (trip.technicianProfileId) {
      getTechnicianContactInfoByIds([trip.technicianProfileId]).then((map) => {
        setTechnicianAddress(map.get(trip.technicianProfileId!)?.address || "");
      });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTripId(null);
  };

  const handleSelectTechnician = (u: ProfileRow) => {
    // Origin locks to wherever they actually belong — not free-typed, so a
    // trip's origin always reflects their real assigned branch.
    setForm((f) => ({ ...f, technicianProfileId: u.id, technicianName: u.display_name || u.email, originLocation: u.assigned_branch || "" }));
    setTechnicianQuery(u.display_name || u.email);
    setTechnicianDropdownOpen(false);
    setTechnicianAddress("");
    setTechnicianPhone("");
    setTechnicianEmail("");
    getTechnicianContactInfoByIds([u.id]).then((map) => {
      const info = map.get(u.id);
      setTechnicianAddress(info?.address || "");
      setTechnicianPhone(info?.phone || "");
      setTechnicianEmail(info?.email || "");
    });
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
          carRentalNeeded: form.carRentalNeeded,
        });
        closeModal();
        await loadData();
      } else {
        const newTripId = await createFlashTechTrip({
          technicianProfileId: form.technicianProfileId,
          technicianName: form.technicianName.trim(),
          technicianPhone,
          technicianEmail,
          originLocation: form.originLocation.trim(),
          destinationLocation: form.destinationLocation.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          notes: form.notes,
          carRentalNeeded: form.carRentalNeeded,
          createdBy: myProfileId,
          createdByName: displayName,
          includeHotelExpense: form.includeHotelExpense,
          includeTransportationExpense: form.includeTransportationExpense,
        });
        closeModal();
        await loadData();
        // Most of the Tracker's columns (hotel/rental/receipts/etc.) aren't
        // known yet at scheduling time — jump straight to that new row in
        // the Tracker instead of leaving HR to go find it, so filling the
        // rest in is one continuous flow rather than a separate hunt.
        setView("tracker");
        setHighlightTripId(newTripId);
      }
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
    <main className={embedded ? "" : "flex-1 bg-slate-950 py-6"}>
      <div className={embedded ? "" : "max-w-[1600px] mx-auto px-6"}>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-white">
          {!embedded && (
            <button onClick={goBack} className="btn">
              <ChevronLeft className="h-4 w-4" />
              {mod.label}
            </button>
          )}
          {!embedded && (
            <div>
              <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
              <p className="text-sm text-muted-foreground">{sub.description}</p>
            </div>
          )}
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
            Only SuperAdmin, Admin, and Accounting can schedule or edit trips here — you can still view the calendar
            {canEditTracker ? " and fill in the Tracker below" : ""}.
          </div>
        )}

        <div className="flex gap-1.5 mb-4">
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "calendar" ? "bg-primary/20 text-primary" : ""}`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Calendar
          </button>
          <button
            type="button"
            onClick={() => setView("tracker")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "tracker" ? "bg-primary/20 text-primary" : ""}`}
          >
            <Table2 className="h-3.5 w-3.5" /> Tracker
          </button>
          <button
            type="button"
            onClick={() => setView("availability")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "availability" ? "bg-primary/20 text-primary" : ""}`}
          >
            <Users className="h-3.5 w-3.5" /> Flash Tech List
          </button>
        </div>

        {view === "calendar" && (
        <>
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
                                  trip.carRentalNeeded ? " — car rental needed" : ""
                                }${canManage ? " — click to edit" : ""}`}
                                className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight text-white ${
                                  CHIP_COLORS[tripColorIndex.get(trip.id) ?? 0]
                                } ${canManage ? "cursor-pointer hover:brightness-110" : "cursor-default"}`}
                              >
                                <span className="truncate">{trip.technicianName}</span>
                                {trip.carRentalNeeded && (
                                  <span className="ml-auto inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-400">
                                    <Car className="h-2.5 w-2.5 text-slate-900" strokeWidth={2.5} />
                                  </span>
                                )}
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
        </>
        )}

        {view === "tracker" && (
          <FlashTechTrackerTable
            trips={sortedTrips}
            users={users}
            loading={loading}
            canEdit={canEditTracker}
            savingCellKey={savingCellKey}
            uploadingReceiptId={uploadingReceiptId}
            highlightTripId={highlightTripId}
            onPatch={patchTrip}
            onChangeTechnician={handleChangeTechnician}
            onUploadReceipt={handleUploadReceipt}
            onRemoveReceipt={handleRemoveReceipt}
            onPreviewReceipt={setPreviewReceiptUrl}
          />
        )}

        {view === "availability" && (
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Flash Tech List</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Who's free to send out on a flash tech trip today ({todayIso()}) vs already out on one.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/10">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Search</label>
                <input
                  type="text"
                  value={availabilitySearch}
                  onChange={(e) => setAvailabilitySearch(e.target.value)}
                  placeholder="Technician name…"
                  className="w-48 rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Status</label>
                <select
                  value={availabilityStatusFilter}
                  onChange={(e) => setAvailabilityStatusFilter(e.target.value as typeof availabilityStatusFilter)}
                  className="rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All</option>
                  <option value="available">Available</option>
                  <option value="needsForm">Form Not Filed</option>
                  <option value="busy">On Trip</option>
                </select>
              </div>
              {(availabilitySearch || availabilityStatusFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => { setAvailabilitySearch(""); setAvailabilityStatusFilter("all"); }}
                  className="text-xs text-blue-400 hover:text-blue-300 mt-4"
                >
                  Reset filters
                </button>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground self-end pb-1.5">
                {filteredTechnicianAvailability.length} of {technicianAvailability.length}
              </span>
            </div>
            {loading ? (
              <div className="py-10 text-center text-slate-400 text-sm">Loading…</div>
            ) : filteredTechnicianAvailability.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-sm">
                {technicianAvailability.length === 0 ? "No active technicians found." : "No technicians match that filter."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="px-4 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Technician</th>
                      <th className="px-4 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Origin</th>
                      <th className="px-4 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Destination</th>
                      <th className="px-4 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredTechnicianAvailability.map(({ user, trip, formFiled }) => (
                      <tr key={user.id}>
                        <td className="px-4 py-2.5 text-sm text-white truncate max-w-[220px]">{user.display_name}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-300">{trip ? trip.originLocation : <span className="text-slate-600">—</span>}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-300">{trip ? trip.destinationLocation : <span className="text-slate-600">—</span>}</td>
                        <td className="px-4 py-2.5 text-right">
                          {trip ? (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs text-blue-300"
                              title={`${trip.startDate} – ${trip.endDate}`}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" /> On Trip — back {trip.endDate}
                            </span>
                          ) : !formFiled ? (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300"
                              title="Flash Technician Travel & Out-of-State Policy form isn't on file (or still awaiting HR review)"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Form Not Filed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Available
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === "availability" && (
          <div className="panel p-0 overflow-hidden mt-4">
            <div className="px-4 py-3 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Flash Tech History</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Every completed trip (end date already passed), most recent first.</p>
            </div>
            {loading ? (
              <div className="py-10 text-center text-slate-400 text-sm">Loading…</div>
            ) : flashTechHistory.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-sm">No completed flash tech trips yet.</div>
            ) : (
              <ul className="divide-y divide-white/10 max-h-[28rem] overflow-y-auto">
                {flashTechHistory.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm text-white truncate block">{t.technicianName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {t.originLocation} → {t.destinationLocation} · {t.startDate} – {t.endDate} · {t.tripType}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-slate-300">{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {previewReceiptUrl && (
        <AttachmentPreviewModal url={previewReceiptUrl} title="Receipt" onClose={() => setPreviewReceiptUrl(null)} />
      )}

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
                    {filteredTechnicianOptions.slice(0, 50).map((u) => {
                      const formStatus = flashFormStatusByProfileId.get(u.id) ?? "not_sent";
                      const badge =
                        formStatus === "done"
                          ? { icon: <Check className="h-2.5 w-2.5" />, cls: "bg-emerald-500/20 text-emerald-400", title: "Flash Technician Travel form on file" }
                          : formStatus === "awaiting_hr"
                          ? { icon: <Minus className="h-2.5 w-2.5" />, cls: "bg-amber-500/20 text-amber-400", title: "Flash Technician Travel form submitted — awaiting HR review" }
                          : { icon: <X className="h-2.5 w-2.5" />, cls: "bg-red-500/20 text-red-400", title: "Flash Technician Travel form not on file — can still be scheduled" };
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onMouseDown={() => handleSelectTechnician(u)}
                          title={badge.title}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-white/10"
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${badge.cls}`}>{badge.icon}</span>
                          <span className="truncate">{u.display_name || u.email}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Origin</label>
                  <select
                    value={form.originLocation}
                    onChange={(e) => setForm((f) => ({ ...f, originLocation: e.target.value }))}
                    title="Defaults to the technician's assigned branch — change it if they're actually starting from somewhere else (e.g. still out on a prior trip)"
                    className="glass-input mt-1 w-full"
                  >
                    <option value="">Select branch…</option>
                    {ALL_BRANCHES.filter((b) => b !== form.destinationLocation).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Destination</label>
                  <select
                    value={form.destinationLocation}
                    onChange={(e) => setForm((f) => ({ ...f, destinationLocation: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  >
                    <option value="">Select branch…</option>
                    {ALL_BRANCHES.filter((b) => b !== form.originLocation).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Technician Address</label>
                <input
                  value={technicianAddress}
                  readOnly
                  disabled
                  placeholder={form.technicianProfileId ? "No home address on file for this technician" : "Pick a technician from the search results first"}
                  title="The technician's own home address on file — not editable here"
                  className="glass-input mt-1 w-full cursor-not-allowed opacity-70"
                />
                {technicianQuery && !form.technicianProfileId && (
                  <p className="mt-1 text-[11px] text-amber-300">
                    Not linked to a real technician profile — click the search box above and pick a name from the dropdown, or this trip won't apply to their mobile route.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Contact Number</label>
                  <input
                    value={technicianPhone}
                    readOnly
                    disabled
                    placeholder={form.technicianProfileId ? "No phone number on file for this technician" : "Pick a technician from the search results first"}
                    title="The technician's own phone number on file — editable afterward in the Tracker"
                    className="glass-input mt-1 w-full cursor-not-allowed opacity-70"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Email Address</label>
                  <input
                    value={technicianEmail}
                    readOnly
                    disabled
                    placeholder={form.technicianProfileId ? "No email on file for this technician" : "Pick a technician from the search results first"}
                    title="The technician's own email on file — editable afterward in the Tracker"
                    className="glass-input mt-1 w-full cursor-not-allowed opacity-70"
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

              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Car Rental Needed</label>
                <div className="mt-1 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, carRentalNeeded: true }))}
                    className={`btn text-sm px-3 py-1.5 flex-1 ${form.carRentalNeeded ? "bg-primary/20 text-primary" : ""}`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, carRentalNeeded: false }))}
                    className={`btn text-sm px-3 py-1.5 flex-1 ${!form.carRentalNeeded ? "bg-primary/20 text-primary" : ""}`}
                  >
                    No
                  </button>
                </div>
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

// ── Tracker view — spreadsheet-style follow-up detail, per trip ─────────
// (migration 0257). Name/Origin/Destination/Travel Date come from the
// calendar's own Schedule Trip modal and are read-only here; everything
// else is a per-cell inline editor, saved independently on blur/change so
// one field's edit never risks another's in-flight value.

type TrackerPatch = Parameters<typeof updateFlashTechTripTrackerFields>[1];

function TrackerTextCell({ value, placeholder, disabled, onSave }: { value: string; placeholder?: string; disabled?: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      className="w-full min-w-[120px] bg-transparent text-xs px-1.5 py-1 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
    />
  );
}

function TrackerNumberCell({ value, disabled, onSave }: { value: number | null; disabled?: boolean; onSave: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  useEffect(() => setDraft(value != null ? String(value) : ""), [value]);
  const commit = () => {
    const n = draft.trim() === "" ? null : Number(draft);
    if ((n == null ? null : n) !== value) onSave(Number.isFinite(n as number) ? n : null);
  };
  return (
    <input
      type="number"
      step="0.01"
      value={draft}
      disabled={disabled}
      placeholder="0.00"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className="w-full min-w-[80px] bg-transparent text-xs px-1.5 py-1 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
    />
  );
}

function TrackerDateRangeCell({
  start,
  end,
  disabled,
  onSaveStart,
  onSaveEnd,
}: {
  start: string | null;
  end: string | null;
  disabled?: boolean;
  onSaveStart: (v: string | null) => void;
  onSaveEnd: (v: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[130px]">
      <input
        type="date"
        value={start || ""}
        disabled={disabled}
        onChange={(e) => onSaveStart(e.target.value || null)}
        className="w-full bg-transparent text-[11px] px-1 py-0.5 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
      />
      <input
        type="date"
        value={end || ""}
        disabled={disabled}
        onChange={(e) => onSaveEnd(e.target.value || null)}
        className="w-full bg-transparent text-[11px] px-1 py-0.5 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
      />
    </div>
  );
}

function TrackerSelectCell({ value, options, disabled, onSave }: { value: string; options: readonly string[]; disabled?: boolean; onSave: (v: string) => void }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onSave(e.target.value)}
      className="w-full min-w-[100px] bg-slate-900 text-xs px-1.5 py-1 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-slate-900">
          {o}
        </option>
      ))}
    </select>
  );
}

const TRACKER_STATUS_COLOR: Record<string, string> = {
  Open: "text-emerald-300",
  Closed: "text-slate-400",
  Pending: "text-amber-300",
};

function FlashTechTrackerTable({
  trips,
  users,
  loading,
  canEdit,
  savingCellKey,
  uploadingReceiptId,
  highlightTripId,
  onPatch,
  onChangeTechnician,
  onUploadReceipt,
  onRemoveReceipt,
  onPreviewReceipt,
}: {
  trips: FlashTechTrip[];
  users: ProfileRow[];
  loading: boolean;
  canEdit: boolean;
  savingCellKey: string | null;
  uploadingReceiptId: string | null;
  /** A just-created trip to scroll to and briefly highlight — see handleSave's "jump into the Tracker" follow-through. */
  highlightTripId: string | null;
  onPatch: (tripId: string, field: string, patch: TrackerPatch) => void;
  onChangeTechnician: (tripId: string, technicianProfileId: string | null, technicianName: string) => void;
  onUploadReceipt: (trip: FlashTechTrip, file: File) => void;
  onRemoveReceipt: (trip: FlashTechTrip, receiptUrl: string) => void;
  onPreviewReceipt: (url: string) => void;
}) {
  if (loading) {
    return <div className="panel py-10 text-center text-slate-400 text-sm">Loading…</div>;
  }
  if (trips.length === 0) {
    return (
      <div className="panel py-10 text-center text-slate-400 text-sm">
        No flash tech trips yet — schedule one from the Calendar tab first.
      </div>
    );
  }

  const HEADERS = [
    "Name", "Contact Number", "Email", "Tier Level", "Origin City", "Destination City", "Travel Date",
    "Hotel Name", "Lodging Date", "Address", "Hotel Rate", "Confirmation",
    "Car Rental Needed", "Rental Car", "Rental Date", "Rental Rate", "Vehicle Type", "Other Expenses",
    "Notes", "Receipts", "Type", "Status",
  ];

  // Same "active, has a display name" pool the Schedule Trip modal's own
  // technician search draws from — not narrowed to the TECHNICIAN role,
  // since a Flash Tech trip can belong to any staff member covering
  // another branch (Branch Manager, etc. — see this file's own header).
  const technicianOptions = [...users]
    .filter((u) => u.is_active && u.display_name)
    .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));

  return (
    <div className="panel overflow-x-auto p-0">
      <table className="border-collapse text-xs">
        <thead>
          <tr className="bg-slate-700/80 text-slate-200">
            {HEADERS.map((h) => (
              <th key={h} className="px-2 py-2 text-left font-semibold whitespace-nowrap border-r border-white/10 last:border-r-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => {
            const patch = (field: string, value: TrackerPatch) => onPatch(trip.id, field, value);
            const isHighlighted = trip.id === highlightTripId;
            return (
              <tr
                key={trip.id}
                ref={isHighlighted ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined}
                className={`border-b border-white/10 align-top hover:bg-white/5 transition-colors ${
                  isHighlighted ? "bg-blue-500/15 ring-1 ring-inset ring-blue-400/50" : ""
                }`}
              >
                <td className="p-0.5 border-r border-white/10">
                  <select
                    value={trip.technicianProfileId || `unlinked:${trip.technicianName}`}
                    disabled={!canEdit || savingCellKey === `${trip.id}:technician`}
                    onChange={(e) => {
                      const picked = technicianOptions.find((u) => u.id === e.target.value);
                      if (picked) onChangeTechnician(trip.id, picked.id, picked.display_name || picked.email);
                    }}
                    className="w-full min-w-[140px] bg-slate-900 text-xs font-medium px-1.5 py-1 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
                  >
                    {!trip.technicianProfileId && (
                      <option value={`unlinked:${trip.technicianName}`} disabled className="bg-slate-900">
                        {trip.technicianName} (unlinked)
                      </option>
                    )}
                    {technicianOptions.map((u) => (
                      <option key={u.id} value={u.id} className="bg-slate-900">
                        {u.display_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.technicianPhone || ""} disabled={!canEdit} placeholder="Contact number" onSave={(v) => patch("technicianPhone", { technicianPhone: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.technicianEmail || ""} disabled={!canEdit} placeholder="Email" onSave={(v) => patch("technicianEmail", { technicianEmail: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerSelectCell value={trip.tierLevel || ""} disabled={!canEdit} options={["", ...FLASH_TECH_TIER_LEVELS]} onSave={(v) => patch("tierLevel", { tierLevel: v || null })} />
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-300 border-r border-white/10">{trip.originLocation}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-300 border-r border-white/10">{trip.destinationLocation}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-300 border-r border-white/10">{trip.startDate} – {trip.endDate}</td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.hotelName || ""} disabled={!canEdit} placeholder="Hotel name" onSave={(v) => patch("hotelName", { hotelName: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerDateRangeCell
                    start={trip.lodgingStartDate}
                    end={trip.lodgingEndDate}
                    disabled={!canEdit}
                    onSaveStart={(v) => patch("lodgingStartDate", { lodgingStartDate: v })}
                    onSaveEnd={(v) => patch("lodgingEndDate", { lodgingEndDate: v })}
                  />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.hotelAddress || ""} disabled={!canEdit} placeholder="Address" onSave={(v) => patch("hotelAddress", { hotelAddress: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerNumberCell value={trip.hotelRate} disabled={!canEdit} onSave={(v) => patch("hotelRate", { hotelRate: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.hotelConfirmation || ""} disabled={!canEdit} placeholder="Confirmation #" onSave={(v) => patch("hotelConfirmation", { hotelConfirmation: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerSelectCell
                    value={trip.carRentalNeeded ? "Yes" : "No"}
                    disabled={!canEdit}
                    options={["Yes", "No"]}
                    onSave={(v) => patch("carRentalNeeded", { carRentalNeeded: v === "Yes" })}
                  />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.rentalCar || ""} disabled={!canEdit} placeholder="Rental company" onSave={(v) => patch("rentalCar", { rentalCar: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerDateRangeCell
                    start={trip.rentalStartDate}
                    end={trip.rentalEndDate}
                    disabled={!canEdit}
                    onSaveStart={(v) => patch("rentalStartDate", { rentalStartDate: v })}
                    onSaveEnd={(v) => patch("rentalEndDate", { rentalEndDate: v })}
                  />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerNumberCell value={trip.rentalRate} disabled={!canEdit} onSave={(v) => patch("rentalRate", { rentalRate: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.vehicleType || ""} disabled={!canEdit} placeholder="Vehicle type" onSave={(v) => patch("vehicleType", { vehicleType: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerNumberCell value={trip.otherExpenses} disabled={!canEdit} onSave={(v) => patch("otherExpenses", { otherExpenses: v })} />
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerTextCell value={trip.notes || ""} disabled={!canEdit} placeholder="Notes" onSave={(v) => patch("notes", { notes: v })} />
                </td>
                <td className="px-2 py-1.5 border-r border-white/10 whitespace-nowrap">
                  <div className="flex flex-col gap-1">
                    {trip.receiptPaths.map((url, i) => (
                      <div key={url} className="flex items-center gap-2">
                        <button type="button" onClick={() => onPreviewReceipt(url)} className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-[11px]">
                          <Paperclip className="h-3 w-3" /> Receipt {i + 1}
                        </button>
                        {canEdit && (
                          <button type="button" onClick={() => onRemoveReceipt(trip, url)} disabled={uploadingReceiptId === trip.id} className="text-red-400 hover:text-red-300 text-[11px] disabled:opacity-50">
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {canEdit && trip.receiptPaths.length < FLASH_TECH_MAX_RECEIPTS ? (
                      <label className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer inline-flex items-center gap-1">
                        {uploadingReceiptId === trip.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                        {uploadingReceiptId === trip.id ? "Uploading…" : `Attach (${trip.receiptPaths.length}/${FLASH_TECH_MAX_RECEIPTS})`}
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          disabled={uploadingReceiptId === trip.id}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) onUploadReceipt(trip, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ) : (
                      trip.receiptPaths.length === 0 && <span className="text-slate-600">—</span>
                    )}
                  </div>
                </td>
                <td className="p-0.5 border-r border-white/10">
                  <TrackerSelectCell value={trip.tripType} disabled={!canEdit} options={FLASH_TECH_TRIP_TYPES} onSave={(v) => patch("tripType", { tripType: v as FlashTechTrip["tripType"] })} />
                </td>
                <td className="p-0.5">
                  <span className={TRACKER_STATUS_COLOR[trip.status] || "text-slate-300"}>
                    <TrackerSelectCell value={trip.status} disabled={!canEdit} options={FLASH_TECH_STATUSES} onSave={(v) => patch("status", { status: v as FlashTechTrip["status"] })} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
