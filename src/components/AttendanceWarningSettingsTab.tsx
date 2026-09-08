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
import { Mail, Loader2, ChevronRight } from "lucide-react";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import {
  getAttendanceWarningSubscribedManagerIds,
  enrollAttendanceWarningManager,
  unenrollAttendanceWarningManager,
  sendAttendanceEnrollmentEmail,
} from "@/lib/supabase/attendanceWarningSubscriptions";
import { getGmailConnectionStatus, disconnectGmail, type GmailConnectionStatus } from "@/lib/supabase/gmailConnection";
import { TECHNICIAN_PAY_ROLES, normalizeRole } from "@/lib/roleLabels";
import { addMinutesToHHMM, payGraceMinutesFor, nowInTimezone, timezoneForBranch } from "@/lib/attendanceGrace";

const REGION = "ATTENDANCE" as const;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
                    {expanded && (
                      <tr className="bg-white/[0.02]">
                        <td colSpan={4} className="px-3 py-3">
                          {row.reports.length === 0 ? (
                            <div className="text-xs text-slate-500 pl-6">No reports.</div>
                          ) : (
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
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
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
