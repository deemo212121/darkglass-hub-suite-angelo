/**
 * Shared PDF-render-and-upload logic for the "Employee Attendance & Visit
 * Exception Report" fields folded into Sick Leave / Unpaid Leave requests
 * (migration 0306) — mirrors timecardCorrectionPdf.ts exactly, adapted for
 * PtoRequestRow. Reuses exceptionVisitReportTemplate.ts (the same template
 * Time Correction uses) verbatim, not the Ticket Time Dispute variant —
 * there's no "Customer / Job Details" block here, this is a plain
 * attendance exception.
 */
import {
  buildExceptionVisitReportBodyMarkup,
  exceptionVisitReportStyles,
  type ExceptionType,
  type ExceptionVisitFormData,
  type ExceptionVisitSignatures,
} from "@/lib/exceptionVisitReportTemplate";
import { captureHtmlToPdfBlob, loadAssetDataUrl, resolveSignaturesForCapture } from "@/lib/pdfCapture";
import { uploadExceptionVisitReport, uploadPtoRequestSignature, refreshStorageAuthToken } from "@/lib/firebase/storage";
import type { PtoRequestRow } from "@/lib/supabase/pto";

export interface PtoEmployeeInfo {
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

function formDataFromPto(
  dateOfIncident: string,
  exceptionType: ExceptionType,
  otherDescription: string,
  detailedReason: string,
  employeeInfo: PtoEmployeeInfo,
  extra?: { managerComments?: string; hrReceivedDate?: string; hrReviewerName?: string; hrActionStatus?: "approved" | "additional_review_required" | "" }
): ExceptionVisitFormData {
  return {
    employeeId: "",
    employeeName: employeeInfo.employeeName,
    technicianId: employeeInfo.technicianId,
    jobTitle: employeeInfo.jobTitle,
    department: employeeInfo.department,
    directManagerName: employeeInfo.directManagerName,
    dateOfIncident,
    exceptionType,
    otherDescription,
    detailedReason,
    managerComments: extra?.managerComments || "",
    hrReceivedDate: extra?.hrReceivedDate || "",
    hrReviewerName: extra?.hrReviewerName || "",
    hrActionStatus: extra?.hrActionStatus || "",
  };
}

/**
 * Employee submission (Sick Leave or Unpaid Leave) — renders + uploads the
 * PDF with just the employee's own signature. The pto_requests row doesn't
 * exist yet at this point, so the caller pre-generates `requestId`
 * (crypto.randomUUID()) to key the storage path, then passes it into
 * createPtoRequest as the row's own `id`.
 */
export async function buildPtoSubmissionPdf(input: {
  requestId: string;
  companyId: string;
  employeeInfo: PtoEmployeeInfo;
  dateOfIncident: string;
  exceptionType: ExceptionType;
  otherDescription: string;
  detailedReason: string;
  employeeSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; employeeSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const employeeSignatureUrl = await uploadPtoRequestSignature(input.companyId, input.requestId, "employee", input.employeeSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const formData = formDataFromPto(input.dateOfIncident, input.exceptionType, input.otherDescription, input.detailedReason, input.employeeInfo);
  const signatures: ExceptionVisitSignatures = { employee: { name: input.employeeInfo.employeeName, url: employeeSignatureUrl, signedAt: new Date().toISOString() } };
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, signatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, employeeSignatureUrl };
}

/** Manager approval — stamps the manager's signature (+ comments) onto the already-submitted PDF, merging in the employee's earlier signature. */
export async function buildPtoManagerSignaturePdf(input: {
  request: PtoRequestRow;
  companyId: string;
  employeeInfo: PtoEmployeeInfo;
  managerName: string;
  managerComments: string;
  managerSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; managerSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const managerSignatureUrl = await uploadPtoRequestSignature(input.companyId, input.request.id, "manager", input.managerSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const r = input.request;
  const formData = formDataFromPto(r.startDate, r.exceptionType || "other", r.otherDescription, r.reason, input.employeeInfo, {
    managerComments: input.managerComments,
    hrReceivedDate: r.hrReceivedDate || "",
    hrReviewerName: r.hrReviewerName || "",
    hrActionStatus: r.hrPaperworkStatus === "pending" ? "" : r.hrPaperworkStatus,
  });
  const signatures: ExceptionVisitSignatures = {};
  if (r.employeeSignatureUrl) signatures.employee = { name: r.employeeSignatureName || "", url: r.employeeSignatureUrl, signedAt: r.employeeSignedAt || "" };
  signatures.manager = { name: input.managerName, url: managerSignatureUrl, signedAt: new Date().toISOString() };
  if (r.hrSignatureUrl) signatures.hr_staff = { name: r.hrSignatureName || "", url: r.hrSignatureUrl, signedAt: r.hrSignedAt || "" };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "manager", input.managerSignatureDataUrl);
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, captureSignatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, managerSignatureUrl };
}

/** HR paperwork sign-off — stamps the HR signature onto the PDF, merging in the employee's and manager's earlier signatures. */
export async function buildPtoHrSignaturePdf(input: {
  request: PtoRequestRow;
  companyId: string;
  employeeInfo: PtoEmployeeInfo;
  hrReviewerName: string;
  hrReceivedDate: string;
  hrActionStatus: "approved" | "additional_review_required";
  hrSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; hrSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const hrSignatureUrl = await uploadPtoRequestSignature(input.companyId, input.request.id, "hr_staff", input.hrSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const r = input.request;
  const formData = formDataFromPto(r.startDate, r.exceptionType || "other", r.otherDescription, r.reason, input.employeeInfo, {
    managerComments: r.managerComments,
    hrReceivedDate: input.hrReceivedDate,
    hrReviewerName: input.hrReviewerName,
    hrActionStatus: input.hrActionStatus,
  });
  const signatures: ExceptionVisitSignatures = {};
  if (r.employeeSignatureUrl) signatures.employee = { name: r.employeeSignatureName || "", url: r.employeeSignatureUrl, signedAt: r.employeeSignedAt || "" };
  if (r.managerSignatureUrl) signatures.manager = { name: r.managerSignatureName || "", url: r.managerSignatureUrl, signedAt: r.managerSignedAt || "" };
  signatures.hr_staff = { name: input.hrReviewerName, url: hrSignatureUrl, signedAt: new Date().toISOString() };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "hr_staff", input.hrSignatureDataUrl);
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, captureSignatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, hrSignatureUrl };
}

/** Re-renders the PDF from whatever's already on file — no new signature capture, same idea as regenerateCorrectionPdf/regenerateTicketDisputePdf. */
export async function regeneratePtoExceptionReportPdf(input: {
  request: PtoRequestRow;
  companyId: string;
  employeeInfo: PtoEmployeeInfo;
}): Promise<{ pdfUrl: string }> {
  const logoDataUrl = await getLogoDataUrl();
  const r = input.request;
  const formData = formDataFromPto(r.startDate, r.exceptionType || "other", r.otherDescription, r.reason, input.employeeInfo, {
    managerComments: r.managerComments,
    hrReceivedDate: r.hrReceivedDate || "",
    hrReviewerName: r.hrReviewerName || "",
    hrActionStatus: r.hrPaperworkStatus === "pending" ? "" : r.hrPaperworkStatus,
  });
  const signatures: ExceptionVisitSignatures = {};
  if (r.employeeSignatureUrl) signatures.employee = { name: r.employeeSignatureName || "", url: r.employeeSignatureUrl, signedAt: r.employeeSignedAt || "" };
  if (r.managerSignatureUrl) signatures.manager = { name: r.managerSignatureName || "", url: r.managerSignatureUrl, signedAt: r.managerSignedAt || "" };
  if (r.hrSignatureUrl) signatures.hr_staff = { name: r.hrSignatureName || "", url: r.hrSignatureUrl, signedAt: r.hrSignedAt || "" };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "", "");
  const pdfBlob = await captureHtmlToPdfBlob(buildExceptionVisitReportBodyMarkup(formData, logoDataUrl, captureSignatures), exceptionVisitReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl };
}
