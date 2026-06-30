/**
 * ServicePower API bridge (runtime-agnostic).
 *
 * Why this file exists:
 *  - Vite dev does NOT run the serverless `api/` folder, and production serves
 *    the root `api/servicepower.ts`. To keep dev and prod identical we put the
 *    real logic here and have BOTH entry points delegate to it (same pattern as
 *    `supabaseTokenBridge.ts`).
 *
 * Supported actions:
 *  - getCallInfo: query work orders (calls) from the SOAP Dispatch Web Service.
 *  - test/retrieveClaim/createRFA/retrieveRFA: REST Claims/RFA endpoints.
 *
 * Credentials are read from the passed-in env (Cloudflare binding) or
 * process.env (Node/dev).
 */

interface ServicePowerRequestBody {
  action: 'test' | 'retrieveClaim' | 'createRFA' | 'retrieveRFA' | 'getCallInfo' | 'getCallNotes' | 'addCallNote';
  params?: any;
}

const ENDPOINTS = {
  staging: {
    na: {
      claimsRetrieval: 'https://upgdev.servicepower.com:8443/services/claim/v1/retrieval',
      createRFA: 'https://upgdev.servicepower.com:8443/services/rfa/v2/setdetailssvc',
      retrieveRFA: 'https://upgdev.servicepower.com:8443/services/rfa/v2/getdetails',
    },
  },
  production: {
    na: {
      claimsRetrieval: 'https://claimworks.servicepower.com:8443/services/claim/v1/retrieval',
      createRFA: 'https://claimworks.servicepower.com:8443/services/rfa/v2/setdetailssvc',
      retrieveRFA: 'https://claimworks.servicepower.com:8443/services/rfa/v2/getdetails',
    },
  },
};

// SOAP Dispatch Web Service endpoints (getCallInfo / work orders).
const DISPATCH_ENDPOINTS = {
  staging: 'https://fssstag.servicepower.com/sms/services/SPDService',
  production: 'https://fss.servicepower.com/sms/services/SPDService',
};

function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the SOAP envelope for a getCallInfoSearch request.
 * Matches the verified working structure: operation `getCallInfoSearch`
 * (urn-prefixed) with UNPREFIXED UserInfo / FromDateTime / ToDateTime children.
 * Dates use the format mm/dd/yyyy HH:mm:ss.
 */
function buildGetCallInfoEnvelope(params: {
  userId: string;
  password: string;
  svcrAcct: string;
  fromDate?: string;
  toDate?: string;
  callNo?: string;
}): string {
  const callNoEl = params.callNo
    ? `\n      <Callno>${escapeXml(params.callNo)}</Callno>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:SPDServicerService">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:getCallInfoSearch>
      <UserInfo>
        <UserID>${escapeXml(params.userId)}</UserID>
        <Password>${escapeXml(params.password)}</Password>
        <SvcrAcct>${escapeXml(params.svcrAcct)}</SvcrAcct>
      </UserInfo>
      <FromDateTime>${escapeXml(params.fromDate ?? '')}</FromDateTime>
      <ToDateTime>${escapeXml(params.toDate ?? '')}</ToDateTime>${callNoEl}
    </urn:getCallInfoSearch>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Build the SOAP envelope for a getCallNotes request — fetches the running
 * notes / running-notes thread that ServicePower keeps per work order. Body
 * shape mirrors getCallInfoSearch (UserInfo + Callno).
 */
function buildGetCallNotesEnvelope(params: {
  userId: string;
  password: string;
  svcrAcct: string;
  callNo: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:SPDServicerService">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:getCallNotes>
      <UserInfo>
        <UserID>${escapeXml(params.userId)}</UserID>
        <Password>${escapeXml(params.password)}</Password>
        <SvcrAcct>${escapeXml(params.svcrAcct)}</SvcrAcct>
      </UserInfo>
      <Callno>${escapeXml(params.callNo)}</Callno>
    </urn:getCallNotes>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Build the SOAP envelope for an updateCallInfo request that ATTACHES a
 * running note to a call. Per the v2.8 integration guide the Notes/AddedBy
 * pair is how new notes are pushed back to SP. We only set the Note fields
 * (no status change) so this is a pure "add note" call. We also emit
 * <NoteType> + <Visibility> when an internal/external hint is provided so
 * tenants that support them route the note to the correct audience.
 */
function buildAddCallNoteEnvelope(params: {
  userId: string;
  password: string;
  svcrAcct: string;
  callNo: string;
  note: string;
  addedBy: string;
  isInternal?: boolean;
}): string {
  const visBlock =
    params.isInternal === undefined
      ? ""
      : `\n      <NoteType>${params.isInternal ? "Internal" : "External"}</NoteType>` +
        `\n      <Visibility>${params.isInternal ? "Internal" : "External"}</Visibility>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:SPDServicerService">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:updateCallInfo>
      <UserInfo>
        <UserID>${escapeXml(params.userId)}</UserID>
        <Password>${escapeXml(params.password)}</Password>
        <SvcrAcct>${escapeXml(params.svcrAcct)}</SvcrAcct>
      </UserInfo>
      <Callno>${escapeXml(params.callNo)}</Callno>
      <Notes>${escapeXml(params.note)}</Notes>
      <AddedBy>${escapeXml(params.addedBy)}</AddedBy>${visBlock}
    </urn:updateCallInfo>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Handle a POST /api/servicepower request. Returns a standard Response.
 * `env` lets callers pass platform-provided secrets (Cloudflare bindings);
 * falls back to process.env for Node/dev.
 */
export async function handleServicePowerRequest(
  request: Request,
  env?: Record<string, string | undefined>
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const getEnv = (k: string): string | undefined =>
    env?.[k] ?? (typeof process !== 'undefined' ? process.env?.[k] : undefined);

  // Build-time injected constants (see vite.config.ts `define`). Baked into the
  // SERVER bundle only (dist/server), never the client. Most reliable source on
  // Cloudflare Workers, where runtime env plumbing varies. Falls back to env.
  // NOTE: these MUST use static dot-access so Vite's `define` text replacement
  // applies (dynamic bracket access would not be replaced).
  const pick = (injectedVal: unknown, envKey: string): string | undefined => {
    if (typeof injectedVal === 'string' && injectedVal !== '') return injectedVal;
    return getEnv(envKey);
  };

  try {
    const body = (await request.json()) as ServicePowerRequestBody;
    const { action, params } = body;

    const userId = pick((globalThis as any).__SP_USER_ID__, 'VITE_SERVICEPOWER_USER_ID');
    const password = pick((globalThis as any).__SP_PASSWORD__, 'VITE_SERVICEPOWER_PASSWORD');
    const envName = pick((globalThis as any).__SP_ENV__, 'VITE_SERVICEPOWER_ENV') || 'staging';
    const region = pick((globalThis as any).__SP_REGION__, 'VITE_SERVICEPOWER_REGION') || 'na';
    const svcrAcct =
      pick((globalThis as any).__SP_SERVICER_ACCOUNT__, 'VITE_SERVICEPOWER_SERVICER_ACCOUNT') ||
      userId ||
      '';

    if (!userId || !password) {
      return json(
        { success: false, error: 'ServicePower credentials not configured on server' },
        500
      );
    }

    switch (action) {
      case 'getCallInfo': {
        // SOAP Dispatch Web Service - query work orders (calls) by date range.
        const endpoint = (DISPATCH_ENDPOINTS as any)[envName] || DISPATCH_ENDPOINTS.staging;

        const soapBody = buildGetCallInfoEnvelope({
          userId,
          password,
          svcrAcct,
          fromDate: params?.fromDate,
          toDate: params?.toDate,
          callNo: params?.callNo,
        });

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '',
          },
          body: soapBody,
        });

        const xml = await response.text();
        return json({ success: response.ok, xml, environment: envName });
      }

      case 'getCallNotes': {
        // SOAP Dispatch Web Service - fetch running notes for one call.
        const endpoint = (DISPATCH_ENDPOINTS as any)[envName] || DISPATCH_ENDPOINTS.staging;
        if (!params?.callNo) {
          return json({ success: false, error: 'callNo is required for getCallNotes' }, 400);
        }
        const soapBody = buildGetCallNotesEnvelope({
          userId,
          password,
          svcrAcct,
          callNo: String(params.callNo),
        });
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
          body: soapBody,
        });
        const xml = await response.text();
        return json({ success: response.ok, xml, environment: envName });
      }

      case 'addCallNote': {
        // SOAP Dispatch Web Service - push a running note back to SP via
        // updateCallInfo (the Notes/AddedBy pair).
        const endpoint = (DISPATCH_ENDPOINTS as any)[envName] || DISPATCH_ENDPOINTS.staging;
        const noteText = String(params?.note ?? '').trim();
        const callNo = String(params?.callNo ?? '').trim();
        if (!callNo || !noteText) {
          return json(
            { success: false, error: 'callNo and note are required for addCallNote' },
            400,
          );
        }
        const soapBody = buildAddCallNoteEnvelope({
          userId,
          password,
          svcrAcct,
          callNo,
          note: noteText,
          addedBy: String(params?.addedBy ?? svcrAcct ?? userId ?? ''),
          isInternal: typeof params?.isInternal === 'boolean' ? params.isInternal : undefined,
        });
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
          body: soapBody,
        });
        const xml = await response.text();
        return json({ success: response.ok, xml, environment: envName });
      }

      case 'test': {
        const endpoint = (ENDPOINTS as any)[envName][region].claimsRetrieval;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manufacturerName: params?.manufacturerName || '',
            claimNumber: 'TEST-CONNECTION',
            authentication: { userId, password },
          }),
        });
        const data = await response.json();
        return json({
          success: true,
          authenticated: data.responseCode === 'OK' || data.responseCode === 'ER',
          data,
          environment: envName,
          region,
        });
      }

      case 'retrieveClaim': {
        const endpoint = (ENDPOINTS as any)[envName][region].claimsRetrieval;
        // SP's claim retrieval API requires both manufacturerName AND
        // serviceCenterNumber (the numeric servicer ID the manufacturer
        // issued us — not the SP login like GSL00002). Without that
        // exact pair the API rejects with
        // "Invalid manufacturerName/serviceCenterNumber".
        //
        // Resolution order:
        //   1. caller-supplied params (highest priority)
        //   2. VITE_SERVICEPOWER_SERVICER_NUMBER env (recommended)
        //   3. VITE_SERVICEPOWER_MANUFACTURER_NAME env (recommended)
        //   4. fall back to SP login as servicer (used for Assurant
        //      tenants where the login IS the servicer code).
        const envManufacturer = pick(
          (globalThis as any).__SP_MANUFACTURER_NAME__,
          'VITE_SERVICEPOWER_MANUFACTURER_NAME',
        );
        const envServicerNumber = pick(
          (globalThis as any).__SP_SERVICER_NUMBER__,
          'VITE_SERVICEPOWER_SERVICER_NUMBER',
        );

        const payload = {
          ...params,
          manufacturerName:
            params?.manufacturerName ||
            envManufacturer ||
            'ASSURANT',
          serviceCenterNumber:
            params?.serviceCenterNumber ||
            envServicerNumber ||
            svcrAcct,
          authentication: { userId, password },
        };
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        return json(data);
      }

      case 'createRFA': {
        const endpoint = (ENDPOINTS as any)[envName][region].createRFA;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, authentication: { userId, password } }),
        });
        const data = await response.json();
        return json(data);
      }

      case 'retrieveRFA': {
        const endpoint = (ENDPOINTS as any)[envName][region].retrieveRFA;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, authentication: { userId, password } }),
        });
        const data = await response.json();
        return json(data);
      }

      default:
        return json({ error: 'Invalid action' }, 400);
    }
  } catch (error) {
    console.error('[ServicePower API] Error:', error);
    return json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}
