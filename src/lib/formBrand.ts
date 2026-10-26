/**
 * Which company a form copy is issued under. HR Paperworks' "AHS FORMS PH"
 * group sends the Admin Hub Solutions versions (form_data.brand = "ahs");
 * everything else — and every copy sent before that group existed — is the
 * original US In Home Services version. A copy keeps its version for good,
 * including when its PDF is regenerated.
 *
 * Used by Direct Deposit, Valid ID and the Master PH Contractor Agreement
 * (same title in both versions — only the company name and logo differ).
 */
import { loadAssetDataUrl } from "@/lib/pdfCapture";

export type FormBrand = "ahs" | "usihs";

export function brandOf(formData: unknown): FormBrand {
  return (formData as { brand?: string } | null | undefined)?.brand === "ahs" ? "ahs" : "usihs";
}

export const BRAND_COMPANY: Record<FormBrand, string> = {
  ahs: "Admin Hub Solutions",
  usihs: "US In Home Services",
};

/** The logo drawn on the PDF for each version. */
export function loadBrandLogo(brand: FormBrand): Promise<string> {
  return brand === "ahs"
    ? loadAssetDataUrl(() => import("@/assets/AHS logo.png"))
    : loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png"));
}
