import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { setDesktopOverride } from "@/lib/device";
import { getCompanyTickets, getTicketVisits } from "@/lib/supabase/tickets";
import { getTicketBilling, saveTicketBilling, type TicketBilling } from "@/lib/supabase/billing";
import { getTicketComments, addTicketComment, type TicketComment } from "@/lib/supabase/comments";
import { TicketPhotos } from "@/components/TicketPhotos";
import { uploadTicketSignature } from "@/lib/firebase/storage";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { lookupZip } from "@/lib/zipCoverage";
import { resolveTierCode } from "@/lib/tierCodes";
import type { Ticket } from "@/lib/ticketData";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

type View = "roster" | "tickets" | "map" | "detail";
type DetailTab = "general" | "tracking" | "billing";

// Roles that see their OWN tickets directly (skip the technician roster).
const SELF_ROLES = new Set(["TECHNICIAN"]);

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

export function MobileTechApp() {
  const { email, displayName, role, companyId, allowedLocations, logout } = useAuth();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const isSelfRole = role ? SELF_ROLES.has(role.toUpperCase()) : false;

  // Manager flow: which technician's tickets are we viewing.
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [view, setView] = useState<View>(isSelfRole ? "tickets" : "roster");
  const [tab, setTab] = useState<"todo" | "done" | "search">("todo");
  const [search, setSearch] = useState("");
  const [activeTicketNo, setActiveTicketNo] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("general");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getCompanyTickets();
        if (!cancelled) setTickets(rows);
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
    const name = scopeTech.toLowerCase();
    return locScoped.filter((t) => (t.technician || "").toLowerCase() === name);
  }, [locScoped, scopeTech]);

  // Technician roster for managers — real TECHNICIAN-role users from Supabase,
  // scoped to the manager's allowed locations (assigned_branch / branch_access).
  const roster = useMemo(() => {
    // Include users who have TECHNICIAN as their primary role OR in
    // extra_roles. Daven Hodge is a manager+technician, for example.
    const techUsers = users.filter((u) => {
      const primary = (u.role || "").toUpperCase();
      if (primary === "TECHNICIAN") return true;
      const extras = ((u as any).extra_roles as string[] | null | undefined) || [];
      return extras.some((r) => String(r).toUpperCase() === "TECHNICIAN");
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

  const goDesktop = () => {
    setDesktopOverride(true);
    navigate({ to: "/home", replace: true });
  };

  const openTicket = (t: Ticket) => {
    setActiveTicketNo(t.ticketNo);
    setDetailTab("general");
    setView("detail");
  };

  const headerName = displayName || email || "User";
  const companyLabel = companyId || "AH";

  // Unified back navigation for the top-bar back button.
  const handleTopBack = () => {
    if (view === "detail") {
      setView("tickets");
    } else if (view === "map") {
      setView("tickets");
    } else if (view === "tickets") {
      if (!isSelfRole) {
        setSelectedTech(null);
        setView("roster");
      }
    }
  };
  // Hide the back button when there's nowhere to go (tech's own ticket list, or roster root).
  const showTopBack =
    view === "detail" || view === "map" || (view === "tickets" && !isSelfRole);

  return (
    <div className="mtech">
      <TopBar
        title={
          view === "roster"
            ? "Technicians"
            : view === "map"
            ? "Route"
            : view === "detail"
            ? "Service Report"
            : "Tickets"
        }
        company={companyLabel}
        userName={headerName}
        onLogout={logout}
        onBack={handleTopBack}
        showBack={showTopBack}
      />

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
          onRoute={() => setView("map")}
          onOpen={openTicket}
          techLabel={scopeTech || ""}
        />
      )}

      {view === "map" && (
        <RouteMapView
          tickets={myTickets.filter((t) => !isDone(t.status))}
          onBackToTickets={() => setView("tickets")}
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
        />
      )}

      {/* Footer escape to desktop */}
      <button className="mtech-desktop-link" onClick={goDesktop} type="button">
        Desktop Site
      </button>
    </div>
  );
}

function TopBar({
  title,
  company,
  userName,
  onLogout,
  onBack,
  showBack,
}: {
  title: string;
  company: string;
  userName: string;
  onLogout: () => void;
  onBack: () => void;
  showBack: boolean;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="mtech-topbar">
      {showBack ? (
        <button className="mtech-topbar-back" onClick={onBack} type="button" aria-label="Back">
          ‹
        </button>
      ) : (
        <span className="mtech-company">{company}</span>
      )}
      <span className="mtech-title">
        <img src={logo} alt="" className="mtech-coin" />
        {title}
      </span>
      <button className="mtech-user" onClick={() => setMenu((m) => !m)} type="button">
        {userName.split(" ")[0]}
      </button>
      {menu && (
        <>
          <div className="mtech-menu-overlay" onClick={() => setMenu(false)} />
          <div className="mtech-user-menu">
            <button onClick={onLogout} type="button">
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
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
  onRoute,
  onOpen,
  techLabel,
}: {
  loading: boolean;
  tickets: Ticket[];
  tab: "todo" | "done" | "search";
  setTab: (t: "todo" | "done" | "search") => void;
  search: string;
  setSearch: (s: string) => void;
  onRoute: () => void;
  onOpen: (t: Ticket) => void;
  techLabel: string;
}) {
  const today = new Date().toLocaleDateString("en-US");
  return (
    <>
      <div className="mtech-subbar">
        <span className="mtech-date">{techLabel ? techLabel : today}</span>
        <button className="mtech-route-btn" onClick={onRoute} type="button">
          Route
        </button>
      </div>

      <div className="mtech-tabs">
        <button className={tab === "todo" ? "active" : ""} onClick={() => setTab("todo")} type="button">
          To Do
        </button>
        <button className={tab === "done" ? "active" : ""} onClick={() => setTab("done")} type="button">
          Done
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
          tickets.map((t, i) => (
            <button key={t.ticketNo} className="mtech-ticket-card" onClick={() => onOpen(t)} type="button">
              <div className={`mtech-ticket-rail ${statusTone(t.status)}`}>
                <span className="mtech-rail-num">{i + 1}</span>
                <span className="mtech-rail-loc">{resolveLocation(t)}</span>
                <span className="mtech-rail-days">{openDays(t)} days</span>
                {t.warranty && <span className="mtech-rail-wty">{t.warranty}</span>}
                {t.claimCompany && <span className="mtech-rail-claim">{t.claimCompany}</span>}
              </div>
              <div className="mtech-ticket-body">
                <div className="mtech-ticket-no">{t.ticketNo}</div>
                <div className="mtech-ticket-status">🔖 {t.status}</div>
                <div className="mtech-ticket-cust">👤 {t.customer || "—"}</div>
                <div className="mtech-ticket-when">
                  🕑 {t.schedule || "Unscheduled"} {t.city ? `@ ${t.city}` : ""}
                </div>
                <div className="mtech-ticket-model">
                  📦 {t.model} <span className="mtech-ticket-product">({productLabel(t)})</span>
                </div>
              </div>
              <span className="mtech-ticket-chev">›</span>
            </button>
          ))}
      </div>
    </>
  );
}

function RouteMapView({
  tickets,
  onBackToTickets,
}: {
  tickets: Ticket[];
  onBackToTickets: () => void;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const dirRendererRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [stops, setStops] = useState<Array<{ ticket: Ticket; pos: { lat: number; lng: number } }>>([]);
  const [legs, setLegs] = useState<
    Array<{ ticketNo: string; customer: string; address: string; distance: string; duration: string; pos: { lat: number; lng: number } }>
  >([]);
  const [routing, setRouting] = useState(true);

  // Try to get the technician's current location for the route origin.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        /* permission denied — we'll route between stops only */
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Load Google Maps script + init map, then build a driving route.
  useEffect(() => {
    let cancelled = false;

    const init = () => {
      const g = (window as any).google;
      if (!g?.maps || !mapEl.current) return;
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
      void buildRoute(g);
    };

    const buildRoute = async (g: any) => {
      setRouting(true);
      setError(null);
      const geocoder = new g.maps.Geocoder();
      const geocode = (address: string) =>
        new Promise<{ lat: number; lng: number } | null>((resolve) => {
          geocoder.geocode({ address }, (results: any, status: string) => {
            if (status === "OK" && results?.[0]) {
              const p = results[0].geometry.location;
              resolve({ lat: p.lat(), lng: p.lng() });
            } else resolve(null);
          });
        });

      // Geocode each ticket stop in ticket order.
      const resolved: Array<{ ticket: Ticket; pos: { lat: number; lng: number } }> = [];
      for (const t of tickets) {
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
      const badgeColors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
      resolved.forEach((s, i) => {
        const initials = getInitials(s.ticket.technician);
        const svgMarker = {
          path: "M2 2 L38 2 Q40 2 40 4 L40 16 Q40 18 38 18 L22 18 L20 22 L18 18 L2 18 Q0 18 0 16 L0 4 Q0 2 2 2 Z",
          fillColor: badgeColors[i % badgeColors.length],
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
          title: `${s.ticket.ticketNo} - ${s.ticket.customer}`,
          icon: svgMarker,
          label: {
            text: `${initials}${i + 1}`,
            color: "#ffffff",
            fontSize: "13px",
            fontWeight: "bold",
          },
        });
        markersRef.current.push(marker);
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
        mapRef.current.setCenter(resolved[0].pos);
        mapRef.current.setZoom(13);
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
            // Badge markers are already placed; just fit the map to them.
            const bounds = new g.maps.LatLngBounds();
            resolved.forEach((s) => bounds.extend(s.pos));
            mapRef.current.fitBounds(bounds);
          }
          setRouting(false);
        }
      );
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps="mobile"]');
    if ((window as any).google?.maps) {
      init();
    } else if (existing) {
      existing.addEventListener("load", init, { once: true });
      existing.addEventListener("error", () => setError("Google Maps failed to load."), { once: true });
    } else {
      const s = document.createElement("script");
      s.dataset.googleMaps = "mobile";
      s.async = true;
      s.defer = true;
      s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.52`;
      s.onload = init;
      s.onerror = () => setError("Google Maps failed to load.");
      document.head.appendChild(s);
    }

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, origin]);

  // Open the full multi-stop route in the device's Google Maps (turn-by-turn).
  const openInGoogleMaps = () => {
    if (stops.length === 0) return;
    const pts = stops.map((s) => `${s.pos.lat},${s.pos.lng}`);
    const destination = pts[pts.length - 1];
    const waypoints = pts.slice(0, -1);
    const params = new URLSearchParams({ api: "1", destination, travelmode: "driving" });
    if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
    if (waypoints.length) params.set("waypoints", waypoints.join("|"));
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  // Navigate to a single stop from the directions list.
  const navigateToStop = (lat: number, lng: number) => {
    const params = new URLSearchParams({ api: "1", destination: `${lat},${lng}`, travelmode: "driving" });
    if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="mtech-subbar">
        <span className="mtech-date">{new Date().toLocaleDateString("en-US")}</span>
        <button className="mtech-route-btn" onClick={onBackToTickets} type="button">
          Tickets
        </button>
      </div>

      <div className="mtech-map" ref={mapEl}>
        {error && <div className="mtech-empty">{error}</div>}
      </div>

      <button className="mtech-nav-btn" onClick={openInGoogleMaps} type="button" disabled={stops.length === 0}>
        🧭 Start Navigation
      </button>

      <div className="mtech-directions">
        <div className="mtech-directions-title">
          {routing ? "Building route…" : `Route · ${legs.length} stop${legs.length === 1 ? "" : "s"}`}
        </div>
        {legs.map((leg, i) => (
          <button
            key={`${leg.ticketNo}-${i}`}
            className="mtech-direction-row"
            onClick={() => leg.pos && navigateToStop(leg.pos.lat, leg.pos.lng)}
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
    </>
  );
}

function DetailView({
  ticket,
  tab,
  setTab,
  companyId,
  authorName,
  authorRole,
}: {
  ticket: Ticket;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  companyId: string | null;
  authorName: string;
  authorRole: string;
}) {
  return (
    <div className="mtech-scroll">
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
        <button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")} type="button">
          Billing
        </button>
      </div>

      {tab === "general" && (
        <DetailsTab ticket={ticket} authorName={authorName} authorRole={authorRole} />
      )}
      {tab === "tracking" && <RepairTab ticket={ticket} authorName={authorName} />}
      {tab === "billing" && <BillingTab ticket={ticket} companyId={companyId} />}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="mtech-inforow">
      <span className="mtech-info-label">{label}</span>
      <span className="mtech-info-value">{value || "—"}</span>
    </div>
  );
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
  return (
    <div className="mtech-panel">
      <div className="mtech-actions">
        <button type="button" disabled title="Coming soon">On my way</button>
        <button type="button" disabled title="Coming soon">Check In</button>
        <button type="button" disabled title="Coming soon">Check Out</button>
      </div>

      <div className="mtech-section-title">Customer</div>
      <InfoRow label="Name" value={ticket.customer || [ticket.firstName, ticket.lastName].filter(Boolean).join(" ")} />
      <InfoRow label="Phone" value={ticket.phone || ticket.secondPhone} />
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
      <InfoRow label="Home Phone" value={ticket.phone} />
      <InfoRow label="Cell Phone" value={ticket.secondPhone} />
      <InfoRow label="Email" value={ticket.email} />

      <div className="mtech-section-title">Product Information</div>
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getTicketVisits(ticket.ticketNo);
        if (!cancelled) setVisits(rows as any);
      } catch (e) {
        console.error("load visits failed", e);
        if (!cancelled) setVisits([]);
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

  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Service Tracking</div>
      {loading && <div className="mtech-muted">Loading visits…</div>}
      {!loading && visits.length === 0 && <div className="mtech-muted">No visits recorded yet.</div>}

      <div className="mtech-visit-list">
        {visits.map((v) => (
          <div key={v.id} className="mtech-visit">
            <div className="mtech-visit-head">
              <span className="mtech-visit-no">{v.visitNo || "Visit"}</span>
              <span className="mtech-visit-status">{v.repairStatus || v.status || "—"}</span>
            </div>
            <div className="mtech-visit-meta">
              <span>📅 {fmtDate(v.scheduleDate)}{v.timeSlot ? ` · ${v.timeSlot}` : ""}</span>
              <span>👤 {v.technician || "—"}</span>
            </div>
            {v.activity && <InfoRow label="Activity" value={v.activity} />}
            {v.actionType && <InfoRow label="Action" value={v.actionType} />}
            {v.repairType && <InfoRow label="Repair Type" value={v.repairType} />}
            {v.symptomCx && <InfoRow label="Symptom (Cx)" value={v.symptomCx} />}
            {v.diagnosis && <InfoRow label="Diagnosis" value={v.diagnosis} />}
            {v.resolution && <InfoRow label="Resolution" value={v.resolution} />}
            {v.nonCompletionReason && <InfoRow label="Non-Completion" value={v.nonCompletionReason} />}
            {v.schedNotes && <InfoRow label="Sched Notes" value={v.schedNotes} />}
            {v.note && <InfoRow label="Internal Note" value={v.note} />}
          </div>
        ))}
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
        visitOptions={visits.map((v) => String(v.visitNo || "")).filter(Boolean)}
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
            <div className="mtech-comment-body">{c.body}</div>
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
