import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, MapPin, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { ALL_TECHNICIANS, LOCATIONS, getTechniciansForLocation, normalizeLocationName } from "@/lib/locations";
import { getLocationManagementZoomAddress, getLocationManagementCoordinates } from "@/components/LocationManagementPage";
import { getTicketByNumber, type Ticket } from "@/lib/ticketData";
import { TIME_FRAMES, FRAME_START_TIME, type TimeFrame, normalizeTimePeriod } from "@/lib/timeframes";
import {
  getCompanyTickets,
  updateTicketAssignment,
  getLatestVisitTechnicianByTicketIds,
} from "@/lib/supabase/tickets";
import { getLocations as sbGetLocations } from "@/lib/supabase/locationManagement";
import type { TechnicianHome } from "@/lib/supabase/users";
import { lookupZip } from "@/lib/zipCoverage";
import { useAuth } from "@/lib/auth";
import { getCompanyMapProvider, type MapProvider } from "@/lib/supabase/companySettings";
import { loadGoogleMapsScript, makeGeocoder, addRouteDirectionArrow, attachLeafletResizeFix, createBadgeDivIcon, OSM_TILE_URL, OSM_ATTRIBUTION } from "@/lib/mapEngine";

type TicketRecord = Record<string, any> & {
  ticketNo: string;
  customer: string;
  city: string;
  location: string;
  branch: string;
  technician: string;
  status: string;
  schedule: string;
  created: string;
  type: string;
  phone: string;
  delay: number;
  aging: number;
};

type PlannerTicket = TicketRecord & {
  slot: TimeFrame;
  scheduleTime: string;
  lat?: number;
  lng?: number;
};

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const US_STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

// Returns the 2-letter abbreviation for a full state name, or the input as-is
// (uppercased) if it's already an abbreviation / unknown.
function abbreviateState(state: string): string {
  const s = (state || "").trim();
  if (!s) return "";
  if (s.length === 2) return s.toUpperCase();
  return US_STATE_ABBR[s.toLowerCase()] ?? s;
}

// Short display address for the daily schedule card, e.g. "Memphis, TN 38118".
function shortAddress(t: { city?: string; state?: string; zip?: string; location?: string }): string {
  const city = (t.city || "").trim();
  const st = abbreviateState(t.state || "");
  const zip = (t.zip || "").trim();
  const tail = [st, zip].filter(Boolean).join(" ");
  const parts = [city, tail].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return (t.location || "").trim() || "Unknown address";
}

const LOCATION_OPTIONS = LOCATIONS;
const STATUS_LEGEND = [
  { label: "Pending", className: "color-pending" },
  { label: "Ready for Service", className: "color-ready" },
  { label: "Completed", className: "color-completed" },
  { label: "Claimed", className: "color-claimed" },
];
// Daily schedule columns: each time frame, plus an ANYTIME catch-all.
const TIME_SLOTS: Array<PlannerTicket["slot"]> = [...TIME_FRAMES, "ANYTIME"];
const SLOT_TIMES: Record<string, string> = FRAME_START_TIME;
function getLocalDateStr(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateValue: string, offsetDays: number) {
  const nextDate = new Date(`${dateValue}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + offsetDays);
  return getLocalDateStr(nextDate);
}

function normalizeBranch(value: string) {
  const normalized = normalizeLocationName(String(value || ""));
  return normalized || "Unassigned";
}

function getStatusGroup(status: string) {
  const value = String(status || "").toLowerCase();
  if (value.includes("complet") || value.includes("closed") || value.includes("done")) return "Completed";
  if (value.includes("ready")) return "Ready for Service";
  if (value.includes("claim")) return "Claimed";
  return "Pending";
}

function getToneClass(ticket: PlannerTicket, index: number) {
  const status = String(ticket.status || "").toLowerCase();
  if (status.includes("complet") || status.includes("closed") || status.includes("done")) return `tone-tech-${index % 6}`;
  if (status.includes("ready")) return `tone-tech-${(index + 1) % 6}`;
  if (status.includes("claim")) return `tone-tech-${(index + 2) % 6}`;
  return `tone-tech-${index % 6}`;
}

function getInitials(value: string | null | undefined) {
  if (!value) return "U";
  
  // Split by spaces to get first and last name
  const parts = value.trim().split(/\s+/).filter(Boolean);
  
  if (parts.length >= 2) {
    // Use first letter of first name + first letter of last name
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  
  // Fallback: if only one word, use first two letters
  return value.slice(0, 2).toUpperCase();
}

// Stable per-technician color so a tech's ticket badges, house pin, and route
// line all share one color on the map.
const TECH_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
function techColor(roster: readonly string[], techName: string): string {
  const idx = roster.indexOf(techName);
  return idx >= 0 ? TECH_COLORS[idx % TECH_COLORS.length] : "#3B82F6";
}

function createPlannerTickets(rows: TicketRecord[]): PlannerTicket[] {
  // Daily schedule should hide cancelled work — drop them at the source so
  // they never appear on the planner board, map, or counts. "Need Cancel"
  // is still an open work item (CSR requested cancellation but it isn't
  // approved yet), so it stays visible.
  const isCancelled = (status: unknown) => {
    const v = String(status || "").toLowerCase().trim();
    if (!v) return false;
    if (v.includes("need cancel")) return false;
    return /\bcancell?ed\b/.test(v) || v === "cx" || v.startsWith("cx-cancel");
  };
  return rows.filter((row) => !isCancelled(row.status)).map((row, index) => {
    // Time slot is persisted on the ticket. If a ticket has never been
    // scheduled into a slot, default it to ANYTIME (stable across reloads,
    // not a rotating value). Normalise SP-style raw windows ("08:00 - 12:00
    // MORNING", "1:00 PM - 5:00 PM", "AM", "AFTERNOON", …) into the
    // canonical frame label so old rows still bucket into the right column.
    const rawSlot = String(row.slot || row.timeSlot || row.schedulePeriod || "").trim();
    const slot: TimeFrame = normalizeTimePeriod(rawSlot) ?? "ANYTIME";
    
    const techRoster = getTechniciansForLocation(normalizeBranch(row.location || row.city || row.branch));
    const technician = row.technician || techRoster[index % Math.max(techRoster.length, 1)] || ALL_TECHNICIANS[index % ALL_TECHNICIANS.length] || "Unassigned";
    
    // Build complete address with street, city, state, and zip for accurate geocoding
    const streetAddress = row.customer_address || row.address || "";
    const city = row.city || row.customer_city || row.location || "";
    const state = row.state || row.customer_state || ""; // use the ticket's real state
    const zip = row.zip || row.customer_zip || row.zipcode || "";

    // Format: "Street Address, City, State ZIP" - this gives best geocoding results
    let fullAddress = "";
    if (streetAddress && city && zip) {
      fullAddress = `${streetAddress}, ${city}, ${state} ${zip}`.replace(/\s+/g, " ").trim();
    } else if (city && zip) {
      fullAddress = `${city}, ${state} ${zip}`.replace(/\s+/g, " ").trim();
    } else if (streetAddress && city) {
      fullAddress = `${streetAddress}, ${city}, ${state}`.replace(/\s+/g, " ").trim();
    } else if (city) {
      fullAddress = `${city}, ${state}`.replace(/\s+/g, " ").trim();
    } else if (zip) {
      fullAddress = zip;
    } else {
      fullAddress = row.location || "Unknown";
    }
    
    return {
      ...row,
      location: normalizeBranch(row.location || row.city || row.branch),
      branch: normalizeBranch(row.branch || row.location || row.city),
      technician,
      slot,
      scheduleTime: row.scheduleTime || SLOT_TIMES[slot] || "17:30",
      status: row.status || "Pending",
      created: String(row.created || row.created_at || getLocalDateStr()),
      customer: String(row.customer || row.customer_name || "Unknown"),
      city: String(city),
      state: String(state),
      zip: String(zip),
      address: fullAddress,
      delay: Number(row.delay ?? 0),
      aging: Number(row.aging ?? 0),
      phone: String(row.phone || row.customer_cell_phone_1 || ""),
      type: String(row.type || row.source || "SMS"),
      ticketNo: String(row.ticketNo || row.ticket_no || row.no || `TP-${index + 1}`),
    };
  });
}

function getSelectedTechRoster(location: string) {
  if (!location) return [];
  const roster = getTechniciansForLocation(location);
  if (roster.length) return roster;
  return ALL_TECHNICIANS.slice(0, 8);
}

export function WorkPlannerPage({ mod, sub }: Props) {
  const { email, ready, allowedLocations } = useAuth();
  const locationChoices = allowedLocations === null
    ? (LOCATION_OPTIONS as unknown as string[])
    : (LOCATION_OPTIONS as unknown as string[]).filter((l) => allowedLocations.includes(l));
  const [location, setLocation] = useState("");
  const [plannerDate, setPlannerDate] = useState(() => getLocalDateStr());
  const [showRescheduled, setShowRescheduled] = useState(false);
  const [plannerTickets, setPlannerTickets] = useState<PlannerTicket[]>([]);
  const [changedTickets, setChangedTickets] = useState<Array<{ type: string; ticketNum: string; scheduleDate: string; newTimeSlot: string; previousTimeSlot: string; technician: string; timestamp: string }>>([]);
  const [selectedTicket, setSelectedTicket] = useState<PlannerTicket | null>(null);
  const [mapMode, setMapMode] = useState<"map" | "satellite">("map");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState(0);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);
  const [techHomes, setTechHomes] = useState<TechnicianHome[]>([]);
  const geocodeCacheRef = useRef<Map<string, { lat: number; lng: number } | null>>(new Map());
  const dragSourceRef = useRef<{ ticketNo: string; slot: PlannerTicket["slot"]; technician: string } | null>(null);

  // Company-wide map provider (see migration 0050) — set from /m/admin.
  const [mapProvider, setMapProvider] = useState<MapProvider | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCompanyMapProvider().then((p) => { if (!cancelled) setMapProvider(p); });
    return () => { cancelled = true; };
  }, []);
  const leafletContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const leafletMarkersRef = useRef<L.Marker[]>([]);
  const leafletPolylinesRef = useRef<L.Polyline[]>([]);
  const leafletArrowsRef = useRef<L.Marker[]>([]);

  // Manual order within a single (date, technician, slot) cell. Keyed by
  // `${date}|${technician}|${slot}` → array of ticket numbers in the order
  // dispatch wants them rendered. Anything not in the array sorts to the
  // bottom by ticket number. Persisted to localStorage so the next page
  // load preserves the route the user laid out.
  const ORDER_KEY = "ahs:work-planner:slot-order:v1";
  const [slotOrder, setSlotOrder] = useState<Record<string, string[]>>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(ORDER_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ORDER_KEY, JSON.stringify(slotOrder));
      }
    } catch { /* ignore quota */ }
  }, [slotOrder]);
  const slotOrderKey = (date: string, technician: string, slot: string) =>
    `${date}|${technician}|${slot}`;

  // Track which card is being dragged so we can compute the drop index
  // when the user releases over another card in the same cell.
  const reorderDragRef = useRef<{ ticketNo: string; cellKey: string } | null>(null);

  useEffect(() => {
    // Load tickets from Supabase (company-scoped via RLS).
    let cancelled = false;
    const load = async () => {
      try {
        const rows = (await getCompanyTickets()) as unknown as TicketRecord[];
        // Overlay the latest visit-recorded technician onto tickets
        // whose `technician` field is blank — the CSR often sets the
        // tech on a visit row before the ticket itself is updated, and
        // without this overlay the planner falls back to its roster
        // cycle and misattributes the work.
        try {
          const ids = rows
            .map((t: any) => String(t?._id ?? "").trim())
            .filter(Boolean);
          if (ids.length > 0) {
            const techMap = await getLatestVisitTechnicianByTicketIds(ids);
            for (const t of rows as any[]) {
              const tid = String(t?._id ?? "").trim();
              const currentTech = String(
                (t.technician ?? t.technician_name ?? "") as string,
              ).trim();
              if (!currentTech || currentTech.toLowerCase() === "unassigned") {
                const visitTech = tid ? techMap.get(tid) : "";
                if (visitTech) t.technician = visitTech;
              }
            }
          }
        } catch (visitErr) {
          console.warn("Work Planner: tech overlay skipped", visitErr);
        }
        if (!cancelled) setPlannerTickets(createPlannerTickets(rows));
      } catch (err) {
        console.error("Work Planner: failed to load tickets:", err);
        if (!cancelled) setPlannerTickets([]);
      }
    };
    if (ready) load();
    return () => { cancelled = true; };
  }, [ready]);

  // Hydrate the location cache (localStorage) from Supabase so the Work Map's
  // office pin can use saved coordinates/addresses even if the user never
  // opened the Location Management page this session.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const locs = await sbGetLocations();
        if (cancelled || !locs.length) return;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            "ahs:location-management:locations",
            JSON.stringify({ rows: locs }),
          );
        }
      } catch (err) {
        console.error("Work Planner: failed to load locations:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [ready]);

  // Load technician home addresses (for Work Map house pins). Company-scoped.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getCompanyTechnicianHomes } = await import("@/lib/supabase/users");
        const homes = await getCompanyTechnicianHomes();
        if (!cancelled) setTechHomes(homes);
      } catch (err) {
        console.warn("Work Planner: failed to load technician homes:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") setPlannerDate((current) => shiftDate(current, -1));
      if (event.altKey && event.key === "ArrowRight") setPlannerDate((current) => shiftDate(current, 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedTechRoster = useMemo(() => getSelectedTechRoster(location), [location]);

  const visibleTickets = useMemo(() => {
    const selectedDate = plannerDate;
    // Statuses that explicitly mean the ticket is NOT yet scheduled for a
    // day. These should never appear on the daily Work Planner / Work Map
    // even if some legacy row happens to carry a date.
    const isPreScheduleStatus = (status: string) => {
      const v = String(status || "").toLowerCase().trim();
      if (!v) return false;
      if (v.startsWith("csr-assigned to asc")) return true;
      if (v.startsWith("csr-needs scheduling")) return true;
      if (v.startsWith("pt-")) return true; // PT-Preauthentication, PT-Preauthorization, etc.
      return false;
    };
    return plannerTickets.filter((ticket) => {
      // Must have an actual scheduled date — no fallback to created_at.
      // Anything else is "unscheduled" and stays off the planner.
      const ticketDate = String(ticket.schedule || "").slice(0, 10);
      if (!ticketDate) return false;
      if (ticketDate !== selectedDate) return false;
      if (isPreScheduleStatus(ticket.status)) return false;
      if (location && normalizeBranch(ticket.location || ticket.city || ticket.branch) !== location) return false;
      if (!showRescheduled && String(ticket.status || "").toLowerCase().includes("resched")) return false;
      return true;
    });
  }, [plannerTickets, plannerDate, location, showRescheduled]);

  const groupedTickets = useMemo(() => {
    // Apply the manual per-cell order (date, tech, slot) on top of the
    // default ticket-number sort. Tickets that don't appear in the saved
    // order land at the bottom in ticket-number order — so brand-new
    // tickets stay visible without breaking an existing layout.
    const applyOrder = (tech: string, slot: string, list: PlannerTicket[]) => {
      const key = slotOrderKey(plannerDate, tech, slot);
      const saved = slotOrder[key] ?? [];
      if (saved.length === 0) return list;
      const pos = new Map<string, number>();
      saved.forEach((n, idx) => pos.set(n, idx));
      return [...list].sort((a, b) => {
        const ai = pos.has(a.ticketNo) ? pos.get(a.ticketNo)! : Number.MAX_SAFE_INTEGER;
        const bi = pos.has(b.ticketNo) ? pos.get(b.ticketNo)! : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return String(a.ticketNo).localeCompare(String(b.ticketNo));
      });
    };
    return selectedTechRoster.map((tech) => ({
      tech,
      slots: TIME_SLOTS.map((slot) =>
        applyOrder(
          tech,
          slot,
          visibleTickets.filter(
            (ticket) => ticket.technician === tech && ticket.slot === slot,
          ),
        ),
      ),
    }));
  }, [selectedTechRoster, visibleTickets, plannerDate, slotOrder]);

  const techSummary = useMemo(() => {
    return selectedTechRoster.map((tech, index) => {
      const records = visibleTickets.filter((ticket) => ticket.technician === tech);
      const ready = records.filter((ticket) => getStatusGroup(ticket.status) === "Ready for Service").length;
      const pending = records.filter((ticket) => getStatusGroup(ticket.status) === "Pending").length;
      const completed = records.filter((ticket) => getStatusGroup(ticket.status) === "Completed").length;
      return { tech, ready, pending, completed, color: `tone-tech-${index % 6}` };
    });
  }, [selectedTechRoster, visibleTickets]);

  const unverifiedTickets = useMemo(() => visibleTickets.filter((ticket) => !String(ticket.address || ticket.customer_address || "").trim()), [visibleTickets]);

  // Instantiate the Google map once Google is the active provider.
  useEffect(() => {
    if (mapProvider !== "google") return;
    let cancelled = false;
    loadGoogleMapsScript()
      .then(() => {
        if (cancelled || !mapContainerRef.current) return;
        const maps = (window as Window & { google?: any }).google?.maps;
        if (!maps) return;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(mapContainerRef.current, {
            center: { lat: 37.0902, lng: -95.7129 },
            zoom: 4,
            mapTypeId: maps.MapTypeId.ROADMAP,
            disableDefaultUI: true,
            gestureHandling: "greedy",
          });
        }
        setMapReady(true);
        setMapError(null);
      })
      .catch(() => { if (!cancelled) setMapError("Google Maps failed to load."); });
    return () => {
      cancelled = true;
      mapRef.current = null;
      setMapReady(false);
    };
  }, [mapProvider]);

  // Instantiate the Leaflet map once Leaflet is the active provider.
  useEffect(() => {
    if (mapProvider !== "leaflet" || !leafletContainerRef.current) return;
    const container = leafletContainerRef.current;
    const map = L.map(container, {
      center: [37.0902, -95.7129],
      zoom: 4,
    });
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    leafletMapRef.current = map;
    const detachResizeFix = attachLeafletResizeFix(map, container);
    setMapReady(true);
    setMapError(null);
    return () => {
      detachResizeFix();
      map.remove();
      leafletMapRef.current = null;
      setMapReady(false);
    };
  }, [mapProvider]);

  useEffect(() => {
    if (!mapReady || !mapProvider) return;
    const activeMap = mapProvider === "google" ? mapRef.current : leafletMapRef.current;
    if (!activeMap) return;
    const maps = (window as Window & { google?: any }).google?.maps;
    if (mapProvider === "google" && !maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    polylinesRef.current.forEach((line) => line.setMap(null));
    polylinesRef.current = [];
    leafletMarkersRef.current.forEach((m) => m.remove());
    leafletMarkersRef.current = [];
    leafletPolylinesRef.current.forEach((l) => l.remove());
    leafletPolylinesRef.current = [];
    leafletArrowsRef.current.forEach((m) => m.remove());
    leafletArrowsRef.current = [];

    // Ordered geocoded stops per technician, for drawing route lines.
    const routePointsByTech = new Map<string, Array<{ order: number; position: { lat: number; lng: number } }>>();

    const geocode = makeGeocoder(mapProvider);

    // Resolve an office location's position: use explicit Location Management
    // coordinates when set (more precise, no geocoding), otherwise geocode the
    // saved address.
    const geocodeOfficeLocation = (loc: string) => {
      const coords = getLocationManagementCoordinates(loc);
      if (coords) return Promise.resolve(coords);
      return geocode(getLocationManagementZoomAddress(loc));
    };

    // Marker/polyline helpers, dual-provider. Leaflet approximates each
    // custom Google SVG marker (ticket badge / office pin / house icon)
    // with a divIcon; exact pixel parity isn't the goal, just the same
    // color-coding + label content.
    const addTicketMarker = (pos: { lat: number; lng: number }, opts: { label: string; color: string; title: string; onClick: () => void }) => {
      if (mapProvider === "google") {
        const marker = new maps.Marker({
          map: activeMap,
          position: pos,
          title: opts.title,
          icon: {
            path: "M2 2 L38 2 Q40 2 40 4 L40 16 Q40 18 38 18 L22 18 L20 22 L18 18 L2 18 Q0 18 0 16 L0 4 Q0 2 2 2 Z",
            fillColor: opts.color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            scale: 1.8,
            anchor: new maps.Point(20, 22),
            labelOrigin: new maps.Point(20, 10),
          },
          label: { text: opts.label, color: "#ffffff", fontSize: "13px", fontWeight: "bold" },
        });
        marker.addListener("click", opts.onClick);
        markersRef.current.push(marker);
      } else {
        const marker = L.marker([pos.lat, pos.lng], {
          icon: createBadgeDivIcon(
            `<div style="background:${opts.color};color:#fff;font-size:11px;font-weight:bold;border:2px solid #fff;border-radius:6px;padding:2px 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${opts.label}</div>`,
            { className: "wp-ticket-marker", anchor: "bottom" },
          ),
        }).addTo(activeMap as L.Map);
        marker.on("click", opts.onClick);
        leafletMarkersRef.current.push(marker);
      }
    };

    const addOfficeMarker = (pos: { lat: number; lng: number }, title: string) => {
      if (mapProvider === "google") {
        const officeMarker = new maps.Marker({
          map: activeMap,
          position: pos,
          title,
          icon: {
            path: "M12 0 C5.4 0 0 5.4 0 12 C0 21 12 34 12 34 C12 34 24 21 24 12 C24 5.4 18.6 0 12 0 Z",
            fillColor: "#0f172a",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
            scale: 1.3,
            anchor: new maps.Point(12, 34),
            labelOrigin: new maps.Point(12, 12),
          },
          label: { text: "🏢", fontSize: "14px" },
          zIndex: 99999,
        });
        markersRef.current.push(officeMarker);
      } else {
        const marker = L.marker([pos.lat, pos.lng], {
          icon: createBadgeDivIcon(`<span style="font-size:20px;">🏢</span>`, { className: "wp-office-marker", anchor: "bottom" }),
          zIndexOffset: 1000,
        }).bindTooltip(title).addTo(activeMap as L.Map);
        leafletMarkersRef.current.push(marker);
      }
    };

    const addHouseMarker = (pos: { lat: number; lng: number }, opts: { color: string; initials: string; title: string }) => {
      if (mapProvider === "google") {
        const houseMarker = new maps.Marker({
          map: activeMap,
          position: pos,
          title: opts.title,
          icon: {
            path: "M12 2 L1 11 L4 11 L4 21 L9 21 L9 15 L15 15 L15 21 L20 21 L20 11 L23 11 Z",
            fillColor: opts.color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            scale: 1.6,
            anchor: new maps.Point(12, 21),
            labelOrigin: new maps.Point(12, 26),
          },
          label: { text: `🏠 ${opts.initials}`, color: "#ffffff", fontSize: "11px", fontWeight: "bold", className: "wp-house-label" },
          zIndex: 99998,
        });
        markersRef.current.push(houseMarker);
      } else {
        const marker = L.marker([pos.lat, pos.lng], {
          icon: createBadgeDivIcon(
            `<div style="font-size:11px;font-weight:bold;color:${opts.color};white-space:nowrap;">🏠 ${opts.initials}</div>`,
            { className: "wp-house-marker", anchor: "bottom" },
          ),
          zIndexOffset: 998,
        }).bindTooltip(opts.title).addTo(activeMap as L.Map);
        leafletMarkersRef.current.push(marker);
      }
    };

    const addRoutePolyline = (points: Array<{ lat: number; lng: number }>, color: string) => {
      if (mapProvider === "google") {
        const line = new maps.Polyline({
          path: points,
          geodesic: true,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 3,
          map: activeMap,
          icons: [{ icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.5 }, offset: "60%" }],
        });
        polylinesRef.current.push(line);
      } else {
        const line = L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), {
          color,
          opacity: 0.9,
          weight: 3,
        }).addTo(activeMap as L.Map);
        leafletPolylinesRef.current.push(line);
        const arrow = addRouteDirectionArrow(activeMap as L.Map, points, color);
        if (arrow) leafletArrowsRef.current.push(arrow);
      }
    };

    let cancelled = false;
    const bounds = mapProvider === "google" ? new maps.LatLngBounds() : L.latLngBounds([]);
    const extendBounds = (pos: { lat: number; lng: number }) =>
      mapProvider === "google" ? bounds.extend(pos) : bounds.extend([pos.lat, pos.lng]);
    const setMapCenterZoom = (pos: { lat: number; lng: number }, zoom: number) => {
      if (mapProvider === "google") {
        activeMap.setCenter(pos);
        activeMap.setZoom(zoom);
      } else {
        (activeMap as L.Map).setView([pos.lat, pos.lng], zoom);
      }
    };
    const fitMapBounds = () => {
      if (mapProvider === "google") activeMap.fitBounds(bounds);
      else (activeMap as L.Map).fitBounds(bounds, { padding: [40, 40] });
    };

    Promise.all(
      visibleTickets.map(async (ticket) => {
        const cacheKey = `${ticket.location}:${ticket.ticketNo}`;
        if (geocodeCacheRef.current.has(cacheKey)) {
          return { ticket, position: geocodeCacheRef.current.get(cacheKey) };
        }

        // Try full address first
        let position = ticket.address ? await geocode(ticket.address) : null;
        
        const tState = (ticket as any).state || "";
        const tZip = (ticket as any).zip || "";

        // Fallback 1: city + state + zip
        if (!position && ticket.city) {
          const cityStateZip = `${ticket.city}, ${tState} ${tZip}`.replace(/\s+/g, " ").trim();
          console.log(`Trying fallback for ${ticket.ticketNo}: ${cityStateZip}`);
          position = await geocode(cityStateZip);
        }
        
        // Fallback 2: city + state
        if (!position && ticket.city) {
          const cityState = `${ticket.city}, ${tState}`.replace(/\s+/g, " ").trim();
          console.log(`Trying city fallback for ${ticket.ticketNo}: ${cityState}`);
          position = await geocode(cityState);
        }

        // Fallback 3: zip only
        if (!position && tZip) {
          position = await geocode(tZip);
        }
        
        // Fallback 4: Try location name
        if (!position && ticket.location) {
          console.log(`Trying location fallback for ${ticket.ticketNo}: ${ticket.location}`);
          position = await geocode(ticket.location);
        }
        
        if (!position) {
          console.error(`All geocoding attempts failed for ticket ${ticket.ticketNo}`);
        }
        
        geocodeCacheRef.current.set(cacheKey, position);
        return { ticket, position };
      }),
    ).then((results) => {
      if (cancelled || !activeMap) return;

      // Order stops by time slot so route numbering follows the daily schedule
      // (e.g. 8-12 before 1-5 before ANYTIME). SLOT_TIMES maps a slot to a
      // start time; unknown slots sort last.
      const slotRank = (slot: string | undefined) => {
        if (!slot) return 9999;
        const t = SLOT_TIMES[slot];
        if (!t) return slot === "ANYTIME" ? 9998 : 9997;
        const [h, m] = t.split(":").map((n) => parseInt(n, 10));
        return (Number.isFinite(h) ? h : 99) * 60 + (Number.isFinite(m) ? m : 0);
      };
      const orderedResults = [...results].sort(
        (a, b) => slotRank((a.ticket as any).slot) - slotRank((b.ticket as any).slot),
      );

      // Group tickets by technician to determine hierarchy numbers
      const ticketsByTech = new Map<string, number>();

      orderedResults.forEach(({ ticket, position }, index) => {
        if (!position) {
          console.warn(`No position found for ticket ${ticket.ticketNo}, skipping marker`);
          return;
        }

        // Determine hierarchy number for this technician
        const techName = ticket.technician || "Unassigned";
        const currentCount = ticketsByTech.get(techName) || 0;
        const hierarchyNumber = currentCount + 1;
        ticketsByTech.set(techName, hierarchyNumber);

        // Get technician initials
        const initials = ticket.technician ? getInitials(ticket.technician) : "??";

        // Create label text: initials + number (e.g., "JR1", "AM2")
        const labelText = `${initials}${hierarchyNumber}`;

        // Determine color based on technician (shared with house pin + route).
        const markerColor = techColor(selectedTechRoster, techName);

        // Collect ordered route points per technician (JK1 -> JK2 -> JK3 ...).
        if (!routePointsByTech.has(techName)) routePointsByTech.set(techName, []);
        routePointsByTech.get(techName)!.push({ order: hierarchyNumber, position });

        addTicketMarker(position, {
          label: labelText,
          color: markerColor,
          title: `${ticket.ticketNo} - ${ticket.customer}\n${techName} - Ticket #${hierarchyNumber}`,
          onClick: () => {
            setSelectedTicket(ticket);
            setSelectedMarkerIndex(index);
          },
        });

        extendBounds(position);
      });

      // Draw a route line per technician connecting their stops in order
      // (JK1 -> JK2 -> JK3), colored to match the tech's badges.
      routePointsByTech.forEach((points, techName) => {
        if (points.length < 2) return;
        const ordered = [...points].sort((a, b) => a.order - b.order);
        addRoutePolyline(ordered.map((p) => p.position), techColor(selectedTechRoster, techName));
      });

      // Pin the OFFICE for the selected branch — large dark pin with 🏢 label.
      if (location) {
        geocodeOfficeLocation(location).then((officePos) => {
          if (cancelled || !officePos || !activeMap) return;
          addOfficeMarker(officePos, `${location} Office`);
        });
      }

      // Pin each technician's HOUSE. Match the tech to the selected branch
      // leniently: their assigned_branch, their home city, or the branch their
      // home ZIP belongs to (zip coverage) — so minor naming/branch gaps still
      // resolve to the right location.
      const homesToShow = techHomes.filter((h) => {
        if (!location) return false; // only show houses when a branch is picked
        const candidates = [h.branch, h.city];
        if (h.zip) {
          const cov = lookupZip(h.zip);
          if (cov?.location) candidates.push(cov.location);
        }
        return candidates.some((c) => c && normalizeBranch(c) === location);
      });
      homesToShow.forEach((home) => {
        const homeAddr = [home.address, home.city, [home.state, home.zip].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ")
          .trim();
        if (!homeAddr) return;
        const color = techColor(selectedTechRoster, home.name);
        const initials = getInitials(home.name);
        geocode(homeAddr).then((pos) => {
          if (cancelled || !pos || !activeMap) return;
          addHouseMarker(pos, { color, initials, title: `${home.name} — home` });
        });
      });

      if (location) {
        geocodeOfficeLocation(location).then((position) => {
          if (position && activeMap) {
            setMapCenterZoom(position, 10);
            return;
          }
          if (mapProvider === "google" ? !bounds.isEmpty() : bounds.isValid()) {
            if (activeMap) fitMapBounds();
          }
        });
      } else if (mapProvider === "google" ? !bounds.isEmpty() : bounds.isValid()) {
        fitMapBounds();
      } else {
        const fallbackLocation = visibleTickets[0]?.location || selectedTechRoster[0] || location;
        geocodeOfficeLocation(fallbackLocation).then((position) => {
          if (position && activeMap) {
            setMapCenterZoom(position, 10);
          } else if (activeMap) {
            setMapCenterZoom({ lat: 37.0902, lng: -95.7129 }, 4);
          }
        });
      }
    });

    return () => { cancelled = true; };
  }, [mapReady, mapProvider, visibleTickets, techHomes]);

  // Satellite view is Google-only (plain OSM tiles have no free satellite
  // layer) — this effect is a no-op in Leaflet mode.
  useEffect(() => {
    if (!mapReady || mapProvider !== "google" || !mapRef.current) return;
    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;
    mapRef.current.setMapTypeId(mapMode === "satellite" ? maps.MapTypeId.SATELLITE : maps.MapTypeId.ROADMAP);
  }, [mapMode, mapReady, mapProvider]);

  useEffect(() => {
    if (!mapReady || !mapProvider || !location) return;
    const activeMap = mapProvider === "google" ? mapRef.current : leafletMapRef.current;
    if (!activeMap) return;

    const explicitCoords = getLocationManagementCoordinates(location);
    const setCenterZoom = (pos: { lat: number; lng: number }) => {
      if (mapProvider === "google") {
        activeMap.setCenter(pos);
        activeMap.setZoom(10);
      } else {
        (activeMap as L.Map).setView([pos.lat, pos.lng], 10);
      }
    };
    if (explicitCoords) {
      setCenterZoom(explicitCoords);
      return;
    }
    makeGeocoder(mapProvider)(getLocationManagementZoomAddress(location)).then((pos) => {
      if (pos) setCenterZoom(pos);
    });
  }, [location, mapReady, mapProvider]);

  const handleDragStart = (ticketNo: string, slot: PlannerTicket["slot"], technician: string) => {
    dragSourceRef.current = { ticketNo, slot, technician };
  };

  const handleDrop = async (technician: string, slot: PlannerTicket["slot"]) => {
    const dragSource = dragSourceRef.current;
    if (!dragSource) return;

    // Time-frame restriction: a ticket fixed to AM or PM can only move between
    // technicians within that same slot. Only ANYTIME tickets can change slots.
    if (
      dragSource.slot !== slot &&
      dragSource.slot !== "ANYTIME"
    ) {
      alert(
        `This ticket is scheduled for the ${dragSource.slot} time slot and can only be reassigned to another technician in ${dragSource.slot}. To change the time slot, update the ticket's schedule first.`
      );
      dragSourceRef.current = null;
      return;
    }

    // Get old technician name for logging
    const oldTechnician = dragSource.technician;
    const technicianChanged = oldTechnician !== technician;
    const slotChanged = dragSource.slot !== slot;

    // Optimistically update the planner display immediately.
    setPlannerTickets((current) => current.map((ticket) => {
      if (ticket.ticketNo !== dragSource.ticketNo) return ticket;
      return { ...ticket, technician, slot, scheduleTime: SLOT_TIMES[slot] };
    }));

    // Maintain the per-cell manual order: drop the ticket out of the
    // source cell and append it at the bottom of the destination cell
    // so its position stays predictable. The user can reorder from
    // there.
    if (technicianChanged || slotChanged) {
      const srcKey = slotOrderKey(plannerDate, dragSource.technician, dragSource.slot);
      const dstKey = slotOrderKey(plannerDate, technician, slot);
      setSlotOrder((prev) => {
        const next = { ...prev };
        if (next[srcKey]) {
          next[srcKey] = next[srcKey].filter((n) => n !== dragSource.ticketNo);
        }
        const dstList = next[dstKey] ?? [];
        if (!dstList.includes(dragSource.ticketNo)) {
          next[dstKey] = [...dstList, dragSource.ticketNo];
        }
        return next;
      });
    }

    // Persist the assignment change to Supabase (audit trigger records who/when).
    if (technicianChanged || slotChanged) {
      try {
        await updateTicketAssignment(dragSource.ticketNo, {
          technician,
          timeSlot: slot,
        });
        window.dispatchEvent(new CustomEvent("ticket-data-updated", {
          detail: { ticketNo: dragSource.ticketNo },
        }));
      } catch (err) {
        console.error("Failed to persist assignment change:", err);
        alert(`Failed to save assignment: ${err instanceof Error ? err.message : "Unknown error"}`);
        // Reload from Supabase to revert the optimistic change.
        try {
          const rows = (await getCompanyTickets()) as unknown as TicketRecord[];
          setPlannerTickets(createPlannerTickets(rows));
        } catch { /* ignore */ }
        dragSourceRef.current = null;
        return;
      }
    }

    // Add to changed tickets log
    setChangedTickets((current) => [
      {
        type: technicianChanged ? "Technician Reassignment" : "Time Slot Change",
        ticketNum: dragSource.ticketNo,
        scheduleDate: plannerDate,
        newTimeSlot: slot,
        previousTimeSlot: dragSource.slot,
        technician,
        timestamp: new Date().toLocaleTimeString(),
      },
      ...current,
    ]);

    dragSourceRef.current = null;
  };

  const selectedMarker = visibleTickets[selectedMarkerIndex] ?? null;

  const currentLocationLabel = location || "Select a location";

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" /> Back to Tickets
        </Link>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
          <p className="text-sm text-muted-foreground">{sub.description}</p>
        </div>
      </div>

      <div className="work-planner-container">
        <div className="work-planner-controls">
          <div className="work-planner-header">
            <div className="control-group">
              <label className="control-label" htmlFor="locationSelect">Location</label>
              <div className="control-select-wrap">
                <select id="locationSelect" className="control-select" value={location} onChange={(event) => setLocation(event.target.value)}>
                  <option value="" disabled>Select location</option>
                  {locationChoices.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <ChevronDown className="control-select-chevron h-3.5 w-3.5" />
              </div>
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="scheduleDateInput">Date</label>
              <div className="schedule-date-control">
                <button className="schedule-date-arrow" type="button" aria-label="Previous date" onClick={() => setPlannerDate((current) => shiftDate(current, -1))}>❮</button>
                <input id="scheduleDateInput" className="control-input" type="date" value={plannerDate} onChange={(event) => setPlannerDate(event.target.value)} />
                <button className="schedule-date-arrow" type="button" aria-label="Next date" onClick={() => setPlannerDate((current) => shiftDate(current, 1))}>❯</button>
              </div>
            </div>

            <div className="control-group control-checkbox-group">
              <label className="checkbox-group">
                <input type="checkbox" checked={showRescheduled} onChange={(event) => setShowRescheduled(event.target.checked)} />
                <span>Show rescheduled visit</span>
              </label>
            </div>
          </div>
        </div>

        <div className="status-legend">
          <div className="legend-title">Overall Status: Repair Status (customizable in Admin &gt; Repair Statuses)</div>
          <div className="legend-items">
            {STATUS_LEGEND.map((item) => (
              <div key={item.label} className="legend-item">
                <div className={`legend-color ${item.className}`} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tech-schedule" id="techSchedule">
          {selectedTechRoster.length === 0 ? (
            <div className="no-records">No technicians available for {currentLocationLabel}.</div>
          ) : (
            groupedTickets.map(({ tech, slots }, techIndex) => (
              <div key={tech} className="tech-column">
                <div className="tech-header">
                  {tech} <span className="tech-header-count">({slots.flat().length})</span>
                </div>
                <div className="time-slot-grid">
                {TIME_SLOTS.map((slot, slotIndex) => {
                  const tickets = slots[slotIndex] || [];
                  const cellKey = slotOrderKey(plannerDate, tech, slot);
                  return (
                    <div
                      key={`${tech}-${slot}`}
                      className="time-slot"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop(tech, slot)}
                    >
                      <div className="time-slot-label">{slot}</div>
                      {tickets.length === 0 ? (
                        <div className="time-slot-empty">Drop tickets here</div>
                      ) : (
                        tickets.map((ticket, index) => {
                          // Get full ticket with visits from centralized system
                          const fullTicket = getTicketByNumber(ticket.ticketNo);
                          const latestVisit = fullTicket?.visits?.[0];
                          const displayStatus = latestVisit?.repairStatus || ticket.status || "Pending";

                          return (
                            <div
                              key={ticket.ticketNo}
                              className={`work-order-card ${getToneClass(ticket, techIndex + index)}`}
                              draggable
                              onDragStart={(event) => {
                                // Track both transfers: cross-cell move (handleDragStart)
                                // AND in-cell reorder (reorderDragRef).
                                handleDragStart(ticket.ticketNo, ticket.slot, ticket.technician);
                                reorderDragRef.current = { ticketNo: ticket.ticketNo, cellKey };
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onDragOver={(event) => {
                                // Only intercept reorder when the drag started in
                                // the same cell. Otherwise let the parent .time-slot
                                // handle the cross-cell drop.
                                if (reorderDragRef.current?.cellKey === cellKey) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  event.dataTransfer.dropEffect = "move";
                                }
                              }}
                              onDrop={(event) => {
                                const src = reorderDragRef.current;
                                if (!src || src.cellKey !== cellKey) return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (src.ticketNo === ticket.ticketNo) {
                                  reorderDragRef.current = null;
                                  return;
                                }
                                // Build a new order: full current order, then
                                // remove src, then insert before this ticket.
                                const currentList = tickets.map((t) => t.ticketNo);
                                const without = currentList.filter((n) => n !== src.ticketNo);
                                const dropIndex = without.indexOf(ticket.ticketNo);
                                const next = [
                                  ...without.slice(0, dropIndex),
                                  src.ticketNo,
                                  ...without.slice(dropIndex),
                                ];
                                setSlotOrder((prev) => ({ ...prev, [cellKey]: next }));
                                reorderDragRef.current = null;
                                // Suppress the cross-cell handler that will
                                // also fire on the parent.
                                dragSourceRef.current = null;
                              }}
                              onClick={() => setSelectedTicket(ticket)}
                              title="Drag to reorder within this slot, or to a different slot/technician"
                            >
                              <a
                                className="work-order-ticket"
                                href={`/ticket/${encodeURIComponent(ticket.ticketNo)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {ticket.ticketNo}
                              </a>
                              <div className="work-order-customer">{ticket.customer}</div>
                              <div className="work-order-address">{shortAddress(ticket)}</div>
                              <div className="work-order-status">
                                <span className={`work-order-status-dot ${getToneClass(ticket, index)}`} />
                                {displayStatus}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="map-section">
          <div className="map-section-title">Assigned Locations Map</div>
          <div className="map-shell">
            {mapProvider === "google" && (
              <div className="map-type-toggle">
                <button className={`map-type-btn ${mapMode === "map" ? "active" : ""}`} type="button" onClick={() => setMapMode("map")}>Map</button>
                <button className={`map-type-btn ${mapMode === "satellite" ? "active" : ""}`} type="button" onClick={() => setMapMode("satellite")}>Satellite</button>
              </div>
            )}
            <div className="pin-navigator">
              <button className="pin-nav-btn" type="button" title="Previous pin" onClick={() => setSelectedMarkerIndex((current) => (visibleTickets.length ? (current - 1 + visibleTickets.length) % visibleTickets.length : 0))}>❮</button>
              <span className="pin-nav-info">{visibleTickets.length ? `${selectedMarkerIndex + 1} / ${visibleTickets.length}` : "—"}</span>
              <button className="pin-nav-btn" type="button" title="Next pin" onClick={() => setSelectedMarkerIndex((current) => (visibleTickets.length ? (current + 1) % visibleTickets.length : 0))}>❯</button>
            </div>
            {mapProvider === "leaflet" ? (
              <div ref={leafletContainerRef} className="google-map-canvas" aria-label="Map" />
            ) : (
              <div ref={mapContainerRef} className="google-map-canvas" aria-label="Map" />
            )}
            {!mapReady && (
              <div className="map-placeholder-inner">
                <MapPin className="map-placeholder-icon h-16 w-16 text-slate-600" />
                <div className="text-sm text-slate-500">Loading map...</div>
                {mapError ? <div className="text-xs text-rose-300 mt-2">{mapError}</div> : null}
              </div>
            )}
            <div className="legend-for-map" id="mapLegend">
              {selectedTechRoster.slice(0, 5).map((tech, index) => (
                <div key={tech} className="legend-for-map-item">
                    <span className={`legend-color-dot tone-tech-${index % 6}`} />
                  <span>{tech}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="summary-section">
          <div className="section-title">Technicians</div>
          <table className="summary-table">
            <thead>
              <tr>
                <th>Color</th>
                <th>Tech Name</th>
                <th>Ready</th>
                <th>Pend.</th>
                <th>Comp.</th>
              </tr>
            </thead>
            <tbody>
              {techSummary.length === 0 ? (
                <tr><td colSpan={5} className="no-records">No technician summary available.</td></tr>
              ) : techSummary.map((entry) => (
                <tr key={entry.tech}>
                  <td><span className={`legend-color-dot ${entry.color}`} /></td>
                  <td>{entry.tech}</td>
                  <td>{entry.ready}</td>
                  <td>{entry.pending}</td>
                  <td>{entry.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="summary-section unverified-section">
          <div className="section-title">Unverified Address</div>
          <table className="unverified-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ticket No</th>
                <th>Type</th>
                <th>Tech</th>
              </tr>
            </thead>
            <tbody>
              {unverifiedTickets.length === 0 ? (
                <tr><td colSpan={4} className="no-records">No unverified addresses</td></tr>
              ) : unverifiedTickets.map((ticket, index) => (
                <tr key={`${ticket.ticketNo}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{ticket.ticketNo}</td>
                  <td>{ticket.type}</td>
                  <td>{ticket.technician}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="summary-section">
          <div className="section-title">Changed Tickets</div>
          <table className="changed-tickets-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Ticket No</th>
                <th>Schedule Date</th>
                <th>Time Slot</th>
                <th>Technician</th>
              </tr>
            </thead>
            <tbody>
              {changedTickets.length === 0 ? (
                <tr><td colSpan={5} className="no-records">0 records found</td></tr>
              ) : changedTickets.map((change) => (
                <tr key={`${change.ticketNum}-${change.timestamp}`}>
                  <td>{change.type}</td>
                  <td>{change.ticketNum}</td>
                  <td>{change.scheduleDate}</td>
                  <td>{change.previousTimeSlot} → {change.newTimeSlot}</td>
                  <td>{change.technician}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`detail-overlay ${selectedTicket ? "open" : ""}`}>
        <div className="detail-modal">
          <div className="detail-modal-header">
            <div className="detail-title-row">
              <a className="detail-ticket-no detail-ticket-link" href={`/ticket/${encodeURIComponent(selectedTicket?.ticketNo || "")}`} target="_blank" rel="noopener noreferrer">
                {selectedTicket?.ticketNo || "Ticket details"}
              </a>
              <button className="google-btn" type="button" onClick={() => selectedTicket && window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedTicket.address || selectedTicket.city || selectedTicket.location || "")}`, "_blank", "noopener,noreferrer")}>Google Maps</button>
            </div>
            <button className="modal-close-btn" type="button" aria-label="Close" onClick={() => setSelectedTicket(null)}><X className="h-5 w-5" /></button>
          </div>
          <div className="detail-body">
            {selectedTicket ? (
              <>
                <div className="detail-row">
                  <div className="detail-field grow"><div className="detail-label">Customer</div><div className="detail-value">{selectedTicket.customer || "Unknown"}</div></div>
                  <div className="detail-field"><div className="detail-label">Technician</div><div className="detail-value">{selectedTicket.technician || "Unassigned"}</div></div>
                  <div className="detail-field">
                    <div className="detail-label">Repair Status</div>
                    <div className="detail-value">
                      <span className={`status-pill-detail tone-tech-0`}>
                        {(() => {
                          // Get full ticket data with visits from centralized system
                          const fullTicket = getTicketByNumber(selectedTicket.ticketNo);
                          // Get latest visit's repair status if available
                          const latestVisit = fullTicket?.visits?.[0]; // Assumes visits are sorted by date (newest first)
                          const repairStatus = latestVisit?.repairStatus || selectedTicket.status || "Open";
                          return repairStatus;
                        })()}
                      </span>
                    </div>
                  </div>
                </div>
                <hr className="detail-divider" />
                <div className="detail-row">
                  <div className="detail-field grow"><div className="detail-label">Address</div><div className="detail-value">{selectedTicket.address || selectedTicket.city || selectedTicket.location || "-"}</div></div>
                  <div className="detail-field"><div className="detail-label">Schedule</div><div className="detail-value"><span className="schedule-box"><CalendarDays className="h-4 w-4" /><span>{selectedTicket.schedule || plannerDate}</span></span></div></div>
                </div>
                <div className="detail-row"><div className="detail-field grow"><div className="detail-label">Contact</div><div className="detail-value">{selectedTicket.phone || "-"}</div></div></div>
              </>
            ) : (
              <div className="text-sm text-slate-300">Select a ticket to view its details.</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}