/**
 * Exception Reports — a read-only archive of every "Employee Attendance &
 * Visit Exception Report" PDF generated from a Time Correction Request
 * (migration 0304, timecardCorrectionPdf.ts). Not a creation/review surface
 * — submission and signing both live on the Time Correction flow itself
 * (EmployeeSelfServicePage.tsx / mobile / CorrectionsTab.tsx); this tab
 * exists purely so HR can find and download the generated PDF for any
 * correction without having to dig through the Corrections list/history.
 *
 * Self-contained (own data fetch/team-scoping), same pattern as
 * CorrectionsTab.tsx right beside it in Absent List.
 */
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { getCompanyTimecardCorrections, updateCorrectionPdfUrl, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { getCompanyEmployeeRequests, updateEmployeeRequestPdfUrl, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { getCompanyPtoRequests, updatePtoPdfUrl, type PtoRequestRow } from "@/lib/supabase/pto";
import { EXCEPTION_TYPE_LABELS } from "@/lib/exceptionVisitReportTemplate";
import { TICKET_DISPUTE_EXCEPTION_TYPE_LABELS } from "@/lib/ticketDisputeReportTemplate";
import { downloadSignableDocumentPdf } from "@/lib/downloadSignableDocumentPdf";
import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";
import { employeeInfoFor, CorrectionHrSignModal } from "@/components/CorrectionSignModals";
import { regenerateCorrectionPdf } from "@/lib/timecardCorrectionPdf";
import { resolveEmployeeInfo as resolveTicketDisputeEmployeeInfo, TicketDisputeHrSignModal } from "@/components/TicketDisputeSignModals";
import { regenerateTicketDisputePdf } from "@/lib/ticketDisputeReportPdf";
import { employeeInfoForPto, PtoHrSignModal } from "@/components/PtoSignModals";
import { regeneratePtoExceptionReportPdf } from "@/lib/ptoExceptionReportPdf";
import { normalizeRole } from "@/lib/roleLabels";

const PTO_LEAVE_TYPE_LABELS: Record<string, string> = { sick: "Sick Leave", unpaid: "Unpaid Leave" };

interface ExceptionReportLike {
  managerSignatureUrl: string | null;
  hrPaperworkStatus: "pending" | "approved" | "additional_review_required";
}

function managerBadge(c: ExceptionReportLike): { label: string; className: string } {
  return c.managerSignatureUrl
    ? { label: "Manager: Signed", className: "bg-green-500/20 text-green-300 border-green-500/30" }
    : { label: "Manager: Pending", className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" };
}

function hrBadge(c: ExceptionReportLike): { label: string; className: string } {
  if (c.hrPaperworkStatus === "approved") return { label: "HR: Approved", className: "bg-green-500/20 text-green-300 border-green-500/30" };
  if (c.hrPaperworkStatus === "additional_review_required") return { label: "HR: Additional Review Required", className: "bg-red-500/20 text-red-300 border-red-500/30" };
  // HR can't act until the manager has signed (see CorrectionSignModals.tsx/TicketDisputeSignModals.tsx) — reflect that in the label rather than a bare "Pending".
  return {
    label: c.managerSignatureUrl ? "HR: Pending" : "HR: Awaiting Manager First",
    className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  };
}

export function ExceptionReportsTab() {
  const { uid, role, extraRoles, displayName, companyId } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);
  // Sign HR is only for actual HR/Admin/Finance/Superadmin — a manager who
  // can see a row here (their own team's) still can't sign the HR paperwork,
  // same gate TicketTimeDisputesTab.tsx/CorrectionsTab.tsx already enforce.
  const isFullRequestsAdmin = [role, ...(extraRoles ?? [])].some((r) => ["ADMIN", "SUPERADMIN", "HR", "FINANCE"].includes(normalizeRole(r)));

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [ticketDisputes, setTicketDisputes] = useState<EmployeeRequestRow[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [profileRows, composition, correctionRows, requestRows, ptoRows] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getCompanyTimecardCorrections(),
        getCompanyEmployeeRequests(),
        getCompanyPtoRequests(),
      ]);
      setProfiles(profileRows);
      setCsrComposition(composition);
      setCorrections(correctionRows);
      setTicketDisputes(requestRows.filter((r) => r.requestType === "ticket_time_dispute"));
      setPtoRequests(ptoRows);
    } catch (err) {
      console.error("ExceptionReportsTab: load failed", err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const profileName = (id: string) => profileById.get(id)?.display_name || profileById.get(id)?.email || "—";

  const myProfile = myProfileId ? profileById.get(myProfileId) ?? null : null;
  const teamScopedIds = useMemo(
    () => (myProfile ? visibleAttendanceProfileIds(myProfile, profiles, csrComposition) : null),
    [myProfile, profiles, csrComposition]
  );

  const [search, setSearch] = useState("");
  const [previewing, setPreviewing] = useState<{ url: string; title: string } | null>(null);
  const [subView, setSubView] = useState<"timeCorrection" | "slUl" | "ticketDispute">("timeCorrection");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [signingCorrectionHr, setSigningCorrectionHr] = useState<TimecardCorrectionRow | null>(null);
  const [signingTicketHr, setSigningTicketHr] = useState<EmployeeRequestRow | null>(null);
  const [signingPtoHr, setSigningPtoHr] = useState<PtoRequestRow | null>(null);

  const handleRegenerate = async (c: TimecardCorrectionRow) => {
    if (!companyId) return;
    setRegeneratingId(c.id);
    try {
      const employeeInfo = employeeInfoFor(c, profiles);
      const { pdfUrl } = await regenerateCorrectionPdf({ correction: c, companyId, employeeInfo });
      await updateCorrectionPdfUrl(c.id, pdfUrl);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to regenerate PDF.");
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleRegenerateTicketDispute = async (r: EmployeeRequestRow) => {
    if (!companyId) return;
    setRegeneratingId(r.id);
    try {
      const employeeInfo = await resolveTicketDisputeEmployeeInfo(r, profiles);
      const { pdfUrl } = await regenerateTicketDisputePdf({ request: r, companyId, employeeInfo });
      await updateEmployeeRequestPdfUrl(r.id, pdfUrl);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to regenerate PDF.");
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleRegeneratePto = async (r: PtoRequestRow) => {
    if (!companyId) return;
    setRegeneratingId(r.id);
    try {
      const employeeInfo = employeeInfoForPto(r, profiles);
      const { pdfUrl } = await regeneratePtoExceptionReportPdf({ request: r, companyId, employeeInfo });
      await updatePtoPdfUrl(r.id, pdfUrl);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to regenerate PDF.");
    } finally {
      setRegeneratingId(null);
    }
  };

  const reports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return corrections
      .filter((c) => c.pdfUrl !== null)
      .filter((c) => teamScopedIds === null || teamScopedIds.has(c.profileId) || c.managerId === myProfileId)
      .filter((c) => !q || profileName(c.profileId).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [corrections, search, teamScopedIds, myProfileId, profiles]);

  const ticketReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ticketDisputes
      .filter((r) => r.pdfUrl !== null)
      .filter((r) => teamScopedIds === null || teamScopedIds.has(r.profileId))
      .filter((r) => !q || profileName(r.profileId).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ticketDisputes, search, teamScopedIds, profiles]);

  const slUlReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ptoRequests
      .filter((r) => r.exceptionType !== null && r.pdfUrl !== null)
      .filter((r) => teamScopedIds === null || teamScopedIds.has(r.profileId) || r.managerId === myProfileId)
      .filter((r) => !q || profileName(r.profileId).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ptoRequests, search, teamScopedIds, myProfileId, profiles]);

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
        <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-white mb-1">Exception Reports</h2>
            <p className="text-xs text-slate-500">
              {subView === "timeCorrection"
                ? "Every Exception Report PDF generated from a Time Correction Request submission — download the latest signed version here."
                : subView === "ticketDispute"
                ? "Every Exception Report PDF generated from a Ticket Time Dispute submission — download the latest signed version here."
                : "Every Exception Report PDF generated from a Sick Leave or Unpaid Leave Request submission — download the latest signed version here."}
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setSubView("timeCorrection")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${subView === "timeCorrection" ? "bg-primary/20 text-primary" : "bg-slate-800/50 text-slate-400 hover:text-white"}`}
            >
              Time Correction
            </button>
            <button
              type="button"
              onClick={() => setSubView("slUl")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${subView === "slUl" ? "bg-primary/20 text-primary" : "bg-slate-800/50 text-slate-400 hover:text-white"}`}
            >
              SL-UL
            </button>
            <button
              type="button"
              onClick={() => setSubView("ticketDispute")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${subView === "ticketDispute" ? "bg-primary/20 text-primary" : "bg-slate-800/50 text-slate-400 hover:text-white"}`}
            >
              Ticket Dispute
            </button>
          </div>
        </div>
        <div className="mb-4 mt-3">
          <label className="block text-xs text-slate-400 uppercase mb-2">Search Employee</label>
          <input
            type="text"
            placeholder="Enter employee name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
          />
        </div>
        {subView === "timeCorrection" ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Work Date</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Exception Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Paperwork Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No exception report PDFs yet.</td></tr>
            ) : reports.map((c) => {
              const mgrBadge = managerBadge(c);
              const hrStatusBadge = hrBadge(c);
              return (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      title="Preview PDF"
                      onClick={() => setPreviewing({ url: c.pdfUrl!, title: `Exception Report - ${profileName(c.profileId)} - ${c.workDate}` })}
                      className="text-blue-400 hover:text-blue-300 hover:underline font-medium text-left"
                    >
                      {profileName(c.profileId)}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{c.workDate}</td>
                  <td className="px-3 py-3 text-slate-300">{c.exceptionType ? EXCEPTION_TYPE_LABELS[c.exceptionType] : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border w-fit ${mgrBadge.className}`}>{mgrBadge.label}</span>
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border w-fit ${hrStatusBadge.className}`}>{hrStatusBadge.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => downloadSignableDocumentPdf(c.pdfUrl!, `Exception Report - ${profileName(c.profileId)} - ${c.workDate}.pdf`)}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                      >
                        <Download className="h-3 w-3" /> Download
                      </button>
                      <button
                        type="button"
                        title="Re-render the PDF from the signatures already on file — no new signature needed"
                        onClick={() => handleRegenerate(c)}
                        disabled={regeneratingId === c.id}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                      >
                        {regeneratingId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Regenerate
                      </button>
                      {isFullRequestsAdmin && c.hrPaperworkStatus === "pending" && c.managerSignatureUrl && (
                        <button
                          type="button"
                          onClick={() => setSigningCorrectionHr(c)}
                          className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition"
                        >
                          Sign HR
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        ) : subView === "ticketDispute" ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Ticket #</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Exception Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Paperwork Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : ticketReports.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No exception report PDFs yet.</td></tr>
            ) : ticketReports.map((r) => {
              const mgrBadge = managerBadge(r);
              const hrStatusBadge = hrBadge(r);
              const submittedDate = r.createdAt.slice(0, 10);
              return (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      title="Preview PDF"
                      onClick={() => setPreviewing({ url: r.pdfUrl!, title: `Exception Report - ${profileName(r.profileId)} - ${submittedDate}` })}
                      className="text-blue-400 hover:text-blue-300 hover:underline font-medium text-left"
                    >
                      {profileName(r.profileId)}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{r.ticketNo || "—"}</td>
                  <td className="px-3 py-3 text-slate-300">{r.exceptionType ? TICKET_DISPUTE_EXCEPTION_TYPE_LABELS[r.exceptionType] : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border w-fit ${mgrBadge.className}`}>{mgrBadge.label}</span>
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border w-fit ${hrStatusBadge.className}`}>{hrStatusBadge.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => downloadSignableDocumentPdf(r.pdfUrl!, `Exception Report - ${profileName(r.profileId)} - ${submittedDate}.pdf`)}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                      >
                        <Download className="h-3 w-3" /> Download
                      </button>
                      <button
                        type="button"
                        title="Re-render the PDF from the signatures already on file — no new signature needed"
                        onClick={() => handleRegenerateTicketDispute(r)}
                        disabled={regeneratingId === r.id}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                      >
                        {regeneratingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Regenerate
                      </button>
                      {isFullRequestsAdmin && r.hrPaperworkStatus === "pending" && r.managerSignatureUrl && (
                        <button
                          type="button"
                          onClick={() => setSigningTicketHr(r)}
                          className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition"
                        >
                          Sign HR
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Dates</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Exception Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Paperwork Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : slUlReports.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No exception report PDFs yet.</td></tr>
            ) : slUlReports.map((r) => {
              const mgrBadge = managerBadge(r);
              const hrStatusBadge = hrBadge(r);
              const submittedDate = r.createdAt.slice(0, 10);
              return (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      title="Preview PDF"
                      onClick={() => setPreviewing({ url: r.pdfUrl!, title: `Exception Report - ${profileName(r.profileId)} - ${submittedDate}` })}
                      className="text-blue-400 hover:text-blue-300 hover:underline font-medium text-left"
                    >
                      {profileName(r.profileId)}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{PTO_LEAVE_TYPE_LABELS[r.ptoType] || r.ptoType}</td>
                  <td className="px-3 py-3 text-slate-300">{r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`}</td>
                  <td className="px-3 py-3 text-slate-300">{r.exceptionType ? EXCEPTION_TYPE_LABELS[r.exceptionType] : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border w-fit ${mgrBadge.className}`}>{mgrBadge.label}</span>
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border w-fit ${hrStatusBadge.className}`}>{hrStatusBadge.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => downloadSignableDocumentPdf(r.pdfUrl!, `Exception Report - ${profileName(r.profileId)} - ${submittedDate}.pdf`)}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                      >
                        <Download className="h-3 w-3" /> Download
                      </button>
                      <button
                        type="button"
                        title="Re-render the PDF from the signatures already on file — no new signature needed"
                        onClick={() => handleRegeneratePto(r)}
                        disabled={regeneratingId === r.id}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                      >
                        {regeneratingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Regenerate
                      </button>
                      {isFullRequestsAdmin && r.hrPaperworkStatus === "pending" && r.managerSignatureUrl && (
                        <button
                          type="button"
                          onClick={() => setSigningPtoHr(r)}
                          className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition"
                        >
                          Sign HR
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      {previewing && (
        <AttachmentPreviewModal
          url={previewing.url}
          title={previewing.title}
          onClose={() => setPreviewing(null)}
        />
      )}

      {signingCorrectionHr && (
        <CorrectionHrSignModal
          correction={signingCorrectionHr}
          companyId={companyId}
          profiles={profiles}
          reviewerId={myProfileId}
          reviewerName={displayName || "HR"}
          onClose={() => setSigningCorrectionHr(null)}
          onSigned={async () => {
            setSigningCorrectionHr(null);
            await load();
          }}
        />
      )}
      {signingTicketHr && (
        <TicketDisputeHrSignModal
          request={signingTicketHr}
          companyId={companyId}
          profiles={profiles}
          reviewerId={myProfileId}
          reviewerName={displayName || "HR"}
          onClose={() => setSigningTicketHr(null)}
          onSigned={async () => {
            setSigningTicketHr(null);
            await load();
          }}
        />
      )}
      {signingPtoHr && (
        <PtoHrSignModal
          request={signingPtoHr}
          companyId={companyId}
          profiles={profiles}
          reviewerId={myProfileId}
          reviewerName={displayName || "HR"}
          onClose={() => setSigningPtoHr(null)}
          onSigned={async () => {
            setSigningPtoHr(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
