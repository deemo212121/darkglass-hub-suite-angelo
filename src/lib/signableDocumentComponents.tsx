/**
 * Lazy-loaded page components for every SignableDocumentType, keyed the
 * same way as signableDocumentRegistry.ts. Used only by the bundle wizard
 * (SignBundlePage/ExternalSignBundlePage) so stepping through a bundle
 * code-splits per document type on demand instead of pulling in all 22
 * fill/sign pages up front. Every one of these already takes a plain
 * `docId` prop and does its own data fetching/signing — see e.g.
 * SignDocumentPage.tsx — so rendering them here needs no changes to the
 * components themselves.
 */
import { lazy } from "react";
import type { SignableDocumentType } from "@/lib/supabase/signableDocuments";

export const INTERNAL_SIGNABLE_DOCUMENT_COMPONENTS: Record<SignableDocumentType, ReturnType<typeof lazy>> = {
  warning_form: lazy(() => import("@/components/SignDocumentPage").then((m) => ({ default: m.SignDocumentPage }))),
  promotion_form: lazy(() => import("@/components/SignPromotionFormPage").then((m) => ({ default: m.SignPromotionFormPage }))),
  action_plan_form: lazy(() => import("@/components/SignActionPlanFormPage").then((m) => ({ default: m.SignActionPlanFormPage }))),
  termination_form: lazy(() => import("@/components/SignTerminationFormPage").then((m) => ({ default: m.SignTerminationFormPage }))),
  w8ben: lazy(() => import("@/components/FillW8benPage").then((m) => ({ default: m.FillW8benPage }))),
  w4: lazy(() => import("@/components/FillW4Page").then((m) => ({ default: m.FillW4Page }))),
  w9: lazy(() => import("@/components/FillW9Page").then((m) => ({ default: m.FillW9Page }))),
  w4r: lazy(() => import("@/components/FillW4RPage").then((m) => ({ default: m.FillW4RPage }))),
  i9: lazy(() => import("@/components/FillI9Page").then((m) => ({ default: m.FillI9Page }))),
  wage_ack: lazy(() => import("@/components/FillWageAckPage").then((m) => ({ default: m.FillWageAckPage }))),
  car_iq_agreement: lazy(() => import("@/components/FillCarIqAgreementPage").then((m) => ({ default: m.FillCarIqAgreementPage }))),
  vehicle_agreement: lazy(() => import("@/components/FillVehicleAgreementPage").then((m) => ({ default: m.FillVehicleAgreementPage }))),
  employee_confidentiality: lazy(() => import("@/components/FillEmployeeConfidentialityPage").then((m) => ({ default: m.FillEmployeeConfidentialityPage }))),
  meal_rest_break: lazy(() => import("@/components/FillMealRestBreakPage").then((m) => ({ default: m.FillMealRestBreakPage }))),
  pto_ack: lazy(() => import("@/components/FillPtoAckPage").then((m) => ({ default: m.FillPtoAckPage }))),
  parts_responsibility: lazy(() => import("@/components/FillPartsResponsibilityPage").then((m) => ({ default: m.FillPartsResponsibilityPage }))),
  mileage_fuel: lazy(() => import("@/components/FillMileageFuelPage").then((m) => ({ default: m.FillMileageFuelPage }))),
  location_consent: lazy(() => import("@/components/FillLocationConsentPage").then((m) => ({ default: m.FillLocationConsentPage }))),
  damage: lazy(() => import("@/components/FillDamagePage").then((m) => ({ default: m.FillDamagePage }))),
  contractor_data: lazy(() => import("@/components/FillContractorDataPage").then((m) => ({ default: m.FillContractorDataPage }))),
  direct_deposit: lazy(() => import("@/components/FillDirectDepositPage").then((m) => ({ default: m.FillDirectDepositPage }))),
};

export const EXTERNAL_SIGNABLE_DOCUMENT_COMPONENTS: Record<SignableDocumentType, ReturnType<typeof lazy>> = {
  warning_form: lazy(() => import("@/components/ExternalSignDocumentPage").then((m) => ({ default: m.ExternalSignDocumentPage }))),
  promotion_form: lazy(() => import("@/components/ExternalSignPromotionFormPage").then((m) => ({ default: m.ExternalSignPromotionFormPage }))),
  action_plan_form: lazy(() => import("@/components/ExternalSignActionPlanFormPage").then((m) => ({ default: m.ExternalSignActionPlanFormPage }))),
  termination_form: lazy(() => import("@/components/ExternalSignTerminationFormPage").then((m) => ({ default: m.ExternalSignTerminationFormPage }))),
  w8ben: lazy(() => import("@/components/ExternalFillW8benPage").then((m) => ({ default: m.ExternalFillW8benPage }))),
  w4: lazy(() => import("@/components/ExternalFillW4Page").then((m) => ({ default: m.ExternalFillW4Page }))),
  w9: lazy(() => import("@/components/ExternalFillW9Page").then((m) => ({ default: m.ExternalFillW9Page }))),
  w4r: lazy(() => import("@/components/ExternalFillW4RPage").then((m) => ({ default: m.ExternalFillW4RPage }))),
  i9: lazy(() => import("@/components/ExternalFillI9Page").then((m) => ({ default: m.ExternalFillI9Page }))),
  wage_ack: lazy(() => import("@/components/ExternalFillWageAckPage").then((m) => ({ default: m.ExternalFillWageAckPage }))),
  car_iq_agreement: lazy(() => import("@/components/ExternalFillCarIqAgreementPage").then((m) => ({ default: m.ExternalFillCarIqAgreementPage }))),
  vehicle_agreement: lazy(() => import("@/components/ExternalFillVehicleAgreementPage").then((m) => ({ default: m.ExternalFillVehicleAgreementPage }))),
  employee_confidentiality: lazy(() => import("@/components/ExternalFillEmployeeConfidentialityPage").then((m) => ({ default: m.ExternalFillEmployeeConfidentialityPage }))),
  meal_rest_break: lazy(() => import("@/components/ExternalFillMealRestBreakPage").then((m) => ({ default: m.ExternalFillMealRestBreakPage }))),
  pto_ack: lazy(() => import("@/components/ExternalFillPtoAckPage").then((m) => ({ default: m.ExternalFillPtoAckPage }))),
  parts_responsibility: lazy(() => import("@/components/ExternalFillPartsResponsibilityPage").then((m) => ({ default: m.ExternalFillPartsResponsibilityPage }))),
  mileage_fuel: lazy(() => import("@/components/ExternalFillMileageFuelPage").then((m) => ({ default: m.ExternalFillMileageFuelPage }))),
  location_consent: lazy(() => import("@/components/ExternalFillLocationConsentPage").then((m) => ({ default: m.ExternalFillLocationConsentPage }))),
  damage: lazy(() => import("@/components/ExternalFillDamagePage").then((m) => ({ default: m.ExternalFillDamagePage }))),
  contractor_data: lazy(() => import("@/components/ExternalFillContractorDataPage").then((m) => ({ default: m.ExternalFillContractorDataPage }))),
  direct_deposit: lazy(() => import("@/components/ExternalFillDirectDepositPage").then((m) => ({ default: m.ExternalFillDirectDepositPage }))),
};
