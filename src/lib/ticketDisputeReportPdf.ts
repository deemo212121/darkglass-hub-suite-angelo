/**
 * Shared PDF-render-and-upload logic for the "Employee Attendance & Visit
 * Exception Report" fields folded into Ticket Time Dispute (migration
 * 0305) — mirrors timecardCorrectionPdf.ts exactly, adapted for
 * EmployeeRequestRow instead of TimecardCorrectionRow and the ticket-
 * dispute-specific template (ticketDisputeReportTemplate.ts, which adds the
 * Customer / Job Details block Time Correction's own template doesn't
 * have).
 */
import {
  buildTicketDisputeReportBodyMarkup,
  ticketDisputeReportStyles,
  type TicketDisputeExceptionType,
  type TicketDisputeReportFormData,
  type TicketDisputeSignatures,
} from "@/lib/ticketDisputeReportTemplate";
import { captureHtmlToPdfBlob, loadAssetDataUrl, resolveSignaturesForCapture } from "@/lib/pdfCapture";
import { uploadExceptionVisitReport, uploadEmployeeRequestSignature, refreshStorageAuthToken } from "@/lib/firebase/storage";
import type { EmployeeRequestRow } from "@/lib/supabase/employeeRequests";

export interface TicketDisputeEmployeeInfo {
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

function formDataFromDispute(
  dateOfIncident: string,
  exceptionType: TicketDisputeExceptionType,
  otherDescription: string,
  detailedReason: string,
  employeeInfo: TicketDisputeEmployeeInfo,
  ticketNo: string,
  extra?: {
    customerName?: string;
    scheduledTime?: string;
    actionTaken?: string;
    managerComments?: string;
    hrReceivedDate?: string;
    hrReviewerName?: string;
    hrActionStatus?: "approved" | "additional_review_required" | "";
  }
): TicketDisputeReportFormData {
  return {
    employeeName: employeeInfo.employeeName,
    technicianId: employeeInfo.technicianId,
    jobTitle: employeeInfo.jobTitle,
    department: employeeInfo.department,
    directManagerName: employeeInfo.directManagerName,
    dateOfIncident,
    exceptionType,
    otherDescription,
    detailedReason,
    ticketNo,
    customerName: extra?.customerName || "",
    scheduledTime: extra?.scheduledTime || "",
    actionTaken: extra?.actionTaken || "",
    managerComments: extra?.managerComments || "",
    hrReceivedDate: extra?.hrReceivedDate || "",
    hrReviewerName: extra?.hrReviewerName || "",
    hrActionStatus: extra?.hrActionStatus || "",
  };
}

/**
 * Employee submission — renders + uploads the PDF with just the employee's
 * own signature. The employee_requests row doesn't exist yet at this point,
 * so the caller pre-generates `requestId` (crypto.randomUUID()) to key the
 * storage path, then passes it into createEmployeeRequest as the row's own
 * `id` — same pattern buildCorrectionSubmissionPdf uses for Time Correction.
 */
export async function buildTicketDisputeSubmissionPdf(input: {
  requestId: string;
  companyId: string;
  employeeInfo: TicketDisputeEmployeeInfo;
  dateOfIncident: string;
  exceptionType: TicketDisputeExceptionType;
  otherDescription: string;
  detailedReason: string;
  ticketNo: string;
  customerName: string;
  scheduledTime: string;
  actionTaken: string;
  employeeSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; employeeSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const employeeSignatureUrl = await uploadEmployeeRequestSignature(input.companyId, input.requestId, "employee", input.employeeSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const formData = formDataFromDispute(input.dateOfIncident, input.exceptionType, input.otherDescription, input.detailedReason, input.employeeInfo, input.ticketNo, {
    customerName: input.customerName,
    scheduledTime: input.scheduledTime,
    actionTaken: input.actionTaken,
  });
  const signatures: TicketDisputeSignatures = { employee: { name: input.employeeInfo.employeeName, url: employeeSignatureUrl, signedAt: new Date().toISOString() } };
  const pdfBlob = await captureHtmlToPdfBlob(buildTicketDisputeReportBodyMarkup(formData, logoDataUrl, signatures), ticketDisputeReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, employeeSignatureUrl };
}

/** Manager approval — stamps the manager's signature (+ comments) onto the already-submitted PDF, merging in the employee's earlier signature. */
export async function buildTicketDisputeManagerSignaturePdf(input: {
  request: EmployeeRequestRow;
  companyId: string;
  employeeInfo: TicketDisputeEmployeeInfo;
  managerName: string;
  managerComments: string;
  managerSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; managerSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const managerSignatureUrl = await uploadEmployeeRequestSignature(input.companyId, input.request.id, "manager", input.managerSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const r = input.request;
  const formData = formDataFromDispute(r.createdAt.slice(0, 10), r.exceptionType || "other", r.otherDescription, r.details, input.employeeInfo, r.ticketNo || "", {
    customerName: r.exceptionCustomerName,
    scheduledTime: r.exceptionScheduledTime,
    actionTaken: r.exceptionActionTaken,
    managerComments: input.managerComments,
    hrReceivedDate: r.hrReceivedDate || "",
    hrReviewerName: r.hrReviewerName || "",
    hrActionStatus: r.hrPaperworkStatus === "pending" ? "" : r.hrPaperworkStatus,
  });
  const signatures: TicketDisputeSignatures = {};
  if (r.employeeSignatureUrl) signatures.employee = { name: r.employeeSignatureName || "", url: r.employeeSignatureUrl, signedAt: r.employeeSignedAt || "" };
  signatures.manager = { name: input.managerName, url: managerSignatureUrl, signedAt: new Date().toISOString() };
  if (r.hrSignatureUrl) signatures.hr_staff = { name: r.hrSignatureName || "", url: r.hrSignatureUrl, signedAt: r.hrSignedAt || "" };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "manager", input.managerSignatureDataUrl);
  const pdfBlob = await captureHtmlToPdfBlob(buildTicketDisputeReportBodyMarkup(formData, logoDataUrl, captureSignatures), ticketDisputeReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, managerSignatureUrl };
}

/** HR paperwork sign-off — stamps the HR signature onto the PDF, merging in the employee's and manager's earlier signatures. */
export async function buildTicketDisputeHrSignaturePdf(input: {
  request: EmployeeRequestRow;
  companyId: string;
  employeeInfo: TicketDisputeEmployeeInfo;
  hrReviewerName: string;
  hrReceivedDate: string;
  hrActionStatus: "approved" | "additional_review_required";
  hrSignatureDataUrl: string;
}): Promise<{ pdfUrl: string; hrSignatureUrl: string }> {
  await refreshStorageAuthToken();
  const hrSignatureUrl = await uploadEmployeeRequestSignature(input.companyId, input.request.id, "hr_staff", input.hrSignatureDataUrl);
  const logoDataUrl = await getLogoDataUrl();
  const r = input.request;
  const formData = formDataFromDispute(r.createdAt.slice(0, 10), r.exceptionType || "other", r.otherDescription, r.details, input.employeeInfo, r.ticketNo || "", {
    customerName: r.exceptionCustomerName,
    scheduledTime: r.exceptionScheduledTime,
    actionTaken: r.exceptionActionTaken,
    managerComments: r.managerComments,
    hrReceivedDate: input.hrReceivedDate,
    hrReviewerName: input.hrReviewerName,
    hrActionStatus: input.hrActionStatus,
  });
  const signatures: TicketDisputeSignatures = {};
  if (r.employeeSignatureUrl) signatures.employee = { name: r.employeeSignatureName || "", url: r.employeeSignatureUrl, signedAt: r.employeeSignedAt || "" };
  if (r.managerSignatureUrl) signatures.manager = { name: r.managerSignatureName || "", url: r.managerSignatureUrl, signedAt: r.managerSignedAt || "" };
  signatures.hr_staff = { name: input.hrReviewerName, url: hrSignatureUrl, signedAt: new Date().toISOString() };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "hr_staff", input.hrSignatureDataUrl);
  const pdfBlob = await captureHtmlToPdfBlob(buildTicketDisputeReportBodyMarkup(formData, logoDataUrl, captureSignatures), ticketDisputeReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl, hrSignatureUrl };
}

/** Re-renders the PDF from whatever's already on file — no new signature capture, same idea as regenerateCorrectionPdf. */
export async function regenerateTicketDisputePdf(input: {
  request: EmployeeRequestRow;
  companyId: string;
  employeeInfo: TicketDisputeEmployeeInfo;
}): Promise<{ pdfUrl: string }> {
  const logoDataUrl = await getLogoDataUrl();
  const r = input.request;
  const formData = formDataFromDispute(r.createdAt.slice(0, 10), r.exceptionType || "other", r.otherDescription, r.details, input.employeeInfo, r.ticketNo || "", {
    customerName: r.exceptionCustomerName,
    scheduledTime: r.exceptionScheduledTime,
    actionTaken: r.exceptionActionTaken,
    managerComments: r.managerComments,
    hrReceivedDate: r.hrReceivedDate || "",
    hrReviewerName: r.hrReviewerName || "",
    hrActionStatus: r.hrPaperworkStatus === "pending" ? "" : r.hrPaperworkStatus,
  });
  const signatures: TicketDisputeSignatures = {};
  if (r.employeeSignatureUrl) signatures.employee = { name: r.employeeSignatureName || "", url: r.employeeSignatureUrl, signedAt: r.employeeSignedAt || "" };
  if (r.managerSignatureUrl) signatures.manager = { name: r.managerSignatureName || "", url: r.managerSignatureUrl, signedAt: r.managerSignedAt || "" };
  if (r.hrSignatureUrl) signatures.hr_staff = { name: r.hrSignatureName || "", url: r.hrSignatureUrl, signedAt: r.hrSignedAt || "" };
  const captureSignatures = await resolveSignaturesForCapture(signatures, "", "");
  const pdfBlob = await captureHtmlToPdfBlob(buildTicketDisputeReportBodyMarkup(formData, logoDataUrl, captureSignatures), ticketDisputeReportStyles);
  const pdfUrl = await uploadExceptionVisitReport(input.companyId, input.employeeInfo.employeeName, pdfBlob);
  return { pdfUrl };
}
