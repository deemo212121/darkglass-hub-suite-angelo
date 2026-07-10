/**
 * HR Candidates — the hiring pipeline behind the HR & Recruitment
 * Dashboard's "Add Candidate" flow. A candidate moves applied ->
 * interviewing -> selected -> hired/rejected; CV files live in the
 * private `candidate-cvs` Storage bucket under
 * `{company_id}/{candidate_id}/{filename}`, referenced by `cv_path`.
 */

import { supabase } from "./client";

// "training" and "on_hold" added for EOD/EOM hiring reports (0047) —
// Interviewing/Training require a date (interview_date/training_start_date);
// Hired moves the matching hr_staffing_targets counter by ±1; On Hold and
// every other status are no-ops for that counter. See
// hr_update_candidate_status() in 0047_hr_hiring_reports.sql for where
// that side effect actually happens (atomically, alongside the status
// history log) — never via a plain `update hr_candidates set status=...`.
export type CandidateStatus = "applied" | "interviewing" | "selected" | "training" | "on_hold" | "hired" | "rejected";

export interface Candidate {
  id: string;
  companyId: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  branch: string | null;
  cvPath: string | null;
  status: CandidateStatus;
  interviewDate: string | null;      // required when status = "interviewing"
  trainingStartDate: string | null;  // required when status = "training"
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// `full_name` is the real column (the table predates this feature — see
// 0001_init.sql / 0030_hr_candidates.sql); mapped to `name` here so the
// rest of the app's Candidate type reads naturally.
const SELECT = "id, company_id, full_name, phone, email, position, branch, cv_path, status, interview_date, training_start_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back to this (pre-0047) SELECT if training_start_date doesn't
// exist yet — i.e. 0047_hr_hiring_reports.sql hasn't been run against this
// database. Without this, the whole Hiring tab would break on that one
// missing column alone, even though everything else about it still works.
const SELECT_LEGACY = "id, company_id, full_name, phone, email, position, branch, cv_path, status, interview_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";

/** Postgres 42703 = "column ... does not exist" — the 0047 migration hasn't been applied yet. */
function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

function fromRow(r: any): Candidate {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.full_name,
    phone: r.phone,
    email: r.email,
    position: r.position,
    branch: r.branch,
    cvPath: r.cv_path,
    status: r.status,
    interviewDate: r.interview_date,
    trainingStartDate: r.training_start_date ?? null,
    notes: r.notes,
    createdBy: r.created_by,
    createdByName: r.author?.display_name || r.author?.username || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getCandidates(): Promise<Candidate[]> {
  let { data, error }: { data: any[] | null; error: any } = await supabase
    .from("hr_candidates")
    .select(SELECT)
    .order("created_at", { ascending: false });
  if (isMissingColumnError(error)) {
    ({ data, error } = await supabase.from("hr_candidates").select(SELECT_LEGACY).order("created_at", { ascending: false }));
  }
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export async function addCandidate(input: {
  name: string;
  phone?: string;
  email?: string;
  position?: string;
  branch?: string;
  notes?: string;
}): Promise<Candidate> {
  const insertPayload = {
    full_name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    position: input.position?.trim() || null,
    branch: input.branch?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  let { data, error }: { data: any; error: any } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT).single();
  if (isMissingColumnError(error)) {
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT_LEGACY).single());
  }
  if (error) throw new Error(error.message);
  return fromRow(data);
}

/** Uploads a CV to the private bucket and records its path on the candidate row. */
export async function uploadCandidateCv(candidateId: string, companyId: string, file: File): Promise<void> {
  const path = `${companyId}/${candidateId}/${Date.now()}_${file.name}`;
  const { error: uploadError } = await supabase.storage.from("candidate-cvs").upload(path, file, { upsert: true });
  if (uploadError) throw new Error(uploadError.message);

  const { error } = await supabase.from("hr_candidates").update({ cv_path: path }).eq("id", candidateId);
  if (error) throw new Error(error.message);
}

/** Bucket is private — generate a short-lived signed URL on demand rather than caching one. */
export async function getCandidateCvUrl(cvPath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("candidate-cvs").createSignedUrl(cvPath, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/**
 * Longer-lived (30 day) signed URL for forwarding a CV through the internal
 * messenger — the 1hr URL from getCandidateCvUrl() above is fine for an
 * immediate "View CV" click, but would go dead almost immediately if
 * embedded in a chat message someone might open days later.
 */
export async function getCandidateCvUrlForForwarding(cvPath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("candidate-cvs").createSignedUrl(cvPath, 60 * 60 * 24 * 30);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/**
 * Changes a candidate's status via the hr_update_candidate_status() RPC
 * (0047_hr_hiring_reports.sql) instead of a plain table update — that
 * function atomically logs the transition to hr_candidate_status_history
 * and applies the Staff Needed ±1 effect for a hire/reversed hire, guarded
 * so re-saving the same status never double-logs or double-counts.
 * `effectiveDate` is the interview date (status = "interviewing") or
 * training start date (status = "training"); ignored for other statuses.
 */
export async function updateCandidateStatus(id: string, status: CandidateStatus, effectiveDate?: string): Promise<void> {
  const { error } = await supabase.rpc("hr_update_candidate_status", {
    p_candidate_id: id,
    p_new_status: status,
    p_effective_date: effectiveDate ?? null,
  });
  if (error) {
    // hr_update_candidate_status() comes from 0047_hr_hiring_reports.sql —
    // if that migration hasn't been run yet, fall back to a plain update so
    // basic status changes (the pre-existing behavior) keep working; the
    // history log and Staff Needed counter just won't apply until it's run.
    if (error.code === "PGRST202" || /could not find the function|function .* does not exist/i.test(error.message)) {
      const { error: legacyError } = await supabase.from("hr_candidates").update({ status }).eq("id", id);
      if (legacyError) throw new Error(legacyError.message);
      return;
    }
    throw new Error(error.message);
  }
}

export async function deleteCandidate(id: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// =====================================================================
// Staff Needed (per Position + Branch, manually entered by HR)
// =====================================================================

export interface StaffingTarget {
  id: string;
  position: string;
  branch: string;
  staffNeeded: number;
  updatedAt: string;
}

export async function getStaffingTargets(): Promise<StaffingTarget[]> {
  const { data, error } = await supabase
    .from("hr_staffing_targets")
    .select("id, position, branch, staff_needed, updated_at")
    .order("position")
    .order("branch");
  if (error) {
    // 42P01 = "relation does not exist" — 0047_hr_hiring_reports.sql hasn't
    // been run yet, so this table doesn't exist. No targets yet either way.
    if (error.code === "42P01") return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    position: r.position,
    branch: r.branch,
    staffNeeded: r.staff_needed,
    updatedAt: r.updated_at,
  }));
}

/** Sets the Staff Needed value for a Position+Branch (creates the row if it doesn't exist yet). */
export async function setStaffingTarget(position: string, branch: string, staffNeeded: number): Promise<void> {
  const { error } = await supabase
    .from("hr_staffing_targets")
    .upsert({ position, branch, staff_needed: staffNeeded }, { onConflict: "company_id,position,branch" });
  if (error) throw new Error(error.message);
}

// =====================================================================
// CV Forwards (for the "CVs Sent to BM/PM" report column)
// =====================================================================

/**
 * Records a "Forward CV" action — counted against the CANDIDATE's own
 * Position+Branch on the EOD/EOM reports (not the recipient's), per spec:
 * an Asheville candidate's CV forward counts on Asheville's row regardless
 * of which manager it was sent to.
 */
export async function logCvForward(candidateId: string, position: string | null, branch: string | null, recipientId: string): Promise<void> {
  const { error } = await supabase.from("hr_candidate_cv_forwards").insert({
    candidate_id: candidateId,
    position,
    branch,
    recipient_id: recipientId,
  });
  if (error) throw new Error(error.message);
}

// =====================================================================
// EOD / EOM Hiring Reports
// =====================================================================

export interface EodHiringRow {
  position: string;
  branch: string;
  staffNeeded: number;
  /** Candidates currently Interviewing for this branch, with their interview date. */
  scheduledInterviews: { name: string; date: string | null }[];
  /** Active trainees for this branch, with their start dates. */
  activeTrainees: { name: string; date: string | null }[];
  /** True if any candidate for this Position+Branch is currently On Hold. */
  onHold: boolean;
  /** All-time "Forward CV" actions logged for candidates at this Position+Branch. */
  cvsSentToBm: CvForwardDetail[];
}

export interface CvForwardDetail {
  candidateName: string;
  recipientName: string;
  date: string;
}

const UNSET_LABEL = "(Unassigned)";

/**
 * Live snapshot as of `dateStr` (YYYY-MM-DD), grouped by Position → Branch —
 * matches the company's existing EOD spreadsheet format: Staff Needed
 * (manual counter that already reflects hires via hr_update_candidate_status,
 * so there's no separate "Hired" column here), Active Trainee/On Hold
 * (combined — trainee count+date, or "on hold" if a candidate there is On
 * Hold), Scheduled Interviews (live headcount of anyone currently
 * Interviewing for that branch, not filtered to a specific interview date —
 * confirmed against the reference sheet rather than assumed), and CVs Sent
 * to BM (all-time count of Forward CV actions, not date-scoped — same
 * "running counter" treatment as Staff Needed).
 */
export async function getEodHiringReport(dateStr: string): Promise<EodHiringRow[]> {
  let [{ data: cands, error: candErr }, targets, forwards] = await Promise.all([
    supabase.from("hr_candidates").select("full_name, position, branch, status, interview_date, training_start_date"),
    getStaffingTargets(),
    getCvForwardDetails(),
  ]);
  if (isMissingColumnError(candErr)) {
    // training_start_date doesn't exist yet — fall back to a query without
    // it so existing candidates (and their Interviewing/On Hold counts)
    // still show, just without trainee start dates until 0047 is applied.
    ({ data: cands, error: candErr } = await supabase.from("hr_candidates").select("full_name, position, branch, status, interview_date"));
  }
  if (candErr) throw new Error(candErr.message);

  const map = new Map<string, EodHiringRow>();
  const keyOf = (p: string, b: string) => `${p}||${b}`;
  const ensure = (position: string, branch: string) => {
    const key = keyOf(position, branch);
    if (!map.has(key)) map.set(key, { position, branch, staffNeeded: 0, scheduledInterviews: [], activeTrainees: [], onHold: false, cvsSentToBm: [] });
    return map.get(key)!;
  };

  for (const t of targets) ensure(t.position || UNSET_LABEL, t.branch || UNSET_LABEL).staffNeeded = t.staffNeeded;

  for (const c of cands ?? []) {
    const row = ensure(c.position || UNSET_LABEL, c.branch || UNSET_LABEL);
    if (c.status === "interviewing") row.scheduledInterviews.push({ name: c.full_name, date: c.interview_date ?? null });
    if (c.status === "training") row.activeTrainees.push({ name: c.full_name, date: c.training_start_date ?? null });
    if (c.status === "on_hold") row.onHold = true;
  }

  for (const [key, details] of forwards) {
    const [position, branch] = key.split("||");
    ensure(position || UNSET_LABEL, branch || UNSET_LABEL).cvsSentToBm = details;
  }

  return Array.from(map.values()).sort((a, b) => a.position.localeCompare(b.position) || a.branch.localeCompare(b.branch));
}

/**
 * All-time CV-forward details per Position+Branch, keyed "{position}||{branch}" —
 * candidate name + recipient (manager) name + when, for the clickable "CVs Sent
 * to BM" popover. Returns an empty map if the table doesn't exist yet (0047 not
 * applied), same graceful-degradation treatment as the rest of this report.
 */
async function getCvForwardDetails(rangeStart?: string, rangeEnd?: string): Promise<Map<string, CvForwardDetail[]>> {
  const details = new Map<string, CvForwardDetail[]>();
  let query = supabase
    .from("hr_candidate_cv_forwards")
    .select("position, branch, created_at, candidate:candidate_id (full_name), recipient:recipient_id (display_name, username)")
    .order("created_at", { ascending: false });
  if (rangeStart) query = query.gte("created_at", rangeStart);
  if (rangeEnd) query = query.lt("created_at", rangeEnd);
  const { data, error } = await query;
  if (error) {
    if (error.code === "42P01") return details; // table doesn't exist yet
    throw new Error(error.message);
  }
  for (const r of (data ?? []) as any[]) {
    const key = `${r.position || ""}||${r.branch || ""}`;
    const list = details.get(key) ?? [];
    list.push({
      candidateName: r.candidate?.full_name || "(Unknown candidate)",
      recipientName: r.recipient?.display_name || r.recipient?.username || "(Unknown recipient)",
      date: r.created_at,
    });
    details.set(key, list);
  }
  return details;
}

/**
 * Same Position → Branch table as `getEodHiringReport`, just evaluated as of
 * the end of `yearMonth` instead of "right now". Staff Needed is still the
 * current live target (there's no "monthly" variant of a manually-set
 * headcount target).
 *
 * Scheduled Interviews / Active Trainee / On Hold reduce each candidate down
 * to their LATEST status-history entry at or before the end of the month —
 * not every transition in the range — so e.g. Training → Interviewing drops
 * the candidate out of Active Trainee exactly like EOD's live snapshot does,
 * instead of leaving a stale training entry sitting alongside the new
 * interviewing one. Only whichever status was actually true as of month-end
 * counts, which also means a candidate who's been training since a prior
 * month still shows up this month if nothing has changed since — a real
 * point-in-time snapshot, not a tally of this month's events.
 */
export async function getEomHiringReport(yearMonth: string): Promise<EodHiringRow[]> {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01T00:00:00`;
  const nextMonth = m === 12 ? `${y + 1}-01-01T00:00:00` : `${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00`;

  const [{ data, error }, targets, forwards] = await Promise.all([
    supabase
      .from("hr_candidate_status_history")
      .select("candidate_id, position, branch, to_status, effective_date, created_at, candidate:candidate_id (full_name)")
      .lt("created_at", nextMonth)
      .order("created_at", { ascending: true }),
    getStaffingTargets(),
    getCvForwardDetails(start, nextMonth),
  ]);
  // 42P01 = table doesn't exist yet (0047 not applied) — treat as no activity yet rather than erroring.
  if (error && error.code !== "42P01") throw new Error(error.message);

  // Rows come back oldest-first, so the last write per candidate_id is their
  // status as of the end of this month.
  const latestByCandidate = new Map<string, any>();
  for (const r of (data ?? []) as any[]) latestByCandidate.set(r.candidate_id, r);

  const map = new Map<string, EodHiringRow>();
  const keyOf = (p: string, b: string) => `${p}||${b}`;
  const ensure = (position: string, branch: string) => {
    const key = keyOf(position, branch);
    if (!map.has(key)) map.set(key, { position, branch, staffNeeded: 0, scheduledInterviews: [], activeTrainees: [], onHold: false, cvsSentToBm: [] });
    return map.get(key)!;
  };

  for (const t of targets) ensure(t.position || UNSET_LABEL, t.branch || UNSET_LABEL).staffNeeded = t.staffNeeded;

  for (const r of latestByCandidate.values()) {
    if (r.to_status !== "interviewing" && r.to_status !== "training" && r.to_status !== "on_hold") continue;
    const row = ensure(r.position || UNSET_LABEL, r.branch || UNSET_LABEL);
    const name = r.candidate?.full_name || "(Unknown candidate)";
    const date = r.effective_date ?? r.created_at ?? null;
    if (r.to_status === "interviewing") row.scheduledInterviews.push({ name, date });
    else if (r.to_status === "training") row.activeTrainees.push({ name, date });
    else if (r.to_status === "on_hold") row.onHold = true;
  }

  for (const [key, details] of forwards) {
    const [position, branch] = key.split("||");
    ensure(position || UNSET_LABEL, branch || UNSET_LABEL).cvsSentToBm = details;
  }

  return Array.from(map.values()).sort((a, b) => a.position.localeCompare(b.position) || a.branch.localeCompare(b.branch));
}
