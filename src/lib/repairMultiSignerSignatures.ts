/**
 * One-time repair for documents signed BEFORE resolveSignaturesForCapture
 * existed (see pdfCapture.ts) — any warning/promotion/action-plan/
 * termination form with 2+ signatures whose stored PDF was generated
 * while an earlier signer's signature was still a bare Firebase Storage
 * URL (silently skipped by html2canvas, no CORS) ends up missing every
 * signature but the last one in the actual PDF, even though the record's
 * live in-app preview (plain <img> tags, no CORS needed) shows them all.
 *
 * Regenerates each affected document's PDF the same way a real signer's
 * page now does — every signature resolved to a local data: URL before
 * compositing — and swaps in the new pdf_url. Meant to be run once (from
 * the browser, since it needs html2canvas/DOM) via a temporary trigger,
 * then removed.
 */
import { getSignableDocuments, updateSignableDocumentPdfUrl, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { captureHtmlToPdfBlob, loadAssetDataUrl, resolveSignaturesForCapture } from "@/lib/pdfCapture";
import { uploadWarningForm, uploadPromotionForm, uploadActionPlanForm, uploadTerminationForm } from "@/lib/firebase/storage";
import { buildWarningFormBodyMarkup, warningFormStyles, type WarningFormData } from "@/lib/warningFormTemplate";
import { buildPromotionFormBodyMarkup, promotionFormStyles, type PromotionFormData } from "@/lib/promotionFormTemplate";
import { buildActionPlanFormBodyMarkup, actionPlanFormStyles, type ActionPlanFormData } from "@/lib/actionPlanFormTemplate";
import { buildTerminationFormBodyMarkup, terminationFormStyles, type TerminationFormData } from "@/lib/terminationFormTemplate";

export interface RepairResult {
  checked: number;
  repaired: string[];
  failed: { id: string; type: SignableDocumentType; error: string }[];
}

const MULTI_SIGNER_TYPES: SignableDocumentType[] = ["warning_form", "promotion_form", "action_plan_form", "termination_form"];

export async function repairMultiSignerPdfs(onProgress?: (msg: string) => void): Promise<RepairResult> {
  const result: RepairResult = { checked: 0, repaired: [], failed: [] };

  const [logo, ribbon, footer] = await Promise.all([
    loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
    loadAssetDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
    loadAssetDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
  ]);

  for (const type of MULTI_SIGNER_TYPES) {
    const docs = await getSignableDocuments(type);
    for (const doc of docs) {
      // A single-signature document was never affected (nothing else to
      // composite) — only documents with 2+ actual signatures and an
      // already-generated PDF are candidates.
      const sigCount = Object.values(doc.signatures).filter(Boolean).length;
      if (!doc.pdfUrl || sigCount < 2) continue;
      result.checked++;
      const employeeName = (doc.formData as { employeeName?: string })?.employeeName || "employee";
      onProgress?.(`Checking ${type} — ${employeeName}...`);
      try {
        // Every signature here is historical (nobody is "just signing"
        // right now) — "__none__" never matches a real slot key, so every
        // entry goes through the fetch-and-convert path.
        const captureSignatures = await resolveSignaturesForCapture(doc.signatures, "__none__", "");
        let pdfBlob: Blob;
        let pdfUrl: string;
        if (type === "warning_form") {
          pdfBlob = await captureHtmlToPdfBlob(buildWarningFormBodyMarkup(doc.formData as unknown as WarningFormData, logo, captureSignatures), warningFormStyles);
          pdfUrl = await uploadWarningForm(doc.companyId, employeeName, pdfBlob);
        } else if (type === "promotion_form") {
          pdfBlob = await captureHtmlToPdfBlob(buildPromotionFormBodyMarkup(doc.formData as unknown as PromotionFormData, logo, captureSignatures), promotionFormStyles);
          pdfUrl = await uploadPromotionForm(doc.companyId, employeeName, pdfBlob);
        } else if (type === "action_plan_form") {
          pdfBlob = await captureHtmlToPdfBlob(buildActionPlanFormBodyMarkup(doc.formData as unknown as ActionPlanFormData, logo, ribbon, footer, captureSignatures), actionPlanFormStyles);
          pdfUrl = await uploadActionPlanForm(doc.companyId, employeeName, pdfBlob);
        } else {
          pdfBlob = await captureHtmlToPdfBlob(buildTerminationFormBodyMarkup(doc.formData as unknown as TerminationFormData, logo, ribbon, footer, captureSignatures), terminationFormStyles);
          pdfUrl = await uploadTerminationForm(doc.companyId, employeeName, pdfBlob);
        }
        await updateSignableDocumentPdfUrl(doc.id, pdfUrl);
        result.repaired.push(`${type}: ${employeeName} (${doc.id})`);
      } catch (err) {
        result.failed.push({ id: doc.id, type, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}
