import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { setDesktopOverride } from "@/lib/device";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import type { Ticket } from "@/lib/ticketData";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

type View = "roster" | "tickets" | "map" | "detail";
type DetailTab = "details" | "repair" | "billing";

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
  const [detailTab, setDetailTab] = useState<DetailTab>("details");

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
    const techUsers = users.filter((u) => (u.role || "").toUpperCase() === "TECHNICIAN");
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
    setDetailTab("details");
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
        <DetailView ticket={activeTicket} tab={detailTab} setTab={setDetailTab} />
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
                <span className="mtech-rail-loc">{t.location || "—"}</span>
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
          suppressMarkers: false,
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
            const bounds = new g.maps.LatLngBounds();
            resolved.forEach((s, i) => {
              new g.maps.Marker({
                position: s.pos,
                map: mapRef.current,
                label: { text: String(i + 1), color: "#fff", fontWeight: "700" },
              });
              bounds.extend(s.pos);
            });
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
}: {
  ticket: Ticket;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
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
          <span>{ticket.location}</span>
          <span>{openDays(ticket)}d</span>
          {ticket.warranty && <span>{ticket.warranty}</span>}
        </div>
      </div>

      {/* Tabs only exist inside an open ticket */}
      <div className="mtech-detail-tabs">
        <button className={tab === "details" ? "active" : ""} onClick={() => setTab("details")} type="button">
          Details
        </button>
        <button className={tab === "repair" ? "active" : ""} onClick={() => setTab("repair")} type="button">
          Repair
        </button>
        <button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")} type="button">
          Billing
        </button>
      </div>

      {tab === "details" && <DetailsTab ticket={ticket} />}
      {tab === "repair" && <RepairTab ticket={ticket} />}
      {tab === "billing" && <BillingTab ticket={ticket} />}
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

function DetailsTab({ ticket }: { ticket: Ticket }) {
  return (
    <div className="mtech-panel">
      <div className="mtech-actions">
        <button type="button" disabled title="Coming soon">On my way</button>
        <button type="button" disabled title="Coming soon">Check In</button>
        <button type="button" disabled title="Coming soon">Check Out</button>
      </div>

      <div className="mtech-section-title">Customer Information</div>
      <InfoRow label="Name" value={ticket.customer} />
      <InfoRow label="Address" value={fmtAddress(ticket)} />
      <InfoRow label="Home Phone" value={ticket.phone} />
      <InfoRow label="Cell Phone" value={ticket.secondPhone} />
      <InfoRow label="Email" value={ticket.email} />

      <div className="mtech-section-title">Product Information</div>
      <InfoRow label="Brand" value={ticket.manufacturer} />
      <InfoRow label="Product" value={productLabel(ticket)} />
      <InfoRow label="Model" value={ticket.model} />
      <InfoRow label="Serial" value={ticket.serial} />
      <InfoRow label="Warranty" value={ticket.warranty} />

      {ticket.problemDescription && (
        <>
          <div className="mtech-section-title">Problem</div>
          <p className="mtech-problem">{ticket.problemDescription}</p>
        </>
      )}
    </div>
  );
}

function RepairTab({ ticket }: { ticket: Ticket }) {
  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Repair Information</div>
      <InfoRow label="Model Code" value={ticket.model} />
      <InfoRow label="Model Version" value={ticket.modelVersion} />
      <InfoRow label="Serial No" value={ticket.serial} />
      <InfoRow label="Diagnosed" value={ticket.diagnosed === "Y" ? "Yes" : "No"} />
      <InfoRow label="Internal Note" value={ticket.internalNote} />

      <div className="mtech-section-title">Attachments</div>
      <div className="mtech-muted">Photo upload coming soon.</div>
    </div>
  );
}

function BillingTab({ ticket }: { ticket: Ticket }) {
  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Billing Info</div>
      <table className="mtech-bill">
        <thead>
          <tr>
            <th>Cost</th>
            <th>Fee</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Labor</td>
            <td>$0.00</td>
          </tr>
          <tr>
            <td>Parts</td>
            <td>$0.00</td>
          </tr>
          <tr>
            <td>Diagnose (Trip)</td>
            <td>$0.00</td>
          </tr>
          <tr>
            <td>Tax</td>
            <td>$0.00</td>
          </tr>
          <tr className="mtech-bill-total">
            <td>Total</td>
            <td>$0.00</td>
          </tr>
        </tbody>
      </table>
      <div className="mtech-muted">
        Service has a limited warranty of 90 days for parts and 30 days for labor. Billing entry coming soon.
      </div>
      <InfoRow label="Customer Name" value={ticket.customer} />
    </div>
  );
}
