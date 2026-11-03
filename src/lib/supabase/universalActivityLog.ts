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
 *   clean, purpose-built feed — plus module_activity_log's "truck-stock"
 *   (Truck Stock imports, and blocked import attempts as alerts).
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
 * - Technician also folds in mileage_entries as a secondary "job
 *   activity" signal, since technicians don't otherwise set CSR-/OP-/etc.
 *   statuses much themselves.
 *
 * Each source is read for the requested window only, in the database
 * (ticket status changes, mileage, HR and module logs), so the page can
 * load two weeks at a time — every ticket row (all columns) and the whole
 * mileage table used to be fetched on every load. Tickets are now read
 * only for their number / claim flag (getTicketLabels); the tiny
 * conduct-notes and Parts Done tables are still filtered here.
 */
import { supabase } from "./client";
import type { TicketAuditEntry } from "./tickets";
import { getCompanyUsers, type ProfileRow } from "./users";
import { getAllAgentNotes } from "./csrAgentNotes";
import { getPartsDoneActivity } from "./partsDoneActivityLog";
import { getActivityLogInRange as getHrActivityLogInRange, activityActionLabel as hrActivityActionLabel } from "./hrActivityLog";
import { getModuleActivityLogInRange, moduleActivityActionLabel, MODULE_ACTIVITY_ALERT_ACTIONS, type ActivityLogModule } from "./moduleActivityLog";
import { normalizeRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { classify as classifyTicketAction, BUCKET_LABEL as TICKET_ACTION_LABEL } from "@/lib/ticketActivityBuckets";

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
  /** Someone tried something they don't have access to (e.g. Truck Stock Import without Admin) — shown in red. */
  alert?: boolean;
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

const PAGE_SIZE = 1000;
const PARALLEL_PAGES = 8;

/**
 * Every row of a ranged query: the first page also brings the total count,
 * then the rest a few pages at a time (two weeks of ticket status changes
 * is ~20 pages). A row inserted meanwhile shifts the pages by one, so rows
 * are de-duplicated by id.
 */
async function fetchAllPages(
  page: (from: number, to: number, withCount: boolean) => PromiseLike<{ data: any[] | null; error: { message: string } | null; count: number | null }>
): Promise<any[]> {
  const first = await page(0, PAGE_SIZE - 1, true);
  if (first.error) throw new Error(first.error.message);
  const rows = [...(first.data ?? [])];
  const starts: number[] = [];
  for (let s = PAGE_SIZE; s < (first.count ?? 0); s += PAGE_SIZE) starts.push(s);
  for (let i = 0; i < starts.length; i += PARALLEL_PAGES) {
    const batch = await Promise.all(starts.slice(i, i + PARALLEL_PAGES).map((s) => page(s, s + PAGE_SIZE - 1, false)));
    for (const b of batch) {
      if (b.error) throw new Error(b.error.message);
      rows.push(...(b.data ?? []));
    }
  }
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.id) && !!seen.add(r.id));
}

/** Status changes only (live data spells the field both "status" and "Status") — other fields carry big text dumps this page never shows. */
async function getTicketStatusChanges(fromIso: string, toIso: string): Promise<TicketAuditEntry[]> {
  const rows = await fetchAllPages((from, to, withCount) =>
    supabase
      .from("ticket_audit_log")
      .select("id, ticket_id, action, field, before_value, after_value, changed_by, created_at", withCount ? { count: "exact" } : undefined)
      .ilike("field", "status")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  );
  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticket_id,
    action: r.action ?? "",
    field: r.field ?? "",
    beforeValue: r.before_value,
    afterValue: r.after_value,
    changedBy: r.changed_by,
    createdAt: r.created_at,
  }));
}

type TicketLabel = { ticketNo: string; isClaim: boolean };

// Ticket number + "is it a claim" for every ticket — only those four
// columns, read alongside the status changes rather than after them (two
// weeks touch most tickets, so looking them up by id was slower), and kept
// for a couple of minutes so "Load 2 more weeks" doesn't read them again.
const TICKET_LABELS_TTL_MS = 120_000;
let ticketLabelsCache: { at: number; promise: Promise<Map<string, TicketLabel>> } | null = null;

function getTicketLabels(): Promise<Map<string, TicketLabel>> {
  if (ticketLabelsCache && Date.now() - ticketLabelsCache.at < TICKET_LABELS_TTL_MS) return ticketLabelsCache.promise;
  const promise = fetchAllPages((from, to, withCount) =>
    supabase
      .from("tickets")
      .select("id, ticket_no, warranty, claim_company", withCount ? { count: "exact" } : undefined)
      .order("id")
      .range(from, to)
  ).then((rows) => {
    const map = new Map<string, TicketLabel>();
    for (const t of rows) {
      map.set(t.id, {
        ticketNo: t.ticket_no,
        isClaim: String(t.warranty || "").trim().toUpperCase() === "IW" || !!String(t.claim_company || "").trim(),
      });
    }
    return map;
  });
  ticketLabelsCache = { at: Date.now(), promise };
  promise.catch(() => { if (ticketLabelsCache?.promise === promise) ticketLabelsCache = null; });
  return promise;
}

async function getMileageLogged(fromIso: string, toIso: string) {
  const rows = await fetchAllPages((from, to, withCount) =>
    supabase
      .from("mileage_entries")
      .select("id, created_at, created_by_name, technician_name, total_mileage, branch", withCount ? { count: "exact" } : undefined)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  );
  return rows.map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    createdByName: (r.created_by_name ?? null) as string | null,
    technicianName: (r.technician_name ?? null) as string | null,
    totalMileage: Number(r.total_mileage) || 0,
    branch: (r.branch ?? "") as string,
  }));
}

export interface GetUniversalActivityLogOptions {
  /** The viewer's own calendar days (YYYY-MM-DD), both included. */
  startDate: string;
  endDate: string;
  /** How many most-recent Parts Done rows to read before date-filtering them here (that table has no date query). */
  limitPerSource?: number;
}

export async function getUniversalActivityLog(opts: GetUniversalActivityLogOptions): Promise<UniversalActivityEntry[]> {
  const { startDate, endDate } = opts;
  const limit = opts.limitPerSource ?? 500;
  const moduleNames: ActivityLogModule[] = ["accounting", "payroll", "attendance-monitoring", "it-tickets", "user-management", "truck-stock"];
  // Local midnight to local end of day, as instants — so "today" is the viewer's today.
  const fromIso = new Date(`${startDate}T00:00:00`).toISOString();
  const toIso = new Date(`${endDate}T23:59:59.999`).toISOString();
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  const inRange = (iso: string) => {
    const t = Date.parse(iso);
    return t >= fromMs && t <= toMs;
  };

  const [profiles, auditRows, ticketById, agentNotes, partsDone, hrRows, mileageEntries, moduleRows] = await Promise.all([
    getCompanyUsers(),
    getTicketStatusChanges(fromIso, toIso).catch((err) => { console.error("Failed to load ticket audit log:", err); return []; }),
    getTicketLabels().catch((err) => { console.error("Failed to load ticket numbers:", err); return new Map<string, TicketLabel>(); }),
    getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
    getPartsDoneActivity(limit).catch((err) => { console.error("Failed to load Parts Done Activity:", err); return []; }),
    getHrActivityLogInRange(fromIso, toIso).catch((err) => { console.error("Failed to load HR activity log:", err); return []; }),
    getMileageLogged(fromIso, toIso).catch((err) => { console.error("Failed to load mileage entries:", err); return []; }),
    getModuleActivityLogInRange(moduleNames, fromIso, toIso).catch((err) => { console.error("Failed to load module activity logs:", err); return []; }),
  ]);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
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
    if (!inRange(r.createdAt)) continue;
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

  // ── module_activity_log → Accounting / Admin / IT / Parts ──
  const MODULE_TO_DEPT: Record<ActivityLogModule, ActivityDepartment> = {
    accounting: "accounting",
    payroll: "accounting",
    "attendance-monitoring": "admin",
    "user-management": "admin",
    "it-tickets": "it",
    "absent-list": "hr",
    "truck-stock": "parts",
  };
  for (const r of moduleRows) {
    const dept = MODULE_TO_DEPT[r.module];
    if (!dept) continue;
    entries.push({
      id: `module:${r.id}`,
      department: dept,
      when: r.createdAt,
      actorName: r.actorName || "System",
      action: moduleActivityActionLabel(r.action),
      targetLabel: r.targetLabel || "",
      alert: MODULE_ACTIVITY_ALERT_ACTIONS.has(r.action),
    });
  }

  // ── Conduct notes (warnings/mistakes) → whichever department the noted
  // employee belongs to ──
  for (const n of agentNotes) {
    if (!inRange(n.createdAt)) continue;
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
