import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, MapPin, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { ALL_TECHNICIANS, LOCATIONS, getTechniciansForLocation, normalizeLocationName } from "@/lib/locations";
import { getSubModule } from "@/lib/modules";
import { getLocationManagementZoomAddress } from "@/components/LocationManagementPage";

const GOOGLE_MAPS_API_KEY = "AIzaSyBnTWvcdQZsXsohbrHLBiA3zsMGhVZYPbc";

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
  slot: "AM" | "PM" | "Eve";
  scheduleTime: string;
  lat?: number;
  lng?: number;
};

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const LOCATION_OPTIONS = LOCATIONS;
const STATUS_LEGEND = [
  { label: "Pending", className: "color-pending" },
  { label: "Ready for Service", className: "color-ready" },
  { label: "Completed", className: "color-completed" },
  { label: "Claimed", className: "color-claimed" },
];
const TIME_SLOTS: Array<PlannerTicket["slot"]> = ["AM", "PM", "Eve"];
const SLOT_TIMES: Record<PlannerTicket["slot"], string> = {
  AM: "08:30",
  PM: "14:30",
  Eve: "17:30",
};
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
  const parts = value.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function storageKey(mod: string, sub: string) {
  return `ahs:data:${mod}:${sub}`;
}

function readSeededTickets(): TicketRecord[] {
  const seededSub = getSubModule("tickets", "ticket-list");
  if (!seededSub?.seed) return [];
  const count = seededSub.count ?? 24;
  return Array.from({ length: count }, (_, index) => ({
    __id: `ticket-list-${index}`,
    ...seededSub.seed(index),
  })) as TicketRecord[];
}

function createPlannerTickets(rows: TicketRecord[]): PlannerTicket[] {
  return rows.map((row, index) => {
    const slot = TIME_SLOTS[index % TIME_SLOTS.length];
    const techRoster = getTechniciansForLocation(normalizeBranch(row.location || row.city || row.branch));
    const technician = row.technician || techRoster[index % Math.max(techRoster.length, 1)] || ALL_TECHNICIANS[index % ALL_TECHNICIANS.length] || "Unassigned";
    const address = row.customer_address || row.address || `${row.city || row.location || "Unknown"}`;
    return {
      ...row,
      location: normalizeBranch(row.location || row.city || row.branch),
      branch: normalizeBranch(row.branch || row.location || row.city),
      technician,
      slot,
      scheduleTime: row.scheduleTime || SLOT_TIMES[slot],
      status: row.status || "Pending",
      created: String(row.created || row.created_at || getLocalDateStr()),
      customer: String(row.customer || row.customer_name || "Unknown"),
      city: String(row.city || row.customer_city || row.location || ""),
      address,
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

function buildPinPosition(ticket: PlannerTicket, index: number) {
  const seed = String(ticket.location || ticket.customer || ticket.city || ticket.address || "");
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  }
  return `map-pin-pos-${(hash + index) % 16}`;
}

export function WorkPlannerPage({ mod, sub }: Props) {
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
  const geocodeCacheRef = useRef<Map<string, { lat: number; lng: number } | null>>(new Map());
  const dragSourceRef = useRef<{ ticketNo: string; slot: PlannerTicket["slot"]; technician: string } | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(storageKey("tickets", "ticket-list"));
    const sourceRows = raw ? (() => { try { return JSON.parse(raw) as TicketRecord[]; } catch { return readSeededTickets(); } })() : readSeededTickets();
    setPlannerTickets(createPlannerTickets(sourceRows));
  }, []);

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
    return plannerTickets.filter((ticket) => {
      const ticketDate = String(ticket.schedule || ticket.created || "").slice(0, 10);
      if (ticketDate && ticketDate !== selectedDate) return false;
      if (location && normalizeBranch(ticket.location || ticket.city || ticket.branch) !== location) return false;
      if (!showRescheduled && String(ticket.status || "").toLowerCase().includes("resched")) return false;
      return true;
    });
  }, [plannerTickets, plannerDate, location, showRescheduled]);

  const groupedTickets = useMemo(() => {
    return selectedTechRoster.map((tech) => ({
      tech,
      slots: TIME_SLOTS.map((slot) => visibleTickets.filter((ticket) => ticket.technician === tech && ticket.slot === slot)),
    }));
  }, [selectedTechRoster, visibleTickets]);

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

  useEffect(() => {
    let cancelled = false;

    const initializeMap = () => {
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
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-maps="work-planner"]');
    if ((window as Window & { google?: any }).google?.maps) {
      initializeMap();
      return () => { cancelled = true; };
    }

    if (existingScript) {
      existingScript.addEventListener("load", initializeMap, { once: true });
      existingScript.addEventListener("error", () => { if (!cancelled) setMapError("Google Maps failed to load."); }, { once: true });
      return () => { cancelled = true; };
    } else {
      const script = document.createElement("script");
      script.dataset.googleMaps = "work-planner";
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.52`;
      script.onload = initializeMap;
      script.onerror = () => { if (!cancelled) setMapError("Google Maps failed to load."); };
      document.head.appendChild(script);
    }

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const geocoder = new maps.Geocoder();
    const geocode = (address: string) => new Promise<{ lat: number; lng: number } | null>((resolve) => {
      geocoder.geocode({ address }, (results: any, status: string) => {
        if (status === "OK" && results?.[0]) {
          const position = results[0].geometry.location;
          resolve({ lat: position.lat(), lng: position.lng() });
          return;
        }
        resolve(null);
      });
    });

    let cancelled = false;
    const bounds = new maps.LatLngBounds();

    Promise.all(
      visibleTickets.map(async (ticket) => {
        const cacheKey = `${ticket.location}:${ticket.ticketNo}`;
        if (geocodeCacheRef.current.has(cacheKey)) {
          return { ticket, position: geocodeCacheRef.current.get(cacheKey) };
        }

        const query = ticket.address || ticket.city || ticket.location;
        const position = query ? await geocode(query) : null;
        geocodeCacheRef.current.set(cacheKey, position);
        return { ticket, position };
      }),
    ).then((results) => {
      if (cancelled || !mapRef.current) return;

      results.forEach(({ ticket, position }, index) => {
        if (!position) return;

        const marker = new maps.Marker({
          map: mapRef.current,
          position,
          title: ticket.ticketNo,
        });

        marker.addListener("click", () => {
          setSelectedTicket(ticket);
          setSelectedMarkerIndex(index);
        });

        markersRef.current.push(marker);
        bounds.extend(position);
      });

      if (location) {
        geocode(getLocationManagementZoomAddress(location)).then((position) => {
          if (position && mapRef.current) {
            mapRef.current.setCenter(position);
            mapRef.current.setZoom(10);
            return;
          }

          if (!bounds.isEmpty() && mapRef.current) {
            mapRef.current.fitBounds(bounds);
          }
        });
      } else if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds);
      } else {
        const fallbackLocation = visibleTickets[0]?.location || selectedTechRoster[0] || location;
        geocode(getLocationManagementZoomAddress(fallbackLocation)).then((position) => {
          if (position && mapRef.current) {
            mapRef.current.setCenter(position);
            mapRef.current.setZoom(10);
          } else {
            mapRef.current.setCenter({ lat: 37.0902, lng: -95.7129 });
            mapRef.current.setZoom(4);
          }
        });
      }
    });

    return () => { cancelled = true; };
  }, [mapReady, visibleTickets]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;
    mapRef.current.setMapTypeId(mapMode === "satellite" ? maps.MapTypeId.SATELLITE : maps.MapTypeId.ROADMAP);
  }, [mapMode, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !location) return;
    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;

    const geocoder = new maps.Geocoder();
    geocoder.geocode({ address: getLocationManagementZoomAddress(location) }, (results: any, status: string) => {
      if (status === "OK" && results?.[0] && mapRef.current) {
        mapRef.current.setCenter(results[0].geometry.location);
        mapRef.current.setZoom(10);
      }
    });
  }, [location, mapReady]);

  const handleDragStart = (ticketNo: string, slot: PlannerTicket["slot"], technician: string) => {
    dragSourceRef.current = { ticketNo, slot, technician };
  };

  const handleDrop = (technician: string, slot: PlannerTicket["slot"]) => {
    const dragSource = dragSourceRef.current;
    if (!dragSource) return;

    setPlannerTickets((current) => current.map((ticket) => {
      if (ticket.ticketNo !== dragSource.ticketNo) return ticket;
      return { ...ticket, technician, slot, scheduleTime: SLOT_TIMES[slot] };
    }));

    setChangedTickets((current) => [
      {
        type: "Reassignment",
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
                  {LOCATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
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
                {TIME_SLOTS.map((slot, slotIndex) => {
                  const tickets = slots[slotIndex] || [];
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
                        tickets.map((ticket, index) => (
                          <div
                            key={ticket.ticketNo}
                            className={`work-order-card ${getToneClass(ticket, techIndex + index)}`}
                            draggable
                            onDragStart={() => handleDragStart(ticket.ticketNo, ticket.slot, ticket.technician)}
                            onClick={() => setSelectedTicket(ticket)}
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
                            <div className="work-order-address">{ticket.address || ticket.city || ticket.location || "Unknown address"}</div>
                            <div className="work-order-status">
                              <span className={`work-order-status-dot ${getToneClass(ticket, index)}`} />
                              {ticket.status || "Pending"}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="map-section">
          <div className="map-section-title">Assigned Locations Map</div>
          <div className="map-shell">
            <div className="map-type-toggle">
              <button className={`map-type-btn ${mapMode === "map" ? "active" : ""}`} type="button" onClick={() => setMapMode("map")}>Map</button>
              <button className={`map-type-btn ${mapMode === "satellite" ? "active" : ""}`} type="button" onClick={() => setMapMode("satellite")}>Satellite</button>
            </div>
            <div className="pin-navigator">
              <button className="pin-nav-btn" type="button" title="Previous pin" onClick={() => setSelectedMarkerIndex((current) => (visibleTickets.length ? (current - 1 + visibleTickets.length) % visibleTickets.length : 0))}>❮</button>
              <span className="pin-nav-info">{visibleTickets.length ? `${selectedMarkerIndex + 1} / ${visibleTickets.length}` : "—"}</span>
              <button className="pin-nav-btn" type="button" title="Next pin" onClick={() => setSelectedMarkerIndex((current) => (visibleTickets.length ? (current + 1) % visibleTickets.length : 0))}>❯</button>
            </div>
            <div ref={mapContainerRef} className="google-map-canvas" aria-label="Google map" />
            {!mapReady && (
              <div className="map-placeholder-inner">
                <MapPin className="map-placeholder-icon h-16 w-16 text-slate-600" />
                <div className="text-sm text-slate-500">Loading Google Maps...</div>
                {mapError ? <div className="text-xs text-rose-300 mt-2">{mapError}</div> : null}
              </div>
            )}
            <div className="map-pins-container">
              {visibleTickets.map((ticket, index) => {
                const position = buildPinPosition(ticket, index);
                const toneClass = getToneClass(ticket, index);
                const initials = getInitials(ticket.technician || ticket.customer || ticket.ticketNo);
                return (
                  <button
                    key={`${ticket.ticketNo}-${index}`}
                    type="button"
                    className={`map-pin ${position}`}
                    onClick={() => setSelectedTicket(ticket)}
                    aria-label={`Open ${ticket.ticketNo}`}
                  >
                    <div className={`pin-bubble ${toneClass}`}>
                      <span className="pin-initials">{initials}</span>
                      <span className="pin-time">{ticket.scheduleTime || "Today"}</span>
                    </div>
                    <div className={`pin-tail ${toneClass}`} />
                  </button>
                );
              })}
            </div>
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
              <button className="google-btn" type="button" onClick={() => selectedTicket && window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedTicket.ticketNo || selectedTicket.customer || "ticket")}`, "_blank", "noopener,noreferrer")}>Google</button>
            </div>
            <button className="modal-close-btn" type="button" aria-label="Close" onClick={() => setSelectedTicket(null)}><X className="h-5 w-5" /></button>
          </div>
          <div className="detail-body">
            {selectedTicket ? (
              <>
                <div className="detail-row">
                  <div className="detail-field grow"><div className="detail-label">Customer</div><div className="detail-value">{selectedTicket.customer || "Unknown"}</div></div>
                  <div className="detail-field"><div className="detail-label">Technician</div><div className="detail-value">{selectedTicket.technician || "Unassigned"}</div></div>
                  <div className="detail-field"><div className="detail-label">Status</div><div className="detail-value"><span className={`status-pill-detail tone-tech-0`}>{selectedTicket.status || "Open"}</span></div></div>
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