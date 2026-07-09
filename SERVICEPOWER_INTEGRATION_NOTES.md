# ServicePower Integration Notes

## Current Status

### ✅ What's Working
- API endpoint configured at `/api/servicepower`
- Authentication credentials configured in `.env`
- TanStack Start server route properly set up
- Test connection component available at `/servicepower-test`

### ❌ Current Issues

#### 1. Database Field Size Error
**Error**: `DataTypeText: byte data exceeds size of data type definition (17,10) (field: SA_USRID)`

**Cause**: The ServicePower `SA_USRID` field has a maximum length limit, and our user ID `admin@usinhomeservices.com` (27 characters) exceeds it.

**Solution Options**:
1. Use a shorter user ID format (if ServicePower provides one)
2. Contact ServicePower to get the correct user ID format for API access
3. The field definition `(17,10)` suggests max 17 characters total with 10 decimal places - this seems like it might be expecting a numeric ID, not an email

#### 2. Missing Work Order Query Documentation
We need to understand:
- What's the endpoint to query work orders/calls?
- Can we query by date range?
- What parameters are available for filtering?
- What does the response structure look like?

## ServicePower API Endpoints (Currently Known)

### Environment: Staging (NA)
- **Claims Retrieval**: `https://upgdev.servicepower.com:8443/services/claim/v1/retrieval`
- **Create RFA**: `https://upgdev.servicepower.com:8443/services/rfa/v2/setdetailssvc`
- **Retrieve RFA**: `https://upgdev.servicepower.com:8443/services/rfa/v2/getdetails`

### Environment: Production (NA)
- **Claims Retrieval**: `https://claimworks.servicepower.com:8443/services/claim/v1/retrieval`
- **Create RFA**: `https://claimworks.servicepower.com:8443/services/rfa/v2/setdetailssvc`
- **Retrieve RFA**: `https://claimworks.servicepower.com:8443/services/rfa/v2/getdetails`

## Known Data From Work Order List

From the screenshot provided, ServicePower work orders have:
- **Work Order #** (e.g., `SA-3869517`, `26000835554`)
- **Status** (e.g., `HS`, `Accepted`, `DF`)
- **Network Job Status** 
- **Work Order Type** (e.g., `Repair`)
- **Customer First Name**
- **Customer Last Name**
- **Source** (e.g., `GE`, `ASSURANT SOLUTIONS`, `SQUARE TRADE`)
- **Description** (Full issue description)
- **Priority**
- **Time Duration** (e.g., `08:00 - 17:00`, `08:00 - 12:00`)
- **Office Name** (e.g., `DEFAULT LOCATION`)
- **City**
- **Zip**

## What We Need From PDF Documentation

### Critical Information Needed:

1. **Authentication**
   - What's the correct format for user ID? Is it:
     - Email address?
     - Numeric servicer ID?
     - Some other identifier?
   - Is there a character limit?

2. **Work Order / Call List API**
   - Endpoint URL for listing work orders
   - Request structure:
     ```json
     {
       "authentication": { "userId": "?", "password": "?" },
       // What goes here?
       "dateFrom": "?",
       "dateTo": "?",
       "status": "?",
       // Other filters?
     }
     ```
   - Response structure - sample JSON

3. **Query Capabilities**
   - Can we query by date range?
   - Can we query by status?
   - Can we query by location/zip?
   - Are there pagination parameters?

4. **Work Order Detail API**
   - How to get full details for a specific work order?
   - What additional fields are available beyond the list view?

## Temporary Workaround

Until we get the proper documentation, we can:
1. Continue using claim number queries (which work but require specific IDs)
2. Display dummy data in the work order list
3. Try common ServicePower API patterns based on industry standards

## Next Steps

1. **Review PDF documentation** for:
   - Section on authentication/credentials
   - Section on work order queries
   - API reference for call/work order endpoints

2. **Test with corrected user ID** format

3. **Implement work order list sync** once we have the endpoint details

---

## Notes for PDF Review

Please extract or provide:
- **Page numbers** covering authentication
- **Page numbers** covering work order/call APIs
- **Any example requests/responses** for work orders
- **Base URL** if different from what we have
- **Any servicer-specific identifiers** we should use instead of email
