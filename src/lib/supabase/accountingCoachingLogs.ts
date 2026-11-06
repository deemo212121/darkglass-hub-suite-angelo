/**
 * Accounting Coaching Log (migration 0431) — one row per coaching session.
 * Who may write which part, the signing order (person coached first, then
 * the creator) and the lock once both have signed are all enforced by the
 * table's triggers and RLS; this file just reads and writes. A copy of
 * csrCoachingLogs.ts with its own tables, so the two departments never mix.
 */
import { supabase } from "./client";
import { getOrCreateDmThread, sendMessage } from "./messaging";
import { createNotification } from "./notifications";
import { getAppUrl } from "../appUrl";

export interface AccountingCoachingLog {
  id: string;
  employeeProfileId: string;
  employeeName: string;
  coachProfileId: string | null;
  coachName: string | null;
  issue: string;
  coachingDate: string;
  summary: string;
  employeeExplanation: string;
  coachingDiscussion: string;
  employeeActionPlan: string;
  coachActionPlan: string;
  employeeSignature: string | null;
  employeeSignedName: string | null;
  employeeSignedAt: string | null;
  creatorSignature: string | null;
  creatorSignedName: string | null;
  creatorSignedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByName: string | null;
  /** Last time the coach sent it to the person coached. */
  sentAt: string | null;
  sentByName: string | null;
}

export interface AccountingCoachingLogEvent {
  id: string;
  logId: string;
  action: "created" | "edited" | "sent" | "employee_signed" | "creator_signed" | "deleted" | "restored";
  actorName: string | null;
  createdAt: string;
}

const COLUMNS =
  "id, employee_profile_id, employee_name, coach_profile_id, coach_name, issue, coaching_date, summary, employee_explanation, coaching_discussion, employee_action_plan, coach_action_plan, employee_signature, employee_signed_name, employee_signed_at, creator_signature, creator_signed_name, creator_signed_at, created_by, created_by_name, created_at, updated_at, deleted_at, deleted_by_name, sent_at, sent_by_name";

const PAGE_SIZE = 1000;

function mapRow(r: any): AccountingCoachingLog {
  return {
    id: r.id,
    employeeProfileId: r.employee_profile_id,
    employeeName: r.employee_name ?? "",
    coachProfileId: r.coach_profile_id ?? null,
    coachName: r.coach_name ?? null,
    issue: r.issue ?? "",
    coachingDate: r.coaching_date,
    summary: r.summary ?? "",
    employeeExplanation: r.employee_explanation ?? "",
    coachingDiscussion: r.coaching_discussion ?? "",
    employeeActionPlan: r.employee_action_plan ?? "",
    coachActionPlan: r.coach_action_plan ?? "",
    employeeSignature: r.employee_signature ?? null,
    employeeSignedName: r.employee_signed_name ?? null,
    employeeSignedAt: r.employee_signed_at ?? null,
    creatorSignature: r.creator_signature ?? null,
    creatorSignedName: r.creator_signed_name ?? null,
    creatorSignedAt: r.creator_signed_at ?? null,
    createdBy: r.created_by ?? null,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    deletedByName: r.deleted_by_name ?? null,
    sentAt: r.sent_at ?? null,
    sentByName: r.sent_by_name ?? null,
  };
}

function friendly(message: string): string {
  if (/accounting_coaching_log|relation .* does not exist|schema cache/i.test(message) && /does not exist|schema cache/i.test(message)) {
    return "The Coaching Log's database tables are missing or out of date — run the latest migration 0431 in Supabase.";
  }
  return message;
}

/** Every coaching log the caller can see (RLS: all for Admin/HR/Senior Manager, own for the person coached), deleted ones included. */
export async function getAccountingCoachingLogs(): Promise<AccountingCoachingLog[]> {
  const all: AccountingCoachingLog[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("accounting_coaching_logs")
      .select(COLUMNS)
      .order("coaching_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(friendly(error.message));
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

export interface NewAccountingCoachingLogInput {
  employeeProfileId: string;
  employeeName: string;
  issue: string;
  coachingDate: string;
  summary: string;
  coachingDiscussion: string;
  coachActionPlan: string;
}

/** The server fills in the coach: whoever creates the log. */
export async function createAccountingCoachingLog(input: NewAccountingCoachingLogInput): Promise<AccountingCoachingLog> {
  const row = {
    employee_profile_id: input.employeeProfileId,
    employee_name: input.employeeName,
    issue: input.issue,
    coaching_date: input.coachingDate,
    summary: input.summary,
    coaching_discussion: input.coachingDiscussion,
    coach_action_plan: input.coachActionPlan,
  };
  const { data, error } = await supabase.from("accounting_coaching_logs").insert(row).select(COLUMNS).single();
  if (error) throw new Error(friendly(error.message));
  return mapRow(data);
}

/** Coach side: header + sections I, III, V. */
export interface AccountingCoachFieldsInput {
  issue: string;
  coachingDate: string;
  summary: string;
  coachingDiscussion: string;
  coachActionPlan: string;
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<AccountingCoachingLog> {
  const { data, error } = await supabase.from("accounting_coaching_logs").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw new Error(friendly(error.message));
  return mapRow(data);
}

export function saveAccountingCoachFields(id: string, f: AccountingCoachFieldsInput): Promise<AccountingCoachingLog> {
  return updateRow(id, {
    issue: f.issue,
    coaching_date: f.coachingDate,
    summary: f.summary,
    coaching_discussion: f.coachingDiscussion,
    coach_action_plan: f.coachActionPlan,
  });
}

/** Person coached: sections II and IV. */
export function saveAccountingStaffFields(id: string, employeeExplanation: string, employeeActionPlan: string): Promise<AccountingCoachingLog> {
  return updateRow(id, { employee_explanation: employeeExplanation, employee_action_plan: employeeActionPlan });
}

/** The server stamps the signed-at time; the caller's role in the log decides which slot is allowed. */
export function signAsAccountingStaff(id: string, signature: string, signedName: string): Promise<AccountingCoachingLog> {
  return updateRow(id, { employee_signature: signature, employee_signed_name: signedName, employee_signed_at: new Date().toISOString() });
}

export function signAsAccountingCoach(id: string, signature: string, signedName: string): Promise<AccountingCoachingLog> {
  return updateRow(id, { creator_signature: signature, creator_signed_name: signedName, creator_signed_at: new Date().toISOString() });
}

/** Coach side: stamp "sent" (the server sets the time and sender). */
export function markAccountingCoachingLogSent(id: string): Promise<AccountingCoachingLog> {
  return updateRow(id, { sent_at: new Date().toISOString() });
}

export function deleteAccountingCoachingLog(id: string): Promise<AccountingCoachingLog> {
  return updateRow(id, { deleted_at: new Date().toISOString() });
}

export function restoreAccountingCoachingLog(id: string): Promise<AccountingCoachingLog> {
  return updateRow(id, { deleted_at: null });
}

/** Create / edit / send / sign / delete / restore history — readable by Admin, HR, Senior Manager. */
export async function getAccountingCoachingLogEvents(): Promise<AccountingCoachingLogEvent[]> {
  const all: AccountingCoachingLogEvent[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("accounting_coaching_log_events")
      .select("id, log_id, action, actor_name, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(friendly(error.message));
    all.push(...(data ?? []).map((r: any) => ({ id: r.id, logId: r.log_id, action: r.action, actorName: r.actor_name ?? null, createdAt: r.created_at })));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Status — shared by the page and the "waiting on you" badges.
// ---------------------------------------------------------------------------

export type AccountingCoachingStatus = "coach" | "staff" | "staff_sign" | "creator_sign" | "locked";

type StatusFields = Pick<AccountingCoachingLog, "summary" | "employeeExplanation" | "coachingDiscussion" | "employeeActionPlan" | "coachActionPlan" | "employeeSignedAt" | "creatorSignedAt">;

export function accountingCoachingStatus(l: StatusFields): AccountingCoachingStatus {
  if (l.employeeSignedAt && l.creatorSignedAt) return "locked";
  if (l.employeeSignedAt) return "creator_sign";
  if (!l.summary.trim() || !l.coachingDiscussion.trim() || !l.coachActionPlan.trim()) return "coach";
  if (!l.employeeExplanation.trim() || !l.employeeActionPlan.trim()) return "staff";
  return "staff_sign";
}

/** The person coached has to fill in / sign, or the creator has to sign. */
export function isAccountingCoachingWaitingOn(l: StatusFields & Pick<AccountingCoachingLog, "employeeProfileId" | "createdBy" | "deletedAt">, profileId: string | null): boolean {
  if (!profileId || l.deletedAt) return false;
  const s = accountingCoachingStatus(l);
  if (l.employeeProfileId === profileId) return s === "staff" || s === "staff_sign";
  if (l.createdBy === profileId) return s === "creator_sign";
  return false;
}

/** How many coaching logs are waiting on this person — for the Home / module badges. */
export async function getAccountingCoachingWaitingCount(profileId: string): Promise<number> {
  const { data, error } = await supabase
    .from("accounting_coaching_logs")
    .select("employee_profile_id, created_by, summary, employee_explanation, coaching_discussion, employee_action_plan, coach_action_plan, employee_signed_at, creator_signed_at, deleted_at")
    .or(`employee_profile_id.eq.${profileId},created_by.eq.${profileId}`)
    .is("deleted_at", null)
    .is("creator_signed_at", null);
  if (error) return 0;
  return (data ?? []).map(mapRow).filter((l) => isAccountingCoachingWaitingOn(l, profileId)).length;
}

// ---------------------------------------------------------------------------
// Sending — like the other forms: a Team Messenger message from the sender
// with a link to the log, plus a bell notification.
// ---------------------------------------------------------------------------

export function accountingCoachingLogPath(id: string): string {
  return `/m/accounting/accounting-coaching-log?log=${id}`;
}

export async function sendAccountingCoachingLogMessage(input: { fromId: string; fromName: string; toId: string; logId: string; body: string }): Promise<void> {
  const link = `${getAppUrl()}${accountingCoachingLogPath(input.logId)}`;
  const thread = await getOrCreateDmThread(input.fromId, input.toId);
  await sendMessage({ dmThreadId: thread.id, senderId: input.fromId, senderName: input.fromName, body: `${input.body} Open it here: ${link}` });
  await createNotification({
    recipientId: input.toId,
    senderId: input.fromId,
    senderName: input.fromName,
    body: input.body,
    linkTo: accountingCoachingLogPath(input.logId),
  }).catch(() => undefined);
}
