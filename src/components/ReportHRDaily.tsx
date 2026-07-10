import { useState, useMemo, useEffect, Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Plus, Trash2, AlertTriangle, CheckCircle, XCircle, Paperclip, Users, Clock, UserCheck, UserX, UserMinus, Search, Bell, Download, Forward } from "lucide-react";
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
import { getAllAgentNotes, getPendingAgentNotes, reviewAgentNote, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { parseBranchAccess } from "@/lib/locations";
import { OnboardingApplicantDocuments } from "./OnboardingApplicantDocuments";
import { getOnboardingDocumentCategoriesByProfileIds } from "@/lib/supabase/onboardingDocuments";

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

const branchesOf = (assignedBranch: string | null, branchAccess: string | null): string[] => {
  const raw = [assignedBranch ?? "", ...parseBranchAccess(branchAccess)];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
};

export function ReportHRDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { role: myRole, ready, uid, displayName, companyId } = useAuth();
  const normalizedMyRole = normalizeRole(myRole);
  const isHrOrAdmin = ready && HR_ADMIN_ROLES.has(normalizedMyRole);
  const isBranchManager = ready && BRANCH_MANAGER_ROLES.has(normalizedMyRole);

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
  const [activeTab, setActiveTab] = useState<"hiring" | "warnings" | "directory" | "jotform" | "onboarding" | "hiringReports" | "report">("hiring");

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
        };
      });
      setEmployees(mapped);
    } catch (err) {
      console.error("ReportHRDaily employees load error:", err);
    } finally {
      setEmployeesLoading(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isHrOrAdmin]);

  const decideNote = async (id: string, status: "approved" | "rejected") => {
    try {
      await reviewAgentNote(id, status);
      await loadNotes();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update candidate status.");
    }
  };

  const handleConfirmStatusDate = async () => {
    if (!statusDateDialog) return;
    try {
      await updateCandidateStatus(statusDateDialog.candidateId, statusDateDialog.status, statusDateDialog.date);
      await loadCandidates();
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
    if (activeTab !== "hiringReports") return;
    if (hiringReportMode === "eod") void loadEodReport(eodDate);
    else void loadEomReport(eomMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hiringReportMode, eodDate, eomMonth]);

  const handleStaffNeededChange = async (position: string, branch: string, value: number) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    setEodRows((prev) => prev.map((r) => (r.position === position && r.branch === branch ? { ...r, staffNeeded: safeValue } : r)));
    try {
      await setStaffingTarget(position, branch, safeValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Staff Needed.");
      void loadEodReport(eodDate);
    }
  };

  const handleDeleteCandidate = async (id: string) => {
    try {
      await deleteCandidate(id);
      await loadCandidates();
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

  return (
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-6">
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
      </div>

      {/* ── KPI overview ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
        {[
          { label: "Candidates", value: kpi.candidates, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
          { label: "Scheduled for Interview", value: kpi.scheduled, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
          { label: "Rejected", value: kpi.rejected, color: "text-red-300", icon: <XCircle className="h-4 w-4" /> },
          { label: "Hired", value: kpi.hired, color: "text-green-300", icon: <UserCheck className="h-4 w-4" /> },
          { label: "Terminated", value: kpi.terminated, color: "text-red-400", icon: <UserX className="h-4 w-4" /> },
          { label: "Resigned", value: kpi.resigned, color: "text-slate-300", icon: <UserMinus className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="panel p-3 text-center">
            <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex gap-1 mb-4 border-b border-white/10">
        {([
          { key: "hiring", label: "Hiring", count: visibleCandidates.length },
          { key: "warnings", label: "Warnings & Mistakes", count: isHrOrAdmin ? pendingNotes.length : 0 },
          { key: "directory", label: "Employee Directory", count: employees.length },
          ...(canViewJotformTab ? [{ key: "jotform", label: "Jotform Submissions", count: unreadJotformCount }] as const : []),
          { key: "onboarding", label: "Onboarding Documents", count: 0 },
          { key: "hiringReports", label: "EOD/EOM Reports", count: 0 },
          { key: "report", label: "Generate Report", count: 0 },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === tab.key ? "bg-primary/20 text-primary" : "bg-white/10 text-muted-foreground"}`}>{tab.count}</span>
            )}
          </button>
        ))}
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
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Manager</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">HR (Final)</th>
                </tr>
              </thead>
              <tbody>
                {filteredApprovedLog.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground text-xs">No approved warnings or mistakes{logSearch || logType || logDept ? " match these filters." : " yet."}</td></tr>
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
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.managerReviewedByName || "—"}<br />
                        {n.managerReviewedAt && <span className="text-[10px]">{new Date(n.managerReviewedAt).toLocaleString()}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.reviewedByName || "Unknown"}<br />
                        <span className="text-[10px]">{n.reviewedAt ? new Date(n.reviewedAt).toLocaleString() : "—"}</span>
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
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Termination</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground text-xs">{employeesLoading ? "Loading employees…" : employees.length === 0 ? "No employees found." : "No employees match these filters."}</td></tr>
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

      {/* ── Jotform Submissions ── */}
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

      {/* ── EOD/EOM Hiring Reports ── */}
      {activeTab === "hiringReports" && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">EOD / EOM Hiring Reports</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Grouped by Position → Branch. Staff Needed is manually entered and moves ±1 automatically when a candidate is hired or a hire is reversed.</p>
          </div>
          <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5">
            <button type="button" onClick={() => setHiringReportMode("eod")} className={`px-4 text-xs font-medium transition-colors ${hiringReportMode === "eod" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>EOD (Daily)</button>
            <button type="button" onClick={() => setHiringReportMode("eom")} className={`px-4 text-xs font-medium transition-colors border-l border-white/15 ${hiringReportMode === "eom" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>EOM (Monthly)</button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex items-end gap-3">
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
          <p className="text-[10px] text-muted-foreground mt-0.5">Same Position → Branch grid as the EOD/EOM Reports tab (Staff Needed, Active Trainee/On Hold, Scheduled Interviews, CVs Sent to BM), exported for a specific day or month.</p>
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
