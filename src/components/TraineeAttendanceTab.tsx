/**
 * Attendance Monitoring's "Trainee Attendance" tab — a trainee
 * (profiles.employment_type = 'trainee', migration 0152, set via
 * ReportHRDaily.tsx's Masterlist) punches in/out on the exact same screens
 * every other employee uses, but those punches land in
 * trainee_timecard_entries (migration 0216) instead of the real
 * timecard_entries, until their direct manager approves the day here.
 * Approve copies the day onto the real timecard via approveTraineeDay
 * (reusing the existing saveEntry, same as technicianCheckoutProposals'
 * own approval flow) — Reject sends it back with a reason, and the trainee
 * simply re-punching resets it to pending for another look.
 *
 * Table layout mirrors ReportAttendanceMonitoring.tsx's "Daily Attendance"
 * (groupBy="employee") table — same compact columns/header/banded-row look
 * — but the band groups by the trainee's MANAGER instead of by date (a
 * manager reviewing here already knows they're looking at their own
 * trainees; grouping by who they report to matters more than which day),
 * and keeps a Date column plus the Approve/Reject Actions column that
 * read-only report doesn't need.
 *
 * Receives profiles/teamScopedIds/role/extraRoles/myProfileId as props
 * from AttendanceMonitoringPage rather than re-fetching them — this tab is
 * only ever mounted there, so there's no reason to duplicate the company
 * roster + CSR composition fetch that page already did (contrast with
 * TicketAttendanceTab.tsx, which IS mounted from two different pages and
 * so fetches everything itself).
 */
import { useEffect, useMemo, useState, Fragment } from "react";
import { Check, X as XIcon, Clock3 } from "lucide-react";
import type { ProfileRow } from "@/lib/supabase/users";
import { calcWorkedHours } from "@/lib/supabase/timecards";
import { ROLE_LABELS, normalizeRole, isTraineeApprovalEligible, isAttendanceFullAccessRole, isTraineeFallbackReviewerRole } from "@/lib/roleLabels";
import {
  getCompanyTraineeEntries,
  canApproveTraineeDay,
  approveTraineeDay,
  rejectTraineeDay,
  recordTraineeDayWithoutPunch,
  type TraineeTimecardEntry,
} from "@/lib/supabase/traineeTimecards";

/** Fixed rejection categories the user asked for — "Other" reveals a required free-text field. */
const REJECT_REASON_OPTIONS = ["On Field", "Termination", "Absent", "Quit", "Other"] as const;

const STATUS_LABEL: Record<TraineeTimecardEntry["status"], string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const STATUS_CLASS: Record<TraineeTimecardEntry["status"], string> = {
  pending: "bg-sky-500/20 text-sky-300",
  approved: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
};

// profiles.department is rarely populated — role is the real department-like
// dimension, same convention ReportAttendanceMonitoring.tsx/AccountingDashboard.tsx use.
function roleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[normalizeRole(role)] ?? role ?? "Unspecified";
}

interface Row {
  kind: "entry" | "placeholder";
  entry: TraineeTimecardEntry | null;
  profileId: string;
}

export function TraineeAttendanceTab({
  profiles,
  teamScopedIds,
  myProfileId,
  role,
  extraRoles,
}: {
  profiles: ProfileRow[];
  /** null = unrestricted (Admin/HR/Finance/SuperAdmin) — see visibleAttendanceProfileIds. */
  teamScopedIds: Set<string> | null;
  myProfileId: string | null;
  role: string | null;
  extraRoles: string[] | null;
}) {
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [dateFrom, setDateFrom] = useState(todayISO);
  const [dateTo, setDateTo] = useState(todayISO);
  const [entries, setEntries] = useState<TraineeTimecardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReasonOption, setRejectReasonOption] = useState("");
  const [rejectReasonCustom, setRejectReasonCustom] = useState("");
  const finalRejectReason = rejectReasonOption === "Other" ? rejectReasonCustom.trim() : rejectReasonOption;
  const canSubmitReject = rejectReasonOption !== "" && (rejectReasonOption !== "Other" || rejectReasonCustom.trim() !== "");

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  // Every trainee this viewer may see — same "my team" scoping every other
  // tab on this page already uses, so a manager only ever sees their own
  // trainees while Admin/HR/Finance/SuperAdmin see the whole company. This
  // is the actual roster (from Masterlist's Employment Type), not derived
  // from who happens to have punched yet — a brand-new trainee who hasn't
  // clocked in at all still needs to show up here, not just silently be
  // absent from the list.
  // Technician department only — see isTraineeApprovalEligible's own doc
  // comment (roleLabels.ts). A CSR/Parts/other-department employee marked
  // Trainee on Masterlist never shows up here at all; their punches go
  // straight onto the real timecard like a regular employee.
  const visibleTrainees = useMemo(
    () =>
      profiles.filter(
        (p) =>
          p.employment_type === "trainee" &&
          isTraineeApprovalEligible(p.role, p.extra_roles) &&
          (teamScopedIds === null || teamScopedIds.has(p.id))
      ),
    [profiles, teamScopedIds]
  );
  const traineeIds = useMemo(() => new Set(visibleTrainees.map((p) => p.id)), [visibleTrainees]);

  const load = () => {
    setLoading(true);
    getCompanyTraineeEntries(dateFrom, dateTo)
      .then((rows) => setEntries(rows.filter((r) => traineeIds.has(r.profileId))))
      .catch((err) => console.error("Failed to load trainee timecards:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, traineeIds]);

  // The trainee's own stored manager_name (profiles.manager_name — the same
  // field resolveTeamLeadOrManager reads at punch time) is the band label,
  // not entry.managerId — a placeholder row (nobody's punched yet) has no
  // entry at all to read a managerId off, but still needs to land in the
  // right manager's group.
  const managerNameOf = (profileId: string) => profileById.get(profileId)?.manager_name?.trim() || "Unassigned";

  // A real punch row per (trainee, day) that has one, PLUS a placeholder for
  // any visible trainee with zero punches anywhere in the selected range —
  // otherwise a trainee who just hasn't clocked in yet (or hasn't started)
  // would be invisible on this tab instead of showing as something a
  // manager can actually see and follow up on. Grouped by manager (band),
  // then by trainee name, then most-recent day first within a trainee.
  const rows = useMemo<Row[]>(() => {
    const withEntry: Row[] = entries.map((e) => ({ kind: "entry", entry: e, profileId: e.profileId }));
    const punchedIds = new Set(entries.map((e) => e.profileId));
    const withoutEntry: Row[] = visibleTrainees
      .filter((p) => !punchedIds.has(p.id))
      .map((p) => ({ kind: "placeholder", entry: null, profileId: p.id }));
    return [...withEntry, ...withoutEntry].sort((a, b) => {
      const mgrA = managerNameOf(a.profileId);
      const mgrB = managerNameOf(b.profileId);
      if (mgrA !== mgrB) return mgrA.localeCompare(mgrB);
      const nameA = profileById.get(a.profileId)?.display_name || "";
      const nameB = profileById.get(b.profileId)?.display_name || "";
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      if (a.kind === "entry" && b.kind === "entry") return b.entry!.workDate.localeCompare(a.entry!.workDate);
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, visibleTrainees, profileById]);

  const handleApprove = async (entry: TraineeTimecardEntry) => {
    if (!myProfileId) return;
    const name = profileById.get(entry.profileId)?.display_name || "this trainee";
    const verb = entry.status === "approved" ? "Re-approve" : "Approve";
    if (!window.confirm(`${verb} ${name}'s timecard for ${entry.workDate}? It will be copied onto their real timecard.`)) return;
    setActingId(entry.id);
    try {
      await approveTraineeDay(entry, myProfileId);
      load();
    } catch (err) {
      alert(`Failed to approve: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActingId(null);
    }
  };

  const submitReject = async (entry: TraineeTimecardEntry) => {
    if (!myProfileId || !canSubmitReject) return;
    setActingId(entry.id);
    try {
      await rejectTraineeDay(entry.id, myProfileId, finalRejectReason);
      setRejectingId(null);
      setRejectReasonOption("");
      setRejectReasonCustom("");
      load();
    } catch (err) {
      alert(`Failed to reject: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActingId(null);
    }
  };

  // A placeholder row has no entry yet to read a managerId off — same
  // authority check as canApproveTraineeDay, just matched against the
  // trainee's raw manager_name (the same field the band label above already
  // reads) instead of an existing row's stamped managerId.
  const viewerName = (profileById.get(myProfileId || "")?.display_name || "").trim().toLowerCase();
  const canManageTrainee = (trainee: ProfileRow | undefined) =>
    isAttendanceFullAccessRole(role, extraRoles) ||
    isTraineeFallbackReviewerRole(role, extraRoles) ||
    (viewerName !== "" && (trainee?.manager_name || "").trim().toLowerCase() === viewerName);

  // Marks a trainee absent (or any other reason) for a day they never
  // punched at all — see recordTraineeDayWithoutPunch's own doc comment.
  // Always targets dateTo (the end of the selected range, defaulting to
  // today when From=To) since a placeholder row has no specific date of
  // its own to attach the status to.
  const submitPlaceholderReject = async (trainee: ProfileRow | undefined, profileId: string) => {
    if (!myProfileId || !canSubmitReject) return;
    const actingKey = `placeholder:${profileId}`;
    setActingId(actingKey);
    try {
      const managerId =
        profiles.find(
          (p) => p.is_active && (p.display_name || "").trim().toLowerCase() === (trainee?.manager_name || "").trim().toLowerCase()
        )?.id ?? null;
      await recordTraineeDayWithoutPunch(profileId, dateTo, managerId, myProfileId, finalRejectReason);
      setRejectingId(null);
      setRejectReasonOption("");
      setRejectReasonCustom("");
      load();
    } catch (err) {
      alert(`Failed to update status: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-sky-400" />
          Trainee Attendance
        </h2>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <div className="panel overflow-x-auto p-0">
        <div className="px-3 py-2 border-b border-white/10 font-semibold text-xs flex justify-between">
          <span>Trainee Attendance</span>
          <span className="text-muted-foreground">{rows.length} records</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {[
                { label: "Name", align: "text-left" },
                { label: "Role", align: "text-left" },
                { label: "Date", align: "text-center" },
                { label: "Clock In", align: "text-center" },
                { label: "Required In", align: "text-center" },
                { label: "Clock Out", align: "text-center" },
                { label: "Required Out", align: "text-center" },
                { label: "Hours", align: "text-center" },
                { label: "Status", align: "text-center" },
                { label: "Actions", align: "text-center" },
              ].map((h) => (
                <th key={h.label} className={`px-2.5 py-1.5 ${h.align} text-[10px] text-muted-foreground uppercase whitespace-nowrap`}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No trainees visible to you yet — set an employee's Employment Type to Trainee on Masterlist.</td></tr>
            ) : (
              rows.map((row, i) => {
                const profile = profileById.get(row.profileId);
                const showManagerBand = i === 0 || managerNameOf(rows[i - 1].profileId) !== managerNameOf(row.profileId);
                const managerBand = (
                  <tr className="bg-blue-500/10">
                    <td colSpan={10} className="px-2.5 py-1 font-semibold text-blue-300 text-[10px] uppercase tracking-wide">
                      {managerNameOf(row.profileId)}
                    </td>
                  </tr>
                );

                if (row.kind === "placeholder") {
                  const placeholderKey = `placeholder:${row.profileId}`;
                  const isActingPlaceholder = actingId === placeholderKey;
                  const isRejectingPlaceholder = rejectingId === placeholderKey;
                  const canManage = canManageTrainee(profile);
                  return (
                    <Fragment key={placeholderKey}>
                      {showManagerBand && managerBand}
                      <tr className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                        <td className="px-2.5 py-1 font-medium whitespace-nowrap">{profile?.display_name || "—"}</td>
                        <td className="px-2.5 py-1 text-muted-foreground whitespace-nowrap">{roleLabel(profile?.role)}</td>
                        <td className="px-2.5 py-1 text-center text-muted-foreground" colSpan={6}>No punch in this date range yet.</td>
                        <td className="px-2.5 py-1 text-center">
                          <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-white/10 text-slate-400">No Punch Yet</span>
                        </td>
                        <td className="px-2.5 py-1 text-center">
                          {!canManage ? (
                            <span className="text-slate-600">—</span>
                          ) : isRejectingPlaceholder ? (
                            <div className="flex flex-col gap-1.5 min-w-[180px] text-left mx-auto">
                              <select
                                value={rejectReasonOption}
                                onChange={(e) => setRejectReasonOption(e.target.value)}
                                autoFocus
                                className="w-full rounded border border-white/15 bg-slate-800 px-2 py-1 text-xs text-white"
                              >
                                <option value="">Select reason…</option>
                                {REJECT_REASON_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                              {rejectReasonOption === "Other" && (
                                <input
                                  type="text"
                                  value={rejectReasonCustom}
                                  onChange={(e) => setRejectReasonCustom(e.target.value)}
                                  placeholder="Specify reason…"
                                  className="w-full rounded border border-white/15 bg-slate-800 px-2 py-1 text-xs text-white"
                                />
                              )}
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void submitPlaceholderReject(profile, row.profileId)}
                                  disabled={!canSubmitReject || isActingPlaceholder}
                                  className="flex-1 rounded-md border border-red-400/40 bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                                >
                                  {isActingPlaceholder ? "…" : "Confirm"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setRejectingId(null); setRejectReasonOption(""); setRejectReasonCustom(""); }}
                                  disabled={isActingPlaceholder}
                                  className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setRejectingId(placeholderKey); setRejectReasonOption(""); setRejectReasonCustom(""); }}
                              disabled={isActingPlaceholder}
                              title="Mark a status (e.g. Absent) without a punch"
                              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-40"
                            >
                              Mark Status
                            </button>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                }

                const entry = row.entry!;
                const canApprove = canApproveTraineeDay(entry, myProfileId, role, extraRoles);
                const isActing = actingId === entry.id;
                const isRejecting = rejectingId === entry.id;
                const hours = calcWorkedHours({ checkIn: entry.checkIn, checkOut: entry.checkOut, mealStart: entry.mealStart, mealEnd: entry.mealEnd, notes: "" });
                return (
                  <Fragment key={entry.id}>
                    {showManagerBand && managerBand}
                    <tr className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-2.5 py-1 font-medium whitespace-nowrap">{profile?.display_name || "—"}</td>
                      <td className="px-2.5 py-1 text-muted-foreground whitespace-nowrap">{roleLabel(profile?.role)}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{entry.workDate}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{entry.checkIn || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap text-muted-foreground">{profile?.required_check_in || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{entry.checkOut || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap text-muted-foreground">{profile?.required_check_out || "—"}</td>
                      <td className="px-2.5 py-1 text-center whitespace-nowrap">{hours.toFixed(2)}h</td>
                      <td className="px-2.5 py-1 text-center">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
                        {entry.status === "rejected" && entry.rejectReason && (
                          <p className="mt-1 text-[10px] text-slate-400 italic max-w-[160px] mx-auto">"{entry.rejectReason}"</p>
                        )}
                      </td>
                      <td className="px-2.5 py-1 text-center">
                        {!canApprove ? (
                          <span className="text-slate-600">—</span>
                        ) : isRejecting ? (
                          <div className="flex flex-col gap-1.5 min-w-[180px] text-left mx-auto">
                            <select
                              value={rejectReasonOption}
                              onChange={(e) => setRejectReasonOption(e.target.value)}
                              autoFocus
                              className="w-full rounded border border-white/15 bg-slate-800 px-2 py-1 text-xs text-white"
                            >
                              <option value="">Select reason…</option>
                              {REJECT_REASON_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                            {rejectReasonOption === "Other" && (
                              <input
                                type="text"
                                value={rejectReasonCustom}
                                onChange={(e) => setRejectReasonCustom(e.target.value)}
                                placeholder="Specify reason…"
                                className="w-full rounded border border-white/15 bg-slate-800 px-2 py-1 text-xs text-white"
                              />
                            )}
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => void submitReject(entry)}
                                disabled={!canSubmitReject || isActing}
                                className="flex-1 rounded-md border border-red-400/40 bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                              >
                                {isActing ? "…" : "Confirm Reject"}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setRejectingId(null); setRejectReasonOption(""); setRejectReasonCustom(""); }}
                                disabled={isActing}
                                className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleApprove(entry)}
                              disabled={isActing}
                              title={entry.status === "approved" ? "Re-approve" : "Approve"}
                              className="grid h-7 w-7 place-items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                            >
                              {isActing ? "…" : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRejectingId(entry.id); setRejectReasonOption(""); setRejectReasonCustom(""); }}
                              disabled={isActing}
                              title={entry.status === "rejected" ? "Change reason" : "Reject"}
                              className="grid h-7 w-7 place-items-center rounded-full border border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
