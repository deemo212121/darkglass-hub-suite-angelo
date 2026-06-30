import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { CalendarDays, ChevronLeft, ChevronDown, MapPin, X } from "lucide-react";
import { WORK_MAP_LOCATIONS, mergeLocationOptions, normalizeLocationName, TECHNICIANS_BY_LOCATION } from "@/lib/locations";
import { getTicketByNumber, type Ticket } from "@/lib/ticketData";
import { getCompanyTickets, getCsrVisitDatesByTicketIds, getLatestVisitTechnicianByTicketIds } from "@/lib/supabase/tickets";
import { getLocations as sbGetLocations } from "@/lib/supabase/locationManagement";
import { getLocationManagementZoomAddress, getLocationManagementCoordinates } from "@/components/LocationManagementPage";
import { useAuth } from "@/lib/auth";

type ColorMode = "status" | "tech";
type SidebarTab = "tickets" | "status";

type TicketRecord = Record<string, any>;

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

const STATUS_OPTIONS = [
  "CL-Need Cancel",
  "CL-Parts Back Ordered",
  "CSR-Acknowledged",
  "CSR-Assigned to ASC",
  "CSR-Left Message for Cx",
  "CSR-Needs Scheduling",
  "OP-Reschedule Follow up",
  "OP-Waiting for Part",
  "PT-Need PreAuthorization",
  "TR-Need PO",
  "TR-Need Triage",
] as const;

interface LocationTickets {
  location: string;
  count: number;
  records: TicketRecord[];
  priority: "high" | "medium" | "low";
}

function derivePriority(records: TicketRecord[]): "high" | "medium" | "low" {
  const highPriority = records.filter((record) => String(record.priority || "").toLowerCase() === "high").length;
  if (highPriority > 0) return "high";
  if (records.length > 3) return "medium";
  return "low";
}

function deriveStatusGroup(status: string) {
  const value = String(status || "").toLowerCase();
  if (value.includes("complet") || value.includes("closed") || value === "comp") return "comp";
  if (value.startsWith("cl-")) return "cl-need";
  if (value.includes("ready")) return "ready";
  return "op";
}

// Map a repair status to a marker color so an Unassigned ticket still
// reads visually (it shouldn't fall back to the generic technician palette
// since it has no technician). Mirrors the palette used elsewhere in the
// app (Ticket List status palette).
function statusMarkerColor(status: string): string {
  const v = String(status || "").trim().toLowerCase();
  if (v === "pt-need preauthorization") return "#ea580c";
  if (v === "cl-ready to complete") return "#ef4444";
  if (v === "op-ready for service") return "#3b82f6";
  if (v === "csr-left message for cx") return "#10b981";
  if (v === "op-waiting for part") return "#facc15";
  if (v === "csr-assigned to asc") return "#94a3b8";
  if (v === "cl-parts back ordered") return "#94a3b8";
  if (v === "tr-need triage") return "#64748b";
  if (v === "cl-need cancel") return "#fb923c";
  if (v === "op-reschedule follow up") return "#ec4899";
  if (v === "csr-acknowledged") return "#fb7185";
  return "#60a5fa";
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

function getToneClass(mode: ColorMode, ticket: TicketRecord, index: number) {
  if (mode === "tech") return `tone-tech-${index % 6}`;
  const status = String(ticket.status || "").toLowerCase();
  if (status.includes("closed") || status.includes("comp")) return "tone-comp";
  if (status.startsWith("cl-") || status.includes("part")) return "tone-cl-need";
  if (status.includes("ready")) return "tone-ready";
  return "tone-op";
}

function getStatusDotClass(status: "ready" | "op" | "clNeed" | "comp") {
  return `status-dot status-dot-${status}`;
}

export function TicketsMapWorkMap({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("status");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("tickets");
  const [mapMode, setMapMode] = useState<"map" | "satellite">("map");
  const [mapDate, setMapDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Work Map can either bucket per single day (mapDate === ticketDate) or
  // across a window starting at mapDate. Dispatch uses the week view to
  // sched ahead — a ticket scheduled later in the week should still surface
  // when the start of the week is selected.
  const [dateRangeMode, setDateRangeMode] = useState<"day" | "week" | "custom">("day");
  const [mapDateEnd, setMapDateEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  // When true (default), show tickets scheduled for any day within the
  // selected window as faded "other day" pins. Mirrors the ER work map
  // "Tickets on Other Days" toggle. When false, only tickets scheduled
  // exactly on the selected date appear at all.
  const [showOtherDayTickets, setShowOtherDayTickets] = useState(true);
  const [ready, setReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [selectedTechnicians, setSelectedTechnicians] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<"technician" | "status">("technician");
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);
  // Holds the Google Maps InfoWindow + the React-managed DOM node it
  // renders inside, so the detail card can stay anchored to the ticket's
  // pin while the user pans/zooms the map.
  const infoWindowRef = useRef<any>(null);
  const infoContentRef = useRef<HTMLDivElement | null>(null);
  // Re-render trigger so the portal mounts on the first selection (when
  // infoContentRef has just been created).
  const [infoHostReady, setInfoHostReady] = useState(false);
  const { ready: authReady, allowedLocations } = useAuth();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);

  // Load tickets from Supabase (company-scoped via RLS), gated on auth ready.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = (await getCompanyTickets()) as unknown as TicketRecord[];
        if (!cancelled) {
          // Work-plan location restriction: hide tickets outside allowed locations.
          const scoped = allowedLocations === null
            ? rows
            : rows.filter((t: any) => allowedLocations.includes(normalizeLocationName(t.location || t.customer_city || t.city || "")));

          // Attach the full set of CSR-added visit dates to each ticket
          // WITHOUT overwriting the SP schedule_date. The per-day filter
          // surfaces a ticket on a given day when either:
          //   • the SP date equals that day, OR
          //   • the CSR has visit-logged a RESCHEDULE / OSR entry for
          //     that day.
          // This mirrors the dispatch rule "a Jul-3 SP ticket only shows
          // on Jul 1 if a CSR added it for Jul 1".
          //
          // We also overlay the latest visit-recorded technician onto
          // tickets whose `technician` is blank. Plenty of tickets in
          // production are auto-imported from ServicePower without a
          // tech name, but the CSR records the actual assignment in a
          // visit row. Without this overlay the Work Map renders those
          // as "Unassigned" (UN1..UNn) while the daily-schedule planner
          // attributes them correctly to e.g. Jordan Koetsier.
          try {
            const ids = scoped
              .map((t: any) => String(t?._id ?? "").trim())
              .filter(Boolean);
            const [csrMap, techMap] = await Promise.all([
              getCsrVisitDatesByTicketIds(ids),
              getLatestVisitTechnicianByTicketIds(ids),
            ]);
            for (const t of scoped as any[]) {
              const tid = String(t?._id ?? "").trim();
              const dates = tid ? csrMap.get(tid) : undefined;
              t.csrVisitDates = dates ? Array.from(dates) : [];

              const currentTech = String(
                (t.technician ?? t.technician_name ?? "") as string,
              ).trim();
              if (!currentTech || currentTech.toLowerCase() === "unassigned") {
                const visitTech = tid ? techMap.get(tid) : "";
                if (visitTech) {
                  t.technician = visitTech;
                }
              }
            }
          } catch (visitErr) {
            console.warn("Work Map: visit date overlay skipped", visitErr);
          }

          setTickets(scoped);
          setReady(true);
        }
      } catch (err) {
        console.error("Work Map: failed to load tickets:", err);
        if (!cancelled) {
          setTickets([]);
          setReady(true);
        }
      }
    };
    if (authReady) load();
    return () => { cancelled = true; };
  }, [authReady, allowedLocations]);

  // Hydrate the location cache (localStorage) from Supabase so the office pin
  // can use saved coordinates/addresses even if the Location Management page
  // wasn't opened this session.
  useEffect(() => {
    if (!authReady) return;
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
        console.error("Work Map: failed to load locations:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady]);

  useEffect(() => {
    let cancelled = false;

    const initializeMap = () => {
      if (cancelled || !mapContainerRef.current || !ready) return;
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
    };

    // If data isn't ready yet, wait
    if (!ready) return;

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-maps="work-map"]');
    if ((window as Window & { google?: any }).google?.maps) {
      initializeMap();
      return () => {
        cancelled = true;
      };
    }

    if (existingScript) {
      existingScript.addEventListener("load", initializeMap, { once: true });
      existingScript.addEventListener("error", () => {
        if (!cancelled) setMapError("Google Maps failed to load.");
      }, { once: true });
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", initializeMap);
      };
    }

    const script = document.createElement("script");
    script.dataset.googleMaps = "work-map";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.52`;
    script.onload = initializeMap;
    script.onerror = () => {
      if (!cancelled) setMapError("Google Maps failed to load.");
    };
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [ready]); // Add ready as dependency

  const locationData = useMemo<LocationTickets[]>(() => {
    const locationMap = new Map<string, TicketRecord[]>();
    tickets.forEach((ticket) => {
      const location = normalizeLocationName(ticket.location || ticket.customer_city || ticket.city || "Richmond, VA");
      if (!locationMap.has(location)) locationMap.set(location, []);
      locationMap.get(location)!.push(ticket);
    });

    const liveLocations = Array.from(locationMap.entries()).map(([location, records]) => ({ location, count: records.length, records, priority: derivePriority(records) }));
    const merged = new Map<string, LocationTickets>();

    WORK_MAP_LOCATIONS.forEach((location) => {
      merged.set(location, { location, count: 0, records: [], priority: "low" });
    });

    liveLocations.forEach((entry) => {
      merged.set(entry.location, entry);
    });

    return mergeLocationOptions(WORK_MAP_LOCATIONS, liveLocations.map((entry) => entry.location)).map((location) => merged.get(location) ?? { location, count: 0, records: [], priority: "low" });
  }, [tickets]);

  useEffect(() => {
    if (!selectedLocation && locationData.length > 0) {
      setSelectedLocation(locationData.find((location) => location.count > 0)?.location ?? locationData[0].location);
    }
  }, [locationData, selectedLocation]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;

    mapRef.current.setMapTypeId(mapMode === "satellite" ? maps.MapTypeId.SATELLITE : maps.MapTypeId.ROADMAP);
  }, [mapMode, mapReady]);

  const visibleTickets = useMemo(() => {
    const filtered = selectedLocation
      ? tickets.filter((ticket) => normalizeLocationName(ticket.location || ticket.customer_city || ticket.city || "Richmond, VA") === selectedLocation)
      : tickets;

    // What counts as "pending" — i.e. work that hasn't been closed out.
    // Everything except the explicit terminal statuses (completed, claimed,
    // cancelled, data closed). Blank status counts as pending so dispatch
    // can still see new work.
    const isPendingStatus = (status: unknown) => {
      const v = String(status || "").toLowerCase().trim();
      if (!v) return true;
      if (
        v === "cl-completed" || v === "completed" ||
        v === "cl-claimed" || v === "claimed" ||
        v === "cl-cancelled" || /\bcancell?ed\b/.test(v) ||
        v.includes("data closed") || v.includes("data-closed")
      ) return false;
      return true;
    };

    // For the selected day surface:
    //   • every ticket scheduled FOR that day, AND
    //   • every pending ticket without a schedule date — so dispatch can see
    //     what's waiting and slot it onto a tech's route.
    // Resolve the inclusive [rangeStart, rangeEnd] window the map keeps
    // pins for. Route lines only connect tickets that fall on `mapDate`
    // exactly — the wider window just keeps off-day pins visible as
    // muted context (matching dispatch's ER work-map UX).
    //
    //   - Day mode:    pick day → window = the same week (mapDate - 3 to
    //                  mapDate + 3). Off-day pins muted, no route line.
    //   - Week mode:   pick day → window = mapDate to mapDate + 6.
    //   - Custom mode: user picks both ends.
    const rangeStart = mapDate;
    let rangeEnd = mapDate;
    let rangeStartActual = mapDate;
    if (dateRangeMode === "week") {
      try {
        const start = new Date(mapDate + "T00:00:00");
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        rangeEnd = end.toISOString().slice(0, 10);
        rangeStartActual = rangeStart;
      } catch { rangeEnd = mapDate; rangeStartActual = rangeStart; }
    } else if (dateRangeMode === "custom") {
      rangeEnd = mapDateEnd && mapDateEnd >= mapDate ? mapDateEnd : mapDate;
      rangeStartActual = rangeStart;
    } else {
      // Day mode: keep a ±3-day cushion around the picked day so the
      // map still surfaces this-week tickets as faded pins (no route).
      try {
        const start = new Date(mapDate + "T00:00:00");
        const earlier = new Date(start);
        earlier.setDate(start.getDate() - 3);
        const later = new Date(start);
        later.setDate(start.getDate() + 3);
        rangeStartActual = earlier.toISOString().slice(0, 10);
        rangeEnd = later.toISOString().slice(0, 10);
      } catch {
        rangeStartActual = rangeStart;
        rangeEnd = rangeStart;
      }
    }

    const dateFiltered = filtered.filter((ticket) => {
      const ticketDate = String(ticket.schedule || ticket.schedule_date || "").slice(0, 10);
      const csrDates: string[] = Array.isArray((ticket as any).csrVisitDates)
        ? (ticket as any).csrVisitDates
        : [];

      // No SP date and no CSR-added dates → it's an unscheduled-but-
      // pending ticket. Keep the legacy behavior of surfacing it so
      // dispatch can slot it onto a route.
      if (!ticketDate && csrDates.length === 0) {
        return isPendingStatus(ticket.status);
      }

      const matchesExact = (d: string) => Boolean(d) && d === mapDate;
      const inWindow = (d: string) =>
        Boolean(d) && d >= rangeStartActual && d <= rangeEnd;

      const sourceDates = [ticketDate, ...csrDates].filter(Boolean);
      // The toggle hides off-day pins when the user explicitly opts
      // out. The default keeps them as muted context so dispatch still
      // sees what else is in the week.
      if (!showOtherDayTickets) {
        return sourceDates.some(matchesExact);
      }
      return sourceDates.some(inWindow);
    });

    // Apply filters based on current filter mode
    if (filterMode === "technician") {
      // Filter by technician visibility
      // selectedTechnicians contains the HIDDEN technicians (unchecked)
      if (selectedTechnicians.size > 0) {
        return dateFiltered.filter((ticket) => {
          const techName = ticket.technician_name || ticket.technician || "Unassigned";
          return !selectedTechnicians.has(techName);
        });
      }
    } else {
      // Filter by status visibility
      // selectedStatuses contains the HIDDEN statuses (unchecked)
      if (selectedStatuses.size > 0) {
        return dateFiltered.filter((ticket) => {
          const status = ticket.status || "";
          return !selectedStatuses.has(status);
        });
      }
    }

    // If no filters are applied, show all tickets
    return dateFiltered;
  }, [tickets, selectedLocation, mapDate, mapDateEnd, dateRangeMode, showOtherDayTickets, selectedTechnicians, selectedStatuses, filterMode]);

  // Get all technicians for the selected location (not just those with scheduled tickets)
  const uniqueTechnicians = useMemo(() => {
    // First, get technicians from the selected location's roster
    const locationTechs = selectedLocation ? (TECHNICIANS_BY_LOCATION[selectedLocation] || []) : [];
    
    // Also include any technicians that have tickets scheduled (in case they're not in the roster)
    const ticketTechs = visibleTickets.map(t => t.technician_name || t.technician).filter(Boolean);
    
    // Combine and deduplicate, prioritizing roster order
    const combined = [...locationTechs, ...ticketTechs];
    return Array.from(new Set(combined)).filter(tech => tech !== "Unassigned");
  }, [selectedLocation, visibleTickets]);

  // Helper to get technician color
  const getTechColor = (techName: string) => {
    const techColors = [
      "#3B82F6", // Blue
      "#10B981", // Green
      "#F59E0B", // Amber
      "#EF4444", // Red
      "#8B5CF6", // Purple
      "#EC4899", // Pink
    ];
    const techIndex = uniqueTechnicians.indexOf(techName);
    return techColors[techIndex % techColors.length];
  };

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    polylinesRef.current.forEach((line) => line.setMap(null));
    polylinesRef.current = [];

    const geocoder = new maps.Geocoder();
    const geocode = (address: string) => new Promise<any | null>((resolve) => {
      geocoder.geocode({ address }, (results: any, status: string) => {
        if (status === "OK" && results?.[0]) {
          resolve(results[0].geometry.location);
          return;
        }
        resolve(null);
      });
    });

    // Resolve an office location's position: prefer explicit Location Management
    // coordinates, otherwise geocode the saved office address.
    const geocodeOfficeLocation = (loc: string): Promise<{ lat: number; lng: number } | null> => {
      const coords = getLocationManagementCoordinates(loc);
      if (coords) return Promise.resolve(coords);
      return geocode(getLocationManagementZoomAddress(loc)).then((pos) =>
        pos ? { lat: pos.lat(), lng: pos.lng() } : null,
      );
    };

    let cancelled = false;

    // Ordered geocoded stops per technician, for drawing route lines.
    const routePointsByTech = new Map<string, Array<{ order: number; position: any }>>();

    const ticketPositions = visibleTickets.map(async (ticket) => {
      const directLat = typeof ticket.lat === "number" ? ticket.lat : typeof ticket.latitude === "number" ? ticket.latitude : null;
      const directLng = typeof ticket.lng === "number" ? ticket.lng : typeof ticket.longitude === "number" ? ticket.longitude : null;
      if (directLat != null && directLng != null) {
        return { ticket, position: { lat: directLat, lng: directLng } };
      }

      // Build the best geocode query from the ticket's real fields.
      const streetAddr = ticket.address || ticket.customer_address || "";
      const cityName = ticket.city || ticket.customer_city || "";
      const stateName = ticket.state || ticket.customer_state || "";
      const zipCode = ticket.zip || ticket.customer_zip || "";

      const parts: string[] = [];
      if (streetAddr) parts.push(streetAddr);
      const cityStateZip = [cityName, [stateName, zipCode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      if (cityStateZip) parts.push(cityStateZip);
      const fullQuery = parts.join(", ").trim() || zipCode || ticket.location || "";
      if (!fullQuery) return { ticket, position: null };

      return { ticket, position: await geocode(fullQuery) };
    });

    Promise.all(ticketPositions).then((results) => {
      if (cancelled || !mapRef.current) return;

      const bounds = new maps.LatLngBounds();

      // Order stops by time slot so route numbering follows the daily schedule.
      const slotRank = (t: any): number => {
        const raw = String(t.slot || t.time_slot || t.timeSlot || "").trim();
        if (!raw) return 9999;
        if (/anytime/i.test(raw)) return 9998;
        const m = raw.match(/(\d{1,2})/);
        return m ? parseInt(m[1], 10) : 9997;
      };
      const orderedResults = [...results].sort((a, b) => slotRank(a.ticket) - slotRank(b.ticket));

      // Identify the "selected date" inside the current window. Only
      // tickets scheduled exactly for this date contribute to the
      // technician route hierarchy (numbered badges + connecting lines).
      // Other-day tickets in the same window render as faded pins with
      // no number and no route line — matching the ER work-map UX.
      // A ticket counts as "on today" when EITHER its SP schedule_date
      // OR any CSR-added Visit Log date equals the selected day.
      const selectedDay = mapDate;
      const isOnSelectedDay = (t: any): boolean => {
        const sp = String(t?.schedule || t?.schedule_date || "").slice(0, 10);
        if (sp && sp === selectedDay) return true;
        const csrDates: string[] = Array.isArray(t?.csrVisitDates) ? t.csrVisitDates : [];
        return csrDates.some((d) => d === selectedDay);
      };

      // Group tickets by technician to determine hierarchy numbers — but
      // only count tickets that belong to the selected day so the
      // numbering reflects today's stops, not the whole window.
      const ticketsByTech = new Map<string, number>();

      orderedResults.forEach(({ ticket, position }, index) => {
        if (!position) return;

        const techName = ticket.technician_name || ticket.technician || "Unassigned";
        const onDay = isOnSelectedDay(ticket);
        const initials = getInitials(techName);
        const markerColor = techName === "Unassigned"
          ? statusMarkerColor(ticket.status)
          : getTechColor(techName);

        let hierarchyNumber = 0;
        let labelText = "";
        let svgMarker: any;

        if (onDay) {
          // Today's stop — numbered badge + route line.
          const currentCount = ticketsByTech.get(techName) || 0;
          hierarchyNumber = currentCount + 1;
          ticketsByTech.set(techName, hierarchyNumber);
          if (!routePointsByTech.has(techName)) routePointsByTech.set(techName, []);
          routePointsByTech.get(techName)!.push({ order: hierarchyNumber, position });

          labelText = `${initials}${hierarchyNumber}`;
          svgMarker = {
            path: "M2 2 L38 2 Q40 2 40 4 L40 16 Q40 18 38 18 L22 18 L20 22 L18 18 L2 18 Q0 18 0 16 L0 4 Q0 2 2 2 Z",
            fillColor: markerColor,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            scale: 1.8,
            anchor: new maps.Point(20, 22),
            labelOrigin: new maps.Point(20, 10),
          };
        } else {
          // Other-day stop in the window — same teardrop badge as today
          // but labeled with just the technician initials (no order
          // number) so it can't be mistaken for part of today's route.
          // Bigger and bolder per dispatch's request — they should be
          // readable from the same zoom level as today's pins.
          labelText = initials;
          svgMarker = {
            path: "M2 2 L38 2 Q40 2 40 4 L40 16 Q40 18 38 18 L22 18 L20 22 L18 18 L2 18 Q0 18 0 16 L0 4 Q0 2 2 2 Z",
            fillColor: markerColor,
            fillOpacity: 0.75,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            strokeOpacity: 0.85,
            scale: 1.5,
            anchor: new maps.Point(20, 22),
            labelOrigin: new maps.Point(20, 10),
          };
        }

        const ticketDateStr = String(ticket.schedule || ticket.schedule_date || "").slice(0, 10);
        const marker = new maps.Marker({
          map: mapRef.current,
          position,
          title:
            `${ticket.ticketNo || ticket.ticket_no || `Ticket ${index + 1}`} - ` +
            `${ticket.customer || ticket.customer_name || 'Unknown'}\n` +
            `${techName}${onDay ? ` - Ticket #${hierarchyNumber}` : " (other day)"}` +
            (ticketDateStr ? `\nScheduled: ${ticketDateStr}` : ""),
          icon: svgMarker,
          label: labelText
            ? {
                text: labelText,
                color: "#ffffff",
                fontSize: onDay ? "13px" : "12px",
                fontWeight: "bold",
              }
            : undefined,
          zIndex: onDay ? 5 : 1,
        });
        (marker as any).__ticketNo = String(ticket.ticketNo || ticket.ticket_no || "").trim();

        marker.addListener("click", () => setSelectedTicket(ticket));
        markersRef.current.push(marker);
        bounds.extend(position);
      });

      // Draw a route line per technician connecting their stops in order
      // (JK1 -> JK2 -> JK3), colored to match the tech's badges. Only
      // tickets scheduled for the selected day participate — other-day
      // stops appear as faded pins without a line.
      routePointsByTech.forEach((points, techName) => {
        if (points.length < 2) return;
        if (techName === "Unassigned") return;
        const ordered = [...points].sort((a, b) => a.order - b.order);
        const line = new maps.Polyline({
          path: ordered.map((p) => p.position),
          geodesic: true,
          strokeColor: getTechColor(techName),
          strokeOpacity: 0.9,
          strokeWeight: 3,
          map: mapRef.current,
          icons: [
            {
              icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.5 },
              offset: "60%",
            },
          ],
        });
        polylinesRef.current.push(line);
      });

      // Pin the OFFICE for the selected branch — dark teardrop pin with 🏢.
      if (selectedLocation) {
        geocodeOfficeLocation(selectedLocation).then((officePos) => {
          if (cancelled || !officePos || !mapRef.current) return;
          const officeMarker = new maps.Marker({
            map: mapRef.current,
            position: officePos,
            title: `${selectedLocation} Office`,
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
        });
      }

      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds);
      } else if (selectedLocation) {
        geocodeOfficeLocation(selectedLocation).then((position) => {
          if (position && mapRef.current) {
            mapRef.current.setCenter(position);
            mapRef.current.setZoom(10);
          }
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mapReady, selectedLocation, visibleTickets]);

  // When the user selects a ticket (marker OR sidebar card), open an
  // anchored InfoWindow at that ticket's pin. The InfoWindow is created
  // lazily on first selection; its content is a div that we populate with
  // the React-rendered detail card via a portal-style move below. As long
  // as the InfoWindow is open it stays glued to the marker — panning or
  // zooming the map keeps the card anchored on the location.
  useEffect(() => {
    if (!selectedTicket || !mapRef.current) return;
    const w = window as any;
    const maps = w.google?.maps;
    if (!maps) return;
    const target = String(selectedTicket.ticketNo || selectedTicket.ticket_no || "").trim();
    if (!target) return;
    const marker = markersRef.current.find((m: any) => m?.__ticketNo === target);
    if (!marker) return;

    // Lazy-create the InfoWindow + its host node.
    if (!infoWindowRef.current) {
      infoContentRef.current = document.createElement("div");
      infoContentRef.current.className = "ahs-ticket-iw-host";
      infoWindowRef.current = new maps.InfoWindow({
        content: infoContentRef.current,
        // Push the card above the marker so it doesn't hide the pin.
        pixelOffset: new maps.Size(0, -8),
        // We want max readable width without pushing the map controls.
        maxWidth: 480,
      });
      // When the user clicks the X on the InfoWindow itself, clear state.
      maps.event.addListener(infoWindowRef.current, "closeclick", () => setSelectedTicket(null));
      // Trigger a render so the portal can mount into the new host node.
      setInfoHostReady(true);
    }

    infoWindowRef.current.open({ map: mapRef.current, anchor: marker });

    // Pan / gentle zoom so the marker is centered next to the bubble.
    const pos = marker.getPosition?.();
    if (pos) {
      mapRef.current.panTo(pos);
      const currentZoom = mapRef.current.getZoom?.() ?? 8;
      if (currentZoom < 12) mapRef.current.setZoom(12);
    }
  }, [selectedTicket]);

  // Close + tear down the InfoWindow when the user dismisses or navigates
  // away.
  useEffect(() => {
    if (!selectedTicket && infoWindowRef.current) {
      infoWindowRef.current.close();
    }
  }, [selectedTicket]);

  const counters = useMemo(() => {
    const source = locationData.find((location) => location.location === selectedLocation)?.records ?? tickets;
    return source.reduce(
      (acc, ticket) => {
        const group = deriveStatusGroup(ticket.status);
        if (group === "ready") acc.ready += 1;
        if (group === "op") acc.op += 1;
        if (group === "cl-need") acc.clNeed += 1;
        if (group === "comp") acc.comp += 1;
        return acc;
      },
      { ready: 0, op: 0, clNeed: 0, comp: 0 },
    );
  }, [locationData, selectedLocation, tickets]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        {!ready ? (
          <div className="flex justify-center items-center h-96">
            <p className="text-gray-500">Loading map...</p>
          </div>
        ) : (
          <div className="map-panel">
            <div className="map-topbar">
              <div className="topbar-location-group">
                <label htmlFor="locationSelect" className="topbar-label">Location</label>
                <select id="locationSelect" aria-label="Location" value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}>
                  <option value="">All Locations</option>
                  {locationData.map((location) => (
                    <option key={location.location} value={location.location}>{location.location}</option>
                  ))}
                </select>
              </div>

              <div className="date-nav">
                <button className="date-nav-btn" type="button" aria-label="Previous day" onClick={() => setMapDate((current) => new Date(new Date(current).getTime() - 86400000).toISOString().slice(0, 10))}>❮</button>
                <input id="mapDate" type="date" aria-label="Date" value={mapDate} onChange={(event) => setMapDate(event.target.value)} />
                <button className="date-nav-btn" type="button" aria-label="Next day" onClick={() => setMapDate((current) => new Date(new Date(current).getTime() + 86400000).toISOString().slice(0, 10))}>❯</button>
                <select
                  aria-label="Date range mode"
                  value={dateRangeMode}
                  onChange={(e) => setDateRangeMode(e.target.value as "day" | "week" | "custom")}
                  className="ml-2 rounded-md bg-slate-900/85 border border-blue-400/55 px-2 py-1 text-xs text-white"
                  title="Day = exactly the picked day. Week = picked day + 6 days. Custom = pick your own end date."
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="custom">Custom</option>
                </select>
                {dateRangeMode === "custom" && (
                  <input
                    type="date"
                    aria-label="End date"
                    value={mapDateEnd}
                    min={mapDate}
                    onChange={(event) => setMapDateEnd(event.target.value)}
                    className="ml-2 rounded-md bg-slate-900/85 border border-blue-400/55 px-2 py-1 text-xs text-white"
                  />
                )}
                <label
                  className="ml-3 inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none"
                  title="Show tickets scheduled on other days in the window as faded pins (no number, no route line)."
                >
                  <input
                    type="checkbox"
                    checked={showOtherDayTickets}
                    onChange={(e) => setShowOtherDayTickets(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Tickets on other days
                </label>
              </div>

              <div className="color-legend">
                <span className="legend-caption">The color of tickets</span>
                <label><input type="radio" name="colorBy" value="status" checked={colorMode === "status"} onChange={() => setColorMode("status")} /> by Status</label>
                <label><input type="radio" name="colorBy" value="tech" checked={colorMode === "tech"} onChange={() => setColorMode("tech")} /> by Tech</label>
              </div>
            </div>

            <div className="map-body">
              <aside className="ticket-sidebar">
                <div className="sidebar-tabs">
                  <button className={`sidebar-tab ${sidebarTab === "status" ? "active" : ""}`} type="button" onClick={() => setSidebarTab("status")}>Status</button>
                  <button className={`sidebar-tab ${sidebarTab === "tickets" ? "active" : ""}`} type="button" onClick={() => setSidebarTab("tickets")}>Tickets</button>
                </div>

                <div className={`status-view ${sidebarTab === "status" ? "visible" : ""}`}>
                  <div className="status-row"><span><span className={getStatusDotClass("ready")} />Ready for Service</span><span>{counters.ready}</span></div>
                  <div className="status-row"><span><span className={getStatusDotClass("op")} />OP - Reschedule</span><span>{counters.op}</span></div>
                  <div className="status-row"><span><span className={getStatusDotClass("clNeed")} />CL - Need Parts</span><span>{counters.clNeed}</span></div>
                  <div className="status-row"><span><span className={getStatusDotClass("comp")} />Completed</span><span>{counters.comp}</span></div>
                </div>

                <div className={`ticket-list ${sidebarTab === "tickets" ? "visible" : ""}`}>
                  {visibleTickets.length === 0 ? (
                    <div className="p-4 text-sm text-slate-400">No tickets for this location/date.</div>
                  ) : (
                    visibleTickets.map((ticket, index) => {
                      const toneClass = getToneClass(colorMode, ticket, index);
                      const selected = selectedTicket?.ticketNo === ticket.ticketNo || selectedTicket?.ticket_no === ticket.ticket_no;
                      const techName = ticket.technician_name || ticket.technician || "Unassigned";
                      const initials = getInitials(techName);
                      const ticketNumber = ticket.ticketNo || ticket.ticket_no || `T-${index + 1}`;
                      const address = ticket.address || ticket.customer_address || ticket.city || ticket.customer_city || ticket.location || "Unknown address";
                      
                      // Card background — by technician when assigned, by
                      // repair status when unassigned, so Unassigned cards
                      // still read by status color.
                      const bgColor = techName === "Unassigned"
                        ? statusMarkerColor(ticket.status)
                        : getTechColor(techName);
                      const cardStyle = { 
                        backgroundColor: `${bgColor}15`, // 15 = ~8% opacity
                        borderLeftColor: bgColor,
                        borderLeftWidth: '4px',
                        borderLeftStyle: 'solid'
                      };
                      
                      return (
                        <button 
                          key={`${ticketNumber}-${index}`} 
                          type="button" 
                          className={`ticket-card ${selected ? "selected" : ""}`} 
                          style={cardStyle}
                          onClick={() => setSelectedTicket(ticket)}
                        >
                          <div className="ticket-card-top">
                            <span className="ticket-card-no">{ticketNumber}</span>
                            <span 
                              className={`tech-badge ${colorMode === "tech" ? "" : toneClass}`}
                              style={colorMode === "tech" ? { backgroundColor: bgColor } : {}}
                              title={techName}
                            >
                              {initials}
                            </span>
                          </div>
                          <span className="ticket-card-addr">{address}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>

              <section className={`map-area ${mapMode === "satellite" ? "satellite-mode" : ""}`}>
                <div className="map-type-toggle">
                  <button className={`map-type-btn ${mapMode === "map" ? "active" : ""}`} type="button" onClick={() => setMapMode("map")}>Map</button>
                  <button className={`map-type-btn ${mapMode === "satellite" ? "active" : ""}`} type="button" onClick={() => setMapMode("satellite")}>Satellite</button>
                </div>

                <div ref={mapContainerRef} className="google-map-canvas" aria-label="Google map" />

                {!mapReady && (
                  <div className="map-placeholder-inner">
                    <MapPin className="map-placeholder-icon h-16 w-16 text-slate-600" />
                    <div className="text-sm text-slate-500">Loading Google Maps...</div>
                    {mapError ? <div className="text-xs text-rose-300 mt-2">{mapError}</div> : null}
                  </div>
                )}

                <div className="selected-day-panel">
                  <div 
                    className="selected-day-header" 
                    onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <span>Selected Day's Tickets</span>
                    <ChevronDown 
                      className="h-4 w-4 transition-transform" 
                      style={{ transform: isPanelCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                    />
                  </div>
                  {!isPanelCollapsed && (
                    <>
                      {/* Filter Mode Tabs */}
                      <div style={{ 
                        display: 'flex', 
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(15, 23, 42, 0.5)'
                      }}>
                        <button
                          onClick={() => setFilterMode("technician")}
                          style={{
                            flex: 1,
                            padding: '0.5rem',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            color: filterMode === "technician" ? '#60a5fa' : '#94a3b8',
                            background: filterMode === "technician" ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                            borderBottom: filterMode === "technician" ? '2px solid #60a5fa' : '2px solid transparent',
                            cursor: 'pointer',
                            border: 'none',
                            transition: 'all 0.2s'
                          }}
                        >
                          By Technician
                        </button>
                        <button
                          onClick={() => setFilterMode("status")}
                          style={{
                            flex: 1,
                            padding: '0.5rem',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            color: filterMode === "status" ? '#60a5fa' : '#94a3b8',
                            background: filterMode === "status" ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                            borderBottom: filterMode === "status" ? '2px solid #60a5fa' : '2px solid transparent',
                            cursor: 'pointer',
                            border: 'none',
                            transition: 'all 0.2s'
                          }}
                        >
                          By Status
                        </button>
                      </div>

                      <div className="selected-day-filters">
                        {filterMode === "technician" ? (
                          // Technician Filter
                          <div style={{ width: '100%' }}>
                            <div style={{ 
                              fontSize: '0.7rem', 
                              fontWeight: '600', 
                              color: '#94a3b8', 
                              marginBottom: '0.5rem', 
                              textTransform: 'uppercase', 
                              letterSpacing: '0.05em' 
                            }}>
                              Filter by Technician
                            </div>
                            {uniqueTechnicians.map((tech) => {
                              const techColor = getTechColor(tech);
                              const isHidden = selectedTechnicians.has(tech);
                              const isChecked = !isHidden;
                              
                              return (
                                <label key={tech} className="filter-chip" style={{ width: '100%', marginBottom: '0.3rem' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const newHidden = new Set(selectedTechnicians);
                                      if (e.target.checked) {
                                        newHidden.delete(tech);
                                      } else {
                                        newHidden.add(tech);
                                      }
                                      setSelectedTechnicians(newHidden);
                                    }}
                                  />
                                  <span 
                                    className="legend-color-dot" 
                                    style={{ 
                                      backgroundColor: techColor,
                                      width: '10px',
                                      height: '10px',
                                      borderRadius: '50%',
                                      display: 'inline-block',
                                      marginRight: '0.3rem'
                                    }}
                                  />
                                  <span style={{ flex: 1 }}>{tech}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          // Status Filter
                          <div style={{ width: '100%' }}>
                            <div style={{ 
                              fontSize: '0.7rem', 
                              fontWeight: '600', 
                              color: '#94a3b8', 
                              marginBottom: '0.5rem', 
                              textTransform: 'uppercase', 
                              letterSpacing: '0.05em',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}>
                              <span>Filter by Status</span>
                              <button
                                onClick={() => {
                                  if (selectedStatuses.size === 0) {
                                    // If all checked, uncheck all
                                    setSelectedStatuses(new Set(STATUS_OPTIONS));
                                  } else {
                                    // If some unchecked, check all
                                    setSelectedStatuses(new Set());
                                  }
                                }}
                                style={{
                                  fontSize: '0.65rem',
                                  padding: '0.2rem 0.4rem',
                                  background: 'rgba(59, 130, 246, 0.2)',
                                  color: '#60a5fa',
                                  border: '1px solid rgba(59, 130, 246, 0.3)',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                {selectedStatuses.size === 0 ? 'Uncheck All' : 'Check All'}
                              </button>
                            </div>
                            {STATUS_OPTIONS.map((status) => {
                              const isHidden = selectedStatuses.has(status);
                              const isChecked = !isHidden;
                              
                              return (
                                <label key={status} className="filter-chip" style={{ width: '100%', marginBottom: '0.3rem' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const newHidden = new Set(selectedStatuses);
                                      if (e.target.checked) {
                                        newHidden.delete(status);
                                      } else {
                                        newHidden.add(status);
                                      }
                                      setSelectedStatuses(newHidden);
                                    }}
                                  />
                                  <span style={{ flex: 1, fontSize: '0.75rem' }}>{status}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Ticket detail card — rendered into the Google Maps InfoWindow via
          a React portal so it stays anchored to the ticket's pin. Pan or
          zoom the map and the card moves with the marker. */}
      {selectedTicket && infoHostReady && infoContentRef.current && createPortal(
        <div className="detail-modal">
          <div className="detail-modal-header">
            <div className="detail-title-row">
              <a 
                className="detail-ticket-no detail-ticket-link" 
                href={selectedTicket ? `/ticket/${selectedTicket.ticketNo || selectedTicket.ticket_no}` : "#"} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                {selectedTicket?.ticketNo || selectedTicket?.ticket_no || "Ticket details"}
              </a>
              <button className="google-btn" type="button" onClick={() => selectedTicket && window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((selectedTicket.address || selectedTicket.customer_address || "") + ", " + (selectedTicket.city || selectedTicket.customer_city || ""))}`, "_blank", "noopener,noreferrer")}>Google Maps</button>
            </div>
            {/* Close button removed — the Google Maps InfoWindow renders
                its own X. Showing two close buttons was confusing. */}
          </div>

          <div className="detail-body">
            {selectedTicket ? (
              (() => {
                // Get full ticket data with visits from centralized system
                const ticketNo = selectedTicket.ticketNo || selectedTicket.ticket_no;
                const fullTicket = ticketNo ? getTicketByNumber(ticketNo) : null;
                const latestVisit = fullTicket?.visits?.[0];
                const displayStatus = latestVisit?.repairStatus || selectedTicket.status || "Open";
                
                return (
                  <>
                    <div className="detail-row">
                      <div className="detail-field grow">
                        <div className="detail-label">Customer</div>
                        <div className="detail-value">{selectedTicket.customer_name || selectedTicket.customer || "Unknown"}</div>
                      </div>
                      <div className="detail-field">
                        <div className="detail-label">Technician</div>
                        <div className="detail-value">{selectedTicket.technician_name || selectedTicket.technician || "Unassigned"}</div>
                      </div>
                      <div className="detail-field">
                        <div className="detail-label">Repair Status</div>
                        <div className="detail-value"><span className={`status-pill-detail ${getToneClass(colorMode, selectedTicket, 0)}`}>{displayStatus}</span></div>
                      </div>
                    </div>

                    <hr className="detail-divider" />

                    <div className="detail-row">
                      <div className="detail-field grow">
                        <div className="detail-label">Address</div>
                        <div className="detail-value">
                          {(() => {
                            const street = selectedTicket.address || selectedTicket.customer_address || "";
                            const city = selectedTicket.city || selectedTicket.customer_city || "";
                            const zip = selectedTicket.zip || "";
                            return street && city
                              ? `${street}, ${city}${zip ? `, ${zip}` : ""}`
                              : selectedTicket.location || "-";
                          })()}
                        </div>
                      </div>
                      <div className="detail-field">
                        <div className="detail-label">Schedule</div>
                        {(() => {
                          // Show the SP-issued schedule date as the primary
                          // value. If the CSR also added one or more visit
                          // dates that include today, surface a small tag
                          // so dispatch knows the ticket is on today's
                          // route via the Visit Log (not the SP date).
                          const tinyTag = (label: string) => (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
                              {label}
                            </span>
                          );
                          const sp = String(
                            selectedTicket.schedule ||
                              selectedTicket.schedule_date ||
                              "",
                          ).trim();
                          const csrDates: string[] = Array.isArray(
                            (selectedTicket as any).csrVisitDates,
                          )
                            ? (selectedTicket as any).csrVisitDates
                            : [];
                          const display = sp || (csrDates[0] ?? mapDate ?? "");
                          // Tag rules:
                          //   - SP date == picked day  → "from ServicePower".
                          //   - CSR booked the picked day (and SP didn't)
                          //                            → "added by CSR".
                          //   - Otherwise plain "from ServicePower" when sp
                          //     exists, else "from Visit Log".
                          let source = "";
                          if (sp && sp === mapDate) {
                            source = "from ServicePower";
                          } else if (csrDates.includes(mapDate)) {
                            source = "added by CSR";
                          } else if (sp) {
                            source = "from ServicePower";
                          } else if (csrDates.length > 0) {
                            source = "from Visit Log";
                          }
                          return (
                            <div className="detail-value">
                              <span className="schedule-box">
                                <CalendarDays className="h-4 w-4" />
                                <span>{display}</span>
                              </span>
                              {source && tinyTag(source)}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="detail-row">
                      <div className="detail-field grow">
                        <div className="detail-label">Problem</div>
                        <div className="detail-value">{selectedTicket.problem_description || selectedTicket.note || "No additional notes."}</div>
                      </div>
                    </div>

                    <hr className="detail-divider" />

                    <div className="detail-row">
                      <div className="detail-field grow">
                        <div className="detail-label">Contact</div>
                        <div className="detail-value">{selectedTicket.customer_cell_phone_1 || selectedTicket.phone || "-"}</div>
                        <div className="contact-actions">
                          <button className="contact-btn" type="button">Call</button>
                          <button className="contact-btn" type="button">Text</button>
                          <button className="contact-btn" type="button">Email</button>
                        </div>
                      </div>
                    </div>

                    <hr className="detail-divider" />

                    <div className="detail-row">
                      <div className="detail-field grow">
                        <div className="detail-label">Internal Note</div>
                        <div className="internal-note-box">{selectedTicket.internal_note || selectedTicket.problem_description || "No internal note available."}</div>
                      </div>
                    </div>
                  </>
                );
              })()
            ) : (
              <div className="text-sm text-slate-300">Select a ticket to view its details.</div>
            )}
          </div>
        </div>,
        infoContentRef.current,
      )}

      <style>{`
        .map-panel { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; overflow: hidden; color: #fff; backdrop-filter: blur(10px); display: flex; flex-direction: column; }
        .map-topbar { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 0.65rem 1rem; background: rgba(17,24,39,0.75); border-bottom: 1px solid rgba(255,255,255,0.12); flex-wrap: wrap; position: relative; }
        .date-nav { display: flex; align-items: center; gap: 0.55rem; }
        .date-nav-btn { width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(96,165,250,0.5); background: transparent; color: #60a5fa; font-size: 1.05rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        #mapDate { background: rgba(15,23,42,0.85); border: 1.5px solid rgba(96,165,250,0.55); border-radius: 6px; color: #e2e8f0; font-size: 0.9rem; font-weight: 600; cursor: pointer; text-align: center; padding: 0.32rem 0.65rem; min-width: 130px; outline: none; }
        .topbar-label, .legend-caption { color: #94a3b8; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
        .legend-caption { font-size: 0.82rem; }
        .color-legend { display: flex; align-items: center; gap: 0.75rem; font-size: 0.85rem; position: absolute; right: 1rem; }
        .color-legend label { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; color: #cbd5e1; }
        .map-body { display: flex; flex: 1; position: relative; min-height: 620px; }
        .ticket-sidebar { width: 230px; min-width: 200px; background: rgba(15,23,42,0.96); border-right: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; z-index: 10; }
        .sidebar-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .sidebar-tab { flex: 1; padding: 0.6rem; text-align: center; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none; background: transparent; color: #64748b; }
        .sidebar-tab.active { color: #fff; border-bottom: 2px solid #60a5fa; }
        .ticket-list { overflow-y: auto; flex: 1; display: none; }
        .ticket-list.visible { display: flex; flex-direction: column; }
        .ticket-card { display: flex; flex-direction: column; padding: 0.55rem 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.07); cursor: pointer; border-left: 4px solid transparent; background: transparent; text-align: left; }
        .ticket-card:hover { background: rgba(255,255,255,0.05); }
        .ticket-card.selected { background: rgba(96,165,250,0.12); }
        .ticket-card-top { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
        .ticket-card-no { font-size: 0.8rem; font-weight: 700; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tech-badge, .status-pill-detail { font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; white-space: nowrap; color: #fff; }
        .tone-ready { background: #3b82f6; } .tone-op { background: #f59e0b; } .tone-cl-need { background: #ef4444; } .tone-comp { background: #22c55e; }
        .tone-tech-0 { background: #2563eb; } .tone-tech-1 { background: #7c3aed; } .tone-tech-2 { background: #0f766e; } .tone-tech-3 { background: #b45309; } .tone-tech-4 { background: #be123c; } .tone-tech-5 { background: #4f46e5; }
        .ticket-card-addr { font-size: 0.74rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 0.2rem; }
        .status-view { padding: 0.75rem; display: none; flex-direction: column; gap: 0.5rem; }
        .status-view.visible { display: flex; }
        .status-row { display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 0.5rem; }
        .status-dot-ready { background: #3b82f6; } .status-dot-op { background: #f59e0b; } .status-dot-clNeed { background: #ef4444; } .status-dot-comp { background: #22c55e; }
        .map-area { flex: 1; position: relative; min-height: 500px; background: #d1e8d1; background-image: linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px); background-size: 48px 48px; overflow: hidden; }
        .map-area.satellite-mode { background: #1c2d1c; background-image: linear-gradient(rgba(0,255,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,0,0.04) 1px, transparent 1px); }
        .topbar-location-group { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 0.4rem; z-index: 5; }
        .topbar-location-group select { background: rgba(15,23,42,0.9); border: 1px solid rgba(96,165,250,0.45); color: #e2e8f0; font-size: 0.78rem; font-weight: 600; padding: 0.3rem 0.55rem; border-radius: 4px; cursor: pointer; max-width: 180px; outline: none; }
        .map-type-toggle { position: absolute; top: 1rem; left: 1rem; border: 2px solid #9ca3af; border-radius: 4px; overflow: hidden; z-index: 5; display: flex; }
        .map-type-btn { padding: 0.42rem 0.85rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; border: none; background: #f3f4f6; color: #1f2937; }
        .map-type-btn.active { background: #fff; box-shadow: inset 0 -2px 0 #3b82f6; }
        .map-placeholder-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; pointer-events: none; }
        .map-placeholder-icon { opacity: 0.35; }
        .selected-day-panel { position: absolute; top: 1rem; right: 1rem; width: 240px; max-height: 500px; background: rgba(10,15,30,0.97); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; z-index: 20; overflow: hidden; }
        .selected-day-header { background: #0f172a; padding: 0.55rem 0.9rem; font-size: 0.88rem; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .selected-day-filters { display: flex; flex-direction: column; gap: 0; padding: 0.55rem 0.85rem; max-height: 400px; overflow-y: auto; }
        .filter-chip { display: flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: #e2e8f0; cursor: pointer; }
        /* Card inside Google Maps InfoWindow. The InfoWindow itself owns
           positioning (anchored to the marker); we just style the inner
           card and override the default white bubble to match our theme. */
        .gm-style .gm-style-iw-c {
          background: rgba(15,23,42,0.97);
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 10px;
          box-shadow: 0 18px 50px rgba(0,0,0,0.55);
          padding: 0 !important;
          color: #f1f5f9;
        }
        .gm-style .gm-style-iw-d { overflow: hidden !important; padding: 0 !important; }
        .gm-style .gm-style-iw-tc::after { background: rgba(15,23,42,0.97) !important; }
        .gm-style .gm-style-iw button[aria-label="Close"] { filter: invert(0.85); }
        .ahs-ticket-iw-host .detail-modal { background: transparent; border: none; border-radius: 0; width: 460px; max-width: 80vw; max-height: 70vh; overflow: hidden; color: #f1f5f9; box-shadow: none; display: flex; flex-direction: column; }
        .ahs-ticket-iw-host .detail-body { overflow-y: auto; }
        .detail-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.1rem; background: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.1); position: sticky; top: 0; z-index: 1; }
        .detail-title-row { display: flex; align-items: center; gap: 0.75rem; }
        .detail-ticket-no { font-size: 1.1rem; font-weight: 700; color: #fff; }
        .detail-ticket-link { text-decoration: underline; text-underline-offset: 2px; } .detail-ticket-link:hover { color: #93c5fd; }
        .google-btn { padding: 0.28rem 0.7rem; background: #4285f4; color: #fff; border: none; border-radius: 4px; font-size: 0.76rem; font-weight: 600; cursor: pointer; }
        .modal-close-btn { background: transparent; border: none; color: #64748b; font-size: 1.4rem; cursor: pointer; line-height: 1; padding: 0.1rem 0.3rem; }
        .detail-body { padding: 1rem 1.1rem; }
        .detail-row { display: flex; gap: 1.5rem; margin-bottom: 0.65rem; flex-wrap: wrap; align-items: flex-start; }
        .detail-field { display: flex; flex-direction: column; gap: 0.22rem; min-width: 130px; } .detail-field.grow { flex: 1; }
        .detail-label { font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
        .detail-value { font-size: 0.9rem; color: #f1f5f9; }
        .detail-divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 0.8rem 0; }
        .schedule-box { display: inline-flex; align-items: center; gap: 0.55rem; background: rgba(30,64,175,0.2); border: 1px solid rgba(96,165,250,0.3); border-radius: 6px; padding: 0.45rem 0.85rem; font-size: 0.88rem; flex-wrap: wrap; }
        .contact-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.45rem; }
        .contact-btn { padding: 0.28rem 0.7rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.18); background: rgba(30,41,59,0.9); color: #e2e8f0; font-size: 0.76rem; cursor: pointer; }
        .contact-btn:hover { background: rgba(30,64,175,0.3); border-color: rgba(96,165,250,0.4); }
        .status-pill-detail { display: inline-block; padding: 0.25rem 0.7rem; border-radius: 99px; font-size: 0.8rem; font-weight: 600; color: #fff; }
        .internal-note-box { font-size: 0.82rem; color: #cbd5e1; background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.65rem 0.9rem; line-height: 1.65; white-space: pre-wrap; width: 100%; box-sizing: border-box; }
        .selected-day-panel, .map-panel, .ticket-sidebar, .detail-modal { animation: fadeIn 180ms ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 768px) { .ticket-sidebar { width: 175px; min-width: 150px; } .color-legend { position: static; right: auto; } .selected-day-panel { width: 220px; } .map-body { min-height: 480px; } }
      `}</style>
    </div>
  );
}
