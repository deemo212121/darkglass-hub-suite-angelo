/**
 * Logo for the HR agreements that come in a US In Home Services and an Admin
 * Hub Solutions version — the Master W-2 Office & Logistics agreement (its
 * wording version 2, signableDocumentRegistry.ts) and the Master
 * Confidentiality agreement (copies sent from AHS Forms PH, lib/formBrand.ts).
 * A document keeps the name and logo it was sent / signed in, so an
 * agreement someone already signed never re-renders under a different
 * company's name.
 */
export function agreementLogoLoader(adminHubBranding: boolean): () => Promise<{ default: string }> {
  return adminHubBranding
    ? () => import("@/assets/admin-hub-solutions-logo-badge.png")
    : () => import("@/assets/us-in-home-services-logo.png");
}
