/**
 * "Regenerate PDF" — re-runs a signable document's HTML→PDF capture from
 * its already-stored form_data/signatures, replacing pdf_url with a fresh
 * render. Built for the date-rollback bug fix (see each form template's
 * fmtDate — a date-only string used to render a day early in some
 * timezones): fixing fmtDate only changes documents generated FROM NOW ON,
 * since an already-generated PDF has the wrong date baked in as rendered
 * pixels, not editable text. This lets HR fix an already-signed document
 * without asking the signer to redo anything.
 *
 * Two shapes, matching the two ways this app's HTML-template forms store
 * signatures:
 *
 * - regenerateSimpleSignableDocumentPdf — single-party (or "employee" is
 *   the only signer that matters for rendering) forms whose signature
 *   lives in hr_signable_documents.signatures, a Firebase Storage URL.
 *   html2canvas can't draw a cross-origin image without CORS headers, so
 *   that URL needs the same /api/image-proxy round-trip
 *   resolveSignaturesForCapture already does for every OTHER signer when
 *   a fresh one is added — here there's no fresh signer, so every entry
 *   goes through the proxy.
 *
 * - regenerateMasterAgreementPdf — the two-party Master Agreements
 *   (W-2 Technician/Office/Executive, PH Contractor), whose employee AND
 *   employer signatures are stored as data: URLs directly inline in
 *   form_data (never re-fetched from Storage — see e.g.
 *   masterW2AgreementFormTemplate.ts's employeeSignatureDataUrl field).
 *   No CORS resolution needed at all; the raw pixels are already local.
 */
import { captureHtmlToPdfBlob, resolveSignaturesForCapture } from "@/lib/pdfCapture";
import { updateSignableDocumentPdfUrl } from "@/lib/supabase/signableDocuments";

interface RegenerateDocLike {
  id: string;
  companyId: string;
  formData: Record<string, any>;
  signatures?: Partial<Record<string, { url: string; name: string; signedAt: string }>>;
}

export async function regenerateSimpleSignableDocumentPdf<TFormData, TSig extends { url: string }>(
  doc: RegenerateDocLike,
  logoDataUrl: string,
  buildMarkup: (data: TFormData, logo: string, signature: TSig | undefined) => string,
  styles: string,
  uploadFn: (companyId: string, name: string, blob: Blob) => Promise<string>,
  employeeName: string
): Promise<string> {
  const formData = doc.formData as TFormData;
  const resolved = await resolveSignaturesForCapture(
    (doc.signatures ?? {}) as Partial<Record<string, TSig>>,
    "__regenerate__",
    ""
  );
  const signature = resolved.employee as TSig | undefined;
  const pdfBlob = await captureHtmlToPdfBlob(buildMarkup(formData, logoDataUrl, signature), styles);
  const pdfUrl = await uploadFn(doc.companyId, employeeName, pdfBlob);
  await updateSignableDocumentPdfUrl(doc.id, pdfUrl);
  return pdfUrl;
}

export async function regenerateMasterAgreementPdf<TFormData>(
  doc: RegenerateDocLike,
  logoDataUrl: string,
  buildMarkup: (data: TFormData, logo: string) => string,
  styles: string,
  uploadFn: (companyId: string, name: string, blob: Blob) => Promise<string>,
  employeeName: string
): Promise<string> {
  const formData = doc.formData as TFormData;
  const pdfBlob = await captureHtmlToPdfBlob(buildMarkup(formData, logoDataUrl), styles);
  const pdfUrl = await uploadFn(doc.companyId, employeeName, pdfBlob);
  await updateSignableDocumentPdfUrl(doc.id, pdfUrl);
  return pdfUrl;
}
