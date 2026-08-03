/**
 * ServicePower API Client (Server-Side Proxy Version)
 * 
 * This client calls our server-side API endpoint which proxies requests to ServicePower,
 * avoiding CORS issues that occur when calling ServicePower directly from the browser.
 */

import type {
  ClaimsRetrievalResponse,
  CreateRFAResponse,
  RetrieveRFAResponse,
} from '@/types/servicePower';

/**
 * Test ServicePower API connection
 */
export async function testServicePowerConnection(): Promise<{
  success: boolean;
  authenticated: boolean;
  data?: any;
  error?: string;
}> {
  try {
    const response = await fetch('/api/servicepower', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'test',
        params: {}
      })
    });

    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        authenticated: false,
        error: result.error || 'Server error'
      };
    }

    return {
      success: true,
      authenticated: result.authenticated,
      data: result.data
    };
  } catch (error) {
    return {
      success: false,
      authenticated: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Retrieve claim information
 */
export async function retrieveClaim(params: {
  claimIdentifier?: string;
  claimNumber?: string;
  callNumber?: string;
  claimBatchNumber?: number;
  claimSequenceNumber?: number;
  manufacturerName?: string;
  serviceCenterNumber?: string;
}): Promise<ClaimsRetrievalResponse> {
  const { runWithApiHealth } = await import("./apiHealth");
  return runWithApiHealth(
    "servicePower.retrieveClaim",
    async () => {
      const response = await fetch('/api/servicepower', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retrieveClaim', params }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to retrieve claim');
      }
      return response.json() as Promise<ClaimsRetrievalResponse>;
    },
    {
      // Treat ServicePower "ER" responses as logical failures. Some are
      // expected (claim not on file, bad input) but persistent ER bursts
      // still warrant an admin heads-up.
      isFailure: (r) => Boolean(r && (r as any).responseCode === "ER"),
      describeFailure: (r) =>
        (r as any)?.messages?.map((m: any) => m.message).join("; ") ||
        "ServicePower responded with ER",
    },
  );
}

/**
 * Create a new Request for Authorization
 */
export async function createRFA(params: {
  manufacturerName?: string;
  callNumber: string;
  serviceDate: string;
  problemDescription: string;
  serviceLocation?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  consumer?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
  };
  product?: {
    modelNumber?: string;
    serialNumber?: string;
    purchaseDate?: string;
  };
  partsRequested?: Array<{
    partNumber: string;
    description: string;
    quantity: number;
    unitPrice?: number;
  }>;
  laborRequested?: {
    hours: number;
    rate?: number;
  };
}): Promise<CreateRFAResponse> {
  const response = await fetch('/api/servicepower', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'createRFA',
      params
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create RFA');
  }

  return response.json();
}

/**
 * Retrieve Request for Authorization status
 */
export async function retrieveRFA(params: {
  callNumber?: string;
  manufacturerName?: string;
  fromChangedOn?: string;
  toChangedOn?: string;
  manufacturerNumber?: string;
}): Promise<RetrieveRFAResponse> {
  const response = await fetch('/api/servicepower', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'retrieveRFA',
      params
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to retrieve RFA');
  }

  return response.json();
}

/**
 * Poll for RFA status changes
 */
export async function pollRFAStatus(
  callNumber: string,
  options?: {
    interval?: number;
    maxAttempts?: number;
    onUpdate?: (response: RetrieveRFAResponse) => void;
  }
): Promise<RetrieveRFAResponse> {
  const interval = options?.interval || 60000; // Default: 1 minute
  const maxAttempts = options?.maxAttempts || 60; // Default: 60 attempts (1 hour)
  
  let attempts = 0;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        attempts++;
        const response = await retrieveRFA({ callNumber });
        
        if (options?.onUpdate) {
          options.onUpdate(response);
        }

        // Check if RFA status is final (approved, rejected, or closed)
        const request = response.requests?.[0];
        const status = request?.coreInfo?.rfaStatusCode;
        
        if (status === 'APV' || status === 'REJ' || status === 'CLS') {
          resolve(response);
          return;
        }

        // Continue polling if not at max attempts
        if (attempts < maxAttempts) {
          setTimeout(poll, interval);
        } else {
          reject(new Error('Max polling attempts reached'));
        }
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });
}

/**
 * Get human-readable RFA status
 */
export function getRFAStatusLabel(statusCode?: string): string {
  const statusMap: Record<string, string> = {
    OPN: 'Open',
    APV: 'Approved',
    REJ: 'Rejected',
    WAI: 'Waiting for Information',
    CLS: 'Closed',
  };
  return statusMap[statusCode || ''] || 'Unknown';
}

/**
 * Check if RFA is in final state
 */
export function isRFAFinal(statusCode?: string): boolean {
  return statusCode === 'APV' || statusCode === 'REJ' || statusCode === 'CLS';
}
