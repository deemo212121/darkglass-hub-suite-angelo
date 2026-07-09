import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  ArrowLeft,
  ChevronRight,
  Send,
  Ticket as TicketIcon,
  MapPin,
  MessageCircle,
  FileText,
  DollarSign,
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
  type UIPartRow,
} from "@/lib/supabase/tickets";
import { getMyProfileId } from "@/lib/supabase/users";
import { lookupGeocode, storeGeocode } from "@/lib/supabase/geocodeCache";
import {
  getDmMessages,
  getOrCreateDmThread,
  sendMessage,
  subscribeToMessages,
  type MessageRow,
  type DmThreadRow,
} from "@/lib/supabase/messaging";
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

type View =
  | "roster"
  | "tickets"
  | "map"
  | "detail"
  | "chat"
  | "home"
  | "payroll"
  | "parts"
  | "sheets";
type DetailTab = "general" | "tracking" | "parts" | "billing";

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
  const { email, displayName, role, companyId, allowedLocations, logout, uid } = useAuth();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const isSelfRole = role ? SELF_ROLES.has(role.toUpperCase()) : false;

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
      "parts",
      "sheets",
    ];
    if (stored && (known as string[]).includes(stored)) {
      return stored as View;
    }
    return isSelfRole ? "tickets" : "roster";
  });
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
      : view === "sheets"
      ? "sheets"
      : view === "payroll"
      ? "payroll"
      : view === "map"
      ? "route"
      : "tickets"; // tickets, roster, detail, home, parts all highlight Tickets

  return (
    <div className="mtech">
      {/* ── Fixed top header ───────────────────────────────────────── */}
      <AppHeaderMobile
        logoSrc={logo}
        userName={headerName}
        showBack={showTopBack}
        onBack={handleTopBack}
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
          />
        )}

        {view === "map" && (
          <RouteMapView
            tickets={myTickets.filter((t) => {
              if (isDone(t.status)) return false;
              const status = String(t.status || "").toLowerCase();
              if (status.startsWith("csr-assigned to asc")) return false;
              if (status.startsWith("csr-needs scheduling")) return false;
              if (status.startsWith("pt-")) return false;
              if (status.includes("resched")) return false;
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
            })}
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

        {view === "chat" && (
          <ChatView
            firebaseUid={uid || ""}
            authorName={displayName || email || "User"}
          />
        )}

        {view === "sheets" && (
          <MobileStubView
            title="Tech Sheets"
            message="Tech Sheets browsing is best experienced on desktop. Open the desktop site on a computer to look up model documents."
          />
        )}

        {view === "payroll" && (
          <MobilePayrollView userName={headerName} />
        )}

        {/* home / parts sub-views still reachable but not in bottom nav — redirect to tickets */}
        {view === "home" && (
          <MobileHomeView
            userName={headerName}
            openTickets={myTickets.filter((t) => !isDone(t.status)).length}
            onOpenTickets={() => setView("tickets")}
            onOpenPayroll={() => setView("payroll")}
            onOpenParts={() => setView("sheets")}
            onOpenSheets={() => setView("sheets")}
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
  onLogout,
}: {
  logoSrc: string;
  userName: string;
  showBack: boolean;
  onBack: () => void;
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

      {/* Right: profile bubble → logout dropdown */}
      <div className="mtech-app-header-right">
        <button
          type="button"
          className="mtech-app-profile-btn"
          onClick={() => setMenu((m) => !m)}
          aria-label="Account menu"
        >
          {initials}
        </button>
        {menu && (
          <>
            <div className="mtech-menu-overlay" onClick={() => setMenu(false)} />
            <div className="mtech-app-profile-menu">
              <div className="mtech-app-profile-name">{userName}</div>
              <div className="mtech-app-profile-divider" />
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
type BottomTab = "tickets" | "route" | "chat" | "sheets" | "payroll";
const BOTTOM_TABS: Array<{ id: BottomTab; label: string; icon: React.ReactNode }> = [
  { id: "tickets", label: "Tickets",   icon: <TicketIcon  className="mtech-bottom-tab-svg" /> },
  { id: "route",   label: "Route",     icon: <MapPin      className="mtech-bottom-tab-svg" /> },
  { id: "chat",    label: "Chat",      icon: <MessageCircle className="mtech-bottom-tab-svg" /> },
  { id: "sheets",  label: "Tech Sheet",icon: <FileText    className="mtech-bottom-tab-svg" /> },
  { id: "payroll", label: "Payroll",   icon: <DollarSign  className="mtech-bottom-tab-svg" /> },
];

function BottomNav({
  active,
  onSelect,
}: {
  active: BottomTab;
  onSelect: (tab: BottomTab) => void;
}) {
  return (
    <nav className="mtech-bottom-nav" aria-label="Main navigation">
      {BOTTOM_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`mtech-bottom-tab${active === tab.id ? " mtech-bottom-tab-active" : ""}`}
          onClick={() => onSelect(tab.id)}
          aria-label={tab.label}
          aria-current={active === tab.id ? "page" : undefined}
        >
          <span className="mtech-bottom-tab-icon">{tab.icon}</span>
          <span className="mtech-bottom-tab-label">{tab.label}</span>
        </button>
      ))}
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
}: {
  loading: boolean;
  tickets: Ticket[];
  tab: "todo" | "done" | "search";
  setTab: (t: "todo" | "done" | "search") => void;
  search: string;
  setSearch: (s: string) => void;
  onOpen: (t: Ticket) => void;
  techLabel: string;
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
              {/* Left accent strip with tone color */}
              <div className={`mtech-ticket-accent ${statusTone(t.status)}`} />
              {/* Card body */}
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
                {t.schedule && (
                  <div className="mtech-ticket-sched">
                    {t.schedule}
                    {t.model ? ` · ${t.model}` : ""}
                  </div>
                )}
              </div>
              <span className="mtech-ticket-chev-icon">
                <ChevronRight className="h-4 w-4" />
              </span>
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
  // Toggle a full-screen mode where the directions list, top bar, and
  // Start Navigation button are hidden so only the map + its zoom/pan
  // controls are visible. Handy for eyeballing pin positions or showing
  // the route to a customer without the surrounding chrome.
  const [expanded, setExpanded] = useState(false);
  // When the map container resizes (expand toggle) tell Google Maps to
  // recompute so the tiles fill the new dimensions and the route stays
  // centered.
  useEffect(() => {
    const map = mapRef.current;
    const maps = (window as any).google?.maps;
    if (!map || !maps) return;
    // Give the DOM a beat to flip classes / re-layout before Maps recalc.
    const t = window.setTimeout(() => {
      try {
        maps.event.trigger(map, "resize");
        if (stops.length > 0) {
          const bounds = new maps.LatLngBounds();
          for (const s of stops) bounds.extend(s.pos);
          if (origin) bounds.extend(origin);
          map.fitBounds(bounds, 40);
        }
      } catch (err) {
        console.warn("map resize skipped", err);
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [expanded, stops, origin]);

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
      const geocode = async (address: string) => {
        // --- Cache check first (free, instant) ---
        const cached = await lookupGeocode(address);
        if (cached) return cached;
        // --- Cache miss: call Google Geocoding API ---
        const result = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
          geocoder.geocode({ address }, (results: any, status: string) => {
            if (status === "OK" && results?.[0]) {
              const p = results[0].geometry.location;
              resolve({ lat: p.lat(), lng: p.lng() });
            } else resolve(null);
          });
        });
        // --- Store in cache for next time ---
        if (result) void storeGeocode(address, result);
        return result;
      };

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
      ? tickets.find((x) => x.ticketNo === ticketNoOrNull)
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
        <div className="mtech-subbar">
          <span className="mtech-date">{new Date().toLocaleDateString("en-US")}</span>
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
  // Per-visit inline edit state. Techs can edit Repair Status, Cause
  // of Failure, Repair Notes, and Non-Completion Reason from the
  // mobile app — everything else stays read-only because it's owned
  // by dispatch / CSR on the desktop side.
  const [editVisitId, setEditVisitId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    repairStatus: string;
    diagnosis: string;
    resolution: string;
    nonCompletionReason: string;
  }>({ repairStatus: "", diagnosis: "", resolution: "", nonCompletionReason: "" });
  const [savingVisit, setSavingVisit] = useState(false);

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

  const beginEdit = (v: NonNullable<Ticket["visits"]>[number]) => {
    setEditVisitId(v.id);
    setEditDraft({
      repairStatus: String(v.repairStatus ?? ""),
      diagnosis: String(v.diagnosis ?? ""),
      resolution: String(v.resolution ?? ""),
      nonCompletionReason: String(v.nonCompletionReason ?? ""),
    });
  };

  const cancelEdit = () => {
    setEditVisitId(null);
    setEditDraft({ repairStatus: "", diagnosis: "", resolution: "", nonCompletionReason: "" });
  };

  const saveEdit = async (visitId: string) => {
    setSavingVisit(true);
    try {
      await updateTicketVisit(visitId, {
        repairStatus: editDraft.repairStatus,
        diagnosis: editDraft.diagnosis,
        resolution: editDraft.resolution,
        nonCompletionReason: editDraft.nonCompletionReason,
        updateReason: `Tech ${authorName || ""} updated visit`.trim(),
      } as any);
      // Reflect changes locally so the row updates without a re-fetch.
      setVisits((prev) =>
        prev.map((row) =>
          row.id === visitId
            ? {
                ...row,
                repairStatus: editDraft.repairStatus,
                diagnosis: editDraft.diagnosis,
                resolution: editDraft.resolution,
                nonCompletionReason: editDraft.nonCompletionReason,
              }
            : row,
        ),
      );
      cancelEdit();
    } catch (err) {
      console.error("Failed to save visit edit", err);
      alert(
        `Failed to save visit: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSavingVisit(false);
    }
  };

  // "Complete" flow — save the visit edits and flip the parent ticket's
  // repair status to "CL-Ready to Complete". Only available when the
  // tech has filled BOTH Cause of Failure AND Repair Notes. If the tech
  // put anything into Non-Completion Reason, we assume the job wasn't
  // finished and hide the button entirely; they save with Save instead.
  const completeVisit = async (visitId: string) => {
    setSavingVisit(true);
    try {
      // Force the visit's repair status to Ready to Complete so the visit
      // log and the ticket status stay aligned.
      const readyStatus = "CL-Ready to Complete";
      await updateTicketVisit(visitId, {
        repairStatus: readyStatus,
        diagnosis: editDraft.diagnosis,
        resolution: editDraft.resolution,
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
                resolution: editDraft.resolution,
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
    editDraft.resolution.trim().length > 0 &&
    editDraft.nonCompletionReason.trim().length === 0;

  return (
    <div className="mtech-panel">
      <div className="mtech-section-title">Service Tracking</div>
      {loading && <div className="mtech-muted">Loading visits…</div>}
      {!loading && visits.length === 0 && <div className="mtech-muted">No visits recorded yet.</div>}

      <div className="mtech-visit-list">
        {visits.map((v) => {
          const isEditing = editVisitId === v.id;
          return (
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
              {!isEditing && v.diagnosis && (
                <InfoRow label="Cause of Failure (Tech)" value={v.diagnosis} />
              )}
              {!isEditing && v.resolution && (
                <InfoRow label="Repair Notes (Tech)" value={v.resolution} />
              )}
              {!isEditing && v.nonCompletionReason && (
                <InfoRow label="Non-Completion Reason" value={v.nonCompletionReason} />
              )}
              {v.schedNotes && <InfoRow label="Sched Notes" value={v.schedNotes} />}
              {v.note && <InfoRow label="Internal Note" value={v.note} />}

              {isEditing ? (
                <div className="mtech-visit-edit">
                  <label className="mtech-visit-edit-label">Repair Status</label>
                  <select
                    className="mtech-visit-edit-input"
                    value={editDraft.repairStatus}
                    onChange={(e) => setEditDraft((d) => ({ ...d, repairStatus: e.target.value }))}
                  >
                    <option value="">— select —</option>
                    {MOBILE_REPAIR_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <label className="mtech-visit-edit-label">Cause of Failure (Tech)</label>
                  <textarea
                    className="mtech-visit-edit-input"
                    value={editDraft.diagnosis}
                    onChange={(e) => setEditDraft((d) => ({ ...d, diagnosis: e.target.value }))}
                    placeholder="What failed and why"
                    rows={2}
                  />
                  <label className="mtech-visit-edit-label">Repair Notes (Tech)</label>
                  <textarea
                    className="mtech-visit-edit-input"
                    value={editDraft.resolution}
                    onChange={(e) => setEditDraft((d) => ({ ...d, resolution: e.target.value }))}
                    placeholder="What you did to fix it"
                    rows={3}
                  />
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
    BRANCH_MANAGER: "Branch Manager",
    SENIOR_BRANCH_MANAGER: "Senior Branch Manager",
    BIZOPS_MANAGER: "BizOps Manager",
    BIZOPS_SENIOR_MANAGER: "BizOps Senior Manager",
    CSR: "CSR",
    CSR_AGENT: "CSR Agent",
    CSR_TEAM_LEADER: "CSR Team Leader",
    CSR_MANAGER: "CSR Manager",
    PARTS: "Parts",
    PARTS_MANAGER: "Parts Manager",
    CLAIMS: "Claims",
    CLAIMS_MANAGER: "Claims Manager",
    TRIAGE_USER: "Triage",
    TRIAGE_MANAGER: "Triage Manager",
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
    const poll = async () => {
      try {
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
    return contacts.filter((c) => {
      if (roleFilter && c.roleLabel !== roleFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [contacts, roleFilter, searchName]);

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
                    {m.body}
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
        {visibleContacts.map((c) => (
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
              <span className="mtech-chat-contact-name">{c.name}</span>
              <span className="mtech-chat-contact-role-label">{c.roleLabel}</span>
            </div>
            <ChevronRight className="mtech-chat-contact-chev h-4 w-4" />
          </button>
        ))}
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

// Home tab: high-level greeting + quick jumps to the same sidebar
// destinations so users can navigate without opening the drawer.
function MobileHomeView({
  userName,
  openTickets,
  onOpenTickets,
  onOpenPayroll,
  onOpenParts,
  onOpenSheets,
}: {
  userName: string;
  openTickets: number;
  onOpenTickets: () => void;
  onOpenPayroll: () => void;
  onOpenParts: () => void;
  onOpenSheets: () => void;
}) {
  const hourNow = new Date().getHours();
  const greeting =
    hourNow < 12 ? "Good morning" : hourNow < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="mtech-scroll mtech-home">
      <div className="mtech-home-greeting">
        <div className="mtech-home-hi">{greeting},</div>
        <div className="mtech-home-name">{userName}</div>
      </div>

      <div className="mtech-home-stats">
        <div className="mtech-home-stat">
          <div className="mtech-home-stat-value">{openTickets}</div>
          <div className="mtech-home-stat-label">Open Tickets</div>
        </div>
      </div>

      <div className="mtech-home-grid">
        <button className="mtech-home-tile" type="button" onClick={onOpenTickets}>
          <TicketIcon className="mtech-home-tile-svg" />
          <span className="mtech-home-tile-label">Tickets</span>
        </button>
        <button className="mtech-home-tile" type="button" onClick={onOpenParts}>
          <FileText className="mtech-home-tile-svg" />
          <span className="mtech-home-tile-label">Tech Sheet</span>
        </button>
        <button className="mtech-home-tile" type="button" onClick={onOpenSheets}>
          <MapPin className="mtech-home-tile-svg" />
          <span className="mtech-home-tile-label">Route</span>
        </button>
        <button className="mtech-home-tile" type="button" onClick={onOpenPayroll}>
          <DollarSign className="mtech-home-tile-svg" />
          <span className="mtech-home-tile-label">Payroll</span>
        </button>
      </div>
    </div>
  );
}

// Payroll tab: table matches the /timecard MobilePayrollPage exactly
// so users get the same experience from either entry point.
interface MobilePayRowInline {
  id: string;
  periodLabel: string;
  periodEnd: string;
  amount: number;
  status: "Paid" | "Pending" | "Processing" | "On Hold";
}

function MobilePayrollView({ userName }: { userName: string }) {
  const rows = useMemo<MobilePayRowInline[]>(() => {
    const out: MobilePayRowInline[] = [];
    const endDate = new Date();
    for (let i = 0; i < 12; i += 1) {
      const start = new Date(endDate);
      start.setDate(endDate.getDate() - 13);
      const label =
        start.toLocaleDateString("en-US") + " – " + endDate.toLocaleDateString("en-US");
      const iso = endDate.toISOString().slice(0, 10);
      const amount = 850 + ((i * 137) % 620);
      let status: MobilePayRowInline["status"];
      if (i === 0) status = "Processing";
      else if (i === 1) status = "Pending";
      else if (i === 4) status = "On Hold";
      else status = "Paid";
      out.push({ id: "TP-" + iso, periodLabel: label, periodEnd: iso, amount, status });
      endDate.setDate(endDate.getDate() - 14);
    }
    return out;
  }, []);

  const totalPaid = rows.filter((r) => r.status === "Paid").reduce((s, r) => s + r.amount, 0);
  const totalPending = rows.filter((r) => r.status !== "Paid").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="mtech-scroll mtech-payroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">{userName}</div>
        <div className="mtech-payroll-sub">Last 12 pay periods</div>
      </div>

      <div className="mtech-payroll-summary">
        <div className="mtech-payroll-card">
          <div className="mtech-payroll-card-label">YTD Paid</div>
          <div className="mtech-payroll-card-value paid">${totalPaid.toFixed(2)}</div>
        </div>
        <div className="mtech-payroll-card">
          <div className="mtech-payroll-card-label">Pending</div>
          <div className="mtech-payroll-card-value pending">${totalPending.toFixed(2)}</div>
        </div>
      </div>

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
                  onClick={() =>
                    alert(
                      `Pay period ${row.periodLabel}\nAmount: $${row.amount.toFixed(2)}\nStatus: ${row.status}`,
                    )
                  }
                >
                  View
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
          </div>
        ))}
      </div>

      <p className="mtech-payroll-note">
        Payroll is issued per pay period. If an amount looks wrong, reach out to your branch manager or HR.
      </p>
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
