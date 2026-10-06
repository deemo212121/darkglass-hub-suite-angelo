/**
 * PTO Management — request + two-of-three-stage (Manager/HR/Accounting)
 * approval for PTO/Leave requests. Self-contained: fetches its own data
 * independently (own profiles/team-scoping, own PTO requests) rather than
 * depending on a parent page's unrelated state, so the exact same tab can
 * be rendered from more than one page — Attendance Monitoring's own "PTO
 * Management" tab and Absent List's tab of the same name both mount this
 * directly. Mirrors TicketAttendanceTab.tsx's self-containment for the
 * same reason.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getProfileEmployeeInfo, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds, resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import {
  getCompanyPtoRequests,
  createPtoRequest,
  reviewPtoStage,
  resetPtoStage,
  canReviewPtoStage,
  isEligibleForPto,
  ptoEligibleDate,
  type PtoRequestRow,
  type PtoType,
  type PtoStage,
} from "@/lib/supabase/pto";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import { PtoManagerSignModal, PtoHrSignModal } from "@/components/PtoSignModals";

// Same split as Attendance Monitoring's PTO Management (Paid Leave / Unpaid Leave).
const PAID_LEAVE_PTO_TYPES: PtoType[] = ["vacation"];
const UNPAID_LEAVE_PTO_TYPES: PtoType[] = ["personal", "unpaid", "sick", "holiday", "bereavement"];

const PTO_TYPE_LABELS: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

export function PtoManagementTab() {
  const { uid, role, extraRoles, displayName, companyId } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [profileRows, composition, ptoRows] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getCompanyPtoRequests(),
      ]);
      setProfiles(profileRows);
      setCsrComposition(composition);
      setPtoRequests(ptoRows);
    } catch (err) {
      console.error("PtoManagementTab: load failed", err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const profileName = (id: string | null) => {
    if (!id) return "—";
    const p = profileById.get(id);
    return p?.display_name || p?.email || "—";
  };

  // Manager-tier viewer only sees their own team's PTO requests, never the
  // whole company's — same scoping Attendance Monitoring itself uses.
  const myProfile = myProfileId ? profileById.get(myProfileId) ?? null : null;
  const teamScopedIds = useMemo(
    () => (myProfile ? visibleAttendanceProfileIds(myProfile, profiles, csrComposition) : null),
    [myProfile, profiles, csrComposition]
  );
  // Status tabs + Dates / Submitted sort — same as Attendance Monitoring's PTO table.
  const [ptoLeaveTab, setPtoLeaveTab] = useState<"paid" | "unpaid">("paid");
  const [ptoStatusTab, setPtoStatusTab] = useState<"pending" | "approved" | "rejected">("pending");
  const ptoStatusMatches = (status: string, tab: "pending" | "approved" | "rejected") => (tab === "rejected" ? status === "denied" : status === tab);
  const [ptoSort, setPtoSort] = useState<{ key: "dates" | "submitted"; dir: "desc" | "asc" }>({ key: "submitted", dir: "desc" });
  const togglePtoSort = (key: "dates" | "submitted") =>
    setPtoSort((cur) => (cur.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const ptoSubmittedDay = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const visiblePtoRequests = useMemo(() => {
    if (teamScopedIds === null) return ptoRequests;
    return ptoRequests.filter((r) => teamScopedIds.has(r.profileId));
  }, [ptoRequests, teamScopedIds]);
  const sortedPtoTableRows = useMemo(() => {
    const leaveTypes = ptoLeaveTab === "paid" ? PAID_LEAVE_PTO_TYPES : UNPAID_LEAVE_PTO_TYPES;
    const rows = visiblePtoRequests.filter((r) => leaveTypes.includes(r.ptoType) && ptoStatusMatches(r.status, ptoStatusTab));
    const keyOf = (r: (typeof rows)[number]) => (ptoSort.key === "dates" ? `${r.startDate}|${r.createdAt}` : r.createdAt);
    return [...rows].sort((a, b) => (ptoSort.dir === "desc" ? keyOf(b).localeCompare(keyOf(a)) : keyOf(a).localeCompare(keyOf(b))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePtoRequests, ptoStatusTab, ptoSort, ptoLeaveTab]);
  const visibleProfiles = useMemo(
    () => profiles.filter((p) => p.is_active && (teamScopedIds === null || teamScopedIds.has(p.id))).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")),
    [profiles, teamScopedIds]
  );

  const [busyPtoId, setBusyPtoId] = useState<string | null>(null);
  const [signingManagerFor, setSigningManagerFor] = useState<PtoRequestRow | null>(null);
  const [signingHrFor, setSigningHrFor] = useState<PtoRequestRow | null>(null);
  const [showPtoForm, setShowPtoForm] = useState(false);
  const [ptoForm, setPtoForm] = useState({ profileId: "", ptoType: "vacation" as PtoType, startDate: "", endDate: "", reason: "" });
  const [ptoFormHireDate, setPtoFormHireDate] = useState<string | null>(null);
  const [submittingPto, setSubmittingPto] = useState(false);

  useEffect(() => {
    if (!ptoForm.profileId) {
      setPtoFormHireDate(null);
      return;
    }
    let cancelled = false;
    getProfileEmployeeInfo(ptoForm.profileId).then((info) => {
      if (!cancelled) setPtoFormHireDate(info?.hireDate || null);
    });
    return () => { cancelled = true; };
  }, [ptoForm.profileId]);

  const ptoFormCreatedAt = profileById.get(ptoForm.profileId)?.created_at ?? null;
  // Sick Leave has no 1-year wait — it's available from day 1 — so the
  // vacation-PTO eligibility gate only applies to every other leave type.
  const ptoFormEligible = ptoForm.ptoType === "sick" || !ptoForm.profileId || isEligibleForPto(ptoFormHireDate, ptoFormCreatedAt);
  const ptoFormEligibleOn = ptoEligibleDate(ptoFormHireDate, ptoFormCreatedAt);

  const handleSubmitPtoRequest = async () => {
    if (!ptoForm.profileId || !ptoForm.startDate || !ptoForm.endDate) {
      alert("Please fill in employee, start date, and end date.");
      return;
    }
    if (ptoForm.ptoType !== "sick" && !isEligibleForPto(ptoFormHireDate, ptoFormCreatedAt)) {
      alert(`${profileName(ptoForm.profileId)} isn't eligible for PTO yet — employees need 1 year of tenure first. Eligible starting ${ptoFormEligibleOn}.`);
      return;
    }
    setSubmittingPto(true);
    try {
      const requester = profileById.get(ptoForm.profileId) ?? null;
      const manager = requester ? await resolveTeamLeadOrManager(requester, profiles) : null;
      await createPtoRequest({
        profileId: ptoForm.profileId,
        ptoType: ptoForm.ptoType,
        startDate: ptoForm.startDate,
        endDate: ptoForm.endDate,
        reason: ptoForm.reason,
        requestedBy: myProfileId,
        managerId: manager?.id ?? null,
      });
      setPtoRequests(await getCompanyPtoRequests());
      setShowPtoForm(false);
      setPtoForm({ profileId: "", ptoType: "vacation", startDate: "", endDate: "", reason: "" });
    } catch (error) {
      alert(`Failed to submit PTO request: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSubmittingPto(false);
    }
  };

  const handlePtoStageAction = async (request: PtoRequestRow, stage: PtoStage, decision: "approved" | "rejected") => {
    setBusyPtoId(request.id);
    try {
      await reviewPtoStage(request, stage, decision, myProfileId || "", displayName || "Admin");
      setPtoRequests(await getCompanyPtoRequests());
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "Admin",
        action: decision === "approved" ? "pto_request_approved" : "pto_request_rejected",
        targetType: "pto_request",
        targetId: request.id,
        targetLabel: `${profileName(request.profileId)} (${request.startDate} – ${request.endDate})`,
        details: { stage, ptoType: request.ptoType },
      });
    } catch (error) {
      alert(`Failed to update PTO request: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyPtoId(null);
    }
  };

  // Undo a mistaken Approve/Reject on one stage — the review buttons above
  // only render while that stage is "pending" (see the JSX below), so once
  // someone has clicked, there's otherwise no way to revisit it even for a
  // plain misclick. Resets just that one stage back to pending; the other
  // two stages, and their own history, are untouched.
  const handleReconsiderStage = async (request: PtoRequestRow, stage: PtoStage) => {
    const stageLabel = stage === "manager" ? "Manager" : stage === "hr" ? "HR" : "Accounting";
    if (!window.confirm(`Undo the ${stageLabel} decision on this request and set it back to pending? The reviewer will need to re-decide.`)) return;
    setBusyPtoId(request.id);
    try {
      await resetPtoStage(request.id, stage);
      setPtoRequests(await getCompanyPtoRequests());
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "Admin",
        action: "pto_stage_reconsidered",
        targetType: "pto_request",
        targetId: request.id,
        targetLabel: `${profileName(request.profileId)} (${request.startDate} – ${request.endDate})`,
        details: {
          stage,
          ptoType: request.ptoType,
          previousStatus: stage === "manager" ? request.managerStatus : stage === "hr" ? request.hrStatus : request.accountingStatus,
        },
      });
    } catch (error) {
      alert(`Failed to reset this stage: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyPtoId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {([
          ["paid", "Paid Leave"],
          ["unpaid", "Unpaid Leave"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPtoLeaveTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${ptoLeaveTab === key ? "bg-blue-600 text-white" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}
          >
            {label}
            {(() => {
              const n = visiblePtoRequests.filter((r) => (key === "paid" ? PAID_LEAVE_PTO_TYPES : UNPAID_LEAVE_PTO_TYPES).includes(r.ptoType) && r.status === "pending").length;
              return n > 0 ? <span className="home-badge home-badge--sm" title={`${n} pending`}>{n > 99 ? "99+" : n}</span> : null;
            })()}
          </button>
        ))}
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="text-lg font-bold text-white">PTO Requests</h2>
          <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/40 p-0.5" role="tablist" aria-label="PTO status">
            {([
              ["pending", "Pending", "text-yellow-300"],
              ["approved", "Approved", "text-green-300"],
              ["rejected", "Rejected", "text-red-300"],
            ] as const).map(([key, label, tone]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={ptoStatusTab === key}
                onClick={() => setPtoStatusTab(key)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition inline-flex items-center gap-1.5 ${ptoStatusTab === key ? `bg-white/10 ${tone}` : "text-slate-400 hover:text-white"}`}
              >
                {label}
                <span className="rounded-full bg-black/25 px-1.5 text-[10px] tabular-nums">{visiblePtoRequests.filter((r) => (ptoLeaveTab === "paid" ? PAID_LEAVE_PTO_TYPES : UNPAID_LEAVE_PTO_TYPES).includes(r.ptoType) && ptoStatusMatches(r.status, key)).length}</span>
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">
                <button
                  type="button"
                  onClick={() => togglePtoSort("dates")}
                  title="Sort — click to flip newest / oldest"
                  className={`inline-flex items-center gap-1 uppercase hover:text-white ${ptoSort.key === "dates" ? "text-white" : ""}`}
                >
                  Dates <span className="text-[10px]">{ptoSort.key === "dates" ? (ptoSort.dir === "desc" ? "▼" : "▲") : "↕"}</span>
                </button>
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">
                <button
                  type="button"
                  onClick={() => togglePtoSort("submitted")}
                  title="Sort — click to flip newest / oldest"
                  className={`inline-flex items-center gap-1 uppercase hover:text-white ${ptoSort.key === "submitted" ? "text-white" : ""}`}
                >
                  Submitted <span className="text-[10px]">{ptoSort.key === "submitted" ? (ptoSort.dir === "desc" ? "▼" : "▲") : "↕"}</span>
                </button>
              </th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Days</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : sortedPtoTableRows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No {ptoStatusTab} PTO requests.</td></tr>
            ) : sortedPtoTableRows.map((request) => {
              const requesterManagerName = profileById.get(request.profileId)?.manager_name ?? null;
              const requesterManagersManagerName = requesterManagerName
                ? profiles.find((p) => (p.display_name || "").trim().toLowerCase() === requesterManagerName.trim().toLowerCase())?.manager_name ?? null
                : null;
              return (
              <tr key={request.id} className="border-b border-white/5 hover:bg-white/5 transition">
                <td className="px-3 py-3 text-white font-medium">{profileName(request.profileId)}</td>
                <td className="px-3 py-3 text-slate-300">{PTO_TYPE_LABELS[request.ptoType]}</td>
                <td className="px-3 py-3 text-slate-300">{request.startDate} to {request.endDate}</td>
                <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{ptoSubmittedDay(request.createdAt)}</td>
                <td className="px-3 py-3 text-center text-slate-300">{Math.round(request.hoursRequested / 8)}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      request.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : request.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                    }`}>
                      Manager: {request.managerStatus.charAt(0).toUpperCase() + request.managerStatus.slice(1)}
                      {request.managerReviewedBy ? ` — ${profileName(request.managerReviewedBy)}` : ""}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      request.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : request.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                    }`}>
                      HR: {request.hrStatus.charAt(0).toUpperCase() + request.hrStatus.slice(1)}
                      {request.hrReviewedBy ? ` — ${profileName(request.hrReviewedBy)}` : ""}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      request.accountingStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : request.accountingStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                    }`}>
                      Accounting: {request.accountingStatus.charAt(0).toUpperCase() + request.accountingStatus.slice(1)}
                      {request.accountingReviewedBy ? ` — ${profileName(request.accountingReviewedBy)}` : ""}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-1.5">
                    {request.managerStatus === "pending" && canReviewPtoStage(request, "manager", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName) && (
                      <div className="flex gap-1">
                        <span className="text-[10px] text-slate-500 self-center">Mgr:</span>
                        {request.exceptionType !== null ? (
                          <button type="button" title="Approve & sign as manager" onClick={() => setSigningManagerFor(request)} disabled={busyPtoId === request.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                          </button>
                        ) : (
                          <button type="button" title="Approve as manager" onClick={() => handlePtoStageAction(request, "manager", "approved")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                            {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                          </button>
                        )}
                        <button type="button" title="Reject as manager" onClick={() => handlePtoStageAction(request, "manager", "rejected")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    {request.exceptionType !== null && request.hrPaperworkStatus === "pending" && request.hrStatus !== "pending" && canReviewPtoStage(request, "hr", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName) && (
                      <div className="flex gap-1">
                        <span className="text-[10px] text-slate-500 self-center">HR:</span>
                        <button type="button" title="Sign the Exception Report as HR" onClick={() => setSigningHrFor(request)} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {request.hrStatus === "pending" && canReviewPtoStage(request, "hr", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName) && (
                      <div className="flex gap-1">
                        <span className="text-[10px] text-slate-500 self-center">HR:</span>
                        <button
                          type="button"
                          title={request.exceptionType !== null && request.hrPaperworkStatus === "pending" ? "Approve & sign as HR" : "Approve as HR"}
                          onClick={() => (request.exceptionType !== null && request.hrPaperworkStatus === "pending" ? setSigningHrFor(request) : handlePtoStageAction(request, "hr", "approved"))}
                          disabled={busyPtoId === request.id}
                          className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1"
                        >
                          {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                        </button>
                        <button type="button" title="Reject as HR" onClick={() => handlePtoStageAction(request, "hr", "rejected")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    {request.accountingStatus === "pending" && canReviewPtoStage(request, "accounting", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName) && (
                      <div className="flex gap-1">
                        <span className="text-[10px] text-slate-500 self-center">Acct:</span>
                        <button type="button" title="Approve as Accounting" onClick={() => handlePtoStageAction(request, "accounting", "approved")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                        </button>
                        <button type="button" title="Reject as Accounting" onClick={() => handlePtoStageAction(request, "accounting", "rejected")} disabled={busyPtoId === request.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyPtoId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    {!(request.managerStatus === "pending" && canReviewPtoStage(request, "manager", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName)) &&
                     !(request.hrStatus === "pending" && canReviewPtoStage(request, "hr", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName)) &&
                     !(request.accountingStatus === "pending" && canReviewPtoStage(request, "accounting", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName)) && (
                      <span className="text-xs text-slate-500">{request.managerStatus === "pending" ? "Awaiting manager" : "Awaiting HR/Accounting"}</span>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
        <h2 className="text-lg font-bold text-white mb-4">PTO History</h2>
        <div className="space-y-3">
          {visiblePtoRequests.filter(r => r.status !== "pending").length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm">No PTO history yet</p>
            </div>
          ) : visiblePtoRequests.filter(r => r.status !== "pending").map((request) => {
            const requesterManagerName = profileById.get(request.profileId)?.manager_name ?? null;
            const requesterManagersManagerName = requesterManagerName
              ? profiles.find((p) => (p.display_name || "").trim().toLowerCase() === requesterManagerName.trim().toLowerCase())?.manager_name ?? null
              : null;
            // A "Reconsider" button per stage that's rejected AND that this
            // viewer could act on in the first place (same canReviewPtoStage
            // gate the live Approve/Reject buttons use above) — the only way
            // to undo a mistaken decision, since this history row otherwise
            // has no controls at all once the request leaves "pending".
            const reconsiderable: { stage: PtoStage; label: string }[] = (
              [
                ["manager", "Manager"],
                ["hr", "HR"],
                ["accounting", "Accounting"],
              ] as [PtoStage, string][]
            ).filter(([stage]) => {
              const status = stage === "manager" ? request.managerStatus : stage === "hr" ? request.hrStatus : request.accountingStatus;
              return status === "rejected" && canReviewPtoStage(request, stage, myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName);
            }).map(([stage, label]) => ({ stage, label }));
            return (
            <div key={request.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white">{profileName(request.profileId)} - {PTO_TYPE_LABELS[request.ptoType]}</p>
                  <p className="text-xs text-slate-400 mt-1">{request.startDate} to {request.endDate}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${
                      request.status === "approved" ? "bg-green-500/20 text-green-300" : request.status === "denied" ? "bg-red-500/20 text-red-300" : "bg-slate-500/20 text-slate-300"
                    }`}>
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Manager: {request.managerStatus}{request.managerReviewedBy ? ` by ${profileName(request.managerReviewedBy)}` : ""}{request.managerReviewedAt ? ` on ${request.managerReviewedAt.slice(0, 10)}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    HR: {request.hrStatus}{request.hrReviewedBy ? ` by ${profileName(request.hrReviewedBy)}` : ""}{request.hrReviewedAt ? ` on ${request.hrReviewedAt.slice(0, 10)}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    Accounting: {request.accountingStatus}{request.accountingReviewedBy ? ` by ${profileName(request.accountingReviewedBy)}` : ""}{request.accountingReviewedAt ? ` on ${request.accountingReviewedAt.slice(0, 10)}` : ""}
                  </p>
                </div>
                {reconsiderable.length > 0 && (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {reconsiderable.map(({ stage, label }) => (
                      <button
                        key={stage}
                        type="button"
                        title={`Undo the ${label} rejection and set it back to pending`}
                        disabled={busyPtoId === request.id}
                        onClick={() => void handleReconsiderStage(request, stage)}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded text-[10px] font-semibold transition whitespace-nowrap"
                      >
                        {busyPtoId === request.id ? "…" : `Reconsider (${label})`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {showPtoForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-white">New PTO Request</h3>
              <button onClick={() => setShowPtoForm(false)} className="text-slate-400 hover:text-white transition p-1">✕</button>
            </div>
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Employee</label>
                <select value={ptoForm.profileId} onChange={(e) => setPtoForm({ ...ptoForm, profileId: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">Select employee</option>
                  {visibleProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                  ))}
                </select>
                {ptoForm.profileId && ptoForm.ptoType !== "sick" && !ptoFormEligible && (
                  <p className="text-xs text-amber-300 mt-1">
                    Not yet eligible for PTO — needs 1 year of tenure first (eligible starting {ptoFormEligibleOn}).
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Type</label>
                <select value={ptoForm.ptoType} onChange={(e) => setPtoForm({ ...ptoForm, ptoType: e.target.value as PtoType })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                  {(Object.keys(PTO_TYPE_LABELS) as PtoType[]).map((t) => (
                    <option key={t} value={t}>{PTO_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Start Date</label>
                  <input type="date" value={ptoForm.startDate} onChange={(e) => setPtoForm({ ...ptoForm, startDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">End Date</label>
                  <input type="date" value={ptoForm.endDate} onChange={(e) => setPtoForm({ ...ptoForm, endDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Reason</label>
                <textarea value={ptoForm.reason} onChange={(e) => setPtoForm({ ...ptoForm, reason: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSubmitPtoRequest}
                disabled={!ptoFormEligible || submittingPto}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition font-semibold text-sm"
              >
                {submittingPto ? "Submitting…" : "Submit"}
              </button>
              <button onClick={() => setShowPtoForm(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {signingManagerFor && (
        <PtoManagerSignModal
          request={signingManagerFor}
          companyId={companyId}
          profiles={profiles}
          reviewerId={myProfileId}
          reviewerName={displayName || "Manager"}
          onClose={() => setSigningManagerFor(null)}
          onSigned={async () => {
            setSigningManagerFor(null);
            await load();
          }}
        />
      )}
      {signingHrFor && (
        <PtoHrSignModal
          request={signingHrFor}
          companyId={companyId}
          profiles={profiles}
          reviewerId={myProfileId}
          reviewerName={displayName || "HR"}
          onClose={() => setSigningHrFor(null)}
          onSigned={async () => {
            setSigningHrFor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
