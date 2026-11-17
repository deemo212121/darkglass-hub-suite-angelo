import { supabase } from "./client";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import {
  toAudience,
  type PendingTerms,
  type TermsAcceptance,
  type TermsAudience,
  type TermsDocument,
  type TermsVersion,
} from "@/lib/terms";

/** Admin → Terms & Conditions and the accept window (migration 0455). */

const missing = (message: string) => /terms_(documents|versions|acceptances|pending_for_me|accept|publish)|schema cache|does not exist/i.test(message);
const friendly = (message: string) => (missing(message) ? "Run migration 0455 in Supabase first." : message);

const mapDoc = (r: any): TermsDocument => ({
  id: r.id,
  title: r.title ?? "",
  body: r.body ?? "",
  audience: toAudience(r.audience),
  archived: !!r.archived,
  createdByName: r.created_by_name ?? null,
  createdAt: r.created_at,
  updatedByName: r.updated_by_name ?? null,
  updatedAt: r.updated_at,
});

const mapVersion = (r: any): TermsVersion => ({
  id: r.id,
  documentId: r.document_id,
  version: r.version,
  title: r.title,
  body: r.body,
  audience: toAudience(r.audience),
  requiresReaccept: !!r.requires_reaccept,
  publishedAt: r.published_at,
  publishedByName: r.published_by_name ?? null,
});

const mapAcceptance = (r: any): TermsAcceptance => ({
  id: r.id,
  documentId: r.document_id,
  versionId: r.version_id,
  profileId: r.profile_id,
  displayName: r.display_name ?? null,
  device: r.device ?? "web",
  acceptedAt: r.accepted_at,
  email: r.email ?? null,
  ip: r.ip ?? null,
  ipCity: r.ip_city ?? null,
  ipRegion: r.ip_region ?? null,
  ipCountry: r.ip_country ?? null,
  browser: r.browser ?? null,
  usualIp: r.usual_ip ?? null,
  ipMatches: r.ip_matches ?? null,
});

// ---- Admin page ----------------------------------------------------------

export async function getTermsDocuments(): Promise<TermsDocument[]> {
  const { data, error } = await supabase.from("terms_documents").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(friendly(error.message));
  return (data ?? []).map(mapDoc);
}

export async function getTermsVersions(): Promise<TermsVersion[]> {
  const { data, error } = await supabase.from("terms_versions").select("*").order("version", { ascending: false });
  if (error) throw new Error(friendly(error.message));
  return (data ?? []).map(mapVersion);
}

export async function getTermsAcceptances(): Promise<TermsAcceptance[]> {
  const out: TermsAcceptance[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("terms_acceptances").select("*").order("accepted_at", { ascending: false }).range(from, from + 999);
    if (error) throw new Error(friendly(error.message));
    out.push(...(data ?? []).map(mapAcceptance));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** A new, empty set of terms (a draft — nobody sees it). company_id and names are stamped by the database. */
export async function createTermsDocument(title: string): Promise<TermsDocument> {
  const { data, error } = await supabase.from("terms_documents").insert({ title, body: "", audience: { everyone: true } }).select("*").single();
  if (error) throw new Error(friendly(error.message));
  return mapDoc(data);
}

export async function saveTermsDraft(id: string, draft: { title: string; body: string; audience: TermsAudience }): Promise<TermsDocument> {
  const { data, error } = await supabase
    .from("terms_documents")
    .update({ title: draft.title.trim(), body: draft.body, audience: toAudience(draft.audience) })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(friendly(error.message));
  return mapDoc(data);
}

/** Stop asking (or ask again). Acceptances are kept either way. */
export async function setTermsArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from("terms_documents").update({ archived }).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

/** Only a set that was never published can be deleted (the database refuses otherwise). */
export async function deleteTermsDocument(id: string): Promise<void> {
  const { error } = await supabase.from("terms_documents").delete().eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

/** Makes the saved draft live as the next version. */
export async function publishTerms(documentId: string, requiresReaccept: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("terms_publish", { p_document_id: documentId, p_requires_reaccept: requiresReaccept });
  if (error) throw new Error(friendly(error.message));
  return data as string;
}

// ---- Everyone ------------------------------------------------------------

/**
 * What the signed-in person still has to accept. null when it can't be checked
 * (migration not run yet, offline) — the window then stays away instead of locking everyone out.
 */
export async function getMyPendingTerms(): Promise<PendingTerms[] | null> {
  const { data, error } = await supabase.rpc("terms_pending_for_me");
  if (error) {
    if (!missing(error.message)) console.warn("terms_pending_for_me:", error.message);
    return null;
  }
  return ((data ?? []) as any[]).map((r) => ({
    versionId: r.version_id,
    documentId: r.document_id,
    version: r.version,
    title: r.title,
    body: r.body,
    publishedAt: r.published_at,
  }));
}

/**
 * Through /api/terms-accept, which also records where it was accepted from
 * (migration 0456 — IP, compared with the person's usual sign-in IP). If the
 * server can't be reached (or on the local dev server, which doesn't run it),
 * straight to terms_accept() instead — without the IP — so nobody is stuck
 * behind the window.
 */
export async function acceptTerms(versionId: string, device: "web" | "mobile"): Promise<void> {
  const idToken = await firebaseAuth?.currentUser?.getIdToken(false).catch(() => null);
  if (idToken) {
    const res = await fetch("/api/terms-accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, versionId, device }),
    }).catch(() => null);
    if (res?.ok) return;
    if (res && (res.status === 401 || res.status === 403)) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "Sign in again to accept.");
    }
    console.warn("/api/terms-accept:", res ? res.status : "unreachable", "— accepting without the IP");
  }
  const { error } = await supabase.rpc("terms_accept", { p_version_id: versionId, p_device: device });
  if (error) throw new Error(friendly(error.message));
}

/** Profile → "Terms & Conditions": what I accepted (newest first), with the text. */
export async function getMyAcceptedTerms(profileId: string): Promise<{ acceptance: TermsAcceptance; version: TermsVersion }[]> {
  const { data, error } = await supabase
    .from("terms_acceptances")
    .select("*, terms_versions(*)")
    .eq("profile_id", profileId)
    .order("accepted_at", { ascending: false });
  if (error) throw new Error(friendly(error.message));
  return (data ?? [])
    .filter((r: any) => r.terms_versions)
    .map((r: any) => ({ acceptance: mapAcceptance(r), version: mapVersion(r.terms_versions) }));
}
