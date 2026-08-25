/**
 * Central metadata for every SignableDocumentType — one place mapping a
 * document type to its human label and its dedicated sign/fill route
 * (internal, logged-in vs external, no-login). Used by the "Signed
 * Employment Forms" combine-into-one-link action (ReportHRDaily.tsx) and
 * by the bundle wizard (SignBundlePage/ExternalSignBundlePage) so both
 * stay in sync with the per-type routes without duplicating this list.
 */
import type { SignableDocumentType } from "@/lib/supabase/signableDocuments";

export interface SignableDocumentRegistryEntry {
  label: string;
  /** Route prefix for the logged-in flow, e.g. "/fill-w4" (+ "/$docId"). */
  internalPath: string;
  /** Route prefix for the no-login flow, e.g. "/fill-w4-external" (+ "/$docId"). */
  externalPath: string;
}

export const SIGNABLE_DOCUMENT_REGISTRY: Record<SignableDocumentType, SignableDocumentRegistryEntry> = {
  warning_form: { label: "Employee Warning Form", internalPath: "/sign-document", externalPath: "/sign-external" },
  promotion_form: { label: "Promotion / Role Change Form", internalPath: "/sign-promotion-form", externalPath: "/sign-promotion-external" },
  action_plan_form: { label: "Manager's Action Plan Form", internalPath: "/sign-action-plan-form", externalPath: "/sign-action-plan-external" },
  termination_form: { label: "Notice of Termination", internalPath: "/sign-termination-form", externalPath: "/sign-termination-external" },
  w8ben: { label: "Form W-8BEN", internalPath: "/fill-w8ben", externalPath: "/fill-w8ben-external" },
  w4: { label: "Form W-4", internalPath: "/fill-w4", externalPath: "/fill-w4-external" },
  w9: { label: "Form W-9", internalPath: "/fill-w9", externalPath: "/fill-w9-external" },
  w4r: { label: "Form W-4R", internalPath: "/fill-w4r", externalPath: "/fill-w4r-external" },
  i9: { label: "Form I-9", internalPath: "/fill-i9", externalPath: "/fill-i9-external" },
  wage_ack: { label: "Acknowledgment of Wage", internalPath: "/fill-wage-ack", externalPath: "/fill-wage-ack-external" },
  car_iq_agreement: { label: "Car IQ Technician Agreement", internalPath: "/fill-car-iq-agreement", externalPath: "/fill-car-iq-agreement-external" },
  vehicle_agreement: { label: "Company Vehicle Use Agreement", internalPath: "/fill-vehicle-agreement", externalPath: "/fill-vehicle-agreement-external" },
  employee_confidentiality: { label: "Employee Confidentiality Agreement", internalPath: "/fill-employee-confidentiality", externalPath: "/fill-employee-confidentiality-external" },
  meal_rest_break: { label: "Meal & Rest Break Acknowledgment", internalPath: "/fill-meal-rest-break", externalPath: "/fill-meal-rest-break-external" },
  pto_ack: { label: "PTO & Sick Leave Policy Acknowledgment", internalPath: "/fill-pto-ack", externalPath: "/fill-pto-ack-external" },
  parts_responsibility: { label: "Parts Responsibility & Floor Protection Acknowledgment", internalPath: "/fill-parts-responsibility", externalPath: "/fill-parts-responsibility-external" },
  mileage_fuel: { label: "Mileage & Fuel Policy Agreement", internalPath: "/fill-mileage-fuel", externalPath: "/fill-mileage-fuel-external" },
  location_consent: { label: "Location Sharing Consent Agreement", internalPath: "/fill-location-consent", externalPath: "/fill-location-consent-external" },
  damage: { label: "Damage Agreement", internalPath: "/fill-damage", externalPath: "/fill-damage-external" },
  contractor_data: { label: "Contractor Data", internalPath: "/fill-contractor-data", externalPath: "/fill-contractor-data-external" },
  direct_deposit: { label: "Direct Deposit Authorization", internalPath: "/fill-direct-deposit", externalPath: "/fill-direct-deposit-external" },
  substance_screening: { label: "Substance Screening & Conduct Agreement", internalPath: "/fill-substance-screening", externalPath: "/fill-substance-screening-external" },
};

export function signableDocumentLabel(type: SignableDocumentType): string {
  return SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type;
}
