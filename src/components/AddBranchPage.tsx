import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { ZIP_COVERAGE } from "@/lib/zipCoverage";
import {
  upsertLocation as sbUpsertLocation,
  insertCoverageBulk as sbInsertCoverageBulk,
} from "@/lib/supabase/locationManagement";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

const RADIUS_OPTIONS = [5, 10, 15, 25, 50, 75, 100] as const;
const MILES_TO_METERS = 1609.344;

// TIGERweb ZCTA5 layer (Census 2020) supports point+distance spatial queries.
const TIGERWEB_ZCTA5_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/84/query";

type ZipHit = {
  zip: string;
  city: string;
  state: string;
  location: string; // existing branch that already covers this zip, if any
  lat: number;
  lng: number;
  distanceMiles: number;
};

type LatLng = { lat: number; lng: number };

// Haversine distance in miles between two lat/lng points.
function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.7613; // earth radius in miles
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const c = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(c)));
}

// Take a GeoJSON Polygon/MultiPolygon and return an approximate centroid
// by averaging the outer-ring vertices. Fine for a ZIP polygon.
function centroidOf(geom: any): LatLng | null {
  if (!geom) return null;
  const rings: number[][][] = geom.type === "Polygon" ? geom.coordinates : (geom.coordinates?.[0] ?? []);
  const outer = geom.type === "Polygon" ? rings[0] : (geom.coordinates?.[0]?.[0] ?? []);
  const pts: number[][] = Array.isArray(outer) ? outer : [];
  if (!pts.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return { lng: sx / pts.length, lat: sy / pts.length };
}

async function fetchZipsWithinRadius(center: LatLng, radiusMiles: number): Promise<ZipHit[]> {
  const params = new URLSearchParams({
    geometry: `${center.lng},${center.lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusMiles),
    units: "esriSRUnit_StatuteMile",
    outFields: "ZCTA5,BASENAME",
    returnGeometry: "true",
    f: "geojson",
    outSR: "4326",
  });
  const url = `${TIGERWEB_ZCTA5_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TIGERweb request failed (${res.status})`);
  const json = (await res.json()) as { features?: any[] };
  const features = Array.isArray(json.features) ? json.features : [];
  const hits: ZipHit[] = [];
  for (const feature of features) {
    const zip = String(feature?.properties?.ZCTA5 ?? feature?.properties?.BASENAME ?? "").trim();
    if (!zip) continue;
    const centroid = centroidOf(feature?.geometry);
    if (!centroid) continue;
    const distanceMiles = haversineMiles(center, centroid);
    // Only keep zips whose centroid is inside the circle. The TIGERweb
    // spatial filter returns anything the buffered circle merely touches,
    // which over-fetches. Filtering by centroid distance matches what a
    // dispatcher actually expects when they say "within X miles".
    if (distanceMiles > radiusMiles) continue;
    const existing = ZIP_COVERAGE[zip];
    hits.push({
      zip,
      city: existing?.city ?? "",
      state: "",
      location: existing?.location ?? "",
      lat: centroid.lat,
      lng: centroid.lng,
      distanceMiles,
    });
  }
  hits.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return hits;
}

async function fetchZipGeoJson(zip: string): Promise<any | null> {
  const where = encodeURIComponent(`ZCTA5='${zip}'`);
  const url = `${TIGERWEB_ZCTA5_URL}?where=${where}&outFields=ZCTA5&returnGeometry=true&f=geojson&outSR=4326`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.features?.length ? json : null;
  } catch {
    return null;
  }
}

interface AddBranchPageProps {
  mod: ModuleDef;
  sub: SubModuleDef;
}

export function AddBranchPage({ sub }: AddBranchPageProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const centerMarkerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const zipMarkersRef = useRef<any[]>([]);
  const zipGeoCacheRef = useRef<Map<string, any>>(new Map());

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const [center, setCenter] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState<number>(25);
  const [zipHits, setZipHits] = useState<ZipHit[]>([]);
  const [loadingZips, setLoadingZips] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const [branchName, setBranchName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load the Maps SDK once.
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      setMapError("Set VITE_GOOGLE_MAPS_API_KEY to enable the map.");
      return;
    }
    let cancelled = false;
    const init = () => {
      if (cancelled || !mapContainerRef.current) return;
      const maps = (window as any).google?.maps;
      if (!maps) return;
      if (!mapRef.current || mapRef.current.getDiv() !== mapContainerRef.current) {
        mapRef.current = new maps.Map(mapContainerRef.current, {
          center: { lat: 37.0902, lng: -95.7129 },
          zoom: 4,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "greedy",
        });
        mapRef.current.addListener("click", (e: any) => {
          const lat = e?.latLng?.lat?.();
          const lng = e?.latLng?.lng?.();
          if (typeof lat === "number" && typeof lng === "number") {
            setCenter({ lat, lng });
          }
        });
      }
      setMapReady(true);
      setMapError(null);
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps="add-branch"]');
    if ((window as any).google?.maps) {
      init();
    } else if (existing) {
      existing.addEventListener("load", init, { once: true });
      existing.addEventListener("error", () => setMapError("Google Maps failed to load."), { once: true });
    } else {
      const s = document.createElement("script");
      s.dataset.googleMaps = "add-branch";
      s.async = true;
      s.defer = true;
      s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.52`;
      s.onload = init;
      s.onerror = () => setMapError("Google Maps failed to load.");
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync the center marker + radius circle to state.
  useEffect(() => {
    if (!mapReady) return;
    const maps = (window as any).google?.maps;
    if (!maps || !mapRef.current) return;

    if (!center) {
      centerMarkerRef.current?.setMap(null);
      centerMarkerRef.current = null;
      circleRef.current?.setMap(null);
      circleRef.current = null;
      return;
    }

    if (!centerMarkerRef.current) {
      centerMarkerRef.current = new maps.Marker({
        position: center,
        map: mapRef.current,
        draggable: true,
        title: "Branch center",
      });
      centerMarkerRef.current.addListener("dragend", (e: any) => {
        const lat = e?.latLng?.lat?.();
        const lng = e?.latLng?.lng?.();
        if (typeof lat === "number" && typeof lng === "number") {
          setCenter({ lat, lng });
        }
      });
    } else {
      centerMarkerRef.current.setPosition(center);
    }

    if (!circleRef.current) {
      circleRef.current = new maps.Circle({
        strokeColor: "#0ea5e9",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#38bdf8",
        fillOpacity: 0.12,
        map: mapRef.current,
        center,
        radius: radius * MILES_TO_METERS,
        editable: false,
        clickable: false,
      });
    } else {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radius * MILES_TO_METERS);
    }

    // Zoom so the whole circle is visible.
    const bounds = circleRef.current.getBounds();
    if (bounds) mapRef.current.fitBounds(bounds, 40);
  }, [center, radius, mapReady]);

  // Fetch zips whenever center/radius changes.
  useEffect(() => {
    if (!center) {
      setZipHits([]);
      return;
    }
    let cancelled = false;
    setLoadingZips(true);
    setZipError(null);
    (async () => {
      try {
        const hits = await fetchZipsWithinRadius(center, radius);
        if (!cancelled) setZipHits(hits);
      } catch (err: any) {
        if (!cancelled) {
          setZipError(err?.message ?? "Failed to load zip codes.");
          setZipHits([]);
        }
      } finally {
        if (!cancelled) setLoadingZips(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [center, radius]);

  // Overlay zip polygons + centroid labels on the map.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const maps = (window as any).google?.maps;
    if (!maps) return;

    // Clear any prior zip labels.
    zipMarkersRef.current.forEach((m) => m.setMap(null));
    zipMarkersRef.current = [];

    // Reset the Data layer style / features.
    const dataLayer = mapRef.current.data as any;
    dataLayer.setStyle({
      fillColor: "#22c55e",
      fillOpacity: 0.15,
      strokeColor: "#065f46",
      strokeOpacity: 0.7,
      strokeWeight: 1,
    });
    dataLayer.forEach((f: any) => dataLayer.remove(f));

    if (!zipHits.length) return;

    let cancelled = false;
    (async () => {
      for (const hit of zipHits) {
        if (cancelled) return;

        // Centroid label (transparent icon, text-only marker).
        try {
          const marker = new maps.Marker({
            position: { lat: hit.lat, lng: hit.lng },
            map: mapRef.current,
            clickable: false,
            icon: {
              url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
              scaledSize: new maps.Size(1, 1),
              anchor: new maps.Point(0, 0),
              labelOrigin: new maps.Point(0, 0),
            },
            label: {
              text: hit.zip,
              color: "#052e16",
              fontSize: "11px",
              fontWeight: "700",
            },
            zIndex: 500,
          });
          zipMarkersRef.current.push(marker);
        } catch {
          // Marker label is decorative — polygon fill still renders.
        }

        // Polygon fill.
        let geojson = zipGeoCacheRef.current.get(hit.zip);
        if (!geojson) {
          geojson = await fetchZipGeoJson(hit.zip);
          if (geojson) zipGeoCacheRef.current.set(hit.zip, geojson);
        }
        if (!cancelled && geojson) dataLayer.addGeoJson(geojson);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [zipHits, mapReady]);

  const handleSave = useCallback(async () => {
    if (!center || !branchName.trim()) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const saved = await sbUpsertLocation({
        id: "",
        location: branchName.trim(),
        address1: "",
        address2: "",
        city: "",
        state: "",
        zipCode: "",
        office: branchName.trim(),
        coordinates: `${center.lat}, ${center.lng}`,
        phoneNo: "",
        email: "",
        defaultPartDist: "",
        repTech: "",
        officeLocation: branchName.trim(),
        sms: "N",
        emailFlag: "N",
        autoTriage: "N",
        availableDays: [],
        availableTimeSlot: "ANY",
        coveredTechnicians: [],
      });
      const branchName2 = saved.location || branchName.trim();
      if (zipHits.length) {
        await sbInsertCoverageBulk(
          zipHits.map((hit) => ({
            id: "",
            location: branchName2,
            zipCode: hit.zip,
            city: hit.city,
            selfSchedule: "",
            daysLater: "",
            tierCode: "",
          })),
        );
      }
      setSaveMessage(`Saved "${branchName2}" with ${zipHits.length} zip codes.`);
    } catch (err: any) {
      setSaveMessage(`Save failed: ${err?.message ?? "unknown error"}`);
    } finally {
      setSaving(false);
    }
  }, [center, branchName, zipHits]);

  const totalDistinct = useMemo(() => zipHits.length, [zipHits]);

  return (
    <main className="flex-1 bg-slate-950">
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-white">
          <h1 className="text-xl font-semibold">{sub.title}</h1>
          <p className="text-sm text-slate-400">{sub.description}</p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white backdrop-blur-md">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Branch Name
                </label>
                <input
                  className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="e.g. Dallas North"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Radius (miles)
                </label>
                <div className="flex flex-wrap gap-2">
                  {RADIUS_OPTIONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRadius(r)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        radius === r
                          ? "border-sky-400 bg-sky-500/20 text-sky-100"
                          : "border-white/10 bg-slate-900 text-slate-300 hover:border-white/25"
                      }`}
                    >
                      {r} mi
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Center
                </label>
                {center ? (
                  <div className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200">
                    <div>Lat: {center.lat.toFixed(6)}</div>
                    <div>Lng: {center.lng.toFixed(6)}</div>
                  </div>
                ) : (
                  <div className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                    Click anywhere on the map to drop the branch center.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm">
                <div className="text-slate-400">Zip codes in radius</div>
                <div className="text-lg font-semibold text-white">
                  {loadingZips ? "Loading..." : totalDistinct}
                </div>
                {zipError && (
                  <div className="mt-1 text-xs text-rose-300">{zipError}</div>
                )}
              </div>

              <button
                onClick={handleSave}
                disabled={!center || !branchName.trim() || saving || loadingZips}
                className="w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Branch + Coverage"}
              </button>
              {saveMessage && (
                <div className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200">
                  {saveMessage}
                </div>
              )}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-slate-900" style={{ height: "70vh" }}>
            <div ref={mapContainerRef} className="absolute inset-0" />
            {mapError && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 text-sm text-rose-300">
                {mapError}
              </div>
            )}
            {!mapReady && !mapError && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                Loading map…
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 text-white backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="text-sm font-semibold">
              Zip codes within radius
              {center && (
                <span className="ml-2 text-slate-400">
                  ({radius} mi of {center.lat.toFixed(4)}, {center.lng.toFixed(4)})
                </span>
              )}
            </div>
            <div className="text-sm text-slate-400">{totalDistinct} distinct</div>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/80 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">Zip</th>
                  <th className="px-4 py-2 text-left">City</th>
                  <th className="px-4 py-2 text-left">Currently Covered By</th>
                  <th className="px-4 py-2 text-right">Distance (mi)</th>
                </tr>
              </thead>
              <tbody>
                {zipHits.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      {loadingZips
                        ? "Loading zip codes..."
                        : center
                        ? "No zip codes found for this radius."
                        : "Drop a center point on the map to see zip codes."}
                    </td>
                  </tr>
                )}
                {zipHits.map((hit) => (
                  <tr key={hit.zip} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2 font-mono">{hit.zip}</td>
                    <td className="px-4 py-2">{hit.city || <span className="text-slate-500">—</span>}</td>
                    <td className="px-4 py-2">
                      {hit.location || <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {hit.distanceMiles.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
