export async function GET(request: Request) {
  const userId = import.meta.env.VITE_SERVICEPOWER_USER_ID;
  const password = import.meta.env.VITE_SERVICEPOWER_PASSWORD;
  const env = import.meta.env.VITE_SERVICEPOWER_ENV || 'staging';
  const region = import.meta.env.VITE_SERVICEPOWER_REGION || 'na';

  if (!userId || !password) {
    return new Response(JSON.stringify({
      success: false,
      error: 'ServicePower credentials not configured in .env'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const endpoints = {
    staging: {
      na: 'https://upgdev.servicepower.com:8443/services/claim/v1/retrieval',
      eu: 'https://claimsqa-eu.servicepower.com/services/claim/v1/retrieval'
    },
    production: {
      na: 'https://claimworks.servicepower.com:8443/services/claim/v1/retrieval',
      eu: 'https://claims-eu.servicepower.com/services/claim/v1/retrieval'
    }
  };

  const endpoint = endpoints[env as 'staging' | 'production'][region as 'na' | 'eu'];

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        manufacturerName: '',
        claimNumber: 'TEST-12345',
        authentication: {
          userId,
          password
        }
      })
    });

    const data = await response.json();

    return new Response(JSON.stringify({
      success: data.responseCode === 'OK',
      config: { env, region, userId: '✅ Set', password: '✅ Set' },
      data
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
