/**
 * "This technician doesn't need this form" flags for the HR module's
 * Technician Form Checklist (TechnicianFormChecklistPage.tsx). A row
 * present = marked Not Applicable; no row = still expected. See
 * migration 0222_technician_form_exemptions.sql.
 */
import { supabase } from "./client";

export interface FormExemptionRow {
  profileId: string;
  documentType: string;
  markedByName: string | null;
  createdAt: string;
}

function key(profileId: string, documentType: string): string {
  return `${profileId}|${documentType}`;
}

/** Every exemption for the caller's company, as a Set of "{profileId}|{documentType}" keys for cheap lookup. */
export async function getTechnicianFormExemptions(): Promise<Set<string>> {
  const { data, error } = await supabase.from("technician_form_exemptions").select("profile_id, document_type");
  if (error) {
    // 42P01 = relation doesn't exist yet (0222 not applied) — treat as no exemptions rather than breaking the whole checklist.
    if (error.code === "42P01") return new Set();
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((r: any) => key(r.profile_id, r.document_type)));
}

/** Marks (or clears) one technician/form as Not Applicable. */
export async function setTechnicianFormExemption(
  profileId: string,
  documentType: string,
  exempt: boolean,
  markedByName: string
): Promise<void> {
  if (exempt) {
    const { error } = await supabase
      .from("technician_form_exemptions")
      .upsert(
        { profile_id: profileId, document_type: documentType, marked_by_name: markedByName },
        { onConflict: "company_id,profile_id,document_type" }
      );
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("technician_form_exemptions")
      .delete()
      .eq("profile_id", profileId)
      .eq("document_type", documentType);
    if (error) throw new Error(error.message);
  }
}
