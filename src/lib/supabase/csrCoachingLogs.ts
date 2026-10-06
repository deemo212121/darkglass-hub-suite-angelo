/**
 * CSR Coaching Log (migration 0356) — one row per coaching session.
 * Who may write which part, the signing order (person coached first, then
 * the creator) and the lock once both have signed are all enforced by the
 * table's triggers and RLS; this file just reads and writes.
 */
import { supabase } from "./client";

export interface CoachingLog {
  id: string;
  csrProfileId: string;
  csrName: string;
  teamLeaderProfileId: string | null;
  teamLeaderName: string | null;
  ticketNumber: string;
  team: string;
  coachingDate: string;
  summary: string;
  csrExplanation: string;
  coachingDiscussion: string;
  csrActionPlan: string;
  tlActionPlan: string;
  csrSignature: string | null;
  csrSignedName: string | null;
  csrSignedAt: string | null;
  creatorSignature: string | null;
  creatorSignedName: string | null;
  creatorSignedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByName: string | null;
}

export interface CoachingLogEvent {
  id: string;
  logId: string;
  action: "created" | "edited" | "csr_signed" | "creator_signed" | "deleted" | "restored";
  actorName: string | null;
  createdAt: string;
}

const COLUMNS =
  "id, csr_profile_id, csr_name, team_leader_profile_id, team_leader_name, ticket_number, team, coaching_date, summary, csr_explanation, coaching_discussion, csr_action_plan, tl_action_plan, csr_signature, csr_signed_name, csr_signed_at, creator_signature, creator_signed_name, creator_signed_at, created_by, created_by_name, created_at, updated_at, deleted_at, deleted_by_name";

const PAGE_SIZE = 1000;

function mapRow(r: any): CoachingLog {
  return {
    id: r.id,
    csrProfileId: r.csr_profile_id,
    csrName: r.csr_name ?? "",
    teamLeaderProfileId: r.team_leader_profile_id ?? null,
    teamLeaderName: r.team_leader_name ?? null,
    ticketNumber: r.ticket_number ?? "",
    team: r.team ?? "",
    coachingDate: r.coaching_date,
    summary: r.summary ?? "",
    csrExplanation: r.csr_explanation ?? "",
    coachingDiscussion: r.coaching_discussion ?? "",
    csrActionPlan: r.csr_action_plan ?? "",
    tlActionPlan: r.tl_action_plan ?? "",
    csrSignature: r.csr_signature ?? null,
    csrSignedName: r.csr_signed_name ?? null,
    csrSignedAt: r.csr_signed_at ?? null,
    creatorSignature: r.creator_signature ?? null,
    creatorSignedName: r.creator_signed_name ?? null,
    creatorSignedAt: r.creator_signed_at ?? null,
    createdBy: r.created_by ?? null,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    deletedByName: r.deleted_by_name ?? null,
  };
}

function friendly(message: string): string {
  if (/csr_coaching_logs|relation .* does not exist|schema cache/i.test(message) && /does not exist|schema cache/i.test(message)) {
    return "The Coaching Log isn't set up yet — run migration 0356 in Supabase first.";
  }
  return message;
}

/** Every coaching log the caller can see (RLS: all for TL/Manager/HR/Admin…, own for the person coached), deleted ones included. */
export async function getCoachingLogs(): Promise<CoachingLog[]> {
  const all: CoachingLog[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("csr_coaching_logs")
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

export interface NewCoachingLogInput {
  csrProfileId: string;
  csrName: string;
  teamLeaderProfileId: string | null;
  teamLeaderName: string | null;
  ticketNumber: string;
  team: string;
  coachingDate: string;
  summary: string;
  coachingDiscussion: string;
  tlActionPlan: string;
}

export async function createCoachingLog(input: NewCoachingLogInput): Promise<CoachingLog> {
  const { data, error } = await supabase
    .from("csr_coaching_logs")
    .insert({
      csr_profile_id: input.csrProfileId,
      csr_name: input.csrName,
      team_leader_profile_id: input.teamLeaderProfileId,
      team_leader_name: input.teamLeaderName,
      ticket_number: input.ticketNumber,
      team: input.team,
      coaching_date: input.coachingDate,
      summary: input.summary,
      coaching_discussion: input.coachingDiscussion,
      tl_action_plan: input.tlActionPlan,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(friendly(error.message));
  return mapRow(data);
}

/** Coach side: header + sections I, III, V. */
export interface CoachFieldsInput {
  teamLeaderProfileId: string | null;
  teamLeaderName: string | null;
  ticketNumber: string;
  team: string;
  coachingDate: string;
  summary: string;
  coachingDiscussion: string;
  tlActionPlan: string;
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<CoachingLog> {
  const { data, error } = await supabase.from("csr_coaching_logs").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw new Error(friendly(error.message));
  return mapRow(data);
}

export function saveCoachFields(id: string, f: CoachFieldsInput): Promise<CoachingLog> {
  return updateRow(id, {
    team_leader_profile_id: f.teamLeaderProfileId,
    team_leader_name: f.teamLeaderName,
    ticket_number: f.ticketNumber,
    team: f.team,
    coaching_date: f.coachingDate,
    summary: f.summary,
    coaching_discussion: f.coachingDiscussion,
    tl_action_plan: f.tlActionPlan,
  });
}

/** Person coached: sections II and IV. */
export function saveCsrFields(id: string, csrExplanation: string, csrActionPlan: string): Promise<CoachingLog> {
  return updateRow(id, { csr_explanation: csrExplanation, csr_action_plan: csrActionPlan });
}

/** The server stamps the signed-at time; the caller's role in the log decides which slot is allowed. */
export function signAsCsr(id: string, signature: string, signedName: string): Promise<CoachingLog> {
  return updateRow(id, { csr_signature: signature, csr_signed_name: signedName, csr_signed_at: new Date().toISOString() });
}

export function signAsCreator(id: string, signature: string, signedName: string): Promise<CoachingLog> {
  return updateRow(id, { creator_signature: signature, creator_signed_name: signedName, creator_signed_at: new Date().toISOString() });
}

export function deleteCoachingLog(id: string): Promise<CoachingLog> {
  return updateRow(id, { deleted_at: new Date().toISOString() });
}

export function restoreCoachingLog(id: string): Promise<CoachingLog> {
  return updateRow(id, { deleted_at: null });
}

/** Create / edit / sign / delete / restore history — readable by TL, Manager, HR, Senior Manager, Admin. */
export async function getCoachingLogEvents(): Promise<CoachingLogEvent[]> {
  const all: CoachingLogEvent[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("csr_coaching_log_events")
      .select("id, log_id, action, actor_name, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(friendly(error.message));
    all.push(...(data ?? []).map((r: any) => ({ id: r.id, logId: r.log_id, action: r.action, actorName: r.actor_name ?? null, createdAt: r.created_at })));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}
