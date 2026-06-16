/**
 * ServicePower Sync Button Component
 * 
 * Sync work orders from ServicePower by date range
 */

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Download, Check, AlertCircle, Calendar } from 'lucide-react';
import { syncServicePowerCalls } from '@/lib/servicePowerSync';

interface SyncResult {
  success: boolean;
  added: number;
  updated: number;
  errors?: string[];
}

export function ServicePowerSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [days, setDays] = useState('7'); // Default to last 7 days

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);

    try {
      // Calculate date range
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(toDate.getDate() - parseInt(days || '7', 10));

      // Format as YYYYMMDD
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };

      const fromDateStr = formatDate(fromDate);
      const toDateStr = formatDate(toDate);

      const syncResult = await syncServicePowerCalls(fromDateStr, toDateStr, 'merge');

      setResult({
        success: syncResult.success,
        added: syncResult.added,
        updated: syncResult.updated,
        errors: syncResult.errors,
      });
    } catch (error) {
      setResult({
        success: false,
        added: 0,
        updated: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-sm text-slate-400 block mb-1">Sync Last</label>
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
            disabled={syncing}
          >
            <option value="1">1 Day</option>
            <option value="3">3 Days</option>
            <option value="7">7 Days</option>
            <option value="14">14 Days</option>
            <option value="30">30 Days</option>
            <option value="60">60 Days</option>
            <option value="90">90 Days</option>
          </select>
        </div>
        
        <div className="flex flex-col gap-2">
          <Button
            onClick={handleSync}
            disabled={syncing}
            className="gap-2"
          >
            {syncing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Sync Work Orders
              </>
            )}
          </Button>
        </div>
      </div>

      {result && (
        <div className={`p-3 rounded-lg border ${
          result.success 
            ? 'bg-green-900/20 border-green-700' 
            : 'bg-red-900/20 border-red-700'
        }`}>
          <div className="flex items-start gap-2">
            {result.success ? (
              <Check className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
            )}
            
            <div className="flex-1 text-sm">
              {result.success ? (
                <>
                  <div className="font-semibold text-green-300 mb-1">
                    ✅ Sync Successful!
                  </div>
                  <div className="text-slate-300">
                    <div>• Added: {result.added} new work orders</div>
                    <div>• Updated: {result.updated} existing work orders</div>
                    <div className="mt-2 text-xs text-slate-400">
                      Work orders synced from ServicePower appear in your ticket list
                    </div>
                    {result.errors && result.errors.length > 0 && (
                      <div className="mt-2 text-xs text-amber-300 break-all whitespace-pre-wrap">
                        {result.errors.map((error, idx) => (
                          <div key={idx}>⚠ {error}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-red-300 mb-1">
                    ❌ Sync Failed
                  </div>
                  {result.errors && result.errors.length > 0 && (
                    <div className="text-slate-300 space-y-1">
                      {result.errors.map((error, idx) => (
                        <div key={idx}>• {error}</div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-500 border-t border-slate-700 pt-3">
        <p className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          ServicePower work orders are synced by date range
        </p>
        <p className="mt-1">• Select a time period and click "Sync Work Orders"</p>
        <p className="mt-1">• Synced work orders will be merged with your existing ticket list</p>
        <p className="mt-1">• Work orders are identified by Call Number</p>
      </div>
    </Card>
  );
}
