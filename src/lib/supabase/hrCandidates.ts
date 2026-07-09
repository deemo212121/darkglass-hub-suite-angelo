/**
 * HR Candidates — the hiring pipeline behind the HR & Recruitment
 * Dashboard's "Add Candidate" flow. A candidate moves applied ->
 * interviewing -> selected -> hired/rejected; CV files live in the
 * private `candidate-cvs` Storage bucket under
 * `{company_id}/{candidate_id}/{filename}`, referenced by `cv_path`.
 */

import { supabase } from "./client";

export type CandidateStatus = "applied" | "interviewing" | "selected" | "hired" | "rejected";

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
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// `full_name` is the real column (the table predates this feature — see
// 0001_init.sql / 0030_hr_candidates.sql); mapped to `name` here so the
// rest of the app's Candidate type reads naturally.
const SELECT = "id, company_id, full_name, phone, email, position, branch, cv_path, status, notes, created_by, created_at, updated_at, author:created_by (display_name, username)";

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
    notes: r.notes,
    createdBy: r.created_by,
    createdByName: r.author?.display_name || r.author?.username || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getCandidates(): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("hr_candidates")
    .select(SELECT)
    .order("created_at", { ascending: false });
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
  const { data, error } = await supabase
    .from("hr_candidates")
    .insert({
      full_name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      position: input.position?.trim() || null,
      branch: input.branch?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select(SELECT)
    .single();
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

export async function updateCandidateStatus(id: string, status: CandidateStatus): Promise<void> {
  const { error } = await supabase.from("hr_candidates").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCandidate(id: string): Promise<void> {
  const { error } = await supabase.from("hr_candidates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
