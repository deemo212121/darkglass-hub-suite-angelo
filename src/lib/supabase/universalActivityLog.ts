/**
 * Universal Activity Log — one combined, time-sorted feed across every
 * department, built by NORMALIZING the several already-existing activity
 * sources in this app rather than adding new logging plumbing anywhere:
 *
 * - Claims/CSR/Triage/BizOps: `ticket_audit_log` status changes, the same
 *   source DailyActivityPage.tsx/ReportTriageDaily.tsx/ClaimsDashboard.tsx
 *   already read, classified into a department by the resulting status's
 *   CSR-/OP-/TR-/PT-/CL- prefix (the same taxonomy convention used
 *   everywhere else in this app).
 * - Technician: any of the above ticket_audit_log rows where the actor
 *   holds TECHNICIAN (primary or extra role) — deliberately overlaps with
 *   the department classification above, since a technician-caused status
 *   change is legitimately both "activity in that ticket's stage" and
 *   "this technician's activity."
 * - Parts: parts_done_activity_log (getPartsDoneActivity) — already a
 *   clean, purpose-built feed — plus module_activity_log's "truck-stock"
 *   (Truck Stock imports, and blocked import attempts as alerts).
 * - HR: hr_activity_log — already a clean, purpose-built feed.
 * - Accounting/Payroll/Attendance/IT/User Management: module_activity_log,
 *   the existing shared table — accounting+payroll roll into "accounting",
 *   attendance-monitoring+user-management roll into "admin" (this app's
 *   Admin module owns both), it-tickets rolls into "it".
 * - Warnings/mistakes (employee_conduct_notes, getAllAgentNotes) — shared
 *   across CSR/Claims/Parts/Triage/BizOps, so each note is classified by
 *   the NOTED employee's own department (getRoleDepartmentBreakdown),
 *   which is the same real-department vocabulary AccountingDashboard.tsx/
 *   PayrollCalculationPage.tsx already use.
 * - Technician also folds in mileage_entries as a secondary "job
 *   activity" signal, since technicians don't otherwise set CSR-/OP-/etc.
 *   statuses much themselves.
 *
 * Loaded a page at a time (getUniversalActivityPage): each tab reads only
 * its own sources, each source at most one page of its newest rows, in the
 * database. It used to read every ticket, every mileage entry and a month
 * of every ticket field on each load.
 */
import { supabase } from "./client";
import type { TicketAuditEntry } from "./tickets";
import { getCompanyUsersLite, type ProfileRow } from "./users";
import { getAllAgentNotes } from "./csrAgentNotes";
import { getPartsDoneActivity } from "./partsDoneActivityLog";
import { getActivityLogPage as getHrActivityLogPage, activityActionLabel as hrActivityActionLabel } from "./hrActivityLog";
import { getModuleActivityLogPage, moduleActivityActionLabel, MODULE_ACTIVITY_ALERT_ACTIONS, type ActivityLogModule } from "./moduleActivityLog";
import { normalizeRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { classify as classifyTicketAction, BUCKET_LABEL as TICKET_ACTION_LABEL } from "@/lib/ticketActivityBuckets";

export type ActivityDepartment =
  | "claims" | "parts" | "csr" | "triage" | "bizops" | "technician"
  | "hr" | "accounting" | "it" | "admin";

/** A tab on the page: one department, or every department merged. */
export type ActivityTab = "all" | ActivityDepartment;

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

const profileName = (p: ProfileRow | undefined) => p?.display_name || p?.username || p?.email || "Unknown";

const MODULE_TO_DEPT: Record<ActivityLogModule, ActivityDepartment> = {
  accounting: "accounting",
  payroll: "accounting",
  "attendance-monitoring": "admin",
  "user-management": "admin",
  "it-tickets": "it",
  "absent-list": "hr",
  "truck-stock": "parts",
};
const ALL_MODULES: ActivityLogModule[] = ["accounting", "payroll", "attendance-monitoring", "it-tickets", "user-management", "truck-stock"];

type TicketLabel = { ticketNo: string; isClaim: boolean };
// Ticket number + "is it a claim" for the tickets a loaded page shows, kept
// for the session (each page needs at most a few hundred).
const ticketLabelCache = new Map<string, TicketLabel>();

async function getTicketLabels(ids: string[]): Promise<Map<string, TicketLabel>> {
  const missing = [...new Set(ids)].filter((id) => id && !ticketLabelCache.has(id));
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += 150) chunks.push(missing.slice(i, i + 150));
  await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase.from("tickets").select("id, ticket_no, warranty, claim_company").in("id", chunk);
      if (error) throw new Error(error.message);
      for (const t of data ?? []) {
        ticketLabelCache.set(t.id, {
          ticketNo: t.ticket_no,
          isClaim: String(t.warranty || "").trim().toUpperCase() === "IW" || !!String(t.claim_company || "").trim(),
        });
      }
    })
  );
  return ticketLabelCache;
}

/**
 * A ticket status change as Activity Log rows: its department (by the new
 * status's prefix) and, when a technician made it, a Technician row too.
 * Only real status-change rows (field "status", any case — live data has
 * both "status" and "Status"); other field types (Visit Log, Part
 * Transaction, schedule_date, …) carry giant pipe-delimited text dumps as
 * afterValue, which would garble the Action column and risk false
 * department matches (a Part Transaction's "Claim To: —").
 */
function ticketEntries(row: TicketAuditEntry, ticket: TicketLabel | undefined, actor: ProfileRow | undefined): UniversalActivityEntry[] {
  if (row.field.trim().toLowerCase() !== "status") return [];
  const actorName = profileName(actor);
  const targetLabel = ticket ? `Ticket ${ticket.ticketNo}` : "";
  const action = describeTicketAction(row);
  const statusDept = classifyStatusDepartment(row.afterValue);
  // A PT-/CL- prefixed status only really counts as Claims when the ticket
  // itself is a real claim (isClaimTicket) — same rule ClaimsDashboard.tsx uses.
  const dept = statusDept === "claims" && !ticket?.isClaim ? null : statusDept;
  const out: UniversalActivityEntry[] = [];
  if (dept) out.push({ id: `ticket:${row.id}:${dept}`, department: dept, when: row.createdAt, actorName, action, targetLabel });
  if (isTechnicianProfile(actor)) out.push({ id: `ticket:${row.id}:technician`, department: "technician", when: row.createdAt, actorName, action, targetLabel });
  return out;
}

// ── Sources ──
// A source returns its newest `limit` rows at or before `before` (and not
// before `after`) as entries, plus `oldest`: the oldest of those rows' time
// when it returned a full page (older rows may still exist), else null
// (nothing older in it). Sources that need the staff list (actor names,
// who's a technician) wait for it only after their own query is sent.
type Bounds = { before: string | null; after: string | null };
type SourceResult = { entries: UniversalActivityEntry[]; oldest: string | null };
type Source = (b: Bounds, limit: number) => Promise<SourceResult>;
type Ctx = { profileById: Map<string, ProfileRow>; technicianIds: string[] };

const oldestIfFull = (rows: { createdAt: string }[], limit: number) => (rows.length === limit ? rows[rows.length - 1].createdAt : null);
const STATUS_PREFIXES = ["csr-", "op-", "tr-", "pt-", "cl-"];

async function readStatusChanges(b: Bounds, limit: number, filter: { statusPrefixes?: string[]; changedBy?: string[] }): Promise<TicketAuditEntry[]> {
  let query = supabase
    .from("ticket_audit_log")
    .select("id, ticket_id, action, field, before_value, after_value, changed_by, created_at")
    .ilike("field", "status")
    .order("created_at", { ascending: false })
    .order("id")
    .limit(limit);
  if (b.before) query = query.lte("created_at", b.before);
  if (b.after) query = query.gte("created_at", b.after);
  if (filter.statusPrefixes) query = query.or(filter.statusPrefixes.map((p) => `after_value.ilike.${p}*`).join(","));
  if (filter.changedBy) query = query.in("changed_by", filter.changedBy);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
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

async function statusChangeEntries(rows: TicketAuditEntry[], ctx: Ctx, keep: (d: ActivityDepartment) => boolean): Promise<UniversalActivityEntry[]> {
  const labels = await getTicketLabels(rows.map((r) => r.ticketId)).catch((err) => {
    console.error("Failed to load ticket numbers:", err);
    return ticketLabelCache;
  });
  return rows.flatMap((row) =>
    ticketEntries(row, labels.get(row.ticketId), row.changedBy ? ctx.profileById.get(row.changedBy) : undefined).filter((e) => keep(e.department))
  );
}

/** Status changes whose new status names a department (CSR-/OP-/TR-/PT-/CL-) — the department rows, not the Technician copy. */
function departmentStatusSource(ctxP: Promise<Ctx>, prefixes: string[], keep: (d: ActivityDepartment) => boolean): Source {
  return async (b, limit) => {
    const rows = await readStatusChanges(b, limit, { statusPrefixes: prefixes });
    const entries = await statusChangeEntries(rows, await ctxP, (d) => d !== "technician" && keep(d));
    return { entries, oldest: oldestIfFull(rows, limit) };
  };
}

/**
 * Status changes made by a technician (the Technician rows), read by
 * changed_by in groups so each request stays short. One source: it's only
 * complete down to the newest of its groups' cut-offs.
 */
function technicianStatusSource(ctxP: Promise<Ctx>): Source {
  return async (b, limit) => {
    const ctx = await ctxP;
    const groups: string[][] = [];
    for (let i = 0; i < ctx.technicianIds.length; i += 80) groups.push(ctx.technicianIds.slice(i, i + 80));
    const perGroup = await Promise.all(groups.map((ids) => readStatusChanges(b, limit, { changedBy: ids })));
    let oldest: string | null = null;
    for (const rows of perGroup) {
      const o = oldestIfFull(rows, limit);
      if (o && (!oldest || Date.parse(o) > Date.parse(oldest))) oldest = o;
    }
    const entries = await statusChangeEntries(perGroup.flat(), ctx, (d) => d === "technician");
    return { entries, oldest };
  };
}

const mileageSource: Source = async (b, limit) => {
  let query = supabase
    .from("mileage_entries")
    .select("id, created_at, created_by_name, technician_name, total_mileage, branch")
    .order("created_at", { ascending: false })
    .order("id")
    .limit(limit);
  if (b.before) query = query.lte("created_at", b.before);
  if (b.after) query = query.gte("created_at", b.after);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r: any) => ({ ...r, createdAt: r.created_at as string }));
  const entries = rows.map((m): UniversalActivityEntry => ({
    id: `mileage:${m.id}`,
    department: "technician",
    when: m.created_at,
    actorName: m.created_by_name || m.technician_name || "Unknown",
    action: "Logged mileage",
    targetLabel: `${m.technician_name || "—"} — ${Number(m.total_mileage) || 0} mi (${m.branch || "Unassigned"})`,
  }));
  return { entries, oldest: oldestIfFull(rows, limit) };
};

const partsDoneSource: Source = async (b, limit) => {
  const rows = await getPartsDoneActivity(limit, b);
  const entries = rows.map((r): UniversalActivityEntry => ({
    id: `parts-done:${r.id}`,
    department: "parts",
    when: r.createdAt,
    actorName: r.actorName || "Unknown",
    action: "Marked branch done",
    targetLabel: `${r.branch} — ${r.summary}`,
  }));
  return { entries, oldest: oldestIfFull(rows, limit) };
};

const hrSource: Source = async (b, limit) => {
  const rows = await getHrActivityLogPage({ ...b, limit });
  const entries = rows.map((r): UniversalActivityEntry => ({
    id: `hr:${r.id}`,
    department: "hr",
    when: r.createdAt,
    actorName: r.actorName || "System",
    action: hrActivityActionLabel(r.action),
    targetLabel: r.targetLabel || "",
  }));
  return { entries, oldest: oldestIfFull(rows, limit) };
};

function moduleSource(modules: ActivityLogModule[]): Source {
  return async (b, limit) => {
    const rows = await getModuleActivityLogPage(modules, { ...b, limit });
    const entries = rows.map((r): UniversalActivityEntry => ({
      id: `module:${r.id}`,
      department: MODULE_TO_DEPT[r.module],
      when: r.createdAt,
      actorName: r.actorName || "System",
      action: moduleActivityActionLabel(r.action),
      targetLabel: r.targetLabel || "",
      alert: MODULE_ACTIVITY_ALERT_ACTIONS.has(r.action),
    }));
    return { entries, oldest: oldestIfFull(rows, limit) };
  };
}

// Conduct notes (warnings/mistakes) → whichever department the noted
// employee belongs to. A small table, read whole once per page and
// bounded here.
function notesSource(ctxP: Promise<Ctx>, keep: (d: ActivityDepartment) => boolean): Source {
  let notesP: ReturnType<typeof getAllAgentNotes> | null = null;
  return async (b) => {
    notesP ??= getAllAgentNotes();
    const [notes, ctx] = await Promise.all([notesP, ctxP]);
    const beforeMs = b.before ? Date.parse(b.before) : Infinity;
    const afterMs = b.after ? Date.parse(b.after) : -Infinity;
    const entries: UniversalActivityEntry[] = [];
    for (const n of notes) {
      const t = Date.parse(n.createdAt);
      if (t > beforeMs || t < afterMs) continue;
      const agent = ctx.profileById.get(n.agentProfileId);
      const dept = departmentForProfile(agent);
      if (!dept || !keep(dept)) continue;
      entries.push({
        id: `note:${n.id}`,
        department: dept,
        when: n.createdAt,
        actorName: n.createdByName || "Unknown",
        action: n.type === "warning" ? "Submitted warning" : "Submitted mistake note",
        targetLabel: `${profileName(agent)}${n.ticketNo ? ` — Ticket ${n.ticketNo}` : ""}`,
      });
    }
    return { entries, oldest: null };
  };
}

function sourcesFor(tab: ActivityTab, ctxP: Promise<Ctx>): Source[] {
  const only = (d: ActivityDepartment) => (x: ActivityDepartment) => x === d;
  const notes = notesSource(ctxP, tab === "all" ? () => true : only(tab));
  switch (tab) {
    case "all":
      // Only the status changes that show up somewhere: a department's
      // prefix, or made by a technician — most others (e.g. "Completed" by
      // an office user) belong to no tab.
      return [departmentStatusSource(ctxP, STATUS_PREFIXES, () => true), technicianStatusSource(ctxP), mileageSource, partsDoneSource, hrSource, moduleSource(ALL_MODULES), notes];
    case "claims":
      return [departmentStatusSource(ctxP, ["pt-", "cl-"], only("claims")), notes];
    case "csr":
      return [departmentStatusSource(ctxP, ["csr-"], only("csr")), notes];
    case "triage":
      return [departmentStatusSource(ctxP, ["tr-"], only("triage")), notes];
    case "bizops":
      return [departmentStatusSource(ctxP, ["op-"], only("bizops")), notes];
    case "technician":
      return [technicianStatusSource(ctxP), mileageSource, notes];
    case "parts":
      return [partsDoneSource, moduleSource(["truck-stock"]), notes];
    case "hr":
      return [hrSource, notes];
    case "accounting":
      return [moduleSource(["accounting", "payroll"]), notes];
    case "it":
      return [moduleSource(["it-tickets"]), notes];
    case "admin":
      return [moduleSource(["attendance-monitoring", "user-management"]), notes];
  }
}

export interface ActivityPage {
  entries: UniversalActivityEntry[];
  /** Pass back as `before` for the next page; null when there's nothing older. */
  next: string | null;
}

/**
 * The newest `limit` (default 500) entries for a tab at or before `before`
 * (and not before `after`) — ISO instants, both optional. `have` is what
 * the page already shows (entries sharing the previous page's last
 * timestamp come back again and are dropped).
 *
 * Every source gives its newest `limit` rows and they're merged. A source
 * that gave a full page may still hold older rows, so only entries at or
 * after the newest such cut-off are certain to be in order; past it, the
 * source(s) at that cut-off are read again from there (the others already
 * reach further back). That way nothing is skipped between pages even
 * though the sources run at very different rates (ticket status changes
 * ~1,300 a day, IT a few a week).
 */
export async function getUniversalActivityPage(opts: {
  tab: ActivityTab;
  before?: string | null;
  after?: string | null;
  limit?: number;
  have?: ReadonlySet<string>;
}): Promise<ActivityPage> {
  const limit = opts.limit ?? 500;
  // The lean one-query roster (names and roles are all this needs) — the
  // full getCompanyUsers also builds the approval directory, ~20 requests cold.
  const ctxP: Promise<Ctx> = getCompanyUsersLite().then((profiles) => ({
    profileById: new Map(profiles.map((p) => [p.id, p])),
    technicianIds: profiles.filter(isTechnicianProfile).map((p) => p.id),
  }));
  ctxP.catch(() => {}); // surfaced by the sources that await it
  const sources = sourcesFor(opts.tab, ctxP);
  const seen = new Set(opts.have ?? []);
  const taken: UniversalActivityEntry[] = [];
  let before = opts.before ?? null;
  let results: (SourceResult | null)[] = sources.map(() => null);
  for (let round = 0; round < 8; round++) {
    const beforeMs = before ? Date.parse(before) : Infinity;
    results = await Promise.all(
      sources.map((s, i) => {
        // Already holds everything down to a point older than `before` — no need to read it again.
        const prev = results[i];
        if (prev && (prev.oldest === null || Date.parse(prev.oldest) < beforeMs)) return prev;
        return s({ before, after: opts.after ?? null }, limit).catch((err): SourceResult => {
          console.error("Activity Logs: a source failed to load:", err);
          return { entries: [], oldest: null };
        });
      })
    );
    let cutoff: string | null = null;
    let cutoffMs = -Infinity;
    for (const r of results) {
      if (r?.oldest && Date.parse(r.oldest) > cutoffMs) {
        cutoffMs = Date.parse(r.oldest);
        cutoff = r.oldest;
      }
    }
    const fresh = results
      .flatMap((r) => r?.entries ?? [])
      .filter((e) => !seen.has(e.id) && Date.parse(e.when) >= cutoffMs && Date.parse(e.when) <= beforeMs)
      .sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
    const need = limit - taken.length;
    for (const e of fresh.slice(0, need)) {
      taken.push(e);
      seen.add(e.id);
    }
    if (taken.length >= limit) {
      const everythingRead = cutoff === null && fresh.length <= need;
      return { entries: taken, next: everythingRead ? null : taken[taken.length - 1].when };
    }
    if (cutoff === null) return { entries: taken, next: null };
    before = cutoff;
  }
  return { entries: taken, next: before };
}
