/**
 * HR agreements that switched from US In Home Services to Admin Hub
 * Solutions branding in a later wording version (signableDocumentRegistry.ts —
 * Master Confidentiality v3, Master W-2 Office & Logistics v2). A document
 * keeps the name and logo of the version it was sent / signed in, so an
 * agreement someone already signed never re-renders under a different
 * company's name.
 */
export function agreementLogoLoader(adminHubBranding: boolean): () => Promise<{ default: string }> {
  return adminHubBranding
    ? () => import("@/assets/admin-hub-solutions-logo-badge.png")
    : () => import("@/assets/us-in-home-services-logo.png");
}
