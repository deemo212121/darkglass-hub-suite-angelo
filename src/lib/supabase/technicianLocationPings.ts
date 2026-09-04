/**
 * Real GPS location pings for technicians — see migration
 * 0189_technician_location_pings.sql for the full RLS story (reads
 * restricted to Admin/SuperAdmin, writes restricted to the technician's
 * own row and only while they have a genuinely open shift). One row per
 * technician, overwritten on every ping — no history is kept.
 */
import { supabase } from "./client";
import { getSignableDocuments } from "./signableDocuments";

export interface TechnicianLocationPing {
  profileId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string;
  updatedAt: string;
}

/**
 * Upserts the caller's own current position. Rejected by RLS (42501) if
 * they're not on an open shift. company_id is deliberately omitted from
 * the payload and left for the trg_technician_location_pings_company
 * trigger (migration 0190) to auto-stamp from the caller's own JWT —
 * useAuth()'s companyId is the legacy human-readable company code (e.g.
 * "COMP001"), not the real companies.id UUID this table's FK needs.
 */
export async function upsertMyLocationPing(
  profileId: string,
  lat: number,
  lng: number,
  accuracyM: number | null,
  recordedAt: string
): Promise<void> {
  const { error } = await supabase
    .from("technician_location_pings")
    .upsert(
      { profile_id: profileId, lat, lng, accuracy_m: accuracyM, recorded_at: recordedAt, updated_at: new Date().toISOString() },
      { onConflict: "profile_id" }
    );
  if (error) throw new Error(error.message);
}

/** Clears the caller's own position — called the moment they clock out, so no stale pin lingers into off-hours. */
export async function clearMyLocationPing(profileId: string): Promise<void> {
  const { error } = await supabase.from("technician_location_pings").delete().eq("profile_id", profileId);
  if (error) throw new Error(error.message);
}

/** Every technician's latest ping for the caller's company — RLS already restricts this to Admin/SuperAdmin callers. */
export async function getCompanyLocationPings(): Promise<TechnicianLocationPing[]> {
  const { data, error } = await supabase
    .from("technician_location_pings")
    .select("profile_id, lat, lng, accuracy_m, recorded_at, updated_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    profileId: r.profile_id,
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracy_m,
    recordedAt: r.recorded_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * True once this employee's Location Consent document has been signed by
 * both sides (status "confirmed" — see ReportHRDaily.tsx's
 * handleSaveLocationConsentEmployerSignature). Gates whether
 * TechnicianLocationTracker ever prompts them at all.
 *
 * Identity match is on `recipient_id` — the real column HR sets when the
 * document is addressed to an in-app teammate — with `form_data.employeeId`
 * kept only as a fallback for older rows. The JSON copy alone was
 * unreliable: the "Completed" document could carry a blank/edited
 * employeeId (e.g. sent via the external-link flow, which hardcodes
 * `employeeId: ""`) while recipient_id was correct all along, so a
 * genuinely signed-and-confirmed consent still read as missing on the
 * technician's phone. This matches how getTechnicianIdsMissingRouteDocuments
 * keys the same document type.
 */
export async function hasConfirmedLocationConsent(profileId: string): Promise<boolean> {
  const docs = await getSignableDocuments("location_consent");
  return docs.some(
    (d) =>
      d.status === "confirmed" &&
      (d.recipientId === profileId || (d.formData as { employeeId?: string })?.employeeId === profileId)
  );
}
