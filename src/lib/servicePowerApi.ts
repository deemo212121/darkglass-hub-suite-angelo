// ServicePower API Integration Service

import type {
  ServicePowerConfig,
  ServicePowerRegion,
  ServicePowerEnvironment,
  ClaimsRetrievalRequest,
  ClaimsRetrievalResponse,
  CreateRFARequest,
  CreateRFAResponse,
  RetrieveRFARequest,
  RetrieveRFAResponse,
} from '@/types/servicePower';

// ============================================================================
// Configuration
// ============================================================================

const ENDPOINTS = {
  production: {
    na: {
      claimsRetrieval: 'https://claimworks.servicepower.com:8443/services/claim/v1/retrieval',
      createRFA: 'https://claimworks.servicepower.com:8443/services/rfa/v2/setdetailssvc',
      retrieveRFA: 'https://claimworks.servicepower.com:8443/services/rfa/v2/getdetails',
    },
    eu: {
      claimsRetrieval: 'https://claims-eu.servicepower.com/services/claim/v1/retrieval',
      createRFA: 'https://claims-eu.servicepower.com/services/rfa/v2/setdetailssvc',
      retrieveRFA: 'https://claims-eu.servicepower.com/services/rfa/v2/getdetails',
    },
  },
  staging: {
    na: {
      claimsRetrieval: 'https://upgdev.servicepower.com:8443/services/claim/v1/retrieval',
      createRFA: 'https://upgdev.servicepower.com:8443/services/rfa/v2/setdetailssvc',
      retrieveRFA: 'https://upgdev.servicepower.com:8443/services/rfa/v2/getdetails',
    },
    eu: {
      claimsRetrieval: 'https://claimsqa-eu.servicepower.com/services/claim/v1/retrieval',
      createRFA: 'https://claimsqa-eu.servicepower.com/services/rfa/v2/setdetailssvc',
      retrieveRFA: 'https://claimsqa-eu.servicepower.com/services/rfa/v2/getdetails',
    },
  },
};

// ============================================================================
// ServicePower API Client Class
// ============================================================================

export class ServicePowerClient {
  private config: ServicePowerConfig;

  constructor(config: ServicePowerConfig) {
    this.config = config;
  }

  /**
   * Get the base URL for a specific endpoint
   */
  private getEndpoint(type: 'claimsRetrieval' | 'createRFA' | 'retrieveRFA'): string {
    return ENDPOINTS[this.config.environment][this.config.region][type];
  }

  /**
   * Make a POST request to ServicePower API
   */
  private async makeRequest<TRequest, TResponse>(
    endpoint: string,
    payload: TRequest
  ): Promise<TResponse> {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Log transaction ID for debugging
      if (data.transactionId) {
        console.log('[ServicePower] Transaction ID:', data.transactionId);
      }

      // Check for API-level errors
      if (data.responseCode === 'ER') {
        const errorMessages = data.messages?.map((m: any) => m.message).join(', ') || 'Unknown error';
        throw new Error(`ServicePower API Error: ${errorMessages}`);
      }

      return data;
    } catch (error) {
      console.error('[ServicePower] API Request Failed:', error);
      throw error;
    }
  }

  /**
   * Retrieve claim information
   */
  async retrieveClaim(params: {
    claimIdentifier?: string;
    claimNumber?: string;
    callNumber?: string;
    claimBatchNumber?: number;
    claimSequenceNumber?: number;
    manufacturerName?: string;
  }): Promise<ClaimsRetrievalResponse> {
    const request: ClaimsRetrievalRequest = {
      manufacturerName: params.manufacturerName || this.config.manufacturerName || '',
      serviceCenterNumber: this.config.serviceCenterNumber,
      ...params,
      authentication: {
        userId: this.config.userId,
        password: this.config.password,
      },
    };

    return this.makeRequest<ClaimsRetrievalRequest, ClaimsRetrievalResponse>(
      this.getEndpoint('claimsRetrieval'),
      request
    );
  }

  /**
   * Create a new Request for Authorization
   */
  async createRFA(request: Omit<CreateRFARequest, 'authentication'>): Promise<CreateRFAResponse> {
    const fullRequest: CreateRFARequest = {
      ...request,
      manufacturerName: request.manufacturerName || this.config.manufacturerName || '',
      authentication: {
        userId: this.config.userId,
        password: this.config.password,
      },
    };

    return this.makeRequest<CreateRFARequest, CreateRFAResponse>(
      this.getEndpoint('createRFA'),
      fullRequest
    );
  }

  /**
   * Retrieve Request for Authorization status
   */
  async retrieveRFA(params: {
    callNumber?: string;
    manufacturerName?: string;
    fromChangedOn?: string;
    toChangedOn?: string;
    manufacturerNumber?: string;
  }): Promise<RetrieveRFAResponse> {
    const request: RetrieveRFARequest = {
      ...params,
      manufacturerName: params.manufacturerName || this.config.manufacturerName,
      authentication: {
        userId: this.config.userId,
        password: this.config.password,
      },
    };

    return this.makeRequest<RetrieveRFARequest, RetrieveRFAResponse>(
      this.getEndpoint('retrieveRFA'),
      request
    );
  }

  /**
   * Poll for RFA status changes (useful for checking authorization approval)
   */
  async pollRFAStatus(
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
          const response = await this.retrieveRFA({ callNumber });
          
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
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ServicePower client from environment variables
 */
export function createServicePowerClient(): ServicePowerClient {
  const environment = (import.meta.env.VITE_SERVICEPOWER_ENV || 'staging') as ServicePowerEnvironment;
  const region = (import.meta.env.VITE_SERVICEPOWER_REGION || 'na') as ServicePowerRegion;
  const userId = import.meta.env.VITE_SERVICEPOWER_USER_ID;
  const password = import.meta.env.VITE_SERVICEPOWER_PASSWORD;
  const manufacturerName = import.meta.env.VITE_SERVICEPOWER_MANUFACTURER_NAME;
  const serviceCenterNumber = import.meta.env.VITE_SERVICEPOWER_SERVICER_NUMBER;

  if (!userId || !password) {
    throw new Error('ServicePower credentials not configured. Set VITE_SERVICEPOWER_USER_ID and VITE_SERVICEPOWER_PASSWORD in .env');
  }

  return new ServicePowerClient({
    environment,
    region,
    userId,
    password,
    manufacturerName,
    serviceCenterNumber,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a date for ServicePower API (CCYYMMDD)
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format a timestamp for ServicePower API (CCYYMMDDHHMM)
 */
export function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}`;
}

/**
 * Parse a ServicePower date string (CCYYMMDD or YYYYMMDD)
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.length < 8) return null;
  
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  
  return new Date(year, month, day);
}

/**
 * Parse a ServicePower timestamp (YYYYMMDDHHMMSS)
 */
export function parseTimestamp(timestampStr: string): Date | null {
  if (!timestampStr || timestampStr.length < 14) return null;
  
  const year = parseInt(timestampStr.substring(0, 4));
  const month = parseInt(timestampStr.substring(4, 6)) - 1;
  const day = parseInt(timestampStr.substring(6, 8));
  const hours = parseInt(timestampStr.substring(8, 10));
  const minutes = parseInt(timestampStr.substring(10, 12));
  const seconds = parseInt(timestampStr.substring(12, 14));
  
  return new Date(year, month, day, hours, minutes, seconds);
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
