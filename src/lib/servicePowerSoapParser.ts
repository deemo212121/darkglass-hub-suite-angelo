/**
 * ServicePower SOAP XML Parser
 * 
 * Parses SOAP/XML responses from ServicePower Dispatch API
 * and converts them to JavaScript objects
 */

/**
 * Parse a single XML element
 */
function parseElement(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<[^:]*:?${tagName}[^>]*>([\\s\\S]*?)<\/[^:]*:?${tagName}>`, 'i');
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
  const regex = new RegExp(`<[^:]*:?${tagName}[^>]*>([\\s\\S]*?)<\/[^:]*:?${tagName}>`, 'gi');
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
 * to MM/DD/YY format
 */
export function formatServicePowerDate(dateStr: string | null): string {
  if (!dateStr) return '';
  
  // ServicePower uses various date formats
  // Try to parse and format consistently
  try {
    // Remove timezone info if present
    const cleanDate = dateStr.replace(/[-+]\d{2}:\d{2}$/, '');
    const date = new Date(cleanDate);
    
    if (isNaN(date.getTime())) return dateStr; // Return original if can't parse
    
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).substring(2);
    
    return `${month}/${day}/${year}`;
  } catch {
    return dateStr;
  }
}
