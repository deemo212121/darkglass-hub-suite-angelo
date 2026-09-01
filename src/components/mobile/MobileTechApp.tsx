import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { setDesktopOverride } from "@/lib/device";
import { useLiveLocation } from "@/lib/liveLocationContext";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Send,
  Ticket as TicketIcon,
  MapPin,
  MessageCircle,
  PauseCircle,
  DollarSign,
  ExternalLink,
  Home,
  X,
} from "lucide-react";
// Mobile shell is an isolated surface — no navigation to desktop routes,
// no device-override toggle. The desktop UI is available only from an
// actual desktop browser.
import {
  getCompanyTickets,
  getTicketVisits,
  updateTicketVisit,
  updateTicketStatus,
  getLatestVisitTechnicianByTicketIds,
  getTicketParts,
  updateTicketPart,
  setTicketOnsiteCheckIn,
  getOnsiteCheckins,
  type UIPartRow,
} from "@/lib/supabase/tickets";
import { getMyProfileId, getMyFullProfile } from "@/lib/supabase/users";
import { getTechPayrollBreakdown, type TechPayrollBreakdown } from "@/lib/supabase/techPayroll";
import { getCompanyMapProvider, type MapProvider } from "@/lib/supabase/companySettings";
import { loadGoogleMapsScript, getLeaflet, makeGeocoder, geocodeAddress, haversineMiles, routeGeoapify, metersToMiles, formatDuration, attachLeafletResizeFix, createBadgeDivIcon, OSM_TILE_URL, OSM_ATTRIBUTION, ON_SITE_CHECKIN_RADIUS_MILES, ON_SITE_CHECKIN_ACCURACY_SLACK_CAP_MILES, ON_SITE_CHECKIN_MANUAL_OVERRIDE_MAX_MILES, getOfficeCoordinates } from "@/lib/mapEngine";
import { getCompanyFlashTechTrips, type FlashTechTrip } from "@/lib/supabase/flashTechTrips";
import type * as Leaflet from "leaflet";
import {
  getDmMessages,
  getOrCreateDmThread,
  peekLatestThreadMessage,
  sendMessage,
  subscribeToMessages,
  listMyDmInbox,
  markThreadRead,
  getUnreadCounts,
  type MessageRow,
  type DmThreadRow,
  type DmInboxEntry,
} from "@/lib/supabase/messaging";
import { getTicketBilling, saveTicketBilling, type TicketBilling } from "@/lib/supabase/billing";
import { getMyPayslips, payslipStatusLabel, type MyPayslipRow } from "@/lib/supabase/payslips";
import { getMyProfileSchedule, getMonthEntries, getCompanyTimecardEntries, saveEntry as saveTimecardEntry, resolveScheduledShiftHours, type UITimeEntry, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import { isAttendanceManagerTierRole, normalizeRole, ROLE_LABELS, TECHNICIAN_PAY_ROLES } from "@/lib/roleLabels";
import { LOCATIONS } from "@/lib/locations";
import { timezoneForBranch, nowInTimezone } from "@/lib/attendanceGrace";
import { getServerNow, zonedDateKey, zonedTimeString, zonedWallClockToUtcIso, TIME_ZONES, type ScheduleTimezone } from "@/lib/serverTime";
import { getTicketComments, addTicketComment, type TicketComment } from "@/lib/supabase/comments";
import { enqueueOnsiteCheckin, enqueueVisitSave } from "@/lib/offlineQueue";
import { TicketPhotos } from "@/components/TicketPhotos";
import { MessageBody } from "@/components/MessageBody";
import { LocationSharingBadge } from "@/components/LocationSharingBadge";
import { OfflineQueueBadge } from "@/components/OfflineQueueBadge";
import { uploadTicketSignature, uploadPayrollDisputeAttachment, uploadTicketTimeDisputeAttachment } from "@/lib/firebase/storage";
import { getTechnicianTodayRoute, type TechnicianRouteStop } from "@/lib/supabase/technicianWhereabouts";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { lookupZip } from "@/lib/zipCoverage";
import { resolveTierCode } from "@/lib/tierCodes";
import { getModelResources, saveModelResources, type ModelResources } from "@/lib/supabase/modelResources";
import { getUndismissedMobilePopupAlerts, dismissTicketAlert, type TicketAlert } from "@/lib/supabase/ticketAlerts";
import { createItTicket, getItTickets, type ItTicketRow, type ItTicketPriority } from "@/lib/supabase/itTickets";
import { createEmployeeRequest, getCompanyEmployeeRequests, notifyRequestReviewers, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { createPtoRequest, getCompanyPtoRequests, weekdayCount, type PtoType, type PtoRequestRow } from "@/lib/supabase/pto";
import { createTimecardCorrection, getCompanyTimecardCorrections, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { createNotification } from "@/lib/supabase/notifications";
import { getMileageEntries, type MileageEntry } from "@/lib/supabase/mileage";
import { resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import { NotificationsMenu } from "@/components/NotificationsMenu";
import { NotificationCenterPanel } from "@/components/NotificationCenterPage";
import {
  parseServicePerformed,
  composeServicePerformed,
  emptyServicePerformed,
} from "@/lib/servicePerformedNotes";
import type { Ticket } from "@/lib/ticketData";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";

type View =
  | "roster"
  | "tickets"
  | "map"
  | "detail"
  | "chat"
  | "home"
  | "payroll"
  | "timecard"
  | "clockinteam"
  | "parts"
  | "onhold"
  | "itsupport"
  | "payrolldispute"
  | "timeoff"
  | "tickettimedispute"
  | "correction"
  | "notifications";
type DetailTab = "general" | "tracking" | "parts" | "billing";

// Zero-padded "HH:MM"/"HH:MM:SS" strings sort chronologically as plain
// strings, so this catches the classic native <input type="time"> mistake
// of leaving the AM/PM half wrong — mirrors EmployeeSelfServicePage.tsx's
// local helper of the same name (kept as its own copy since neither file
// exports page-local helpers).
function isCheckOutBeforeCheckIn(checkIn: string, checkOut: string): boolean {
  return !!checkIn && !!checkOut && checkOut <= checkIn;
}

// Repair-status options the tech can pick from when editing a visit row
// on mobile. Same set the desktop Add Visit modal uses so both surfaces
// stay in sync — kept inline because the desktop list lives in
// ticket.$ticketNo.tsx and isn't exported yet. Alphabetical order per
// the "dropdowns must be alphabetical" rule.
const MOBILE_REPAIR_STATUSES = [
  "CL-Cancelled",
  "CL-Claimed",
  "CL-Data-Closed",
  "CL-Need Cancel",
  "CL-Parts Back Ordered",
  "CL-Ready to Complete",
  "CSR-Acknowledged",
  "CSR-Assigned to ASC",
  "CSR-Left Message for Cx",
  "CSR-Needs Scheduling",
  "OP-Ready for Service",
  "OP-Reschedule Follow up",
  "OP-UPDATE HOLD",
  "OP-Waiting for Part",
  "PT-Need PreAuthorization",
  "TR-Need PO",
  "TR-Need Triage",
].sort((a, b) => a.localeCompare(b));

// Roles that see their OWN tickets directly (skip the technician roster).
const SELF_ROLES = new Set(["TECHNICIAN"]);

// How far back On Hold Tickets' "Updated" sub-tab looks for a released hold.
const RECENTLY_RELEASED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Days a ticket has been open, from aging if present else from created date.
function openDays(t: Ticket): number {
  if (t.aging && t.aging > 0) return t.aging;
  const raw = String(t.created || "").trim();
  if (!raw) return 0;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// A "done"/closed ticket for the To Do vs Done split.
function isDone(status: string): boolean {
  const s = (status || "").toLowerCase();
  return s.includes("complete") || s.includes("closed") || s.includes("cl-") || s.includes("claim");
}

// Same "is this ticket's schedule today" match RouteMapView's ticket
// filter uses (ISO or US-format schedule string) — pulled out so Home's
// "Assigned Today" list uses the identical definition of "today".
function isScheduledToday(t: Ticket): boolean {
  const rawDate = String(t.schedule || (t as any).schedule_date || "").trim();
  if (!rawDate) return false;
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayIso = `${yyyy}-${mm}-${dd}`;
  if (rawDate.startsWith(todayIso)) return true;
  const usMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (usMatch) {
    const yy = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    const iso = `${yy}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
    return iso === todayIso;
  }
  return false;
}

function statusTone(status: string): string {
  const s = (status || "").toLowerCase();
  if (s.includes("complete") || s.includes("ready to complete")) return "tone-green";
  if (s.includes("cancel")) return "tone-red";
  if (s.includes("waiting") || s.includes("pending") || s.includes("back order")) return "tone-amber";
  if (s.includes("ready for service") || s.includes("ready to repair")) return "tone-blue";
  return "tone-blue";
}

function productLabel(t: Ticket): string {
  const explicit = (t.productType || "").trim();
  if (explicit) return explicit.toUpperCase();
  const m = (t.model || "").toLowerCase();
  if (/dryer/.test(m)) return "DRYER";
  if (/wash/.test(m)) return "WASHER";
  if (/refrig|fridge/.test(m)) return "REFRIGERATOR";
  if (/dishwash/.test(m)) return "DISHWASHER";
  if (/range|oven|stove|cooktop/.test(m)) return "RANGE/OVEN";
  if (/microwave/.test(m)) return "MICROWAVE";
  return (t.manufacturer || "APPLIANCE").toUpperCase();
}

function fmtAddress(t: Ticket): string {
  const parts = [t.address, t.city, [t.state, t.zip].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ");
}

// Formats a UTC instant as wall-clock time explicitly in `tz`, labeled with
// the zone abbreviation — used for Ticket Time Dispute times so they read
// unambiguously the same way regardless of the viewer's own device
// timezone (matches serverTime.ts's zonedTimeString convention).
function fmtTimeInZone(iso: string | null, tz: ScheduleTimezone): string {
  if (!iso) return "?";
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONES[tz].timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// Resolve a ticket's branch/location. If the stored location is missing or
// "Unknown", fall back to the zip-coverage map (e.g. a Salem zip resolves to
// the Asheville branch).
function resolveLocation(t: Ticket): string {
  const loc = (t.location || "").trim();
  if (loc && loc.toLowerCase() !== "unknown") return loc;
  const zip = (t.zip || "").trim();
  if (zip) {
    const cov = lookupZip(zip);
    if (cov?.location) return cov.location;
  }
  return loc || "Unknown";
}

// Initials for the map badge, matching the Work Planner web style (e.g. "JR").
function getInitials(value: string | null | undefined): string {
  if (!value) return "U";
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

// Hardcoded local-only stand-ins for testing the Flash Tech route-origin
// override — never shipped: only merged in under import.meta.env.DEV (false
// in any production build), same gating already used for the GPS "Dev:
// Simulate" button elsewhere in this file. Writes nothing to the database.
//
// Models one specific scenario: Aug 31, 2026 — a normal day, 4 tickets in
// Atlanta (his real branch, no Flash Tech yet). Sep 1, 2026 — flash-teched
// to Columbus, 3 tickets there. The matching dev-only Flash Tech trip
// (Atlanta → Columbus, Sep 1–1) is built separately in RouteMapView itself,
// since it needs the real logged-in myProfileId to actually match — see
// buildDevTestFlashTechTrip below.
function buildDevTestRouteTickets(): Ticket[] {
  const base = {
    warranty: "OW",
    manufacturer: "Whirlpool",
    model: "TEST-MODEL",
    internalNote: "",
    diagnosed: "",
    technician: "Angelo Mendoza",
    customerPref: "",
    phone: "706-555-0100",
    redo: "N",
    aging: 0,
    calls: 0,
    partOrder: "",
  };
  const atlanta = { location: "Atlanta", city: "Atlanta", state: "GA", schedule: "2026-08-31", created: "2026-08-31" };
  const columbus = { location: "Columbus", city: "Columbus", state: "GA", schedule: "2026-09-01", created: "2026-09-01" };
  return [
    { ...base, ...atlanta, ticketNo: "DEVTEST-003", customer: "Dev Test Atlanta 1", address: "233 Peachtree St NE", zip: "30303", timeSlot: "8-12", status: "OP-Ready for Service" },
    { ...base, ...atlanta, ticketNo: "DEVTEST-002", customer: "Dev Test Atlanta 2", address: "191 Peachtree St NE", zip: "30303", timeSlot: "8-12", status: "OP-Ready for Service" },
    { ...base, ...atlanta, ticketNo: "DEVTEST-001", customer: "Dev Test Atlanta 3", address: "75 Ted Turner Dr SW", zip: "30303", timeSlot: "1-5", status: "OP-Ready for Service" },
    // Deliberately "CL-Ready to Complete" with no Work Start/Work Done ever
    // recorded (setTicketOnsiteCheckIn no-ops for a fake ticket_no, so this
    // one can never accidentally pick up a timestamp) — exercises the
    // missingTimestampTicketNos orange flag in TicketsView.
    { ...base, ...atlanta, ticketNo: "DEVTEST-004", customer: "Dev Test Atlanta 4", address: "101 Marietta St NW", zip: "30303", timeSlot: "1-5", status: "CL-Ready to Complete" },
    { ...base, ...columbus, ticketNo: "DEVTEST-005", customer: "Dev Test Columbus 1", address: "1200 Broadway", zip: "31901", timeSlot: "8-12", status: "OP-Ready for Service" },
    { ...base, ...columbus, ticketNo: "DEVTEST-006", customer: "Dev Test Columbus 2", address: "233 12th St", zip: "31901", timeSlot: "8-12", status: "OP-Ready for Service" },
    { ...base, ...columbus, ticketNo: "DEVTEST-007", customer: "Dev Test Columbus 3", address: "500 10th Ave", zip: "31901", timeSlot: "1-5", status: "OP-Ready for Service" },
  ];
}

// The matching dev-only Flash Tech trip for the scenario above — Atlanta to
// Columbus, Sep 1 only. Needs the real logged-in myProfileId to actually
// match RouteMapView's technicianProfileId filter, so it's built at the call
// site (dev-only) rather than baked into a static constant.
function buildDevTestFlashTechTrip(profileId: string): FlashTechTrip {
  return {
    id: "dev-test-trip-001",
    technicianProfileId: profileId,
    technicianName: "Angelo Mendoza",
    originLocation: "Atlanta",
    destinationLocation: "Columbus",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    notes: "Dev test — local only",
    createdBy: null,
    createdByName: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    hotelExpense: null,
    transportationExpense: null,
  };
}

export function MobileTechApp() {
  const { email, displayName, role, extraRoles, companyId, allowedLocations, logout, uid } = useAuth();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const isSelfRole = [role, ...extraRoles].some((r) => r && SELF_ROLES.has(r.toUpperCase()));

  // Resolved once for the whole app shell — needed by DetailView to know
  // which technician is looking at a ticket, for the mobile alert-popup
  // dismiss tracking (ticket_alert_dismissals is keyed per profile).
  const [profileId, setProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyProfileId(uid).then((id) => { if (!cancelled) setProfileId(id); });
    return () => { cancelled = true; };
  }, [uid]);

  // Own assigned branch — RouteMapView's fallback "starting point before
  // the day starts" when live GPS isn't available yet (see its own comment),
  // instead of a real branch office point actually being used there. Not
  // needed for anything else at this level, but simplest to fetch once here.
  // Also grabs scheduleTimezone (CST/EST) in the same call — Ticket Time
  // Dispute needs it so a technician's typed "10:00 AM" is interpreted as
  // 10:00 AM in THEIR scheduled timezone, not whatever timezone their
  // device's clock happens to be set to (same convention Time Clock punches
  // already use — see serverTime.ts).
  const [myAssignedBranch, setMyAssignedBranch] = useState("");
  const [myScheduleTimezone, setMyScheduleTimezone] = useState<ScheduleTimezone>("CST");
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyFullProfile(uid).then((p) => {
      if (cancelled) return;
      // Dev-only: the Aug 31 test scenario needs a real branch to fall back
      // to before GPS kicks in — only fills in when the real profile has
      // none on file, never overrides an actual assigned branch.
      const real = p?.assignedBranch || "";
      setMyAssignedBranch(import.meta.env.DEV && !real ? "Atlanta" : real);
      setMyScheduleTimezone(p?.scheduleTimezone || "CST");
    });
    return () => { cancelled = true; };
  }, [uid]);

  // Red badge on the Chat bottom-nav tab — total unread DMs across every
  // thread, kept live independent of whether ChatView is even mounted.
  // getUnreadCounts is the same batched query MessagesMenu.tsx (desktop)
  // already uses instead of one count-query per thread; only perDm matters
  // here since this mobile shell has no channel chat UI.
  const [unreadDmCount, setUnreadDmCount] = useState(0);
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const refresh = () => {
      getUnreadCounts(profileId)
        .then((counts) => {
          if (!cancelled) setUnreadDmCount(Object.values(counts.perDm).reduce((a, b) => a + b, 0));
        })
        .catch((e) => console.error("mtech: unread DM count poll failed", e));
    };
    refresh();
    const intervalId = window.setInterval(refresh, 30000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [profileId]);

  // Persist the mobile tech-app navigation state across page reloads.
  // The tech expects a refresh to keep them on the same view instead of
  // bouncing back to the technician roster or the ticket list.
  // Stored in sessionStorage so it clears on browser close (but survives
  // ctrl-R, iOS pull-to-refresh, or a mid-shift reload).
  const NAV_STATE_KEY = "ahs:mtech:nav-state:v1";
  const readNavState = (): {
    view?: View;
    tab?: "todo" | "done" | "search";
    detailTab?: DetailTab;
    selectedTech?: string | null;
    activeTicketNo?: string | null;
  } => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.sessionStorage.getItem(NAV_STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const _persisted = readNavState();

  // Manager flow: which technician's tickets are we viewing.
  const [selectedTech, setSelectedTech] = useState<string | null>(
    _persisted.selectedTech ?? null,
  );
  const [view, setView] = useState<View>(() => {
    const stored = _persisted.view;
    const known: View[] = [
      "roster",
      "tickets",
      "map",
      "detail",
      "chat",
      "home",
      "payroll",
      "timecard",
      "clockinteam",
      "parts",
      "onhold",
      "itsupport",
      "payrolldispute",
      "timeoff",
      "tickettimedispute",
      "correction",
    ];
    if (stored && (known as string[]).includes(stored)) {
      return stored as View;
    }
    return isSelfRole ? "home" : "roster";
  });

  // Real on-site Work Start/Work Done times, lifted up here (rather than
  // living only inside HomeOnSiteCard as before) so both the Home card AND
  // the Tickets tab's own list read the exact same live state — tapping
  // Work Start/Done on Home now shows up immediately on that ticket's card
  // in the Tickets tab too, not just on Home. Local-only and blank on
  // mount; seeded below from what's actually persisted (`prev` wins on
  // merge so an optimistic tap made while a seed fetch is still in flight
  // isn't clobbered) — same reasoning HomeOnSiteCard's seed used to have.
  const [arrivedAt, setArrivedAt] = useState<Record<string, string>>({});
  const [doneAt, setDoneAt] = useState<Record<string, string>>({});
  const formatTimeAt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const ticketNoKey = tickets.map((t) => t.ticketNo).join(",");
  useEffect(() => {
    if (!ticketNoKey) return;
    let cancelled = false;
    getOnsiteCheckins(ticketNoKey.split(","))
      .then((checkins) => {
        if (cancelled) return;
        const arrived: Record<string, string> = {};
        const done: Record<string, string> = {};
        for (const [ticketNo, v] of Object.entries(checkins)) {
          if (v.arrivedAt) arrived[ticketNo] = formatTimeAt(v.arrivedAt);
          if (v.doneAt) done[ticketNo] = formatTimeAt(v.doneAt);
        }
        setArrivedAt((prev) => ({ ...arrived, ...prev }));
        setDoneAt((prev) => ({ ...done, ...prev }));
      })
      .catch((e) => console.warn("Failed to load on-site check-in status", e));
    return () => { cancelled = true; };
    // Also re-fetched on `view` change, same reasoning as
    // disputedTimeByTicketNo below — an Approve on desktop (which writes
    // straight onto onsite_arrived_at/onsite_done_at) should be visible
    // here without needing a full page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketNoKey, view]);

  // Ticket Time Disputes (pending or approved), keyed by the ticket they're
  // tied to — a small "Disputed Time" note on that ticket's row in the
  // Tickets tab (To Do or Done, doesn't matter which — TicketsView renders
  // both from the same code), so the adjusted/claimed check-in time stays
  // visible on the ticket itself, not just buried in the dispute's own "My
  // Disputes" list.
  //
  // A ticket can end up with more than one dispute over time. A still-
  // PENDING one always wins the display (labeled "In Progress") — it's the
  // one actually awaiting action right now. With no pending one, falls back
  // to the MOST RECENTLY APPROVED one (labeled "Completed") — since each
  // Approve action writes straight onto the ticket's own onsite_arrived_at/
  // onsite_done_at (see AttendanceMonitoringPage.tsx's
  // handleEmployeeRequestAction), that's always what's actually sitting on
  // the real ticket record. Picked by reviewedAt, not createdAt/array
  // order, since a dispute filed earlier could still get approved later
  // than one filed after it.
  //
  // Re-fetched on every `view` change (not just once on mount) — an Admin
  // approving a dispute on desktop while this tab stays open needs a way to
  // pick that up without a full page reload; switching to the Tickets tab
  // (or back to it) is the natural moment to refresh.
  const [disputedTimeByTicketNo, setDisputedTimeByTicketNo] = useState<Map<string, { time: string; status: "pending" | "approved" }>>(new Map());
  useEffect(() => {
    let cancelled = false;
    getCompanyEmployeeRequests()
      .then((all) => {
        if (cancelled) return;
        const pendingByTicketNo = new Map<string, EmployeeRequestRow>();
        const approvedByTicketNo = new Map<string, EmployeeRequestRow>();
        for (const r of all) {
          if (r.requestType !== "ticket_time_dispute" || !r.ticketNo) continue;
          if (r.status === "pending") {
            const existing = pendingByTicketNo.get(r.ticketNo);
            if (!existing || r.createdAt > existing.createdAt) pendingByTicketNo.set(r.ticketNo, r);
          } else if (r.status === "approved") {
            const existing = approvedByTicketNo.get(r.ticketNo);
            if (!existing || (r.reviewedAt || "") > (existing.reviewedAt || "")) approvedByTicketNo.set(r.ticketNo, r);
          }
        }
        const fmtEntry = (r: EmployeeRequestRow) => `${fmtTimeInZone(r.disputedStartTime, myScheduleTimezone)} – ${fmtTimeInZone(r.disputedEndTime, myScheduleTimezone)} ${myScheduleTimezone}`;
        const map = new Map<string, { time: string; status: "pending" | "approved" }>();
        for (const [ticketNo, r] of approvedByTicketNo) map.set(ticketNo, { time: fmtEntry(r), status: "approved" });
        for (const [ticketNo, r] of pendingByTicketNo) map.set(ticketNo, { time: fmtEntry(r), status: "pending" });
        setDisputedTimeByTicketNo(map);
      })
      .catch((e) => console.error("Failed to load disputed check-in times:", e));
    return () => { cancelled = true; };
  }, [myScheduleTimezone, view]);

  // ChatView clears unread server-side the moment a thread is opened, but
  // the 30s poll above wouldn't reflect that right away — re-poll as soon
  // as the user leaves Chat so the nav badge drops immediately instead of
  // lagging behind what they just read.
  const prevViewRef = useRef<View>(view);
  useEffect(() => {
    if (prevViewRef.current === "chat" && view !== "chat" && profileId) {
      getUnreadCounts(profileId)
        .then((counts) => setUnreadDmCount(Object.values(counts.perDm).reduce((a, b) => a + b, 0)))
        .catch((e) => console.error("mtech: unread DM count re-poll failed", e));
    }
    prevViewRef.current = view;
  }, [view, profileId]);

  const [tab, setTab] = useState<"todo" | "done" | "search">(
    _persisted.tab ?? "todo",
  );
  const [search, setSearch] = useState("");
  const [activeTicketNo, setActiveTicketNo] = useState<string | null>(
    _persisted.activeTicketNo ?? null,
  );
  const [detailTab, setDetailTab] = useState<DetailTab>(
    _persisted.detailTab ?? "general",
  );

  // Save nav state on every change so a reload restores exactly where
  // the tech was. Only persists the fields we care about; search text
  // is intentionally left transient.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        NAV_STATE_KEY,
        JSON.stringify({
          view,
          tab,
          detailTab,
          selectedTech,
          activeTicketNo,
        }),
      );
    } catch { /* quota — nothing to do */ }
  }, [view, tab, detailTab, selectedTech, activeTicketNo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getCompanyTickets();
        // Overlay the latest visit-recorded technician onto tickets whose
        // `technician` is blank. Same rule the Work Map and Daily Schedule
        // already use — without this, a tech only sees the tickets where
        // their name is on the ticket row itself and misses tickets whose
        // assignment lives only in the Visit Log.
        try {
          const ids = rows
            .map((t: any) => String(t?._id ?? "").trim())
            .filter(Boolean);
          if (ids.length > 0) {
            const techMap = await getLatestVisitTechnicianByTicketIds(ids);
            for (const t of rows as any[]) {
              const tid = String(t?._id ?? "").trim();
              const currentTech = String(t.technician ?? "").trim();
              if (!currentTech || currentTech.toLowerCase() === "unassigned") {
                const visitTech = tid ? techMap.get(tid) : "";
                if (visitTech) t.technician = visitTech;
              }
            }
          }
        } catch (visitErr) {
          console.warn("Mobile: tech overlay skipped", visitErr);
        }
        if (!cancelled) setTickets(import.meta.env.DEV ? [...rows, ...buildDevTestRouteTickets()] : rows);
      } catch (e) {
        console.error("Mobile: failed to load tickets", e);
        if (!cancelled) setTickets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Payroll-hold flags for the On Hold Tickets tab — this is a DIFFERENT
  // "on hold" than a ticket's own repair status (e.g. "OP-UPDATE HOLD"): it's
  // mileage_entries.payrollExcluded, the same flag Accounting's Mileage tab
  // "Notify On-Hold" button reads (missing service photos, or a manual hold)
  // — see AccountingDashboard.tsx's mileageOnHoldByTechnician. A held ticket
  // can have any ordinary status, so matching on status text would (and did)
  // miss it entirely.
  const [mileageEntries, setMileageEntries] = useState<MileageEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    getMileageEntries()
      .then((rows) => { if (!cancelled) setMileageEntries(rows); })
      .catch((e) => console.error("Mobile: failed to load mileage entries", e));
    return () => { cancelled = true; };
  }, []);

  // This technician's own payroll run history — for On Hold Tickets' Dispute
  // sub-tab, to tell whether a released ticket's payroll period was already
  // generated before it got released (see disputeEligibleTickets below). A
  // manager-tier viewer has no single "my payroll" to check against, so this
  // only fetches for a real technician.
  const [myPayslips, setMyPayslips] = useState<MyPayslipRow[]>([]);
  useEffect(() => {
    if (!isSelfRole || !profileId) return;
    let cancelled = false;
    getMyPayslips(profileId)
      .then((rows) => { if (!cancelled) setMyPayslips(rows); })
      .catch((e) => console.error("Mobile: failed to load payslips", e));
    return () => { cancelled = true; };
  }, [isSelfRole, profileId]);

  // Ticket numbers this tech has already filed a payroll dispute for (any
  // status) — lets the On Hold Tickets Dispute tab flatten that ticket's
  // "Dispute" button to "Submitted" instead of allowing a duplicate filing.
  // Prefill/lock context for the Payroll Dispute form itself, set when
  // arriving via that same "Dispute" button (see MobileOnHoldTicketsView).
  const [disputedTicketNos, setDisputedTicketNos] = useState<Set<string>>(new Set());
  const [payrollDisputePrefill, setPayrollDisputePrefill] = useState<{ ticketNo: string; payPeriod?: string; periodStart?: string; periodEnd?: string } | null>(null);
  // Same idea for the Tickets tab's own "Dispute" button (shown on a ticket
  // flagged missing its Work Start/Work Done timestamp) — jumps straight to
  // Ticket Time Dispute with that ticket pre-selected instead of making the
  // tech find it again in the dropdown.
  const [ticketTimeDisputePrefillTicketNo, setTicketTimeDisputePrefillTicketNo] = useState<string | null>(null);
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    getCompanyEmployeeRequests()
      .then((all) => {
        if (cancelled) return;
        setDisputedTicketNos(new Set(
          all
            .filter((r) => r.requestType === "payroll_dispute" && r.profileId === profileId && r.ticketNo)
            .map((r) => r.ticketNo as string)
        ));
      })
      .catch((e) => console.error("Mobile: failed to load disputed ticket numbers", e));
    return () => { cancelled = true; };
  }, [profileId]);

  // Load real company users (for the manager technician roster). Techs don't
  // need this list, so only fetch for non-self roles.
  useEffect(() => {
    if (isSelfRole) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getCompanyUsers();
        if (!cancelled) setUsers(rows);
      } catch (e) {
        console.error("Mobile: failed to load users", e);
        if (!cancelled) setUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSelfRole]);

  // Location-restricted set (techs/restricted roles). null = unrestricted.
  const locScoped = useMemo(() => {
    if (allowedLocations === null) return tickets;
    return tickets.filter((t) => allowedLocations.includes(t.location));
  }, [tickets, allowedLocations]);

  // The technician name we're scoping to: self for techs, selected for managers.
  const scopeTech = isSelfRole ? displayName || email || "" : selectedTech;

  const myTickets = useMemo(() => {
    if (!scopeTech) return [];
    // Tolerant name match: normalise whitespace + case, and accept the
    // ticket's technician field matching either the technician's full
    // display name or the email-derived alias (e.g. "jkoetsier"). This
    // keeps the mobile to-do list in sync with the Work Map / Daily
    // Schedule, where the same person can appear under slightly
    // different name strings across sources.
    const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const candidates = new Set<string>();
    const scope = normalise(scopeTech);
    if (scope) candidates.add(scope);
    // Add a "lastname-only" alias so "Jordan Koetsier" still matches a
    // ticket stored as just "Koetsier".
    const parts = scope.split(" ");
    if (parts.length >= 2) candidates.add(parts[parts.length - 1]);
    // If the scope looks like an email, also key by the local part.
    if (scope.includes("@")) candidates.add(scope.split("@")[0]);
    return locScoped.filter((t) => {
      const tt = normalise(String(t.technician ?? ""));
      if (!tt) return false;
      if (candidates.has(tt)) return true;
      // Fuzzy contains so "Jordan Koetsier" matches "jkoetsier" or
      // vice-versa — the planner already uses this tolerance to bucket
      // tickets to a tech.
      return Array.from(candidates).some((c) => tt.includes(c) || c.includes(tt));
    });
  }, [locScoped, scopeTech]);

  // Ticket rows flagged "CL-Ready to Complete" but with neither Work Start
  // nor Work Done ever actually stamped — a real gap between what the
  // status claims and what the On-Site Check-In flow actually recorded
  // (missed geofence, forgot to tap it, etc.), surfaced directly in the
  // ticket list so it doesn't need a trip to Attendance Monitoring's
  // Ticket Attendance tab to notice. Derived from the same arrivedAt/doneAt
  // state above — no separate fetch.
  //
  // Scoped to myTickets (this technician's own tickets), NOT the raw
  // company-wide `tickets` — otherwise the count/badge includes every OTHER
  // technician's flagged tickets too, which this tech never actually sees a
  // banner for in their own list, making the badge count not match what's
  // visibly flagged.
  //
  // Also scoped to the last 14 days (by schedule date) — On-Site Check-In
  // timestamps are a new feature, so plenty of real tickets marked
  // CL-Ready to Complete long before it existed will never have one; without
  // this window, the flag/badge counts that entire backlog instead of just
  // the recent, actually-actionable misses.
  const MISSING_TIMESTAMP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  const missingTimestampTicketNos = useMemo(() => {
    const missing = new Set<string>();
    const cutoff = Date.now() - MISSING_TIMESTAMP_WINDOW_MS;
    for (const t of myTickets) {
      if (t.status !== "CL-Ready to Complete" || arrivedAt[t.ticketNo] || doneAt[t.ticketNo]) continue;
      // An APPROVED Ticket Time Dispute means the check-in time now exists
      // — it's just recorded via the dispute (and, for a real ticket, also
      // written straight onto onsite_arrived_at/onsite_done_at by the
      // approve action) rather than a normal Work Start/Work Done tap. A
      // still-pending dispute doesn't clear the flag — nothing's actually
      // been confirmed yet.
      if (disputedTimeByTicketNo.get(t.ticketNo)?.status === "approved") continue;
      const scheduled = t.schedule ? new Date(t.schedule).getTime() : NaN;
      if (!isNaN(scheduled) && scheduled < cutoff) continue;
      missing.add(t.ticketNo);
    }
    return missing;
  }, [myTickets, arrivedAt, doneAt, disputedTimeByTicketNo]);

  // Home landing page's "Assigned Today" list — same tickets To Do would
  // show, further narrowed to today's schedule date.
  const todaysTickets = useMemo(
    () => myTickets.filter((t) => !isDone(t.status) && isScheduledToday(t)),
    [myTickets]
  );

  // On-Site Check-In's ticket list — the technician's whole active queue
  // (same set the To Do tab shows), not narrowed to today's schedule date
  // like todaysTickets above. Many real tickets don't have a schedule date
  // that matches today exactly, which would otherwise leave this feature
  // with nothing to show even when there's real work to check into.
  const activeTickets = useMemo(() => myTickets.filter((t) => !isDone(t.status)), [myTickets]);

  // Technician roster for managers — real TECHNICIAN-role users from Supabase,
  // scoped to the manager's allowed locations (assigned_branch / branch_access).
  const roster = useMemo(() => {
    // Include users who have TECHNICIAN as their primary role OR in
    // extra_roles (e.g. a manager+technician), but only while active — a
    // deactivated tech shouldn't still show up in the roster.
    const techUsers = users.filter((u) => {
      if (!u.is_active) return false;
      const primary = (u.role || "").toUpperCase();
      if (primary.includes("TECHNICIAN")) return true;
      const extras = ((u as any).extra_roles as string[] | null | undefined) || [];
      return extras.some((r) => String(r).toUpperCase().includes("TECHNICIAN"));
    });
    const inScope = techUsers.filter((u) => {
      if (allowedLocations === null) return true;
      const branches = [u.assigned_branch, ...(u.branch_access || "").split(/[,;]/)]
        .map((b) => (b || "").trim())
        .filter(Boolean);
      // If the tech has no branch info, keep them visible (don't hide silently).
      if (branches.length === 0) return true;
      return branches.some((b) => allowedLocations.includes(b));
    });
    return inScope
      .map((u) => ({
        name: u.display_name || u.username || u.email,
        branch: u.assigned_branch || "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, allowedLocations]);

  const visibleTickets = useMemo(() => {
    let list = myTickets;
    if (tab === "todo") list = list.filter((t) => !isDone(t.status));
    else if (tab === "done") list = list.filter((t) => isDone(t.status));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) =>
        [t.ticketNo, t.customer, t.city, t.model, t.status, t.location].some((v) =>
          (v || "").toLowerCase().includes(q)
        )
      );
    }
    return list;
  }, [myTickets, tab, search]);

  const activeTicket = useMemo(
    () => tickets.find((t) => t.ticketNo === activeTicketNo) || null,
    [tickets, activeTicketNo]
  );

  // On Hold Tickets bottom-nav tab (replaces the old Tech Sheets stub) —
  // joins mileageEntries' payroll-hold flag back to the real Ticket by
  // ticket #, so the card can show full details and still open into the
  // normal ticket detail view via openTicket. Scoped the same way the
  // Tickets tab is: a technician sees only holds on their OWN mileage
  // entries (profileId match — precise, not name-fuzzy), a manager (no
  // single "selected tech" context on this tab) sees every held ticket
  // across their allowed branches instead.
  const onHoldTickets = useMemo(() => {
    const heldTicketNos = new Set(
      mileageEntries
        .filter((e) => e.payrollExcluded && e.ticketNo)
        .filter((e) => (isSelfRole ? e.profileId === profileId : allowedLocations === null || allowedLocations.includes(e.branch)))
        .map((e) => e.ticketNo as string)
    );
    return tickets.filter((t) => heldTicketNos.has(t.ticketNo));
  }, [mileageEntries, isSelfRole, profileId, allowedLocations, tickets]);

  // On Hold Tickets' "Updated" and "Dispute" sub-tabs — mutually exclusive,
  // computed together since they're really one decision per released ticket
  // (payrollReleasedAt, migration 0184 — payrollExcludedAt/payrollHoldReason
  // get wiped back to null the moment a hold clears, so payrollReleasedAt is
  // the only field that still remembers a release happened at all):
  //   - Payroll for that work date's period was already generated BEFORE
  //     the release → the tech got shorted in a run that already went out
  //     → Dispute (technician-only — myPayslips is only ever fetched for
  //     isSelfRole; not time-windowed, since a missed ticket stays eligible
  //     until actually disputed — there's no per-ticket "already filed"
  //     tracking yet, so this may include ones already submitted).
  //   - Otherwise (no run yet for that period, or it ran again after the
  //     release) → the fix landed in time, the existing/next run just
  //     counts it normally → Updated, but only within the last 14 days so
  //     this doesn't grow into a permanent list.
  const { updatedTickets, disputeEligibleTickets, disputePeriodByTicketNo } = useMemo(() => {
    const updated: Ticket[] = [];
    const disputed: Ticket[] = [];
    // Structured periodStart/periodEnd travel alongside the display label
    // so the Dispute tab's "Dispute" button can hand real dates to the
    // Payroll Dispute form (migration 0186) — needed to auto-inject the
    // missing amount into that exact period's Tech Activity Report once
    // approved, not just show a human-readable string.
    const periodByTicketNo = new Map<string, { label: string; periodStart: string; periodEnd: string }>();
    const recentCutoff = Date.now() - RECENTLY_RELEASED_WINDOW_MS;

    for (const e of mileageEntries) {
      if (!e.payrollReleasedAt || !e.ticketNo) continue;
      const inScope = isSelfRole ? e.profileId === profileId : allowedLocations === null || allowedLocations.includes(e.branch);
      if (!inScope) continue;
      const ticket = tickets.find((t) => t.ticketNo === e.ticketNo);
      if (!ticket) continue;

      let isDisputeEligible = false;
      if (isSelfRole && e.workDate) {
        const run = myPayslips.find((p) => p.generatedAt && e.workDate! >= p.periodStart && e.workDate! <= p.periodEnd);
        if (run?.generatedAt && new Date(run.generatedAt).getTime() < new Date(e.payrollReleasedAt).getTime()) {
          isDisputeEligible = true;
          periodByTicketNo.set(e.ticketNo, { label: `${run.periodStart} – ${run.periodEnd}`, periodStart: run.periodStart, periodEnd: run.periodEnd });
        }
      }

      if (isDisputeEligible) disputed.push(ticket);
      else if (new Date(e.payrollReleasedAt).getTime() >= recentCutoff) updated.push(ticket);
    }

    return { updatedTickets: updated, disputeEligibleTickets: disputed, disputePeriodByTicketNo: periodByTicketNo };
  }, [mileageEntries, isSelfRole, profileId, allowedLocations, tickets, myPayslips]);

  // (goDesktop removed — mobile is a separate surface; users stay here.)

  const openTicket = (t: Ticket) => {
    setActiveTicketNo(t.ticketNo);
    setDetailTab("general");
    setView("detail");
  };

  // Slide-in side navigation replaced by persistent bottom nav bar.

  const headerName = displayName || email || "User";
  const companyLabel = companyId || "AH";

  // Unified back navigation for the top-bar back button.
  const handleTopBack = () => {
    if (view === "detail") {
      setView("tickets");
    } else if (view === "map") {
      setView("tickets");
    }
    // All other views are directly reachable from the bottom nav —
    // no in-header back needed.
  };

  // Show the in-header back arrow only for detail (ticket report sub-view).
  // Route map is a bottom-nav primary destination so no back needed there.
  const showTopBack = view === "detail";

  // The five primary tabs shown in the bottom nav.
  const activeBottomTab: BottomTab =
    view === "chat"
      ? "chat"
      : view === "onhold"
      ? "onhold"
      : view === "payroll"
      ? "payroll"
      : view === "map"
      ? "route"
      : view === "home" ||
        view === "timecard" ||
        view === "clockinteam" ||
        view === "itsupport" ||
        view === "payrolldispute" ||
        view === "timeoff" ||
        view === "tickettimedispute" ||
        view === "correction" ||
        view === "notifications"
      ? "home" // Home's own quick-action tiles reach all of these sub-pages
      : "tickets"; // tickets, roster, detail, parts all highlight Tickets

  // Every notification's linkTo is a DESKTOP path (e.g.
  // "/m/dashboard/attendance-monitoring?tab=disputes-inquiries") — the
  // mobile shell is an isolated surface with its own in-memory view
  // switching, not real routes, so clicking one here must redirect within
  // the mobile shell instead of navigating the router to a desktop-only
  // page. Unmapped links (Parts/Mileage/Report — Finance/Accounting-only
  // notifications a technician wouldn't normally get — and the ambiguous
  // "employee-self-service?tab=requests" self-notify link shared by both
  // PTO and Time Correction, which can't be told apart from the URL alone)
  // are a deliberate no-op rather than breaking out to an un-adapted
  // desktop screen. Specific tab checks (pto-management/corrections/
  // ticket-time-disputes) must come before the generic "attendance-monitoring"
  // substring since all three of those links contain it. Old notifications
  // linking to the now-removed "disputes-inquiries" attendance-dispute view
  // fall through as a no-op — nothing left to open.
  const handleNotificationLink = (linkTo: string) => {
    const lower = linkTo.toLowerCase();
    if (lower.includes("it-tickets") || lower.includes("itsupport")) { setView("itsupport"); return; }
    if (lower.includes("payrolldisputes") || lower.includes("accounting-dashboard")) { setPayrollDisputePrefill(null); setView("payrolldispute"); return; }
    if (lower.includes("pto-management")) { setView("timeoff"); return; }
    if (lower.includes("corrections")) { setView("correction"); return; }
    if (lower.includes("ticket-time-disputes")) { setView("tickettimedispute"); return; }
    if (lower.includes("ticket-list") || lower.includes("/ticket/")) { setView(isSelfRole ? "tickets" : "roster"); return; }
  };

  return (
    <div className="mtech">
      {/* ── Fixed top header ───────────────────────────────────────── */}
      <AppHeaderMobile
        logoSrc={logo}
        userName={headerName}
        showBack={showTopBack}
        onBack={handleTopBack}
        onOpenTimecard={() => setView("timecard")}
        showClockInTeam={isAttendanceManagerTierRole(role, extraRoles)}
        onOpenClockInTeam={() => setView("clockinteam")}
        onNotificationLink={handleNotificationLink}
        onOpenNotifications={() => setView("notifications")}
        onSwitchToDesktop={() => {
          setDesktopOverride(true);
          navigate({ to: "/home", replace: true });
        }}
        onLogout={logout}
      />

      {/* ── Scrollable content area ────────────────────────────────── */}
      <div className="mtech-content">
        {view === "roster" && (
          <RosterView
            roster={roster}
            onSelect={(tech) => {
              setSelectedTech(tech);
              setTab("todo");
              setView("tickets");
            }}
          />
        )}

        {view === "tickets" && (
          <TicketsView
            loading={loading}
            tickets={visibleTickets}
            tab={tab}
            setTab={setTab}
            search={search}
            setSearch={setSearch}
            onOpen={openTicket}
            techLabel={scopeTech || ""}
            disputedTimeByTicketNo={disputedTimeByTicketNo}
            missingTimestampTicketNos={missingTimestampTicketNos}
            arrivedAt={arrivedAt}
            doneAt={doneAt}
            onDispute={(ticketNo) => { setTicketTimeDisputePrefillTicketNo(ticketNo); setView("tickettimedispute"); }}
          />
        )}

        {view === "map" && (
          <RouteMapView
            // Date filtering (which day's stops to show) lives inside
            // RouteMapView itself now, alongside its prev/next date
            // navigation — only the status filters (which are day-
            // independent) belong here.
            tickets={myTickets.filter((t) => {
              if (isDone(t.status)) return false;
              const status = String(t.status || "").toLowerCase();
              if (status.startsWith("csr-assigned to asc")) return false;
              if (status.startsWith("csr-needs scheduling")) return false;
              if (status.startsWith("pt-")) return false;
              if (status.includes("resched")) return false;
              return true;
            })}
            onBackToTickets={() => setView("tickets")}
            myProfileId={profileId}
            myBranch={myAssignedBranch}
          />
        )}

        {view === "detail" && activeTicket && (
          <DetailView
            ticket={activeTicket}
            tab={detailTab}
            setTab={setDetailTab}
            companyId={companyId}
            authorName={displayName || email || "User"}
            authorRole={role || ""}
            profileId={profileId}
          />
        )}

        {view === "chat" && (
          <ChatView
            firebaseUid={uid || ""}
            authorName={displayName || email || "User"}
          />
        )}

        {view === "onhold" && (
          <MobileOnHoldTicketsView
            onHoldTickets={onHoldTickets}
            updatedTickets={updatedTickets}
            disputeEligibleTickets={disputeEligibleTickets}
            disputePeriodByTicketNo={disputePeriodByTicketNo}
            disputedTicketNos={disputedTicketNos}
            onDispute={(t) => {
              const period = disputePeriodByTicketNo.get(t.ticketNo);
              setPayrollDisputePrefill({ ticketNo: t.ticketNo, payPeriod: period?.label, periodStart: period?.periodStart, periodEnd: period?.periodEnd });
              setView("payrolldispute");
            }}
            loading={loading}
            onOpen={openTicket}
          />
        )}

        {view === "payroll" && (
          <MobilePayrollView userName={headerName} profileId={profileId} uid={uid} role={role} />
        )}

        {view === "timecard" && (
          <MobileTimecardView uid={uid} profileId={profileId} userName={headerName} />
        )}

        {view === "clockinteam" && (
          <MobileClockInTeamView profileId={profileId} />
        )}

        {view === "itsupport" && (
          <MobileItSupportView userName={headerName} />
        )}

        {view === "payrolldispute" && (
          <MobilePayrollDisputeView
            userName={headerName}
            profileId={profileId}
            companyId={companyId}
            prefill={payrollDisputePrefill}
            onSubmitted={(ticketNo) => setDisputedTicketNos((prev) => new Set(prev).add(ticketNo))}
          />
        )}

        {view === "timeoff" && (
          <MobileTimeOffView userName={headerName} profileId={profileId} />
        )}

        {view === "tickettimedispute" && (
          <MobileTicketTimeDisputeView
            userName={headerName}
            profileId={profileId}
            companyId={companyId}
            technicianName={headerName}
            scheduleTimezone={myScheduleTimezone}
            prefillTicketNo={ticketTimeDisputePrefillTicketNo}
          />
        )}

        {view === "correction" && (
          <MobileTimeCorrectionView userName={headerName} profileId={profileId} />
        )}

        {view === "notifications" && (
          <div className="mtech-scroll">
            <div className="mtech-payroll-heading">
              <div className="mtech-payroll-name">Notifications</div>
              <div className="mtech-payroll-sub">Everything sent to you, in one place</div>
            </div>
            <NotificationCenterPanel onLinkClick={handleNotificationLink} />
          </div>
        )}

        {/* parts sub-view still reachable but not in bottom nav — redirect to tickets */}
        {view === "home" && (
          <MobileHomeView
            userName={headerName}
            role={role}
            uid={uid}
            profileId={profileId}
            todaysTickets={todaysTickets}
            activeTickets={activeTickets}
            onHoldTickets={onHoldTickets}
            onOpenTicketsTab={() => setView("tickets")}
            onOpenOnHoldTab={() => setView("onhold")}
            showClockInTeam={isAttendanceManagerTierRole(role, extraRoles)}
            onOpenClockInTeam={() => setView("clockinteam")}
            onOpenItSupport={() => setView("itsupport")}
            onOpenPayrollDispute={() => { setPayrollDisputePrefill(null); setView("payrolldispute"); }}
            onOpenTimeOff={() => setView("timeoff")}
            onOpenTicketTimeDispute={() => setView("tickettimedispute")}
            onOpenCorrection={() => setView("correction")}
            arrivedAt={arrivedAt}
            setArrivedAt={setArrivedAt}
            doneAt={doneAt}
            setDoneAt={setDoneAt}
          />
        )}

        {view === "parts" && (
          <MobileStubView
            title="Part Pickup"
            message="Part pickup workflows are being redesigned for mobile. Use the desktop site to record part pickups."
          />
        )}
      </div>

      {/* ── Persistent bottom navigation bar ──────────────────────── */}
      <BottomNav
        active={activeBottomTab}
        unreadDmCount={unreadDmCount}
        missingTimestampCount={missingTimestampTicketNos.size}
        onSelect={(tab) => {
          if (tab === "tickets") setView(isSelfRole ? "tickets" : "roster");
          else if (tab === "route") setView("map");
          else setView(tab);
        }}
      />
    </div>
  );
}

// ── New top header — logo left, profile bubble right ─────────────────────
function AppHeaderMobile({
  logoSrc,
  userName,
  showBack,
  onBack,
  onOpenTimecard,
  showClockInTeam,
  onOpenClockInTeam,
  onNotificationLink,
  onOpenNotifications,
  onSwitchToDesktop,
  onLogout,
}: {
  logoSrc: string;
  userName: string;
  showBack: boolean;
  onBack: () => void;
  onOpenTimecard: () => void;
  showClockInTeam: boolean;
  onOpenClockInTeam: () => void;
  onNotificationLink: (linkTo: string) => void;
  onOpenNotifications: () => void;
  onSwitchToDesktop: () => void;
  onLogout: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const initials = userName
    .split(/[\s.@]/)[0]
    .slice(0, 2)
    .toUpperCase() || "U";
  return (
    <header className="mtech-app-header">
      {/* Left: optional back arrow for sub-views like detail/map */}
      <div className="mtech-app-header-left">
        {showBack ? (
          <button
            className="mtech-app-header-back"
            onClick={onBack}
            type="button"
            aria-label="Back"
          >
            ‹
          </button>
        ) : (
          <img src={logoSrc} alt="AH Solutions" className="mtech-app-header-logo" />
        )}
      </div>

      {/* Center: app name wordmark */}
      <div className="mtech-app-header-title">Admin Hub</div>

      {/* Right: notification bell + profile bubble → logout dropdown */}
      <div className="mtech-app-header-right">
        <NotificationsMenu onLinkClick={onNotificationLink} onViewAll={onOpenNotifications} />
        <button
          type="button"
          className="mtech-app-profile-btn relative"
          onClick={() => setMenu((m) => !m)}
          aria-label="Account menu"
        >
          {initials}
          <LocationSharingBadge />
          <OfflineQueueBadge />
        </button>
        {menu && (
          <>
            <div className="mtech-menu-overlay" onClick={() => setMenu(false)} />
            <div className="mtech-app-profile-menu">
              <div className="mtech-app-profile-name">{userName}</div>
              <div className="mtech-app-profile-divider" />
              <button
                type="button"
                className="mtech-app-profile-timecard"
                onClick={() => { setMenu(false); onOpenTimecard(); }}
              >
                🕐 Timecard
              </button>
              {showClockInTeam && (
                <button
                  type="button"
                  className="mtech-app-profile-timecard"
                  onClick={() => { setMenu(false); onOpenClockInTeam(); }}
                >
                  👥 Clock In Team
                </button>
              )}
              <button
                type="button"
                className="mtech-app-profile-timecard"
                onClick={() => { setMenu(false); onSwitchToDesktop(); }}
              >
                🖥️ Desktop Site
              </button>
              <button
                type="button"
                className="mtech-app-profile-logout"
                onClick={() => { setMenu(false); onLogout(); }}
              >
                🚪 Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

// ── Persistent bottom navigation bar ────────────────────────────────────
type BottomTab = "home" | "tickets" | "route" | "chat" | "onhold" | "payroll";
const BOTTOM_TABS: Array<{ id: BottomTab; label: string; icon: React.ReactNode }> = [
  { id: "home",    label: "Home",      icon: <Home        className="mtech-bottom-tab-svg" /> },
  { id: "tickets", label: "Tickets",   icon: <TicketIcon  className="mtech-bottom-tab-svg" /> },
  { id: "route",   label: "Route",     icon: <MapPin      className="mtech-bottom-tab-svg" /> },
  { id: "chat",    label: "Chat",      icon: <MessageCircle className="mtech-bottom-tab-svg" /> },
  { id: "onhold",  label: "On Hold",   icon: <PauseCircle className="mtech-bottom-tab-svg" /> },
  { id: "payroll", label: "Payroll",   icon: <DollarSign  className="mtech-bottom-tab-svg" /> },
];

function BottomNav({
  active,
  unreadDmCount,
  missingTimestampCount,
  onSelect,
}: {
  active: BottomTab;
  unreadDmCount: number;
  /** Tickets flagged CL-Ready to Complete with no Work Start/Work Done recorded (this technician's own, last 14 days — same scope as the Done tab's badge). */
  missingTimestampCount: number;
  onSelect: (tab: BottomTab) => void;
}) {
  return (
    <nav className="mtech-bottom-nav" aria-label="Main navigation">
      {BOTTOM_TABS.map((tab) => {
        const badgeCount = tab.id === "chat" ? unreadDmCount : tab.id === "tickets" ? missingTimestampCount : 0;
        return (
        <button
          key={tab.id}
          type="button"
          className={`mtech-bottom-tab${active === tab.id ? " mtech-bottom-tab-active" : ""}`}
          onClick={() => onSelect(tab.id)}
          aria-label={badgeCount > 0 ? `${tab.label}, ${badgeCount} ${tab.id === "chat" ? "unread" : "missing timestamp"}` : tab.label}
          aria-current={active === tab.id ? "page" : undefined}
        >
          <span className="mtech-bottom-tab-icon">
            {tab.icon}
            {badgeCount > 0 && (
              <span className="mtech-bottom-tab-badge">{badgeCount > 9 ? "9+" : badgeCount}</span>
            )}
          </span>
          <span className="mtech-bottom-tab-label">{tab.label}</span>
        </button>
        );
      })}
    </nav>
  );
}

function RosterView({
  roster,
  onSelect,
}: {
  roster: Array<{ name: string; branch: string }>;
  onSelect: (tech: string) => void;
}) {
  return (
    <div className="mtech-scroll">
      {roster.length === 0 && <div className="mtech-empty">No technicians in your locations.</div>}
      {roster.map((tech) => (
        <button
          key={tech.name}
          className="mtech-roster-card"
          onClick={() => onSelect(tech.name)}
          type="button"
        >
          <div className="mtech-roster-info">
            <span className="mtech-roster-role">Technician{tech.branch ? ` · ${tech.branch}` : ""}</span>
            <span className="mtech-roster-name">{tech.name}</span>
          </div>
          <span className="mtech-roster-chev">›</span>
        </button>
      ))}
    </div>
  );
}

function TicketsView({
  loading,
  tickets,
  tab,
  setTab,
  search,
  setSearch,
  onOpen,
  techLabel,
  disputedTimeByTicketNo,
  missingTimestampTicketNos,
  arrivedAt,
  doneAt,
  onDispute,
}: {
  loading: boolean;
  tickets: Ticket[];
  tab: "todo" | "done" | "search";
  setTab: (t: "todo" | "done" | "search") => void;
  search: string;
  setSearch: (s: string) => void;
  onOpen: (t: Ticket) => void;
  techLabel: string;
  disputedTimeByTicketNo: Map<string, { time: string; status: "pending" | "approved" }>;
  /** Ticket numbers marked "CL-Ready to Complete" with neither Work Start nor Work Done ever stamped — flagged red/amber in the list below. */
  missingTimestampTicketNos: Set<string>;
  /** Same live On-Site Check-In state HomeOnSiteCard tracks — shown per-ticket below so a Work Start/Done tap on Home is visible here too. */
  arrivedAt: Record<string, string>;
  doneAt: Record<string, string>;
  /** Opens Ticket Time Dispute pre-selected to this ticket — offered on a missing-timestamp card so filing one doesn't need a trip through the dropdown. */
  onDispute: (ticketNo: string) => void;
}) {
  const today = new Date().toLocaleDateString("en-US");
  return (
    <>
      <div className="mtech-subbar">
        <span className="mtech-date">{techLabel ? techLabel : today}</span>
      </div>

      <div className="mtech-tabs">
        <button className={tab === "todo" ? "active" : ""} onClick={() => setTab("todo")} type="button">
          To Do
        </button>
        <button className={tab === "done" ? "active" : ""} onClick={() => setTab("done")} type="button" style={{ position: "relative" }}>
          Done
          {missingTimestampTicketNos.size > 0 && (
            <span
              style={{
                position: "absolute",
                top: "0.15rem",
                right: "0.15rem",
                minWidth: "1.1rem",
                height: "1.1rem",
                padding: "0 0.25rem",
                borderRadius: "999px",
                background: "#dc2626",
                color: "#fff",
                fontSize: "0.62rem",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              {missingTimestampTicketNos.size > 9 ? "9+" : missingTimestampTicketNos.size}
            </span>
          )}
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")} type="button">
          Search
        </button>
      </div>

      {tab === "search" && (
        <div className="mtech-searchbar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket, customer, city..."
          />
        </div>
      )}

      <div className="mtech-scroll">
        {loading && <div className="mtech-empty">Loading tickets…</div>}
        {!loading && tickets.length === 0 && <div className="mtech-empty">No tickets here.</div>}
        {!loading &&
          tickets.map((t, i) => {
            const isMissingTimestamp = missingTimestampTicketNos.has(t.ticketNo);
            return (
            <button
              key={t.ticketNo}
              className="mtech-ticket-card"
              onClick={() => onOpen(t)}
              type="button"
              style={isMissingTimestamp ? { border: "1px solid rgba(234,88,12,0.55)", background: "rgba(234,88,12,0.08)" } : undefined}
            >
              {/* Left accent strip with tone color */}
              <div className={`mtech-ticket-accent ${statusTone(t.status)}`} />
              {/* Card body */}
              <div className="mtech-ticket-body">
                <div className="mtech-ticket-row-top">
                  <span className="mtech-ticket-no">
                    {t.ticketNo}
                    {t.schedulePeriod && <span className="mtech-ticket-sched-time">{t.schedulePeriod}</span>}
                  </span>
                  <span className={`mtech-ticket-tone-badge ${statusTone(t.status)}`}>
                    {openDays(t)}d
                  </span>
                </div>
                <div className="mtech-ticket-customer">{t.customer || "—"}</div>
                <div className="mtech-ticket-meta-row">
                  <span className="mtech-ticket-meta-chip">{resolveLocation(t)}</span>
                  {t.warranty && <span className="mtech-ticket-meta-chip">{t.warranty}</span>}
                  {t.city && <span className="mtech-ticket-meta-chip">{t.city}</span>}
                </div>
                <div className="mtech-ticket-status-line">{t.status}</div>
                {t.schedule && (
                  <div className="mtech-ticket-sched">
                    {t.schedule}
                    {t.model ? ` · ${t.model}` : ""}
                  </div>
                )}
                {isMissingTimestamp && (
                  <div
                    style={{
                      marginTop: "0.35rem",
                      padding: "0.35rem 0.5rem",
                      borderRadius: "6px",
                      background: "rgba(234,88,12,0.14)",
                      border: "1px solid rgba(234,88,12,0.4)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                    }}
                  >
                    <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "#ea580c", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      ⚠ No Work Start/Work Done Recorded
                    </span>
                    {/* A <span> here, not a nested <button> — this whole card is already a <button>. */}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onDispute(t.ticketNo); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onDispute(t.ticketNo); } }}
                      style={{
                        fontSize: "0.66rem",
                        fontWeight: 700,
                        color: "#fff",
                        background: "#ea580c",
                        padding: "0.25rem 0.55rem",
                        borderRadius: "999px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Dispute
                    </span>
                  </div>
                )}
                {(arrivedAt[t.ticketNo] || doneAt[t.ticketNo]) && (
                  <div
                    style={{
                      marginTop: "0.35rem",
                      padding: "0.35rem 0.5rem",
                      borderRadius: "6px",
                      background: "rgba(22,163,74,0.1)",
                      border: "1px solid rgba(22,163,74,0.3)",
                      display: "flex",
                      gap: "0.75rem",
                    }}
                  >
                    <span style={{ fontSize: "0.72rem", color: "#e2e8f0" }}>
                      <span style={{ color: "#4ade80", fontWeight: 700 }}>Work Start:</span> {arrivedAt[t.ticketNo] || "—"}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "#e2e8f0" }}>
                      <span style={{ color: "#4ade80", fontWeight: 700 }}>Work Done:</span> {doneAt[t.ticketNo] || "—"}
                    </span>
                  </div>
                )}
                {disputedTimeByTicketNo.has(t.ticketNo) && (() => {
                  const dispute = disputedTimeByTicketNo.get(t.ticketNo)!;
                  const isPending = dispute.status === "pending";
                  const accent = isPending ? "#ca8a04" : "#16a34a";
                  return (
                    <div
                      style={{
                        marginTop: "0.35rem",
                        padding: "0.35rem 0.5rem",
                        borderRadius: "6px",
                        background: isPending ? "rgba(202,138,4,0.12)" : "rgba(22,163,74,0.12)",
                        border: `1px solid ${isPending ? "rgba(202,138,4,0.35)" : "rgba(22,163,74,0.35)"}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem" }}>
                        <span style={{ fontSize: "0.66rem", fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                          Disputed Time
                        </span>
                        <span style={{ fontSize: "0.62rem", fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                          {isPending ? "In Progress" : "Completed"}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#e2e8f0", marginTop: "0.1rem" }}>
                        {dispute.time}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <span className="mtech-ticket-chev-icon">
                <ChevronRight className="h-4 w-4" />
              </span>
            </button>
            );
          })}
      </div>
    </>
  );
}

// Replaces the old "Tech Sheets" bottom-nav stub. Three sub-tabs, same card
// markup as TicketsView's ticket cards but no To Do/Done/Search split since
// each sub-tab here is already its own purpose-scoped list:
//   - On Hold: every ticket currently excluded from payroll.
//   - Updated: tickets released from a hold in the last 14 days — lets a
//     tech confirm what actually cleared after they uploaded photos.
//   - Dispute: released tickets whose payroll period was already generated
//     BEFORE the release — the tech got shorted for it in a run that's
//     already gone out, so it needs a manual Payroll Dispute, not just
//     waiting on the next run. Technician-only; empty for anyone else.
function MobileOnHoldTicketsView({
  onHoldTickets,
  updatedTickets,
  disputeEligibleTickets,
  disputePeriodByTicketNo,
  disputedTicketNos,
  onDispute,
  loading,
  onOpen,
}: {
  onHoldTickets: Ticket[];
  updatedTickets: Ticket[];
  disputeEligibleTickets: Ticket[];
  disputePeriodByTicketNo: Map<string, { label: string; periodStart: string; periodEnd: string }>;
  /** Ticket numbers that already have a payroll dispute on file — the
   *  Dispute tab's button flattens to "Submitted" for these instead of
   *  allowing a second filing. */
  disputedTicketNos: Set<string>;
  /** Opens the Payroll Dispute form with this ticket locked in — only
   *  called from the Dispute tab's own button, never by tapping the card. */
  onDispute: (t: Ticket) => void;
  loading: boolean;
  onOpen: (t: Ticket) => void;
}) {
  const [subTab, setSubTab] = useState<"hold" | "updated" | "dispute">("hold");
  const tickets = subTab === "hold" ? onHoldTickets : subTab === "updated" ? updatedTickets : disputeEligibleTickets;
  return (
    <>
      <div className="mtech-subbar">
        <span className="mtech-date">On Hold Tickets</span>
      </div>

      <div className="mtech-tabs">
        <button className={subTab === "hold" ? "active" : ""} onClick={() => setSubTab("hold")} type="button">
          On Hold{onHoldTickets.length > 0 ? ` (${onHoldTickets.length})` : ""}
        </button>
        <button className={subTab === "updated" ? "active" : ""} onClick={() => setSubTab("updated")} type="button">
          Updated{updatedTickets.length > 0 ? ` (${updatedTickets.length})` : ""}
        </button>
        <button className={subTab === "dispute" ? "active" : ""} onClick={() => setSubTab("dispute")} type="button">
          Dispute{disputeEligibleTickets.length > 0 ? ` (${disputeEligibleTickets.length})` : ""}
        </button>
      </div>

      <div className="mtech-scroll">
        {loading && <div className="mtech-empty">Loading tickets…</div>}
        {!loading && tickets.length === 0 && (
          <div className="mtech-empty">
            {subTab === "hold"
              ? "No tickets on hold right now."
              : subTab === "updated"
              ? "No tickets released from hold in the last 14 days."
              : "No missed payroll to dispute — nothing was released after its pay period already ran."}
          </div>
        )}
        {!loading &&
          tickets.map((t) => {
            const alreadyDisputed = disputedTicketNos.has(t.ticketNo);
            return (
            <div
              key={t.ticketNo}
              className="mtech-ticket-card"
              onClick={() => onOpen(t)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(t); } }}
              role="button"
              tabIndex={0}
            >
              <div className={`mtech-ticket-accent ${statusTone(t.status)}`} />
              <div className="mtech-ticket-body">
                <div className="mtech-ticket-row-top">
                  <span className="mtech-ticket-no">{t.ticketNo}</span>
                  <span className={`mtech-ticket-tone-badge ${statusTone(t.status)}`}>
                    {openDays(t)}d
                  </span>
                </div>
                <div className="mtech-ticket-customer">{t.customer || "—"}</div>
                <div className="mtech-ticket-meta-row">
                  <span className="mtech-ticket-meta-chip">{resolveLocation(t)}</span>
                  {t.warranty && <span className="mtech-ticket-meta-chip">{t.warranty}</span>}
                  {t.city && <span className="mtech-ticket-meta-chip">{t.city}</span>}
                </div>
                <div className="mtech-ticket-status-line">{t.status}</div>
                {subTab === "dispute" && disputePeriodByTicketNo.has(t.ticketNo) && (
                  <div className="mtech-ticket-sched" style={{ color: "#fca5a5" }}>
                    Missed payroll: {disputePeriodByTicketNo.get(t.ticketNo)?.label}
                  </div>
                )}
                {t.schedule && (
                  <div className="mtech-ticket-sched">
                    {t.schedule}
                    {t.model ? ` · ${t.model}` : ""}
                  </div>
                )}
                {subTab === "dispute" && (
                  <button
                    type="button"
                    disabled={alreadyDisputed}
                    onClick={(e) => { e.stopPropagation(); if (!alreadyDisputed) onDispute(t); }}
                    style={{
                      marginTop: "0.5rem",
                      padding: "0.35rem 0.9rem",
                      borderRadius: "8px",
                      border: alreadyDisputed ? "1px solid rgba(148,163,184,0.3)" : "1px solid rgba(96,165,250,0.5)",
                      background: alreadyDisputed ? "rgba(100,116,139,0.15)" : "rgba(59,130,246,0.15)",
                      color: alreadyDisputed ? "#94a3b8" : "#93c5fd",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      cursor: alreadyDisputed ? "default" : "pointer",
                    }}
                  >
                    {alreadyDisputed ? "Submitted" : "Dispute"}
                  </button>
                )}
              </div>
              <span className="mtech-ticket-chev-icon">
                <ChevronRight className="h-4 w-4" />
              </span>
            </div>
            );
          })}
      </div>
    </>
  );
}

function RouteMapView({
  tickets,
  onBackToTickets,
  myProfileId,
  myBranch,
}: {
  tickets: Ticket[];
  onBackToTickets: () => void;
  myProfileId: string | null;
  myBranch: string;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const dirRendererRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Company-wide map provider (see migration 0050) — set from /m/admin.
  const [mapProvider, setMapProvider] = useState<MapProvider | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCompanyMapProvider().then((p) => { if (!cancelled) setMapProvider(p); });
    return () => { cancelled = true; };
  }, []);
  const leafletMapRef = useRef<Leaflet.Map | null>(null);
  const leafletMarkersRef = useRef<Leaflet.Marker[]>([]);
  const leafletRouteLineRef = useRef<Leaflet.Layer | null>(null);
  const [L, setL] = useState<typeof Leaflet | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [error, setError] = useState<string | null>(null);
  // Live GPS, when we have it — wins over the branch fallback below since
  // it's the most accurate "where they actually are" once the day's
  // underway. `origin` itself (derived further down, once effectiveBranch
  // exists) falls back to the branch office point whenever this is null.
  const [gpsOrigin, setGpsOrigin] = useState<{ lat: number; lng: number } | null>(null);

  // Which day's stops to show — defaults to today, shiftable via the
  // prev/next buttons next to the date label so a tech can preview
  // tomorrow's route or glance back at yesterday's.
  const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [selectedDateIso, setSelectedDateIso] = useState(() => isoDate(new Date()));
  const shiftSelectedDate = (days: number) => {
    setSelectedDateIso((prev) => {
      const d = new Date(`${prev}T00:00:00`);
      d.setDate(d.getDate() + days);
      return isoDate(d);
    });
  };

  // Flash Tech — if this technician has a trip covering the selected day,
  // that trip's destination branch becomes their "starting point before the
  // day starts" instead of their normal assigned branch (see the origin
  // fallback below); reverts on its own once the trip's date range ends.
  const [flashTechTrips, setFlashTechTrips] = useState<FlashTechTrip[]>([]);
  useEffect(() => {
    if (!myProfileId) return;
    let cancelled = false;
    getCompanyFlashTechTrips()
      .then((trips) => {
        if (cancelled) return;
        const mine = trips.filter((t) => t.technicianProfileId === myProfileId);
        setFlashTechTrips(import.meta.env.DEV ? [...mine, buildDevTestFlashTechTrip(myProfileId)] : mine);
      })
      .catch((err) => console.error("RouteMapView: failed to load Flash Tech trips", err));
    return () => { cancelled = true; };
  }, [myProfileId]);
  // Dev-only override — flips the effective branch to a Flash Tech
  // destination regardless of the selected date/whether a real trip covers
  // it, so the origin swap can be tested without navigating dates. Local
  // only, never shipped (see the Dev button in the JSX below).
  const [devSimulateFlashTech, setDevSimulateFlashTech] = useState(false);
  const effectiveBranch = useMemo(() => {
    if (import.meta.env.DEV && devSimulateFlashTech) return "Columbus";
    const activeTrip = flashTechTrips.find((t) => t.startDate <= selectedDateIso && selectedDateIso <= t.endDate);
    return activeTrip?.destinationLocation || myBranch;
  }, [flashTechTrips, selectedDateIso, myBranch, devSimulateFlashTech]);
  // The route's actual starting point: live GPS whenever we have it, else
  // the effective branch office point (which already accounts for an
  // active Flash Tech trip on the selected day).
  const origin = useMemo(() => gpsOrigin ?? getOfficeCoordinates(effectiveBranch), [gpsOrigin, effectiveBranch]);

  const dailyTickets = useMemo(() => {
    return tickets.filter((t) => {
      const rawDate = String(t.schedule || (t as any).schedule_date || "").trim();
      if (!rawDate) return false;
      if (rawDate.startsWith(selectedDateIso)) return true;
      const usMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (usMatch) {
        const yy = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
        const iso = `${yy}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
        return iso === selectedDateIso;
      }
      return false;
    });
  }, [tickets, selectedDateIso]);

  const [stops, setStops] = useState<Array<{ ticket: Ticket; pos: { lat: number; lng: number } }>>([]);
  const [legs, setLegs] = useState<
    Array<{ ticketNo: string; customer: string; address: string; distance: string; duration: string; pos: { lat: number; lng: number } }>
  >([]);
  const [routing, setRouting] = useState(true);
  // Toggle a full-screen mode where the directions list, top bar, and
  // Start Navigation button are hidden so only the map + its zoom/pan
  // controls are visible. Handy for eyeballing pin positions or showing
  // the route to a customer without the surrounding chrome.
  const [expanded, setExpanded] = useState(false);
  // When the map container resizes (expand toggle) tell the map engine to
  // recompute so the tiles fill the new dimensions and the route stays
  // centered.
  useEffect(() => {
    if (!mapProvider) return;
    // Give the DOM a beat to flip classes / re-layout before recalculating.
    const t = window.setTimeout(() => {
      try {
        if (mapProvider === "google") {
          const map = mapRef.current;
          const maps = (window as any).google?.maps;
          if (!map || !maps) return;
          maps.event.trigger(map, "resize");
          if (stops.length > 0) {
            const bounds = new maps.LatLngBounds();
            for (const s of stops) bounds.extend(s.pos);
            if (origin) bounds.extend(origin);
            map.fitBounds(bounds, 40);
          }
        } else {
          const map = leafletMapRef.current;
          if (!map || !L) return;
          map.invalidateSize();
          if (stops.length > 0) {
            const points = stops.map((s) => [s.pos.lat, s.pos.lng] as [number, number]);
            if (origin) points.push([origin.lat, origin.lng]);
            map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
          }
        }
      } catch (err) {
        console.warn("map resize skipped", err);
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [expanded, stops, origin, mapProvider, L]);

  // Try to get the technician's current location for the route origin — if
  // it's denied/unavailable, `origin` above already falls back to the
  // branch office point on its own, no extra handling needed here.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGpsOrigin({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        /* denied/unavailable — origin already falls back to the branch point */
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Instantiate the Google map once Google is the active provider.
  useEffect(() => {
    if (mapProvider !== "google") return;
    let cancelled = false;
    loadGoogleMapsScript()
      .then(() => {
        if (cancelled || !mapEl.current) return;
        const g = (window as any).google;
        if (!g?.maps) return;
        if (!mapRef.current) {
          mapRef.current = new g.maps.Map(mapEl.current, {
            zoom: 9,
            center: { lat: 39.5, lng: -98.35 },
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "greedy",
          });
          dirRendererRef.current = new g.maps.DirectionsRenderer({
            map: mapRef.current,
            suppressMarkers: true,
            polylineOptions: { strokeColor: "#5b7eff", strokeWeight: 5 },
          });
        }
        setMapReady(true);
      })
      .catch(() => { if (!cancelled) setError("Google Maps failed to load."); });
    return () => {
      cancelled = true;
      mapRef.current = null;
      dirRendererRef.current = null;
      setMapReady(false);
    };
  }, [mapProvider]);

  // Load the Leaflet module (client-only) once it's the active provider.
  useEffect(() => {
    if (mapProvider !== "leaflet" || L) return;
    let cancelled = false;
    getLeaflet().then((mod) => { if (!cancelled) setL(mod); });
    return () => { cancelled = true; };
  }, [mapProvider, L]);

  // Instantiate the Leaflet map once Leaflet is the active provider.
  useEffect(() => {
    if (mapProvider !== "leaflet" || !L || !mapEl.current) return;
    const container = mapEl.current;
    const map = L.map(container, { zoom: 9, center: [39.5, -98.35], zoomControl: true });
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    leafletMapRef.current = map;
    const detachResizeFix = attachLeafletResizeFix(map, container);
    setMapReady(true);
    return () => {
      detachResizeFix();
      map.remove();
      leafletMapRef.current = null;
      leafletRouteLineRef.current = null;
      setMapReady(false);
    };
  }, [mapProvider, L]);

  // Geocode stops + build the route once the map is ready. Google mode uses
  // real turn-by-turn driving directions (DirectionsService); Leaflet mode
  // uses Geoapify's Routing API (same key as geocoding) for real driving
  // distance/routes too — only falls back to a straight line if that
  // routing call itself fails.
  useEffect(() => {
    if (!mapProvider) return;
    const activeMap = mapProvider === "google" ? mapRef.current : leafletMapRef.current;
    if (!activeMap) return;
    if (mapProvider === "leaflet" && !L) return;
    let cancelled = false;

    const buildRoute = async () => {
      setRouting(true);
      setError(null);
      const geocode = makeGeocoder(mapProvider);

      // Geocode each ticket stop in ticket order.
      const resolved: Array<{ ticket: Ticket; pos: { lat: number; lng: number } }> = [];
      for (const t of dailyTickets) {
        const addr = fmtAddress(t) || t.city || t.location;
        if (!addr) continue;
        const pos = await geocode(addr);
        if (cancelled) return;
        if (pos) resolved.push({ ticket: t, pos });
      }
      setStops(resolved);

      // Place Work-Planner-style badge markers (rounded box + pointer, white
      // border, technician initials + stop number) for each stop.
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      leafletMarkersRef.current.forEach((m) => m.remove());
      leafletMarkersRef.current = [];
      const badgeColors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
      resolved.forEach((s, i) => {
        const initials = getInitials(s.ticket.technician);
        const label = `${initials}${i + 1}`;
        const color = badgeColors[i % badgeColors.length];
        const title = `${s.ticket.ticketNo} - ${s.ticket.customer}`;
        if (mapProvider === "google") {
          const g = (window as any).google;
          const svgMarker = {
            path: "M2 2 L38 2 Q40 2 40 4 L40 16 Q40 18 38 18 L22 18 L20 22 L18 18 L2 18 Q0 18 0 16 L0 4 Q0 2 2 2 Z",
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            scale: 1.8,
            anchor: new g.maps.Point(20, 22),
            labelOrigin: new g.maps.Point(20, 10),
          };
          const marker = new g.maps.Marker({
            map: mapRef.current,
            position: s.pos,
            title,
            icon: svgMarker,
            label: { text: label, color: "#ffffff", fontSize: "13px", fontWeight: "bold" },
          });
          markersRef.current.push(marker);
        } else {
          const marker = L!.marker([s.pos.lat, s.pos.lng], {
            icon: createBadgeDivIcon(
              L!,
              `<div style="background:${color};color:#fff;font-size:13px;font-weight:bold;border:2px solid #fff;border-radius:6px;padding:2px 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${label}</div>`,
              { className: "mtech-stop-marker", anchor: "bottom" },
            ),
            title,
          }).addTo(activeMap as Leaflet.Map);
          leafletMarkersRef.current.push(marker);
        }
      });

      if (resolved.length === 0) {
        setRouting(false);
        setError("No mappable stops for these tickets.");
        return;
      }

      // origin = device location (or first stop); destination = last stop;
      // the middle stops become ordered waypoints.
      const start = origin || resolved[0].pos;
      const points = origin ? resolved : resolved.slice(1);
      if (points.length === 0) {
        if (mapProvider === "google") {
          mapRef.current.setCenter(resolved[0].pos);
          mapRef.current.setZoom(13);
        } else {
          (activeMap as Leaflet.Map).setView([resolved[0].pos.lat, resolved[0].pos.lng], 13);
        }
        setLegs([
          {
            ticketNo: resolved[0].ticket.ticketNo,
            customer: resolved[0].ticket.customer || "",
            address: fmtAddress(resolved[0].ticket),
            distance: "",
            duration: "",
            pos: resolved[0].pos,
          },
        ]);
        setRouting(false);
        return;
      }

      const destination = points[points.length - 1].pos;

      if (mapProvider === "google") {
        const g = (window as any).google;
        const waypoints = points.slice(0, -1).map((p) => ({ location: p.pos, stopover: true }));
        const ds = new g.maps.DirectionsService();
        ds.route(
          {
            origin: start,
            destination,
            waypoints,
            optimizeWaypoints: false,
            travelMode: g.maps.TravelMode.DRIVING,
          },
          (result: any, status: string) => {
            if (cancelled) return;
            if (status === "OK" && result) {
              dirRendererRef.current.setDirections(result);
              const route = result.routes[0];
              const legInfo = route.legs.map((leg: any, i: number) => {
                const t = points[i]?.ticket;
                return {
                  ticketNo: t?.ticketNo || "",
                  customer: t?.customer || "",
                  address: leg.end_address || "",
                  distance: leg.distance?.text || "",
                  duration: leg.duration?.text || "",
                  pos: points[i]?.pos,
                };
              });
              setLegs(legInfo);
            } else {
              setError("Could not build a driving route. Showing stops only.");
              const bounds = new g.maps.LatLngBounds();
              resolved.forEach((s) => bounds.extend(s.pos));
              mapRef.current.fitBounds(bounds);
            }
            setRouting(false);
          }
        );
      } else {
        // Real driving route via Geoapify's Routing API (Leaflet-mode
        // equivalent of Google's DirectionsService) — falls back to a
        // straight line only if the routing call itself fails.
        const routePoints = [start, ...points.map((p) => p.pos)];
        const route = await routeGeoapify(routePoints, "drive");
        if (cancelled) return;

        leafletRouteLineRef.current?.remove();
        leafletRouteLineRef.current = route
          ? L!.geoJSON(route.geometry, { style: { color: "#5b7eff", weight: 5 } }).addTo(activeMap as Leaflet.Map)
          : L!.polyline(routePoints.map((p) => [p.lat, p.lng] as [number, number]), { color: "#5b7eff", weight: 5 }).addTo(activeMap as Leaflet.Map);

        const legInfo = points.map((p, i) => {
          const leg = route?.legs[i];
          if (leg) {
            return {
              ticketNo: p.ticket.ticketNo,
              customer: p.ticket.customer || "",
              address: fmtAddress(p.ticket),
              distance: `${metersToMiles(leg.distanceMeters).toFixed(1)} mi`,
              duration: formatDuration(leg.durationSeconds),
              pos: p.pos,
            };
          }
          const from = i === 0 ? start : points[i - 1].pos;
          const miles = haversineMiles(from, p.pos);
          return {
            ticketNo: p.ticket.ticketNo,
            customer: p.ticket.customer || "",
            address: fmtAddress(p.ticket),
            distance: `${miles.toFixed(1)} mi (straight-line)`,
            duration: "",
            pos: p.pos,
          };
        });
        setLegs(legInfo);
        if (!route) setError("Could not build a driving route. Showing straight-line stops only.");
        (activeMap as Leaflet.Map).fitBounds(L!.latLngBounds(routePoints.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40] });
        setRouting(false);
      }
    };

    void buildRoute();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      leafletMarkersRef.current.forEach((m) => m.remove());
      leafletMarkersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyTickets, origin, mapProvider, mapReady, L]);

  // Format a stop's destination string for the Google Maps deep link.
  // Passing the real street address makes Google Maps drop a properly
  // labeled pin at the building (instead of a freeform "Dropped pin"
  // somewhere near the lat/lng we geocoded ourselves).
  // Falls back to lat/lng only when we have no usable address.
  const stopDestination = (
    ticket: Ticket | undefined,
    pos: { lat: number; lng: number } | null,
  ): string => {
    const addr = ticket ? fmtAddress(ticket).trim() : "";
    if (addr) return addr;
    const city = [ticket?.city, ticket?.state, ticket?.zip]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (city) return city;
    if (pos) return `${pos.lat},${pos.lng}`;
    return "";
  };

  // Open the full multi-stop route in the device's Google Maps (turn-by-turn).
  const openInGoogleMaps = () => {
    if (stops.length === 0) return;
    const destinations = stops.map((s) => stopDestination(s.ticket, s.pos)).filter(Boolean);
    if (destinations.length === 0) return;
    const destination = destinations[destinations.length - 1];
    const waypoints = destinations.slice(0, -1);
    const params = new URLSearchParams({ api: "1", destination, travelmode: "driving" });
    if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
    if (waypoints.length) params.set("waypoints", waypoints.join("|"));
    window.open(
      `https://www.google.com/maps/dir/?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Navigate to a single stop from the directions list. Prefer the
  // address string so the destination pin in Google Maps lands on the
  // actual building. Lat/lng is kept only as a fallback when we don't
  // have an address.
  const navigateToStop = (
    ticketNoOrNull: string | null,
    pos: { lat: number; lng: number } | null,
  ) => {
    const t = ticketNoOrNull
      ? dailyTickets.find((x) => x.ticketNo === ticketNoOrNull)
      : undefined;
    const dest = stopDestination(t, pos);
    if (!dest) return;
    const params = new URLSearchParams({ api: "1", destination: dest, travelmode: "driving" });
    if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
    window.open(
      `https://www.google.com/maps/dir/?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className={`mtech-route ${expanded ? "mtech-route-expanded" : ""}`}>
      {!expanded && (
        <div className="mtech-subbar mtech-route-datebar">
          <button
            type="button"
            className="mtech-route-date-nav"
            onClick={() => shiftSelectedDate(-1)}
            title="Previous day"
            aria-label="Previous day"
          >
            ‹
          </button>
          <span className="mtech-date">{new Date(`${selectedDateIso}T00:00:00`).toLocaleDateString("en-US")}</span>
          <button
            type="button"
            className="mtech-route-date-nav"
            onClick={() => shiftSelectedDate(1)}
            title="Next day"
            aria-label="Next day"
          >
            ›
          </button>
        </div>
      )}

      <div className={`mtech-map-wrap ${expanded ? "expanded" : ""}`}>
        <div className="mtech-map" ref={mapEl}>
          {error && <div className="mtech-empty">{error}</div>}
        </div>
        {/* Expand / collapse toggle — floats over the top-right of the
            map so the tech can flip to a full-screen view of just the
            pinned tickets and back without losing route context. */}
        <button
          type="button"
          className="mtech-map-expand"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Exit full-screen map" : "Full-screen map"}
        >
          {expanded ? "✕ Close" : "⛶ Expand"}
        </button>
      </div>

      {!expanded && (
        <button className="mtech-nav-btn" onClick={openInGoogleMaps} type="button" disabled={stops.length === 0}>
          🧭 Start Navigation
        </button>
      )}

      {!expanded && (
        <div className="mtech-directions">
          <div className="mtech-directions-title">
            {routing ? "Building route…" : `Route · ${legs.length} stop${legs.length === 1 ? "" : "s"}`}
          </div>
          {import.meta.env.DEV && (
            <button
              type="button"
              className="mtech-home-onsite-devbtn"
              onClick={() => setDevSimulateFlashTech((v) => !v)}
            >
              {devSimulateFlashTech ? "✓ " : ""}Dev: simulate Flash Tech → Columbus (local only)
            </button>
          )}
          {legs.map((leg, i) => (
            <button
              key={`${leg.ticketNo}-${i}`}
              className="mtech-direction-row"
              onClick={() => navigateToStop(leg.ticketNo, leg.pos)}
              type="button"
            >
              <span className="mtech-direction-num">{i + 1}</span>
              <span className="mtech-direction-info">
                <span className="mtech-direction-cust">{leg.customer || leg.ticketNo}</span>
                <span className="mtech-direction-addr">{leg.address}</span>
              </span>
              <span className="mtech-direction-meta">
                {leg.duration && <span>{leg.duration}</span>}
                {leg.distance && <span className="mtech-direction-dist">{leg.distance}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailView({
  ticket,
  tab,
  setTab,
  companyId,
  authorName,
  authorRole,
  profileId,
}: {
  ticket: Ticket;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  companyId: string | null;
  authorName: string;
  authorRole: string;
  profileId: string | null;
}) {
  // Mobile popup alerts — fires once per ticket-open (this component mounts
  // fresh whenever a different ticket is opened; it does NOT remount on tab
  // switches, so this doesn't re-fire every time the tech taps a tab).
  const ticketDbId = (ticket as any)._id as string | undefined;
  const [popupAlerts, setPopupAlerts] = useState<TicketAlert[]>([]);
  useEffect(() => {
    setPopupAlerts([]);
    if (!ticketDbId || !profileId) return;
    let cancelled = false;
    getUndismissedMobilePopupAlerts(ticketDbId, profileId)
      .then((alerts) => { if (!cancelled) setPopupAlerts(alerts); })
      .catch((err) => console.error("getUndismissedMobilePopupAlerts error:", err));
    return () => { cancelled = true; };
  }, [ticketDbId, profileId]);

  const dismissPopupAlerts = async () => {
    if (!profileId) { setPopupAlerts([]); return; }
    const ids = popupAlerts.map((a) => a.id);
    setPopupAlerts([]);
    try {
      await Promise.all(ids.map((id) => dismissTicketAlert(id, profileId)));
    } catch (err) {
      console.error("dismissTicketAlert error:", err);
    }
  };

  return (
    <div className="mtech-scroll">
      {popupAlerts.length > 0 && (
        <TicketAlertPopup alerts={popupAlerts} onDismiss={() => void dismissPopupAlerts()} />
      )}
      {/* Always-on ticket info header */}
      <div className="mtech-detail-head">
        <div className="mtech-detail-headinfo">
          <div className="mtech-detail-no">{ticket.ticketNo}</div>
          <div className="mtech-detail-status">🔖 {ticket.status}</div>
          <div className="mtech-detail-line">👤 {ticket.customer || "—"}</div>
          <div className="mtech-detail-line">
            🕑 {ticket.schedule || "Unscheduled"} {ticket.city ? `@ ${ticket.city}` : ""}
          </div>
          <div className="mtech-detail-line">
            📦 {ticket.model} <span className="mtech-ticket-product">({productLabel(ticket)})</span>
          </div>
        </div>
        <div className={`mtech-detail-railbadge ${statusTone(ticket.status)}`}>
          <span>{resolveLocation(ticket)}</span>
          <span>{openDays(ticket)}d</span>
          {ticket.warranty && <span>{ticket.warranty}</span>}
        </div>
      </div>

      {/* Tabs only exist inside an open ticket */}
      <div className="mtech-detail-tabs">
        <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")} type="button">
          General
        </button>
        <button className={tab === "tracking" ? "active" : ""} onClick={() => setTab("tracking")} type="button">
          Service Tracking
        </button>
        <button className={tab === "parts" ? "active" : ""} onClick={() => setTab("parts")} type="button">
          Parts
        </button>
        <button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")} type="button">
          Billing
        </button>
      </div>

      {tab === "general" && (
        <DetailsTab ticket={ticket} authorName={authorName} authorRole={authorRole} />
      )}
      {tab === "tracking" && <RepairTab ticket={ticket} authorName={authorName} />}
      {tab === "parts" && <PartsTab ticket={ticket} authorName={authorName} />}
      {tab === "billing" && <BillingTab ticket={ticket} companyId={companyId} />}
    </div>
  );
}

/** Centered, blocking popup for mobile-flagged ticket alerts. No exact
    centered-dialog precedent existed in this file (the only prior overlay,
    the profile menu, is a corner dropdown) — new class names below. */
function TicketAlertPopup({ alerts, onDismiss }: { alerts: TicketAlert[]; onDismiss: () => void }) {
  return (
    <div className="mtech-alert-popup-scrim">
      <div className="mtech-alert-popup-card">
        <div className="mtech-alert-popup-title">⚠️ Alert{alerts.length > 1 ? "s" : ""}</div>
        <div className="mtech-alert-popup-body">
          {alerts.map((alert) => (
            <p key={alert.id} className="mtech-alert-popup-text">{alert.text}</p>
          ))}
        </div>
        <button type="button" className="mtech-btn mtech-btn-primary mtech-alert-popup-ok" onClick={onDismiss}>
          OK, got it
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value, type }: { label: string; value?: string; type?: "phone" }) {
  const digits = type === "phone" ? String(value || "").replace(/[^\d+]/g, "") : "";
  return (
    <div className="mtech-inforow">
      <span className="mtech-info-label">{label}</span>
      {type === "phone" && digits ? (
        <a href={`tel:${digits}`} className="mtech-info-value mtech-phone-link" title={`Call ${value}`}>
          {value}
        </a>
      ) : (
        <span className="mtech-info-value">{value || "—"}</span>
      )}
    </div>
  );
}

/** Like InfoRow, but stacked (label above value) with real line breaks
    preserved — needed for the Service Performed field, which is
    multi-line free text. */
function ServiceSection({ label, value }: { label: string; value: string }) {
  return (
    <div className="mtech-service-section">
      <div className="mtech-info-label">{label}</div>
      <div className="mtech-service-section-value">{value}</div>
    </div>
  );
}

/** Live, read-only list of parts currently marked "Used" on this ticket -
    not something the tech types, so it's rendered separately from
    Service Performed rather than as one of its sections. */
function PartsUsedList({ parts }: { parts: UIPartRow[] }) {
  if (parts.length === 0) return null;
  const value = parts
    .map((p) => `- ${p.partNo || "?"} — ${p.partDesc || "part"}${p.quantity ? ` (qty ${p.quantity})` : ""}`)
    .join("\n");
  return <ServiceSection label="Parts Used" value={value} />;
}

function DetailsTab({
  ticket,
  authorName,
  authorRole,
}: {
  ticket: Ticket;
  authorName: string;
  authorRole: string;
}) {
  // Per-model reference links (Exploded View / Service Bulletin) — same
  // model_resources data the desktop ticket page's Product Information
  // section shows, just never wired up on mobile before. Shared across
  // every ticket carrying this model number, so a tech adding one in the
  // field also benefits everyone else on the same model.
  const [modelResources, setModelResources] = useState<ModelResources>({
    model: "", explodedViewUrl: "", serviceBulletinUrl: "",
  });
  const [editingResource, setEditingResource] = useState<"exploded" | "bulletin" | null>(null);
  const [resourceDraft, setResourceDraft] = useState("");
  const [savingResource, setSavingResource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!ticket.model) {
      setModelResources({ model: "", explodedViewUrl: "", serviceBulletinUrl: "" });
      return;
    }
    getModelResources(ticket.model)
      .then((res) => { if (!cancelled) setModelResources(res); })
      .catch((err) => console.error("getModelResources error:", err));
    return () => { cancelled = true; };
  }, [ticket.model]);

  const beginEditResource = (kind: "exploded" | "bulletin") => {
    setEditingResource(kind);
    setResourceDraft(kind === "exploded" ? modelResources.explodedViewUrl : modelResources.serviceBulletinUrl);
  };
  const cancelEditResource = () => {
    setEditingResource(null);
    setResourceDraft("");
  };
  const saveEditResource = async () => {
    if (!editingResource || !ticket.model) return;
    setSavingResource(true);
    try {
      const updated = await saveModelResources(ticket.model, {
        explodedViewUrl: editingResource === "exploded" ? resourceDraft.trim() : modelResources.explodedViewUrl,
        serviceBulletinUrl: editingResource === "bulletin" ? resourceDraft.trim() : modelResources.serviceBulletinUrl,
      });
      setModelResources(updated);
      cancelEditResource();
    } catch (err) {
      console.error("saveModelResources error:", err);
      alert(`Failed to save link: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingResource(false);
    }
  };

  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Customer</div>
      <InfoRow label="Name" value={ticket.customer || [ticket.firstName, ticket.lastName].filter(Boolean).join(" ")} />
      <InfoRow label="Phone" value={ticket.phone || ticket.secondPhone} type="phone" />
      <InfoRow label="Location" value={resolveLocation(ticket)} />
      {/* Tier Code — derived from warranty + zip. Shows "N/A" for warranty
          companies outside the Assurant / GE / Miele set so techs can see
          the field exists and that no tiered rate applies. */}
      {(() => {
        const tier = resolveTierCode(ticket.account || ticket.warranty, ticket.zip, (ticket as any).accountNo);
        return <InfoRow label="Tier Code" value={tier ? tier.label : "N/A"} />;
      })()}

      <div className="mtech-section-title">Contact Details</div>
      <InfoRow label="Address" value={ticket.address} />
      <InfoRow label="Address 2" value={ticket.address2} />
      <InfoRow label="State/Zip" value={[ticket.state, ticket.zip].filter(Boolean).join(" ")} />
      <InfoRow label="Home Phone" value={ticket.phone} type="phone" />
      <InfoRow label="Cell Phone" value={ticket.secondPhone} type="phone" />
      <InfoRow label="Email" value={ticket.email} />

      <div className="mtech-section-title">Product Information</div>
      {ticket.model && (
        <div className="mtech-visit-actions" style={{ flexWrap: "wrap" }}>
          {(["exploded", "bulletin"] as const).map((kind) => {
            const label = kind === "exploded" ? "Exploded View" : "Service Bulletin";
            const url = kind === "exploded" ? modelResources.explodedViewUrl : modelResources.serviceBulletinUrl;
            return url ? (
              <a
                key={kind}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mtech-btn mtech-btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", textDecoration: "none" }}
              >
                <ExternalLink size={14} /> {label}
              </a>
            ) : (
              <button
                key={kind}
                type="button"
                className="mtech-btn"
                onClick={() => beginEditResource(kind)}
              >
                + Add {label}
              </button>
            );
          })}
        </div>
      )}
      {editingResource && (
        <div className="mtech-visit-edit">
          <label className="mtech-visit-edit-label">
            {editingResource === "exploded" ? "Exploded View" : "Service Bulletin"} link
          </label>
          <input
            className="mtech-visit-edit-input"
            type="url"
            inputMode="url"
            value={resourceDraft}
            onChange={(e) => setResourceDraft(e.target.value)}
            placeholder="https://…"
            autoFocus
          />
          <div className="mtech-visit-edit-actions">
            <button
              type="button"
              className="mtech-btn mtech-btn-primary"
              disabled={savingResource}
              onClick={() => void saveEditResource()}
            >
              {savingResource ? "Saving…" : "Save"}
            </button>
            <button type="button" className="mtech-btn" disabled={savingResource} onClick={cancelEditResource}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <InfoRow label="Brand" value={ticket.manufacturer} />
      <InfoRow label="Product Category" value={productLabel(ticket)} />
      <InfoRow label="Model Code" value={ticket.model} />
      <InfoRow label="Model Version" value={ticket.modelVersion} />
      <InfoRow label="Serial No" value={ticket.serial} />
      <InfoRow label="Cx Preferred Date" value={(ticket as any).customerPrefDate || ticket.schedule} />
      <InfoRow label="Warranty Type" value={ticket.warranty} />
      <InfoRow label="Redo" value={ticket.redo === "Y" ? "Yes" : "No"} />
      {ticket.purchaseDate && <InfoRow label="Purchase Date" value={ticket.purchaseDate} />}

      <div className="mtech-section-title">Problem Description</div>
      <p className="mtech-problem">{ticket.problemDescription || "—"}</p>

      {/* Servicer Notes thread lives at the bottom of General Information */}
      <CommentThread ticket={ticket} authorName={authorName} authorRole={authorRole} />
    </div>
  );
}

function RepairTab({ ticket, authorName }: { ticket: Ticket; authorName: string }) {
  const [visits, setVisits] = useState<NonNullable<Ticket["visits"]>>([]);
  const [loading, setLoading] = useState(true);
  // Per-visit inline edit state. Techs can edit Repair Status, Cause
  // of Failure, Service Performed, and Non-Completion Reason from the
  // mobile app — everything else stays read-only because it's owned
  // by dispatch / CSR on the desktop side.
  const [editVisitId, setEditVisitId] = useState<string | null>(null);
  // `service` holds the raw textarea text as typed, not a parsed sections
  // object - it's only normalized (labels/blank-lines snapped back into
  // place, Parts Used hint refreshed) on blur and on save, never on every
  // keystroke. Recomposing live on every onChange looks tempting but fights
  // the browser's own cursor position the instant someone types on the
  // blank line reserved under a label (the normal, common case) - the
  // canonical text always differs from what was just typed by one blank
  // line, so a controlled <textarea> would reset the DOM value - and hence
  // the cursor - on nearly every keystroke.
  const [editDraft, setEditDraft] = useState<{
    repairStatus: string;
    diagnosis: string;
    service: string;
    nonCompletionReason: string;
  }>({ repairStatus: "", diagnosis: "", service: composeServicePerformed(emptyServicePerformed()), nonCompletionReason: "" });
  const [savingVisit, setSavingVisit] = useState(false);
  // Red-outlines the Repair Status dropdown after a blocked save attempt —
  // cleared the moment they pick a value. Desktop's own Add Visit modal
  // already blocks an empty Repair Status the same way (see
  // ticket.$ticketNo.tsx's addVisitLogEntry); this closes the same gap on
  // mobile's Save-visit-edit path, which had no validation at all.
  const [repairStatusInvalid, setRepairStatusInvalid] = useState(false);
  const [diagnosisInvalid, setDiagnosisInvalid] = useState(false);
  const [serviceInvalid, setServiceInvalid] = useState(false);

  // Parts Used isn't part of the free-text notes anymore - it's a live,
  // read-only readout of whichever parts the Parts tab currently has
  // marked "Used" on this ticket, attached only to the latest visit log
  // entry (visits[0], since getTicketVisits orders newest-first). This tab
  // unmounts/remounts on every switch (see the `{tab === "tracking" && ...}`
  // gate above), so re-fetching here is enough to pick up a status change
  // made moments ago on the Parts tab without any push/sync machinery.
  const [usedParts, setUsedParts] = useState<UIPartRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [rows, partRows] = await Promise.all([
          getTicketVisits(ticket.ticketNo),
          getTicketParts(ticket.ticketNo),
        ]);
        if (!cancelled) {
          setVisits(rows as any);
          setUsedParts(partRows.filter((p) => p.status === "Used"));
        }
      } catch (e) {
        console.error("load visits failed", e);
        if (!cancelled) {
          setVisits([]);
          setUsedParts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket.ticketNo]);

  const fmtDate = (v: string) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-US");
  };

  const beginEdit = (v: NonNullable<Ticket["visits"]>[number]) => {
    setEditVisitId(v.id);
    setEditDraft({
      repairStatus: String(v.repairStatus ?? ""),
      diagnosis: String(v.diagnosis ?? ""),
      service: composeServicePerformed(parseServicePerformed(String(v.resolution ?? ""))),
      nonCompletionReason: String(v.nonCompletionReason ?? ""),
    });
  };

  const cancelEdit = () => {
    setEditVisitId(null);
    setEditDraft({ repairStatus: "", diagnosis: "", service: composeServicePerformed(emptyServicePerformed()), nonCompletionReason: "" });
    setRepairStatusInvalid(false);
    setDiagnosisInvalid(false);
    setServiceInvalid(false);
  };

  const saveEdit = async (visitId: string) => {
    const repairStatusMissing = !editDraft.repairStatus.trim();
    const diagnosisMissing = !editDraft.diagnosis.trim();
    const serviceMissing = !parseServicePerformed(editDraft.service).notes.trim();
    if (repairStatusMissing || diagnosisMissing || serviceMissing) {
      setRepairStatusInvalid(repairStatusMissing);
      setDiagnosisInvalid(diagnosisMissing);
      setServiceInvalid(serviceMissing);
      const missing = [
        diagnosisMissing && "Cause of Failure",
        serviceMissing && "Service Performed",
        repairStatusMissing && "Repair Status",
      ].filter(Boolean);
      alert(`Missing required field${missing.length > 1 ? "s" : ""} before saving this visit: ${missing.join(", ")}.`);
      return;
    }
    setSavingVisit(true);
    const original = visits.find((row) => row.id === visitId);
    const resolution = composeServicePerformed(parseServicePerformed(editDraft.service));
    // updateTicketVisit overwrites every column (?? null fallback), so the
    // full existing row must be spread first or fields the tech never
    // touched (schedule date, technician, time slot, locked, ...) get
    // silently nulled out. Fully self-contained, so it's also exactly what
    // gets queued below if the write fails — nothing extra to fetch at
    // sync time.
    const payload = {
      ...original,
      repairStatus: editDraft.repairStatus,
      diagnosis: editDraft.diagnosis,
      resolution,
      nonCompletionReason: editDraft.nonCompletionReason,
      updateReason: `Tech ${authorName || ""} updated visit`.trim(),
    } as any;
    // Reflect changes locally immediately — same reasoning as the On-Site
    // Check-In handlers: offline or a flaky connection both just throw
    // from here, and either way the tech shouldn't be blocked waiting on a
    // write that may not complete right now.
    setVisits((prev) =>
      prev.map((row) =>
        row.id === visitId
          ? {
              ...row,
              repairStatus: editDraft.repairStatus,
              diagnosis: editDraft.diagnosis,
              resolution,
              nonCompletionReason: editDraft.nonCompletionReason,
            }
          : row,
      ),
    );
    cancelEdit();
    try {
      await updateTicketVisit(visitId, payload);
    } catch (err) {
      console.warn("Visit edit write failed, queuing for later sync", err);
      await enqueueVisitSave({ visitId, visit: payload }).catch((qErr) =>
        console.error("Failed to queue visit edit", qErr),
      );
    } finally {
      setSavingVisit(false);
    }
  };

  // "Complete" flow — save the visit edits and flip the parent ticket's
  // repair status to "CL-Ready to Complete". Only available when the
  // tech has filled BOTH Cause of Failure AND the Notes section of
  // Service Performed. If the tech put anything into Non-Completion
  // Reason, we assume the job wasn't finished and hide the button
  // entirely; they save with Save instead.
  const completeVisit = async (visitId: string) => {
    setSavingVisit(true);
    try {
      // Force the visit's repair status to Ready to Complete so the visit
      // log and the ticket status stay aligned.
      const readyStatus = "CL-Ready to Complete";
      const resolution = composeServicePerformed(parseServicePerformed(editDraft.service));
      const original = visits.find((row) => row.id === visitId);
      await updateTicketVisit(visitId, {
        ...original,
        repairStatus: readyStatus,
        diagnosis: editDraft.diagnosis,
        resolution,
        nonCompletionReason: editDraft.nonCompletionReason,
        updateReason: `Tech ${authorName || ""} marked visit complete`.trim(),
      } as any);
      // Push the same status to the ticket so it lands on the CSR/dispatch
      // "Ready to Complete" bucket. If this fails we still keep the visit
      // update so the tech's work isn't lost.
      try {
        await updateTicketStatus(ticket.ticketNo, readyStatus);
      } catch (err) {
        console.warn("Ticket status update failed after complete", err);
      }
      setVisits((prev) =>
        prev.map((row) =>
          row.id === visitId
            ? {
                ...row,
                repairStatus: readyStatus,
                diagnosis: editDraft.diagnosis,
                resolution,
                nonCompletionReason: editDraft.nonCompletionReason,
              }
            : row,
        ),
      );
      cancelEdit();
      alert("Ticket marked Ready to Complete.");
    } catch (err) {
      console.error("Failed to complete visit", err);
      alert(
        `Failed to complete: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSavingVisit(false);
    }
  };

  const canComplete =
    editDraft.diagnosis.trim().length > 0 &&
    parseServicePerformed(editDraft.service).notes.trim().length > 0 &&
    editDraft.nonCompletionReason.trim().length === 0;

  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Service Tracking</div>
      {loading && <div className="mtech-muted">Loading visits…</div>}
      {!loading && visits.length === 0 && <div className="mtech-muted">No visits recorded yet.</div>}

      <div className="mtech-visit-list">
        {visits.map((v, idx) => {
          const isEditing = editVisitId === v.id;
          const isLatestVisit = idx === 0;
          // Recompute the label from position rather than trusting the
          // stored visit_no — visits arrives newest-first (oldest = V1), so
          // this stays correct even when visit_no is missing or duplicated
          // in the database. Mirrors the same guard on desktop's Visit
          // History (ticket.$ticketNo.tsx's getNextVisitNumber/visitLabelById).
          const visitLabel = `V${visits.length - idx}`;
          return (
            <div key={v.id} className="mtech-visit">
              <div className="mtech-visit-head">
                <span className="mtech-visit-no">{visitLabel}</span>
                <span className="mtech-visit-status">{v.repairStatus || v.status || "—"}</span>
              </div>
              <div className="mtech-visit-meta">
                <span>📅 {fmtDate(v.scheduleDate)}{v.timeSlot ? ` · ${v.timeSlot}` : ""}</span>
                <span>👤 {v.technician || "—"}</span>
              </div>
              {/* Tech-facing read order: what the customer complained about,
                  then what the tech found, then what the tech did about it
                  (Service Performed's composed text carries Parts Needed
                  right after Notes) — before the lower-priority scheduling
                  fields below. Long free-text fields all use the same
                  stacked ServiceSection layout (label above, full-width
                  value below) instead of InfoRow's label-left/value-right
                  row, which squeezes long paragraphs against the right edge
                  and reads as inconsistent next to short categorical
                  fields like Action Type. */}
              {v.symptomCx && <ServiceSection label="Symptom (Cx)" value={v.symptomCx} />}
              {!isEditing && v.diagnosis && (
                <ServiceSection label="Cause of Failure (Tech)" value={v.diagnosis} />
              )}
              {!isEditing && v.resolution && (
                <ServiceSection label="Service Performed (Tech)" value={v.resolution} />
              )}
              {isLatestVisit && <PartsUsedList parts={usedParts} />}
              {v.activity && <InfoRow label="Activity" value={v.activity} />}
              {v.actionType && <InfoRow label="Action Type (CSR)" value={v.actionType} />}
              {v.repairType && <InfoRow label="Repair Type" value={v.repairType} />}
              {!isEditing && v.nonCompletionReason && (
                <ServiceSection label="Non-Completion Reason" value={v.nonCompletionReason} />
              )}
              {v.schedNotes && <ServiceSection label="Sched Notes" value={v.schedNotes} />}
              {v.note && <ServiceSection label="Internal Note" value={v.note} />}

              {isEditing ? (
                <div className="mtech-visit-edit">
                  <label className={diagnosisInvalid ? "mtech-visit-edit-label field-invalid" : "mtech-visit-edit-label"}>Cause of Failure (Tech) {diagnosisInvalid && <span className="text-rose-400">*required</span>}</label>
                  <textarea
                    className={diagnosisInvalid ? "mtech-visit-edit-input field-invalid" : "mtech-visit-edit-input"}
                    value={editDraft.diagnosis}
                    onChange={(e) => { setEditDraft((d) => ({ ...d, diagnosis: e.target.value })); if (e.target.value.trim()) setDiagnosisInvalid(false); }}
                    placeholder="What failed and why"
                    rows={2}
                  />
                  <label className={serviceInvalid ? "mtech-visit-edit-label field-invalid" : "mtech-visit-edit-label"}>Service Performed (Tech) {serviceInvalid && <span className="text-rose-400">*required</span>}</label>
                  <textarea
                    className={serviceInvalid ? "mtech-visit-edit-input field-invalid" : "mtech-visit-edit-input"}
                    value={editDraft.service}
                    onChange={(e) => { setEditDraft((d) => ({ ...d, service: e.target.value })); if (parseServicePerformed(e.target.value).notes.trim()) setServiceInvalid(false); }}
                    onBlur={() =>
                      setEditDraft((d) => ({
                        ...d,
                        service: composeServicePerformed(parseServicePerformed(d.service)),
                      }))
                    }
                    rows={10}
                  />
                  <label className={repairStatusInvalid ? "mtech-visit-edit-label field-invalid" : "mtech-visit-edit-label"}>Repair Status {repairStatusInvalid && <span className="text-rose-400">*required</span>}</label>
                  <select
                    className={repairStatusInvalid ? "mtech-visit-edit-input field-invalid" : "mtech-visit-edit-input"}
                    value={editDraft.repairStatus}
                    onChange={(e) => { setEditDraft((d) => ({ ...d, repairStatus: e.target.value })); if (e.target.value.trim()) setRepairStatusInvalid(false); }}
                  >
                    <option value="">— select —</option>
                    {MOBILE_REPAIR_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <label className="mtech-visit-edit-label">Non-Completion Reason</label>
                  <textarea
                    className="mtech-visit-edit-input"
                    value={editDraft.nonCompletionReason}
                    onChange={(e) => setEditDraft((d) => ({ ...d, nonCompletionReason: e.target.value }))}
                    placeholder="If the repair wasn't completed, why"
                    rows={2}
                  />
                  <div className="mtech-visit-edit-actions">
                    <button
                      type="button"
                      className="mtech-btn mtech-btn-primary"
                      disabled={savingVisit}
                      onClick={() => void saveEdit(v.id)}
                    >
                      {savingVisit ? "Saving…" : "Save"}
                    </button>
                    {canComplete && (
                      <button
                        type="button"
                        className="mtech-btn mtech-btn-complete"
                        disabled={savingVisit}
                        onClick={() => void completeVisit(v.id)}
                        title="Save and mark the ticket Ready to Complete"
                      >
                        {savingVisit ? "Saving…" : "Complete"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="mtech-btn"
                      disabled={savingVisit}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </div>
                  {editDraft.nonCompletionReason.trim().length > 0 && (
                    <div className="mtech-visit-edit-note">
                      Non-Completion Reason is filled — Complete is disabled.
                      Save this as an incomplete visit instead.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mtech-visit-actions">
                  <button
                    type="button"
                    className="mtech-btn mtech-btn-primary"
                    onClick={() => beginEdit(v)}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mtech-section-title">Repair Information</div>
      <InfoRow label="Model Code" value={ticket.model} />
      <InfoRow label="Model Version" value={ticket.modelVersion} />
      <InfoRow label="Serial No" value={ticket.serial} />
      <InfoRow label="Diagnosed" value={ticket.diagnosed === "Y" ? "Yes" : "No"} />
      <InfoRow label="Internal Note" value={ticket.internalNote} />

      <div className="mtech-section-title">Attachments</div>
      <TicketPhotos
        ticketNo={ticket.ticketNo}
        category="service"
        title=""
        uploadedBy={authorName}
        visitOptions={Array.from(new Set(visits.map((v) => String(v.visitNo || "")).filter(Boolean)))}
      />
    </div>
  );
}

function CommentThread({
  ticket,
  authorName,
  authorRole,
}: {
  ticket: Ticket;
  authorName: string;
  authorRole: string;
}) {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const rows = await getTicketComments(ticket.ticketNo);
      setComments(rows);
    } catch (e) {
      console.error("load comments failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.ticketNo]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const added = await addTicketComment(ticket.ticketNo, body, authorName, authorRole);
      setComments((prev) => [...prev, added]);
      setText("");
    } catch (e: any) {
      console.error("send comment failed", e);
    } finally {
      setSending(false);
    }
  };

  const fmt = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="mtech-comment-section">
      <div className="mtech-section-title">Servicer Notes</div>
      <p className="mtech-muted" style={{ marginTop: 0 }}>
        Shared with the office — CSRs see these on the ticket's Servicer Notes.
      </p>

      <div className="mtech-comment-thread">
        {loading && <div className="mtech-muted">Loading…</div>}
        {!loading && comments.length === 0 && <div className="mtech-muted">No comments yet.</div>}
        {comments.map((c) => (
          <div key={c.id} className="mtech-comment">
            <div className="mtech-comment-head">
              <span className="mtech-comment-author">
                {c.authorName || "User"}
                {c.authorRole ? ` · ${c.authorRole}` : ""}
              </span>
              <span className="mtech-comment-time">{fmt(c.createdAt)}</span>
            </div>
            <div className="mtech-comment-body"><MessageBody text={c.body} className="m-0" /></div>
          </div>
        ))}
      </div>

      <div className="mtech-comment-compose">
        <textarea
          rows={2}
          value={text}
          placeholder="Write a message to the office…"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" onClick={send} disabled={sending || !text.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const PAYMENT_METHODS = ["Cash", "Check", "Credit Card", "Ext Warranty"];

const EMPTY_BILLING: TicketBilling = {
  labor: 0,
  laborTaxable: true,
  parts: 0,
  partsTaxable: true,
  partsUsed: "",
  diagnose: 0,
  diagnoseTaxable: true,
  others: 0,
  othersTaxable: true,
  taxRate: 0,
  tax: 0,
  deduction: 0,
  total: 0,
  customerName: "",
  paymentMethod: "",
  comment: "",
  signature: "",
};

// Status options the tech can pick from on the mobile part row. Same
// canonical set the desktop Part Transaction table uses — kept in
// sync manually because the desktop list is inlined in ticket.$ticketNo.tsx.
// Sorted alphabetically per the "dropdowns must be alphabetical" rule;
// the blank "" placeholder is pinned to the top so it acts as the
// "— select —" option.
const MOBILE_PART_STATUSES = [
  "",
  ...[
    "Need PO",
    "PO Made",
    "Part Ready",
    "Tech Pickup",
    "Cx Home",
    "Cx Received",
    "SQT Received",
    "Back Order",
    "Cancelled",
    "Used",
    "Not Used & Stocked",
    "Defective",
    "Hold for next vist",
    "Hold for Estimation",
    "Lost",
    "RA - Defect",
    "RA- DMG",
    "RA - PNN",
    "RA - Qty Discrepancy",
    "Claimed",
    "PAID",
  ].sort((a, b) => a.localeCompare(b)),
];

function PartsTab({ ticket, authorName }: { ticket: Ticket; authorName: string }) {
  const [parts, setParts] = useState<UIPartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getTicketParts(ticket.ticketNo);
        if (!cancelled) setParts(rows);
      } catch (e) {
        console.error("load parts failed", e);
        if (!cancelled) setParts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket.ticketNo]);

  const onStatusChange = async (row: UIPartRow, nextStatus: string) => {
    // Optimistic update so the dropdown reflects the pick immediately.
    setParts((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, status: nextStatus } : r)),
    );
    setSavingId(row.id);
    try {
      await updateTicketPart(row.id, {
        status: nextStatus,
        lastModifiedBy: authorName || row.lastModifiedBy,
      });
    } catch (e) {
      console.error("save part status failed", e);
      alert(`Failed to update status: ${e instanceof Error ? e.message : "Unknown error"}`);
      // Roll back.
      setParts((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)),
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Part Transactions</div>
      <div className="mtech-muted mtech-parts-hint">
        Read-only for everything except <strong>Part Status</strong>. Tap the
        status pill to change it (auto-saves).
      </div>

      {loading && <div className="mtech-muted">Loading parts…</div>}
      {!loading && parts.length === 0 && (
        <div className="mtech-muted">No parts logged for this work order.</div>
      )}

      <div className="mtech-part-list">
        {parts.map((p) => (
          <div key={p.id} className="mtech-part">
            <div className="mtech-part-head">
              <span className="mtech-part-no">{p.partNo || "—"}</span>
              <span className="mtech-part-dist">{p.partDist || "—"}</span>
            </div>
            <div className="mtech-part-desc">{p.partDesc || "No description"}</div>

            <div className="mtech-part-status-row">
              <label className="mtech-part-status-label">Part Status</label>
              <select
                className="mtech-part-status-input"
                value={p.status || ""}
                onChange={(e) => void onStatusChange(p, e.target.value)}
                disabled={savingId === p.id}
              >
                {MOBILE_PART_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s || "— select —"}
                  </option>
                ))}
              </select>
              {savingId === p.id && (
                <span className="mtech-part-saving">Saving…</span>
              )}
            </div>

            <div className="mtech-part-details">
              {p.quantity && <InfoRow label="Qty" value={p.quantity} />}
              {p.poNo && <InfoRow label="PO #" value={p.poNo} />}
              {p.poDate && <InfoRow label="PO Date" value={p.poDate} />}
              {p.orderNo && <InfoRow label="Order #" value={p.orderNo} />}
              {p.invoiceNo && <InfoRow label="Invoice #" value={p.invoiceNo} />}
              {p.eta && <InfoRow label="ETA" value={p.eta} />}
              {p.inTracking && (
                <InfoRow label="In Tracking #" value={p.inTracking} />
              )}
              {p.outTracking && (
                <InfoRow label="Out Tracking #" value={p.outTracking} />
              )}
              {p.raNo && <InfoRow label="RA #" value={p.raNo} />}
              {p.claimTo && <InfoRow label="Claim To" value={p.claimTo} />}
              {p.note && <InfoRow label="Note" value={p.note} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Roles the tech can start a DM with from the mobile Chat view. Keeps
// the contact picker focused on the people techs actually need to
// reach: CSR / Triage / Parts / Claims (+ their managers) and admins.
const MOBILE_CHAT_ROLE_ALLOW = new Set(
  [
    "ADMIN",
    "SUPERADMIN",
    "MANAGER",
    "SENIOR_MANAGER",
    "BRANCH_MANAGER",
    "SENIOR_BRANCH_MANAGER",
    "BIZOPS_MANAGER",
    "BIZOPS_SENIOR_MANAGER",
    "CSR",
    "CSR_AGENT",
    "CSR_TEAM_LEADER",
    "CSR_MANAGER",
    "PARTS",
    "PARTS_MANAGER",
    "PARTS_TEAM_LEADER",
    "CLAIMS",
    "CLAIMS_MANAGER",
    "TRIAGE_USER",
    "TRIAGE_MANAGER",
    "DISPATCHER",
  ].map((r) => r.toUpperCase()),
);

function readableRoleLabel(role: string): string {
  const key = String(role || "").toUpperCase();
  const map: Record<string, string> = {
    ADMIN: "Admin",
    SUPERADMIN: "Super Admin",
    MANAGER: "Manager",
    SENIOR_MANAGER: "Senior Manager",
    BRANCH_MANAGER: "Branch Manager",
    SENIOR_BRANCH_MANAGER: "Senior Branch Manager",
    BIZOPS_MANAGER: "BizOps Manager",
    BIZOPS_SENIOR_MANAGER: "BizOps Senior Manager",
    CSR: "CSR Associate",
    CSR_AGENT: "CSR Associate",
    CSR_TEAM_LEADER: "CSR Team Leader",
    CSR_MANAGER: "CSR Manager",
    PARTS: "Parts",
    PARTS_MANAGER: "Parts Manager",
    PARTS_TEAM_LEADER: "Parts Team Leader",
    CLAIMS: "Claims Associate",
    CLAIMS_MANAGER: "Claims Manager",
    TRIAGE_USER: "Technical Support",
    TRIAGE_MANAGER: "Technical Support Manager",
    DISPATCHER: "Dispatcher",
    TECHNICIAN: "Technician",
  };
  return map[key] || key;
}

interface ChatContact {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
}

function ChatView({ firebaseUid, authorName }: { firebaseUid: string; authorName: string }) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contactErr, setContactErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChatContact | null>(null);
  const [thread, setThread] = useState<DmThreadRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [searchName, setSearchName] = useState("");
  // Last message + unread count per teammate, keyed by their profile id -
  // what turns the plain contact directory into a real messenger-style
  // inbox (last message preview, timestamp, unread badge, most-recent-
  // first ordering) without changing how contacts themselves are loaded.
  const [inboxByContact, setInboxByContact] = useState<Map<string, DmInboxEntry>>(new Map());

  const refreshInbox = async (pid: string) => {
    try {
      const entries = await listMyDmInbox(pid);
      setInboxByContact(new Map(entries.map((e) => [e.otherProfileId, e])));
    } catch (e) {
      console.error("chat: load inbox failed", e);
    }
  };

  // 1. Resolve my Supabase profile id from my Firebase uid.
  useEffect(() => {
    let cancelled = false;
    if (!firebaseUid) return;
    (async () => {
      try {
        const id = await getMyProfileId(firebaseUid);
        if (!cancelled) setProfileId(id);
      } catch (e) {
        console.error("chat: resolve profile id failed", e);
        if (!cancelled) setProfileId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [firebaseUid]);

  // 1b. Once we know who I am, load my inbox (last message + unread per
  // teammate) for the contact list.
  useEffect(() => {
    if (!profileId) return;
    void refreshInbox(profileId);
  }, [profileId]);

  // 2. Load company users, filter to allowed chat roles.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingContacts(true);
      setContactErr(null);
      try {
        const rows = await getCompanyUsers();
        if (cancelled) return;
        const list: ChatContact[] = [];
        for (const u of rows) {
          if (!(u as any).is_active) continue;
          const primary = String((u as any).role || "").toUpperCase();
          const extras = ((u as any).extra_roles as string[] | null | undefined) || [];
          const allRoles = [primary, ...extras.map((r) => String(r).toUpperCase())];
          if (!allRoles.some((r) => MOBILE_CHAT_ROLE_ALLOW.has(r))) continue;
          if ((u as any).firebase_uid === firebaseUid) continue; // don't chat with self
          list.push({
            id: (u as any).id,
            name: (u as any).display_name || (u as any).username || (u as any).email || "User",
            role: primary,
            roleLabel: readableRoleLabel(primary),
          });
        }
        // Alphabetical by display name — as requested for all dropdowns.
        list.sort((a, b) => a.name.localeCompare(b.name));
        setContacts(list);
      } catch (e: any) {
        console.error("chat: load contacts failed", e);
        setContactErr(e?.message || "Failed to load contacts.");
        setContacts([]);
      } finally {
        setLoadingContacts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [firebaseUid]);

  // 3. When a contact is picked, open/create the DM thread + load history.
  useEffect(() => {
    let cancelled = false;
    if (!profileId || !selected) return;
    (async () => {
      setMessagesLoading(true);
      try {
        const t = await getOrCreateDmThread(profileId, selected.id);
        if (cancelled) return;
        setThread(t);
        const rows = await getDmMessages(t.id);
        if (!cancelled) setMessages(rows);
        // Opening the thread reads it - clear its unread badge on the
        // contact list right away rather than waiting for the next
        // inbox refresh.
        await markThreadRead({ profileId, dmThreadId: t.id });
        if (!cancelled) {
          setInboxByContact((prev) => {
            const existing = prev.get(selected.id);
            if (!existing || existing.unreadCount === 0) return prev;
            const next = new Map(prev);
            next.set(selected.id, { ...existing, unreadCount: 0 });
            return next;
          });
        }
      } catch (e) {
        console.error("chat: open thread failed", e);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, selected]);

  // 4. Realtime updates for the open thread. Two channels:
  //   a) Postgres realtime subscription (best case — instant push).
  //   b) A 5-second poll fallback so the thread still auto-refreshes
  //      when realtime isn't enabled on the Supabase project. Merge
  //      is done by message id so we don't double up on the initial
  //      history rows.
  useEffect(() => {
    if (!thread) return;
    let cancelled = false;
    const mergeById = (prev: MessageRow[], incoming: MessageRow[]): MessageRow[] => {
      const seen = new Set(prev.map((m) => m.id));
      const additions = incoming.filter((m) => !seen.has(m.id));
      if (additions.length === 0) return prev;
      return [...prev, ...additions].sort((a, b) => {
        const ta = new Date((a as any).created_at ?? 0).getTime();
        const tb = new Date((b as any).created_at ?? 0).getTime();
        return ta - tb;
      });
    };
    const unsub = subscribeToMessages({
      dmThreadId: thread.id,
      onMessage: (m) => setMessages((prev) => mergeById(prev, [m])),
    });
    // Cheap peek every tick (latest message id for this thread); only pay
    // for the full getDmMessages when something actually moved — realtime
    // is the fast path, this is just the fallback.
    let lastPeekedId: string | null = null;
    const poll = async () => {
      try {
        const top = await peekLatestThreadMessage({ dmThreadId: thread.id });
        if (top?.id === lastPeekedId) return;
        lastPeekedId = top?.id ?? null;
        const rows = await getDmMessages(thread.id);
        if (!cancelled) setMessages((prev) => mergeById(prev, rows));
      } catch (err) {
        console.warn("chat: poll refresh failed", err);
      }
    };
    const intervalId = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      unsub && unsub();
    };
  }, [thread]);

  // Auto-scroll to the bottom whenever the message list grows so newly
  // arrived messages are visible without the tech having to swipe.
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !thread || !profileId) return;
    setSending(true);
    try {
      await sendMessage({
        senderId: profileId,
        senderName: authorName || "Technician",
        dmThreadId: thread.id,
        body,
      });
      setDraft("");
    } catch (e) {
      console.error("chat: send failed", e);
      alert(`Failed to send: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSending(false);
    }
  };

  const availableRoles = useMemo(() => {
    const s = new Set<string>();
    contacts.forEach((c) => c.roleLabel && s.add(c.roleLabel));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const visibleContacts = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    const filtered = contacts.filter((c) => {
      if (roleFilter && c.roleLabel !== roleFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // Messenger-style ordering: teammates with an existing conversation
    // float to the top, most recently active first (contacts is already
    // alphabetical, so everyone without a thread yet just keeps that
    // order beneath them).
    return [...filtered].sort((a, b) => {
      const ea = inboxByContact.get(a.id);
      const eb = inboxByContact.get(b.id);
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      if (ea && eb) return eb.lastMessageAt.localeCompare(ea.lastMessageAt);
      return 0;
    });
  }, [contacts, roleFilter, searchName, inboxByContact]);

  // Compact "messenger" timestamp for the inbox row: clock time for
  // today, weekday for the last week, short date beyond that - same
  // convention most chat apps use so recent activity stays scannable.
  const fmtInboxTime = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
    return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  };

  const fmtTime = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? iso
      : d.toLocaleString("en-US", {
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  };

  if (selected) {
    return (
      <div className="mtech-chat mtech-chat-thread">
        {/* ── Thread header ── */}
        <div className="mtech-chat-thread-header">
          <button
            className="mtech-chat-back-btn"
            type="button"
            aria-label="Back to contacts"
            onClick={() => {
              setSelected(null);
              setThread(null);
              setMessages([]);
              // Refresh so the contact list's last-message preview picks
              // up anything just sent in this thread.
              if (profileId) void refreshInbox(profileId);
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="mtech-chat-thread-avatar">
            {selected.name.charAt(0).toUpperCase()}
          </div>
          <div className="mtech-chat-thread-info">
            <div className="mtech-chat-thread-name">{selected.name}</div>
            <div className="mtech-chat-thread-role">{selected.roleLabel}</div>
          </div>
        </div>

        {/* ── Message bubbles ── */}
        <div className="mtech-chat-messages" ref={messagesScrollRef}>
          {messagesLoading && (
            <div className="mtech-chat-status">Loading messages…</div>
          )}
          {!messagesLoading && messages.length === 0 && (
            <div className="mtech-chat-status">No messages yet. Say hello 👋</div>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === profileId;
            return (
              <div key={m.id} className={`mtech-msg-row ${mine ? "mine" : "theirs"}`}>
                {!mine && (
                  <div className="mtech-msg-avatar">
                    {selected.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="mtech-msg-bubble-wrap">
                  <div className={`mtech-msg-bubble ${mine ? "mine" : "theirs"}`}>
                    <MessageBody text={m.body} className="m-0" />
                  </div>
                  <div className={`mtech-msg-time ${mine ? "mine" : ""}`}>
                    {fmtTime((m as any).created_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Composer ── */}
        <div className="mtech-chat-composer">
          <input
            className="mtech-chat-composer-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="mtech-chat-send-btn"
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── Contact / inbox list ──────────────────────────────────────────────
  return (
    <div className="mtech-chat mtech-chat-inbox">
      {/* Header bar — full-width search */}
      <div className="mtech-chat-inbox-header">
        <span className="mtech-chat-inbox-title">Messages</span>
        <div className="mtech-chat-search-wrap">
          <svg className="mtech-chat-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="mtech-chat-search-input"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="Search teammates…"
          />
          {searchName && (
            <button className="mtech-chat-search-clear" onClick={() => setSearchName("")} type="button" aria-label="Clear">
              ×
            </button>
          )}
        </div>
        {/* Role filter pills */}
        {availableRoles.length > 0 && (
          <div className="mtech-chat-role-pills">
            <button
              className={`mtech-chat-role-pill${roleFilter === "" ? " active" : ""}`}
              type="button"
              onClick={() => setRoleFilter("")}
            >
              All
            </button>
            {availableRoles.map((r) => (
              <button
                key={r}
                className={`mtech-chat-role-pill${roleFilter === r ? " active" : ""}`}
                type="button"
                onClick={() => setRoleFilter(roleFilter === r ? "" : r)}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Contact rows */}
      {loadingContacts && (
        <div className="mtech-chat-status">Loading contacts…</div>
      )}
      {contactErr && (
        <div className="mtech-chat-status mtech-chat-status-err">{contactErr}</div>
      )}
      {!loadingContacts && visibleContacts.length === 0 && (
        <div className="mtech-chat-status">No matching teammates found.</div>
      )}

      <div className="mtech-chat-contact-list">
        {visibleContacts.map((c) => {
          const entry = inboxByContact.get(c.id);
          const preview = entry?.lastMessageBody
            ? `${entry.lastMessageSenderId === profileId ? "You: " : ""}${entry.lastMessageBody}`
            : "";
          const hasUnread = (entry?.unreadCount ?? 0) > 0;
          return (
            <button
              key={c.id}
              type="button"
              className="mtech-chat-contact-row"
              onClick={() => setSelected(c)}
            >
              <div className="mtech-chat-contact-avatar">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="mtech-chat-contact-info">
                <span className={`mtech-chat-contact-name${hasUnread ? " unread" : ""}`}>
                  {c.name}
                </span>
                {/* Last message preview once a conversation exists; falls
                    back to the role label for teammates never messaged
                    yet, same as before. */}
                <span className={`mtech-chat-contact-preview${hasUnread ? " unread" : ""}`}>
                  {preview || c.roleLabel}
                </span>
              </div>
              <div className="mtech-chat-contact-meta">
                {entry?.lastMessageAt && (
                  <span className="mtech-chat-contact-time">{fmtInboxTime(entry.lastMessageAt)}</span>
                )}
                {hasUnread ? (
                  <span className="mtech-chat-contact-unread-badge">{entry!.unreadCount}</span>
                ) : (
                  <ChevronRight className="mtech-chat-contact-chev h-4 w-4" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BillingTab({ ticket, companyId }: { ticket: Ticket; companyId: string | null }) {
  const [form, setForm] = useState<TicketBilling>(EMPTY_BILLING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  // Load existing billing for this ticket.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const existing = await getTicketBilling(ticket.ticketNo);
        if (cancelled) return;
        setForm(existing ?? { ...EMPTY_BILLING, customerName: ticket.customer || "" });
      } catch (e) {
        console.error("load billing failed", e);
        if (!cancelled) setForm({ ...EMPTY_BILLING, customerName: ticket.customer || "" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket.ticketNo, ticket.customer]);

  // Compute tax + total whenever taxable inputs change.
  const taxableBase =
    (form.laborTaxable ? form.labor : 0) +
    (form.partsTaxable ? form.parts : 0) +
    (form.diagnoseTaxable ? form.diagnose : 0) +
    (form.othersTaxable ? form.others : 0);
  const tax = +(taxableBase * (form.taxRate / 100)).toFixed(2);
  const total = +(
    form.labor + form.parts + form.diagnose + form.others + tax - form.deduction
  ).toFixed(2);

  const num = (v: string) => {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  // ---- Signature canvas drawing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Restore existing signature if present (display only — don't mark as a
    // freshly drawn signature, so we don't re-upload an unchanged one).
    if (form.signature) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = form.signature;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    hasDrawnRef.current = true;
  };
  const endDraw = () => {
    drawingRef.current = false;
  };
  const clearSignature = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    hasDrawnRef.current = false;
    setForm((f) => ({ ...f, signature: "" }));
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // If the tech drew a new signature, upload it to Firebase Storage as a
      // PNG and store the resulting URL (not the raw base64) in the DB.
      let signatureUrl = form.signature;
      if (hasDrawnRef.current && canvasRef.current) {
        const dataUrl = canvasRef.current.toDataURL("image/png");
        // Only re-upload when it's a freshly drawn signature (data URL), not an
        // already-saved https URL.
        if (dataUrl.startsWith("data:image")) {
          if (companyId) {
            signatureUrl = await uploadTicketSignature(companyId, ticket.ticketNo, dataUrl);
          } else {
            // No company context — fall back to storing the data URL inline.
            signatureUrl = dataUrl;
          }
        }
      }
      const payload: TicketBilling = { ...form, tax, total, signature: signatureUrl };
      await saveTicketBilling(ticket.ticketNo, payload);
      setForm(payload);
      setMsg("Billing saved.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to save billing.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="mtech-panel mtech-muted">Loading billing…</div>;

  const money = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Billing Info</div>

      <table className="mtech-bill">
        <thead>
          <tr>
            <th>Cost</th>
            <th>Fee</th>
            <th className="mtech-bill-tax">Tax</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Labor</td>
            <td>
              <input
                className="mtech-bill-input"
                inputMode="decimal"
                value={form.labor || ""}
                onChange={(e) => setForm((f) => ({ ...f, labor: num(e.target.value) }))}
              />
            </td>
            <td className="mtech-bill-tax">
              <input
                type="checkbox"
                checked={form.laborTaxable}
                onChange={(e) => setForm((f) => ({ ...f, laborTaxable: e.target.checked }))}
              />
            </td>
          </tr>
          <tr>
            <td>Parts Used</td>
            <td colSpan={2}>
              <input
                className="mtech-bill-input"
                value={form.partsUsed}
                placeholder="0.00 / 0.00"
                onChange={(e) => setForm((f) => ({ ...f, partsUsed: e.target.value }))}
              />
            </td>
          </tr>
          <tr>
            <td>Parts</td>
            <td>
              <input
                className="mtech-bill-input"
                inputMode="decimal"
                value={form.parts || ""}
                onChange={(e) => setForm((f) => ({ ...f, parts: num(e.target.value) }))}
              />
            </td>
            <td className="mtech-bill-tax">
              <input
                type="checkbox"
                checked={form.partsTaxable}
                onChange={(e) => setForm((f) => ({ ...f, partsTaxable: e.target.checked }))}
              />
            </td>
          </tr>
          <tr>
            <td>Diagnose (Trip)</td>
            <td>
              <input
                className="mtech-bill-input"
                inputMode="decimal"
                value={form.diagnose || ""}
                onChange={(e) => setForm((f) => ({ ...f, diagnose: num(e.target.value) }))}
              />
            </td>
            <td className="mtech-bill-tax">
              <input
                type="checkbox"
                checked={form.diagnoseTaxable}
                onChange={(e) => setForm((f) => ({ ...f, diagnoseTaxable: e.target.checked }))}
              />
            </td>
          </tr>
          <tr>
            <td>Others</td>
            <td>
              <input
                className="mtech-bill-input"
                inputMode="decimal"
                value={form.others || ""}
                onChange={(e) => setForm((f) => ({ ...f, others: num(e.target.value) }))}
              />
            </td>
            <td className="mtech-bill-tax">
              <input
                type="checkbox"
                checked={form.othersTaxable}
                onChange={(e) => setForm((f) => ({ ...f, othersTaxable: e.target.checked }))}
              />
            </td>
          </tr>
          <tr>
            <td>Tax Rate (%)</td>
            <td colSpan={2}>
              <input
                className="mtech-bill-input"
                inputMode="decimal"
                value={form.taxRate || ""}
                onChange={(e) => setForm((f) => ({ ...f, taxRate: num(e.target.value) }))}
              />
            </td>
          </tr>
          <tr>
            <td>Tax</td>
            <td colSpan={2}>{money(tax)}</td>
          </tr>
          <tr>
            <td>Deduction</td>
            <td colSpan={2}>
              <input
                className="mtech-bill-input"
                inputMode="decimal"
                value={form.deduction || ""}
                onChange={(e) => setForm((f) => ({ ...f, deduction: num(e.target.value) }))}
              />
            </td>
          </tr>
          <tr className="mtech-bill-total">
            <td>Total</td>
            <td colSpan={2}>{money(total)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mtech-muted">
        Service has a limited warranty of 90 days for parts and 30 days for labor. Labor is covered for 30 days from
        the first service date; parts only if the same part is defective within 90 days. Only company-supplied parts
        are covered under the limited warranty.
      </p>

      <div className="mtech-section-title">Customer Name</div>
      <input
        className="mtech-bill-input full"
        value={form.customerName}
        onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
      />

      <div className="mtech-section-title">Payment Method</div>
      <select
        className="mtech-bill-input full"
        value={form.paymentMethod}
        onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
      >
        <option value="">Select payment method</option>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <div className="mtech-section-title">Billing (Repair) Comment</div>
      <textarea
        className="mtech-bill-input full"
        rows={3}
        value={form.comment}
        onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
      />

      <div className="mtech-sig-head">
        <span className="mtech-section-title" style={{ margin: 0, border: "none" }}>
          Signature
        </span>
        <button type="button" className="mtech-sig-clear" onClick={clearSignature}>
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="mtech-sig-canvas"
        onPointerDown={startDraw}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
        onPointerLeave={endDraw}
      />

      <button type="button" className="mtech-save-btn" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      {msg && <div className="mtech-save-msg">{msg}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Sidebar-launched views — stay inside the mobile shell
// ══════════════════════════════════════════════════════════════════════

// "Assigned Today" and "On Hold" totals side by side in one card, not two
// separate cards — just the counts, tap either half to jump to that tab for
// the actual ticket details instead of repeating full ticket cards here too.
function HomeTicketStatsCard({
  todaysCount,
  onHoldCount,
  onOpenTicketsTab,
  onOpenOnHoldTab,
}: {
  todaysCount: number;
  onHoldCount: number;
  onOpenTicketsTab: () => void;
  onOpenOnHoldTab: () => void;
}) {
  return (
    <div className="mtech-home-stat-card">
      <button type="button" className="mtech-home-stat-col" onClick={onOpenTicketsTab}>
        <span className="mtech-home-stat-title">Assigned Today</span>
        <span className="mtech-home-stat-value">{todaysCount}</span>
      </button>
      <div className="mtech-home-stat-divider" />
      <button type="button" className="mtech-home-stat-col" onClick={onOpenOnHoldTab}>
        <span className="mtech-home-stat-title">On Hold</span>
        <span className="mtech-home-stat-value">{onHoldCount}</span>
        <span className="mtech-home-stat-sub">Tickets needed updates.</span>
      </button>
    </div>
  );
}

// One Time In/Out/Meal In/Out card on the Home landing page. Two states:
// a plain tappable card showing the recorded value (or "—"), or — once
// armed by a first tap — an inline "Yes / No" confirm in the same slot,
// so committing a clock event never needs a native browser popup.
function ClockCard({
  label,
  value,
  valueClass,
  armed,
  canAct,
  confirmLabel,
  onTap,
  onCancel,
}: {
  label: string;
  value: string;
  valueClass: "in" | "out" | "meal";
  armed: boolean;
  canAct: boolean;
  confirmLabel: string;
  onTap: () => void;
  onCancel: () => void;
}) {
  if (armed) {
    return (
      <div className="mtech-timecard-card mtech-timecard-card-confirm">
        <div className="mtech-timecard-card-confirm-label">{confirmLabel}</div>
        <div className="mtech-timecard-card-confirm-actions">
          <button type="button" className="mtech-timecard-confirm-btn mtech-timecard-confirm-yes" onClick={onTap}>Yes</button>
          <button type="button" className="mtech-timecard-confirm-btn mtech-timecard-confirm-no" onClick={onCancel}>No</button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className="mtech-timecard-card mtech-timecard-card-btn" disabled={!canAct} onClick={onTap}>
      <div className="mtech-timecard-card-label">{label}</div>
      <div className={`mtech-timecard-card-value ${valueClass}`}>{value || "—"}</div>
    </button>
  );
}

// "Location / Ticket#" list of today's assigned tickets with a geofenced
// I'm Here / I'm Done action per ticket. Both buttons only log a timestamped
// ticket comment (no status change) — this is a lightweight arrival/
// completion record for monitoring, not a replacement for the real
// completion flow (photos/parts/signature) technicians still do from the
// ticket's own detail screen. A ticket stays in the list after being marked
// done — both timestamps just show underneath it instead of the buttons —
// so the record stays visible for the rest of the shift rather than
// disappearing the moment it's logged.
function HomeOnSiteCard({
  tickets,
  userName,
  role,
  arrivedAt,
  setArrivedAt,
  doneAt,
  setDoneAt,
}: {
  tickets: Ticket[];
  userName: string;
  role: string | null;
  /** Lifted to MobileTechApp (the top-level component) so the Tickets tab
   * can show the same live Work Start/Work Done times this card records —
   * see missingTimestampTicketNos and the ticket-card timestamp row in
   * TicketsView. */
  arrivedAt: Record<string, string>;
  setArrivedAt: Dispatch<SetStateAction<Record<string, string>>>;
  doneAt: Record<string, string>;
  setDoneAt: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const [mapProvider, setMapProvider] = useState<MapProvider | null>(null);
  const [ticketPos, setTicketPos] = useState<Record<string, { lat: number; lng: number; approximate: boolean } | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCompanyMapProvider().then((p) => { if (!cancelled) setMapProvider(p); });
    return () => { cancelled = true; };
  }, []);

  // Same live position TechnicianLocationTracker.tsx already watches (and
  // uploads to technician_location_pings) — no second navigator.geolocation
  // watch here. That component only turns tracking on when the technician
  // has confirmed Location Consent AND is clocked in; consentConfirmed/
  // clockedIn are exposed here so this card can explain which of those is
  // missing instead of a generic error.
  const { position: coarsePos, accuracy: coarseAccuracyM, watching, consentConfirmed, clockedIn, permissionDenied } = useLiveLocation();

  // The shared watcher (TechnicianLocationTracker) runs at coarse accuracy
  // — cell-tower / Wi-Fi, routinely 1 km+ off — which is right for the
  // dispatch breadcrumb but nowhere near tight enough to clear a check-in
  // geofence. Whenever there's a ticket to check into that isn't done yet,
  // take periodic one-shot high-accuracy (real GPS) fixes and use those for
  // the distance test. `at` is used to ignore a fix that's gone stale (e.g.
  // one taken while still driving). See the effect below focusTickets.
  const [preciseFix, setPreciseFix] = useState<
    { pos: { lat: number; lng: number }; accuracyM: number; at: number } | null
  >(null);
  const [refiningFix, setRefiningFix] = useState(false);
  const preciseFresh = preciseFix != null && Date.now() - preciseFix.at < 45_000;
  const myPos = preciseFresh ? preciseFix!.pos : coarsePos;
  const fixAccuracyM = preciseFresh ? preciseFix!.accuracyM : coarseAccuracyM;
  // Give the technician the benefit of the doubt equal to the fix's own
  // reported uncertainty, capped so a coarse "±3 km" fix can't widen the
  // zone into meaninglessness.
  const accuracySlackMiles = Math.min(
    metersToMiles(fixAccuracyM ?? 0),
    ON_SITE_CHECKIN_ACCURACY_SLACK_CAP_MILES,
  );
  const checkinRadiusMiles = ON_SITE_CHECKIN_RADIUS_MILES + accuracySlackMiles;

  // Dev-only escape hatch for testing the in-radius UI without real GPS
  // (e.g. location permission unavailable in this environment). Gated on
  // import.meta.env.DEV so this never exists in a production build — a
  // simulate-location bypass in prod would defeat the whole point of the
  // geofence. Bypasses both the radius check below AND the "waiting for a
  // fix" gate here — a missing myPos shouldn't block testing when distance
  // itself is about to be ignored anyway.
  const [devSimulate, setDevSimulate] = useState(false);

  // Sharing is only actually "on" once TechnicianLocationTracker.tsx has a
  // live reading flowing (watching) — separate from consentConfirmed, which
  // just means the agreement is on file. Two independent status rows below
  // instead of one message, so a technician can see at a glance which of
  // the two prerequisites is actually missing.
  const sharingActive = watching || devSimulate;
  const sharingReason = !consentConfirmed
    ? null // already explained by the Consent row above — no need to repeat it
    : !clockedIn
    ? "Clock in to start sharing your location."
    : permissionDenied
    ? "Location access is blocked — enable it in your phone's Settings."
    : !sharingActive
    ? "Waiting for a location fix…"
    : null;

  const visibleTickets = tickets;

  // Geocode each visible ticket's address once we know the map provider.
  // geocodeAddress (vs the plain geocode() the route maps use) also returns
  // an `approximate` flag — set when only a street / city / ZIP-centroid
  // anchor could be found because the exact address wouldn't resolve. The
  // check-in geofence must not hard-pass on an approximate anchor.
  useEffect(() => {
    if (!mapProvider) return;
    let cancelled = false;
    (async () => {
      for (const t of visibleTickets) {
        if (ticketPos[t.ticketNo] !== undefined) continue;
        const addr = fmtAddress(t) || t.city || t.location;
        const hit = addr ? await geocodeAddress(mapProvider, addr) : null;
        if (cancelled) return;
        setTicketPos((prev) => ({
          ...prev,
          [t.ticketNo]: hit ? { lat: hit.lat, lng: hit.lng, approximate: hit.approximate } : null,
        }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapProvider, visibleTickets]);

  const distanceFor = (t: Ticket): number | null => {
    const pos = ticketPos[t.ticketNo];
    if (!pos || !myPos) return null;
    return haversineMiles(myPos, pos);
  };

  // Which tickets the card offers a check-in for right now, in priority:
  //   1. every ticket already checked in ("Work Start" tapped) but not yet
  //      marked done — pinned regardless of distance so stepping away
  //      mid-visit (a supply run) doesn't drop an open check-in;
  //   2. every just-finished ticket ("Work Done" tapped) the tech is still
  //      physically at — kept visible instead of instantly swapping to the
  //      next ticket the moment Done is tapped, so packing up/writing notes
  //      on-site doesn't feel like the app rushing them along. Drops off
  //      once they've actually left the geofence, same radius as check-in;
  //   3. plus every not-yet-started ticket currently inside the geofence.
  //      More than one when two customers' zones overlap or several
  //      appliances share one address — the tech picks the right ticket
  //      instead of the app snapping to whichever centroid reads nearest;
  //   4. if that yields nothing, the single nearest ticket overall, shown
  //      dimmed with its distance for context on where they're headed.
  // Sorted nearest-first, capped so a stack of same-address tickets can't
  // bury the card. Empty only while distances are unresolved (map provider /
  // geocoding not ready) or there's nothing to check into.
  const MAX_ONSITE_ROWS = 5;
  const focusTickets = useMemo(() => {
    const notDone = visibleTickets.filter((t) => !doneAt[t.ticketNo]);
    const withD = (t: Ticket) => ({ t, d: distanceFor(t) });
    const byDist = (a: { d: number | null }, b: { d: number | null }) =>
      (a.d ?? Infinity) - (b.d ?? Infinity);

    const inProgress = notDone.filter((t) => arrivedAt[t.ticketNo]);
    const justDoneStillHere = visibleTickets.filter((t) => {
      if (!doneAt[t.ticketNo]) return false;
      const d = distanceFor(t);
      return devSimulate || (d !== null && d <= checkinRadiusMiles);
    });
    const inRadius = notDone
      .filter((t) => !arrivedAt[t.ticketNo])
      .map(withD)
      .filter(
        (x) =>
          x.d !== null &&
          (devSimulate ||
            (ticketPos[x.t.ticketNo]?.approximate !== true && x.d <= checkinRadiusMiles)),
      )
      .map((x) => x.t);

    const active = [...inProgress, ...justDoneStillHere, ...inRadius];
    if (active.length > 0) {
      return active.map(withD).sort(byDist).slice(0, MAX_ONSITE_ROWS).map((x) => x.t);
    }

    const ranked = notDone.map(withD).filter((x) => x.d !== null).sort(byDist);
    if (ranked.length > 0) return [ranked[0].t];

    // No measurable distance for anything. If that's because the addresses
    // genuinely won't geocode (ticketPos resolved to null, not just "not
    // fetched yet"), still surface the un-started ones so the manual "I'm
    // here anyway" path stays reachable — the row shows "Address not on the
    // map". A pending geocode or a missing GPS fix just leaves this empty.
    const ungeocodable = notDone.filter(
      (t) => !arrivedAt[t.ticketNo] && ticketPos[t.ticketNo] === null,
    );
    if (ungeocodable.length > 0) return ungeocodable.slice(0, MAX_ONSITE_ROWS);

    return devSimulate && notDone.length > 0 ? [notDone[0]] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTickets, ticketPos, myPos, arrivedAt, doneAt, devSimulate, checkinRadiusMiles]);

  // Take real-GPS fixes while there's a ticket the technician still needs to
  // check into. One-shot getCurrentPosition (cheap, unlike a second
  // watchPosition) on a short interval so it converges as GPS settles and as
  // they walk in from the truck. Stops once Work Start is tapped (presence is
  // already proven) or the ticket is done; only runs for a clocked-in tech
  // who's confirmed location sharing (same prerequisites as the shared
  // watcher) and never in the dev simulate mode.
  // Comma-joined ticket numbers still awaiting check-in among the rows shown
  // that have a precise point to measure against — non-empty means "the tech
  // is arriving somewhere we can verify", so keep refining. Rows that only
  // have an approximate anchor (or none) don't count: a sharper device fix
  // can't make an approximate geofence pass, so those go straight to the
  // manual override.
  const arrivingKey = useMemo(
    () =>
      focusTickets
        .filter(
          (t) =>
            !arrivedAt[t.ticketNo] &&
            !doneAt[t.ticketNo] &&
            ticketPos[t.ticketNo] != null &&
            ticketPos[t.ticketNo]?.approximate !== true,
        )
        .map((t) => t.ticketNo)
        .sort()
        .join(","),
    [focusTickets, arrivedAt, doneAt, ticketPos],
  );
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (!arrivingKey || permissionDenied || devSimulate) { setRefiningFix(false); return; }
    if (!clockedIn || !consentConfirmed) { setRefiningFix(false); return; }

    let cancelled = false;
    const takeFix = () => {
      if (cancelled) return;
      setRefiningFix(true);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (cancelled) return;
          setRefiningFix(false);
          setPreciseFix({
            pos: { lat: p.coords.latitude, lng: p.coords.longitude },
            accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : 9999,
            at: Date.now(),
          });
        },
        () => { if (!cancelled) setRefiningFix(false); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    };
    takeFix();
    const id = window.setInterval(takeFix, 12_000);
    return () => { cancelled = true; window.clearInterval(id); setRefiningFix(false); };
  }, [arrivingKey, permissionDenied, devSimulate, clockedIn, consentConfirmed]);

  const formatNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const checkInCommentBody = (label: string, time: string, note?: string) =>
    `On-site check-in: ${label} at ${time}${note ? ` — ${note}` : ""}`;

  // Updates local state immediately regardless of how the write goes —
  // offline or a flaky connection (indistinguishable from here, both just
  // throw) queues the same write for auto-sync instead of blocking the
  // technician with an alert; either way they don't stand around waiting
  // on a request that may never complete right now.
  const handleImHere = async (t: Ticket, manualNote?: string) => {
    const time = formatNow();
    const at = new Date().toISOString();
    const body = checkInCommentBody("arrived", time, manualNote);
    setArrivedAt((prev) => ({ ...prev, [t.ticketNo]: time }));
    // A fresh arrival invalidates any earlier "done" mark for this same
    // ticket (re-checking in — a callback, a re-visit, or just a repeat
    // tap) — matches setTicketOnsiteCheckIn's own onsite_done_at reset, so
    // the local UI state doesn't keep showing a stale, now-earlier-than-
    // arrival "Done" time alongside the new one.
    setDoneAt((prev) => {
      if (!(t.ticketNo in prev)) return prev;
      const next = { ...prev };
      delete next[t.ticketNo];
      return next;
    });
    setBusy(t.ticketNo);
    try {
      await Promise.all([
        addTicketComment(t.ticketNo, body, userName, role || ""),
        setTicketOnsiteCheckIn(t.ticketNo, "arrived", at),
      ]);
    } catch (e) {
      console.warn("on-site check-in: arrival write failed, queuing for later sync", e);
      await enqueueOnsiteCheckin({
        ticketNo: t.ticketNo,
        event: "arrived",
        at,
        commentBody: body,
        authorName: userName,
        authorRole: role || "",
      }).catch((qErr) => console.error("on-site check-in: failed to queue arrival", qErr));
    } finally {
      setBusy(null);
    }
  };

  // "I'm here anyway" — used when the automatic geofence rejects a ticket the
  // technician is genuinely standing at (address geocoded to the wrong point,
  // GPS never sharpened, or the address didn't geocode at all). Skips the
  // distance gate but records what the check *did* measure, in the ticket
  // comment, so a manual override is visible to dispatch and its distance
  // can be sanity-checked after the fact. Offered only within
  // ON_SITE_CHECKIN_MANUAL_OVERRIDE_MAX_MILES (or when there's no geocode to
  // measure against) — see the render below.
  const handleManualCheckIn = (t: Ticket, measuredMiles: number | null, approximate: boolean) => {
    const anchor = approximate ? "the mapped area" : "the address";
    const measured =
      measuredMiles === null
        ? "address could not be located on the map"
        : `GPS placed me about ${measuredMiles < 0.1 ? "0.1" : measuredMiles.toFixed(1)} mi from ${anchor}${
            approximate ? " (address only approximately mapped)" : ""
          }`;
    if (!window.confirm(
      `Check in to ${t.ticketNo} anyway?\n\nThe app couldn't confirm you're on site — ${measured}. Only do this if you're actually at the customer's address. It's logged on the ticket.`,
    )) return;
    void handleImHere(t, `manual override — ${measured}`);
  };

  const handleImDone = async (t: Ticket) => {
    const time = formatNow();
    const at = new Date().toISOString();
    setDoneAt((prev) => ({ ...prev, [t.ticketNo]: time }));
    setBusy(t.ticketNo);
    try {
      await Promise.all([
        addTicketComment(t.ticketNo, checkInCommentBody("marked done", time), userName, role || ""),
        setTicketOnsiteCheckIn(t.ticketNo, "done", at),
      ]);
    } catch (e) {
      console.warn("on-site check-in: done write failed, queuing for later sync", e);
      await enqueueOnsiteCheckin({
        ticketNo: t.ticketNo,
        event: "done",
        at,
        commentBody: checkInCommentBody("marked done", time),
        authorName: userName,
        authorRole: role || "",
      }).catch((qErr) => console.error("on-site check-in: failed to queue done", qErr));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mtech-home-onsite">
      <div className="mtech-home-onsite-title">On-Site Check-In</div>
      {focusTickets.length === 0 ? (
        <div className="mtech-home-onsite-empty">
          {visibleTickets.length === 0 ? "No active tickets to check into right now." : "Locating nearby tickets…"}
        </div>
      ) : (
      <div className="mtech-home-onsite-list">
        {focusTickets.length > 1 && (
          <div className="mtech-home-onsite-hint">More than one address is within range — pick the ticket you're actually at.</div>
        )}
        {focusTickets.map((t) => {
          const dist = distanceFor(t);
          const pos = ticketPos[t.ticketNo];
          const geocoded = pos != null;
          // An approximate anchor (street / city / ZIP centroid, or a fuzzy
          // provider match) can be a mile+ from the real building, so it
          // never hard-passes the geofence — those go through the manual
          // override, same as an address that wouldn't geocode at all.
          const approx = pos?.approximate === true;
          const inRadius =
            devSimulate || (dist !== null && !approx && dist <= checkinRadiusMiles);
          const hereAt = arrivedAt[t.ticketNo];
          const finishedAt = doneAt[t.ticketNo];
          const isBusy = busy === t.ticketNo;
          const pending = !inRadius && !hereAt && !finishedAt;
          // Refining the fix (real-GPS one-shot in flight) and still only
          // holding a coarse position — "1.2 mi away" from a cell-tower fix
          // is noise, so say we're still locating rather than show it. Not
          // for approximate anchors: a sharper fix can't help there.
          const locating = pending && refiningFix && !preciseFresh && geocoded && !approx;
          // Manual "I'm here anyway" — offered while the automatic check is
          // failing but the tech is plausibly on site: no usable geocode, an
          // approximate-only anchor, or a precise point within the cap.
          const canManual =
            pending && !locating &&
            (!geocoded || approx || (dist !== null && dist <= ON_SITE_CHECKIN_MANUAL_OVERRIDE_MAX_MILES));
          return (
            <div key={t.ticketNo} className={`mtech-home-onsite-row${pending ? " mtech-home-onsite-row--pending" : ""}`}>
              <div className="mtech-home-onsite-info">
                <span className="mtech-home-onsite-location">{resolveLocation(t)}</span>
                <span className="mtech-home-onsite-ticket">{t.ticketNo}</span>
                {hereAt || finishedAt ? (
                  <span className="mtech-home-onsite-times">
                    {hereAt && `Here ${hereAt}`}
                    {hereAt && finishedAt && "  ·  "}
                    {finishedAt && `Done ${finishedAt}`}
                  </span>
                ) : (
                  (locating || !geocoded || dist !== null) && (
                    <span className="mtech-home-onsite-distance">
                      {locating
                        ? "Getting precise location…"
                        : !geocoded
                        ? "Address not on the map"
                        : approx
                        ? dist === null
                          ? "Approximate area only"
                          : `~${dist.toFixed(1)} mi from the mapped area`
                        : dist! < 0.1
                        ? "Almost there…"
                        : `${dist!.toFixed(1)} mi away`}
                    </span>
                  )
                )}
              </div>
              {!finishedAt && (
                !hereAt ? (
                  <div className="mtech-home-onsite-actions">
                    <button
                      type="button"
                      className="mtech-home-onsite-btn"
                      disabled={!inRadius || isBusy || locating}
                      onClick={() => handleImHere(t)}
                    >
                      {isBusy ? "…" : locating ? "Locating…" : "Work Start"}
                    </button>
                    {canManual && (
                      <button
                        type="button"
                        className="mtech-home-onsite-btn mtech-home-onsite-btn--manual"
                        disabled={isBusy}
                        onClick={() => handleManualCheckIn(t, dist, approx)}
                      >
                        I'm here anyway
                      </button>
                    )}
                  </div>
                ) : (
                  // No radius gate here, unlike "I'm Here" — the meaningful
                  // proof-of-presence already happened at check-in; requiring
                  // it again to close out just adds friction (GPS drift,
                  // stepping to the truck for a part) without verifying
                  // anything new.
                  <button
                    type="button"
                    className="mtech-home-onsite-btn mtech-home-onsite-btn-done"
                    disabled={isBusy}
                    onClick={() => handleImDone(t)}
                  >
                    {isBusy ? "…" : "Work Done"}
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
      )}
      <div className="mtech-home-onsite-hint">Work Start unlocks once your phone's GPS puts you at the customer's address (roughly within a few hundred metres, allowing for GPS and map accuracy).</div>
      <div className="mtech-home-onsite-status-row">
        <span className={`mtech-home-onsite-status ${consentConfirmed ? "is-ok" : "is-bad"}`}>
          {consentConfirmed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} Consent
        </span>
        <span className={`mtech-home-onsite-status ${sharingActive ? "is-ok" : "is-bad"}`}>
          {sharingActive ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} Sharing Location
        </span>
      </div>
      {sharingReason && <div className="mtech-home-onsite-hint">{sharingReason}</div>}
      {import.meta.env.DEV && (
        <button
          type="button"
          className="mtech-home-onsite-devbtn"
          onClick={() => setDevSimulate((v) => !v)}
        >
          {devSimulate ? "✓ " : ""}Dev: simulate in-radius (local only)
        </button>
      )}
    </div>
  );
}

// Home tab: high-level greeting + quick jumps to the same sidebar
// destinations so users can navigate without opening the drawer.
function MobileHomeView({
  userName,
  role,
  uid,
  profileId,
  todaysTickets,
  activeTickets,
  onHoldTickets,
  onOpenTicketsTab,
  onOpenOnHoldTab,
  showClockInTeam,
  onOpenClockInTeam,
  onOpenItSupport,
  onOpenPayrollDispute,
  onOpenTimeOff,
  onOpenTicketTimeDispute,
  onOpenCorrection,
  arrivedAt,
  setArrivedAt,
  doneAt,
  setDoneAt,
}: {
  userName: string;
  role: string | null;
  uid: string | null;
  profileId: string | null;
  todaysTickets: Ticket[];
  activeTickets: Ticket[];
  onHoldTickets: Ticket[];
  onOpenTicketsTab: () => void;
  onOpenOnHoldTab: () => void;
  showClockInTeam: boolean;
  onOpenClockInTeam: () => void;
  onOpenItSupport: () => void;
  onOpenPayrollDispute: () => void;
  onOpenTimeOff: () => void;
  onOpenTicketTimeDispute: () => void;
  onOpenCorrection: () => void;
  arrivedAt: Record<string, string>;
  setArrivedAt: Dispatch<SetStateAction<Record<string, string>>>;
  doneAt: Record<string, string>;
  setDoneAt: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const hourNow = new Date().getHours();
  const greeting =
    hourNow < 12 ? "Good morning" : hourNow < 18 ? "Good afternoon" : "Good evening";

  // Same clock-in/meal data + rules as MobileTimecardView, so tapping a
  // card here is a real Time In/Out or Meal In/Out, not just a shortcut to
  // the Timecard tab. Confirmation is inline (tap to arm, tap Yes to
  // confirm) rather than a native window.confirm() popup, to match the
  // rest of this card-based UI instead of a plain OS dialog.
  const [requiredCheckIn, setRequiredCheckIn] = useState("");
  const [requiredCheckOut, setRequiredCheckOut] = useState("");
  const [workingHours, setWorkingHours] = useState<number | null>(null);
  const [mealMinutes, setMealMinutes] = useState<number | null>(null);
  const [scheduleProfileId, setScheduleProfileId] = useState<string | null>(null);
  const [entry, setEntry] = useState<UITimeEntry>({ checkIn: "", checkOut: "", mealStart: "", mealEnd: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const schedule = await getMyProfileSchedule(uid);
        if (cancelled) return;
        setRequiredCheckIn(schedule.requiredCheckIn);
        setRequiredCheckOut(schedule.requiredCheckOut);
        setWorkingHours(schedule.workingHours);
        setMealMinutes(schedule.mealMinutes);
        setScheduleProfileId(schedule.profileId || null);
        if (!schedule.profileId) return;
        const monthEntries = await getMonthEntries(schedule.profileId, now.getFullYear(), now.getMonth());
        if (!cancelled) setEntry(monthEntries[todayKey] || { checkIn: "", checkOut: "", mealStart: "", mealEnd: "", notes: "" });
      } catch (e) {
        console.error("MobileHomeView: load today's entry failed", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const getNowTime = (): string => {
    const t = new Date();
    return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  };

  const persist = async (next: UITimeEntry) => {
    if (!scheduleProfileId) {
      alert("Could not resolve your profile. Please re-login.");
      return;
    }
    setEntry(next);
    setSaving(true);
    try {
      await saveTimecardEntry(scheduleProfileId, todayKey, next);
    } catch (e) {
      console.error("MobileHomeView: save failed", e);
      alert(`Failed to save: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const canTimeIn = !entry.checkIn && !saving;
  const canTimeOut = !!entry.checkIn && !entry.checkOut && !saving;
  const canMealIn = !!entry.checkIn && !entry.checkOut && !entry.mealStart && !saving;
  const canMealOut = !!entry.mealStart && !entry.mealEnd && !saving;

  // Which card is currently showing its inline "Yes / No" confirm —
  // at most one at a time. Auto-disarms after a few seconds so an armed
  // card doesn't sit there indefinitely if the user taps away.
  type ArmedCard = "checkIn" | "checkOut" | "mealStart" | "mealEnd" | null;
  const [armedCard, setArmedCard] = useState<ArmedCard>(null);
  const armTimerRef = useRef<number | null>(null);

  const arm = (card: ArmedCard) => {
    if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
    setArmedCard(card);
    armTimerRef.current = window.setTimeout(() => setArmedCard(null), 4000);
  };
  const disarm = () => {
    if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
    setArmedCard(null);
  };
  useEffect(() => () => { if (armTimerRef.current) window.clearTimeout(armTimerRef.current); }, []);

  const handleTimeIn = () => {
    if (!canTimeIn) return;
    if (armedCard !== "checkIn") { arm("checkIn"); return; }
    disarm();
    persist({ ...entry, checkIn: getNowTime() });
  };

  const handleTimeOut = () => {
    if (!canTimeOut) return;
    if (armedCard !== "checkOut") { arm("checkOut"); return; }
    disarm();
    persist({ ...entry, checkOut: getNowTime() });
  };

  const handleMealIn = () => {
    if (!canMealIn) return;
    if (armedCard !== "mealStart") {
      if ((!requiredCheckIn || !requiredCheckOut) && !workingHours) {
        alert("No scheduled shift is set for your account. Contact your admin to set your required schedule.");
        return;
      }
      const scheduledShift = resolveScheduledShiftHours(requiredCheckIn, requiredCheckOut, workingHours, mealMinutes);
      if (scheduledShift <= 6) {
        alert(`Meal break is only available for scheduled shifts of more than 6 hours. Your scheduled shift is ${scheduledShift.toFixed(1)} hours.`);
        return;
      }
      arm("mealStart");
      return;
    }
    disarm();
    persist({ ...entry, mealStart: getNowTime() });
  };

  const handleMealOut = () => {
    if (!canMealOut) return;
    if (armedCard !== "mealEnd") { arm("mealEnd"); return; }
    disarm();
    persist({ ...entry, mealEnd: getNowTime() });
  };

  const menuTiles = [
    {
      key: "correction", label: "Time Correction",
      description: "Request a fix to a check-in, check-out, or meal punch",
      onClick: onOpenCorrection, show: true,
    },
    {
      key: "timeoff", label: "Time Off Request",
      description: "Request PTO, sick leave, or unpaid time off",
      onClick: onOpenTimeOff, show: true,
    },
    {
      key: "tickettimedispute", label: "Ticket Time Dispute",
      description: "Report a failed on-site check-in for a ticket",
      onClick: onOpenTicketTimeDispute, show: true,
    },
    {
      key: "payrolldispute", label: "Payroll Dispute",
      description: "Dispute a pay period and track your own requests",
      onClick: onOpenPayrollDispute, show: true,
    },
    {
      key: "itsupport", label: "IT Support",
      description: "Submit a ticket and track your own requests",
      onClick: onOpenItSupport, show: true,
    },
    {
      key: "clockinteam", label: "Clock In Team",
      description: "Your team's technicians, today",
      onClick: onOpenClockInTeam, show: showClockInTeam,
    },
  ].filter((t) => t.show);

  return (
    <div className="mtech-scroll mtech-home">
      <div className="mtech-home-greeting">
        <div className="mtech-home-hi">{greeting},</div>
        <div className="mtech-home-name">{userName}</div>
        <HomeTicketStatsCard
          todaysCount={todaysTickets.length}
          onHoldCount={onHoldTickets.length}
          onOpenTicketsTab={onOpenTicketsTab}
          onOpenOnHoldTab={onOpenOnHoldTab}
        />
      </div>

      <div className="mtech-timecard-summary mtech-home-clockrow">
        <ClockCard
          label="Time In" value={entry.checkIn ? entry.checkIn.slice(0, 5) : ""} valueClass="in"
          armed={armedCard === "checkIn"} canAct={canTimeIn} confirmLabel="Time In now?"
          onTap={handleTimeIn} onCancel={disarm}
        />
        <ClockCard
          label="Meal In" value={entry.mealStart ? entry.mealStart.slice(0, 5) : ""} valueClass="meal"
          armed={armedCard === "mealStart"} canAct={canMealIn} confirmLabel="Meal In now?"
          onTap={handleMealIn} onCancel={disarm}
        />
        <ClockCard
          label="Meal Out" value={entry.mealEnd ? entry.mealEnd.slice(0, 5) : ""} valueClass="meal"
          armed={armedCard === "mealEnd"} canAct={canMealOut} confirmLabel="Meal Out now?"
          onTap={handleMealOut} onCancel={disarm}
        />
        <ClockCard
          label="Time Out" value={entry.checkOut ? entry.checkOut.slice(0, 5) : ""} valueClass="out"
          armed={armedCard === "checkOut"} canAct={canTimeOut} confirmLabel="Time Out now?"
          onTap={handleTimeOut} onCancel={disarm}
        />
      </div>

      <HomeOnSiteCard
        tickets={activeTickets}
        userName={userName}
        role={role}
        arrivedAt={arrivedAt}
        setArrivedAt={setArrivedAt}
        doneAt={doneAt}
        setDoneAt={setDoneAt}
      />

      <div className="mtech-home-divider" />

      <div className="mtech-home-grid">
        {menuTiles.map((t) => (
          <button key={t.key} className="mtech-home-tile" type="button" onClick={t.onClick}>
            <span className="mtech-home-tile-label">{t.label}</span>
            <span className="mtech-home-tile-desc">{t.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Payroll tab: same real payslip data (getMyPayslips) and status mapping
// as the /timecard MobilePayrollPage, so users get the same numbers from
// either entry point.
interface MobilePayRowInline {
  id: string;
  periodLabel: string;
  periodEnd: string;
  amount: number;
  status: ReturnType<typeof payslipStatusLabel>;
  payslip: MyPayslipRow;
}

function MobilePayrollView({
  userName,
  profileId,
  uid,
  role,
}: {
  userName: string;
  profileId: string | null;
  uid: string | null;
  role: string | null;
}) {
  const [payslips, setPayslips] = useState<MyPayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Technicians are paid per completed repair ticket (Tech Payroll on the
  // Accounting Dashboard) instead of hourly — same piece-rate categories
  // shown there, not the generic Hours/OT/Regular Pay breakdown below,
  // which doesn't mean anything for piece-rate pay.
  const isTech = normalizeRole(role || "") === "TECHNICIAN";
  const [assignedBranch, setAssignedBranch] = useState("");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [breakdownByRun, setBreakdownByRun] = useState<
    Record<string, TechPayrollBreakdown | "loading" | "error">
  >({});

  useEffect(() => {
    let cancelled = false;
    if (!profileId) {
      setPayslips([]);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const rows = await getMyPayslips(profileId);
        if (!cancelled) setPayslips(rows);
      } catch (e) {
        console.error("payroll: load payslips failed", e);
        if (!cancelled) setPayslips([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    if (!isTech || !uid) return;
    let cancelled = false;
    getMyFullProfile(uid).then((p) => { if (!cancelled) setAssignedBranch(p?.assignedBranch || ""); });
    return () => { cancelled = true; };
  }, [isTech, uid]);

  const toggleBreakdown = async (row: MobilePayRowInline) => {
    if (expandedRunId === row.id) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(row.id);
    if (breakdownByRun[row.id] || !profileId) return;
    setBreakdownByRun((prev) => ({ ...prev, [row.id]: "loading" }));
    try {
      const breakdown = await getTechPayrollBreakdown(
        profileId,
        userName,
        assignedBranch,
        row.payslip.periodStart,
        row.payslip.periodEnd,
      );
      setBreakdownByRun((prev) => ({ ...prev, [row.id]: breakdown }));
    } catch (e) {
      console.error("payroll: tech breakdown failed", e);
      setBreakdownByRun((prev) => ({ ...prev, [row.id]: "error" }));
    }
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US");
  };

  const rows = useMemo<MobilePayRowInline[]>(
    () =>
      payslips.map((p) => ({
        id: p.runId,
        periodLabel: `${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}`,
        periodEnd: p.periodEnd,
        amount: p.netPay,
        status: payslipStatusLabel(p.status),
        payslip: p,
      })),
    [payslips],
  );

  const totalPaid = rows.filter((r) => r.status === "Paid").reduce((s, r) => s + r.amount, 0);
  const totalPending = rows.filter((r) => r.status !== "Paid").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="mtech-scroll mtech-payroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">{userName}</div>
        <div className="mtech-payroll-sub">
          {rows.length > 0 ? `${rows.length} pay period${rows.length === 1 ? "" : "s"}` : "Pay history"}
        </div>
      </div>

      <div className="mtech-payroll-summary">
        <div className="mtech-payroll-card">
          <div className="mtech-payroll-card-label">Paid</div>
          <div className="mtech-payroll-card-value paid">${totalPaid.toFixed(2)}</div>
        </div>
        <div className="mtech-payroll-card">
          <div className="mtech-payroll-card-label">Pending</div>
          <div className="mtech-payroll-card-value pending">${totalPending.toFixed(2)}</div>
        </div>
      </div>

      {loading && <div className="mtech-muted">Loading payroll…</div>}
      {!loading && rows.length === 0 && (
        <div className="mtech-muted">No payroll runs yet.</div>
      )}

      <div className="mtech-payroll-list">
        {rows.map((row) => (
          <div key={row.id} className="mtech-payroll-row">
            <div className="mtech-payroll-row-head">
              <div className="mtech-payroll-row-date">{row.periodLabel}</div>
              <div className={`mtech-payroll-status mtech-payroll-status-${row.status.toLowerCase().replace(/\s+/g, "-")}`}>
                {row.status}
              </div>
            </div>
            <div className="mtech-payroll-row-body">
              <div className="mtech-payroll-row-amount">${row.amount.toFixed(2)}</div>
              <div className="mtech-payroll-row-actions">
                <button
                  type="button"
                  className="mtech-payroll-action"
                  onClick={() => {
                    if (isTech) { void toggleBreakdown(row); return; }
                    const p = row.payslip;
                    alert(
                      `Pay period ${row.periodLabel}\nStatus: ${row.status}\n\n` +
                        `Hours: ${p.hoursWorked.toFixed(2)} (+ ${p.overtimeHours.toFixed(2)} OT)\n` +
                        `Regular Pay: $${p.regularPay.toFixed(2)}\nOvertime Pay: $${p.overtimePay.toFixed(2)}\n` +
                        `Gross Pay: $${p.grossPay.toFixed(2)}\nNet Pay: $${p.netPay.toFixed(2)}`,
                    );
                  }}
                >
                  {isTech && expandedRunId === row.id ? "Hide" : "View"}
                </button>
                <button
                  type="button"
                  className="mtech-payroll-action mtech-payroll-action-secondary"
                  disabled={row.status !== "Paid"}
                  onClick={() =>
                    alert(
                      `Pay stub for ${row.periodLabel} will be available once your finance team publishes it.`,
                    )
                  }
                >
                  Stub
                </button>
              </div>
            </div>
            {isTech && expandedRunId === row.id && (
              <TechPayrollBreakdownPanel entry={breakdownByRun[row.id]} netPay={row.amount} />
            )}
          </div>
        ))}
      </div>

      <p className="mtech-payroll-note">
        Payroll is issued per pay period. If an amount looks wrong, reach out to your branch manager or HR.
      </p>
    </div>
  );
}

/** Inline expand panel for a technician's Tech Payroll piece-rate breakdown
 * — same categories as the Accounting Dashboard's Tech Payroll tab. Net Pay
 * shown here is always the row's own real payslip amount (what was actually
 * paid), never the live-recomputed total, since Finance may have adjusted
 * things after the run was generated. */
function TechPayrollBreakdownPanel({
  entry,
  netPay,
}: {
  entry: TechPayrollBreakdown | "loading" | "error" | undefined;
  netPay: number;
}) {
  if (!entry || entry === "loading") {
    return <div className="mtech-payroll-breakdown mtech-muted">Loading breakdown…</div>;
  }
  if (entry === "error") {
    return <div className="mtech-payroll-breakdown mtech-muted">Couldn't load the breakdown for this period.</div>;
  }
  const ratioPct = entry.ticketsAssigned > 0 ? (entry.ticketsCompleted / entry.ticketsAssigned) * 100 : null;
  // Same Math.max(1, ...) denominator floor AccountingDashboard.tsx uses,
  // so a zero-working-days edge case reads identically on both surfaces.
  const avgComp = entry.ticketsCompleted / Math.max(1, entry.workingDays);
  const line = (label: string, value: string) => (
    <div className="mtech-payroll-breakdown-row">
      <span className="mtech-payroll-breakdown-label">{label}</span>
      <span className="mtech-payroll-breakdown-value">{value}</span>
    </div>
  );
  return (
    <div className="mtech-payroll-breakdown">
      {line("Tickets Completed", String(entry.ticketsCompleted))}
      {line("Tickets Assigned", String(entry.ticketsAssigned))}
      {line("Ratio", ratioPct === null ? "—" : `${ratioPct.toFixed(0)}%`)}
      {line("Avg. Comp.", avgComp.toFixed(2))}
      {line("2 Man Job", `$${entry.techCategoryPay.twoManJob.toFixed(2)}`)}
      {line("Back Tub", `$${entry.techCategoryPay.backTub.toFixed(2)}`)}
      {line("Sealed System", `$${entry.techCategoryPay.sealedSystem.toFixed(2)}`)}
      {line("Sealed System (R600)", `$${entry.techCategoryPay.sealedSystemR600.toFixed(2)}`)}
      {line("Two Tech", `${entry.twoTechCount} · $${entry.twoTechPay.toFixed(2)}`)}
      {line("LDT", `${entry.ldtCount} · $${entry.ldtPay.toFixed(2)}`)}
      {line("Mileage", `${entry.mileage} mi · $${entry.mileagePay.toFixed(2)}`)}
      {line("Training Paid", `$${entry.trainingPay.toFixed(2)}`)}
      {entry.mcaBonus > 0 && line("MCA Bonus", `$${entry.mcaBonus.toFixed(2)}`)}
      {entry.completedTicketsPay > 0 && line("Completed Tickets Rate", `$${entry.completedTicketsPay.toFixed(2)}`)}
      <div className="mtech-payroll-breakdown-row mtech-payroll-breakdown-total">
        <span className="mtech-payroll-breakdown-label">Net Pay</span>
        <span className="mtech-payroll-breakdown-value">${netPay.toFixed(2)}</span>
      </div>
    </div>
  );
}

// Timecard tab: real punch clock (Time In/Out, Meal In/Out), reached from
// the profile menu. Unlike desktop's FullTimecardPage this only ever shows
// TODAY — no calendar to browse, since desktop already locks editing to
// today's date anyway (timecard.tsx) — so there's no "locked past day" state
// to handle here at all. Business rules (meal break requires an 8+ hour
// scheduled shift, checked-in first) are copied verbatim from
// FullTimecardPage's handleMealToggle so mobile and desktop never disagree.
function MobileTimecardView({
  uid,
  profileId,
  userName,
}: {
  uid: string | null;
  profileId: string | null;
  userName: string;
}) {
  const [requiredCheckIn, setRequiredCheckIn] = useState("");
  const [requiredCheckOut, setRequiredCheckOut] = useState("");
  const [workingHours, setWorkingHours] = useState<number | null>(null);
  const [mealMinutes, setMealMinutes] = useState<number | null>(null);
  const [scheduleTimezone, setScheduleTimezone] = useState<ScheduleTimezone>("CST");
  const [entry, setEntry] = useState<UITimeEntry>({ checkIn: "", checkOut: "", mealStart: "", mealEnd: "", notes: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayLabel = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const schedule = await getMyProfileSchedule(uid);
        if (cancelled) return;
        setRequiredCheckIn(schedule.requiredCheckIn);
        setRequiredCheckOut(schedule.requiredCheckOut);
        setWorkingHours(schedule.workingHours);
        setMealMinutes(schedule.mealMinutes);
        setScheduleTimezone(schedule.scheduleTimezone);
        if (!schedule.profileId) {
          setEntry({ checkIn: "", checkOut: "", mealStart: "", mealEnd: "", notes: "" });
          return;
        }
        const monthEntries = await getMonthEntries(schedule.profileId, now.getFullYear(), now.getMonth());
        if (cancelled) return;
        setEntry(monthEntries[todayKey] || { checkIn: "", checkOut: "", mealStart: "", mealEnd: "", notes: "" });
      } catch (e) {
        console.error("MobileTimecardView: load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const timeDiff = (t1: string, t2: string): number => {
    if (!t1 || !t2) return 0;
    const [h1, m1, s1 = 0] = t1.split(":").map(Number);
    const [h2, m2, s2 = 0] = t2.split(":").map(Number);
    return (h2 * 3600 + m2 * 60 + s2 - (h1 * 3600 + m1 * 60 + s1)) / 3600;
  };

  // Stamps `field` with the server's own current instant (never the
  // phone's own clock — see src/lib/serverTime.ts), converted into this
  // technician's own scheduled timezone, so setting your phone's date/time
  // can't fake a punch. If getServerNow() fails, the punch is NOT saved
  // with a fallback local time — that would just reopen the hole this
  // exists to close.
  const persistPunch = async (field: keyof Pick<UITimeEntry, "checkIn" | "checkOut" | "mealStart" | "mealEnd">) => {
    if (!profileId) {
      alert("Could not resolve your profile. Please re-login.");
      return;
    }
    setSaving(true);
    try {
      const serverNow = await getServerNow();
      const workDate = zonedDateKey(serverNow, scheduleTimezone);
      const time = zonedTimeString(serverNow, scheduleTimezone);
      if (workDate !== todayKey) {
        alert("It's now a new day — please reopen your timecard and try again.");
        return;
      }
      const next = { ...entry, [field]: time };
      setEntry(next);
      await saveTimecardEntry(profileId, workDate, next);
    } catch (e) {
      console.error("MobileTimecardView: save failed", e);
      alert(`Failed to save: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTimeToggle = () => {
    if (!entry.checkIn) void persistPunch("checkIn");
    else if (!entry.checkOut) void persistPunch("checkOut");
  };

  const handleMealToggle = () => {
    if (!entry.checkIn) {
      alert("Please log time in first.");
      return;
    }
    if (entry.checkOut) {
      alert("You've already timed out for the day.");
      return;
    }
    if ((!requiredCheckIn || !requiredCheckOut) && !workingHours) {
      alert("No scheduled shift is set for your account. Contact your admin to set your required schedule.");
      return;
    }
    // Same rule as TimeClockMenu.tsx / routes/timecard.tsx: shifts of 6 hours
    // or less have no meal break, and an explicit Working Hours override
    // (migration 0109) takes priority over the Time In/Out subtraction.
    const scheduledShift = resolveScheduledShiftHours(requiredCheckIn, requiredCheckOut, workingHours, mealMinutes);
    if (scheduledShift <= 6) {
      alert(`Meal break is only available for scheduled shifts of more than 6 hours. Your scheduled shift is ${scheduledShift.toFixed(1)} hours.`);
      return;
    }
    if (!entry.mealStart) void persistPunch("mealStart");
    else if (!entry.mealEnd) void persistPunch("mealEnd");
  };

  const hoursToday = entry.checkIn && entry.checkOut
    ? Math.max(0, timeDiff(entry.checkIn, entry.checkOut) - (entry.mealStart && entry.mealEnd ? timeDiff(entry.mealStart, entry.mealEnd) : 0))
    : null;

  return (
    <div className="mtech-scroll mtech-timecard">
      <div className="mtech-timecard-heading">
        <div className="mtech-timecard-name">{userName}</div>
        <div className="mtech-timecard-sub">{todayLabel}</div>
      </div>

      {loading ? (
        <div className="mtech-muted">Loading timecard…</div>
      ) : (
        <>
          <div className="mtech-timecard-summary">
            <div className="mtech-timecard-card">
              <div className="mtech-timecard-card-label">Check In</div>
              <div className="mtech-timecard-card-value in">{entry.checkIn ? entry.checkIn.slice(0, 5) : "—"}</div>
            </div>
            <div className="mtech-timecard-card">
              <div className="mtech-timecard-card-label">Check Out</div>
              <div className="mtech-timecard-card-value out">{entry.checkOut ? entry.checkOut.slice(0, 5) : "—"}</div>
            </div>
            <div className="mtech-timecard-card">
              <div className="mtech-timecard-card-label">Meal Start</div>
              <div className="mtech-timecard-card-value meal">{entry.mealStart ? entry.mealStart.slice(0, 5) : "—"}</div>
            </div>
            <div className="mtech-timecard-card">
              <div className="mtech-timecard-card-label">Meal End</div>
              <div className="mtech-timecard-card-value meal">{entry.mealEnd ? entry.mealEnd.slice(0, 5) : "—"}</div>
            </div>
          </div>

          {hoursToday !== null && <div className="mtech-timecard-hours">{hoursToday.toFixed(1)}h worked today</div>}

          <button
            type="button"
            className="mtech-timecard-btn mtech-timecard-btn-time"
            disabled={!!entry.checkOut || saving}
            onClick={handleTimeToggle}
          >
            {!entry.checkIn ? "🕐 Time In" : !entry.checkOut ? "🛑 Time Out" : "✓ Shift Complete"}
          </button>
          <button
            type="button"
            className="mtech-timecard-btn mtech-timecard-btn-meal"
            disabled={!!entry.mealEnd || saving}
            onClick={handleMealToggle}
          >
            {!entry.mealStart ? "🍽 Meal In" : !entry.mealEnd ? "✓ Meal Out" : "Meal Done"}
          </button>

          {requiredCheckIn && requiredCheckOut && (
            <p className="mtech-timecard-note">Scheduled shift: {requiredCheckIn}–{requiredCheckOut}</p>
          )}
        </>
      )}
    </div>
  );
}

// Clock In Team: a manager-tier viewer's visible technicians (direct
// reports via manager_name, or — for Parts Manager — every technician at
// their own branch), each with a Clock In button — reachable from the
// profile menu. Deliberately Clock-In-only; there is no Clock Out or Meal
// action here at all, since only the technician themselves ends their own
// shift. Reuses the exact same scoping already built for Attendance
// Monitoring (visibleAttendanceProfileIds), so "my team" here always
// matches what that dashboard already shows for this same viewer.
interface ClockInTechRow {
  id: string;
  name: string;
  branch: string | null;
  checkIn: string;
  clockedInByName: string | null;
}

function MobileClockInTeamView({ profileId }: { profileId: string | null }) {
  const [rows, setRows] = useState<ClockInTechRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockingIn, setClockingIn] = useState<Set<string>>(new Set());

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const load = async () => {
    if (!profileId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [allProfiles, csrComposition, todayEntries] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getCompanyTimecardEntries(todayKey, todayKey),
      ]);
      const myProfile = allProfiles.find((p) => p.id === profileId) ?? null;
      if (!myProfile) {
        setRows([]);
        return;
      }
      const nameById = new Map(allProfiles.map((p) => [p.id, p.display_name || p.email]));
      const entryByProfile = new Map<string, CompanyTimecardEntry>(todayEntries.map((e) => [e.profileId, e]));
      const scoped = visibleAttendanceProfileIds(myProfile, allProfiles, csrComposition);
      const myTechnicians = allProfiles.filter(
        (p) => p.is_active && (scoped === null || scoped.has(p.id)) && TECHNICIAN_PAY_ROLES.has(normalizeRole(p.role))
      );
      setRows(
        myTechnicians
          .map((p) => {
            const entry = entryByProfile.get(p.id);
            return {
              id: p.id,
              name: p.display_name || p.email,
              branch: p.assigned_branch,
              checkIn: entry?.checkIn || "",
              clockedInByName: entry?.clockedInBy ? nameById.get(entry.clockedInBy) || null : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      console.error("MobileClockInTeamView: load failed", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const handleClockIn = async (tech: ClockInTechRow) => {
    if (!profileId) return;
    if (!window.confirm(`Clock in ${tech.name} now?`)) return;
    setClockingIn((prev) => new Set(prev).add(tech.id));
    try {
      const branchTz = timezoneForBranch(tech.branch);
      // Server-verified instant (see src/lib/serverTime.ts), not this
      // manager's own phone clock — same reason self-punches use it.
      const serverNow = await getServerNow();
      const { hhmm } = nowInTimezone(branchTz, serverNow);
      const seconds = String(serverNow.getSeconds()).padStart(2, "0");
      await saveTimecardEntry(
        tech.id,
        todayKey,
        { checkIn: `${hhmm}:${seconds}`, checkOut: "", mealStart: "", mealEnd: "", notes: "" },
        { clockedInBy: profileId }
      );
      await load();
    } catch (e) {
      alert(`Failed to clock in: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setClockingIn((prev) => {
        const next = new Set(prev);
        next.delete(tech.id);
        return next;
      });
    }
  };

  return (
    <div className="mtech-scroll mtech-clockin">
      <div className="mtech-clockin-heading">
        <div className="mtech-clockin-title">Clock In Team</div>
        <div className="mtech-clockin-sub">Your direct-report technicians, today</div>
      </div>

      {loading && <div className="mtech-muted">Loading your team…</div>}
      {!loading && rows.length === 0 && <div className="mtech-muted">No technicians report to you.</div>}

      <div className="mtech-clockin-list">
        {rows.map((tech) => (
          <div key={tech.id} className="mtech-clockin-row">
            <div className="mtech-clockin-row-info">
              <div className="mtech-clockin-row-name">{tech.name}</div>
              <div className="mtech-clockin-row-status">
                {tech.checkIn
                  ? `Clocked in ${tech.checkIn.slice(0, 5)}${tech.clockedInByName ? ` (by ${tech.clockedInByName})` : ""}`
                  : "Not clocked in yet"}
              </div>
            </div>
            {!tech.checkIn && (
              <button
                type="button"
                className="mtech-clockin-btn"
                disabled={clockingIn.has(tech.id)}
                onClick={() => handleClockIn(tech)}
              >
                {clockingIn.has(tech.id) ? "…" : "Clock In"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const IT_TICKET_PRIORITIES: ItTicketPriority[] = ["low", "normal", "high", "urgent"];
const IT_TICKET_STATUS_COLORS: Record<ItTicketRow["status"], { bg: string; fg: string }> = {
  open: { bg: "rgba(59,130,246,0.18)", fg: "#93c5fd" },
  in_progress: { bg: "rgba(234,179,8,0.18)", fg: "#fde047" },
  resolved: { bg: "rgba(16,185,129,0.18)", fg: "#6ee7b7" },
  closed: { bg: "rgba(100,116,139,0.25)", fg: "#cbd5e1" },
};
const IT_TICKET_STATUS_LABELS: Record<ItTicketRow["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

// Same underlying data/RLS as the desktop "My Profile → IT Support" page
// (src/routes/it-tickets.tsx) — submit a ticket and see your own tickets'
// status/resolution notes, just styled for the mobile shell instead of
// linking out to the desktop-chrome-wrapped route.
function MobileItSupportView({ userName }: { userName: string }) {
  const [tickets, setTickets] = useState<ItTicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<ItTicketPriority>("normal");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setTickets(await getItTickets());
    } catch (e) {
      console.error("it support: load tickets failed", e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const submit = async () => {
    if (!subject.trim() || !description.trim()) {
      setMsg("Subject and description are required.");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      await createItTicket({ subject: subject.trim(), description: description.trim(), priority, createdByName: userName });
      setSubject("");
      setDescription("");
      setPriority("normal");
      setMsg("Ticket submitted.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to submit ticket.");
    } finally {
      setSubmitting(false);
      setTimeout(() => setMsg(""), 3000);
    }
  };

  return (
    <div className="mtech-scroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">IT Support</div>
        <div className="mtech-payroll-sub">Submit a ticket and track your own requests</div>
      </div>

      <div className="mtech-panel" style={{ marginTop: 0 }}>
        <div className="mtech-section-title" style={{ marginTop: 0 }}>Subject</div>
        <input
          className="mtech-bill-input full"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What's the issue?"
        />

        <div className="mtech-section-title">Priority</div>
        <select
          className="mtech-bill-input full"
          value={priority}
          onChange={(e) => setPriority(e.target.value as ItTicketPriority)}
        >
          {IT_TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
          ))}
        </select>

        <div className="mtech-section-title">Description</div>
        <textarea
          className="mtech-bill-input full"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what's happening…"
        />

        <button type="button" className="mtech-save-btn" onClick={submit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Ticket"}
        </button>
        {msg && <div className="mtech-save-msg">{msg}</div>}
      </div>

      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9", margin: "0.4rem 0 0.1rem" }}>My Tickets</div>
      {loading ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>Loading tickets…</div>
      ) : tickets.length === 0 ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>No tickets submitted yet.</div>
      ) : (
        <div className="mtech-payroll-list">
          {tickets.map((t) => (
            <div key={t.id} className="mtech-payroll-row">
              <div className="mtech-payroll-row-head">
                <div className="mtech-payroll-row-date">{t.subject}</div>
                <div className="mtech-payroll-status" style={{ background: IT_TICKET_STATUS_COLORS[t.status].bg, color: IT_TICKET_STATUS_COLORS[t.status].fg }}>
                  {IT_TICKET_STATUS_LABELS[t.status]}
                </div>
              </div>
              <div className="mtech-payroll-row-body" style={{ display: "block", padding: "0.4rem 0.85rem 0.7rem" }}>
                <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{t.description}</p>
                {t.resolutionNotes && (
                  <p className="mtech-muted" style={{ color: "#16a34a", fontWeight: 600, padding: "0.25rem 0" }}>IT note: {t.resolutionNotes}</p>
                )}
                <p className="mtech-muted" style={{ padding: 0 }}>
                  Submitted {new Date(t.createdAt).toLocaleDateString()} · {t.priority[0].toUpperCase() + t.priority.slice(1)} priority
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PAYROLL_DISPUTE_STATUS_COLORS: Record<EmployeeRequestRow["status"], { bg: string; fg: string }> = {
  pending: { bg: "rgba(234,179,8,0.18)", fg: "#fde047" },
  approved: { bg: "rgba(16,185,129,0.18)", fg: "#6ee7b7" },
  rejected: { bg: "rgba(239,68,68,0.18)", fg: "#fca5a5" },
  closed: { bg: "rgba(100,116,139,0.25)", fg: "#cbd5e1" },
};
const PAYROLL_DISPUTE_STATUS_LABELS: Record<EmployeeRequestRow["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  closed: "Closed",
};

// Submit a payroll dispute and track your own — same shape as IT Support
// above, backed by employee_requests (request_type "payroll_dispute",
// migration 0182) instead of it_tickets. Reviewed on desktop's Attendance
// Monitoring > Disputes & Inquiries tab with Approve/Reject, same as an
// Attendance Dispute (a Payroll Inquiry there only gets "Respond & Close").
const PAYROLL_DISPUTE_REASONS = [
  "Missing hours",
  "Incorrect hourly rate",
  "Missing completed ticket(s)",
  "Missing mileage",
  "Missing bonus/incentive",
  "Other",
];

function MobilePayrollDisputeView({
  userName,
  profileId,
  companyId,
  prefill,
  onSubmitted,
}: {
  userName: string;
  profileId: string | null;
  companyId: string | null;
  /** Set when arriving via the On Hold Tickets Dispute tab's "Dispute"
   *  button — the ticket number is known for certain in that flow, so it's
   *  locked instead of left free-text/editable. */
  prefill?: { ticketNo: string; payPeriod?: string; periodStart?: string; periodEnd?: string } | null;
  /** Fires once the dispute is actually saved, so the parent can flatten
   *  that ticket's "Dispute" button to "Submitted" without a full refetch. */
  onSubmitted?: (ticketNo: string) => void;
}) {
  const [requests, setRequests] = useState<EmployeeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticketNo, setTicketNo] = useState(prefill?.ticketNo ?? "");
  const [payPeriod, setPayPeriod] = useState(prefill?.payPeriod ?? "");
  const [totalReceived, setTotalReceived] = useState("");
  const [totalExpected, setTotalExpected] = useState("");
  const [reason, setReason] = useState(PAYROLL_DISPUTE_REASONS[0]);
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  // Derived, not typed in — avoids the missing amount ever disagreeing
  // with the two numbers it's supposed to summarize.
  const missingAmount = (() => {
    const received = Number(totalReceived);
    const expected = Number(totalExpected);
    if (totalReceived === "" || totalExpected === "" || Number.isNaN(received) || Number.isNaN(expected)) return null;
    return expected - received;
  })();

  const load = async () => {
    setLoading(true);
    try {
      const all = await getCompanyEmployeeRequests();
      setRequests(all.filter((r) => r.requestType === "payroll_dispute" && r.profileId === profileId));
    } catch (e) {
      console.error("payroll dispute: load requests failed", e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [profileId]);

  const submit = async () => {
    if (!profileId) {
      setMsg("Your profile hasn't loaded yet — try again in a moment.");
      return;
    }
    if (!payPeriod.trim() || totalReceived === "" || totalExpected === "" || !details.trim()) {
      setMsg("Fill in the pay period, both amounts, and an explanation before submitting.");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      let attachments: { url: string; name: string }[] = [];
      if (files.length > 0 && companyId) {
        const disputeKey = crypto.randomUUID();
        attachments = await Promise.all(
          files.map(async (f) => {
            const { url } = await uploadPayrollDisputeAttachment(companyId, disputeKey, f);
            return { url, name: f.name };
          })
        );
      }
      await createEmployeeRequest({
        profileId,
        requestType: "payroll_dispute",
        details: details.trim(),
        requestedBy: profileId,
        payPeriod: payPeriod.trim(),
        totalReceived: Number(totalReceived),
        totalExpected: Number(totalExpected),
        missingAmount: missingAmount ?? undefined,
        disputeReason: reason,
        attachments,
        ticketNo: ticketNo.trim() || undefined,
        periodStart: prefill?.periodStart,
        periodEnd: prefill?.periodEnd,
      });
      void notifyRequestReviewers({
        body: `💰 New Payroll Dispute from ${userName} (${payPeriod.trim()}).`,
        linkTo: "/m/dashboard/accounting-dashboard?tab=payrollDisputes",
        senderId: profileId,
        senderName: userName,
      });
      if (ticketNo.trim()) onSubmitted?.(ticketNo.trim());
      // Prefilled from the Dispute tab — leave the locked ticket number in
      // place rather than clearing it back to an empty (but still disabled)
      // field; the tech is done with this screen either way.
      if (!prefill?.ticketNo) setTicketNo("");
      setPayPeriod("");
      setTotalReceived("");
      setTotalExpected("");
      setReason(PAYROLL_DISPUTE_REASONS[0]);
      setDetails("");
      setFiles([]);
      setMsg("Dispute submitted.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to submit dispute.");
    } finally {
      setSubmitting(false);
      setTimeout(() => setMsg(""), 3000);
    }
  };

  return (
    <div className="mtech-scroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">Payroll Dispute</div>
        <div className="mtech-payroll-sub">Dispute a pay period and track your own requests</div>
      </div>

      <div className="mtech-panel" style={{ marginTop: 0 }}>
        <div className="mtech-section-title" style={{ marginTop: 0 }}>Ticket Number</div>
        <input
          className="mtech-bill-input full"
          value={ticketNo}
          onChange={(e) => setTicketNo(e.target.value)}
          placeholder="e.g. HAP20260736718689"
          disabled={!!prefill?.ticketNo}
          style={prefill?.ticketNo ? { opacity: 0.7 } : undefined}
        />
        {prefill?.ticketNo && (
          <p className="mtech-muted" style={{ padding: "0.15rem 0 0.25rem" }}>Locked to the ticket you disputed from.</p>
        )}

        <div className="mtech-section-title">Pay Period</div>
        <input
          className="mtech-bill-input full"
          value={payPeriod}
          onChange={(e) => setPayPeriod(e.target.value)}
          placeholder="e.g. Aug 1 – Aug 15, 2026"
        />

        <div className="mtech-section-title">Total Received</div>
        <input
          className="mtech-bill-input full"
          type="number"
          inputMode="decimal"
          value={totalReceived}
          onChange={(e) => setTotalReceived(e.target.value)}
          placeholder="$0.00"
        />

        <div className="mtech-section-title">Total Expected</div>
        <input
          className="mtech-bill-input full"
          type="number"
          inputMode="decimal"
          value={totalExpected}
          onChange={(e) => setTotalExpected(e.target.value)}
          placeholder="$0.00"
        />

        <div className="mtech-section-title">Missing Amount</div>
        <input
          className="mtech-bill-input full"
          value={missingAmount === null ? "" : `$${missingAmount.toFixed(2)}`}
          placeholder="Fills in automatically"
          disabled
        />

        <div className="mtech-section-title">Reason for Dispute</div>
        <select className="mtech-bill-input full" value={reason} onChange={(e) => setReason(e.target.value)}>
          {PAYROLL_DISPUTE_REASONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <div className="mtech-section-title">Explanation</div>
        <textarea
          className="mtech-bill-input full"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Describe what's missing or incorrect"
        />

        <div className="mtech-section-title">Upload Supporting Documents</div>
        <input
          className="mtech-bill-input full"
          type="file"
          multiple
          accept="image/*,.pdf"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        {files.length > 0 && (
          <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{files.length} file{files.length === 1 ? "" : "s"} selected</p>
        )}

        <button type="button" className="mtech-save-btn" onClick={submit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Dispute"}
        </button>
        {msg && <div className="mtech-save-msg">{msg}</div>}
      </div>

      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9", margin: "0.4rem 0 0.1rem" }}>My Disputes</div>
      {loading ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>Loading disputes…</div>
      ) : requests.length === 0 ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>No disputes submitted yet.</div>
      ) : (
        <div className="mtech-payroll-list">
          {requests.map((r) => (
            <div key={r.id} className="mtech-payroll-row">
              <div className="mtech-payroll-row-head">
                <div className="mtech-payroll-row-date">{r.payPeriod || new Date(r.createdAt).toLocaleDateString()}</div>
                <div className="mtech-payroll-status" style={{ background: PAYROLL_DISPUTE_STATUS_COLORS[r.status].bg, color: PAYROLL_DISPUTE_STATUS_COLORS[r.status].fg }}>
                  {PAYROLL_DISPUTE_STATUS_LABELS[r.status]}
                </div>
              </div>
              <div className="mtech-payroll-row-body" style={{ display: "block", padding: "0.4rem 0.85rem 0.7rem" }}>
                {r.ticketNo && <p className="mtech-muted" style={{ padding: "0.25rem 0", fontWeight: 600, color: "#93c5fd" }}>Ticket {r.ticketNo}</p>}
                {r.disputeReason && <p className="mtech-muted" style={{ padding: "0.25rem 0", fontWeight: 600 }}>{r.disputeReason}</p>}
                {(r.totalReceived !== null || r.totalExpected !== null) && (
                  <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                    Received ${(r.totalReceived ?? 0).toFixed(2)} · Expected ${(r.totalExpected ?? 0).toFixed(2)} · Missing ${(r.missingAmount ?? 0).toFixed(2)}
                  </p>
                )}
                <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{r.details}</p>
                {r.attachments.length > 0 && (
                  <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                    {r.attachments.map((a, i) => (
                      <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd", marginRight: "0.5rem" }}>
                        {a.name}{i < r.attachments.length - 1 ? "," : ""}
                      </a>
                    ))}
                  </p>
                )}
                {r.reviewNote && (
                  <p className="mtech-muted" style={{ color: "#16a34a", fontWeight: 600, padding: "0.25rem 0" }}>Response: {r.reviewNote}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Generic status-pill colors shared by Time Off/Attendance Dispute/Time
// Correction below — covers every status string PTO (denied/cancelled),
// corrections (rejected), and employee_requests (rejected/closed) can
// produce, so one map/label pair works for all three instead of three
// near-identical copies.
const REQUEST_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "rgba(234,179,8,0.18)", fg: "#fde047" },
  approved: { bg: "rgba(16,185,129,0.18)", fg: "#6ee7b7" },
  rejected: { bg: "rgba(239,68,68,0.18)", fg: "#fca5a5" },
  denied: { bg: "rgba(239,68,68,0.18)", fg: "#fca5a5" },
  cancelled: { bg: "rgba(100,116,139,0.25)", fg: "#cbd5e1" },
  closed: { bg: "rgba(100,116,139,0.25)", fg: "#cbd5e1" },
};
function requestStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const LEAVE_TYPES = ["Vacation", "Personal", "Sick", "Unpaid"];
const PTO_TYPE_LABELS: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick Leave",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

// Submit a PTO/Sick/Personal/Unpaid request and track your own — same
// "submit form + My Requests list" shape as Payroll Dispute above, backed
// by pto.ts's two-stage manager-then-(HR OR Accounting) approval instead of
// employee_requests. Unlike EmployeeSelfServicePage.tsx's desktop version,
// this deliberately skips the tenure-eligibility gate and remaining-balance
// math (ptoYearWindow/ptoAllowanceForTenureYear, sickYearWindow) — that
// logic lives only in the desktop page today, and duplicating the
// anniversary-anchored tenure-year calculation here risks it drifting out
// of sync. The manager/HR/Accounting review stage is the real enforcement
// point either way, so mobile submits directly and lets that catch
// anything out of policy.
function MobileTimeOffView({ userName, profileId }: { userName: string; profileId: string | null }) {
  const [requests, setRequests] = useState<PtoRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyProfiles, setCompanyProfiles] = useState<ProfileRow[]>([]);
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [details, setDetails] = useState("");
  const [position, setPosition] = useState("");
  const [branch, setBranch] = useState<string>(LOCATIONS[0] || "");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getCompanyUsers().then(setCompanyProfiles).catch((e) => console.error("time off: load users failed", e));
  }, []);

  // Auto-fill from the technician's own profile, same as the desktop
  // Employee Self-Service PTO/Sick modal — they can still change either.
  useEffect(() => {
    if (!profileId) return;
    const myProfile = companyProfiles.find((p) => p.id === profileId);
    if (!myProfile) return;
    if (myProfile.role) setPosition(myProfile.role);
    if (myProfile.assigned_branch) setBranch(myProfile.assigned_branch);
  }, [profileId, companyProfiles]);

  const load = async () => {
    setLoading(true);
    try {
      const all = await getCompanyPtoRequests();
      setRequests(all.filter((r) => r.profileId === profileId));
    } catch (e) {
      console.error("time off: load requests failed", e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [profileId]);

  const submit = async () => {
    if (!profileId) {
      setMsg("Your profile hasn't loaded yet — try again in a moment.");
      return;
    }
    if (!startDate || !endDate) {
      setMsg("Select a start and end date.");
      return;
    }
    if (!details.trim()) {
      setMsg("Add a reason for the request.");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      const ptoTypeMap: Record<string, PtoType> = { Vacation: "vacation", Personal: "personal", Sick: "sick", Unpaid: "unpaid" };
      const ptoType = ptoTypeMap[leaveType] || "vacation";
      const myProfile = companyProfiles.find((p) => p.id === profileId) ?? null;
      const managerProfile = myProfile ? await resolveTeamLeadOrManager(myProfile, companyProfiles) : null;
      await createPtoRequest({
        profileId,
        ptoType,
        startDate,
        endDate,
        reason: `Branch: ${branch} | Position: ${ROLE_LABELS[position] || position || "N/A"} - ${details.trim()}`,
        requestedBy: profileId,
        managerId: managerProfile?.id ?? null,
      });
      // Manager + every HR user (falling back to Admin/SuperAdmin if no
      // manager could be resolved) — same recipient rule the desktop PTO/
      // Sick submit flow uses, so nobody's request is stranded unseen.
      const recipients = new Map<string, ProfileRow>();
      if (managerProfile && managerProfile.id !== profileId) recipients.set(managerProfile.id, managerProfile);
      for (const p of companyProfiles) {
        if (p.id === profileId || !p.is_active) continue;
        const primary = (p.role || "").toUpperCase();
        if (primary === "HR" || (!managerProfile && (primary === "ADMIN" || primary === "SUPERADMIN"))) recipients.set(p.id, p);
      }
      const emoji = ptoType === "sick" ? "🤒" : "🗓️";
      const label = ptoType === "sick" ? "Sick Leave" : "PTO";
      await Promise.all(
        Array.from(recipients.values()).map((r) =>
          createNotification({
            recipientId: r.id,
            senderId: profileId,
            senderName: userName,
            body: `${emoji} New ${label} Request from ${userName} needs your approval: ${startDate} to ${endDate}.`,
            linkTo: "/m/dashboard/attendance-monitoring?tab=pto-management",
          }).catch((err) => console.error("Failed to notify", r.id, err))
        )
      );
      setStartDate("");
      setEndDate("");
      setDetails("");
      setLeaveType(LEAVE_TYPES[0]);
      setMsg("Request submitted.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to submit request.");
    } finally {
      setSubmitting(false);
      setTimeout(() => setMsg(""), 3000);
    }
  };

  return (
    <div className="mtech-scroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">Time Off Request</div>
        <div className="mtech-payroll-sub">Request PTO, sick leave, or unpaid time off</div>
      </div>

      <div className="mtech-panel" style={{ marginTop: 0 }}>
        <div className="mtech-section-title" style={{ marginTop: 0 }}>Leave Type</div>
        <select className="mtech-bill-input full" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <div className="mtech-section-title">Position</div>
        <select className="mtech-bill-input full" value={position} onChange={(e) => setPosition(e.target.value)}>
          {Object.entries(ROLE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>

        <div className="mtech-section-title">Branch</div>
        <select className="mtech-bill-input full" value={branch} onChange={(e) => setBranch(e.target.value)}>
          {LOCATIONS.map((location) => (
            <option key={location} value={location}>{location}</option>
          ))}
        </select>

        <div className="mtech-section-title">Start Date</div>
        <input className="mtech-bill-input full" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />

        <div className="mtech-section-title">End Date</div>
        <input className="mtech-bill-input full" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />

        <div className="mtech-section-title">Reason</div>
        <textarea
          className="mtech-bill-input full"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Why are you requesting time off?"
        />

        <button type="button" className="mtech-save-btn" onClick={submit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Request"}
        </button>
        {msg && <div className="mtech-save-msg">{msg}</div>}
      </div>

      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9", margin: "0.4rem 0 0.1rem" }}>My Requests</div>
      {loading ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>Loading requests…</div>
      ) : requests.length === 0 ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>No requests submitted yet.</div>
      ) : (
        <div className="mtech-payroll-list">
          {requests.map((r) => (
            <div key={r.id} className="mtech-payroll-row">
              <div className="mtech-payroll-row-head">
                <div className="mtech-payroll-row-date">{r.startDate} – {r.endDate}</div>
                <div className="mtech-payroll-status" style={{ background: REQUEST_STATUS_COLORS[r.status].bg, color: REQUEST_STATUS_COLORS[r.status].fg }}>
                  {requestStatusLabel(r.status)}
                </div>
              </div>
              <div className="mtech-payroll-row-body" style={{ display: "block", padding: "0.4rem 0.85rem 0.7rem" }}>
                <p className="mtech-muted" style={{ padding: "0.25rem 0", fontWeight: 600 }}>
                  {PTO_TYPE_LABELS[r.ptoType] || r.ptoType} · {(r.hoursRequested / 8).toFixed(r.hoursRequested % 8 === 0 ? 0 : 1)} day{r.hoursRequested === 8 ? "" : "s"}
                </p>
                <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{r.reason}</p>
                <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                  Manager: {requestStatusLabel(r.managerStatus)} · HR: {requestStatusLabel(r.hrStatus)} · Accounting: {requestStatusLabel(r.accountingStatus)}
                </p>
                {r.reviewNote && (
                  <p className="mtech-muted" style={{ color: "#16a34a", fontWeight: 600, padding: "0.25rem 0" }}>Response: {r.reviewNote}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Submit a Ticket Time Dispute and track your own — replaces the old plain
// free-text Attendance Dispute (migration 0207): reports a failed On-Site
// Check-In (Work Start/Work Done only succeed within ON_SITE_CHECKIN_RADIUS_
// MILES of the customer's address — outside it, the button just silently
// disables, per handleImHere/handleImDone above) by picking the actual
// ticket and stating the real start/end time. Reviewed on desktop's
// Attendance Monitoring > Ticket Time Disputes tab (separate from the old
// Disputes & Inquiries tab, which still handles any already-pending legacy
// attendance_dispute rows). Approving writes these times straight onto the
// ticket's own onsite_arrived_at/onsite_done_at — not just a paper trail.
function MobileTicketTimeDisputeView({ userName, profileId, companyId, technicianName, scheduleTimezone, prefillTicketNo }: { userName: string; profileId: string | null; companyId: string | null; technicianName: string; scheduleTimezone: ScheduleTimezone; prefillTicketNo?: string | null }) {
  const [requests, setRequests] = useState<EmployeeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [todaysStops, setTodaysStops] = useState<TechnicianRouteStop[]>([]);
  const [ticketNo, setTicketNo] = useState("");
  // Arriving from the Tickets tab's "Dispute" button (a missing-timestamp
  // card) — pre-select that ticket instead of leaving the dropdown blank.
  useEffect(() => {
    if (prefillTicketNo) setTicketNo(prefillTicketNo);
  }, [prefillTicketNo]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  // .mtech-save-msg is styled green by default (a "saved" confirmation) —
  // this flips it red for a validation/submit failure instead of showing
  // an error in success-green.
  const [msgIsError, setMsgIsError] = useState(false);

  // This technician's own existing dispute status per ticket — shown right
  // in the dropdown, with the actual claimed time, so they can see at a
  // glance whether — and what — they've already disputed on a ticket before
  // filing another one. A still-pending one wins over an older approved one
  // for the same ticket (same priority the ticket-row indicator elsewhere
  // uses — it's the one actually awaiting action right now).
  const myDisputeStatusByTicketNo = useMemo(() => {
    const map = new Map<string, { status: "pending" | "approved"; time: string }>();
    for (const r of requests) {
      if (!r.ticketNo) continue;
      // Same dev-test sandbox exclusion as disputedTimeByTicketNo above —
      // a real dispute filed against a DEVTEST-* ticket shouldn't stick
      // around forever and block re-testing.
      if (import.meta.env.DEV && r.ticketNo.startsWith("DEVTEST-")) continue;
      const existing = map.get(r.ticketNo);
      if (existing?.status === "pending") continue; // a pending one already won this ticket
      if (r.status !== "pending" && r.status !== "approved") continue;
      map.set(r.ticketNo, {
        status: r.status as "pending" | "approved",
        time: `${fmtTimeInZone(r.disputedStartTime, scheduleTimezone)} – ${fmtTimeInZone(r.disputedEndTime, scheduleTimezone)} ${scheduleTimezone}`,
      });
    }
    return map;
  }, [requests, scheduleTimezone]);

  const load = async () => {
    setLoading(true);
    try {
      const all = await getCompanyEmployeeRequests();
      setRequests(all.filter((r) => r.requestType === "ticket_time_dispute" && r.profileId === profileId));
    } catch (e) {
      console.error("ticket time dispute: load requests failed", e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [profileId]);

  // Dev-only: getTechnicianTodayRoute is a live DB query, so it has no idea
  // about the hardcoded local-only test tickets used elsewhere in this file
  // (buildDevTestRouteTickets) — those never touch the real `tickets` table.
  // These fake stops are set immediately, independent of whether the real
  // query below succeeds, fails, or is still loading, so the dropdown is
  // never empty while testing locally. Submitting/approving against one of
  // these still exercises the full dispute flow (create, review, approve/
  // reject) — the one thing it CAN'T prove is the approve side-effect
  // actually landing on a ticket, since setTicketOnsiteCheckIn's update just
  // silently matches zero rows for a ticket number that doesn't really
  // exist. To verify that part specifically, pick a real scheduled ticket.
  const devTestStops: TechnicianRouteStop[] = import.meta.env.DEV
    ? [
        { ticketNo: "DEVTEST-003", status: "OP-Ready for Service", statusGroup: "open", timeSlot: "8-12", address: "233 Peachtree St NE, Atlanta, GA", arrivedAt: null, doneAt: null },
        { ticketNo: "DEVTEST-002", status: "OP-Ready for Service", statusGroup: "open", timeSlot: "8-12", address: "191 Peachtree St NE, Atlanta, GA", arrivedAt: null, doneAt: null },
        { ticketNo: "DEVTEST-004", status: "CL-Ready to Complete", statusGroup: "completed", timeSlot: "1-5", address: "101 Marietta St NW, Atlanta, GA", arrivedAt: null, doneAt: null },
      ]
    : [];
  useEffect(() => {
    setTodaysStops(devTestStops);
    if (!technicianName) return;
    getTechnicianTodayRoute(technicianName)
      .then((real) => setTodaysStops([...real, ...devTestStops]))
      .catch((e) => console.error("ticket time dispute: load today's tickets failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicianName]);

  const submit = async () => {
    if (!profileId) {
      setMsgIsError(true);
      setMsg("Your profile hasn't loaded yet — try again in a moment.");
      return;
    }
    if (!ticketNo) {
      setMsgIsError(true);
      setMsg("Pick which ticket this is about.");
      return;
    }
    if (!startTime || !endTime) {
      setMsgIsError(true);
      setMsg("Enter the time you actually started and finished.");
      return;
    }
    if (!details.trim()) {
      setMsgIsError(true);
      setMsg("Describe what went wrong with the check-in.");
      return;
    }
    if (files.length === 0) {
      setMsgIsError(true);
      setMsg("Attach proof (a photo or screenshot) before submitting.");
      return;
    }
    setSubmitting(true);
    setMsgIsError(false);
    setMsg("");
    try {
      let attachments: { url: string; name: string }[] = [];
      if (files.length > 0 && companyId) {
        const disputeKey = crypto.randomUUID();
        attachments = await Promise.all(
          files.map(async (f) => {
            const { url } = await uploadTicketTimeDisputeAttachment(companyId, disputeKey, f);
            return { url, name: f.name };
          })
        );
      }
      // A typed "10:00 AM" means 10:00 AM in the technician's own SCHEDULED
      // timezone (CST/EST, profiles.schedule_timezone) — not whatever
      // timezone their device's clock happens to be set to, same convention
      // Time Clock punches already follow (serverTime.ts). Confirmed bug
      // without this: a Central-time technician typing 10:00 AM was coming
      // back as 5:00 AM, since the earlier fix used the browser's own local
      // time instead of the technician's actual scheduled zone.
      const todayKey = zonedDateKey(new Date(), scheduleTimezone);
      const [y, mo, d] = todayKey.split("-").map(Number);
      const [startHour, startMin] = startTime.split(":").map(Number);
      const [endHour, endMin] = endTime.split(":").map(Number);
      const disputedStart = zonedWallClockToUtcIso(y, mo, d, startHour, startMin, scheduleTimezone);
      const disputedEnd = zonedWallClockToUtcIso(y, mo, d, endHour, endMin, scheduleTimezone);
      await createEmployeeRequest({
        profileId,
        requestType: "ticket_time_dispute",
        details: details.trim(),
        requestedBy: profileId,
        ticketNo,
        disputedStartTime: disputedStart,
        disputedEndTime: disputedEnd,
        attachments,
      });
      void notifyRequestReviewers({
        body: `⚠️ New Ticket Time Dispute from ${userName} (Ticket ${ticketNo}).`,
        linkTo: "/m/dashboard/attendance-monitoring?tab=ticket-time-disputes",
        senderId: profileId,
        senderName: userName,
      });
      setTicketNo("");
      setStartTime("");
      setEndTime("");
      setDetails("");
      setFiles([]);
      setMsg("Dispute submitted.");
      await load();
    } catch (e) {
      setMsgIsError(true);
      setMsg(e instanceof Error ? e.message : "Failed to submit dispute.");
    } finally {
      setSubmitting(false);
      setTimeout(() => setMsg(""), 3000);
    }
  };

  return (
    <div className="mtech-scroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">Ticket Time Dispute</div>
        <div className="mtech-payroll-sub">Report a failed on-site check-in for a ticket</div>
      </div>

      <div className="mtech-panel" style={{ marginTop: 0 }}>
        <div className="mtech-section-title" style={{ marginTop: 0 }}>Ticket</div>
        <select className="mtech-bill-input full" value={ticketNo} onChange={(e) => setTicketNo(e.target.value)}>
          <option value="">Select a ticket from today…</option>
          {todaysStops.map((s) => {
            const dispute = myDisputeStatusByTicketNo.get(s.ticketNo);
            // Colored option text so a technician can see at a glance
            // they've already filed on this one (and what time) before
            // starting another — <option> styling support is inconsistent
            // across mobile browsers (notably iOS), so the label text
            // itself always spells it out too, not just the color.
            if (dispute) {
              const isPending = dispute.status === "pending";
              return (
                <option key={s.ticketNo} value={s.ticketNo} style={{ color: isPending ? "#ca8a04" : "#16a34a" }}>
                  {s.ticketNo} — Already disputed ({isPending ? "Pending" : "Approved"}): {dispute.time}
                </option>
              );
            }
            return (
              <option key={s.ticketNo} value={s.ticketNo}>
                {s.ticketNo} — {s.address || "No address"}{s.timeSlot ? ` (${s.timeSlot})` : ""}
              </option>
            );
          })}
        </select>
        {todaysStops.length === 0 && (
          <p className="mtech-muted" style={{ padding: "0.15rem 0 0.25rem" }}>No tickets found for today yet.</p>
        )}

        <div className="mtech-section-title">Start Time ({scheduleTimezone})</div>
        <input
          className="mtech-bill-input full"
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />

        <div className="mtech-section-title">End Time ({scheduleTimezone})</div>
        <input
          className="mtech-bill-input full"
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
        />

        <div className="mtech-section-title">What's wrong?</div>
        <textarea
          className="mtech-bill-input full"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Describe the issue — e.g. GPS wouldn't register, signal was down, etc."
        />

        <div className="mtech-section-title">Proof</div>
        <input
          className="mtech-bill-input full"
          type="file"
          multiple
          accept="image/*,.pdf"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        {files.length > 0 && (
          <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{files.length} file{files.length === 1 ? "" : "s"} selected</p>
        )}

        <button type="button" className="mtech-save-btn" onClick={submit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Dispute"}
        </button>
        {msg && <div className="mtech-save-msg" style={msgIsError ? { color: "#f87171" } : undefined}>{msg}</div>}
      </div>

      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9", margin: "0.4rem 0 0.1rem" }}>My Disputes</div>
      {loading ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>Loading disputes…</div>
      ) : requests.length === 0 ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>No disputes submitted yet.</div>
      ) : (
        <div className="mtech-payroll-list">
          {requests.map((r) => (
            <div key={r.id} className="mtech-payroll-row">
              <div className="mtech-payroll-row-head">
                <div className="mtech-payroll-row-date">{new Date(r.createdAt).toLocaleDateString()}</div>
                <div className="mtech-payroll-status" style={{ background: REQUEST_STATUS_COLORS[r.status].bg, color: REQUEST_STATUS_COLORS[r.status].fg }}>
                  {requestStatusLabel(r.status)}
                </div>
              </div>
              <div className="mtech-payroll-row-body" style={{ display: "block", padding: "0.4rem 0.85rem 0.7rem" }}>
                {r.ticketNo && <p className="mtech-muted" style={{ padding: "0.25rem 0", fontWeight: 600, color: "#93c5fd" }}>Ticket {r.ticketNo}</p>}
                {(r.disputedStartTime || r.disputedEndTime) && (
                  <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                    {fmtTimeInZone(r.disputedStartTime, scheduleTimezone)} – {fmtTimeInZone(r.disputedEndTime, scheduleTimezone)} {scheduleTimezone}
                  </p>
                )}
                <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{r.details}</p>
                {r.attachments.length > 0 && (
                  <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                    {r.attachments.map((a, i) => (
                      <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd", marginRight: "0.5rem" }}>
                        {a.name}{i < r.attachments.length - 1 ? "," : ""}
                      </a>
                    ))}
                  </p>
                )}
                {r.reviewNote && (
                  <p className="mtech-muted" style={{ color: "#16a34a", fontWeight: 600, padding: "0.25rem 0" }}>Response: {r.reviewNote}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Submit a time correction and track your own — needs the employee's own
// "original" check-in/out/meal punch for the selected date (looked up via
// getMonthEntries, the same source MobileTimecardView already uses for
// today's entry) so the review queue can show what's being corrected FROM,
// not just what it's being corrected TO. Same two-stage manager-then-(HR OR
// Accounting) approval as Time Off, via timecardCorrections.ts.
function MobileTimeCorrectionView({ userName, profileId }: { userName: string; profileId: string | null }) {
  const [requests, setRequests] = useState<TimecardCorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyProfiles, setCompanyProfiles] = useState<ProfileRow[]>([]);
  const [correctionDate, setCorrectionDate] = useState("");
  const [correctedCheckIn, setCorrectedCheckIn] = useState("");
  const [correctedCheckOut, setCorrectedCheckOut] = useState("");
  const [correctedMealStart, setCorrectedMealStart] = useState("");
  const [correctedMealEnd, setCorrectedMealEnd] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getCompanyUsers().then(setCompanyProfiles).catch((e) => console.error("time correction: load users failed", e));
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const all = await getCompanyTimecardCorrections();
      setRequests(all.filter((r) => r.profileId === profileId));
    } catch (e) {
      console.error("time correction: load requests failed", e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [profileId]);

  const submit = async () => {
    if (!profileId) {
      setMsg("Your profile hasn't loaded yet — try again in a moment.");
      return;
    }
    if (!correctionDate) {
      setMsg("Select the date you're correcting.");
      return;
    }
    if (!correctedCheckIn && !correctedCheckOut && !correctedMealStart && !correctedMealEnd) {
      setMsg("Enter at least one corrected time (check in, check out, meal start, or meal end).");
      return;
    }
    if (!details.trim()) {
      setMsg("Add a reason for the correction.");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      const [y, m] = correctionDate.split("-").map(Number);
      const monthEntries = await getMonthEntries(profileId, y, m - 1);
      const existing = monthEntries[correctionDate];

      const effectiveCheckIn = correctedCheckIn || existing?.checkIn || "";
      const effectiveCheckOut = correctedCheckOut || existing?.checkOut || "";
      if (isCheckOutBeforeCheckIn(effectiveCheckIn, effectiveCheckOut)) {
        setMsg(`Check out (${effectiveCheckOut}) is before check in (${effectiveCheckIn}). Double-check the time.`);
        setSubmitting(false);
        return;
      }
      const effectiveMealStart = correctedMealStart || existing?.mealStart || "";
      const effectiveMealEnd = correctedMealEnd || existing?.mealEnd || "";
      if (isCheckOutBeforeCheckIn(effectiveMealStart, effectiveMealEnd)) {
        setMsg(`Meal end (${effectiveMealEnd}) is before meal start (${effectiveMealStart}). Double-check the time.`);
        setSubmitting(false);
        return;
      }

      const myProfile = companyProfiles.find((p) => p.id === profileId) ?? null;
      const managerProfile = myProfile ? await resolveTeamLeadOrManager(myProfile, companyProfiles) : null;

      await createTimecardCorrection({
        profileId,
        workDate: correctionDate,
        originalCheckIn: existing?.checkIn || "",
        originalCheckOut: existing?.checkOut || "",
        correctedCheckIn,
        correctedCheckOut,
        originalMealStart: existing?.mealStart || "",
        originalMealEnd: existing?.mealEnd || "",
        correctedMealStart,
        correctedMealEnd,
        reason: details.trim(),
        requestedBy: profileId,
        managerId: managerProfile?.id ?? null,
      });

      // Manager + every HR/Finance user + the requester themselves — same
      // recipient rule the desktop correction submit flow uses, so HR/
      // Finance get an early heads-up rather than only learning about it
      // once the manager has already approved.
      const recipients = new Map<string, ProfileRow>();
      if (managerProfile && managerProfile.id !== profileId) recipients.set(managerProfile.id, managerProfile);
      for (const p of companyProfiles) {
        if (!p.is_active) continue;
        const primary = (p.role || "").toUpperCase();
        if (primary === "HR" || primary === "FINANCE") recipients.set(p.id, p);
      }
      if (myProfile) recipients.set(myProfile.id, myProfile);
      await Promise.all(
        Array.from(recipients.values()).map((r) =>
          createNotification({
            recipientId: r.id,
            senderId: profileId,
            senderName: userName,
            body: `🕐 New Time Correction Request from ${userName} for ${correctionDate}.`,
            linkTo: r.id === profileId
              ? "/m/dashboard/employee-self-service?tab=requests"
              : "/m/dashboard/attendance-monitoring?tab=corrections",
          }).catch((err) => console.error("Failed to notify", r.id, err))
        )
      );

      setCorrectionDate("");
      setCorrectedCheckIn("");
      setCorrectedCheckOut("");
      setCorrectedMealStart("");
      setCorrectedMealEnd("");
      setDetails("");
      setMsg("Correction submitted.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to submit correction.");
    } finally {
      setSubmitting(false);
      setTimeout(() => setMsg(""), 3000);
    }
  };

  return (
    <div className="mtech-scroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">Time Correction</div>
        <div className="mtech-payroll-sub">Request a fix to a check-in, check-out, or meal punch</div>
      </div>

      <div className="mtech-panel" style={{ marginTop: 0 }}>
        <div className="mtech-section-title" style={{ marginTop: 0 }}>Date</div>
        <input className="mtech-bill-input full" type="date" value={correctionDate} onChange={(e) => setCorrectionDate(e.target.value)} />

        <div className="mtech-section-title">Corrected Check In</div>
        <input className="mtech-bill-input full" type="time" value={correctedCheckIn} onChange={(e) => setCorrectedCheckIn(e.target.value)} />

        <div className="mtech-section-title">Corrected Check Out</div>
        <input className="mtech-bill-input full" type="time" value={correctedCheckOut} onChange={(e) => setCorrectedCheckOut(e.target.value)} />

        <div className="mtech-section-title">Corrected Meal Start</div>
        <input className="mtech-bill-input full" type="time" value={correctedMealStart} onChange={(e) => setCorrectedMealStart(e.target.value)} />

        <div className="mtech-section-title">Corrected Meal End</div>
        <input className="mtech-bill-input full" type="time" value={correctedMealEnd} onChange={(e) => setCorrectedMealEnd(e.target.value)} />

        <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>Fill in only the field(s) that were wrong — the rest is left as recorded.</p>

        <div className="mtech-section-title">Reason</div>
        <textarea
          className="mtech-bill-input full"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What happened?"
        />

        <button type="button" className="mtech-save-btn" onClick={submit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Correction"}
        </button>
        {msg && <div className="mtech-save-msg">{msg}</div>}
      </div>

      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9", margin: "0.4rem 0 0.1rem" }}>My Corrections</div>
      {loading ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>Loading corrections…</div>
      ) : requests.length === 0 ? (
        <div className="mtech-muted" style={{ color: "#94a3b8" }}>No corrections submitted yet.</div>
      ) : (
        <div className="mtech-payroll-list">
          {requests.map((r) => (
            <div key={r.id} className="mtech-payroll-row">
              <div className="mtech-payroll-row-head">
                <div className="mtech-payroll-row-date">{r.workDate}</div>
                <div className="mtech-payroll-status" style={{ background: REQUEST_STATUS_COLORS[r.status].bg, color: REQUEST_STATUS_COLORS[r.status].fg }}>
                  {requestStatusLabel(r.status)}
                </div>
              </div>
              <div className="mtech-payroll-row-body" style={{ display: "block", padding: "0.4rem 0.85rem 0.7rem" }}>
                {(r.correctedCheckIn || r.correctedCheckOut) && (
                  <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                    Check: {r.originalCheckIn || "—"} → {r.correctedCheckIn || "—"} / {r.originalCheckOut || "—"} → {r.correctedCheckOut || "—"}
                  </p>
                )}
                {(r.correctedMealStart || r.correctedMealEnd) && (
                  <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                    Meal: {r.originalMealStart || "—"} → {r.correctedMealStart || "—"} / {r.originalMealEnd || "—"} → {r.correctedMealEnd || "—"}
                  </p>
                )}
                <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>{r.reason}</p>
                <p className="mtech-muted" style={{ padding: "0.25rem 0" }}>
                  Manager: {requestStatusLabel(r.managerStatus)} · HR: {requestStatusLabel(r.hrStatus)} · Accounting: {requestStatusLabel(r.accountingStatus)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Generic "coming soon on mobile" screen for views where the desktop
// implementation isn't practical on a phone.
function MobileStubView({ title, message }: { title: string; message: string }) {
  return (
    <div className="mtech-scroll mtech-stub">
      <div className="mtech-stub-icon">🚧</div>
      <div className="mtech-stub-title">{title}</div>
      <p className="mtech-stub-message">{message}</p>
    </div>
  );
}
