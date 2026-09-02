/**
 * Admin > Technician Whereabouts — where each active technician's current
 * job site is, per branch or company-wide. Real live GPS (see
 * technicianWhereabouts.ts's own header) when a technician is clocked in,
 * has a confirmed Location Consent document on file, and has a fresh ping —
 * otherwise inferred from today's ticket schedule, the same real data
 * Mileage's day-route view and Work Map already read.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import type * as Leaflet from "leaflet";
import { Check, ChevronLeft, ClipboardList, Loader2, MapPin, RefreshCw, Search, X } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getTechnicianWhereabouts, distinctBranches, LIVE_FRESH_MS, type TechnicianWhereabouts } from "@/lib/supabase/technicianWhereabouts";
import { getSignableDocuments } from "@/lib/supabase/signableDocuments";
import { TechnicianDayRouteModal } from "@/components/TechnicianDayRouteModal";
import { getCompanyMapProvider } from "@/lib/supabase/companySettings";
import {
  getLeaflet,
  loadGoogleMapsScript,
  makeGeocoder,
  getOfficeCoordinates,
  attachLeafletResizeFix,
  OSM_TILE_URL,
  OSM_ATTRIBUTION,
  type LatLng,
} from "@/lib/mapEngine";

/** "12s ago" / "3m ago" / "2h ago" — for the live-GPS sidebar/tooltip timestamp. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

const LIVE_COLOR = "#3b82f6";
// A ping older than LIVE_FRESH_MS (technicianWhereabouts.ts) is still shown
// and still preferred over the schedule proxy — never dropped just because
// it's stale — but reads as "Active" in a dimmer violet instead of "Live"
// in blue, so an admin isn't told someone is live right now when they've
// actually gone quiet (lost signal, closed the tab) mid-shift.
const ACTIVE_COLOR = "#a78bfa";

const STATUS_STYLE: Record<TechnicianWhereabouts["status"], { color: string; label: string }> = {
  current: { color: "#22c55e", label: "At job now" },
  scheduled: { color: "#2dd4bf", label: "Scheduled, not checked in" },
  last: { color: "#f59e0b", label: "Last stop today" },
  none: { color: "#64748b", label: "No job today" },
};

// One dot color per technician, stable across renders/refreshes (same name
// always hashes to the same hue) — lets a color be visually matched between
// the map and the sidebar list without needing a separate legend for every
// technician. Status (at job now / last stop / no job) is layered on top as
// the dot's ring color instead, so both signals stay visible at once.
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
function technicianColor(name: string): string {
  const hue = hashString(name) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// Several technicians commonly resolve to the exact same coordinates (e.g.
// everyone with no job today falls back to the same branch office point) —
// left as-is, later markers completely cover earlier ones and only the
// last-drawn technician is visible or clickable. Nudges each member of a
// same-point cluster into a small ring around the original point instead.
function spreadOverlappingPoints(points: Array<{ pt: LatLng; tech: TechnicianWhereabouts }>): Array<{ pt: LatLng; tech: TechnicianWhereabouts }> {
  const groups = new Map<string, Array<{ pt: LatLng; tech: TechnicianWhereabouts }>>();
  for (const p of points) {
    const key = `${p.pt.lat.toFixed(5)},${p.pt.lng.toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const OFFSET_DEG = 0.0009; // ~100m at these latitudes — enough to separate dots without drifting onto a different street.
  const result: Array<{ pt: LatLng; tech: TechnicianWhereabouts }> = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    group.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      result.push({ tech: p.tech, pt: { lat: p.pt.lat + OFFSET_DEG * Math.sin(angle), lng: p.pt.lng + OFFSET_DEG * Math.cos(angle) } });
    });
  }
  return result;
}

const AUTO_REFRESH_MS = 60_000;

export function TechnicianWhereaboutsPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [rows, setRows] = useState<TechnicianWhereabouts[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [nameSearch, setNameSearch] = useState("");

  const load = async () => {
    try {
      const r = await getTechnicianWhereabouts();
      setRows(r);
      setLoadError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load technician whereabouts.");
    }
  };

  // Auto-refreshes so dispatchers watching this page don't need to remember
  // to hit a manual button — every-minute cadence balances staying current
  // against re-querying + re-geocoding on every render.
  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  const branches = useMemo(() => distinctBranches(rows ?? []), [rows]);
  const filtered = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!branchFilter || r.branch === branchFilter) && (!q || r.name.toLowerCase().includes(q)));
  }, [rows, branchFilter, nameSearch]);
  const withJob = filtered.filter((r) => r.status !== "none");
  const noJob = filtered.filter((r) => r.status === "none");

  // ── Map ──────────────────────────────────────────────────────────────
  const [mapProvider, setMapProvider] = useState<"google" | "leaflet" | null>(null);
  useEffect(() => {
    void getCompanyMapProvider().then(setMapProvider);
  }, []);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<Leaflet.Map | null>(null);
  const googleMapRef = useRef<any>(null);
  const [L, setL] = useState<typeof Leaflet | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const leafletLayersRef = useRef<Array<{ remove: () => void }>>([]);
  const googleOverlaysRef = useRef<any[]>([]);
  const [mapBuilding, setMapBuilding] = useState(false);
  const [geocodeMisses, setGeocodeMisses] = useState(0);
  // Geocoded point per technician, keyed by name — filled in once the map
  // finishes building, read by the sidebar's click-to-zoom handler below.
  const techPointsRef = useRef<Map<string, LatLng>>(new Map());
  const [routeModalTech, setRouteModalTech] = useState<TechnicianWhereabouts | null>(null);

  // Technicians Permission List — who actually has a fully-signed Location
  // Consent document and who's ever gotten a real GPS ping through (proof
  // sharing has actually worked for them, not just that they clicked
  // "allow"). Loaded lazily, only the first time the panel is opened.
  const [showPermissionList, setShowPermissionList] = useState(false);
  const [confirmedConsentProfileIds, setConfirmedConsentProfileIds] = useState<Set<string> | null>(null);
  const [permissionListError, setPermissionListError] = useState<string | null>(null);
  const [permissionListSearch, setPermissionListSearch] = useState("");
  const [permissionListBranchFilter, setPermissionListBranchFilter] = useState("");
  const [permissionListConsentFilter, setPermissionListConsentFilter] = useState<"all" | "has" | "missing">("all");
  const openPermissionList = async () => {
    setShowPermissionList(true);
    if (confirmedConsentProfileIds) return;
    try {
      const docs = await getSignableDocuments("location_consent");
      setConfirmedConsentProfileIds(
        new Set(
          docs
            .filter((d) => d.status === "confirmed")
            .map((d) => (d.formData as { employeeId?: string })?.employeeId)
            .filter((id): id is string => !!id)
        )
      );
    } catch (err) {
      setPermissionListError(err instanceof Error ? err.message : "Failed to load consent status.");
    }
  };

  const zoomToTechnician = (name: string) => {
    const pt = techPointsRef.current.get(name);
    if (!pt) return;
    if (mapProvider === "leaflet" && leafletMapRef.current) {
      leafletMapRef.current.flyTo([pt.lat, pt.lng], 14, { duration: 0.6 });
    } else if (mapProvider === "google" && googleMapRef.current) {
      googleMapRef.current.panTo(pt);
      googleMapRef.current.setZoom(14);
    }
  };

  useEffect(() => {
    if (mapProvider !== "leaflet" || L) return;
    let cancelled = false;
    getLeaflet().then((mod) => {
      if (!cancelled) setL(mod);
    });
    return () => {
      cancelled = true;
    };
  }, [mapProvider, L]);

  useEffect(() => {
    if (mapProvider !== "leaflet" || !L || !mapEl.current || leafletMapRef.current) return;
    const container = mapEl.current;
    const map = L.map(container, { zoom: 7, center: [35.5, -85.3], zoomControl: true });
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    leafletMapRef.current = map;
    const detach = attachLeafletResizeFix(map, container);
    setMapReady(true);
    return () => {
      detach();
      map.remove();
      leafletMapRef.current = null;
      setMapReady(false);
    };
  }, [mapProvider, L]);

  useEffect(() => {
    if (mapProvider !== "google" || !mapEl.current || googleMapRef.current) return;
    let cancelled = false;
    void loadGoogleMapsScript().then(() => {
      if (cancelled || !mapEl.current) return;
      const g = (window as any).google;
      googleMapRef.current = new g.maps.Map(mapEl.current, { zoom: 7, center: { lat: 35.5, lng: -85.3 } });
      setMapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mapProvider]);

  useEffect(() => {
    if (!mapProvider || !mapReady || filtered.length === 0) return;
    if (mapProvider === "leaflet" && !L) return;
    let cancelled = false;

    (async () => {
      setMapBuilding(true);
      const geocode = makeGeocoder(mapProvider);
      const points: Array<{ pt: LatLng; tech: TechnicianWhereabouts }> = [];
      let misses = 0;

      for (const tech of filtered) {
        // A fresh live GPS ping is exact — skip geocoding the ticket
        // address entirely when one's available.
        const addressPt = tech.liveLocation ? null : tech.address ? await geocode(tech.address) : null;
        if (cancelled) return;
        const pt = tech.liveLocation ?? addressPt ?? getOfficeCoordinates(tech.branch);
        if (pt) points.push({ pt, tech });
        else misses++;
      }
      if (cancelled) return;
      setGeocodeMisses(misses);
      const spread = spreadOverlappingPoints(points);
      techPointsRef.current = new Map(spread.map(({ pt, tech }) => [tech.name, pt]));

      leafletLayersRef.current.forEach((l) => l.remove());
      leafletLayersRef.current = [];
      googleOverlaysRef.current.forEach((o) => o.setMap(null));
      googleOverlaysRef.current = [];

      if (spread.length === 0) {
        setMapBuilding(false);
        return;
      }

      if (mapProvider === "leaflet" && L) {
        const map = leafletMapRef.current!;
        spread.forEach(({ pt, tech }) => {
          const tooltipText = tech.liveLocation
            ? `${tech.name} — 📍 ${tech.liveLocation.isLive ? "Live" : "Active"} · updated ${timeAgo(tech.liveLocation.updatedAt)}`
            : `${tech.name} — ${STATUS_STYLE[tech.status].label}`;
          if (tech.liveLocation) {
            const halo = L.circleMarker([pt.lat, pt.lng], {
              radius: 13,
              fillOpacity: 0,
              color: tech.liveLocation.isLive ? LIVE_COLOR : ACTIVE_COLOR,
              weight: 2,
              className: "whereabouts-live-halo",
            }).addTo(map);
            leafletLayersRef.current.push(halo);
          }
          const marker = L.circleMarker([pt.lat, pt.lng], {
            radius: 8,
            fillColor: technicianColor(tech.name),
            fillOpacity: 1,
            color: STATUS_STYLE[tech.status].color,
            weight: 3,
            className: "whereabouts-marker",
          }).addTo(map);
          marker.bindTooltip(tooltipText, { direction: "top", offset: [0, -8] });
          marker.on("click", () => setRouteModalTech(tech));
          leafletLayersRef.current.push(marker);
        });
        map.fitBounds(L.latLngBounds(spread.map((p) => [p.pt.lat, p.pt.lng] as [number, number])), { padding: [40, 40] });
      } else if (mapProvider === "google") {
        const g = (window as any).google;
        const map = googleMapRef.current;
        const bounds = new g.maps.LatLngBounds();
        spread.forEach(({ pt, tech }) => {
          const title = tech.liveLocation
            ? `${tech.name} — 📍 ${tech.liveLocation.isLive ? "Live" : "Active"} · updated ${timeAgo(tech.liveLocation.updatedAt)}`
            : `${tech.name} — ${STATUS_STYLE[tech.status].label}`;
          if (tech.liveLocation) {
            const halo = new g.maps.Marker({
              map,
              position: pt,
              icon: { path: g.maps.SymbolPath.CIRCLE, scale: 13, fillOpacity: 0, strokeColor: tech.liveLocation.isLive ? LIVE_COLOR : ACTIVE_COLOR, strokeWeight: 2 },
              clickable: false,
              zIndex: 1,
            });
            googleOverlaysRef.current.push(halo);
          }
          const marker = new g.maps.Marker({
            map,
            position: pt,
            icon: {
              path: g.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: technicianColor(tech.name),
              fillOpacity: 1,
              strokeColor: STATUS_STYLE[tech.status].color,
              strokeWeight: 3,
            },
            title,
            zIndex: 2,
          });
          marker.addListener("click", () => setRouteModalTech(tech));
          googleOverlaysRef.current.push(marker);
          bounds.extend(pt);
        });
        map.fitBounds(bounds);
      }
      setMapBuilding(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapProvider, mapReady, L, filtered.map((r) => `${r.name}|${r.liveLocation ? `${r.liveLocation.lat},${r.liveLocation.lng}` : r.address ?? r.branch}`).join(",")]);

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        <div className="flex items-center gap-3 text-white">
          <button type="button" onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
            <p className="mt-1 text-sm text-slate-300">
              Live GPS while a technician is clocked in and sharing — otherwise inferred from today's schedule.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void openPermissionList()}
            className="btn ml-auto text-sm shrink-0"
          >
            <ClipboardList className="h-4 w-4" />
            Technicians Permission List
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="glass-input text-sm py-1.5 px-3 rounded-md shrink-0 w-48"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500 ml-auto flex items-center gap-1.5">
            {filtered.length} technician{filtered.length === 1 ? "" : "s"}
            {branchFilter ? ` · ${branchFilter}` : " · all branches"}
            {lastUpdated && (
              <span className="flex items-center gap-1 text-slate-600">
                · <RefreshCw className="h-2.5 w-2.5" /> Updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </span>
        </div>

        {loadError && <p className="mt-6 text-sm text-red-400">{loadError}</p>}

        {/* The map container below is ALWAYS rendered (never behind a
            `!rows` check) — the map-building effect only depends on
            [mapProvider, L, filtered], not on `rows` itself, so if this div
            only mounted once rows finished loading, the effect could easily
            run first, find mapEl.current still null, bail out, and never
            fire again since its own dependencies never changed afterward
            (same pitfall MileageDayRouteModal.tsx already documents). */}
        {!loadError && (
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-4">
              <div className="relative h-[640px] rounded-lg border border-white/10 overflow-hidden bg-slate-800">
                <div ref={mapEl} className="h-full w-full" />
                {mapBuilding && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                  </div>
                )}
                {!mapProvider && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">No map provider configured.</div>
                )}
              </div>
              {geocodeMisses > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-400">
                  {geocodeMisses} technician{geocodeMisses === 1 ? "" : "s"} couldn't be placed on the map (no resolvable address or branch).
                </p>
              )}
              <p className="mt-3 text-[11px] text-slate-500">
                Each dot's fill color identifies the technician (matches the sidebar) — hover for their name, click for today's route, or click a name below to zoom in. Ring color is status:
              </p>
              <div className="mt-1.5 flex items-center gap-4 text-[11px] text-slate-400">
                {(Object.keys(STATUS_STYLE) as TechnicianWhereabouts["status"][]).map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-600" style={{ boxShadow: `0 0 0 2px ${STATUS_STYLE[s].color}` }} />
                    {STATUS_STYLE[s].label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-600" style={{ boxShadow: `0 0 0 2px ${LIVE_COLOR}` }} />
                  Live GPS (blue halo)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-600" style={{ boxShadow: `0 0 0 2px ${ACTIVE_COLOR}` }} />
                  Active GPS (violet halo) — updated {LIVE_FRESH_MS / 60_000}+ minutes ago
                </span>
              </div>
            </div>

            <div className="lg:col-span-2 flex flex-col max-h-[640px]">
              <div className="relative shrink-0 mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  placeholder="Search technician name…"
                  className="glass-input text-sm py-1.5 pl-8 pr-7 rounded-md w-full"
                />
                {nameSearch && (
                  <button
                    type="button"
                    onClick={() => setNameSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="space-y-1.5 overflow-y-auto flex-1">
              {!rows ? (
                <BrandedLoader label="Loading technicians…" />
              ) : (
              <>
              {withJob.map((tech) => (
                <div
                  key={tech.name}
                  onClick={() => zoomToTechnician(tech.name)}
                  title="Click to zoom to this technician on the map"
                  className="flex items-start gap-2 text-xs px-2.5 py-2 rounded-md bg-slate-800/60 border border-white/5 cursor-pointer hover:bg-slate-800/90 hover:border-white/15 transition-colors"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full mt-1 shrink-0"
                    style={{
                      background: technicianColor(tech.name),
                      boxShadow: tech.liveLocation
                        ? `0 0 0 2px ${STATUS_STYLE[tech.status].color}, 0 0 0 4px ${tech.liveLocation.isLive ? LIVE_COLOR : ACTIVE_COLOR}`
                        : `0 0 0 2px ${STATUS_STYLE[tech.status].color}`,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium">
                      {tech.name} <span className="text-slate-500 font-normal">· {tech.branch || "No branch"}</span>
                    </p>
                    <p className="text-slate-400 mt-0.5">
                      {STATUS_STYLE[tech.status].label}
                      {tech.ticketNo && (
                        <>
                          {" — "}
                          <Link
                            to="/ticket/$ticketNo"
                            params={{ ticketNo: tech.ticketNo }}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {tech.ticketNo}
                          </Link>
                        </>
                      )}
                      {tech.timeSlot && ` · ${tech.timeSlot}`}
                    </p>
                    {tech.liveLocation ? (
                      <p className="mt-0.5 flex items-center gap-1" style={{ color: tech.liveLocation.isLive ? LIVE_COLOR : ACTIVE_COLOR }}>
                        <MapPin className="h-3 w-3 shrink-0" />📍 {tech.liveLocation.isLive ? "Live" : "Active"} · updated {timeAgo(tech.liveLocation.updatedAt)}
                      </p>
                    ) : (
                      tech.address && <p className="text-slate-500 mt-0.5 truncate flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{tech.address}</p>
                    )}
                  </div>
                </div>
              ))}
              {noJob.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide pt-2 pb-1">No job scheduled today ({noJob.length})</p>
                  {noJob.map((tech) => (
                    <div
                      key={tech.name}
                      onClick={() => zoomToTechnician(tech.name)}
                      title="Click to zoom to this technician on the map"
                      className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md bg-slate-800/30 cursor-pointer hover:bg-slate-800/60 transition-colors"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{
                          background: technicianColor(tech.name),
                          boxShadow: tech.liveLocation
                            ? `0 0 0 2px ${STATUS_STYLE.none.color}, 0 0 0 4px ${tech.liveLocation.isLive ? LIVE_COLOR : ACTIVE_COLOR}`
                            : `0 0 0 2px ${STATUS_STYLE.none.color}`,
                        }}
                      />
                      <span className="text-slate-300">{tech.name}</span>
                      <span className="text-slate-500">· {tech.branch || "No branch"}</span>
                      {tech.liveLocation && (
                        <span className="ml-auto shrink-0" style={{ color: tech.liveLocation.isLive ? LIVE_COLOR : ACTIVE_COLOR }}>
                          📍 {tech.liveLocation.isLive ? "Live" : "Active"}
                        </span>
                      )}
                    </div>
                  ))}
                </>
              )}
              {filtered.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No active technicians for this filter.</p>}
              </>
              )}
              </div>
            </div>
          </div>
        )}
      </div>
      {routeModalTech && (
        <TechnicianDayRouteModal
          technicianName={routeModalTech.name}
          branch={routeModalTech.branch}
          profileId={routeModalTech.profileId}
          liveLocation={routeModalTech.liveLocation}
          onClose={() => setRouteModalTech(null)}
        />
      )}

      {showPermissionList && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowPermissionList(false)}>
          <div
            className="bg-slate-900 border border-white/10 rounded-lg max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">Technicians Permission List</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Consent = Location Sharing Consent document signed by both sides. Sharing = has ever sent a real GPS ping.
                </p>
              </div>
              <button type="button" onClick={() => setShowPermissionList(false)} className="p-1 hover:bg-white/10 rounded transition text-slate-300 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-white/10 flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search technician name..."
                value={permissionListSearch}
                onChange={(e) => setPermissionListSearch(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md w-52"
              />
              <select
                value={permissionListBranchFilter}
                onChange={(e) => setPermissionListBranchFilter(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md w-40"
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select
                value={permissionListConsentFilter}
                onChange={(e) => setPermissionListConsentFilter(e.target.value as "all" | "has" | "missing")}
                className="glass-input text-sm py-1.5 px-3 rounded-md w-44"
              >
                <option value="all">Any Consent Status</option>
                <option value="has">Has Consent</option>
                <option value="missing">Missing Consent</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto">
              {permissionListError ? (
                <p className="p-5 text-sm text-red-400">{permissionListError}</p>
              ) : !rows || !confirmedConsentProfileIds ? (
                <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="border-b border-white/10 text-slate-400 text-xs uppercase">
                      <th className="px-5 py-2 text-left">Technician</th>
                      <th className="px-5 py-2 text-left">Branch</th>
                      <th className="px-5 py-2 text-center">Consent</th>
                      <th className="px-5 py-2 text-center">Location Sharing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows]
                      .filter((tech) => {
                        const q = permissionListSearch.trim().toLowerCase();
                        if (q && !tech.name.toLowerCase().includes(q)) return false;
                        if (permissionListBranchFilter && tech.branch !== permissionListBranchFilter) return false;
                        const hasConsent = confirmedConsentProfileIds.has(tech.profileId);
                        if (permissionListConsentFilter === "has" && !hasConsent) return false;
                        if (permissionListConsentFilter === "missing" && hasConsent) return false;
                        return true;
                      })
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((tech) => {
                      const hasConsent = confirmedConsentProfileIds.has(tech.profileId);
                      const hasSharing = !!tech.liveLocation;
                      return (
                        <tr key={tech.profileId} className="border-b border-white/5">
                          <td className="px-5 py-2.5 text-white font-medium">{tech.name}</td>
                          <td className="px-5 py-2.5 text-slate-400">{tech.branch || "—"}</td>
                          <td className="px-5 py-2.5 text-center">
                            {hasConsent ? <Check className="h-4 w-4 text-emerald-400 inline" /> : <X className="h-4 w-4 text-red-400 inline" />}
                          </td>
                          <td className="px-5 py-2.5 text-center">
                            {hasSharing ? <Check className="h-4 w-4 text-emerald-400 inline" /> : <X className="h-4 w-4 text-red-400 inline" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
