/**
 * HR Candidates — the hiring pipeline behind the HR & Recruitment
 * Dashboard's "Add Candidate" flow. A candidate moves applied ->
 * interviewing -> selected -> hired/rejected; CV files live in the
 * private `candidate-cvs` Storage bucket under
 * `{company_id}/{candidate_id}/{filename}`, referenced by `cv_path`.
 */

import { supabase } from "./client";
import { createNotification } from "./notifications";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { INACTIVE_BRANCHES } from "@/lib/locations";

// "training" and "on_hold" added for EOD/EOM hiring reports (0048); "phone_screening",
// "withdrawn", and "cancelled" added (and "on_hold" removed) by 0221_hr_candidates_status_update.sql.
// Interviewing/Training/Withdrawn each require a date (interview_date/
// training_start_date/withdrawn_date); Hired moves the matching
// hr_staffing_targets counter by ±1; every other status is a no-op for
// that counter. See hr_update_candidate_status() in
// 0048_hr_hiring_reports.sql (updated by 0221) for where that side effect
// actually happens (atomically, alongside the status history log) — never
// via a plain `update hr_candidates set status=...`.
export type CandidateStatus = "applied" | "attempt" | "phone_screening" | "interviewing" | "selected" | "training" | "hired" | "rejected" | "withdrawn" | "cancelled";

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
  assignedManagerId: string | null;  // manager acting as interviewer — separate from branchManagerId, no auto-default; HR picks explicitly (see assignedManagerNameForCandidate in ReportHRDaily.tsx). See migration 0248.
  jobPostingId: string | null;  // which Recruitment Site job posting (hr_job_postings) this candidate came from — optional, picked on Add Candidate. See migration 0296.
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
  startDate: string | null;          // required when status = "hired" — see migration 0261
  screeningDate: string | null;      // manual, independent of the phone_screening status — see updateCandidateScreeningDate. See migration 0247.
  documentVerified: boolean;         // manual check/X toggle for now — see updateCandidateDocumentVerified. See migration 0251.
  notes: string | null;              // "HR Note" in the UI
  interviewerNote: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// `full_name` is the real column (the table predates this feature — see
// 0001_init.sql / 0030_hr_candidates.sql); mapped to `name` here so the
// rest of the app's Candidate type reads naturally.
const SELECT = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, assigned_manager_id, job_posting_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, start_date, screening_date, document_verified, notes, interviewer_note, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back to this if job_posting_id doesn't exist yet — i.e.
// 0296_hr_candidates_job_posting.sql hasn't been run against this
// database, but 0261_hr_candidates_start_date.sql has.
const SELECT_V15 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, assigned_manager_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, start_date, screening_date, document_verified, notes, interviewer_note, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back to this if start_date doesn't exist yet — i.e.
// 0261_hr_candidates_start_date.sql hasn't been run against this
// database, but 0251_hr_candidates_document_check.sql has.
const SELECT_V14 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, assigned_manager_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, screening_date, document_verified, notes, interviewer_note, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if document_verified doesn't exist yet — i.e.
// 0251_hr_candidates_document_check.sql hasn't been run against this
// database, but 0248_hr_candidates_assigned_manager.sql has.
const SELECT_V13 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, assigned_manager_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, screening_date, notes, interviewer_note, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if assigned_manager_id doesn't exist yet —
// i.e. 0248_hr_candidates_assigned_manager.sql hasn't been run against this
// database, but 0247_hr_candidates_screening_date.sql has.
const SELECT_V12 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, screening_date, notes, interviewer_note, created_by, created_at, updated_at, author:created_by (display_name, username)";
// Falls back further to this if screening_date doesn't exist yet — i.e.
// 0247_hr_candidates_screening_date.sql hasn't been run against this
// database, but 0241_hr_candidates_screening_interviewer_notes.sql has.
const SELECT_V11 = "id, company_id, full_name, phone, email, position, branch, department, branch_manager_id, assigned_interviewer_id, trainer_id, source, texted_am, texted_pm, called_am, called_pm, cv_path, status, interview_date, interview_time, interview_timezone, training_start_date, training_end_date, withdrawn_date, notes, interviewer_note, created_by, created_at, updated_at, author:created_by (display_name, username)";
// screening_note (0241) is no longer used by the app — Screening Note was
// removed from the UI, but the column itself is left in place (migrations
// aren't reverted) and simply never selected/written anymore.
// Falls back to this if interviewer_note doesn't exist yet —
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
    assignedManagerId: r.assigned_manager_id ?? null,
    jobPostingId: r.job_posting_id ?? null,
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
    startDate: r.start_date ?? null,
    screeningDate: r.screening_date ?? null,
    documentVerified: r.document_verified ?? false,
    notes: r.notes,
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
      select = SELECT_V15;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V15) {
      select = SELECT_V14;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V14) {
      select = SELECT_V13;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V13) {
      select = SELECT_V12;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V12) {
      select = SELECT_V11;
      ({ data, error } = await supabase
        .from("hr_candidates")
        .select(select)
        .order("created_at", { ascending: false })
        .range(from, from + CANDIDATES_PAGE_SIZE - 1));
    }
    if (isMissingColumnError(error) && select === SELECT_V11) {
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
  jobPostingId?: string;
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
  const insertPayloadWithJobPosting = {
    ...insertPayload,
    job_posting_id: input.jobPostingId || null,
  };
  let { data, error }: { data: any; error: any } = await supabase.from("hr_candidates").insert(insertPayloadWithJobPosting).select(SELECT).single();
  if (isMissingColumnError(error)) {
    // job_posting_id (0296) not applied yet — the insert itself referenced
    // it (it's a real, optional Add Candidate input), so retry with it
    // dropped from the payload too.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT_V15).single());
  }
  if (isMissingColumnError(error)) {
    // document_verified (0251) not applied yet — never an Add Candidate
    // input (set later from the Hiring table), only the RETURNING select did.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT_V13).single());
  }
  if (isMissingColumnError(error)) {
    // assigned_manager_id (0248) not applied yet — never an Add Candidate
    // input (set later from the Hiring table), only the RETURNING select did.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT_V12).single());
  }
  if (isMissingColumnError(error)) {
    // screening_date (0247) not applied yet — never an Add Candidate input
    // (manual, set later from the Hiring table), only the RETURNING select did.
    ({ data, error } = await supabase.from("hr_candidates").insert(insertPayload).select(SELECT_V11).single());
  }
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

// Fixed extra recipients on every hire notification, regardless of branch —
// the user's explicit list (Naveen Lakhani, Yujung Chris Yong, Lou Basco).
// Not role-derived like Branch Manager/SBM below since none of the three
// hold a BM/SBM role themselves.
const HIRE_NOTIFICATION_EXTRA_RECIPIENT_IDS = [
  "bec83133-0de3-4fa6-8174-f6aa1b04d3e8", // Naveen Lakhani
  "f4131c1f-0676-40e0-aa61-dc10ca620259", // Yujung Chris Yong
  "17e098e0-f237-45dc-b8e0-13e34cf275fc", // Lou Basco
];

/**
 * Notifies every active Branch Manager + Senior Branch Manager company-wide
 * (not scoped to the hire's own branch — the user's explicit call), plus
 * the three fixed extra recipients above, whenever a candidate is marked
 * Hired with a Start Date. `linkTo` deep-links into the Hiring tab with
 * `viewCvCandidateId` — ReportHRDaily.tsx picks that up on load and opens
 * the candidate's CV in a preview modal (not a new tab — a notification
 * click doesn't carry the "direct user gesture" a real click does, so
 * window.open would just get popup-blocked).
 */
export async function notifyOnCandidateHired(
  candidate: { id: string; name: string; branch: string | null; position: string | null },
  startDate: string,
  senderId: string | null,
  senderName: string | null
): Promise<void> {
  const { data: bmSbm, error } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER"])
    .eq("is_active", true);
  if (error) console.error("notifyOnCandidateHired (BM/SBM lookup) error:", error.message);

  const recipientIds = new Set<string>([...(bmSbm ?? []).map((r) => r.id), ...HIRE_NOTIFICATION_EXTRA_RECIPIENT_IDS]);
  if (senderId) recipientIds.delete(senderId);

  const dateLabel = (() => {
    const d = new Date(startDate);
    return isNaN(d.getTime()) ? startDate : d.toLocaleDateString();
  })();
  const body = `🎉 ${candidate.name} was hired${candidate.position ? ` as ${candidate.position}` : ""}${candidate.branch ? ` (${candidate.branch})` : ""} — starting ${dateLabel}.`;
  const linkTo = `/m/hr/hr-dashboard?tab=hiring&viewCvCandidateId=${candidate.id}`;

  await Promise.all(
    Array.from(recipientIds).map((recipientId) =>
      createNotification({ recipientId, senderId, senderName, body, linkTo }).catch((err) =>
        console.error(`notifyOnCandidateHired: failed for recipient ${recipientId}:`, err)
      )
    )
  );
}

/** Sets the manual Screening Date — independent of the phone_screening status (no required-date dialog like Interview Date has). See migration 0247. */
export async function updateCandidateScreeningDate(id: string, date: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").update({ screening_date: date || null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Manual check/X toggle on the Hiring table — no detection logic wired up yet, just a plain click-to-flip until HR specifies which document this should verify. See migration 0251. */
export async function updateCandidateDocumentVerified(id: string, verified: boolean): Promise<void> {
  const { error } = await supabase.from("hr_candidates").update({ document_verified: verified }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Updates just the free-text note on a candidate row — separate from addCandidate's initial `notes` so HR can jot down/revise something after the fact (e.g. interview impressions) without touching status. */
export async function updateCandidateNotes(id: string, notes: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").update({ notes: notes.trim() || null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Updates the Interviewer Note — a separate slot from the general HR note (updateCandidateNotes above) so each role's write never clobbers the other's. See 0241_hr_candidates_screening_interviewer_notes.sql. */
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
  fields: Partial<{ name: string; phone: string; email: string; position: string; branch: string; department: string; branchManagerId: string; assignedInterviewerId: string; assignedManagerId: string; jobPostingId: string; trainerId: string; source: string }>
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
  if (fields.assignedManagerId !== undefined) payload.assigned_manager_id = fields.assignedManagerId.trim() || null;
  if (fields.jobPostingId !== undefined) payload.job_posting_id = fields.jobPostingId.trim() || null;
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
 * to BM — scoped to just `dateStr`'s calendar day (same "this period's
 * activity, not a running total" treatment getEomHiringReport already uses
 * for its own month-scoped version), so picking a different date on the
 * report's own date field actually changes this column instead of always
 * showing the same all-time count.
 */
export async function getEodHiringReport(dateStr: string): Promise<EodHiringRow[]> {
  const dayStart = `${dateStr}T00:00:00`;
  const nextDay = new Date(`${dateStr}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const dayEnd = `${nextDay.toISOString().slice(0, 10)}T00:00:00`;

  let [{ data: cands, error: candErr }, targets, forwards] = await Promise.all([
    supabase.from("hr_candidates").select("full_name, position, branch, status, interview_date, training_start_date"),
    getStaffingTargets(),
    getCvForwardDetails(dayStart, dayEnd),
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
 * All-time CV-forward history keyed by candidate_id — who it was sent to
 * and when, newest first. Used by the Hiring table's own "Sent {date}"
 * indicator (ReportHRDaily.tsx) next to the Forward button, distinct from
 * getCvForwardDetails above (that one's grouped by Position+Branch for the
 * EOD/EOM reports, not per-candidate). Same empty-map-if-table-missing
 * degradation.
 */
export async function getCvForwardsByCandidateId(): Promise<Map<string, CvForwardDetail[]>> {
  const details = new Map<string, CvForwardDetail[]>();
  const { data, error } = await supabase
    .from("hr_candidate_cv_forwards")
    .select("candidate_id, created_at, candidate:candidate_id (full_name), recipient:recipient_id (display_name, username)")
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01") return details; // table doesn't exist yet
    throw new Error(error.message);
  }
  for (const r of (data ?? []) as any[]) {
    const list = details.get(r.candidate_id) ?? [];
    list.push({
      candidateName: r.candidate?.full_name || "(Unknown candidate)",
      recipientName: r.recipient?.display_name || r.recipient?.username || "(Unknown recipient)",
      date: r.created_at,
    });
    details.set(r.candidate_id, list);
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

// =====================================================================
// Hiring Report v2 -- 3 sections (Technician / Parts Manager / Philippine
// Staff), replacing the flat Position+Branch table above for the on-screen
// "Generate Report" tab (ReportHRDaily.tsx). The old getEodHiringReport/
// getEomHiringReport above are UNCHANGED and still back the existing
// Excel/PDF export -- this is additive, not a replacement of those.
//
// Section rules (per the user's own spec):
//   - Technician: every non-Philippines branch (LOCATIONS_DATA), position
//     anything OTHER than "Parts Manager" (case-insensitive) -- the broad
//     "everyone else" bucket so nothing at a US branch is silently dropped.
//   - Parts Manager ("US Staff"): every non-Philippines branch, same
//     blanket seed as Technician, scoped to position "Parts Manager".
//   - Philippine Staff: any Philippines branch, grouped by department
//     (Claims/CSR/Tech Support/PO/Operation/IT seeded by default, any
//     other department value found in the data added alongside) instead
//     of by branch -- Philippine staffing isn't tracked per-branch the way
//     US hiring is.
//
// Computed pieces and where they come from:
//   - Staff Need: hr_staffing_targets (existing).
//   - Interview: candidates currently "interviewing" (live status, same
//     as the v1 EOD report -- not history-based, since this is "right now").
//   - Hired: hr_candidate_status_history rows where to_status='hired' and
//     created_at falls inside the period -- a genuine "hired during this
//     period" count, not a running total. Start Date is each of those
//     candidates' own hr_candidates.start_date.
//   - CVs Sent to BM: hr_candidate_cv_forwards, once scoped to the exact
//     period (day for EOD, month for EOM) and once to the containing
//     month regardless of period type ("(Monthly)" column) -- identical to
//     the exact one for EOM, where the period already IS a month.
//   - Terminated/Resigned: profiles.employee_info->>employmentStatus in
//     ('terminated','resigned') with employmentStatusDate inside the
//     period, grouped by the person's CURRENT assigned_branch (or
//     department if their branch is in the Philippines).
//   - Warning (Time Card Warning / Employee Error/Manipulation -- counted
//     separately based on the HR-only classification chosen in the
//     "Preview & Send" panel when the Warning Form was sent,
//     WarningFormData.warningCategory -- NOT part of the "Reason(s) for
//     Warning" shown on the document itself; a warning with no category
//     chosen counts toward neither column): hr_signable_documents
//     where document_type='warning_form' and created_at falls inside the
//     period, grouped by the WARNED EMPLOYEE's (form_data->>employeeId,
//     not whichever signature slot currently holds recipient_id) CURRENT
//     assigned_branch/department -- explicitly the recipient's own branch,
//     not the sender's, per the user's own instruction.
//   - Budget/Sponsored/Others: hr_hiring_report_manual_entries (migration
//     0273), typed in by hand per (period, section, row).
//   - New Hire: same count as Hired (no separate source found for it as
//     something distinct from Hired -- flagged as an assumption, easy to
//     change if it's actually supposed to mean something else).
// =====================================================================

export type HiringReportPeriodType = "eod" | "eom";
export type HiringReportSection = "technician" | "parts_manager" | "philippine_staff";

const PH_BRANCH_SET = new Set(LOCATIONS_DATA.filter((l) => l.isPhilippines).map((l) => l.location));
// Dallas and Louisville exist in the app's full location list but aren't
// real active branches — INACTIVE_BRANCHES (src/lib/locations.ts) is the
// shared source of truth for this exclusion, also used by the Branch
// Daily Report, so it can't drift into two different Sets over time.
const US_BRANCH_NAMES = LOCATIONS_DATA.filter((l) => !l.isPhilippines && !INACTIVE_BRANCHES.has(l.location)).map((l) => l.location).sort();
const PH_DEPARTMENT_DEFAULTS = ["Claims", "CSR", "Tech Support", "PO", "Operation", "IT"];
// Same real department, different spelling depending on who typed it in —
// normalized to the canonical PH_DEPARTMENT_DEFAULTS name so "CSR" and
// "Customer Service" land on one row instead of splitting the count.
const PH_DEPARTMENT_ALIASES: Record<string, string> = {
  "customer service": "CSR",
};
function normalizePhDepartment(department: string | null | undefined): string {
  const raw = (department || "").trim();
  if (!raw) return UNSET_LABEL;
  return PH_DEPARTMENT_ALIASES[raw.toLowerCase()] || raw;
}

export interface HiringReportRow {
  groupKey: string; // branch (technician/parts_manager) or department (philippine_staff)
  staffNeeded: number;
  scheduledInterviews: { name: string; date: string | null }[];
  hired: number;
  hiredStartDates: string[];
  cvsSentToBm: CvForwardDetail[];
  cvsSentToBmMonthly: CvForwardDetail[];
  terminatedResigned: number;
  /** Counted separately per warning_form's warningCategory (HR-only classification, not the document's printed reasons) — a warning with no category chosen counts toward neither column. */
  timeCardWarningCount: number;
  employeeErrorManipulationCount: number;
  budget: number | null;
  sponsored: number | null;
  others: number | null;
}

export interface HiringReportSummary {
  /** Combined Time Card Warning + Employee Error/Manipulation total — see HiringReportRow for the two counted separately. */
  warning: number;
  terminatedResigned: number;
  daySponsored: number;
  budget: number;
  newHire: number;
  schedInterview: number;
}

export interface HiringReportSections {
  technician: HiringReportRow[];
  partsManager: HiringReportRow[];
  philippineStaff: HiringReportRow[];
  summary: HiringReportSummary;
}

function hiringReportPeriodBounds(periodType: HiringReportPeriodType, periodKey: string): { start: string; end: string } {
  if (periodType === "eod") {
    const start = `${periodKey}T00:00:00`;
    const next = new Date(`${periodKey}T00:00:00`);
    next.setDate(next.getDate() + 1);
    return { start, end: `${next.toISOString().slice(0, 10)}T00:00:00` };
  }
  const [y, m] = periodKey.split("-").map(Number);
  const start = `${periodKey}-01T00:00:00`;
  const end = m === 12 ? `${y + 1}-01-01T00:00:00` : `${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00`;
  return { start, end };
}

function blankHiringReportRow(groupKey: string): HiringReportRow {
  return {
    groupKey,
    staffNeeded: 0,
    scheduledInterviews: [],
    hired: 0,
    hiredStartDates: [],
    cvsSentToBm: [],
    cvsSentToBmMonthly: [],
    terminatedResigned: 0,
    timeCardWarningCount: 0,
    employeeErrorManipulationCount: 0,
    budget: null,
    sponsored: null,
    others: null,
  };
}

export async function getHiringReportSections(periodType: HiringReportPeriodType, periodKey: string): Promise<HiringReportSections> {
  const { start, end } = hiringReportPeriodBounds(periodType, periodKey);
  const monthKey = periodType === "eod" ? periodKey.slice(0, 7) : periodKey;
  const { start: monthStart, end: monthEnd } = hiringReportPeriodBounds("eom", monthKey);

  const hiredHistoryPromise = (async () => {
    const all: any[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("hr_candidate_status_history")
        .select("candidate_id, position, branch, to_status, created_at, candidate:candidate_id (start_date)")
        .eq("to_status", "hired")
        .gte("created_at", start)
        .lt("created_at", end)
        .range(from, from + PAGE - 1);
      if (error) {
        if (error.code === "42P01") break; // 0048 not applied yet
        throw new Error(error.message);
      }
      all.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return all;
  })();

  const [
    { data: cands, error: candErr },
    targets,
    forwardsExact,
    forwardsMonthly,
    hiredHistory,
    manualEntries,
    { data: allProfiles, error: profErr },
    warningResult,
  ] = await Promise.all([
    supabase.from("hr_candidates").select("id, position, branch, department, status, interview_date"),
    getStaffingTargets(),
    getCvForwardDetails(start, end),
    getCvForwardDetails(monthStart, monthEnd),
    hiredHistoryPromise,
    getHiringReportManualEntries(periodType, periodKey),
    supabase.from("profiles").select("id, assigned_branch, department, employee_info, role"),
    supabase.from("hr_signable_documents").select("form_data, created_at").eq("document_type", "warning_form").gte("created_at", start).lt("created_at", end),
  ]);
  if (candErr) throw new Error(candErr.message);
  if (profErr) throw new Error(profErr.message);
  const warnings: any[] = warningResult.error ? [] : (warningResult.data ?? []);

  const profileById = new Map((allProfiles ?? []).map((p: any) => [p.id, p]));
  const isPhBranch = (branch: string | null | undefined) => !!branch && PH_BRANCH_SET.has(branch);

  const rows: Record<HiringReportSection, Map<string, HiringReportRow>> = {
    technician: new Map(),
    parts_manager: new Map(),
    philippine_staff: new Map(),
  };
  const ensure = (section: HiringReportSection, groupKey: string): HiringReportRow => {
    const map = rows[section];
    const key = groupKey || UNSET_LABEL;
    if (!map.has(key)) map.set(key, blankHiringReportRow(key));
    return map.get(key)!;
  };

  // Both US sections show every known branch as a row, even with no data
  // yet — "list branch list" for Technician AND US Staff/Parts Manager,
  // per the user's own instruction (Parts Manager used to only show
  // branches that already had data; now it matches Technician's full list).
  for (const b of US_BRANCH_NAMES) ensure("technician", b);
  for (const b of US_BRANCH_NAMES) ensure("parts_manager", b);
  for (const d of PH_DEPARTMENT_DEFAULTS) ensure("philippine_staff", d);

  const usSectionFor = (position: string | null): HiringReportSection =>
    (position || "").trim().toLowerCase() === "parts manager" ? "parts_manager" : "technician";

  for (const t of targets) {
    if (isPhBranch(t.branch)) continue; // Staff Need targets are US-branch only in practice
    ensure(usSectionFor(t.position), t.branch || UNSET_LABEL).staffNeeded += t.staffNeeded;
  }

  for (const c of (cands ?? []) as any[]) {
    if (c.status !== "interviewing") continue;
    if (isPhBranch(c.branch)) {
      ensure("philippine_staff", normalizePhDepartment(c.department)).scheduledInterviews.push({ name: "", date: c.interview_date ?? null });
    } else {
      ensure(usSectionFor(c.position), c.branch || UNSET_LABEL).scheduledInterviews.push({ name: "", date: c.interview_date ?? null });
    }
  }

  for (const r of hiredHistory as any[]) {
    const startDate = r.candidate?.start_date ?? null;
    if (isPhBranch(r.branch)) {
      // Status history doesn't carry department -- an unattributed PH hire
      // lands in "(Unassigned)" rather than being silently dropped.
      const row = ensure("philippine_staff", UNSET_LABEL);
      row.hired += 1;
      if (startDate) row.hiredStartDates.push(startDate);
    } else {
      const row = ensure(usSectionFor(r.position), r.branch || UNSET_LABEL);
      row.hired += 1;
      if (startDate) row.hiredStartDates.push(startDate);
    }
  }

  for (const [key, details] of forwardsExact) {
    const [position, branch] = key.split("||");
    if (isPhBranch(branch)) continue; // forwards are logged with a branch, not department -- PH forwards aren't attributable to a department here
    ensure(usSectionFor(position), branch || UNSET_LABEL).cvsSentToBm = details;
  }
  for (const [key, details] of forwardsMonthly) {
    const [position, branch] = key.split("||");
    if (isPhBranch(branch)) continue;
    ensure(usSectionFor(position), branch || UNSET_LABEL).cvsSentToBmMonthly = details;
  }

  // ---- Terminated/Resigned: profiles.employee_info, grouped by current branch/department ----
  for (const p of (allProfiles ?? []) as any[]) {
    const info = p.employee_info;
    if (!info || typeof info !== "object") continue;
    const status = info.employmentStatus;
    const statusDate = info.employmentStatusDate;
    if ((status !== "terminated" && status !== "resigned") || !statusDate) continue;
    if (statusDate < start.slice(0, 10) || statusDate >= end.slice(0, 10)) continue;
    if (isPhBranch(p.assigned_branch)) {
      ensure("philippine_staff", normalizePhDepartment(p.department)).terminatedResigned += 1;
    } else {
      // Position isn't known for a terminated/resigned employee here (this
      // is a profile, not a candidate) -- counted against Technician, the
      // broad bucket, unless their role is literally Parts Manager.
      const section = (p.role || "").toString().toLowerCase() === "parts_manager" ? "parts_manager" : "technician";
      ensure(section, p.assigned_branch || UNSET_LABEL).terminatedResigned += 1;
    }
  }

  // ---- Warning: hr_signable_documents(warning_form), grouped by the WARNED employee's current branch/department ----
  // Time Card Warning and Employee Error/Manipulation are counted
  // separately based on the HR-only classification chosen when the
  // Warning Form was sent (WarningFormData.warningCategory) — not one of
  // the "Reason(s) for Warning" shown on the printed document. A warning
  // sent with no category chosen doesn't count toward either column.
  for (const w of warnings) {
    const employeeId = w.form_data?.employeeId;
    const profile = employeeId ? profileById.get(employeeId) : null;
    if (!profile) continue; // no profile to attribute the branch to -- skip rather than guess
    const category = w.form_data?.warningCategory;
    const isTimeCard = category === "time_card_warning";
    const isEmployeeError = category === "employee_error_manipulation";
    if (!isTimeCard && !isEmployeeError) continue;
    const row = isPhBranch((profile as any).assigned_branch)
      ? ensure("philippine_staff", normalizePhDepartment((profile as any).department))
      : ensure(
          ((profile as any).role || "").toString().toLowerCase() === "parts_manager" ? "parts_manager" : "technician",
          (profile as any).assigned_branch || UNSET_LABEL,
        );
    if (isTimeCard) row.timeCardWarningCount += 1;
    if (isEmployeeError) row.employeeErrorManipulationCount += 1;
  }

  // ---- Manual entries (Budget/Sponsored/Others) ----
  for (const m of manualEntries) {
    const row = ensure(m.section, m.groupKey);
    row.budget = m.budget;
    row.sponsored = m.sponsored;
    row.others = m.others;
  }

  const sortRows = (map: Map<string, HiringReportRow>) => Array.from(map.values()).sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  const technician = sortRows(rows.technician);
  const partsManager = sortRows(rows.parts_manager);
  const philippineStaff = sortRows(rows.philippine_staff);

  const allRows = [...technician, ...partsManager, ...philippineStaff];
  const summary: HiringReportSummary = {
    warning: allRows.reduce((s, r) => s + r.timeCardWarningCount + r.employeeErrorManipulationCount, 0),
    terminatedResigned: allRows.reduce((s, r) => s + r.terminatedResigned, 0),
    daySponsored: allRows.reduce((s, r) => s + (r.sponsored ?? 0), 0),
    budget: allRows.reduce((s, r) => s + (r.budget ?? 0), 0),
    newHire: allRows.reduce((s, r) => s + r.hired, 0),
    schedInterview: allRows.reduce((s, r) => s + r.scheduledInterviews.length, 0),
  };

  return { technician, partsManager, philippineStaff, summary };
}

// =====================================================================
// Manual entries (Budget/Sponsored/Others) for the report above --
// migration 0273/0278.
// =====================================================================

export interface HiringReportManualEntry {
  section: HiringReportSection;
  groupKey: string;
  budget: number | null;
  sponsored: number | null;
  others: number | null;
}

async function getHiringReportManualEntries(periodType: HiringReportPeriodType, periodKey: string): Promise<HiringReportManualEntry[]> {
  const { data, error } = await supabase
    .from("hr_hiring_report_manual_entries")
    .select("section, group_key, budget, sponsored, others")
    .eq("period_type", periodType)
    .eq("period_key", periodKey);
  if (error) {
    if (error.code === "42P01") return []; // 0273 not applied yet
    throw new Error(error.message);
  }
  return (data ?? []).map((r: any) => ({ section: r.section, groupKey: r.group_key, budget: r.budget, sponsored: r.sponsored, others: r.others }));
}

export type HiringReportManualEntryFields = Partial<Pick<HiringReportManualEntry, "budget" | "sponsored" | "others">>;

export async function upsertHiringReportManualEntry(
  periodType: HiringReportPeriodType,
  periodKey: string,
  section: HiringReportSection,
  groupKey: string,
  fields: HiringReportManualEntryFields
): Promise<void> {
  const patch: Record<string, unknown> = { period_type: periodType, period_key: periodKey, section, group_key: groupKey };
  if ("budget" in fields) patch.budget = fields.budget;
  if ("sponsored" in fields) patch.sponsored = fields.sponsored;
  if ("others" in fields) patch.others = fields.others;
  const { error } = await supabase.from("hr_hiring_report_manual_entries").upsert(patch, { onConflict: "company_id,period_type,period_key,section,group_key" });
  if (error) throw new Error(error.message);
}
