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

/** Same "resched" status check used everywhere else in the app (e.g.
 *  MobileTechApp.tsx's route filter, WorkPlannerPage.tsx). A ticket whose
 *  CURRENT status has moved to a reschedule variant is no longer really
 *  part of this day's drive, even though its mileage_entries row (created
 *  back when it still was) still exists here. */
function isReschedStatus(status: string | null): boolean {
  return String(status || "").toLowerCase().includes("resched");
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
        // Rescheduled stops are excluded from the reorderable route from the
        // start (see reschedStops below) -- they're shown separately,
        // read-only, never part of `order`'s reorder mechanics.
        setOrder(dayStops.filter((s) => !isReschedStatus(s.status)).map((s) => s.ticketId));
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
  // Rescheduled stops (current ticket status, not a stale snapshot -- see
  // MileageDayStop.status) are pulled out of the reorderable route and
  // shown separately, read-only -- a ticket that's been rescheduled off
  // this day never really happened as part of this drive, so it shouldn't
  // count toward (or be reorderable within) the route/total.
  const reschedStops = (stops ?? []).filter((s) => isReschedStatus(s.status));
  const activeStopIds = (stops ?? []).filter((s) => !isReschedStatus(s.status)).map((s) => s.ticketId);
  const orderedStops = order.map((id) => stopsById.get(id)).filter((s): s is MileageDayStop => !!s);
  const orderChanged = stops != null && order.join(",") !== activeStopIds.join(",");
  // True the moment a rescheduled stop exists that hasn't yet had its
  // day recalculated to exclude it -- lets Save stay actionable even when
  // the tech-visible order itself hasn't changed, since dropping a stale
  // stop from the shared day total is itself a real recalculation.
  const needsReschedExclusion = reschedStops.length > 0;

  // Whether the day's final leg goes home or loops back to the branch —
  // defaults to the last SAVED choice (route_return_to), falling back to
  // the same "home if one's on file, else branch" rule the calculation
  // itself always used before this was choosable. savedReturnTarget tracks
  // what's actually persisted so the Save button can tell a live toggle
  // apart from an already-saved state, the same way `stops` does for order.
  const defaultReturnTarget: "home" | "branch" = dayEntry?.routeReturnTo ?? (homeAddress ? "home" : "branch");
  const [returnTarget, setReturnTarget] = useState<"home" | "branch">(defaultReturnTarget);
  const [savedReturnTarget, setSavedReturnTarget] = useState<"home" | "branch">(defaultReturnTarget);
  const returnTargetChanged = returnTarget !== savedReturnTarget;

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
  const [legBreakdown, setLegBreakdown] = useState<{ label: string; miles: number }[]>([]);
  const [gmapsLink, setGmapsLink] = useState<string | null>(null);

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
      if (returnTarget === "home" && homeAddress) homePt = await geocode(homeAddress);
      if (cancelled) return;

      const endsAtHome = homePt != null;
      const points = [originPt, ...stopPts, homePt ?? originPt];
      // Human-readable label per waypoint, used for both the leg-breakdown
      // list and the gmaps link isn't needed there, but keeps the two
      // consistent with what's actually plotted.
      const pointLabels = ["Branch", ...orderedStops.map((s) => s.ticketNo), endsAtHome ? "Home" : "Branch"];

      // Open in Google Maps — lets Accounting cross-check this exact route
      // (same stops, same order, same end point) in Google's own app,
      // independent of which provider this company's map is set to.
      const gLink =
        points.length >= 2
          ? `https://www.google.com/maps/dir/?api=1&origin=${points[0].lat},${points[0].lng}&destination=${points[points.length - 1].lat},${points[points.length - 1].lng}` +
            (points.length > 2 ? `&waypoints=${points.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join("|")}` : "") +
            "&travelmode=driving"
          : null;
      setGmapsLink(gLink);

      // Clear previous layer/markers before redrawing.
      leafletLayersRef.current.forEach((l) => l.remove());
      leafletLayersRef.current = [];
      googleOverlaysRef.current.forEach((o) => o.setMap(null));
      googleOverlaysRef.current = [];

      const labelFor = (i: number) => (i === 0 ? "B" : i === points.length - 1 ? (endsAtHome ? "H" : "B") : String(i));
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
          setLegBreakdown(
            route.legs.map((leg, i) => ({ label: `${pointLabels[i]} → ${pointLabels[i + 1]}`, miles: metersToMiles(leg.distanceMeters) }))
          );
        } else {
          const poly = L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { color: "#5b7eff", weight: 4, dashArray: "6 6" }).addTo(map);
          leafletLayersRef.current.push(poly);
          let total = 0;
          const legs: { label: string; miles: number }[] = [];
          for (let i = 1; i < points.length; i++) {
            const miles = haversineMiles(points[i - 1], points[i]);
            total += miles;
            legs.push({ label: `${pointLabels[i - 1]} → ${pointLabels[i]}`, miles });
          }
          setRouteInfo({ totalMiles: total, approximate: true });
          setLegBreakdown(legs);
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
              const legsRaw = result.routes[0].legs as any[];
              const totalMeters = legsRaw.reduce((s: number, leg: any) => s + (leg.distance?.value ?? 0), 0);
              setRouteInfo({ totalMiles: metersToMiles(totalMeters), approximate: false });
              setLegBreakdown(
                legsRaw.map((leg, i) => ({ label: `${pointLabels[i]} → ${pointLabels[i + 1]}`, miles: metersToMiles(leg.distance?.value ?? 0) }))
              );
            } else {
              const bounds = new g.maps.LatLngBounds();
              points.forEach((p) => bounds.extend(p));
              map.fitBounds(bounds);
              let total = 0;
              const legs: { label: string; miles: number }[] = [];
              for (let i = 1; i < points.length; i++) {
                const miles = haversineMiles(points[i - 1], points[i]);
                total += miles;
                legs.push({ label: `${pointLabels[i - 1]} → ${pointLabels[i]}`, miles });
              }
              setRouteInfo({ totalMiles: total, approximate: true });
              setLegBreakdown(legs);
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
  }, [mapProvider, mapReady, L, order.join(","), returnTarget]);

  const handleSaveOrder = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await recalculateMileageDayRoute({
        entries: entries.map((e) => ({ id: e.id, ticketId: e.ticketId as string })),
        orderedTicketIds: order,
        branch,
        homeAddress,
        returnTo: returnTarget,
      });
      // Re-baseline both "did anything change" comparisons against what's
      // now actually saved, or the Save button would stay active-looking
      // (comparing against a stale pre-save snapshot) even with nothing
      // left to save.
      setStops((prev) => (prev ? order.map((id) => prev.find((s) => s.ticketId === id)!) : prev));
      setSavedReturnTarget(returnTarget);
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
                <div className="mt-1.5 rounded-md border border-white/10 bg-slate-800/40 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-400">
                      Route preview: <span className="font-semibold text-slate-200">{routeInfo.totalMiles?.toFixed(1)} mi</span>
                      {routeInfo.approximate ? " (straight-line estimate — routing call failed)" : ""}
                      {(orderChanged || returnTargetChanged) && " — click “Save this order” below to make this the official total."}
                    </p>
                    {gmapsLink && (
                      <a
                        href={gmapsLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[11px] text-blue-400 hover:text-blue-300 underline whitespace-nowrap"
                      >
                        Open in Google Maps
                      </a>
                    )}
                  </div>
                  {legBreakdown.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5">
                      {legBreakdown.map((leg, i) => (
                        <li key={i} className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>{leg.label}</span>
                          <span className="text-slate-400">{leg.miles.toFixed(1)} mi</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
                      <Link to="/ticket/$ticketNo" params={{ ticketNo: stop.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
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
                  <span className="w-5 text-center font-semibold">{returnTarget === "home" && homeAddress ? "H" : "B"}</span>
                  <span className="flex-1">
                    {returnTarget === "home" && homeAddress ? homeAddress : `${branch} (branch)`}
                    {!homeAddress && <span className="text-slate-600"> — no home address on file</span>}
                  </span>
                  {homeAddress && (
                    <div className="flex rounded-md border border-white/15 overflow-hidden shrink-0">
                      <button
                        onClick={() => setReturnTarget("home")}
                        className={`px-2 py-0.5 text-[10px] font-semibold ${returnTarget === "home" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-white/5"}`}
                      >
                        Home
                      </button>
                      <button
                        onClick={() => setReturnTarget("branch")}
                        className={`px-2 py-0.5 text-[10px] font-semibold ${returnTarget === "branch" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-white/5"}`}
                      >
                        Branch
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {saveError && <p className="text-xs text-red-400 mt-2">{saveError}</p>}
              <button
                onClick={handleSaveOrder}
                disabled={saving || (!orderChanged && !returnTargetChanged && !needsReschedExclusion)}
                className="mt-3 w-full rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2"
              >
                {saving
                  ? "Recalculating…"
                  : orderChanged || returnTargetChanged || needsReschedExclusion
                  ? "Save this order & recalculate"
                  : "No changes to save"}
              </button>

              {reschedStops.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[11px] font-semibold text-amber-300 mb-1.5">
                    Rescheduled — excluded from this route ({reschedStops.length})
                  </p>
                  <div className="space-y-1">
                    {reschedStops.map((stop) => (
                      <div key={stop.ticketId} className="flex items-center justify-between gap-2 text-[11px]">
                        <Link
                          to="/ticket/$ticketNo"
                          params={{ ticketNo: stop.ticketNo }}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-amber-300 hover:text-amber-200 hover:underline truncate"
                        >
                          {stop.ticketNo}
                        </Link>
                        <span className="text-amber-400/80 truncate">{stop.status}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-400/70 mt-1.5">
                    No longer counted toward this day's mileage. Click Save above to update the saved total.
                  </p>
                </div>
              )}
              </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
