/**
 * Accounting Dashboard's Mileage tab — "Day Route" view. Shows one
 * technician's one day as an actual route (branch -> stop 1 -> ... ->
 * stop N -> home address, or back to the branch if none on file) on a map,
 * lets Accounting reorder the stops (the auto time-slot order is a best
 * guess, not the tech's real visit order — see mileage.ts's
 * sortStopsByHeuristic) and recalculate, and lets them override or adjust
 * the resulting total for payroll purposes.
 */

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { X, ArrowUp, ArrowDown, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  getMileageDayRouteStops,
  recalculateMileageDayRoute,
  setMileageDayAdjustment,
  mileageEffectiveTotal,
  type MileageEntry,
  type MileageDayStop,
} from "@/lib/supabase/mileage";
import { getCompanyMapProvider } from "@/lib/supabase/companySettings";
import {
  getLeaflet,
  loadGoogleMapsScript,
  makeGeocoder,
  routeGeoapify,
  getOfficeCoordinates,
  haversineMiles,
  metersToMiles,
  attachLeafletResizeFix,
  createBadgeDivIcon,
  OSM_TILE_URL,
  OSM_ATTRIBUTION,
  type LatLng,
} from "@/lib/mapEngine";

function formatStopAddress(stop: MileageDayStop): string {
  return [stop.address, [stop.city, stop.state].filter(Boolean).join(", "), stop.zip].filter((p) => p && p.trim()).join(", ");
}

interface Props {
  technicianName: string;
  workDate: string;
  branch: string;
  homeAddress?: string;
  entries: MileageEntry[]; // this day's mileage_entries rows (one per ticket, sharing the day total)
  myProfileId: string | null;
  actorName: string;
  onClose: () => void;
  onSaved: () => void; // parent refetches mileageEntries
}

export function MileageDayRouteModal({ technicianName, workDate, branch, homeAddress, entries, myProfileId, actorName, onClose, onSaved }: Props) {
  const [stops, setStops] = useState<MileageDayStop[] | null>(null);
  const [order, setOrder] = useState<string[]>([]); // ticket ids, in visit order
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mapProvider, setMapProvider] = useState<"google" | "leaflet" | null>(null);

  const dayEntry = entries[0];
  const effectiveTotal = dayEntry ? mileageEffectiveTotal(dayEntry) : 0;
  const isAdjusted = dayEntry ? dayEntry.mileageOverride != null || dayEntry.mileageAdjustment != null : false;

  // Adjustment form — seeded from whatever's already saved for this day.
  const [overrideInput, setOverrideInput] = useState(dayEntry?.mileageOverride != null ? String(dayEntry.mileageOverride) : "");
  const [adjustmentInput, setAdjustmentInput] = useState(dayEntry?.mileageAdjustment != null ? String(dayEntry.mileageAdjustment) : "");
  const [noteInput, setNoteInput] = useState(dayEntry?.adjustmentNote ?? "");
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  useEffect(() => {
    void getCompanyMapProvider().then(setMapProvider);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dayStops = await getMileageDayRouteStops(entries.map((e) => ({ ticketId: e.ticketId, routeOrder: e.routeOrder })));
        if (cancelled) return;
        setStops(dayStops);
        setOrder(dayStops.map((s) => s.ticketId));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load this day's stops.");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const move = (index: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const stopsById = new Map((stops ?? []).map((s) => [s.ticketId, s]));
  const orderedStops = order.map((id) => stopsById.get(id)).filter((s): s is MileageDayStop => !!s);
  const orderChanged = stops != null && order.join(",") !== stops.map((s) => s.ticketId).join(",");

  // ── Map: pins for branch/stops/home + a drawn route, redrawn whenever
  // the staged order changes (no API cost for reordering itself — the map
  // just redraws with what's already geocoded/cached).
  const mapEl = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<Leaflet.Map | null>(null);
  const googleMapRef = useRef<any>(null);
  const [L, setL] = useState<typeof Leaflet | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const leafletLayersRef = useRef<Array<{ remove: () => void }>>([]);
  const googleOverlaysRef = useRef<any[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ totalMiles: number | null; approximate: boolean } | null>(null);
  const [mapBuilding, setMapBuilding] = useState(false);

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
    if (!mapProvider || !mapReady || orderedStops.length === 0) return;
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
      for (const s of orderedStops) {
        const pt = await geocode(formatStopAddress(s));
        if (cancelled) return;
        if (pt) stopPts.push(pt);
      }
      let homePt: LatLng | null = null;
      if (homeAddress) homePt = await geocode(homeAddress);
      if (cancelled) return;

      const points = [originPt, ...stopPts, homePt ?? originPt];

      // Clear previous layer/markers before redrawing.
      leafletLayersRef.current.forEach((l) => l.remove());
      leafletLayersRef.current = [];
      googleOverlaysRef.current.forEach((o) => o.setMap(null));
      googleOverlaysRef.current = [];

      const labelFor = (i: number) => (i === 0 ? "B" : i === points.length - 1 ? "H" : String(i));
      const colorFor = (i: number) => (i === 0 || i === points.length - 1 ? "#64748b" : "#5b7eff");

      if (mapProvider === "leaflet" && L) {
        const map = leafletMapRef.current!;
        points.forEach((p, i) => {
          const marker = L.marker([p.lat, p.lng], {
            icon: createBadgeDivIcon(
              L,
              `<div style="background:${colorFor(i)};color:#fff;font-size:12px;font-weight:bold;border:2px solid #fff;border-radius:6px;padding:2px 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${labelFor(i)}</div>`,
              { className: "day-route-marker", anchor: "bottom" }
            ),
          }).addTo(map);
          leafletLayersRef.current.push(marker);
        });
        const route = await routeGeoapify(points, "drive");
        if (cancelled) return;
        if (route) {
          const line = L.geoJSON(route.geometry, { style: { color: "#5b7eff", weight: 5 } }).addTo(map);
          leafletLayersRef.current.push(line);
          setRouteInfo({ totalMiles: metersToMiles(route.totalDistanceMeters), approximate: false });
        } else {
          const poly = L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { color: "#5b7eff", weight: 4, dashArray: "6 6" }).addTo(map);
          leafletLayersRef.current.push(poly);
          let total = 0;
          for (let i = 1; i < points.length; i++) total += haversineMiles(points[i - 1], points[i]);
          setRouteInfo({ totalMiles: total, approximate: true });
        }
        map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40] });
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
              const totalMeters = result.routes[0].legs.reduce((s: number, leg: any) => s + (leg.distance?.value ?? 0), 0);
              setRouteInfo({ totalMiles: metersToMiles(totalMeters), approximate: false });
            } else {
              const bounds = new g.maps.LatLngBounds();
              points.forEach((p) => bounds.extend(p));
              map.fitBounds(bounds);
              let total = 0;
              for (let i = 1; i < points.length; i++) total += haversineMiles(points[i - 1], points[i]);
              setRouteInfo({ totalMiles: total, approximate: true });
            }
          }
        );
      }
      setMapBuilding(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapProvider, mapReady, L, order.join(",")]);

  const handleSaveOrder = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await recalculateMileageDayRoute({
        entries: entries.map((e) => ({ id: e.id, ticketId: e.ticketId as string })),
        orderedTicketIds: order,
        branch,
        homeAddress,
      });
      // Re-baseline the "did the order change" comparison against what's
      // now actually saved, or the Save button would stay active-looking
      // (comparing the new order against the stale pre-save snapshot)
      // even though there's nothing left to save.
      setStops((prev) => (prev ? order.map((id) => prev.find((s) => s.ticketId === id)!) : prev));
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save the new stop order.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAdjustment = async (clear: boolean) => {
    setSavingAdjustment(true);
    setSaveError(null);
    try {
      const override = clear ? null : overrideInput.trim() ? Number(overrideInput) : null;
      const adjustment = clear ? null : override == null && adjustmentInput.trim() ? Number(adjustmentInput) : null;
      await setMileageDayAdjustment({
        entryIds: entries.map((e) => e.id),
        override,
        adjustment,
        note: clear ? null : noteInput.trim() || null,
        byProfileId: myProfileId,
        byName: actorName,
      });
      if (clear) {
        setOverrideInput("");
        setAdjustmentInput("");
        setNoteInput("");
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save the adjustment.");
    } finally {
      setSavingAdjustment(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">
              {technicianName} — {workDate}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Day total: <span className="font-semibold text-white">{effectiveTotal.toFixed(1)} mi</span>
              {isAdjusted && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-300">
                  adjusted{dayEntry?.totalMileage != null ? ` from ${dayEntry.totalMileage.toFixed(1)}` : ""}
                </span>
              )}
            </p>
            {dayEntry?.adjustedByName && (
              <p className="text-[11px] text-slate-500 mt-1">
                Adjusted by {dayEntry.adjustedByName}
                {dayEntry.adjustedAt ? ` on ${new Date(dayEntry.adjustedAt).toLocaleDateString()}` : ""}
                {dayEntry.adjustmentNote ? ` — "${dayEntry.adjustmentNote}"` : ""}
              </p>
            )}
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
          // The map container below is ALWAYS rendered (never behind a
          // `!stops` check) — the map-building effect only depends on
          // [mapProvider, L, order], not on `stops`, so if this div only
          // mounted once stops finished loading, the effect could easily
          // run first, find mapEl.current still null, bail out, and never
          // fire again since its own dependencies never changed afterward.
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <div className="relative h-[360px] rounded-lg border border-white/10 overflow-hidden bg-slate-800">
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
              {routeInfo && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Route preview: {routeInfo.totalMiles?.toFixed(1)} mi{routeInfo.approximate ? " (straight-line estimate — routing call failed)" : ""}
                  {orderChanged && " — click \"Save this order\" to make this the official total."}
                </p>
              )}

              <div className="mt-4 rounded-lg border border-white/10 bg-slate-800/40 p-3">
                <p className="text-xs font-semibold text-slate-300 mb-2">Manual adjustment</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wide">Override total (mi)</label>
                    <input
                      type="number"
                      value={overrideInput}
                      onChange={(e) => {
                        setOverrideInput(e.target.value);
                        if (e.target.value.trim()) setAdjustmentInput("");
                      }}
                      placeholder="e.g. 500"
                      className="w-full mt-1 rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wide">Adjust by (+/- mi)</label>
                    <input
                      type="number"
                      value={adjustmentInput}
                      onChange={(e) => {
                        setAdjustmentInput(e.target.value);
                        if (e.target.value.trim()) setOverrideInput("");
                      }}
                      placeholder="e.g. -15"
                      disabled={!!overrideInput.trim()}
                      className="w-full mt-1 rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-40"
                    />
                  </div>
                </div>
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Reason (shown in the audit trail)"
                  className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white mb-2"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSaveAdjustment(false)}
                    disabled={savingAdjustment || (!overrideInput.trim() && !adjustmentInput.trim())}
                    className="rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5"
                  >
                    {savingAdjustment ? "Saving…" : "Save adjustment"}
                  </button>
                  {isAdjusted && (
                    <button
                      onClick={() => handleSaveAdjustment(true)}
                      disabled={savingAdjustment}
                      className="rounded-md border border-white/15 text-slate-300 hover:bg-white/5 text-xs font-semibold px-3 py-1.5 inline-flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" /> Clear adjustment
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              {!stops ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading this day's stops…
                </div>
              ) : (
              <>
              <p className="text-xs font-semibold text-slate-300 mb-2">Stops ({orderedStops.length}) — reorder to match the real visit order</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500 px-2 py-1.5 rounded-md bg-slate-800/40">
                  <span className="w-5 text-center font-semibold">B</span>
                  <span>{branch} (branch)</span>
                </div>
                {orderedStops.map((stop, i) => (
                  <div key={stop.ticketId} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-slate-800/60 border border-white/5">
                    <span className="w-5 text-center font-semibold text-blue-300">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <Link to="/ticket/$ticketNo" params={{ ticketNo: stop.ticketNo }} className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
                        {stop.ticketNo}
                      </Link>
                      {stop.timeSlot && <span className="text-slate-500"> · {stop.timeSlot}</span>}
                      <p className="text-slate-400 truncate">{formatStopAddress(stop) || "No address on file"}</p>
                    </div>
                    <div className="flex flex-col">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="text-slate-400 hover:text-white disabled:opacity-20"
                        title="Move earlier"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === orderedStops.length - 1}
                        className="text-slate-400 hover:text-white disabled:opacity-20"
                        title="Move later"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-xs text-slate-500 px-2 py-1.5 rounded-md bg-slate-800/40">
                  <span className="w-5 text-center font-semibold">H</span>
                  <span>{homeAddress || `${branch} (no home address on file)`}</span>
                </div>
              </div>

              {saveError && <p className="text-xs text-red-400 mt-2">{saveError}</p>}
              <button
                onClick={handleSaveOrder}
                disabled={saving || !orderChanged}
                className="mt-3 w-full rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2"
              >
                {saving ? "Recalculating…" : orderChanged ? "Save this order & recalculate" : "No changes to save"}
              </button>
              </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
