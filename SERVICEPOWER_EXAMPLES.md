# ServicePower API - Code Examples

## Setup

1. **Add environment variables to `.env`:**

```env
# ServicePower Configuration
VITE_SERVICEPOWER_ENV=staging
VITE_SERVICEPOWER_REGION=na
VITE_SERVICEPOWER_USER_ID=your_user_id
VITE_SERVICEPOWER_PASSWORD=your_password
VITE_SERVICEPOWER_MANUFACTURER_NAME=YourManufacturer
VITE_SERVICEPOWER_SERVICER_NUMBER=12345
```

2. **Import the client:**

```typescript
import { createServicePowerClient, formatDate } from '@/lib/servicePowerApi';
```

## Example 1: Check Claim Payment Status

```typescript
async function checkClaimPayment(claimNumber: string) {
  const client = createServicePowerClient();
  
  try {
    const response = await client.retrieveClaim({
      claimNumber: claimNumber
    });
    
    if (response.responseCode === 'OK' && response.claims) {
      const claim = response.claims[0];
      
      console.log('Claim Status:', claim.claimStatusDescription);
      console.log('Payment Amount:', claim.paymentAmount);
      console.log('Payment Date:', claim.paymentDate);
      
      if (claim.paymentDate) {
        console.log('✅ Claim has been paid!');
        console.log('Labor:', claim.paidLaborAmount);
        console.log('Parts:', claim.paidPartsAmount);
        console.log('Travel:', claim.paidTravelAmount);
      } else {
        console.log('⏳ Payment pending...');
      }
    }
  } catch (error) {
    console.error('Error retrieving claim:', error);
  }
}
```

## Example 2: Submit Authorization Request

```typescript
async function requestAdditionalAuthorization(callNumber: string) {
  const client = createServicePowerClient();
  
  try {
    const response = await client.createRFA({
      callNumber: callNumber,
      manufacturerName: 'YourManufacturer',
      
      coreInfo: {
        additionalManRequired: 'Y',
        estimatedHoursOnJob: 2,
        estimatedMinutesOnJob: 30,
        whyHigherRate: 'Job requires second technician for safety. Heavy appliance on second floor.'
      },
      
      amounts: {
        requestedLabor: 150.00,
        requestedLaborTax: 12.00,
        requestedMiles: 45,
        requestedRatePerMile: 0.65,
      },
      
      parts: [
        {
          quantity: 1,
          partNumber: 'PART-12345',
          partDescription: 'Replacement Compressor',
          singlePartCost: 275.50,
          selfSourced: 'N'
        },
        {
          quantity: 2,
          partNumber: 'PART-67890',
          partDescription: 'Mounting Bracket',
          singlePartCost: 15.25,
          selfSourced: 'N'
        }
      ]
    });
    
    if (response.responseCode === 'OK') {
      console.log('✅ Authorization request submitted successfully');
      console.log('Check status by polling the retrieve API');
    } else {
      console.error('❌ Failed to submit authorization request');
      console.error('Messages:', response.messages);
    }
  } catch (error) {
    console.error('Error creating RFA:', error);
  }
}
```

## Example 3: Check Authorization Status

```typescript
async function checkAuthorizationStatus(callNumber: string) {
  const client = createServicePowerClient();
  
  try {
    const response = await client.retrieveRFA({
      callNumber: callNumber
    });
    
    if (response.responseCode === 'OK' && response.requests) {
      const request = response.requests[0];
      const status = request.coreInfo?.rfaStatusCode;
      const statusDescription = request.coreInfo?.rfaStatus;
      
      console.log('Authorization Status:', statusDescription);
      
      switch (status) {
        case 'APV':
          console.log('✅ APPROVED!');
          console.log('Authorized Labor:', request.amounts?.authorizedLabor);
          console.log('Authorized Parts:', request.amounts?.authorizedParts);
          console.log('Authorized Total:', request.amounts?.authorizedTotal);
          if (request.approvalRejectInfo?.approvedOrAdditionalInformationRequestNotes) {
            console.log('Notes:', request.approvalRejectInfo.approvedOrAdditionalInformationRequestNotes);
          }
          break;
          
        case 'REJ':
          console.log('❌ REJECTED');
          console.log('Reason:', request.approvalRejectInfo?.reasonDescription);
          console.log('Notes:', request.approvalRejectInfo?.approvedOrAdditionalInformationRequestNotes);
          break;
          
        case 'WAI':
          console.log('⏸️ WAITING - Additional information requested');
          console.log('Notes:', request.approvalRejectInfo?.approvedOrAdditionalInformationRequestNotes);
          break;
          
        case 'OPN':
          console.log('⏳ OPEN - Pending review');
          break;
          
        case 'CLS':
          console.log('🔒 CLOSED');
          break;
      }
    }
  } catch (error) {
    console.error('Error retrieving RFA:', error);
  }
}
```

## Example 4: Poll for Authorization Approval

```typescript
async function waitForAuthorizationDecision(callNumber: string) {
  const client = createServicePowerClient();
  
  console.log('🔄 Starting to poll for authorization decision...');
  
  try {
    const response = await client.pollRFAStatus(callNumber, {
      interval: 60000, // Check every minute
      maxAttempts: 60, // Stop after 1 hour
      onUpdate: (response) => {
        const request = response.requests?.[0];
        const status = request?.coreInfo?.rfaStatusCode;
        console.log(`⏳ Status: ${status} - ${request?.coreInfo?.rfaStatus}`);
      }
    });
    
    const request = response.requests?.[0];
    const status = request?.coreInfo?.rfaStatusCode;
    
    if (status === 'APV') {
      console.log('✅ Authorization approved!');
      return {
        approved: true,
        authorizedAmount: request?.amounts?.authorizedTotal,
        notes: request?.approvalRejectInfo?.approvedOrAdditionalInformationRequestNotes
      };
    } else {
      console.log('❌ Authorization not approved');
      return {
        approved: false,
        reason: request?.approvalRejectInfo?.reasonDescription,
        notes: request?.approvalRejectInfo?.approvedOrAdditionalInformationRequestNotes
      };
    }
  } catch (error) {
    console.error('Error polling for authorization:', error);
    throw error;
  }
}
```

## Example 5: React Component - Claim Status

```typescript
import { useState, useEffect } from 'react';
import { createServicePowerClient } from '@/lib/servicePowerApi';
import type { ClaimData } from '@/types/servicePower';

export function ClaimStatus({ claimNumber }: { claimNumber: string }) {
  const [claim, setClaim] = useState<ClaimData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    async function fetchClaim() {
      try {
        const client = createServicePowerClient();
        const response = await client.retrieveClaim({ claimNumber });
        
        if (response.claims && response.claims.length > 0) {
          setClaim(response.claims[0]);
        } else {
          setError('Claim not found');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch claim');
      } finally {
        setLoading(false);
      }
    }
    
    fetchClaim();
  }, [claimNumber]);
  
  if (loading) return <div>Loading claim status...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!claim) return <div>No claim found</div>;
  
  return (
    <div className="border rounded-lg p-4">
      <h3 className="font-semibold mb-2">Claim #{claim.claimNumber}</h3>
      <div className="space-y-2">
        <div>
          <span className="text-gray-600">Status:</span>
          <span className="ml-2 font-medium">{claim.claimStatusDescription}</span>
        </div>
        
        {claim.paymentDate && (
          <>
            <div>
              <span className="text-gray-600">Payment Date:</span>
              <span className="ml-2">{claim.paymentDate}</span>
            </div>
            <div>
              <span className="text-gray-600">Payment Amount:</span>
              <span className="ml-2 font-semibold">${claim.paymentAmount.toFixed(2)}</span>
            </div>
            
            <div className="mt-4 pt-4 border-t">
              <h4 className="font-medium mb-2">Payment Breakdown:</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Labor: ${claim.paidLaborAmount.toFixed(2)}</div>
                <div>Parts: ${claim.paidPartsAmount.toFixed(2)}</div>
                <div>Travel: ${claim.paidTravelAmount.toFixed(2)}</div>
                <div>Mileage: ${claim.paidMileageAmount.toFixed(2)}</div>
                <div>Other: ${claim.paidOtherAmount.toFixed(2)}</div>
                <div>Tax: ${(claim.paidFederalTaxAmount + claim.paidStateTaxAmount).toFixed(2)}</div>
              </div>
            </div>
          </>
        )}
        
        {!claim.paymentDate && (
          <div className="text-yellow-600">
            ⏳ Payment pending - Check back later
          </div>
        )}
      </div>
    </div>
  );
}
```

## Example 6: React Component - Authorization Request Form

```typescript
import { useState } from 'react';
import { createServicePowerClient } from '@/lib/servicePowerApi';
import type { RFAPart } from '@/types/servicePower';

export function AuthorizationRequestForm({ callNumber }: { callNumber: string }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    additionalManRequired: false,
    estimatedHours: 0,
    estimatedMinutes: 0,
    whyHigherRate: '',
    requestedLabor: 0,
    parts: [] as RFAPart[]
  });
  
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
          requestedLabor: formData.requestedLabor
        },
        parts: formData.parts
      });
      
      if (response.responseCode === 'OK') {
        setSuccess(true);
      } else {
        setError(response.messages?.map(m => m.message).join(', ') || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };
  
  if (success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h3 className="text-green-800 font-semibold">✅ Authorization Request Submitted</h3>
        <p className="text-green-700 mt-2">
          Your request has been submitted for review. Check the status in a few minutes.
        </p>
      </div>
    );
  }
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.additionalManRequired}
            onChange={(e) => setFormData({ ...formData, additionalManRequired: e.target.checked })}
          />
          <span>Additional Technician Required</span>
        </label>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Hours</label>
          <input
            type="number"
            min="0"
            value={formData.estimatedHours}
            onChange={(e) => setFormData({ ...formData, estimatedHours: parseInt(e.target.value) })}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Minutes</label>
          <input
            type="number"
            min="0"
            max="59"
            value={formData.estimatedMinutes}
            onChange={(e) => setFormData({ ...formData, estimatedMinutes: parseInt(e.target.value) })}
            className="w-full border rounded px-3 py-2"
          />
        </div>
      </div>
      
      <div>
        <label className="block text-sm font-medium mb-1">
          Reason for Additional Authorization *
        </label>
        <textarea
          required
          value={formData.whyHigherRate}
          onChange={(e) => setFormData({ ...formData, whyHigherRate: e.target.value })}
          className="w-full border rounded px-3 py-2"
          rows={4}
          placeholder="Explain why additional authorization is needed..."
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium mb-1">Requested Labor Amount</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={formData.requestedLabor}
          onChange={(e) => setFormData({ ...formData, requestedLabor: parseFloat(e.target.value) })}
          className="w-full border rounded px-3 py-2"
        />
      </div>
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700">
          {error}
        </div>
      )}
      
      <button
        type="submit"
        disabled={loading}
        className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Submit Request'}
      </button>
    </form>
  );
}
```

## Example 7: Background Job - Auto-check RFA Status

```typescript
// This could be run as a background job or cron task

import { createServicePowerClient, isRFAFinal } from '@/lib/servicePowerApi';
import { db } from '@/lib/firebase'; // Your database
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';

async function checkPendingAuthorizations() {
  console.log('[Job] Checking pending authorizations...');
  
  // Get all pending RFAs from your database
  const pendingRFAs = await getDocs(
    query(
      collection(db, 'authorizations'),
      where('status', '==', 'pending')
    )
  );
  
  const client = createServicePowerClient();
  
  for (const rfaDoc of pendingRFAs.docs) {
    const rfa = rfaDoc.data();
    const callNumber = rfa.callNumber;
    
    try {
      const response = await client.retrieveRFA({ callNumber });
      
      if (response.requests && response.requests.length > 0) {
        const request = response.requests[0];
        const statusCode = request.coreInfo?.rfaStatusCode;
        
        if (isRFAFinal(statusCode)) {
          // Update your database
          await updateDoc(doc(db, 'authorizations', rfaDoc.id), {
            status: statusCode === 'APV' ? 'approved' : 'rejected',
            statusCode: statusCode,
            authorizedAmount: request.amounts?.authorizedTotal,
            notes: request.approvalRejectInfo?.approvedOrAdditionalInformationRequestNotes,
            updatedAt: new Date()
          });
          
          console.log(`[Job] Updated authorization ${callNumber}: ${statusCode}`);
          
          // Send notification to technician
          // sendNotification(rfa.technicianId, `Authorization ${statusCode === 'APV' ? 'approved' : 'rejected'}`);
        }
      }
    } catch (error) {
      console.error(`[Job] Error checking RFA ${callNumber}:`, error);
    }
  }
  
  console.log('[Job] Finished checking authorizations');
}

// Run every 5 minutes
setInterval(checkPendingAuthorizations, 5 * 60 * 1000);
```

## Testing

Use the staging environment first:

```typescript
// In your .env.development
VITE_SERVICEPOWER_ENV=staging
VITE_SERVICEPOWER_REGION=na
```

Sample test data URLs are provided in the documentation for testing requests and responses.
