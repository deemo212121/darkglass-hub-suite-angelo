/**
 * Shared PDF-render-and-upload logic for the "Employee Attendance & Visit
 * Exception Report" fields folded directly into Time Correction Request
 * (migration 0304) — every place that submits or approves a correction
 * (EmployeeSelfServicePage.tsx, MobileTimeCorrectionView, CorrectionsTab.tsx,
 * AttendanceMonitoringPage.tsx, ReportHRDaily.tsx, PendingItemDetailModal.tsx,
 * mobile Team Approvals) calls these instead of re-implementing the PDF
 * pipeline itself. Reuses exceptionVisitReportTemplate.ts's markup/styles
 * verbatim — only where the data comes from changed (timecard_corrections
 * rows instead of a standalone document), not the rendered document.
 *
 * Same multi-signer mechanic every other signable document in this app
 * uses: the WHOLE PDF re-renders from scratch every time someone signs,
 * fed every signature collected so far via resolveSignaturesForCapture
 * (proxies earlier signers' Firebase Storage images through /api/image-proxy
 * so html2canvas can rasterize them cross-origin) — see
 * SignPromotionFormPage.tsx for the reference implementation this mirrors.
 */
import {
  buildExceptionVisitReportBodyMarkup,
  exceptionVisitReportStyles,
  type ExceptionType,
  type ExceptionVisitFormData,
  type ExceptionVisitSignatures,
} from "@/lib/exceptionVisitReportTemplate";
import { captureHtmlToPdfBlob, loadAssetDataUrl, resolveSignaturesForCapture } from "@/lib/pdfCapture";
import { uploadExceptionVisitReport, uploadTimecardCorrectionSignature, refreshStorageAuthToken } from "@/lib/firebase/storage";
import type { TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";

export interface CorrectionEmployeeInfo {
  employeeName: string;
  technicianId: string;
  jobTitle: string;
  department: string;
  directManagerName: string;
}

let cachedLogo: string | null = null;
async function getLogoDataUrl(): Promise<string> {
  if (cachedLogo === null) {
    cachedLogo = await loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png"));
  }
  return cachedLogo;
}

function formDataFromCorrection(
  workDate: string,
  exceptionType: ExceptionType,
  otherDescription: string,
  reason: string,
  employeeInfo: CorrectionEmployeeInfo,
  extra?: { managerComments?: string; hrReceivedDate?: string; hrReviewerName?: string; hrActionStatus?: "approved" | "additional_review_required" | "" }
): ExceptionVisitFormData {
  return {
    employeeId: "",
    employeeName: employeeInfo.employeeName,
    technicianId: employeeInfo.technicianId,
    jobTitle: employeeInfo.jobTitle,
    department: employeeInfo.department,
    directManagerName: employeeInfo.directManagerName,
    dateOfIncident: workDate,
    exceptionType,
    otherDescription,
    detailedReason: reason,
    managerComments: extra?.managerComments || "",
    hrReceivedDate: extra?.hrReceivedDate || "",
    hrReviewerName: extra?.hrReviewerName || "",
    hrActionStatus: extra?.hrActionStatus || "",
  };
}

/**
 * Employee submission — renders + uploads the PDF with just the employee's
 * own signature. The correction row doesn't exist yet at this point, so the
 * caller pre-generates `correctionId` (crypto.randomUUID()) to key the
 * storage path, then passes it (plus these URLs) into createTimecardCorrection
 * as the row's own `id` — same pre-generated-key pattern
 * MobileTicketTimeDisputeView already uses for its own attachments.
 */
export async function buildCorrectionSubmissionPdf(input: {
  correctionId: string;
  companyId: string;
  employeeInfo: CorrectionEmployeeInfo;
  workDate: string;
  exceptionType: ExceptionType;
  otherDescription: string;
  reason: string;
  employeeSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; employeeSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const employeeSignatureUrl = await uploadTimecardCorrectionSignature(input.companyId, input.correctionId, "employee", input.employeeSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const formData = formDataFromCorrection(input.workDate, input.exceptionType, input.otherDescription, input.reason, input.employeeInfo);
  const signatures: ExceptionVisitSignatures = { employee: { name: input.employeeInfo.employeeName, url: employeeSignatureUrl, signedAt: new Date().toISOString() } };
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, signatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, employeeSignatureUrl };
}

/**
 * Manager approval — stamps the manager's signature (+ their comments) onto
 * the already-submitted PDF, merging in the employee's earlier signature
 * (and the HR signature, if this correction is somehow being re-signed
 * after HR already acted). Called the instant a manager clicks Approve on
 * the manager stage, from any of the 5 places that can do that.
 */
export async function buildCorrectionManagerSignaturePdf(input: {
  correction: TimecardCorrectionRow;
  companyId: string;
  employeeInfo: CorrectionEmployeeInfo;
  managerName: string;
  managerComments: string;
  managerSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; managerSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const managerSignatureUrl = await uploadTimecardCorrectionSignature(input.companyId, input.correction.id, "manager", input.managerSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const c = input.correction;
  const formData = formDataFromCorrection(c.workDate, c.exceptionType || "other", c.otherDescription, c.reason, input.employeeInfo, {
    managerComments: input.managerComments,
    hrReceivedDate: c.hrReceivedDate || "",
    hrReviewerName: c.hrReviewerName || "",
    hrActionStatus: c.hrPaperworkStatus === "pending" ? "" : c.hrPaperworkStatus,
  });
  const signatures: ExceptionVisitSignatures = {};
  if (c.employeeSignatureUrl) signatures.employee = { name: c.employeeSignatureName || "", url: c.employeeSignatureUrl, signedAt: c.employeeSignedAt || "" };
  signatures.manager = { name: input.managerName, url: managerSignatureUrl, signedAt: new Date().toISOString() };
  if (c.hrSignatureUrl) signatures.hr_staff = { name: c.hrSignatureName || "", url: c.hrSignatureUrl, signedAt: c.hrSignedAt || "" };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "manager", input.managerSignatureDataUrl);
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, captureSignatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, managerSignatureUrl };
}

/**
 * HR paperwork sign-off — stamps the HR signature onto the PDF, merging in
 * the employee's and manager's earlier signatures. Independent of the
 * manager/HR/Accounting approval quorum (see signCorrectionHrPaperwork's own
 * doc comment) — reachable whenever an HR person wants to complete the
 * paperwork, whether or not they were the one who cast the quorum's HR vote.
 */
export async function buildCorrectionHrSignaturePdf(input: {
  correction: TimecardCorrectionRow;
  companyId: string;
  employeeInfo: CorrectionEmployeeInfo;
  hrReviewerName: string;
  hrReceivedDate: string;
  hrActionStatus: "approved" | "additional_review_required";
  hrSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; hrSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const hrSignatureUrl = await uploadTimecardCorrectionSignature(input.companyId, input.correction.id, "hr_staff", input.hrSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const c = input.correction;
  const formData = formDataFromCorrection(c.workDate, c.exceptionType || "other", c.otherDescription, c.reason, input.employeeInfo, {
    managerComments: c.managerComments,
    hrReceivedDate: input.hrReceivedDate,
    hrReviewerName: input.hrReviewerName,
    hrActionStatus: input.hrActionStatus,
  });
  const signatures: ExceptionVisitSignatures = {};
  if (c.employeeSignatureUrl) signatures.employee = { name: c.employeeSignatureName || "", url: c.employeeSignatureUrl, signedAt: c.employeeSignedAt || "" };
  if (c.managerSignatureUrl) signatures.manager = { name: c.managerSignatureName || "", url: c.managerSignatureUrl, signedAt: c.managerSignedAt || "" };
  signatures.hr_staff = { name: input.hrReviewerName, url: hrSignatureUrl, signedAt: new Date().toISOString() };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "hr_staff", input.hrSignatureDataUrl);
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, captureSignatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, hrSignatureUrl };
}

/**
 * Re-renders the PDF from whatever's already on file — no new signature
 * capture, just a fresh pass through the current template with the
 * signatures/comments/status already stored on the row. For fixing a stale
 * PDF after a template bug (e.g. the Manager/SBM line printing the
 * employee's originally-resolved manager instead of whoever actually
 * signed), or any other case where the stored data is right but the
 * rendered file isn't. Every already-signed slot gets proxied through
 * /api/image-proxy (resolveSignaturesForCapture's normal job when re-
 * signing) — passing a freshSlot that matches nothing just means every
 * entry takes that path, none get swapped for a "just signed" data URL.
 */
export async function regenerateCorrectionPdf(input: {
  correction: TimecardCorrectionRow;
  companyId: string;
  employeeInfo: CorrectionEmployeeInfo;
}): Promise<{ pdfUrl: string }> {
  const logoDataUrl = await getLogoDataUrl();
  const c = input.correction;
  const formData = formDataFromCorrection(c.workDate, c.exceptionType || "other", c.otherDescription, c.reason, input.employeeInfo, {
    managerComments: c.managerComments,
    hrReceivedDate: c.hrReceivedDate || "",
    hrReviewerName: c.hrReviewerName || "",
    hrActionStatus: c.hrPaperworkStatus === "pending" ? "" : c.hrPaperworkStatus,
  });
  const signatures: ExceptionVisitSignatures = {};
  if (c.employeeSignatureUrl) signatures.employee = { name: c.employeeSignatureName || "", url: c.employeeSignatureUrl, signedAt: c.employeeSignedAt || "" };
  if (c.managerSignatureUrl) signatures.manager = { name: c.managerSignatureName || "", url: c.managerSignatureUrl, signedAt: c.managerSignedAt || "" };
  if (c.hrSignatureUrl) signatures.hr_staff = { name: c.hrSignatureName || "", url: c.hrSignatureUrl, signedAt: c.hrSignedAt || "" };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "", "");
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, captureSignatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl };
}
