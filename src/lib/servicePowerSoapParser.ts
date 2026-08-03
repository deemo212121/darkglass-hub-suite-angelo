/**
 * ServicePower SOAP XML Parser
 * 
 * Parses SOAP/XML responses from ServicePower Dispatch API
 * and converts them to JavaScript objects
 */

/**
 * Parse a single XML element. Matches an optional namespace prefix
 * (e.g. `ns:Tag`) but never matches across tag boundaries.
 */
function parseElement(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<(?:[A-Za-z][\\w.-]*:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\/(?:[A-Za-z][\\w.-]*:)?${tagName}>`, 'i');
  const match = xml.match(regex);
  if (!match) return null;
  
  const content = match[1].trim();
  // Remove CDATA if present
  return content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Parse all instances of an XML element
 */
function parseElements(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<(?:[A-Za-z][\\w.-]*:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\/(?:[A-Za-z][\\w.-]*:)?${tagName}>`, 'gi');
  const matches = xml.matchAll(regex);
  return Array.from(matches, m => m[1].trim());
}

/**
 * Parse ConsumerInfo block
 */
function parseConsumerInfo(xml: string): any {
  return {
    firstName: parseElement(xml, 'ConsumerFirstName'),
    lastName: parseElement(xml, 'ConsumerLastName'),
    address1: parseElement(xml, 'ConsumerAddress1'),
    address2: parseElement(xml, 'ConsumerAddress2'),
    postcodeLevel1: parseElement(xml, 'PostcodeLevel1'),
    postcodeLevel2: parseElement(xml, 'PostcodeLevel2'),
    postcodeLevel3: parseElement(xml, 'PostcodeLevel3'),
    postcode: parseElement(xml, 'Postcode'),
    country: parseElement(xml, 'Country'),
    phone1: parseElement(xml, 'Phone1'),
    phone2: parseElement(xml, 'Phone2'),
    cellPhone: parseElement(xml, 'CellPhone'),
    email: parseElement(xml, 'EmaiIld'), // Note: typo in API (EmaiIld instead of EmailId)
  };
}

/**
 * Parse ProductInfo block
 */
function parseProductInfo(xml: string): any {
  return {
    brandId: parseElement(xml, 'SPBrandId'),
    brandDesc: parseElement(xml, 'SPBrandDesc'),
    productId: parseElement(xml, 'SPProductId'),
    productDesc: parseElement(xml, 'SPProductDesc'),
    modelNo: parseElement(xml, 'MobelNo'), // Note: typo in API (MobelNo instead of ModelNo)
    serialNo: parseElement(xml, 'SerialNo'),
    installDate: parseElement(xml, 'InstallDate'),
    serviceContractNumber: parseElement(xml, 'ServiceContractNumber'),
    serviceContractExpireDate: parseElement(xml, 'ServiceContractExpireDate'),
    poNumber: parseElement(xml, 'PoNumber'),
    poAmount: parseElement(xml, 'PoAmount'),
    copayAmount: parseElement(xml, 'CopayAmount'),
    // SP exposes the human-readable "Warranty Info" label at the product
    // level too. Names vary by tenant — try the common variants.
    warrantyInfo:
      parseElement(xml, 'WarrantyInfo') ||
      parseElement(xml, 'WarrantyType') ||
      parseElement(xml, 'WarrantyStatus') ||
      parseElement(xml, 'WarrantyDescription') ||
      parseElement(xml, 'WarrantyTypeDesc'),
    retailerName: parseElement(xml, 'RetailerName'),
    // Keep the raw XML so the UI can grep it as a last resort if SP ever
    // emits the field under yet another tag name.
    rawXml: xml,
  };
}

/**
 * Parse a single CallInfo block
 */
function parseCallInfo(callXml: string): any {
  const consumerInfoXml = parseElement(callXml, 'ConsumerInfo');
  const productInfoXml = parseElement(callXml, 'ProductInfo');

  return {
    servicerAccount: parseElement(callXml, 'ServicerAccount'),
    groupKey: parseElement(callXml, 'GroupKey'),
    techKey: parseElement(callXml, 'TechKey'),
    callNumber: parseElement(callXml, 'CallNumber'),
    mfgId: parseElement(callXml, 'MfgId'),
    // SP's "Work Order Source" label (the readable name shown in their UI).
    // Tag names vary by tenant; we try the common variants.
    mfgName:
      parseElement(callXml, 'MfgName') ||
      parseElement(callXml, 'MfgDesc') ||
      parseElement(callXml, 'WorkOrderSource') ||
      parseElement(callXml, 'SourceName') ||
      parseElement(callXml, 'Source'),
    callRawXml: callXml,
    fssCallId: parseElement(callXml, 'FSSCallId'),
    serviceCenter: parseElement(callXml, 'ServiceCenter'),
    warrantyType: parseElement(callXml, 'WarrantyType'),
    serviceType: parseElement(callXml, 'ServicetType'), // Note: typo in API
    serviceLocation: parseElement(callXml, 'ServiceLocation'),
    scheduleDate: parseElement(callXml, 'ScheduleDate'),
    scheduleTimePeriod: parseElement(callXml, 'ScheduleTimePeriod'),
    problemType: parseElement(callXml, 'ProblemType'),
    problemDesc: parseElement(callXml, 'ProbelmDesc'), // Note: typo in API
    repeatCall: parseElement(callXml, 'RepeatCall'),
    forcedCall: parseElement(callXml, 'ForcedCall'),
    callStatus: parseElement(callXml, 'CallStatus'),
    spCallStatusId: parseElement(callXml, 'SPCallStatusID'),
    callSubStatus: parseElement(callXml, 'CallSubStatus'),
    spCallSubStatusId: parseElement(callXml, 'SPCallSubStatusID'),
    callCreatedOn: parseElement(callXml, 'CallCreatedOn'),
    authNo: parseElement(callXml, 'AuthNo'),
    consumer: consumerInfoXml ? parseConsumerInfo(consumerInfoXml) : null,
    product: productInfoXml ? parseProductInfo(productInfoXml) : null,
  };
}

/**
 * Parse getCallInfo response
 */
export function parseGetCallInfoResponse(xml: string): {
  success: boolean;
  numberOfCalls: number;
  calls: any[];
  error?: any;
} {
  // Check for SOAP fault
  if (xml.includes('faultstring')) {
    const faultString = parseElement(xml, 'faultstring');
    return {
      success: false,
      numberOfCalls: 0,
      calls: [],
      error: {
        type: 'SOAP_FAULT',
        message: faultString,
      },
    };
  }

  // Check for ServicePower error
  const errorInfo = parseElement(xml, 'ErrorInfo');
  if (errorInfo) {
    const errorCode = parseElement(errorInfo, 'Code');
    const errorDesc = parseElement(errorInfo, 'Description');
    const errorCause = parseElement(errorInfo, 'Cause');
    
    if (errorCode) {
      return {
        success: false,
        numberOfCalls: 0,
        calls: [],
        error: {
          type: 'API_ERROR',
          code: errorCode,
          description: errorDesc,
          cause: errorCause,
        },
      };
    }
  }

  // Parse successful response
  const numberOfCalls = parseElement(xml, 'numberOfCalls');
  const callInfoBlocks = parseElements(xml, 'CallInfo');
  
  const calls = callInfoBlocks.map(callXml => parseCallInfo(callXml));

  return {
    success: true,
    numberOfCalls: numberOfCalls ? parseInt(numberOfCalls, 10) : calls.length,
    calls,
  };
}

/**
 * Parse error response
 */
export function parseErrorResponse(xml: string): any {
  const errorOccurred = parseElement(xml, 'erroroccurred');
  
  if (errorOccurred === 'true' || errorOccurred === '1') {
    return {
      errorOccurred: true,
      code: parseElement(xml, 'Code'),
      description: parseElement(xml, 'Description'),
      cause: parseElement(xml, 'Cause'),
      ackMessage: parseElement(xml, 'ackmessage'),
      updateDate: parseElement(xml, 'updatedate'),
    };
  }

  return {
    errorOccurred: false,
    ackMessage: parseElement(xml, 'ackmessage'),
    updateDate: parseElement(xml, 'updatedate'),
  };
}

/**
 * Helper to format dates from ServicePower format (various formats)
 * to MM/DD/YY format.
 *
 * Important: ServicePower's schedule dates are calendar days (no time
 * component), but the API often serialises them as ISO timestamps with
 * a `Z` (UTC) suffix or a timezone offset. Parsing those with the
 * `Date` constructor and then reading `getDate()` runs the value
 * through the browser's local timezone, which silently shifts a
 * 2026-07-02T00:00:00Z back to 2026-07-01 for anyone east of UTC and
 * forward to 2026-07-03 for users west of UTC.
 *
 * To stay calendar-correct, we read the y/m/d fragment directly out of
 * the string instead of leaning on `new Date(...)`. Supported inputs:
 *   - 2026-07-02 / 2026-07-02T00:00:00 / 2026-07-02T...Z / 2026-07-02T...+05:00
 *   - 20260702 (compact)
 *   - 07/02/2026 / 07/02/26 (already MM/DD/YY)
 *   - 7/2/2026  (single-digit US)
 * Falls back to whatever the API sent if none of these match.
 */
export function formatServicePowerDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const raw = String(dateStr).trim();
  if (!raw) return '';

  const formatYmd = (y: string, m: string, d: string) =>
    `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y.length === 4 ? y.slice(-2) : y}`;

  // 1. ISO style: YYYY-MM-DD (with optional time/timezone tail we ignore).
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return formatYmd(iso[1], iso[2], iso[3]);

  // 2. Compact YYYYMMDD.
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return formatYmd(compact[1], compact[2], compact[3]);

  // 3. US style: M/D/YY or MM/DD/YYYY.
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const yy = us[3].length === 2 ? us[3] : us[3].slice(-2);
    return `${us[1].padStart(2, '0')}/${us[2].padStart(2, '0')}/${yy}`;
  }

  // 4. Last-resort: let Date parse it, but stay timezone-safe by
  //    reading the UTC components (since SP usually emits UTC).
  try {
    const cleaned = raw.replace(/[-+]\d{2}:\d{2}$/, '');
    const date = new Date(cleaned);
    if (isNaN(date.getTime())) return raw;
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const year = String(date.getUTCFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
  } catch {
    return dateStr;
  }
}
