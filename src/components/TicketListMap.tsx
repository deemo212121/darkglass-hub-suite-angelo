/**
 * Filtered ticket map view launched from the Ticket List page.
 *
 * Behavior
 * --------
 *  - Reads filter values from the URL (repairStatus, location, source,
 *    group, startDate, endDate). Defaults to the current calendar week
 *    when no dates are passed.
 *  - Loads tickets from Supabase, applies the same filters as TicketList,
 *    geocodes each one with the Google Maps JS Geocoder, drops a marker
 *    per ticket with a status-colored dot and an info window showing the
 *    ticket # / customer / status / scheduled date.
 *  - Sidebar lets you tweak each filter in-page; changes write back to
 *    the URL so the view is shareable / refreshable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronLeft, MapPin } from "lucide-react";
import { Footer } from "@/components/Footer";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getCompanyTickets, getCsrVisitDatesByTicketIds, getLatestVisitTechnicianByTicketIds } from "@/lib/supabase/tickets";
import { getLocations as sbGetLocations } from "@/lib/supabase/locationManagement";
import { lookupGeocode, storeGeocode } from "@/lib/supabase/geocodeCache";
import {
  getLocationManagementCoordinates,
  getLocationManagementZoomAddress,
} from "@/components/LocationManagementPage";

type AnyTicket = Record<string, any>;

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

// Buckets shared with Ticket List (Open/Pending vs Completed/Claimed vs Cancelled).
type StatusGroup = "open" | "completed" | "cancelled";
function statusGroupOf(status: string): StatusGroup | "other" {
  const v = String(status || "").trim().toLowerCase();
  if (!v) return "other";
  if (v.includes("need cancel")) return "open";
  if (v === "cl-cancelled" || /\bcancell?ed\b/.test(v)) return "cancelled";
  if (
    v === "cl-completed" || v === "completed" ||
    v === "cl-claimed" || v === "claimed" ||
    v.includes("data closed") || v.includes("data-closed")
  ) return "completed";
  if (v.startsWith("csr-") || v.startsWith("op-") || v.startsWith("pt-") || v.startsWith("tr-") || v.startsWith("cl-")) return "open";
  return "other";
}

function statusColorHex(status: string): string {
  const v = String(status || "").trim().toLowerCase();
  if (v === "pt-need preauthorization") return "#ea580c";
  if (v === "cl-ready to complete") return "#ef4444";
  if (v === "op-ready for service") return "#3b82f6";
  if (v === "csr-left message for cx") return "#6ee7b7";
  if (v === "op-waiting for part") return "#facc15";
  if (v === "csr-assigned to asc") return "#e2e8f0";
  if (v === "cl-parts back ordered") return "#e2e8f0";
  if (v === "tr-need triage") return "#94a3b8";
  if (v === "cl-need cancel") return "#fed7aa";
  if (v === "op-reschedule follow up") return "#f9a8d4";
  if (v === "csr-acknowledged") return "#fda4af";
  return "#60a5fa";
}

// First day of current week (Mon → Sun). Returned as ISO yyyy-mm-dd.
function currentWeekRange(): { start: string; end: string } {
  const today = new Date();
  const day = today.getDay() === 0 ? 7 : today.getDay(); // Monday=1, Sunday=7
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}

// Pull the schedule date as ISO regardless of source format.
function ticketDateIso(value: unknown): string {
  const v = String(value || "").trim();
  if (!v) return "";
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

interface SearchParams {
  repairStatus?: string;
  location?: string;
  source?: string;
  group?: "" | StatusGroup;
  startDate?: string;
  endDate?: string;
}

export function TicketListMap() {
  // Route exposes its own typed search params; for safety we narrow here.
  const search = (useSearch({ strict: false }) as SearchParams) ?? {};
  const week = currentWeekRange();

  const [repairStatus, setRepairStatus] = useState(search.repairStatus ?? "");
  const [location, setLocation] = useState(search.location ?? "");
  const [source, setSource] = useState(search.source ?? "");
  const [group, setGroup] = useState<SearchParams["group"]>(search.group ?? "");
  const [startDate, setStartDate] = useState(search.startDate ?? week.start);
  const [endDate, setEndDate] = useState(search.endDate ?? week.end);

  const { ready, email } = useAuth();
  const [tickets, setTickets] = useState<AnyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<any[]>([]);
  const officeMarkersRef = useRef<any[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AnyTicket | null>(null);

  // Hydrate the Location Management cache (localStorage) so the helper
  // functions can resolve office addresses + coords from Supabase data.
  useEffect(() => {
    if (!ready || !email) return;
    let cancelled = false;
    (async () => {
      try {
        const locs = await sbGetLocations();
        if (cancelled || !locs.length) return;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            "ahs:location-management:locations",
            JSON.stringify(locs),
          );
        }
      } catch (err) {
        console.warn("TicketListMap: could not hydrate location cache", err);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, email]);

  // Load tickets once.
  useEffect(() => {
    if (!ready || !email) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getCompanyTickets();
        // Attach the set of CSR-added visit dates AND the latest
        // visit-recorded technician to each row, without overwriting
        // the SP schedule_date. The filter below treats a ticket as
        // visible on a given day when its SP date OR any CSR-added
        // Visit Log date matches. The tech overlay keeps a ticket with
        // no `technician` field attributed to whoever the CSR last
        // logged on a visit — same rule used by the Work Map and the
        // daily-schedule planner.
        try {
          const ids = rows
            .map((t: any) => String(t?._id ?? "").trim())
            .filter(Boolean);
          const [csrMap, techMap] = await Promise.all([
            getCsrVisitDatesByTicketIds(ids),
            getLatestVisitTechnicianByTicketIds(ids),
          ]);
          for (const t of rows as any[]) {
            const tid = String(t?._id ?? "").trim();
            const dates = tid ? csrMap.get(tid) : undefined;
            t.csrVisitDates = dates ? Array.from(dates) : [];

            const currentTech = String(
              (t.technician ?? (t as any).technician_name ?? "") as string,
            ).trim();
            if (!currentTech || currentTech.toLowerCase() === "unassigned") {
              const visitTech = tid ? techMap.get(tid) : "";
              if (visitTech) {
                (t as any).technician = visitTech;
              }
            }
          }
        } catch (visitErr) {
          console.warn("TicketListMap: visit date overlay skipped", visitErr);
        }
        if (!cancelled) setTickets(rows as AnyTicket[]);
      } catch (err) {
        console.error("TicketListMap: failed to load tickets", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, email]);

  const filtered = useMemo(() => {
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const rs = norm(repairStatus);
    const loc = norm(location);
    const src = norm(source);
    const gp = group ?? "";
    return tickets.filter((t) => {
      if (rs && norm(t.status) !== rs) return false;
      if (loc && norm(t.location) !== loc) return false;
      if (src && norm(t.ticketSource ?? t.ticket_source) !== src) return false;
      if (gp && statusGroupOf(t.status) !== gp) return false;
      // Combine SP schedule_date with CSR-added Visit Log dates so a
      // ticket appears on every day it's been booked for. SP-only dates
      // stay primary, but a CSR-added day still surfaces the ticket
      // without overwriting the original schedule.
      const sp = ticketDateIso(t.schedule ?? t.schedule_date);
      const csrDates: string[] = Array.isArray((t as any).csrVisitDates)
        ? (t as any).csrVisitDates
        : [];
      const allDates = [sp, ...csrDates].filter(Boolean) as string[];
      if (allDates.length === 0) return false;
      const inRange = (d: string) =>
        (!startDate || d >= startDate) && (!endDate || d <= endDate);
      return allDates.some(inRange);
    });
  }, [tickets, repairStatus, location, source, group, startDate, endDate]);

  // Load Google Maps script once, then init the map.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as any;
    let cancelled = false;
    const init = () => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const maps = w.google?.maps;
      if (!maps) return;
      mapRef.current = new maps.Map(containerRef.current, {
        center: { lat: 33.5, lng: -86.5 },
        zoom: 5,
        mapTypeControl: false,
        streetViewControl: false,
      });
    };
    if (w.google?.maps) { init(); return; }
    const existing = document.querySelector('script[data-google-maps="ticket-list-map"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", init, { once: true });
      return () => { cancelled = true; };
    }
    const s = document.createElement("script");
    s.dataset.googleMaps = "ticket-list-map";
    s.async = true; s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.52`;
    s.onload = init;
    s.onerror = () => { if (!cancelled) setMapError("Google Maps failed to load."); };
    document.head.appendChild(s);
    return () => { cancelled = true; };
  }, []);

  // Geocode and plot filtered tickets whenever the filter set changes.
  useEffect(() => {
    const w = window as any;
    const maps = w.google?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    let cancelled = false;

    // Clear old markers.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    officeMarkersRef.current.forEach((m) => m.setMap(null));
    officeMarkersRef.current = [];

    if (filtered.length === 0) return;

    const geocoder = new maps.Geocoder();
    const cache = new Map<string, { lat: number; lng: number } | null>();
    const geocode = (q: string) => new Promise<{ lat: number; lng: number } | null>(async (resolve) => {
      // Layer 1: in-memory cache (free, instant — avoids duplicate calls in same render)
      if (cache.has(q)) { resolve(cache.get(q)!); return; }
      // Layer 2: Supabase DB cache (free — only pay Google once per unique address ever)
      const dbHit = await lookupGeocode(q);
      if (dbHit) { cache.set(q, dbHit); resolve(dbHit); return; }
      // Layer 3: Google Geocoding API (costs money — store result after)
      geocoder.geocode({ address: q }, (results: any, status: string) => {
        if (status === "OK" && results?.[0]) {
          const pos = results[0].geometry.location;
          const out = { lat: pos.lat(), lng: pos.lng() };
          cache.set(q, out);
          void storeGeocode(q, out); // fire-and-forget — persist for next time
          resolve(out);
        } else {
          cache.set(q, null);
          resolve(null);
        }
      });
    });

    // Office markers — one per distinct location in the filtered set.
    // Prefers explicit Location Management coordinates; falls back to
    // geocoding the saved office address.
    const officeLocations = Array.from(new Set(
      filtered
        .map((t) => String(t.location ?? "").trim())
        .filter(Boolean),
    ));
    const plotOffice = async (loc: string) => {
      let pos: { lat: number; lng: number } | null = getLocationManagementCoordinates(loc);
      if (!pos) {
        const addr = getLocationManagementZoomAddress(loc);
        if (addr) pos = await geocode(addr);
      }
      if (!pos || cancelled) return null;
      const office = new maps.Marker({
        position: pos,
        map,
        title: `${loc} Office`,
        zIndex: 9999,
        icon: {
          path: "M -10 0 C -10 -10 10 -10 10 0 L 10 6 L 0 14 L -10 6 Z",
          fillColor: "#0ea5e9",
          fillOpacity: 1,
          strokeColor: "#0f172a",
          strokeWeight: 2,
          scale: 1.1,
          anchor: new maps.Point(0, 14),
        },
        label: {
          text: "\uD83C\uDFE2", // 🏢 office building
          fontSize: "12px",
        },
      });
      officeMarkersRef.current.push(office);
      return pos;
    };

    (async () => {
      const bounds = new maps.LatLngBounds();
      // Plot office markers first so they sit underneath the tickets in
      // case of overlap. Their positions go into the bounds calc too so
      // small clusters of tickets stay zoomed in nicely with the office.
      for (const loc of officeLocations) {
        if (cancelled) return;
        const pos = await plotOffice(loc);
        if (pos) bounds.extend(pos);
      }
      for (const ticket of filtered) {
        if (cancelled) return;
        const street = ticket.address || ticket.customer_address || "";
        const city = ticket.city || ticket.customer_city || ticket.location || "";
        const state = ticket.state || ticket.customer_state || "";
        const zip = ticket.zip || ticket.customer_zip || "";
        const query = [street, city, state, zip].filter(Boolean).join(", ");
        if (!query) continue;
        const pos = await geocode(query);
        if (!pos || cancelled) continue;
        const color = statusColorHex(ticket.status);
        const marker = new maps.Marker({
          position: pos,
          map,
          title: `${ticket.ticketNo ?? ticket.ticket_no} · ${ticket.customer ?? ticket.customer_name ?? ""}`,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: color,
            fillOpacity: 0.95,
            strokeColor: "#0f172a",
            strokeWeight: 2,
          },
        });
        marker.addListener("click", () => setSelected(ticket));
        markersRef.current.push(marker);
        bounds.extend(pos);
      }
      if (!cancelled && (markersRef.current.length > 0 || officeMarkersRef.current.length > 0)) {
        map.fitBounds(bounds, 48);
      }
    })();

    return () => { cancelled = true; };
  }, [filtered]);

  // Pull distinct values from the loaded ticket set for the dropdowns.
  const distinct = (key: string) => {
    const s = new Set<string>();
    for (const t of tickets) {
      const v = String(t[key] ?? "").trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  };

  const statusOptions = distinct("status");
  const locationOptions = distinct("location");
  const sourceOptions = new Set<string>();
  for (const t of tickets) {
    const v = String(t.ticketSource ?? t.ticket_source ?? "").trim();
    if (v) sourceOptions.add(v);
  }

  return (
    <>
      <AppHeader />
      <main className="min-h-[calc(100vh-200px)] bg-slate-950">
        <div className="max-w-[1600px] mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-4">
            <Link
              to="/m/$module/$submodule"
              params={{ module: "tickets", submodule: "ticket-list" }}
              search={{} as any}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" /> Ticket List
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Ticket Map</h1>
              <p className="text-sm text-muted-foreground">Geographic view of filtered tickets for the selected week.</p>
            </div>
          </div>

          {/* Filters */}
          <div className="grid gap-3 lg:grid-cols-3 mb-4">
            <select value={repairStatus} onChange={(e) => setRepairStatus(e.target.value)} className="glass-input w-full">
              <option value="">All Repair Status</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={location} onChange={(e) => setLocation(e.target.value)} className="glass-input w-full">
              <option value="">All Locations</option>
              {locationOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="glass-input w-full">
              <option value="">All Ticket Sources</option>
              {Array.from(sourceOptions).sort().map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={group ?? ""} onChange={(e) => setGroup(e.target.value as any)} className="glass-input w-full">
              <option value="">All (Open + Closed)</option>
              <option value="open">Open / Pending</option>
              <option value="completed">Completed / Claimed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="glass-input w-full" />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="glass-input w-full" />
          </div>

          {/* Map */}
          <div className="relative rounded-xl border border-white/10 overflow-hidden bg-slate-900" style={{ height: "calc(100vh - 320px)" }}>
            {mapError && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 text-rose-200 text-sm">{mapError}</div>
            )}
            <div ref={containerRef} className="h-full w-full" />
            {/* Status legend / count overlay */}
            <div className="absolute top-3 left-3 rounded-lg border border-white/15 bg-slate-900/85 backdrop-blur px-3 py-1.5 text-[11px] text-slate-200">
              {loading ? "Loading tickets…" : `${markersRef.current.length || filtered.length} ticket${filtered.length === 1 ? "" : "s"} plotted`}
            </div>

            {selected && (
              <div className="absolute bottom-3 left-3 right-3 lg:right-auto lg:w-96 rounded-xl border border-white/15 bg-slate-900/95 backdrop-blur p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Ticket</div>
                    <Link
                      to="/ticket/$ticketNo"
                      params={{ ticketNo: String(selected.ticketNo ?? selected.ticket_no) }}
                      className="text-sm font-mono font-semibold text-blue-300 hover:underline"
                    >
                      {selected.ticketNo ?? selected.ticket_no}
                    </Link>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:text-white">✕</button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><div className="text-slate-500">Customer</div><div className="text-slate-200">{selected.customer ?? selected.customer_name ?? "—"}</div></div>
                  <div><div className="text-slate-500">Status</div><div className="font-semibold" style={{ color: statusColorHex(selected.status) }}>{selected.status ?? "—"}</div></div>
                  <div><div className="text-slate-500">Location</div><div className="text-slate-200">{selected.location ?? "—"}</div></div>
                  <div><div className="text-slate-500">Schedule</div><div className="text-slate-200">{ticketDateIso(selected.schedule ?? selected.schedule_date) || "—"}</div></div>
                  <div className="col-span-2"><div className="text-slate-500">Address</div><div className="text-slate-200">{[selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(", ") || "—"}</div></div>
                </div>
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
                <div className="rounded-lg bg-slate-900/85 border border-white/15 px-4 py-3 text-sm text-slate-200 flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> No tickets match the current filters / date range.
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
