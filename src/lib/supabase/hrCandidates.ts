/**
 * HR Candidates — the hiring pipeline behind the HR & Recruitment
 * Dashboard's "Add Candidate" flow. A candidate moves applied ->
 * interviewing -> selected -> hired/rejected; CV files live in the
 * private `candidate-cvs` Storage bucket under
 * `{company_id}/{candidate_id}/{filename}`, referenced by `cv_path`.
 */

import { supabase } from "./client";

// "training" and "on_hold" added for EOD/EOM hiring reports (0048); "phone_screening",
// "withdrawn", and "cancelled" added (and "on_hold" removed) by 0221_hr_candidates_status_update.sql.
// Interviewing/Training/Withdrawn each require a date (interview_date/
// training_start_date/withdrawn_date); Hired moves the matching
// hr_staffing_targets counter by ±1; every other status is a no-op for
// that counter. See hr_update_candidate_status() in
// 0048_hr_hiring_reports.sql (updated by 0221) for where that side effect
// actually happens (atomically, alongside the status history log) — never
// via a plain `update hr_candidates set status=...`.
export type CandidateStatus = "applied" | "phone_screening" | "interviewing" | "selected" | "training" | "hired" | "rejected" | "withdrawn" | "cancelled";

export interface Candidate {
  id: string;
  companyId: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  branch: string | null;
  department: string | null;
  branchManagerId: string | null;  // manually-assigned override for the Hiring table's auto-derived Branch Manager column
  assignedInterviewerId: string | null;  // HR person running this candidate's interview process
  trainerId: string | null;  // who's training this candidate, set from the Training status dialog
  source: string | null;  // where the applicant was found — "Indeed" / "ZipRecruiter" / free text for "Other"
  textedAm: boolean;
  textedPm: boolean;
  calledAm: boolean;
  calledPm: boolean;
  cvPath: string | null;
  status: CandidateStatus;
  interviewDate: string | null;      // required when status = "interviewing"
  interviewTime: string | null;      // optional "HH:MM", settable alongside interviewDate — powers the Interview Calendar tab
  interviewTimezone: "CST" | "EST" | null;  // which zone interviewTime is in — same two zones profiles.schedule_timezone uses
  trainingStartDate: string | null;  // required when status = "training"
  trainingEndDate: string | null;    // optional, settable alongside trainingStartDate
  withdrawnDate: string | null;      // required when status = "withdrawn"
  notes: string | null;              // "HR Note" in the UI
  screeningNote: string | null;
  interviewerNote: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// `full_name` is the real column (the table predates this feature — see
// 0001_init.sql / 0030_hr_candidates.sql); mapped to `name` here so the
// rest of the app's Candidate type reads naturally.
const SELECT = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, notes, screening_note, interviewer_note, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back to this if screening_note/interviewer_note don't exist yet —
// i.e. 0241_hr_candidates_screening_interviewer_notes.sql hasn't been run
// against this database, but 0238_hr_candidates_trainer.sql has.
const SELECT_V10 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if trainer_id doesn't exist either — i.e.
// 0238 hasn't run, but 0234_hr_candidates_source.sql has.
const SELECT_V9 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if source doesn't exist either — i.e.
// 0234 hasn't run, but 0233_hr_candidates_interview_timezone.sql has.
const SELECT_V8 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if interview_timezone doesn't exist either —
// i.e. 0233 hasn't run, but 0232_hr_candidates_interview_time.sql has.
const SELECT_V7 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if interview_time doesn't exist either —
// i.e. 0232 hasn't run, but 0231_hr_candidates_assigned_interviewer.sql has.
const SELECT_V6 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if assigned_interviewer_id doesn't exist
// either — i.e. 0231 hasn't run, but 0230_hr_candidates_outreach.sql has.
const SELECT_V5 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if texted_am/texted_pm/called_am/called_pm
// don't exist either — i.e. 0230 hasn't run, but
// 0229_hr_candidates_department_branch_manager.sql has.
const SELECT_V4 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, cv_path, status, interview_date, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if department/branch_manager_id don't exist
// yet either — i.e. 0229 hasn't run, but 0227_hr_candidates_training_end_date.sql has.
const SELECT_V3 = "id, company_id, full_name, phone, email, position, branch, cv_path, status, interview_date, training_start_date, training_end_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if training_end_date doesn't exist yet — i.e.
// 0227 hasn't been run either, but 0221_hr_candidates_status_update.sql has.
const SELECT_V2 = "id, company_id, full_name, phone, email, position, branch, cv_path, status, interview_date, training_start_date, withdrawn_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if withdrawn_date doesn't exist yet either —
// i.e. 0221 hasn't run, but 0048_hr_hiring_reports.sql has.
const SELECT_V1 = "id, company_id, full_name, phone, email, position, branch, cv_path, status, interview_date, training_start_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further still to this (pre-0048) SELECT if training_start_date
// doesn't exist yet either. Without these fallbacks, the whole Hiring tab
// would break on one missing column alone, even though everything else
// about it still works.
const SELECT_LEGACY = "id, company_id, full_name, phone, email, position, branch, cv_path, status, interview_date, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";

/** Postgres 42703 = "column ... does not exist" — a newer migration hasn't been applied yet. */
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
    department: r.department ?? null,
    branchManagerId: r.branch_manager_id ?? null,
    assignedInterviewerId: r.assigned_interviewer_id ?? null,
    trainerId: r.trainer_id ?? null,
    source: r.source ?? null,
    textedAm: r.texted_am ?? false,
    textedPm: r.texted_pm ?? false,
    calledAm: r.called_am ?? false,
    calledPm: r.called_pm ?? false,
    cvPath: r.cv_path,
    status: r.status,
    interviewDate: r.interview_date,
    interviewTime: r.interview_time ?? null,
    interviewTimezone: r.interview_timezone ?? null,
    trainingStartDate: r.training_start_date ?? null,
    trainingEndDate: r.training_end_date ?? null,
    withdrawnDate: r.withdrawn_date ?? null,
    notes: r.notes,
    screeningNote: r.screening_note ?? null,
    interviewerNote: r.interviewer_note ?? null,
    createdBy: r.created_by,
    createdByName: r.author?.display_name || r.author?.username || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Supabase caps an unbounded select at 1000 rows — a company's full
// candidate pipeline can exceed that. Page through in chunks of 1000.
// (Named distinctly from getEomHiringReport's own PAGE_SIZE further down —
// same file, same fix, but a separate function's constant.)
const CANDIDATES_PAGE_SIZE = 1000;

export async function getCandidates(): Promise<Candidate[]> {
  const all: any[] = [];
  let select = SELECT;
  for (let from = 0; ; from += CANDIDATES_PAGE_SIZE) {
    let { data, error }: { data: any[] | null; error: any } = await supabase
      .from("hr_candidates")
      .select(select)
      .order("created_at", { ascending: false })
      .range(from, from + CANDIDATES_PAGE_SIZE - 1);
    if (isMissingColumnError(error) && select === SELECT) {
      select = SELECT_V10;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V10) {
      select = SELECT_V9;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V9) {
      select = SELECT_V8;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V8) {
      select = SELECT_V7;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V7) {
      select = SELECT_V6;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V6) {
      select = SELECT_V5;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V5) {
      select = SELECT_V4;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V4) {
      select = SELECT_V3;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V3) {
      select = SELECT_V2;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V2) {
      select = SELECT_V1;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error)) {
      select = SELECT_LEGACY;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < CANDIDATES_PAGE_SIZE) break;
  }
  return all.map(fromRow);
}

export async function addCandidate(input: {
  name: string;
  phone?: string;
  email?: string;
  position?: string;
  branch?: string;
  department?: string;
  branchManagerId?: string;
  assignedInterviewerId?: string;
  source?: string;
  notes?: string;
}): Promise<Candidate> {
  const basePayload = {
    full_name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    position: input.position?.trim() || null,
    branch: input.branch?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  // Assigned Interviewer is optional — HR can leave it blank and set it
  // later from the Hiring table's own inline edit, same as it always could.
  const insertPayloadNoInterviewer = {
    ...basePayload,
    department: input.department?.trim() || null,
    branch_manager_id: input.branchManagerId || null,
  };
  const insertPayloadNoSource = {
    ...insertPayloadNoInterviewer,
    assigned_interviewer_id: input.assignedInterviewerId || null,
  };
  const insertPayload = {
    ...insertPayloadNoSource,
    source: input.source?.trim() || null,
  };
  let { data, error }: { data: any; error: any } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT).single();
  if (isMissingColumnError(error)) {
    // trainer_id (0238) not applied yet — the insert never referenced it
    // (not an Add Candidate input, only settable later via the Training
    // status dialog), only the RETURNING select did.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT_V9).single());
  }
  if (isMissingColumnError(error)) {
    // source (0230) not applied yet — the insert itself referenced it this
    // time (unlike interview_time/timezone below, source IS a real Add
    // Candidate input), so retry with it dropped from the payload too.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayloadNoSource).select(SELECT_V8).single());
  }
  if (isMissingColumnError(error)) {
    // interview_timezone (0229) not applied yet — same story, the insert
    // never referenced it, only the RETURNING select did.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayloadNoSource).select(SELECT_V7).single());
  }
  if (isMissingColumnError(error)) {
    // interview_time (0228) not applied yet — same story, the insert never
    // referenced it, only the RETURNING select did.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayloadNoSource).select(SELECT_V6).single());
  }
  if (isMissingColumnError(error)) {
    // assigned_interviewer_id (0227) not applied yet — the insert itself
    // referenced it this time (it's now a real, optional Add Candidate
    // input), so retry with it dropped from the payload too.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayloadNoInterviewer).select(SELECT_V5).single());
  }
  if (isMissingColumnError(error)) {
    // texted_am/texted_pm/called_am/called_pm (0226) not applied yet — the
    // insert itself never referenced them (they're DB-defaulted, not part
    // of Add Candidate), only the RETURNING select did, so retry with the
    // same insertPayload against one column fewer in the select.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayloadNoInterviewer).select(SELECT_V4).single());
  }
  if (isMissingColumnError(error)) {
    // department/branch_manager_id (0225) not applied yet either — retry without them.
    ({ data, error } = await supabase.from("hr_candidates").insert(basePayload).select(SELECT_V3).single());
  }
  if (isMissingColumnError(error)) {
    ({ data, error } = await supabase.from("hr_candidates").insert(basePayload).select(SELECT_V2).single());
  }
  if (isMissingColumnError(error)) {
    ({ data, error } = await supabase.from("hr_candidates").insert(basePayload).select(SELECT_V1).single());
  }
  if (isMissingColumnError(error)) {
    ({ data, error } = await supabase.from("hr_candidates").insert(basePayload).select(SELECT_LEGACY).single());
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
 * `trainingEndDate` (0227_hr_candidates_training_end_date.sql) only ever
 * applies alongside status = "training", set together with the start date
 * from the same dialog. `interviewTime`/`interviewTimezone`
 * (0232/0233_hr_candidates_interview_time*.sql) only ever apply alongside
 * status = "interviewing".
 */
export async function updateCandidateStatus(
  id: string,
  status: CandidateStatus,
  effectiveDate?: string,
  trainingEndDate?: string,
  interviewTime?: string,
  interviewTimezone?: string
): Promise<void> {
  const isMissingFunctionError = (err: { code?: string; message?: string } | null) =>
    !!err && (err.code === "PGRST202" || /could not find the function|function .* does not exist/i.test(err.message ?? ""));

  let { error } = await supabase.rpc("hr_update_candidate_status", {
    p_candidate_id: id,
    p_new_status: status,
    p_effective_date: effectiveDate ?? null,
    p_training_end_date: trainingEndDate ?? null,
    p_interview_time: interviewTime ?? null,
    p_interview_timezone: interviewTimezone ?? null,
  });
  if (isMissingFunctionError(error)) {
    // Retry without p_interview_timezone — interview_timezone (0229) might
    // just not be applied yet even though the 5-arg RPC (0228) is, which
    // would otherwise make this look like the RPC doesn't exist at all.
    ({ error } = await supabase.rpc("hr_update_candidate_status", {
      p_candidate_id: id,
      p_new_status: status,
      p_effective_date: effectiveDate ?? null,
      p_training_end_date: trainingEndDate ?? null,
      p_interview_time: interviewTime ?? null,
    }));
  }
  if (isMissingFunctionError(error)) {
    // Retry without p_interview_time either — interview_time (0228) might
    // not be applied yet, only the 4-arg RPC (0223).
    ({ error } = await supabase.rpc("hr_update_candidate_status", {
      p_candidate_id: id,
      p_new_status: status,
      p_effective_date: effectiveDate ?? null,
      p_training_end_date: trainingEndDate ?? null,
    }));
  }
  if (error) {
    // hr_update_candidate_status() comes from 0047_hr_hiring_reports.sql —
    // if that migration hasn't been run yet, fall back to a plain update so
    // basic status changes (the pre-existing behavior) keep working; the
    // history log and Staff Needed counter just won't apply until it's run.
    if (isMissingFunctionError(error)) {
      const { error: legacyError } = await supabase.from("hr_candidates").update({ status }).eq("id", id);
      if (legacyError) throw new Error(legacyError.message);
      return;
    }
    throw new Error(error.message);
  }
}

/** Updates just the free-text note on a candidate row — separate from addCandidate's initial `notes` so HR can jot down/revise something after the fact (e.g. interview impressions) without touching status. */
export async function updateCandidateNotes(id: string, notes: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").update({ notes: notes.trim() || null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Updates the Screening Note — a separate slot from the general HR note (updateCandidateNotes above) and the Interviewer Note below, so each role's write never clobbers another's. See 0241_hr_candidates_screening_interviewer_notes.sql. */
export async function updateCandidateScreeningNote(id: string, note: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").update({ screening_note: note.trim() || null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Updates the Interviewer Note — see updateCandidateScreeningNote above for why this is a separate column from `notes`. */
export async function updateCandidateInterviewerNote(id: string, note: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").update({ interviewer_note: note.trim() || null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Flips one texted/called AM/PM flag (0226) — the Hiring table's "Texted / Called" column toggles these directly, one at a time, no popup. */
export async function setCandidateOutreach(
  id: string,
  field: "textedAm" | "textedPm" | "calledAm" | "calledPm",
  value: boolean
): Promise<void> {
  const column = { textedAm: "texted_am", textedPm: "texted_pm", calledAm: "called_am", calledPm: "called_pm" }[field];
  const { error } = await supabase.from("hr_candidates").update({ [column]: value }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Corrects a candidate's own on-file info (name/phone/email/position/
 * branch) — separate from updateCandidateStatus (which goes through the
 * hr_update_candidate_status() RPC for its Staff Needed/history side
 * effects). Plain update is fine here: none of these fields have any side
 * effect of their own. Chiefly needed to fix an email typo that's making
 * the Account Status column read "Not Created" even though a real account
 * already exists under the correct address — email is the only field
 * hr_candidates and profiles share, so a mismatch there is silent
 * otherwise.
 */
export async function updateCandidateFields(
  id: string,
  fields: Partial<{ name: string; phone: string; email: string; position: string; branch: string; department: string; branchManagerId: string; assignedInterviewerId: string; trainerId: string; source: string }>
): Promise<void> {
  const payload: Record<string, string | null> = {};
  if (fields.name !== undefined) payload.full_name = fields.name.trim();
  if (fields.phone !== undefined) payload.phone = fields.phone.trim() || null;
  if (fields.email !== undefined) payload.email = fields.email.trim() || null;
  if (fields.position !== undefined) payload.position = fields.position.trim() || null;
  if (fields.branch !== undefined) payload.branch = fields.branch.trim() || null;
  if (fields.department !== undefined) payload.department = fields.department.trim() || null;
  if (fields.branchManagerId !== undefined) payload.branch_manager_id = fields.branchManagerId.trim() || null;
  if (fields.assignedInterviewerId !== undefined) payload.assigned_interviewer_id = fields.assignedInterviewerId.trim() || null;
  if (fields.trainerId !== undefined) payload.trainer_id = fields.trainerId.trim() || null;
  if (fields.source !== undefined) payload.source = fields.source.trim() || null;
  const { error } = await supabase.from("hr_candidates").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCandidate(id: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Who last changed each candidate's status, and when — for the Hiring
 * table's "Changed by" line under the Status dropdown. Reads
 * hr_candidate_status_history (0048_hr_hiring_reports.sql), which
 * hr_update_candidate_status() already logs a row to on every real status
 * transition (not on a same-status date reschedule — see that function's
 * own comment) — no separate "last edited by" column on hr_candidates
 * itself needed. Rows come back newest-first per candidate_id, so the
 * first one seen per candidate as we page through is its latest.
 */
export interface StatusChange {
  changedByName: string | null;
  changedAt: string;
}

const STATUS_HISTORY_PAGE_SIZE = 1000;

export async function getLatestStatusChanges(): Promise<Map<string, StatusChange>> {
  const map = new Map<string, StatusChange>();
  for (let from = 0; ; from += STATUS_HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hr_candidate_status_history")
      .select("candidate_id, created_at, author:changed_by (display_name, username)")
      .order("created_at", { ascending: false })
      .range(from, from + STATUS_HISTORY_PAGE_SIZE - 1);
    if (error) {
      // 42P01 = table doesn't exist yet (0048 not applied) — no history to show.
      if (error.code === "42P01") return map;
      console.error("getLatestStatusChanges error:", error.message);
      return map;
    }
    for (const r of (data ?? []) as any[]) {
      if (map.has(r.candidate_id)) continue; // already have this candidate's latest (newest-first order)
      map.set(r.candidate_id, {
        changedByName: r.author?.display_name || r.author?.username || null,
        changedAt: r.created_at,
      });
    }
    if (!data || data.length < STATUS_HISTORY_PAGE_SIZE) break;
  }
  return map;
}

/**
 * Generic "who last edited this column" audit trail (0239) for the Hiring
 * table's inline-editable fields — Status (and Trainer, set alongside it)
 * already has its own dedicated history table/RPC (hr_candidate_status_
 * history) and isn't logged here too.
 */
export interface FieldEdit {
  changedByName: string | null;
  changedAt: string;
}

/** Fire-and-forget — a logging failure should never block the actual field save it's attached to. */
export async function logCandidateFieldEdit(candidateId: string, fieldName: string): Promise<void> {
  try {
    const { error } = await supabase.from("hr_candidate_field_edits").insert({ candidate_id: candidateId, field_name: fieldName });
    if (error && error.code !== "42P01") console.error("logCandidateFieldEdit error:", error.message);
  } catch (err) {
    console.error("logCandidateFieldEdit error:", err);
  }
}

const FIELD_EDIT_PAGE_SIZE = 1000;

/** Latest edit per (candidate, field), company-wide — one bulk paginated fetch, keyed "candidateId||fieldName". */
export async function getLatestFieldEdits(): Promise<Map<string, FieldEdit>> {
  const map = new Map<string, FieldEdit>();
  for (let from = 0; ; from += FIELD_EDIT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hr_candidate_field_edits")
      .select("candidate_id, field_name, created_at, author:changed_by (display_name, username)")
      .order("created_at", { ascending: false })
      .range(from, from + FIELD_EDIT_PAGE_SIZE - 1);
    if (error) {
      // 42P01 = table doesn't exist yet (0239 not applied) — no history to show.
      if (error.code === "42P01") return map;
      console.error("getLatestFieldEdits error:", error.message);
      return map;
    }
    for (const r of (data ?? []) as any[]) {
      const key = `${r.candidate_id}||${r.field_name}`;
      if (map.has(key)) continue; // already have this candidate/field's latest (newest-first order)
      map.set(key, {
        changedByName: r.author?.display_name || r.author?.username || null,
        changedAt: r.created_at,
      });
    }
    if (!data || data.length < FIELD_EDIT_PAGE_SIZE) break;
  }
  return map;
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
    // "on_hold" was removed as a status (0221) — "cancelled" is the closest
    // successor for "hiring paused for this position/branch" (as opposed to
    // "withdrawn", which is the candidate's own choice to drop out).
    if (c.status === "cancelled") row.onHold = true;
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
// Supabase caps an unbounded select at 1000 rows — this only has an upper
// bound (created_at < nextMonth), no lower bound, so it fetches all history
// since day one. Page through in chunks of 1000 instead.
const PAGE_SIZE = 1000;

export async function getEomHiringReport(yearMonth: string): Promise<EodHiringRow[]> {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01T00:00:00`;
  const nextMonth = m === 12 ? `${y + 1}-01-01T00:00:00` : `${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00`;

  const [data, targets, forwards] = await Promise.all([
    (async () => {
      const all: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("hr_candidate_status_history")
          .select("candidate_id, position, branch, to_status, effective_date, created_at, candidate:candidate_id (full_name)")
          .lt("created_at", nextMonth)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        // 42P01 = table doesn't exist yet (0047 not applied) — treat as no activity yet rather than erroring.
        if (error) {
          if (error.code === "42P01") break;
          throw new Error(error.message);
        }
        all.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return all;
    })(),
    getStaffingTargets(),
    getCvForwardDetails(start, nextMonth),
  ]);

  // Rows come back oldest-first, so the last write per candidate_id is their
  // status as of the end of this month.
  const latestByCandidate = new Map<string, any>();
  for (const r of data as any[]) latestByCandidate.set(r.candidate_id, r);

  const map = new Map<string, EodHiringRow>();
  const keyOf = (p: string, b: string) => `${p}||${b}`;
  const ensure = (position: string, branch: string) => {
    const key = keyOf(position, branch);
    if (!map.has(key)) map.set(key, { position, branch, staffNeeded: 0, scheduledInterviews: [], activeTrainees: [], onHold: false, cvsSentToBm: [] });
    return map.get(key)!;
  };

  for (const t of targets) ensure(t.position || UNSET_LABEL, t.branch || UNSET_LABEL).staffNeeded = t.staffNeeded;

  for (const r of latestByCandidate.values()) {
    // "on_hold" was removed as a status (0221) — "cancelled" is its
    // successor here too, same reasoning as getEodHiringReport above.
    if (r.to_status !== "interviewing" && r.to_status !== "training" && r.to_status !== "cancelled") continue;
    const row = ensure(r.position || UNSET_LABEL, r.branch || UNSET_LABEL);
    const name = r.candidate?.full_name || "(Unknown candidate)";
    const date = r.effective_date ?? r.created_at ?? null;
    if (r.to_status === "interviewing") row.scheduledInterviews.push({ name, date });
    else if (r.to_status === "training") row.activeTrainees.push({ name, date });
    else if (r.to_status === "cancelled") row.onHold = true;
  }

  for (const [key, details] of forwards) {
    const [position, branch] = key.split("||");
    ensure(position || UNSET_LABEL, branch || UNSET_LABEL).cvsSentToBm = details;
  }

  return Array.from(map.values()).sort((a, b) => a.position.localeCompare(b.position) || a.branch.localeCompare(b.branch));
}
