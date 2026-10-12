/**
 * Every-5-minutes job (scheduled() in src/server.ts): late clock-out check.
 *
 * Once a technician (any held technician-tier role, primary or extra — same
 * rule as technicianForcedCheckout.ts; not Philippines) has a Time Out for a
 * day, work out when they should have clocked out:
 *
 *   last "Work Done" (tickets.onsite_done_at) that day
 *   + drive time from that ticket's customer address to where they end the day
 *   + a 10-minute extension
 *
 * Where they end the day:
 *   1. on a Flash Tech trip covering that day -> the destination location's
 *      branch address (location_mgmt_locations),
 *   2. otherwise their home address (profiles.employee_info),
 *   3. otherwise their assigned branch's address.
 *
 * A Time Out more than 30 minutes later than that -> HR is notified (one
 * batched notification per HR user per run, reminding them to check the
 * tickets first). Smaller overruns are recorded as ok. A home more than
 * 2 hours from the last customer isn't where they end the day, so their
 * branch is used. Days closed by the system's automatic clock-out are skipped (the
 * system already picked that time), as are days with no finished ticket.
 *
 * Each technician-day is recorded once in technician_clock_out_checks
 * (migration 0362) — that row is also what stops later runs re-checking it.
 * Geocoding + routing use Geoapify (VITE_GEOAPIFY_API_KEY), the same
 * service as the mileage route map; at most MAX_PER_RUN days per run.
 *
 * Raw REST + service key, same structure as the other server jobs.
 */
import { timezoneForBranch, nowInTimezone, DEFAULT_ATTENDANCE_TIMEZONE } from "../attendanceGrace";
import { TECHNICIAN_PAY_ROLES, normalizeRole } from "../roleLabels";

const EXTENSION_MINUTES = 10;
// HR is only alerted past this many minutes over the expected Time Out
// (smaller overruns are recorded as ok, with their minutes).
const ALERT_AFTER_MINUTES = 30;
const MAX_PER_RUN = 25;
const LOOKBACK_DAYS = 2;
// First day checked — the rule starts the day after it ships, so the first
// run doesn't alert HR about days before it existed.
const LATE_CLOCK_OUT_FROM = "2026-10-08";
// A home address further than this from the last customer isn't where they
// end the day (they work far from home) — their branch address is used.
const HOME_MAX_DRIVE_MINUTES = 120;
const HR_PAGE = "/m/hr/attendance-monitoring";
const SCHEDULE_TZ_TO_IANA: Record<string, string> = { CST: "America/Chicago", EST: "America/New_York" };

interface Profile {
  id: string;
  company_id: string;
  display_name: string | null;
  role: string | null;
  extra_roles: string[] | null;
  assigned_branch: string | null;
  schedule_timezone: string | null;
  employee_info: Record<string, unknown> | null;
  is_active: boolean;
}

interface Summary {
  candidates: number;
  checked: number;
  late: number;
  skipped: number;
  notificationsSent: number;
  errors: string[];
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const normBranch = (s: string | null | undefined) => norm(s).replace(/\s*,\s*/g, ",");

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Wall-clock "HH:MM:SS" for an instant, as seen in `timeZone`. */
function zonedHms(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .format(new Date(ms))
    .replace(/^24:/, "00:");
}

/** UTC epoch ms for a wall-clock date + time in `timeZone`. */
function zonedToUtcMs(dateISO: string, hms: string, timeZone: string): number {
  const asUtc = Date.parse(`${dateISO}T${hms.length === 5 ? `${hms}:00` : hms}Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(asUtc));
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const shown = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second"));
  return asUtc - (shown - asUtc);
}

/** "18:05:00" -> "6:05 PM". */
function clock(hms: string): string {
  const [h, m] = hms.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

const joinAddress = (...parts: (string | null | undefined)[]) =>
  parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(", ");

export async function runLateClockOutCheck(env: Record<string, string | undefined>): Promise<Summary> {
  const summary: Summary = { candidates: 0, checked: 0, late: 0, skipped: 0, notificationsSent: 0, errors: [] };
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? env.VITE_SUPABASE_URL;
  const serviceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? env.SUPABASE_SERVICE_KEY;
  const geoKey = ((import.meta as any).env?.VITE_GEOAPIFY_API_KEY as string | undefined) || env.VITE_GEOAPIFY_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    summary.errors.push("Missing Supabase URL/service key.");
    return summary;
  }
  if (!geoKey) {
    summary.errors.push("Missing VITE_GEOAPIFY_API_KEY — can't work out drive times.");
    return summary;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const get = async <T,>(path: string): Promise<T[]> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  };

  // PostgREST returns at most 1000 rows per request — a "&limit=5000" is
  // silently cut to 1000. Pages with offset (the query must be ordered).
  const getAll = async <T,>(path: string): Promise<T[]> => {
    const all: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${supabaseUrl}/rest/v1/${path}&offset=${offset}&limit=1000`, { headers });
      if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
      const page: T[] = await res.json();
      all.push(...page);
      if (page.length < 1000) return all;
    }
  };

  const today = nowInTimezone(DEFAULT_ATTENDANCE_TIMEZONE).dateISO;
  const from = [LATE_CLOCK_OUT_FROM, addDays(today, -LOOKBACK_DAYS)].sort()[1];
  if (from > today) return summary;

  const [profiles, entries, done] = await Promise.all([
    get<Profile>("profiles?select=id,company_id,display_name,role,extra_roles,assigned_branch,schedule_timezone,employee_info,is_active"),
    getAll<{ profile_id: string; work_date: string; check_in: string | null; check_out: string | null; notes: string | null }>(
      `timecard_entries?select=profile_id,work_date,check_in,check_out,notes&work_date=gte.${from}&check_out=not.is.null&order=work_date,profile_id`,
    ),
    getAll<{ profile_id: string; work_date: string }>(`technician_clock_out_checks?select=profile_id,work_date&work_date=gte.${from}&order=work_date,profile_id`),
  ]);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const already = new Set(done.map((d) => `${d.profile_id}|${d.work_date}`));
  const isTech = (p: Profile) => [p.role, ...(p.extra_roles ?? [])].some((r) => TECHNICIAN_PAY_ROLES.has(normalizeRole(r)));

  // Latest Time Out per technician-day, skipping system auto clock-outs.
  const latest = new Map<string, { p: Profile; date: string; checkOut: string }>();
  for (const e of entries) {
    const p = byId.get(e.profile_id);
    if (!p || !p.is_active || !isTech(p) || norm(p.assigned_branch) === "philippines") continue;
    if (!e.check_out || String(e.notes ?? "").includes("[Auto clock-out")) continue;
    const k = `${e.profile_id}|${e.work_date}`;
    if (already.has(k)) continue;
    const prev = latest.get(k);
    if (!prev || e.check_out > prev.checkOut) latest.set(k, { p, date: e.work_date, checkOut: e.check_out });
  }
  summary.candidates = latest.size;
  if (latest.size === 0) return summary;

  const [branches, trips] = await Promise.all([
    get<{ location: string; address1: string | null; address2: string | null; city: string | null; state: string | null; zip_code: string | null }>(
      "location_mgmt_locations?select=location,address1,address2,city,state,zip_code",
    ),
    get<{ technician_profile_id: string; destination_location: string; start_date: string; end_date: string; status: string | null }>(
      `flash_tech_trips?select=technician_profile_id,destination_location,start_date,end_date,status&end_date=gte.${from}`,
    ).catch(() => []),
  ]);
  const branchAddress = new Map<string, string>();
  for (const b of branches) {
    const addr = joinAddress(b.address1, b.city, [b.state, b.zip_code].filter(Boolean).join(" "));
    if (b.address1 && !branchAddress.has(normBranch(b.location))) branchAddress.set(normBranch(b.location), addr);
  }

  // Geoapify, cached for this run.
  const geoCache = new Map<string, { lat: number; lon: number } | null>();
  const geocode = async (text: string) => {
    if (geoCache.has(text)) return geoCache.get(text)!;
    const res = await fetch(`https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&filter=countrycode:us&limit=1&apiKey=${geoKey}`);
    if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
    const f = (await res.json())?.features?.[0];
    const pt = f ? { lat: f.properties.lat as number, lon: f.properties.lon as number } : null;
    geoCache.set(text, pt);
    return pt;
  };
  const driveSeconds = async (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const res = await fetch(`https://api.geoapify.com/v1/routing?waypoints=${a.lat},${a.lon}|${b.lat},${b.lon}&mode=drive&apiKey=${geoKey}`);
    if (!res.ok) throw new Error(`routing HTTP ${res.status}`);
    const t = (await res.json())?.features?.[0]?.properties?.time;
    return typeof t === "number" ? t : null;
  };

  const record = async (row: Record<string, unknown>) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/technician_clock_out_checks?on_conflict=profile_id,work_date`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`record HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const rows: { id: string }[] = await res.json();
    return rows[0]?.id ?? null; // null = another run already recorded it
  };

  const hrByCompany = new Map<string, string[]>();
  const hrFor = (companyId: string) => {
    if (!hrByCompany.has(companyId)) {
      hrByCompany.set(
        companyId,
        profiles
          .filter((x) => x.company_id === companyId && x.is_active && [x.role, ...(x.extra_roles ?? [])].some((r) => normalizeRole(r) === "HR"))
          .map((x) => x.id),
      );
    }
    return hrByCompany.get(companyId)!;
  };

  const lateByCompany = new Map<string, { id: string; line: string }[]>();
  for (const { p, date, checkOut } of Array.from(latest.values()).slice(0, MAX_PER_RUN)) {
    const name = p.display_name || "A technician";
    const base = { company_id: p.company_id, profile_id: p.id, work_date: date, actual_out: checkOut };
    try {
      const tz = SCHEDULE_TZ_TO_IANA[String(p.schedule_timezone ?? "").trim().toUpperCase()] ?? timezoneForBranch(p.assigned_branch);

      // 1. Their last finished ticket that day.
      const tickets = await get<{ ticket_no: string; onsite_done_at: string | null; customer: { address: string | null; city: string | null; state: string | null; zip: string | null } | null }>(
        `tickets?select=ticket_no,onsite_done_at,customer:customers(address,city,state,zip)&schedule_date=eq.${date}&technician=ilike.${encodeURIComponent(p.display_name ?? "")}&onsite_done_at=not.is.null&order=onsite_done_at.desc&limit=1`,
      );
      const last = tickets[0];
      if (!last?.onsite_done_at) {
        await record({ ...base, status: "skipped", reason: "No finished ticket that day" });
        summary.skipped++;
        continue;
      }
      const customerAddress = joinAddress(last.customer?.address, last.customer?.city, [last.customer?.state, last.customer?.zip].filter(Boolean).join(" "));

      // 2. Where they end the day.
      const trip = trips.find((t) => t.technician_profile_id === p.id && t.start_date <= date && t.end_date >= date && !/cancel/i.test(t.status ?? ""));
      const info = (p.employee_info ?? {}) as Record<string, string | undefined>;
      const home = info.address1?.trim() ? joinAddress(info.address1, info.city, [info.state, info.zipCode].filter(Boolean).join(" ")) : "";
      const branchDest = { kind: "branch" as const, label: `${p.assigned_branch || "their"} branch`, address: branchAddress.get(normBranch(p.assigned_branch)) };
      let dest: { kind: "home" | "branch" | "flash_tech_branch"; label: string; address: string | undefined } = trip
        ? { kind: "flash_tech_branch", label: `${trip.destination_location} branch (Flash Tech)`, address: branchAddress.get(normBranch(trip.destination_location)) }
        : home
          ? { kind: "home", label: "home", address: home }
          : branchDest;
      if (!customerAddress) {
        await record({ ...base, last_ticket_no: last.ticket_no, last_done_at: last.onsite_done_at, status: "skipped", reason: "Last ticket has no customer address" });
        summary.skipped++;
        continue;
      }

      // 3. Drive time. A home address more than HOME_MAX_DRIVE_MINUTES away
      // isn't where they end the day (they work far from it) — use their branch.
      const a = await geocode(customerAddress);
      const driveTo = async (address: string | undefined) => {
        if (!a || !address) return null;
        const b = await geocode(address);
        return b ? driveSeconds(a, b) : null;
      };
      let secs = await driveTo(dest.address);
      if (dest.kind === "home" && secs !== null && secs / 60 > HOME_MAX_DRIVE_MINUTES) {
        const far = Math.round(secs / 60);
        dest = { ...branchDest, label: `${branchDest.label} (home on file is ${duration(far)} away)` };
        secs = await driveTo(dest.address);
      }
      const detail = { last_ticket_no: last.ticket_no, last_done_at: last.onsite_done_at, destination_kind: dest.kind, destination_label: dest.label };
      if (secs === null) {
        const reason = !a
          ? `Couldn't locate customer address "${customerAddress}"`
          : !dest.address
            ? `No address on file for ${dest.label}`
            : `Couldn't locate or route to ${dest.label} ("${dest.address}")`;
        await record({ ...base, ...detail, status: "skipped", reason });
        summary.skipped++;
        continue;
      }
      const driveMin = Math.round(secs / 60);
      const expectedMs = Date.parse(last.onsite_done_at) + (driveMin + EXTENSION_MINUTES) * 60_000;
      const actualMs = zonedToUtcMs(date, checkOut, tz);
      const minutesLate = Math.round((actualMs - expectedMs) / 60_000);
      const isLate = minutesLate > ALERT_AFTER_MINUTES;
      const expectedOut = zonedHms(expectedMs, tz);

      const id = await record({
        ...base, ...detail,
        status: isLate ? "late" : "ok",
        drive_minutes: driveMin,
        expected_out: expectedOut,
        minutes_late: Math.max(0, minutesLate),
      });
      summary.checked++;
      if (!isLate || !id) continue;
      summary.late++;
      const doneLocal = zonedHms(Date.parse(last.onsite_done_at), tz);
      const line =
        `${name} (${p.assigned_branch || "no branch"}, ${date}): clocked out ${clock(checkOut)}, should have been about ${clock(expectedOut)} — ${duration(minutesLate)} late. ` +
        `Last ticket ${last.ticket_no} done ${clock(doneLocal)}, ~${duration(driveMin)} drive to ${dest.label} + ${EXTENSION_MINUTES} min.`;
      if (!lateByCompany.has(p.company_id)) lateByCompany.set(p.company_id, []);
      lateByCompany.get(p.company_id)!.push({ id, line });
    } catch (e) {
      // Not recorded, so the next run tries again (e.g. a Geoapify hiccup).
      summary.errors.push(`${name} ${date}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 4. Tell HR — one notification per HR user per run, listing everyone.
  for (const [companyId, items] of lateByCompany) {
    const body =
      `Late clock-out — ${items.length} technician${items.length === 1 ? "" : "s"} clocked out more than ${ALERT_AFTER_MINUTES} min after their last ticket + drive time + ${EXTENSION_MINUTES} min. ` +
      `Please check their tickets first: a job finished without tapping Work Done makes the day look shorter than it was.\n` +
      items.map((i) => `• ${i.line}`).join("\n");
    let sent = 0;
    for (const hrId of hrFor(companyId)) {
      const res = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
        method: "POST",
        headers,
        body: JSON.stringify({ company_id: companyId, recipient_id: hrId, sender_id: null, sender_name: "Clock-Out Monitor", body, link_to: HR_PAGE }),
      });
      if (res.ok) sent++;
      else summary.errors.push(`Notify ${hrId}: HTTP ${res.status}`);
    }
    summary.notificationsSent += sent;
    if (sent > 0) {
      await fetch(`${supabaseUrl}/rest/v1/technician_clock_out_checks?id=in.(${items.map((i) => i.id).join(",")})`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ hr_notified_at: new Date().toISOString() }),
      }).catch(() => undefined);
    }
  }
  return summary;
}
