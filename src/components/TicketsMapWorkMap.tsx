import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getSubModule } from "@/lib/modules";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { CalendarDays, ChevronLeft, MapPin, X } from "lucide-react";
import { WORK_MAP_LOCATIONS, mergeLocationOptions, normalizeLocationName } from "@/lib/locations";

type ColorMode = "status" | "tech";
type SidebarTab = "tickets" | "status";

type TicketRecord = Record<string, any>;

const GOOGLE_MAPS_API_KEY = "AIzaSyBnTWvcdQZsXsohbrHLBiA3zsMGhVZYPbc";

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

function getInitials(value: string | null | undefined) {
  if (!value) return "U";
  const localPart = value.split("@")[0] ?? value;
  const parts = localPart.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return localPart.slice(0, 2).toUpperCase();
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

function buildPinPosition(ticket: TicketRecord, index: number) {
  const seed = String(ticket.location || ticket.customer || ticket.city || ticket.address || "");
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  }
  const left = 10 + ((hash + index * 17) % 78);
  const top = 15 + (((hash >> 3) + index * 11) % 68);
  return { left: `${left}%`, top: `${top}%` };
}

export function TicketsMapWorkMap({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("status");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("tickets");
  const [mapMode, setMapMode] = useState<"map" | "satellite">("map");
  const [mapDate, setMapDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ready, setReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    const key = "ticket-list";
    if (!localStorage.getItem(key)) {
      const seeded = getSubModule("tickets", "ticket-list");
      if (seeded?.seed) {
        const count = seeded.count || 24;
        const data = Array.from({ length: count }, (_, index) => seeded.seed(index));
        localStorage.setItem(key, JSON.stringify(data));
      }
    }
    setReady(true);
  }, []);

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
  }, []);

  const tickets = useMemo<TicketRecord[]>(() => {
    if (!ready) return [];
    try {
      return JSON.parse(localStorage.getItem("ticket-list") || "[]") as TicketRecord[];
    } catch {
      return [];
    }
  }, [ready]);

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

    return filtered.filter((ticket) => {
      const ticketDate = String(ticket.schedule || ticket.created || ticket.created_at || "").slice(0, 10);
      return !ticketDate || ticketDate === mapDate;
    });
  }, [tickets, selectedLocation, mapDate]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

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

    let cancelled = false;

    const ticketPositions = visibleTickets.map(async (ticket) => {
      const directLat = typeof ticket.lat === "number" ? ticket.lat : typeof ticket.latitude === "number" ? ticket.latitude : null;
      const directLng = typeof ticket.lng === "number" ? ticket.lng : typeof ticket.longitude === "number" ? ticket.longitude : null;
      if (directLat != null && directLng != null) {
        return { ticket, position: { lat: directLat, lng: directLng } };
      }

      const query = ticket.customer_address || ticket.customer_city || ticket.location;
      if (!query) return { ticket, position: null };
      return { ticket, position: await geocode(query) };
    });

    Promise.all(ticketPositions).then((results) => {
      if (cancelled || !mapRef.current) return;

      const bounds = new maps.LatLngBounds();
      results.forEach(({ ticket, position }, index) => {
        if (!position) return;

        const marker = new maps.Marker({
          map: mapRef.current,
          position,
          title: ticket.ticket_no || ticket.customer_name || `Ticket ${index + 1}`,
        });

        marker.addListener("click", () => setSelectedTicket(ticket));
        markersRef.current.push(marker);
        bounds.extend(position);
      });

      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds);
      } else if (selectedLocation) {
        geocode(selectedLocation).then((position) => {
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

  const pinStyles = useMemo(
    () =>
      visibleTickets
        .map((ticket, index) => {
          const position = buildPinPosition(ticket, index);
          return `.map-pin-${index} { left: ${position.left}; top: ${position.top}; }`;
        })
        .join("\n"),
    [visibleTickets],
  );

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
                      const selected = selectedTicket?.ticket_no === ticket.ticket_no;
                      return (
                        <button key={`${ticket.ticket_no}-${index}`} type="button" className={`ticket-card ${selected ? "selected" : ""}`} onClick={() => setSelectedTicket(ticket)}>
                          <div className="ticket-card-top">
                            <span className="ticket-card-no">{ticket.ticket_no}</span>
                            <span className={`tech-badge ${toneClass}`}>{ticket.technician_name || ticket.technician || "Unassigned"}</span>
                          </div>
                          <span className="ticket-card-addr">{ticket.customer_address || ticket.customer_name || ticket.customer_city || ticket.location || "Unknown address"}</span>
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

                <div className="map-pins">
                  {visibleTickets.map((ticket, index) => {
                    const toneClass = getToneClass(colorMode, ticket, index);
                    const initials = getInitials(ticket.technician_name || ticket.technician || ticket.customer_name || ticket.ticket_no);
                    const time = String(ticket.schedule || ticket.created || ticket.created_at || "").slice(11, 16) || ticket.schedule_date || "";
                    return (
                      <button key={`pin-${ticket.ticket_no}-${index}`} type="button" className={`map-pin map-pin-${index}`} onClick={() => setSelectedTicket(ticket)} aria-label={`Open ${ticket.ticket_no}`}>
                        <div className={`pin-bubble ${toneClass}`}>
                          <span className="pin-initials">{initials}</span>
                          <span className="pin-time">{time || "Today"}</span>
                        </div>
                        <div className={`pin-tail ${toneClass}`} />
                      </button>
                    );
                  })}
                </div>

                <div className="selected-day-panel">
                  <div className="selected-day-header">Selected Day's Tickets</div>
                  <div className="selected-day-filters">
                    <label className="filter-chip"><input type="checkbox" defaultChecked /> Technician</label>
                    <label className="filter-chip"><input type="checkbox" defaultChecked /> Ready</label>
                    <label className="filter-chip"><input type="checkbox" defaultChecked /> CL-Need</label>
                    <label className="filter-chip"><input type="checkbox" defaultChecked /> Comp.</label>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      <div className={`detail-overlay ${selectedTicket ? "open" : ""}`}>
        <div className="detail-modal">
          <div className="detail-modal-header">
            <div className="detail-title-row">
              <a className="detail-ticket-no detail-ticket-link" href={selectedTicket ? "ticket_details.html" : "#"} target="_blank" rel="noopener noreferrer">
                {selectedTicket?.ticket_no || "Ticket details"}
              </a>
              <button className="google-btn" type="button" onClick={() => selectedTicket && window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedTicket.ticket_no || selectedTicket.customer_name || "ticket")}`, "_blank", "noopener,noreferrer")}>Google</button>
            </div>
            <button className="modal-close-btn" type="button" aria-label="Close" onClick={() => setSelectedTicket(null)}><X className="h-5 w-5" /></button>
          </div>

          <div className="detail-body">
            {selectedTicket ? (
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
                    <div className="detail-label">Status</div>
                    <div className="detail-value"><span className={`status-pill-detail ${getToneClass(colorMode, selectedTicket, 0)}`}>{selectedTicket.status || "Open"}</span></div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Address</div>
                    <div className="detail-value">{selectedTicket.customer_address || selectedTicket.location || selectedTicket.customer_city || "-"}</div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Schedule</div>
                    <div className="detail-value"><span className="schedule-box"><CalendarDays className="h-4 w-4" /><span>{String(selectedTicket.schedule || selectedTicket.schedule_date || mapDate)}</span></span></div>
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
            ) : (
              <div className="text-sm text-slate-300">Select a ticket to view its details.</div>
            )}
          </div>
        </div>
      </div>

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
        .map-pins { position: absolute; inset: 0; pointer-events: none; }
        .map-pin { position: absolute; display: flex; flex-direction: column; align-items: center; cursor: pointer; pointer-events: all; transform: translate(-50%, -100%); background: transparent; border: none; padding: 0; }
        .map-pin:hover { transform: translate(-50%, -105%) scale(1.15); z-index: 10; }
        .pin-bubble { padding: 0.35rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; gap: 0.3rem; flex-direction: column; color: #fff; }
        .pin-initials { min-width: 1rem; line-height: 1; } .pin-time { font-size: 0.65rem; opacity: 0.9; line-height: 1; }
        .pin-tail { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid transparent; margin-top: -1px; }
        .pin-tail.tone-ready { border-top-color: #3b82f6; } .pin-tail.tone-op { border-top-color: #f59e0b; } .pin-tail.tone-cl-need { border-top-color: #ef4444; } .pin-tail.tone-comp { border-top-color: #22c55e; }
        .pin-tail.tone-tech-0 { border-top-color: #2563eb; } .pin-tail.tone-tech-1 { border-top-color: #7c3aed; } .pin-tail.tone-tech-2 { border-top-color: #0f766e; } .pin-tail.tone-tech-3 { border-top-color: #b45309; } .pin-tail.tone-tech-4 { border-top-color: #be123c; } .pin-tail.tone-tech-5 { border-top-color: #4f46e5; }
        .selected-day-panel { position: absolute; top: 1rem; right: 1rem; width: 285px; background: rgba(10,15,30,0.97); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; z-index: 20; overflow: hidden; }
        .selected-day-header { background: #0f172a; padding: 0.55rem 0.9rem; font-size: 0.88rem; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .selected-day-filters { display: flex; gap: 0.6rem; padding: 0.55rem 0.85rem; flex-wrap: wrap; }
        .filter-chip { display: flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: #e2e8f0; cursor: pointer; }
        .detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 200; display: none; align-items: center; justify-content: center; padding: 1rem; }
        .detail-overlay.open { display: flex; }
        .detail-modal { background: #1e293b; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; width: 700px; max-width: 95vw; max-height: 92vh; overflow-y: auto; color: #f1f5f9; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
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
      <style>{pinStyles}</style>
    </div>
  );
}
