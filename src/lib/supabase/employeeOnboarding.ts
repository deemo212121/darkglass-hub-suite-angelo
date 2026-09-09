/**
 * Per-hire onboarding punch list — backs the HR module's To-Do List page
 * (HrOnboardingChecklistPage, HR / Admin / Super Admin only). Rows live in
 * employee_onboarding_tasks (migration 0220) and are seeded from a
 * role-aware template right after User Management creates the account.
 *
 * The task set is intentionally about the setup the "Add User" form does
 * NOT finish — it captures name / email / role / branch / schedule and
 * nothing else. Onboarding *documents* already have their own per-doc grid
 * on the HR Dashboard, so that step here is just a pointer to it, not a
 * second copy.
 */
import { supabase } from "./client";
import { normalizeRole, TECHNICIAN_PAY_ROLES, isCsrRestrictedRole } from "@/lib/roleLabels";

export type OnboardingTaskStatus = "open" | "done" | "na";

export interface OnboardingTaskRow {
  taskKey: string;
  status: OnboardingTaskStatus;
  note: string | null;
  doneByName: string | null;
  doneAt: string | null;
}

export interface OnboardingBoardEntry {
  profileId: string;
  name: string;
  roleLabel: string;
  addedAt: string;
  tasks: OnboardingTaskRow[];
  openCount: number;
  totalCount: number;
}

/** A step in the template. `link` is a client route the page deep-links to. */
export interface OnboardingTaskDef {
  key: string;
  label: string;
  detail: string;
  link?: { to: string; params?: Record<string, string> };
  applies: (ctx: OnboardingContext) => boolean;
}

interface OnboardingContext {
  isTechnician: boolean;
  isPhilippines: boolean;
  isCsr: boolean;
}

const HR_DASHBOARD_LINK = { to: "/m/$module/$submodule", params: { module: "hr", submodule: "hr-dashboard" } };
const ACCOUNTING_LINK = { to: "/m/$module/$submodule", params: { module: "dashboard", submodule: "accounting-dashboard" } };
const CSR_DASHBOARD_LINK = { to: "/m/$module/$submodule", params: { module: "dashboard", submodule: "csr-dashboard" } };
const USER_MGMT_LINK = { to: "/m/$module/$submodule", params: { module: "admin", submodule: "user-management" } };

/**
 * Order here is the order shown in the panel. `applies` filters the list
 * for a given hire at seed time; a task never added is never shown.
 */
export const ONBOARDING_TASK_DEFS: OnboardingTaskDef[] = [
  {
    key: "login_delivered",
    label: "Send login details to the employee",
    detail: "Email their username and the temporary password (Welcome2024!). They're forced to set their own on first sign-in.",
    applies: () => true,
  },
  {
    key: "profile_completed",
    label: "Complete their employee profile",
    detail: "Hire date, employment type, phone, address, emergency contact, government IDs (SSN, or SSS / TIN / PhilHealth for PH).",
    link: { to: "/employee/$employeeId" },
    applies: () => true,
  },
  {
    key: "off_days_set",
    label: "Set weekly off-days on their profile",
    detail: "The Add User form only saved off-days to this browser — attendance alerts won't compute correctly until they're set on the profile itself.",
    link: { to: "/employee/$employeeId" },
    applies: () => true,
  },
  {
    key: "schedule_confirmed",
    label: "Confirm their required check-in / check-out times",
    detail: "Double-check the shift window captured at creation is right for their role and location.",
    link: { to: "/employee/$employeeId" },
    applies: () => true,
  },
  {
    key: "manager_confirmed",
    label: "Confirm their reporting manager",
    detail: "Manager is free text — make sure it matches a real person so the org chart and manager-scoped views resolve.",
    link: { to: "/employee/$employeeId" },
    applies: () => true,
  },
  {
    key: "access_reviewed",
    label: "Review role, extra roles and module access",
    detail: "Confirm the primary role, any secondary roles, and dashboard/module access are what this person should have.",
    link: USER_MGMT_LINK,
    applies: () => true,
  },
  {
    key: "onboarding_docs",
    label: "Collect onboarding documents",
    detail: "Work the role/country document checklist on the HR Dashboard until every required file is on record.",
    link: HR_DASHBOARD_LINK,
    applies: () => true,
  },
  {
    key: "hr_forms_sent",
    label: "Send required HR forms for signature",
    detail: "Start the signing chain for the forms this hire needs (Contractor Addendum for contractors, Employee Confirmation Form, NDA, etc.).",
    link: HR_DASHBOARD_LINK,
    applies: () => true,
  },
  {
    key: "tech_pay_setup",
    label: "Set up technician pay",
    detail: "Confirm piece rates, LDT, mileage rate and MCA threshold apply for their branch.",
    link: ACCOUNTING_LINK,
    applies: (c) => c.isTechnician,
  },
  {
    key: "pay_rate_set",
    label: "Set their hourly rate or salary",
    detail: "Nothing is set at account creation — enter their pay rate in Accounting before the next payroll run.",
    link: ACCOUNTING_LINK,
    applies: (c) => !c.isTechnician,
  },
  {
    key: "csr_team_added",
    label: "Add them to a CSR team",
    detail: "Assign the new CSR to a team so they show up in the Team Leader dashboard and call routing.",
    link: CSR_DASHBOARD_LINK,
    applies: (c) => c.isCsr,
  },
  {
    key: "manager_notified",
    label: "Tell their manager they've been added",
    detail: "Give the reporting manager a heads-up so they can fold the new hire into schedules and assignments.",
    applies: () => true,
  },
];

function contextFor(role: string | null | undefined, extraRoles: string[] | null | undefined, assignedBranch: string | null | undefined): OnboardingContext {
  const roleTokens = [role, ...(extraRoles ?? [])];
  return {
    isTechnician: roleTokens.some((r) => TECHNICIAN_PAY_ROLES.has(normalizeRole(r))),
    isPhilippines: (assignedBranch ?? "").trim().toLowerCase() === "philippines",
    isCsr: isCsrRestrictedRole(role, extraRoles),
  };
}

/** Which task keys a given hire should get — same helper the seed and any future re-sync share. */
export function onboardingTaskKeysFor(role: string | null | undefined, extraRoles: string[] | null | undefined, assignedBranch: string | null | undefined): string[] {
  const ctx = contextFor(role, extraRoles, assignedBranch);
  return ONBOARDING_TASK_DEFS.filter((d) => d.applies(ctx)).map((d) => d.key);
}

/** 42P01 = table not created yet (0220 not applied) — treat as "no board" instead of throwing. */
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01";
}

/**
 * Seed the checklist for a just-created user. Best-effort and idempotent —
 * `ignoreDuplicates` on the (company_id, profile_id, task_key) unique key
 * means re-running never disturbs a task HR has already ticked.
 */
export async function seedOnboardingTasks(
  profileId: string,
  opts: { role: string | null | undefined; extraRoles: string[] | null | undefined; assignedBranch: string | null | undefined },
): Promise<void> {
  const keys = onboardingTaskKeysFor(opts.role, opts.extraRoles, opts.assignedBranch);
  if (keys.length === 0) return;
  const rows = keys.map((task_key) => ({ profile_id: profileId, task_key, status: "open" as const }));
  const { error } = await supabase
    .from("employee_onboarding_tasks")
    .upsert(rows, { onConflict: "company_id,profile_id,task_key", ignoreDuplicates: true });
  if (error && !isMissingTable(error)) throw new Error(error.message);
}

/** Every hire that still has at least one open task, newest first. */
export async function getOnboardingBoard(): Promise<OnboardingBoardEntry[]> {
  const { data, error } = await supabase
    .from("employee_onboarding_tasks")
    .select("profile_id, task_key, status, note, done_at, done_by_name, created_at, profile:profiles(display_name, role), doneBy:done_by(display_name)")
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }

  const byProfile = new Map<string, OnboardingBoardEntry>();
  for (const r of (data ?? []) as any[]) {
    let entry = byProfile.get(r.profile_id);
    if (!entry) {
      entry = {
        profileId: r.profile_id,
        name: r.profile?.display_name ?? "(unknown)",
        roleLabel: r.profile?.role ?? "",
        addedAt: r.created_at,
        tasks: [],
        openCount: 0,
        totalCount: 0,
      };
      byProfile.set(r.profile_id, entry);
    }
    entry.tasks.push({
      taskKey: r.task_key,
      status: r.status,
      note: r.note ?? null,
      doneByName: r.done_by_name ?? r.doneBy?.display_name ?? null,
      doneAt: r.done_at ?? null,
    });
    entry.totalCount += 1;
    if (r.status === "open") entry.openCount += 1;
    if (r.created_at < entry.addedAt) entry.addedAt = r.created_at;
  }

  // Order each entry's tasks by the template's own order, and drop any
  // profile whose checklist is fully resolved.
  const order = new Map(ONBOARDING_TASK_DEFS.map((d, i) => [d.key, i]));
  return [...byProfile.values()]
    .filter((e) => e.openCount > 0)
    .map((e) => ({ ...e, tasks: e.tasks.sort((a, b) => (order.get(a.taskKey) ?? 99) - (order.get(b.taskKey) ?? 99)) }))
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
}

export async function setOnboardingTaskStatus(
  profileId: string,
  taskKey: string,
  status: OnboardingTaskStatus,
  actorName: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("employee_onboarding_tasks")
    .update({ status, done_by_name: status === "open" ? null : actorName })
    .eq("profile_id", profileId)
    .eq("task_key", taskKey);
  if (error) throw new Error(error.message);
}

export async function setOnboardingTaskNote(profileId: string, taskKey: string, note: string): Promise<void> {
  const { error } = await supabase
    .from("employee_onboarding_tasks")
    .update({ note: note.trim() || null })
    .eq("profile_id", profileId)
    .eq("task_key", taskKey);
  if (error) throw new Error(error.message);
}

/** Clear a whole hire off the board — every still-open task becomes "na". */
export async function dismissOnboarding(profileId: string, actorName: string | null): Promise<void> {
  const { error } = await supabase
    .from("employee_onboarding_tasks")
    .update({ status: "na", done_by_name: actorName })
    .eq("profile_id", profileId)
    .eq("status", "open");
  if (error) throw new Error(error.message);
}
