import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RefreshCw, Plus, X, Trash2, CalendarDays, Table2, Paperclip, Loader2, Car, Users, Check, Minus, Building2, Search, Filter, Mail } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { normalizeRole, isEligibleForTechnicianFormChecklist } from "@/lib/roleLabels";
import { getCompanyUsers, getMyProfileId, getTechnicianContactInfoByIds, type ProfileRow } from "@/lib/supabase/users";
import { getGmailConnectionStatus, disconnectGmail, type GmailConnectionStatus } from "@/lib/supabase/gmailConnection";
import { getFlashTechOpenAlertEmail, setFlashTechOpenAlertEmail } from "@/lib/supabase/companySettings";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import {
  getCompanyFlashTechTrips,
  createFlashTechTrip,
  updateFlashTechTrip,
  deleteFlashTechTrip,
  updateFlashTechTripTrackerFields,
  updateFlashTechTripTechnician,
  updateFlashTechTripDates,
  uploadFlashTechTripReceipt,
  removeFlashTechTripReceipt,
  computeFlashTechTripStatus,
  FLASH_TECH_MAX_RECEIPTS,
  FLASH_TECH_TIER_LEVELS,
  FLASH_TECH_TRIP_TYPES,
  FLASH_TECH_STATUSES,
  type FlashTechTrip,
  type FlashTechTripType,
  type FlashTechStatus,
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
  // Every Tracker column, now fillable straight from Schedule Trip too (see
  // createFlashTechTrip's own doc comment) — numbers kept as strings here
  // like every other controlled input, parsed on save.
  tierLevel: string;
  hotelName: string;
  lodgingStartDate: string;
  lodgingEndDate: string;
  hotelAddress: string;
  hotelRate: string;
  hotelConfirmation: string;
  rentalCar: string;
  rentalStartDate: string;
  rentalEndDate: string;
  rentalRate: string;
  vehicleType: string;
  otherExpenses: string;
  tripType: FlashTechTripType;
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
    tierLevel: "",
    hotelName: "",
    lodgingStartDate: "",
    lodgingEndDate: "",
    hotelAddress: "",
    hotelRate: "",
    hotelConfirmation: "",
    rentalCar: "",
    rentalStartDate: "",
    rentalEndDate: "",
    rentalRate: "",
    vehicleType: "Enterprise",
    otherExpenses: "",
    tripType: "Flashtech",
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
  const isHrRole = [role, ...extraRoles].some((r) => normalizeRole(r) === "HR");
  // Connect (OAuth) is Admin/SuperAdmin only — same CONNECT_ROLES gate every
  // other Gmail slot's server-side connect action enforces. Editing WHO the
  // "trip turned Open" alert goes to is a little wider (HR too), matching
  // set_flash_tech_open_alert_email's own role check.
  const canConnectFlashTechGmail = role ? ["ADMIN", "SUPERADMIN"].includes(normalizeRole(role)) : false;
  const canEditFlashTechAlertEmail = canConnectFlashTechGmail || isHrRole;

  // ── Connect Gmail + "trip turned Open" alert recipient — same
  // connect-flow/region idiom as ReportHRDaily.tsx's Hiring Gmail block
  // (migration 0268, src/lib/server/flashTechOpenAlerts.ts's hourly cron
  // job is what actually sends the alert; this page only connects the
  // mailbox and sets who receives it). ──
  const [flashTechGmailStatus, setFlashTechGmailStatus] = useState<GmailConnectionStatus | null>(null);
  const [connectingFlashTechGmail, setConnectingFlashTechGmail] = useState(false);
  const [disconnectingFlashTechGmail, setDisconnectingFlashTechGmail] = useState(false);
  const loadFlashTechGmailStatus = () => {
    getGmailConnectionStatus("FLASH_TECH")
      .then(setFlashTechGmailStatus)
      .catch((err) => console.error("Failed to load Flash Tech Gmail connection status:", err));
  };
  const [flashTechAlertEmail, setFlashTechAlertEmailState] = useState(""); // saved, comma-separated
  // Draft shown as individual chips — one container per email — instead of
  // one shared text box, per HR's explicit request. flashTechAlertEmailInput
  // holds whatever's currently being typed, not yet turned into a chip.
  const [flashTechAlertEmailChips, setFlashTechAlertEmailChips] = useState<string[]>([]);
  const [flashTechAlertEmailInput, setFlashTechAlertEmailInput] = useState("");
  const commitFlashTechAlertEmailChip = () => {
    const v = flashTechAlertEmailInput.trim().replace(/,+$/, "");
    if (!v) { setFlashTechAlertEmailInput(""); return; }
    setFlashTechAlertEmailChips((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setFlashTechAlertEmailInput("");
  };
  const removeFlashTechAlertEmailChip = (email: string) => {
    setFlashTechAlertEmailChips((prev) => prev.filter((e) => e !== email));
  };
  const flashTechAlertEmailDirty = [...flashTechAlertEmailChips, flashTechAlertEmailInput.trim()].filter(Boolean).join(",") !== flashTechAlertEmail;
  const [savingFlashTechAlertEmail, setSavingFlashTechAlertEmail] = useState(false);
  const [flashTechAlertNotice, setFlashTechAlertNotice] = useState<string | null>(null);
  useEffect(() => {
    loadFlashTechGmailStatus();
    getFlashTechOpenAlertEmail()
      .then((email) => {
        setFlashTechAlertEmailState(email);
        setFlashTechAlertEmailChips(email.split(",").map((s) => s.trim()).filter(Boolean));
      })
      .catch((err) => console.error("Failed to load Flash Tech alert recipient:", err));
  }, []);
  // Google redirects back here with ?gmailConnected=1|0 after the consent
  // screen (see gmailBridge.ts) — show the result once, then strip the
  // param so refreshing the page doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("gmailConnected");
    if (result === null) return;
    setFlashTechAlertNotice(result === "1" ? "Gmail connected." : "Couldn't connect Gmail — please try again.");
    if (result === "1") loadFlashTechGmailStatus();
    params.delete("gmailConnected");
    params.delete("gmailRegion");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleConnectFlashTechGmail = async () => {
    setConnectingFlashTechGmail(true);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
      if (!idToken) { setFlashTechAlertNotice("You need to be logged in to connect Gmail."); return; }
      // A real navigation (not fetch) — Google's consent screen has to run in the top-level window.
      window.location.href = `/api/gmail?action=connect&region=FLASH_TECH&idToken=${encodeURIComponent(idToken)}`;
    } finally {
      setConnectingFlashTechGmail(false);
    }
  };
  const handleDisconnectFlashTechGmail = async () => {
    if (!confirm("Disconnect Gmail from the Flash Tech page?")) return;
    setDisconnectingFlashTechGmail(true);
    try {
      await disconnectGmail("FLASH_TECH");
      loadFlashTechGmailStatus();
    } catch (err) {
      setFlashTechAlertNotice(err instanceof Error ? err.message : "Failed to disconnect Gmail.");
    } finally {
      setDisconnectingFlashTechGmail(false);
    }
  };
  const handleSaveFlashTechAlertEmail = async () => {
    // Anything still sitting in the typing box counts too — saving
    // shouldn't silently drop an email that was typed but never
    // Enter/comma-committed into its own chip.
    const pending = flashTechAlertEmailInput.trim().replace(/,+$/, "");
    const all = pending && !flashTechAlertEmailChips.includes(pending) ? [...flashTechAlertEmailChips, pending] : flashTechAlertEmailChips;
    const joined = all.join(",");
    setSavingFlashTechAlertEmail(true);
    setFlashTechAlertNotice(null);
    try {
      await setFlashTechOpenAlertEmail(joined);
      setFlashTechAlertEmailState(joined);
      setFlashTechAlertEmailChips(all);
      setFlashTechAlertEmailInput("");
      setFlashTechAlertNotice("Saved.");
    } catch (err) {
      setFlashTechAlertNotice(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingFlashTechAlertEmail(false);
    }
  };
  const [view, setView] = useState<"calendar" | "tracker" | "availability">("calendar");
  // Which Check-Out Alert tile (0-7 days left) the Tracker is currently
  // filtered to, if any — click a tile to narrow the table to just those
  // technicians, click it again (or the "Clear" pill) to go back to
  // everyone. Reset when leaving the Tracker tab so it doesn't stay
  // silently applied if you come back to it later.
  const [checkoutAlertFilter, setCheckoutAlertFilter] = useState<number | null>(null);
  useEffect(() => {
    if (view !== "tracker") setCheckoutAlertFilter(null);
  }, [view]);
  const [availabilitySearch, setAvailabilitySearch] = useState("");
  const [availabilityStatusFilter, setAvailabilityStatusFilter] = useState<"all" | "available" | "busy" | "needsForm">("all");
  const [monthValue, setMonthValue] = useState(todayMonthValue());
  const [carRentalOnly, setCarRentalOnly] = useState(false);
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
  const [technicianPhone, setTechnicianPhone] = useState("");
  const [technicianEmail, setTechnicianEmail] = useState("");
  // Receipts picked in the Schedule Trip modal, before a trip id exists to
  // upload them against — held here and actually uploaded once handleSave
  // has a real tripId (new or existing), same FLASH_TECH_MAX_RECEIPTS cap
  // (counting against whatever's already on the trip when editing).
  const [newReceiptFiles, setNewReceiptFiles] = useState<File[]>([]);
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
      setTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          const merged = { ...t, ...patch } as FlashTechTrip;
          // `status` (what the Tracker's dropdown actually displays) isn't
          // itself one of updateFlashTechTripTrackerFields' patchable
          // fields — only statusOverride is. Without recomputing it here,
          // picking "Cancelled" would save fine but the dropdown would
          // keep showing the old auto-computed value until the next full
          // reload — same precedence mapTripRow uses server-side.
          merged.status = merged.statusOverride || computeFlashTechTripStatus(merged.startDate, merged.endDate);
          return merged;
        })
      );
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

  const handleChangeDates = async (tripId: string, field: "startDate" | "endDate", value: string) => {
    const key = `${tripId}:travelDate`;
    const current = trips.find((t) => t.id === tripId);
    if (!current) return;
    const startDate = field === "startDate" ? value : current.startDate;
    const endDate = field === "endDate" ? value : current.endDate;
    setSavingCellKey(key);
    try {
      await updateFlashTechTripDates(tripId, startDate, endDate);
      setTrips((prev) =>
        prev.map((t) =>
          t.id === tripId
            ? { ...t, startDate, endDate, status: t.statusOverride || computeFlashTechTripStatus(startDate, endDate) }
            : t
        )
      );
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
  // Tracker-only KPI row: how many technicians currently out on a trip
  // ("Open" status — already started, not yet ended) are within 7 days of
  // their End Date (their "check out"/return date), bucketed by the exact
  // number of days left (0 = ending today). A trip that hasn't started yet
  // doesn't count even if its End Date happens to fall in this window —
  // this is about people already out who are coming up on their return.
  // Returns null for a trip that isn't currently "Open" at all — including
  // one manually marked Cancelled, even if its dates still span today.
  const daysLeftIfOpen = (t: FlashTechTrip, today: string): number | null => {
    if (t.status === "Cancelled" || t.startDate > today || t.endDate < today) return null;
    return Math.round((new Date(t.endDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
  };
  const checkoutAlertCounts = useMemo(() => {
    const today = todayIso();
    const counts = new Map<number, number>();
    for (let d = 0; d <= 7; d++) counts.set(d, 0);
    for (const t of sortedTrips) {
      const daysLeft = daysLeftIfOpen(t, today);
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) counts.set(daysLeft, (counts.get(daysLeft) ?? 0) + 1);
    }
    return counts;
  }, [sortedTrips]);
  const trackerTrips = useMemo(() => {
    if (checkoutAlertFilter === null) return sortedTrips;
    const today = todayIso();
    return sortedTrips.filter((t) => daysLeftIfOpen(t, today) === checkoutAlertFilter);
  }, [sortedTrips, checkoutAlertFilter]);
  const tripColorIndex = useMemo(() => new Map(sortedTrips.map((t, i) => [t.id, i % CHIP_COLORS.length])), [sortedTrips]);
  const calendarTrips = useMemo(
    () => (carRentalOnly ? sortedTrips.filter((t) => t.carRentalNeeded) : sortedTrips),
    [sortedTrips, carRentalOnly]
  );
  const tripsByDay = useMemo(() => {
    const map = new Map<string, FlashTechTrip[]>();
    for (const week of monthWeeks) {
      for (const day of week) {
        if (!day.inMonth) continue;
        const dayTrips = calendarTrips.filter((t) => t.startDate <= day.iso && t.endDate >= day.iso);
        if (dayTrips.length > 0) map.set(day.iso, dayTrips);
      }
    }
    return map;
  }, [monthWeeks, calendarTrips]);

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
      if (t.technicianProfileId && t.status !== "Cancelled" && t.startDate <= today && t.endDate >= today) tripByProfileId.set(t.technicianProfileId, t);
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
    setTechnicianPhone("");
    setTechnicianEmail("");
    setNewReceiptFiles([]);
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
      tierLevel: trip.tierLevel || "",
      hotelName: trip.hotelName || "",
      lodgingStartDate: trip.lodgingStartDate || "",
      lodgingEndDate: trip.lodgingEndDate || "",
      hotelAddress: trip.hotelAddress || "",
      hotelRate: trip.hotelRate != null ? String(trip.hotelRate) : "",
      hotelConfirmation: trip.hotelConfirmation || "",
      rentalCar: trip.rentalCar || "",
      rentalStartDate: trip.rentalStartDate || "",
      rentalEndDate: trip.rentalEndDate || "",
      rentalRate: trip.rentalRate != null ? String(trip.rentalRate) : "",
      vehicleType: trip.vehicleType || "",
      otherExpenses: trip.otherExpenses != null ? String(trip.otherExpenses) : "",
      tripType: trip.tripType,
    });
    setTechnicianQuery(trip.technicianName);
    setTechnicianPhone(trip.technicianPhone || "");
    setTechnicianEmail(trip.technicianEmail || "");
    setNewReceiptFiles([]);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTripId(null);
    setNewReceiptFiles([]);
  };

  const handleSelectTechnician = (u: ProfileRow) => {
    // Origin locks to wherever they actually belong — not free-typed, so a
    // trip's origin always reflects their real assigned branch. Tier Level
    // defaults from whatever's already set on Master List's Current
    // Technicians tab (profiles.tier_level) — still just a starting point,
    // HR can override it in the dropdown below for this specific trip.
    setForm((f) => ({ ...f, technicianProfileId: u.id, technicianName: u.display_name || u.email, originLocation: u.assigned_branch || "", tierLevel: u.tier_level || "" }));
    setTechnicianQuery(u.display_name || u.email);
    setTechnicianDropdownOpen(false);
    setTechnicianPhone("");
    setTechnicianEmail("");
    getTechnicianContactInfoByIds([u.id]).then((map) => {
      const info = map.get(u.id);
      setTechnicianPhone(info?.phone || "");
      setTechnicianEmail(info?.email || "");
    });
  };

  // Shared by both create and edit — every Tracker column the form now also
  // collects, parsed from the controlled-input strings into what the
  // service functions actually expect. A blank field stays null, same as
  // never having filled it in via the Tracker's own per-cell editors.
  const buildTrackerFields = () => ({
    tierLevel: form.tierLevel || null,
    hotelName: form.hotelName || null,
    lodgingStartDate: form.lodgingStartDate || null,
    lodgingEndDate: form.lodgingEndDate || null,
    hotelAddress: form.hotelAddress || null,
    hotelRate: form.hotelRate.trim() === "" ? null : Number(form.hotelRate),
    hotelConfirmation: form.hotelConfirmation || null,
    rentalCar: form.rentalCar || null,
    rentalStartDate: form.rentalStartDate || null,
    rentalEndDate: form.rentalEndDate || null,
    rentalRate: form.rentalRate.trim() === "" ? null : Number(form.rentalRate),
    vehicleType: form.vehicleType || null,
    otherExpenses: form.otherExpenses.trim() === "" ? null : Number(form.otherExpenses),
    tripType: form.tripType,
  });

  // Uploads whatever's in newReceiptFiles against a now-real tripId, one at
  // a time (same sequential pattern handleUploadReceipt uses in the
  // Tracker), stopping at FLASH_TECH_MAX_RECEIPTS total.
  const uploadPendingReceipts = async (tripId: string, existingPaths: string[]) => {
    if (!companyId || newReceiptFiles.length === 0) return;
    let paths = existingPaths;
    for (const file of newReceiptFiles) {
      if (paths.length >= FLASH_TECH_MAX_RECEIPTS) break;
      paths = await uploadFlashTechTripReceipt(companyId, tripId, file, paths);
    }
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
        await updateFlashTechTripTrackerFields(editingTripId, {
          technicianPhone,
          technicianEmail,
          ...buildTrackerFields(),
        });
        await uploadPendingReceipts(editingTripId, editingTrip?.receiptPaths ?? []);
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
          ...buildTrackerFields(),
        });
        await uploadPendingReceipts(newTripId, []);
        closeModal();
        await loadData();
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
      <div className={embedded ? "" : "max-w-[1900px] mx-auto px-4"}>
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

        {/* Connect Gmail + who gets emailed when a trip auto-turns Open —
            the actual send happens on the server's hourly cron
            (flashTechOpenAlerts.ts), this is just connect + recipient. */}
        <div className="panel mb-4 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-sm w-fit">
              <Mail className={`h-4 w-4 shrink-0 ${flashTechGmailStatus?.connected ? "text-green-400" : "text-slate-500"}`} />
              <span className="text-xs text-slate-400 uppercase font-semibold">Flash Tech Gmail:</span>
              {flashTechGmailStatus?.connected ? (
                <>
                  <span className="text-slate-200" title={flashTechGmailStatus.connectedByName ? `Connected by ${flashTechGmailStatus.connectedByName}` : undefined}>
                    {flashTechGmailStatus.connectedAccountName || "Unknown"}
                    {flashTechGmailStatus.connectedEmail && <span className="text-slate-500"> ({flashTechGmailStatus.connectedEmail})</span>}
                  </span>
                  {canConnectFlashTechGmail && (
                    <button
                      type="button"
                      onClick={() => void handleDisconnectFlashTechGmail()}
                      disabled={disconnectingFlashTechGmail}
                      className="text-red-300 hover:text-red-200 disabled:opacity-40 disabled:no-underline text-xs underline ml-1"
                    >
                      {disconnectingFlashTechGmail ? "Disconnecting…" : "Disconnect"}
                    </button>
                  )}
                </>
              ) : canConnectFlashTechGmail ? (
                <button
                  type="button"
                  onClick={() => void handleConnectFlashTechGmail()}
                  disabled={connectingFlashTechGmail}
                  className="text-blue-300 hover:text-blue-200 text-xs underline disabled:opacity-50"
                >
                  {connectingFlashTechGmail ? "Connecting…" : "Connect Gmail"}
                </button>
              ) : (
                <span className="text-slate-500 text-xs">Not connected — ask an Admin</span>
              )}
            </div>

            {canEditFlashTechAlertEmail && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 uppercase font-semibold whitespace-nowrap">Notify when Open:</label>
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1.5 min-w-[16rem]">
                  {flashTechAlertEmailChips.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-200 text-xs px-2 py-0.5"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeFlashTechAlertEmailChip(email)}
                        title="Remove"
                        className="text-blue-300 hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={flashTechAlertEmailInput}
                    onChange={(e) => {
                      // Typing/pasting a comma commits the chip immediately —
                      // same as pressing Enter — so pasting "a@x.com, b@x.com"
                      // splits into two chips instead of one comma-joined blob.
                      const v = e.target.value;
                      if (v.includes(",")) {
                        const parts = v.split(",");
                        const last = parts.pop() ?? "";
                        const newChips = parts.map((s) => s.trim()).filter(Boolean);
                        if (newChips.length) {
                          setFlashTechAlertEmailChips((prev) => Array.from(new Set([...prev, ...newChips])));
                        }
                        setFlashTechAlertEmailInput(last);
                      } else {
                        setFlashTechAlertEmailInput(v);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitFlashTechAlertEmailChip(); }
                      else if (e.key === "Backspace" && !flashTechAlertEmailInput && flashTechAlertEmailChips.length > 0) {
                        removeFlashTechAlertEmailChip(flashTechAlertEmailChips[flashTechAlertEmailChips.length - 1]);
                      }
                    }}
                    onBlur={commitFlashTechAlertEmailChip}
                    placeholder={flashTechAlertEmailChips.length ? "Add another…" : "email@example.com"}
                    className="flex-1 min-w-[10rem] bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none py-0.5"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveFlashTechAlertEmail()}
                  disabled={savingFlashTechAlertEmail || !flashTechAlertEmailDirty}
                  className="btn text-xs px-2.5 py-1.5 disabled:opacity-40"
                >
                  {savingFlashTechAlertEmail ? "Saving…" : "Save"}
                </button>
              </div>
            )}

            {flashTechAlertNotice && <span className="text-xs text-slate-400">{flashTechAlertNotice}</span>}
          </div>
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
          <button
            type="button"
            onClick={() => setCarRentalOnly((v) => !v)}
            className={`btn text-sm inline-flex items-center gap-1.5 ${carRentalOnly ? "bg-amber-500/20 text-amber-300 border-amber-400/40" : ""}`}
            title="Show only trips flagged as needing a car rental"
          >
            <Car className="h-3.5 w-3.5" />
            Car Rental Only
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
                          className={`px-1.5 py-1 border-r border-white/10 last:border-r-0 align-top min-h-14 ${
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
                            {dayTrips.map((trip) => (
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
          <>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Check-Out Alert — Days Until Return</p>
                {checkoutAlertFilter !== null && (
                  <button type="button" onClick={() => setCheckoutAlertFilter(null)} className="text-[10px] text-blue-400 hover:text-blue-300">
                    Clear filter
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {[7, 6, 5, 4, 3, 2, 1, 0].map((d) => {
                  const active = checkoutAlertFilter === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCheckoutAlertFilter((cur) => (cur === d ? null : d))}
                      className={`panel p-1.5 text-center transition-colors hover:bg-white/5 ${active ? "ring-1 ring-blue-400 bg-blue-500/10" : ""}`}
                    >
                      <p className={`text-sm font-bold ${d <= 1 ? "text-red-400" : d <= 3 ? "text-amber-300" : "text-blue-300"}`}>
                        {checkoutAlertCounts.get(d) ?? 0}
                      </p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{d === 0 ? "Today" : `${d} Day${d === 1 ? "" : "s"}`}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <FlashTechTrackerTable
            trips={trackerTrips}
            users={users}
            loading={loading}
            canEdit={canEditTracker}
            savingCellKey={savingCellKey}
            uploadingReceiptId={uploadingReceiptId}
            highlightTripId={highlightTripId}
            onPatch={patchTrip}
            onChangeTechnician={handleChangeTechnician}
            onChangeDates={handleChangeDates}
            onUploadReceipt={handleUploadReceipt}
            onRemoveReceipt={handleRemoveReceipt}
            onPreviewReceipt={setPreviewReceiptUrl}
            />
          </>
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
                {technicianQuery && !form.technicianProfileId && (
                  <p className="mt-1 text-[11px] text-amber-300">
                    Not linked to a real technician profile — click the search box above and pick a name from the dropdown, or this trip won't apply to their mobile route.
                  </p>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Contact Number</label>
                  <input
                    value={technicianPhone}
                    onChange={(e) => setTechnicianPhone(e.target.value)}
                    placeholder={form.technicianProfileId ? "No phone number on file for this technician" : "Pick a technician from the search results first"}
                    title="Defaults from the technician's profile — override it here if needed"
                    className="glass-input mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Email Address</label>
                  <input
                    value={technicianEmail}
                    onChange={(e) => setTechnicianEmail(e.target.value)}
                    placeholder={form.technicianProfileId ? "No email on file for this technician" : "Pick a technician from the search results first"}
                    title="Defaults from the technician's profile — override it here if needed"
                    className="glass-input mt-1 w-full"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Tier Level</label>
                <select
                  value={form.tierLevel}
                  onChange={(e) => setForm((f) => ({ ...f, tierLevel: e.target.value }))}
                  className="glass-input mt-1 w-full"
                >
                  <option value="">—</option>
                  {FLASH_TECH_TIER_LEVELS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Travel Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Travel End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-white/10 p-3 space-y-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Hotel</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Hotel Name</label>
                    <input
                      value={form.hotelName}
                      onChange={(e) => setForm((f) => ({ ...f, hotelName: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Confirmation #</label>
                    <input
                      value={form.hotelConfirmation}
                      onChange={(e) => setForm((f) => ({ ...f, hotelConfirmation: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-slate-500">Address</label>
                  <input
                    value={form.hotelAddress}
                    onChange={(e) => setForm((f) => ({ ...f, hotelAddress: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Lodging Start</label>
                    <input
                      type="date"
                      value={form.lodgingStartDate}
                      onChange={(e) => setForm((f) => ({ ...f, lodgingStartDate: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Lodging End</label>
                    <input
                      type="date"
                      value={form.lodgingEndDate}
                      onChange={(e) => setForm((f) => ({ ...f, lodgingEndDate: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Rate ($/night)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.hotelRate}
                      onChange={(e) => setForm((f) => ({ ...f, hotelRate: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
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

              <div className="rounded-lg border border-white/10 p-3 space-y-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Rental Car</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Rental Company</label>
                    <input
                      value={form.rentalCar}
                      onChange={(e) => setForm((f) => ({ ...f, rentalCar: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Vehicle Type</label>
                    <input
                      value={form.vehicleType}
                      onChange={(e) => setForm((f) => ({ ...f, vehicleType: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Rental Start</label>
                    <input
                      type="date"
                      value={form.rentalStartDate}
                      onChange={(e) => setForm((f) => ({ ...f, rentalStartDate: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Rental End</label>
                    <input
                      type="date"
                      value={form.rentalEndDate}
                      onChange={(e) => setForm((f) => ({ ...f, rentalEndDate: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">Rate ($/day)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.rentalRate}
                      onChange={(e) => setForm((f) => ({ ...f, rentalRate: e.target.value }))}
                      className="glass-input mt-1 w-full"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Other Expenses</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.otherExpenses}
                    onChange={(e) => setForm((f) => ({ ...f, otherExpenses: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-400">Type</label>
                  <select
                    value={form.tripType}
                    onChange={(e) => setForm((f) => ({ ...f, tripType: e.target.value as FlashTechTripType }))}
                    className="glass-input mt-1 w-full"
                  >
                    {FLASH_TECH_TRIP_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
              {form.startDate && form.endDate && (
                <p className="text-xs text-slate-400">
                  Status: <span className={TRACKER_STATUS_COLOR[computeFlashTechTripStatus(form.startDate, form.endDate)] || "text-slate-300"}>
                    {computeFlashTechTripStatus(form.startDate, form.endDate)}
                  </span>{" "}
                  <span className="text-slate-600">— automatically set from the travel dates.</span>
                </p>
              )}

              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">
                  Receipts {(editingTrip?.receiptPaths.length ?? 0) + newReceiptFiles.length > 0 && `(${(editingTrip?.receiptPaths.length ?? 0) + newReceiptFiles.length}/${FLASH_TECH_MAX_RECEIPTS})`}
                </label>
                {editingTrip && editingTrip.receiptPaths.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">{editingTrip.receiptPaths.length} already on file — manage those from the Tracker; anything picked below is added on top.</p>
                )}
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    const room = FLASH_TECH_MAX_RECEIPTS - (editingTrip?.receiptPaths.length ?? 0) - newReceiptFiles.length;
                    if (room <= 0) return alert(`Up to ${FLASH_TECH_MAX_RECEIPTS} receipts per trip.`);
                    setNewReceiptFiles((prev) => [...prev, ...picked.slice(0, room)]);
                  }}
                  className="mt-1 block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-white/20"
                />
                {newReceiptFiles.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {newReceiptFiles.map((f, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-xs text-slate-300">
                        <span className="truncate">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setNewReceiptFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="shrink-0 text-slate-500 hover:text-red-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
// (migration 0257). Name and Travel Date are also correctable here (via
// updateFlashTechTripTechnician/updateFlashTechTripDates) for fixing a typo
// after the fact without reopening Schedule Trip; Origin/Destination stay
// read-only. Everything else is a per-cell inline editor, saved
// independently on blur/change so one field's edit never risks another's
// in-flight value.

type TrackerPatch = Parameters<typeof updateFlashTechTripTrackerFields>[1];

/** Tracker header cell with a funnel icon that opens an Excel-style
 *  checklist of that column's real values — same pattern as ReportHRDaily's
 *  FilterableTh (Sent History tables), reimplemented locally here since
 *  that one isn't exported and is tied to a different table's column type. */
function FlashTechFilterableTh({
  header,
  options,
  optionLabel,
  selected,
  onToggleValue,
  onClear,
  className,
  extra,
}: {
  header: string;
  options: string[];
  optionLabel: (opt: string) => string;
  selected: string[];
  onToggleValue: (value: string) => void;
  onClear: () => void;
  className?: string;
  /** Extra trailing control in the header cell (e.g. the Alt Hotel group's own collapse chevron). */
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);
  const isFiltered = selected.length > 0;

  return (
    <th
      ref={ref}
      className={`px-2 py-2 text-left font-semibold whitespace-nowrap border-r border-white/10 relative ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1.5">
        {header}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={`Filter by ${header}`}
          className={`p-0.5 rounded hover:bg-white/10 ${isFiltered ? "text-blue-400" : "text-slate-400/70"}`}
        >
          <Filter className="h-3 w-3" />
        </button>
        {extra}
      </span>
      {open && (
        <div className="absolute z-20 mt-1.5 left-0 bg-slate-800 border border-white/10 rounded-md shadow-xl p-2 w-52 max-h-72 overflow-y-auto normal-case font-normal text-slate-200">
          <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-white/10">
            <span className="text-[10px] text-slate-500">{options.length} value{options.length === 1 ? "" : "s"}</span>
            {isFiltered && (
              <button type="button" onClick={onClear} className="text-[10px] text-blue-300 hover:text-blue-200">Clear</button>
            )}
          </div>
          {options.length === 0 ? (
            <p className="px-1 py-1 text-[11px] text-slate-500">No values yet.</p>
          ) : (
            options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 py-1 px-1 text-xs cursor-pointer hover:bg-white/5 rounded">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggleValue(opt)} />
                <span className="truncate">{optionLabel(opt)}</span>
              </label>
            ))
          )}
        </div>
      )}
    </th>
  );
}

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
      className="w-full min-w-[100px] bg-transparent text-xs px-1.5 py-1 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
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
  Open: "text-green-400",
  Closed: "text-slate-400",
  Upcoming: "text-yellow-300",
  Cancelled: "text-red-400",
};

const TRACKER_ROW_STATUS_BG: Record<string, string> = {
  Open: "bg-green-500/35 border-l-2 border-l-green-400 hover:bg-green-500/40",
  Closed: "bg-slate-500/15 border-l-2 border-l-slate-500 hover:bg-slate-500/20",
  Upcoming: "bg-yellow-400/35 border-l-2 border-l-yellow-300 hover:bg-yellow-400/40",
  Cancelled: "bg-red-500/15 border-l-2 border-l-red-500 hover:bg-red-500/20",
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
  onChangeDates,
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
  onChangeDates: (tripId: string, field: "startDate" | "endDate", value: string) => void;
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
  const ALT_HEADERS = ["Alt Lodging Date", "Alt Address", "Alt Hotel Rate", "Alt Confirmation"];
  const CONFIRMATION_IDX = HEADERS.indexOf("Confirmation");

  // Same "active, has a display name" pool the Schedule Trip modal's own
  // technician search draws from — not narrowed to the TECHNICIAN role,
  // since a Flash Tech trip can belong to any staff member covering
  // another branch (Branch Manager, etc. — see this file's own header).
  const technicianOptions = [...users]
    .filter((u) => u.is_active && u.display_name)
    .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));

  // "Technician requested another hotel" opens this form popup (add AND
  // edit both go through it) instead of editing the Alt Hotel columns
  // cell-by-cell inline — those columns are a read-only summary once set.
  const [altHotelModalTrip, setAltHotelModalTrip] = useState<FlashTechTrip | null>(null);
  const [altHotelForm, setAltHotelForm] = useState({ lodgingStart: "", lodgingEnd: "", address: "", rate: "", confirmation: "" });
  const openAltHotelModal = (trip: FlashTechTrip) => {
    setAltHotelModalTrip(trip);
    setAltHotelForm({
      lodgingStart: trip.altLodgingStartDate || "",
      lodgingEnd: trip.altLodgingEndDate || "",
      address: trip.altHotelAddress || "",
      rate: trip.altHotelRate != null ? String(trip.altHotelRate) : "",
      confirmation: trip.altHotelConfirmation || "",
    });
  };
  const saveAltHotelModal = () => {
    if (!altHotelModalTrip) return;
    onPatch(altHotelModalTrip.id, "altHotelRequested", {
      altHotelRequested: true,
      altLodgingStartDate: altHotelForm.lodgingStart || null,
      altLodgingEndDate: altHotelForm.lodgingEnd || null,
      altHotelAddress: altHotelForm.address || null,
      altHotelRate: altHotelForm.rate ? Number(altHotelForm.rate) : null,
      altHotelConfirmation: altHotelForm.confirmation || null,
    });
    setAltHotelModalTrip(null);
  };
  const removeAltHotelModal = () => {
    if (!altHotelModalTrip) return;
    onPatch(altHotelModalTrip.id, "altHotelRequested", {
      altHotelRequested: false,
      altLodgingStartDate: null,
      altLodgingEndDate: null,
      altHotelAddress: null,
      altHotelRate: null,
      altHotelConfirmation: null,
    });
    setAltHotelModalTrip(null);
  };

  // Whether every row's Alt Hotel fields render as their own 4 columns or
  // collapse into one — most trips never touch these, so collapsed is the
  // default and keeps the table from being mostly-empty amber columns.
  const [altColsExpanded, setAltColsExpanded] = useState(false);

  // ── Per-column filtering (Excel-style checklist, same FilterableTh
  // pattern as ReportHRDaily's Sent History tables) + the Name search bar
  // above the table. Alt Hotel columns only get a filter funnel while
  // expanded — same as the header itself, since there's nowhere to put 4 of
  // them in the one collapsed cell.
  const [nameSearch, setNameSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const toggleColumnFilterValue = (header: string, value: string) =>
    setColumnFilters((prev) => {
      const current = prev[header] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [header]: next };
    });
  const clearColumnFilter = (header: string) => setColumnFilters((prev) => ({ ...prev, [header]: [] }));
  const isColumnFiltered = (header: string) => (columnFilters[header]?.length ?? 0) > 0;
  const activeColumnFilterCount = Object.values(columnFilters).filter((v) => v.length > 0).length;

  const getColumnText = (trip: FlashTechTrip, header: string): string => {
    switch (header) {
      case "Name": return trip.technicianName || "";
      case "Contact Number": return trip.technicianPhone || "";
      case "Email": return trip.technicianEmail || "";
      case "Tier Level": return trip.tierLevel || "";
      case "Origin City": return trip.originLocation || "";
      case "Destination City": return trip.destinationLocation || "";
      case "Travel Date": return `${trip.startDate} ${trip.endDate}`;
      case "Hotel Name": return trip.hotelName || "";
      case "Lodging Date": return `${trip.lodgingStartDate || ""} ${trip.lodgingEndDate || ""}`;
      case "Address": return trip.hotelAddress || "";
      case "Hotel Rate": return trip.hotelRate != null ? String(trip.hotelRate) : "";
      case "Confirmation": return trip.hotelConfirmation || "";
      case "Alt Lodging Date": return `${trip.altLodgingStartDate || ""} ${trip.altLodgingEndDate || ""}`;
      case "Alt Address": return trip.altHotelAddress || "";
      case "Alt Hotel Rate": return trip.altHotelRate != null ? String(trip.altHotelRate) : "";
      case "Alt Confirmation": return trip.altHotelConfirmation || "";
      case "Car Rental Needed": return trip.carRentalNeeded ? "Yes" : "No";
      case "Rental Car": return trip.rentalCar || "";
      case "Rental Date": return `${trip.rentalStartDate || ""} ${trip.rentalEndDate || ""}`;
      case "Rental Rate": return trip.rentalRate != null ? String(trip.rentalRate) : "";
      case "Vehicle Type": return trip.vehicleType || "";
      case "Other Expenses": return trip.otherExpenses != null ? String(trip.otherExpenses) : "";
      case "Notes": return trip.notes || "";
      case "Receipts": return trip.receiptPaths.length > 0 ? "yes" : "no";
      case "Type": return trip.tripType || "";
      case "Status": return trip.status || "";
      default: return "";
    }
  };

  const filteredTrips = trips.filter((trip) => {
    if (nameSearch.trim() && !trip.technicianName.toLowerCase().includes(nameSearch.trim().toLowerCase())) return false;
    // Checked values are OR'd within a column (any match keeps the row),
    // columns are AND'd against each other — standard AutoFilter semantics.
    for (const [header, values] of Object.entries(columnFilters)) {
      if (!values || values.length === 0) continue;
      if (!values.includes(getColumnText(trip, header))) return false;
    }
    return true;
  });

  // Every column's checklist lists only the values that actually appear in
  // it right now (so Tier Level doesn't show unused options), computed once
  // per render rather than per open popover.
  const RECEIPTS_LABEL: Record<string, string> = { yes: "Has receipts", no: "No receipts" };
  const columnOptionsCache: Record<string, string[]> = {};
  const getColumnOptions = (header: string): string[] => {
    if (columnOptionsCache[header]) return columnOptionsCache[header];
    const values = new Set<string>();
    for (const trip of trips) {
      const v = getColumnText(trip, header);
      if (v) values.add(v);
    }
    const sorted = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    columnOptionsCache[header] = sorted;
    return sorted;
  };
  const optionLabel = (header: string, opt: string) => (header === "Receipts" ? RECEIPTS_LABEL[opt] ?? opt : opt);

  return (
    <div className="panel overflow-x-auto p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-800/60 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-slate-500" />
        <input
          type="text"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          placeholder="Search by name…"
          className="w-52 rounded border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500"
        />
        <span className="text-[11px] text-slate-500">
          {filteredTrips.length === trips.length ? `${trips.length} trip${trips.length === 1 ? "" : "s"}` : `${filteredTrips.length} of ${trips.length} trips`}
        </span>
        {(nameSearch || activeColumnFilterCount > 0) && (
          <button
            type="button"
            onClick={() => { setNameSearch(""); setColumnFilters({}); }}
            className="text-[11px] text-blue-400 hover:text-blue-300"
          >
            Clear filters{activeColumnFilterCount > 0 ? ` (${activeColumnFilterCount})` : ""}
          </button>
        )}
      </div>
      <table className="border-collapse text-xs">
        <thead>
          <tr className="bg-slate-700/80 text-slate-200">
            {HEADERS.slice(0, CONFIRMATION_IDX + 1).map((h) => (
              <FlashTechFilterableTh
                key={h}
                header={h}
                options={getColumnOptions(h)}
                optionLabel={(opt) => optionLabel(h, opt)}
                selected={columnFilters[h] || []}
                onToggleValue={(v) => toggleColumnFilterValue(h, v)}
                onClear={() => clearColumnFilter(h)}
              />
            ))}
            {altColsExpanded ? (
              ALT_HEADERS.map((h, i) => (
                <FlashTechFilterableTh
                  key={h}
                  header={h}
                  options={getColumnOptions(h)}
                  optionLabel={(opt) => optionLabel(h, opt)}
                  selected={columnFilters[h] || []}
                  onToggleValue={(v) => toggleColumnFilterValue(h, v)}
                  onClear={() => clearColumnFilter(h)}
                  className="bg-amber-500/10 text-amber-200"
                  extra={
                    i === ALT_HEADERS.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setAltColsExpanded(false)}
                        title="Collapse Alt Hotel columns"
                        className="ml-auto text-amber-300 hover:text-amber-100"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                    ) : undefined
                  }
                />
              ))
            ) : (
              <th colSpan={ALT_HEADERS.length} className="px-1 py-2 whitespace-nowrap border-r border-white/10 bg-amber-500/10 text-amber-200">
                <button
                  type="button"
                  onClick={() => setAltColsExpanded(true)}
                  title="Show Alt Hotel columns"
                  className="flex w-full items-center justify-center text-amber-300 hover:text-amber-100"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </th>
            )}
            {HEADERS.slice(CONFIRMATION_IDX + 1).map((h) => (
              <FlashTechFilterableTh
                key={h}
                header={h}
                options={getColumnOptions(h)}
                optionLabel={(opt) => optionLabel(h, opt)}
                selected={columnFilters[h] || []}
                onToggleValue={(v) => toggleColumnFilterValue(h, v)}
                onClear={() => clearColumnFilter(h)}
                className="last:border-r-0"
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredTrips.length === 0 && (
            <tr>
              <td colSpan={HEADERS.length + ALT_HEADERS.length} className="px-4 py-8 text-center text-slate-500">
                No trips match these filters.
              </td>
            </tr>
          )}
          {filteredTrips.map((trip) => {
            const patch = (field: string, value: TrackerPatch) => onPatch(trip.id, field, value);
            const isHighlighted = trip.id === highlightTripId;
            return (
              <tr
                key={trip.id}
                ref={isHighlighted ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined}
                className={`border-b border-white/10 align-top transition-colors ${
                  isHighlighted
                    ? "bg-blue-500/15 ring-1 ring-inset ring-blue-400/50"
                    : TRACKER_ROW_STATUS_BG[trip.status] || "hover:bg-white/5"
                }`}
              >
                <td className="p-0.5 border-r border-white/10">
                  <div className="flex items-center gap-1">
                    <select
                      value={trip.technicianProfileId || `unlinked:${trip.technicianName}`}
                      disabled={!canEdit || savingCellKey === `${trip.id}:technician`}
                      onChange={(e) => {
                        const picked = technicianOptions.find((u) => u.id === e.target.value);
                        if (picked) onChangeTechnician(trip.id, picked.id, picked.display_name || picked.email);
                      }}
                      className="w-full min-w-[110px] bg-transparent text-xs font-medium px-1.5 py-1 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed text-slate-200"
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
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => openAltHotelModal(trip)}
                      title={trip.altHotelRequested ? "Alt hotel on file — click to view/edit" : "Technician requested another hotel"}
                      className={`shrink-0 h-7 w-7 flex items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        trip.altHotelRequested
                          ? "bg-amber-400 border-amber-300 text-slate-900 hover:bg-amber-300 shadow-[0_0_0_2px_rgba(251,191,36,0.25)]"
                          : "bg-sky-500/25 border-sky-400/60 text-sky-200 hover:bg-sky-500/40 hover:text-white"
                      }`}
                    >
                      <Building2 className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                  </div>
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
                <td className="p-0.5 border-r border-white/10">
                  <TrackerDateRangeCell
                    start={trip.startDate}
                    end={trip.endDate}
                    disabled={!canEdit}
                    onSaveStart={(v) => v && onChangeDates(trip.id, "startDate", v)}
                    onSaveEnd={(v) => v && onChangeDates(trip.id, "endDate", v)}
                  />
                </td>
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
                {altColsExpanded ? (
                  <>
                    <td
                      className={`px-2 py-1.5 whitespace-nowrap border-r border-white/10 bg-amber-500/[0.04] ${canEdit ? "cursor-pointer hover:bg-amber-500/10" : ""}`}
                      onClick={() => canEdit && openAltHotelModal(trip)}
                    >
                      {trip.altHotelRequested && trip.altLodgingStartDate ? (
                        <span className="text-slate-200">{trip.altLodgingStartDate} – {trip.altLodgingEndDate || "?"}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 whitespace-nowrap border-r border-white/10 bg-amber-500/[0.04] ${canEdit ? "cursor-pointer hover:bg-amber-500/10" : ""}`}
                      onClick={() => canEdit && openAltHotelModal(trip)}
                    >
                      {trip.altHotelRequested && trip.altHotelAddress ? (
                        <span className="text-slate-200">{trip.altHotelAddress}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 whitespace-nowrap border-r border-white/10 bg-amber-500/[0.04] ${canEdit ? "cursor-pointer hover:bg-amber-500/10" : ""}`}
                      onClick={() => canEdit && openAltHotelModal(trip)}
                    >
                      {trip.altHotelRequested && trip.altHotelRate != null ? (
                        <span className="text-slate-200">{trip.altHotelRate.toFixed(2)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 whitespace-nowrap border-r border-white/10 bg-amber-500/[0.04] ${canEdit ? "cursor-pointer hover:bg-amber-500/10" : ""}`}
                      onClick={() => canEdit && openAltHotelModal(trip)}
                    >
                      {trip.altHotelRequested && trip.altHotelConfirmation ? (
                        <span className="text-slate-200">{trip.altHotelConfirmation}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </>
                ) : (
                  <td
                    colSpan={ALT_HEADERS.length}
                    className={`p-0.5 border-r border-white/10 bg-amber-500/[0.04] text-center ${canEdit ? "cursor-pointer hover:bg-amber-500/10" : ""}`}
                    onClick={() => canEdit && openAltHotelModal(trip)}
                  >
                    {trip.altHotelRequested ? (
                      <span className="text-[10px] font-medium text-amber-300">● alt hotel on file</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                )}
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
                  <select
                    value={trip.status}
                    disabled={!canEdit}
                    onChange={(e) => patch("statusOverride", { statusOverride: e.target.value as FlashTechStatus })}
                    className={`w-full min-w-[90px] bg-transparent text-xs font-semibold px-1.5 py-1 border border-transparent hover:border-white/10 focus:border-blue-500 rounded outline-none disabled:opacity-60 disabled:cursor-not-allowed ${TRACKER_STATUS_COLOR[trip.status] || "text-slate-300"}`}
                    title={trip.statusOverride ? "Manually set — won't change automatically with the travel dates" : "Automatic, based on the travel dates"}
                  >
                    {FLASH_TECH_STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-slate-900 text-slate-200">
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {altHotelModalTrip && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAltHotelModalTrip(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-white/10 bg-slate-800 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-white">Technician requested another hotel</h3>
            <p className="mt-1.5 text-xs text-slate-400">
              {altHotelModalTrip.technicianName}'s replacement stay — the original Hotel Name/Lodging Date/Address/Rate/Confirmation stay on the row untouched.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Lodging Start</label>
                <input
                  type="date"
                  value={altHotelForm.lodgingStart}
                  onChange={(e) => setAltHotelForm((f) => ({ ...f, lodgingStart: e.target.value }))}
                  className="glass-input mt-1 w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Lodging End</label>
                <input
                  type="date"
                  value={altHotelForm.lodgingEnd}
                  onChange={(e) => setAltHotelForm((f) => ({ ...f, lodgingEnd: e.target.value }))}
                  className="glass-input mt-1 w-full"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold uppercase text-slate-400">Address</label>
                <input
                  type="text"
                  value={altHotelForm.address}
                  onChange={(e) => setAltHotelForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Address"
                  className="glass-input mt-1 w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Hotel Rate</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={altHotelForm.rate}
                  onChange={(e) => setAltHotelForm((f) => ({ ...f, rate: e.target.value }))}
                  className="glass-input mt-1 w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-400">Confirmation #</label>
                <input
                  type="text"
                  value={altHotelForm.confirmation}
                  onChange={(e) => setAltHotelForm((f) => ({ ...f, confirmation: e.target.value }))}
                  placeholder="Confirmation #"
                  className="glass-input mt-1 w-full"
                />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between">
              {altHotelModalTrip.altHotelRequested ? (
                <button type="button" onClick={removeAltHotelModal} className="text-xs text-red-400 hover:text-red-300">
                  Remove alternate hotel
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setAltHotelModalTrip(null)} className="btn text-xs px-3 py-1.5">
                  Cancel
                </button>
                <button type="button" onClick={saveAltHotelModal} className="btn btn-primary text-xs px-3 py-1.5">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
