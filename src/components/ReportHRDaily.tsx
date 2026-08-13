import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronDown, ChevronRight, Plus, Trash2, AlertTriangle, CheckCircle, XCircle, Paperclip, Users, Clock, UserCheck, UserX, UserMinus, Search, Bell, Download, Forward, History, FileText, ClipboardList, Landmark, GripVertical } from "lucide-react";
import { DndContext, useDraggable, type DragEndEvent } from "@dnd-kit/core";
import {
  getLeadersRoster,
  upsertLeadersRosterRow,
  moveLeadersRosterRow,
  deleteLeadersRosterRow,
  type LeadersRosterRow,
} from "@/lib/supabase/leadersRoster";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { normalizeRole, ROLE_LABELS, isJotformHrRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { getCompanyUsers, getProfileEmployeeInfo, getEmployeeInfoByProfileIds, saveProfileEmployeeInfo, updateCompanyUser, getMyProfileId, type EmployeeInfo } from "@/lib/supabase/users";
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
import { parseBranchAccess, LOCATIONS } from "@/lib/locations";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { OnboardingApplicantDocuments } from "./OnboardingApplicantDocuments";
import { getOnboardingDocumentCategoriesByProfileIds } from "@/lib/supabase/onboardingDocuments";
import {
  getOnboardingDocumentColumns,
  addOnboardingDocumentColumn,
  deleteOnboardingDocumentColumn,
  type OnboardingDocumentColumn,
  type OnboardingGroupKey,
} from "@/lib/supabase/onboardingDocumentColumns";
import { uploadCoeCertificate, uploadWarningForm, uploadPromotionForm, uploadActionPlanForm, uploadTerminationForm, uploadW8benForm, uploadW4Form } from "@/lib/firebase/storage";
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
import { buildWarningFormDocxBlob } from "@/lib/warningFormDocx";
import { buildPromotionFormBodyMarkup, promotionFormStyles, type PromotionFormData, type PromotionSignatureSlot } from "@/lib/promotionFormTemplate";
import { buildPromotionFormDocxBlob } from "@/lib/promotionFormDocx";
import { buildActionPlanFormBodyMarkup, actionPlanFormStyles, type ActionPlanFormData, type ActionPlanSignatureSlot } from "@/lib/actionPlanFormTemplate";
import { buildActionPlanFormDocxBlob } from "@/lib/actionPlanFormDocx";
import { buildTerminationFormBodyMarkup, terminationFormStyles, type TerminationFormData, type TerminationSignatureSlot } from "@/lib/terminationFormTemplate";
import { buildTerminationFormDocxBlob } from "@/lib/terminationFormDocx";
import type { W8benFormData, W8benAddress } from "@/lib/w8benFormTemplate";
import { fillW8benPdf } from "@/lib/w8benPdfFill";
import type { W4FormData } from "@/lib/w4FormTemplate";
import { fillW4Pdf } from "@/lib/w4PdfFill";
import type { W9FormData } from "@/lib/w9FormTemplate";
import { fillW9Pdf } from "@/lib/w9PdfFill";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";
import { HrActivityLogPanel } from "@/components/HrActivityLogPage";
import { subscribeTableChanges } from "@/lib/supabase/realtime";
import { getCompanyPtoRequests, ptoYearWindow, ptoDaysUsed, sickYearWindow, sickDaysUsed, reviewPtoStage, canReviewPtoStage, type PtoRequestRow, type PtoType, type PtoStage } from "@/lib/supabase/pto";
import { getCompanyTimecardEntries, calcWorkedHours, hoursDiff, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getCompanyTimecardCorrections, reviewCorrectionStage, canReviewCorrectionStage, type TimecardCorrectionRow, type CorrectionStage } from "@/lib/supabase/timecardCorrections";
import { getCompanyEmployeeRequests, updateEmployeeRequestStatus, type EmployeeRequestRow, type EmployeeRequestStatus } from "@/lib/supabase/employeeRequests";
import { getAppUrl } from "@/lib/appUrl";
import { getCompanyCoeBodyTemplate, setCompanyCoeBodyTemplate, getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { getCompanyCoeDocuments, addCoeDocument, type CoeDocument } from "@/lib/supabase/coeDocuments";
import { getJotformSubmissions, getDeletedJotformSubmissions, updateJotformSubmissionStatus, softDeleteJotformSubmission, restoreJotformSubmission, type JotformSubmission, type JotformSubmissionStatus } from "@/lib/supabase/jotformSubmissions";
import { getCustomFormSubmissions } from "@/lib/supabase/customForms";
import { CustomFormsPanel } from "./CustomFormsPanel";

// Formats a <input type="date"> value ("YYYY-MM-DD") as a long-form date
// ("July 17, 2026") via the multi-arg Date constructor (new Date(y, m-1, d),
// parsed in LOCAL time) — NOT `new Date(str).toLocaleDateString()`. A
// date-only ISO string passed as a single string is parsed as UTC midnight;
// formatting it back out in the browser's local timezone (anything behind
// UTC, i.e. all of the US) rolls it back a day, e.g. printing "since July 5,
// 2026" on a COE for an employee who actually started July 6.
function formatDateOnlyLong(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

// Certificate of Employment's editable body — the prose paragraphs between
// the greeting and the signature block (see companySettings.ts's
// getCompanyCoeBodyTemplate/setCompanyCoeBodyTemplate, migration 0063).
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
const HR_ADMIN_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN", "MANAGER", "SENIOR_MANAGER"]);
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
  phone: string;
  ssn?: string;
  startDate: string;
  terminationDate?: string;
  terminationReason?: string;
  status: EmploymentStatus;
  /** Trainee vs Regular — a separate classification from `status` (Account Status) above. See migration 0152. */
  employmentType: "trainee" | "regular";
  onboardingDocs: Record<string, boolean>;
  // Same off-day/required-shift fields Attendance Monitoring already uses
  // (profiles.off_days/required_check_in/required_check_out) — carried
  // through here so the Attendance KPI tile can derive present/absent/short
  // duty without a second profiles query.
  offDays: number[];
  requiredCheckIn: string;
  requiredCheckOut: string;
  // Editable straight from the Master List tab; also shown on the
  // employee's own My Profile page (EmployeeSelfServicePage.tsx) — see
  // Master List's "Hours of Work" column.
  workingHours: number | null;
  // profiles.extra_roles — used by Master List to also surface someone
  // under "BizOps and IT" when IT is a secondary role, not just their
  // primary one (see resolveMasterListDepartment).
  extraRoles: string[];
  // Which zone requiredCheckIn/requiredCheckOut are actually in — Master
  // List's "Hours of Work" column dropdown, next to the schedule inputs.
  scheduleTimezone: "CST" | "EST";
  // Extra Master List department tabs this person ALSO shows up under,
  // on top of their real/primary one — see "duplicate to another
  // department" next to the Department dropdown.
  extraDepartments: string[];
  // profiles.meal_minutes — same "Working Hours & Meal Time" field the
  // employee sets on their own My Profile page (see workingHours above).
  mealMinutes: number | null;
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

/**
 * Several fine-grained departments (as actually stored — on hr_leaders_
 * roster rows, and free-typed into profiles.department) share the same
 * senior manager in real life, so both the Leaders tab and Master List
 * collapse them into one tab: Parts Manager + Parts Order + Logistics
 * (Naveen Lakhani), BizOps + IT (Jerich Bolico), CSR + Accounting + HR
 * (Lou Basco), and Branch Manager/Senior Branch Manager roles fold into
 * Current Technicians (same as how the Leaders tab already nests them
 * under the Technician hierarchy). This is a DISPLAY-only grouping — it
 * never rewrites the underlying department value on any row/profile, so
 * un-grouping later is just deleting this list, not a data migration.
 * Order here is also the tab display order.
 *
 * ONLY these 6 named groups are allowed to be their own tab — anything
 * that doesn't match one (Admin, Management, Finance, a stray typo, etc.)
 * collapses into "Unlisted" instead of spawning its own one-off tab.
 * Matched with loose regexes (not exact string equality) since real-world
 * profiles.department spelling varies ("BizOps" vs "Biz Ops").
 */
const MASTER_LIST_UNLISTED = "Unlisted";
const CANONICAL_DEPARTMENT_GROUPS: { name: string; match: RegExp }[] = [
  { name: "Executive", match: /^admin$|super\s*admin|management|executive/i },
  { name: "Claims", match: /claim/i },
  { name: "Tech Support", match: /tech(nical)?\s*support/i },
  { name: "Current Technicians", match: /technician|branch\s*manager/i },
  { name: "Parts Manager and Parts", match: /parts|logistics/i },
  { name: "BizOps and IT", match: /biz\s*ops|information\s*technology|\bit\b/i },
  { name: "HR, Accounting and CSR", match: /human\s*resources|\bhr\b|accounting|\bfinance\b|\bcsr\b|customer\s*service/i },
];

/** Master List's Department column dropdown — the 6 real destinations plus Unlisted (to explicitly park someone there), used to move a person between departments straight from the table. */
const MASTER_LIST_DEPARTMENT_OPTIONS = [...CANONICAL_DEPARTMENT_GROUPS.map((g) => g.name), MASTER_LIST_UNLISTED];

function canonicalDepartmentGroup(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  for (const g of CANONICAL_DEPARTMENT_GROUPS) {
    if (g.match.test(trimmed)) return g.name;
  }
  return MASTER_LIST_UNLISTED; // not one of the 6 tracked departments — grouped, not its own tab
}

const LEADERS_TIER_OPTIONS: { value: LeadersRosterRow["tier"]; label: string }[] = [
  { value: "senior", label: "Senior (cyan)" },
  { value: "manager", label: "Manager (rose)" },
  { value: "standard", label: "Standard" },
];

interface LeaderTreeNode {
  row: LeadersRosterRow;
  children: LeaderTreeNode[];
}

/**
 * Builds a reporting tree from a department's flat row list, using
 * reportsTo (migration 0154) to link a row to whichever OTHER row in the
 * same department has that name. Rows with no reportsTo (or one that
 * doesn't resolve to anyone in this department) become roots — which is
 * every row for a department that doesn't use hierarchy at all, so callers
 * can check `roots.length === rows.length` to fall back to a flat list.
 */
function buildLeadersTree(rows: LeadersRosterRow[]): LeaderTreeNode[] {
  const byName = new Map<string, LeaderTreeNode>();
  for (const row of rows) byName.set(row.personName, { row, children: [] });
  const roots: LeaderTreeNode[] = [];
  for (const row of rows) {
    const node = byName.get(row.personName)!;
    const parent = row.reportsTo ? byName.get(row.reportsTo) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * One draggable row in the Leaders tab. Drag-and-drop is hand-rolled on
 * @dnd-kit/core's useDraggable WITHOUT its droppable/collision system —
 * confirmed elsewhere in this app (CustomFormBuilder.tsx) that `over`
 * never populates reliably — so the parent instead compares this row's own
 * measured DOM rect (via `rowRef`) against the dragged item's live
 * translated position to figure out where it was dropped.
 */
/** The only 4 titles Current Technicians is allowed to use — see CURRENT_TECHNICIANS_ORDER, which this must stay in sync with. */
const TECHNICIAN_DEPARTMENT_TITLES = ["Technical Director", "Technical Assistant Director", "Senior Branch Manager", "Branch Manager"];

function LeaderRow({
  row,
  canEdit,
  isDragging,
  rowRef,
  deptPeople,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  row: LeadersRosterRow;
  canEdit: boolean;
  isDragging: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  /** Every other person's name in this same department — populates "Reports To". */
  deptPeople: string[];
  onUpdate: (patch: Partial<Pick<LeadersRosterRow, "roleTitle" | "personName" | "tier" | "reportsTo">>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: row.id });
  const dotClass = row.tier === "senior" ? "bg-cyan-400" : row.tier === "manager" ? "bg-rose-400" : "bg-slate-500";
  const badgeClass =
    row.tier === "senior"
      ? "bg-cyan-500/15 text-cyan-200 border-cyan-400/30"
      : row.tier === "manager"
      ? "bg-rose-500/15 text-rose-200 border-rose-400/30"
      : "bg-white/5 text-slate-400 border-white/10";

  return (
    <div
      ref={rowRef}
      style={{ transform: isDragging ? `translate(${transform?.x ?? 0}px, ${transform?.y ?? 0}px)` : undefined, zIndex: isDragging ? 10 : undefined }}
      className={`group flex items-center gap-2 px-2.5 py-2 text-xs transition-colors hover:bg-white/[0.04] ${isDragging ? "opacity-60 bg-white/5" : ""}`}
    >
      {canEdit ? (
        <button
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          type="button"
          className="shrink-0 flex items-center text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-300 cursor-grab active:cursor-grabbing transition-opacity"
          title="Drag to reorder or move to another department"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${dotClass}`} />
      )}

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {canEdit ? (
          <div className="flex items-center gap-1.5">
            <select
              value={row.tier}
              onChange={(e) => onUpdate({ tier: e.target.value as LeadersRosterRow["tier"] })}
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide focus:outline-none ${badgeClass}`}
            >
              {LEADERS_TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {row.department === "Technician" ? (
              <select
                value={row.roleTitle}
                onChange={(e) => onUpdate({ roleTitle: e.target.value })}
                className="flex-1 min-w-0 rounded px-1.5 py-0.5 bg-transparent border-0 focus:outline-none focus:bg-white/5 font-semibold text-slate-200"
              >
                {!TECHNICIAN_DEPARTMENT_TITLES.includes(row.roleTitle) && <option value={row.roleTitle}>{row.roleTitle}</option>}
                {TECHNICIAN_DEPARTMENT_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <input
                key={`role:${row.id}:${row.roleTitle}`}
                defaultValue={row.roleTitle}
                onBlur={(e) => e.target.value.trim() && e.target.value !== row.roleTitle && onUpdate({ roleTitle: e.target.value.trim() })}
                className="flex-1 min-w-0 rounded px-1.5 py-0.5 bg-transparent border-0 focus:outline-none focus:bg-white/5 font-semibold text-slate-200"
              />
            )}
          </div>
        ) : (
          <span className={`self-start rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${badgeClass}`}>
            {row.roleTitle}
          </span>
        )}
        {canEdit ? (
          <input
            key={`name:${row.id}:${row.personName}`}
            defaultValue={row.personName}
            onBlur={(e) => e.target.value.trim() && e.target.value !== row.personName && onUpdate({ personName: e.target.value.trim() })}
            className="min-w-0 rounded px-1.5 py-0.5 bg-transparent border-0 focus:outline-none focus:bg-white/5 text-slate-100"
          />
        ) : (
          <span className="px-1.5 text-slate-100">{row.personName}</span>
        )}
        {canEdit && deptPeople.length > 0 && (
          <select
            value={row.reportsTo ?? ""}
            onChange={(e) => onUpdate({ reportsTo: e.target.value || null })}
            className="min-w-0 rounded px-1.5 py-0.5 bg-transparent border-0 focus:outline-none focus:bg-white/5 text-[10px] text-slate-500"
            title="Who this person reports to within this department (optional — builds a nested hierarchy like Technician's)"
          >
            <option value="">Reports to: — none (top level) —</option>
            {deptPeople.map((name) => <option key={name} value={name}>Reports to: {name}</option>)}
          </select>
        )}
        {!canEdit && row.reportsTo && (
          <span className="px-1.5 text-[10px] text-slate-500">reports to {row.reportsTo}</span>
        )}
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={onDuplicate}
          className="shrink-0 flex items-center text-slate-600 opacity-0 group-hover:opacity-100 hover:text-emerald-300 transition-opacity"
          title="Duplicate this row — same title/tier/reports-to, just type the new person's name"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 flex items-center text-slate-600 opacity-0 group-hover:opacity-100 hover:text-red-300 transition-opacity"
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Recursively renders a reporting-tree branch (see buildLeadersTree) — each level of depth indents further and gets a faint connecting rail, so e.g. a Senior Branch Manager's own Branch Managers read as nested under them rather than another flat row. */
function LeaderTreeBranch({
  node,
  depth,
  canEdit,
  leadersDraggingId,
  deptPeople,
  setLeadersRowRef,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  node: LeaderTreeNode;
  depth: number;
  canEdit: boolean;
  leadersDraggingId: string | null;
  deptPeople: string[];
  setLeadersRowRef: (id: string) => (el: HTMLDivElement | null) => void;
  onUpdate: (id: string, patch: Partial<Pick<LeadersRosterRow, "roleTitle" | "personName" | "tier" | "reportsTo">>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  return (
    <>
      <div className={depth > 0 ? "border-l border-white/10 ml-3" : ""} style={{ paddingLeft: depth > 0 ? 8 : 0 }}>
        <LeaderRow
          row={node.row}
          canEdit={canEdit}
          isDragging={leadersDraggingId === node.row.id}
          rowRef={setLeadersRowRef(node.row.id)}
          deptPeople={deptPeople.filter((n) => n !== node.row.personName)}
          onUpdate={(patch) => onUpdate(node.row.id, patch)}
          onDelete={() => onDelete(node.row.id)}
          onDuplicate={() => onDuplicate(node.row.id)}
        />
      </div>
      {node.children.map((child) => (
        <LeaderTreeBranch
          key={child.row.id}
          node={child}
          depth={depth + 1}
          canEdit={canEdit}
          deptPeople={deptPeople}
          leadersDraggingId={leadersDraggingId}
          setLeadersRowRef={setLeadersRowRef}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      ))}
    </>
  );
}

export function ReportHRDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { role: myRole, extraRoles: myExtraRoles, ready, uid, displayName, companyId } = useAuth();
  const normalizedMyRole = normalizeRole(myRole);
  const normalizedMyExtraRoles = myExtraRoles.map(normalizeRole);
  const heldRoles = [normalizedMyRole, ...normalizedMyExtraRoles];
  const isHrOrAdmin = ready && heldRoles.some((r) => HR_ADMIN_ROLES.has(r));
  const isBranchManager = ready && heldRoles.some((r) => BRANCH_MANAGER_ROLES.has(r));
  const isAdmin = heldRoles.some((r) => ["ADMIN", "SUPERADMIN"].includes(r));

  // isJotformHrRole (not the broader isHrOrAdmin) so this stays in exact
  // sync with findHrFirebaseUids() in jotformBridge.ts — otherwise this tab
  // is visible to roles the webhook never actually notifies, and it just
  // sits empty forever for them regardless of how many submissions come in.
  const canViewJotformTab = isJotformHrRole(normalizedMyRole, normalizedMyExtraRoles);

  const today = new Date().toISOString().slice(0, 10);

  const [error, setError] = useState<string | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
  // One section visible at a time — the page used to stack Hiring, Pending
  // Reviews, the Approved log, the department trend chart, and the full
  // Employee Directory all on top of each other, forcing a long scroll to
  // reach anything below Hiring.
  const [activeTab, setActiveTab] = useState<"hiring" | "warnings" | "masterList" | "leaders" | "jotform" | "jotformDocuments" | "customForms" | "onboarding" | "hiringReports" | "report" | "coe" | "warningForm" | "promotionForm" | "actionPlanForm" | "terminationForm" | "employeeRequestManager" | "w8ben">("hiring");
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
  const VALID_HR_TABS = ["hiring", "warnings", "masterList", "leaders", "jotform", "jotformDocuments", "customForms", "onboarding", "hiringReports", "report", "coe", "warningForm", "promotionForm", "actionPlanForm", "terminationForm", "employeeRequestManager", "w8ben"] as const;
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

  // Fetched here (not left to CustomFormsPanel's own internal state) purely
  // so the "Custom Forms" tab can show a "N new" badge before the tab's
  // ever been opened this session — same reasoning/pattern as
  // jotformSubmissions above. CustomFormsPanel still does its own separate
  // fetch when actually opened; a little duplicated work, same trade-off
  // already accepted for the Jotform tab.
  const [newCustomFormSubmissionsCount, setNewCustomFormSubmissionsCount] = useState(0);
  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const subs = await getCustomFormSubmissions();
        setNewCustomFormSubmissionsCount(subs.filter((s) => s.status === "new").length);
      } catch (err) {
        console.error("Failed to load custom form submissions count:", err);
      }
    })();
  }, [ready]);

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
          phone: p.phone_number || "",
          ssn: info.employeeSsn || undefined,
          startDate: info.hireDate || p.created_at?.slice(0, 10) || "",
          terminationDate: info.employmentStatusDate || info.terminateDate || undefined,
          terminationReason: info.employeeNote || undefined,
          status: employmentStatus,
          employmentType: p.employment_type || "regular",
          onboardingDocs: info.onboardingDocs || {},
          offDays: p.off_days ?? [],
          requiredCheckIn: p.required_check_in || "",
          requiredCheckOut: p.required_check_out || "",
          workingHours: p.working_hours ?? null,
          extraRoles: p.extra_roles ?? [],
          scheduleTimezone: p.schedule_timezone ?? "CST",
          extraDepartments: p.master_list_extra_departments ?? [],
          mealMinutes: p.meal_minutes ?? null,
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
      await reviewPtoStage(request, stage, decision, myProfileId || "", displayName || "HR");
      await loadPtoRequests();
    } catch (err) {
      alert(`Failed to update PTO request: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleCorrectionStageAction = async (correction: TimecardCorrectionRow, stage: CorrectionStage, decision: "approved" | "rejected") => {
    try {
      if (decision === "approved") {
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
      }
      await reviewCorrectionStage(correction, stage, decision, myProfileId || "", displayName || "HR");
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
  const COE_OFFICE_USE_ROLES = new Set(["ADMIN", "SUPERADMIN", "HR", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"]);
  // Office Use box signer is any manager (Branch, CSR, Parts, BizOps, etc.
  // — anything with "MANAGER" in the role code) as well as Admin/HR/BizOps,
  // since a branch-level manager like the reference's "CSR Manager" isn't
  // covered by COE_OFFICE_USE_ROLES's fixed BizOps-only list above.
  const isCoeOfficeUseEligible = (role: string) => role.includes("MANAGER") || role === "ADMIN" || role === "SUPERADMIN" || role === "HR" || role.includes("BIZOPS");
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
      startDate: blank(f.employeeStartDate ? formatDateOnlyLong(f.employeeStartDate) : ""),
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
      // point, so a failure here (e.g. migration 0064 not run yet) must
      // never surface as "failed to send" or block closing the dialog.
      addCoeDocument({ employeeName: employeeLabel, documentUrl: url, recipientId: coeRecipientId })
        .then(() => void loadCoeDocuments())
        .catch((err) => console.error("Failed to record COE sent-history row:", err));

      // Opt-in broadcast — see Notifications Settings (migration 0090).
      // COE has no separate "submission" step, so the send itself is the event.
      getHrNotificationSettings()
        .then(({ coe }) => {
          if (!coe) return;
          void notifyHrRoleUsers(myProfileId, displayName || "HR", [coeRecipientId], `📄 Certificate of Employment sent — ${employeeLabel} (to ${recipientName ?? "recipient"}).`);
        })
        .catch((err) => console.error("[coe] hr notify check failed:", err));

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
    setAddPrevWarnOpen(false);
    setAddPrevWarnError(null);
  };

  // Frozen snapshot for the currently-selected employee — approved warnings only (the official record), most recent first, capped at the 3 slots the paper form has.
  // Sorts/displays by occurredAt when set (backfilled pre-system warnings — see handleAddPreviousWarning below) so a
  // historical warning entered today doesn't look like the most recent one and bump a genuinely recent warning out of the top 3.
  const warnPreviousWarnings = useMemo(() => {
    if (!warnForm.employeeId) return [];
    return allNotes
      .filter((n) => n.type === "warning" && n.agentProfileId === warnForm.employeeId && n.status === "approved")
      .sort((a, b) => (b.occurredAt || b.createdAt).localeCompare(a.occurredAt || a.createdAt))
      .slice(0, 3)
      .map((n) => ({ cause: n.note, date: n.occurredAt || n.createdAt, issuedBy: n.createdByName || "—" }));
  }, [allNotes, warnForm.employeeId]);

  // ── Backfill a pre-system warning (issued before this app's warning workflow existed) ──
  const [addPrevWarnOpen, setAddPrevWarnOpen] = useState(false);
  const [addPrevWarnDate, setAddPrevWarnDate] = useState(todayStr);
  const [addPrevWarnReason, setAddPrevWarnReason] = useState("");
  const [addPrevWarnSaving, setAddPrevWarnSaving] = useState(false);
  const [addPrevWarnError, setAddPrevWarnError] = useState<string | null>(null);
  const handleAddPreviousWarning = async () => {
    if (!warnForm.employeeId || !addPrevWarnDate || !addPrevWarnReason.trim()) {
      setAddPrevWarnError("Date and reason are required.");
      return;
    }
    setAddPrevWarnSaving(true);
    setAddPrevWarnError(null);
    try {
      await addAgentNote({
        agentProfileId: warnForm.employeeId,
        type: "warning",
        note: addPrevWarnReason.trim(),
        occurredAt: new Date(addPrevWarnDate + "T00:00:00").toISOString(),
        fastTrackToApproved: true,
      });
      setAllNotes(await getAllAgentNotes());
      setAddPrevWarnOpen(false);
      setAddPrevWarnDate(todayStr);
      setAddPrevWarnReason("");
    } catch (error) {
      setAddPrevWarnError(error instanceof Error ? error.message : "Failed to add warning.");
    } finally {
      setAddPrevWarnSaving(false);
    }
  };

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
    recipientNames: recipientName ? { [recipientSlot]: recipientName } : undefined,
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
  // "teammate" = today's flow: pick a real AHS profile, requires them to log
  // in to sign, auto-DMs them. "external" = a freely-typed name with no AHS
  // account at all — generates a link (no DM, since there's no profile to
  // DM) that opens src/components/ExternalSignDocumentPage.tsx.
  const [warnSendMode, setWarnSendMode] = useState<"teammate" | "external">("teammate");
  const [warnExternalName, setWarnExternalName] = useState("");
  // Set right after a successful send — the modal switches to a "here's the
  // link" confirmation instead of closing immediately, since the automatic
  // DM alone isn't always enough (e.g. the recipient hasn't checked AHS
  // messages yet, or HR wants to send it through email/Slack/text too).
  const [warnSentLink, setWarnSentLink] = useState<{ link: string; recipientName: string } | null>(null);
  const [warnSentLinkCopied, setWarnSentLinkCopied] = useState(false);
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
      setWarnSendMode("teammate");
      setWarnExternalName("");
      setWarnSendError(null);
      setWarnSentLink(null);
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

  const [warnDocxGenerating, setWarnDocxGenerating] = useState(false);
  const handleDownloadWarningFormWord = async () => {
    setWarnDocxGenerating(true);
    try {
      const previewData = buildWarnFormData(warnRecipientSlot, "");
      const blob = await buildWarningFormDocxBlob(previewData, warnLogoDataUrl);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Employee Warning Form - ${previewData.employeeName || "Untitled"}.docx`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setWarnDocxGenerating(false);
    }
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

  /** The signing link is already delivered automatically via an in-app DM when the form is sent (teammate mode) — this just lets HR grab that same link again to share through any other channel (email, Slack, text), same as the Copy Link action the tax forms already have. External-recipient documents have no DM at all, so this is their only way to get the link back if it was lost. */
  const handleCopyWarningFormLink = async (doc: SignableDocument) => {
    try {
      const path = doc.recipientId ? "sign-document" : "sign-external";
      await navigator.clipboard.writeText(`${getAppUrl()}/${path}/${doc.id}`);
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
    if (!warnForm.employeeName.trim() || !warnRecipientId || !uid) return;
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

      setWarnSentLink({ link: signLink, recipientName: recipient.name });
      await loadSentWarningForms();
    } catch (err) {
      setWarnSendError(err instanceof Error ? err.message : "Failed to send warning form.");
    } finally {
      setWarnSending(false);
    }
  };

  /** No AHS profile to tie this to, so no DM — the link itself (shown in the same post-send confirmation view) is the only way the recipient finds out, which is why it always lands there instead of just closing. */
  const handleGenerateExternalWarningLink = async () => {
    if (!warnForm.employeeName.trim() || !warnExternalName.trim()) return;
    setWarnSending(true);
    setWarnSendError(null);
    try {
      const formData = buildWarnFormData(warnRecipientSlot, warnExternalName.trim());
      const pdfBlob = await captureHtmlToPdfBlob(buildWarningFormBodyMarkup(formData, warnLogoDataUrl, {}), warningFormStyles);
      const pdfUrl = await uploadWarningForm(companyId ?? "", warnForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "warning_form",
        formData: formData as unknown as Record<string, any>,
        recipientName: warnExternalName.trim(),
        recipientSlot: warnRecipientSlot,
        pdfUrl,
      });

      void logActivity({ action: "warning_form_sent", targetType: "employee", targetId: warnForm.employeeId, targetLabel: warnForm.employeeName, details: { to: warnExternalName.trim(), slot: warnRecipientSlot, external: true } });

      setWarnSentLink({ link: `${getAppUrl()}/sign-external/${doc.id}`, recipientName: warnExternalName.trim() });
      await loadSentWarningForms();
    } catch (err) {
      setWarnSendError(err instanceof Error ? err.message : "Failed to generate link.");
    } finally {
      setWarnSending(false);
    }
  };

  const handleCopyWarnSentLink = async () => {
    if (!warnSentLink) return;
    try {
      await navigator.clipboard.writeText(warnSentLink.link);
      setWarnSentLinkCopied(true);
      setTimeout(() => setWarnSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleCloseWarnPreview = () => {
    setWarnPreviewOpen(false);
    setWarnSentLink(null);
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
  };

  // ── Sent Warning Forms tracking table actions ──
  const [warnActionBusyId, setWarnActionBusyId] = useState<string | null>(null);
  const [warnActionError, setWarnActionError] = useState<string | null>(null);

  const handleConfirmWarningForm = async (doc: SignableDocument) => {
    const data = doc.formData as unknown as WarningFormData;
    // A warning typed in manually (no matching AHS employee picked) has no
    // real profile to attach a conduct note to — the document can still be
    // finalized, it just won't count toward anyone's official warning
    // history, so the confirmation makes that trade-off explicit.
    const confirmMessage = data.employeeId
      ? "Confirm this warning? This finalizes it and adds it to the employee's official warning record."
      : `Confirm this warning? "${data.employeeName}" isn't a matched AHS employee, so this will finalize the document but won't count toward any employee's official warning record.`;
    if (!window.confirm(confirmMessage)) return;
    setWarnActionBusyId(doc.id);
    setWarnActionError(null);
    try {
      let noteId: string | null = null;
      if (data.employeeId) {
        const noteText = buildWarnNoteText(data);
        noteId = await addAgentNote({ agentProfileId: data.employeeId, type: "warning", note: noteText, fastTrackToApproved: true });
      }
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
  const [reassignMode, setReassignMode] = useState<"teammate" | "external">("teammate");
  const [reassignExternalName, setReassignExternalName] = useState("");
  // Set right after a successful external reassign — shown inline in this
  // same dialog (unlike the initial send's warnSentLink view, this dialog
  // can be opened from the tracker table with the main preview modal
  // closed, so there's no other modal already open to show it in).
  const [reassignSentLink, setReassignSentLink] = useState<string | null>(null);
  const [reassignSentLinkCopied, setReassignSentLinkCopied] = useState(false);
  const filteredReassignRecipients = useMemo(() => {
    const q = reassignRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, reassignRecipientSearch]);

  const handleSendToNextRecipient = async () => {
    if (!reassignDialog || !uid) return;
    const employeeName = (reassignDialog.formData as unknown as WarningFormData).employeeName || "the employee";

    if (reassignMode === "external") {
      if (!reassignExternalName.trim()) return;
      setWarnActionBusyId(reassignDialog.id);
      setWarnActionError(null);
      try {
        await reassignSignableDocument(reassignDialog.id, { recipientName: reassignExternalName.trim() }, reassignSlot);
        void logActivity({ action: "warning_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: reassignExternalName.trim(), slot: reassignSlot, external: true } });
        setReassignSentLink(`${getAppUrl()}/sign-external/${reassignDialog.id}`);
        await loadSentWarningForms();
      } catch (err) {
        setWarnActionError(err instanceof Error ? err.message : "Failed to reassign.");
      } finally {
        setWarnActionBusyId(null);
      }
      return;
    }

    if (!reassignRecipientId) return;
    setWarnActionBusyId(reassignDialog.id);
    setWarnActionError(null);
    try {
      const recipient = employees.find((e) => e.id === reassignRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");
      await reassignSignableDocument(reassignDialog.id, { recipientId: reassignRecipientId, recipientName: recipient.name }, reassignSlot);

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, reassignRecipientId);
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

  const handleCopyReassignSentLink = async () => {
    if (!reassignSentLink) return;
    try {
      await navigator.clipboard.writeText(reassignSentLink);
      setReassignSentLinkCopied(true);
      setTimeout(() => setReassignSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleCloseReassignDialog = () => {
    setReassignDialog(null);
    setReassignRecipientId("");
    setReassignRecipientSearch("");
    setReassignMode("teammate");
    setReassignExternalName("");
    setReassignSentLink(null);
  };

  // ── Generate Employee Promotion / Role Change Form ──────────────────
  // Same shape as the Employee Warning Form above — field layout mirrors
  // src/assets/Employee Promotion or Role Change.pdf exactly. Document-only:
  // confirming does NOT write back to the employee's profile (Position/
  // Department/Tier stay whatever HR separately sets in Master List) — a
  // signed paper trail, not a data-mutating action.
  const [promoForm, setPromoForm] = useState({
    employeeId: "",
    employeeName: "",
    currentPosition: "",
    department: "",
    dateOfHire: "",
    roleChangeType: {
      promotion: false,
      positionTitleChange: false,
      departmentTransfer: false,
      technicianTierRaise: false,
      other: false,
      otherText: "",
    },
    newPositionTitle: "",
    newDepartment: "",
    effectiveDate: todayStr,
    performance: {
      meetsExpectations: false,
      exceedsExpectations: false,
      leadershipDemonstrated: false,
      trainingCompleted: false,
      other: false,
      otherText: "",
    },
  });
  const updatePromoField = <K extends keyof typeof promoForm>(field: K, value: (typeof promoForm)[K]) =>
    setPromoForm((prev) => ({ ...prev, [field]: value }));
  const toggleRoleChangeType = (key: keyof typeof promoForm.roleChangeType) =>
    setPromoForm((prev) => ({ ...prev, roleChangeType: { ...prev.roleChangeType, [key]: !prev.roleChangeType[key] } }));
  const togglePerformance = (key: keyof typeof promoForm.performance) =>
    setPromoForm((prev) => ({ ...prev, performance: { ...prev.performance, [key]: !prev.performance[key] } }));

  const [promoEmployeeDropdownOpen, setPromoEmployeeDropdownOpen] = useState(false);
  const filteredPromoEmployeeOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q)) : sorted;
  };
  const selectPromoEmployee = (employee: { id: string; name: string; position: string; branch: string; startDate: string }) => {
    setPromoForm((prev) => ({
      ...prev,
      employeeId: employee.id,
      employeeName: employee.name,
      currentPosition: ROLE_LABELS[normalizeRole(employee.position)] ?? employee.position,
      department: employee.branch,
      dateOfHire: employee.startDate || "",
    }));
    setPromoEmployeeDropdownOpen(false);
  };

  const buildPromoFormData = (recipientSlot: PromotionSignatureSlot, recipientName: string): PromotionFormData => ({
    employeeId: promoForm.employeeId,
    employeeName: promoForm.employeeName,
    currentPosition: promoForm.currentPosition,
    department: promoForm.department,
    dateOfHire: promoForm.dateOfHire,
    roleChangeType: promoForm.roleChangeType,
    newPositionTitle: promoForm.newPositionTitle,
    newDepartment: promoForm.newDepartment,
    effectiveDate: promoForm.effectiveDate,
    performance: promoForm.performance,
    recipientSlot,
    recipientName,
    recipientNames: recipientName ? { [recipientSlot]: recipientName } : undefined,
  });

  const [promoLogoDataUrl, setPromoLogoDataUrl] = useState("");
  const [promoPreviewOpen, setPromoPreviewOpen] = useState(false);
  const [promoGenerating, setPromoGenerating] = useState(false);
  const [promoRecipientId, setPromoRecipientId] = useState("");
  const [promoRecipientSearch, setPromoRecipientSearch] = useState("");
  const [promoRecipientDropdownOpen, setPromoRecipientDropdownOpen] = useState(false);
  const [promoRecipientSlot, setPromoRecipientSlot] = useState<PromotionSignatureSlot>("manager");
  const [promoSending, setPromoSending] = useState(false);
  const [promoSendError, setPromoSendError] = useState<string | null>(null);
  const [promoSendMode, setPromoSendMode] = useState<"teammate" | "external">("teammate");
  const [promoExternalName, setPromoExternalName] = useState("");
  const [promoSentLink, setPromoSentLink] = useState<{ link: string; recipientName: string } | null>(null);
  const [promoSentLinkCopied, setPromoSentLinkCopied] = useState(false);
  const filteredPromoRecipients = useMemo(() => {
    const q = promoRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, promoRecipientSearch]);

  const handleOpenPromoPreview = async () => {
    setPromoGenerating(true);
    try {
      setPromoLogoDataUrl(await loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")));
      setPromoRecipientId("");
      setPromoRecipientSearch("");
      setPromoSendMode("teammate");
      setPromoExternalName("");
      setPromoSendError(null);
      setPromoSentLink(null);
      setPromoPreviewOpen(true);
    } finally {
      setPromoGenerating(false);
    }
  };

  const handleDownloadPromoForm = () => {
    const previewData = buildPromoFormData(promoRecipientSlot, "");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Employee Promotion / Role Change Form</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#fff;}${promotionFormStyles}@media print{@page{margin:0;}}</style></head><body>${buildPromotionFormBodyMarkup(previewData, promoLogoDataUrl, {})}</body></html>`;
    openPrintWindow(html);
  };

  const [promoDocxGenerating, setPromoDocxGenerating] = useState(false);
  const handleDownloadPromoFormWord = async () => {
    setPromoDocxGenerating(true);
    try {
      const previewData = buildPromoFormData(promoRecipientSlot, "");
      const blob = await buildPromotionFormDocxBlob(previewData, promoLogoDataUrl);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Employee Promotion Form - ${previewData.employeeName || "Untitled"}.docx`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setPromoDocxGenerating(false);
    }
  };

  const [sentPromotionForms, setSentPromotionForms] = useState<SignableDocument[]>([]);
  const loadSentPromotionForms = async () => {
    try {
      setSentPromotionForms(await getSignableDocuments("promotion_form"));
    } catch (err) {
      console.error("Failed to load sent promotion forms:", err);
    }
  };
  useEffect(() => {
    if (activeTab === "promotionForm") void loadSentPromotionForms();
  }, [activeTab]);

  const [promoViewDoc, setPromoViewDoc] = useState<SignableDocument | null>(null);
  const handleViewPromoForm = async (doc: SignableDocument) => {
    if (!promoLogoDataUrl) {
      setPromoLogoDataUrl(await loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")));
    }
    setPromoViewDoc(doc);
  };

  const handleDownloadPromoFormPdf = async (doc: SignableDocument) => {
    if (!doc.pdfUrl) return;
    const employeeName = (doc.formData as unknown as PromotionFormData).employeeName || "promotion-form";
    try {
      const res = await fetch(doc.pdfUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Employee Promotion Form - ${employeeName}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(doc.pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopyPromotionFormLink = async (doc: SignableDocument) => {
    try {
      const path = doc.recipientId ? "sign-promotion-form" : "sign-promotion-external";
      await navigator.clipboard.writeText(`${getAppUrl()}/${path}/${doc.id}`);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleSendPromotionForm = async () => {
    if (!promoForm.employeeName.trim() || !promoRecipientId || !uid) return;
    setPromoSending(true);
    setPromoSendError(null);
    try {
      const recipient = employees.find((e) => e.id === promoRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");

      const formData = buildPromoFormData(promoRecipientSlot, recipient.name);
      const pdfBlob = await captureHtmlToPdfBlob(buildPromotionFormBodyMarkup(formData, promoLogoDataUrl, {}), promotionFormStyles);
      const pdfUrl = await uploadPromotionForm(companyId ?? "", promoForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "promotion_form",
        formData: formData as unknown as Record<string, any>,
        recipientId: promoRecipientId,
        recipientSlot: promoRecipientSlot,
        pdfUrl,
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, promoRecipientId);
      const signLink = `${getAppUrl()}/sign-promotion-form/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `🎉 Employee Promotion / Role Change Form for ${promoForm.employeeName} needs your signature. Review and sign here: ${signLink}`,
      });

      void logActivity({ action: "promotion_form_sent", targetType: "employee", targetId: promoForm.employeeId, targetLabel: promoForm.employeeName, details: { to: recipient.name, slot: promoRecipientSlot } });

      setPromoSentLink({ link: signLink, recipientName: recipient.name });
      await loadSentPromotionForms();
    } catch (err) {
      setPromoSendError(err instanceof Error ? err.message : "Failed to send promotion form.");
    } finally {
      setPromoSending(false);
    }
  };

  /** No AHS profile to tie this to, so no DM — the link itself (shown in the same post-send confirmation view) is the only way the recipient finds out. */
  const handleGenerateExternalPromotionLink = async () => {
    if (!promoForm.employeeName.trim() || !promoExternalName.trim()) return;
    setPromoSending(true);
    setPromoSendError(null);
    try {
      const formData = buildPromoFormData(promoRecipientSlot, promoExternalName.trim());
      const pdfBlob = await captureHtmlToPdfBlob(buildPromotionFormBodyMarkup(formData, promoLogoDataUrl, {}), promotionFormStyles);
      const pdfUrl = await uploadPromotionForm(companyId ?? "", promoForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "promotion_form",
        formData: formData as unknown as Record<string, any>,
        recipientName: promoExternalName.trim(),
        recipientSlot: promoRecipientSlot,
        pdfUrl,
      });

      void logActivity({ action: "promotion_form_sent", targetType: "employee", targetId: promoForm.employeeId, targetLabel: promoForm.employeeName, details: { to: promoExternalName.trim(), slot: promoRecipientSlot, external: true } });

      setPromoSentLink({ link: `${getAppUrl()}/sign-promotion-external/${doc.id}`, recipientName: promoExternalName.trim() });
      await loadSentPromotionForms();
    } catch (err) {
      setPromoSendError(err instanceof Error ? err.message : "Failed to generate link.");
    } finally {
      setPromoSending(false);
    }
  };

  const handleCopyPromoSentLink = async () => {
    if (!promoSentLink) return;
    try {
      await navigator.clipboard.writeText(promoSentLink.link);
      setPromoSentLinkCopied(true);
      setTimeout(() => setPromoSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleClosePromoPreview = () => {
    setPromoPreviewOpen(false);
    setPromoSentLink(null);
    setPromoForm({
      employeeId: "",
      employeeName: "",
      currentPosition: "",
      department: "",
      dateOfHire: "",
      roleChangeType: { promotion: false, positionTitleChange: false, departmentTransfer: false, technicianTierRaise: false, other: false, otherText: "" },
      newPositionTitle: "",
      newDepartment: "",
      effectiveDate: todayStr,
      performance: { meetsExpectations: false, exceedsExpectations: false, leadershipDemonstrated: false, trainingCompleted: false, other: false, otherText: "" },
    });
  };

  // ── Sent Promotion Forms tracking table actions ──
  const [promoActionBusyId, setPromoActionBusyId] = useState<string | null>(null);
  const [promoActionError, setPromoActionError] = useState<string | null>(null);

  /** Document-only (per design — see this section's header comment): confirming just finalizes the record, it never writes back to the employee's profile. agentNoteId is always null here — this form has nothing to do with the warnings system. */
  const handleConfirmPromotionForm = async (doc: SignableDocument) => {
    if (!window.confirm("Confirm this promotion / role change form? This finalizes it as the official signed record.")) return;
    setPromoActionBusyId(doc.id);
    setPromoActionError(null);
    try {
      await confirmSignableDocument(doc.id, null);
      await loadSentPromotionForms();
      const data = doc.formData as unknown as PromotionFormData;
      void logActivity({ action: "promotion_form_confirmed", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setPromoActionError(err instanceof Error ? err.message : "Failed to confirm promotion form.");
    } finally {
      setPromoActionBusyId(null);
    }
  };

  const handleCancelPromotionForm = async (doc: SignableDocument) => {
    const isRevert = doc.status === "confirmed";
    const message = isRevert
      ? "Revert this confirmed promotion form? It goes back to voided — it was never applied to the employee's profile in the first place, so there's nothing else to undo."
      : "Cancel this promotion form? This voids it entirely.";
    if (!window.confirm(message)) return;
    setPromoActionBusyId(doc.id);
    setPromoActionError(null);
    try {
      await cancelSignableDocument(doc.id);
      await loadSentPromotionForms();
      const data = doc.formData as unknown as PromotionFormData;
      void logActivity({ action: isRevert ? "promotion_form_reverted" : "promotion_form_cancelled", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setPromoActionError(err instanceof Error ? err.message : `Failed to ${isRevert ? "revert" : "cancel"} promotion form.`);
    } finally {
      setPromoActionBusyId(null);
    }
  };

  const handleDeletePromotionForm = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this promotion form? This can't be undone.")) return;
    setPromoActionBusyId(doc.id);
    setPromoActionError(null);
    try {
      await deleteSignableDocument(doc.id);
      setSentPromotionForms((prev) => prev.filter((d) => d.id !== doc.id));
      const data = doc.formData as unknown as PromotionFormData;
      void logActivity({ action: "promotion_form_deleted", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setPromoActionError(err instanceof Error ? err.message : "Failed to delete promotion form.");
    } finally {
      setPromoActionBusyId(null);
    }
  };

  const [promoReassignDialog, setPromoReassignDialog] = useState<SignableDocument | null>(null);
  const [promoReassignRecipientId, setPromoReassignRecipientId] = useState("");
  const [promoReassignRecipientSearch, setPromoReassignRecipientSearch] = useState("");
  const [promoReassignRecipientDropdownOpen, setPromoReassignRecipientDropdownOpen] = useState(false);
  const [promoReassignSlot, setPromoReassignSlot] = useState<PromotionSignatureSlot>("senior_manager");
  const [promoReassignMode, setPromoReassignMode] = useState<"teammate" | "external">("teammate");
  const [promoReassignExternalName, setPromoReassignExternalName] = useState("");
  const [promoReassignSentLink, setPromoReassignSentLink] = useState<string | null>(null);
  const [promoReassignSentLinkCopied, setPromoReassignSentLinkCopied] = useState(false);
  const filteredPromoReassignRecipients = useMemo(() => {
    const q = promoReassignRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, promoReassignRecipientSearch]);

  const handleSendPromoToNextRecipient = async () => {
    if (!promoReassignDialog || !uid) return;
    const employeeName = (promoReassignDialog.formData as unknown as PromotionFormData).employeeName || "the employee";

    if (promoReassignMode === "external") {
      if (!promoReassignExternalName.trim()) return;
      setPromoActionBusyId(promoReassignDialog.id);
      setPromoActionError(null);
      try {
        await reassignSignableDocument(promoReassignDialog.id, { recipientName: promoReassignExternalName.trim() }, promoReassignSlot);
        void logActivity({ action: "promotion_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: promoReassignExternalName.trim(), slot: promoReassignSlot, external: true } });
        setPromoReassignSentLink(`${getAppUrl()}/sign-promotion-external/${promoReassignDialog.id}`);
        await loadSentPromotionForms();
      } catch (err) {
        setPromoActionError(err instanceof Error ? err.message : "Failed to reassign.");
      } finally {
        setPromoActionBusyId(null);
      }
      return;
    }

    if (!promoReassignRecipientId) return;
    setPromoActionBusyId(promoReassignDialog.id);
    setPromoActionError(null);
    try {
      const recipient = employees.find((e) => e.id === promoReassignRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");
      await reassignSignableDocument(promoReassignDialog.id, { recipientId: promoReassignRecipientId, recipientName: recipient.name }, promoReassignSlot);

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, promoReassignRecipientId);
      const signLink = `${getAppUrl()}/sign-promotion-form/${promoReassignDialog.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `🎉 Employee Promotion / Role Change Form for ${employeeName} needs your signature. Review and sign here: ${signLink}`,
      });

      void logActivity({ action: "promotion_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: recipient.name, slot: promoReassignSlot } });

      setPromoReassignDialog(null);
      setPromoReassignRecipientId("");
      setPromoReassignRecipientSearch("");
      await loadSentPromotionForms();
    } catch (err) {
      setPromoActionError(err instanceof Error ? err.message : "Failed to send to next recipient.");
    } finally {
      setPromoActionBusyId(null);
    }
  };

  const handleCopyPromoReassignSentLink = async () => {
    if (!promoReassignSentLink) return;
    try {
      await navigator.clipboard.writeText(promoReassignSentLink);
      setPromoReassignSentLinkCopied(true);
      setTimeout(() => setPromoReassignSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleClosePromoReassignDialog = () => {
    setPromoReassignDialog(null);
    setPromoReassignRecipientId("");
    setPromoReassignRecipientSearch("");
    setPromoReassignMode("teammate");
    setPromoReassignExternalName("");
    setPromoReassignSentLink(null);
  };

  // ── Generate 4th Warning — Manager's Action Plan Form ────────────────
  // Unlike the Warning Form and Promotion Form above, HR only fills the
  // identifying fields here (Employee/Branch/Position/Date) and picks the
  // Manager to route it to — the 5 numbered plan sections and Manager
  // Comments are intentionally left blank at send time and get filled in
  // by the Manager themselves on their sign page (SignActionPlanFormPage.tsx),
  // right alongside signing. Document-only (per design, same as the
  // Promotion Form) — confirming never writes back to the employee's
  // warning record.
  const [actionPlanForm, setActionPlanForm] = useState({
    employeeId: "",
    employeeName: "",
    branch: "",
    position: "",
    date: todayStr,
  });
  const updateActionPlanField = <K extends keyof typeof actionPlanForm>(field: K, value: (typeof actionPlanForm)[K]) =>
    setActionPlanForm((prev) => ({ ...prev, [field]: value }));

  const [actionPlanEmployeeDropdownOpen, setActionPlanEmployeeDropdownOpen] = useState(false);
  const filteredActionPlanEmployeeOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q)) : sorted;
  };
  const selectActionPlanEmployee = (employee: { id: string; name: string; position: string; branch: string }) => {
    setActionPlanForm((prev) => ({
      ...prev,
      employeeId: employee.id,
      employeeName: employee.name,
      position: ROLE_LABELS[normalizeRole(employee.position)] ?? employee.position,
      branch: employee.branch,
    }));
    setActionPlanEmployeeDropdownOpen(false);
  };

  const buildActionPlanFormData = (recipientSlot: ActionPlanSignatureSlot, recipientName: string): ActionPlanFormData => ({
    employeeId: actionPlanForm.employeeId,
    employeeName: actionPlanForm.employeeName,
    branch: actionPlanForm.branch,
    position: actionPlanForm.position,
    date: actionPlanForm.date,
    coachingPlan: "",
    monitoringPlan: "",
    additionalTraining: "",
    performanceExpectations: "",
    consequences: "",
    managerComments: "",
    recipientSlot,
    recipientName,
    recipientNames: recipientName ? { [recipientSlot]: recipientName } : undefined,
  });

  // Same 3-image letterhead as the Certificate of Employment (logo + ribbon
  // header, contact-info footer graphic) — see coeImages above.
  const [actionPlanImages, setActionPlanImages] = useState({ logo: "", ribbon: "", footer: "" });
  const [actionPlanPreviewOpen, setActionPlanPreviewOpen] = useState(false);
  const [actionPlanGenerating, setActionPlanGenerating] = useState(false);
  const [actionPlanRecipientId, setActionPlanRecipientId] = useState("");
  const [actionPlanRecipientSearch, setActionPlanRecipientSearch] = useState("");
  const [actionPlanRecipientDropdownOpen, setActionPlanRecipientDropdownOpen] = useState(false);
  const [actionPlanRecipientSlot, setActionPlanRecipientSlot] = useState<ActionPlanSignatureSlot>("manager");
  const [actionPlanSending, setActionPlanSending] = useState(false);
  const [actionPlanSendError, setActionPlanSendError] = useState<string | null>(null);
  const [actionPlanSendMode, setActionPlanSendMode] = useState<"teammate" | "external">("teammate");
  const [actionPlanExternalName, setActionPlanExternalName] = useState("");
  const [actionPlanSentLink, setActionPlanSentLink] = useState<{ link: string; recipientName: string } | null>(null);
  const [actionPlanSentLinkCopied, setActionPlanSentLinkCopied] = useState(false);
  const filteredActionPlanRecipients = useMemo(() => {
    const q = actionPlanRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, actionPlanRecipientSearch]);

  const handleOpenActionPlanPreview = async () => {
    setActionPlanGenerating(true);
    try {
      const [logoDataUrl, ribbonDataUrl, footerDataUrl] = await Promise.all([
        loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
      ]);
      setActionPlanImages({ logo: logoDataUrl, ribbon: ribbonDataUrl, footer: footerDataUrl });
      setActionPlanRecipientId("");
      setActionPlanRecipientSearch("");
      setActionPlanSendMode("teammate");
      setActionPlanExternalName("");
      setActionPlanSendError(null);
      setActionPlanSentLink(null);
      setActionPlanPreviewOpen(true);
    } finally {
      setActionPlanGenerating(false);
    }
  };

  const handleDownloadActionPlanForm = () => {
    const previewData = buildActionPlanFormData(actionPlanRecipientSlot, "");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Manager's Action Plan Form</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#fff;}${actionPlanFormStyles}@media print{@page{margin:0;}}</style></head><body>${buildActionPlanFormBodyMarkup(previewData, actionPlanImages.logo, actionPlanImages.ribbon, actionPlanImages.footer, {})}</body></html>`;
    openPrintWindow(html);
  };

  const [actionPlanDocxGenerating, setActionPlanDocxGenerating] = useState(false);
  const handleDownloadActionPlanFormWord = async () => {
    setActionPlanDocxGenerating(true);
    try {
      const previewData = buildActionPlanFormData(actionPlanRecipientSlot, "");
      const blob = await buildActionPlanFormDocxBlob(previewData, actionPlanImages.logo, actionPlanImages.ribbon, actionPlanImages.footer);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Manager Action Plan Form - ${previewData.employeeName || "Untitled"}.docx`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setActionPlanDocxGenerating(false);
    }
  };

  const [sentActionPlanForms, setSentActionPlanForms] = useState<SignableDocument[]>([]);
  const loadSentActionPlanForms = async () => {
    try {
      setSentActionPlanForms(await getSignableDocuments("action_plan_form"));
    } catch (err) {
      console.error("Failed to load sent action plan forms:", err);
    }
  };
  useEffect(() => {
    if (activeTab === "actionPlanForm") void loadSentActionPlanForms();
  }, [activeTab]);

  const [actionPlanViewDoc, setActionPlanViewDoc] = useState<SignableDocument | null>(null);
  const handleViewActionPlanForm = async (doc: SignableDocument) => {
    if (!actionPlanImages.logo) {
      const [logoDataUrl, ribbonDataUrl, footerDataUrl] = await Promise.all([
        loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
      ]);
      setActionPlanImages({ logo: logoDataUrl, ribbon: ribbonDataUrl, footer: footerDataUrl });
    }
    setActionPlanViewDoc(doc);
  };

  const handleDownloadActionPlanFormPdf = async (doc: SignableDocument) => {
    if (!doc.pdfUrl) return;
    const employeeName = (doc.formData as unknown as ActionPlanFormData).employeeName || "action-plan-form";
    try {
      const res = await fetch(doc.pdfUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Manager Action Plan Form - ${employeeName}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(doc.pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopyActionPlanFormLink = async (doc: SignableDocument) => {
    try {
      const path = doc.recipientId ? "sign-action-plan-form" : "sign-action-plan-external";
      await navigator.clipboard.writeText(`${getAppUrl()}/${path}/${doc.id}`);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleSendActionPlanForm = async () => {
    if (!actionPlanForm.employeeName.trim() || !actionPlanRecipientId || !uid) return;
    setActionPlanSending(true);
    setActionPlanSendError(null);
    try {
      const recipient = employees.find((e) => e.id === actionPlanRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");

      const formData = buildActionPlanFormData(actionPlanRecipientSlot, recipient.name);
      const pdfBlob = await captureHtmlToPdfBlob(buildActionPlanFormBodyMarkup(formData, actionPlanImages.logo, actionPlanImages.ribbon, actionPlanImages.footer, {}), actionPlanFormStyles);
      const pdfUrl = await uploadActionPlanForm(companyId ?? "", actionPlanForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "action_plan_form",
        formData: formData as unknown as Record<string, any>,
        recipientId: actionPlanRecipientId,
        recipientSlot: actionPlanRecipientSlot,
        pdfUrl,
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, actionPlanRecipientId);
      const signLink = `${getAppUrl()}/sign-action-plan-form/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📋 4th Warning — Manager's Action Plan Form for ${actionPlanForm.employeeName} needs your input and signature. Review and complete it here: ${signLink}`,
      });

      void logActivity({ action: "action_plan_form_sent", targetType: "employee", targetId: actionPlanForm.employeeId, targetLabel: actionPlanForm.employeeName, details: { to: recipient.name, slot: actionPlanRecipientSlot } });

      setActionPlanSentLink({ link: signLink, recipientName: recipient.name });
      await loadSentActionPlanForms();
    } catch (err) {
      setActionPlanSendError(err instanceof Error ? err.message : "Failed to send action plan form.");
    } finally {
      setActionPlanSending(false);
    }
  };

  /** No AHS profile to tie this to, so no DM — the link itself (shown in the same post-send confirmation view) is the only way the recipient finds out. */
  const handleGenerateExternalActionPlanLink = async () => {
    if (!actionPlanForm.employeeName.trim() || !actionPlanExternalName.trim()) return;
    setActionPlanSending(true);
    setActionPlanSendError(null);
    try {
      const formData = buildActionPlanFormData(actionPlanRecipientSlot, actionPlanExternalName.trim());
      const pdfBlob = await captureHtmlToPdfBlob(buildActionPlanFormBodyMarkup(formData, actionPlanImages.logo, actionPlanImages.ribbon, actionPlanImages.footer, {}), actionPlanFormStyles);
      const pdfUrl = await uploadActionPlanForm(companyId ?? "", actionPlanForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "action_plan_form",
        formData: formData as unknown as Record<string, any>,
        recipientName: actionPlanExternalName.trim(),
        recipientSlot: actionPlanRecipientSlot,
        pdfUrl,
      });

      void logActivity({ action: "action_plan_form_sent", targetType: "employee", targetId: actionPlanForm.employeeId, targetLabel: actionPlanForm.employeeName, details: { to: actionPlanExternalName.trim(), slot: actionPlanRecipientSlot, external: true } });

      setActionPlanSentLink({ link: `${getAppUrl()}/sign-action-plan-external/${doc.id}`, recipientName: actionPlanExternalName.trim() });
      await loadSentActionPlanForms();
    } catch (err) {
      setActionPlanSendError(err instanceof Error ? err.message : "Failed to generate link.");
    } finally {
      setActionPlanSending(false);
    }
  };

  const handleCopyActionPlanSentLink = async () => {
    if (!actionPlanSentLink) return;
    try {
      await navigator.clipboard.writeText(actionPlanSentLink.link);
      setActionPlanSentLinkCopied(true);
      setTimeout(() => setActionPlanSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleCloseActionPlanPreview = () => {
    setActionPlanPreviewOpen(false);
    setActionPlanSentLink(null);
    setActionPlanForm({ employeeId: "", employeeName: "", branch: "", position: "", date: todayStr });
  };

  // ── Sent Action Plan Forms tracking table actions ──
  const [actionPlanActionBusyId, setActionPlanActionBusyId] = useState<string | null>(null);
  const [actionPlanActionError, setActionPlanActionError] = useState<string | null>(null);

  /** Document-only (per design — see this section's header comment): confirming just finalizes the record, it never writes back to the employee's warning record. agentNoteId is always null here. */
  const handleConfirmActionPlanForm = async (doc: SignableDocument) => {
    if (!window.confirm("Confirm this action plan form? This finalizes it as the official signed record.")) return;
    setActionPlanActionBusyId(doc.id);
    setActionPlanActionError(null);
    try {
      await confirmSignableDocument(doc.id, null);
      await loadSentActionPlanForms();
      const data = doc.formData as unknown as ActionPlanFormData;
      void logActivity({ action: "action_plan_form_confirmed", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setActionPlanActionError(err instanceof Error ? err.message : "Failed to confirm action plan form.");
    } finally {
      setActionPlanActionBusyId(null);
    }
  };

  const handleCancelActionPlanForm = async (doc: SignableDocument) => {
    const isRevert = doc.status === "confirmed";
    const message = isRevert
      ? "Revert this confirmed action plan form? It goes back to voided — it was never applied to the employee's warning record in the first place, so there's nothing else to undo."
      : "Cancel this action plan form? This voids it entirely.";
    if (!window.confirm(message)) return;
    setActionPlanActionBusyId(doc.id);
    setActionPlanActionError(null);
    try {
      await cancelSignableDocument(doc.id);
      await loadSentActionPlanForms();
      const data = doc.formData as unknown as ActionPlanFormData;
      void logActivity({ action: isRevert ? "action_plan_form_reverted" : "action_plan_form_cancelled", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setActionPlanActionError(err instanceof Error ? err.message : `Failed to ${isRevert ? "revert" : "cancel"} action plan form.`);
    } finally {
      setActionPlanActionBusyId(null);
    }
  };

  const handleDeleteActionPlanForm = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this action plan form? This can't be undone.")) return;
    setActionPlanActionBusyId(doc.id);
    setActionPlanActionError(null);
    try {
      await deleteSignableDocument(doc.id);
      setSentActionPlanForms((prev) => prev.filter((d) => d.id !== doc.id));
      const data = doc.formData as unknown as ActionPlanFormData;
      void logActivity({ action: "action_plan_form_deleted", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setActionPlanActionError(err instanceof Error ? err.message : "Failed to delete action plan form.");
    } finally {
      setActionPlanActionBusyId(null);
    }
  };

  const [actionPlanReassignDialog, setActionPlanReassignDialog] = useState<SignableDocument | null>(null);
  const [actionPlanReassignRecipientId, setActionPlanReassignRecipientId] = useState("");
  const [actionPlanReassignRecipientSearch, setActionPlanReassignRecipientSearch] = useState("");
  const [actionPlanReassignRecipientDropdownOpen, setActionPlanReassignRecipientDropdownOpen] = useState(false);
  const [actionPlanReassignSlot, setActionPlanReassignSlot] = useState<ActionPlanSignatureSlot>("senior_manager");
  const [actionPlanReassignMode, setActionPlanReassignMode] = useState<"teammate" | "external">("teammate");
  const [actionPlanReassignExternalName, setActionPlanReassignExternalName] = useState("");
  const [actionPlanReassignSentLink, setActionPlanReassignSentLink] = useState<string | null>(null);
  const [actionPlanReassignSentLinkCopied, setActionPlanReassignSentLinkCopied] = useState(false);
  const filteredActionPlanReassignRecipients = useMemo(() => {
    const q = actionPlanReassignRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, actionPlanReassignRecipientSearch]);

  const handleSendActionPlanToNextRecipient = async () => {
    if (!actionPlanReassignDialog || !uid) return;
    const employeeName = (actionPlanReassignDialog.formData as unknown as ActionPlanFormData).employeeName || "the employee";

    if (actionPlanReassignMode === "external") {
      if (!actionPlanReassignExternalName.trim()) return;
      setActionPlanActionBusyId(actionPlanReassignDialog.id);
      setActionPlanActionError(null);
      try {
        await reassignSignableDocument(actionPlanReassignDialog.id, { recipientName: actionPlanReassignExternalName.trim() }, actionPlanReassignSlot);
        void logActivity({ action: "action_plan_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: actionPlanReassignExternalName.trim(), slot: actionPlanReassignSlot, external: true } });
        setActionPlanReassignSentLink(`${getAppUrl()}/sign-action-plan-external/${actionPlanReassignDialog.id}`);
        await loadSentActionPlanForms();
      } catch (err) {
        setActionPlanActionError(err instanceof Error ? err.message : "Failed to reassign.");
      } finally {
        setActionPlanActionBusyId(null);
      }
      return;
    }

    if (!actionPlanReassignRecipientId) return;
    setActionPlanActionBusyId(actionPlanReassignDialog.id);
    setActionPlanActionError(null);
    try {
      const recipient = employees.find((e) => e.id === actionPlanReassignRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");
      await reassignSignableDocument(actionPlanReassignDialog.id, { recipientId: actionPlanReassignRecipientId, recipientName: recipient.name }, actionPlanReassignSlot);

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, actionPlanReassignRecipientId);
      const signLink = `${getAppUrl()}/sign-action-plan-form/${actionPlanReassignDialog.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📋 4th Warning — Manager's Action Plan Form for ${employeeName} needs your signature. Review and sign here: ${signLink}`,
      });

      void logActivity({ action: "action_plan_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: recipient.name, slot: actionPlanReassignSlot } });

      setActionPlanReassignDialog(null);
      setActionPlanReassignRecipientId("");
      setActionPlanReassignRecipientSearch("");
      await loadSentActionPlanForms();
    } catch (err) {
      setActionPlanActionError(err instanceof Error ? err.message : "Failed to send to next recipient.");
    } finally {
      setActionPlanActionBusyId(null);
    }
  };

  const handleCopyActionPlanReassignSentLink = async () => {
    if (!actionPlanReassignSentLink) return;
    try {
      await navigator.clipboard.writeText(actionPlanReassignSentLink);
      setActionPlanReassignSentLinkCopied(true);
      setTimeout(() => setActionPlanReassignSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleCloseActionPlanReassignDialog = () => {
    setActionPlanReassignDialog(null);
    setActionPlanReassignRecipientId("");
    setActionPlanReassignRecipientSearch("");
    setActionPlanReassignMode("teammate");
    setActionPlanReassignExternalName("");
    setActionPlanReassignSentLink(null);
  };

  // ── Generate Notice of Termination Form ──────────────────────────────
  // Same shape as the Warning Form — HR fills every field, all 4 recipients
  // only sign to acknowledge. Field layout mirrors src/assets/Termination
  // Notice Form.pdf exactly. Document-only (per design) — confirming never
  // writes back to the employee's Status/Termination Date on their profile.
  const [terminationForm, setTerminationForm] = useState({
    employeeId: "",
    employeeName: "",
    effectiveDate: todayStr,
    reason: "",
  });
  const updateTerminationField = <K extends keyof typeof terminationForm>(field: K, value: (typeof terminationForm)[K]) =>
    setTerminationForm((prev) => ({ ...prev, [field]: value }));

  const [terminationEmployeeDropdownOpen, setTerminationEmployeeDropdownOpen] = useState(false);
  const filteredTerminationEmployeeOptions = (query: string) => {
    const q = query.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q)) : sorted;
  };
  const selectTerminationEmployee = (employee: { id: string; name: string }) => {
    setTerminationForm((prev) => ({ ...prev, employeeId: employee.id, employeeName: employee.name }));
    setTerminationEmployeeDropdownOpen(false);
  };

  const buildTerminationFormData = (recipientSlot: TerminationSignatureSlot, recipientName: string): TerminationFormData => ({
    employeeId: terminationForm.employeeId,
    employeeName: terminationForm.employeeName,
    effectiveDate: terminationForm.effectiveDate,
    reason: terminationForm.reason,
    recipientSlot,
    recipientName,
    recipientNames: recipientName ? { [recipientSlot]: recipientName } : undefined,
  });

  // Same 3-image letterhead as the Certificate of Employment / Manager's
  // Action Plan Form (logo + ribbon header, contact-info footer graphic).
  const [terminationImages, setTerminationImages] = useState({ logo: "", ribbon: "", footer: "" });
  const [terminationPreviewOpen, setTerminationPreviewOpen] = useState(false);
  const [terminationGenerating, setTerminationGenerating] = useState(false);
  const [terminationRecipientId, setTerminationRecipientId] = useState("");
  const [terminationRecipientSearch, setTerminationRecipientSearch] = useState("");
  const [terminationRecipientDropdownOpen, setTerminationRecipientDropdownOpen] = useState(false);
  const [terminationRecipientSlot, setTerminationRecipientSlot] = useState<TerminationSignatureSlot>("employee");
  const [terminationSending, setTerminationSending] = useState(false);
  const [terminationSendError, setTerminationSendError] = useState<string | null>(null);
  const [terminationSendMode, setTerminationSendMode] = useState<"teammate" | "external">("teammate");
  const [terminationExternalName, setTerminationExternalName] = useState("");
  const [terminationSentLink, setTerminationSentLink] = useState<{ link: string; recipientName: string } | null>(null);
  const [terminationSentLinkCopied, setTerminationSentLinkCopied] = useState(false);
  const filteredTerminationRecipients = useMemo(() => {
    const q = terminationRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, terminationRecipientSearch]);

  const handleOpenTerminationPreview = async () => {
    setTerminationGenerating(true);
    try {
      const [logoDataUrl, ribbonDataUrl, footerDataUrl] = await Promise.all([
        loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
      ]);
      setTerminationImages({ logo: logoDataUrl, ribbon: ribbonDataUrl, footer: footerDataUrl });
      setTerminationRecipientId("");
      setTerminationRecipientSearch("");
      setTerminationSendMode("teammate");
      setTerminationExternalName("");
      setTerminationSendError(null);
      setTerminationSentLink(null);
      setTerminationPreviewOpen(true);
    } finally {
      setTerminationGenerating(false);
    }
  };

  const handleDownloadTerminationForm = () => {
    const previewData = buildTerminationFormData(terminationRecipientSlot, "");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Notice of Termination</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#fff;}${terminationFormStyles}@media print{@page{margin:0;}}</style></head><body>${buildTerminationFormBodyMarkup(previewData, terminationImages.logo, terminationImages.ribbon, terminationImages.footer, {})}</body></html>`;
    openPrintWindow(html);
  };

  const [terminationDocxGenerating, setTerminationDocxGenerating] = useState(false);
  const handleDownloadTerminationFormWord = async () => {
    setTerminationDocxGenerating(true);
    try {
      const previewData = buildTerminationFormData(terminationRecipientSlot, "");
      const blob = await buildTerminationFormDocxBlob(previewData, terminationImages.logo, terminationImages.ribbon, terminationImages.footer);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Termination Notice - ${previewData.employeeName || "Untitled"}.docx`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setTerminationDocxGenerating(false);
    }
  };

  const [sentTerminationForms, setSentTerminationForms] = useState<SignableDocument[]>([]);
  const loadSentTerminationForms = async () => {
    try {
      setSentTerminationForms(await getSignableDocuments("termination_form"));
    } catch (err) {
      console.error("Failed to load sent termination forms:", err);
    }
  };
  useEffect(() => {
    if (activeTab === "terminationForm") void loadSentTerminationForms();
  }, [activeTab]);

  const [terminationViewDoc, setTerminationViewDoc] = useState<SignableDocument | null>(null);
  const handleViewTerminationForm = async (doc: SignableDocument) => {
    if (!terminationImages.logo) {
      const [logoDataUrl, ribbonDataUrl, footerDataUrl] = await Promise.all([
        loadImageDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
        loadImageDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
      ]);
      setTerminationImages({ logo: logoDataUrl, ribbon: ribbonDataUrl, footer: footerDataUrl });
    }
    setTerminationViewDoc(doc);
  };

  const handleDownloadTerminationFormPdf = async (doc: SignableDocument) => {
    if (!doc.pdfUrl) return;
    const employeeName = (doc.formData as unknown as TerminationFormData).employeeName || "termination-form";
    try {
      const res = await fetch(doc.pdfUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Termination Notice - ${employeeName}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(doc.pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopyTerminationFormLink = async (doc: SignableDocument) => {
    try {
      const path = doc.recipientId ? "sign-termination-form" : "sign-termination-external";
      await navigator.clipboard.writeText(`${getAppUrl()}/${path}/${doc.id}`);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleSendTerminationForm = async () => {
    if (!terminationForm.employeeName.trim() || !terminationRecipientId || !uid) return;
    setTerminationSending(true);
    setTerminationSendError(null);
    try {
      const recipient = employees.find((e) => e.id === terminationRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");

      const formData = buildTerminationFormData(terminationRecipientSlot, recipient.name);
      const pdfBlob = await captureHtmlToPdfBlob(buildTerminationFormBodyMarkup(formData, terminationImages.logo, terminationImages.ribbon, terminationImages.footer, {}), terminationFormStyles);
      const pdfUrl = await uploadTerminationForm(companyId ?? "", terminationForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "termination_form",
        formData: formData as unknown as Record<string, any>,
        recipientId: terminationRecipientId,
        recipientSlot: terminationRecipientSlot,
        pdfUrl,
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, terminationRecipientId);
      const signLink = `${getAppUrl()}/sign-termination-form/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📄 Notice of Termination for ${terminationForm.employeeName} needs your signature. Review and sign here: ${signLink}`,
      });

      void logActivity({ action: "termination_form_sent", targetType: "employee", targetId: terminationForm.employeeId, targetLabel: terminationForm.employeeName, details: { to: recipient.name, slot: terminationRecipientSlot } });

      setTerminationSentLink({ link: signLink, recipientName: recipient.name });
      await loadSentTerminationForms();
    } catch (err) {
      setTerminationSendError(err instanceof Error ? err.message : "Failed to send termination form.");
    } finally {
      setTerminationSending(false);
    }
  };

  /** No AHS profile to tie this to, so no DM — the link itself (shown in the same post-send confirmation view) is the only way the recipient finds out. */
  const handleGenerateExternalTerminationLink = async () => {
    if (!terminationForm.employeeName.trim() || !terminationExternalName.trim()) return;
    setTerminationSending(true);
    setTerminationSendError(null);
    try {
      const formData = buildTerminationFormData(terminationRecipientSlot, terminationExternalName.trim());
      const pdfBlob = await captureHtmlToPdfBlob(buildTerminationFormBodyMarkup(formData, terminationImages.logo, terminationImages.ribbon, terminationImages.footer, {}), terminationFormStyles);
      const pdfUrl = await uploadTerminationForm(companyId ?? "", terminationForm.employeeName, pdfBlob);

      const doc = await createSignableDocument({
        documentType: "termination_form",
        formData: formData as unknown as Record<string, any>,
        recipientName: terminationExternalName.trim(),
        recipientSlot: terminationRecipientSlot,
        pdfUrl,
      });

      void logActivity({ action: "termination_form_sent", targetType: "employee", targetId: terminationForm.employeeId, targetLabel: terminationForm.employeeName, details: { to: terminationExternalName.trim(), slot: terminationRecipientSlot, external: true } });

      setTerminationSentLink({ link: `${getAppUrl()}/sign-termination-external/${doc.id}`, recipientName: terminationExternalName.trim() });
      await loadSentTerminationForms();
    } catch (err) {
      setTerminationSendError(err instanceof Error ? err.message : "Failed to generate link.");
    } finally {
      setTerminationSending(false);
    }
  };

  const handleCopyTerminationSentLink = async () => {
    if (!terminationSentLink) return;
    try {
      await navigator.clipboard.writeText(terminationSentLink.link);
      setTerminationSentLinkCopied(true);
      setTimeout(() => setTerminationSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleCloseTerminationPreview = () => {
    setTerminationPreviewOpen(false);
    setTerminationSentLink(null);
    setTerminationForm({ employeeId: "", employeeName: "", effectiveDate: todayStr, reason: "" });
  };

  // ── Sent Termination Forms tracking table actions ──
  const [terminationActionBusyId, setTerminationActionBusyId] = useState<string | null>(null);
  const [terminationActionError, setTerminationActionError] = useState<string | null>(null);

  /** Document-only (per design — see this section's header comment): confirming just finalizes the record, it never writes back to the employee's Status/Termination Date. agentNoteId is always null here — this form has nothing to do with the warnings system. */
  const handleConfirmTerminationForm = async (doc: SignableDocument) => {
    if (!window.confirm("Confirm this termination notice? This finalizes it as the official signed record.")) return;
    setTerminationActionBusyId(doc.id);
    setTerminationActionError(null);
    try {
      await confirmSignableDocument(doc.id, null);
      await loadSentTerminationForms();
      const data = doc.formData as unknown as TerminationFormData;
      void logActivity({ action: "termination_form_confirmed", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setTerminationActionError(err instanceof Error ? err.message : "Failed to confirm termination form.");
    } finally {
      setTerminationActionBusyId(null);
    }
  };

  const handleCancelTerminationForm = async (doc: SignableDocument) => {
    const isRevert = doc.status === "confirmed";
    const message = isRevert
      ? "Revert this confirmed termination notice? It goes back to voided — it was never applied to the employee's profile in the first place, so there's nothing else to undo."
      : "Cancel this termination notice? This voids it entirely.";
    if (!window.confirm(message)) return;
    setTerminationActionBusyId(doc.id);
    setTerminationActionError(null);
    try {
      await cancelSignableDocument(doc.id);
      await loadSentTerminationForms();
      const data = doc.formData as unknown as TerminationFormData;
      void logActivity({ action: isRevert ? "termination_form_reverted" : "termination_form_cancelled", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setTerminationActionError(err instanceof Error ? err.message : `Failed to ${isRevert ? "revert" : "cancel"} termination form.`);
    } finally {
      setTerminationActionBusyId(null);
    }
  };

  const handleDeleteTerminationForm = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this termination notice? This can't be undone.")) return;
    setTerminationActionBusyId(doc.id);
    setTerminationActionError(null);
    try {
      await deleteSignableDocument(doc.id);
      setSentTerminationForms((prev) => prev.filter((d) => d.id !== doc.id));
      const data = doc.formData as unknown as TerminationFormData;
      void logActivity({ action: "termination_form_deleted", targetType: "employee", targetId: data.employeeId, targetLabel: data.employeeName });
    } catch (err) {
      setTerminationActionError(err instanceof Error ? err.message : "Failed to delete termination form.");
    } finally {
      setTerminationActionBusyId(null);
    }
  };

  const [terminationReassignDialog, setTerminationReassignDialog] = useState<SignableDocument | null>(null);
  const [terminationReassignRecipientId, setTerminationReassignRecipientId] = useState("");
  const [terminationReassignRecipientSearch, setTerminationReassignRecipientSearch] = useState("");
  const [terminationReassignRecipientDropdownOpen, setTerminationReassignRecipientDropdownOpen] = useState(false);
  const [terminationReassignSlot, setTerminationReassignSlot] = useState<TerminationSignatureSlot>("manager");
  const [terminationReassignMode, setTerminationReassignMode] = useState<"teammate" | "external">("teammate");
  const [terminationReassignExternalName, setTerminationReassignExternalName] = useState("");
  const [terminationReassignSentLink, setTerminationReassignSentLink] = useState<string | null>(null);
  const [terminationReassignSentLinkCopied, setTerminationReassignSentLinkCopied] = useState(false);
  const filteredTerminationReassignRecipients = useMemo(() => {
    const q = terminationReassignRecipientSearch.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((e) => e.name.toLowerCase().includes(q) || (ROLE_LABELS[normalizeRole(e.position)] ?? e.position).toLowerCase().includes(q)) : sorted;
  }, [employees, terminationReassignRecipientSearch]);

  const handleSendTerminationToNextRecipient = async () => {
    if (!terminationReassignDialog || !uid) return;
    const employeeName = (terminationReassignDialog.formData as unknown as TerminationFormData).employeeName || "the employee";

    if (terminationReassignMode === "external") {
      if (!terminationReassignExternalName.trim()) return;
      setTerminationActionBusyId(terminationReassignDialog.id);
      setTerminationActionError(null);
      try {
        await reassignSignableDocument(terminationReassignDialog.id, { recipientName: terminationReassignExternalName.trim() }, terminationReassignSlot);
        void logActivity({ action: "termination_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: terminationReassignExternalName.trim(), slot: terminationReassignSlot, external: true } });
        setTerminationReassignSentLink(`${getAppUrl()}/sign-termination-external/${terminationReassignDialog.id}`);
        await loadSentTerminationForms();
      } catch (err) {
        setTerminationActionError(err instanceof Error ? err.message : "Failed to reassign.");
      } finally {
        setTerminationActionBusyId(null);
      }
      return;
    }

    if (!terminationReassignRecipientId) return;
    setTerminationActionBusyId(terminationReassignDialog.id);
    setTerminationActionError(null);
    try {
      const recipient = employees.find((e) => e.id === terminationReassignRecipientId);
      if (!recipient) throw new Error("Select a recipient first.");
      await reassignSignableDocument(terminationReassignDialog.id, { recipientId: terminationReassignRecipientId, recipientName: recipient.name }, terminationReassignSlot);

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, terminationReassignRecipientId);
      const signLink = `${getAppUrl()}/sign-termination-form/${terminationReassignDialog.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📄 Notice of Termination for ${employeeName} needs your signature. Review and sign here: ${signLink}`,
      });

      void logActivity({ action: "termination_form_reassigned", targetType: "employee", targetLabel: employeeName, details: { to: recipient.name, slot: terminationReassignSlot } });

      setTerminationReassignDialog(null);
      setTerminationReassignRecipientId("");
      setTerminationReassignRecipientSearch("");
      await loadSentTerminationForms();
    } catch (err) {
      setTerminationActionError(err instanceof Error ? err.message : "Failed to send to next recipient.");
    } finally {
      setTerminationActionBusyId(null);
    }
  };

  const handleCopyTerminationReassignSentLink = async () => {
    if (!terminationReassignSentLink) return;
    try {
      await navigator.clipboard.writeText(terminationReassignSentLink);
      setTerminationReassignSentLinkCopied(true);
      setTimeout(() => setTerminationReassignSentLinkCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleCloseTerminationReassignDialog = () => {
    setTerminationReassignDialog(null);
    setTerminationReassignRecipientId("");
    setTerminationReassignRecipientSearch("");
    setTerminationReassignMode("teammate");
    setTerminationReassignExternalName("");
    setTerminationReassignSentLink(null);
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
    const employee = employees.find((e) => e.id === id);
    const prevStatus = employee?.status;
    try {
      const info = (await getProfileEmployeeInfo(id)) || {};
      await saveProfileEmployeeInfo(id, { ...info, employmentStatus: newStatus, employmentStatusDate: today });
      await updateCompanyUser(id, { isActive: newStatus === "active" });
      setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, status: newStatus, terminationDate: newStatus === "terminated" || newStatus === "resigned" ? today : e.terminationDate } : e)));
      void logActivity({ action: "employee_status_changed", targetType: "employee", targetId: id, targetLabel: employee?.name, details: { from: prevStatus, to: newStatus, status: newStatus } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update employment status.");
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!confirmDialog) return;
    await persistEmployeeStatus(confirmDialog.employeeId, confirmDialog.newStatus);
    setConfirmDialog(null);
  };

  // Trainee vs Regular — a separate classification from Account Status
  // above, no confirmation needed (unlike terminating/resigning someone).
  const handleUpdateEmploymentType = async (id: string, newType: "trainee" | "regular") => {
    const employee = employees.find((e) => e.id === id);
    const prevType = employee?.employmentType ?? "regular";
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, employmentType: newType } : e)));
    try {
      await updateCompanyUser(id, { employmentType: newType });
      void logActivity({ action: "employee_status_changed", targetType: "employee", targetId: id, targetLabel: employee?.name, details: { employmentType: newType } });
    } catch (err) {
      setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, employmentType: prevType } : e)));
      setError(err instanceof Error ? err.message : "Failed to update employment type.");
    }
  };

  const handleCancelStatusChange = () => setConfirmDialog(null);

  // Master List's Department column dropdown (Unlisted/every other tab) —
  // an explicit override, writing straight to profiles.department. Once
  // set, this raw value always wins over the Leaders-roster/role-based
  // fallback in resolveMasterListDepartment, so it's how HR moves someone
  // out of Unlisted (or between any two departments) directly from the table.
  const handleUpdateEmployeeDepartment = async (id: string, value: string) => {
    const prevEmployee = employees.find((e) => e.id === id);
    if (!prevEmployee) return;
    const prevValue = prevEmployee.department;
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, department: value } : e)));
    try {
      await updateCompanyUser(id, { department: value });
    } catch (err) {
      console.error("Failed to move employee's department:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, department: prevValue } : e)));
    }
  };

  // Master List's "duplicate to another department" control — someone
  // like Daven Hodge genuinely leads two departments at once; this makes
  // them ALSO appear under a second tab without touching their real
  // (primary) department, which the Department dropdown above still edits.
  const persistExtraDepartments = async (id: string, next: string[]) => {
    const prevEmployee = employees.find((e) => e.id === id);
    if (!prevEmployee) return;
    const prevValue = prevEmployee.extraDepartments;
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, extraDepartments: next } : e)));
    try {
      await updateCompanyUser(id, { masterListExtraDepartments: next });
    } catch (err) {
      console.error("Failed to update duplicate departments:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, extraDepartments: prevValue } : e)));
    }
  };
  const handleAddExtraDepartment = (id: string, dept: string) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee || employee.extraDepartments.includes(dept)) return;
    void persistExtraDepartments(id, [...employee.extraDepartments, dept]);
  };
  const handleRemoveExtraDepartment = (id: string, dept: string) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee) return;
    void persistExtraDepartments(id, employee.extraDepartments.filter((d) => d !== dept));
  };

  // Master List's "Hours of Work" column — writes profiles.required_check_in
  // / required_check_out, the SAME fields EmployeeSelfServicePage.tsx's
  // "Required Schedule" section reads (see ManageWorkingHoursModal.tsx for
  // the same write path elsewhere in the app) — this is what actually
  // reflects on the employee's own My Profile page.
  const handleUpdateSchedule = async (id: string, field: "requiredCheckIn" | "requiredCheckOut" | "scheduleTimezone", value: string) => {
    const prevEmployee = employees.find((e) => e.id === id);
    if (!prevEmployee) return;
    const prevValue = prevEmployee[field];
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
    try {
      await updateCompanyUser(id, { [field]: value } as Parameters<typeof updateCompanyUser>[1]);
    } catch (err) {
      console.error("Failed to save required schedule:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, [field]: prevValue } : e)));
    }
  };

  // Master List's "Total Work Hours" column — writes profiles.working_hours
  // directly (distinct from the Required Schedule check-in/out range above).
  const handleUpdateWorkingHours = async (id: string, hours: number | null) => {
    const prevEmployee = employees.find((e) => e.id === id);
    if (!prevEmployee) return;
    const prevValue = prevEmployee.workingHours;
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, workingHours: hours } : e)));
    try {
      await updateCompanyUser(id, { workingHours: hours });
    } catch (err) {
      console.error("Failed to save total work hours:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, workingHours: prevValue } : e)));
    }
  };

  // Master List's "Meal Time" column — writes profiles.meal_minutes, the
  // other half of the same "Working Hours & Meal Time" field set on My Profile.
  const handleUpdateMealMinutes = async (id: string, minutes: number | null) => {
    const prevEmployee = employees.find((e) => e.id === id);
    if (!prevEmployee) return;
    const prevValue = prevEmployee.mealMinutes;
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, mealMinutes: minutes } : e)));
    try {
      await updateCompanyUser(id, { mealMinutes: minutes });
    } catch (err) {
      console.error("Failed to save meal time:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, mealMinutes: prevValue } : e)));
    }
  };

  // Master List's "Start Date" column — writes employee_info.hireDate (same
  // record persistEmployeeStatus above reads/merges), not a profiles column.
  const handleUpdateStartDate = async (id: string, value: string) => {
    const employee = employees.find((e) => e.id === id);
    const prevValue = employee?.startDate ?? "";
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, startDate: value } : e)));
    try {
      const info = (await getProfileEmployeeInfo(id)) || {};
      await saveProfileEmployeeInfo(id, { ...info, hireDate: value });
      void logActivity({ action: "employee_start_date_changed", targetType: "employee", targetId: id, targetLabel: employee?.name, details: { from: prevValue, to: value } });
    } catch (err) {
      console.error("Failed to save start date:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, startDate: prevValue } : e)));
    }
  };

  const handleUpdatePhone = async (id: string, value: string) => {
    const employee = employees.find((e) => e.id === id);
    const prevValue = employee?.phone ?? "";
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, phone: value } : e)));
    try {
      await updateCompanyUser(id, { phoneNumber: value });
      void logActivity({ action: "employee_phone_changed", targetType: "employee", targetId: id, targetLabel: employee?.name, details: { from: prevValue, to: value } });
    } catch (err) {
      console.error("Failed to save phone number:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, phone: prevValue } : e)));
    }
  };

  const handleUpdateBranch = async (id: string, value: string) => {
    const employee = employees.find((e) => e.id === id);
    const prevValue = employee?.branch ?? "";
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, branch: value } : e)));
    try {
      await updateCompanyUser(id, { assignedBranch: value });
      void logActivity({ action: "employee_branch_changed", targetType: "employee", targetId: id, targetLabel: employee?.name, details: { from: prevValue, to: value } });
    } catch (err) {
      console.error("Failed to save branch:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, branch: prevValue } : e)));
    }
  };

  // Single free-text field, same as the table/popup display already treats
  // it — overwrites address1 and clears city/state so the join in
  // loadEmployees's mapping (`[address1, city, state].filter(Boolean).join`)
  // never shows a stale city/state stuck onto a freshly-typed full address.
  const handleUpdateAddress = async (id: string, value: string) => {
    const employee = employees.find((e) => e.id === id);
    const prevValue = employee?.address ?? "";
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, address: value } : e)));
    try {
      const info = (await getProfileEmployeeInfo(id)) || {};
      await saveProfileEmployeeInfo(id, { ...info, address1: value, city: "", state: "" });
      void logActivity({ action: "employee_address_changed", targetType: "employee", targetId: id, targetLabel: employee?.name, details: { from: prevValue, to: value } });
    } catch (err) {
      console.error("Failed to save address:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, address: prevValue } : e)));
    }
  };

  // Email is the real Firebase Auth login credential (not just contact
  // info), so changing it goes through /api/admin-update-email first — same
  // flow as the full employee detail page (see
  // m.$module.$submodule.$userId.tsx's canEditEmail/handleSave), except HR
  // is also allowed here (see that endpoint's ADMIN_ROLES) since this is
  // specifically the Master List's quick-edit popup. The actual update call
  // lives in handleSaveMasterListDetail below (part of the popup's single
  // "Save Changes" batch, not a standalone per-field commit) — only once
  // the Firebase Auth update succeeds does profiles.email itself get
  // updated, so the two never end up desynced from a partial failure.
  const canEditEmployeeEmail = [myRole, ...(myExtraRoles ?? [])].some((r) => ["ADMIN", "SUPERADMIN", "HR"].includes(String(r || "").toUpperCase()));

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

  // Extra columns HR has added from the "+ Add Column" button, per group —
  // merged with the hardcoded TECHNICIAN/PARTS_MANAGER/PH_ONBOARDING_DOCS
  // lists below. A custom column behaves exactly like a hardcoded one: it's
  // just another free-text category name, so the same YES/NO lookup and the
  // same per-employee drop zone work for it with no other changes.
  const [customOnboardingColumns, setCustomOnboardingColumns] = useState<OnboardingDocumentColumn[]>([]);
  const [addColumnGroup, setAddColumnGroup] = useState<OnboardingGroupKey | null>(null);
  const [newColumnLabel, setNewColumnLabel] = useState("");
  const [addColumnSaving, setAddColumnSaving] = useState(false);
  const [addColumnError, setAddColumnError] = useState<string | null>(null);

  const defaultOnboardingDocsFor = (groupKey: OnboardingGroupKey) =>
    groupKey === "PH" ? PH_ONBOARDING_DOCS
    : groupKey === "TECHNICIAN" ? TECHNICIAN_ONBOARDING_DOCS
    : PARTS_MANAGER_ONBOARDING_DOCS;
  const onboardingDocsForGroup = (groupKey: OnboardingGroupKey) => [
    ...defaultOnboardingDocsFor(groupKey),
    ...customOnboardingColumns.filter((c) => c.groupKey === groupKey).map((c) => c.label),
  ];

  const handleAddOnboardingColumn = async () => {
    if (!addColumnGroup || !newColumnLabel.trim()) return;
    setAddColumnSaving(true);
    setAddColumnError(null);
    try {
      await addOnboardingDocumentColumn(addColumnGroup, newColumnLabel);
      setCustomOnboardingColumns(await getOnboardingDocumentColumns());
      setAddColumnGroup(null);
      setNewColumnLabel("");
    } catch (err) {
      setAddColumnError(err instanceof Error ? err.message : "Failed to add column.");
    } finally {
      setAddColumnSaving(false);
    }
  };
  const handleRemoveOnboardingColumn = async (col: OnboardingDocumentColumn) => {
    if (!window.confirm(`Remove the "${col.label}" column? This won't delete any files already filed under it.`)) return;
    setCustomOnboardingColumns((prev) => prev.filter((c) => c.id !== col.id));
    try {
      await deleteOnboardingDocumentColumn(col.id);
    } catch (err) {
      console.error("Failed to remove onboarding column:", err);
      setCustomOnboardingColumns(await getOnboardingDocumentColumns());
    }
  };

  // Same US-Technician/US-other/PH split as onboardingEmployees above, just evaluated for one specific employee — used to pick their document list regardless of whichever group tab happens to be selected at click-time.
  const getOnboardingDocListForEmployee = (employee: { country: string; position: string }) =>
    onboardingDocsForGroup(
      employee.country === "PH" ? "PH"
      : normalizeRole(employee.position) === "TECHNICIAN" ? "TECHNICIAN"
      : "PARTS_MANAGER"
    );
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
  const onboardingDocColumns = onboardingDocsForGroup(onboardingGroup);

  // Custom columns are company-wide (not filtered by the currently visible
  // employee list), so just load them once when the tab is first opened.
  const customOnboardingColumnsLoadedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== "onboarding" || customOnboardingColumnsLoadedRef.current) return;
    customOnboardingColumnsLoadedRef.current = true;
    getOnboardingDocumentColumns()
      .then(setCustomOnboardingColumns)
      .catch((err) => console.error("Failed to load custom onboarding columns:", err));
  }, [activeTab]);

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

  // Remaining Sick Leave per employee — flat 5 days every tenure year
  // (never increments), available from day 1 (no 1-year wait, unlike
  // vacation PTO above) — same sickYearWindow/sickDaysUsed logic Employee
  // Self-Service uses. Master List's "Sick Leave" column pairs this with
  // its own allowance rather than the vacation-PTO figure above — Sick
  // Leave is its own separate accrual bucket (see pto.ts's isPaidPtoType/
  // sickYearWindow), not drawn from the same pool as vacation/personal.
  const remainingSickByProfile = useMemo(() => {
    const map = new Map<string, { remaining: number; allowance: number } | null>();
    for (const e of employees) {
      const window = sickYearWindow(e.startDate, null);
      if (!window) {
        map.set(e.id, null);
        continue;
      }
      const used = sickDaysUsed(ptoRequestsByProfile.get(e.id) ?? [], window);
      map.set(e.id, { remaining: Math.max(0, window.allowance - used), allowance: window.allowance });
    }
    return map;
  }, [employees, ptoRequestsByProfile]);

  // ── Master List — same staff roster as Employee Directory, but split
  // into sub-tabs by department instead of one flat table. Sub-tabs are
  // generated from whatever distinct profiles.department values actually
  // exist (not a hand-picked list), so a newly-typed department shows up
  // automatically next time someone opens this tab — no code change needed.
  const [masterListDept, setMasterListDept] = useState<string>("__all__");
  const [masterListSearch, setMasterListSearch] = useState("");
  // Clicking a name on Master List pops up a quick-detail card instead of
  // navigating away — full stats are still one click further via the
  // "View full profile" link inside it.
  const [masterListDetailEmployee, setMasterListDetailEmployee] = useState<Employee | null>(null);
  // Recent-edit history shown at the bottom of that popup — every field
  // edit made from either the popup or the table itself logs here (see
  // handleUpdatePhone/handleUpdateAddress/handleUpdateBranch/
  // handleUpdateEmployeeEmail/handleUpdateStartDate/persistEmployeeStatus),
  // so this is a real audit trail, not a popup-only note.
  const [masterListDetailActivity, setMasterListDetailActivity] = useState<HrActivityLogEntry[]>([]);
  const [masterListDetailActivityLoading, setMasterListDetailActivityLoading] = useState(false);
  // The popup edits a local draft and only persists on "Save Changes" — the
  // table's own columns stay onBlur-instant (that's intentional, requested
  // separately), but this popup previously auto-committed per field on blur
  // too, which made it unclear whether an edit (e.g. the Email field) had
  // actually gone through until the popup was reopened. An explicit save
  // gives one clear success/failure result for everything changed at once.
  interface MasterListDetailDraft {
    status: EmploymentStatus;
    startDate: string;
    branch: string;
    phone: string;
    email: string;
    address: string;
  }
  const [popupDraft, setPopupDraft] = useState<MasterListDetailDraft | null>(null);
  const [popupSaving, setPopupSaving] = useState(false);
  const [popupSaveError, setPopupSaveError] = useState<string | null>(null);
  const [popupSaveSuccess, setPopupSaveSuccess] = useState(false);
  const draftFromEmployee = (employee: Employee): MasterListDetailDraft => ({
    status: employee.status,
    startDate: employee.startDate || "",
    branch: employee.branch || "",
    phone: employee.phone || "",
    email: employee.email,
    address: employee.address || "",
  });
  const openMasterListDetail = async (employee: Employee) => {
    setMasterListDetailEmployee(employee);
    setPopupDraft(draftFromEmployee(employee));
    setPopupSaveError(null);
    setPopupSaveSuccess(false);
    setMasterListDetailActivityLoading(true);
    try {
      setMasterListDetailActivity(await getActivityLog({ targetId: employee.id, limit: 15 }));
    } catch (err) {
      console.error("Failed to load employee activity log:", err);
      setMasterListDetailActivity([]);
    } finally {
      setMasterListDetailActivityLoading(false);
    }
  };

  const handleSaveMasterListDetail = async () => {
    if (!masterListDetailEmployee || !popupDraft) return;
    const id = masterListDetailEmployee.id;
    const original = employees.find((e) => e.id === id) ?? masterListDetailEmployee;
    setPopupSaving(true);
    setPopupSaveError(null);
    setPopupSaveSuccess(false);
    try {
      const patch: Partial<Employee> = {};

      // Terminated/Resigned routes through the existing confirm dialog,
      // which persists (and logs) on its own once confirmed — everything
      // else here commits directly.
      if (popupDraft.status !== original.status) {
        handleUpdateEmployeeStatus(id, popupDraft.status);
      }
      if (popupDraft.startDate !== (original.startDate || "")) {
        const info = (await getProfileEmployeeInfo(id)) || {};
        await saveProfileEmployeeInfo(id, { ...info, hireDate: popupDraft.startDate });
        void logActivity({ action: "employee_start_date_changed", targetType: "employee", targetId: id, targetLabel: original.name, details: { from: original.startDate, to: popupDraft.startDate } });
        patch.startDate = popupDraft.startDate;
      }
      if (popupDraft.branch !== (original.branch || "")) {
        await updateCompanyUser(id, { assignedBranch: popupDraft.branch });
        void logActivity({ action: "employee_branch_changed", targetType: "employee", targetId: id, targetLabel: original.name, details: { from: original.branch, to: popupDraft.branch } });
        patch.branch = popupDraft.branch;
      }
      if (popupDraft.phone !== (original.phone || "")) {
        await updateCompanyUser(id, { phoneNumber: popupDraft.phone });
        void logActivity({ action: "employee_phone_changed", targetType: "employee", targetId: id, targetLabel: original.name, details: { from: original.phone, to: popupDraft.phone } });
        patch.phone = popupDraft.phone;
      }
      if (popupDraft.address !== (original.address || "")) {
        const info = (await getProfileEmployeeInfo(id)) || {};
        await saveProfileEmployeeInfo(id, { ...info, address1: popupDraft.address, city: "", state: "" });
        void logActivity({ action: "employee_address_changed", targetType: "employee", targetId: id, targetLabel: original.name, details: { from: original.address, to: popupDraft.address } });
        patch.address = popupDraft.address;
      }
      const trimmedEmail = popupDraft.email.trim();
      if (canEditEmployeeEmail && trimmedEmail && trimmedEmail !== original.email) {
        const idToken = await firebaseAuth?.currentUser?.getIdToken();
        if (!idToken) throw new Error("Could not verify your session. Please re-login and try again.");
        const res = await fetch("/api/admin-update-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, targetProfileId: id, newEmail: trimmedEmail }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to update login email");
        await updateCompanyUser(id, { email: trimmedEmail });
        void logActivity({ action: "employee_email_changed", targetType: "employee", targetId: id, targetLabel: original.name, details: { from: original.email, to: trimmedEmail } });
        patch.email = trimmedEmail;
      }

      if (Object.keys(patch).length > 0) {
        setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      }
      setPopupSaveSuccess(true);
      setMasterListDetailActivity(await getActivityLog({ targetId: id, limit: 15 }));
    } catch (err) {
      setPopupSaveError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setPopupSaving(false);
    }
  };

  // Declared here (rather than down with the rest of the Leaders tab state)
  // so the department-resolution fallback just below can use it — the
  // effect that actually LOADS it still lives further down.
  const [leadersRoster, setLeadersRoster] = useState<LeadersRosterRow[]>([]);

  // Master List's own department resolution — most profiles.department
  // values are blank in practice, so falling straight back to "Unassigned"
  // buried hundreds of real people in one useless bucket. Instead: use the
  // Leaders roster's department for anyone who's on it by name (a real,
  // curated source), then fall back to role->department (same mapping
  // AccountingDashboard.tsx's Payroll table uses) — only genuinely unknown
  // roles land in "Unassigned" now. This is DISPLAY-only (grouping/sub-tabs),
  // it never writes the resolved value back to profiles.department.
  const MASTER_LIST_UNASSIGNED = "Unassigned";
  const LEADERS_TIER_RANK: Record<LeadersRosterRow["tier"], number> = { senior: 3, manager: 2, standard: 1 };
  // A person can legitimately have more than one roster row now (e.g. Daven
  // Hodge is Technical Director of both Current Technicians and Technical
  // Support; the "duplicate to another department" feature deliberately
  // creates more of these). Picking "whichever row comes first in the
  // roster" is arbitrary and has bitten us before (a stray low-tier
  // placeholder row sorting ahead of someone's real senior entry) — always
  // prefer their HIGHEST-tier row instead, and take department/tier/title
  // from that SAME row so they never end up mismatched.
  // A stray row can end up with its tier bumped to match a real senior
  // entry (e.g. via the tier dropdown) while its title stays whatever
  // generic default it was created with — a straight tier comparison
  // would then tie, and whichever sorts first by department wins by
  // accident. Break that tie by preferring the title that doesn't read
  // like a mismatch for its own tier (a "senior" row titled "Team Leader"
  // is almost certainly the stray one).
  const looksMismatched = (row: LeadersRosterRow) =>
    (row.tier === "senior" || row.tier === "manager") && /team leader|\bagent\b/i.test(row.roleTitle);
  const leadersBestRowByName = useMemo(() => {
    const map = new Map<string, LeadersRosterRow>();
    for (const row of leadersRoster) {
      const existing = map.get(row.personName);
      if (!existing) {
        map.set(row.personName, row);
        continue;
      }
      const tierDiff = LEADERS_TIER_RANK[row.tier] - LEADERS_TIER_RANK[existing.tier];
      if (tierDiff > 0) {
        map.set(row.personName, row);
      } else if (tierDiff === 0 && looksMismatched(existing) && !looksMismatched(row)) {
        map.set(row.personName, row);
      }
    }
    return map;
  }, [leadersRoster]);
  const leadersDeptByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, row] of leadersBestRowByName) map.set(name, row.department);
    return map;
  }, [leadersBestRowByName]);
  // Senior-tier leaders (see the Leaders tab) sit above a single department
  // — e.g. Lou Basco is Senior Manager across CSR, Accounting, and HR — so
  // showing one specific department for them would be misleading. Anyone
  // on that tier gets the "Senior Manager" label instead in the Department
  // column below, rather than whichever one department happens to be on
  // file for them.
  const leadersTierByName = useMemo(() => {
    const map = new Map<string, LeadersRosterRow["tier"]>();
    for (const [name, row] of leadersBestRowByName) map.set(name, row.tier);
    return map;
  }, [leadersBestRowByName]);
  // Leaders roster titles ("Team Leader", "Lead Manager", "Pre Auth", …)
  // are more specific/accurate than the flat role-code label for anyone
  // on that roster — used for Master List's Position column.
  const leadersTitleByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, row] of leadersBestRowByName) map.set(name, row.roleTitle);
    return map;
  }, [leadersBestRowByName]);
  const resolveMasterListPosition = (e: Employee): string =>
    leadersTitleByName.get(e.name) || ROLE_LABELS[normalizeRole(e.position)] || e.position || "—";
  /** The raw specific department, before the senior-tier "Senior Manager" override below — needed by hrAccountingCsrRank to know which of HR/Accounting/CSR someone is actually in even once they're a senior leader. */
  const rawSpecificDepartment = (e: Employee): string => {
    const raw = e.department?.trim();
    return (
      raw ||
      leadersDeptByName.get(e.name) ||
      getRoleDepartmentBreakdown(e.position).department ||
      MASTER_LIST_UNASSIGNED
    );
  };
  /** Display-only — the person's actual specific department (not the 6-group collapse used for sub-tabs). */
  const resolveSpecificDepartment = (e: Employee): string => {
    // Senior-tier leaders sit above a single department (Lou Basco is
    // "Senior Manager" across CSR/Accounting/HR), so showing one specific
    // department for them would be misleading — group by their actual
    // title instead (which for a title-specific role like Daven Hodge's
    // "Technical Director" is NOT the generic "Senior Manager" label).
    if (leadersTierByName.get(e.name) === "senior") return leadersTitleByName.get(e.name) || "Senior Manager";
    return rawSpecificDepartment(e);
  };
  // Explicit hierarchy for the "HR, Accounting and CSR" canonical group —
  // its 3 sub-departments share one senior manager but don't follow the
  // usual manager > team-leader rank order across each other (an
  // Accounting Team Leader outranks a CSR Manager here), so this can't be
  // derived from the generic positionRank below. Index 0 = highest.
  // HR, Accounting, and CSR share one senior manager but are otherwise 3
  // separate departments — grouped as their own tier containers (Senior
  // Manager on top, then each department as its own block) instead of
  // interleaving everyone by a single flat manager/team-leader/agent rank.
  const HR_ACCOUNTING_CSR_ORDER = ["Senior Manager", "HR", "Accounting", "CSR"];
  /** Which of the 4 HR/Accounting/CSR tiers this person is in, or null if they're not in that canonical group at all. */
  const hrAccountingCsrLabel = (e: Employee): string | null => {
    if (resolveMasterListDepartment(e) !== "HR, Accounting and CSR") return null;
    if (leadersTierByName.get(e.name) === "senior") return "Senior Manager";
    const dept = rawSpecificDepartment(e);
    if (/human\s*resources|^hr\b/i.test(dept)) return "HR";
    if (/accounting|finance/i.test(dept)) return "Accounting";
    if (/\bcsr\b|customer\s*service/i.test(dept)) return "CSR";
    return "CSR"; // unresolved dept but still in this canonical group — CSR is the largest catch-all here
  };
  /** Rank within HR_ACCOUNTING_CSR_ORDER (higher = outranks), or null if this employee isn't in that canonical group. */
  const hrAccountingCsrRank = (e: Employee): number | null => {
    const label = hrAccountingCsrLabel(e);
    if (label === null) return null;
    const idx = HR_ACCOUNTING_CSR_ORDER.indexOf(label);
    return idx === -1 ? null : HR_ACCOUNTING_CSR_ORDER.length - idx;
  };
  // Explicit hierarchy for "Current Technicians" — the generic tier-based
  // ranking below can't tell an Assistant Technical Director from a plain
  // Senior Branch Manager (both are "senior"/"manager" tier), so this
  // checks title/role text directly instead. Index 0 = highest.
  const CURRENT_TECHNICIANS_ORDER = [
    "Technical Director",
    "Technical Assistant Director",
    "Senior Branch Manager",
    "Branch Manager",
    "Tech Manager",
    "Technician",
  ];
  /** Which of the 6 Current Technicians tiers this person is in, or null if they're not in that canonical group at all. Used both for sorting and for splitting the Master List into separate tier containers (see groupByDepartment). Tech Manager is kept separate from Branch Manager — they're different roles (see 0156's Technical Support split), not interchangeable titles. */
  const currentTechniciansLabel = (e: Employee): string | null => {
    if (resolveMasterListDepartment(e) !== "Current Technicians") return null;
    const tier = leadersTierByName.get(e.name);
    const title = (leadersTitleByName.get(e.name) || "").toLowerCase();
    const code = normalizeRole(e.position);
    if (/^technical director$/i.test(title) || code === "TECHNICAL_DIRECTOR") return "Technical Director";
    if (/assistant.*director|technical\s*assistant\s*director/i.test(title) || code === "TECHNICAL_ASSISTANT_DIRECTOR") return "Technical Assistant Director";
    if (/senior\s*(branch\s*)?manager/i.test(title) || tier === "senior" || code === "SENIOR_BRANCH_MANAGER" || code === "SENIOR_MANAGER") return "Senior Branch Manager";
    if (/tech(nician)?\s*manager/i.test(title) || code === "TECHNICIAN_MANAGER") return "Tech Manager";
    if (/branch\s*manager/i.test(title) || tier === "manager" || code === "BRANCH_MANAGER") return "Branch Manager";
    return "Technician";
  };
  /** Rank within CURRENT_TECHNICIANS_ORDER (higher = outranks), or null if this employee isn't in that canonical group. */
  const currentTechniciansRank = (e: Employee): number | null => {
    const label = currentTechniciansLabel(e);
    if (label === null) return null;
    const idx = CURRENT_TECHNICIANS_ORDER.indexOf(label);
    return idx === -1 ? null : CURRENT_TECHNICIANS_ORDER.length - idx;
  };
  // Tech Support gets the same role-tier sub-grouping as Current
  // Technicians — a manager there is titled "Manager" on the Leaders
  // roster, but the group header should read "Technical Manager" (their
  // real title in this department), not the department name itself.
  const TECH_SUPPORT_ORDER = ["Technical Director", "Technical Manager", "Technician"];
  const techSupportLabel = (e: Employee): string | null => {
    if (resolveMasterListDepartment(e) !== "Tech Support") return null;
    const tier = leadersTierByName.get(e.name);
    const title = (leadersTitleByName.get(e.name) || "").toLowerCase();
    const code = normalizeRole(e.position);
    if (/^technical director$/i.test(title) || code === "TECHNICAL_DIRECTOR") return "Technical Director";
    if (/manager/i.test(title) || tier === "manager" || code.includes("MANAGER")) return "Technical Manager";
    return "Technician";
  };
  const techSupportRank = (e: Employee): number | null => {
    const label = techSupportLabel(e);
    if (label === null) return null;
    const idx = TECH_SUPPORT_ORDER.indexOf(label);
    return idx === -1 ? null : TECH_SUPPORT_ORDER.length - idx;
  };
  // Parts Manager and Parts — no longer split by branch (was earlier),
  // now one merged group sorted by this hierarchy instead, same shape as
  // Current Technicians/Tech Support.
  const PARTS_ORDER = ["Senior Manager", "Assistant Manager", "Parts Manager", "Team Leader Parts", "Parts"];
  const partsLabel = (e: Employee): string | null => {
    if (resolveMasterListDepartment(e) !== "Parts Manager and Parts") return null;
    const tier = leadersTierByName.get(e.name);
    const title = (leadersTitleByName.get(e.name) || "").toLowerCase();
    const code = normalizeRole(e.position);
    if (/senior\s*manager/i.test(title) || tier === "senior") return "Senior Manager";
    if (/assistant\s*manager/i.test(title)) return "Assistant Manager";
    if (/team\s*leader/i.test(title) || code === "PARTS_TEAM_LEADER") return "Team Leader Parts";
    if (/parts\s*manager/i.test(title) || code === "PARTS_MANAGER" || tier === "manager") return "Parts Manager";
    return "Parts";
  };
  const partsRank = (e: Employee): number | null => {
    const label = partsLabel(e);
    if (label === null) return null;
    const idx = PARTS_ORDER.indexOf(label);
    return idx === -1 ? null : PARTS_ORDER.length - idx;
  };
  /** Rough seniority ranking for the Department table's default sort — highest first. */
  const positionRank = (e: Employee): number => {
    const hrRank = hrAccountingCsrRank(e);
    if (hrRank !== null) return hrRank;
    const techRank = currentTechniciansRank(e);
    if (techRank !== null) return techRank;
    const tsRank = techSupportRank(e);
    if (tsRank !== null) return tsRank;
    const pRank = partsRank(e);
    if (pRank !== null) return pRank;
    const tier = leadersTierByName.get(e.name);
    if (tier === "senior") return 5;
    if (tier === "manager") return 4;
    const code = normalizeRole(e.position);
    if (code.includes("DIRECTOR")) return 5;
    if (code.includes("SENIOR_MANAGER") || code === "ADMIN" || code === "SUPERADMIN") return 5;
    if (code.includes("MANAGER")) return 4;
    if (code.includes("TEAM_LEADER")) return 3;
    if (code.includes("DISPATCHER")) return 2;
    return 1;
  };
  const resolveMasterListDepartment = (e: Employee): string => {
    // IT as a secondary role always surfaces someone under "BizOps and IT"
    // — they still keep their real primary department/position everywhere
    // else, this only affects which Master List group they're grouped
    // under, so IT can see everyone who actually helps with IT work.
    if (e.extraRoles.some((r) => (r || "").toUpperCase() === "IT")) {
      return "BizOps and IT";
    }
    const raw = e.department?.trim();
    const resolved =
      raw ||
      leadersDeptByName.get(e.name) ||
      getRoleDepartmentBreakdown(e.position).department ||
      MASTER_LIST_UNASSIGNED;
    // Same 6-group collapse as the Leaders tab (shared senior manager) —
    // see canonicalDepartmentGroup's own comment for why.
    return resolved === MASTER_LIST_UNASSIGNED ? resolved : canonicalDepartmentGroup(resolved);
  };

  /** True if `dept` is either this person's real/primary department or one they've been explicitly duplicated onto (see extraDepartments). */
  const matchesMasterListTab = (e: Employee, dept: string): boolean =>
    resolveMasterListDepartment(e) === dept || e.extraDepartments.includes(dept);

  const masterListDepartments = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) {
      set.add(resolveMasterListDepartment(e));
      for (const d of e.extraDepartments) set.add(d);
    }
    // Executive (leadership) sits right after "All", ahead of every other
    // tab — everything else stays alphabetical.
    return Array.from(set).sort((a, b) => {
      if (a === "Executive") return -1;
      if (b === "Executive") return 1;
      return a.localeCompare(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, leadersDeptByName]);

  const masterListFiltered = useMemo(() => {
    let result = employees;
    if (masterListDept !== "__all__") {
      result = result.filter((e) => matchesMasterListTab(e, masterListDept));
    }
    const q = masterListSearch.trim().toLowerCase();
    if (q) {
      result = result.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.branch.toLowerCase().includes(q) ||
        (ROLE_LABELS[normalizeRole(e.position)] ?? e.position ?? "").toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => positionRank(b) - positionRank(a) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, masterListDept, masterListSearch, leadersDeptByName, leadersTierByName]);

  // ── Leaders — a hand-maintained, drag-to-reorder roster (migration 0153),
  // NOT derived from profiles.role — several of these titles ("Assistant
  // Manager", "Senior Director", "Tech Manager ATL") aren't real role codes
  // in this app, so there's no reliable way to derive them. See
  // leadersRoster.ts / the Leaders tab render block below for the rest.
  const [leadersRosterLoading, setLeadersRosterLoading] = useState(false);
  const loadLeadersRoster = async () => {
    setLeadersRosterLoading(true);
    try {
      setLeadersRoster(await getLeadersRoster());
    } catch (err) {
      console.error("Failed to load Leaders roster:", err);
    } finally {
      setLeadersRosterLoading(false);
    }
  };
  useEffect(() => {
    void loadLeadersRoster();
  }, []);

  // Grouped by canonicalDepartmentGroup (e.g. "Parts Manager" + "Parts
  // Order" both land under "Parts Manager and Parts"), not the raw
  // department each row actually stores — sorted by (deptSort, rowSort) so
  // a merged card still shows each original department's rows together in
  // their own order, rather than interleaved by coincidence of rowSort.
  const leadersByDepartment = useMemo(() => {
    const groups = new Map<string, LeadersRosterRow[]>();
    for (const row of leadersRoster) {
      const key = canonicalDepartmentGroup(row.department);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    for (const list of groups.values()) list.sort((a, b) => (a.deptSort - b.deptSort) || (a.rowSort - b.rowSort));
    return Array.from(groups.entries()).sort(
      ([, aRows], [, bRows]) => Math.min(...aRows.map((r) => r.deptSort)) - Math.min(...bRows.map((r) => r.deptSort)),
    );
  }, [leadersRoster]);

  const leadersRowNodes = useRef(new Map<string, HTMLDivElement>());
  const setLeadersRowRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) leadersRowNodes.current.set(id, el);
    else leadersRowNodes.current.delete(id);
  };
  // Card-level fallback drop target — lets a row drop into a department
  // whose rows don't fill the card (or a card with zero rows), by hit
  // testing the card's own bounds when the pointer isn't over any row.
  const leadersCardNodes = useRef(new Map<string, HTMLDivElement>());
  const setLeadersCardRef = (department: string) => (el: HTMLDivElement | null) => {
    if (el) leadersCardNodes.current.set(department, el);
    else leadersCardNodes.current.delete(department);
  };
  const [leadersDraggingId, setLeadersDraggingId] = useState<string | null>(null);

  /**
   * Cards are arranged in a responsive multi-column grid, so a single
   * vertical-list Y-comparison (the CustomFormBuilder.tsx convention) can't
   * tell which COLUMN a drop landed in. Instead this hit-tests the actual
   * drop point (still without @dnd-kit's own droppable/collision system,
   * which — confirmed elsewhere in this app — never populates `over`
   * reliably): first against every row's own rect, falling back to each
   * card's rect so dropping into empty space within a card still works.
   */
  const findLeadersDropTarget = (x: number, y: number): { department: string; beforeRowId: string | null } | null => {
    for (const [id, el] of leadersRowNodes.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const row = leadersRoster.find((r) => r.id === id);
        if (!row) continue;
        const before = y < rect.top + rect.height / 2;
        if (before) return { department: row.department, beforeRowId: id };
        // After this row — find whatever comes next in the same department (or end of it).
        const deptRows = leadersByDepartment.find(([d]) => d === row.department)?.[1] ?? [];
        const idx = deptRows.findIndex((r) => r.id === id);
        return { department: row.department, beforeRowId: deptRows[idx + 1]?.id ?? null };
      }
    }
    for (const [department, el] of leadersCardNodes.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { department, beforeRowId: null };
      }
    }
    return null;
  };

  const handleLeadersDragEnd = (event: DragEndEvent) => {
    setLeadersDraggingId(null);
    const activatorEvent = event.activatorEvent as PointerEvent | MouseEvent | undefined;
    if (!activatorEvent || !("clientX" in activatorEvent)) return;
    const x = activatorEvent.clientX + event.delta.x;
    const y = activatorEvent.clientY + event.delta.y;
    const drop = findLeadersDropTarget(x, y);
    if (!drop) return;
    const activeId = String(event.active.id);

    setLeadersRoster((prev) => {
      const moving = prev.find((r) => r.id === activeId);
      if (!moving) return prev;
      const deptRows = (leadersByDepartment.find(([d]) => d === drop.department)?.[1] ?? []).filter((r) => r.id !== activeId);
      let insertIdx = drop.beforeRowId === null ? deptRows.length : deptRows.findIndex((r) => r.id === drop.beforeRowId);
      if (insertIdx === -1) insertIdx = deptRows.length;
      const prevRow = deptRows[insertIdx - 1];
      const nextRow = deptRows[insertIdx];
      const deptSort = prevRow?.deptSort ?? nextRow?.deptSort ?? moving.deptSort;
      const prevRowSort = prevRow?.rowSort ?? 0;
      const nextRowSort = nextRow?.rowSort ?? prevRowSort + 2;
      const rowSort = (prevRowSort + nextRowSort) / 2;
      const updated: LeadersRosterRow = { ...moving, department: drop.department, deptSort, rowSort };

      void moveLeadersRosterRow(moving.id, { department: drop.department, deptSort, rowSort }).catch((err) => {
        console.error("Failed to save Leaders reorder:", err);
      });

      return prev.map((r) => (r.id === activeId ? updated : r));
    });
  };

  const updateLeadersRow = async (id: string, patch: Partial<Pick<LeadersRosterRow, "roleTitle" | "personName" | "tier" | "reportsTo">>) => {
    const row = leadersRoster.find((r) => r.id === id);
    if (!row) return;
    const updated = { ...row, ...patch };
    setLeadersRoster((prev) => prev.map((r) => (r.id === id ? updated : r)));
    try {
      await upsertLeadersRosterRow({
        id: updated.id,
        department: updated.department,
        roleTitle: updated.roleTitle,
        personName: updated.personName,
        tier: updated.tier,
        deptSort: updated.deptSort,
        rowSort: updated.rowSort,
        reportsTo: updated.reportsTo,
      });
    } catch (err) {
      console.error("Failed to save Leaders row:", err);
      setLeadersRoster((prev) => prev.map((r) => (r.id === id ? row : r)));
    }
  };

  const addLeadersRow = async (department: string, deptSort: number) => {
    const rowsInDept = leadersRoster.filter((r) => r.department === department);
    const rowSort = (rowsInDept.length ? Math.max(...rowsInDept.map((r) => r.rowSort)) : 0) + 1;
    try {
      const id = await upsertLeadersRosterRow({
        department, roleTitle: "Team Leader", personName: "New Person", tier: "standard", deptSort, rowSort,
      });
      setLeadersRoster((prev) => [...prev, { id, department, roleTitle: "Team Leader", personName: "New Person", tier: "standard", deptSort, rowSort, reportsTo: null }]);
    } catch (err) {
      alert(`Failed to add row: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  /** Clones an existing row's title/tier/reportsTo, inserted right after it, so adding another person in the same role (e.g. another branch's manager) is just typing their name — no need to re-pick title/tier/reports-to from scratch. */
  const duplicateLeadersRow = async (sourceId: string) => {
    const source = leadersRoster.find((r) => r.id === sourceId);
    if (!source) return;
    const rowSort = source.rowSort + 0.001;
    try {
      const id = await upsertLeadersRosterRow({
        department: source.department,
        roleTitle: source.roleTitle,
        personName: "New Person",
        tier: source.tier,
        deptSort: source.deptSort,
        rowSort,
        reportsTo: source.reportsTo,
      });
      setLeadersRoster((prev) => [
        ...prev,
        { id, department: source.department, roleTitle: source.roleTitle, personName: "New Person", tier: source.tier, deptSort: source.deptSort, rowSort, reportsTo: source.reportsTo },
      ]);
    } catch (err) {
      alert(`Failed to duplicate row: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const addLeadersDepartment = async () => {
    const name = prompt("New department name:")?.trim();
    if (!name) return;
    if (leadersByDepartment.some(([d]) => d.toLowerCase() === name.toLowerCase())) {
      alert("A department with that name already exists.");
      return;
    }
    const deptSort = (leadersByDepartment.length ? Math.max(...leadersByDepartment.map(([, rows]) => rows[0]?.deptSort ?? 0)) : 0) + 1;
    await addLeadersRow(name, deptSort);
  };

  const deleteLeadersRow = async (id: string) => {
    if (!confirm("Remove this person from the Leaders roster?")) return;
    const row = leadersRoster.find((r) => r.id === id);
    setLeadersRoster((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteLeadersRosterRow(id);
    } catch (err) {
      console.error("Failed to delete Leaders row:", err);
      if (row) setLeadersRoster((prev) => [...prev, row]);
    }
  };

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
    // Automated Forms (COE, Warning Form, tax forms, Jotform docs) is
    // AH Solutions-only for now — other companies don't use these forms.
    ...(companyId === "COMP001" ? [{
      group: "Automated Forms",
      icon: Paperclip,
      tabs: [
        ...(canViewJotformTab ? [{ key: "jotformDocuments", label: "Applicant Documents", count: newJotformSubmissionsCount, icon: Forward }] as const : []),
        { key: "customForms", label: "Custom Forms", count: newCustomFormSubmissionsCount, icon: FileText },
        { key: "coe", label: "Certificate of Employment", count: 0, icon: CheckCircle },
        { key: "warningForm", label: "Employee Warning Form", count: 0, icon: FileText },
        { key: "promotionForm", label: "Employee Promotion / Role Change", count: 0, icon: FileText },
        { key: "actionPlanForm", label: "Manager's Action Plan Form", count: 0, icon: FileText },
        { key: "terminationForm", label: "Termination Notice Form", count: 0, icon: FileText },
        { key: "w8ben", label: "W-8 / W-9 / W-4 Forms", count: 0, icon: Landmark },
      ] as const,
    }] : []),
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
        { key: "masterList", label: "Master List", count: employees.length, icon: Users },
        { key: "leaders", label: "Leaders", count: leadersRoster.length, icon: UserCheck },
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
                {section.group === "People Operations" && (
                  <Link
                    to="/m/$module/$submodule"
                    params={{ module: "admin", submodule: "user-management" }}
                    onClick={() => setSidebarOpen(false)}
                    className="w-full text-left pl-2.5 pr-2 py-2 rounded-lg text-sm flex items-center gap-2 border border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                    title="Jump to the Admin module's User Management page"
                  >
                    <span className="flex items-center justify-center h-6 w-6 rounded-md shrink-0 bg-white/5 text-muted-foreground">
                      <UserCheck className="h-3.5 w-3.5" />
                    </span>
                    User Management
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <main className="flex-1 max-w-[1900px] mx-auto w-full px-3 py-4">
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
        <button
          type="button"
          onClick={() => setShowActivityLog(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm text-muted-foreground hover:text-foreground"
        >
          <History className="h-4 w-4" /> Activity Log
        </button>
      </div>

      {showActivityLog && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowActivityLog(false)}
        >
          <div
            className="bg-slate-950 border border-white/10 rounded-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end px-3 pt-3">
              <button onClick={() => setShowActivityLog(false)} className="text-slate-400 hover:text-white transition p-1">
                ✕
              </button>
            </div>
            <div className="px-3 pb-3 overflow-y-auto">
              <HrActivityLogPanel />
            </div>
          </div>
        </div>
      )}

      {/* ── KPI overview — every tile is clickable, same as Attendance: it jumps straight to the tab/filter that explains the number instead of just displaying it. ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
        {[
          { label: "Candidates", value: kpi.candidates, color: "text-blue-300", icon: <Users className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter(""); } },
          { label: "Scheduled for Interview", value: kpi.scheduled, color: "text-yellow-300", icon: <Clock className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter("interviewing"); } },
          { label: "Rejected", value: kpi.rejected, color: "text-red-300", icon: <XCircle className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter("rejected"); } },
          { label: "Hired", value: kpi.hired, color: "text-green-300", icon: <UserCheck className="h-4 w-4" />, onClick: () => { setActiveTab("hiring"); setHiringStatusFilter("hired"); } },
          { label: "Terminated", value: kpi.terminated, color: "text-red-400", icon: <UserX className="h-4 w-4" />, onClick: () => setActiveTab("masterList") },
          { label: "Resigned", value: kpi.resigned, color: "text-slate-300", icon: <UserMinus className="h-4 w-4" />, onClick: () => setActiveTab("masterList") },
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
      {/* z-30 on the wrapper itself (not just the z-20 dropdown inside it) —
          the tab content below (e.g. the W-8BEN panel) uses backdrop-filter,
          which creates its own stacking context and, without this, paints
          over the open dropdown regardless of the dropdown's own z-index. */}
      <div className="mb-4 border-b border-white/10 pb-3 relative z-30">
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
                      {section.group === "People Operations" && (
                        <Link
                          to="/m/$module/$submodule"
                          params={{ module: "admin", submodule: "user-management" }}
                          onClick={() => setOpenCategory(null)}
                          className="w-full text-left px-3.5 py-2 text-sm flex items-center gap-2 border-t border-white/10 mt-1 pt-2 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                          title="Jump to the Admin module's User Management page"
                        >
                          <UserCheck className="h-3.5 w-3.5" /> User Management
                        </Link>
                      )}
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
          <ResponsiveContainer width="100%" height={260} debounce={200}>
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

      {/* ── Master List — Employee Directory's same roster, split into
          department sub-tabs instead of one flat table. ── */}
      {activeTab === "masterList" && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex flex-wrap justify-between items-center gap-3">
          <h2 className="font-semibold text-sm">Master List</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={masterListSearch}
              onChange={(e) => setMasterListSearch(e.target.value)}
              placeholder="Name, email, branch, or position…"
              className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
            />
          </div>
        </div>

        {/* Department sub-tabs — generated from whatever department values are actually on file (falling back to a Leaders-roster or role match before landing in Unassigned — see resolveMasterListDepartment). */}
        <div className="px-4 pt-3 border-b border-white/10 flex gap-1 overflow-x-auto">
          <button
            onClick={() => setMasterListDept("__all__")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 whitespace-nowrap transition ${
              masterListDept === "__all__"
                ? "border-blue-500 text-blue-300 bg-white/5"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({employees.length})
          </button>
          {masterListDepartments.map((dept) => {
            const count = employees.filter((e) => matchesMasterListTab(e, dept)).length;
            return (
              <button
                key={dept}
                onClick={() => setMasterListDept(dept)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 whitespace-nowrap transition ${
                  masterListDept === dept
                    ? "border-blue-500 text-blue-300 bg-white/5"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {dept} ({count})
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2 border-b border-white/10 bg-white/5 text-xs text-muted-foreground">
          {masterListFiltered.length} of {employees.length} employees
        </div>

        {(() => {
          // Parts is the one department that's organized by branch, not by
          // a manager/team-leader hierarchy — each branch has its own Parts
          // person (or none, if a technician covers it there), so a Branch
          // column + branch-grouped rows matches how HR actually tracks it,
          // unlike every other department tab.
          const showBranchColumn = masterListDept === "Parts Manager and Parts";
          const colCount = showBranchColumn ? 15 : 14;
          return (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {showBranchColumn && <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Branch</th>}
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Status</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Editable — writes the employee's hire date">Start Date</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Name</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Editable — writes profiles.phone_number">Phone</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Address</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Department</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Position</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Editable — writes profiles.required_check_in / required_check_out, the Required Schedule shown on the employee's own My Profile page">Hours of Work</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Editable — writes profiles.working_hours, a plain total distinct from the Required Schedule range">Total Work Hours</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Editable — writes profiles.meal_minutes, the other half of My Profile's Working Hours & Meal Time field">Meal Time</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Sick Leave is its own allowance, separate from vacation — flat 5 days/year, available from day 1">Sick Leave</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Remaining / Allowance">Vacation Leave</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Employment Status</th>
                <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {masterListFiltered.length === 0 ? (
                <tr><td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground text-xs">{employeesLoading ? "Loading employees…" : "No employees match this view."}</td></tr>
              ) : (() => {
                // Active first, everyone else (inactive/terminated/resigned)
                // grouped separately below its own divider — so a
                // no-longer-active person never reads as if they're still
                // part of the active headcount just because they're mixed
                // into the same block.
                const activeRows = masterListFiltered.filter((e) => e.status === "active");
                const inactiveRows = masterListFiltered.filter((e) => e.status !== "active");
                // Within each active/inactive block: group by the person's
                // specific department (same value shown in the Department
                // column), and inside each department group, sort by
                // hierarchy — Senior Manager down to standard — instead of
                // one flat alphabetical-by-name list.
                const groupByDepartment = (rows: Employee[]) => {
                  const byDept = new Map<string, Employee[]>();
                  for (const e of rows) {
                    const masterDept = resolveMasterListDepartment(e);
                    const dept = masterDept === "HR, Accounting and CSR"
                      ? (hrAccountingCsrLabel(e) ?? masterDept)
                      : masterDept === "Current Technicians"
                      ? (currentTechniciansLabel(e) ?? masterDept)
                      : masterDept === "Tech Support"
                      ? (techSupportLabel(e) ?? masterDept)
                      : masterDept === "Parts Manager and Parts"
                      ? (partsLabel(e) ?? masterDept)
                      : resolveSpecificDepartment(e);
                    if (!byDept.has(dept)) byDept.set(dept, []);
                    byDept.get(dept)!.push(e);
                  }
                  const tierGroupIndex = (name: string): number => {
                    for (const order of [HR_ACCOUNTING_CSR_ORDER, CURRENT_TECHNICIANS_ORDER, TECH_SUPPORT_ORDER, PARTS_ORDER]) {
                      const idx = order.indexOf(name);
                      if (idx !== -1) return idx;
                    }
                    return -1;
                  };
                  return Array.from(byDept.entries())
                    .sort(([a], [b]) => {
                      // Current Technicians', Tech Support's, and Parts'
                      // tier containers sort by rank (most senior first),
                      // not alphabetically — every other department's
                      // groups stay alphabetical.
                      const ai = tierGroupIndex(a);
                      const bi = tierGroupIndex(b);
                      if (ai !== -1 && bi !== -1) return ai - bi;
                      return a.localeCompare(b);
                    })
                    .map(([department, deptRows]) => ({
                      department,
                      rows: [...deptRows].sort((a, b) => positionRank(b) - positionRank(a) || a.name.localeCompare(b.name)),
                    }));
                };
                const renderRow = (employee: Employee) => {
                  const pto = remainingPtoByProfile.get(employee.id);
                  const sick = remainingSickByProfile.get(employee.id);
                  const warnings = approvedWarningCountByProfile.get(employee.id) ?? 0;
                  return (
                    <tr key={employee.id} className="border-b border-white/5 hover:bg-white/5">
                      {showBranchColumn && <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{employee.branch || "—"}</td>}
                      <td className="px-2 py-1">
                        <select
                          value={employee.status}
                          onChange={(e) => handleUpdateEmployeeStatus(employee.id, e.target.value as EmploymentStatus)}
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border-0 ${
                            employee.status === "active" ? "bg-emerald-500/20 text-emerald-300" :
                            employee.status === "terminated" ? "bg-red-500/20 text-red-300" :
                            employee.status === "resigned" ? "bg-slate-500/20 text-slate-300" :
                            "bg-yellow-500/20 text-yellow-300"
                          }`}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="terminated">Terminated</option>
                          <option value="resigned">Resigned</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="date"
                          defaultValue={employee.startDate || ""}
                          onBlur={(e) => {
                            const v = e.target.value;
                            if (v !== employee.startDate) void handleUpdateStartDate(employee.id, v);
                          }}
                          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-[110px]"
                        />
                      </td>
                      <td className="px-2 py-1 font-medium whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void openMasterListDetail(employee)}
                          className="text-left text-blue-300/90 hover:text-blue-300 hover:underline transition cursor-pointer"
                          title={`View ${employee.name}'s details`}
                        >
                          {employee.name}
                        </button>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          defaultValue={employee.phone || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (employee.phone || "")) void handleUpdatePhone(employee.id, v);
                          }}
                          placeholder="—"
                          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-[110px]"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          defaultValue={employee.address || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (employee.address || "")) void handleUpdateAddress(employee.id, v);
                          }}
                          title={employee.address || ""}
                          placeholder="—"
                          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-[110px]"
                        />
                      </td>
                      <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            {resolveMasterListDepartment(employee) === "Current Technicians" ? (
                              <span>{employee.branch || "—"}</span>
                            ) : (
                              <select
                                value={resolveMasterListDepartment(employee)}
                                onChange={(e) => void handleUpdateEmployeeDepartment(employee.id, e.target.value)}
                                title="Move this person to a different department"
                                className="glass-input text-[11px] py-0.5 px-1 rounded-md w-32"
                              >
                                {!MASTER_LIST_DEPARTMENT_OPTIONS.includes(resolveMasterListDepartment(employee)) && (
                                  <option value={resolveMasterListDepartment(employee)}>{resolveMasterListDepartment(employee)}</option>
                                )}
                                {MASTER_LIST_DEPARTMENT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                              </select>
                            )}
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) handleAddExtraDepartment(employee.id, e.target.value);
                                e.target.value = "";
                              }}
                              title="Send a duplicate of this person onto another department tab too — keeps their real department above unchanged"
                              className="glass-input text-[10px] py-0.5 px-0.5 rounded-md w-6 text-center"
                            >
                              <option value="">+</option>
                              {MASTER_LIST_DEPARTMENT_OPTIONS.filter(
                                (d) => d !== resolveMasterListDepartment(employee) && !employee.extraDepartments.includes(d),
                              ).map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                          {employee.extraDepartments.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {employee.extraDepartments.map((d) => (
                                <span key={d} className="inline-flex items-center gap-1 bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded text-[10px]" title={`Also shown under ${d}`}>
                                  {d}
                                  <button type="button" onClick={() => handleRemoveExtraDepartment(employee.id, d)} className="hover:text-red-300" title="Stop showing under this department">
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-muted-foreground max-w-[110px] truncate" title={resolveMasterListPosition(employee)}>{resolveMasterListPosition(employee)}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="time"
                            defaultValue={employee.requiredCheckIn?.slice(0, 5) || ""}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v && v !== employee.requiredCheckIn?.slice(0, 5)) void handleUpdateSchedule(employee.id, "requiredCheckIn", v);
                            }}
                            className="glass-input text-[11px] py-0.5 px-1 rounded-md w-[78px]"
                          />
                          <span className="text-muted-foreground">–</span>
                          <input
                            type="time"
                            defaultValue={employee.requiredCheckOut?.slice(0, 5) || ""}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v && v !== employee.requiredCheckOut?.slice(0, 5)) void handleUpdateSchedule(employee.id, "requiredCheckOut", v);
                            }}
                            className="glass-input text-[11px] py-0.5 px-1 rounded-md w-[78px]"
                          />
                          <select
                            value={employee.scheduleTimezone}
                            onChange={(e) => void handleUpdateSchedule(employee.id, "scheduleTimezone", e.target.value)}
                            title="Which timezone these hours are in"
                            className="glass-input text-[11px] py-0.5 px-0.5 rounded-md w-[54px]"
                          >
                            <option value="CST">CST</option>
                            <option value="EST">EST</option>
                          </select>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          defaultValue={employee.workingHours ?? ""}
                          placeholder="—"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const parsed = v === "" ? null : Number(v);
                            if (parsed !== employee.workingHours) void handleUpdateWorkingHours(employee.id, Number.isFinite(parsed as number) ? parsed : null);
                          }}
                          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-14"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={0}
                          step={5}
                          defaultValue={employee.mealMinutes ?? ""}
                          placeholder="—"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const parsed = v === "" ? null : Number(v);
                            if (parsed !== employee.mealMinutes) void handleUpdateMealMinutes(employee.id, Number.isFinite(parsed as number) ? parsed : null);
                          }}
                          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-14"
                        />
                      </td>
                      <td className="px-2 py-1">
                        {!sick ? (
                          <span className="text-muted-foreground text-[10px]">—</span>
                        ) : (
                          <span className="bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded text-[10px] font-semibold" title="Remaining / Allowance">
                            {sick.remaining}/{sick.allowance}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {!pto ? (
                          <span className="text-muted-foreground text-[10px]" title="Not yet eligible — PTO starts after 1 year of tenure.">—</span>
                        ) : (
                          <span className="bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded text-[10px] font-semibold">{pto.remaining}/{pto.allowance}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={employee.employmentType}
                          onChange={(e) => void handleUpdateEmploymentType(employee.id, e.target.value as "trainee" | "regular")}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded border-0 bg-slate-700 text-slate-100"
                        >
                          <option value="regular">Regular</option>
                          <option value="trainee">Trainee</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        {warnings > 0 ? <span className="bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded text-[10px] font-semibold">{warnings}</span> : <span className="text-muted-foreground text-[10px]">—</span>}
                      </td>
                    </tr>
                  );
                };
                const renderDepartmentGroups = (rows: Employee[]) =>
                  groupByDepartment(rows).map(({ department, rows: deptRows }) => (
                    <Fragment key={department}>
                      <tr>
                        <td colSpan={colCount} className="px-3 py-1 bg-blue-500/10 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                          {department} ({deptRows.length})
                        </td>
                      </tr>
                      {deptRows.map(renderRow)}
                    </Fragment>
                  ));
                return (
                  <>
                    {renderDepartmentGroups(activeRows)}
                    {inactiveRows.length > 0 && (
                      <tr>
                        <td colSpan={colCount} className="px-3 py-1.5 bg-white/5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Not Active ({inactiveRows.length}) — inactive, terminated, or resigned
                        </td>
                      </tr>
                    )}
                    {renderDepartmentGroups(inactiveRows)}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
          );
        })()}
      </div>
      )}

      {/* ── Leaders — hand-maintained, drag-to-reorder roster (0153). ── */}
      {activeTab === "leaders" && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="font-semibold text-sm">Leaders</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drag a row's grip to reorder within a department or drop it into another one.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{leadersRoster.length} leaders</span>
            {isHrOrAdmin && (
              <button onClick={() => void addLeadersDepartment()} className="btn text-xs px-3 py-1.5 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Add Department
              </button>
            )}
          </div>
        </div>
        <div className="p-5 bg-slate-950/30">
          {leadersByDepartment.length === 0 ? (
            <div className="px-3 py-6 text-center text-muted-foreground text-xs">
              {leadersRosterLoading ? "Loading…" : "No leaders on file yet."}
            </div>
          ) : (
            <DndContext
              onDragStart={(e) => setLeadersDraggingId(String(e.active.id))}
              onDragEnd={handleLeadersDragEnd}
              onDragCancel={() => setLeadersDraggingId(null)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {leadersByDepartment.map(([department, rows]) => (
                  <div
                    key={department}
                    ref={setLeadersCardRef(department)}
                    className="flex flex-col rounded-xl border border-white/10 bg-gradient-to-b from-slate-800/70 to-slate-900/80 shadow-lg shadow-black/30 ring-1 ring-white/5 hover:border-white/20 transition-colors overflow-hidden"
                  >
                    <div className="bg-gradient-to-r from-blue-600/25 via-blue-600/10 to-transparent border-b border-white/10 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-white uppercase tracking-wide truncate">{department}</span>
                        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-slate-300">{rows.length}</span>
                      </div>
                      {isHrOrAdmin && (
                        <button onClick={() => void addLeadersRow(department, rows[0]?.deptSort ?? 0)} className="shrink-0 text-blue-300 hover:text-blue-200 text-xs font-medium flex items-center gap-1">
                          <Plus className="h-3 w-3" /> Add
                        </button>
                      )}
                    </div>
                    <div className="flex-1 divide-y divide-white/5">
                      {(() => {
                        const tree = buildLeadersTree(rows);
                        // Only actually nested (some row's reportsTo resolved to
                        // another row here) if roots are fewer than the total —
                        // otherwise every row is a root and this is identical to
                        // a flat list, just rendered through the same code path.
                        return tree.map((node) => (
                          <LeaderTreeBranch
                            key={node.row.id}
                            node={node}
                            depth={0}
                            canEdit={isHrOrAdmin}
                            leadersDraggingId={leadersDraggingId}
                            deptPeople={rows.map((r) => r.personName)}
                            setLeadersRowRef={setLeadersRowRef}
                            onUpdate={(id, patch) => void updateLeadersRow(id, patch)}
                            onDelete={(id) => void deleteLeadersRow(id)}
                            onDuplicate={(id) => void duplicateLeadersRow(id)}
                          />
                        ));
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </DndContext>
          )}
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

      {/* ── Custom Forms — the in-house Form Maker, runs alongside Jotform ── */}
      {activeTab === "customForms" && <CustomFormsPanel />}

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
                const canManagerAct = r.managerStatus === "pending" && canReviewPtoStage(r, "manager", myProfileId, myRole, myExtraRoles);
                const canHrAct = r.hrStatus === "pending" && canReviewPtoStage(r, "hr", myProfileId, myRole, myExtraRoles);
                const canAccountingAct = r.accountingStatus === "pending" && canReviewPtoStage(r, "accounting", myProfileId, myRole, myExtraRoles);
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
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            r.accountingStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                            : r.accountingStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                            : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                          }`}>
                            Accounting: {r.accountingStatus.charAt(0).toUpperCase() + r.accountingStatus.slice(1)}
                            {r.accountingReviewedBy ? ` — ${profileName(r.accountingReviewedBy)}` : ""}
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
                        {canAccountingAct && (
                          <div className="flex gap-1">
                            <button type="button" onClick={() => handlePtoStageAction(r, "accounting", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve (Acct)</button>
                            <button type="button" onClick={() => handlePtoStageAction(r, "accounting", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                          </div>
                        )}
                        {!canManagerAct && !canHrAct && !canAccountingAct && <span className="text-xs text-muted-foreground">{r.managerStatus === "pending" ? "Awaiting manager" : "Awaiting HR/Accounting"}</span>}
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
              {pendingCorrections.map((r) => {
                const canCorrManagerAct = r.managerStatus === "pending" && canReviewCorrectionStage(r, "manager", myProfileId, myRole, myExtraRoles);
                const canCorrHrAct = r.hrStatus === "pending" && canReviewCorrectionStage(r, "hr", myProfileId, myRole, myExtraRoles);
                const canCorrAccountingAct = r.accountingStatus === "pending" && canReviewCorrectionStage(r, "accounting", myProfileId, myRole, myExtraRoles);
                return (
                <div key={r.id} className="border border-white/10 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
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
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        r.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                        : r.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                        : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                      }`}>
                        Manager: {r.managerStatus.charAt(0).toUpperCase() + r.managerStatus.slice(1)}
                      </span>
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        r.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                        : r.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                        : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                      }`}>
                        HR: {r.hrStatus.charAt(0).toUpperCase() + r.hrStatus.slice(1)}
                      </span>
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        r.accountingStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                        : r.accountingStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                        : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                      }`}>
                        Accounting: {r.accountingStatus.charAt(0).toUpperCase() + r.accountingStatus.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {canCorrManagerAct && (
                      <div className="flex gap-1">
                        <button type="button" onClick={() => handleCorrectionStageAction(r, "manager", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve (Mgr)</button>
                        <button type="button" onClick={() => handleCorrectionStageAction(r, "manager", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                      </div>
                    )}
                    {canCorrHrAct && (
                      <div className="flex gap-1">
                        <button type="button" onClick={() => handleCorrectionStageAction(r, "hr", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve (HR)</button>
                        <button type="button" onClick={() => handleCorrectionStageAction(r, "hr", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                      </div>
                    )}
                    {canCorrAccountingAct && (
                      <div className="flex gap-1">
                        <button type="button" onClick={() => handleCorrectionStageAction(r, "accounting", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition">Approve (Acct)</button>
                        <button type="button" onClick={() => handleCorrectionStageAction(r, "accounting", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition">Reject</button>
                      </div>
                    )}
                    {!canCorrManagerAct && !canCorrHrAct && !canCorrAccountingAct && (
                      <span className="text-xs text-muted-foreground">{r.managerStatus === "pending" ? "Awaiting manager" : "Awaiting HR/Accounting"}</span>
                    )}
                  </div>
                  </div>
                </div>
                );
              })}
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
            <button
              type="button"
              onClick={() => { setAddColumnGroup(onboardingGroup); setNewColumnLabel(""); setAddColumnError(null); }}
              className="btn text-xs px-3 py-1.5 h-7.5 flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add Column
            </button>
          </div>
        </div>

        <div>
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-1.5 py-2 text-left text-[10px] text-muted-foreground uppercase w-[9%]">Name</th>
                <th className="px-1.5 py-2 text-left text-[10px] text-muted-foreground uppercase w-[7%]">{onboardingGroup === "PH" ? "Dept." : "Branch"}</th>
                {onboardingDocColumns.map((doc) => {
                  const customCol = customOnboardingColumns.find((c) => c.groupKey === onboardingGroup && c.label === doc);
                  return (
                    <th key={doc} className="px-1 py-2 text-center text-[9px] leading-tight text-muted-foreground uppercase break-words">
                      {doc}
                      {customCol && (
                        <button
                          type="button"
                          onClick={() => void handleRemoveOnboardingColumn(customCol)}
                          title="Remove this column"
                          className="ml-1 text-muted-foreground hover:text-red-300 normal-case"
                        >
                          ×
                        </button>
                      )}
                    </th>
                  );
                })}
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

      {/* Add Column dialog — new document category for the group open when the button was clicked, works exactly like the built-in columns once saved (free-text category, matched the same way on the checklist grid and the per-employee Documents page). */}
      {addColumnGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setAddColumnGroup(null)}>
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Add Column</h3>
            <p className="text-sm text-muted-foreground mb-4">
              New document column for{" "}
              <span className="font-semibold text-white">
                {addColumnGroup === "PH" ? "Philippines" : addColumnGroup === "TECHNICIAN" ? "Technician" : "Parts Manager"}
              </span>
              . It works exactly like the others — upload or link a file for it from each employee's Documents page.
            </p>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Document Name</label>
            <input
              type="text"
              value={newColumnLabel}
              onChange={(e) => setNewColumnLabel(e.target.value)}
              placeholder="e.g. Background Check"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void handleAddOnboardingColumn(); }}
              className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1 mb-3"
            />
            {addColumnError && <p className="text-xs text-red-300 mb-3">{addColumnError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAddColumnGroup(null)} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={() => void handleAddOnboardingColumn()}
                disabled={!newColumnLabel.trim() || addColumnSaving}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {addColumnSaving ? "Adding…" : "Add"}
              </button>
            </div>
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
            {!warnForm.employeeId && warnForm.employeeName.trim() && (
              <p className="text-[10px] text-yellow-400/80 mt-0.5">No matching AHS employee — you can still continue, but this won't count toward anyone's official warning record once confirmed.</p>
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
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Previous Warning(s) Issued (auto-filled)</p>
              <button
                type="button"
                onClick={() => { setAddPrevWarnOpen((v) => !v); setAddPrevWarnError(null); }}
                className="text-[10px] font-semibold text-blue-400 hover:text-blue-300"
              >
                {addPrevWarnOpen ? "Cancel" : "+ Add previous warning"}
              </button>
            </div>
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
            {addPrevWarnOpen && (
              <div className="mt-2 p-3 rounded-md border border-white/10 bg-white/[0.03] space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  For a warning issued before this system existed (paper form, verbal, etc.) — logs it as an approved record on this employee's file with its real date.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-2 items-start">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date it happened</label>
                    <input
                      type="date"
                      value={addPrevWarnDate}
                      max={todayStr}
                      onChange={(e) => setAddPrevWarnDate(e.target.value)}
                      className="glass-input text-sm py-1.5 px-3 rounded-md"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reason</label>
                    <input
                      type="text"
                      value={addPrevWarnReason}
                      onChange={(e) => setAddPrevWarnReason(e.target.value)}
                      placeholder="e.g. Excessive tardiness — 3 unexcused lates in June"
                      className="glass-input text-sm py-1.5 px-3 rounded-md"
                    />
                  </div>
                </div>
                {addPrevWarnError && <p className="text-xs text-red-400">{addPrevWarnError}</p>}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddPreviousWarning}
                    disabled={addPrevWarnSaving}
                    className="btn text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {addPrevWarnSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-4 border-t border-white/10 flex justify-end">
          <button
            onClick={handleOpenWarnPreview}
            disabled={warnGenerating || !warnForm.employeeName.trim()}
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
                      <td className="px-4 py-3 text-muted-foreground">
                        {recipient?.name ?? doc.recipientName ?? "—"} <span className="text-[10px] uppercase">({doc.recipientSlot.replace("_", " ")}{!doc.recipientId ? " · external" : ""})</span>
                      </td>
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
                          {doc.status === "pending_signature" && (
                            <button type="button" onClick={() => handleCopyWarningFormLink(doc)} className="btn text-[10px] px-2 py-1">
                              Copy Link
                            </button>
                          )}
                          {(doc.status === "pending_signature" || doc.status === "signed") && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { setReassignDialog(doc); setReassignRecipientId(""); setReassignRecipientSearch(""); setReassignSlot(doc.recipientSlot as SignatureSlot); setReassignMode("teammate"); setReassignExternalName(""); setReassignSentLink(null); }}
                                className="btn text-[10px] px-2 py-1 disabled:opacity-50"
                              >
                                {doc.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}
                              </button>
                              {doc.status === "signed" && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleConfirmWarningForm(doc)}
                                  className="btn text-[10px] px-2 py-1 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                                >
                                  Confirm Warning
                                </button>
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

      {/* ── Generate Employee Promotion / Role Change Form ── */}
      {activeTab === "promotionForm" && (
      <>
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Generate Employee Promotion / Role Change Form</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Fill in the fields below. Sending logs the form and routes it through however many signers it needs — it comes back to you automatically once fully signed.</p>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Name</label>
            <input
              type="text"
              value={promoForm.employeeName}
              onChange={(e) => { updatePromoField("employeeName", e.target.value); updatePromoField("employeeId", ""); setPromoEmployeeDropdownOpen(true); }}
              onFocus={() => setPromoEmployeeDropdownOpen(true)}
              onBlur={() => setTimeout(() => setPromoEmployeeDropdownOpen(false), 150)}
              placeholder="Search an employee…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {promoEmployeeDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredPromoEmployeeOptions(promoForm.employeeName).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching employees.</p>
                ) : (
                  filteredPromoEmployeeOptions(promoForm.employeeName).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => selectPromoEmployee(e)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${promoForm.employeeId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Current Position</label>
            <input type="text" value={promoForm.currentPosition} onChange={(e) => updatePromoField("currentPosition", e.target.value)} placeholder="Auto-fills from employee" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Department/Branch</label>
            <input type="text" value={promoForm.department} onChange={(e) => updatePromoField("department", e.target.value)} placeholder="Auto-fills from employee" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date of Hire</label>
            <input type="date" value={promoForm.dateOfHire} onChange={(e) => updatePromoField("dateOfHire", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
        </div>

        <div className="px-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Role Change Details</label>
            <div className="flex flex-col gap-1.5">
              {([
                ["promotion", "Promotion"],
                ["positionTitleChange", "Position Title Change"],
                ["departmentTransfer", "Department Transfer"],
                ["technicianTierRaise", "Technician Tier Raise"],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => toggleRoleChangeType(key)} className="flex items-center gap-1.5 text-sm text-left">
                  <span className="text-base">{promoForm.roleChangeType[key] ? "☑" : "☐"}</span> {label}
                </button>
              ))}
              <button type="button" onClick={() => toggleRoleChangeType("other")} className="flex items-center gap-1.5 text-sm text-left">
                <span className="text-base">{promoForm.roleChangeType.other ? "☑" : "☐"}</span> Other:
              </button>
              {promoForm.roleChangeType.other && (
                <input
                  type="text"
                  value={promoForm.roleChangeType.otherText}
                  onChange={(e) => setPromoForm((prev) => ({ ...prev, roleChangeType: { ...prev.roleChangeType, otherText: e.target.value } }))}
                  placeholder="Specify…"
                  className="glass-input text-sm py-1.5 px-3 rounded-md"
                />
              )}
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">New Position Title</label>
              <input type="text" value={promoForm.newPositionTitle} onChange={(e) => updatePromoField("newPositionTitle", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">New Department/Branch</label>
              <input type="text" value={promoForm.newDepartment} onChange={(e) => updatePromoField("newDepartment", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Effective Date</label>
              <input type="date" value={promoForm.effectiveDate} onChange={(e) => updatePromoField("effectiveDate", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Performance &amp; Qualification Summary (For Direct Manager)</label>
            <div className="flex flex-col gap-1.5">
              {([
                ["meetsExpectations", "Meets performance expectations"],
                ["exceedsExpectations", "Exceeds performance expectations"],
                ["leadershipDemonstrated", "Leadership capability demonstrated"],
                ["trainingCompleted", "Required training completed"],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => togglePerformance(key)} className="flex items-center gap-1.5 text-sm text-left">
                  <span className="text-base">{promoForm.performance[key] ? "☑" : "☐"}</span> {label}
                </button>
              ))}
              <button type="button" onClick={() => togglePerformance("other")} className="flex items-center gap-1.5 text-sm text-left">
                <span className="text-base">{promoForm.performance.other ? "☑" : "☐"}</span> Other justification:
              </button>
              {promoForm.performance.other && (
                <input
                  type="text"
                  value={promoForm.performance.otherText}
                  onChange={(e) => setPromoForm((prev) => ({ ...prev, performance: { ...prev.performance, otherText: e.target.value } }))}
                  placeholder="Specify…"
                  className="glass-input text-sm py-1.5 px-3 rounded-md"
                />
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-4 border-t border-white/10 flex justify-end mt-4">
          <button
            onClick={handleOpenPromoPreview}
            disabled={promoGenerating || !promoForm.employeeName.trim()}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {promoGenerating ? "Loading…" : "Preview & Send"}
          </button>
        </div>
      </div>

      {/* ── Sent Promotion Forms tracking ── */}
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Sent Promotion Forms</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Track signature status. Confirming finalizes the record as signed; cancelling voids it. Document-only — nothing here changes the employee's profile automatically.</p>
        </div>
        {promoActionError && (
          <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{promoActionError}</p>
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
              {sentPromotionForms.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No promotion forms sent yet.</td></tr>
              ) : (
                sentPromotionForms.map((doc) => {
                  const data = doc.formData as unknown as PromotionFormData;
                  const recipient = employees.find((e) => e.id === doc.recipientId);
                  const busy = promoActionBusyId === doc.id;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">
                        <button type="button" onClick={() => handleViewPromoForm(doc)} className="text-blue-300 hover:text-blue-200 hover:underline text-left">
                          {data.employeeName}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.createdByName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {recipient?.name ?? doc.recipientName ?? "—"} <span className="text-[10px] uppercase">({doc.recipientSlot.replace("_", " ")}{!doc.recipientId ? " · external" : ""})</span>
                      </td>
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
                          {doc.status === "pending_signature" && (
                            <button type="button" onClick={() => handleCopyPromotionFormLink(doc)} className="btn text-[10px] px-2 py-1">
                              Copy Link
                            </button>
                          )}
                          {(doc.status === "pending_signature" || doc.status === "signed") && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { setPromoReassignDialog(doc); setPromoReassignRecipientId(""); setPromoReassignRecipientSearch(""); setPromoReassignSlot(doc.recipientSlot as PromotionSignatureSlot); setPromoReassignMode("teammate"); setPromoReassignExternalName(""); setPromoReassignSentLink(null); }}
                                className="btn text-[10px] px-2 py-1 disabled:opacity-50"
                              >
                                {doc.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}
                              </button>
                              {doc.status === "signed" && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleConfirmPromotionForm(doc)}
                                  className="btn text-[10px] px-2 py-1 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                                >
                                  Confirm
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleCancelPromotionForm(doc)}
                                className="btn text-[10px] px-2 py-1 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {doc.status === "confirmed" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCancelPromotionForm(doc)}
                              className="btn text-[10px] px-2 py-1 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50"
                            >
                              Revert
                            </button>
                          )}
                          {doc.pdfUrl && (
                            <button
                              type="button"
                              onClick={() => handleDownloadPromoFormPdf(doc)}
                              className="text-blue-300 hover:text-blue-200 underline text-xs"
                            >
                              Download PDF
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeletePromotionForm(doc)}
                            title="Permanently delete this promotion form"
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

      {/* ── Generate 4th Warning — Manager's Action Plan Form ── */}
      {activeTab === "actionPlanForm" && (
      <>
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Generate Manager's Action Plan Form</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Fill in the employee's identifying details and pick the Manager to route it to. The Manager fills in the actual action plan themselves when they open it to sign — it comes back to you automatically once fully signed.</p>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Name</label>
            <input
              type="text"
              value={actionPlanForm.employeeName}
              onChange={(e) => { updateActionPlanField("employeeName", e.target.value); updateActionPlanField("employeeId", ""); setActionPlanEmployeeDropdownOpen(true); }}
              onFocus={() => setActionPlanEmployeeDropdownOpen(true)}
              onBlur={() => setTimeout(() => setActionPlanEmployeeDropdownOpen(false), 150)}
              placeholder="Search an employee…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {actionPlanEmployeeDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredActionPlanEmployeeOptions(actionPlanForm.employeeName).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching employees.</p>
                ) : (
                  filteredActionPlanEmployeeOptions(actionPlanForm.employeeName).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => selectActionPlanEmployee(e)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${actionPlanForm.employeeId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
            <input type="text" value={actionPlanForm.branch} onChange={(e) => updateActionPlanField("branch", e.target.value)} placeholder="Auto-fills from employee" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Position</label>
            <input type="text" value={actionPlanForm.position} onChange={(e) => updateActionPlanField("position", e.target.value)} placeholder="Auto-fills from employee" className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
            <input type="date" value={actionPlanForm.date} onChange={(e) => updateActionPlanField("date", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
        </div>

        <div className="px-4 py-4 border-t border-white/10 flex justify-end mt-4">
          <button
            onClick={handleOpenActionPlanPreview}
            disabled={actionPlanGenerating || !actionPlanForm.employeeName.trim()}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {actionPlanGenerating ? "Loading…" : "Preview & Send"}
          </button>
        </div>
      </div>

      {/* ── Sent Action Plan Forms tracking ── */}
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Sent Action Plan Forms</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Track signature status. Confirming finalizes the record as signed; cancelling voids it. Document-only — nothing here changes the employee's warning record automatically.</p>
        </div>
        {actionPlanActionError && (
          <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{actionPlanActionError}</p>
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
              {sentActionPlanForms.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No action plan forms sent yet.</td></tr>
              ) : (
                sentActionPlanForms.map((doc) => {
                  const data = doc.formData as unknown as ActionPlanFormData;
                  const recipient = employees.find((e) => e.id === doc.recipientId);
                  const busy = actionPlanActionBusyId === doc.id;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">
                        <button type="button" onClick={() => handleViewActionPlanForm(doc)} className="text-blue-300 hover:text-blue-200 hover:underline text-left">
                          {data.employeeName}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.createdByName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {recipient?.name ?? doc.recipientName ?? "—"} <span className="text-[10px] uppercase">({doc.recipientSlot.replace("_", " ")}{!doc.recipientId ? " · external" : ""})</span>
                      </td>
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
                          {doc.status === "pending_signature" && (
                            <button type="button" onClick={() => handleCopyActionPlanFormLink(doc)} className="btn text-[10px] px-2 py-1">
                              Copy Link
                            </button>
                          )}
                          {(doc.status === "pending_signature" || doc.status === "signed") && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { setActionPlanReassignDialog(doc); setActionPlanReassignRecipientId(""); setActionPlanReassignRecipientSearch(""); setActionPlanReassignSlot(doc.recipientSlot as ActionPlanSignatureSlot); setActionPlanReassignMode("teammate"); setActionPlanReassignExternalName(""); setActionPlanReassignSentLink(null); }}
                                className="btn text-[10px] px-2 py-1 disabled:opacity-50"
                              >
                                {doc.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}
                              </button>
                              {doc.status === "signed" && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleConfirmActionPlanForm(doc)}
                                  className="btn text-[10px] px-2 py-1 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                                >
                                  Confirm
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleCancelActionPlanForm(doc)}
                                className="btn text-[10px] px-2 py-1 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {doc.status === "confirmed" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCancelActionPlanForm(doc)}
                              className="btn text-[10px] px-2 py-1 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50"
                            >
                              Revert
                            </button>
                          )}
                          {doc.pdfUrl && (
                            <button
                              type="button"
                              onClick={() => handleDownloadActionPlanFormPdf(doc)}
                              className="text-blue-300 hover:text-blue-200 underline text-xs"
                            >
                              Download PDF
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteActionPlanForm(doc)}
                            title="Permanently delete this action plan form"
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

      {/* ── Generate Notice of Termination Form ── */}
      {activeTab === "terminationForm" && (
      <>
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Generate Notice of Termination</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Fill in the fields below. Sending logs the notice and routes it through however many signers it needs to acknowledge receipt — it comes back to you automatically once fully signed.</p>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Name</label>
            <input
              type="text"
              value={terminationForm.employeeName}
              onChange={(e) => { updateTerminationField("employeeName", e.target.value); updateTerminationField("employeeId", ""); setTerminationEmployeeDropdownOpen(true); }}
              onFocus={() => setTerminationEmployeeDropdownOpen(true)}
              onBlur={() => setTimeout(() => setTerminationEmployeeDropdownOpen(false), 150)}
              placeholder="Search an employee…"
              className="glass-input text-sm py-1.5 px-3 rounded-md"
            />
            {terminationEmployeeDropdownOpen && (
              <div className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                {filteredTerminationEmployeeOptions(terminationForm.employeeName).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching employees.</p>
                ) : (
                  filteredTerminationEmployeeOptions(terminationForm.employeeName).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => selectTerminationEmployee(e)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${terminationForm.employeeId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                    >
                      {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Effective Date</label>
            <input type="date" value={terminationForm.effectiveDate} onChange={(e) => updateTerminationField("effectiveDate", e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reason for Termination</label>
            <textarea value={terminationForm.reason} onChange={(e) => updateTerminationField("reason", e.target.value)} rows={4} placeholder="Detailed reason…" className="glass-input text-sm py-1.5 px-3 rounded-md resize-y" />
          </div>
        </div>

        <div className="px-4 py-4 border-t border-white/10 flex justify-end">
          <button
            onClick={handleOpenTerminationPreview}
            disabled={terminationGenerating || !terminationForm.employeeName.trim()}
            className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {terminationGenerating ? "Loading…" : "Preview & Send"}
          </button>
        </div>
      </div>

      {/* ── Sent Termination Forms tracking ── */}
      <div className="panel p-0 overflow-hidden mt-4">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Sent Termination Forms</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Track signature status. Confirming finalizes the record as signed; cancelling voids it. Document-only — nothing here changes the employee's Status automatically.</p>
        </div>
        {terminationActionError && (
          <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{terminationActionError}</p>
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
              {sentTerminationForms.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No termination forms sent yet.</td></tr>
              ) : (
                sentTerminationForms.map((doc) => {
                  const data = doc.formData as unknown as TerminationFormData;
                  const recipient = employees.find((e) => e.id === doc.recipientId);
                  const busy = terminationActionBusyId === doc.id;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">
                        <button type="button" onClick={() => handleViewTerminationForm(doc)} className="text-blue-300 hover:text-blue-200 hover:underline text-left">
                          {data.employeeName}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.createdByName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {recipient?.name ?? doc.recipientName ?? "—"} <span className="text-[10px] uppercase">({doc.recipientSlot.replace("_", " ")}{!doc.recipientId ? " · external" : ""})</span>
                      </td>
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
                          {doc.status === "pending_signature" && (
                            <button type="button" onClick={() => handleCopyTerminationFormLink(doc)} className="btn text-[10px] px-2 py-1">
                              Copy Link
                            </button>
                          )}
                          {(doc.status === "pending_signature" || doc.status === "signed") && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { setTerminationReassignDialog(doc); setTerminationReassignRecipientId(""); setTerminationReassignRecipientSearch(""); setTerminationReassignSlot(doc.recipientSlot as TerminationSignatureSlot); setTerminationReassignMode("teammate"); setTerminationReassignExternalName(""); setTerminationReassignSentLink(null); }}
                                className="btn text-[10px] px-2 py-1 disabled:opacity-50"
                              >
                                {doc.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}
                              </button>
                              {doc.status === "signed" && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleConfirmTerminationForm(doc)}
                                  className="btn text-[10px] px-2 py-1 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                                >
                                  Confirm
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleCancelTerminationForm(doc)}
                                className="btn text-[10px] px-2 py-1 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {doc.status === "confirmed" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCancelTerminationForm(doc)}
                              className="btn text-[10px] px-2 py-1 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50"
                            >
                              Revert
                            </button>
                          )}
                          {doc.pdfUrl && (
                            <button
                              type="button"
                              onClick={() => handleDownloadTerminationFormPdf(doc)}
                              className="text-blue-300 hover:text-blue-200 underline text-xs"
                            >
                              Download PDF
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteTerminationForm(doc)}
                            title="Permanently delete this termination form"
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

      {/* Reassign the recipient — either redirecting a not-yet-signed document to the right person (e.g. it was sent to the wrong teammate), or forwarding an already-signed one to the next stage in the chain. */}
      {reassignDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            {reassignSentLink ? (
              <>
                <h3 className="text-lg font-bold mb-2">Link Generated</h3>
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 mb-3">
                  <p className="text-sm font-semibold text-green-300">Reassigned to {reassignExternalName}</p>
                  <p className="text-xs text-muted-foreground mt-1">No AHS account needed — copy this link and send it any way you like.</p>
                </div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                <div className="flex gap-2 mt-1 mb-4">
                  <input type="text" readOnly value={reassignSentLink} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                  <button onClick={handleCopyReassignSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{reassignSentLinkCopied ? "Copied!" : "Copy"}</button>
                </div>
                <div className="flex justify-end">
                  <button onClick={handleCloseReassignDialog} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Done</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold mb-2">{reassignDialog.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {reassignDialog.status === "signed" ? "Forward" : "Redirect"} <span className="font-semibold text-white">{(reassignDialog.formData as unknown as WarningFormData).employeeName}</span>'s warning form to another signer.
                </p>

                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit mb-3">
                  <button type="button" onClick={() => setReassignMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${reassignMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setReassignMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${reassignMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {reassignMode === "teammate" ? (
                  <>
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
                  </>
                ) : (
                  <div className="mb-3">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={reassignExternalName}
                      onChange={(e) => setReassignExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                  </div>
                )}

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
                  <button onClick={handleCloseReassignDialog} className="btn text-sm px-4 py-2">Cancel</button>
                  <button
                    onClick={handleSendToNextRecipient}
                    disabled={(reassignMode === "teammate" ? !reassignRecipientId : !reassignExternalName.trim()) || warnActionBusyId === reassignDialog.id}
                    className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {warnActionBusyId === reassignDialog.id ? (reassignMode === "teammate" ? "Sending…" : "Generating…") : (reassignMode === "teammate" ? "Send" : "Generate Link")}
                  </button>
                </div>
              </>
            )}
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
              <button onClick={handleCloseWarnPreview} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
                <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: warningFormStyles }} />
                  <div
                    dangerouslySetInnerHTML={{
                      __html: buildWarningFormBodyMarkup(
                        buildWarnFormData(warnRecipientSlot, warnSendMode === "external" ? warnExternalName : employees.find((e) => e.id === warnRecipientId)?.name || ""),
                        warnLogoDataUrl,
                        {}
                      ),
                    }}
                  />
                </div>
              </div>

              {warnSentLink ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5">
                    <p className="text-sm font-semibold text-green-300">Sent to {warnSentLink.recipientName}</p>
                    <p className="text-xs text-muted-foreground mt-1">They've also been notified in AHS Messages. Copy the link below to send it any other way too — email, Slack, text — so they can open it and fill in their signature.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                    <div className="flex gap-2 mt-1">
                      <input type="text" readOnly value={warnSentLink.link} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                      <button onClick={handleCopyWarnSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{warnSentLinkCopied ? "Copied!" : "Copy"}</button>
                    </div>
                  </div>
                  <button onClick={handleCloseWarnPreview} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-auto">Done</button>
                </div>
              ) : (
              <div className="flex flex-col gap-3">
                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit">
                  <button type="button" onClick={() => setWarnSendMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${warnSendMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setWarnSendMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${warnSendMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {warnSendMode === "teammate" ? (
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
                ) : (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={warnExternalName}
                      onChange={(e) => setWarnExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">No AHS account needed — you'll get a link to send them any way you like (email, Slack, text), and they can open it and sign without logging in.</p>
                  </div>
                )}

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
                  {warnSendMode === "teammate" ? (
                    <button
                      onClick={handleSendWarningForm}
                      disabled={!warnRecipientId || warnSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {warnSending ? "Sending…" : "Send for Signature"}
                    </button>
                  ) : (
                    <button
                      onClick={handleGenerateExternalWarningLink}
                      disabled={!warnExternalName.trim() || warnSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {warnSending ? "Generating…" : "Generate Link"}
                    </button>
                  )}
                  <button onClick={handleDownloadWarningForm} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download PDF instead
                  </button>
                  <button onClick={handleDownloadWarningFormWord} disabled={warnDocxGenerating} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    <Download className="h-3.5 w-3.5" /> {warnDocxGenerating ? "Generating…" : "Download as Word Document"}
                  </button>
                  <button onClick={handleCloseWarnPreview} className="btn text-sm px-4 py-2">Cancel</button>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reassign the recipient for a Promotion Form — either redirecting a not-yet-signed document, or forwarding an already-signed one to the next stage in the chain. */}
      {promoReassignDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            {promoReassignSentLink ? (
              <>
                <h3 className="text-lg font-bold mb-2">Link Generated</h3>
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 mb-3">
                  <p className="text-sm font-semibold text-green-300">Reassigned to {promoReassignExternalName}</p>
                  <p className="text-xs text-muted-foreground mt-1">No AHS account needed — copy this link and send it any way you like.</p>
                </div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                <div className="flex gap-2 mt-1 mb-4">
                  <input type="text" readOnly value={promoReassignSentLink} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                  <button onClick={handleCopyPromoReassignSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{promoReassignSentLinkCopied ? "Copied!" : "Copy"}</button>
                </div>
                <div className="flex justify-end">
                  <button onClick={handleClosePromoReassignDialog} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Done</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold mb-2">{promoReassignDialog.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {promoReassignDialog.status === "signed" ? "Forward" : "Redirect"} <span className="font-semibold text-white">{(promoReassignDialog.formData as unknown as PromotionFormData).employeeName}</span>'s promotion form to another signer.
                </p>

                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit mb-3">
                  <button type="button" onClick={() => setPromoReassignMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${promoReassignMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setPromoReassignMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${promoReassignMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {promoReassignMode === "teammate" ? (
                  <>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                    <div className="relative mt-1 mb-3">
                      <input
                        type="text"
                        value={promoReassignRecipientSearch}
                        onChange={(e) => { setPromoReassignRecipientSearch(e.target.value); setPromoReassignRecipientId(""); setPromoReassignRecipientDropdownOpen(true); }}
                        onFocus={() => setPromoReassignRecipientDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setPromoReassignRecipientDropdownOpen(false), 150)}
                        placeholder="Search a teammate…"
                        className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                      />
                      {promoReassignRecipientDropdownOpen && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                          {filteredPromoReassignRecipients.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                          ) : (
                            filteredPromoReassignRecipients.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => {
                                  setPromoReassignRecipientId(e.id);
                                  setPromoReassignRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                  setPromoReassignRecipientDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${promoReassignRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                              >
                                {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mb-3">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={promoReassignExternalName}
                      onChange={(e) => setPromoReassignExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                  </div>
                )}

                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                <select value={promoReassignSlot} onChange={(e) => setPromoReassignSlot(e.target.value as PromotionSignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1 mb-4">
                  <option value="manager">Direct Manager</option>
                  <option value="senior_manager">Senior Manager</option>
                  <option value="hr_staff">HR</option>
                  <option value="executive">Executive</option>
                  <option value="employee">Employee</option>
                </select>
                {promoActionError && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{promoActionError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button onClick={handleClosePromoReassignDialog} className="btn text-sm px-4 py-2">Cancel</button>
                  <button
                    onClick={handleSendPromoToNextRecipient}
                    disabled={(promoReassignMode === "teammate" ? !promoReassignRecipientId : !promoReassignExternalName.trim()) || promoActionBusyId === promoReassignDialog.id}
                    className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {promoActionBusyId === promoReassignDialog.id ? (promoReassignMode === "teammate" ? "Sending…" : "Generating…") : (promoReassignMode === "teammate" ? "Send" : "Generate Link")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sent Promotion Forms — view-only preview of the form as it stands right now (whatever signatures exist so far) */}
      {promoViewDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-6xl h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-bold">{(promoViewDoc.formData as unknown as PromotionFormData).employeeName} — Promotion / Role Change Form</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Issued by {promoViewDoc.createdByName ?? "—"}</p>
              </div>
              <button onClick={() => setPromoViewDoc(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-white/5 flex justify-center">
              <div style={{ transform: "scale(0.85)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: promotionFormStyles }} />
                <div
                  dangerouslySetInnerHTML={{
                    __html: buildPromotionFormBodyMarkup(promoViewDoc.formData as unknown as PromotionFormData, promoLogoDataUrl, promoViewDoc.signatures),
                  }}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
              {promoViewDoc.pdfUrl && (
                <a href={promoViewDoc.pdfUrl} target="_blank" rel="noreferrer noopener" className="btn text-sm px-4 py-2">Open PDF</a>
              )}
              <button onClick={() => setPromoViewDoc(null)} className="btn text-sm px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Promotion / Role Change Form — preview, pick who signs which line, send for signature */}
      {promoPreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Employee Promotion / Role Change Form — Preview</h3>
              <button onClick={handleClosePromoPreview} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
                <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: promotionFormStyles }} />
                  <div
                    dangerouslySetInnerHTML={{
                      __html: buildPromotionFormBodyMarkup(
                        buildPromoFormData(promoRecipientSlot, promoSendMode === "external" ? promoExternalName : employees.find((e) => e.id === promoRecipientId)?.name || ""),
                        promoLogoDataUrl,
                        {}
                      ),
                    }}
                  />
                </div>
              </div>

              {promoSentLink ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5">
                    <p className="text-sm font-semibold text-green-300">Sent to {promoSentLink.recipientName}</p>
                    <p className="text-xs text-muted-foreground mt-1">They've also been notified in AHS Messages. Copy the link below to send it any other way too — email, Slack, text — so they can open it and fill in their signature.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                    <div className="flex gap-2 mt-1">
                      <input type="text" readOnly value={promoSentLink.link} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                      <button onClick={handleCopyPromoSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{promoSentLinkCopied ? "Copied!" : "Copy"}</button>
                    </div>
                  </div>
                  <button onClick={handleClosePromoPreview} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-auto">Done</button>
                </div>
              ) : (
              <div className="flex flex-col gap-3">
                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit">
                  <button type="button" onClick={() => setPromoSendMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${promoSendMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setPromoSendMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${promoSendMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {promoSendMode === "teammate" ? (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                    <div className="relative mt-1">
                      <input
                        type="text"
                        value={promoRecipientSearch}
                        onChange={(e) => {
                          setPromoRecipientSearch(e.target.value);
                          setPromoRecipientId("");
                          setPromoRecipientDropdownOpen(true);
                        }}
                        onFocus={() => setPromoRecipientDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setPromoRecipientDropdownOpen(false), 150)}
                        placeholder="Search a teammate…"
                        className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                      />
                      {promoRecipientDropdownOpen && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                          {filteredPromoRecipients.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                          ) : (
                            filteredPromoRecipients.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => {
                                  setPromoRecipientId(e.id);
                                  setPromoRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                  setPromoRecipientDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${promoRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                              >
                                {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={promoExternalName}
                      onChange={(e) => setPromoExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">No AHS account needed — you'll get a link to send them any way you like (email, Slack, text), and they can open it and sign without logging in.</p>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                  <select value={promoRecipientSlot} onChange={(e) => setPromoRecipientSlot(e.target.value as PromotionSignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1">
                    <option value="manager">Direct Manager</option>
                    <option value="senior_manager">Senior Manager</option>
                    <option value="hr_staff">HR</option>
                    <option value="executive">Executive</option>
                    <option value="employee">Employee</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2 mt-auto">
                  {promoSendError && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{promoSendError}</p>
                  )}
                  {promoSendMode === "teammate" ? (
                    <button
                      onClick={handleSendPromotionForm}
                      disabled={!promoRecipientId || promoSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {promoSending ? "Sending…" : "Send for Signature"}
                    </button>
                  ) : (
                    <button
                      onClick={handleGenerateExternalPromotionLink}
                      disabled={!promoExternalName.trim() || promoSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {promoSending ? "Generating…" : "Generate Link"}
                    </button>
                  )}
                  <button onClick={handleDownloadPromoForm} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download PDF instead
                  </button>
                  <button onClick={handleDownloadPromoFormWord} disabled={promoDocxGenerating} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    <Download className="h-3.5 w-3.5" /> {promoDocxGenerating ? "Generating…" : "Download as Word Document"}
                  </button>
                  <button onClick={handleClosePromoPreview} className="btn text-sm px-4 py-2">Cancel</button>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reassign the recipient for an Action Plan Form — either redirecting a not-yet-signed document, or forwarding an already-signed one to the next stage in the chain. */}
      {actionPlanReassignDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            {actionPlanReassignSentLink ? (
              <>
                <h3 className="text-lg font-bold mb-2">Link Generated</h3>
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 mb-3">
                  <p className="text-sm font-semibold text-green-300">Reassigned to {actionPlanReassignExternalName}</p>
                  <p className="text-xs text-muted-foreground mt-1">No AHS account needed — copy this link and send it any way you like.</p>
                </div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                <div className="flex gap-2 mt-1 mb-4">
                  <input type="text" readOnly value={actionPlanReassignSentLink} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                  <button onClick={handleCopyActionPlanReassignSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{actionPlanReassignSentLinkCopied ? "Copied!" : "Copy"}</button>
                </div>
                <div className="flex justify-end">
                  <button onClick={handleCloseActionPlanReassignDialog} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Done</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold mb-2">{actionPlanReassignDialog.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {actionPlanReassignDialog.status === "signed" ? "Forward" : "Redirect"} <span className="font-semibold text-white">{(actionPlanReassignDialog.formData as unknown as ActionPlanFormData).employeeName}</span>'s action plan form to another signer.
                </p>

                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit mb-3">
                  <button type="button" onClick={() => setActionPlanReassignMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${actionPlanReassignMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setActionPlanReassignMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${actionPlanReassignMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {actionPlanReassignMode === "teammate" ? (
                  <>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                    <div className="relative mt-1 mb-3">
                      <input
                        type="text"
                        value={actionPlanReassignRecipientSearch}
                        onChange={(e) => { setActionPlanReassignRecipientSearch(e.target.value); setActionPlanReassignRecipientId(""); setActionPlanReassignRecipientDropdownOpen(true); }}
                        onFocus={() => setActionPlanReassignRecipientDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setActionPlanReassignRecipientDropdownOpen(false), 150)}
                        placeholder="Search a teammate…"
                        className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                      />
                      {actionPlanReassignRecipientDropdownOpen && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                          {filteredActionPlanReassignRecipients.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                          ) : (
                            filteredActionPlanReassignRecipients.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => {
                                  setActionPlanReassignRecipientId(e.id);
                                  setActionPlanReassignRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                  setActionPlanReassignRecipientDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${actionPlanReassignRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                              >
                                {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mb-3">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={actionPlanReassignExternalName}
                      onChange={(e) => setActionPlanReassignExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                  </div>
                )}

                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                <select value={actionPlanReassignSlot} onChange={(e) => setActionPlanReassignSlot(e.target.value as ActionPlanSignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1 mb-4">
                  <option value="manager">Manager</option>
                  <option value="senior_manager">Senior Manager</option>
                  <option value="hr_staff">HR/Management</option>
                </select>
                {actionPlanActionError && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{actionPlanActionError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button onClick={handleCloseActionPlanReassignDialog} className="btn text-sm px-4 py-2">Cancel</button>
                  <button
                    onClick={handleSendActionPlanToNextRecipient}
                    disabled={(actionPlanReassignMode === "teammate" ? !actionPlanReassignRecipientId : !actionPlanReassignExternalName.trim()) || actionPlanActionBusyId === actionPlanReassignDialog.id}
                    className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {actionPlanActionBusyId === actionPlanReassignDialog.id ? (actionPlanReassignMode === "teammate" ? "Sending…" : "Generating…") : (actionPlanReassignMode === "teammate" ? "Send" : "Generate Link")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sent Action Plan Forms — view-only preview of the form as it stands right now (whatever content/signatures exist so far) */}
      {actionPlanViewDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-6xl h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-bold">{(actionPlanViewDoc.formData as unknown as ActionPlanFormData).employeeName} — Manager's Action Plan Form</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Issued by {actionPlanViewDoc.createdByName ?? "—"}</p>
              </div>
              <button onClick={() => setActionPlanViewDoc(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-white/5 flex justify-center">
              <div style={{ transform: "scale(0.85)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: actionPlanFormStyles }} />
                <div
                  dangerouslySetInnerHTML={{
                    __html: buildActionPlanFormBodyMarkup(actionPlanViewDoc.formData as unknown as ActionPlanFormData, actionPlanImages.logo, actionPlanImages.ribbon, actionPlanImages.footer, actionPlanViewDoc.signatures),
                  }}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
              {actionPlanViewDoc.pdfUrl && (
                <a href={actionPlanViewDoc.pdfUrl} target="_blank" rel="noreferrer noopener" className="btn text-sm px-4 py-2">Open PDF</a>
              )}
              <button onClick={() => setActionPlanViewDoc(null)} className="btn text-sm px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Manager's Action Plan Form — preview, pick who signs which line, send for signature */}
      {actionPlanPreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Manager's Action Plan Form — Preview</h3>
              <button onClick={handleCloseActionPlanPreview} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
                <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: actionPlanFormStyles }} />
                  <div
                    dangerouslySetInnerHTML={{
                      __html: buildActionPlanFormBodyMarkup(
                        buildActionPlanFormData(actionPlanRecipientSlot, actionPlanSendMode === "external" ? actionPlanExternalName : employees.find((e) => e.id === actionPlanRecipientId)?.name || ""),
                        actionPlanImages.logo,
                        actionPlanImages.ribbon,
                        actionPlanImages.footer,
                        {}
                      ),
                    }}
                  />
                </div>
              </div>

              {actionPlanSentLink ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5">
                    <p className="text-sm font-semibold text-green-300">Sent to {actionPlanSentLink.recipientName}</p>
                    <p className="text-xs text-muted-foreground mt-1">They've also been notified in AHS Messages. Copy the link below to send it any other way too — email, Slack, text — so they can open it, fill in the plan, and sign.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                    <div className="flex gap-2 mt-1">
                      <input type="text" readOnly value={actionPlanSentLink.link} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                      <button onClick={handleCopyActionPlanSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{actionPlanSentLinkCopied ? "Copied!" : "Copy"}</button>
                    </div>
                  </div>
                  <button onClick={handleCloseActionPlanPreview} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-auto">Done</button>
                </div>
              ) : (
              <div className="flex flex-col gap-3">
                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit">
                  <button type="button" onClick={() => setActionPlanSendMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${actionPlanSendMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setActionPlanSendMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${actionPlanSendMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {actionPlanSendMode === "teammate" ? (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                    <div className="relative mt-1">
                      <input
                        type="text"
                        value={actionPlanRecipientSearch}
                        onChange={(e) => {
                          setActionPlanRecipientSearch(e.target.value);
                          setActionPlanRecipientId("");
                          setActionPlanRecipientDropdownOpen(true);
                        }}
                        onFocus={() => setActionPlanRecipientDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setActionPlanRecipientDropdownOpen(false), 150)}
                        placeholder="Search a teammate…"
                        className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                      />
                      {actionPlanRecipientDropdownOpen && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                          {filteredActionPlanRecipients.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                          ) : (
                            filteredActionPlanRecipients.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => {
                                  setActionPlanRecipientId(e.id);
                                  setActionPlanRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                  setActionPlanRecipientDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${actionPlanRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                              >
                                {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={actionPlanExternalName}
                      onChange={(e) => setActionPlanExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">No AHS account needed — you'll get a link to send them any way you like (email, Slack, text), and they can open it, fill in the plan, and sign without logging in.</p>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                  <select value={actionPlanRecipientSlot} onChange={(e) => setActionPlanRecipientSlot(e.target.value as ActionPlanSignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1">
                    <option value="manager">Manager</option>
                    <option value="senior_manager">Senior Manager</option>
                    <option value="hr_staff">HR/Management</option>
                  </select>
                  {actionPlanRecipientSlot === "manager" && (
                    <p className="text-[10px] text-muted-foreground mt-1">The Manager slot is the one who fills in the actual coaching/monitoring/consequences plan — send this one first.</p>
                  )}
                </div>

                <div className="flex flex-col gap-2 mt-auto">
                  {actionPlanSendError && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{actionPlanSendError}</p>
                  )}
                  {actionPlanSendMode === "teammate" ? (
                    <button
                      onClick={handleSendActionPlanForm}
                      disabled={!actionPlanRecipientId || actionPlanSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {actionPlanSending ? "Sending…" : "Send for Signature"}
                    </button>
                  ) : (
                    <button
                      onClick={handleGenerateExternalActionPlanLink}
                      disabled={!actionPlanExternalName.trim() || actionPlanSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {actionPlanSending ? "Generating…" : "Generate Link"}
                    </button>
                  )}
                  <button onClick={handleDownloadActionPlanForm} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download PDF instead
                  </button>
                  <button onClick={handleDownloadActionPlanFormWord} disabled={actionPlanDocxGenerating} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    <Download className="h-3.5 w-3.5" /> {actionPlanDocxGenerating ? "Generating…" : "Download as Word Document"}
                  </button>
                  <button onClick={handleCloseActionPlanPreview} className="btn text-sm px-4 py-2">Cancel</button>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reassign the recipient for a Termination Form — either redirecting a not-yet-signed document, or forwarding an already-signed one to the next stage in the chain. */}
      {terminationReassignDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            {terminationReassignSentLink ? (
              <>
                <h3 className="text-lg font-bold mb-2">Link Generated</h3>
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 mb-3">
                  <p className="text-sm font-semibold text-green-300">Reassigned to {terminationReassignExternalName}</p>
                  <p className="text-xs text-muted-foreground mt-1">No AHS account needed — copy this link and send it any way you like.</p>
                </div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                <div className="flex gap-2 mt-1 mb-4">
                  <input type="text" readOnly value={terminationReassignSentLink} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                  <button onClick={handleCopyTerminationReassignSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{terminationReassignSentLinkCopied ? "Copied!" : "Copy"}</button>
                </div>
                <div className="flex justify-end">
                  <button onClick={handleCloseTerminationReassignDialog} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Done</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold mb-2">{terminationReassignDialog.status === "signed" ? "Send to Next Recipient" : "Send to Another Recipient"}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {terminationReassignDialog.status === "signed" ? "Forward" : "Redirect"} <span className="font-semibold text-white">{(terminationReassignDialog.formData as unknown as TerminationFormData).employeeName}</span>'s termination notice to another signer.
                </p>

                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit mb-3">
                  <button type="button" onClick={() => setTerminationReassignMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${terminationReassignMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setTerminationReassignMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${terminationReassignMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {terminationReassignMode === "teammate" ? (
                  <>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                    <div className="relative mt-1 mb-3">
                      <input
                        type="text"
                        value={terminationReassignRecipientSearch}
                        onChange={(e) => { setTerminationReassignRecipientSearch(e.target.value); setTerminationReassignRecipientId(""); setTerminationReassignRecipientDropdownOpen(true); }}
                        onFocus={() => setTerminationReassignRecipientDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setTerminationReassignRecipientDropdownOpen(false), 150)}
                        placeholder="Search a teammate…"
                        className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                      />
                      {terminationReassignRecipientDropdownOpen && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                          {filteredTerminationReassignRecipients.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                          ) : (
                            filteredTerminationReassignRecipients.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => {
                                  setTerminationReassignRecipientId(e.id);
                                  setTerminationReassignRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                  setTerminationReassignRecipientDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${terminationReassignRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                              >
                                {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mb-3">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={terminationReassignExternalName}
                      onChange={(e) => setTerminationReassignExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                  </div>
                )}

                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                <select value={terminationReassignSlot} onChange={(e) => setTerminationReassignSlot(e.target.value as TerminationSignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1 mb-4">
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="senior_manager">Senior Manager</option>
                  <option value="hr_staff">HR Staff</option>
                </select>
                {terminationActionError && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{terminationActionError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button onClick={handleCloseTerminationReassignDialog} className="btn text-sm px-4 py-2">Cancel</button>
                  <button
                    onClick={handleSendTerminationToNextRecipient}
                    disabled={(terminationReassignMode === "teammate" ? !terminationReassignRecipientId : !terminationReassignExternalName.trim()) || terminationActionBusyId === terminationReassignDialog.id}
                    className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {terminationActionBusyId === terminationReassignDialog.id ? (terminationReassignMode === "teammate" ? "Sending…" : "Generating…") : (terminationReassignMode === "teammate" ? "Send" : "Generate Link")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sent Termination Forms — view-only preview of the form as it stands right now (whatever signatures exist so far) */}
      {terminationViewDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-6xl h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-bold">{(terminationViewDoc.formData as unknown as TerminationFormData).employeeName} — Notice of Termination</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Issued by {terminationViewDoc.createdByName ?? "—"}</p>
              </div>
              <button onClick={() => setTerminationViewDoc(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-white/5 flex justify-center">
              <div style={{ transform: "scale(0.85)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: terminationFormStyles }} />
                <div
                  dangerouslySetInnerHTML={{
                    __html: buildTerminationFormBodyMarkup(terminationViewDoc.formData as unknown as TerminationFormData, terminationImages.logo, terminationImages.ribbon, terminationImages.footer, terminationViewDoc.signatures),
                  }}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
              {terminationViewDoc.pdfUrl && (
                <a href={terminationViewDoc.pdfUrl} target="_blank" rel="noreferrer noopener" className="btn text-sm px-4 py-2">Open PDF</a>
              )}
              <button onClick={() => setTerminationViewDoc(null)} className="btn text-sm px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Notice of Termination — preview, pick who signs which line, send for signature */}
      {terminationPreviewOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-base font-bold">Notice of Termination — Preview</h3>
              <button onClick={handleCloseTerminationPreview} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
                <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: terminationFormStyles }} />
                  <div
                    dangerouslySetInnerHTML={{
                      __html: buildTerminationFormBodyMarkup(
                        buildTerminationFormData(terminationRecipientSlot, terminationSendMode === "external" ? terminationExternalName : employees.find((e) => e.id === terminationRecipientId)?.name || ""),
                        terminationImages.logo,
                        terminationImages.ribbon,
                        terminationImages.footer,
                        {}
                      ),
                    }}
                  />
                </div>
              </div>

              {terminationSentLink ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5">
                    <p className="text-sm font-semibold text-green-300">Sent to {terminationSentLink.recipientName}</p>
                    <p className="text-xs text-muted-foreground mt-1">They've also been notified in AHS Messages. Copy the link below to send it any other way too — email, Slack, text — so they can open it and sign.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sign link</label>
                    <div className="flex gap-2 mt-1">
                      <input type="text" readOnly value={terminationSentLink.link} onFocus={(e) => e.target.select()} className="glass-input text-xs py-1.5 px-3 rounded-md flex-1" />
                      <button onClick={handleCopyTerminationSentLink} className="btn text-xs px-3 py-1.5 shrink-0">{terminationSentLinkCopied ? "Copied!" : "Copy"}</button>
                    </div>
                  </div>
                  <button onClick={handleCloseTerminationPreview} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-auto">Done</button>
                </div>
              ) : (
              <div className="flex flex-col gap-3">
                <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5 w-fit">
                  <button type="button" onClick={() => setTerminationSendMode("teammate")} className={`px-3 text-xs font-medium transition-colors ${terminationSendMode === "teammate" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>AHS Teammate</button>
                  <button type="button" onClick={() => setTerminationSendMode("external")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${terminationSendMode === "external" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>External Link</button>
                </div>

                {terminationSendMode === "teammate" ? (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
                    <div className="relative mt-1">
                      <input
                        type="text"
                        value={terminationRecipientSearch}
                        onChange={(e) => {
                          setTerminationRecipientSearch(e.target.value);
                          setTerminationRecipientId("");
                          setTerminationRecipientDropdownOpen(true);
                        }}
                        onFocus={() => setTerminationRecipientDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setTerminationRecipientDropdownOpen(false), 150)}
                        placeholder="Search a teammate…"
                        className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                      />
                      {terminationRecipientDropdownOpen && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
                          {filteredTerminationRecipients.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching teammates.</p>
                          ) : (
                            filteredTerminationRecipients.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => {
                                  setTerminationRecipientId(e.id);
                                  setTerminationRecipientSearch(`${e.name} — ${ROLE_LABELS[normalizeRole(e.position)] ?? e.position}`);
                                  setTerminationRecipientDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${terminationRecipientId === e.id ? "bg-blue-500/20 text-blue-300" : ""}`}
                              >
                                {e.name} <span className="text-muted-foreground text-xs">— {ROLE_LABELS[normalizeRole(e.position)] ?? e.position}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recipient name</label>
                    <input
                      type="text"
                      value={terminationExternalName}
                      onChange={(e) => setTerminationExternalName(e.target.value)}
                      placeholder="Type their name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">No AHS account needed — you'll get a link to send them any way you like (email, Slack, text), and they can open it and sign without logging in.</p>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                  <select value={terminationRecipientSlot} onChange={(e) => setTerminationRecipientSlot(e.target.value as TerminationSignatureSlot)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1">
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="senior_manager">Senior Manager</option>
                    <option value="hr_staff">HR Staff</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2 mt-auto">
                  {terminationSendError && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{terminationSendError}</p>
                  )}
                  {terminationSendMode === "teammate" ? (
                    <button
                      onClick={handleSendTerminationForm}
                      disabled={!terminationRecipientId || terminationSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {terminationSending ? "Sending…" : "Send for Signature"}
                    </button>
                  ) : (
                    <button
                      onClick={handleGenerateExternalTerminationLink}
                      disabled={!terminationExternalName.trim() || terminationSending}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {terminationSending ? "Generating…" : "Generate Link"}
                    </button>
                  )}
                  <button onClick={handleDownloadTerminationForm} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download PDF instead
                  </button>
                  <button onClick={handleDownloadTerminationFormWord} disabled={terminationDocxGenerating} className="btn text-sm px-4 py-2 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    <Download className="h-3.5 w-3.5" /> {terminationDocxGenerating ? "Generating…" : "Download as Word Document"}
                  </button>
                  <button onClick={handleCloseTerminationPreview} className="btn text-sm px-4 py-2">Cancel</button>
                </div>
              </div>
              )}
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
      {/* Master List — clicking a name pops this up instead of navigating away; "View full profile" inside still opens the full stats page. Edits here are a local draft until "Save Changes" is clicked — one explicit save, one clear result, instead of a silent per-field auto-commit that made it unclear whether e.g. an email change had actually gone through. */}
      {masterListDetailEmployee && popupDraft && (() => {
        const detail = masterListDetailEmployee;
        const closeDetail = () => { setMasterListDetailEmployee(null); setPopupDraft(null); };
        const setDraft = <K extends keyof MasterListDetailDraft>(field: K, value: MasterListDetailDraft[K]) =>
          setPopupDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
        const fieldLabel = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";
        const fieldInput = "glass-input text-sm py-1.5 px-3 rounded-md w-full";
        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeDetail}>
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 border-b border-white/10 shrink-0">
              <h3 className="text-lg font-bold mb-1">{detail.name}</h3>
              <p className="text-xs text-muted-foreground">{resolveMasterListPosition(detail)} · {resolveSpecificDepartment(detail)}</p>
            </div>

            <div className="overflow-y-auto px-6 py-4 flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className={fieldLabel}>Status</label>
                  <select
                    value={popupDraft.status}
                    onChange={(e) => setDraft("status", e.target.value as EmploymentStatus)}
                    className={`${fieldInput} capitalize`}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="terminated">Terminated</option>
                    <option value="resigned">Resigned</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabel}>Start Date</label>
                  <input
                    type="date"
                    value={popupDraft.startDate}
                    onChange={(e) => setDraft("startDate", e.target.value)}
                    className={fieldInput}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabel}>Branch</label>
                  <select
                    value={popupDraft.branch}
                    onChange={(e) => setDraft("branch", e.target.value)}
                    className={fieldInput}
                  >
                    <option value="">—</option>
                    {!(LOCATIONS as readonly string[]).includes(popupDraft.branch) && popupDraft.branch && <option value={popupDraft.branch}>{popupDraft.branch}</option>}
                    {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabel}>Phone</label>
                  <input
                    type="text"
                    value={popupDraft.phone}
                    onChange={(e) => setDraft("phone", e.target.value)}
                    placeholder="—"
                    className={fieldInput}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <label className={fieldLabel}>Email {canEditEmployeeEmail ? "" : "(Admin/SuperAdmin/HR only)"}</label>
                  {canEditEmployeeEmail ? (
                    <input
                      type="email"
                      value={popupDraft.email}
                      onChange={(e) => setDraft("email", e.target.value)}
                      className={fieldInput}
                    />
                  ) : (
                    <p className="text-sm truncate" title={popupDraft.email}>{popupDraft.email}</p>
                  )}
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <label className={fieldLabel}>Address</label>
                  <input
                    type="text"
                    value={popupDraft.address}
                    onChange={(e) => setDraft("address", e.target.value)}
                    placeholder="—"
                    className={fieldInput}
                  />
                </div>
              </div>

              {popupSaveError && (
                <p className="text-xs text-red-400 mt-3">{popupSaveError}</p>
              )}
              {popupSaveSuccess && !popupSaveError && (
                <p className="text-xs text-green-400 mt-3">Saved.</p>
              )}

              <div className="mt-5 pt-4 border-t border-white/10">
                <p className={`${fieldLabel} mb-2`}>Recent Activity</p>
                {masterListDetailActivityLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : masterListDetailActivity.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No changes logged for this employee yet.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {masterListDetailActivity.map((entry) => (
                      <li key={entry.id} className="text-xs text-muted-foreground">
                        <span className="text-foreground">{activityActionLabel(entry.action)}</span>
                        {entry.details?.from !== undefined && entry.details?.to !== undefined && (
                          <span> — "{String(entry.details.from) || "—"}" → "{String(entry.details.to) || "—"}"</span>
                        )}
                        <span> · {entry.actorName || "Someone"} · {new Date(entry.createdAt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10 shrink-0">
              <a
                href={`/csr-agent/${detail.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                View full profile
              </a>
              <button onClick={closeDetail} className="btn text-sm px-4 py-2">Close</button>
              <button
                onClick={handleSaveMasterListDetail}
                disabled={popupSaving}
                className="btn text-sm px-4 py-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
              >
                {popupSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
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
