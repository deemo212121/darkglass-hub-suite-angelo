/**
 * ServicePower API Server-Side Endpoint
 * 
 * This endpoint acts as a proxy to call ServicePower APIs from the server-side,
 * bypassing CORS restrictions that prevent direct browser calls.
 */

export const config = {
  runtime: "nodejs20.x",
};

interface ServicePowerRequest {
  action: 'test' | 'retrieveClaim' | 'createRFA' | 'retrieveRFA';
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

export default async function handler(request: Request): Promise<Response> {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: ServicePowerRequest = await request.json();
    const { action, params } = body;

    // Get credentials from environment
    const userId = process.env.VITE_SERVICEPOWER_USER_ID;
    const password = process.env.VITE_SERVICEPOWER_PASSWORD;
    const env = process.env.VITE_SERVICEPOWER_ENV || 'staging';
    const region = process.env.VITE_SERVICEPOWER_REGION || 'na';

    if (!userId || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'ServicePower credentials not configured on server',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Handle different actions
    switch (action) {
      case 'test': {
        // Simple connection test
        const endpoint = (ENDPOINTS as any)[env][region].claimsRetrieval;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            manufacturerName: params?.manufacturerName || '',
            claimNumber: 'TEST-CONNECTION',
            authentication: {
              userId,
              password,
            },
          }),
        });

        const data = await response.json();

        return new Response(
          JSON.stringify({
            success: true,
            authenticated: data.responseCode === 'OK' || data.responseCode === 'ER',
            data,
            environment: env,
            region,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      case 'retrieveClaim': {
        const endpoint = (ENDPOINTS as any)[env][region].claimsRetrieval;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...params,
            authentication: {
              userId,
              password,
            },
          }),
        });

        const data = await response.json();

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'createRFA': {
        const endpoint = (ENDPOINTS as any)[env][region].createRFA;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...params,
            authentication: {
              userId,
              password,
            },
          }),
        });

        const data = await response.json();

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'retrieveRFA': {
        const endpoint = (ENDPOINTS as any)[env][region].retrieveRFA;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...params,
            authentication: {
              userId,
              password,
            },
          }),
        });

        const data = await response.json();

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
    }
  } catch (error) {
    console.error('[ServicePower API] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
