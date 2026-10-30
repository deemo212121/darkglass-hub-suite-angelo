/**
 * HR → HR Paperworks at AH Solutions: only the people below, plus Super
 * Admin — not every HR / Admin role, which is all the page's role gate
 * (dashboardAccess.ts "hr-paperworks") checks. Other companies keep that
 * role gate as is.
 *
 * Keyed by Firebase uid, which stays the same if someone changes their
 * email. To give someone access, add them here.
 *
 * Checked by the page route (m.$module.$submodule.tsx), the tiles that list
 * it (canAccessSubmodule), and ReportHRDaily.tsx, which sends a paperwork
 * tab opened anywhere else (HR To Do List's ?tab= links, sign notifications)
 * to the HR Paperworks page. The "form signed" notifications go only to
 * these people too (hrRoleNotify.ts, signableDocumentsBridge.ts).
 */
import { isCompanySuperAdminRole } from "./roleLabels";

/** AH Solutions — by its code (useAuth's companyId) or its id (profiles.company_id). */
const LIMITED_COMPANY = new Set(["COMP001", "b86acc43-08df-4ef3-aae0-1653cb5a1fcd"]);

const HR_PAPERWORKS_PEOPLE: Record<string, string> = {
  ujnXwUP5RAUZY4JL2A8FsDGSQ8s2: "Wincel Franz Carusca",
  ri5rDxKr1gR752cqRKqs59VMj8m2: "Shin Seo (Angella)",
  jKOTfeiKcDfm0wzOhI4MkG6PhCg1: "Justin Lee",
};

/**
 * True unless this is an AH Solutions account that is neither listed above
 * nor a Super Admin (primary or secondary). An unknown company (still
 * loading) counts as AH Solutions, so the page never opens early.
 */
export function passesHrPaperworksPeopleGate(who: {
  uid: string | null | undefined;
  companyId: string | null | undefined;
  role: string | null | undefined;
  extraRoles: string[] | null | undefined;
}): boolean {
  if (who.companyId && !LIMITED_COMPANY.has(who.companyId)) return true;
  if (isCompanySuperAdminRole(who.role, who.extraRoles)) return true;
  return !!who.uid && Object.prototype.hasOwnProperty.call(HR_PAPERWORKS_PEOPLE, who.uid);
}
