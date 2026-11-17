/**
 * Terms & Conditions (migration 0455) — the rules shared by the Admin page
 * and the accept window:
 *
 *   • who a set of terms is for (Everyone, or any of its roles / departments /
 *     branches) — the same rule as SQL's terms_audience_matches();
 *   • whether someone still has to accept: the newest version, unless they
 *     accepted it, or accepted an earlier one and no version since needs
 *     everyone to accept again — the same rule as terms_pending_for_me().
 */

export interface TermsAudience {
  everyone: boolean;
  roles?: string[];
  departments?: string[];
  branches?: string[];
}

export interface TermsDocument {
  id: string;
  /** Draft title / text — what Publish makes live. */
  title: string;
  body: string;
  audience: TermsAudience;
  /** No longer asked (acceptances kept). */
  archived: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
}

export interface TermsVersion {
  id: string;
  documentId: string;
  version: number;
  title: string;
  body: string;
  audience: TermsAudience;
  requiresReaccept: boolean;
  publishedAt: string;
  publishedByName: string | null;
}

export interface TermsAcceptance {
  id: string;
  documentId: string;
  versionId: string;
  profileId: string;
  displayName: string | null;
  device: string;
  acceptedAt: string;
}

/** The terms someone still has to accept (from terms_pending_for_me()). */
export interface PendingTerms {
  versionId: string;
  documentId: string;
  version: number;
  title: string;
  body: string;
  publishedAt: string;
}

export interface TermsPerson {
  role?: string | null;
  extra_roles?: string[] | null;
  department?: string | null;
  assigned_branch?: string | null;
}

export const EVERYONE: TermsAudience = { everyone: true };

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const branchKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** A clean audience from whatever is stored (old / partial json). */
export function toAudience(raw: unknown): TermsAudience {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((x) => x.trim()) : []);
  const roles = list(a.roles);
  const departments = list(a.departments);
  const branches = list(a.branches);
  const everyone = a.everyone === true || (a.everyone === undefined && !roles.length && !departments.length && !branches.length);
  return everyone ? { everyone: true } : { everyone: false, roles, departments, branches };
}

/** Is this set of terms for this person? Everyone, or any one of its roles / departments / branches. */
export function audienceMatches(audience: TermsAudience, p: TermsPerson): boolean {
  if (audience.everyone) return true;
  const myRoles = new Set([up(p.role), ...(p.extra_roles ?? []).map(up)].filter(Boolean));
  if ((audience.roles ?? []).some((r) => myRoles.has(up(r)))) return true;
  if (p.department && (audience.departments ?? []).some((d) => low(d) === low(p.department))) return true;
  if (p.assigned_branch && (audience.branches ?? []).some((b) => branchKey(b) === branchKey(p.assigned_branch))) return true;
  return false;
}

/** Nobody picked yet — publishing would reach no one. */
export const audienceIsEmpty = (a: TermsAudience) =>
  !a.everyone && !(a.roles?.length || a.departments?.length || a.branches?.length);

/** "Everyone" or "Technician, Accounting · Raleigh". */
export function audienceText(a: TermsAudience, roleName: (r: string) => string = (r) => r): string {
  if (a.everyone) return "Everyone";
  const parts = [
    (a.roles ?? []).map(roleName).join(", "),
    (a.departments ?? []).join(", "),
    (a.branches ?? []).join(", "),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nobody yet";
}

/**
 * Has this person accepted what they need to for one set of terms?
 * `versions` = that set's published versions; `acceptedVersionIds` = the ones they accepted.
 * True when nothing is published yet.
 */
export function hasAcceptedLatest(versions: Pick<TermsVersion, "id" | "version" | "requiresReaccept">[], acceptedVersionIds: Set<string>): boolean {
  if (!versions.length) return true;
  // The newest version everyone had to accept (version 1 always counts).
  const mustHave = Math.max(...versions.filter((v) => v.requiresReaccept || v.version === 1).map((v) => v.version), 1);
  return versions.some((v) => v.version >= mustHave && acceptedVersionIds.has(v.id));
}

/** A draft differs from what's live (or was never published). */
export function draftChanged(doc: Pick<TermsDocument, "title" | "body" | "audience">, latest: Pick<TermsVersion, "title" | "body" | "audience"> | undefined): boolean {
  if (!latest) return true;
  return doc.title !== latest.title || doc.body !== latest.body || JSON.stringify(toAudience(doc.audience)) !== JSON.stringify(toAudience(latest.audience));
}

/** True when the HTML has no words in it (an empty editor gives "<p></p>"). */
export const bodyIsEmpty = (html: string) => !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
