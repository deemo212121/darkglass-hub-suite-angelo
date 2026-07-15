/**
 * Jotform Document submissions — the real, Jotform-generated PDF per
 * submission (fetched via their generatePDF API and re-hosted in Firebase
 * Storage by src/lib/server/jotformBridge.ts), tracked here so the
 * Applicant Documents tab can filter/sort/search it the same way every
 * other HR list in this app does. Rows are written by the webhook using
 * the Supabase service-role key — this file only reads and updates status.
 */

import { supabase } from "./client";

export type JotformSubmissionStatus = "new" | "reviewed" | "archived";

export interface JotformSubmission {
  id: string;
  companyId: string;
  formId: string;
  formTitle: string | null;
  submissionId: string;
  applicantName: string | null;
  documentUrl: string | null;
  documentPath: string | null;
  status: JotformSubmissionStatus;
  submittedAt: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  deletedAt: string | null;
}

const SELECT =
  "id, company_id, form_id, form_title, submission_id, applicant_name, document_url, document_path, status, submitted_at, created_at, reviewed_by, reviewed_at, deleted_at, reviewer:reviewed_by (display_name, username)";

function fromRow(r: any): JotformSubmission {
  return {
    id: r.id,
    companyId: r.company_id,
    formId: r.form_id,
    formTitle: r.form_title,
    submissionId: r.submission_id,
    applicantName: r.applicant_name,
    documentUrl: r.document_url,
    documentPath: r.document_path,
    status: r.status,
    submittedAt: r.submitted_at,
    createdAt: r.created_at,
    reviewedBy: r.reviewed_by,
    reviewedByName: r.reviewer?.display_name || r.reviewer?.username || null,
    reviewedAt: r.reviewed_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/** Soft-deleted rows still within the 30-day restore window. */
const RESTORE_WINDOW_DAYS = 30;

// Supabase caps an unbounded select at 1000 rows — with the backfill script
// having imported thousands of historical submissions, a plain query here
// would silently truncate the list. Page through in chunks of 1000 instead.
const PAGE_SIZE = 1000;

/** All non-deleted Jotform Document submissions for the caller's company (RLS-scoped), newest first. */
export async function getJotformSubmissions(): Promise<JotformSubmission[]> {
  const all: JotformSubmission[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hr_jotform_submissions")
      .select(SELECT)
      .is("deleted_at", null)
      .order("submitted_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...(data ?? []).map(fromRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Soft-deleted submissions still within the 30-day restore window, most recently deleted first. */
export async function getDeletedJotformSubmissions(): Promise<JotformSubmission[]> {
  const cutoff = new Date(Date.now() - RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("hr_jotform_submissions")
    .select(SELECT)
    .not("deleted_at", "is", null)
    .gte("deleted_at", cutoff)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function updateJotformSubmissionStatus(id: string, status: JotformSubmissionStatus, reviewerId: string): Promise<void> {
  const { error } = await supabase
    .from("hr_jotform_submissions")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Soft-deletes a submission — e.g. a test/junk one — moving it to "Deleted Jotforms" for 30 days rather than removing it immediately. */
export async function softDeleteJotformSubmission(id: string): Promise<void> {
  const { error } = await supabase.from("hr_jotform_submissions").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Restores a soft-deleted submission back onto the Applicant Documents list. */
export async function restoreJotformSubmission(id: string): Promise<void> {
  const { error } = await supabase.from("hr_jotform_submissions").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
}
