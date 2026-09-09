/**
 * Which onboarding form TYPES apply to a given hr_candidates row — a
 * per-candidate checklist HR sets from the Hiring table's "Forms" column
 * (ReportHRDaily.tsx), since there's no fixed "every new hire needs these
 * N forms" list anywhere in this app (it varies by position/branch). See
 * migration 0224_hr_candidate_required_forms.sql.
 */
import { supabase } from "./client";
import type { SignableDocumentType } from "./signableDocuments";

/** Every candidate's selected required form types, keyed by candidate id — one bulk company-scoped fetch (RLS-scoped), not one query per candidate. */
export async function getCandidateRequiredFormTypes(): Promise<Map<string, SignableDocumentType[]>> {
  const { data, error } = await supabase.from("hr_candidate_required_forms").select("candidate_id, document_type");
  if (error) {
    console.error("getCandidateRequiredFormTypes error:", error.message);
    return new Map();
  }
  const map = new Map<string, SignableDocumentType[]>();
  for (const row of data ?? []) {
    const list = map.get(row.candidate_id) ?? [];
    list.push(row.document_type as SignableDocumentType);
    map.set(row.candidate_id, list);
  }
  return map;
}

/** Replaces the full set of required form types for one candidate — simple delete-then-insert, fine for a low-frequency admin action. */
export async function setCandidateRequiredFormTypes(candidateId: string, types: SignableDocumentType[]): Promise<void> {
  const { error: delError } = await supabase.from("hr_candidate_required_forms").delete().eq("candidate_id", candidateId);
  if (delError) throw new Error(delError.message);
  if (types.length === 0) return;
  const { error: insError } = await supabase
    .from("hr_candidate_required_forms")
    .insert(types.map((t) => ({ candidate_id: candidateId, document_type: t })));
  if (insError) throw new Error(insError.message);
}
