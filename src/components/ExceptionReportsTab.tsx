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
import { CorrectionOverallBadge } from "@/components/CorrectionStageBadges";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, ImagePlus, Loader2, Paperclip, RefreshCw, XCircle } from "lucide-react";
import { TIME_ZONES, type ScheduleTimezone } from "@/lib/serverTime";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { getCompanyTimecardCorrections, updateCorrectionPdfUrl, rejectCorrectionAsHr, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { getCompanyEmployeeRequests, updateEmployeeRequestPdfUrl, updateEmployeeRequestStatus, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { getCompanyPtoRequests, updatePtoPdfUrl, reviewPtoStage, uploadPtoAttachment, type PtoRequestRow } from "@/lib/supabase/pto";
import { createNotification } from "@/lib/supabase/notifications";
import { EXCEPTION_TYPE_LABELS, correctionIssueLabel, correctionIssueKey, correctionIssueOptions } from "@/lib/exceptionVisitReportTemplate";
import { TICKET_DISPUTE_EXCEPTION_TYPE_LABELS } from "@/lib/ticketDisputeReportTemplate";
import { downloadSignableDocumentPdf } from "@/lib/downloadSignableDocumentPdf";
import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";
import { employeeInfoFor, CorrectionHrSignModal } from "@/components/CorrectionSignModals";
import { regenerateCorrectionPdf } from "@/lib/timecardCorrectionPdf";
import { resolveEmployeeInfo as resolveTicketDisputeEmployeeInfo, TicketDisputeHrSignModal } from "@/components/TicketDisputeSignModals";
import { regenerateTicketDisputePdf } from "@/lib/ticketDisputeReportPdf";
import { employeeInfoForPto, PtoHrSignModal } from "@/components/PtoSignModals";
import { regeneratePtoExceptionReportPdf } from "@/lib/ptoExceptionReportPdf";
import { normalizeRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { ActualTime, RequestedTime } from "@/components/CorrectionRequestedTime";

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

/** `hrWaitsForManager` false for Time Corrections — HR signs in any order there. */
function hrBadge(c: ExceptionReportLike, hrWaitsForManager = true): { label: string; className: string } {
  if (c.hrPaperworkStatus === "approved") return { label: "HR: Approved", className: "bg-green-500/20 text-green-300 border-green-500/30" };
  if (c.hrPaperworkStatus === "additional_review_required") return { label: "HR: Additional Review Required", className: "bg-red-500/20 text-red-300 border-red-500/30" };
  // HR can't act until the manager has signed (see CorrectionSignModals.tsx/TicketDisputeSignModals.tsx) — reflect that in the label rather than a bare "Pending".
  return {
    label: c.managerSignatureUrl || !hrWaitsForManager ? "HR: Pending" : "HR: Awaiting Manager First",
    className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  };
}

/**
 * Paperwork Status cell — same look as Attendance Monitoring's corrections:
 * a bold Approved / Rejected pill once decided, and on a rejected request the
 * signatures nobody needs anymore are greyed "Not needed" instead of yellow
 * "Pending". An approved request keeps its signature badges (HR may still sign).
 */
type PaperworkBadge = { label: string; className: string; /** The approval step behind it, when known — "pending" once decided means it wasn't needed. */ stage?: string };

/** Accounting step (Time Corrections and leave) — approves with a click, no signature. */
function accountingBadge(status: string): PaperworkBadge {
  if (status === "approved") return { label: "Accounting: Approved", className: "bg-green-500/20 text-green-300 border-green-500/30", stage: status };
  if (status === "rejected") return { label: "Accounting: Rejected", className: "bg-red-500/20 text-red-300 border-red-500/30", stage: status };
  return { label: "Accounting: Pending", className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30", stage: status };
}

/** YYYY-MM-DD in local time — same format as Work Date. */
const isoDay = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function PaperworkStatus({ status, badges }: { status: string; badges: PaperworkBadge[] }) {
  const overall = status === "denied" ? "rejected" : status;
  const rejected = overall === "rejected";
  const approved = overall === "approved";
  return (
    <div className="flex flex-col items-start gap-1">
      {(overall === "approved" || rejected) && <CorrectionOverallBadge status={overall as "approved" | "rejected"} />}
      {badges.map((b) => {
        // Not needed: anything still open on a rejected request, or a step that never voted on an approved one (any 2 of 3 decide it).
        const notNeeded = (rejected && /Pending|Awaiting/.test(b.label)) || (approved && b.stage === "pending");
        return (
          <span
            key={b.label}
            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border w-fit ${notNeeded ? "bg-slate-500/10 text-slate-500 border-slate-500/20" : b.className}`}
            title={notNeeded ? (rejected ? "Not needed — the request was rejected" : "Not needed — already approved by the other two steps") : undefined}
          >
            {notNeeded ? `${b.label.split(":")[0]}: Not needed` : b.label}
          </span>
        );
      })}
    </div>
  );
}

/** "Finalize" — HR marked the paperwork "Additional Review Required"; this is the final HR sign-off (Approved), or use Reject. */
function ReviewAgainButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Additional review done — finalize HR's sign-off"
      className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1 whitespace-nowrap"
    >
      <CheckCircle2 className="h-3 w-3" /> Finalize
    </button>
  );
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
  // Ticket Dispute "Claimed Time" — shown in the technician's own time zone, same as Ticket Time Disputes.
  const disputeTz = (id: string): ScheduleTimezone => (profileById.get(id)?.schedule_timezone as ScheduleTimezone) || "CST";
  const fmtClaimed = (iso: string | null, tz: ScheduleTimezone) =>
    iso ? new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONES[tz].timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "?";
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
  // True when the open HR sign modal was opened from "Finalize" (second review).
  const [finalizing, setFinalizing] = useState(false);

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

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const handleRejectCorrection = async (c: TimecardCorrectionRow) => {
    const name = profileName(c.profileId);
    const message =
      c.status === "approved"
        ? `Reject ${name}'s time correction for ${c.workDate}?\n\nIt was already approved, so their timecard will be put back to the actual times (${c.originalCheckIn || "—"} → ${c.originalCheckOut || "—"}). ${name} will be notified.`
        : `Reject ${name}'s time correction for ${c.workDate}? ${name} will be notified.`;
    if (!confirm(message)) return;
    setRejectingId(c.id);
    try {
      await rejectCorrectionAsHr(c, myProfileId || "", displayName || "HR");
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "HR",
        action: "timecard_correction_rejected",
        targetType: "timecard_correction",
        targetId: c.id,
        targetLabel: `${name} (${c.workDate})`,
        details: { stage: "hr", source: "exception-reports", wasApproved: c.status === "approved" },
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reject the correction.");
    } finally {
      setRejectingId(null);
    }
  };

  // HR "Add Photo" on an SL-UL row — one hidden file input, pointed at whichever row was clicked.
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [proofTarget, setProofTarget] = useState<PtoRequestRow | null>(null);
  const [uploadingProofId, setUploadingProofId] = useState<string | null>(null);
  const pickProof = (r: PtoRequestRow) => {
    setProofTarget(r);
    proofInputRef.current?.click();
  };
  const handleProofChosen = async (file: File | undefined) => {
    const r = proofTarget;
    if (proofInputRef.current) proofInputRef.current.value = "";
    if (!file || !r || !companyId) return;
    setUploadingProofId(r.id);
    try {
      await uploadPtoAttachment(r.id, companyId, file, myProfileId);
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "HR",
        action: "pto_attachment_added",
        targetType: "pto_request",
        targetId: r.id,
        targetLabel: `${profileName(r.profileId)} (${r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`})`,
        details: { source: "exception-reports" },
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't upload the photo.");
    } finally {
      setUploadingProofId(null);
      setProofTarget(null);
    }
  };

  const handleRejectPto = async (r: PtoRequestRow) => {
    const name = profileName(r.profileId);
    const dates = r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`;
    if (!confirm(`Reject ${name}'s ${PTO_LEAVE_TYPE_LABELS[r.ptoType] || "leave"} request for ${dates}? ${name} will be notified.`)) return;
    setRejectingId(r.id);
    try {
      await reviewPtoStage(r, "hr", "rejected", myProfileId || "", displayName || "HR");
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "HR",
        action: "pto_request_rejected",
        targetType: "pto_request",
        targetId: r.id,
        targetLabel: `${name} (${dates})`,
        details: { stage: "hr", source: "exception-reports", wasApproved: r.status === "approved" },
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reject the request.");
    } finally {
      setRejectingId(null);
    }
  };

  const handleRejectTicketDispute = async (r: EmployeeRequestRow) => {
    const name = profileName(r.profileId);
    const ticket = r.ticketNo || "this ticket";
    const message =
      r.status === "approved"
        ? `Reject ${name}'s ticket dispute for ${ticket}?\n\nIt was already approved, and the claimed times were written onto the ticket's on-site check-in. Those ticket times will NOT be changed back automatically — fix them on the ticket if needed. ${name} will be notified.`
        : `Reject ${name}'s ticket dispute for ${ticket}? ${name} will be notified.`;
    if (!confirm(message)) return;
    setRejectingId(r.id);
    try {
      // Asks for the reason and notifies the employee (with it) — see updateEmployeeRequestStatus.
      await updateEmployeeRequestStatus(r.id, "rejected", myProfileId, undefined, displayName || "HR");
      void logModuleActivity({
        module: "attendance-monitoring",
        actorName: displayName || "HR",
        action: "ticket_time_dispute_rejected",
        targetType: "employee_request",
        targetId: r.id,
        targetLabel: `${name} (${ticket})`,
        details: { source: "exception-reports", wasApproved: r.status === "approved" },
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reject the dispute.");
    } finally {
      setRejectingId(null);
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

  // Staff group, same rules the rest of the app uses: PH = assigned branch
  // "Philippines" (payroll/attendance grace use this exact check), then the
  // technician side — any role in the Technician department (Technician,
  // Tech Manager, Branch Manager, Senior Branch Manager, Technical Director,
  // Technical Assistant Director) or a Technician tier — and every other US
  // employee (Parts) is US Staff.
  type StaffGroup = "all" | "ph" | "us" | "tech";
  const [staffGroup, setStaffGroup] = useState<StaffGroup>("all");
  const groupOf = (profileId: string): Exclude<StaffGroup, "all"> => {
    const p = profileById.get(profileId);
    if (p?.assigned_branch === "Philippines") return "ph";
    if (getRoleDepartmentBreakdown(p?.role).department === "Technician" || normalizeRole(p?.role).startsWith("TECHNICIAN")) return "tech";
    return "us";
  };
  const inGroup = (profileId: string) => staffGroup === "all" || groupOf(profileId) === staffGroup;

  // Everything visible to this viewer that matches the search — before the
  // staff-group filter, so the group buttons can show a count for each.
  const allReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return corrections
      .filter((c) => c.pdfUrl !== null)
      .filter((c) => teamScopedIds === null || teamScopedIds.has(c.profileId) || c.managerId === myProfileId)
      .filter((c) => !q || profileName(c.profileId).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [corrections, search, teamScopedIds, myProfileId, profiles]);

  const allTicketReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ticketDisputes
      .filter((r) => r.pdfUrl !== null)
      .filter((r) => teamScopedIds === null || teamScopedIds.has(r.profileId))
      .filter((r) => !q || profileName(r.profileId).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ticketDisputes, search, teamScopedIds, profiles]);

  const allSlUlReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ptoRequests
      .filter((r) => r.exceptionType !== null && r.pdfUrl !== null)
      .filter((r) => teamScopedIds === null || teamScopedIds.has(r.profileId) || r.managerId === myProfileId)
      .filter((r) => !q || profileName(r.profileId).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ptoRequests, search, teamScopedIds, myProfileId, profiles]);

  // Work Date column sort (Time Correction view) — newest first by default.
  const [workDateSort, setWorkDateSort] = useState<"desc" | "asc">("desc");
  const [issueFilter, setIssueFilter] = useState<string>("all");
  // Status mini-tabs (upper right). PTO's "denied" counts as Rejected.
  const [statusTab, setStatusTab] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const statusOf = (st: string) => (st === "denied" ? "rejected" : st);
  const inStatus = (st: string) => statusTab === "all" || statusOf(st) === statusTab;
  const reports = [...allReports.filter((c) => inGroup(c.profileId) && (issueFilter === "all" || correctionIssueKey(c.exceptionType) === issueFilter) && inStatus(c.status))].sort((a, b) => {
      const d = a.workDate.localeCompare(b.workDate) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return workDateSort === "desc" ? -d : d;
    });
  const ticketReports = allTicketReports.filter((r) => inGroup(r.profileId) && inStatus(r.status));
  const slUlReports = allSlUlReports.filter((r) => inGroup(r.profileId) && inStatus(r.status));
  // Counts for the status tabs — current view and staff group, before the status filter.
  const statusBase: { status: string; profileId: string }[] = (subView === "timeCorrection" ? allReports : subView === "ticketDispute" ? allTicketReports : allSlUlReports).filter((r) => inGroup(r.profileId));
  const statusCounts = { all: statusBase.length, pending: 0, approved: 0, rejected: 0 } as Record<string, number>;
  for (const r of statusBase) statusCounts[statusOf(r.status)] = (statusCounts[statusOf(r.status)] ?? 0) + 1;

  const currentBase: { profileId: string }[] =
    subView === "timeCorrection" ? allReports : subView === "ticketDispute" ? allTicketReports : allSlUlReports;
  const groupCounts = { all: currentBase.length, ph: 0, us: 0, tech: 0 };
  for (const r of currentBase) groupCounts[groupOf(r.profileId)]++;

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
        <div className="flex justify-end mt-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/40 p-0.5" role="tablist" aria-label="Status">
            {([
              ["all", "All", "text-slate-200"],
              ["pending", "Pending", "text-yellow-300"],
              ["approved", "Approved", "text-green-300"],
              ["rejected", "Rejected", "text-red-300"],
            ] as const).map(([key, label, tone]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={statusTab === key}
                onClick={() => setStatusTab(key)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition inline-flex items-center gap-1.5 ${statusTab === key ? `bg-white/10 ${tone}` : "text-slate-400 hover:text-white"}`}
              >
                {label}
                <span className="rounded-full bg-black/25 px-1.5 text-[10px] tabular-nums">{statusCounts[key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4 mt-3 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Search Employee</label>
            <input
              type="text"
              placeholder="Enter employee name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-w-[16rem] max-w-xs bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
            />
          </div>
          <div>
            <span className="block text-xs text-slate-400 uppercase mb-2">Staff Group</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Staff group">
              {([
                ["all", "All"],
                ["ph", "PH"],
                ["us", "US Staff (Parts)"],
                ["tech", "Technicians"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={staffGroup === key}
                  onClick={() => setStaffGroup(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                    staffGroup === key ? "bg-primary/20 text-primary" : "bg-slate-800/50 text-slate-400 hover:text-white"
                  }`}
                >
                  {label}
                  <span className="rounded-full bg-black/20 px-1.5 text-[10px] tabular-nums">{groupCounts[key]}</span>
                </button>
              ))}
            </div>
          </div>
          {subView === "timeCorrection" && (
            <div>
              <span className="block text-xs text-slate-400 uppercase mb-2">Issue</span>
              <select
                value={issueFilter}
                onChange={(e) => setIssueFilter(e.target.value)}
                className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Issues</option>
                {correctionIssueOptions(allReports).map((o) => (
                  <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {subView === "timeCorrection" ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">
                <button
                  type="button"
                  onClick={() => setWorkDateSort((d) => (d === "desc" ? "asc" : "desc"))}
                  title={workDateSort === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
                  className="inline-flex items-center gap-1 uppercase hover:text-white"
                >
                  Work Date <span className="text-[10px]">{workDateSort === "desc" ? "▼" : "▲"}</span>
                </button>
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actual Time</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Requested Time</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Issue</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Paperwork Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No exception report PDFs yet.</td></tr>
            ) : reports.map((c) => {
              const mgrBadge = managerBadge(c);
              const hrStatusBadge = hrBadge(c, false);
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
                  <td className="px-3 py-3 text-slate-300">{isoDay(c.createdAt)}</td>
                  <td className="px-3 py-3 text-slate-300">{c.workDate}</td>
                  <td className="px-3 py-3 text-slate-300"><ActualTime c={c} /></td>
                  <td className="px-3 py-3 text-amber-200"><RequestedTime c={c} /></td>
                  <td className="px-3 py-3 text-slate-300">{correctionIssueLabel(c.exceptionType, c.otherDescription)}</td>
                  <td className="px-3 py-3">
                    <PaperworkStatus status={c.status} badges={[{ ...mgrBadge, stage: c.managerStatus }, { ...hrStatusBadge, stage: c.hrStatus }, accountingBadge(c.accountingStatus)]} />
                  </td>
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
                      {isFullRequestsAdmin && c.hrPaperworkStatus === "pending" && (
                        <button
                          type="button"
                          onClick={() => { setFinalizing(false); setSigningCorrectionHr(c); }}
                          className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition"
                        >
                          Sign HR
                        </button>
                      )}
                      {isFullRequestsAdmin && c.hrPaperworkStatus === "additional_review_required" && c.status !== "rejected" && (
                        <ReviewAgainButton onClick={() => { setFinalizing(true); setSigningCorrectionHr(c); }} />
                      )}
                      {isFullRequestsAdmin && c.status !== "rejected" && (
                        <button
                          type="button"
                          title="Reject this correction as HR"
                          onClick={() => handleRejectCorrection(c)}
                          disabled={rejectingId === c.id}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                        >
                          {rejectingId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Reject
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
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Ticket #</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Dispute Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Exception Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Claimed Time</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Reason</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Photos</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Paperwork Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : ticketReports.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No exception report PDFs yet.</td></tr>
            ) : ticketReports.map((r) => {
              const mgrBadge = managerBadge(r);
              const hrStatusBadge = hrBadge(r, false);
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
                  <td className="px-3 py-3 text-slate-300">{isoDay(r.createdAt)}</td>
                  <td className="px-3 py-3 text-slate-300">{r.ticketNo || "—"}</td>
                  <td className="px-3 py-3">
                    {r.disputeMode === "reschedule" ? (
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold border bg-blue-500/20 text-blue-300 border-blue-500/40">Reschedule</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold border bg-amber-500/20 text-amber-300 border-amber-500/40">Time Dispute</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{r.exceptionType ? TICKET_DISPUTE_EXCEPTION_TYPE_LABELS[r.exceptionType] : "—"}</td>
                  <td className="px-3 py-3 text-slate-200 whitespace-nowrap">
                    {r.disputeMode === "reschedule" && (r.rescheduleActualDay || r.rescheduleDate) ? (
                      <span className="text-blue-200">{r.rescheduleActualDay || "—"} → {r.rescheduleDate || "—"}</span>
                    ) : r.disputedStartTime || r.disputedEndTime ? (
                      <>
                        {fmtClaimed(r.disputedStartTime, disputeTz(r.profileId))} – {fmtClaimed(r.disputedEndTime, disputeTz(r.profileId))}{" "}
                        <span className="text-slate-500 text-[11px]">{disputeTz(r.profileId)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-300 max-w-[240px]">
                    <span className="line-clamp-2" title={r.details}>{r.details || "—"}</span>
                  </td>
                  <td className="px-3 py-3">
                    {r.attachments.length === 0 ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.attachments.map((a) => (
                          <button
                            key={a.url}
                            type="button"
                            onClick={() => setPreviewing({ url: a.url, title: `${profileName(r.profileId)} — ${r.ticketNo || "photo"}` })}
                            title={a.name}
                            className="block h-10 w-10 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
                          >
                            {/\.pdf(\?|$)/i.test(a.url) ? (
                              <span className="flex h-full w-full items-center justify-center text-slate-400"><Paperclip className="h-4 w-4" /></span>
                            ) : (
                              <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <PaperworkStatus status={r.status} badges={[mgrBadge, hrStatusBadge]} />
                  </td>
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
                      {isFullRequestsAdmin && r.hrPaperworkStatus === "pending" && (
                        <button
                          type="button"
                          onClick={() => { setFinalizing(false); setSigningTicketHr(r); }}
                          className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition"
                        >
                          Sign HR
                        </button>
                      )}
                      {isFullRequestsAdmin && r.hrPaperworkStatus === "additional_review_required" && r.status !== "rejected" && (
                        <ReviewAgainButton onClick={() => { setFinalizing(true); setSigningTicketHr(r); }} />
                      )}
                      {isFullRequestsAdmin && r.status !== "rejected" && (
                        <button
                          type="button"
                          title="Reject this ticket dispute as HR"
                          onClick={() => handleRejectTicketDispute(r)}
                          disabled={rejectingId === r.id}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                        >
                          {rejectingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Reject
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
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Dates</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Exception Type</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Photos</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Paperwork Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : slUlReports.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No exception report PDFs yet.</td></tr>
            ) : slUlReports.map((r) => {
              const mgrBadge = managerBadge(r);
              const hrStatusBadge = hrBadge(r, false);
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
                  <td className="px-3 py-3 text-slate-300">{isoDay(r.createdAt)}</td>
                  <td className="px-3 py-3 text-slate-300">{PTO_LEAVE_TYPE_LABELS[r.ptoType] || r.ptoType}</td>
                  <td className="px-3 py-3 text-slate-300">{r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`}</td>
                  <td className="px-3 py-3 text-slate-300">{r.exceptionType ? EXCEPTION_TYPE_LABELS[r.exceptionType] : "—"}</td>
                  <td className="px-3 py-3">
                    {r.attachmentPath ? (
                      <button
                        type="button"
                        onClick={() => setPreviewing({ url: r.attachmentPath!, title: `${profileName(r.profileId)} — proof (${r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`})` })}
                        title="View proof"
                        className="block h-10 w-10 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
                      >
                        {/\.pdf(\?|$)/i.test(r.attachmentPath) ? (
                          <span className="flex h-full w-full items-center justify-center text-slate-400"><Paperclip className="h-4 w-4" /></span>
                        ) : (
                          <img src={r.attachmentPath} alt="Proof" className="h-full w-full object-cover" />
                        )}
                      </button>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <PaperworkStatus status={r.status} badges={[{ ...mgrBadge, stage: r.managerStatus }, { ...hrStatusBadge, stage: r.hrStatus }, accountingBadge(r.accountingStatus)]} />
                  </td>
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
                      {isFullRequestsAdmin && r.hrPaperworkStatus === "pending" && (
                        <button
                          type="button"
                          onClick={() => { setFinalizing(false); setSigningPtoHr(r); }}
                          className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition"
                        >
                          Sign HR
                        </button>
                      )}
                      {isFullRequestsAdmin && r.hrPaperworkStatus === "additional_review_required" && r.status !== "denied" && r.status !== "cancelled" && (
                        <ReviewAgainButton onClick={() => { setFinalizing(true); setSigningPtoHr(r); }} />
                      )}
                      {isFullRequestsAdmin && !r.attachmentPath && (
                        <button
                          type="button"
                          title="Add a proof photo or PDF"
                          onClick={() => pickProof(r)}
                          disabled={uploadingProofId === r.id}
                          className="px-2 py-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          {uploadingProofId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                          Add Photo
                        </button>
                      )}
                      {isFullRequestsAdmin && r.status !== "denied" && r.status !== "cancelled" && (
                        <button
                          type="button"
                          title="Reject this leave request as HR"
                          onClick={() => handleRejectPto(r)}
                          disabled={rejectingId === r.id}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition inline-flex items-center gap-1"
                        >
                          {rejectingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Reject
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

      <input
        ref={proofInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => void handleProofChosen(e.target.files?.[0])}
      />

      {previewing && (
        <AttachmentPreviewModal
          url={previewing.url}
          title={previewing.title}
          onClose={() => setPreviewing(null)}
        />
      )}

      {signingCorrectionHr && (
        <CorrectionHrSignModal
          finalize={finalizing}
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
          finalize={finalizing}
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
          finalize={finalizing}
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
