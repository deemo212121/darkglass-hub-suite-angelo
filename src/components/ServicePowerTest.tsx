/**
 * ServicePower Connection Test Component - Diagnostic Version
 */

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function ServicePowerTest() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    rawXml?: string;
    details?: any;
  } | null>(null);

  const testConnection = async () => {
    setTesting(true);
    setResult(null);

    try {
      // Call our server-side API endpoint (bypasses CORS)
      const response = await fetch('/api/servicepower', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'test',
          params: {},
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setResult({
          success: false,
          message: '❌ Server error',
          details: data,
        });
        return;
      }

      setResult({
        success: !!data.success,
        message: data.message || 'Done',
        rawXml: data.xml,
        details: data.data,
      });
    } catch (error) {
      setResult({
        success: false,
        message: '❌ Connection failed',
        details: {
          error: error instanceof Error ? error.message : String(error),
          note: 'Failed to connect to server-side API endpoint',
        },
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Card className="p-6">
        <h2 className="text-xl font-bold mb-4">ServicePower API Connection Test</h2>

        <div className="space-y-4">
          <Button onClick={testConnection} disabled={testing}>
            {testing ? 'Testing...' : 'Test Connection (no date filter)'}
          </Button>

          {result && (
            <div
              className={`p-4 rounded-lg border ${
                result.success
                  ? 'bg-green-50 border-green-300'
                  : 'bg-red-50 border-red-300'
              }`}
            >
              <div className="font-semibold mb-2">{result.message}</div>

              {result.rawXml && (
                <div className="mt-3">
                  <div className="text-sm font-semibold mb-1">Raw XML Response:</div>
                  <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {result.rawXml}
                  </pre>
                </div>
              )}

              {result.details && (
                <div className="mt-3">
                  <div className="text-sm font-semibold mb-1">Parsed Details:</div>
                  <pre className="text-xs bg-slate-100 p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(result.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Configuration</h3>
            <div className="text-sm text-blue-800 space-y-1">
              <div>Environment: {import.meta.env.VITE_SERVICEPOWER_ENV || 'staging'}</div>
              <div>Region: {import.meta.env.VITE_SERVICEPOWER_REGION || 'na'}</div>
              <div>
                User ID:{' '}
                {import.meta.env.VITE_SERVICEPOWER_USER_ID
                  ? `✅ Set (${import.meta.env.VITE_SERVICEPOWER_USER_ID.length} chars)`
                  : '❌ Not set'}
              </div>
              <div>
                Password:{' '}
                {import.meta.env.VITE_SERVICEPOWER_PASSWORD ? '✅ Set' : '❌ Not set'}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
