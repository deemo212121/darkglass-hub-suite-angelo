/**
 * Every-5-minutes Cron Trigger job (see scheduled() in src/server.ts): flag
 * any active employee who has blown through their grace period (PH 5 min,
 * US office 15 min, Technicians none — see payGraceMinutesFor in
 * attendanceGrace.ts) on their scheduled clock-in or clock-out — never clocked in past
 * required_check_in, or clocked in but never clocked out past
 * required_check_out — and hasn't already been notified about this exact
 * gap today, then ping HR/Finance plus their resolved manager (Admin/
 * SuperAdmin deliberately excluded — see NOTIFY_ROLES below). Mirrors
 * nsaPartsSync.ts's structure (raw REST + service key,
 * per-item try/catch, a plain summary object).
 *
 * Notifications are batched per (recipient, alert type) per run, not sent
 * one-per-employee — since most employees share the same shift time, a
 * single 5-minute tick commonly crosses the grace deadline for many people
 * at once (e.g. everyone on the 08:00 shift), and a recipient who'd be
 * notified about all of them gets exactly one notification listing them,
 * not a flood of individual ones.
 *
 * Escalation: when an employee's daily grace-period miss (of the same type)
 * extends to exactly 3 consecutive scheduled work days, a second, distinctly
 * worded notification fires alongside the daily one — same recipients
 * (HR/Finance + resolved manager). "Exactly 3" (not "3 or
 * more") is deliberate: attendance_alerts is an append-only daily ledger, so
 * checking "were the last 3 scheduled days all misses" is naturally true on
 * every day of a 4th, 5th, ... day streak too — gating on exactly 3 means
 * this fires once per fresh streak instead of re-escalating every day a
 * chronic problem continues.
 *
 * Runs company-wide (not scoped to one tenant) since it's a single global
 * scheduled job — company_id groups the roster internally.
 *
 * Each employee's grace-period MINUTE comparison uses their own branch's
 * real local timezone (Philippines follows Central by policy) — see
 * timezoneForBranch in attendanceGrace.ts. Calendar-day boundaries (which
 * date is "today", off_days weekday, streak history window) stay anchored
 * to a single Central-Time reference regardless of branch, since that skew
 * is at most 1 hour and not worth a separate per-branch date axis.
 *
 * PTO-awareness is deliberately not handled here — an employee on approved
 * PTO today still gets evaluated like anyone else with a schedule. That gap
 * already existed in the client-side alert logic and wasn't part of the ask.
 *
 * missing_clock_out gets one more recipient group on top of HR/Finance +
 * resolved manager: when the flagged profile is a technician (any
 * TECHNICIAN_PAY_ROLES tier), their branch's Branch Manager and Parts
 * Manager (General Information's per-branch directory,
 * general_info_branch_roles — the same free-typed-name table
 * GeneralInfoPage.tsx edits and AttendanceMonitoringPage.tsx's Branch
 * Manager/Senior Branch Manager columns read) also get notified — they're
 * the ones who actually need to know a technician never clocked out, not
 * just HR. Resolved by matching the directory's free-typed name against
 * profiles.display_name, same tolerance resolveManagerId already uses
 * below. missing_clock_in intentionally does not get this treatment — the
 * ask was specifically about not clocking OUT.
 */

import {
  addMinutesToHHMM,
  nowInTimezone,
  timezoneForBranch,
  DEFAULT_ATTENDANCE_TIMEZONE,
  payGraceMinutesFor,
} from "../attendanceGrace";
import { TECHNICIAN_PAY_ROLES } from "../roleLabels";
import { readEnv, fetchGmailConnection, refreshAccessToken, sendGmailMessage, fetchProfileByFirebaseUid } from "./gmailBridge";
import { verifyFirebaseToken } from "./supabaseTokenBridge";

type AlertType = "missing_clock_in" | "missing_clock_out";
type NotificationKind = AlertType | "pattern_missing_clock_in" | "pattern_missing_clock_out";

const STREAK_LENGTH = 3;

interface AlertSummary {
  profilesChecked: number;
  missingClockInFired: number;
  missingClockOutFired: number;
  streaksFired: number;
  notificationsSent: number;
  graceWarningsFired: number;
  graceWarningEmailsSent: number;
  errors: string[];
  /** Only populated when dryRun is true — the batches that would have been sent. */
  dryRunPreview?: Array<{ kind: NotificationKind; recipientId: string; employeeNames: string[] }>;
}

interface FiredAlert {
  companyId: string;
  employeeName: string;
  kind: NotificationKind;
  recipients: Set<string>;
}

/** Groups newly-fired alerts by (recipient, kind) so each recipient gets one notification per kind per run. */
function groupFiredAlerts(
  fired: FiredAlert[]
): Array<{ companyId: string; kind: NotificationKind; recipientId: string; employeeNames: string[] }> {
  const map = new Map<
    string,
    { companyId: string; kind: NotificationKind; recipientId: string; employeeNames: string[] }
  >();
  for (const alert of fired) {
    for (const recipientId of alert.recipients) {
      const key = `${recipientId}|${alert.kind}`;
      if (!map.has(key)) map.set(key, { companyId: alert.companyId, kind: alert.kind, recipientId, employeeNames: [] });
      map.get(key)!.employeeNames.push(alert.employeeName);
    }
  }
  return Array.from(map.values());
}

function batchNotificationBody(kind: NotificationKind, employeeNames: string[], dateISO: string): string {
  const count = employeeNames.length;
  const preview = employeeNames.slice(0, 5).join(", ") + (count > 5 ? `, +${count - 5} more` : "");
  if (kind === "missing_clock_in" || kind === "missing_clock_out") {
    const verb = kind === "missing_clock_in" ? "clocked in" : "clocked out";
    return `${count} employee${count === 1 ? " has" : "s have"} not ${verb} yet (5-min grace expired) — ${dateISO}: ${preview}.`;
  }
  const verb = kind === "pattern_missing_clock_in" ? "missed clock-in" : "missed clock-out";
  return `⚠ ${count} employee${count === 1 ? " has" : "s have"} ${verb} ${STREAK_LENGTH} scheduled days in a row (as of ${dateISO}): ${preview}.`;
}

/** The `count` most recent scheduled (non-off-day) dates on/before dateISO, most recent first. Capped to avoid an unbounded walk for a pathological all-days-off profile. */
function scheduledDatesBefore(dateISO: string, offDays: Set<number>, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${dateISO}T00:00:00`);
  for (let i = 0; i < 60 && dates.length < count; i++) {
    if (!offDays.has(cursor.getDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

interface ServerProfile {
  id: string;
  company_id: string;
  display_name: string | null;
  email: string | null;
  role: string | null;
  extra_roles: string[] | null;
  manager_name: string | null;
  assigned_branch: string | null;
  required_check_in: string | null;
  required_check_out: string | null;
  off_days: number[] | null;
}

type GraceWarningType = "grace_warning_clock_in" | "grace_warning_clock_out";

interface FiredGraceWarning {
  companyId: string;
  managerId: string;
  employeeName: string;
  kind: GraceWarningType;
}

// Admin/SuperAdmin deliberately excluded — routine attendance misses are
// HR/Finance's job to track, not something every admin needs pinged about.
const NOTIFY_ROLES = new Set(["HR", "FINANCE"]);

function normalizeRole(role: string | null | undefined): string {
  return String(role ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

// Held roles pile up — mirrors resolveTeamLeadOrManager's CSR branch in
// src/lib/notifyRouting.ts, which checks [profile.role, ...(profile.extra_roles ?? [])].
function isCsrRole(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return [role, ...(extraRoles ?? [])].some((r) => {
    const n = normalizeRole(r);
    return n === "CSR" || n.startsWith("CSR");
  });
}

function resolveCreds(env: Record<string, string | undefined>) {
  const g = globalThis as any;
  const supabaseUrl =
    (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? env.VITE_SUPABASE_URL;
  const supabaseServiceKey =
    (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ??
    env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, supabaseServiceKey };
}

export async function runAttendanceAlertCheck(
  env: Record<string, string | undefined>,
  opts: { dryRun?: boolean } = {}
): Promise<AlertSummary> {
  const summary: AlertSummary = {
    profilesChecked: 0,
    missingClockInFired: 0,
    missingClockOutFired: 0,
    streaksFired: 0,
    notificationsSent: 0,
    graceWarningsFired: 0,
    graceWarningEmailsSent: 0,
    errors: [],
    ...(opts.dryRun ? { dryRunPreview: [] } : {}),
  };
  const { supabaseUrl, supabaseServiceKey } = resolveCreds(env);
  if (!supabaseUrl || !supabaseServiceKey) {
    summary.errors.push("Missing Supabase URL/service key — cannot run.");
    return summary;
  }
  const sbHeaders = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    "Content-Type": "application/json",
  };

  // Calendar-day boundary (which date is "today", off_days weekday, streak
  // history window) is anchored to the default policy timezone (Central) —
  // branch-to-branch date-rollover skew is at most the 1-hour Eastern/Central
  // gap, not worth a separate per-branch date axis. The grace-period MINUTE
  // comparison below, however, IS per-branch (see nowHHMMByTimezone).
  const { dateISO } = nowInTimezone(DEFAULT_ATTENDANCE_TIMEZONE);
  const dow = new Date(`${dateISO}T00:00:00`).getDay();

  // 21 calendar days is comfortably enough to contain 3 scheduled days even
  // for a part-time (e.g. 2-days/week) work pattern, for the streak check below.
  const historyStart = (() => {
    const d = new Date(`${dateISO}T00:00:00`);
    d.setDate(d.getDate() - 21);
    return d.toISOString().slice(0, 10);
  })();

  const [profilesRes, entriesRes, alertsRes, historyRes, membersRes, branchRolesRes, warningSubsRes] = await Promise.all([
    fetch(
      `${supabaseUrl}/rest/v1/profiles?select=id,company_id,display_name,email,role,extra_roles,manager_name,assigned_branch,required_check_in,required_check_out,off_days&is_active=eq.true`,
      { headers: sbHeaders }
    ),
    fetch(`${supabaseUrl}/rest/v1/timecard_entries?select=profile_id,check_in,check_out&work_date=eq.${dateISO}`, {
      headers: sbHeaders,
    }),
    fetch(`${supabaseUrl}/rest/v1/attendance_alerts?select=profile_id,alert_type&work_date=eq.${dateISO}`, {
      headers: sbHeaders,
    }),
    fetch(
      `${supabaseUrl}/rest/v1/attendance_alerts?select=profile_id,work_date,alert_type&work_date=gte.${historyStart}&work_date=lt.${dateISO}`,
      { headers: sbHeaders }
    ),
    fetch(`${supabaseUrl}/rest/v1/csr_team_members?select=profile_id,team_id,is_leader`, { headers: sbHeaders }),
    fetch(`${supabaseUrl}/rest/v1/general_info_branch_roles?select=branch,branch_manager,parts_manager`, {
      headers: sbHeaders,
    }),
    // Grace-warning email enrollment (Attendance Monitoring's SuperAdmin-only
    // Settings tab, migration 0217) — which managers opted in.
    fetch(`${supabaseUrl}/rest/v1/attendance_warning_subscriptions?select=manager_profile_id`, { headers: sbHeaders }),
  ]);
  if (!profilesRes.ok) {
    summary.errors.push(`Failed to list profiles: HTTP ${profilesRes.status}`);
    return summary;
  }
  const profiles: ServerProfile[] = await profilesRes.json();

  // Grace-period MINUTE comparison is per-branch-timezone — compute once per
  // distinct zone actually in use rather than once per profile.
  const nowHHMMByTimezone = new Map<string, string>();
  new Set(profiles.map((p) => timezoneForBranch(p.assigned_branch))).forEach((tz) => {
    nowHHMMByTimezone.set(tz, nowInTimezone(tz).hhmm);
  });

  const entries: Array<{ profile_id: string; check_in: string | null; check_out: string | null }> = entriesRes.ok
    ? await entriesRes.json()
    : [];
  const alreadyNotified: Array<{ profile_id: string; alert_type: string }> = alertsRes.ok ? await alertsRes.json() : [];
  const history: Array<{ profile_id: string; work_date: string; alert_type: string }> = historyRes.ok
    ? await historyRes.json()
    : [];
  const teamMembers: Array<{ profile_id: string; team_id: string; is_leader: boolean }> = membersRes.ok
    ? await membersRes.json()
    : [];
  const branchRoles: Array<{ branch: string; branch_manager: string | null; parts_manager: string | null }> =
    branchRolesRes.ok ? await branchRolesRes.json() : [];
  const branchRolesByBranch = new Map(branchRoles.map((r) => [r.branch.trim().toLowerCase(), r]));
  const warningSubs: Array<{ manager_profile_id: string }> = warningSubsRes.ok ? await warningSubsRes.json() : [];
  const subscribedManagerIds = new Set(warningSubs.map((r) => r.manager_profile_id));

  const entryByProfile = new Map(entries.map((e) => [e.profile_id, e]));
  const dedupSet = new Set(alreadyNotified.map((a) => `${a.profile_id}|${a.alert_type}`));
  const historySet = new Set(history.map((h) => `${h.profile_id}|${h.work_date}|${h.alert_type}`));

  /** Does this profile's streak of `alertType` misses, ending today (today counts as a hit by construction — the caller only calls this once today's miss is confirmed), equal exactly STREAK_LENGTH? */
  function hasFreshStreak(profileId: string, alertType: AlertType, offDays: Set<number>): boolean {
    const dates = scheduledDatesBefore(dateISO, offDays, STREAK_LENGTH);
    if (dates.length < STREAK_LENGTH) return false;
    return dates.every((d) => d === dateISO || historySet.has(`${profileId}|${d}|${alertType}`));
  }

  // CSR team-leader resolution: for a CSR-role profile, find the leader of
  // whichever team they belong to (mirrors resolveTeamLeadOrManager's CSR
  // branch in src/lib/notifyRouting.ts, reimplemented here since that file
  // pulls in the browser Supabase client, which can't run in the Worker).
  function resolveCsrLeaderId(profileId: string): string | null {
    const mine = teamMembers.find((m) => m.profile_id === profileId);
    if (!mine) return null;
    const leader = teamMembers.find((m) => m.team_id === mine.team_id && m.is_leader);
    return leader?.profile_id ?? null;
  }

  // Per-company HR/Finance recipient list.
  const notifyRolesByCompany = new Map<string, Set<string>>();
  profiles.forEach((p) => {
    const roles = [p.role, ...(p.extra_roles ?? [])].map((r) => normalizeRole(r));
    if (roles.some((r) => NOTIFY_ROLES.has(r))) {
      if (!notifyRolesByCompany.has(p.company_id)) notifyRolesByCompany.set(p.company_id, new Set());
      notifyRolesByCompany.get(p.company_id)!.add(p.id);
    }
  });

  function resolveManagerId(p: ServerProfile): string | null {
    if (isCsrRole(p.role, p.extra_roles)) {
      const leaderId = resolveCsrLeaderId(p.id);
      if (leaderId) return leaderId;
    }
    const managerName = (p.manager_name || "").trim().toLowerCase();
    if (!managerName) return null;
    const match = profiles.find(
      (o) => o.company_id === p.company_id && (o.display_name || "").trim().toLowerCase() === managerName
    );
    return match?.id ?? null;
  }

  // Deliberately the plain manager_name lookup only (no CSR-team-leader
  // special case, unlike resolveManagerId above) — this is exactly the
  // candidate set Attendance Monitoring's Settings tab offers as
  // enrollable checkboxes, so a grace-warning email only ever targets
  // someone who could actually have been enrolled for it.
  function resolveManagerIdSimple(p: ServerProfile): string | null {
    const managerName = (p.manager_name || "").trim().toLowerCase();
    if (!managerName) return null;
    const match = profiles.find(
      (o) => o.company_id === p.company_id && (o.display_name || "").trim().toLowerCase() === managerName
    );
    return match?.id ?? null;
  }

  // Only for missing_clock_out, only for technicians (see this file's own
  // header comment) — the branch's Branch Manager and Parts Manager from
  // General Information's directory, resolved by name the same tolerant
  // way resolveManagerId is. Either field being blank/unmatched just
  // contributes nothing, same as resolveManagerId returning null.
  function resolveBranchRoleRecipientIds(p: ServerProfile): string[] {
    if (!TECHNICIAN_PAY_ROLES.has(normalizeRole(p.role))) return [];
    const branch = (p.assigned_branch || "").trim().toLowerCase();
    if (!branch) return [];
    const row = branchRolesByBranch.get(branch);
    if (!row) return [];
    const names = [row.branch_manager, row.parts_manager]
      .map((n) => (n || "").trim().toLowerCase())
      .filter((n): n is string => !!n);
    const ids: string[] = [];
    for (const name of names) {
      const match = profiles.find(
        (o) => o.company_id === p.company_id && (o.display_name || "").trim().toLowerCase() === name
      );
      if (match) ids.push(match.id);
    }
    return ids;
  }

  const firedAlerts: FiredAlert[] = [];
  const graceWarningsFired: FiredGraceWarning[] = [];

  for (const p of profiles) {
    if (!p.required_check_in && !p.required_check_out) continue;
    const offDays = new Set(p.off_days ?? []);
    if (offDays.has(dow)) continue;
    summary.profilesChecked++;

    const entry = entryByProfile.get(p.id);
    const checkIn = entry?.check_in || "";
    const checkOut = entry?.check_out || "";

    const nowHHMM = nowHHMMByTimezone.get(timezoneForBranch(p.assigned_branch))!;
    const country = p.assigned_branch === "Philippines" ? "PH" : "US";
    const graceMinutes = payGraceMinutesFor(country);
    const graceIn = p.required_check_in ? addMinutesToHHMM(p.required_check_in, graceMinutes) : null;
    const graceOut = p.required_check_out ? addMinutesToHHMM(p.required_check_out, graceMinutes) : null;

    const flags: AlertType[] = [];
    if (!checkIn && graceIn && nowHHMM > graceIn) flags.push("missing_clock_in");
    if (checkIn && !checkOut && graceOut && nowHHMM > graceOut) flags.push("missing_clock_out");

    for (const alertType of flags) {
      const dedupKey = `${p.id}|${alertType}`;
      if (dedupSet.has(dedupKey)) continue;

      const employeeName = p.display_name || "This employee";
      const recipients = new Set<string>(notifyRolesByCompany.get(p.company_id) ?? []);
      const managerId = resolveManagerId(p);
      if (managerId) recipients.add(managerId);
      if (alertType === "missing_clock_out") {
        resolveBranchRoleRecipientIds(p).forEach((id) => recipients.add(id));
      }
      recipients.delete(p.id);

      const recordFired = () => {
        firedAlerts.push({ companyId: p.company_id, employeeName, kind: alertType, recipients });
        if (hasFreshStreak(p.id, alertType, offDays)) {
          const streakKind: NotificationKind = alertType === "missing_clock_in" ? "pattern_missing_clock_in" : "pattern_missing_clock_out";
          firedAlerts.push({ companyId: p.company_id, employeeName, kind: streakKind, recipients });
          summary.streaksFired++;
        }
      };

      if (opts.dryRun) {
        recordFired();
        continue;
      }

      try {
        // on_conflict names the unique constraint explicitly — without it,
        // Prefer: resolution=ignore-duplicates has nothing to match against
        // and a real racing duplicate just 409s instead of no-op'ing (confirmed
        // against real data while verifying this job).
        const insertRes = await fetch(
          `${supabaseUrl}/rest/v1/attendance_alerts?on_conflict=profile_id,work_date,alert_type`,
          {
            method: "POST",
            headers: { ...sbHeaders, Prefer: "return=representation,resolution=ignore-duplicates" },
            body: JSON.stringify({ company_id: p.company_id, profile_id: p.id, work_date: dateISO, alert_type: alertType }),
          }
        );
        const inserted: unknown[] = insertRes.ok ? await insertRes.json() : [];
        if (!insertRes.ok || inserted.length === 0) continue; // already claimed by a concurrent/earlier run
        recordFired();
      } catch (e) {
        summary.errors.push(`${employeeName} (${alertType}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── Grace-warning email (Settings tab, migration 0217) — fires the
    // moment the scheduled time passes, while still WITHIN the grace
    // window (missing_clock_in/out above only fire once grace has fully
    // expired) — only for an employee whose resolved manager has actually
    // opted in. Silently does nothing for anyone else, same as
    // resolveManagerId returning null does for the alerts above. ──
    const graceWarningFlags: GraceWarningType[] = [];
    if (!checkIn && p.required_check_in && nowHHMM > p.required_check_in && (!graceIn || nowHHMM <= graceIn)) {
      graceWarningFlags.push("grace_warning_clock_in");
    }
    if (checkIn && !checkOut && p.required_check_out && nowHHMM > p.required_check_out && (!graceOut || nowHHMM <= graceOut)) {
      graceWarningFlags.push("grace_warning_clock_out");
    }
    for (const alertType of graceWarningFlags) {
      const dedupKey = `${p.id}|${alertType}`;
      if (dedupSet.has(dedupKey)) continue;
      const managerId = resolveManagerIdSimple(p);
      if (!managerId || !subscribedManagerIds.has(managerId)) continue;

      const employeeName = p.display_name || "This employee";
      const recordFired = () => graceWarningsFired.push({ companyId: p.company_id, managerId, employeeName, kind: alertType });

      if (opts.dryRun) {
        recordFired();
        continue;
      }
      try {
        const insertRes = await fetch(
          `${supabaseUrl}/rest/v1/attendance_alerts?on_conflict=profile_id,work_date,alert_type`,
          {
            method: "POST",
            headers: { ...sbHeaders, Prefer: "return=representation,resolution=ignore-duplicates" },
            body: JSON.stringify({ company_id: p.company_id, profile_id: p.id, work_date: dateISO, alert_type: alertType }),
          }
        );
        const inserted: unknown[] = insertRes.ok ? await insertRes.json() : [];
        if (!insertRes.ok || inserted.length === 0) continue; // already claimed by a concurrent/earlier run
        recordFired();
      } catch (e) {
        summary.errors.push(`${employeeName} (${alertType}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  summary.graceWarningsFired = graceWarningsFired.length;
  summary.missingClockInFired = firedAlerts.filter((a) => a.kind === "missing_clock_in").length;
  summary.missingClockOutFired = firedAlerts.filter((a) => a.kind === "missing_clock_out").length;

  const groups = groupFiredAlerts(firedAlerts);

  if (opts.dryRun) {
    summary.dryRunPreview = groups.map((g) => ({
      kind: g.kind,
      recipientId: g.recipientId,
      employeeNames: g.employeeNames,
    }));
    return summary;
  }

  for (const g of groups) {
    const body = batchNotificationBody(g.kind, g.employeeNames, dateISO);
    try {
      const notifyRes = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify({
          company_id: g.companyId,
          recipient_id: g.recipientId,
          sender_id: null,
          sender_name: "Attendance Monitor",
          body,
          link_to: "/m/dashboard/attendance-monitoring",
        }),
      });
      if (notifyRes.ok) summary.notificationsSent++;
      else summary.errors.push(`Notify ${g.recipientId} (${g.kind} batch of ${g.employeeNames.length}) failed: HTTP ${notifyRes.status}`);
    } catch (e) {
      summary.errors.push(`Notify ${g.recipientId} (${g.kind} batch): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Grace-warning emails — one per enrolled manager per run, listing
  // every employee of theirs currently inside (not yet past) their grace
  // window. Silently skipped for a company with no ATTENDANCE Gmail
  // connected, or a manager with no email on file — same "nothing to send
  // to" tolerance the rest of this job already has for a null recipient. ──
  const warningsByManager = new Map<string, { companyId: string; employeeKinds: Array<{ name: string; kind: GraceWarningType }> }>();
  for (const w of graceWarningsFired) {
    if (!warningsByManager.has(w.managerId)) warningsByManager.set(w.managerId, { companyId: w.companyId, employeeKinds: [] });
    warningsByManager.get(w.managerId)!.employeeKinds.push({ name: w.employeeName, kind: w.kind });
  }

  if (warningsByManager.size > 0) {
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const gmailEnvResult = readEnv(env);
    if ("error" in gmailEnvResult) {
      summary.errors.push(`Grace-warning emails skipped: ${gmailEnvResult.error}`);
    } else {
      const gmailEnv = gmailEnvResult;
      // One ATTENDANCE connection lookup per distinct company involved, not per manager.
      const connectionByCompany = new Map<string, { refreshToken: string; connectedEmail: string | null } | null>();
      for (const info of warningsByManager.values()) {
        if (!connectionByCompany.has(info.companyId)) {
          connectionByCompany.set(info.companyId, await fetchGmailConnection(gmailEnv, info.companyId, "ATTENDANCE"));
        }
      }
      for (const [managerId, info] of warningsByManager) {
        const manager = profileById.get(managerId);
        if (!manager?.email) continue;
        const connection = connectionByCompany.get(info.companyId);
        if (!connection) continue; // ATTENDANCE Gmail not connected for this company
        try {
          const accessToken = await refreshAccessToken(gmailEnv, connection.refreshToken);
          const fromEmail = connection.connectedEmail || "me";
          const inNames = info.employeeKinds.filter((e) => e.kind === "grace_warning_clock_in").map((e) => e.name);
          const outNames = info.employeeKinds.filter((e) => e.kind === "grace_warning_clock_out").map((e) => e.name);
          const lines: string[] = [`Hi ${manager.display_name || "there"},`, ""];
          if (inNames.length) {
            lines.push("Not yet clocked in (still within grace time):", ...inNames.map((n) => `• ${n}`), "");
          }
          if (outNames.length) {
            lines.push("Not yet clocked out (still within grace time):", ...outNames.map((n) => `• ${n}`), "");
          }
          lines.push("This is an early heads-up before their grace time runs out — no action needed if they're already on their way.");
          const subject = `Attendance grace warning — ${dateISO}`;
          await sendGmailMessage(accessToken, fromEmail, manager.email, subject, lines.join("\n"));
          summary.graceWarningEmailsSent++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          summary.errors.push(`Grace-warning email to ${manager.display_name || managerId}: ${msg}`);
        }
      }
    }
  }

  return summary;
}

// Manual "Run Now" trigger — the every-5-minute Cron Trigger above only
// ever fires in a deployed Worker; `vite dev` runs no Workers runtime at
// all (the Cloudflare Vite plugin is build-only — see vite.config.ts's own
// comment on this), so there is no way to exercise this job locally
// without it. This is a REAL run (writes real attendance_alerts dedup
// rows, sends real grace-warning emails) — not a separate sandboxed test
// path — same side effects the cron itself has, just triggered by a
// button instead of a timer. SuperAdmin-only, since it's reachable from
// Attendance Monitoring's Settings tab (which is itself hidden from every
// other role) and nothing else should be able to fire it on demand.
export async function handleRunAttendanceAlertsRequest(request: Request, env: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    if (!idToken) return json({ error: "Missing idToken" }, 400);

    const envResult = readEnv(env);
    if ("error" in envResult) return json(envResult, 500);

    const claims = await verifyFirebaseToken(idToken, envResult.firebaseProjectId);
    const caller = await fetchProfileByFirebaseUid(envResult, claims.sub);
    if (!caller) return json({ error: "Profile not found" }, 403);
    const isCallerSuperAdmin = [caller.role, ...caller.extraRoles].some((r) => (r || "").toUpperCase() === "SUPERADMIN");
    if (!isCallerSuperAdmin) return json({ error: "Only a SuperAdmin can run this" }, 403);

    const dryRun = payload.dryRun === true;
    const result = await runAttendanceAlertCheck(env, { dryRun });
    return json({ ok: true, result });
  } catch (err) {
    console.error("[attendanceAlerts] manual run error:", err);
    return json({ error: err instanceof Error ? err.message : "Run failed" }, 500);
  }
}
