/**
 * ServicePower Integration Component
 * 
 * This component demonstrates integration between your existing ticket system
 * and ServicePower's authorization and claims APIs
 */

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createServicePowerClient, getRFAStatusLabel } from '@/lib/servicePowerApi';
import type { RFAPart, RFARequest } from '@/types/servicePower';

interface ServicePowerIntegrationProps {
  ticketNo: string;
  callNumber: string;
}

export function ServicePowerIntegration({ ticketNo, callNumber }: ServicePowerIntegrationProps) {
  const [activeTab, setActiveTab] = useState<'rfa' | 'claim'>('rfa');

  return (
    <Card className="p-6">
      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => setActiveTab('rfa')}
          className={`pb-2 px-4 ${
            activeTab === 'rfa'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-600'
          }`}
        >
          Authorization Requests
        </button>
        <button
          onClick={() => setActiveTab('claim')}
          className={`pb-2 px-4 ${
            activeTab === 'claim'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-600'
          }`}
        >
          Claim Status
        </button>
      </div>

      {activeTab === 'rfa' ? (
        <AuthorizationRequestSection ticketNo={ticketNo} callNumber={callNumber} />
      ) : (
        <ClaimStatusSection ticketNo={ticketNo} callNumber={callNumber} />
      )}
    </Card>
  );
}

// ============================================================================
// Authorization Request Section
// ============================================================================

function AuthorizationRequestSection({ ticketNo, callNumber }: ServicePowerIntegrationProps) {
  const [showForm, setShowForm] = useState(false);
  const [rfaStatus, setRfaStatus] = useState<RFARequest | null>(null);
  const [loading, setLoading] = useState(false);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const client = createServicePowerClient();
      const response = await client.retrieveRFA({ callNumber });
      
      if (response.requests && response.requests.length > 0) {
        setRfaStatus(response.requests[0]);
      }
    } catch (error) {
      console.error('Error checking RFA status:', error);
    } finally {
      setLoading(false);
    }
  };

  if (showForm) {
    return (
      <div>
        <Button
          variant="outline"
          onClick={() => setShowForm(false)}
          className="mb-4"
        >
          ← Back
        </Button>
        <AuthorizationRequestForm
          callNumber={callNumber}
          onSuccess={() => {
            setShowForm(false);
            checkStatus();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Authorization Status</h3>
        <div className="space-x-2">
          <Button onClick={checkStatus} disabled={loading}>
            {loading ? 'Checking...' : 'Check Status'}
          </Button>
          <Button onClick={() => setShowForm(true)}>
            Request Authorization
          </Button>
        </div>
      </div>

      {rfaStatus ? (
        <AuthorizationStatusDisplay rfa={rfaStatus} />
      ) : (
        <div className="text-center py-8 text-gray-500">
          No authorization requests found for this call.
          <br />
          Click "Request Authorization" to submit a new request.
        </div>
      )}
    </div>
  );
}

function AuthorizationStatusDisplay({ rfa }: { rfa: RFARequest }) {
  const statusCode = rfa.coreInfo?.rfaStatusCode;
  const statusLabel = getRFAStatusLabel(statusCode);

  const getStatusColor = () => {
    switch (statusCode) {
      case 'APV': return 'bg-green-100 text-green-800 border-green-300';
      case 'REJ': return 'bg-red-100 text-red-800 border-red-300';
      case 'WAI': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'OPN': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="border rounded-lg p-4">
      <div className={`inline-block px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor()}`}>
        {statusLabel}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm text-gray-600">Requested Amount</div>
          <div className="text-lg font-semibold">
            ${rfa.amounts?.requestedTotal?.toFixed(2) || '0.00'}
          </div>
        </div>

        {statusCode === 'APV' && rfa.amounts?.authorizedTotal && (
          <div>
            <div className="text-sm text-gray-600">Authorized Amount</div>
            <div className="text-lg font-semibold text-green-600">
              ${rfa.amounts.authorizedTotal.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {rfa.amounts && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="font-medium mb-2">Request Breakdown:</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {rfa.amounts.requestedLabor && (
              <div>Labor: ${rfa.amounts.requestedLabor.toFixed(2)}</div>
            )}
            {rfa.amounts.requestedMiles && (
              <div>Mileage: {rfa.amounts.requestedMiles} miles @ ${rfa.amounts.requestedRatePerMile}/mi</div>
            )}
            {rfa.amounts.requestedTravel && (
              <div>Travel: ${rfa.amounts.requestedTravel.toFixed(2)}</div>
            )}
            {rfa.amounts.requestedOther && (
              <div>Other: ${rfa.amounts.requestedOther.toFixed(2)}</div>
            )}
          </div>
        </div>
      )}

      {rfa.parts && rfa.parts.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="font-medium mb-2">Requested Parts:</h4>
          <div className="space-y-2">
            {rfa.parts.map((part, index) => (
              <div key={index} className="text-sm flex justify-between">
                <span>
                  {part.quantity}x {part.partDescription} ({part.partNumber})
                </span>
                <span className="font-medium">
                  ${((part.total || 0).toFixed(2))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rfa.approvalRejectInfo?.approvedOrAdditionalInformationRequestNotes && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="font-medium mb-2">Notes:</h4>
          <p className="text-sm text-gray-700">
            {rfa.approvalRejectInfo.approvedOrAdditionalInformationRequestNotes}
          </p>
        </div>
      )}

      {rfa.auditInfo?.approvedOn && (
        <div className="mt-4 pt-4 border-t text-xs text-gray-500">
          Reviewed by {rfa.auditInfo.approvedBy} on {rfa.auditInfo.approvedOn}
        </div>
      )}
    </div>
  );
}

function AuthorizationRequestForm({
  callNumber,
  onSuccess
}: {
  callNumber: string;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    additionalManRequired: false,
    estimatedHours: 0,
    estimatedMinutes: 0,
    whyHigherRate: '',
    requestedLabor: 0,
    requestedMiles: 0,
    requestedRatePerMile: 0.65,
  });

  const [parts, setParts] = useState<RFAPart[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const client = createServicePowerClient();
      
      const response = await client.createRFA({
        callNumber,
        coreInfo: {
          additionalManRequired: formData.additionalManRequired ? 'Y' : 'N',
          estimatedHoursOnJob: formData.estimatedHours,
          estimatedMinutesOnJob: formData.estimatedMinutes,
          whyHigherRate: formData.whyHigherRate
        },
        amounts: {
          requestedLabor: formData.requestedLabor,
          requestedMiles: formData.requestedMiles,
          requestedRatePerMile: formData.requestedRatePerMile,
        },
        parts: parts.length > 0 ? parts : undefined
      });

      if (response.responseCode === 'OK') {
        onSuccess();
      } else {
        setError(response.messages?.map(m => m.message).join(', ') || 'Failed to submit');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.additionalManRequired}
            onChange={(e) => setFormData({ ...formData, additionalManRequired: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm font-medium">Additional Technician Required</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Estimated Time</label>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <input
              type="number"
              min="0"
              placeholder="Hours"
              value={formData.estimatedHours}
              onChange={(e) => setFormData({ ...formData, estimatedHours: parseInt(e.target.value) || 0 })}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <input
              type="number"
              min="0"
              max="59"
              placeholder="Minutes"
              value={formData.estimatedMinutes}
              onChange={(e) => setFormData({ ...formData, estimatedMinutes: parseInt(e.target.value) || 0 })}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">
          Reason for Additional Authorization *
        </label>
        <textarea
          required
          value={formData.whyHigherRate}
          onChange={(e) => setFormData({ ...formData, whyHigherRate: e.target.value })}
          className="w-full border rounded-lg px-3 py-2"
          rows={4}
          placeholder="Explain why additional authorization is needed (be specific)..."
        />
        <p className="text-xs text-gray-500 mt-1">
          Provide detailed justification for faster approval
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Requested Labor ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formData.requestedLabor}
            onChange={(e) => setFormData({ ...formData, requestedLabor: parseFloat(e.target.value) || 0 })}
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Mileage</label>
          <input
            type="number"
            min="0"
            placeholder="Miles"
            value={formData.requestedMiles}
            onChange={(e) => setFormData({ ...formData, requestedMiles: parseInt(e.target.value) || 0 })}
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-end space-x-3">
        <Button type="button" variant="outline" onClick={onSuccess}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Submitting...' : 'Submit Request'}
        </Button>
      </div>
    </form>
  );
}

// ============================================================================
// Claim Status Section
// ============================================================================

function ClaimStatusSection({ ticketNo, callNumber }: ServicePowerIntegrationProps) {
  // Implementation would be similar to Authorization section
  // but using claims retrieval API
  return (
    <div className="text-center py-8 text-gray-500">
      Claim status checking will be implemented here.
      <br />
      Use the Claims Retrieval API to check payment status.
    </div>
  );
}
