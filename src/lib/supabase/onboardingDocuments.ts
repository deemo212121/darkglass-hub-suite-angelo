import { supabase } from "./client";

// Categories are just the applicant's actual required-document names (e.g.
// "W9", "Driver's License", "Vehicle Use Agreement"), which vary by role —
// Technician / Parts Manager / Philippines each have their own list (see
// TECHNICIAN_ONBOARDING_DOCS etc. in ReportHRDaily.tsx, the same lists the
// Onboarding Documents checklist grid already uses). Free text rather than a
// fixed enum, same treatment as position/branch elsewhere in this app.
export type OnboardingDocCategory = string;

export interface OnboardingDocument {
  id: string;
  profileId: string;
  category: OnboardingDocCategory;
  fileName: string;
  fileUrl: string;
  storagePath: string | null;
  source: "jotform" | "manual";
  jotformNotificationId: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

const SELECT =
  "id, profile_id, category, file_name, file_url, storage_path, source, jotform_notification_id, created_at, uploader:uploaded_by (display_name, username)";

/** 42P01 = relation doesn't exist yet (0048 not applied) — treat as "no documents yet" instead of a hard error. */
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

function mapRow(r: any): OnboardingDocument {
  return {
    id: r.id,
    profileId: r.profile_id,
    category: r.category,
    fileName: r.file_name,
    fileUrl: r.file_url,
    storagePath: r.storage_path,
    source: r.source,
    jotformNotificationId: r.jotform_notification_id,
    uploadedByName: r.uploader?.display_name || r.uploader?.username || null,
    createdAt: r.created_at,
  };
}

export async function getOnboardingDocuments(profileId: string): Promise<OnboardingDocument[]> {
  const { data, error } = await supabase
    .from("onboarding_documents")
    .select(SELECT)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(mapRow);
}

export interface AddOnboardingDocumentInput {
  profileId: string;
  category: OnboardingDocCategory;
  fileName: string;
  fileUrl: string;
  storagePath?: string | null;
  source: "jotform" | "manual";
  jotformNotificationId?: string | null;
}

export async function addOnboardingDocument(input: AddOnboardingDocumentInput): Promise<void> {
  const { error } = await supabase.from("onboarding_documents").insert({
    profile_id: input.profileId,
    category: input.category,
    file_name: input.fileName,
    file_url: input.fileUrl,
    storage_path: input.storagePath ?? null,
    source: input.source,
    jotform_notification_id: input.jotformNotificationId ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteOnboardingDocument(id: string): Promise<void> {
  const { error } = await supabase.from("onboarding_documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Bulk existence check for the checklist grid — per applicant, which
 * category names already have at least one filed document. Used to drive
 * the YES/NO checklist automatically off real uploaded/linked files instead
 * of a manually-toggled flag, so the grid can never say "YES" for a
 * document nobody actually attached.
 */
export async function getOnboardingDocumentCategoriesByProfileIds(profileIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (profileIds.length === 0) return map;
  const { data, error } = await supabase
    .from("onboarding_documents")
    .select("profile_id, category")
    .in("profile_id", profileIds);
  if (error) {
    if (isMissingTableError(error)) return map;
    throw new Error(error.message);
  }
  for (const r of data ?? []) {
    const set = map.get(r.profile_id) ?? new Set<string>();
    set.add(r.category);
    map.set(r.profile_id, set);
  }
  return map;
}
