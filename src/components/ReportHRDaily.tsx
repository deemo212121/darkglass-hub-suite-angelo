import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronDown, ChevronRight, Plus, Trash2, AlertTriangle, CheckCircle, XCircle, Paperclip, Users, Clock, UserCheck, UserX, UserMinus, Search, Bell, Download, Forward, History, FileText, ClipboardList, Landmark } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { normalizeRole, ROLE_LABELS, isJotformHrRole } from "@/lib/roleLabels";
import { getCompanyUsers, getProfileEmployeeInfo, getEmployeeInfoByProfileIds, saveProfileEmployeeInfo, updateCompanyUser, getMyRoles, getMyProfileId, type EmployeeInfo } from "@/lib/supabase/users";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { subscribeNotifications, markNotificationRead, deleteNotification, type AppNotification } from "@/lib/firebase/notifications";
import {
  addCandidate,
  deleteCandidate,
  getCandidateCvUrl,
  getCandidateCvUrlForForwarding,
  getCandidates,
  updateCandidateStatus,
  uploadCandidateCv,
  getEodHiringReport,
  getEomHiringReport,
  setStaffingTarget,
  logCvForward,
  type Candidate,
  type CandidateStatus,
  type EodHiringRow,
  type CvForwardDetail,
} from "@/lib/supabase/hrCandidates";
import { getAllAgentNotes, getPendingAgentNotes, reviewAgentNote, addAgentNote, deleteAgentNote, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { parseBranchAccess } from "@/lib/locations";
import { OnboardingApplicantDocuments } from "./OnboardingApplicantDocuments";
import { getOnboardingDocumentCategoriesByProfileIds } from "@/lib/supabase/onboardingDocuments";
import { uploadCoeCertificate, uploadWarningForm, uploadW8benForm, uploadW4Form } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl as loadImageDataUrl } from "@/lib/pdfCapture";
import {
  createSignableDocument,
  getSignableDocuments,
  confirmSignableDocument,
  cancelSignableDocument,
  deleteSignableDocument,
  reassignSignableDocument,
  updateSignableDocumentPdfUrl,
  type SignableDocument,
} from "@/lib/supabase/signableDocuments";
import { buildWarningFormBodyMarkup, warningFormStyles, type WarningFormData, type SignatureSlot } from "@/lib/warningFormTemplate";
import type { W8benFormData, W8benAddress } from "@/lib/w8benFormTemplate";
import { fillW8benPdf } from "@/lib/w8benPdfFill";
import type { W4FormData } from "@/lib/w4FormTemplate";
import { fillW4Pdf } from "@/lib/w4PdfFill";
import type { W9FormData } from "@/lib/w9FormTemplate";
import { fillW9Pdf } from "@/lib/w9PdfFill";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { subscribeTableChanges } from "@/lib/supabase/realtime";
import { getCompanyPtoRequests, ptoYearWindow, ptoDaysUsed, reviewPtoStage, canReviewPtoStage, type PtoRequestRow, type PtoType, type PtoStage } from "@/lib/supabase/pto";
import { getCompanyTimecardEntries, calcWorkedHours, hoursDiff, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getCompanyTimecardCorrections, approveTimecardCorrection, rejectTimecardCorrection, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { getCompanyEmployeeRequests, updateEmployeeRequestStatus, type EmployeeRequestRow, type EmployeeRequestStatus } from "@/lib/supabase/employeeRequests";
import { getAppUrl } from "@/lib/appUrl";
import { getCompanyCoeBodyTemplate, setCompanyCoeBodyTemplate } from "@/lib/supabase/companySettings";
import { getCompanyCoeDocuments, addCoeDocument, type CoeDocument } from "@/lib/supabase/coeDocuments";
import { getJotformSubmissions, getDeletedJotformSubmissions, updateJotformSubmissionStatus, softDeleteJotformSubmission, restoreJotformSubmission, type JotformSubmission, type JotformSubmissionStatus } from "@/lib/supabase/jotformSubmissions";

// Certificate of Employment's editable body — the prose paragraphs between
// the greeting and the signature block (see companySettings.ts's
// getCompanyCoeBodyTemplate/setCompanyCoeBodyTemplate, migration 0058).
// Placeholders are substituted in at generation time; this default matches
// the original hardcoded text exactly, so nothing changes until an Admin
// edits it. Paragraphs are separated by a blank line.
const COE_BODY_PLACEHOLDERS = ["honorific", "employeeName", "startDate", "jobTitle", "reason", "he", "his"] as const;
// This is the free-flowing letter prose only — Admin-editable via "Edit
// Template" — everything here is plain text/placeholders, no HTML, so
// editing it never means touching markup. The "For Office Use Only" stamp
// that follows it on the actual certificate is NOT part of this template —
// it's a fixed-layout box built directly in buildCoeBodyMarkup from the
// Generate COE form's own office-use fields (Name/Title/Signature/Number),
// matching the reference certificate's 2-column layout exactly; letting an
// Admin freely rearrange that structured stamp via free text isn't
// meaningful the way editing prose paragraphs is.
const DEFAULT_COE_BODY_TEMPLATE = `This is to certify that {{employeeName}} has been employed with US IN HOME SERVICES since {{startDate}}.

{{honorific}} {{employeeName}} is currently employed as a {{jobTitle}}. Throughout {{his}} employment, {{he}} has demonstrated professionalism and has remained a valued employee in good standing with our organization.

This certification is issued upon {{his}} request for {{reason}}.

Should you require any additional information or verification regarding {{his}} employment, please do not hesitate to contact us.`;

const PTO_TYPE_LABEL: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

const ALL_US_BRANCHES = LOCATIONS_DATA.filter(l => !l.isPhilippines).map(l => l.location).sort();
const ALL_PH_BRANCHES = LOCATIONS_DATA.filter(l => l.isPhilippines).map(l => l.location).sort();
const PH_BRANCH_NAMES = new Set(LOCATIONS_DATA.filter(l => l.isPhilippines).map(l => l.location));

// HR/Admin/Superadmin/Manager see every candidate and can finalize hires;
// Branch Managers only see + decide on their own branch's applicants —
// they run the final interview, HR finalizes the hire.
const HR_ADMIN_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN", "MANAGER"]);
const BRANCH_MANAGER_ROLES = new Set(["BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER"]);

const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  selected: "Selected",
  training: "Training",
  on_hold: "On Hold",
  hired: "Hired",
  rejected: "Rejected",
};
const CANDIDATE_STATUS_COLOR: Record<CandidateStatus, string> = {
  applied: "bg-blue-500/20 text-blue-300",
  interviewing: "bg-yellow-500/20 text-yellow-300",
  selected: "bg-purple-500/20 text-purple-300",
  training: "bg-cyan-500/20 text-cyan-300",
  on_hold: "bg-slate-500/20 text-slate-300",
  hired: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
};
// Statuses that require an accompanying date when selected — interview
// date for Interviewing, training start date for Training — see
// hr_update_candidate_status() in 0047_hr_hiring_reports.sql, which is
// what actually persists these dates alongside the status transition.
const STATUS_REQUIRES_DATE: Partial<Record<CandidateStatus, string>> = {
  interviewing: "Interview date",
  training: "Training start date",
};

type EmploymentStatus = "active" | "inactive" | "terminated" | "resigned";

interface Employee {
  id: string;
  name: string;
  email: string;
  position: string; // raw role code
  branch: string;
  department: string;
  country: "US" | "PH";
  birthday: string;
  address: string;
  ssn?: string;
  startDate: string;
  terminationDate?: string;
  terminationReason?: string;
  status: EmploymentStatus;
  onboardingDocs: Record<string, boolean>;
  // Same off-day/required-shift fields Attendance Monitoring already uses
  // (profiles.off_days/required_check_in/required_check_out) — carried
  // through here so the Attendance KPI tile can derive present/absent/short
  // duty without a second profiles query.
  offDays: number[];
  requiredCheckIn: string;
  requiredCheckOut: string;
}

// Onboarding Documents — per-role/country checklist columns (see the
// "Onboarding Documents" tab). Distinct lists because each group's required
// paperwork genuinely differs (e.g. Technicians need a Vehicle Use Agreement,
// Parts Managers need a W4 vs PH's W-8BEN); confirmed against the company's
// existing tracking spreadsheets rather than guessed.
const TECHNICIAN_ONBOARDING_DOCS = [
  "Employee Confirmation Form",
  "Contractor Data Sheet",
  "Direct Deposit Authorization",
  "Contractor Off Days Policy",
  "Vehicle Use Agreement",
  "Technician Questions",
  "Non-Disclosure Agreement",
  "Plus One",
  "Parts Responsibility Acknowledgement",
  "W9",
  "Driver's License",
  "Social Security",
  "CAR IQ",
  "Floor Protection",
  "Subcontractor Agreement",
];
const PARTS_MANAGER_ONBOARDING_DOCS = [
  "Employee Confirmation Form",
  "Employee Data",
  "Direct Deposit Authorization",
  "Employee Off Days Policy",
  "Non-Disclosure Agreement",
  "W4",
  "Driver's License",
  "Social Security",
];
const PH_ONBOARDING_DOCS = [
  "Employee Data",
  "Direct Deposit Authorization",
  "Non-Disclosure Agreement",
  "CSR Duty Agreement",
  "Employee Off Days Agreement",
  "W-8BEN",
];

// Job Title options for the Generate COE tab — every real role in the
// system except the three that aren't actual job titles someone would put
// on an employment certificate (Super Admin, plain "CSR", Dispatcher).
const COE_JOB_TITLE_OPTIONS = Object.entries(ROLE_LABELS)
  .filter(([code]) => !["SUPERADMIN", "CSR", "DISPATCHER"].includes(code))
  .map(([, label]) => label);

const branchesOf = (assignedBranch: string | null, branchAccess: string | null): string[] => {
  const raw = [assignedBranch ?? "", ...parseBranchAccess(branchAccess)];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
};

export function ReportHRDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { role: myRole, ready, uid, displayName, companyId } = useAuth();
  const normalizedMyRole = normalizeRole(myRole);
  const isHrOrAdmin = ready && HR_ADMIN_ROLES.has(normalizedMyRole);
  const isBranchManager = ready && BRANCH_MANAGER_ROLES.has(normalizedMyRole);
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(normalizedMyRole);

  // HR can also be held as a sub-role (extra_roles) rather than the primary
  // role — useAuth().role only carries the primary, so resolve extra_roles
  // separately to decide who can see the Jotform Submissions tab below.
  const [hasHrSubRole, setHasHrSubRole] = useState(false);
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyRoles(uid).then(({ extraRoles }) => {
      if (!cancelled) setHasHrSubRole(extraRoles.some((r) => normalizeRole(r) === "HR"));
    });
    return () => { cancelled = true; };
  }, [ready, uid]);
  // isJotformHrRole (not the broader isHrOrAdmin) so this stays in exact
  // sync with findHrFirebaseUids() in jotformBridge.ts — otherwise this tab
  // is visible to roles the webhook never actually notifies, and it just
  // sits empty forever for them regardless of how many submissions come in.
  const canViewJotformTab = isJotformHrRole(normalizedMyRole) || hasHrSubRole;

  const today = new Date().toISOString().slice(0, 10);

  const [error, setError] = useState<string | null>(null);
  // One section visible at a time — the page used to stack Hiring, Pending
  // Reviews, the Approved log, the department trend chart, and the full
  // Employee Directory all on top of each other, forcing a long scroll to
  // reach anything below Hiring.
  const [activeTab, setActiveTab] = useState<"hiring" | "warnings" | "directory" | "jotform" | "jotformDocuments" | "onboarding" | "hiringReports" | "report" | "coe" | "warningForm" | "employeeRequestManager" | "w8ben">("hiring");
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Persist the current tab (and, for Onboarding Documents, which
  // applicant is open) in the URL, so a plain page refresh comes back to
  // wherever the user actually was instead of resetting to the Hiring tab
  // every time. Restoring reads only the FIRST render's search params
  // (initialHrSearchRef) — after that, this component's own state is the
  // source of truth and pushes into the URL, not the other way around. ──
  const navigate = useNavigate();
  const hrSearchParams = (useSearch({ strict: false }) as { tab?: string; submissionId?: string; profileId?: string }) ?? {};
  const initialHrSearchRef = useRef(hrSearchParams);
  const VALID_HR_TABS = ["hiring", "warnings", "directory", "jotform", "jotformDocuments", "onboarding", "hiringReports", "report", "coe", "warningForm", "employeeRequestManager", "w8ben"] as const;
  useEffect(() => {
    const tab = initialHrSearchRef.current.tab;
    if (tab && (VALID_HR_TABS as readonly string[]).includes(tab)) setActiveTab(tab as typeof activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Jotform Submissions (live) — same Firestore notifications/{uid}/items
  // the bell icon reads (kind: "jotform_submission"), just filtered into its
  // own tab here so HR doesn't have to hunt for form-submission pings mixed
  // in with every other notification type. ──
  const [jotformNotifs, setJotformNotifs] = useState<AppNotification[]>([]);
  useEffect(() => {
    if (!uid || !canViewJotformTab) {
      setJotformNotifs([]);
      return;
    }
    const unsubscribe = subscribeNotifications(uid, (items) => {
      setJotformNotifs(items.filter((n) => n.kind === "jotform_submission"));
    });
    return unsubscribe;
  }, [uid, canViewJotformTab]);
  const unreadJotformCount = jotformNotifs.filter((n) => !n.isRead).length;

  // ── Applicant Documents — the real Jotform-generated PDF per submission
  // (see hr_jotform_submissions / jotformBridge.ts), filterable/sortable
  // unlike the plain notification list above. Replaces the old Jotform
  // Submissions tab; that tab's code/data is left in place, just hidden
  // from the nav (see tabGroups below). ──
  const [jotformSubmissions, setJotformSubmissions] = useState<JotformSubmission[]>([]);
  const [jotformSubmissionsLoading, setJotformSubmissionsLoading] = useState(true);
  const [jotformFormFilter, setJotformFormFilter] = useState("");
  const [jotformStatusFilter, setJotformStatusFilter] = useState<"" | JotformSubmissionStatus>("");
  const [jotformSearch, setJotformSearch] = useState("");
  const [jotformPreview, setJotformPreview] = useState<JotformSubmission | null>(null);
  const [jotformPage, setJotformPage] = useState(1);
  const JOTFORM_PAGE_SIZE = 25;

  const loadJotformSubmissions = async () => {
    if (!canViewJotformTab) return;
    setJotformSubmissionsLoading(true);
    try {
      setJotformSubmissions(await getJotformSubmissions());
    } catch (err) {
      console.error("Failed to load Jotform submissions:", err);
    } finally {
      setJotformSubmissionsLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !canViewJotformTab) return;
    void loadJotformSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, canViewJotformTab]);

  useEffect(() => {
    if (!ready || !companyId || !canViewJotformTab) return;
    return subscribeTableChanges(
      "hr_jotform_submissions",
      () => {
        void loadJotformSubmissions();
        void loadDeletedJotformSubmissions();
      },
      `company_id=eq.${companyId}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, companyId, canViewJotformTab]);

  // A notification's link ("?tab=jotformDocuments&submissionId=...") lands
  // here — jump to the tab and open that exact submission once it's loaded,
  // instead of leaving the user to find it themselves in the list.
  const jotformSearchParams = hrSearchParams;
  useEffect(() => {
    if (!jotformSearchParams.submissionId || jotformSubmissions.length === 0) return;
    const match = jotformSubmissions.find((s) => s.submissionId === jotformSearchParams.submissionId);
    if (match) setJotformPreview(match);
  }, [jotformSearchParams.submissionId, jotformSubmissions]);

  const jotformFormOptions = useMemo(
    () => Array.from(new Set(jotformSubmissions.map((s) => s.formTitle || s.formId))).sort(),
    [jotformSubmissions]
  );
  const filteredJotformSubmissions = useMemo(() => {
    const q = jotformSearch.trim().toLowerCase();
    return jotformSubmissions.filter((s) => {
      if (jotformFormFilter && (s.formTitle || s.formId) !== jotformFormFilter) return false;
      if (jotformStatusFilter && s.status !== jotformStatusFilter) return false;
      if (q && !(s.applicantName ?? "").toLowerCase().includes(q) && !(s.formTitle ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jotformSubmissions, jotformFormFilter, jotformStatusFilter, jotformSearch]);
  const newJotformSubmissionsCount = jotformSubmissions.filter((s) => s.status === "new").length;

  // Reset to page 1 whenever the filters actually narrow the list — otherwise
  // changing a filter while on page 5 could land on an empty page.
  useEffect(() => { setJotformPage(1); }, [jotformFormFilter, jotformStatusFilter, jotformSearch]);
  const jotformPageCount = Math.max(1, Math.ceil(filteredJotformSubmissions.length / JOTFORM_PAGE_SIZE));
  const pagedJotformSubmissions = useMemo(
    () => filteredJotformSubmissions.slice((jotformPage - 1) * JOTFORM_PAGE_SIZE, jotformPage * JOTFORM_PAGE_SIZE),
    [filteredJotformSubmissions, jotformPage]
  );
  // Windowed page numbers (1 … p-1 p p+1 … last) — with thousands of rows
  // possible after the backfill, rendering every page number would mean 80+
  // buttons in a row.
  const jotformPageWindow = useMemo(() => {
    const pages = new Set([1, jotformPageCount, jotformPage - 1, jotformPage, jotformPage + 1]);
    return [...pages].filter((p) => p >= 1 && p <= jotformPageCount).sort((a, b) => a - b);
  }, [jotformPage, jotformPageCount]);

  const handleJotformStatusChange = async (submission: JotformSubmission, status: JotformSubmissionStatus) => {
    if (!uid) return;
    const reviewerId = await getMyProfileId(uid);
    if (!reviewerId) return;
    setJotformSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, status } : s)));
    try {
      await updateJotformSubmissionStatus(submission.id, status, reviewerId);
    } catch (err) {
      console.error("Failed to update submission status:", err);
      void loadJotformSubmissions();
    }
  };

  // ── Deleted Jotforms — "Delete" doesn't remove a submission immediately;
  // it moves to this list (with its document untouched in Storage) for 30
  // days, restorable at any time in that window. ──
  const [deletedJotformSubmissions, setDeletedJotformSubmissions] = useState<JotformSubmission[]>([]);
  const [deletedJotformLoading, setDeletedJotformLoading] = useState(true);

  const loadDeletedJotformSubmissions = async () => {
    if (!canViewJotformTab) return;
    setDeletedJotformLoading(true);
    try {
      setDeletedJotformSubmissions(await getDeletedJotformSubmissions());
    } catch (err) {
      console.error("Failed to load deleted Jotform submissions:", err);
    } finally {
      setDeletedJotformLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !canViewJotformTab) return;
    void loadDeletedJotformSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, canViewJotformTab]);

  const handleDeleteJotformSubmission = async (submission: JotformSubmission) => {
    if (!window.confirm(`Delete "${submission.applicantName || "this"}" submission (${submission.formTitle || submission.formId})? It'll move to Deleted Jotforms, restorable for 30 days.`)) return;
    setJotformSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
    if (jotformPreview?.id === submission.id) setJotformPreview(null);
    try {
      await softDeleteJotformSubmission(submission.id);
      void logActivity({ action: "jotform_submission_deleted", targetType: "employee", targetLabel: submission.applicantName || "Unknown", details: { form: submission.formTitle || submission.formId } });
      void loadDeletedJotformSubmissions();
    } catch (err) {
      console.error("Failed to delete submission:", err);
      void loadJotformSubmissions();
    }
  };

  const handleRestoreJotformSubmission = async (submission: JotformSubmission) => {
    setDeletedJotformSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
    try {
      await restoreJotformSubmission(submission.id);
      void logActivity({ action: "jotform_submission_restored", targetType: "employee", targetLabel: submission.applicantName || "Unknown", details: { form: submission.formTitle || submission.formId } });
      void loadJotformSubmissions();
    } catch (err) {
      console.error("Failed to restore submission:", err);
      void loadDeletedJotformSubmissions();
    }
  };

  const markJotformRead = async (n: AppNotification) => {
    if (n.isRead || !uid) return;
    setJotformNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    try {
      await markNotificationRead(uid, n.id);
    } catch (err) {
      console.error("Failed to mark Jotform notification read:", err);
    }
  };

  const markAllJotformRead = async () => {
    if (!uid) return;
    const unreadIds = jotformNotifs.filter((n) => !n.isRead).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setJotformNotifs((prev) => prev.map((x) => ({ ...x, isRead: true })));
    try {
      // Mark only the Jotform-kind docs — the Firestore notifications
      // collection is shared with other alert kinds (e.g. cross-inventory
      // requests), so a blanket "mark all read" would hide those too.
      await Promise.all(unreadIds.map((id) => markNotificationRead(uid, id)));
    } catch (err) {
      console.error("Failed to mark all Jotform notifications read:", err);
    }
  };

  const handleDeleteJotformNotification = async (n: AppNotification) => {
    if (!uid) return;
    if (!window.confirm(`Delete this submission notification ("${n.title}")? This can't be undone.`)) return;
    setJotformNotifs((prev) => prev.filter((x) => x.id !== n.id));
    if (selectedSubmission?.id === n.id) setSelectedSubmission(null);
    try {
      await deleteNotification(uid, n.id);
    } catch (err) {
      console.error("Failed to delete Jotform notification:", err);
      setError(err instanceof Error ? err.message : "Failed to delete submission.");
    }
  };

  // Clicking a Jotform notification opens a modal with the full submission.
  // `answers` is now a JSON-encoded array of {label, value} rows built
  // directly from Jotform's structured rawRequest (see buildAnswerRows in
  // jotformBridge.ts) — reliable for checkboxes/paragraphs, unlike the old
  // comma-split parse of Jotform's free-text "pretty" summary, which could
  // silently mis-split or drop answers containing their own commas.
  const [selectedSubmission, setSelectedSubmission] = useState<AppNotification | null>(null);
  const parseAnswers = (answers: string | undefined): { label: string; value: string }[] => {
    if (!answers) return [];
    try {
      const parsed = JSON.parse(answers);
      if (Array.isArray(parsed)) return parsed as { label: string; value: string }[];
    } catch {
      // Not JSON — must be an older notification stored before this format
      // changed. Fall back to the legacy comma-split parse of the "pretty"
      // string so existing notifications still render something.
    }
    return answers
      .split(/,\s*(?=[^,:]+:)/)
      .map((part) => {
        const idx = part.indexOf(":");
        if (idx === -1) return { label: "", value: part.trim() };
        return { label: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
      })
      .filter((p) => p.label || p.value);
  };

  // ── Jotform Submissions filters: form title, submitter name, date ──
  const [jotformFilters, setJotformFilters] = useState({ formTitle: "", submitter: "", date: "" });
  const jotformFormTitles = useMemo(
    () => Array.from(new Set(jotformNotifs.map((n) => n.title))).sort(),
    [jotformNotifs]
  );
  const filteredJotformNotifs = useMemo(() => {
    const q = jotformFilters.submitter.trim().toLowerCase();
    return jotformNotifs.filter((n) => {
      if (jotformFilters.formTitle && n.title !== jotformFilters.formTitle) return false;
      if (jotformFilters.date && n.createdAt.slice(0, 10) !== jotformFilters.date) return false;
      // body reads "Submitted by <name>" — search it directly rather than
      // re-deriving the name, since that's the only place it's stored.
      if (q && !n.body.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jotformNotifs, jotformFilters]);

  // "Download PDF" opens an isolated print window with just this submission
  // (not the whole dashboard) and triggers the browser's print dialog, which
  // every browser offers "Save as PDF" as a destination for — same approach
  // already used elsewhere in this app (see OverallStatusPage.tsx's Printer
  // button) rather than pulling in a PDF-generation library.
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const downloadSubmissionPdf = async (n: AppNotification) => {
    const rows = parseAnswers(n.answers);
    // Same container/header treatment as the payslip PDF (see
    // generatePayslipHTML in employee.$employeeId.tsx) so every generated
    // document in this app looks like one consistent system.
    let logoDataUrl = "";
    try {
      const logoModule = await import("@/assets/logo.png");
      const res = await fetch(logoModule.default);
      const blob = await res.blob();
      logoDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      // Logo is cosmetic — proceed without it if it fails to load.
    }

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${escapeHtml(n.title)}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: white; padding: 10px; color: #1f2937; }
            .container { max-width: 800px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; padding: 20px; }
            .header { display: flex; gap: 15px; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 8px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); }
            .header img { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
            .header h1 { color: white; font-size: 22px; letter-spacing: 0.5px; }
            .header p { color: #e0e7ff; font-size: 12px; margin-top: 2px; }
            .info-section { display: flex; flex-direction: column; gap: 4px; background: #eff6ff; border-left: 4px solid #1e40af; padding: 12px 14px; border-radius: 4px; margin-bottom: 20px; }
            .info-section label { font-size: 11px; color: #1e40af; text-transform: uppercase; font-weight: 700; }
            .info-section span { font-size: 15px; font-weight: 600; color: #1f2937; }
            .info-section .sub { font-size: 12px; color: #6b7280; font-weight: 500; margin-top: 2px; }
            h3.section-title { font-size: 13px; font-weight: 700; color: #1f2937; margin-bottom: 8px; border-bottom: 2px solid #1e40af; padding-bottom: 5px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            table th { background: #f3f4f6; color: #1f2937; padding: 8px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; border: 1px solid #e5e7eb; width: 30%; }
            table td { padding: 8px; border: 1px solid #e5e7eb; font-size: 13px; color: #374151; }
            table tr:nth-child(even) { background: #fafafa; }
            .attachments { display: flex; flex-wrap: wrap; gap: 10px; }
            .attachments img { width: 140px; height: 140px; object-fit: cover; border: 1px solid #e5e7eb; border-radius: 6px; }
            .footer { text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10px; }
            @media print {
              body { padding: 0; }
              .container { border: none; padding: 20px; }
              .header, table th, .info-section { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" />` : ""}
              <div>
                <h1>FORM SUBMISSION</h1>
                <p>${escapeHtml(n.title)}</p>
              </div>
            </div>

            <div class="info-section">
              <label>Submitted By</label>
              <span>${escapeHtml(n.body.replace(/^Submitted by /i, ""))}</span>
              <div class="sub">${escapeHtml(new Date(n.createdAt).toLocaleString())}</div>
            </div>

            ${rows.length > 0 ? `
            <h3 class="section-title">Submission Details</h3>
            <table>
              <thead><tr><th>Field</th><th>Response</th></tr></thead>
              <tbody>
                ${rows.map((r) => `<tr><td>${escapeHtml(r.label || "—")}</td><td>${escapeHtml(r.value || "—")}</td></tr>`).join("")}
              </tbody>
            </table>
            ` : `<p style="color:#6b7280; font-size:13px; margin-bottom:20px;">No additional details available for this submission.</p>`}

            ${n.photos && n.photos.length > 0 ? `
            <h3 class="section-title">Attachments</h3>
            <div class="attachments">
              ${n.photos.map((p) => `<img src="${escapeHtml(p)}" />`).join("")}
            </div>
            ` : ""}

            <div class="footer">Generated by AHS System &middot; ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </body>
      </html>
    `);
    win.document.close();
    // Wait for the window to finish loading (so the logo and any attachment
    // images are actually rendered before printing) rather than firing
    // print() immediately, then close the tab once the print dialog is
    // dismissed — otherwise it's left sitting there empty afterward.
    win.onload = () => {
      win.focus();
      win.print();
    };
    win.onafterprint = () => win.close();
  };

  // ── Employee Directory (live) ──
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roleByProfileId, setRoleByProfileId] = useState<Map<string, string>>(new Map());
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [myLocations, setMyLocations] = useState<string[]>([]);
  // Full employee_info per profile, cached so Onboarding Documents can merge
  // a toggle into the existing record instead of clobbering bank info,
  // address, etc. with a partial save.
  const [employeeInfoByProfileId, setEmployeeInfoByProfileId] = useState<Map<string, EmployeeInfo>>(new Map());

  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; employeeId: string; employeeName: string; newStatus: EmploymentStatus } | null>(null);

  const [employeeFilters, setEmployeeFilters] = useState({
    search: "",
    status: "" as "" | EmploymentStatus,
    branch: "",
    sortBy: "name" as "name" | "startDate" | "warnings",
    sortOrder: "asc" as "asc" | "desc",
  });

  const loadEmployees = async () => {
    setEmployeesLoading(true);
    try {
      const profiles = await getCompanyUsers();

      const me = profiles.find((p) => p.id === uid);
      setMyLocations(me ? branchesOf(me.assigned_branch, me.branch_access) : []);
      setRoleByProfileId(new Map(profiles.map((p) => [p.id, p.role || ""])));

      // getCompanyUsers() doesn't select employee_info (it can carry a
      // base64 photoDataUrl, too heavy to pull on every profile-list load)
      // — fetch hire dates etc. for just this list in one bulk query.
      const infoByProfileId = await getEmployeeInfoByProfileIds(profiles.map((p) => p.id));
      setEmployeeInfoByProfileId(infoByProfileId);

      const mapped: Employee[] = profiles.map(p => {
        const info = infoByProfileId.get(p.id) || {};
        const employmentStatus: EmploymentStatus = info.employmentStatus || (p.is_active ? "active" : "inactive");
        return {
          id: p.id,
          name: p.display_name || p.email,
          email: p.email,
          position: p.role,
          branch: p.assigned_branch || "",
          department: p.department || "",
          country: PH_BRANCH_NAMES.has(p.assigned_branch || "") ? "PH" : "US",
          birthday: info.birthDate || "",
          address: [info.address1, info.city, info.state].filter(Boolean).join(", "),
          ssn: info.employeeSsn || undefined,
          startDate: info.hireDate || p.created_at?.slice(0, 10) || "",
          terminationDate: info.employmentStatusDate || info.terminateDate || undefined,
          terminationReason: info.employeeNote || undefined,
          status: employmentStatus,
          onboardingDocs: info.onboardingDocs || {},
          offDays: p.off_days ?? [],
          requiredCheckIn: p.required_check_in || "",
          requiredCheckOut: p.required_check_out || "",
        };
      });
      setEmployees(mapped);
    } catch (err) {
      console.error("ReportHRDaily employees load error:", err);
    } finally {
      setEmployeesLoading(false);
    }
  };

  // ── PTO balances (for the Employee Directory "Remaining PTO" column) ──
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const loadPtoRequests = async () => {
    try {
      setPtoRequests(await getCompanyPtoRequests());
    } catch (err) {
      console.error("Failed to load PTO requests:", err);
    }
  };

  // ── Employee Request Manager — all-in-one company-wide view of PTO
  // requests, Time Correction requests, Attendance Disputes, and Payroll
  // Inquiries, mirroring Employee Self-Service's "Manage Requests" tab (same
  // underlying lib functions, its own fetch/state here) so HR/managers don't
  // need to leave the HR dashboard to review and act on these. ──
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [employeeRequests, setEmployeeRequests] = useState<EmployeeRequestRow[]>([]);
  const [requestManagerLoading, setRequestManagerLoading] = useState(true);
  const [requestResponseNote, setRequestResponseNote] = useState<Record<string, string>>({});
  const loadRequestManagerData = async () => {
    setRequestManagerLoading(true);
    try {
      const [correctionsData, employeeRequestsData] = await Promise.all([
        getCompanyTimecardCorrections(),
        getCompanyEmployeeRequests(),
      ]);
      setCorrections(correctionsData);
      setEmployeeRequests(employeeRequestsData);
    } catch (err) {
      console.error("Failed to load employee requests:", err);
    } finally {
      setRequestManagerLoading(false);
    }
  };
  const pendingPtoRequests = useMemo(() => ptoRequests.filter((r) => r.status === "pending"), [ptoRequests]);
  const pendingCorrections = useMemo(() => corrections.filter((r) => r.status === "pending"), [corrections]);
  const pendingEmployeeRequests = useMemo(() => employeeRequests.filter((r) => r.status === "pending"), [employeeRequests]);
  const requestManagerPendingCount = pendingPtoRequests.length + pendingCorrections.length + pendingEmployeeRequests.length;

  // ── Which category's table is showing (one at a time, not all three
  // stacked) + a "new since last viewed" badge per category, tracked in
  // localStorage (per browser) since there's no existing per-user "seen"
  // flag on these request tables to read instead. ──
  const REQUEST_MANAGER_CATEGORIES = ["pto", "corrections", "disputes"] as const;
  type RequestManagerCategory = (typeof REQUEST_MANAGER_CATEGORIES)[number];
  const [requestManagerCategory, setRequestManagerCategory] = useState<RequestManagerCategory>("pto");
  const [requestManagerLastSeen, setRequestManagerLastSeen] = useState<Record<RequestManagerCategory, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("hrRequestManagerLastSeen") || "{}");
    } catch {
      return {} as Record<RequestManagerCategory, string>;
    }
  });
  const latestCreatedAt = (rows: { createdAt: string }[]): string | null =>
    rows.reduce<string | null>((max, r) => (!max || r.createdAt > max ? r.createdAt : max), null);
  const requestManagerLatest: Record<RequestManagerCategory, string | null> = {
    pto: latestCreatedAt(pendingPtoRequests),
    corrections: latestCreatedAt(pendingCorrections),
    disputes: latestCreatedAt(pendingEmployeeRequests),
  };
  const requestManagerHasNew = (category: RequestManagerCategory): boolean => {
    const latest = requestManagerLatest[category];
    if (!latest) return false;
    const lastSeen = requestManagerLastSeen[category];
    return !lastSeen || latest > lastSeen;
  };
  const handleSelectRequestManagerCategory = (category: RequestManagerCategory) => {
    setRequestManagerCategory(category);
    const latest = requestManagerLatest[category];
    if (latest) {
      const next = { ...requestManagerLastSeen, [category]: latest };
      setRequestManagerLastSeen(next);
      localStorage.setItem("hrRequestManagerLastSeen", JSON.stringify(next));
    }
  };
  const profileName = (id: string) => employees.find((e) => e.id === id)?.name || "Unknown";
  /** Native <input type="time"> flips AM/PM when a user mistypes — flags the classic case without needing Date parsing. */
  const isCheckOutBeforeCheckIn = (checkIn: string, checkOut: string): boolean => !!checkIn && !!checkOut && checkOut <= checkIn;

  const handlePtoStageAction = async (request: PtoRequestRow, stage: PtoStage, decision: "approved" | "rejected") => {
    try {
      await reviewPtoStage(request, stage, decision, myProfileId || "");
      await loadPtoRequests();
    } catch (err) {
      alert(`Failed to update PTO request: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleCorrectionAction = async (correction: TimecardCorrectionRow, approve: boolean) => {
    try {
      if (approve) {
        const effectiveCheckIn = correction.correctedCheckIn || correction.originalCheckIn || "";
        const effectiveCheckOut = correction.correctedCheckOut || correction.originalCheckOut || "";
        const effectiveMealStart = correction.correctedMealStart || correction.originalMealStart || "";
        const effectiveMealEnd = correction.correctedMealEnd || correction.originalMealEnd || "";
        if (isCheckOutBeforeCheckIn(effectiveCheckIn, effectiveCheckOut)) {
          alert(`Can't approve: check out (${effectiveCheckOut}) is before check in (${effectiveCheckIn}). This is usually an AM/PM mistake on the time picker — reject it and ask the employee to resubmit.`);
          return;
        }
        if (isCheckOutBeforeCheckIn(effectiveMealStart, effectiveMealEnd)) {
          alert(`Can't approve: meal end (${effectiveMealEnd}) is before meal start (${effectiveMealStart}). This is usually an AM/PM mistake on the time picker — reject it and ask the employee to resubmit.`);
          return;
        }
        await approveTimecardCorrection(correction, correction.correctedCheckIn, correction.correctedCheckOut, myProfileId, correction.correctedMealStart, correction.correctedMealEnd);
      } else {
        await rejectTimecardCorrection(correction, myProfileId);
      }
      await loadRequestManagerData();
    } catch (err) {
      alert(`Failed to update correction: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleEmployeeRequestAction = async (id: string, status: EmployeeRequestStatus) => {
    try {
      await updateEmployeeRequestStatus(id, status, myProfileId, requestResponseNote[id]);
      await loadRequestManagerData();
      setRequestResponseNote((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      alert(`Failed to update request: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  // ── Attendance KPI tile — today's present/absent breakdown. Reuses the
  // exact same off_days/required_check_in/required_check_out + timecard
  // comparison Attendance Monitoring already does, just for today only. ──
  const [todayTimecardEntries, setTodayTimecardEntries] = useState<CompanyTimecardEntry[]>([]);
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [attendanceCountryTab, setAttendanceCountryTab] = useState<"US" | "PH">("US");
  const loadTodayTimecardEntries = async () => {
    try {
      setTodayTimecardEntries(await getCompanyTimecardEntries(today, today));
    } catch (err) {
      console.error("Failed to load today's timecard entries:", err);
    }
  };

  // ── Hiring / Candidates (live) ──
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ name: "", phone: "", email: "", position: "", branch: "" });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [savingCandidate, setSavingCandidate] = useState(false);
  const [hiringSearch, setHiringSearch] = useState("");
  const [hiringStatusFilter, setHiringStatusFilter] = useState<"" | CandidateStatus>("");

  const loadCandidates = async () => {
    setCandidatesLoading(true);
    try {
      setCandidates(await getCandidates());
    } catch (err) {
      console.error("Failed to load candidates:", err);
    } finally {
      setCandidatesLoading(false);
    }
  };

  // ── Warnings/mistakes (company-wide, generalized from the CSR workflow) ──
  const [allNotes, setAllNotes] = useState<CsrAgentNote[]>([]);
  const [pendingNotes, setPendingNotes] = useState<CsrAgentNote[]>([]);
  const [pendingNotesLoading, setPendingNotesLoading] = useState(true);

  // Mistakes/Warnings totals shown above Pending Reviews — scoped to a date
  // range (Today by default), same "Today" quick-select + From/To pattern as
  // the Generate Report tab. Counts approved notes only, windowed by
  // createdAt (same field the department trend chart below already uses).
  const [warningsRangeFrom, setWarningsRangeFrom] = useState(today);
  const [warningsRangeTo, setWarningsRangeTo] = useState(today);
  const setWarningsRangeToday = () => { setWarningsRangeFrom(today); setWarningsRangeTo(today); };
  const warningsCountKpi = useMemo(() => {
    const inRange = (n: CsrAgentNote) => {
      const d = n.createdAt.slice(0, 10);
      return n.status === "approved" && d >= warningsRangeFrom && d <= warningsRangeTo;
    };
    return {
      warnings: allNotes.filter((n) => n.type === "warning" && inRange(n)).length,
      mistakes: allNotes.filter((n) => n.type === "mistake" && inRange(n)).length,
    };
  }, [allNotes, warningsRangeFrom, warningsRangeTo]);

  const loadNotes = async () => {
    try {
      const [all, awaitingReview] = await Promise.all([
        getAllAgentNotes().catch(() => []),
        isHrOrAdmin ? getPendingAgentNotes().catch(() => []) : Promise.resolve([]),
      ]);
      setAllNotes(all);
      // Show both stages here — HR/Admin can act directly on a still-pending
      // (stage 1) submission instead of waiting on a department manager to
      // review it first on the employee's own page. decideNote() already
      // supports deciding from either stage.
      setPendingNotes(awaitingReview);
    } finally {
      setPendingNotesLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    loadEmployees();
    loadCandidates();
    loadNotes();
    loadPtoRequests();
    loadTodayTimecardEntries();
    loadRequestManagerData();
    if (uid) void getMyProfileId(uid).then(setMyProfileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isHrOrAdmin]);

  // ── Live updates — so HR staff see each other's changes without a manual
  // refresh. Coarse-grained (reload the whole list on any change) rather
  // than patching individual rows, since these lists are cheap to refetch
  // and this stays correct even when a change touches a joined column. ──
  useEffect(() => {
    if (!ready || !companyId) return;
    const unsubs = [
      subscribeTableChanges("hr_candidates", () => void loadCandidates(), `company_id=eq.${companyId}`),
      subscribeTableChanges("employee_conduct_notes", () => void loadNotes(), `company_id=eq.${companyId}`),
      subscribeTableChanges("hr_signable_documents", () => { void loadSentWarningForms(); void loadSentW8benForms(); void loadSentW4Forms(); void loadSentW9Forms(); }, `company_id=eq.${companyId}`),
      subscribeTableChanges("pto_requests", () => void loadPtoRequests(), `company_id=eq.${companyId}`),
      subscribeTableChanges("timecard_entries", () => void loadTodayTimecardEntries(), `company_id=eq.${companyId}`),
      subscribeTableChanges("timecard_corrections", () => void loadRequestManagerData(), `company_id=eq.${companyId}`),
      subscribeTableChanges("employee_requests", () => void loadRequestManagerData(), `company_id=eq.${companyId}`),
    ];
    return () => unsubs.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, companyId]);

  const decideNote = async (id: string, status: "approved" | "rejected") => {
    try {
      const note = pendingNotes.find((n) => n.id === id);
      await reviewAgentNote(id, status);
      await loadNotes();
      const employeeName = note ? employees.find((e) => e.id === note.agentProfileId)?.name : undefined;
      void logActivity({ action: "warning_note_reviewed", targetType: "conduct_note", targetId: id, targetLabel: employeeName, details: { status } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update review status.");
    }
  };

  // ── Approved Warnings & Mistakes — one centralized log across every
  // department, so HR doesn't have to open each employee's page one by one. ──
  const [logSearch, setLogSearch] = useState("");
  const [logType, setLogType] = useState<"" | "warning" | "mistake">("");
  const [logDept, setLogDept] = useState("");

  const deptLabelOf = (roleCode: string | undefined) => ROLE_LABELS[normalizeRole(roleCode)] ?? roleCode ?? "Unknown";

  const approvedLog = useMemo(() => {
    return allNotes
      .filter((n) => n.status === "approved")
      .map((n) => ({
        ...n,
        employeeName: employees.find((e) => e.id === n.agentProfileId)?.name || "Unknown employee",
        department: deptLabelOf(roleByProfileId.get(n.agentProfileId)),
      }))
      .sort((a, b) => (b.reviewedAt || b.createdAt).localeCompare(a.reviewedAt || a.createdAt));
  }, [allNotes, employees, roleByProfileId]);

  const approvedDepartments = useMemo(
    () => Array.from(new Set(approvedLog.map((n) => n.department))).sort(),
    [approvedLog],
  );

  const filteredApprovedLog = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return approvedLog.filter((n) => {
      if (logType && n.type !== logType) return false;
      if (logDept && n.department !== logDept) return false;
      if (q && !n.employeeName.toLowerCase().includes(q) && !n.note.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [approvedLog, logType, logDept, logSearch]);

  /** Retracts an already-approved warning/mistake straight from the centralized log — same action as the employee page's Retract button, just without needing to open that page first. */
  const handleRetractApprovedNote = async (noteId: string) => {
    if (!window.confirm("Retract this approved warning/mistake? This permanently removes the official record.")) return;
    try {
      const note = allNotes.find((n) => n.id === noteId);
      await deleteAgentNote(noteId);
      setAllNotes((prev) => prev.filter((n) => n.id !== noteId));
      const employeeName = note ? employees.find((e) => e.id === note.agentProfileId)?.name : undefined;
      void logActivity({ action: "warning_note_retracted", targetType: "conduct_note", targetId: noteId, targetLabel: employeeName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retract note.");
    }
  };

  // ── Candidate handlers ──
  const allBranches = useMemo(() => LOCATIONS_DATA.map(l => l.location).sort(), []);
  const branchOptions = isBranchManager && myLocations.length > 0 ? myLocations : allBranches;

  const visibleCandidates = useMemo(() => {
    if (!isBranchManager) return candidates;
    return candidates.filter((c) => c.branch && myLocations.includes(c.branch));
  }, [candidates, isBranchManager, myLocations]);

  // Search/Status filters narrow what the table shows — KPI tiles and the
  // tab badge count stay based on visibleCandidates (unfiltered) above.
  const filteredCandidates = useMemo(() => {
    let result = visibleCandidates;
    if (hiringStatusFilter) result = result.filter((c) => c.status === hiringStatusFilter);
    const q = hiringSearch.trim().toLowerCase();
    if (q) {
      result = result.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.position ?? "").toLowerCase().includes(q) ||
        (c.branch ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [visibleCandidates, hiringSearch, hiringStatusFilter]);

  const kpi = useMemo(() => ({
    candidates: visibleCandidates.length,
    scheduled: visibleCandidates.filter((c) => c.status === "interviewing").length,
    rejected: visibleCandidates.filter((c) => c.status === "rejected").length,
    hired: visibleCandidates.filter((c) => c.status === "hired").length,
    terminated: employees.filter((e) => e.status === "terminated").length,
    resigned: employees.filter((e) => e.status === "resigned").length,
  }), [visibleCandidates, employees]);

  // ── Attendance KPI tile — today's present/absent breakdown, built the same
  // way Attendance Monitoring's dailyRecords does (off_days -> isOffDay,
  // required_check_in/out vs actual check-in/out -> short-duty alerts).
  // Absent employees are further split using today's approved PTO requests,
  // mapped per the confirmed convention: sick->Sick Leave, personal->
  // Personal Leave, unpaid->Time Off, vacation/holiday/bereavement->Paid
  // Time Off. Anyone absent with no matching approved PTO is "no notice". ──
  function fmtShortMinutes(hours: number): string {
    const totalMinutes = Math.max(0, Math.round(hours * 60));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  const PTO_BUCKET: Record<PtoType, "Sick Leave" | "Personal Leave" | "Time Off" | "Paid Time Off"> = {
    sick: "Sick Leave",
    personal: "Personal Leave",
    unpaid: "Time Off",
    vacation: "Paid Time Off",
    holiday: "Paid Time Off",
    bereavement: "Paid Time Off",
  };
  function buildAttendanceSummary(pool: Employee[], entryByProfile: Map<string, CompanyTimecardEntry>, ptoByProfile: Map<string, PtoType>, dow: number) {
    const present: { employee: Employee; lateBy: string | null; shortBy: string | null }[] = [];
    const buckets: Record<"Absent without notice" | "Sick Leave" | "Personal Leave" | "Time Off" | "Paid Time Off", Employee[]> = {
      "Absent without notice": [],
      "Sick Leave": [],
      "Personal Leave": [],
      "Time Off": [],
      "Paid Time Off": [],
    };
    for (const emp of pool) {
      if (emp.status !== "active") continue;
      const isOffDay = new Set(emp.offDays).has(dow);
      if (isOffDay) continue;
      const entry = entryByProfile.get(emp.id);
      const checkIn = entry?.checkIn || "";
      const checkOut = entry?.checkOut || "";
      if (checkIn) {
        let lateBy: string | null = null;
        let shortBy: string | null = null;
        if (emp.requiredCheckIn && checkIn > emp.requiredCheckIn) {
          lateBy = fmtShortMinutes(hoursDiff(emp.requiredCheckIn, checkIn));
        }
        if (checkOut && emp.requiredCheckIn && emp.requiredCheckOut) {
          const worked = calcWorkedHours({ checkIn, checkOut, mealStart: entry?.mealStart || "", mealEnd: entry?.mealEnd || "", notes: "" });
          const requiredHours = hoursDiff(emp.requiredCheckIn, emp.requiredCheckOut);
          if (requiredHours - worked > 0.25) shortBy = fmtShortMinutes(requiredHours - worked);
        }
        present.push({ employee: emp, lateBy, shortBy });
      } else {
        const ptoType = ptoByProfile.get(emp.id);
        const bucket = ptoType ? PTO_BUCKET[ptoType] : "Absent without notice";
        buckets[bucket].push(emp);
      }
    }
    const totalAbsent = Object.values(buckets).reduce((sum, arr) => sum + arr.length, 0);
    return { present, buckets, totalAbsent };
  }

  // Split US/PH so HR can review each region's attendance separately
  // (different shift norms, holidays, etc.) instead of one blended list.
  const { attendanceSummaryUS, attendanceSummaryPH, attendanceSummary } = useMemo(() => {
    const dow = new Date(today + "T00:00:00").getDay();
    const entryByProfile = new Map<string, CompanyTimecardEntry>();
    for (const e of todayTimecardEntries) entryByProfile.set(e.profileId, e);
    const approvedPtoToday = ptoRequests.filter(
      (r) => r.status === "approved" && r.startDate <= today && today <= r.endDate
    );
    const ptoByProfile = new Map<string, PtoType>();
    for (const r of approvedPtoToday) if (!ptoByProfile.has(r.profileId)) ptoByProfile.set(r.profileId, r.ptoType);

    const us = buildAttendanceSummary(employees.filter((e) => e.country === "US"), entryByProfile, ptoByProfile, dow);
    const ph = buildAttendanceSummary(employees.filter((e) => e.country === "PH"), entryByProfile, ptoByProfile, dow);
    const combined = {
      present: [...us.present, ...ph.present],
      buckets: (["Absent without notice", "Sick Leave", "Personal Leave", "Time Off", "Paid Time Off"] as const).reduce((acc, k) => {
        acc[k] = [...us.buckets[k], ...ph.buckets[k]];
        return acc;
      }, {} as typeof us.buckets),
      totalAbsent: us.totalAbsent + ph.totalAbsent,
    };
    return { attendanceSummaryUS: us, attendanceSummaryPH: ph, attendanceSummary: combined };
  }, [employees, todayTimecardEntries, ptoRequests, today]);

  // ── Generate Report: same KPI breakdown as the top of the page, scoped to
  // a date range instead of all-time. Candidates are windowed by when they
  // applied (createdAt); terminated/resigned are windowed by terminationDate
  // — same fields the department trend chart below already uses this way. ──
  const todayStr = new Date().toISOString().slice(0, 10);
  const [reportFrom, setReportFrom] = useState(todayStr);
  const [reportTo, setReportTo] = useState(todayStr);
  const setReportRangeToday = () => { setReportFrom(todayStr); setReportTo(todayStr); };

  const reportCandidates = useMemo(
    () => visibleCandidates.filter((c) => {
      const d = c.createdAt.slice(0, 10);
      return d >= reportFrom && d <= reportTo;
    }),
    [visibleCandidates, reportFrom, reportTo]
  );
  const reportTerminatedEmployees = useMemo(
    () => employees.filter((e) => e.terminationDate && e.terminationDate >= reportFrom && e.terminationDate <= reportTo),
    [employees, reportFrom, reportTo]
  );
  const hiringReportKpi = useMemo(() => ({
    candidates: reportCandidates.length,
    scheduled: reportCandidates.filter((c) => c.status === "interviewing").length,
    rejected: reportCandidates.filter((c) => c.status === "rejected").length,
    hired: reportCandidates.filter((c) => c.status === "hired").length,
    terminated: reportTerminatedEmployees.filter((e) => e.status === "terminated").length,
    resigned: reportTerminatedEmployees.filter((e) => e.status === "resigned").length,
  }), [reportCandidates, reportTerminatedEmployees]);
  const reportRangeLabel = reportFrom === reportTo ? reportFrom : `${reportFrom} to ${reportTo}`;

  const hiringReportRows: [string, number][] = [
    ["Candidates", hiringReportKpi.candidates],
    ["Scheduled for Interview", hiringReportKpi.scheduled],
    ["Rejected", hiringReportKpi.rejected],
    ["Hired", hiringReportKpi.hired],
    ["Terminated", hiringReportKpi.terminated],
    ["Resigned", hiringReportKpi.resigned],
  ];

  // Metric -> the same accent color its KPI tile uses on the dashboard, so
  // the exported sheet visually matches the on-screen tiles.
  const hiringReportColors: Record<string, string> = {
    "Candidates": "#2563eb",
    "Scheduled for Interview": "#ca8a04",
    "Rejected": "#dc2626",
    "Hired": "#16a34a",
    "Terminated": "#dc2626",
    "Resigned": "#475569",
  };

  // Shared by every "Download PDF" button on this page — loads the logo once
  // as a data URL (so the print window doesn't depend on network state) and
  // opens/prints/closes the window, so each report only needs to build its
  // own HTML body.
  const loadLogoDataUrl = async (): Promise<string> => {
    try {
      const logoModule = await import("@/assets/logo.png");
      const res = await fetch(logoModule.default);
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return ""; // Logo is cosmetic — proceed without it if it fails to load.
    }
  };

  const openPrintWindow = (html: string) => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
    win.onafterprint = () => win.close();
  };

  const [coeForm, setCoeForm] = useState({
    honorific: "Mr.",
    employeeName: "",
    employeeStartDate: "",
    jobTitle: "",
    reason: "",
    authorizedRep: "",
    authorizedRepEmail: "",
    authorizedRepPhone: "800-779-3579",
    officeUseName: "",
    officeUseTitle: "",
    officeUseSignature: "",
    officeUseNumber: "800-779-3579",
  });
  const [coeGenerating, setCoeGenerating] = useState(false);
  const updateCoeField = (field: keyof typeof coeForm, value: string) =>
    setCoeForm((prev) => ({ ...prev, [field]: value }));

  // ── Editable COE body template (Admin-only) — doesn't touch the form
  // fields above; just the prose paragraphs rendered into the certificate. ──
  const [coeBodyTemplate, setCoeBodyTemplate] = useState(DEFAULT_COE_BODY_TEMPLATE);
  const [coeTemplateModalOpen, setCoeTemplateModalOpen] = useState(false);
  const [coeTemplateDraft, setCoeTemplateDraft] = useState("");
  const [coeTemplateSaving, setCoeTemplateSaving] = useState(false);
  useEffect(() => {
    getCompanyCoeBodyTemplate()
      .then((stored) => setCoeBodyTemplate(stored ?? DEFAULT_COE_BODY_TEMPLATE))
      .catch((err) => console.error("Failed to load COE body template:", err));
  }, []);
  const handleSaveCoeBodyTemplate = async () => {
    setCoeTemplateSaving(true);
    try {
      await setCompanyCoeBodyTemplate(coeTemplateDraft);
      setCoeBodyTemplate(coeTemplateDraft);
      setCoeTemplateModalOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save template.");
    } finally {
      setCoeTemplateSaving(false);
    }
  };
  /** Substitutes {{placeholders}} into the (already-escaped) template text and wraps blank-line-separated paragraphs in <p> tags. */
  const renderCoeBodyHtml = (template: string, values: Record<string, string>): string => {
    const escaped = escapeHtml(template);
    const substituted = escaped.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
    return substituted
      .split(/\n\s*\n/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
  };
  // Employee Name, Job Title, and Authorized Representative are all
  // typeable filters — the input's value doubles as both the filter query
  // and the field's final text (so a name/title not in either suggestion
  // list can still just be typed in directly), same combobox pattern as
  // the recipient picker below.
  const [coeEmployeeNameDropdownOpen, setCoeEmployeeNameDropdownOpen] = useState(false);
  const filteredCoeEmployeeOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q)) : sorted;
  };

  const [coeJobTitleDropdownOpen, setCoeJobTitleDropdownOpen] = useState(false);
  const filteredCoeJobTitleOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    return q ? COE_JOB_TITLE_OPTIONS.filter((t) => t.toLowerCase().includes(q)) : COE_JOB_TITLE_OPTIONS;
  };

  // "For Office Use Only — Name" and "Authorized Representative" suggestions
  // — Admin/HR/BizOps roles are the people who'd realistically sign off on
  // a certificate like this. These are two independent signers (e.g. the
  // reference certificate has "Frederick Ian Cabilao" as the letter's
  // Authorized Representative and a different person, "Raul Bayuyos", in
  // the Office Use box), so each gets its own dropdown/state.
  const COE_OFFICE_USE_ROLES = new Set(["ADMIN", "HR", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"]);
  // Office Use box signer is any manager (Branch, CSR, Parts, BizOps, etc.
  // — anything with "MANAGER" in the role code) as well as Admin/HR/BizOps,
  // since a branch-level manager like the reference's "CSR Manager" isn't
  // covered by COE_OFFICE_USE_ROLES's fixed BizOps-only list above.
  const isCoeOfficeUseEligible = (role: string) => role.includes("MANAGER") || role === "ADMIN" || role === "HR" || role.includes("BIZOPS");
  const [coeOfficeUseNameDropdownOpen, setCoeOfficeUseNameDropdownOpen] = useState(false);
  const filteredCoeOfficeUseNameOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    const candidates = employees.filter((e) => isCoeOfficeUseEligible(normalizeRole(e.position))).sort((a, b) => a.name.localeCompare(b.name));
    return q ? candidates.filter((e) => e.name.toLowerCase().includes(q)) : candidates;
  };

  const [coeAuthorizedRepDropdownOpen, setCoeAuthorizedRepDropdownOpen] = useState(false);
  const filteredCoeAuthorizedRepOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    const candidates = employees.filter((e) => COE_OFFICE_USE_ROLES.has(normalizeRole(e.position))).sort((a, b) => a.name.localeCompare(b.name));
    return q ? candidates.filter((e) => e.name.toLowerCase().includes(q)) : candidates;
  };

  // CSS shared by both the print-window document and the live in-app
  // preview (rendered via dangerouslySetInnerHTML so both paths — download
  // and "capture this exact DOM node for sending" — stay pixel-identical).
  const coeStyles = `
    .coe-container * { margin: 0; padding: 0; box-sizing: border-box; }
    .coe-container { width: 816px; min-height: 1056px; background: white; padding: 96px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #1f2937; }
    .coe-container .header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .coe-container .header img.logo { width: 115px; height: 115px; object-fit: contain; }
    .coe-container .header img.ribbon { width: 260px; height: auto; }
    .coe-container h1 { text-align: center; font-size: 20px; letter-spacing: 0.3px; margin-bottom: 22px; }
    .coe-container p { font-size: 13.5px; line-height: 1.3; margin-bottom: 17px; text-align: justify; }
    .coe-container .date-line { margin-bottom: 17px; }
    .coe-container .sign-block { margin-top: 4px; }
    .coe-container .sign-block p { text-align: left; margin-bottom: 2px; }
    .coe-container .sign-line { margin-bottom: 6px; font-weight: 600; }
    .coe-container .office-use { margin-top: 58px; }
    .coe-container .office-use-rule { border: none; border-top: 1.5px solid #9ca3af; margin: 0 0 14px; }
    .coe-container .office-use-rule.bottom { margin: 14px 0 0; }
    .coe-container .office-use p { font-size: 13.5px; line-height: 1.3; margin-bottom: 8px; text-align: left; }
    .coe-container .office-use-heading { font-weight: 700; margin-bottom: 10px; }
    .coe-container .office-use .row { display: flex; gap: 90px; align-items: flex-start; margin-bottom: 8px; }
    .coe-container .office-use .row p { margin-bottom: 8px; }
    .coe-container .office-use-col:last-child p { margin-bottom: 0; }
    .coe-container .office-use u { text-decoration: underline; font-style: italic; }
    .coe-container .footer-wrap { margin-top: 70px; }
    .coe-container .footer-graphic img { display: block; width: 100%; height: auto; }
  `;

  const buildCoeBodyMarkup = (logoDataUrl: string, ribbonDataUrl: string, footerDataUrl: string) => {
    const f = coeForm;
    const blank = (v: string) => (v.trim() ? escapeHtml(v) : "&nbsp;");
    // "Ms."/"Mrs." both read as female for pronoun purposes; anything else
    // (including "Mr.") defaults to male since it's the only other option
    // in the Honorific dropdown.
    const isFemale = f.honorific === "Ms." || f.honorific === "Mrs.";
    const values = {
      honorific: blank(f.honorific),
      employeeName: blank(f.employeeName),
      startDate: blank(f.employeeStartDate ? new Date(f.employeeStartDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : ""),
      jobTitle: blank(f.jobTitle),
      reason: blank(f.reason),
      he: isFemale ? "she" : "he",
      his: isFemale ? "her" : "his",
    };
    return `
      <div class="coe-container">
        <div class="header">
          ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="US In Home Services" />` : `<div style="font-weight:800;font-size:14px;color:#1e3a8a;max-width:120px;">US IN HOME SERVICES</div>`}
          ${ribbonDataUrl ? `<img class="ribbon" src="${ribbonDataUrl}" alt="" />` : ""}
        </div>

        <h1>CERTIFICATE OF EMPLOYMENT<br/>US IN HOME SERVICES</h1>

        <p class="date-line">Date: ${escapeHtml(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }))}</p>

        <p>To Whom It May Concern,</p>

        ${renderCoeBodyHtml(coeBodyTemplate, values)}

        <div class="sign-block">
          <p>Sincerely,</p>
          <p class="sign-line">${blank(f.authorizedRep)}</p>
          <p>Authorized Representative</p>
          <p>US IN HOME SERVICES</p>
          <p>Email: ${blank(f.authorizedRepEmail)}</p>
          <p>Phone: ${blank(f.authorizedRepPhone)}</p>
        </div>

        <div class="office-use">
          <hr class="office-use-rule" />
          <p class="office-use-heading">For Office Use Only:</p>
          <div class="row">
            <div class="office-use-col">
              <p>Name: ${blank(f.officeUseName)}</p>
              <p>Title: ${blank(f.officeUseTitle)}</p>
            </div>
            <div class="office-use-col">
              <p>Signature: <u>${blank(f.officeUseSignature)}</u></p>
            </div>
          </div>
          <p>Contact Number: ${blank(f.officeUseNumber)}</p>
          <hr class="office-use-rule bottom" />
        </div>

        <div class="footer-wrap">
          <div class="footer-graphic">
            ${footerDataUrl ? `<img src="${footerDataUrl}" alt="" />` : ""}
          </div>
        </div>
      </div>
    `;
  };

  const buildCoeHtml = (logoDataUrl: string, ribbonDataUrl: string, footerDataUrl: string) => `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Certificate of Employment</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: white; }
          .coe-container { width: auto !important; max-width: 816px; margin: 0 auto; }
          ${coeStyles}
          @media print {
            @page { margin: 0; }
            .footer-graphic img { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          }
        </style>
      </head>
      <body>
        ${buildCoeBodyMarkup(logoDataUrl, ribbonDataUrl, footerDataUrl)}
      </body>
    </html>
  `;

  const [coeImages, setCoeImages] = useState({ logo: "", ribbon: "", footer: "" });
  const [coePreviewOpen, setCoePreviewOpen] = useState(false);
  const coePreviewRef = useRef<HTMLDivElement>(null);
  const [coeRecipientId, setCoeRecipientId] = useState("");
  const [coeRecipientSearch, setCoeRecipientSearch] = useState("");
  const [coeRecipientDropdownOpen, setCoeRecipientDropdownOpen] = useState(false);
  const [coeSending, setCoeSending] = useState(false);
  // Scoped to this modal, not the page-wide `error` banner — that banner
  // sits behind this full-screen overlay, so a failure here would otherwise
  // happen silently as far as the user watching this modal can tell.
  const [coeSendError, setCoeSendError] = useState<string | null>(null);

  // ── COE Sent History ──
  const [coeDocuments, setCoeDocuments] = useState<CoeDocument[]>([]);
  const [coeDocumentsLoading, setCoeDocumentsLoading] = useState(true);
  const [coeDocumentPreview, setCoeDocumentPreview] = useState<CoeDocument | null>(null);
  const loadCoeDocuments = async () => {
    setCoeDocumentsLoading(true);
    try {
      setCoeDocuments(await getCompanyCoeDocuments());
    } catch (err) {
      console.error("Failed to load COE sent history:", err);
    } finally {
      setCoeDocumentsLoading(false);
    }
  };
  useEffect(() => {
    if (!ready) return;
    void loadCoeDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => {
    if (!ready || !companyId) return;
    return subscribeTableChanges("hr_coe_documents", () => void loadCoeDocuments(), `company_id=eq.${companyId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, companyId]);
  const filteredCoeRecipients = useMemo(() => {
    const q = coeRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter(
      (e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)
    );
  }, [employees, coeRecipientSearch]);

  const handleGenerateCoe = async () => {
    setCoeGenerating(true);
    try {
      const [logoDataUrl, ribbonDataUrl, footerDataUrl] = await Promise.all([
        loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
      ]);
      setCoeImages({ logo: logoDataUrl, ribbon: ribbonDataUrl, footer: footerDataUrl });
      setCoeRecipientId("");
      setCoeRecipientSearch("");
      setCoeSendError(null);
      setCoePreviewOpen(true);
    } finally {
      setCoeGenerating(false);
    }
  };

  const handleDownloadCoe = () => {
    openPrintWindow(buildCoeHtml(coeImages.logo, coeImages.ribbon, coeImages.footer));
  };

  const handleSendCoe = async () => {
    if (!coeRecipientId || !uid) return;
    setCoeSending(true);
    setCoeSendError(null);
    try {
      const pdfBlob = await captureHtmlToPdfBlob(buildCoeBodyMarkup(coeImages.logo, coeImages.ribbon, coeImages.footer), coeStyles);

      const employeeLabel = coeForm.employeeName.trim() || "Certificate";
      const url = await uploadCoeCertificate(companyId ?? "", employeeLabel, pdfBlob);

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, coeRecipientId);
      const filename = `Certificate of Employment - ${employeeLabel}.pdf`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📄 Certificate of Employment — ${employeeLabel}: [${filename}](${url})`,
      });

      const recipientName = employees.find((e) => e.id === coeRecipientId)?.name;
      void logActivity({ action: "coe_sent", targetType: "employee", targetLabel: employeeLabel, details: { to: recipientName ?? "" } });
      // Best-effort — the certificate has already been sent above by this
      // point, so a failure here (e.g. migration 0059 not run yet) must
      // never surface as "failed to send" or block closing the dialog.
      addCoeDocument({ employeeName: employeeLabel, documentUrl: url, recipientId: coeRecipientId })
        .then(() => void loadCoeDocuments())
        .catch((err) => console.error("Failed to record COE sent-history row:", err));

      setCoePreviewOpen(false);
      setCoeRecipientId("");
      setCoeRecipientSearch("");
    } catch (err) {
      setCoeSendError(err instanceof Error ? err.message : "Failed to send certificate.");
    } finally {
      setCoeSending(false);
    }
  };

  // ── Generate Employee Warning Form ──────────────────────────────────
  // Fields mirror the company's real paper form exactly (see
  // warningFormTemplate.ts). "Previous Warning(s) Issued" auto-fills from
  // this employee's actual approved warning history (same data backing the
  // Warnings & Mistakes tab), frozen into the document at generation time
  // so a later new warning never retroactively rewrites a document already
  // out for signature. Sending creates the real warning record (fast-
  // tracked to approved, same as HR submitting directly elsewhere in this
  // app) AND a pending signable-document row the recipient signs from a
  // dedicated /sign-document/$docId page — a single round-trip: whoever
  // HR sends it to signs their own line and it comes straight back.
  const [warnForm, setWarnForm] = useState({
    employeeId: "",
    employeeName: "",
    role: "",
    branch: "",
    warningDate: todayStr,
    level: "" as "" | "1st" | "2nd" | "3rd",
    reasons: {
      absence: false,
      tardiness: false,
      inappropriateBehavior: false,
      insubordination: false,
      policyViolation: false,
      equipmentDamage: false,
      other: false,
    },
    otherReasonText: "",
    description: "",
    correctiveActions: "",
  });
  const updateWarnField = <K extends keyof typeof warnForm>(field: K, value: (typeof warnForm)[K]) =>
    setWarnForm((prev) => ({ ...prev, [field]: value }));
  const toggleWarnReason = (key: keyof typeof warnForm.reasons) =>
    setWarnForm((prev) => ({ ...prev, reasons: { ...prev.reasons, [key]: !prev.reasons[key] } }));

  const [warnEmployeeDropdownOpen, setWarnEmployeeDropdownOpen] = useState(false);
  const filteredWarnEmployeeOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q)) : sorted;
  };
  const selectWarnEmployee = (employee: { id: string; name: string; position: string; branch: string }) => {
    setWarnForm((prev) => ({
      ...prev,
      employeeId: employee.id,
      employeeName: employee.name,
      role: ROLE_LABELS[normalizeRole(employee.position)] ?? employee.position,
      branch: employee.branch,
    }));
    setWarnEmployeeDropdownOpen(false);
  };

  // Frozen snapshot for the currently-selected employee — approved warnings only (the official record), most recent first, capped at the 3 slots the paper form has.
  const warnPreviousWarnings = useMemo(() => {
    if (!warnForm.employeeId) return [];
    return allNotes
      .filter((n) => n.type === "warning" && n.agentProfileId === warnForm.employeeId && n.status === "approved")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 3)
      .map((n) => ({ cause: n.note, date: n.createdAt, issuedBy: n.createdByName || "—" }));
  }, [allNotes, warnForm.employeeId]);

  const buildWarnFormData = (recipientSlot: SignatureSlot, recipientName: string): WarningFormData => ({
    employeeId: warnForm.employeeId,
    employeeName: warnForm.employeeName,
    role: warnForm.role,
    branch: warnForm.branch,
    warningDate: warnForm.warningDate,
    level: warnForm.level,
    reasons: { ...warnForm.reasons, otherText: warnForm.otherReasonText },
    description: warnForm.description,
    correctiveActions: warnForm.correctiveActions,
    previousWarnings: warnPreviousWarnings,
    recipientSlot,
    recipientName,
  });

  const [warnLogoDataUrl, setWarnLogoDataUrl] = useState("");
  const [warnPreviewOpen, setWarnPreviewOpen] = useState(false);
  const [warnGenerating, setWarnGenerating] = useState(false);
  const [warnRecipientId, setWarnRecipientId] = useState("");
  const [warnRecipientSearch, setWarnRecipientSearch] = useState("");
  const [warnRecipientDropdownOpen, setWarnRecipientDropdownOpen] = useState(false);
  const [warnRecipientSlot, setWarnRecipientSlot] = useState<SignatureSlot>("manager");
  const [warnSending, setWarnSending] = useState(false);
  const [warnSendError, setWarnSendError] = useState<string | null>(null);
  const filteredWarnRecipients = useMemo(() => {
    const q = warnRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, warnRecipientSearch]);

  const handleOpenWarnPreview = async () => {
    setWarnGenerating(true);
    try {
      setWarnLogoDataUrl(await loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")));
      setWarnRecipientId("");
      setWarnRecipientSearch("");
      setWarnSendError(null);
      setWarnPreviewOpen(true);
    } finally {
      setWarnGenerating(false);
    }
  };

  const handleDownloadWarningForm = () => {
    const previewData = buildWarnFormData(warnRecipientSlot, "");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Employee Warning Form</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#fff;}${warningFormStyles}@media print{@page{margin:0;}}</style></head><body>${buildWarningFormBodyMarkup(previewData, warnLogoDataUrl, {})}</body></html>`;
    openPrintWindow(html);
  };

  // Shared between Confirm Warning (below) and — previously — the initial
  // send. Built from a frozen WarningFormData snapshot (not live `warnForm`
  // state) so it works correctly however long after the original send
  // Confirm actually happens.
  const buildWarnNoteText = (data: Pick<WarningFormData, "level" | "reasons" | "description">) => {
    const reasonLabels: string[] = [];
    if (data.reasons.absence) reasonLabels.push("Absence");
    if (data.reasons.tardiness) reasonLabels.push("Tardiness");
    if (data.reasons.inappropriateBehavior) reasonLabels.push("Inappropriate Behavior");
    if (data.reasons.insubordination) reasonLabels.push("Insubordination");
    if (data.reasons.policyViolation) reasonLabels.push("Policy Violation");
    if (data.reasons.equipmentDamage) reasonLabels.push("Equipment Damage");
    if (data.reasons.other && data.reasons.otherText?.trim()) reasonLabels.push(data.reasons.otherText.trim());
    const levelLabel = data.level ? `${data.level} Warning` : "Warning";
    return `${levelLabel}${reasonLabels.length ? ` — ${reasonLabels.join(", ")}` : ""}${data.description.trim() ? `. ${data.description.trim()}` : ""}`;
  };

  const [sentWarningForms, setSentWarningForms] = useState<SignableDocument[]>([]);
  const loadSentWarningForms = async () => {
    try {
      setSentWarningForms(await getSignableDocuments("warning_form"));
    } catch (err) {
      console.error("Failed to load sent warning forms:", err);
    }
  };
  useEffect(() => {
    // Also loaded on the Warnings & Mistakes tab — it cross-references
    // hr_signable_documents to show "Issued By" (who generated the Warning
    // Form) separately from "Submitted" (whoever actually clicked Confirm,
    // which can be a different person) in the Approved Warnings & Mistakes
    // table there.
    if (activeTab === "warningForm" || activeTab === "warnings") void loadSentWarningForms();
  }, [activeTab]);

  const issuerNameByNoteId = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of sentWarningForms) {
      if (d.agentNoteId && d.createdByName) map.set(d.agentNoteId, d.createdByName);
    }
    return map;
  }, [sentWarningForms]);

  // Clicking a name in the tracking table previews the form as it stands
  // right now — whichever signatures have been captured so far render in
  // their slot, everything else still blank.
  const [warnViewDoc, setWarnViewDoc] = useState<SignableDocument | null>(null);
  const handleViewWarnForm = async (doc: SignableDocument) => {
    if (!warnLogoDataUrl) {
      setWarnLogoDataUrl(await loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")));
    }
    setWarnViewDoc(doc);
  };

  /** Forces a real download instead of just opening the PDF in a new tab. Falls back to a plain new-tab open if the fetch fails (e.g. before the Firebase Storage CORS setting is configured). */
  const handleDownloadWarningFormPdf = async (doc: SignableDocument) => {
    if (!doc.pdfUrl) return;
    const employeeName = (doc.formData as unknown as WarningFormData).employeeName || "warning-form";
    try {
      const res = await fetch(doc.pdfUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Employee Warning Form - ${employeeName}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(doc.pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  // ── W-8BEN — HR just picks a recipient; the recipient fills in their own
  // Part I fields on FillW8benPage.tsx and sends the completed PDF back. ──
  const [sentW8benForms, setSentW8benForms] = useState<SignableDocument[]>([]);
  const loadSentW8benForms = async () => {
    try {
      setSentW8benForms(await getSignableDocuments("w8ben"));
    } catch (err) {
      console.error("Failed to load sent W-8BEN forms:", err);
    }
  };
  useEffect(() => {
    if (activeTab === "w8ben") void loadSentW8benForms();
  }, [activeTab]);

  const [w8RecipientId, setW8RecipientId] = useState("");
  const [w8RecipientSearch, setW8RecipientSearch] = useState("");
  const [w8RecipientDropdownOpen, setW8RecipientDropdownOpen] = useState(false);
  const [w8Sending, setW8Sending] = useState(false);
  const [w8SendError, setW8SendError] = useState<string | null>(null);
  const [w8ActionBusyId, setW8ActionBusyId] = useState<string | null>(null);
  const [w8ActionError, setW8ActionError] = useState<string | null>(null);
  const [w8PreviewOpen, setW8PreviewOpen] = useState(false);
  const [w8PreviewPdfUrl, setW8PreviewPdfUrl] = useState<string | null>(null);
  const [w8DocPreview, setW8DocPreview] = useState<SignableDocument | null>(null);
  const [w8PreviewLoading, setW8PreviewLoading] = useState(false);
  const filteredW8Recipients = useMemo(
    () => employees.filter((e) => e.name.toLowerCase().includes(w8RecipientSearch.toLowerCase())),
    [employees, w8RecipientSearch]
  );

  const W8_BLANK_ADDRESS: W8benAddress = { street: "", cityStateZip: "", country: "" };
  /** What the recipient sees before they've filled anything in — just their name pre-filled, everything else blank (including Part II, which they fill in themselves like the rest of the form). */
  const buildW8benPreviewData = (employeeName: string): W8benFormData => ({
    employeeId: "",
    employeeName,
    countryOfCitizenship: "",
    permanentAddress: { ...W8_BLANK_ADDRESS },
    mailingAddress: { ...W8_BLANK_ADDRESS },
    usTin: "",
    ftin: "",
    ftinNotRequired: false,
    referenceNumbers: "",
    dateOfBirth: "",
    treatyResidentCountry: "",
    treatyArticleParagraph: "",
    treatyRate: "",
    treatyIncomeType: "",
    treatyAdditionalConditions: "",
    certifiedTrue: false,
    dateSigned: "",
  });

  const closeW8benPreview = () => {
    setW8PreviewOpen(false);
    if (w8PreviewPdfUrl) URL.revokeObjectURL(w8PreviewPdfUrl);
    setW8PreviewPdfUrl(null);
  };

  /** Renders the SAME real official PDF (fillW8benPdf, no HTML redraw) with a blank preview fill, so what HR previews is exactly what gets generated when the recipient actually submits. */
  const handleOpenW8benPreview = async () => {
    setW8SendError(null);
    setW8PreviewOpen(true);
    setW8PreviewLoading(true);
    try {
      const recipientName = employees.find((e) => e.id === w8RecipientId)?.name || "";
      const pdfBytes = await fillW8benPdf(buildW8benPreviewData(recipientName));
      const url = URL.createObjectURL(new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));
      setW8PreviewPdfUrl(url);
    } catch (err) {
      setW8SendError(err instanceof Error ? err.message : "Failed to build preview.");
    } finally {
      setW8PreviewLoading(false);
    }
  };

  const handleSendW8ben = async () => {
    if (!w8RecipientId || !uid) return;
    setW8Sending(true);
    setW8SendError(null);
    try {
      const recipient = employees.find((e) => e.id === w8RecipientId);
      if (!recipient) throw new Error("Select a recipient first.");

      const doc = await createSignableDocument({
        documentType: "w8ben",
        formData: { employeeId: recipient.id, employeeName: recipient.name } as unknown as Record<string, any>,
        recipientId: w8RecipientId,
        recipientSlot: "employee",
        pdfUrl: "",
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, w8RecipientId);
      const fillLink = `${getAppUrl()}/fill-w8ben/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📋 Please complete your Form W-8BEN (Certificate of Foreign Status): ${fillLink}`,
      });

      void logActivity({ action: "w8ben_form_sent", targetType: "employee", targetId: recipient.id, targetLabel: recipient.name });

      closeW8benPreview();
      setW8RecipientId("");
      setW8RecipientSearch("");
      await loadSentW8benForms();
    } catch (err) {
      setW8SendError(err instanceof Error ? err.message : "Failed to send W-8BEN request.");
    } finally {
      setW8Sending(false);
    }
  };

  const handleCopyW8benLink = async (doc: SignableDocument) => {
    try {
      await navigator.clipboard.writeText(`${getAppUrl()}/fill-w8ben/${doc.id}`);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  /** Forces a real download instead of just opening the PDF in a new tab — same fallback as the Warning Form's download action. */
  const handleDownloadW8benPdf = async (doc: SignableDocument) => {
    if (!doc.pdfUrl) return;
    const employeeName = (doc.formData as Partial<W8benFormData>).employeeName || "w8ben-form";
    try {
      const res = await fetch(doc.pdfUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `W-8BEN - ${employeeName}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(doc.pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleDeleteW8ben = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this W-8BEN request?")) return;
    setW8ActionBusyId(doc.id);
    setW8ActionError(null);
    try {
      await deleteSignableDocument(doc.id);
      await loadSentW8benForms();
    } catch (err) {
      setW8ActionError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setW8ActionBusyId(null);
    }
  };

  // ── W-4 — same pattern as W-8BEN above: HR just picks a recipient, the
  // recipient fills in everything themselves on FillW4Page.tsx. ──
  const [w8FormType, setW8FormType] = useState<"w8ben" | "w4" | "w9">("w8ben");
  const [sentW4Forms, setSentW4Forms] = useState<SignableDocument[]>([]);
  const loadSentW4Forms = async () => {
    try {
      setSentW4Forms(await getSignableDocuments("w4"));
    } catch (err) {
      console.error("Failed to load sent W-4 forms:", err);
    }
  };
  useEffect(() => {
    if (activeTab === "w8ben") void loadSentW4Forms();
  }, [activeTab]);

  const [w4RecipientId, setW4RecipientId] = useState("");
  const [w4RecipientSearch, setW4RecipientSearch] = useState("");
  const [w4RecipientDropdownOpen, setW4RecipientDropdownOpen] = useState(false);
  const [w4Sending, setW4Sending] = useState(false);
  const [w4SendError, setW4SendError] = useState<string | null>(null);
  const [w4ActionBusyId, setW4ActionBusyId] = useState<string | null>(null);
  const [w4ActionError, setW4ActionError] = useState<string | null>(null);
  const [w4PreviewOpen, setW4PreviewOpen] = useState(false);
  const [w4PreviewPdfUrl, setW4PreviewPdfUrl] = useState<string | null>(null);
  const [w4PreviewLoading, setW4PreviewLoading] = useState(false);
  const [w4DocPreview, setW4DocPreview] = useState<SignableDocument | null>(null);
  const filteredW4Recipients = useMemo(
    () => employees.filter((e) => e.name.toLowerCase().includes(w4RecipientSearch.toLowerCase())),
    [employees, w4RecipientSearch]
  );

  const buildW4PreviewData = (employeeName: string): W4FormData => {
    const [first, ...rest] = employeeName.split(" ");
    return {
      employeeId: "",
      firstNameMiddleInitial: first ?? "",
      lastName: rest.join(" "),
      ssn: "",
      address: "",
      cityStateZip: "",
      filingStatus: "",
      multipleJobsCheckbox: false,
      step3ChildrenAmount: "",
      step3OtherDependentsAmount: "",
      step3TotalAmount: "",
      step4aOtherIncome: "",
      step4bDeductions: "",
      step4cExtraWithholding: "",
      exemptCheckbox: false,
      dateSigned: "",
      signatureDataUrl: "",
      employerNameAndAddress: "",
      employerFirstDateOfEmployment: "",
      employerEin: "",
      mjwLine1: "",
      mjwLine2a: "",
      mjwLine2b: "",
      mjwLine2c: "",
      mjwLine3: "",
      mjwLine4: "",
      dwLine1a: "",
      dwLine1b: "",
      dwLine1c: "",
      dwLine2: "",
      dwLine3a: "",
      dwLine3b: "",
      dwLine4: "",
      dwLine5: "",
      dwLine6a: "",
      dwLine6b: "",
      dwLine6c: "",
      dwLine6d: "",
      dwLine6e: "",
      dwLine7: "",
      dwLine8a: "",
      dwLine8b: "",
      dwLine9: "",
      dwLine10: "",
      dwLine11: "",
      dwLine12: "",
      dwLine13: "",
      dwLine14: "",
      dwLine15: "",
    };
  };

  const closeW4Preview = () => {
    setW4PreviewOpen(false);
    if (w4PreviewPdfUrl) URL.revokeObjectURL(w4PreviewPdfUrl);
    setW4PreviewPdfUrl(null);
  };

  const handleOpenW4Preview = async () => {
    setW4SendError(null);
    setW4PreviewOpen(true);
    setW4PreviewLoading(true);
    try {
      const recipientName = employees.find((e) => e.id === w4RecipientId)?.name || "";
      const pdfBytes = await fillW4Pdf(buildW4PreviewData(recipientName));
      const url = URL.createObjectURL(new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));
      setW4PreviewPdfUrl(url);
    } catch (err) {
      setW4SendError(err instanceof Error ? err.message : "Failed to build preview.");
    } finally {
      setW4PreviewLoading(false);
    }
  };

  const handleSendW4 = async () => {
    if (!w4RecipientId || !uid) return;
    setW4Sending(true);
    setW4SendError(null);
    try {
      const recipient = employees.find((e) => e.id === w4RecipientId);
      if (!recipient) throw new Error("Select a recipient first.");

      const doc = await createSignableDocument({
        documentType: "w4",
        formData: { employeeId: recipient.id } as unknown as Record<string, any>,
        recipientId: w4RecipientId,
        recipientSlot: "employee",
        pdfUrl: "",
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, w4RecipientId);
      const fillLink = `${getAppUrl()}/fill-w4/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📋 Please complete your Form W-4 (Employee's Withholding Certificate): ${fillLink}`,
      });

      void logActivity({ action: "w4_form_sent", targetType: "employee", targetId: recipient.id, targetLabel: recipient.name });

      closeW4Preview();
      setW4RecipientId("");
      setW4RecipientSearch("");
      await loadSentW4Forms();
    } catch (err) {
      setW4SendError(err instanceof Error ? err.message : "Failed to send W-4 request.");
    } finally {
      setW4Sending(false);
    }
  };

  const handleCopyW4Link = async (doc: SignableDocument) => {
    try {
      await navigator.clipboard.writeText(`${getAppUrl()}/fill-w4/${doc.id}`);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleDownloadW4Pdf = async (doc: SignableDocument) => {
    if (!doc.pdfUrl) return;
    const data = doc.formData as Partial<W4FormData>;
    const employeeName = `${data.firstNameMiddleInitial ?? ""} ${data.lastName ?? ""}`.trim() || "w4-form";
    try {
      const res = await fetch(doc.pdfUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `W-4 - ${employeeName}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(doc.pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleDeleteW4 = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this W-4 request?")) return;
    setW4ActionBusyId(doc.id);
    setW4ActionError(null);
    try {
      await deleteSignableDocument(doc.id);
      await loadSentW4Forms();
    } catch (err) {
      setW4ActionError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setW4ActionBusyId(null);
    }
  };

  // ── W-9 — same pattern as W-8BEN/W-4 above: HR just picks a recipient,
  // the recipient fills in everything themselves on FillW9Page.tsx. No
  // later "HR completes a section" step, unlike the W-4's Employers Only
  // box. ──
  const [sentW9Forms, setSentW9Forms] = useState<SignableDocument[]>([]);
  const loadSentW9Forms = async () => {
    try {
      setSentW9Forms(await getSignableDocuments("w9"));
    } catch (err) {
      console.error("Failed to load sent W-9 forms:", err);
    }
  };
  useEffect(() => {
    if (activeTab === "w8ben") void loadSentW9Forms();
  }, [activeTab]);

  const [w9RecipientId, setW9RecipientId] = useState("");
  const [w9RecipientSearch, setW9RecipientSearch] = useState("");
  const [w9RecipientDropdownOpen, setW9RecipientDropdownOpen] = useState(false);
  const [w9Sending, setW9Sending] = useState(false);
  const [w9SendError, setW9SendError] = useState<string | null>(null);
  const [w9ActionBusyId, setW9ActionBusyId] = useState<string | null>(null);
  const [w9ActionError, setW9ActionError] = useState<string | null>(null);
  const [w9PreviewOpen, setW9PreviewOpen] = useState(false);
  const [w9PreviewPdfUrl, setW9PreviewPdfUrl] = useState<string | null>(null);
  const [w9PreviewLoading, setW9PreviewLoading] = useState(false);
  const [w9DocPreview, setW9DocPreview] = useState<SignableDocument | null>(null);
  const filteredW9Recipients = useMemo(
    () => employees.filter((e) => e.name.toLowerCase().includes(w9RecipientSearch.toLowerCase())),
    [employees, w9RecipientSearch]
  );

  const buildW9PreviewData = (name: string): W9FormData => ({
    employeeId: "",
    name,
    businessName: "",
    taxClassification: "",
    llcTaxClassificationCode: "",
    otherClassificationText: "",
    foreignPartnersCheckbox: false,
    exemptPayeeCode: "",
    fatcaExemptionCode: "",
    address: "",
    cityStateZip: "",
    accountNumbers: "",
    requesterNameAddress: "",
    ssnPart1: "",
    ssnPart2: "",
    ssnPart3: "",
    einPart1: "",
    einPart2: "",
    dateSigned: "",
    signatureDataUrl: "",
  });

  const closeW9Preview = () => {
    setW9PreviewOpen(false);
    if (w9PreviewPdfUrl) URL.revokeObjectURL(w9PreviewPdfUrl);
    setW9PreviewPdfUrl(null);
  };

  const handleOpenW9Preview = async () => {
    setW9SendError(null);
    setW9PreviewOpen(true);
    setW9PreviewLoading(true);
    try {
      const recipientName = employees.find((e) => e.id === w9RecipientId)?.name || "";
      const pdfBytes = await fillW9Pdf(buildW9PreviewData(recipientName));
      const url = URL.createObjectURL(new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));
      setW9PreviewPdfUrl(url);
    } catch (err) {
      setW9SendError(err instanceof Error ? err.message : "Failed to build preview.");
    } finally {
      setW9PreviewLoading(false);
    }
  };

  const handleSendW9 = async () => {
    if (!w9RecipientId || !uid) return;
    setW9Sending(true);
    setW9SendError(null);
    try {
      const recipient = employees.find((e) => e.id === w9RecipientId);
      if (!recipient) throw new Error("Select a recipient first.");

      const doc = await createSignableDocument({
        documentType: "w9",
        formData: { employeeId: recipient.id } as unknown as Record<string, any>,
        recipientId: w9RecipientId,
        recipientSlot: "employee",
        pdfUrl: "",
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, w9RecipientId);
      const fillLink = `${getAppUrl()}/fill-w9/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📋 Please complete your Form W-9 (Request for Taxpayer Identification Number and Certification): ${fillLink}`,
      });

      void logActivity({ action: "w9_form_sent", targetType: "employee", targetId: recipient.id, targetLabel: recipient.name });

      closeW9Preview();
      setW9RecipientId("");
      setW9RecipientSearch("");
      await loadSentW9Forms();
    } catch (err) {
      setW9SendError(err instanceof Error ? err.message : "Failed to send W-9 request.");
    } finally {
      setW9Sending(false);
    }
  };

  const handleCopyW9Link = async (doc: SignableDocument) => {
    try {
      await navigator.clipboard.writeText(`${getAppUrl()}/fill-w9/${doc.id}`);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleDownloadW9Pdf = async (doc: SignableDocument) => {
    if (!doc.pdfUrl) return;
    const data = doc.formData as Partial<W9FormData>;
    const name = data.name || "w9-form";
    try {
      const res = await fetch(doc.pdfUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `W-9 - ${name}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(doc.pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleDeleteW9 = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this W-9 request?")) return;
    setW9ActionBusyId(doc.id);
    setW9ActionError(null);
    try {
      await deleteSignableDocument(doc.id);
      await loadSentW9Forms();
    } catch (err) {
      setW9ActionError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setW9ActionBusyId(null);
    }
  };

  // ── HR completing the W-4's "Employers Only" box after the employee has
  // already submitted. Regenerates the whole PDF fresh from the
  // ALREADY-STORED formData (a plain same-origin Supabase read) plus the
  // newly-typed employer fields, via the same fillW4Pdf the employee's own
  // submission used — never fetches the previously-generated PDF back from
  // Firebase Storage, so there's no CORS setup needed for this feature at
  // all. The employee's signature is redrawn from formData.signatureDataUrl
  // (a data: URL, always same-origin-safe to fetch — see
  // w4FormTemplate.ts's header comment). ──
  const [w4EmployerDialog, setW4EmployerDialog] = useState<SignableDocument | null>(null);
  const [w4EmployerNameAddress, setW4EmployerNameAddress] = useState("");
  const [w4EmployerFirstDate, setW4EmployerFirstDate] = useState("");
  const [w4EmployerEin, setW4EmployerEin] = useState("");
  const [w4EmployerSaving, setW4EmployerSaving] = useState(false);
  const [w4EmployerError, setW4EmployerError] = useState<string | null>(null);

  const handleOpenW4EmployerDialog = (doc: SignableDocument) => {
    setW4EmployerDialog(doc);
    setW4EmployerNameAddress("");
    setW4EmployerFirstDate("");
    setW4EmployerEin("");
    setW4EmployerError(null);
  };

  const handleSaveW4EmployerInfo = async () => {
    if (!w4EmployerDialog) return;
    setW4EmployerSaving(true);
    setW4EmployerError(null);
    try {
      const data = w4EmployerDialog.formData as W4FormData;
      const merged: W4FormData = {
        ...data,
        employerNameAndAddress: w4EmployerNameAddress,
        employerFirstDateOfEmployment: w4EmployerFirstDate,
        employerEin: w4EmployerEin,
      };
      const sigBytes = data.signatureDataUrl
        ? new Uint8Array(await (await fetch(data.signatureDataUrl)).arrayBuffer())
        : undefined;
      const pdfBytes = await fillW4Pdf(merged, sigBytes);
      const employeeName = `${data.firstNameMiddleInitial ?? ""} ${data.lastName ?? ""}`.trim();
      const pdfUrl = await uploadW4Form(w4EmployerDialog.companyId, employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));
      await updateSignableDocumentPdfUrl(w4EmployerDialog.id, pdfUrl, merged as unknown as Record<string, any>);
      setW4EmployerDialog(null);
      await loadSentW4Forms();
    } catch (err) {
      setW4EmployerError(err instanceof Error ? err.message : "Failed to save employer info.");
    } finally {
      setW4EmployerSaving(false);
    }
  };

  const handleSendWarningForm = async () => {
    if (!warnForm.employeeId || !warnRecipientId || !uid) return;
    setWarnSending(true);
    setWarnSendError(null);
    try {
      const recipient = employees.find((e) => e.id === warnRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");

      const formData = buildWarnFormData(warnRecipientSlot, recipient.name);
      const pdfBlob = await captureHtmlToPdfBlob(buildWarningFormBodyMarkup(formData, warnLogoDataUrl, {}), warningFormStyles);
      const pdfUrl = await uploadWarningForm(companyId ?? "", warnForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "warning_form",
        formData: formData as unknown as Record<string, any>,
        recipientId: warnRecipientId,
        recipientSlot: warnRecipientSlot,
        pdfUrl,
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, warnRecipientId);
      const signLink = `${getAppUrl()}/sign-document/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `⚠️ Employee Warning Form for ${warnForm.employeeName} needs your signature. Review and sign here: ${signLink}`,
      });

      void logActivity({ action: "warning_form_sent", targetType: "employee", targetId: warnForm.employeeId, targetLabel: warnForm.employeeName, details: { to: recipient.name, slot: warnRecipientSlot } });

      setWarnPreviewOpen(false);
      setWarnForm({
        employeeId: "",
        employeeName: "",
        role: "",
        branch: "",
        warningDate: todayStr,
        level: "",
        reasons: { absence: false, tardiness: false, inappropriateBehavior: false, insubordination: false, policyViolation: false, equipmentDamage: false, other: false },
        otherReasonText: "",
        description: "",
        correctiveActions: "",
      });
      await loadSentWarningForms();
    } catch (err) {
      setWarnSendError(err instanceof Error ? err.message : "Failed to send warning form.");
    } finally {
      setWarnSending(false);
    }
  };

  // ── Sent Warning Forms tracking table actions ──
  const [warnActionBusyId, setWarnActionBusyId] = useState<string | null>(null);
  const [warnActionError, setWarnActionError] = useState<string | null>(null);

  const handleConfirmWarningForm = async (doc: SignableDocument) => {
    if (!window.confirm("Confirm this warning? This finalizes it and adds it to the employee's official warning record.")) return;
    setWarnActionBusyId(doc.id);
    setWarnActionError(null);
    try {
      const data = doc.formData as unknown as WarningFormData;
      const noteText = buildWarnNoteText(data);
      const noteId = await addAgentNote({ agentProfileId: data.employeeId, type: "warning", note: noteText, fastTrackToApproved: true });
      await confirmSignableDocument(doc.id, noteId);
      await Promise.all([loadSentWarningForms(), (async () => setAllNotes(await getAllAgentNotes()))()]);
      void logActivity({ action: "warning_form_confirmed", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setWarnActionError(err instanceof Error ? err.message : "Failed to confirm warning.");
    } finally {
      setWarnActionBusyId(null);
    }
  };

  // Same underlying action (retract any logged note + mark cancelled) for
  // both "Cancel Warning" (before it's been confirmed) and "Revert
  // Warning" (undoing one that was already confirmed) — just different
  // wording depending on which state it's coming from.
  const handleCancelWarningForm = async (doc: SignableDocument) => {
    const isRevert = doc.status === "confirmed";
    const message = isRevert
      ? "Revert this confirmed warning? It will be retracted from the employee's official record — their warning count drops back down accordingly."
      : "Cancel this warning form? This voids it entirely — if it was somehow already logged, that record is also removed.";
    if (!window.confirm(message)) return;
    setWarnActionBusyId(doc.id);
    setWarnActionError(null);
    try {
      await cancelSignableDocument(doc.id);
      await Promise.all([loadSentWarningForms(), (async () => setAllNotes(await getAllAgentNotes()))()]);
      const data = doc.formData as unknown as WarningFormData;
      void logActivity({ action: isRevert ? "warning_form_reverted" : "warning_form_cancelled", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setWarnActionError(err instanceof Error ? err.message : `Failed to ${isRevert ? "revert" : "cancel"} warning form.`);
    } finally {
      setWarnActionBusyId(null);
    }
  };

  /** Permanently erases the whole document — for when it was raised entirely in error and shouldn't leave a trace, not even a "cancelled" row. */
  const handleDeleteWarningForm = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this warning form? This can't be undone — it removes the record entirely, including any logged warning against the employee.")) return;
    setWarnActionBusyId(doc.id);
    setWarnActionError(null);
    try {
      await deleteSignableDocument(doc.id);
      setSentWarningForms((prev) => prev.filter((d) => d.id !== doc.id));
      setAllNotes(await getAllAgentNotes());
      const data = doc.formData as unknown as WarningFormData;
      void logActivity({ action: "warning_form_deleted", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setWarnActionError(err instanceof Error ? err.message : "Failed to delete warning form.");
    } finally {
      setWarnActionBusyId(null);
    }
  };

  const [reassignDialog, setReassignDialog] = useState<SignableDocument | null>(null);
  const [reassignRecipientId, setReassignRecipientId] = useState("");
  const [reassignRecipientSearch, setReassignRecipientSearch] = useState("");
  const [reassignRecipientDropdownOpen, setReassignRecipientDropdownOpen] = useState(false);
  const [reassignSlot, setReassignSlot] = useState<SignatureSlot>("senior_manager");
  const filteredReassignRecipients = useMemo(() => {
    const q = reassignRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, reassignRecipientSearch]);

  const handleSendToNextRecipient = async () => {
    if (!reassignDialog || !reassignRecipientId || !uid) return;
    setWarnActionBusyId(reassignDialog.id);
    setWarnActionError(null);
    try {
      const recipient = employees.find((e) => e.id === reassignRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");
      await reassignSignableDocument(reassignDialog.id, reassignRecipientId, reassignSlot);

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, reassignRecipientId);
      const employeeName = (reassignDialog.formData as unknown as WarningFormData).employeeName || "the employee";
      const signLink = `${getAppUrl()}/sign-document/${reassignDialog.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `⚠️ Employee Warning Form for ${employeeName} needs your signature. Review and sign here: ${signLink}`,
      });

      void logActivity({ action: "warning_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: recipient.name, slot: reassignSlot } });

      setReassignDialog(null);
      setReassignRecipientId("");
      setReassignRecipientSearch("");
      await loadSentWarningForms();
    } catch (err) {
      setWarnActionError(err instanceof Error ? err.message : "Failed to send to next recipient.");
    } finally {
      setWarnActionBusyId(null);
    }
  };

  /**
   * Plain CSV can't carry color — there's no such thing as a "colored cell"
   * in comma-separated text. Excel (and Sheets) will happily open an HTML
   * table saved with a .xls extension and render its inline styles as real
   * colored cells, so we build the same colored/bordered look as the PDF
   * this way instead of pulling in a binary xlsx-writing library.
   */
  const downloadHiringReportExcel = () => {
    const html = `
      <html>
        <head><meta charset="UTF-8"></head>
        <body>
          <table border="0" cellspacing="0" cellpadding="6" style="border-collapse:collapse; font-family:Arial,Helvetica,sans-serif;">
            <tr><td colspan="2" style="background:#1e40af; color:white; font-size:18px; font-weight:bold; padding:10px;">AHS SYSTEM</td></tr>
            <tr><td colspan="2" style="background:#1e40af; color:#e0e7ff; font-size:13px; padding:4px 10px 10px;">HIRING REPORT</td></tr>
            <tr><td style="font-weight:bold; color:#1e40af;">Report Range</td><td>${escapeHtml(reportRangeLabel)}</td></tr>
            <tr><td style="font-weight:bold; color:#1e40af;">Generated</td><td>${escapeHtml(new Date().toLocaleString())}</td></tr>
            <tr><td colspan="2">&nbsp;</td></tr>
            <tr>
              <td style="background:#1e40af; color:white; font-weight:bold; border:1px solid #1e40af;">Metric</td>
              <td style="background:#1e40af; color:white; font-weight:bold; border:1px solid #1e40af; text-align:right;">Total</td>
            </tr>
            ${hiringReportRows.map(([label, value], i) => `
            <tr style="${i % 2 === 1 ? "background:#f9fafb;" : ""}">
              <td style="border:1px solid #e5e7eb;">${escapeHtml(label)}</td>
              <td style="border:1px solid #e5e7eb; text-align:right; font-weight:bold; color:${hiringReportColors[label] ?? "#111827"};">${value}</td>
            </tr>`).join("")}
          </table>
        </body>
      </html>
    `;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hiring-report-${reportFrom}_to_${reportTo}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadHiringReportPdf = async () => {
    // Same logo + container styling as downloadSubmissionPdf, so every
    // generated document in this app reads as one consistent system.
    const logoDataUrl = await loadLogoDataUrl();
    openPrintWindow(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Hiring Report</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: white; padding: 10px; color: #1f2937; }
            .container { max-width: 800px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; padding: 20px; }
            .header { display: flex; gap: 15px; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 8px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); }
            .header img { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
            .header h1 { color: white; font-size: 22px; letter-spacing: 0.5px; }
            .header p { color: #e0e7ff; font-size: 12px; margin-top: 2px; }
            .info-section { display: flex; flex-direction: column; gap: 4px; background: #eff6ff; border-left: 4px solid #1e40af; padding: 12px 14px; border-radius: 4px; margin-bottom: 20px; }
            .info-section label { font-size: 11px; color: #1e40af; text-transform: uppercase; font-weight: 700; }
            .info-section span { font-size: 15px; font-weight: 600; color: #1f2937; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            table th { background: #f3f4f6; color: #1f2937; padding: 8px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; border: 1px solid #e5e7eb; }
            table td { padding: 8px; border: 1px solid #e5e7eb; font-size: 13px; color: #374151; }
            table td.amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
            table tr:nth-child(even) { background: #fafafa; }
            .footer { text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10px; }
            @media print {
              body { padding: 0; }
              .container { border: none; padding: 20px; }
              .header, table th, .info-section { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" />` : ""}
              <div>
                <h1>HIRING REPORT</h1>
                <p>${escapeHtml(reportRangeLabel)}</p>
              </div>
            </div>

            <div class="info-section">
              <label>Report Range</label>
              <span>${escapeHtml(reportRangeLabel)}</span>
            </div>

            <table>
              <thead><tr><th>Metric</th><th style="text-align:right;">Total</th></tr></thead>
              <tbody>
                ${hiringReportRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="amount">${value}</td></tr>`).join("")}
              </tbody>
            </table>

            <div class="footer">Generated by AHS System &middot; ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </body>
      </html>
    `);
  };

  // ── Generate Report: EOD / EOM Hiring Grid — same Position → Branch table
  // shown on the EOD/EOM Reports tab, exportable independently of whatever
  // date/month is currently open there. Fetches fresh on demand rather than
  // reusing that tab's state, since a user may want to export a different
  // day/month than the one they're currently viewing. ──
  const [genEodDate, setGenEodDate] = useState(todayStr);
  const [genEomMonth, setGenEomMonth] = useState(todayStr.slice(0, 7));
  const [genEodBusy, setGenEodBusy] = useState<"excel" | "pdf" | null>(null);
  const [genEomBusy, setGenEomBusy] = useState<"excel" | "pdf" | null>(null);

  const formatTraineeCell = (r: EodHiringRow) => {
    if (r.onHold) return "On Hold";
    if (r.activeTrainees.length === 0) return "—";
    return r.activeTrainees.map((t) => `${t.name}${t.date ? ` (${new Date(t.date).toLocaleDateString()})` : ""}`).join("; ");
  };
  const formatInterviewCell = (r: EodHiringRow) =>
    r.scheduledInterviews.length === 0
      ? "—"
      : r.scheduledInterviews.map((t) => `${t.name}${t.date ? ` (${new Date(t.date).toLocaleDateString()})` : ""}`).join("; ");
  const formatCvCell = (r: EodHiringRow) =>
    r.cvsSentToBm.length === 0 ? "—" : r.cvsSentToBm.map((f) => `${f.candidateName} → ${f.recipientName}`).join("; ");

  /** Row markup shared by the EOD and EOM grid exports — same 6 columns, grouped under Position band rows. */
  const hiringGridTableHtml = (rows: EodHiringRow[]) => {
    const headerCell = `background:#1e40af;color:white;font-weight:bold;border:1px solid #1e40af;padding:8px;`;
    let html = `<tr>
      <td style="${headerCell}">Branch</td>
      <td style="${headerCell}">Sponsor End Date</td>
      <td style="${headerCell}text-align:right;">Staff Needed</td>
      <td style="${headerCell}">Active Trainee / On Hold</td>
      <td style="${headerCell}">Scheduled Interviews</td>
      <td style="${headerCell}">CVs Sent to BM</td>
    </tr>`;
    if (rows.length === 0) {
      html += `<tr><td colspan="6" style="border:1px solid #e5e7eb; padding:8px; text-align:center; color:#6b7280;">No hiring activity or Staff Needed targets for this period.</td></tr>`;
      return html;
    }
    rows.forEach((r, i) => {
      if (i === 0 || rows[i - 1].position !== r.position) {
        html += `<tr><td colspan="6" style="background:#dbeafe;color:#1e40af;font-weight:bold;border:1px solid #e5e7eb;padding:6px 8px;">${escapeHtml(r.position)}</td></tr>`;
      }
      html += `<tr style="${i % 2 === 1 ? "background:#f9fafb;" : ""}">
        <td style="border:1px solid #e5e7eb;padding:8px;font-weight:bold;">${escapeHtml(r.branch)}</td>
        <td style="border:1px solid #e5e7eb;padding:8px;color:#6b7280;">—</td>
        <td style="border:1px solid #e5e7eb;padding:8px;text-align:right;">${r.staffNeeded}</td>
        <td style="border:1px solid #e5e7eb;padding:8px;">${escapeHtml(formatTraineeCell(r))}</td>
        <td style="border:1px solid #e5e7eb;padding:8px;">${escapeHtml(formatInterviewCell(r))}</td>
        <td style="border:1px solid #e5e7eb;padding:8px;">${escapeHtml(formatCvCell(r))}</td>
      </tr>`;
    });
    return html;
  };

  const downloadHiringGridExcel = (rows: EodHiringRow[], reportName: string, periodLabel: string, filename: string) => {
    const html = `
      <html>
        <head><meta charset="UTF-8"></head>
        <body>
          <table border="0" cellspacing="0" cellpadding="6" style="border-collapse:collapse; font-family:Arial,Helvetica,sans-serif;">
            <tr><td colspan="6" style="background:#1e40af; color:white; font-size:18px; font-weight:bold; padding:10px;">AHS SYSTEM</td></tr>
            <tr><td colspan="6" style="background:#1e40af; color:#e0e7ff; font-size:13px; padding:4px 10px 10px;">${escapeHtml(reportName)}</td></tr>
            <tr><td style="font-weight:bold; color:#1e40af;">Period</td><td colspan="5">${escapeHtml(periodLabel)}</td></tr>
            <tr><td style="font-weight:bold; color:#1e40af;">Generated</td><td colspan="5">${escapeHtml(new Date().toLocaleString())}</td></tr>
            <tr><td colspan="6">&nbsp;</td></tr>
            ${hiringGridTableHtml(rows)}
          </table>
        </body>
      </html>
    `;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadHiringGridPdf = async (rows: EodHiringRow[], reportName: string, periodLabel: string) => {
    const logoDataUrl = await loadLogoDataUrl();
    openPrintWindow(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${escapeHtml(reportName)}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: white; padding: 10px; color: #1f2937; }
            .container { max-width: 1000px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; padding: 20px; }
            .header { display: flex; gap: 15px; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 8px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); }
            .header img { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
            .header h1 { color: white; font-size: 22px; letter-spacing: 0.5px; }
            .header p { color: #e0e7ff; font-size: 12px; margin-top: 2px; }
            .info-section { display: flex; flex-direction: column; gap: 4px; background: #eff6ff; border-left: 4px solid #1e40af; padding: 12px 14px; border-radius: 4px; margin-bottom: 20px; }
            .info-section label { font-size: 11px; color: #1e40af; text-transform: uppercase; font-weight: 700; }
            .info-section span { font-size: 15px; font-weight: 600; color: #1f2937; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
            .footer { text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10px; }
            @media print {
              body { padding: 0; }
              .container { border: none; padding: 20px; }
              .header, td { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" />` : ""}
              <div>
                <h1>${escapeHtml(reportName.toUpperCase())}</h1>
                <p>${escapeHtml(periodLabel)}</p>
              </div>
            </div>

            <div class="info-section">
              <label>Period</label>
              <span>${escapeHtml(periodLabel)}</span>
            </div>

            <table>${hiringGridTableHtml(rows)}</table>

            <div class="footer">Generated by AHS System &middot; ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </body>
      </html>
    `);
  };

  const downloadEodHiringReport = async (format: "excel" | "pdf") => {
    setGenEodBusy(format);
    try {
      const rows = await getEodHiringReport(genEodDate);
      if (format === "excel") downloadHiringGridExcel(rows, "EOD HIRING REPORT", genEodDate, `eod-hiring-report-${genEodDate}.xls`);
      else await downloadHiringGridPdf(rows, "EOD Hiring Report", genEodDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate EOD hiring report.");
    } finally {
      setGenEodBusy(null);
    }
  };

  const downloadEomHiringReport = async (format: "excel" | "pdf") => {
    setGenEomBusy(format);
    try {
      const rows = await getEomHiringReport(genEomMonth);
      if (format === "excel") downloadHiringGridExcel(rows, "EOM HIRING REPORT", genEomMonth, `eom-hiring-report-${genEomMonth}.xls`);
      else await downloadHiringGridPdf(rows, "EOM Hiring Report", genEomMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate EOM hiring report.");
    } finally {
      setGenEomBusy(null);
    }
  };

  // ── Generate Report: Warnings & Mistakes — same date-range pattern as the
  // Hiring report above, and the same approved-notes-by-createdAt counting
  // the Warnings & Mistakes tab's own KPI tiles use. Independent range state
  // from that tab's filter since this is a separate export flow. ──
  const [wmReportFrom, setWmReportFrom] = useState(today);
  const [wmReportTo, setWmReportTo] = useState(today);
  const setWmReportRangeToday = () => { setWmReportFrom(today); setWmReportTo(today); };

  const wmReportKpi = useMemo(() => {
    const inRange = (n: CsrAgentNote) => {
      const d = n.createdAt.slice(0, 10);
      return n.status === "approved" && d >= wmReportFrom && d <= wmReportTo;
    };
    return {
      warnings: allNotes.filter((n) => n.type === "warning" && inRange(n)).length,
      mistakes: allNotes.filter((n) => n.type === "mistake" && inRange(n)).length,
    };
  }, [allNotes, wmReportFrom, wmReportTo]);
  const wmReportRangeLabel = wmReportFrom === wmReportTo ? wmReportFrom : `${wmReportFrom} to ${wmReportTo}`;
  const wmReportRows: [string, number][] = [
    ["Warnings", wmReportKpi.warnings],
    ["Mistakes", wmReportKpi.mistakes],
  ];
  const wmReportColors: Record<string, string> = { "Warnings": "#ca8a04", "Mistakes": "#ea580c" };

  const downloadWmReportExcel = () => {
    const html = `
      <html>
        <head><meta charset="UTF-8"></head>
        <body>
          <table border="0" cellspacing="0" cellpadding="6" style="border-collapse:collapse; font-family:Arial,Helvetica,sans-serif;">
            <tr><td colspan="2" style="background:#1e40af; color:white; font-size:18px; font-weight:bold; padding:10px;">AHS SYSTEM</td></tr>
            <tr><td colspan="2" style="background:#1e40af; color:#e0e7ff; font-size:13px; padding:4px 10px 10px;">WARNINGS &amp; MISTAKES REPORT</td></tr>
            <tr><td style="font-weight:bold; color:#1e40af;">Report Range</td><td>${escapeHtml(wmReportRangeLabel)}</td></tr>
            <tr><td style="font-weight:bold; color:#1e40af;">Generated</td><td>${escapeHtml(new Date().toLocaleString())}</td></tr>
            <tr><td colspan="2">&nbsp;</td></tr>
            <tr>
              <td style="background:#1e40af; color:white; font-weight:bold; border:1px solid #1e40af;">Metric</td>
              <td style="background:#1e40af; color:white; font-weight:bold; border:1px solid #1e40af; text-align:right;">Total</td>
            </tr>
            ${wmReportRows.map(([label, value], i) => `
            <tr style="${i % 2 === 1 ? "background:#f9fafb;" : ""}">
              <td style="border:1px solid #e5e7eb;">${escapeHtml(label)}</td>
              <td style="border:1px solid #e5e7eb; text-align:right; font-weight:bold; color:${wmReportColors[label] ?? "#111827"};">${value}</td>
            </tr>`).join("")}
          </table>
        </body>
      </html>
    `;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warnings-mistakes-report-${wmReportFrom}_to_${wmReportTo}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadWmReportPdf = async () => {
    let logoDataUrl = "";
    try {
      const logoModule = await import("@/assets/logo.png");
      const res = await fetch(logoModule.default);
      const blob = await res.blob();
      logoDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      // Logo is cosmetic — proceed without it if it fails to load.
    }

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Warnings & Mistakes Report</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: white; padding: 10px; color: #1f2937; }
            .container { max-width: 800px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; padding: 20px; }
            .header { display: flex; gap: 15px; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 8px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); }
            .header img { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
            .header h1 { color: white; font-size: 22px; letter-spacing: 0.5px; }
            .header p { color: #e0e7ff; font-size: 12px; margin-top: 2px; }
            .info-section { display: flex; flex-direction: column; gap: 4px; background: #eff6ff; border-left: 4px solid #1e40af; padding: 12px 14px; border-radius: 4px; margin-bottom: 20px; }
            .info-section label { font-size: 11px; color: #1e40af; text-transform: uppercase; font-weight: 700; }
            .info-section span { font-size: 15px; font-weight: 600; color: #1f2937; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            table th { background: #f3f4f6; color: #1f2937; padding: 8px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; border: 1px solid #e5e7eb; }
            table td { padding: 8px; border: 1px solid #e5e7eb; font-size: 13px; color: #374151; }
            table td.amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
            table tr:nth-child(even) { background: #fafafa; }
            .footer { text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10px; }
            @media print {
              body { padding: 0; }
              .container { border: none; padding: 20px; }
              .header, table th, .info-section { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" />` : ""}
              <div>
                <h1>WARNINGS &amp; MISTAKES REPORT</h1>
                <p>${escapeHtml(wmReportRangeLabel)}</p>
              </div>
            </div>

            <div class="info-section">
              <label>Report Range</label>
              <span>${escapeHtml(wmReportRangeLabel)}</span>
            </div>

            <table>
              <thead><tr><th>Metric</th><th style="text-align:right;">Total</th></tr></thead>
              <tbody>
                ${wmReportRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="amount">${value}</td></tr>`).join("")}
              </tbody>
            </table>

            <div class="footer">Generated by AHS System &middot; ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </body>
      </html>
    `);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
    win.onafterprint = () => win.close();
  };

  const handleAddCandidate = async () => {
    if (!newCandidate.name.trim()) return;
    setSavingCandidate(true);
    setError(null);
    try {
      const created = await addCandidate(newCandidate);
      // The candidate row is saved at this point — close the form and
      // refresh the list regardless of what happens next, so a CV upload
      // failure doesn't strand the UI on a stale, still-open form.
      setNewCandidate({ name: "", phone: "", email: "", position: "", branch: "" });
      setCvFile(null);
      setShowAddCandidate(false);
      await loadCandidates();
      void logActivity({ action: "candidate_added", targetType: "candidate", targetId: created.id, targetLabel: created.name });

      if (cvFile && created.companyId) {
        try {
          // Use the company_id the server actually stamped on the row
          // (set by the DB trigger in this same request) rather than the
          // client's cached auth context — guaranteed to match what the
          // Storage RLS policy checks against, no staleness possible.
          await uploadCandidateCv(created.id, created.companyId, cvFile);
          await loadCandidates();
        } catch (err) {
          setError(`${created.name} was added, but the CV upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add candidate.");
    } finally {
      setSavingCandidate(false);
    }
  };

  // Interviewing/Training require an accompanying date — instead of saving
  // immediately, open a small dialog to collect it first.
  const [statusDateDialog, setStatusDateDialog] = useState<{ candidateId: string; candidateName: string; status: CandidateStatus; label: string; date: string } | null>(null);

  const handleCandidateStatus = async (id: string, status: CandidateStatus) => {
    const requiredLabel = STATUS_REQUIRES_DATE[status];
    if (requiredLabel) {
      const candidate = candidates.find((c) => c.id === id);
      const existingDate = status === "interviewing" ? candidate?.interviewDate : candidate?.trainingStartDate;
      setStatusDateDialog({ candidateId: id, candidateName: candidate?.name || "", status, label: requiredLabel, date: existingDate || today });
      return;
    }
    try {
      await updateCandidateStatus(id, status);
      await loadCandidates();
      const candidate = candidates.find((c) => c.id === id);
      void logActivity({ action: "candidate_status_changed", targetType: "candidate", targetId: id, targetLabel: candidate?.name, details: { status } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update candidate status.");
    }
  };

  const handleConfirmStatusDate = async () => {
    if (!statusDateDialog) return;
    try {
      await updateCandidateStatus(statusDateDialog.candidateId, statusDateDialog.status, statusDateDialog.date);
      await loadCandidates();
      void logActivity({
        action: "candidate_status_changed",
        targetType: "candidate",
        targetId: statusDateDialog.candidateId,
        targetLabel: statusDateDialog.candidateName,
        details: { status: statusDateDialog.status, date: statusDateDialog.date },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update candidate status.");
    } finally {
      setStatusDateDialog(null);
    }
  };

  // ── EOD/EOM Hiring Reports ──
  const [hiringReportMode, setHiringReportMode] = useState<"eod" | "eom">("eod");
  const [eodDate, setEodDate] = useState(today);
  const [eomMonth, setEomMonth] = useState(today.slice(0, 7));
  const [eodRows, setEodRows] = useState<EodHiringRow[]>([]);
  const [eomRows, setEomRows] = useState<EodHiringRow[]>([]);
  const [hiringDetailDialog, setHiringDetailDialog] = useState<{ title: string; items: { name: string; date: string | null }[] } | null>(null);
  const [cvForwardDetailDialog, setCvForwardDetailDialog] = useState<{ title: string; items: CvForwardDetail[] } | null>(null);
  const [eodLoading, setEodLoading] = useState(false);
  const [eomLoading, setEomLoading] = useState(false);

  const loadEodReport = async (date: string) => {
    setEodLoading(true);
    try {
      setEodRows(await getEodHiringReport(date));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load EOD report.");
    } finally {
      setEodLoading(false);
    }
  };

  const loadEomReport = async (yearMonth: string) => {
    setEomLoading(true);
    try {
      setEomRows(await getEomHiringReport(yearMonth));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load EOM report.");
    } finally {
      setEomLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "report") return;
    if (hiringReportMode === "eod") void loadEodReport(eodDate);
    else void loadEomReport(eomMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hiringReportMode, eodDate, eomMonth]);

  const handleStaffNeededChange = async (position: string, branch: string, value: number) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    setEodRows((prev) => prev.map((r) => (r.position === position && r.branch === branch ? { ...r, staffNeeded: safeValue } : r)));
    try {
      await setStaffingTarget(position, branch, safeValue);
      void logActivity({ action: "staffing_target_updated", targetType: "staffing_target", targetLabel: `${position} — ${branch}`, details: { staffNeeded: safeValue } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Staff Needed.");
      void loadEodReport(eodDate);
    }
  };

  const handleDeleteCandidate = async (id: string) => {
    try {
      const candidate = candidates.find((c) => c.id === id);
      await deleteCandidate(id);
      await loadCandidates();
      void logActivity({ action: "candidate_deleted", targetType: "candidate", targetId: id, targetLabel: candidate?.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete candidate.");
    }
  };

  const handleViewCv = async (cvPath: string) => {
    try {
      const url = await getCandidateCvUrl(cvPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open CV.");
    }
  };

  // ── Forward CV to a manager via the internal messenger ──
  // "Manager" = any role containing "MANAGER" (Branch Manager, Parts
  // Manager, CSR Manager, Technician Manager, etc.) — matches the same
  // substring convention already used elsewhere in this file/app rather
  // than a hardcoded list, so it stays correct as new manager roles appear.
  const managerRecipients = useMemo(
    () => employees.filter((e) => normalizeRole(e.position).includes("MANAGER")).sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );
  const [forwardCvDialog, setForwardCvDialog] = useState<Candidate | null>(null);
  const [forwardRecipientId, setForwardRecipientId] = useState("");
  const [forwardRecipientSearch, setForwardRecipientSearch] = useState("");
  const [forwardRecipientDropdownOpen, setForwardRecipientDropdownOpen] = useState(false);
  const [forwardSending, setForwardSending] = useState(false);
  const filteredManagerRecipients = useMemo(() => {
    const q = forwardRecipientSearch.trim().toLowerCase();
    if (!q) return managerRecipients;
    return managerRecipients.filter(
      (m) => m.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(m.position)] ?? m.position).toLowerCase().includes(q)
    );
  }, [managerRecipients, forwardRecipientSearch]);

  const handleForwardCv = async () => {
    if (!forwardCvDialog?.cvPath || !forwardRecipientId || !uid) return;
    setForwardSending(true);
    try {
      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const cvUrl = await getCandidateCvUrlForForwarding(forwardCvDialog.cvPath);
      const thread = await getOrCreateDmThread(myProfileId, forwardRecipientId);
      const details = [forwardCvDialog.position, forwardCvDialog.branch].filter(Boolean).join(", ");
      // cvPath is "{companyId}/{candidateId}/{timestamp}_{originalFilename}"
      // (see uploadCandidateCv) — strip the leading timestamp so the link
      // label reads as the real filename, not a raw signed URL.
      const filename = (forwardCvDialog.cvPath.split("/").pop() || "CV").replace(/^\d+_/, "");
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📄 Candidate CV forwarded — ${forwardCvDialog.name}${details ? ` (${details})` : ""}: [${filename}](${cvUrl})`,
      });
      // Counted against the candidate's own Position+Branch on the EOD/EOM
      // "CVs Sent to BM" column — best-effort, a logging failure shouldn't
      // undo the fact the message already sent successfully.
      try {
        await logCvForward(forwardCvDialog.id, forwardCvDialog.position, forwardCvDialog.branch, forwardRecipientId);
      } catch (logErr) {
        console.error("Failed to log CV forward for reporting:", logErr);
      }
      const recipientName = managerRecipients.find((m) => m.id === forwardRecipientId)?.name;
      void logActivity({ action: "candidate_cv_forwarded", targetType: "candidate", targetId: forwardCvDialog.id, targetLabel: forwardCvDialog.name, details: { to: recipientName ?? "" } });
      setForwardCvDialog(null);
      setForwardRecipientId("");
      setForwardRecipientSearch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to forward CV.");
    } finally {
      setForwardSending(false);
    }
  };

  // Branch Managers run the final interview and pick a candidate, but HR
  // finalizes the actual hire.
  const candidateStatusOptions = (isHrOrAdmin
    ? ["applied", "interviewing", "selected", "training", "on_hold", "hired", "rejected"]
    : ["interviewing", "selected", "training", "on_hold", "rejected"]) as CandidateStatus[];

  // ── Employee status handlers (now real — persists to employee_info + is_active) ──
  const handleUpdateEmployeeStatus = (id: string, newStatus: EmploymentStatus) => {
    if (newStatus === "terminated" || newStatus === "resigned") {
      const employee = employees.find(e => e.id === id);
      if (employee) setConfirmDialog({ show: true, employeeId: id, employeeName: employee.name, newStatus });
    } else {
      void persistEmployeeStatus(id, newStatus);
    }
  };

  const persistEmployeeStatus = async (id: string, newStatus: EmploymentStatus) => {
    try {
      const info = (await getProfileEmployeeInfo(id)) || {};
      await saveProfileEmployeeInfo(id, { ...info, employmentStatus: newStatus, employmentStatusDate: today });
      await updateCompanyUser(id, { isActive: newStatus === "active" });
      setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, status: newStatus, terminationDate: newStatus === "terminated" || newStatus === "resigned" ? today : e.terminationDate } : e)));
      const employeeName = employees.find((e) => e.id === id)?.name;
      void logActivity({ action: "employee_status_changed", targetType: "employee", targetId: id, targetLabel: employeeName, details: { status: newStatus } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update employment status.");
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!confirmDialog) return;
    await persistEmployeeStatus(confirmDialog.employeeId, confirmDialog.newStatus);
    setConfirmDialog(null);
  };

  const handleCancelStatusChange = () => setConfirmDialog(null);

  // ── Onboarding Documents: per-employee checklist, persisted on
  // employee_info (same flexible JSON field bank info/address/etc. already
  // live on) so no new table is needed. Merges into the cached full info
  // rather than the trimmed Employee row, so a toggle never clobbers other
  // saved fields like bank details or SSN. Grouped by role for
  // Technician/Parts Manager (their required paperwork differs), and by
  // country for Philippines (one shared list regardless of role there).
  // Parts Manager is the catch-all for every other US role — not just
  // PARTS_MANAGER — so nobody in the US falls through both tabs. ──
  const [onboardingGroup, setOnboardingGroup] = useState<"TECHNICIAN" | "PARTS_MANAGER" | "PH">("TECHNICIAN");
  const [onboardingSearch, setOnboardingSearch] = useState("");
  // Clicking a name drills into that applicant's document repository (drag-and-drop from the Jotform inbox + manual upload) instead of the checklist grid.
  const [onboardingSelectedEmployee, setOnboardingSelectedEmployee] = useState<{ id: string; name: string; docList: string[] } | null>(null);
  // Same US-Technician/US-other/PH split as onboardingEmployees above, just evaluated for one specific employee — used to pick their document list regardless of whichever group tab happens to be selected at click-time.
  const getOnboardingDocListForEmployee = (employee: { country: string; position: string }) =>
    employee.country === "PH" ? PH_ONBOARDING_DOCS
    : normalizeRole(employee.position) === "TECHNICIAN" ? TECHNICIAN_ONBOARDING_DOCS
    : PARTS_MANAGER_ONBOARDING_DOCS;
  const onboardingEmployees = useMemo(() => {
    const byGroup =
      onboardingGroup === "PH" ? employees.filter((e) => e.country === "PH")
      : onboardingGroup === "TECHNICIAN" ? employees.filter((e) => e.country === "US" && normalizeRole(e.position) === "TECHNICIAN")
      : employees.filter((e) => e.country === "US" && normalizeRole(e.position) !== "TECHNICIAN");
    const q = onboardingSearch.trim().toLowerCase();
    return q ? byGroup.filter((e) => e.name.toLowerCase().includes(q)) : byGroup;
  }, [employees, onboardingGroup, onboardingSearch]);

  // Restores which applicant's Onboarding Documents page was open (if any)
  // from the URL's ?profileId= — only once, as soon as employees has
  // loaded, using the same frozen initial search params as the tab restore
  // above. Runs once regardless of tab, since employees loads independently.
  const restoredOnboardingProfileRef = useRef(false);
  useEffect(() => {
    if (restoredOnboardingProfileRef.current || employees.length === 0) return;
    restoredOnboardingProfileRef.current = true;
    const profileId = initialHrSearchRef.current.profileId;
    if (!profileId) return;
    const employee = employees.find((e) => e.id === profileId);
    if (employee) setOnboardingSelectedEmployee({ id: employee.id, name: employee.name, docList: getOnboardingDocListForEmployee(employee) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

  // Keeps the URL in sync with the current tab/applicant going forward, so
  // a refresh (or a bookmarked/shared link) lands back here — replace, not
  // push, so switching tabs doesn't spam the browser's back-button history.
  useEffect(() => {
    void navigate({
      search: ((prev: any) => ({ ...prev, tab: activeTab, profileId: onboardingSelectedEmployee?.id })) as any,
      replace: true,
    } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, onboardingSelectedEmployee?.id]);
  const onboardingDocColumns =
    onboardingGroup === "TECHNICIAN" ? TECHNICIAN_ONBOARDING_DOCS
    : onboardingGroup === "PARTS_MANAGER" ? PARTS_MANAGER_ONBOARDING_DOCS
    : PH_ONBOARDING_DOCS;

  // YES/NO on the checklist grid reflects whether a real document has
  // actually been filed (uploaded, linked, or dragged in from Jotform) for
  // that applicant + category in onboarding_documents — not a manually
  // toggled flag — so the grid can never claim "YES" for a document nobody
  // attached. Re-fetched whenever the currently-visible employee list
  // changes (group/search), keyed by profile id.
  const [onboardingDocCategoriesByProfile, setOnboardingDocCategoriesByProfile] = useState<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    if (activeTab !== "onboarding" || onboardingEmployees.length === 0) return;
    let cancelled = false;
    getOnboardingDocumentCategoriesByProfileIds(onboardingEmployees.map((e) => e.id))
      .then((map) => { if (!cancelled) setOnboardingDocCategoriesByProfile(map); })
      .catch((err) => console.error("Failed to load onboarding document status:", err));
    return () => { cancelled = true; };
  }, [activeTab, onboardingEmployees]);

  // Warnings actually approved by HR (final stage) — not timecard-derived.
  const approvedWarningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of allNotes) {
      if (n.status !== "approved" || n.type !== "warning") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [allNotes]);

  // Remaining PTO per employee — 5 days in their first eligible tenure year
  // (starting at the 1-year hire anniversary), +1 day each following year,
  // uncapped, minus days already pending/approved in the current window.
  // Same ptoYearWindow/ptoDaysUsed logic Employee Self-Service uses, so the
  // number HR sees here always matches what the employee sees.
  const ptoRequestsByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of ptoRequests) {
      const arr = map.get(r.profileId);
      if (arr) arr.push(r);
      else map.set(r.profileId, [r]);
    }
    return map;
  }, [ptoRequests]);

  const remainingPtoByProfile = useMemo(() => {
    const map = new Map<string, { remaining: number; allowance: number } | null>();
    for (const e of employees) {
      const window = ptoYearWindow(e.startDate, null);
      if (!window) {
        map.set(e.id, null);
        continue;
      }
      const used = ptoDaysUsed(ptoRequestsByProfile.get(e.id) ?? [], window);
      map.set(e.id, { remaining: Math.max(0, window.allowance - used), allowance: window.allowance });
    }
    return map;
  }, [employees, ptoRequestsByProfile]);

  // Filtered and sorted employees
  const filteredEmployees = useMemo(() => {
    let result = [...employees];
    const q = employeeFilters.search.trim().toLowerCase();
    if (q) {
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.branch.toLowerCase().includes(q) ||
        (ROLE_LABELS[normalizeRole(e.position)] ?? e.position ?? "").toLowerCase().includes(q),
      );
    }
    if (employeeFilters.status) result = result.filter(e => e.status === employeeFilters.status);
    if (employeeFilters.branch) result = result.filter(e => e.branch === employeeFilters.branch);
    result.sort((a, b) => {
      let compareVal = 0;
      if (employeeFilters.sortBy === "name") compareVal = a.name.localeCompare(b.name);
      else if (employeeFilters.sortBy === "startDate") compareVal = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      else if (employeeFilters.sortBy === "warnings") compareVal = (approvedWarningCountByProfile.get(a.id) ?? 0) - (approvedWarningCountByProfile.get(b.id) ?? 0);
      return employeeFilters.sortOrder === "asc" ? compareVal : -compareVal;
    });
    return result;
  }, [employees, employeeFilters, approvedWarningCountByProfile]);

  // ── Warnings / Termination / Resigned per-department trend ──
  const [trendMode, setTrendMode] = useState<"monthly" | "range">("monthly");
  const [trendMonth, setTrendMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [trendFrom, setTrendFrom] = useState("");
  const [trendTo, setTrendTo] = useState("");

  const inTrendWindow = (dateStr: string | undefined | null) => {
    if (!dateStr) return false;
    if (trendMode === "monthly") return dateStr.slice(0, 7) === trendMonth;
    if (trendFrom && dateStr < trendFrom) return false;
    if (trendTo && dateStr > trendTo) return false;
    return true;
  };

  const departmentTrendData = useMemo(() => {
    const byDept = new Map<string, { department: string; Warnings: number; Terminated: number; Resigned: number }>();
    const deptLabel = (roleCode: string | undefined) => ROLE_LABELS[normalizeRole(roleCode)] ?? roleCode ?? "Unknown";
    const bump = (roleCode: string | undefined, key: "Warnings" | "Terminated" | "Resigned") => {
      const dept = deptLabel(roleCode);
      if (!byDept.has(dept)) byDept.set(dept, { department: dept, Warnings: 0, Terminated: 0, Resigned: 0 });
      byDept.get(dept)![key] += 1;
    };

    for (const n of allNotes) {
      if (n.status !== "approved" || n.type !== "warning") continue;
      if (!inTrendWindow(n.createdAt.slice(0, 10))) continue;
      bump(roleByProfileId.get(n.agentProfileId), "Warnings");
    }
    for (const e of employees) {
      if (e.status !== "terminated" && e.status !== "resigned") continue;
      if (!inTrendWindow(e.terminationDate)) continue;
      bump(e.position, e.status === "terminated" ? "Terminated" : "Resigned");
    }
    return Array.from(byDept.values()).sort((a, b) => (b.Warnings + b.Terminated + b.Resigned) - (a.Warnings + a.Terminated + a.Resigned));
  }, [allNotes, employees, roleByProfileId, trendMode, trendMonth, trendFrom, trendTo]);

  // ── Tab groups — single source shared by the dropdown header nav and the
  // floating sidebar, so the two stay in sync automatically. Categories and
  // the tabs within them are kept in alphabetical order. ──
  const tabGroups = [
    {
      group: "Automated Forms",
      icon: Paperclip,
      tabs: [
        ...(canViewJotformTab ? [{ key: "jotformDocuments", label: "Applicant Documents", count: newJotformSubmissionsCount, icon: Forward }] as const : []),
        { key: "coe", label: "Certificate of Employment", count: 0, icon: CheckCircle },
        { key: "warningForm", label: "Employee Warning Form", count: 0, icon: FileText },
        { key: "w8ben", label: "W-8 / W-9 / W-4 Forms", count: 0, icon: Landmark },
      ] as const,
    },
    {
      group: "Generate Reports",
      icon: Download,
      tabs: [
        { key: "report", label: "Generate Report", count: 0, icon: Download },
      ] as const,
    },
    {
      group: "People Operations",
      icon: Users,
      tabs: [
        { key: "directory", label: "Employee Directory", count: employees.length, icon: UserCheck },
        { key: "employeeRequestManager", label: "Employee Request Manager", count: requestManagerPendingCount, icon: ClipboardList },
        { key: "hiring", label: "Hiring", count: visibleCandidates.length, icon: Users },
        { key: "onboarding", label: "Onboarding Documents", count: 0, icon: Paperclip },
        { key: "warnings", label: "Warnings & Mistakes", count: isHrOrAdmin ? pendingNotes.length : 0, icon: AlertTriangle },
      ] as const,
    },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Floating sidebar nav — hover the left edge to open, same as the ticket page's "Sections" tab; no click needed ── */}
      <div
        className={`fixed left-0 top-0 bottom-0 z-40 transition-[width] duration-150 ${sidebarOpen ? "w-72" : "w-8"}`}
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
      >
        <div
          className={`absolute left-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md border border-blue-400/40 bg-blue-500/20 text-blue-200 px-1 py-2 shadow-md shadow-blue-900/30 select-none transition-opacity ${sidebarOpen ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        >
          <ChevronRight className="h-3 w-3" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] [writing-mode:vertical-rl]">Sections</span>
        </div>

        <div
          className={`h-full w-72 bg-slate-900 border-r border-white/10 shadow-2xl p-4 overflow-y-auto transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-4">HR Sections</p>
          {tabGroups.map((section) => (
            <div key={section.group} className="mb-3">
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-foreground">
                <section.icon className="h-4 w-4 text-muted-foreground" />
                {section.group}
              </div>
              <div className="flex flex-col gap-0.5 pl-2 border-l border-white/10 ml-4">
                {section.tabs.map((tab) => {
                  const active = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => { setActiveTab(tab.key); setSidebarOpen(false); }}
                      className={`w-full text-left pl-2.5 pr-2 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors ${active ? "bg-primary/10 border border-primary/30 text-foreground font-semibold" : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`flex items-center justify-center h-6 w-6 rounded-md shrink-0 ${active ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground"}`}>
                          <tab.icon className="h-3.5 w-3.5" />
                        </span>
                        {tab.label}
                      </span>
                      {tab.count > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] shrink-0 ${active ? "bg-primary/20 text-primary" : "bg-white/10 text-muted-foreground"}`}>{tab.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-6">
      <div className="flex items-center gap-3 mb-4"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300/70 hover:text-red-300 shrink-0">✕</button>
        </div>
      )}

      {/* ── Total Employees ── */}
      <div className="panel p-4 mb-4 flex items-center gap-4">
        <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-blue-500/15 text-blue-300 shrink-0">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-tight">{employees.length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Employees</p>
        </div>
        <Link
          to="/hr-activity-log"
          className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm text-muted-foreground hover:text-foreground"
        >
          <History className="h-4 w-4" /> Activity Log
        </Link>
      </div>

      {/* ── KPI overview — every tile is clickable, same as Attendance: it jumps straight to the tab/filter that explains the number instead of just displaying it. ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
        {[
          { label: "Candidates", value: kpi.candidates, color: "text-blue-300", icon: <Users className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter(""); } },
          { label: "Scheduled for Interview", value: kpi.scheduled, color: "text-yellow-300", icon: <Clock className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter("interviewing"); } },
          { label: "Rejected", value: kpi.rejected, color: "text-red-300", icon: <XCircle className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter("rejected"); } },
          { label: "Hired", value: kpi.hired, color: "text-green-300", icon: <UserCheck className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter("hired"); } },
          { label: "Terminated", value: kpi.terminated, color: "text-red-400", icon: <UserX className="h-4 w-4" />, onClick: () => { setActiveTab("directory"); setEmployeeFilters((prev) => ({ ...prev, status: "terminated" })); } },
          { label: "Resigned", value: kpi.resigned, color: "text-slate-300", icon: <UserMinus className="h-4 w-4" />, onClick: () => { setActiveTab("directory"); setEmployeeFilters((prev) => ({ ...prev, status: "resigned" })); } },
        ].map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={k.onClick}
            className="panel p-3 text-center hover:bg-white/5 transition-colors cursor-pointer"
          >
            <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAttendanceModalOpen(true)}
          className="panel p-3 text-center hover:bg-white/5 transition-colors cursor-pointer"
        >
          <div className="flex justify-center mb-1 text-muted-foreground"><UserCheck className="h-4 w-4" /></div>
          <p className="text-xl font-bold text-cyan-300">{attendanceSummary.present.length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Attendance</p>
        </button>
      </div>

      {/* ── Attendance summary modal — today's present/absent breakdown ── */}
      {attendanceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAttendanceModalOpen(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Today's Attendance</p>
                <p className="text-[10px] text-muted-foreground">{new Date(today + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
              </div>
              <button type="button" onClick={() => setAttendanceModalOpen(false)} className="btn text-xs px-2.5 py-1.5">Close</button>
            </div>
            <div className="px-4 pt-3 flex gap-2">
              {(["US", "PH"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAttendanceCountryTab(c)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${attendanceCountryTab === c ? "border-primary/40 bg-primary/10 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  {c === "US" ? "US Employees" : "PH Employees"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {(() => {
                const summary = attendanceCountryTab === "US" ? attendanceSummaryUS : attendanceSummaryPH;
                return (
                  <>
                    {/* Present */}
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-cyan-300" /> Total Present ({summary.present.length})
                      </h3>
                      {summary.present.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No one clocked in yet today.</p>
                      ) : (
                        <div className="flex flex-col gap-1.5 max-h-[28rem] overflow-y-auto">
                          {summary.present.map(({ employee, lateBy, shortBy }) => (
                            <div key={employee.id} className="flex items-center justify-between gap-2 bg-white/5 rounded px-2.5 py-1.5">
                              <span className="text-xs truncate">{employee.name}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {lateBy && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-300" title="Clocked in late">
                                    Late in {lateBy}
                                  </span>
                                )}
                                {shortBy && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300" title="Didn't complete full duty hours">
                                    Short {shortBy}
                                  </span>
                                )}
                                {!lateBy && !shortBy && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/20 text-green-300">On time</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Absent */}
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                        <UserX className="h-3.5 w-3.5 text-red-300" /> Total Absent ({summary.totalAbsent})
                      </h3>
                      <div className="flex flex-col gap-3">
                        {(["Absent without notice", "Sick Leave", "Personal Leave", "Time Off", "Paid Time Off"] as const).map((bucket) => {
                          const list = summary.buckets[bucket];
                          if (list.length === 0) return null;
                          const isNoNotice = bucket === "Absent without notice";
                          return (
                            <details key={bucket} className="rounded-md border border-white/10 overflow-hidden" open={isNoNotice}>
                              <summary className={`px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none ${isNoNotice ? "bg-red-500/15 text-red-300" : "bg-white/5 text-muted-foreground"}`}>
                                {bucket} ({list.length})
                              </summary>
                              <div className="max-h-64 overflow-y-auto grid grid-cols-2 sm:grid-cols-4">
                                {list.map((employee) => (
                                  <div key={employee.id} className={`px-2.5 py-1.5 text-xs truncate border-t border-white/5 ${isNoNotice ? "text-red-200" : "text-muted-foreground"}`}>
                                    {employee.name}
                                  </div>
                                ))}
                              </div>
                            </details>
                          );
                        })}
                        {summary.totalAbsent === 0 && <p className="text-xs text-muted-foreground italic">No one absent today.</p>}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab navigation — collapsed into 3 category dropdowns to save space ── */}
      <div className="mb-4 border-b border-white/10 pb-3 relative">
        <div className="flex flex-wrap gap-2">
          {tabGroups.map((section) => {
            const activeInGroup = section.tabs.some((t) => t.key === activeTab);
            const isOpen = openCategory === section.group;
            // A single-tab category (e.g. Generate Reports) has nothing to
            // expand into — it IS the tab, so clicking it navigates directly
            // instead of opening a one-item dropdown.
            if (section.tabs.length === 1) {
              const onlyTab = section.tabs[0];
              return (
                <button
                  key={section.group}
                  type="button"
                  onClick={() => setActiveTab(onlyTab.key)}
                  className={`px-3.5 py-2 text-sm font-medium rounded-md border flex items-center gap-2 transition-colors ${activeInGroup ? "border-primary/40 bg-primary/10 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  <section.icon className="h-3.5 w-3.5" />
                  {section.group}
                  {onlyTab.count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activeInGroup ? "bg-primary/20 text-primary" : "bg-white/10 text-muted-foreground"}`}>{onlyTab.count}</span>
                  )}
                </button>
              );
            }
            return (
              <div key={section.group} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenCategory(isOpen ? null : section.group)}
                  className={`px-3.5 py-2 text-sm font-medium rounded-md border flex items-center gap-2 transition-colors ${activeInGroup ? "border-primary/40 bg-primary/10 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  <section.icon className="h-3.5 w-3.5" />
                  {section.group}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpenCategory(null)} />
                    <div className="absolute top-full left-0 mt-1 z-20 min-w-[220px] rounded-md border border-white/10 bg-slate-900 shadow-xl py-1">
                      {section.tabs.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => { setActiveTab(tab.key); setOpenCategory(null); }}
                          className={`w-full text-left px-3.5 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${activeTab === tab.key ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                        >
                          <span className="flex items-center gap-2"><tab.icon className="h-3.5 w-3.5" />{tab.label}</span>
                          {tab.count > 0 && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === tab.key ? "bg-primary/20 text-primary" : "bg-white/10 text-muted-foreground"}`}>{tab.count}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Hiring ── */}
      {activeTab === "hiring" && (
      <div className="panel p-0 overflow-hidden mb-4">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-sm">Hiring</h2>
            {isBranchManager && <p className="text-[10px] text-muted-foreground mt-0.5">Showing applicants for your branch{myLocations.length > 1 ? "es" : ""}: {myLocations.join(", ") || "none assigned"}</p>}
          </div>
          <button onClick={() => setShowAddCandidate(!showAddCandidate)} className="btn text-sm px-3 py-1.5 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Candidate
          </button>
        </div>

        {/* Hiring Filters */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input value={hiringSearch} onChange={(e) => setHiringSearch(e.target.value)} placeholder="Name, position, or branch…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={hiringStatusFilter} onChange={(e) => setHiringStatusFilter(e.target.value as any)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                {(["applied", "interviewing", "selected", "hired", "rejected"] as CandidateStatus[]).map((s) => (
                  <option key={s} value={s}>{CANDIDATE_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            {(hiringSearch || hiringStatusFilter) && (
              <button onClick={() => { setHiringSearch(""); setHiringStatusFilter(""); }} className="btn text-sm px-3 mb-0.5">Clear</button>
            )}
            <span className="text-xs text-muted-foreground mb-1.5 ml-auto">
              {filteredCandidates.length}{(hiringSearch || hiringStatusFilter) ? ` of ${visibleCandidates.length}` : ""} candidates
            </span>
          </div>
        </div>

        {showAddCandidate && (
          <div className="px-4 py-4 border-b border-white/10 bg-white/5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="text" placeholder="Name *" value={newCandidate.name} onChange={(e) => setNewCandidate({ ...newCandidate, name: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <input type="text" placeholder="Phone Number" value={newCandidate.phone} onChange={(e) => setNewCandidate({ ...newCandidate, phone: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <input type="email" placeholder="Email" value={newCandidate.email} onChange={(e) => setNewCandidate({ ...newCandidate, email: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="text" placeholder="Position" value={newCandidate.position} onChange={(e) => setNewCandidate({ ...newCandidate, position: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <select value={newCandidate.branch} onChange={(e) => setNewCandidate({ ...newCandidate, branch: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">Select Branch</option>{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
              <label className="glass-input text-sm py-1.5 px-3 rounded-md flex items-center gap-2 cursor-pointer text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{cvFile ? cvFile.name : "Upload CV"}</span>
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => setCvFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddCandidate} disabled={savingCandidate || !newCandidate.name.trim()} className="btn bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5 disabled:opacity-50">{savingCandidate ? "Saving…" : "Save"}</button>
              <button onClick={() => setShowAddCandidate(false)} className="btn text-sm px-4 py-1.5">Cancel</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Candidate</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Position</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Branch</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Contact</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">CV</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Applied</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidatesLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading candidates…</td></tr>
              ) : filteredCandidates.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">{visibleCandidates.length === 0 ? "No candidates yet." : "No candidates match these filters."}</td></tr>
              ) : (
                filteredCandidates.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{c.position || "—"}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{c.branch || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.phone || c.email ? <>{c.phone && <div>{c.phone}</div>}{c.email && <div>{c.email}</div>}</> : "—"}</td>
                    <td className="px-4 py-3">
                      {c.cvPath ? (
                        <button onClick={() => handleViewCv(c.cvPath!)} className="text-blue-400 hover:text-blue-300 text-xs underline">View CV</button>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select value={c.status} onChange={(e) => handleCandidateStatus(c.id, e.target.value as CandidateStatus)} className={`text-xs font-semibold px-2 py-1 rounded border-0 ${CANDIDATE_STATUS_COLOR[c.status]}`}>
                        {!candidateStatusOptions.includes(c.status) && <option value={c.status}>{CANDIDATE_STATUS_LABEL[c.status]}</option>}
                        {candidateStatusOptions.map((s) => <option key={s} value={s}>{CANDIDATE_STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {c.cvPath && (
                          <button
                            onClick={() => { setForwardCvDialog(c); setForwardRecipientId(""); setForwardRecipientSearch(""); }}
                            title="Forward CV to a manager"
                            className="btn text-blue-400 hover:text-blue-300 text-sm p-1"
                          >
                            <Forward className="h-4 w-4" />
                          </button>
                        )}
                        {isHrOrAdmin && (
                          <button onClick={() => handleDeleteCandidate(c.id)} className="btn text-red-400 hover:text-red-300 text-sm p-1"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Warnings & Mistakes tab: Pending Reviews, Approved log, department trend ── */}
      {activeTab === "warnings" && (
      <>
      {/* Mistakes / Warnings totals — date-ranged, Today by default */}
      <div className="panel p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <button type="button" onClick={setWarningsRangeToday} className={`btn text-sm px-3 py-1.5 mb-0.5 ${warningsRangeFrom === today && warningsRangeTo === today ? "bg-primary/20 text-primary" : ""}`}>
            Today
          </button>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From</label>
            <input type="date" value={warningsRangeFrom} onChange={(e) => setWarningsRangeFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">To</label>
            <input type="date" value={warningsRangeTo} onChange={(e) => setWarningsRangeTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="panel p-3 text-center">
            <div className="flex justify-center mb-1 text-muted-foreground"><AlertTriangle className="h-4 w-4" /></div>
            <p className="text-xl font-bold text-yellow-300">{warningsCountKpi.warnings}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Warnings</p>
          </div>
          <div className="panel p-3 text-center">
            <div className="flex justify-center mb-1 text-muted-foreground"><XCircle className="h-4 w-4" /></div>
            <p className="text-xl font-bold text-orange-300">{warningsCountKpi.mistakes}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Mistakes</p>
          </div>
        </div>
      </div>

      {/* Pending Reviews — both stage 1 (pending, no department manager sign-off
          yet) and stage 2 (manager_approved) show up here, since HR/Admin can
          decide directly on either rather than being blocked until a
          department manager acts first on the employee's own page. */}
      {isHrOrAdmin && (
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-yellow-400" /> Pending Reviews
            {pendingNotes.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-yellow-500/15 text-yellow-300 border border-yellow-500/25">{pendingNotes.length}</span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground mb-3">Every warning/mistake awaiting a decision, at any review stage.</p>
          {pendingNotesLoading ? (
            <p className="text-xs text-muted-foreground py-2">Loading…</p>
          ) : pendingNotes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Nothing waiting on a decision.</p>
          ) : (
            <div className="space-y-2">
              {pendingNotes.map((n) => {
                const employeeName = employees.find((e) => e.id === n.agentProfileId)?.name || "Unknown employee";
                return (
                  <div key={n.id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-start gap-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                      {n.type === "warning" ? "Warning" : "Mistake"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs">
                        <span className="font-semibold">{employeeName}</span> — {n.note}{" "}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${n.status === "manager_approved" ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "bg-slate-500/20 text-slate-300 border border-slate-500/30"}`}>
                          {n.status === "manager_approved" ? "Manager-approved" : "Awaiting manager"}
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.ticketNo && <>Ticket <span className="font-mono text-blue-400">{n.ticketNo}</span> · </>}
                        Submitted by {n.createdByName || "Unknown"} · {new Date(n.createdAt).toLocaleString()}
                        {n.managerReviewedByName && <> · Approved by {n.managerReviewedByName}{n.managerReviewedAt ? ` · ${new Date(n.managerReviewedAt).toLocaleString()}` : ""}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => decideNote(n.id, "approved")} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-green-500/15 text-green-300 border border-green-500/30 hover:bg-green-500/25 transition-colors">
                        <CheckCircle className="h-3 w-3" /> Approve
                      </button>
                      <button type="button" onClick={() => decideNote(n.id, "rejected")} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 transition-colors">
                        <XCircle className="h-3 w-3" /> Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Approved Warnings & Mistakes — centralized, company-wide ── */}
      {isHrOrAdmin && (
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-4 border-b border-white/10">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <h2 className="font-semibold text-sm flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-yellow-400" /> Approved Warnings &amp; Mistakes
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">{filteredApprovedLog.length}</span>
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">Every approved note across every department, in one place — no need to open each employee's page.</p>
              </div>
              <div className="ml-auto flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
                  <input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Employee or note…" className="glass-input text-sm py-1.5 px-3 rounded-md w-48" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Type</label>
                  <select value={logType} onChange={(e) => setLogType(e.target.value as any)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                    <option value="">All</option>
                    <option value="warning">Warning</option>
                    <option value="mistake">Mistake</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Department</label>
                  <select value={logDept} onChange={(e) => setLogDept(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                    <option value="">All</option>
                    {approvedDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {(logSearch || logType || logDept) && (
                  <button onClick={() => { setLogSearch(""); setLogType(""); setLogDept(""); }} className="btn text-sm px-3 mb-0.5">Clear</button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-white/10 bg-slate-900">
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Employee</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Department</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Type</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Note</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Ticket</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Submitted</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Issued By</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Manager</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">HR (Final)</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredApprovedLog.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground text-xs">No approved warnings or mistakes{logSearch || logType || logDept ? " match these filters." : " yet."}</td></tr>
                ) : (
                  filteredApprovedLog.map((n) => (
                    <tr key={n.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        <a href={`/csr-agent/${n.agentProfileId}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition">{n.employeeName}</a>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{n.department}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                          {n.type === "warning" ? "Warning" : "Mistake"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate" title={n.note}>{n.note}</td>
                      <td className="px-3 py-2 font-mono text-blue-400 whitespace-nowrap">{n.ticketNo || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.createdByName || "Unknown"}<br />
                        <span className="text-[10px]">{new Date(n.createdAt).toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{issuerNameByNoteId.get(n.id) ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.managerReviewedByName || "—"}<br />
                        {n.managerReviewedAt && <span className="text-[10px]">{new Date(n.managerReviewedAt).toLocaleString()}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.reviewedByName || "Unknown"}<br />
                        <span className="text-[10px]">{n.reviewedAt ? new Date(n.reviewedAt).toLocaleString() : "—"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleRetractApprovedNote(n.id)}
                          title="Retract this approved record"
                          className="text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Warnings, Termination & Resigned — per department ── */}
      <div className="panel p-4 mb-4">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <p className="text-sm font-semibold">Warnings, Termination &amp; Resigned — by Department</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">View</label>
              <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5">
                <button type="button" onClick={() => setTrendMode("monthly")} className={`px-3 text-xs font-medium transition-colors ${trendMode === "monthly" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>Monthly</button>
                <button type="button" onClick={() => setTrendMode("range")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${trendMode === "range" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>Date Range</button>
              </div>
            </div>
            {trendMode === "monthly" ? (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Month</label>
                <input type="month" value={trendMonth} onChange={(e) => setTrendMonth(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md h-7.5" />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From</label>
                  <input type="date" value={trendFrom} onChange={(e) => setTrendFrom(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md h-7.5" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">To</label>
                  <input type="date" value={trendTo} onChange={(e) => setTrendTo(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md h-7.5" />
                </div>
              </>
            )}
          </div>
        </div>
        {departmentTrendData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No warnings, terminations, or resignations in this window.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={departmentTrendData} margin={{ left: -10 }}>
              <XAxis dataKey="department" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-25} textAnchor="end" height={55} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="Warnings" fill="#facc15" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Terminated" fill="#f87171" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Resigned" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      </>
      )}

      {/* ── Employee Directory ── */}
      {activeTab === "directory" && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <h2 className="font-semibold text-sm">Employee Directory</h2>
          <span className="text-xs text-muted-foreground">Click a name to view statistics, mistakes &amp; warnings</span>
        </div>

        {/* Employee Filters */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input value={employeeFilters.search} onChange={(e) => setEmployeeFilters({ ...employeeFilters, search: e.target.value })} placeholder="Name, email, branch, or position…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={employeeFilters.status} onChange={(e) => setEmployeeFilters({ ...employeeFilters, status: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
                <option value="resigned">Resigned</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
              <select value={employeeFilters.branch} onChange={(e) => setEmployeeFilters({ ...employeeFilters, branch: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                {allBranches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sort By</label>
              <select value={employeeFilters.sortBy} onChange={(e) => setEmployeeFilters({ ...employeeFilters, sortBy: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="name">Name</option>
                <option value="startDate">Start Date</option>
                <option value="warnings">Warnings</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Order</label>
              <select value={employeeFilters.sortOrder} onChange={(e) => setEmployeeFilters({ ...employeeFilters, sortOrder: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
            {(employeeFilters.search || employeeFilters.status || employeeFilters.branch) && (
              <button onClick={() => setEmployeeFilters({ search: "", status: "", branch: "", sortBy: "name", sortOrder: "asc" })} className="btn text-sm px-3 mb-0.5">Clear Filters</button>
            )}
            <span className="text-xs text-muted-foreground mb-1.5 ml-auto">
              {filteredEmployees.length}{(employeeFilters.search || employeeFilters.status || employeeFilters.branch) ? ` of ${employees.length}` : ""} employees
            </span>
          </div>
        </div>

        {/* Employee Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Name</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Email</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Position</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Branch</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Start Date</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Warnings</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Remaining PTO</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Termination</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground text-xs">{employeesLoading ? "Loading employees…" : employees.length === 0 ? "No employees found." : "No employees match these filters."}</td></tr>
              ) : (
                filteredEmployees.map((employee) => (
                  <tr key={employee.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">
                      <a href={`/csr-agent/${employee.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition cursor-pointer" title={`View ${employee.name}'s statistics`}>
                        {employee.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">{ROLE_LABELS[normalizeRole(employee.position)] ?? employee.position}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.branch || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.startDate || "—"}</td>
                    <td className="px-3 py-2">
                      {(approvedWarningCountByProfile.get(employee.id) ?? 0) > 0 ? (
                        <span className="bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded text-xs font-semibold">{approvedWarningCountByProfile.get(employee.id)}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const pto = remainingPtoByProfile.get(employee.id);
                        if (!pto) return <span className="text-muted-foreground text-xs" title="Not yet eligible — PTO starts after 1 year of tenure.">—</span>;
                        return (
                          <span className="bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded text-xs font-semibold">
                            {pto.remaining}/{pto.allowance}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {employee.terminationDate ? (
                        <div className="text-yellow-400 text-xs">
                          <div>{employee.terminationDate}</div>
                          <div className="text-xs text-yellow-300">{employee.terminationReason || "N/A"}</div>
                        </div>
                      ) : <span>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={employee.status}
                        onChange={(e) => handleUpdateEmployeeStatus(employee.id, e.target.value as EmploymentStatus)}
                        className="text-xs font-semibold px-2 py-1 rounded border-0 bg-slate-700 text-slate-100"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="terminated">Terminated</option>
                        <option value="resigned">Resigned</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Applicant Documents — the real Jotform-generated PDF per submission ── */}
      {activeTab === "jotformDocuments" && canViewJotformTab && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <Forward className="h-4 w-4 text-blue-300" /> Applicant Documents
              {newJotformSubmissionsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/25">{newJotformSubmissionsCount} new</span>
              )}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">The exact PDF Jotform generated for each submission — not a re-creation.</p>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-end gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={jotformSearch}
              onChange={(e) => setJotformSearch(e.target.value)}
              placeholder="Applicant or form…"
              className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Form</label>
            <select value={jotformFormFilter} onChange={(e) => setJotformFormFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All</option>
              {jotformFormOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
            <select value={jotformStatusFilter} onChange={(e) => setJotformStatusFilter(e.target.value as any)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          {(jotformSearch || jotformFormFilter || jotformStatusFilter) && (
            <button onClick={() => { setJotformSearch(""); setJotformFormFilter(""); setJotformStatusFilter(""); }} className="btn text-sm px-3 py-1.5">Clear Filters</button>
          )}
          <span className="text-xs text-muted-foreground mb-1.5 ml-auto">
            {filteredJotformSubmissions.length}{(jotformSearch || jotformFormFilter || jotformStatusFilter) ? ` of ${jotformSubmissions.length}` : ""} submissions
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Applicant</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Form</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Submitted</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Document</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase"></th>
              </tr>
            </thead>
            <tbody>
              {jotformSubmissionsLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
              ) : filteredJotformSubmissions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">{jotformSubmissions.length === 0 ? "No submissions yet." : "No submissions match these filters."}</td></tr>
              ) : (
                pagedJotformSubmissions.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">
                      <button type="button" onClick={() => setJotformPreview(s)} className="hover:text-blue-300 hover:underline transition cursor-pointer text-left">
                        {s.applicantName || "Someone"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.formTitle || s.formId}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(s.submittedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <select
                        value={s.status}
                        onChange={(e) => handleJotformStatusChange(s, e.target.value as JotformSubmissionStatus)}
                        className={`text-xs font-semibold px-2 py-1 rounded border-0 ${s.status === "new" ? "bg-blue-500/20 text-blue-300" : s.status === "reviewed" ? "bg-green-500/20 text-green-300" : "bg-slate-700 text-slate-300"}`}
                      >
                        <option value="new">New</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="archived">Archived</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {s.documentUrl ? (
                        <button type="button" onClick={() => setJotformPreview(s)} className="btn text-xs px-2.5 py-1.5">View PDF</button>
                      ) : (
                        <span className="text-muted-foreground text-xs" title="Jotform's generated document couldn't be fetched for this submission.">Unavailable</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => handleDeleteJotformSubmission(s)} title="Delete this submission" className="text-muted-foreground hover:text-red-400 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Page numbers ── */}
        {!jotformSubmissionsLoading && filteredJotformSubmissions.length > JOTFORM_PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setJotformPage((p) => Math.max(1, p - 1))}
              disabled={jotformPage === 1}
              className="btn text-xs px-2.5 py-1.5 disabled:opacity-40"
            >
              Prev
            </button>
            {jotformPageWindow.map((p, i) => (
              <span key={p} className="flex items-center gap-1">
                {i > 0 && p - jotformPageWindow[i - 1] > 1 && <span className="text-muted-foreground text-xs px-1">…</span>}
                <button
                  type="button"
                  onClick={() => setJotformPage(p)}
                  className={`text-xs px-2.5 py-1.5 rounded-md ${p === jotformPage ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  {p}
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setJotformPage((p) => Math.min(jotformPageCount, p + 1))}
              disabled={jotformPage === jotformPageCount}
              className="btn text-xs px-2.5 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
      )}

      {/* ── Deleted Jotforms — soft-deleted submissions, restorable for 30 days ── */}
      {activeTab === "jotformDocuments" && canViewJotformTab && (
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <Trash2 className="h-4 w-4 text-red-300" /> Deleted Jotforms
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Deleted submissions stay here for 30 days and can be restored — after that they drop off this list.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Applicant</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Form</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Deleted</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Expires</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase"></th>
              </tr>
            </thead>
            <tbody>
              {deletedJotformLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
              ) : deletedJotformSubmissions.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Nothing deleted.</td></tr>
              ) : (
                deletedJotformSubmissions.map((s) => {
                  const deletedAt = new Date(s.deletedAt!);
                  const expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
                  const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
                  return (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">{s.applicantName || "Someone"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.formTitle || s.formId}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{deletedAt.toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{daysLeft} day{daysLeft === 1 ? "" : "s"} left</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => handleRestoreJotformSubmission(s)} className="btn text-xs px-2.5 py-1.5">Restore</button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Applicant Documents preview modal ── */}
      {jotformPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setJotformPreview(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{jotformPreview.applicantName || "Someone"}</p>
                <p className="text-[10px] text-muted-foreground">{jotformPreview.formTitle || jotformPreview.formId} — submitted {new Date(jotformPreview.submittedAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={jotformPreview.status}
                  onChange={(e) => {
                    const status = e.target.value as JotformSubmissionStatus;
                    setJotformPreview({ ...jotformPreview, status });
                    void handleJotformStatusChange(jotformPreview, status);
                  }}
                  className="text-xs font-semibold px-2 py-1 rounded border-0 bg-slate-700 text-slate-100"
                >
                  <option value="new">New</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="archived">Archived</option>
                </select>
                {jotformPreview.documentUrl && (
                  <a href={jotformPreview.documentUrl} target="_blank" rel="noopener noreferrer" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1"><Download className="h-3 w-3" /> Download</a>
                )}
                <button type="button" onClick={() => handleDeleteJotformSubmission(jotformPreview)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 text-red-300 hover:text-red-200"><Trash2 className="h-3 w-3" /> Delete</button>
                <button type="button" onClick={() => setJotformPreview(null)} className="btn text-xs px-2.5 py-1.5">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-slate-950">
              {jotformPreview.documentUrl ? (
                <iframe src={jotformPreview.documentUrl} title="Applicant document" className="w-full h-full min-h-[70vh] border-0" />
              ) : (
                <p className="p-8 text-center text-sm text-muted-foreground">Jotform's generated document couldn't be fetched for this submission.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Jotform Submissions (hidden from nav — kept for reference/fallback) ── */}
      {activeTab === "jotform" && canViewJotformTab && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <Bell className="h-4 w-4 text-blue-300" /> Jotform Submissions
              {unreadJotformCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/25">{unreadJotformCount} new</span>
              )}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Pings whenever someone submits a Jotform form — delivered here in real time.</p>
          </div>
          {unreadJotformCount > 0 && (
            <button onClick={markAllJotformRead} className="btn text-sm px-3 py-1.5">Mark all read</button>
          )}
        </div>

        {/* Jotform Filters */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Form</label>
              <select value={jotformFilters.formTitle} onChange={(e) => setJotformFilters({ ...jotformFilters, formTitle: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All forms</option>
                {jotformFormTitles.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Submitted By</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input value={jotformFilters.submitter} onChange={(e) => setJotformFilters({ ...jotformFilters, submitter: e.target.value })} placeholder="Submitter name…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-48" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
              <input type="date" value={jotformFilters.date} onChange={(e) => setJotformFilters({ ...jotformFilters, date: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            {(jotformFilters.formTitle || jotformFilters.submitter || jotformFilters.date) && (
              <button onClick={() => setJotformFilters({ formTitle: "", submitter: "", date: "" })} className="btn text-sm px-3 mb-0.5">Clear Filters</button>
            )}
            <span className="text-xs text-muted-foreground mb-1.5 ml-auto">
              {filteredJotformNotifs.length}{(jotformFilters.formTitle || jotformFilters.submitter || jotformFilters.date) ? ` of ${jotformNotifs.length}` : ""} submissions
            </span>
          </div>
        </div>

        {jotformNotifs.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No form submissions yet.</p>
        ) : filteredJotformNotifs.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No submissions match these filters.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredJotformNotifs.map((n) => (
              <div
                key={n.id}
                onClick={() => { markJotformRead(n); setSelectedSubmission(n); }}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors cursor-pointer"
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-blue-300 bg-blue-400/10 border-blue-400/20">
                  <Bell className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm font-semibold ${n.isRead ? "text-muted-foreground" : "text-foreground"}`}>{n.title}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteJotformNotification(n); }}
                        title="Delete this submission"
                        className="text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </span>
                  <span className={`mt-0.5 block text-xs leading-5 ${n.isRead ? "text-muted-foreground" : "text-foreground/70"}`}>{n.body}</span>
                </span>
                {!n.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-400" />}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── Employee Request Manager — company-wide PTO / Time Correction / Attendance Dispute / Payroll Inquiry review, mirroring Employee Self-Service's "Manage Requests" tab ── */}
      {activeTab === "employeeRequestManager" && (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            { key: "pto", label: "Pending PTO", count: pendingPtoRequests.length },
            { key: "corrections", label: "Pending Corrections", count: pendingCorrections.length },
            { key: "disputes", label: "Pending Disputes / Inquiries", count: pendingEmployeeRequests.length },
          ] as const).map((t) => {
            const active = requestManagerCategory === t.key;
            const isNew = requestManagerHasNew(t.key);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => handleSelectRequestManagerCategory(t.key)}
                className={`relative panel p-3 text-center transition-colors ${active ? "border-primary/50 bg-primary/10" : "hover:bg-white/5"}`}
              >
                {isNew && (
                  <span className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500 text-white">NEW</span>
                )}
                <p className={`text-xl font-bold ${active ? "text-primary" : "text-yellow-300"}`}>{t.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{t.label}</p>
              </button>
            );
          })}
        </div>

        {/* Pending PTO */}
        {requestManagerCategory === "pto" && (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-3">PTO Requests — Pending</h3>
          {requestManagerLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pendingPtoRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending PTO requests.</p>
          ) : (
            <div className="space-y-3">
              {pendingPtoRequests.map((r) => {
                const canManagerAct = r.managerStatus === "pending" && canReviewPtoStage(r, "manager", myProfileId, myRole);
                const canHrAct = r.hrStatus === "pending" && canReviewPtoStage(r, "hr", myProfileId, myRole);
                return (
                  <div key={r.id} className="border border-white/10 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{profileName(r.profileId)} — {PTO_TYPE_LABEL[r.ptoType] ?? r.ptoType}</p>
                        <p className="text-xs text-muted-foreground mt-1">{r.startDate} to {r.endDate} ({r.hoursRequested}h)</p>
                        {r.reason && <p className="text-sm text-muted-foreground mt-2">{r.reason}</p>}
                        <div className="flex gap-2 mt-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            r.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                            : r.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                            : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                          }`}>
                            Manager: {r.managerStatus.charAt(0).toUpperCase() + r.managerStatus.slice(1)}
                            {r.managerReviewedBy ? ` — ${profileName(r.managerReviewedBy)}` : ""}
                          </span>
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            r.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                            : r.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                            : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                          }`}>
                            HR: {r.hrStatus.charAt(0).toUpperCase() + r.hrStatus.slice(1)}
                            {r.hrReviewedBy ? ` — ${profileName(r.hrReviewedBy)}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {canManagerAct && (
                          <div className="flex gap-1">
                            <button type="button" onClick={() => handlePtoStageAction(r, "manager", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve (Mgr)</button>
                            <button type="button" onClick={() => handlePtoStageAction(r, "manager", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                          </div>
                        )}
                        {canHrAct && (
                          <div className="flex gap-1">
                            <button type="button" onClick={() => handlePtoStageAction(r, "hr", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve (HR)</button>
                            <button type="button" onClick={() => handlePtoStageAction(r, "hr", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                          </div>
                        )}
                        {!canManagerAct && !canHrAct && <span className="text-xs text-muted-foreground">Awaiting other approver</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Pending Time Corrections */}
        {requestManagerCategory === "corrections" && (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-3">Time Corrections — Pending</h3>
          {requestManagerLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pendingCorrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending time correction requests.</p>
          ) : (
            <div className="space-y-3">
              {pendingCorrections.map((r) => (
                <div key={r.id} className="border border-white/10 rounded-lg p-3 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{profileName(r.profileId)} — {r.workDate}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {r.originalCheckIn || "—"} → {r.originalCheckOut || "—"} &nbsp;⟶&nbsp; requested {r.correctedCheckIn || "—"} → {r.correctedCheckOut || "—"}
                    </p>
                    {(r.correctedMealStart || r.correctedMealEnd) && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Meal: {r.originalMealStart || "—"} → {r.originalMealEnd || "—"} &nbsp;⟶&nbsp; requested {r.correctedMealStart || "—"} → {r.correctedMealEnd || "—"}
                      </p>
                    )}
                    {r.reason && <p className="text-sm text-muted-foreground mt-2">{r.reason}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => handleCorrectionAction(r, true)} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve</button>
                    <button type="button" onClick={() => handleCorrectionAction(r, false)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Pending Attendance Disputes & Payroll Inquiries */}
        {requestManagerCategory === "disputes" && (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-3">Attendance Disputes &amp; Payroll Inquiries — Pending</h3>
          {requestManagerLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pendingEmployeeRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending disputes or inquiries.</p>
          ) : (
            <div className="space-y-3">
              {pendingEmployeeRequests.map((r) => (
                <div key={r.id} className="border border-white/10 rounded-lg p-3">
                  <p className="text-sm font-semibold">{profileName(r.profileId)} — {r.requestType === "attendance_dispute" ? "Attendance Dispute" : "Payroll Inquiry"}</p>
                  <p className="text-xs text-muted-foreground mt-1">Submitted: {r.createdAt.slice(0, 10)}</p>
                  <p className="text-sm text-muted-foreground mt-2">{r.details}</p>
                  <textarea
                    placeholder="Optional response note (visible to the employee)…"
                    value={requestResponseNote[r.id] || ""}
                    onChange={(e) => setRequestResponseNote({ ...requestResponseNote, [r.id]: e.target.value })}
                    rows={2}
                    className="glass-input text-sm w-full mt-2 px-3 py-2 rounded-md"
                  />
                  <div className="flex gap-2 mt-2">
                    {r.requestType === "attendance_dispute" ? (
                      <>
                        <button type="button" onClick={() => handleEmployeeRequestAction(r.id, "approved")} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve</button>
                        <button type="button" onClick={() => handleEmployeeRequestAction(r.id, "rejected")} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => handleEmployeeRequestAction(r.id, "closed")} className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs font-semibold transition">Respond &amp; Close</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* ── Onboarding Documents ── */}
      {activeTab === "onboarding" && onboardingSelectedEmployee && (
        <OnboardingApplicantDocuments
          companyId={companyId ?? ""}
          profileId={onboardingSelectedEmployee.id}
          profileName={onboardingSelectedEmployee.name}
          categories={onboardingSelectedEmployee.docList}
          onBack={() => setOnboardingSelectedEmployee(null)}
        />
      )}
      {activeTab === "onboarding" && !onboardingSelectedEmployee && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-sm">Onboarding Documents</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Click a cell to toggle whether that document has been collected.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5">
              <button type="button" onClick={() => setOnboardingGroup("TECHNICIAN")} className={`px-4 text-xs font-medium transition-colors ${onboardingGroup === "TECHNICIAN" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>Technician</button>
              <button type="button" onClick={() => setOnboardingGroup("PARTS_MANAGER")} className={`px-4 text-xs font-medium transition-colors border-l border-white/15 ${onboardingGroup === "PARTS_MANAGER" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>Parts Manager</button>
              <button type="button" onClick={() => setOnboardingGroup("PH")} className={`px-4 text-xs font-medium transition-colors border-l border-white/15 ${onboardingGroup === "PH" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>Philippines</button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={onboardingSearch}
                onChange={(e) => setOnboardingSearch(e.target.value)}
                placeholder="Search name…"
                className="glass-input text-xs py-1.5 pl-8 pr-3 rounded-md w-40 h-7.5"
              />
            </div>
          </div>
        </div>

        <div>
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-1.5 py-2 text-left text-[10px] text-muted-foreground uppercase w-[9%]">Name</th>
                <th className="px-1.5 py-2 text-left text-[10px] text-muted-foreground uppercase w-[7%]">{onboardingGroup === "PH" ? "Dept." : "Branch"}</th>
                {onboardingDocColumns.map((doc) => (
                  <th key={doc} className="px-1 py-2 text-center text-[9px] leading-tight text-muted-foreground uppercase break-words">{doc}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {onboardingEmployees.length === 0 ? (
                <tr><td colSpan={2 + onboardingDocColumns.length} className="px-3 py-6 text-center text-muted-foreground text-xs">{employeesLoading ? "Loading employees…" : `No ${onboardingGroup === "TECHNICIAN" ? "Technician" : onboardingGroup === "PARTS_MANAGER" ? "Parts Manager" : "Philippines"} employees found.`}</td></tr>
              ) : (
                onboardingEmployees.map((employee) => (
                  <tr key={employee.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-1.5 py-1.5 font-medium truncate" title={employee.name}>
                      <button
                        type="button"
                        onClick={() => setOnboardingSelectedEmployee({ id: employee.id, name: employee.name, docList: getOnboardingDocListForEmployee(employee) })}
                        className="text-blue-300 hover:text-blue-200 hover:underline truncate text-left"
                      >
                        {employee.name}
                      </button>
                    </td>
                    <td className="px-1.5 py-1.5 text-muted-foreground truncate" title={onboardingGroup === "PH" ? (ROLE_LABELS[normalizeRole(employee.position)] ?? employee.position) : employee.branch}>
                      {/* PH's "Department" column reads from position/role, same
                          label the Employee Directory tab shows — not the raw
                          department field, which is usually blank. */}
                      {(onboardingGroup === "PH" ? (ROLE_LABELS[normalizeRole(employee.position)] ?? employee.position) : employee.branch) || "—"}
                    </td>
                    {onboardingDocColumns.map((doc) => {
                      const done = !!onboardingDocCategoriesByProfile.get(employee.id)?.has(doc);
                      return (
                        <td key={doc} className="px-0.5 py-0.5 text-center">
                          <button
                            type="button"
                            title={done ? `${doc} is filed — click to view` : `${doc} is missing — click to upload or link it`}
                            onClick={() => setOnboardingSelectedEmployee({ id: employee.id, name: employee.name, docList: getOnboardingDocListForEmployee(employee) })}
                            className={`w-full px-1 py-1.5 rounded text-[9px] font-bold transition-colors ${done ? "bg-green-500/20 text-green-300 hover:bg-green-500/30" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                          >
                            {done ? "YES" : "NO"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Generate Report ── */}
      {activeTab === "report" && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Generate Hiring Report</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Totals of Candidates, Scheduled for Interview, Rejected, Hired, Terminated, and Resigned for the selected range.</p>
        </div>

        {/* Range filter */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <button type="button" onClick={setReportRangeToday} className={`btn text-sm px-3 py-1.5 mb-0.5 ${reportFrom === todayStr && reportTo === todayStr ? "bg-primary/20 text-primary" : ""}`}>
              Today
            </button>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From</label>
              <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">To</label>
              <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={downloadHiringReportExcel} className="btn text-sm px-3 py-1.5">Download Excel</button>
              <button onClick={downloadHiringReportPdf} className="btn text-sm px-3 py-1.5 flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Download PDF</button>
            </div>
          </div>
        </div>

        {/* KPI tiles — same shape as the top-of-page overview, scoped to the range */}
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {[
            { label: "Candidates", value: hiringReportKpi.candidates, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
            { label: "Scheduled for Interview", value: hiringReportKpi.scheduled, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
            { label: "Rejected", value: hiringReportKpi.rejected, color: "text-red-300", icon: <XCircle className="h-4 w-4" /> },
            { label: "Hired", value: hiringReportKpi.hired, color: "text-green-300", icon: <UserCheck className="h-4 w-4" /> },
            { label: "Terminated", value: hiringReportKpi.terminated, color: "text-red-400", icon: <UserX className="h-4 w-4" /> },
            { label: "Resigned", value: hiringReportKpi.resigned, color: "text-slate-300", icon: <UserMinus className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ── Generate EOD / EOM Hiring Grid Report ── */}
      {activeTab === "report" && (
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Generate EOD / EOM Hiring Report</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Grouped by Position → Branch. Staff Needed is manually entered and moves ±1 automatically when a candidate is hired or a hire is reversed. Export the grid below for a specific day or month.</p>
        </div>

        <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-end gap-6">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">EOD Date</label>
              <input type="date" value={genEodDate} onChange={(e) => setGenEodDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <button
              onClick={() => downloadEodHiringReport("excel")}
              disabled={genEodBusy !== null}
              className="btn text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {genEodBusy === "excel" ? "Generating…" : "Download EOD Excel"}
            </button>
            <button
              onClick={() => downloadEodHiringReport("pdf")}
              disabled={genEodBusy !== null}
              className="btn text-sm px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> {genEodBusy === "pdf" ? "Generating…" : "Download EOD PDF"}
            </button>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">EOM Month</label>
              <input type="month" value={genEomMonth} onChange={(e) => setGenEomMonth(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <button
              onClick={() => downloadEomHiringReport("excel")}
              disabled={genEomBusy !== null}
              className="btn text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {genEomBusy === "excel" ? "Generating…" : "Download EOM Excel"}
            </button>
            <button
              onClick={() => downloadEomHiringReport("pdf")}
              disabled={genEomBusy !== null}
              className="btn text-sm px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> {genEomBusy === "pdf" ? "Generating…" : "Download EOM PDF"}
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5">
            <button type="button" onClick={() => setHiringReportMode("eod")} className={`px-4 text-xs font-medium transition-colors ${hiringReportMode === "eod" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>EOD (Daily)</button>
            <button type="button" onClick={() => setHiringReportMode("eom")} className={`px-4 text-xs font-medium transition-colors border-l border-white/15 ${hiringReportMode === "eom" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>EOM (Monthly)</button>
          </div>
          {hiringReportMode === "eod" ? (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
              <input type="date" value={eodDate} onChange={(e) => setEodDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Month</label>
              <input type="month" value={eomMonth} onChange={(e) => setEomMonth(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {(() => {
            const rows = hiringReportMode === "eod" ? eodRows : eomRows;
            const loading = hiringReportMode === "eod" ? eodLoading : eomLoading;
            const emptyMessage =
              hiringReportMode === "eod" ? "No hiring activity or Staff Needed targets yet." : "No hiring activity recorded for this month.";
            return (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Branch</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sponsor End Date</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Staff Needed</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Active Trainee / On Hold</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Scheduled Interviews</th>
                  <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">CVs Sent to BM</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">{emptyMessage}</td></tr>
                ) : (
                  rows.map((r, i) => {
                    const showPositionBand = i === 0 || rows[i - 1].position !== r.position;
                    const trainee = r.activeTrainees[0];
                    const traineeText = r.onHold
                      ? "On Hold"
                      : r.activeTrainees.length > 0
                      ? `${r.activeTrainees.length}${trainee?.date ? ` on ${new Date(trainee.date).toLocaleDateString()}` : ""}`
                      : null;
                    const interview = r.scheduledInterviews[0];
                    const interviewText =
                      r.scheduledInterviews.length > 0
                        ? `${r.scheduledInterviews.length}${interview?.date ? ` on ${new Date(interview.date).toLocaleDateString()}` : ""}`
                        : null;
                    return (
                      <Fragment key={`${r.position}||${r.branch}`}>
                        {showPositionBand && (
                          <tr key={`${r.position}-band`} className="bg-blue-500/10">
                            <td colSpan={6} className="px-4 py-2 font-semibold text-blue-300 text-xs uppercase tracking-wide">{r.position}</td>
                          </tr>
                        )}
                        <tr key={`${r.position}||${r.branch}`} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-4 py-3 font-medium">{r.branch}</td>
                          {/* Placeholder — not wired to any data source yet, pending definition. */}
                          <td className="px-4 py-3 text-muted-foreground text-xs">—</td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={0}
                              defaultValue={r.staffNeeded}
                              key={`${r.position}||${r.branch}||${r.staffNeeded}`}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (v !== r.staffNeeded) handleStaffNeededChange(r.position, r.branch, v);
                              }}
                              className="glass-input text-sm w-20 py-1 px-2 rounded-md"
                            />
                          </td>
                          <td className="px-4 py-3">
                            {traineeText ? (
                              r.onHold ? (
                                <span className="px-2 py-1 rounded text-xs font-semibold bg-slate-500/20 text-slate-300">{traineeText}</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setHiringDetailDialog({ title: `${r.position} — ${r.branch} — Active Trainees`, items: r.activeTrainees })}
                                  className="px-2 py-1 rounded text-xs font-semibold bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition-colors"
                                >
                                  {traineeText}
                                </button>
                              )
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {interviewText ? (
                              <button
                                type="button"
                                onClick={() => setHiringDetailDialog({ title: `${r.position} — ${r.branch} — Scheduled Interviews`, items: r.scheduledInterviews })}
                                className="px-2 py-1 rounded text-xs font-semibold bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 transition-colors"
                              >
                                {interviewText}
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {r.cvsSentToBm.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setCvForwardDetailDialog({ title: `${r.position} — ${r.branch} — CVs Sent to BM`, items: r.cvsSentToBm })}
                                className="px-2 py-1 rounded text-xs font-semibold bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors"
                              >
                                {r.cvsSentToBm.length}
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
            );
          })()}
        </div>
      </div>
      )}

      {/* ── Generate Warnings & Mistakes Report ── */}
      {activeTab === "report" && (
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Generate Mistakes &amp; Warnings Report</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Totals of approved Warnings and Mistakes for the selected range.</p>
        </div>

        {/* Range filter */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <button type="button" onClick={setWmReportRangeToday} className={`btn text-sm px-3 py-1.5 mb-0.5 ${wmReportFrom === today && wmReportTo === today ? "bg-primary/20 text-primary" : ""}`}>
              Today
            </button>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From</label>
              <input type="date" value={wmReportFrom} onChange={(e) => setWmReportFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">To</label>
              <input type="date" value={wmReportTo} onChange={(e) => setWmReportTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={downloadWmReportExcel} className="btn text-sm px-3 py-1.5">Download Excel</button>
              <button onClick={downloadWmReportPdf} className="btn text-sm px-3 py-1.5 flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Download PDF</button>
            </div>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="p-4 grid grid-cols-2 gap-2">
          <div className="panel p-3 text-center">
            <div className="flex justify-center mb-1 text-muted-foreground"><AlertTriangle className="h-4 w-4" /></div>
            <p className="text-xl font-bold text-yellow-300">{wmReportKpi.warnings}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Warnings</p>
          </div>
          <div className="panel p-3 text-center">
            <div className="flex justify-center mb-1 text-muted-foreground"><XCircle className="h-4 w-4" /></div>
            <p className="text-xl font-bold text-orange-300">{wmReportKpi.mistakes}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Mistakes</p>
          </div>
        </div>
      </div>
      )}

      {/* ── Generate Certificate of Employment ── */}
      {activeTab === "coe" && (
      <>
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">Generate Certificate of Employment</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Fill in the fields below, then generate a printable/PDF certificate on the US In Home Services letterhead.</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setCoeTemplateDraft(coeBodyTemplate); setCoeTemplateModalOpen(true); }}
              className="btn text-xs px-2.5 py-1.5 shrink-0"
            >
              Edit Template
            </button>
          )}
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Honorific</label>
            <select
              value={coeForm.honorific}
              onChange={(e) => updateCoeField("honorific", e.target.value)}
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            >
              <option value="Mr.">Mr.</option>
              <option value="Ms.">Ms.</option>
              <option value="Mrs.">Mrs.</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Name</label>
            <input
              type="text"
              value={coeForm.employeeName}
              onChange={(e) => { updateCoeField("employeeName", e.target.value); setCoeEmployeeNameDropdownOpen(true); }}
              onFocus={() => setCoeEmployeeNameDropdownOpen(true)}
              onBlur={() => setTimeout(() => setCoeEmployeeNameDropdownOpen(false), 150)}
              placeholder="Search an employee…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {coeEmployeeNameDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredCoeEmployeeOptions(coeForm.employeeName).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching employees.</p>
                ) : (
                  filteredCoeEmployeeOptions(coeForm.employeeName).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => { updateCoeField("employeeName", e.name); setCoeEmployeeNameDropdownOpen(false); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/10"
                    >
                      {e.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Start Date</label>
            <input type="date" value={coeForm.employeeStartDate} onChange={(e) => updateCoeField("employeeStartDate", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Job Title</label>
            <input
              type="text"
              value={coeForm.jobTitle}
              onChange={(e) => { updateCoeField("jobTitle", e.target.value); setCoeJobTitleDropdownOpen(true); }}
              onFocus={() => setCoeJobTitleDropdownOpen(true)}
              onBlur={() => setTimeout(() => setCoeJobTitleDropdownOpen(false), 150)}
              placeholder="e.g. Customer Service Representative"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {coeJobTitleDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredCoeJobTitleOptions(coeForm.jobTitle).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching roles — your typed text will be used as-is.</p>
                ) : (
                  filteredCoeJobTitleOptions(coeForm.jobTitle).map((title) => (
                    <button
                      key={title}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => { updateCoeField("jobTitle", title); setCoeJobTitleDropdownOpen(false); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/10"
                    >
                      {title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reason</label>
            <input type="text" value={coeForm.reason} onChange={(e) => updateCoeField("reason", e.target.value)} placeholder="e.g. visa application, loan application" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>

          <div className="md:col-span-2 pt-2 mt-1 border-t border-white/10">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Authorized Representative (Sincerely — Sign-off)</p>
          </div>
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Name</label>
            <input
              type="text"
              value={coeForm.authorizedRep}
              onChange={(e) => { updateCoeField("authorizedRep", e.target.value); setCoeAuthorizedRepDropdownOpen(true); }}
              onFocus={() => setCoeAuthorizedRepDropdownOpen(true)}
              onBlur={() => setTimeout(() => setCoeAuthorizedRepDropdownOpen(false), 150)}
              placeholder="Signer's name"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {coeAuthorizedRepDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredCoeAuthorizedRepOptions(coeForm.authorizedRep).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching Admin/HR/BizOps accounts — your typed text will be used as-is.</p>
                ) : (
                  filteredCoeAuthorizedRepOptions(coeForm.authorizedRep).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setCoeForm((prev) => ({ ...prev, authorizedRep: e.name, authorizedRepEmail: e.email }));
                        setCoeAuthorizedRepDropdownOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/10"
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Email</label>
            <input type="text" value={coeForm.authorizedRepEmail} onChange={(e) => updateCoeField("authorizedRepEmail", e.target.value)} placeholder="e.g. name@usinhomeservices.com" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Phone</label>
            <input type="text" value={coeForm.authorizedRepPhone} onChange={(e) => updateCoeField("authorizedRepPhone", e.target.value)} placeholder="e.g. 800-779-3579" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>

          <div className="md:col-span-2 pt-2 mt-1 border-t border-white/10">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">For Office Use Only</p>
          </div>
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Name</label>
            <input
              type="text"
              value={coeForm.officeUseName}
              onChange={(e) => { updateCoeField("officeUseName", e.target.value); setCoeOfficeUseNameDropdownOpen(true); }}
              onFocus={() => setCoeOfficeUseNameDropdownOpen(true)}
              onBlur={() => setTimeout(() => setCoeOfficeUseNameDropdownOpen(false), 150)}
              placeholder="Signer's name"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {coeOfficeUseNameDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredCoeOfficeUseNameOptions(coeForm.officeUseName).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching Admin/HR/BizOps accounts — your typed text will be used as-is.</p>
                ) : (
                  filteredCoeOfficeUseNameOptions(coeForm.officeUseName).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setCoeForm((prev) => ({ ...prev, officeUseName: e.name, officeUseTitle: ROLE_LABELS[normalizeRole(e.position)] ?? e.position }));
                        setCoeOfficeUseNameDropdownOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/10"
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Title</label>
            <input type="text" value={coeForm.officeUseTitle} onChange={(e) => updateCoeField("officeUseTitle", e.target.value)} placeholder="e.g. CSR Manager" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signature</label>
            <input type="text" value={coeForm.officeUseSignature} onChange={(e) => updateCoeField("officeUseSignature", e.target.value)} placeholder="Typed name as signature" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Contact Number</label>
            <input type="text" value={coeForm.officeUseNumber} onChange={(e) => updateCoeField("officeUseNumber", e.target.value)} placeholder="e.g. 800-779-3579" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
        </div>

        <div className="px-4 py-4 border-t border-white/10 flex justify-end">
          <button
            onClick={handleGenerateCoe}
            disabled={coeGenerating}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {coeGenerating ? "Loading…" : "Preview & Send"}
          </button>
        </div>
      </div>

      {/* ── COE Sent History ── */}
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">COE Sent History</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Every Certificate of Employment sent from this tab, with a link back to the exact PDF that went out.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent To</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent By</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Document</th>
              </tr>
            </thead>
            <tbody>
              {coeDocumentsLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
              ) : coeDocuments.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No COEs sent yet.</td></tr>
              ) : (
                coeDocuments.map((doc) => (
                  <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">
                      <button type="button" onClick={() => setCoeDocumentPreview(doc)} className="hover:text-blue-300 hover:underline text-left">
                        {doc.employeeName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{doc.recipientName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{doc.sentByName ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(doc.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <a href={doc.documentUrl} target="_blank" rel="noopener noreferrer" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit"><Download className="h-3 w-3" /> View PDF</a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* COE Sent History — PDF preview, same inline-frame pattern used elsewhere in this dashboard */}
      {coeDocumentPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setCoeDocumentPreview(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{coeDocumentPreview.employeeName}</p>
                <p className="text-[10px] text-muted-foreground">Sent to {coeDocumentPreview.recipientName ?? "—"} — {new Date(coeDocumentPreview.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <a href={coeDocumentPreview.documentUrl} target="_blank" rel="noopener noreferrer" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1"><Download className="h-3 w-3" /> Download</a>
                <button type="button" onClick={() => setCoeDocumentPreview(null)} className="btn text-xs px-2.5 py-1.5">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-slate-950">
              <iframe src={coeDocumentPreview.documentUrl} title="Certificate of Employment" className="w-full h-full min-h-[70vh] border-0" />
            </div>
          </div>
        </div>
      )}

      {/* Certificate of Employment — Edit Template (Admin-only, doesn't touch the form fields above, just the certificate's prose paragraphs) */}
      {coeTemplateModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setCoeTemplateModalOpen(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-white/10">
              <h3 className="text-sm font-semibold">Edit Certificate Body Template</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Only the paragraph text below is editable — the form fields, header, and signature block stay as they are.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <textarea
                value={coeTemplateDraft}
                onChange={(e) => setCoeTemplateDraft(e.target.value)}
                rows={12}
                className="glass-input text-sm w-full p-3 rounded-md font-mono"
              />
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold mb-1">Available placeholders:</p>
                <div className="flex flex-wrap gap-1.5">
                  {COE_BODY_PLACEHOLDERS.map((p) => (
                    <code key={p} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">{`{{${p}}}`}</code>
                  ))}
                </div>
                <p className="mt-2">Separate paragraphs with a blank line.</p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setCoeTemplateModalOpen(false)} className="btn text-sm px-3 py-1.5">Cancel</button>
              <button
                type="button"
                onClick={() => { setCoeTemplateDraft(DEFAULT_COE_BODY_TEMPLATE); }}
                className="btn text-sm px-3 py-1.5"
                title="Reset to the original default text"
              >
                Reset to Default
              </button>
              <button
                type="button"
                onClick={handleSaveCoeBodyTemplate}
                disabled={coeTemplateSaving}
                className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {coeTemplateSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Certificate of Employment — preview, then pick a recipient and send via Team Messenger */}
      {coePreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Certificate of Employment — Preview</h3>
              <button onClick={() => setCoePreviewOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Preview — rendered at native 800px width, scaled down to fit; this exact DOM node is what gets captured into the sent PDF. */}
              <div className="lg:col-span-2 overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
                <div style={{ transform: "scale(0.85)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: coeStyles }} />
                  <div ref={coePreviewRef} dangerouslySetInnerHTML={{ __html: buildCoeBodyMarkup(coeImages.logo, coeImages.ribbon, coeImages.footer) }} />
                </div>
              </div>

              {/* Recipient + actions */}
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                  <div className="relative mt-1">
                    <input
                      type="text"
                      value={coeRecipientSearch}
                      onChange={(e) => {
                        setCoeRecipientSearch(e.target.value);
                        setCoeRecipientId("");
                        setCoeRecipientDropdownOpen(true);
                      }}
                      onFocus={() => setCoeRecipientDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setCoeRecipientDropdownOpen(false), 150)}
                      placeholder="Search a teammate…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                    />
                    {coeRecipientDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                        {filteredCoeRecipients.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                        ) : (
                          filteredCoeRecipients.map((e) => (
                            <button
                              key={e.id}
                              type="button"
                              onMouseDown={(ev) => ev.preventDefault()}
                              onClick={() => {
                                setCoeRecipientId(e.id);
                                setCoeRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                setCoeRecipientDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${coeRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                            >
                              {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 mt-auto">
                  {coeSendError && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{coeSendError}</p>
                  )}
                  <button
                    onClick={handleSendCoe}
                    disabled={!coeRecipientId || coeSending}
                    className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {coeSending ? "Sending…" : "Send via Team Messenger"}
                  </button>
                  <button onClick={handleDownloadCoe} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download PDF instead
                  </button>
                  <button onClick={() => setCoePreviewOpen(false)} className="btn text-sm px-4 py-2">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Generate Employee Warning Form ── */}
      {activeTab === "warningForm" && (
      <>
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Generate Employee Warning Form</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Fill in the fields below. Sending logs the warning and sends it to the recipient to sign — it comes back to you automatically once signed.</p>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Name</label>
            <input
              type="text"
              value={warnForm.employeeName}
              onChange={(e) => { updateWarnField("employeeName", e.target.value); updateWarnField("employeeId", ""); setWarnEmployeeDropdownOpen(true); }}
              onFocus={() => setWarnEmployeeDropdownOpen(true)}
              onBlur={() => setTimeout(() => setWarnEmployeeDropdownOpen(false), 150)}
              placeholder="Search an employee…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {warnEmployeeDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredWarnEmployeeOptions(warnForm.employeeName).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching employees.</p>
                ) : (
                  filteredWarnEmployeeOptions(warnForm.employeeName).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => selectWarnEmployee(e)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${warnForm.employeeId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Branch Location</label>
            <input type="text" value={warnForm.branch} onChange={(e) => updateWarnField("branch", e.target.value)} placeholder="Auto-fills from employee" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Role</label>
            <input type="text" value={warnForm.role} onChange={(e) => updateWarnField("role", e.target.value)} placeholder="Auto-fills from employee" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Warning Date</label>
            <input type="date" value={warnForm.warningDate} onChange={(e) => updateWarnField("warningDate", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
        </div>

        <div className="px-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Type of Warning</label>
            <div className="flex gap-4 flex-wrap">
              {(["1st", "2nd", "3rd"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => updateWarnField("level", warnForm.level === lvl ? "" : lvl)}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <span className="text-base">{warnForm.level === lvl ? "☑" : "☐"}</span> {lvl} Warning
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Reason(s) for Warning</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ["absence", "Absence"],
                ["tardiness", "Tardiness"],
                ["inappropriateBehavior", "Inappropriate Behavior"],
                ["insubordination", "Insubordination"],
                ["policyViolation", "Policy Violation"],
                ["equipmentDamage", "Equipment Damage"],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => toggleWarnReason(key)} className="flex items-center gap-1.5 text-sm text-left">
                  <span className="text-base">{warnForm.reasons[key] ? "☑" : "☐"}</span> {label}
                </button>
              ))}
              <button type="button" onClick={() => toggleWarnReason("other")} className="flex items-center gap-1.5 text-sm col-span-2">
                <span className="text-base">{warnForm.reasons.other ? "☑" : "☐"}</span> Other:
              </button>
              {warnForm.reasons.other && (
                <input
                  type="text"
                  value={warnForm.otherReasonText}
                  onChange={(e) => updateWarnField("otherReasonText", e.target.value)}
                  placeholder="Specify…"
                  className="glass-input text-sm py-1.5 px-3 rounded-md col-span-2"
                />
              )}
            </div>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Description of Actions/Behaviors</label>
            <textarea value={warnForm.description} onChange={(e) => updateWarnField("description", e.target.value)} rows={4} placeholder="Detailed description…" className="glass-input text-sm py-1.5 px-3 rounded-md resize-y" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Corrective Actions</label>
            <textarea value={warnForm.correctiveActions} onChange={(e) => updateWarnField("correctiveActions", e.target.value)} rows={4} placeholder="Corrective actions the employee must take…" className="glass-input text-sm py-1.5 px-3 rounded-md resize-y" />
          </div>
        </div>

        {warnForm.employeeId && (
          <div className="px-4 pb-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Previous Warning(s) Issued (auto-filled)</p>
            {warnPreviousWarnings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No prior approved warnings on record for this employee.</p>
            ) : (
              <ul className="text-xs space-y-1">
                {warnPreviousWarnings.map((w, i) => (
                  <li key={i} className="text-muted-foreground">
                    {i + 1}. {w.cause} — <span className="text-foreground">{new Date(w.date).toLocaleDateString()}</span>, issued by {w.issuedBy}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="px-4 py-4 border-t border-white/10 flex justify-end">
          <button
            onClick={handleOpenWarnPreview}
            disabled={warnGenerating || !warnForm.employeeId}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {warnGenerating ? "Loading…" : "Preview & Send"}
          </button>
        </div>
      </div>

      {/* ── Sent Warning Forms tracking ── */}
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Sent Warning Forms</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Track signature status. Confirming finalizes the warning onto the employee's official record; cancelling voids it.</p>
        </div>
        {warnActionError && (
          <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{warnActionError}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Issued By</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Recipient</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentWarningForms.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No warning forms sent yet.</td></tr>
              ) : (
                sentWarningForms.map((doc) => {
                  const data = doc.formData as unknown as WarningFormData;
                  const recipient = employees.find((e) => e.id === doc.recipientId);
                  const busy = warnActionBusyId === doc.id;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">
                        <button type="button" onClick={() => handleViewWarnForm(doc)} className="text-blue-300 hover:text-blue-200 hover:underline text-left">
                          {data.employeeName}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.createdByName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{recipient?.name ?? "—"} <span className="text-[10px] uppercase">({doc.recipientSlot.replace("_", " ")})</span></td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          doc.status === "confirmed" ? "bg-green-500/20 text-green-300"
                          : doc.status === "signed" ? "bg-blue-500/20 text-blue-300"
                          : doc.status === "cancelled" ? "bg-slate-500/20 text-slate-400"
                          : "bg-yellow-500/20 text-yellow-300"
                        }`}>
                          {doc.status === "pending_signature" ? "Awaiting Signature" : doc.status === "signed" ? "Signed — Awaiting Confirmation" : doc.status === "confirmed" ? "Confirmed" : "Cancelled"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(doc.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(doc.status === "pending_signature" || doc.status === "signed") && (
                            <>
                              {doc.status === "signed" && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => { setReassignDialog(doc); setReassignRecipientId(""); setReassignRecipientSearch(""); }}
                                    className="btn text-[10px] px-2 py-1 disabled:opacity-50"
                                  >
                                    Send to Next Recipient
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleConfirmWarningForm(doc)}
                                    className="btn text-[10px] px-2 py-1 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                                  >
                                    Confirm Warning
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleCancelWarningForm(doc)}
                                className="btn text-[10px] px-2 py-1 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                              >
                                Cancel Warning
                              </button>
                            </>
                          )}
                          {doc.status === "confirmed" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCancelWarningForm(doc)}
                              className="btn text-[10px] px-2 py-1 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50"
                            >
                              Revert Warning
                            </button>
                          )}
                          {doc.pdfUrl && (
                            <button
                              type="button"
                              onClick={() => handleDownloadWarningFormPdf(doc)}
                              className="text-blue-300 hover:text-blue-200 underline text-xs"
                            >
                              Download PDF
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteWarningForm(doc)}
                            title="Permanently delete this warning form"
                            className="text-muted-foreground hover:text-red-300 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {activeTab === "w8ben" && (
      <>
      <div className="flex gap-2 mt-4">
        {(["w8ben", "w4", "w9"] as const).map((ft) => (
          <button
            key={ft}
            type="button"
            onClick={() => setW8FormType(ft)}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold border transition-colors ${
              w8FormType === ft ? "border-primary/50 bg-primary/10 text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground"
            }`}
          >
            {ft === "w8ben" ? "W-8BEN" : ft === "w4" ? "W-4" : "W-9"}
          </button>
        ))}
      </div>

      {w8FormType === "w8ben" && (
      <>
      <div className="panel p-0 overflow-visible mt-4 relative z-20">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Send W-8BEN Request</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Pick a teammate — they'll get a link to fill in and sign their own Form W-8BEN. It comes back to you here automatically once submitted.</p>
        </div>
        <div className="p-4 flex flex-col gap-3 max-w-md">
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
            <input
              type="text"
              value={w8RecipientSearch}
              onChange={(e) => { setW8RecipientSearch(e.target.value); setW8RecipientId(""); setW8RecipientDropdownOpen(true); }}
              onFocus={() => setW8RecipientDropdownOpen(true)}
              onBlur={() => setTimeout(() => setW8RecipientDropdownOpen(false), 150)}
              placeholder="Search a teammate…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {w8RecipientDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full max-h-96 overflow-y-auto rounded-md border border-white/15 bg-slate-900 shadow-2xl">
                {filteredW8Recipients.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                ) : (
                  filteredW8Recipients.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setW8RecipientId(e.id);
                        setW8RecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                        setW8RecipientDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${w8RecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {w8SendError && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{w8SendError}</p>
          )}
          <button
            onClick={handleOpenW8benPreview}
            disabled={!w8RecipientId || w8Sending}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 w-fit"
          >
            Preview & Send
          </button>
        </div>
      </div>

      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">W-8BEN Sent History</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Track completion status.</p>
        </div>
        {w8ActionError && (
          <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{w8ActionError}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent By</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentW8benForms.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No W-8BEN requests sent yet.</td></tr>
              ) : (
                sentW8benForms.map((doc) => {
                  const data = doc.formData as Partial<W8benFormData>;
                  const recipient = employees.find((e) => e.id === doc.recipientId);
                  const busy = w8ActionBusyId === doc.id;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">
                        {doc.pdfUrl ? (
                          <button type="button" onClick={() => setW8DocPreview(doc)} className="text-blue-300 hover:text-blue-200 hover:underline text-left">
                            {data.employeeName || recipient?.name || "—"}
                          </button>
                        ) : (
                          data.employeeName || recipient?.name || "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.createdByName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          doc.status === "signed" ? "bg-green-500/20 text-green-300"
                          : doc.status === "cancelled" ? "bg-slate-500/20 text-slate-400"
                          : "bg-yellow-500/20 text-yellow-300"
                        }`}>
                          {doc.status === "signed" ? "Submitted" : doc.status === "cancelled" ? "Cancelled" : "Awaiting Completion"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(doc.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {doc.status === "pending_signature" && (
                            <button type="button" onClick={() => handleCopyW8benLink(doc)} className="btn text-[10px] px-2 py-1">
                              Copy Link
                            </button>
                          )}
                          {doc.pdfUrl && (
                            <button type="button" onClick={() => handleDownloadW8benPdf(doc)} className="text-blue-300 hover:text-blue-200 underline text-xs">
                              Download PDF
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteW8ben(doc)}
                            title="Permanently delete this request"
                            className="text-muted-foreground hover:text-red-300 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {w8FormType === "w4" && (
      <>
      <div className="panel p-0 overflow-visible mt-4 relative z-20">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Send W-4 Request</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Pick a teammate — they'll get a link to fill in and sign their own Form W-4. It comes back to you here automatically once submitted.</p>
        </div>
        <div className="p-4 flex flex-col gap-3 max-w-md">
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
            <input
              type="text"
              value={w4RecipientSearch}
              onChange={(e) => { setW4RecipientSearch(e.target.value); setW4RecipientId(""); setW4RecipientDropdownOpen(true); }}
              onFocus={() => setW4RecipientDropdownOpen(true)}
              onBlur={() => setTimeout(() => setW4RecipientDropdownOpen(false), 150)}
              placeholder="Search a teammate…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {w4RecipientDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full max-h-96 overflow-y-auto rounded-md border border-white/15 bg-slate-900 shadow-2xl">
                {filteredW4Recipients.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                ) : (
                  filteredW4Recipients.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setW4RecipientId(e.id);
                        setW4RecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                        setW4RecipientDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${w4RecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {w4SendError && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{w4SendError}</p>
          )}
          <button
            onClick={handleOpenW4Preview}
            disabled={!w4RecipientId || w4Sending}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 w-fit"
          >
            Preview & Send
          </button>
        </div>
      </div>

      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">W-4 Sent History</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Track completion status.</p>
        </div>
        {w4ActionError && (
          <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{w4ActionError}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Employee</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent By</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentW4Forms.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No W-4 requests sent yet.</td></tr>
              ) : (
                sentW4Forms.map((doc) => {
                  const data = doc.formData as Partial<W4FormData>;
                  const recipient = employees.find((e) => e.id === doc.recipientId);
                  const employeeName = `${data.firstNameMiddleInitial ?? ""} ${data.lastName ?? ""}`.trim();
                  const busy = w4ActionBusyId === doc.id;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">
                        {doc.pdfUrl ? (
                          <button type="button" onClick={() => setW4DocPreview(doc)} className="text-blue-300 hover:text-blue-200 hover:underline text-left">
                            {employeeName || recipient?.name || "—"}
                          </button>
                        ) : (
                          employeeName || recipient?.name || "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.createdByName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          doc.status === "signed" ? "bg-green-500/20 text-green-300"
                          : doc.status === "cancelled" ? "bg-slate-500/20 text-slate-400"
                          : "bg-yellow-500/20 text-yellow-300"
                        }`}>
                          {doc.status === "signed" ? "Submitted" : doc.status === "cancelled" ? "Cancelled" : "Awaiting Completion"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(doc.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {doc.status === "pending_signature" && (
                            <button type="button" onClick={() => handleCopyW4Link(doc)} className="btn text-[10px] px-2 py-1">
                              Copy Link
                            </button>
                          )}
                          {doc.pdfUrl && (
                            <button type="button" onClick={() => handleDownloadW4Pdf(doc)} className="text-blue-300 hover:text-blue-200 underline text-xs">
                              Download PDF
                            </button>
                          )}
                          {doc.status === "signed" && (
                            <button type="button" onClick={() => handleOpenW4EmployerDialog(doc)} className="btn text-[10px] px-2 py-1">
                              Fill Employer Info
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteW4(doc)}
                            title="Permanently delete this request"
                            className="text-muted-foreground hover:text-red-300 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {w8FormType === "w9" && (
      <>
      <div className="panel p-0 overflow-visible mt-4 relative z-20">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Send W-9 Request</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Pick a teammate — they'll get a link to fill in and sign their own Form W-9. It comes back to you here automatically once submitted.</p>
        </div>
        <div className="p-4 flex flex-col gap-3 max-w-md">
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
            <input
              type="text"
              value={w9RecipientSearch}
              onChange={(e) => { setW9RecipientSearch(e.target.value); setW9RecipientId(""); setW9RecipientDropdownOpen(true); }}
              onFocus={() => setW9RecipientDropdownOpen(true)}
              onBlur={() => setTimeout(() => setW9RecipientDropdownOpen(false), 150)}
              placeholder="Search a teammate…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {w9RecipientDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full max-h-96 overflow-y-auto rounded-md border border-white/15 bg-slate-900 shadow-2xl">
                {filteredW9Recipients.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                ) : (
                  filteredW9Recipients.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setW9RecipientId(e.id);
                        setW9RecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                        setW9RecipientDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${w9RecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {w9SendError && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{w9SendError}</p>
          )}
          <button
            onClick={handleOpenW9Preview}
            disabled={!w9RecipientId || w9Sending}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 w-fit"
          >
            Preview & Send
          </button>
        </div>
      </div>

      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">W-9 Sent History</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Track completion status.</p>
        </div>
        {w9ActionError && (
          <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{w9ActionError}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent By</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Sent</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentW9Forms.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No W-9 requests sent yet.</td></tr>
              ) : (
                sentW9Forms.map((doc) => {
                  const data = doc.formData as Partial<W9FormData>;
                  const recipient = employees.find((e) => e.id === doc.recipientId);
                  const busy = w9ActionBusyId === doc.id;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">
                        {doc.pdfUrl ? (
                          <button type="button" onClick={() => setW9DocPreview(doc)} className="text-blue-300 hover:text-blue-200 hover:underline text-left">
                            {data.name || recipient?.name || "—"}
                          </button>
                        ) : (
                          data.name || recipient?.name || "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.createdByName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          doc.status === "signed" ? "bg-green-500/20 text-green-300"
                          : doc.status === "cancelled" ? "bg-slate-500/20 text-slate-400"
                          : "bg-yellow-500/20 text-yellow-300"
                        }`}>
                          {doc.status === "signed" ? "Submitted" : doc.status === "cancelled" ? "Cancelled" : "Awaiting Completion"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(doc.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {doc.status === "pending_signature" && (
                            <button type="button" onClick={() => handleCopyW9Link(doc)} className="btn text-[10px] px-2 py-1">
                              Copy Link
                            </button>
                          )}
                          {doc.pdfUrl && (
                            <button type="button" onClick={() => handleDownloadW9Pdf(doc)} className="text-blue-300 hover:text-blue-200 underline text-xs">
                              Download PDF
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteW9(doc)}
                            title="Permanently delete this request"
                            className="text-muted-foreground hover:text-red-300 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
      </>
      )}

      {/* Form W-8BEN — preview the REAL official PDF (fillW8benPdf, same function used at submission time) with a blank fill, not a redrawn approximation, before sending the fill-in link */}
      {w8PreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-4xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Form W-8BEN — Preview</h3>
              <button onClick={closeW8benPreview} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 bg-white/5">
              {w8PreviewLoading || !w8PreviewPdfUrl ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading preview…</div>
              ) : (
                <iframe src={w8PreviewPdfUrl} title="W-8BEN Preview" className="w-full h-full border-0" />
              )}
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-end gap-2">
              {w8SendError && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mr-auto">{w8SendError}</p>
              )}
              <button onClick={closeW8benPreview} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleSendW8ben}
                disabled={w8Sending}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {w8Sending ? "Sending…" : "Send W-8BEN Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* W-8BEN Sent History — PDF preview, same inline-frame pattern used for COE Sent History */}
      {w8DocPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setW8DocPreview(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{(w8DocPreview.formData as Partial<W8benFormData>).employeeName || "—"}</p>
                <p className="text-[10px] text-muted-foreground">Submitted {new Date(w8DocPreview.signedAt ?? w8DocPreview.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                {w8DocPreview.pdfUrl && (
                  <a href={w8DocPreview.pdfUrl} target="_blank" rel="noopener noreferrer" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1"><Download className="h-3 w-3" /> Download</a>
                )}
                <button type="button" onClick={() => setW8DocPreview(null)} className="btn text-xs px-2.5 py-1.5">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-slate-950">
              {w8DocPreview.pdfUrl && <iframe src={w8DocPreview.pdfUrl} title="Form W-8BEN" className="w-full h-full min-h-[70vh] border-0" />}
            </div>
          </div>
        </div>
      )}

      {/* Form W-4 — preview the REAL official PDF (fillW4Pdf, same function used at submission time) with a blank fill, before sending the fill-in link */}
      {w4PreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-4xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Form W-4 — Preview</h3>
              <button onClick={closeW4Preview} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 bg-white/5">
              {w4PreviewLoading || !w4PreviewPdfUrl ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading preview…</div>
              ) : (
                <iframe src={w4PreviewPdfUrl} title="W-4 Preview" className="w-full h-full border-0" />
              )}
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-end gap-2">
              {w4SendError && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mr-auto">{w4SendError}</p>
              )}
              <button onClick={closeW4Preview} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleSendW4}
                disabled={w4Sending}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {w4Sending ? "Sending…" : "Send W-4 Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* W-4 Sent History — PDF preview, same inline-frame pattern used for W-8BEN/COE Sent History */}
      {w4DocPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setW4DocPreview(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  {(() => {
                    const data = w4DocPreview.formData as Partial<W4FormData>;
                    return `${data.firstNameMiddleInitial ?? ""} ${data.lastName ?? ""}`.trim() || "—";
                  })()}
                </p>
                <p className="text-[10px] text-muted-foreground">Submitted {new Date(w4DocPreview.signedAt ?? w4DocPreview.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                {w4DocPreview.pdfUrl && (
                  <a href={w4DocPreview.pdfUrl} target="_blank" rel="noopener noreferrer" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1"><Download className="h-3 w-3" /> Download</a>
                )}
                <button type="button" onClick={() => setW4DocPreview(null)} className="btn text-xs px-2.5 py-1.5">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-slate-950">
              {w4DocPreview.pdfUrl && <iframe src={w4DocPreview.pdfUrl} title="Form W-4" className="w-full h-full min-h-[70vh] border-0" />}
            </div>
          </div>
        </div>
      )}

      {/* Form W-9 — preview the REAL official PDF (fillW9Pdf, same function used at submission time) with a blank fill, before sending the fill-in link */}
      {w9PreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-4xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Form W-9 — Preview</h3>
              <button onClick={closeW9Preview} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 bg-white/5">
              {w9PreviewLoading || !w9PreviewPdfUrl ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading preview…</div>
              ) : (
                <iframe src={w9PreviewPdfUrl} title="W-9 Preview" className="w-full h-full border-0" />
              )}
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-end gap-2">
              {w9SendError && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mr-auto">{w9SendError}</p>
              )}
              <button onClick={closeW9Preview} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleSendW9}
                disabled={w9Sending}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {w9Sending ? "Sending…" : "Send W-9 Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* W-9 Sent History — PDF preview, same inline-frame pattern used for W-8BEN/W-4/COE Sent History */}
      {w9DocPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setW9DocPreview(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{(w9DocPreview.formData as Partial<W9FormData>).name || "—"}</p>
                <p className="text-[10px] text-muted-foreground">Submitted {new Date(w9DocPreview.signedAt ?? w9DocPreview.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                {w9DocPreview.pdfUrl && (
                  <a href={w9DocPreview.pdfUrl} target="_blank" rel="noopener noreferrer" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1"><Download className="h-3 w-3" /> Download</a>
                )}
                <button type="button" onClick={() => setW9DocPreview(null)} className="btn text-xs px-2.5 py-1.5">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-slate-950">
              {w9DocPreview.pdfUrl && <iframe src={w9DocPreview.pdfUrl} title="Form W-9" className="w-full h-full min-h-[70vh] border-0" />}
            </div>
          </div>
        </div>
      )}

      {/* HR completing the W-4's "Employers Only" box after the employee has already submitted */}
      {w4EmployerDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">Fill Employer Info</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Completes the "Employers Only" box on{" "}
              <span className="font-semibold text-white">
                {(() => {
                  const data = w4EmployerDialog.formData as Partial<W4FormData>;
                  return `${data.firstNameMiddleInitial ?? ""} ${data.lastName ?? ""}`.trim();
                })()}
              </span>
              's submitted W-4.
            </p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employer's name and address</label>
                <textarea value={w4EmployerNameAddress} onChange={(e) => setW4EmployerNameAddress(e.target.value)} rows={2} className="glass-input text-sm py-1.5 px-3 rounded-md resize-y" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">First date of employment</label>
                <input type="date" value={w4EmployerFirstDate} onChange={(e) => setW4EmployerFirstDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employer identification number (EIN)</label>
                <input type="text" placeholder="XX-XXXXXXX" value={w4EmployerEin} onChange={(e) => setW4EmployerEin(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
            </div>
            {w4EmployerError && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{w4EmployerError}</p>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setW4EmployerDialog(null)} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleSaveW4EmployerInfo}
                disabled={w4EmployerSaving}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {w4EmployerSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send to Next Recipient — reassign a signed-back document to another signer */}
      {reassignDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">Send to Next Recipient</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Forward <span className="font-semibold text-white">{(reassignDialog.formData as unknown as WarningFormData).employeeName}</span>'s warning form to another signer.
            </p>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
            <div className="relative mt-1 mb-3">
              <input
                type="text"
                value={reassignRecipientSearch}
                onChange={(e) => { setReassignRecipientSearch(e.target.value); setReassignRecipientId(""); setReassignRecipientDropdownOpen(true); }}
                onFocus={() => setReassignRecipientDropdownOpen(true)}
                onBlur={() => setTimeout(() => setReassignRecipientDropdownOpen(false), 150)}
                placeholder="Search a teammate…"
                className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
              />
              {reassignRecipientDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                  {filteredReassignRecipients.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                  ) : (
                    filteredReassignRecipients.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => {
                          setReassignRecipientId(e.id);
                          setReassignRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                          setReassignRecipientDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${reassignRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                      >
                        {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
            <select value={reassignSlot} onChange={(e) => setReassignSlot(e.target.value as SignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1 mb-4">
              <option value="manager">Manager</option>
              <option value="senior_manager">Senior Manager</option>
              <option value="hr_staff">HR Staff</option>
              <option value="employee">Employee</option>
            </select>
            {warnActionError && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{warnActionError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setReassignDialog(null)} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleSendToNextRecipient}
                disabled={!reassignRecipientId || warnActionBusyId === reassignDialog.id}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {warnActionBusyId === reassignDialog.id ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sent Warning Forms — view-only preview of the form as it stands right now (whatever signatures exist so far) */}
      {warnViewDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-6xl h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-bold">{(warnViewDoc.formData as unknown as WarningFormData).employeeName} — Warning Form</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Issued by {warnViewDoc.createdByName ?? "—"}</p>
              </div>
              <button onClick={() => setWarnViewDoc(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-white/5 flex justify-center">
              <div style={{ transform: "scale(0.85)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: warningFormStyles }} />
                <div
                  dangerouslySetInnerHTML={{
                    __html: buildWarningFormBodyMarkup(warnViewDoc.formData as unknown as WarningFormData, warnLogoDataUrl, warnViewDoc.signatures),
                  }}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
              {warnViewDoc.pdfUrl && (
                <a href={warnViewDoc.pdfUrl} target="_blank" rel="noreferrer noopener" className="btn text-sm px-4 py-2">Open PDF</a>
              )}
              <button onClick={() => setWarnViewDoc(null)} className="btn text-sm px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Warning Form — preview, pick who signs which line, send for signature */}
      {warnPreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Employee Warning Form — Preview</h3>
              <button onClick={() => setWarnPreviewOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
                <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: warningFormStyles }} />
                  <div
                    dangerouslySetInnerHTML={{
                      __html: buildWarningFormBodyMarkup(
                        buildWarnFormData(warnRecipientSlot, employees.find((e) => e.id === warnRecipientId)?.name || ""),
                        warnLogoDataUrl,
                        {}
                      ),
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                  <div className="relative mt-1">
                    <input
                      type="text"
                      value={warnRecipientSearch}
                      onChange={(e) => {
                        setWarnRecipientSearch(e.target.value);
                        setWarnRecipientId("");
                        setWarnRecipientDropdownOpen(true);
                      }}
                      onFocus={() => setWarnRecipientDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setWarnRecipientDropdownOpen(false), 150)}
                      placeholder="Search a teammate…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                    />
                    {warnRecipientDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                        {filteredWarnRecipients.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                        ) : (
                          filteredWarnRecipients.map((e) => (
                            <button
                              key={e.id}
                              type="button"
                              onMouseDown={(ev) => ev.preventDefault()}
                              onClick={() => {
                                setWarnRecipientId(e.id);
                                setWarnRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                setWarnRecipientDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${warnRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                            >
                              {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                  <select value={warnRecipientSlot} onChange={(e) => setWarnRecipientSlot(e.target.value as SignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1">
                    <option value="manager">Manager</option>
                    <option value="senior_manager">Senior Manager</option>
                    <option value="hr_staff">HR Staff</option>
                    <option value="employee">Employee</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2 mt-auto">
                  {warnSendError && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{warnSendError}</p>
                  )}
                  <button
                    onClick={handleSendWarningForm}
                    disabled={!warnRecipientId || warnSending}
                    className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {warnSending ? "Sending…" : "Send for Signature"}
                  </button>
                  <button onClick={handleDownloadWarningForm} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download PDF instead
                  </button>
                  <button onClick={() => setWarnPreviewOpen(false)} className="btn text-sm px-4 py-2">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jotform Submission Details — floating modal, blurred backdrop */}
      {selectedSubmission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedSubmission(null)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-white/10 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold truncate">{selectedSubmission.title}</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{selectedSubmission.body} · {new Date(selectedSubmission.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => downloadSubmissionPdf(selectedSubmission)}
                  title="Download as PDF"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
                <button onClick={() => setSelectedSubmission(null)} className="text-muted-foreground hover:text-foreground px-1">✕</button>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4">
              {(() => {
                const rows = parseAnswers(selectedSubmission.answers);
                return rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No additional details available for this submission.</p>
                ) : (
                  <div className="space-y-3">
                    {rows.map((r, i) => (
                      <div key={i}>
                        {r.label && <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{r.label}</p>}
                        <p className="text-sm break-words">{r.value || "—"}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {selectedSubmission.photos && selectedSubmission.photos.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Attachments</p>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedSubmission.photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-white/10 hover:opacity-80 transition-opacity">
                        <img src={url} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {selectedSubmission.attachmentErrors && selectedSubmission.attachmentErrors.length > 0 && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
                  <p className="text-[10px] font-semibold text-yellow-300 uppercase tracking-wide mb-1">
                    {selectedSubmission.attachmentErrors.length === 1 ? "1 attachment couldn't be saved" : `${selectedSubmission.attachmentErrors.length} attachments couldn't be saved`}
                  </p>
                  {selectedSubmission.attachmentErrors.map((err, i) => (
                    <p key={i} className="text-xs text-yellow-200/80">{err}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm">
            <h3 className="text-lg font-bold mb-2">Confirm Status Change</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to mark <span className="font-semibold text-white">{confirmDialog.employeeName}</span> as <span className="font-semibold text-white capitalize">{confirmDialog.newStatus}</span>? This will also deactivate their account.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={handleCancelStatusChange} className="btn text-sm px-4 py-2">Cancel</button>
              <button onClick={handleConfirmStatusChange} className={`btn text-sm px-4 py-2 text-white ${confirmDialog.newStatus === "terminated" ? "bg-red-600 hover:bg-red-700" : "bg-orange-600 hover:bg-orange-700"}`}>
                Confirm {confirmDialog.newStatus === "terminated" ? "Termination" : "Resignation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interviewing/Training require a date — collected here before the status actually saves */}
      {statusDateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">{CANDIDATE_STATUS_LABEL[statusDateDialog.status]}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              <span className="font-semibold text-white">{statusDateDialog.candidateName}</span> — set the {statusDateDialog.label.toLowerCase()}:
            </p>
            <input
              type="date"
              value={statusDateDialog.date}
              onChange={(e) => setStatusDateDialog({ ...statusDateDialog, date: e.target.value })}
              className="glass-input text-sm py-1.5 px-3 rounded-md w-full mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setStatusDateDialog(null)} className="btn text-sm px-4 py-2">Cancel</button>
              <button onClick={handleConfirmStatusDate} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Forward CV to a manager — sends a link via the internal messenger (Team Messenger) */}
      {forwardCvDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">Forward CV</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Send <span className="font-semibold text-white">{forwardCvDialog.name}</span>'s CV to a manager via the internal messenger.
            </p>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
            <div className="relative mt-1 mb-4">
              <input
                type="text"
                value={forwardRecipientSearch}
                onChange={(e) => {
                  setForwardRecipientSearch(e.target.value);
                  setForwardRecipientId("");
                  setForwardRecipientDropdownOpen(true);
                }}
                onFocus={() => setForwardRecipientDropdownOpen(true)}
                onBlur={() => setTimeout(() => setForwardRecipientDropdownOpen(false), 150)}
                placeholder="Search a manager…"
                className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
              />
              {forwardRecipientDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                  {filteredManagerRecipients.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No matching managers.</p>
                  ) : (
                    filteredManagerRecipients.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForwardRecipientId(m.id);
                          setForwardRecipientSearch(`${m.name} — ${ROLE_LABELS[normalizeRole(m.position)] ?? m.position}`);
                          setForwardRecipientDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${forwardRecipientId === m.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                      >
                        {m.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(m.position)] ?? m.position}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {managerRecipients.length === 0 && (
              <p className="text-xs text-yellow-300 mb-4">No manager accounts found in this company.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setForwardCvDialog(null); setForwardRecipientId(""); setForwardRecipientSearch(""); }} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleForwardCv}
                disabled={!forwardRecipientId || forwardSending}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {forwardSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* EOD detail popover — lists candidate names/dates behind a Scheduled Interviews / Active Trainees count badge */}
      {hiringDetailDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setHiringDetailDialog(null)}>
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{hiringDetailDialog.title}</h3>
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {hiringDetailDialog.items.map((it, idx) => (
                <li key={idx} className="flex items-center justify-between gap-3 text-sm border-b border-white/5 pb-2 last:border-0">
                  <span className="font-medium">{it.name}</span>
                  <span className="text-muted-foreground text-xs">{it.date ? new Date(it.date).toLocaleDateString() : "—"}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end mt-4">
              <button onClick={() => setHiringDetailDialog(null)} className="btn text-sm px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* CVs Sent to BM detail popover — candidate name, who received it, and when */}
      {cvForwardDetailDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCvForwardDetailDialog(null)}>
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{cvForwardDetailDialog.title}</h3>
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {cvForwardDetailDialog.items.map((it, idx) => (
                <li key={idx} className="text-sm border-b border-white/5 pb-2 last:border-0">
                  <div className="font-medium">{it.candidateName}</div>
                  <div className="text-muted-foreground text-xs">
                    Sent to <span className="text-foreground">{it.recipientName}</span> — {new Date(it.date).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-end mt-4">
              <button onClick={() => setCvForwardDetailDialog(null)} className="btn text-sm px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}
    </main></div>
  );
}
