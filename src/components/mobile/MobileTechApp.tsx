import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { setDesktopOverride } from "@/lib/device";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";
import { ALL_TECHNICIANS, getTechniciansForLocation } from "@/lib/locations";
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

  // Technician roster for managers (within allowed locations).
  const roster = useMemo(() => {
    let techs: string[] = [];
    if (allowedLocations === null) {
      techs = ALL_TECHNICIANS;
    } else {
      const set = new Set<string>();
      for (const loc of allowedLocations) getTechniciansForLocation(loc).forEach((t) => set.add(t));
      techs = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return techs;
  }, [allowedLocations]);

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
  roster: string[];
  onSelect: (tech: string) => void;
}) {
  return (
    <div className="mtech-scroll">
      {roster.length === 0 && <div className="mtech-empty">No technicians in your locations.</div>}
      {roster.map((tech) => (
        <button key={tech} className="mtech-roster-card" onClick={() => onSelect(tech)} type="button">
          <div className="mtech-roster-info">
            <span className="mtech-roster-role">Technician</span>
            <span className="mtech-roster-name">{tech}</span>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const init = () => {
      const g = (window as any).google;
      if (!g?.maps || !mapEl.current) return;
      const map = new g.maps.Map(mapEl.current, {
        zoom: 9,
        center: { lat: 39.5, lng: -98.35 },
        disableDefaultUI: true,
        zoomControl: true,
      });
      mapRef.current = map;

      const geocoder = new g.maps.Geocoder();
      const bounds = new g.maps.LatLngBounds();
      const geocode = (address: string) =>
        new Promise<{ lat: number; lng: number } | null>((resolve) => {
          geocoder.geocode({ address }, (results: any, status: string) => {
            if (status === "OK" && results?.[0]) {
              const p = results[0].geometry.location;
              resolve({ lat: p.lat(), lng: p.lng() });
            } else resolve(null);
          });
        });

      (async () => {
        let placed = 0;
        for (let i = 0; i < tickets.length; i++) {
          const t = tickets[i];
          const addr = fmtAddress(t) || t.city || t.location;
          if (!addr) continue;
          const pos = await geocode(addr);
          if (cancelled || !pos) continue;
          new g.maps.Marker({
            position: pos,
            map,
            label: { text: String(i + 1), color: "#fff", fontWeight: "700" },
          });
          bounds.extend(pos);
          placed++;
        }
        if (!cancelled && placed > 0) map.fitBounds(bounds);
      })();
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
  }, [tickets]);

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
