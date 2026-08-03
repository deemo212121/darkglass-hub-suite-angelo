# ServicePower API Integration Guide

## Overview

This guide covers the integration of ServicePower's ServiceClaims APIs into the Darkglass Hub Suite application. ServicePower provides three main API endpoints:

1. **Claims Retrieval API** - Query existing claims status
2. **Create Request for Authorization API** - Submit authorization requests
3. **Retrieve Request for Authorization API** - Check authorization status

## Prerequisites

- ServicePower account credentials (userId and password)
- Manufacturer name or servicer number
- HTTPS-only connections required

## Environment Setup

Add these variables to your `.env` file:

```env
# ServicePower API Configuration
SERVICEPOWER_ENV=production  # or 'staging' for testing
SERVICEPOWER_USER_ID=your_user_id
SERVICEPOWER_PASSWORD=your_password
SERVICEPOWER_MANUFACTURER_NAME=your_manufacturer_name
SERVICEPOWER_REGION=na  # 'na' for North America or 'eu' for Europe
```

## API Endpoints

### Production URLs

**North America:**
- Claims Retrieval: `https://claimworks.servicepower.com:8443/services/claim/v1/retrieval`
- Create RFA: `https://claimworks.servicepower.com:8443/services/rfa/v2/setdetailssvc`
- Retrieve RFA: `https://claimworks.servicepower.com:8443/services/rfa/v2/getdetails`

**Europe:**
- Claims Retrieval: `https://claims-eu.servicepower.com/services/claim/v1/retrieval`
- Create RFA: `https://claims-eu.servicepower.com/services/rfa/v2/setdetailssvc`
- Retrieve RFA: `https://claims-eu.servicepower.com/services/rfa/v2/getdetails`

### Staging URLs

**North America:**
- Claims Retrieval: `https://upgdev.servicepower.com:8443/services/claim/v1/retrieval`
- Create RFA: `https://upgdev.servicepower.com:8443/services/rfa/v2/setdetailssvc`
- Retrieve RFA: `https://upgdev.servicepower.com:8443/services/rfa/v2/getdetails`

**Europe:**
- Claims Retrieval: `https://claimsqa-eu.servicepower.com/services/claim/v1/retrieval`
- Create RFA: `https://claimsqa-eu.servicepower.com/services/rfa/v2/setdetailssvc`
- Retrieve RFA: `https://claimsqa-eu.servicepower.com/services/rfa/v2/getdetails`

## Authentication

All API calls require an authentication object:

```json
{
  "authentication": {
    "userId": "YOUR_USER_ID",
    "password": "YOUR_PASSWORD"
  }
}
```

## Use Cases

### 1. Claims Retrieval

Retrieve status and payment information for submitted claims.

**When to use:**
- Check if a claim has been paid
- Get payment amounts by category (labor, parts, etc.)
- Track claim status through the approval process

### 2. Create Request for Authorization (RFA)

Submit a request when additional compensation is needed beyond the pre-agreed amount.

**When to use:**
- Job requires more time than originally estimated
- Additional parts needed not covered in original agreement
- Multiple technicians required for safety
- Job is in difficult/remote location
- Work scope differs from original description

### 3. Retrieve Request for Authorization

Check the status of previously submitted authorization requests.

**When to use:**
- Poll for approval/rejection decisions
- Get authorized amounts after approval
- Retrieve notes from manufacturer reviewer

## Response Codes

- `OK` - Request successful
- `ER` - Error occurred, check messages array

## Error Handling

All APIs return a messages array when errors occur:

```json
{
  "responseCode": "ER",
  "messages": [
    {
      "message": "Error description here"
    }
  ]
}
```

## Integration Architecture

```
Your Application
    ↓
API Service Layer (src/lib/servicePowerApi.ts)
    ↓
ServicePower REST APIs (HTTPS/JSON)
    ↓
ServiceClaims Platform
```

## Best Practices

1. **Use staging environment first** - Test all integrations before production
2. **Schedule frequent polling** - RFA status can change throughout the day
3. **Store transaction IDs** - Include in error reports to ServicePower
4. **Secure credentials** - Never commit credentials to source control
5. **Handle timeouts gracefully** - Network issues can occur
6. **Validate data before sending** - Check required fields and formats
7. **Log all API interactions** - Helps with debugging and auditing

## Common Workflows

### Workflow 1: Submit and Track Authorization Request

1. Technician determines additional work/parts needed
2. Call **Create RFA API** with details
3. Schedule polling job to call **Retrieve RFA API**
4. Check `rfaStatusCode` field:
   - `OPN` - Open (pending review)
   - `APV` - Approved
   - `REJ` - Rejected
   - `WAI` - Waiting for information
   - `CLS` - Closed
5. If approved, proceed with authorized work
6. Submit claim after job completion

### Workflow 2: Verify Claim Payment

1. Submit claim through claims submission API
2. Periodically call **Claims Retrieval API**
3. Check `claimStatusCode` to track progress
4. Once `paymentDate` is populated, claim is paid
5. Reconcile `paymentAmount` with expected amount

## Data Type Specifications

- **A** - Alphanumeric text
- **N** - Numeric values
- Numeric types show max length and decimal places
- Example: N 7,2 = up to 5 digits before decimal, 2 after (max 99999.99)

## Date Format

- Short dates: `CCYYMMDD` (e.g., 20240615)
- Timestamps: `CCYYMMDDHHMMSS` (e.g., 20240615143022)
- Full timestamps: `YYYYMMDDHHMMSS` with seconds

## Next Steps

1. Review the type definitions in `src/types/servicePower.ts`
2. Examine the API service implementation in `src/lib/servicePowerApi.ts`
3. Test with staging environment using sample data
4. Integrate into your existing ticket/claim workflows
5. Deploy to production after thorough testing

## Support

When reporting issues to ServicePower:
- Include the `transactionId` from API responses
- Provide full request/response payloads (sanitize credentials)
- Note the environment (staging/production) and region
- Include timestamp of the issue
