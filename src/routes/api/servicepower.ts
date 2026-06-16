/**
 * ServicePower SOAP API Server Route
 * 
 * This server route acts as a proxy to call ServicePower SOAP/XML APIs from the server-side,
 * bypassing CORS restrictions that prevent direct browser calls.
 * 
 * ServicePower uses SOAP/XML web services, not REST/JSON.
 */

import { createFileRoute } from '@tanstack/react-router';

// ServicePower SOAP Endpoints
const SOAP_ENDPOINTS = {
  staging: 'https://fssstag.servicepower.com/sms/services/SPDService',
  production: 'https://fss.servicepower.com/sms/services/SPDService',
};

/**
 * Build SOAP XML envelope for ServicePower requests
 */
function buildSoapEnvelope(operation: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="urn:SPDServicerService">
  <soapenv:Header/>
  <soapenv:Body>
    <impl:${operation}>
      ${body}
    </impl:${operation}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Build CallInfoSearch parameters.
 * IMPORTANT: child elements are UNQUALIFIED (no namespace prefix).
 * Only the operation element (getCallInfoSearch) carries the impl: namespace.
 * The schema's "impl:CallInfoSearch" yellow box is the TYPE, not an element,
 * so there is NO CallInfoSearch wrapper - children go directly in the operation.
 *
 * Dates use format "CCYYMMDD hh:mm:ss" per the integration guide.
 */
function formatDateTime(yyyymmdd: string, endOfDay = false): string {
  // Input is YYYYMMDD; append a time component
  if (!yyyymmdd) return yyyymmdd;
  const time = endOfDay ? '23:59:59' : '00:00:00';
  return `${yyyymmdd} ${time}`;
}

function buildCallInfoSearch(userId: string, password: string, fromDate: string, toDate: string, callNo?: string, svcrAcct?: string): string {
  let params = `<UserInfo>
        <UserID>${userId}</UserID>
        <Password>${password}</Password>${svcrAcct ? `
        <SvcrAcct>${svcrAcct}</SvcrAcct>` : ''}
      </UserInfo>`;

  // Only include date filters if provided (allows querying all calls when omitted)
  if (fromDate) {
    params += `
      <FromDateTime>${formatDateTime(fromDate, false)}</FromDateTime>`;
  }
  if (toDate) {
    params += `
      <ToDateTime>${formatDateTime(toDate, true)}</ToDateTime>`;
  }
  
  if (callNo) {
    params += `
      <Callno>${callNo}</Callno>`;
  }
  
  return params;
}

/**
 * Parse XML response to JSON
 */
function parseXmlToJson(xml: string): any {
  // Simple XML parser for ServicePower responses
  const parseElement = (xmlStr: string, tagName: string): string | null => {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`, 'i');
    const match = xmlStr.match(regex);
    return match ? match[1].trim() : null;
  };

  // Check for errors first
  const errorOccurred = parseElement(xml, 'erroroccurred');
  if (errorOccurred === 'true' || errorOccurred === '1') {
    const errorCode = parseElement(xml, 'Code');
    const errorDesc = parseElement(xml, 'Description');
    const errorCause = parseElement(xml, 'Cause');
    return {
      success: false,
      errorOccurred: true,
      error: {
        code: errorCode,
        description: errorDesc,
        cause: errorCause,
      }
    };
  }

  // Parse successful response
  return {
    success: true,
    xml: xml, // Return raw XML for now
    errorOccurred: false,
  };
}

export const Route = createFileRoute('/api/servicepower')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { action, params } = body;

          // Get credentials from environment
          const userId = process.env.VITE_SERVICEPOWER_USER_ID;
          const password = process.env.VITE_SERVICEPOWER_PASSWORD;
          const svcrAcct = process.env.VITE_SERVICEPOWER_SERVICER_ACCOUNT || userId;
          const env = (process.env.VITE_SERVICEPOWER_ENV || 'staging') as 'staging' | 'production';

          if (!userId || !password) {
            return Response.json(
              {
                success: false,
                error: 'ServicePower credentials not configured on server',
              },
              { status: 500 }
            );
          }

          const endpoint = SOAP_ENDPOINTS[env];

          // Handle different actions
          switch (action) {
            case 'test': {
              // Connection test against the configured endpoint using a wide date range
              const soapBody = buildCallInfoSearch(userId, password, '20260101', '20261231', '', svcrAcct);
              const soapEnvelope = buildSoapEnvelope('getCallInfoSearch', soapBody);

              const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': '' },
                body: soapEnvelope,
              });

              const xmlResponse = await response.text();
              const callCount = (xmlResponse.match(/<CallInfo[\s>]/gi) || []).length;
              const numMatch = xmlResponse.match(/<numberOfCalls[^>]*>([^<]*)<\/numberOfCalls>/i);
              const isNil = /<numberOfCalls[^>]*nil="true"/i.test(xmlResponse);

              return Response.json({
                success: response.ok,
                authenticated: response.ok,
                data: {
                  endpoint,
                  numberOfCalls: isNil ? 'nil' : (numMatch ? numMatch[1] : 'not found'),
                  callInfoElements: callCount,
                },
                xml: xmlResponse,
                environment: env,
                message: callCount > 0
                  ? `✅ Found ${callCount} calls on ${env}!`
                  : `⚠️ Connected to ${env} but no calls returned`,
              });
            }

            case 'dateFormatDiag': {
              // Diagnostic: try multiple date formats over a wide range to find which one works.
              const formats: { label: string; from: string; to: string }[] = [
                { label: 'YYYYMMDD', from: '20260101', to: '20261231' },
                { label: 'YYYYMMDD hh:mm:ss', from: '20260101 00:00:00', to: '20261231 23:59:59' },
                { label: 'YYYYMMDDhhmmss', from: '20260101000000', to: '20261231235959' },
                { label: 'YYYY-MM-DD', from: '2026-01-01', to: '2026-12-31' },
                { label: 'MM/DD/YYYY', from: '01/01/2026', to: '12/31/2026' },
                { label: 'YYYY-MM-DD hh:mm:ss', from: '2026-01-01 00:00:00', to: '2026-12-31 23:59:59' },
              ];

              const results: any[] = [];

              for (const fmt of formats) {
                const body = `<UserInfo>
        <UserID>${userId}</UserID>
        <Password>${password}</Password>
      </UserInfo>
      <FromDateTime>${fmt.from}</FromDateTime>
      <ToDateTime>${fmt.to}</ToDateTime>`;
                const envelope = buildSoapEnvelope('getCallInfoSearch', body);

                try {
                  const resp = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': '' },
                    body: envelope,
                  });
                  const text = await resp.text();
                  const numMatch = text.match(/<numberOfCalls[^>]*>([^<]*)<\/numberOfCalls>/i);
                  const isNil = /<numberOfCalls[^>]*nil="true"/i.test(text);
                  const callCount = (text.match(/<CallInfo[\s>]/gi) || []).length;
                  results.push({
                    format: fmt.label,
                    from: fmt.from,
                    to: fmt.to,
                    status: resp.status,
                    numberOfCalls: isNil ? 'nil' : (numMatch ? numMatch[1] : 'not found'),
                    callInfoElements: callCount,
                    hasError: /faultstring|<Code>/i.test(text),
                    snippet: text.substring(0, 300),
                  });
                } catch (e) {
                  results.push({ format: fmt.label, error: String(e) });
                }
              }

              console.log('========== DATE FORMAT DIAGNOSTIC ==========');
              console.log(JSON.stringify(results, null, 2));
              console.log('========== END DIAGNOSTIC ==========');

              return Response.json({
                success: true,
                authenticated: true,
                data: { dateFormatTests: results },
                environment: env,
                message: '🔍 Date format diagnostic complete - check results below',
              });
            }

            case 'getCallInfo': {
              // Query work orders/calls by date range
              const fromDate = params?.fromDate || new Date().toISOString().split('T')[0].replace(/-/g, '');
              const toDate = params?.toDate || fromDate;
              const callNo = params?.callNo || '';
              
              const soapBody = buildCallInfoSearch(userId, password, fromDate, toDate, callNo, svcrAcct);
              const soapEnvelope = buildSoapEnvelope('getCallInfoSearch', soapBody);
              
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'text/xml;charset=UTF-8',
                  'SOAPAction': '',
                },
                body: soapEnvelope,
              });

              const xmlResponse = await response.text();
              
              // DEBUG: Log the raw response so we can inspect structure
              console.log('========== SERVICEPOWER RAW RESPONSE ==========');
              console.log('Request dates:', fromDate, 'to', toDate);
              console.log('Response status:', response.status);
              console.log('Response length:', xmlResponse.length);
              console.log(xmlResponse.substring(0, 5000));
              console.log('========== END RESPONSE ==========');
              
              // Return raw XML for now - we'll parse it on the client
              return Response.json({
                success: response.ok,
                xml: xmlResponse,
                parsed: parseXmlToJson(xmlResponse),
              });
            }

            case 'updateCallInfo': {
              // Update work order status
              const callNumber = params?.callNumber;
              const callStatus = params?.callStatus;
              const remarks = params?.remarks;
              
              let soapBody = `<UserInfo>
        <UserID>${userId}</UserID>
        <Password>${password}</Password>
      </UserInfo>
      <CallNumber>${callNumber}</CallNumber>`;
              
              if (callStatus) {
                soapBody += `
      <CallStatus>${callStatus}</CallStatus>`;
              }
              
              if (remarks) {
                soapBody += `
      <Remarks>
        <Notes>${remarks}</Notes>
        <NotesDate>${new Date().toISOString()}</NotesDate>
      </Remarks>`;
              }
              
              const soapEnvelope = buildSoapEnvelope('updateCallInfo', soapBody);
              
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'text/xml;charset=UTF-8',
                  'SOAPAction': '',
                },
                body: soapEnvelope,
              });

              const xmlResponse = await response.text();
              
              return Response.json({
                success: response.ok,
                xml: xmlResponse,
                parsed: parseXmlToJson(xmlResponse),
              });
            }

            default:
              return Response.json(
                { error: 'Invalid action. Supported: test, getCallInfo, updateCallInfo' },
                { status: 400 }
              );
          }
        } catch (error) {
          console.error('[ServicePower SOAP API] Error:', error);
          return Response.json(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
          );
        }
      },
    },
  },
});
