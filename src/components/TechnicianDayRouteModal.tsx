/**
 * Technician Whereabouts — "today's route" viewer, opened by clicking a
 * technician's dot on the map. Read-only (unlike Mileage's own Day Route
 * view — no reordering/adjustment here, this is just a dispatcher-facing
 * "where are they going today" picture): branch -> every ticket scheduled
 * for them today, in time-slot order.
 */

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { X, Loader2, AlertCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getTechnicianTodayRoute, type TechnicianRouteStop } from "@/lib/supabase/technicianWhereabouts";
import { getCompanyMapProvider } from "@/lib/supabase/companySettings";
import {
  getLeaflet,
  loadGoogleMapsScript,
  makeGeocoder,
  routeGeoapify,
  getOfficeCoordinates,
  haversineMiles,
  metersToMiles,
  milesToMeters,
  ON_SITE_CHECKIN_RADIUS_MILES,
  attachLeafletResizeFix,
  createBadgeDivIcon,
  OSM_TILE_URL,
  OSM_ATTRIBUTION,
  type LatLng,
} from "@/lib/mapEngine";

const STOP_STATUS_COLOR: Record<TechnicianRouteStop["statusGroup"], string> = {
  open: "#5b7eff",
  completed: "#22c55e",
  cancelled: "#ef4444",
  other: "#94a3b8",
};

// Live-position marker — an amber triangle, distinct from the numbered
// route-stop badges, so it reads as "this is where they actually are right
// now" rather than another stop.
const LIVE_TRIANGLE_SVG =
  '<svg width="24" height="24" viewBox="0 0 22 22" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))"><polygon points="11,2 20,19 2,19" fill="#f59e0b" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';

interface Props {
  technicianName: string;
  branch: string;
  /** Real GPS, whenever a ping row exists — kept regardless of age, same as TechnicianWhereabouts's own liveLocation (see technicianWhereabouts.ts). Passed down rather than re-fetched here since the caller already has it. */
  liveLocation: { lat: number; lng: number; updatedAt: string; isLive: boolean } | null;
  onClose: () => void;
}

export function TechnicianDayRouteModal({ technicianName, branch, liveLocation, onClose }: Props) {
  const [stops, setStops] = useState<TechnicianRouteStop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapProvider, setMapProvider] = useState<"google" | "leaflet" | null>(null);

  useEffect(() => {
    void getCompanyMapProvider().then(setMapProvider);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getTechnicianTodayRoute(technicianName);
        if (!cancelled) setStops(r);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load today's route.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [technicianName]);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<Leaflet.Map | null>(null);
  const googleMapRef = useRef<any>(null);
  const leafletLiveMarkerRef = useRef<Leaflet.Marker | null>(null);
  const googleLiveMarkerRef = useRef<any>(null);
  const [L, setL] = useState<typeof Leaflet | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const leafletLayersRef = useRef<Array<{ remove: () => void }>>([]);
  const googleOverlaysRef = useRef<any[]>([]);
  const [mapBuilding, setMapBuilding] = useState(false);
  const [routeMiles, setRouteMiles] = useState<number | null>(null);

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
    const map = L.map(container, { zoom: 8, center: [35.5, -85.3], zoomControl: true });
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
      googleMapRef.current = new g.maps.Map(mapEl.current, { zoom: 8, center: { lat: 35.5, lng: -85.3 } });
      setMapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mapProvider]);

  useEffect(() => {
    if (!mapProvider || !mapReady || !stops || stops.length === 0) return;
    if (mapProvider === "leaflet" && !L) return;
    let cancelled = false;

    (async () => {
      setMapBuilding(true);
      const geocode = makeGeocoder(mapProvider);
      const officePt = getOfficeCoordinates(branch);
      const originPt = officePt ?? (await geocode(branch));
      if (cancelled || !originPt) {
        setMapBuilding(false);
        return;
      }

      const stopPts: LatLng[] = [];
      for (const s of stops) {
        const pt = s.address ? await geocode(s.address) : null;
        if (cancelled) return;
        if (pt) stopPts.push(pt);
      }
      if (cancelled) return;

      const points = [originPt, ...stopPts];

      leafletLayersRef.current.forEach((l) => l.remove());
      leafletLayersRef.current = [];
      googleOverlaysRef.current.forEach((o) => o.setMap(null));
      googleOverlaysRef.current = [];

      const labelFor = (i: number) => (i === 0 ? "B" : String(i));
      const colorFor = (i: number) => (i === 0 ? "#64748b" : STOP_STATUS_COLOR[stops[i - 1]?.statusGroup ?? "other"]);

      if (mapProvider === "leaflet" && L) {
        const map = leafletMapRef.current!;
        points.forEach((p, i) => {
          const marker = L.marker([p.lat, p.lng], {
            icon: createBadgeDivIcon(
              L,
              `<div style="background:${colorFor(i)};color:#fff;font-size:12px;font-weight:bold;border:2px solid #fff;border-radius:6px;padding:2px 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${labelFor(i)}</div>`,
              { className: "day-route-marker", anchor: "bottom" },
            ),
          }).addTo(map);
          leafletLayersRef.current.push(marker);
        });
        // On-Site Check-In geofence — same radius the mobile "I'm Here"
        // button uses, drawn around every stop so it's visually obvious
        // how close the technician needs to be to check in.
        stopPts.forEach((p) => {
          const circle = L.circle([p.lat, p.lng], {
            radius: milesToMeters(ON_SITE_CHECKIN_RADIUS_MILES),
            color: "#22c55e",
            weight: 1,
            fillColor: "#22c55e",
            fillOpacity: 0.12,
          }).addTo(map);
          leafletLayersRef.current.push(circle);
        });
        if (points.length >= 2) {
          const route = await routeGeoapify(points, "drive");
          if (cancelled) return;
          if (route) {
            const line = L.geoJSON(route.geometry, { style: { color: "#5b7eff", weight: 4 } }).addTo(map);
            leafletLayersRef.current.push(line);
            setRouteMiles(metersToMiles(route.totalDistanceMeters));
          } else {
            const poly = L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { color: "#5b7eff", weight: 3, dashArray: "6 6" }).addTo(map);
            leafletLayersRef.current.push(poly);
            let total = 0;
            for (let i = 1; i < points.length; i++) total += haversineMiles(points[i - 1], points[i]);
            setRouteMiles(total);
          }
        }
        const boundsPoints = liveLocation ? [...points, liveLocation] : points;
        map.fitBounds(L.latLngBounds(boundsPoints.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40] });
      } else if (mapProvider === "google") {
        const g = (window as any).google;
        const map = googleMapRef.current;
        points.forEach((p, i) => {
          const marker = new g.maps.Marker({
            map,
            position: p,
            label: { text: labelFor(i), color: "#fff", fontSize: "12px", fontWeight: "bold" },
            icon: { path: g.maps.SymbolPath.CIRCLE, scale: 12, fillColor: colorFor(i), fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
          });
          googleOverlaysRef.current.push(marker);
        });
        // On-Site Check-In geofence — same radius the mobile "I'm Here"
        // button uses, drawn around every stop.
        stopPts.forEach((p) => {
          const circle = new g.maps.Circle({
            map,
            center: p,
            radius: milesToMeters(ON_SITE_CHECKIN_RADIUS_MILES),
            strokeColor: "#22c55e",
            strokeWeight: 1,
            fillColor: "#22c55e",
            fillOpacity: 0.12,
          });
          googleOverlaysRef.current.push(circle);
        });
        if (points.length >= 2) {
          const ds = new g.maps.DirectionsService();
          const dr = new g.maps.DirectionsRenderer({ map, suppressMarkers: true });
          googleOverlaysRef.current.push({ setMap: (v: any) => dr.setMap(v) });
          const waypoints = stopPts.slice(0, -1).map((p) => ({ location: p, stopover: true }));
          ds.route(
            { origin: originPt, destination: points[points.length - 1], waypoints, optimizeWaypoints: false, travelMode: g.maps.TravelMode.DRIVING },
            (result: any, status: string) => {
              if (cancelled) return;
              if (status === "OK" && result) {
                dr.setDirections(result);
                const legs = result.routes[0].legs as any[];
                setRouteMiles(metersToMiles(legs.reduce((s: number, leg: any) => s + (leg.distance?.value ?? 0), 0)));
              } else {
                const bounds = new g.maps.LatLngBounds();
                points.forEach((p) => bounds.extend(p));
                if (liveLocation) bounds.extend(liveLocation);
                map.fitBounds(bounds);
                let total = 0;
                for (let i = 1; i < points.length; i++) total += haversineMiles(points[i - 1], points[i]);
                setRouteMiles(total);
              }
            },
          );
        }
        const bounds = new g.maps.LatLngBounds();
        points.forEach((p) => bounds.extend(p));
        if (liveLocation) bounds.extend(liveLocation);
        map.fitBounds(bounds);
      }
      setMapBuilding(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapProvider, mapReady, L, stops]);

  // Live-position triangle, split into two effects so a routine liveLocation
  // refresh (TechnicianWhereaboutsPage polls every AUTO_REFRESH_MS, handing
  // down a new object each time) never re-geocodes/re-routes the whole stop
  // list above, and never even recreates this marker — just moves it.

  // Effect A: create the marker instance once the map itself exists, tear
  // it down when the map goes away. Starts hidden — Effect B below
  // positions and reveals it, so it never flashes at a stale/placeholder
  // spot before a real position is known.
  useEffect(() => {
    if (mapProvider === "leaflet" && L && leafletMapRef.current && !leafletLiveMarkerRef.current) {
      leafletLiveMarkerRef.current = L.marker([0, 0], {
        icon: createBadgeDivIcon(L, LIVE_TRIANGLE_SVG, { className: "day-route-live-marker", anchor: "center" }),
        zIndexOffset: 1000,
        opacity: 0,
      }).addTo(leafletMapRef.current);
    }
    if (mapProvider === "google" && googleMapRef.current && !googleLiveMarkerRef.current) {
      const g = (window as any).google;
      googleLiveMarkerRef.current = new g.maps.Marker({
        map: googleMapRef.current,
        zIndex: 1000,
        visible: false,
        icon: {
          path: "M11 2 L20 19 L2 19 Z",
          fillColor: "#f59e0b",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
          scale: 1,
          anchor: new g.maps.Point(11, 11),
        },
      });
    }
    return () => {
      leafletLiveMarkerRef.current?.remove();
      leafletLiveMarkerRef.current = null;
      googleLiveMarkerRef.current?.setMap(null);
      googleLiveMarkerRef.current = null;
    };
  }, [mapProvider, mapReady, L]);

  // Effect B: just move/show/hide the already-created marker as
  // liveLocation changes — no create/destroy here. Also re-runs when
  // mapProvider/mapReady/L change (not just liveLocation) — liveLocation is
  // usually already known the instant this modal opens, before Effect A
  // above has actually created the marker (map load is async), so without
  // this the marker would get created but never actually get a real
  // position, staying invisible at its placeholder [0,0] forever.
  useEffect(() => {
    if (leafletLiveMarkerRef.current) {
      if (liveLocation) {
        leafletLiveMarkerRef.current.setLatLng([liveLocation.lat, liveLocation.lng]);
        leafletLiveMarkerRef.current.setOpacity(1);
      } else {
        leafletLiveMarkerRef.current.setOpacity(0);
      }
    }
    if (googleLiveMarkerRef.current) {
      if (liveLocation) {
        googleLiveMarkerRef.current.setPosition(liveLocation);
        googleLiveMarkerRef.current.setVisible(true);
      } else {
        googleLiveMarkerRef.current.setVisible(false);
      }
    }
  }, [liveLocation, mapProvider, mapReady, L]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">{technicianName} — Today's Route</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {branch || "No branch"}
              {routeMiles != null && <> · <span className="font-semibold text-white">{routeMiles.toFixed(1)} mi</span> (approximate)</>}
            </p>
          </div>
          <button className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {loadError ? (
          <p className="text-sm text-red-400 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {loadError}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <div className="relative h-[420px] rounded-lg border border-white/10 overflow-hidden bg-slate-800">
                <div ref={mapEl} className="h-full w-full" />
                {mapBuilding && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                  </div>
                )}
                {!mapProvider && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">No map provider configured.</div>
                )}
                {mapProvider && stops && stops.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">No stops scheduled today.</div>
                )}
              </div>
            </div>

            <div className="lg:col-span-2">
              {!stops ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading today's stops…
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold text-slate-300 mb-2">Stops ({stops.length})</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500 px-2 py-1.5 rounded-md bg-slate-800/40">
                      <span className="w-5 text-center font-semibold">B</span>
                      <span>{branch || "Branch"}</span>
                    </div>
                    {stops.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">Nothing scheduled for them today.</p>
                    ) : (
                      stops.map((stop, i) => (
                        <div key={`${stop.ticketNo}-${i}`} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-slate-800/60 border border-white/5">
                          <span className="w-5 text-center font-semibold" style={{ color: STOP_STATUS_COLOR[stop.statusGroup] }}>{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <Link to="/ticket/$ticketNo" params={{ ticketNo: stop.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
                              {stop.ticketNo}
                            </Link>
                            {stop.timeSlot && <span className="text-slate-500"> · {stop.timeSlot}</span>}
                            <span className="text-slate-500"> · {stop.status}</span>
                            <p className="text-slate-400 truncate">{stop.address || "No address on file"}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
