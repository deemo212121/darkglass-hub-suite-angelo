/**
 * NSA Platform Service Facility API — client-side functions.
 *
 * All calls route through /api/nsa (server-side proxy) so credentials
 * stay server-only and CORS is bypassed.
 *
 * Authentication:
 *   Method 1 (used by default): Basic base64(key:secret) on every request.
 *   Method 2: POST /authorizations with Basic base64(user:password) → JWT token.
 *
 * Base URL: https://dev-api.nationalservicealliance.com
 * Mock URL: https://private-anon-729e178652-nsasfapi.apiary-mock.com
 */

const API_ENDPOINT = "/api/nsa";

async function nsaCall(action: string, params: Record<string, any> = {}): Promise<any> {
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `NSA API error: ${res.status}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.data?.message || json.data?.error || `NSA error ${json.status}`);
  }
  return json.data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** Exchange user:password for a Bearer JWT token. Returns { jwt, refreshToken, deviceID }. */
export async function getNsaBearerToken(params: {
  username: string;
  password: string;
  latitude?: number;
  longitude?: number;
}): Promise<{ jwt: string; refreshToken: string; deviceID: string }> {
  return nsaCall("authenticate", params);
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface NsaUser {
  firstName: string;
  lastName: string;
  email: string;
}

export async function getNsaUser(userID: number): Promise<NsaUser> {
  return nsaCall("getUser", { userID });
}

export async function updateNsaUser(userID: number, data: NsaUser): Promise<void> {
  await nsaCall("updateUser", { userID, ...data });
}

// ─── Dispatch types ────────────────────────────────────────────────────────────

export interface NsaDispatch {
  dispatchNumber: string;
  caseNumber?: string;
  masterCode?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  homePhone?: string;
  cellPhone?: string;
  workPhone?: string;
  workExtension?: string;
  address1?: string;
  address2?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  countryCode?: string;
  brand?: string;
  model?: string;
  version?: string;
  serial?: string;
  scheduleDate?: string;
  timeSlot?: string;           // A=AM, P=PM, D=DAY, E=EVENING
  specialInstructions?: string;
  notes?: string;
  status?: string;
  routeName?: string;
  groupName?: string;
  ruleSet?: number;
  ruleSetID?: number;
  attachments?: NsaAttachment[];
  datetimeDepotReceived?: string;
  productCategory?: string;
  modelVersion?: string;
  complaint?: string;
  deductible?: string;
  coverageExclusions?: string;
  customerScheduleAcknowledgedDate?: string;
  customerScheduleAcknowledgedUserName?: string;
  serviceOrderCommunicationLogs?: number[];
  serviceOrderNotes?: number[];
  partIDs?: number[];
  hasPartBOM?: boolean;
  sfCanAddPartOrderBySF?: boolean;
  sfCanOrderPartsThroughNSA?: boolean;
  PartBOMRequired?: boolean;
  estimateRules?: NsaEstimateRules;
  estimates?: NsaEstimateSummary[];
  dispatchCodes?: NsaDispatchCodes;
  preAuthLabor?: number;
  preAuthParts?: number;
  preAuthTotal?: number;
  latitude?: string;
  longitude?: string;
  legacyFileName?: string;
  hash?: string;
  message?: string;
  [key: string]: any;
}

export interface NsaAttachment {
  attachmentID: number;
  type: string;
  link: string;
}

export interface NsaEstimateRules {
  canInitiateEstimate?: boolean;
  validCoverageTypeCodes?: string[];
  requiredCoverageTypeCodes?: string[];
  requirePartsDetails?: boolean;
  listValues?: Array<{ valueType: string; values: string[] }>;
  additionalQuestions?: Array<{
    questionCode: string;
    questionText: string;
    questionValueType: string;
    questionListValues?: string[];
  }>;
}

export interface NsaEstimateSummary {
  estimateID: number;
  submissionStatus?: string;
  processingStatus?: string;
  totalAmount?: number;
}

export interface NsaDispatchCodes {
  actionCodes?: Array<{ Value: string; Description: string }>;
  cancelReasons?: Array<{ Value: string; Description: string }>;
  defectCodes?: Array<{ Code: string; Description: string }>;
  repairCodes?: Array<{ Value: string; Description: string }>;
  unsuccessfulCodes?: string[];
}

// ─── Dispatches ───────────────────────────────────────────────────────────────

export interface NsaDispatchListParams {
  confirmed?: boolean;
  status?: string;
  sinceDate?: string;
  createStartDate?: string;
  createEndDate?: string;
  scheduleStartDate?: string;
  scheduleEndDate?: string;
  closeStartDate?: string;
  closeEndDate?: string;
  lastName?: string;
  phone?: string;
  postalCode?: string;
  page?: number;
  pageSize?: number;
  routeName?: string;
  dispatchNumbersOnly?: boolean;
  getFullDetails?: boolean;
  // POST body for hash-based lookup
  dispatchNumbers?: Array<{ dispatchNumber: string; hash: string }>;
}

/** GET /dispatches — list dispatches with rich query filters. */
export async function getNsaDispatches(params: NsaDispatchListParams = {}): Promise<{
  dispatches: NsaDispatch[];
  currentPageNumber: number;
  hasAdditionalPages: boolean;
}> {
  const data = await nsaCall("getDispatches", params);
  if (Array.isArray(data)) return { dispatches: data, currentPageNumber: 1, hasAdditionalPages: false };
  return {
    dispatches: data?.dispatches ?? [],
    currentPageNumber: data?.currentPageNumber ?? 1,
    hasAdditionalPages: data?.hasAdditionalPages ?? false,
  };
}

/** GET /dispatches/{dispatchNumber} — full dispatch detail. */
export async function getNsaDispatch(dispatchNumber: string): Promise<NsaDispatch> {
  return nsaCall("getDispatch", { dispatchNumber });
}

/** PATCH /dispatches/{dispatchNumber} — update dispatch fields. */
export async function updateNsaDispatch(
  dispatchNumber: string,
  fields: Partial<NsaDispatch> & { statusCode?: string }
): Promise<void> {
  await nsaCall("updateDispatch", { dispatchNumber, ...fields });
}

/** PUT /dispatches/{dispatchNumber}/{confirmID} — accept (1), reject (2), cancel/transfer (6). */
export async function confirmNsaDispatch(
  dispatchNumber: string,
  confirmID: 1 | 2 | 6
): Promise<void> {
  await nsaCall("confirmDispatch", { dispatchNumber, confirmID });
}

/** PATCH /dispatches/{dispatchNumber}/address — update customer address. */
export async function updateNsaDispatchAddress(
  dispatchNumber: string,
  address: {
    first_name?: string; last_name?: string;
    address_1?: string; address_2?: string;
    city?: string; state?: string; postal_code?: string;
    phone?: string; work_phone?: string; wext?: string;
    mobile_phone?: string; email?: string;
  }
): Promise<void> {
  await nsaCall("updateDispatchAddress", { dispatchNumber, ...address });
}

/** POST /dispatches/{dispatchNumber}/schedules — reschedule. */
export async function scheduleNsaDispatch(
  dispatchNumber: string,
  params: { newDate: string; timeSlot: string; reason?: number; notes?: string }
): Promise<void> {
  await nsaCall("scheduleDispatch", { dispatchNumber, ...params });
}

/** POST /dispatches/{dispatchNumber}/trip — log tech trip. */
export async function logNsaTrip(
  dispatchNumber: string,
  trip: {
    tripID: string; deviceID?: string;
    startLat?: string; startLong?: string;
    destinationLat?: string; destinationLong?: string;
    endLat?: string; endLong?: string;
    beginTravelTime?: string; arrivalTime?: string; departureTime?: string;
  }
): Promise<void> {
  await nsaCall("logTrip", { dispatchNumber, ...trip });
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export async function getNsaAttachments(dispatchNumber: string): Promise<NsaAttachment[]> {
  const data = await nsaCall("getAttachments", { dispatchNumber });
  return Array.isArray(data) ? data : [];
}

export async function addNsaAttachment(
  dispatchNumber: string,
  attachment: { attachmentTypeID: number; fileName: string; extension: string; file: string }
): Promise<{ attachmentID: number; attachmentTypeID: number }> {
  return nsaCall("addAttachment", { dispatchNumber, ...attachment });
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export interface NsaNote {
  serviceOrderNoteID?: number;
  notes: string;
  createUserID?: number;
  createUserName?: string;
  timeStamp?: string;
}

export async function getNsaNotes(dispatchNumber: string): Promise<NsaNote[]> {
  const data = await nsaCall("getNotes", { dispatchNumber });
  return Array.isArray(data) ? data : [];
}

/** Returns array of new note IDs. */
export async function addNsaNotes(
  dispatchNumber: string,
  notes: Array<{ notes: string }>
): Promise<number[]> {
  const data = await nsaCall("addNotes", { dispatchNumber, notes });
  return Array.isArray(data) ? data : [];
}

// ─── Communications ───────────────────────────────────────────────────────────

export interface NsaCommunication {
  communicationLogID?: number;
  directionID: number;
  directionDesc?: string;
  typeID: number;
  typeDesc?: string;
  communicationAddress: string;
  contacteeTypeID: number;
  contacteeTypeDesc?: string;
  contactee: string;
  notes: string;
  createUserName?: string;
  timeStamp?: string;
}

export async function getNsaCommunications(dispatchNumber: string): Promise<NsaCommunication[]> {
  const data = await nsaCall("getCommunications", { dispatchNumber });
  return Array.isArray(data) ? data : [];
}

/** Returns array of new communication log IDs. */
export async function addNsaCommunications(
  dispatchNumber: string,
  logs: Array<Omit<NsaCommunication, "communicationLogID" | "directionDesc" | "typeDesc" | "contacteeTypeDesc" | "createUserName" | "timeStamp">>
): Promise<number[]> {
  const data = await nsaCall("addCommunications", { dispatchNumber, logs });
  return Array.isArray(data) ? data : [];
}

// ─── Parts ────────────────────────────────────────────────────────────────────

export interface NsaPart {
  ID?: string;
  Source?: string;
  NsaOrderID?: string;
  Master_Code?: string;
  Depot?: string;
  ServiceOrder?: string;
  PartNumber?: string;
  Description?: string;
  Brand?: string;
  Quantity?: number;
  SFPO?: string;
  SFSupplier?: string;
  SFOrderDate?: string;
  Status?: string;
  InternalStatus?: string;
  OrderDate?: string;
  ReceivedDate?: string;
  Supplier?: string;
  PONumber?: string;
  DueDate?: string;
  PartCost?: number;
  ExtPrice?: number;
  Price?: number;
  Core?: string;
  CoreCost?: number;
  ProblemSolved?: string;
  Installed?: string;
  NotUsed?: string;
  Defective?: string;
  returnStatus?: string;
  arsStatus?: string;
  inboundStatus?: string;
  ReturnTrackingNumber?: string;
  additionalData?: Array<{ dataName: string; dataValue: string }>;
  [key: string]: any;
}

export async function getNsaDispatchParts(dispatchNumber: string): Promise<{
  ServiceOrder: string;
  DispatchNumber: string;
  Parts: NsaPart[];
}> {
  const data = await nsaCall("getDispatchParts", { dispatchNumber });
  return {
    ServiceOrder: data?.ServiceOrder ?? "",
    DispatchNumber: data?.DispatchNumber ?? dispatchNumber,
    Parts: data?.Parts ?? [],
  };
}

export async function getNsaDispatchPart(dispatchNumber: string, partID: number): Promise<NsaPart> {
  return nsaCall("getDispatchPart", { dispatchNumber, partID });
}

export async function addNsaDispatchPart(
  dispatchNumber: string,
  part: {
    orderedThroughNSA: boolean;
    partNumber: string;
    description: string;
    quantity: number;
    mfgCode?: string;
    brand?: string;
    costEach?: number;
    externalSystemID?: string;
    sfPONumber?: string;
    shippingType?: string;
    vendor?: string;
    orderDate?: string;
    dueDate?: string;
    receivedDate?: string;
    requestDate?: string;
    backOrdered?: number;
    vendorInvoice?: string;
    inboundTracking?: string;
    inboundShipCo?: string;
  }
): Promise<void> {
  await nsaCall("addDispatchPart", { dispatchNumber, ...part });
}

export async function updateNsaDispatchPart(
  dispatchNumber: string,
  update: {
    partID: number;
    status?: string;
    disposition?: string;
    returnDate?: string;
    orderDate?: string;
    dueDate?: string;
    receivedDate?: string;
    requestDate?: string;
    vendorInvoice?: string;
    inboundTracking?: string;
    inboundShipCo?: string;
    additionalData?: Array<{ dataName: string; dataValue: string }>;
  }
): Promise<{ partID: number }> {
  return nsaCall("updateDispatchPart", { dispatchNumber, ...update });
}

export async function getNsaDispatchBOM(dispatchNumber: string): Promise<{
  brand: string;
  model: string;
  version: string;
  versionBOM: Array<{
    brand: string; partID: number; partNumber: string; description: string;
    supplier: string; core: boolean; coreCost?: number; cost: number; list: number; mfgCode: string;
  }>;
}> {
  return nsaCall("getDispatchBOM", { dispatchNumber });
}

// ─── Estimates ────────────────────────────────────────────────────────────────

export interface NsaEstimate {
  estimateID: number;
  submissionStatusCode?: string;
  processedStatusCode?: string;
  totalAmount?: number;
  createTimestamp?: string;
  submissionTimestamp?: string | null;
  processedTimestamp?: string;
  lines?: Array<{ coverageTypeCode: string; amount: number; createTimestamp?: string }>;
  parts?: Array<{
    brand: string; partNumber: string; description: string;
    quantity: number; costEach: number; extendedCost: number;
    alreadyUsed?: boolean; alreadyOrdered?: boolean; createTimestamp?: string;
  }>;
  notes?: Array<{
    estimateNoteID?: number; note: string; createdBy?: string;
    createdUserEntity?: string; createTimestamp?: string;
  }>;
}

export async function getNsaEstimates(dispatchNumber: string): Promise<NsaEstimate[]> {
  const data = await nsaCall("getEstimates", { dispatchNumber });
  return Array.isArray(data) ? data : [];
}

export async function getNsaEstimate(dispatchNumber: string, estimateID: number): Promise<NsaEstimate> {
  return nsaCall("getEstimate", { dispatchNumber, estimateID });
}

export async function addNsaEstimate(
  dispatchNumber: string,
  estimate: {
    totalAmount: number;
    lines: Array<{ coverageTypeCode: string; amount: number }>;
    parts?: Array<{ brand: string; partNumber: string; description: string; quantity: number; costEach: number; extendedCost: number; alreadyUsed?: boolean; alreadyOrdered?: boolean }>;
    notes?: Array<{ note: string; createdBy?: string; createUserEntity?: string; createTimestamp?: string }>;
    additionalQuestions?: Array<{ questionCode: string; answer: string }>;
  }
): Promise<void> {
  await nsaCall("addEstimate", { dispatchNumber, ...estimate });
}

export async function deleteNsaEstimate(dispatchNumber: string, estimateID: number): Promise<void> {
  await nsaCall("deleteEstimate", { dispatchNumber, estimateID });
}

// ─── Rule Sets ────────────────────────────────────────────────────────────────

export async function getNsaRuleSet(ruleSetID: number): Promise<any> {
  return nsaCall("getRuleSet", { ruleSetID });
}

export async function submitNsaRuleSet(submission: {
  ruleSetID: number;
  closeID?: number;
  dispatchNumber: string;
  action: string;
  complete: boolean;
  rules: Array<{
    ruleID: number;
    answer?: string;
    attachment?: boolean;
    overrideReason?: string;
    skipReason?: string;
  }>;
}): Promise<{ ruleSetID: number; closeID: number; dispatchNumber: string; submissionID: number; validClose: boolean }> {
  return nsaCall("submitRuleSet", submission);
}

export async function getNsaMaskRules(dispatchNumber: string): Promise<{
  masks: string[]; match: string; override: boolean; overrideReasonRequired: boolean; ruleID: number;
}> {
  return nsaCall("getMaskRules", { dispatchNumber });
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface NsaPaymentBatch {
  batch: number;
  batchDate: string;
  totalAmount: number;
  repairsPaid: number;
}

export async function getNsaPayments(params: {
  fromDate?: string;
  page?: number;
  pageSize?: number;
  sort?: "ASC" | "DESC";
} = {}): Promise<{ paymentBatches: NsaPaymentBatch[]; currentPageNumber: number; hasAdditionalPages: boolean }> {
  return nsaCall("getPayments", params);
}

export async function getNsaBatchDetails(batchID: number): Promise<{
  batchDate: string;
  batchNumber: number;
  paidRepairs: Array<{
    dispatchNumber: string; labor: number; parts: number;
    freight: number; mileage: number; other: number; total: number;
  }>;
}> {
  return nsaCall("getBatchDetails", { batchID });
}

export async function getNsaCallDetails(callID: string): Promise<{
  batchDate: string; batchNumber: number; dispatchNumber: string;
  labor: number; parts: number; freight: number; mileage: number; other: number; total: number;
}> {
  return nsaCall("getCallDetails", { callID });
}

/** POST /location — update SF location coordinates. */
export async function updateNsaLocation(latitude: number, longitude: number): Promise<void> {
  await nsaCall("updateLocation", { latitude, longitude });
}

// ─── Part Returns ─────────────────────────────────────────────────────────────

export interface NsaPartReturn {
  serviceOrder: string;
  masterCode: string;
  partNumber: string;
  quantity: number;
  dateSFOrdered?: string;
  dateOrdered?: string;
  dateCompleted?: string;
  disposition?: string;
  statusCode: string;
  partCancelled: string;
}

export async function getNsaPartReturns(filter?: {
  dispatchNumber?: string;
  caseNumber?: string;
  serviceOrder?: string;
  masterCode?: string;
  returnStatus?: string;
  dateOrderedStart?: string;
  dateOrderedEnd?: string;
  dateReturnStart?: string;
  dateReturnEnd?: string;
}): Promise<NsaPartReturn[]> {
  const data = await nsaCall("getPartReturns", filter ?? {});
  if (data === null || data === undefined) return [];
  return Array.isArray(data) ? data : [];
}

// ─── Codes & Lookups ──────────────────────────────────────────────────────────

export async function getNsaCommunicationCodes(): Promise<Array<{
  codeType: string; id: number; description: string;
}>> {
  const data = await nsaCall("getCommunicationCodes", {});
  return Array.isArray(data) ? data : [];
}

export async function getNsaAttachmentTypes(): Promise<Array<{ id: number; type: string }>> {
  const data = await nsaCall("getAttachmentTypes", {});
  return Array.isArray(data) ? data : [];
}

export async function getNsaModels(masterCode: string): Promise<string[]> {
  const data = await nsaCall("getModels", { masterCode });
  return Array.isArray(data) ? data : [];
}

export async function getNsaSerials(masterCode: string, model: string): Promise<string[]> {
  const data = await nsaCall("getSerials", { masterCode, model });
  return Array.isArray(data) ? data : [];
}

// ─── Helper labels ────────────────────────────────────────────────────────────

export function nsaTimeBlockLabel(code: string | undefined): string {
  const map: Record<string, string> = {
    A: "AM (8am–12pm)", P: "PM (12pm–5pm)", D: "DAY (8am–5pm)", E: "Evening (After 5pm)",
  };
  return map[String(code ?? "").toUpperCase()] ?? code ?? "";
}

export function nsaServiceClassLabel(code: string | undefined): string {
  const map: Record<string, string> = {
    AC: "HVAC", CE: "Consumer Electronics", CP: "Computer", EL: "Electrical",
    FR: "Furniture", GA: "Garage", GC: "Golf Cart", HM: "Handyman",
    IN: "Installations", IS: "Inspection", MA: "Major Appliances", OT: "Other",
    PL: "Plumbing", PO: "Pool/Spa", SH: "Special HVAC", SP: "Special",
  };
  return map[String(code ?? "").toUpperCase()] ?? code ?? "";
}
