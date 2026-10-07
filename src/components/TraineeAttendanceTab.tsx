/**
 * Attendance Monitoring's "Trainee Attendance" tab — a trainee
 * (profiles.employment_type = 'trainee', migration 0152, set via
 * ReportHRDaily.tsx's Masterlist) punches in/out on the exact same screens
 * every other employee uses, but those punches land in
 * trainee_timecard_entries (migration 0216) instead of the real
 * timecard_entries, until their direct manager approves the day here.
 * Approve copies the day onto the real timecard via approveTraineeDay —
 * Reject sends it back with a reason, and the trainee simply re-punching
 * resets it to pending for another look.
 *
 * Laid out like the Corrections tab on the same page (filters, a
 * Pending/Listed counter, one row per trainee day, and a "View Timecard"
 * modal). The reviewer can correct the trainee's punched times in that
 * modal before approving — e.g. a trainee who forgot to clock out — since
 * trainers routinely leave before their trainees do.
 *
 * Receives profiles/teamScopedIds/role/extraRoles/myProfileId as props
 * from AttendanceMonitoringPage rather than re-fetching them — this tab is
 * only ever mounted there.
 */
import { chainCanApprove } from "@/lib/approvalDirectory";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import type { ProfileRow } from "@/lib/supabase/users";
import { calcWorkedHours } from "@/lib/supabase/timecards";
import { ROLE_LABELS, normalizeRole, isAttendanceFullAccessRole, isTraineeFallbackReviewerRole } from "@/lib/roleLabels";
import { getServerNow, zonedDateKey } from "@/lib/serverTime";
import {
  getCompanyTraineeEntries,
  isCurrentTraineeManager,
  approveTraineeDay,
  rejectTraineeDay,
  recordTraineeDayWithoutPunch,
  approveTraineeDayOnField,
  resetTraineeDay,
  updateTraineeDayTimes,
  type TraineeTimecardEntry,
} from "@/lib/supabase/traineeTimecards";

/** Fixed rejection categories the user asked for — "Other" reveals a required free-text field. */
const REJECT_REASON_OPTIONS = ["On Field", "Termination", "Absent", "Quit", "Other"] as const;

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "nopunch";

const STATUS_LABEL: Record<TraineeTimecardEntry["status"], string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
// Same badge palette as the Corrections tab's status badges.
const STATUS_BADGE: Record<TraineeTimecardEntry["status"], string> = {
  pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  approved: "bg-green-500/20 text-green-300 border-green-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
};

const INPUT_CLASS = "w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition";
const MODAL_INPUT_CLASS = "w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none";

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

interface TimeDraft {
  checkIn: string;
  checkOut: string;
  mealStart: string;
  mealEnd: string;
}

type Selected = { kind: "entry"; entry: TraineeTimecardEntry } | { kind: "placeholder"; profileId: string };

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
  // Initial guess only — the browser's own local calendar date, used purely
  // so the filter isn't blank on first paint. Corrected below to the real
  // server-verified CST business date, since a manager reviewing from a very
  // different timezone (e.g. the Philippines) could otherwise land on this
  // tab defaulted to a date that doesn't match the company's own "today".
  const browserTodayGuess = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [dateFrom, setDateFrom] = useState(browserTodayGuess);
  const [dateTo, setDateTo] = useState(browserTodayGuess);
  useEffect(() => {
    let cancelled = false;
    getServerNow()
      .then((serverNow) => {
        if (cancelled) return;
        const realToday = zonedDateKey(serverNow, "CST");
        if (realToday === browserTodayGuess) return;
        // Only correct if the manager hasn't already changed the filter
        // away from the initial guess — never stomp a date they picked.
        setDateFrom((prev) => (prev === browserTodayGuess ? realToday : prev));
        setDateTo((prev) => (prev === browserTodayGuess ? realToday : prev));
      })
      .catch((err) => console.error("Failed to resolve the real server-verified date:", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [entries, setEntries] = useState<TraineeTimecardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");

  // View Timecard modal
  const [selected, setSelected] = useState<Selected | null>(null);
  const [draft, setDraft] = useState<TimeDraft>({ checkIn: "", checkOut: "", mealStart: "", mealEnd: "" });
  const [acting, setActing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReasonOption, setRejectReasonOption] = useState("");
  const [rejectReasonCustom, setRejectReasonCustom] = useState("");
  // "On Field" needs a time range (when they were out) same as "Other"
  // needs free text — see approveTraineeDayOnField's doc comment for why
  // this becomes a real approval with real times instead of a rejection.
  const [onFieldStart, setOnFieldStart] = useState("");
  const [onFieldEnd, setOnFieldEnd] = useState("");
  const resetRejectForm = () => {
    setRejecting(false);
    setRejectReasonOption("");
    setRejectReasonCustom("");
    setOnFieldStart("");
    setOnFieldEnd("");
  };
  const finalRejectReason = rejectReasonOption === "Other" ? rejectReasonCustom.trim() : rejectReasonOption;
  const canSubmitReject =
    rejectReasonOption !== "" &&
    (rejectReasonOption !== "Other" || rejectReasonCustom.trim() !== "") &&
    (rejectReasonOption !== "On Field" || (onFieldStart !== "" && onFieldEnd !== ""));

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const viewerName = (profileById.get(myProfileId || "")?.display_name || "").trim().toLowerCase();
  // Fallback reviewers (Admin/HR/Finance/SuperAdmin/Technical Assistant
  // Director, Senior Branch Manager) can cover a day a trainee's own manager
  // hasn't reviewed — they get an "All Trainees" switch. Everyone else only
  // ever sees their own trainees.
  const isFallbackReviewer = isAttendanceFullAccessRole(role, extraRoles) || isTraineeFallbackReviewerRole(role, extraRoles);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const showAll = scope === "all" && isFallbackReviewer;
  // Default view is a trainer's OWN trainees only (the trainee's
  // profiles.manager_name is the viewer) — not the viewer's whole team
  // chain, and not the whole company even for Admin/HR. The actual roster
  // (Masterlist's Employment Type), not derived from who has punched — a
  // trainee who hasn't clocked in at all still shows up.
  // People HR has since switched to Regular can still have trainee days
  // waiting for review — the review popup lists those, so this page must
  // too, or the popup could never be cleared. Loaded once, all dates.
  const [pendingFormerTraineeIds, setPendingFormerTraineeIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    getCompanyTraineeEntries()
      .then((rows) => setPendingFormerTraineeIds(new Set(rows.filter((r) => r.status === "pending").map((r) => r.profileId))))
      .catch(() => setPendingFormerTraineeIds(new Set()));
  }, []);
  const visibleTrainees = useMemo(
    () =>
      profiles.filter(
        (p) =>
          (p.employment_type === "trainee" || pendingFormerTraineeIds.has(p.id)) &&
          // Deactivated accounts don't show up here.
          p.is_active &&
          (showAll
            ? teamScopedIds === null || teamScopedIds.has(p.id) || isTraineeFallbackReviewerRole(role, extraRoles)
            : (viewerName !== "" && (p.manager_name || "").trim().toLowerCase() === viewerName) ||
              // …plus trainees this viewer covers through the Approval Chain (their branch / area).
              chainCanApprove(myProfileId, p.id) === true)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profiles, teamScopedIds, showAll, viewerName, myProfileId, pendingFormerTraineeIds]
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

  // The trainee's own stored manager_name (the same field
  // resolveTeamLeadOrManager reads at punch time), not entry.managerId — a
  // placeholder row has no entry to read a managerId off.
  const managerNameOf = (profileId: string) => profileById.get(profileId)?.manager_name?.trim() || "Unassigned";

  // A real punch row per (trainee, day) that has one, PLUS a placeholder for
  // any visible trainee with zero punches in the selected range — otherwise
  // a trainee who hasn't clocked in yet would be invisible here.
  const rows = useMemo<Row[]>(() => {
    const withEntry: Row[] = entries.map((e) => ({ kind: "entry", entry: e, profileId: e.profileId }));
    const punchedIds = new Set(entries.map((e) => e.profileId));
    const withoutEntry: Row[] = visibleTrainees
      // Former trainees (now Regular) are only here for their leftover
      // pending days — no "hasn't clocked in" placeholder for them.
      .filter((p) => p.employment_type === "trainee" && !punchedIds.has(p.id))
      .map((p) => ({ kind: "placeholder", entry: null, profileId: p.id }));
    return [...withEntry, ...withoutEntry].sort((a, b) => {
      // Newest day first, then by trainee name; placeholders last.
      if (a.kind !== b.kind) return a.kind === "entry" ? -1 : 1;
      if (a.kind === "entry" && b.kind === "entry" && a.entry!.workDate !== b.entry!.workDate) return b.entry!.workDate.localeCompare(a.entry!.workDate);
      return (profileById.get(a.profileId)?.display_name || "").localeCompare(profileById.get(b.profileId)?.display_name || "");
    });
  }, [entries, visibleTrainees, profileById]);

  const branchOptions = useMemo(
    () => Array.from(new Set(visibleTrainees.map((p) => p.assigned_branch).filter((b): b is string => !!b))).sort(),
    [visibleTrainees]
  );
  const managerOptions = useMemo(
    () => Array.from(new Set(visibleTrainees.map((p) => managerNameOf(p.id)))).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTrainees, profileById]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const profile = profileById.get(row.profileId);
      if (q && !(profile?.display_name || "").toLowerCase().includes(q)) return false;
      if (branchFilter !== "all" && profile?.assigned_branch !== branchFilter) return false;
      if (managerFilter !== "all" && managerNameOf(row.profileId) !== managerFilter) return false;
      if (statusFilter === "nopunch") return row.kind === "placeholder";
      if (statusFilter !== "all") return row.kind === "entry" && row.entry!.status === statusFilter;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, branchFilter, managerFilter, statusFilter, profileById]);

  const pendingCount = filteredRows.filter((r) => r.kind === "entry" && r.entry!.status === "pending").length;
  const hasActiveFilter = search.trim() !== "" || statusFilter !== "all" || branchFilter !== "all" || managerFilter !== "all";

  // A placeholder row has no entry yet to read a managerId off — same
  // authority check as canApproveTraineeDay, matched against the trainee's
  // raw manager_name instead.
  const canManageTrainee = (trainee: ProfileRow | undefined) =>
    isAttendanceFullAccessRole(role, extraRoles) ||
    isTraineeFallbackReviewerRole(role, extraRoles) ||
    (viewerName !== "" && (trainee?.manager_name || "").trim().toLowerCase() === viewerName);

  const openEntry = (entry: TraineeTimecardEntry) => {
    resetRejectForm();
    setSelected({ kind: "entry", entry });
    setDraft({ checkIn: entry.checkIn || "", checkOut: entry.checkOut || "", mealStart: entry.mealStart || "", mealEnd: entry.mealEnd || "" });
  };
  const openPlaceholder = (profileId: string) => {
    resetRejectForm();
    setRejecting(true); // a no-punch day only has the status/On Field action
    setSelected({ kind: "placeholder", profileId });
  };
  const closeModal = () => {
    if (acting) return;
    setSelected(null);
    resetRejectForm();
  };

  // Deep link from the clock-out review pop-up (TraineeAttendanceReviewModal):
  // ?review=<entry id>&date=<work date> opens that day's editor,
  // ?trainee=<profile id>&date=<work date> opens Mark Status for a no-show.
  const routeSearch = (useSearch({ strict: false }) as { review?: string; trainee?: string; date?: string }) ?? {};
  const [deepLink, setDeepLink] = useState<{ review?: string; trainee?: string } | null>(null);
  useEffect(() => {
    if (!routeSearch.date || !(routeSearch.review || routeSearch.trainee)) return;
    setScope("mine");
    setDateFrom(routeSearch.date);
    setDateTo(routeSearch.date);
    setDeepLink({ review: routeSearch.review, trainee: routeSearch.trainee });
  }, [routeSearch.review, routeSearch.trainee, routeSearch.date]);
  useEffect(() => {
    if (!deepLink || loading) return;
    if (deepLink.trainee) {
      openPlaceholder(deepLink.trainee);
      setDeepLink(null);
      return;
    }
    const entry = entries.find((e) => e.id === deepLink.review);
    if (entry) {
      openEntry(entry);
      setDeepLink(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, entries, loading]);

  const selectedEntry = selected?.kind === "entry" ? selected.entry : null;
  const draftChanged =
    !!selectedEntry &&
    (draft.checkIn !== (selectedEntry.checkIn || "") ||
      draft.checkOut !== (selectedEntry.checkOut || "") ||
      draft.mealStart !== (selectedEntry.mealStart || "") ||
      draft.mealEnd !== (selectedEntry.mealEnd || ""));
  const draftHours = calcWorkedHours({ ...draft, notes: "" });

  const run = async (label: string, fn: () => Promise<void>) => {
    setActing(true);
    try {
      await fn();
      setSelected(null);
      resetRejectForm();
      load();
    } catch (err) {
      alert(`Failed to ${label}: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActing(false);
    }
  };

  const handleSaveTimes = () => {
    if (!selectedEntry) return;
    void run("save times", () => updateTraineeDayTimes(selectedEntry.id, draft));
  };

  // Edited times are saved onto the trainee row first, then approval copies
  // them onto the real timecard — so the two records always agree.
  const handleApprove = () => {
    if (!selectedEntry || !myProfileId) return;
    if (!draft.checkIn || !draft.checkOut) {
      alert("Check In and Check Out are both required to approve — fill in the missing time first.");
      return;
    }
    const name = profileById.get(selectedEntry.profileId)?.display_name || "this trainee";
    const verb = selectedEntry.status === "approved" ? "Re-approve" : "Approve";
    if (!window.confirm(`${verb} ${name}'s timecard for ${selectedEntry.workDate}? It will be copied onto their real timecard.`)) return;
    void run("approve", async () => {
      if (draftChanged) await updateTraineeDayTimes(selectedEntry.id, draft);
      await approveTraineeDay({ ...selectedEntry, ...draft }, myProfileId);
    });
  };

  const handleReject = () => {
    if (!myProfileId || !canSubmitReject || !selected) return;
    if (selected.kind === "entry") {
      const entry = selected.entry;
      void run("update", async () => {
        if (rejectReasonOption === "On Field") {
          // Not a rejection — the entered range becomes the trainee's real
          // Check In/Check Out for the day (see approveTraineeDayOnField).
          await approveTraineeDayOnField(entry.profileId, entry.workDate, onFieldStart, onFieldEnd, myProfileId, myProfileId);
        } else {
          await rejectTraineeDay(entry.id, myProfileId, finalRejectReason);
        }
      });
      return;
    }
    // No punch at all — see recordTraineeDayWithoutPunch. Targets dateTo
    // (the end of the selected range, today by default).
    const trainee = profileById.get(selected.profileId);
    const managerId =
      profiles.find((p) => p.is_active && (p.display_name || "").trim().toLowerCase() === (trainee?.manager_name || "").trim().toLowerCase())?.id ?? null;
    void run("update status", async () => {
      if (rejectReasonOption === "On Field") {
        await approveTraineeDayOnField(selected.profileId, dateTo, onFieldStart, onFieldEnd, managerId, myProfileId);
      } else {
        await recordTraineeDayWithoutPunch(selected.profileId, dateTo, managerId, myProfileId, finalRejectReason);
      }
    });
  };

  // Testing/correction convenience — wipes this day back to a clean slate
  // (see resetTraineeDay) so it can be re-punched and re-run through the flow.
  const handleReset = () => {
    if (!selectedEntry) return;
    const name = profileById.get(selectedEntry.profileId)?.display_name || "this trainee";
    if (!window.confirm(`Reset ${name}'s timecard for ${selectedEntry.workDate} back to no punch at all? This clears both the trainee record and their real timecard for this day.`)) return;
    void run("reset", () => resetTraineeDay(selectedEntry.profileId, selectedEntry.workDate));
  };

  const selectedProfile = selected ? profileById.get(selected.kind === "entry" ? selected.entry.profileId : selected.profileId) : undefined;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-bold text-white">Trainee Attendance</h2>
          {isFallbackReviewer && (
            <div className="flex gap-1.5">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${scope === s ? "bg-primary/20 text-primary" : "bg-slate-800/50 text-slate-400 hover:text-white"}`}
                >
                  {s === "mine" ? "My Trainees & Branch" : "All Trainees"}
                </button>
              ))}
            </div>
          )}
        </div>
        {showAll && (
          <p className="text-xs text-slate-500 mb-3">Every trainee company-wide — for covering a day a trainee's own manager hasn't reviewed.</p>
        )}

        <div className="grid gap-3 md:grid-cols-4 mb-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Search Trainee</label>
            <input type="text" placeholder="Enter trainee name..." value={search} onChange={(e) => setSearch(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={INPUT_CLASS}>
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="nopunch">No Punch Yet</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Manager</label>
            <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className={INPUT_CLASS}>
              <option value="all">All Managers</option>
              {managerOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Branch</label>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={INPUT_CLASS}>
              <option value="all">All Branches</option>
              {branchOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Work Date</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={`flex-1 min-w-0 ${INPUT_CLASS}`} />
              <span className="text-slate-500 text-xs shrink-0">to</span>
              <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={`flex-1 min-w-0 ${INPUT_CLASS}`} />
            </div>
          </div>
          <div className="flex items-end justify-end gap-2 md:col-span-2">
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm">
              <span className="text-yellow-300/80">Pending: </span>
              <span className="font-semibold text-yellow-300">{pendingCount}</span>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-800/50 px-4 py-2 text-sm">
              <span className="text-slate-400">Listed: </span>
              <span className="font-semibold text-white">{filteredRows.length}</span>
            </div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {["Employee", "Work Date", "Clock Times", "Required Time", "Hours", "Manager", "Status", "Actions"].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  {hasActiveFilter
                    ? "No trainee days match your search/filter."
                    : visibleTrainees.length === 0
                      ? showAll
                        ? "No trainees yet — set an employee's Employment Type to Trainee on Masterlist."
                        : isFallbackReviewer
                          ? "You have no trainees of your own — switch to All Trainees to see everyone's."
                          : "You have no trainees assigned to you."
                      : "No trainee timecards in this date range."}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const profile = profileById.get(row.profileId);
                const nameCell = (
                  <td className="px-3 py-3 text-white font-medium">
                    {profile?.display_name ? (
                      <Link
                        to="/m/$module/$submodule"
                        params={{ module: "hr", submodule: "user-management" }}
                        search={{ q: profile.display_name } as any}
                        className="text-blue-400 hover:text-blue-300 hover:underline"
                        title="Open in User Management"
                      >
                        {profile.display_name}
                      </Link>
                    ) : "—"}
                    <p className="text-[11px] text-slate-500 font-normal">{roleLabel(profile?.role)}{profile?.assigned_branch ? ` · ${profile.assigned_branch}` : ""}</p>
                  </td>
                );
                const requiredCell = (
                  <td className="px-3 py-3 text-slate-400">{profile?.required_check_in || "—"} → {profile?.required_check_out || "—"}</td>
                );

                if (row.kind === "placeholder") {
                  return (
                    <tr key={`placeholder:${row.profileId}`} className="border-b border-white/5 hover:bg-white/5 transition">
                      {nameCell}
                      <td className="px-3 py-3 text-slate-500">—</td>
                      <td className="px-3 py-3 text-slate-500">No punch in this date range yet.</td>
                      {requiredCell}
                      <td className="px-3 py-3 text-slate-500">—</td>
                      <td className="px-3 py-3 text-slate-300">{managerNameOf(row.profileId)}</td>
                      <td className="px-3 py-3">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold border bg-white/10 text-slate-400 border-white/10">No Punch Yet</span>
                      </td>
                      <td className="px-3 py-3">
                        {canManageTrainee(profile) ? (
                          <button onClick={() => openPlaceholder(row.profileId)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition">
                            Mark Status
                          </button>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                    </tr>
                  );
                }

                const entry = row.entry!;
                // Full-access roles, whoever is the trainee's manager NOW (not
                // whoever was stamped on the entry at punch time), or — when
                // the trainee is governed by the Approval Chain — the chain's
                // approvers, which replace the generic fallback reviewers.
                const chainDecision = chainCanApprove(myProfileId, entry.profileId);
                const canApprove =
                  isAttendanceFullAccessRole(role, extraRoles) ||
                  isCurrentTraineeManager(profileById.get(entry.profileId), entry, myProfileId, viewerName) ||
                  (chainDecision !== null ? chainDecision : isTraineeFallbackReviewerRole(role, extraRoles));
                const hours = calcWorkedHours({ checkIn: entry.checkIn, checkOut: entry.checkOut, mealStart: entry.mealStart, mealEnd: entry.mealEnd, notes: "" });
                return (
                  <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5 transition">
                    {nameCell}
                    <td className="px-3 py-3 text-slate-300">{entry.workDate}</td>
                    <td className="px-3 py-3 text-slate-300">
                      {entry.checkIn || "—"} → {entry.checkOut ? entry.checkOut : <span className="text-amber-300">still clocked in</span>}
                      {(entry.mealStart || entry.mealEnd) && (
                        <p className="text-[11px] text-slate-500">Meal: {entry.mealStart || "—"} → {entry.mealEnd || "—"}</p>
                      )}
                    </td>
                    {requiredCell}
                    <td className="px-3 py-3 text-slate-300">{hours.toFixed(2)}h</td>
                    <td className="px-3 py-3 text-slate-300">{managerNameOf(entry.profileId)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${STATUS_BADGE[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
                      {entry.status === "rejected" && entry.rejectReason && (
                        <p className="mt-1 text-[11px] text-slate-400 italic max-w-[180px]">"{entry.rejectReason}"</p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {canApprove ? (
                        <button onClick={() => openEntry(entry)} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition">
                          View Timecard
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs">{STATUS_LABEL[entry.status]}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={closeModal}>
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Trainee Timecard</h2>
                <p className="text-sm text-slate-400 mt-1">Trainee: <span className="text-blue-400">{selectedProfile?.display_name || "—"}</span></p>
                <p className="text-sm text-slate-400">Work Date: {selectedEntry ? selectedEntry.workDate : dateTo}</p>
                <p className="text-sm text-slate-400">Manager: {selectedProfile ? managerNameOf(selectedProfile.id) : "—"}</p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition p-1">✕</button>
            </div>

            {selectedEntry && (
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-1">Clock Times</h3>
                <p className="text-xs text-slate-400 mb-3">
                  Punched: <span className="text-slate-200 font-semibold">{selectedEntry.checkIn || "—"} → {selectedEntry.checkOut || "—"}</span>
                  {" · "}Required: {selectedProfile?.required_check_in || "—"} → {selectedProfile?.required_check_out || "—"}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check In</label>
                    <input type="time" step="1" value={draft.checkIn} onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })} className={MODAL_INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check Out</label>
                    <input type="time" step="1" value={draft.checkOut} onChange={(e) => setDraft({ ...draft, checkOut: e.target.value })} className={MODAL_INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Meal Start</label>
                    <input type="time" step="1" value={draft.mealStart} onChange={(e) => setDraft({ ...draft, mealStart: e.target.value })} className={MODAL_INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Meal End</label>
                    <input type="time" step="1" value={draft.mealEnd} onChange={(e) => setDraft({ ...draft, mealEnd: e.target.value })} className={MODAL_INPUT_CLASS} />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 text-sm">
                  <span className="text-slate-400">Hours: <span className="text-white font-semibold">{draftHours.toFixed(2)}h</span></span>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_BADGE[selectedEntry.status]}`}>{STATUS_LABEL[selectedEntry.status]}</span>
                </div>
                {selectedEntry.status === "rejected" && selectedEntry.rejectReason && (
                  <p className="mt-2 text-xs text-slate-400 italic">Rejected: "{selectedEntry.rejectReason}"</p>
                )}
              </div>
            )}

            {rejecting && (
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6 space-y-3">
                <h3 className="text-sm font-bold text-white">{selectedEntry ? "Reject / On Field" : "Mark Status (no punch)"}</h3>
                <select value={rejectReasonOption} onChange={(e) => setRejectReasonOption(e.target.value)} autoFocus className={MODAL_INPUT_CLASS}>
                  <option value="">Select reason…</option>
                  {REJECT_REASON_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                {rejectReasonOption === "Other" && (
                  <input type="text" value={rejectReasonCustom} onChange={(e) => setRejectReasonCustom(e.target.value)} placeholder="Specify reason…" className={MODAL_INPUT_CLASS} />
                )}
                {rejectReasonOption === "On Field" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-xs text-slate-400 uppercase mb-2">On Field Start</label>
                      <input type="time" value={onFieldStart} onChange={(e) => setOnFieldStart(e.target.value)} className={MODAL_INPUT_CLASS} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 uppercase mb-2">On Field End</label>
                      <input type="time" value={onFieldEnd} onChange={(e) => setOnFieldEnd(e.target.value)} className={MODAL_INPUT_CLASS} />
                    </div>
                    <p className="md:col-span-2 text-xs text-slate-500">These become their real Check In / Check Out and the day is approved.</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedEntry && !rejecting && (
                <>
                  <button onClick={handleReset} disabled={acting} className="mr-auto px-3 py-2 rounded-lg text-xs font-semibold border border-white/15 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-40" title="Clear this day back to no punch at all">
                    Reset Day
                  </button>
                  {selectedEntry.status !== "approved" && (
                    <button onClick={handleSaveTimes} disabled={acting || !draftChanged} className="px-4 py-2 rounded-lg text-sm font-semibold border border-white/15 bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40">
                      Save Times
                    </button>
                  )}
                  <button onClick={() => setRejecting(true)} disabled={acting} className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">
                    {selectedEntry.status === "rejected" ? "Change Reason" : "Reject"}
                  </button>
                  <button onClick={handleApprove} disabled={acting} className="px-4 py-2 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-40">
                    {acting ? "Saving…" : selectedEntry.status === "approved" ? "Re-approve" : draftChanged ? "Save & Approve" : "Approve"}
                  </button>
                </>
              )}
              {rejecting && (
                <>
                  <button onClick={selectedEntry ? resetRejectForm : closeModal} disabled={acting} className="px-4 py-2 rounded-lg text-sm font-semibold border border-white/15 bg-white/5 text-slate-300 hover:bg-white/10">
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={!canSubmitReject || acting}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 ${rejectReasonOption === "On Field" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
                  >
                    {acting ? "Saving…" : rejectReasonOption === "On Field" ? "Approve On Field" : selectedEntry ? "Confirm Reject" : "Confirm"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
