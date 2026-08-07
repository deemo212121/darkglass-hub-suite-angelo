// ServicePower API Type Definitions

// ============================================================================
// Common Types
// ============================================================================

export interface Authentication {
  userId: string;
  password: string;
}

export interface ApiResponse<T> {
  responseCode: 'OK' | 'ER';
  transactionId?: string;
  messages?: Array<{ message: string }>;
  data?: T;
}

// ============================================================================
// Claims Retrieval API Types
// ============================================================================

export interface ClaimsRetrievalRequest {
  manufacturerName: string;
  serviceCenterNumber?: string;
  claimIdentifier?: string;
  claimBatchNumber?: number;
  claimSequenceNumber?: number;
  claimNumber?: string;
  callNumber?: string;
  authentication: Authentication;
}

export interface ClaimData {
  claimNumber: string;
  claimIdentifier: string;
  claimBatchNumber: number;
  claimSequenceNumber: number;
  claimStatusCode: string;
  claimStatusDescription: string;
  callNumber: string;
  authorizationNumber: string;
  brandName: string;
  productName: string;
  modelNumber: string;
  serialNumber: string;
  servicerNumber: string;
  servicerName: string;
  receivedDate: string; // CCYYMMDD
  editedDate: string; // CCYYMMDD
  paymentType: string;
  paymentMethod: string;
  paymentAmount: number;
  paymentDate: string; // CCYYMMDD
  periodEndingDate: string; // CCYYMMDD
  paymentTransactionNumber: number;
  paidLaborAmount: number;
  paidPartsAmount: number;
  paidPartsHandlingAmount: number;
  paidTravelAmount: number;
  paidOtherAmount: number;
  paidMileageAmount: number;
  paidShippingAmount: number;
  paidFreightAmount: number;
  paidIncentiveAmount: number;
  paidFederalTaxAmount: number;
  paidStateTaxAmount: number;
}

export interface ClaimsRetrievalResponse {
  responseCode: 'OK' | 'ER';
  transactionId: string;
  claims?: ClaimData[];
  messages?: Array<{ message: string }>;
}

// ============================================================================
// Claims Submission API Types
// ============================================================================

/** One line of ClaimSubmissionClaim.parts — "number" is the only mandatory field. */
export interface ClaimSubmissionPart {
  number: string;
  quantity?: number;
  description?: string;
  schematicLocation?: string;
  invoiceNumber?: string;
  priceRequested?: number;
  returned?: 'Y' | 'N';
  distributorNumber?: string;
  faultCode?: string;
  jobCode?: string;
}

/**
 * One entry of the Claims array POSTed to services/claim/v1/submission.
 * manufacturerName + claimNumber are the only two elements the API itself
 * marks Mandatory; everything else is optional but, per the integration
 * guide, any field omitted on an UPDATE (existingClaimBatchNumber set)
 * is treated as blank/zero and overwrites whatever SP already has — see
 * buildServicePowerClaimPayload (servicePowerClaimPayload.ts), which always
 * sends the claim's full current state rather than a partial diff.
 */
export interface ClaimSubmissionClaim {
  manufacturerName: string;
  distributorNumber?: string;
  serviceCenterNumber?: string;
  serviceCenterLocationCode?: string;
  serviceCenterLocationName?: string;
  claimNumber: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerAddress1?: string;
  customerAddress2?: string;
  customerCity?: string;
  customerState?: string;
  customerCountryCode?: string;
  customerZipCode?: string;
  customerPhone?: string;
  customerType?: string;
  customerEmail?: string;
  demographicCode?: string;
  brandName?: string;
  modelNumber?: string;
  serialNumber?: string;
  datePurchased?: string; // CCYYMMDD
  eiaDefectOrComplaintCode?: string;
  defectOrComplaintDescription?: string;
  servicePerformedDescription?: string;
  eiaRepairCode1?: string;
  eiaRepairCode2?: string;
  eiaRepairCode3?: string;
  eiaRepairCode4?: string;
  reworkNumberOrPolicy?: string;
  warrantyType?: string;
  repairCategory?: string;
  stockRepairFlag?: 'Y' | 'N';
  type?: string;
  /** DO NOT PASS on a new claim — only when updating one SP already assigned an id to. */
  existingClaimBatchNumber?: number;
  /** DO NOT PASS on a new claim — only when updating one SP already assigned an id to. */
  existingClaimSequenceNumber?: number;
  dateReceived?: string; // CCYYMMDD
  dateRequested?: string; // CCYYMMDD
  dateStarted?: string; // CCYYMMDD
  dateCompleted?: string; // CCYYMMDD
  callNumber?: string;
  dealerNumber?: string;
  dealerName?: string;
  dealerAddress?: string;
  dealerCity?: string;
  dealerState?: string;
  dealerZipCode?: string;
  laborAmount?: number;
  partsAmount?: number;
  otherAmount?: number;
  shippingChargeAmount?: number;
  travelChargeAmount?: number;
  mileageAmount?: number;
  travelMiles?: number;
  serviceContractNumber?: string;
  authorizationNumber?: string;
  parts?: ClaimSubmissionPart[];
}

export interface ClaimSubmissionRequest {
  authentication: Authentication;
  claims: ClaimSubmissionClaim[];
}

export interface ClaimSubmissionResponseError {
  errorDescription: string;
  partNumber?: string;
}

export interface ClaimSubmissionResponseClaim {
  claimResponseCode: 'OK' | 'ER';
  manufacturerName: string;
  claimNumber: string;
  serviceCenterNumber?: string;
  serviceCenterLocationCode?: string;
  type?: string;
  claimBatchNumber?: number;
  claimSequenceNumber?: number;
  claimStatusCode?: string;
  claimStatusDescription?: string;
  claimTransactionId?: string;
  errors?: ClaimSubmissionResponseError[];
  messages?: Array<{ message: string }>;
}

export interface ClaimSubmissionResponse {
  responseCode: 'OK' | 'ER';
  transactionId?: string;
  totalClaimsProcessedSuccessfully?: number;
  totalClaimsReceived?: number;
  totalClaimsNotProcessedSuccessfully?: number;
  claims?: ClaimSubmissionResponseClaim[];
  messages?: Array<{ message: string }>;
}

// ============================================================================
// Request for Authorization (RFA) - Create API Types
// ============================================================================

export interface RFAAmounts {
  requestedLabor?: number;
  requestedLaborTax?: number;
  requestedMiles?: number;
  requestedRatePerMile?: number;
  requestedOther?: number;
  requestedOtherTax?: number;
  requestedPartsTax?: number;
  requestedShipping?: number;
  requestedFreight?: number;
  requestedTax?: number;
  requestedTravel?: number;
}

export interface RFAPart {
  partSequenceNumber?: number;
  quantity: number;
  partNumber: string;
  partDescription: string;
  singlePartCost: number;
  nlaFlag?: 'Y' | 'N';
  partUnderWarranty?: 'Y' | 'N';
  selfSourced?: 'Y' | 'N';
}

export interface RFACoreInfo {
  additionalManRequired?: 'Y' | 'N';
  costEffectiveToRepair?: 'Y' | 'N';
  estimatedHoursOnJob?: number;
  estimatedMinutesOnJob?: number;
  isProductRepaired?: 'Y' | 'N';
  laborInWarranty?: 'Y' | 'N';
  oemAuthorizedWithManufacturer?: 'Y' | 'N';
  partsInWarranty?: 'Y' | 'N';
  pickUpUnitRequired?: 'Y' | 'N';
  whyHigherRate?: string;
}

export interface RFAProductInfo {
  newBrand?: string;
  newModel?: string;
  newSerialNumber?: string;
  productQuestions?: Array<{
    questionId: number;
    choiceId?: number;
    responseText?: string;
  }>;
}

export interface RFAShippingInfo {
  shipAlternateAddressSequence?: number;
  shipRecipient?: 'C' | 'S'; // Consumer or Servicer
  shipShippingOption?: string;
  shipCompanyName?: string;
  shipFirstName?: string;
  shipLastName?: string;
  shipPhone?: string;
  shipEmail?: string;
  shipAddress1?: string;
  shipAddress2?: string;
  shipCity?: string;
  shipState?: string;
  shipZip?: string;
}

export interface RFAWhyAdditionalManQuestion {
  choiceId?: number;
  responseText?: string;
}

export interface CreateRFARequest {
  manufacturerName: string;
  callNumber: string;
  coreInfo?: RFACoreInfo;
  whyAdditionalManOnTheJobQuestions?: RFAWhyAdditionalManQuestion[];
  faultCode?: string;
  productInfo?: RFAProductInfo;
  servicerOnSite?: 'Y' | 'N';
  shippingInfo?: RFAShippingInfo;
  amounts?: RFAAmounts;
  parts?: RFAPart[];
  authentication: Authentication;
}

export interface CreateRFAResponse {
  responseCode: 'OK' | 'ER';
  messages?: Array<{ message: string }>;
}

// ============================================================================
// Request for Authorization (RFA) - Retrieve API Types
// ============================================================================

export interface RetrieveRFARequest {
  callNumber?: string;
  manufacturerName?: string;
  fromChangedOn?: string; // CCYYMMDDHHMM
  toChangedOn?: string; // CCYYMMDDHHMM
  authentication: Authentication;
  manufacturerNumber?: string;
}

export interface RFAApprovalRejectInfo {
  approvedOrAdditionalInformationRequestNotes?: string;
  reasonCode?: string;
  reasonDescription?: string;
}

export interface RFAAuditInfo {
  approvedBy?: string;
  approvedOn?: string; // YYYYMMDDHHMMSS
  changedBy?: string;
  changedOn?: string; // YYYYMMDDHHMMSS
  createdBy?: string;
  createdOn?: string; // YYYYMMDDHHMMSS
}

export interface RFARetrievedCoreInfo extends RFACoreInfo {
  additionalDaysToFileClaim?: number;
  agreementNumber?: string;
  jobCode?: string;
  repeatCall?: 'Y' | 'N';
  rfaStatus?: string;
  rfaStatusCode?: 'OPN' | 'APV' | 'REJ' | 'WAI' | 'CLS';
}

export interface RFACustomerInfo {
  address?: string;
  cellPhone?: string;
  city?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  state?: string;
  workPhone?: string;
  zip?: string;
}

export interface RFAOtherInfo {
  additionalManRequired?: 'Y' | 'N';
  costEffectiveToRepair?: 'Y' | 'N';
  daysOwned?: number;
  estimatedHoursOnJob?: number;
  estimatedMinutesOnJob?: number;
  isProductRepaired?: 'Y' | 'N';
  laborInWarranty?: 'Y' | 'N';
  oemAuthorizedWithManufacturer?: 'Y' | 'N';
  partsInWarranty?: 'Y' | 'N';
  pickUpUnitRequired?: 'Y' | 'N';
  whyHigherRate?: string;
  modificationsOccurred?: 'Y' | 'N';
  whyAdditionalManOnTheJobQuestions?: Array<{
    choiceId?: number;
    choiceText?: string;
    responseText?: string;
    questionText?: string;
  }>;
}

export interface RFARetrievedPart extends RFAPart {
  extMarkUp?: number;
  systemCost?: number;
  total?: number;
  distributorNumber?: string;
}

export interface RFAProblemInfo {
  customerNotes?: string;
  repairDescription?: string;
  faultCode?: string;
  faultDescription?: string;
}

export interface RFARetrievedProductInfo {
  brand?: string;
  newBrand?: string;
  model?: string;
  newModel?: string;
  serialNumber?: string;
  newSerialSerialNumber?: string;
  product?: string;
  purchaseDate?: string; // YYYYMMDD
  dealerName?: string;
  productQuestions?: Array<{
    questionId?: number;
    questionText?: string;
    choiceId?: number;
    choiceText?: string;
    responseText?: string;
  }>;
}

export interface RFAServicerInfo {
  assignedServicerId?: string;
  servicerOnSite?: 'Y' | 'N';
  servicerOEMAuthorized?: 'Y' | 'N';
  servicerProductInProfile?: 'Y' | 'N';
  servicerZipInProfile?: 'Y' | 'N';
}

export interface RFARetrievedShippingInfo extends RFAShippingInfo {
  // All fields from RFAShippingInfo
}

export interface RFASubRequest {
  subRequestNumber: string;
}

export interface RFARetrievedAmounts extends RFAAmounts {
  authorizedFreight?: number;
  authorizedLabor?: number;
  authorizedLaborTax?: number;
  authorizedMileage?: number;
  authorizedMiles?: number;
  authorizedOther?: number;
  authorizedOtherTax?: number;
  authorizedParts?: number;
  authorizedPartsTax?: number;
  authorizedShipping?: number;
  authorizedTax?: number;
  authorizedTotal?: number;
  authorizedTravel?: number;
  preAuthorizedAmount?: number;
  requestedParts?: number;
  requestedTotal?: number;
  requestedMileage?: number;
}

export interface RFARequest {
  manufacturerName?: string;
  callNumber: string;
  parentRequestNumber?: string;
  amounts?: RFARetrievedAmounts;
  approvalRejectInfo?: RFAApprovalRejectInfo;
  auditInfo?: RFAAuditInfo;
  coreInfo?: RFARetrievedCoreInfo;
  customerInfo?: RFACustomerInfo;
  otherInfo?: RFAOtherInfo;
  parts?: RFARetrievedPart[];
  problemInfo?: RFAProblemInfo;
  productInfo?: RFARetrievedProductInfo;
  servicerInfo?: RFAServicerInfo;
  shippingInfo?: RFARetrievedShippingInfo;
  subRequests?: RFASubRequest[];
}

export interface RetrieveRFAResponse {
  responseCode: 'OK' | 'ER';
  moreCallsExist?: 'Y' | 'N';
  totalClaimsReceived?: number;
  requests?: RFARequest[];
  messages?: Array<{ message: string }>;
}

// ============================================================================
// Utility Types
// ============================================================================

export type ServicePowerRegion = 'na' | 'eu';
export type ServicePowerEnvironment = 'production' | 'staging';

export interface ServicePowerConfig {
  environment: ServicePowerEnvironment;
  region: ServicePowerRegion;
  userId: string;
  password: string;
  manufacturerName?: string;
  serviceCenterNumber?: string;
}
