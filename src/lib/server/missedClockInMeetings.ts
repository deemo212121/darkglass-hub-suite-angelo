/**
 * Hourly job (scheduled() in src/server.ts): yesterday's missed clock-ins.
 *
 * A technician (role TECHNICIAN — primary or extra role — not Philippines,
 * not a trainee) whose scheduled work day yesterday ended with no Time In
 * gets one clock_in_meetings row (migration 0348): "Meeting required".
 * Skipped when yesterday was their day off (profiles.off_days), they were
 * on approved PTO, or it was a US company holiday. Each row is 1 error on
 * the Technician Performance Report.
 *
 * Idempotent: the row is unique per (technician, day), inserted with
 * ignore-duplicates, and only a NEWLY inserted row triggers notifications —
 * so the hourly re-runs after the first one are no-ops. Recipients: the
 * technician's manager (profiles.manager_name), their branch's Branch
 * Manager and Parts Manager (General Information directory) and the Senior
 * Branch Manager who owns the branch — one batched notification each.
 *
 * Raw REST + service key, same structure as attendanceAlerts.ts.
 */
import { nowInTimezone, timezoneForBranch, DEFAULT_ATTENDANCE_TIMEZONE } from "../attendanceGrace";

// The first day that can count as missed — the day after the clock-in code
// went live, so nobody is flagged for a day the code didn't exist yet.
const MISSED_CLOCK_IN_FROM = "2026-10-03";

const MEETINGS_PAGE = "/m/branch-technician/clock-in-codes";

interface Summary {
  date: string;
  checked: number;
  missed: number;
  newMeetings: number;
  notificationsSent: number;
  errors: string[];
}

interface Profile {
  id: string;
  company_id: string;
  display_name: string | null;
  role: string | null;
  extra_roles: string[] | null;
  manager_name: string | null;
  assigned_branch: string | null;
  off_days: number[] | null;
  employment_type?: string | null;
  created_at: string;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const isTechnician = (p: Profile) => [p.role, ...(p.extra_roles ?? [])].some((r) => String(r ?? "").trim().toUpperCase() === "TECHNICIAN");

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function runMissedClockInMeetings(env: Record<string, string | undefined>, opts: { date?: string } = {}): Promise<Summary> {
  const today = nowInTimezone(DEFAULT_ATTENDANCE_TIMEZONE).dateISO;
  const date = opts.date ?? addDays(today, -1);
  const summary: Summary = { date, checked: 0, missed: 0, newMeetings: 0, notificationsSent: 0, errors: [] };
  if (date < MISSED_CLOCK_IN_FROM) return summary;

  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? env.VITE_SUPABASE_URL;
  const serviceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    summary.errors.push("Missing Supabase URL/service key.");
    return summary;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const get = async <T,>(path: string): Promise<T[]> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  };

  let profiles: Profile[];
  try {
    profiles = await get<Profile>("profiles?select=id,company_id,display_name,role,extra_roles,manager_name,assigned_branch,off_days,employment_type,created_at&is_active=eq.true");
  } catch {
    // employment_type is a newer column — retry without it.
    profiles = await get<Profile>("profiles?select=id,company_id,display_name,role,extra_roles,manager_name,assigned_branch,off_days,created_at&is_active=eq.true");
  }

  const [entries, ptos, holidays, branchRoles, sbmBranches] = await Promise.all([
    get<{ profile_id: string; check_in: string | null }>(`timecard_entries?select=profile_id,check_in&work_date=eq.${date}`),
    get<{ profile_id: string }>(`pto_requests?select=profile_id&status=eq.approved&start_date=lte.${date}&end_date=gte.${date}`).catch(() => []),
    get<{ date: string; country: string | null }>(`company_holidays?select=date,country&date=eq.${date}`).catch(() => []),
    get<{ branch: string; branch_manager: string | null; parts_manager: string | null }>("general_info_branch_roles?select=branch,branch_manager,parts_manager").catch(() => []),
    get<{ profile_id: string; branch: string }>("senior_branch_manager_branches?select=profile_id,branch").catch(() => []),
  ]);

  if (holidays.some((h) => !h.country || String(h.country).toUpperCase() !== "PH")) return summary; // US holiday — nobody missed

  const clockedIn = new Set(entries.filter((e) => e.check_in).map((e) => e.profile_id));
  const onPto = new Set(ptos.map((p) => p.profile_id));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();

  const missedTechs = profiles.filter((p) => {
    if (!isTechnician(p)) return false;
    if (norm(p.assigned_branch) === "philippines") return false;
    if (norm(p.employment_type) === "trainee") return false;
    if (p.created_at.slice(0, 10) > date) return false; // didn't work here yet
    summary.checked++;
    if ((p.off_days ?? []).includes(dow)) return false;
    if (onPto.has(p.id)) return false;
    return !clockedIn.has(p.id);
  });
  summary.missed = missedTechs.length;

  const byName = (companyId: string, name: string | null | undefined) => {
    const n = norm(name);
    return n ? profiles.find((o) => o.company_id === companyId && norm(o.display_name) === n)?.id ?? null : null;
  };
  const branchRoleRow = new Map(branchRoles.map((r) => [norm(r.branch), r]));

  // recipient -> technicians to tell them about
  const toNotify = new Map<string, { companyId: string; names: string[] }>();
  for (const p of missedTechs) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/clock_in_meetings?on_conflict=profile_id,missed_date,kind`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation,resolution=ignore-duplicates" },
        body: JSON.stringify({ company_id: p.company_id, profile_id: p.id, missed_date: date, kind: "missed_clock_in" }),
      });
      const inserted: unknown[] = res.ok ? await res.json() : [];
      if (!res.ok) {
        summary.errors.push(`${p.display_name}: HTTP ${res.status}`);
        continue;
      }
      if (inserted.length === 0) continue; // already recorded by an earlier run
      summary.newMeetings++;

      const recipients = new Set<string>();
      const manager = byName(p.company_id, p.manager_name);
      if (manager) recipients.add(manager);
      const row = branchRoleRow.get(norm(p.assigned_branch));
      for (const name of [row?.branch_manager, row?.parts_manager]) {
        const id = byName(p.company_id, name);
        if (id) recipients.add(id);
      }
      for (const s of sbmBranches) if (norm(s.branch) === norm(p.assigned_branch)) recipients.add(s.profile_id);
      recipients.delete(p.id);
      for (const r of recipients) {
        if (!toNotify.has(r)) toNotify.set(r, { companyId: p.company_id, names: [] });
        toNotify.get(r)!.names.push(p.display_name || "A technician");
      }
    } catch (e) {
      summary.errors.push(`${p.display_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const [recipientId, { companyId, names }] of toNotify) {
    const preview = names.slice(0, 5).join(", ") + (names.length > 5 ? `, +${names.length - 5} more` : "");
    const body = `${names.length} technician${names.length === 1 ? "" : "s"} missed clock-in on ${date} — meeting required: ${preview}.`;
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
        method: "POST",
        headers,
        body: JSON.stringify({ company_id: companyId, recipient_id: recipientId, sender_id: null, sender_name: "Clock-In Monitor", body, link_to: MEETINGS_PAGE }),
      });
      if (res.ok) summary.notificationsSent++;
      else summary.errors.push(`Notify ${recipientId}: HTTP ${res.status}`);
    } catch (e) {
      summary.errors.push(`Notify ${recipientId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}

// ───────────────────────────────────────────────────────────────────────
// Missed Time Out (migration 0349): the technician didn't press Time Out —
// the day was closed by an automatic clock-out ("[Auto clock-out …]" note:
// midnight force clock-out or arrived-home geofence) — and they didn't send
// a Time Correction request for that day before their next Time In (or by
// the end of their next work day if they didn't clock in). Then: one
// 'missed_time_out' meeting row (1 error on the report) and a notification
// to their manager, Branch Manager and Senior Branch Manager.
// ───────────────────────────────────────────────────────────────────────

const MISSED_TIME_OUT_FROM = "2026-10-03";
const LOOKBACK_DAYS = 14;

interface TimeOutSummary {
  autoClockOuts: number;
  pending: number;
  corrected: number;
  newMeetings: number;
  notificationsSent: number;
  errors: string[];
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

export async function runMissedTimeOutMeetings(env: Record<string, string | undefined>): Promise<TimeOutSummary> {
  const summary: TimeOutSummary = { autoClockOuts: 0, pending: 0, corrected: 0, newMeetings: 0, notificationsSent: 0, errors: [] };
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? env.VITE_SUPABASE_URL;
  const serviceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    summary.errors.push("Missing Supabase URL/service key.");
    return summary;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  // Pages past PostgREST's 1000-row cap (two weeks of everyone's timecards
  // is well over it).
  const get = async <T,>(path: string): Promise<T[]> => {
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
  const from = [MISSED_TIME_OUT_FROM, addDays(today, -LOOKBACK_DAYS)].sort()[1];
  if (from >= today) return summary;

  const profiles = await get<Profile>(
    "profiles?select=id,company_id,display_name,role,extra_roles,manager_name,assigned_branch,off_days,created_at&is_active=eq.true",
  );
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const [autoEntries, laterEntries, corrections, existing, branchRoles, sbmBranches] = await Promise.all([
    get<{ profile_id: string; work_date: string }>(`timecard_entries?select=profile_id,work_date&work_date=gte.${from}&work_date=lt.${today}&notes=like.*%5BAuto%20clock-out*`),
    get<{ profile_id: string; work_date: string; check_in: string | null }>(`timecard_entries?select=profile_id,work_date,check_in&work_date=gt.${from}&check_in=not.is.null`),
    get<{ profile_id: string; work_date: string; created_at: string }>(`timecard_corrections?select=profile_id,work_date,created_at&work_date=gte.${from}`),
    get<{ profile_id: string; missed_date: string }>(`clock_in_meetings?select=profile_id,missed_date&kind=eq.missed_time_out&missed_date=gte.${from}`),
    get<{ branch: string; branch_manager: string | null }>("general_info_branch_roles?select=branch,branch_manager").catch(() => []),
    get<{ profile_id: string; branch: string }>("senior_branch_manager_branches?select=profile_id,branch").catch(() => []),
  ]);
  const already = new Set(existing.map((e) => `${e.profile_id}|${e.missed_date}`));
  const branchRoleRow = new Map(branchRoles.map((r) => [norm(r.branch), r]));
  const byName = (companyId: string, name: string | null | undefined) => {
    const n = norm(name);
    return n ? profiles.find((o) => o.company_id === companyId && norm(o.display_name) === n)?.id ?? null : null;
  };

  const toNotify = new Map<string, { companyId: string; lines: string[] }>();
  const nowMs = Date.now();

  for (const e of autoEntries) {
    const p = byId.get(e.profile_id);
    if (!p || !isTechnician(p) || norm(p.assigned_branch) === "philippines") continue;
    if (already.has(`${p.id}|${e.work_date}`)) continue;
    summary.autoClockOuts++;
    const tz = timezoneForBranch(p.assigned_branch);

    // Deadline: their next Time In after that day (if it's on their next
    // work day); otherwise the end of their next scheduled work day.
    const next = laterEntries
      .filter((x) => x.profile_id === p.id && x.work_date > e.work_date && x.check_in)
      .sort((a, b) => a.work_date.localeCompare(b.work_date))[0];
    let nextWorkDay = addDays(e.work_date, 1);
    for (let i = 0; i < 7 && (p.off_days ?? []).includes(new Date(`${nextWorkDay}T00:00:00Z`).getUTCDay()); i++) nextWorkDay = addDays(nextWorkDay, 1);
    const deadlineMs = next && next.work_date <= nextWorkDay
      ? zonedToUtcMs(next.work_date, next.check_in!, tz)
      : zonedToUtcMs(addDays(nextWorkDay, 1), "00:00:00", tz);

    const fixedInTime = corrections.some((c) => c.profile_id === p.id && c.work_date === e.work_date && Date.parse(c.created_at) <= deadlineMs);
    if (fixedInTime) { summary.corrected++; continue; }
    if (nowMs < deadlineMs) { summary.pending++; continue; } // still time to fix it

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/clock_in_meetings?on_conflict=profile_id,missed_date,kind`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation,resolution=ignore-duplicates" },
        body: JSON.stringify({ company_id: p.company_id, profile_id: p.id, missed_date: e.work_date, kind: "missed_time_out" }),
      });
      if (!res.ok) { summary.errors.push(`${p.display_name}: HTTP ${res.status}`); continue; }
      const inserted: unknown[] = await res.json();
      if (inserted.length === 0) continue;
      summary.newMeetings++;

      // Correction meeting with Branch Manager & above.
      const recipients = new Set<string>();
      const manager = byName(p.company_id, p.manager_name);
      if (manager) recipients.add(manager);
      const bm = byName(p.company_id, branchRoleRow.get(norm(p.assigned_branch))?.branch_manager);
      if (bm) recipients.add(bm);
      for (const s of sbmBranches) if (norm(s.branch) === norm(p.assigned_branch)) recipients.add(s.profile_id);
      recipients.delete(p.id);
      for (const r of recipients) {
        if (!toNotify.has(r)) toNotify.set(r, { companyId: p.company_id, lines: [] });
        toNotify.get(r)!.lines.push(`${p.display_name || "A technician"} (${e.work_date})`);
      }
    } catch (err) {
      summary.errors.push(`${p.display_name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [recipientId, { companyId, lines }] of toNotify) {
    const preview = lines.slice(0, 5).join(", ") + (lines.length > 5 ? `, +${lines.length - 5} more` : "");
    const body = `${lines.length} technician${lines.length === 1 ? "" : "s"} missed Time Out and didn't send a correction before their next Time In — mandatory correction meeting: ${preview}. Maverick Team can help with time card adjustments.`;
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
        method: "POST",
        headers,
        body: JSON.stringify({ company_id: companyId, recipient_id: recipientId, sender_id: null, sender_name: "Clock-In Monitor", body, link_to: MEETINGS_PAGE }),
      });
      if (res.ok) summary.notificationsSent++;
      else summary.errors.push(`Notify ${recipientId}: HTTP ${res.status}`);
    } catch (err) {
      summary.errors.push(`Notify ${recipientId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
