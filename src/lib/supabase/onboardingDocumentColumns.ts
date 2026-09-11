import { supabase } from "./client";

// Mirrors the groups the Onboarding Documents checklist grid splits
// employees into (see ReportHRDaily.tsx's onboardingGroup state) — the
// first 3 for the original tab. The other 4 are the New Onboarding
// Documents tab's own, separate group-key space (newOnboardingGroup state)
// so its custom columns never mix with the original tab's.
export type OnboardingGroupKey = "TECHNICIAN" | "PARTS_MANAGER" | "PH" | "TECHNICIAN_STAFF" | "BRANCH_MANAGER_UP" | "OFFICE_STAFF_US" | "PHILIPPINES_STAFF";

export interface OnboardingDocumentColumn {
  id: string;
  groupKey: OnboardingGroupKey;
  label: string;
  sortOrder: number;
}

/** 42P01 = relation doesn't exist yet (0064 not applied) — treat as "no custom columns yet" instead of a hard error. */
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

function mapRow(r: any): OnboardingDocumentColumn {
  return { id: r.id, groupKey: r.group_key, label: r.label, sortOrder: r.sort_order };
}

export async function getOnboardingDocumentColumns(): Promise<OnboardingDocumentColumn[]> {
  const { data, error } = await supabase
    .from("hr_onboarding_document_columns")
    .select("id, group_key, label, sort_order")
    .order("sort_order", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(mapRow);
}

export async function addOnboardingDocumentColumn(groupKey: OnboardingGroupKey, label: string): Promise<void> {
  const { error } = await supabase.from("hr_onboarding_document_columns").insert({
    group_key: groupKey,
    label: label.trim(),
    sort_order: Date.now(),
  });
  if (error) {
    if (error.code === "23505") throw new Error("That column already exists for this group.");
    throw new Error(error.message);
  }
}

export async function deleteOnboardingDocumentColumn(id: string): Promise<void> {
  const { error } = await supabase.from("hr_onboarding_document_columns").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
