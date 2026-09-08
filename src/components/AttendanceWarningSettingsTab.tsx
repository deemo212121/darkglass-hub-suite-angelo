/**
 * Attendance Monitoring's "Settings" tab — SuperAdmin-only (hidden from
 * every other role by the parent page, see AttendanceMonitoringPage.tsx's
 * tabConfig). Two pieces:
 *
 * 1. Connect Gmail for the "ATTENDANCE" slot (migration 0217, same
 *    connect/disconnect RPC pattern AccountingDashboard.tsx already uses
 *    for US/PH Payroll) — whichever account is connected here is what
 *    grace-warning emails are sent from.
 * 2. A checkbox list of every "direct manager" in the company (anyone who
 *    appears as some other profile's manager_name — the same candidate
 *    set src/lib/server/attendanceAlerts.ts's resolveManagerIdSimple
 *    resolves to) — checking a manager enrolls them to receive an email
 *    the moment one of their reports' scheduled check-in/check-out time
 *    passes while still inside the grace window (attendanceGrace.ts's
 *    payGraceMinutesFor), so they can act before grace fully runs out.
 *    Present/still-absent counts (split Technicians vs Office) next to
 *    each name are today's live snapshot — context only, not the trigger.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Mail, Loader2, ChevronRight, Play } from "lucide-react";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import {
  getAttendanceWarningSubscribedManagerIds,
  enrollAttendanceWarningManager,
  unenrollAttendanceWarningManager,
  sendAttendanceEnrollmentEmail,
  runAttendanceAlertsNow,
  sendAttendanceTestWarningEmail,
  type AttendanceAlertRunSummary,
} from "@/lib/supabase/attendanceWarningSubscriptions";
import { getGmailConnectionStatus, disconnectGmail, type GmailConnectionStatus } from "@/lib/supabase/gmailConnection";
import { TECHNICIAN_PAY_ROLES, normalizeRole } from "@/lib/roleLabels";
import { addMinutesToHHMM, payGraceMinutesFor, nowInTimezone, timezoneForBranch } from "@/lib/attendanceGrace";

const REGION = "ATTENDANCE" as const;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "BRANCH_MANAGER" -> "Branch Manager" — same free-text role field every
 *  other roster table in this app already stores, just made readable here. */
function formatRoleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return role
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** "present" once checked in. Before that, three different things all used
 *  to get flattened into one misleading "Absent" — split apart here so a
 *  shift that simply hasn't started yet doesn't read the same as a real
 *  no-show: "not_due" (scheduled time hasn't arrived), "in_grace" (past
 *  scheduled time but the system hasn't fired anything yet — this is
 *  exactly the window the grace-warning email above sends during), and
 *  "absent" (grace has fully expired, same threshold missing_clock_in
 *  itself uses). */
type ReportStatus = "present" | "not_due" | "in_grace" | "absent";

interface ReportRow {
  profile: ProfileRow;
  isTechnician: boolean;
  checkIn: string | null;
  status: ReportStatus;
  /** The relevant deadline for THIS person's current state: while not yet
   *  checked in, when required_check_in's grace window ends; once checked
   *  in but not out, when required_check_out's grace window ends. Same
   *  payGraceMinutesFor math attendanceAlerts.ts's cron job itself uses —
   *  shown so it's visible exactly when the system will consider this
   *  person's grace window over (and, for the earlier grace-warning email,
   *  when it already fired — the instant their scheduled time passed). */
  graceEndsAt: string | null;
}

interface ManagerRow {
  profile: ProfileRow;
  technicians: { present: number; absent: number };
  office: { present: number; absent: number };
  reports: ReportRow[];
}

/** Test Mode — fake employees, never written to the database (no profiles
 *  row, no timecard, no dedup record), so they can't show up on any other
 *  dashboard and never need cleanup. requiredCheckIn is a real HH:MM the
 *  admin controls (defaults to "a couple minutes ago" so it's immediately
 *  inside grace, no waiting for a real clock window). */
interface TestEmployee {
  id: string;
  name: string;
  requiredCheckIn: string;
}

/** Same status derivation as the real report rows below, just for a
 *  synthetic "not yet clocked in" case (the only scenario Test Mode
 *  needs) — always US grace (15 min), evaluated against the browser's own
 *  local clock rather than a per-branch timezone, since these people
 *  don't have a real branch. */
function testEmployeeStatus(requiredCheckIn: string, nowHHMM: string): { status: ReportStatus; graceEndsAt: string } {
  const graceEndsAt = addMinutesToHHMM(requiredCheckIn, payGraceMinutesFor("US"));
  if (nowHHMM < requiredCheckIn) return { status: "not_due", graceEndsAt };
  if (nowHHMM <= graceEndsAt) return { status: "in_grace", graceEndsAt };
  return { status: "absent", graceEndsAt };
}

function nowHHMMLocal(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function AttendanceWarningSettingsTab({ myProfileId, myDisplayName }: { myProfileId: string | null; myDisplayName: string | null }) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [todayEntries, setTodayEntries] = useState<CompanyTimecardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingManagerId, setSavingManagerId] = useState<string | null>(null);
  const [expandedManagerId, setExpandedManagerId] = useState<string | null>(null);
  // Per-manager result of the LAST enrollment-email send attempt this
  // session — shown inline on their row so a failure (wrong role, Gmail
  // not connected, bad address, ...) is visible right there instead of
  // needing to go check a Sent folder. Ephemeral (not persisted) — clears
  // on reload, which is fine since it's only meant to answer "did the
  // email I just tried to send actually go out."
  const [emailStatusByManagerId, setEmailStatusByManagerId] = useState<Record<string, { state: "sending" | "sent" | "failed"; message?: string }>>({});

  const [runningAlerts, setRunningAlerts] = useState(false);
  const [runResult, setRunResult] = useState<AttendanceAlertRunSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const handleRunNow = async () => {
    setRunningAlerts(true);
    setRunError(null);
    setRunResult(null);
    try {
      const result = await runAttendanceAlertsNow(false);
      setRunResult(result);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to run.");
    } finally {
      setRunningAlerts(false);
    }
  };

  // ── Test Mode ──────────────────────────────────────────────────────────
  const [testManagerId, setTestManagerId] = useState<string>("");
  const [testEmployees, setTestEmployees] = useState<TestEmployee[]>([]);
  const [sendingTest, setSendingTest] = useState(false);
  const [testSendResult, setTestSendResult] = useState<string | null>(null);
  const [testSendError, setTestSendError] = useState<string | null>(null);

  const addTestEmployees = (count: number) => {
    // 2 minutes ago — already past "scheduled," safely inside the 15-min
    // grace window, so it shows as "In grace" immediately with no waiting.
    const d = new Date(Date.now() - 2 * 60_000);
    const requiredCheckIn = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    setTestEmployees((prev) => {
      const start = prev.length + 1;
      const additions: TestEmployee[] = Array.from({ length: count }, (_, i) => ({
        id: `test-${Date.now()}-${i}`,
        name: `Test Employee ${start + i}`,
        requiredCheckIn,
      }));
      return [...prev, ...additions];
    });
    setTestSendResult(null);
    setTestSendError(null);
  };
  const removeTestEmployee = (id: string) => setTestEmployees((prev) => prev.filter((e) => e.id !== id));
  const clearTestEmployees = () => {
    setTestEmployees([]);
    setTestSendResult(null);
    setTestSendError(null);
  };

  const [gmailStatus, setGmailStatus] = useState<GmailConnectionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    const today = todayISO();
    Promise.all([getCompanyUsers(), getAttendanceWarningSubscribedManagerIds(), getCompanyTimecardEntries(today, today)])
      .then(([p, subs, entries]) => {
        setProfiles(p);
        setSubscribedIds(subs);
        setTodayEntries(entries);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load Settings."))
      .finally(() => setLoading(false));
  };

  const loadGmailStatus = () => {
    getGmailConnectionStatus(REGION)
      .then(setGmailStatus)
      .catch((err) => console.error("Failed to load ATTENDANCE Gmail connection status:", err));
  };

  useEffect(() => {
    load();
    loadGmailStatus();
    // Google redirects back here with ?gmailConnected=1|0 after the
    // consent screen (see gmailBridge.ts's returnUrlFor) — show the
    // result once, then strip the params.
    const params = new URLSearchParams(window.location.search);
    const result = params.get("gmailConnected");
    if (result !== null) {
      setError(result === "1" ? null : "Couldn't connect Gmail — please try again.");
      if (result === "1") loadGmailStatus();
      params.delete("gmailConnected");
      params.delete("gmailRegion");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectGmail = async () => {
    setConnecting(true);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
      if (!idToken) { setError("You need to be logged in to connect Gmail."); return; }
      // A real navigation (not fetch) — Google's consent screen has to run in the top-level window.
      window.location.href = `/api/gmail?action=connect&region=${REGION}&idToken=${encodeURIComponent(idToken)}`;
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!confirm("Disconnect Attendance Gmail? Grace-warning emails won't be sendable until it's reconnected.")) return;
    setDisconnecting(true);
    try {
      await disconnectGmail(REGION);
      loadGmailStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Gmail.");
    } finally {
      setDisconnecting(false);
    }
  };

  // Same plain manager_name resolution attendanceAlerts.ts's
  // resolveManagerIdSimple uses server-side — a manager only shows up
  // here (and is only ever emailed) if they're findable this same way.
  const managerRows = useMemo<ManagerRow[]>(() => {
    const profileByNormalizedName = new Map(
      profiles.filter((p) => p.is_active).map((p) => [(p.display_name || "").trim().toLowerCase(), p])
    );
    const checkInByProfileId = new Map(todayEntries.filter((e) => e.checkIn).map((e) => [e.profileId, e.checkIn]));

    const managerIds = new Set<string>();
    for (const p of profiles) {
      const managerName = (p.manager_name || "").trim().toLowerCase();
      if (!managerName) continue;
      const match = profileByNormalizedName.get(managerName);
      if (match) managerIds.add(match.id);
    }

    const rows: ManagerRow[] = [];
    for (const managerId of managerIds) {
      const manager = profiles.find((p) => p.id === managerId);
      if (!manager) continue;
      const managerNameLower = (manager.display_name || "").trim().toLowerCase();
      const reports = profiles.filter((p) => p.is_active && p.id !== managerId && (p.manager_name || "").trim().toLowerCase() === managerNameLower);

      const technicians = { present: 0, absent: 0 };
      const office = { present: 0, absent: 0 };
      const reportRows: ReportRow[] = [];
      for (const r of reports) {
        const isTechnician = TECHNICIAN_PAY_ROLES.has(normalizeRole(r.role));
        const checkIn = checkInByProfileId.get(r.id) ?? null;

        // Same country/grace-minutes rule attendanceAlerts.ts's cron job
        // uses (assigned_branch === "Philippines" is the only PH signal).
        const graceMinutes = payGraceMinutesFor(r.assigned_branch === "Philippines" ? "PH" : "US");
        const graceEndsAt = !checkIn
          ? (r.required_check_in ? addMinutesToHHMM(r.required_check_in, graceMinutes) : null)
          : (r.required_check_out ? addMinutesToHHMM(r.required_check_out, graceMinutes) : null);

        // Their own branch's real wall-clock "now" — the same per-branch
        // timezone comparison the cron job's grace math uses, not the
        // viewer's own local time.
        const nowHHMM = nowInTimezone(timezoneForBranch(r.assigned_branch)).hhmm;
        let status: ReportStatus;
        if (checkIn) {
          status = "present";
        } else if (!r.required_check_in || nowHHMM < r.required_check_in) {
          status = "not_due"; // shift hasn't started yet — not a no-show
        } else if (!graceEndsAt || nowHHMM <= graceEndsAt) {
          status = "in_grace"; // late, but still within the grace window
        } else {
          status = "absent"; // grace has fully expired
        }
        // "Still Absent" only counts a genuine, already-overdue miss —
        // someone whose shift hasn't started yet isn't tallied as either
        // present or absent (see the header note next to the counts).
        if (status === "present") (isTechnician ? technicians : office).present++;
        else if (status === "absent" || status === "in_grace") (isTechnician ? technicians : office).absent++;

        reportRows.push({ profile: r, isTechnician, checkIn, status, graceEndsAt });
      }
      reportRows.sort((a, b) => (a.profile.display_name || "").localeCompare(b.profile.display_name || ""));
      rows.push({ profile: manager, technicians, office, reports: reportRows });
    }
    return rows.sort((a, b) => (a.profile.display_name || "").localeCompare(b.profile.display_name || ""));
  }, [profiles, todayEntries]);

  // Defaults the Test Mode target to Jhon Norban Rulona if he's in the
  // manager list, else just the first manager — either way, only once,
  // the first time managerRows has something in it (a manual pick after
  // that is never overridden).
  useEffect(() => {
    if (testManagerId || managerRows.length === 0) return;
    const preferred = managerRows.find((m) => (m.profile.display_name || "").trim().toLowerCase() === "jhon norban rulona");
    setTestManagerId((preferred ?? managerRows[0]).profile.id);
  }, [managerRows, testManagerId]);

  // Recomputed on every render (not memoized) — deliberately, since "now"
  // keeps moving and this is a low-frequency admin tool, not a live
  // ticking clock; re-evaluating on whatever render already happens (add/
  // remove/send) is close enough without the complexity of a setInterval.
  const testReportRows = testEmployees.map((e) => ({ ...e, ...testEmployeeStatus(e.requiredCheckIn, nowHHMMLocal()) }));
  const inGraceTestNames = testReportRows.filter((r) => r.status === "in_grace").map((r) => r.name);

  const handleSendTest = async () => {
    if (!testManagerId) return;
    if (inGraceTestNames.length === 0) {
      setTestSendError("None of the test employees are currently inside their grace window — add some (they start 2 minutes \"late\") or wait a moment.");
      return;
    }
    setSendingTest(true);
    setTestSendError(null);
    setTestSendResult(null);
    try {
      const { sentTo } = await sendAttendanceTestWarningEmail(testManagerId, inGraceTestNames);
      setTestSendResult(`Sent to ${sentTo}: ${inGraceTestNames.join(", ")}`);
    } catch (err) {
      setTestSendError(err instanceof Error ? err.message : "Failed to send test email.");
    } finally {
      setSendingTest(false);
    }
  };

  const toggleManager = async (managerId: string, enrolled: boolean) => {
    setSavingManagerId(managerId);
    setError(null);
    try {
      if (enrolled) {
        await unenrollAttendanceWarningManager(managerId);
        setSubscribedIds((prev) => { const next = new Set(prev); next.delete(managerId); return next; });
        // Unenrolling clears any stale send-status badge from a previous enroll.
        setEmailStatusByManagerId((prev) => { const next = { ...prev }; delete next[managerId]; return next; });
      } else {
        await enrollAttendanceWarningManager(managerId, myProfileId || "", myDisplayName || "Unknown");
        setSubscribedIds((prev) => new Set(prev).add(managerId));
        // Auto-sent the moment they're enrolled — a soft failure here
        // (e.g. Attendance Gmail not connected yet) doesn't undo the
        // enrollment itself, just shows up as a failed badge on the row.
        setEmailStatusByManagerId((prev) => ({ ...prev, [managerId]: { state: "sending" } }));
        try {
          const { sentTo } = await sendAttendanceEnrollmentEmail(managerId);
          setEmailStatusByManagerId((prev) => ({ ...prev, [managerId]: { state: "sent", message: sentTo } }));
        } catch (emailErr) {
          const message = emailErr instanceof Error ? emailErr.message : "Failed to send.";
          setEmailStatusByManagerId((prev) => ({ ...prev, [managerId]: { state: "failed", message } }));
          setError(`Enrolled, but couldn't send the confirmation email: ${message}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update enrollment.");
    } finally {
      setSavingManagerId(null);
    }
  };

  // Retries just the email, without touching enrollment — for the "Resend"
  // link on a failed (or already-sent) badge, so confirming a fix doesn't
  // need an uncheck/recheck round-trip.
  const resendEnrollmentEmail = async (managerId: string) => {
    setEmailStatusByManagerId((prev) => ({ ...prev, [managerId]: { state: "sending" } }));
    try {
      const { sentTo } = await sendAttendanceEnrollmentEmail(managerId);
      setEmailStatusByManagerId((prev) => ({ ...prev, [managerId]: { state: "sent", message: sentTo } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send.";
      setEmailStatusByManagerId((prev) => ({ ...prev, [managerId]: { state: "failed", message } }));
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400">
        Warn a manager the moment one of their reports' scheduled check-in/check-out time passes — while they're still inside their grace period, before it fully runs out. Delivered by email, sent from the Gmail account connected below, only to managers checked in the list.
      </p>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <h2 className="text-sm font-bold text-white mb-3">Connect Gmail</h2>
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-sm w-fit">
          <Mail className={`h-4 w-4 shrink-0 ${gmailStatus?.connected ? "text-green-400" : "text-slate-500"}`} />
          <span className="text-xs text-slate-400 uppercase font-semibold">Attendance Warnings:</span>
          {gmailStatus?.connected ? (
            <>
              <span className="text-slate-200" title={gmailStatus.connectedByName ? `Connected by ${gmailStatus.connectedByName}` : undefined}>
                {gmailStatus.connectedAccountName || "Unknown"}
                {gmailStatus.connectedEmail && <span className="text-slate-500"> ({gmailStatus.connectedEmail})</span>}
              </span>
              <button
                type="button"
                onClick={handleDisconnectGmail}
                disabled={disconnecting}
                className="text-red-300 hover:text-red-200 disabled:opacity-40 text-xs underline ml-1"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConnectGmail}
              disabled={connecting}
              className="text-blue-300 hover:text-blue-200 text-xs underline disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect Gmail"}
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <h2 className="text-sm font-bold text-white mb-1">Run Now</h2>
        <p className="text-xs text-slate-400 mb-3">
          The grace-check normally runs automatically every 5 minutes — but only in the deployed app; a local dev server (<code>vite dev</code>) runs no scheduler at all, so nothing fires there on its own. Use this to trigger a real run on demand (same effects as the real one — writes dedup records, sends real emails).
        </p>
        <button
          type="button"
          onClick={handleRunNow}
          disabled={runningAlerts}
          className="btn text-sm px-4 py-2 flex items-center gap-1.5 disabled:opacity-50 w-fit"
        >
          {runningAlerts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {runningAlerts ? "Running…" : "Run Grace Check Now"}
        </button>
        {runError && (
          <p className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{runError}</p>
        )}
        {runResult && (
          <div className="mt-3 text-xs text-slate-300 bg-slate-800/50 border border-white/10 rounded-md px-3 py-2.5 space-y-1">
            <div>Checked {runResult.profilesChecked} profiles.</div>
            <div>Grace-warning emails: <span className="text-emerald-300 font-semibold">{runResult.graceWarningEmailsSent}</span> sent ({runResult.graceWarningsFired} fired).</div>
            <div>Missing clock-in/out notifications: <span className="font-semibold">{runResult.notificationsSent}</span> sent ({runResult.missingClockInFired} in / {runResult.missingClockOutFired} out, {runResult.streaksFired} streak escalations).</div>
            {runResult.errors.length > 0 && (
              <div className="text-red-300">
                {runResult.errors.length} error{runResult.errors.length === 1 ? "" : "s"}: {runResult.errors.slice(0, 5).join("; ")}
                {runResult.errors.length > 5 ? "…" : ""}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <h2 className="text-sm font-bold text-white mb-1">Test Mode</h2>
        <p className="text-xs text-slate-400 mb-3">
          Add fake employees to verify the email actually arrives — nothing here touches the database (no profiles row, no dedup record), so it never shows up on any other dashboard and there's nothing to clean up afterward. New ones start "scheduled" 2 minutes ago, so they're immediately inside their grace window — no waiting.
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Send to manager</label>
            <select
              value={testManagerId}
              onChange={(e) => setTestManagerId(e.target.value)}
              className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none min-w-56"
            >
              {managerRows.map((m) => (
                <option key={m.profile.id} value={m.profile.id}>{m.profile.display_name || m.profile.email}</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => addTestEmployees(5)} className="btn text-sm px-3 py-2">+ 5 Test Employees</button>
          <button type="button" onClick={() => addTestEmployees(3)} className="btn text-sm px-3 py-2">+ 3 Test Employees</button>
          <button type="button" onClick={() => addTestEmployees(1)} className="btn text-sm px-3 py-2">+ 1</button>
          {testEmployees.length > 0 && (
            <button type="button" onClick={clearTestEmployees} className="text-red-300 hover:text-red-200 text-xs underline">Clear all</button>
          )}
        </div>

        {testReportRows.length > 0 && (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 mb-3">
            {testReportRows.map((r) => {
              const statusMeta: Record<ReportStatus, { label: string; className: string }> = {
                present: { label: "", className: "text-emerald-300" },
                not_due: { label: "Not due yet", className: "text-slate-400" },
                in_grace: { label: "In grace", className: "text-amber-300" },
                absent: { label: "Absent", className: "text-red-300" },
              };
              const meta = statusMeta[r.status];
              return (
                <div key={r.id} className="flex flex-col gap-1 text-xs bg-slate-800/50 border border-amber-400/20 rounded-md px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-200 truncate inline-flex items-center gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wide text-amber-300 border border-amber-400/40 rounded px-1">Test</span>
                      {r.name}
                    </span>
                    <span className={`shrink-0 font-semibold ${meta.className}`}>{meta.label}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-slate-500">
                    <span>Sched. in {r.requiredCheckIn}</span>
                    <span>Grace ends {r.graceEndsAt}</span>
                  </div>
                  <button type="button" onClick={() => removeTestEmployee(r.id)} className="text-slate-500 hover:text-red-300 text-left underline w-fit">Remove</button>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={handleSendTest}
          disabled={sendingTest || !testManagerId || testEmployees.length === 0}
          className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 w-fit"
        >
          {sendingTest ? "Sending…" : `Send Test Grace Warning${inGraceTestNames.length > 0 ? ` (${inGraceTestNames.length})` : ""}`}
        </button>
        {testSendError && (
          <p className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{testSendError}</p>
        )}
        {testSendResult && (
          <p className="mt-3 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-2.5 py-2">✓ {testSendResult}</p>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">{error}</div>
      )}

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-1">Enrolled Managers</h2>
        <p className="text-xs text-slate-400 mb-4">Check a manager to enroll them. Present / Still Absent counts are today's live snapshot — someone whose shift hasn't started yet isn't counted as absent (expand a manager's row to see everyone, including who's still "Not due yet" or "In grace").</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : managerRows.length === 0 ? (
          <div className="text-sm text-slate-400 py-6">No managers found — nobody's profile lists a manager yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase w-10"></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Manager</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Role</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Technicians — Present / Still Absent</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Office — Present / Still Absent</th>
              </tr>
            </thead>
            <tbody>
              {managerRows.map((row) => {
                const enrolled = subscribedIds.has(row.profile.id);
                const expanded = expandedManagerId === row.profile.id;
                return (
                  <Fragment key={row.profile.id}>
                    <tr
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                      onClick={() => setExpandedManagerId(expanded ? null : row.profile.id)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={enrolled}
                          disabled={savingManagerId === row.profile.id}
                          onChange={() => toggleManager(row.profile.id, enrolled)}
                          className="h-4 w-4 accent-blue-500 disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-3 text-white font-medium">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          <ChevronRight className={`h-3.5 w-3.5 text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`} />
                          {row.profile.display_name || row.profile.email}
                          <span className="text-xs text-slate-500 font-normal">({row.reports.length})</span>
                          {row.profile.email && (
                            <span className="text-xs text-slate-500 font-normal">— {row.profile.email}</span>
                          )}
                          {(() => {
                            const emailStatus = emailStatusByManagerId[row.profile.id];
                            if (!emailStatus) return null;
                            if (emailStatus.state === "sending") {
                              return <span className="text-xs font-normal text-slate-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sending…</span>;
                            }
                            if (emailStatus.state === "sent") {
                              return <span className="text-xs font-normal text-emerald-300" title={`Confirmation email sent to ${emailStatus.message}`}>✓ Email sent</span>;
                            }
                            return (
                              <span className="text-xs font-normal text-red-300 inline-flex items-center gap-1.5" title={emailStatus.message}>
                                ✗ Email failed: {emailStatus.message}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void resendEnrollmentEmail(row.profile.id); }}
                                  className="text-blue-300 hover:text-blue-200 underline"
                                >
                                  Resend
                                </button>
                              </span>
                            );
                          })()}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-400">{formatRoleLabel(row.profile.role)}</td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        {row.technicians.present + row.technicians.absent === 0 ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <>
                            <span className="text-emerald-300">{row.technicians.present}</span> / <span className="text-red-300">{row.technicians.absent}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        {row.office.present + row.office.absent === 0 ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <>
                            <span className="text-emerald-300">{row.office.present}</span> / <span className="text-red-300">{row.office.absent}</span>
                          </>
                        )}
                      </td>
                    </tr>
                    {expanded && (() => {
                      const testRowsForThisManager = row.profile.id === testManagerId ? testReportRows : [];
                      if (row.reports.length === 0 && testRowsForThisManager.length === 0) {
                        return (
                          <tr className="bg-white/[0.02]">
                            <td colSpan={5} className="px-3 py-3">
                              <div className="text-xs text-slate-500 pl-6">No reports.</div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr className="bg-white/[0.02]">
                          <td colSpan={5} className="px-3 py-3">
                            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 pl-6">
                              {row.reports.map((r) => {
                                const scheduled = r.checkIn ? r.profile.required_check_out : r.profile.required_check_in;
                                const scheduledLabel = r.checkIn ? "Sched. out" : "Sched. in";
                                const statusMeta: Record<ReportStatus, { label: string; className: string }> = {
                                  present: { label: r.checkIn ? r.checkIn.slice(0, 5) : "", className: "text-emerald-300" },
                                  not_due: { label: "Not due yet", className: "text-slate-400" },
                                  in_grace: { label: "In grace", className: "text-amber-300" },
                                  absent: { label: "Absent", className: "text-red-300" },
                                };
                                const meta = statusMeta[r.status];
                                return (
                                  <div key={r.profile.id} className="flex flex-col gap-1 text-xs bg-slate-900/50 border border-white/5 rounded-md px-2.5 py-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-200 truncate">{r.profile.display_name || r.profile.email}</span>
                                      <span className={`shrink-0 font-semibold ${meta.className}`}>{meta.label}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 text-slate-500">
                                      <span>{scheduledLabel} {scheduled ? scheduled.slice(0, 5) : "—"}</span>
                                      <span title="When the system considers this person's grace window over — a grace-warning email fires the moment the scheduled time above passes, and stops being 'in grace' at this time">
                                        Grace ends {r.graceEndsAt ? r.graceEndsAt.slice(0, 5) : "—"}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                              {testRowsForThisManager.map((r) => {
                                const statusMeta: Record<ReportStatus, { label: string; className: string }> = {
                                  present: { label: "", className: "text-emerald-300" },
                                  not_due: { label: "Not due yet", className: "text-slate-400" },
                                  in_grace: { label: "In grace", className: "text-amber-300" },
                                  absent: { label: "Absent", className: "text-red-300" },
                                };
                                const meta = statusMeta[r.status];
                                return (
                                  <div key={r.id} className="flex flex-col gap-1 text-xs bg-slate-900/50 border border-amber-400/20 rounded-md px-2.5 py-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-200 truncate inline-flex items-center gap-1.5">
                                        <span className="text-[9px] font-bold uppercase tracking-wide text-amber-300 border border-amber-400/40 rounded px-1">Test</span>
                                        {r.name}
                                      </span>
                                      <span className={`shrink-0 font-semibold ${meta.className}`}>{meta.label}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 text-slate-500">
                                      <span>Sched. in {r.requiredCheckIn}</span>
                                      <span>Grace ends {r.graceEndsAt}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
