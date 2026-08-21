/**
 * Universal Activity Log — one combined, time-sorted feed across every
 * department, built by NORMALIZING the several already-existing activity
 * sources in this app rather than adding new logging plumbing anywhere:
 *
 * - Claims/CSR/Triage/BizOps: `ticket_audit_log` (via getTicketAuditLog),
 *   the same source DailyActivityPage.tsx/ReportTriageDaily.tsx/
 *   ClaimsDashboard.tsx already read, classified into a department by the
 *   resulting status's CSR-/OP-/TR-/PT-/CL- prefix (the same taxonomy
 *   convention used everywhere else in this app) — falling back to the
 *   ticket's current status when the row itself isn't a status change
 *   (e.g. a reschedule/reassign action).
 * - Technician: any of the above ticket_audit_log rows where the actor
 *   holds TECHNICIAN (primary or extra role) — deliberately overlaps with
 *   the department classification above, since a technician-caused status
 *   change is legitimately both "activity in that ticket's stage" and
 *   "this technician's activity."
 * - Parts: parts_done_activity_log (getPartsDoneActivity) — already a
 *   clean, purpose-built feed.
 * - HR: hr_activity_log (getActivityLog) — already a clean, purpose-built
 *   feed.
 * - Accounting/Payroll/Attendance/IT/User Management: module_activity_log
 *   (getModuleActivityLog), the existing shared table — accounting+payroll
 *   roll into "accounting", attendance-monitoring+user-management roll
 *   into "admin" (this app's Admin module owns both), it-tickets rolls
 *   into "it".
 * - Warnings/mistakes (employee_conduct_notes, getAllAgentNotes) — shared
 *   across CSR/Claims/Parts/Triage/BizOps, so each note is classified by
 *   the NOTED employee's own department (getRoleDepartmentBreakdown),
 *   which is the same real-department vocabulary AccountingDashboard.tsx/
 *   PayrollCalculationPage.tsx already use.
 * - Technician also folds in mileage_entries (getMileageEntries) as a
 *   secondary "job activity" signal, since technicians don't otherwise
 *   set CSR-/OP-/etc. statuses much themselves.
 */
import { getCompanyTickets, getTicketAuditLog, type TicketAuditEntry } from "./tickets";
import { getCompanyUsers, type ProfileRow } from "./users";
import { getAllAgentNotes } from "./csrAgentNotes";
import { getPartsDoneActivity } from "./partsDoneActivityLog";
import { getActivityLog as getHrActivityLog, activityActionLabel as hrActivityActionLabel } from "./hrActivityLog";
import { getModuleActivityLog, moduleActivityActionLabel, type ActivityLogModule } from "./moduleActivityLog";
import { getMileageEntries } from "./mileage";
import { normalizeRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { classify as classifyTicketAction, BUCKET_LABEL as TICKET_ACTION_LABEL } from "@/components/DailyActivityPage";

export type ActivityDepartment =
  | "claims" | "parts" | "csr" | "triage" | "bizops" | "technician"
  | "hr" | "accounting" | "it" | "admin";

export const DEPARTMENT_ORDER: ActivityDepartment[] = [
  "claims", "parts", "csr", "triage", "bizops", "technician", "hr", "accounting", "it", "admin",
];

export const DEPARTMENT_LABEL: Record<ActivityDepartment, string> = {
  claims: "Claims",
  parts: "Parts",
  csr: "CSR",
  triage: "Triage",
  bizops: "BizOps",
  technician: "Technician",
  hr: "HR",
  accounting: "Accounting",
  it: "IT",
  admin: "Admin",
};

export interface UniversalActivityEntry {
  id: string;
  department: ActivityDepartment;
  when: string;
  actorName: string;
  action: string;
  targetLabel: string;
}

// The real department string getRoleDepartmentBreakdown() returns (e.g.
// "BizOps", "Branch Manager") mapped down to just the 10 tabs this page
// covers — "Management"/"Branch Manager"/"Dispatch"/unknown fall through
// to null (still shows up in the ALL tab's underlying sources where
// applicable, just has no single department tab of its own).
const ROLE_DEPARTMENT_TO_TAB: Record<string, ActivityDepartment> = {
  Admin: "admin",
  CSR: "csr",
  Technician: "technician",
  HR: "hr",
  IT: "it",
  Parts: "parts",
  Accounting: "accounting",
  Claims: "claims",
  BizOps: "bizops",
  Triage: "triage",
};

function departmentForProfile(p: ProfileRow | undefined): ActivityDepartment | null {
  if (!p) return null;
  return ROLE_DEPARTMENT_TO_TAB[getRoleDepartmentBreakdown(p.role).department] ?? null;
}

function isTechnicianProfile(p: ProfileRow | undefined): boolean {
  if (!p) return false;
  return [p.role, ...(p.extra_roles ?? [])].some((r) => normalizeRole(r) === "TECHNICIAN");
}

function classifyStatusDepartment(status: string | null | undefined): ActivityDepartment | null {
  const v = String(status || "").trim().toLowerCase();
  if (v.startsWith("csr-")) return "csr";
  if (v.startsWith("op-")) return "bizops";
  if (v.startsWith("tr-")) return "triage";
  if (v.startsWith("pt-") || v.startsWith("cl-")) return "claims";
  return null;
}

function describeTicketAction(row: TicketAuditEntry): string {
  const label = TICKET_ACTION_LABEL[classifyTicketAction(row)];
  if (row.field === "status" && row.afterValue) return `${label} — ${row.afterValue}`;
  return label;
}

function inRange(iso: string, startDate: string, endDate: string): boolean {
  const d = (iso || "").slice(0, 10);
  return d >= startDate && d <= endDate;
}

export interface GetUniversalActivityLogOptions {
  startDate: string;
  endDate: string;
  /** Cap per underlying source (not the combined total) — sources without their own date filter (Parts Done Activity, module_activity_log) fetch this many most-recent rows and then get date-filtered client-side, so a very quiet range still needs enough headroom to not miss real rows. */
  limitPerSource?: number;
}

export async function getUniversalActivityLog(opts: GetUniversalActivityLogOptions): Promise<UniversalActivityEntry[]> {
  const { startDate, endDate } = opts;
  const limit = opts.limitPerSource ?? 500;
  const moduleNames: ActivityLogModule[] = ["accounting", "payroll", "attendance-monitoring", "it-tickets", "user-management"];

  const [tickets, profiles, auditRows, agentNotes, partsDone, hrRows, mileageEntries, moduleLogs] = await Promise.all([
    getCompanyTickets(),
    getCompanyUsers(),
    getTicketAuditLog({ startDate, endDate }).catch((err) => { console.error("Failed to load ticket audit log:", err); return []; }),
    getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
    getPartsDoneActivity(limit).catch((err) => { console.error("Failed to load Parts Done Activity:", err); return []; }),
    getHrActivityLog({ from: `${startDate}T00:00:00`, to: `${endDate}T23:59:59`, limit }).catch((err) => { console.error("Failed to load HR activity log:", err); return []; }),
    getMileageEntries().catch((err) => { console.error("Failed to load mileage entries:", err); return []; }),
    Promise.all(moduleNames.map((m) => getModuleActivityLog(m, limit).catch((err) => { console.error(`Failed to load ${m} activity log:`, err); return []; }))),
  ]);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const ticketById = new Map<string, { ticketNo: string; isClaim: boolean; status: string }>();
  for (const t of tickets as any[]) {
    if (!t._id) continue;
    ticketById.set(t._id, {
      ticketNo: t.ticketNo,
      isClaim: String(t.warranty || "").trim().toUpperCase() === "IW" || !!String(t.claimCompany || "").trim(),
      status: t.status || "",
    });
  }
  const profileName = (p: ProfileRow | undefined) => p?.display_name || p?.username || p?.email || "Unknown";

  const entries: UniversalActivityEntry[] = [];

  // ── Ticket audit log → Claims / CSR / Triage / BizOps, + Technician overlay ──
  // Restricted to real status-change rows (field === "status", checked
  // case-insensitively — live data has both "status" and "Status"). Other
  // field types (Visit Log, Part Transaction, schedule_date, …) carry
  // giant pipe-delimited text dumps as afterValue, not a short status
  // string — including them here would both garble the Action column and
  // risk false department matches from substring collisions (e.g. a Part
  // Transaction's "Claim To: —" containing the literal word "Claim").
  for (const row of auditRows) {
    if (row.field.trim().toLowerCase() !== "status") continue;
    const ticket = ticketById.get(row.ticketId);
    const actor = row.changedBy ? profileById.get(row.changedBy) : undefined;
    const actorName = profileName(actor);
    const targetLabel = ticket ? `Ticket ${ticket.ticketNo}` : "";
    const action = describeTicketAction(row);

    const statusDept = classifyStatusDepartment(row.afterValue);
    // A PT-/CL- prefixed status only really counts as Claims when the
    // ticket itself is a real claim (isClaimTicket) — same rule
    // ClaimsDashboard.tsx uses.
    const dept = statusDept === "claims" && !ticket?.isClaim ? null : statusDept;
    if (dept) entries.push({ id: `ticket:${row.id}:${dept}`, department: dept, when: row.createdAt, actorName, action, targetLabel });

    if (isTechnicianProfile(actor)) {
      entries.push({ id: `ticket:${row.id}:technician`, department: "technician", when: row.createdAt, actorName, action, targetLabel });
    }
  }

  // ── Mileage entries → Technician (secondary job-activity signal) ──
  for (const m of mileageEntries) {
    if (!inRange(m.createdAt, startDate, endDate)) continue;
    entries.push({
      id: `mileage:${m.id}`,
      department: "technician",
      when: m.createdAt,
      actorName: m.createdByName || m.technicianName || "Unknown",
      action: "Logged mileage",
      targetLabel: `${m.technicianName || "—"} — ${m.totalMileage ?? 0} mi (${m.branch || "Unassigned"})`,
    });
  }

  // ── Parts Done Activity → Parts ──
  for (const r of partsDone) {
    if (!inRange(r.createdAt, startDate, endDate)) continue;
    entries.push({
      id: `parts-done:${r.id}`,
      department: "parts",
      when: r.createdAt,
      actorName: r.actorName || "Unknown",
      action: "Marked branch done",
      targetLabel: `${r.branch} — ${r.summary}`,
    });
  }

  // ── HR activity log → HR ──
  for (const r of hrRows) {
    entries.push({
      id: `hr:${r.id}`,
      department: "hr",
      when: r.createdAt,
      actorName: r.actorName || "System",
      action: hrActivityActionLabel(r.action),
      targetLabel: r.targetLabel || "",
    });
  }

  // ── module_activity_log → Accounting / Admin / IT ──
  const MODULE_TO_DEPT: Record<ActivityLogModule, ActivityDepartment> = {
    accounting: "accounting",
    payroll: "accounting",
    "attendance-monitoring": "admin",
    "user-management": "admin",
    "it-tickets": "it",
  };
  moduleNames.forEach((moduleName, i) => {
    for (const r of moduleLogs[i]) {
      if (!inRange(r.createdAt, startDate, endDate)) continue;
      entries.push({
        id: `module:${r.id}`,
        department: MODULE_TO_DEPT[moduleName],
        when: r.createdAt,
        actorName: r.actorName || "System",
        action: moduleActivityActionLabel(r.action),
        targetLabel: r.targetLabel || "",
      });
    }
  });

  // ── Conduct notes (warnings/mistakes) → whichever department the noted
  // employee belongs to ──
  for (const n of agentNotes) {
    if (!inRange(n.createdAt, startDate, endDate)) continue;
    const agent = profileById.get(n.agentProfileId);
    const dept = departmentForProfile(agent);
    if (!dept) continue;
    entries.push({
      id: `note:${n.id}`,
      department: dept,
      when: n.createdAt,
      actorName: n.createdByName || "Unknown",
      action: n.type === "warning" ? "Submitted warning" : "Submitted mistake note",
      targetLabel: `${profileName(agent)}${n.ticketNo ? ` — Ticket ${n.ticketNo}` : ""}`,
    });
  }

  return entries.sort((a, b) => b.when.localeCompare(a.when));
}
