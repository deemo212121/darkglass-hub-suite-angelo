/**
 * Attendance Corrections — request + two-of-three-stage (Manager/HR/
 * Accounting) approval for a check-in/check-out/meal punch fix. Self-
 * contained (own profiles/team-scoping/data fetch), same reasoning as
 * PtoManagementTab.tsx right beside it, so the same tab can be rendered
 * from Attendance Monitoring AND Absent List.
 *
 * Deliberately a streamlined copy, not a byte-for-byte port of Attendance
 * Monitoring's own Corrections tab: approve/reject act on the correction
 * exactly as submitted (reviewCorrectionStage's own `corrected` override
 * param is never used here), and department/branch/work-date filters are
 * left out in favor of just search + status — matching the same
 * "browse and act, not the full power-user toolbox" scope this session's
 * mobile Team Approvals view already settled on for the identical data.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import {
  getCompanyTimecardCorrections,
  getCompanyTimecardCorrectionHistory,
  reviewCorrectionStage,
  canReviewCorrectionStage,
  type TimecardCorrectionRow,
  type TimecardCorrectionHistoryRow,
  type CorrectionStatus,
} from "@/lib/supabase/timecardCorrections";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import { CorrectionManagerSignModal, CorrectionHrSignModal } from "@/components/CorrectionSignModals";

export function CorrectionsTab() {
  const { uid, role, extraRoles, displayName, companyId } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [correctionHistory, setCorrectionHistory] = useState<TimecardCorrectionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [profileRows, composition, correctionRows, historyRows] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getCompanyTimecardCorrections(),
        getCompanyTimecardCorrectionHistory(),
      ]);
      setProfiles(profileRows);
      setCsrComposition(composition);
      setCorrections(correctionRows);
      setCorrectionHistory(historyRows);
    } catch (err) {
      console.error("CorrectionsTab: load failed", err);
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

  const myProfile = myProfileId ? profileById.get(myProfileId) ?? null : null;
  const teamScopedIds = useMemo(
    () => (myProfile ? visibleAttendanceProfileIds(myProfile, profiles, csrComposition) : null),
    [myProfile, profiles, csrComposition]
  );

  const [correctionSearch, setCorrectionSearch] = useState("");
  const [correctionStatusFilter, setCorrectionStatusFilter] = useState<"all" | CorrectionStatus>("all");
  // "New" = has the Exception Report fields (exceptionType set at
  // submission, migration 0304) — every correction submitted from now on.
  // "Old" = submitted before this feature existed, kept purely as a
  // read-only archive; never routed through the signature-required approve
  // flow (see the manager-approve button below), since they were never
  // asked to sign anything in the first place.
  const [correctionEraFilter, setCorrectionEraFilter] = useState<"new" | "old">("new");

  // A stale managerId snapshot only ever ADDS visibility (the requester's
  // manager at submission time can still act even if team scoping has since
  // moved them out), never removes it — same rule Attendance Monitoring's
  // own Corrections tab uses.
  const filteredCorrections = useMemo(() => {
    const q = correctionSearch.trim().toLowerCase();
    return corrections.filter((c) => {
      if ((c.exceptionType !== null) !== (correctionEraFilter === "new")) return false;
      if (teamScopedIds !== null && !teamScopedIds.has(c.profileId) && c.managerId !== myProfileId) return false;
      if (correctionStatusFilter !== "all" && c.status !== correctionStatusFilter) return false;
      if (q && !profileName(c.profileId).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [corrections, correctionSearch, correctionStatusFilter, correctionEraFilter, teamScopedIds, myProfileId, profiles]);
  const correctionPendingCount = useMemo(() => filteredCorrections.filter((c) => c.status === "pending").length, [filteredCorrections]);

  const visibleCorrectionHistory = useMemo(() => {
    if (teamScopedIds === null) return correctionHistory;
    return correctionHistory.filter((h) => {
      const related = corrections.find((c) => c.id === h.correctionId);
      if (!related) return false;
      return teamScopedIds.has(related.profileId) || related.managerId === myProfileId;
    });
  }, [correctionHistory, corrections, teamScopedIds, myProfileId]);

  const [busyCorrectionId, setBusyCorrectionId] = useState<string | null>(null);
  const [signingManagerFor, setSigningManagerFor] = useState<TimecardCorrectionRow | null>(null);
  const [signingHrFor, setSigningHrFor] = useState<TimecardCorrectionRow | null>(null);
  const managerChainFor = (requesterProfileId: string) => {
    const requesterManagerName = profileById.get(requesterProfileId)?.manager_name ?? null;
    const requesterManagersManagerName = requesterManagerName
      ? profiles.find((p) => (p.display_name || "").trim().toLowerCase() === requesterManagerName.trim().toLowerCase())?.manager_name ?? null
      : null;
    return { requesterManagerName, requesterManagersManagerName };
  };

  const handleCorrectionStageAction = async (c: TimecardCorrectionRow, stage: "manager" | "hr" | "accounting", decision: "approved" | "rejected") => {
    setBusyCorrectionId(c.id);
    try {
      await reviewCorrectionStage(c, stage, decision, myProfileId || "", displayName || "Admin");
      const [correctionRows, historyRows] = await Promise.all([getCompanyTimecardCorrections(), getCompanyTimecardCorrectionHistory()]);
      setCorrections(correctionRows);
      setCorrectionHistory(historyRows);
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "Admin",
        action: decision === "approved" ? "timecard_correction_approved" : "timecard_correction_rejected",
        targetType: "timecard_correction",
        targetId: c.id,
        targetLabel: `${profileName(c.profileId)} (${c.workDate})`,
        details: { stage },
      });
    } catch (error) {
      alert(`Failed to update correction: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyCorrectionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-bold text-white">Attendance Corrections</h2>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setCorrectionEraFilter("new")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${correctionEraFilter === "new" ? "bg-primary/20 text-primary" : "bg-slate-800/50 text-slate-400 hover:text-white"}`}
            >
              New Corrections
            </button>
            <button
              type="button"
              onClick={() => setCorrectionEraFilter("old")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${correctionEraFilter === "old" ? "bg-primary/20 text-primary" : "bg-slate-800/50 text-slate-400 hover:text-white"}`}
            >
              Old Corrections (Archive)
            </button>
          </div>
        </div>
        {correctionEraFilter === "old" && (
          <p className="text-xs text-slate-500 mb-3">Submitted before the Exception Report requirement — kept here for the record only.</p>
        )}
        <div className="grid gap-3 md:grid-cols-4 mb-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Search Employee</label>
            <input
              type="text"
              placeholder="Enter employee name..."
              value={correctionSearch}
              onChange={(e) => setCorrectionSearch(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Status</label>
            <select
              value={correctionStatusFilter}
              onChange={(e) => setCorrectionStatusFilter(e.target.value as "all" | CorrectionStatus)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="flex items-end justify-end gap-2 md:col-span-2">
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm">
              <span className="text-yellow-300/80">Pending: </span>
              <span className="font-semibold text-yellow-300">{correctionPendingCount}</span>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-800/50 px-4 py-2 text-sm">
              <span className="text-slate-400">Listed: </span>
              <span className="font-semibold text-white">{filteredCorrections.length}</span>
            </div>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Work Date</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Original → Corrected</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Reason</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : filteredCorrections.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">{correctionSearch.trim() || correctionStatusFilter !== "all" ? "No correction requests match your search/filter." : "No correction requests yet."}</td></tr>
            ) : filteredCorrections.map((c) => {
              const { requesterManagerName, requesterManagersManagerName } = managerChainFor(c.profileId);
              return (
              <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition">
                <td className="px-3 py-3 text-white font-medium">{profileName(c.profileId)}</td>
                <td className="px-3 py-3 text-slate-300">{c.workDate}</td>
                <td className="px-3 py-3 text-slate-300">
                  {c.originalCheckIn || "—"} → {c.originalCheckOut || "—"}
                  {(c.correctedCheckIn || c.correctedCheckOut) && (
                    <span className="text-emerald-300"> ({c.correctedCheckIn || "—"} → {c.correctedCheckOut || "—"})</span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-300">{c.reason || "—"}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      c.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : c.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                    }`}>
                      Manager: {c.managerStatus.charAt(0).toUpperCase() + c.managerStatus.slice(1)}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      c.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : c.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                    }`}>
                      HR: {c.hrStatus.charAt(0).toUpperCase() + c.hrStatus.slice(1)}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      c.accountingStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : c.accountingStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                    }`}>
                      Accounting: {c.accountingStatus.charAt(0).toUpperCase() + c.accountingStatus.slice(1)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-1.5">
                    {c.managerStatus === "pending" && canReviewCorrectionStage(c, "manager", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName) && (
                      <div className="flex gap-1">
                        <span className="text-[10px] text-slate-500 self-center">Mgr:</span>
                        {c.exceptionType !== null ? (
                          <button type="button" title="Approve & sign as manager" onClick={() => setSigningManagerFor(c)} disabled={busyCorrectionId === c.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                          </button>
                        ) : (
                          // Pre-Exception-Report correction — plain approve, no signature (never asked of them at submission).
                          <button type="button" title="Approve as manager" onClick={() => handleCorrectionStageAction(c, "manager", "approved")} disabled={busyCorrectionId === c.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                            {busyCorrectionId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                          </button>
                        )}
                        <button type="button" title="Reject as manager" onClick={() => handleCorrectionStageAction(c, "manager", "rejected")} disabled={busyCorrectionId === c.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyCorrectionId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    {c.hrStatus === "pending" && canReviewCorrectionStage(c, "hr", myProfileId, role, extraRoles) && (
                      <div className="flex gap-1">
                        <span className="text-[10px] text-slate-500 self-center">HR:</span>
                        {c.exceptionType === null && (
                          // Pre-Exception-Report correction — plain approve, no signature (never asked of them at submission).
                          <button type="button" title="Approve as HR" onClick={() => handleCorrectionStageAction(c, "hr", "approved")} disabled={busyCorrectionId === c.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                            {busyCorrectionId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                          </button>
                        )}
                        <button type="button" title="Reject as HR" onClick={() => handleCorrectionStageAction(c, "hr", "rejected")} disabled={busyCorrectionId === c.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyCorrectionId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    {c.exceptionType !== null && c.hrPaperworkStatus === "pending" && canReviewCorrectionStage(c, "hr", myProfileId, role, extraRoles) && (
                      c.managerSignatureUrl ? (
                        <button type="button" onClick={() => setSigningHrFor(c)} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-semibold transition">
                          Sign Exception Report (HR)
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500">Exception Report: awaiting manager signature</span>
                      )
                    )}
                    {c.accountingStatus === "pending" && canReviewCorrectionStage(c, "accounting", myProfileId, role, extraRoles) && (
                      <div className="flex gap-1">
                        <span className="text-[10px] text-slate-500 self-center">Acct:</span>
                        <button type="button" title="Approve as Accounting" onClick={() => handleCorrectionStageAction(c, "accounting", "approved")} disabled={busyCorrectionId === c.id} className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyCorrectionId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                        </button>
                        <button type="button" title="Reject as Accounting" onClick={() => handleCorrectionStageAction(c, "accounting", "rejected")} disabled={busyCorrectionId === c.id} className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs transition flex items-center gap-1">
                          {busyCorrectionId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    {!(c.managerStatus === "pending" && canReviewCorrectionStage(c, "manager", myProfileId, role, extraRoles, displayName, requesterManagerName, requesterManagersManagerName)) &&
                     !(c.hrStatus === "pending" && canReviewCorrectionStage(c, "hr", myProfileId, role, extraRoles)) &&
                     !(c.accountingStatus === "pending" && canReviewCorrectionStage(c, "accounting", myProfileId, role, extraRoles)) && (
                      <span className="text-xs text-slate-500">{c.status === "pending" ? "Awaiting review" : c.status === "approved" ? "Approved" : "Rejected"}</span>
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
        <h2 className="text-lg font-bold text-white mb-4">Correction History</h2>
        <div className="space-y-3">
          {visibleCorrectionHistory.length > 0 ? (
            visibleCorrectionHistory.map((history) => {
              const relatedCorrection = corrections.find(c => c.id === history.correctionId);
              return (
                <div key={history.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white capitalize">{history.action}</p>
                      <p className="text-xs text-slate-400 mt-1">Changed by <span className="text-slate-300">{profileName(history.changedBy)}</span> on {new Date(history.createdAt).toLocaleString()}</p>
                      {relatedCorrection && (
                        <p className="text-xs text-slate-400 mt-2">
                          Employee: <span className="text-slate-300 font-semibold">{profileName(relatedCorrection.profileId)}</span> |
                          Date: <span className="text-slate-300">{relatedCorrection.workDate}</span> |
                          Original: <span className="text-slate-300">{relatedCorrection.originalCheckIn || "—"} → {relatedCorrection.originalCheckOut || "—"}</span> →
                          Corrected: <span className="text-slate-300 font-semibold">{relatedCorrection.correctedCheckIn || "—"} → {relatedCorrection.correctedCheckOut || "—"}</span>
                        </p>
                      )}
                      {history.previousStatus && (
                        <p className="text-xs text-slate-500 mt-2">
                          Status: <span className="font-semibold text-slate-300">{history.previousStatus}</span> →
                          <span className="font-semibold text-slate-300"> {history.newStatus}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm">No correction history yet</p>
            </div>
          )}
        </div>
      </div>

      {signingManagerFor && (
        <CorrectionManagerSignModal
          correction={signingManagerFor}
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
        <CorrectionHrSignModal
          correction={signingHrFor}
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
