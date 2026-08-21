/**
 * Admin > Technician Whereabouts — where each active technician's current
 * job site is, per branch or company-wide. Not live GPS (see
 * technicianWhereabouts.ts's own header) — inferred from today's ticket
 * schedule, the same real data Mileage's day-route view and Work Map
 * already read.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type * as Leaflet from "leaflet";
import { ChevronLeft, Loader2, MapPin, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getTechnicianWhereabouts, distinctBranches, type TechnicianWhereabouts } from "@/lib/supabase/technicianWhereabouts";
import { getCompanyMapProvider } from "@/lib/supabase/companySettings";
import {
  getLeaflet,
  loadGoogleMapsScript,
  makeGeocoder,
  getOfficeCoordinates,
  attachLeafletResizeFix,
  createBadgeDivIcon,
  OSM_TILE_URL,
  OSM_ATTRIBUTION,
  type LatLng,
} from "@/lib/mapEngine";

const STATUS_STYLE: Record<TechnicianWhereabouts["status"], { color: string; label: string }> = {
  current: { color: "#22c55e", label: "At job now" },
  last: { color: "#f59e0b", label: "Last stop today" },
  none: { color: "#64748b", label: "No job today" },
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function TechnicianWhereaboutsPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<TechnicianWhereabouts[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [branchFilter, setBranchFilter] = useState<string>("");

  const load = async () => {
    try {
      const r = await getTechnicianWhereabouts();
      setRows(r);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load technician whereabouts.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const branches = useMemo(() => distinctBranches(rows ?? []), [rows]);
  const filtered = useMemo(
    () => (rows ?? []).filter((r) => !branchFilter || r.branch === branchFilter),
    [rows, branchFilter],
  );
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
        const addressPt = tech.address ? await geocode(tech.address) : null;
        if (cancelled) return;
        const pt = addressPt ?? getOfficeCoordinates(tech.branch);
        if (pt) points.push({ pt, tech });
        else misses++;
      }
      if (cancelled) return;
      setGeocodeMisses(misses);

      leafletLayersRef.current.forEach((l) => l.remove());
      leafletLayersRef.current = [];
      googleOverlaysRef.current.forEach((o) => o.setMap(null));
      googleOverlaysRef.current = [];

      if (points.length === 0) {
        setMapBuilding(false);
        return;
      }

      if (mapProvider === "leaflet" && L) {
        const map = leafletMapRef.current!;
        points.forEach(({ pt, tech }) => {
          const color = STATUS_STYLE[tech.status].color;
          const marker = L.marker([pt.lat, pt.lng], {
            icon: createBadgeDivIcon(
              L,
              `<div style="background:${color};color:#fff;font-size:11px;font-weight:bold;border:2px solid #fff;border-radius:6px;padding:2px 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${tech.name}</div>`,
              { className: "whereabouts-marker", anchor: "bottom" },
            ),
          }).addTo(map);
          leafletLayersRef.current.push(marker);
        });
        map.fitBounds(L.latLngBounds(points.map((p) => [p.pt.lat, p.pt.lng] as [number, number])), { padding: [40, 40] });
      } else if (mapProvider === "google") {
        const g = (window as any).google;
        const map = googleMapRef.current;
        const bounds = new g.maps.LatLngBounds();
        points.forEach(({ pt, tech }) => {
          const color = STATUS_STYLE[tech.status].color;
          const marker = new g.maps.Marker({
            map,
            position: pt,
            label: { text: initialsOf(tech.name), color: "#fff", fontSize: "11px", fontWeight: "bold" },
            icon: { path: g.maps.SymbolPath.CIRCLE, scale: 14, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
            title: tech.name,
          });
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
  }, [mapProvider, mapReady, L, filtered.map((r) => `${r.name}|${r.address ?? r.branch}`).join(",")]);

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        <div className="flex items-center gap-3 text-white">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
            <p className="mt-1 text-sm text-slate-300">
              Each technician's current job site, inferred from today's schedule — not live GPS.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="glass-input text-sm py-1.5 px-3 rounded-md"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <button type="button" onClick={handleRefresh} disabled={refreshing} className="btn flex items-center gap-1.5">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
          <span className="text-xs text-slate-500 ml-auto">
            {filtered.length} technician{filtered.length === 1 ? "" : "s"}
            {branchFilter ? ` · ${branchFilter}` : " · all branches"}
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
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <div className="relative h-[520px] rounded-lg border border-white/10 overflow-hidden bg-slate-800">
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
              <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400">
                {(Object.keys(STATUS_STYLE) as TechnicianWhereabouts["status"][]).map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_STYLE[s].color }} />
                    {STATUS_STYLE[s].label}
                  </span>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2 space-y-1.5 max-h-[520px] overflow-y-auto">
              {!rows ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading technicians…
                </div>
              ) : (
              <>
              {withJob.map((tech) => (
                <div key={tech.name} className="flex items-start gap-2 text-xs px-2.5 py-2 rounded-md bg-slate-800/60 border border-white/5">
                  <span className="h-2.5 w-2.5 rounded-full mt-1 shrink-0" style={{ background: STATUS_STYLE[tech.status].color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium">
                      {tech.name} <span className="text-slate-500 font-normal">· {tech.branch || "No branch"}</span>
                    </p>
                    <p className="text-slate-400 mt-0.5">
                      {STATUS_STYLE[tech.status].label}
                      {tech.ticketNo && (
                        <>
                          {" — "}
                          <Link to="/ticket/$ticketNo" params={{ ticketNo: tech.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
                            {tech.ticketNo}
                          </Link>
                        </>
                      )}
                      {tech.timeSlot && ` · ${tech.timeSlot}`}
                    </p>
                    {tech.address && <p className="text-slate-500 mt-0.5 truncate flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{tech.address}</p>}
                  </div>
                </div>
              ))}
              {noJob.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide pt-2 pb-1">No job scheduled today ({noJob.length})</p>
                  {noJob.map((tech) => (
                    <div key={tech.name} className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md bg-slate-800/30">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: STATUS_STYLE.none.color }} />
                      <span className="text-slate-300">{tech.name}</span>
                      <span className="text-slate-500">· {tech.branch || "No branch"}</span>
                    </div>
                  ))}
                </>
              )}
              {filtered.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No active technicians for this filter.</p>}
              </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
