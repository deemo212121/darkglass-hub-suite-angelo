# 🎉 ServicePower SOAP API Discovery

## What We Found

The ServicePower API you're using is a **SOAP/XML web service**, NOT a REST/JSON API like your current code expects!

### SOAP Endpoint (Staging)
```
https://fssstag.servicepower.com/sms/services/SPDService
```

### Authentication Structure
```xml
<UserInfo>
  <UserID>GSL00002</UserID>
  <Password>Frontier38*</Password>
  <SvcrAcct>GSL00002</SvcrAcct>  <!-- Servicer Account -->
</UserInfo>
```

## 📋 Key API Operations

### 1. **getCallInfo** - List Work Orders/Calls
**Request Parameters:**
- `UserInfo` (authentication)
- `FromDateTime` (optional) - Date range start
- `ToDateTime` (optional) - Date range end
- `Callno` (optional) - Specific call number
- `Versionno` (optional)

**Response Fields:**
- `numberOfCalls` - Total count
- `CallInfo[]` - Array of calls with:
  - `CallNumber` - Work order number
  - `CallStatus` / `SPCallStatusID` - Status
  - `ScheduleDate` / `ScheduleTimePeriod` - Appointment time
  - `ConsumerInfo`:
    - `ConsumerFirstName`
    - `ConsumerLastName`
    - `ConsumerAddress1`, `ConsumerAddress2`
    - `Postcode`, `PostcodeLevel1/2/3`
    - `Phone1`, `Phone2`, `CellPhone`
  - `ProductInfo`:
    - `SPBrandDesc` - Brand
    - `SPProductDesc` - Product type
    - `ModelNo`, `SerialNo`
    - `ServiceContractNumber`
  - `ProblemDesc` - Issue description
  - `ServiceLocation` - Location type
  - `WarrantyType`
  - `TechKey` - Assigned technician
  - `GroupKey` - Group assignment

### 2. **updateCallInfo** - Update Work Order Status
Update call status, add notes, parts, schedule changes, etc.

### 3. **getCallNotes** - Get Call Notes/History
Retrieve all notes for a specific call.

### 4. **getCallAttributes** - Get Additional Call Details
Retrieve custom attributes for a call.

## 🔧 Why Current Code Fails

Your current implementation at `/api/servicepower` calls **REST/JSON endpoints** like:
```
https://upgdev.servicepower.com:8443/services/claim/v1/retrieval
```

But the actual API you need to use is **SOAP/XML** at:
```
https://fssstag.servicepower.com/sms/services/SPDService
```

These are **completely different APIs!**

## ✅ Solution Options

### Option 1: Use SOAP API Directly (Recommended)
Implement SOAP/XML requests to the correct endpoint. This requires:
1. Building SOAP XML envelopes
2. Parsing XML responses
3. Converting to your ticket format

### Option 2: Check if REST API Exists
The REST endpoints you're using might be for a different ServicePower product (Claims API vs Dispatch API). You may need to:
1. Contact ServicePower support
2. Get access to the REST version of the Dispatch API
3. Or use the correct REST endpoint if it exists

## 🎯 Next Steps

I can implement the SOAP API integration for you. This will:
1. ✅ Fix authentication (use proper SOAP UserInfo structure)
2. ✅ Query calls by date range using `getCallInfo`
3. ✅ Map all the call fields to your ticket structure
4. ✅ Enable real-time sync from ServicePower

**Do you want me to implement the SOAP API integration now?**

This will replace the current REST/JSON approach with proper SOAP/XML calls.

---

## 📊 Field Mapping Reference

| ServicePower Field | Your App Field | Notes |
|-------------------|----------------|-------|
| `CallNumber` | `ticketNo` | Work order # |
| `CallStatus` | `status` | Status text |
| `SPCallStatusID` | - | Status code |
| `ConsumerFirstName` | `firstName` | Customer first name |
| `ConsumerLastName` | `lastName` | Customer last name |
| `ConsumerAddress1` | `address` | Street address |
| `Postcode` | `zip` | Zip code |
| `PostcodeLevel2` | `city` | City |
| `Phone1` | `phone` | Primary phone |
| `SPBrandDesc` | `warranty` | Brand |
| `SPProductDesc` | `type` | Product type |
| `ModelNo` | `model` | Model number |
| `SerialNo` | `serial` | Serial number |
| `ProblemDesc` | `internalNote` / `diagnosed` | Issue description |
| `ScheduleDate` | `schedule` | Appointment date |
| `ScheduleTimePeriod` | `customerPref` | Time window |
| `WarrantyType` | - | Warranty type |
| `ServiceLocation` | `location` | Service location |
| `TechKey` | `technician` | Tech assignment |

---

## 🔑 Authentication Note

The WSDL shows authentication uses a `UserInfo` structure with:
- **UserID**: Your servicer ID (GSL00002)
- **Password**: Your password
- **SvcrAcct**: Servicer account (may be same as UserID)

This is why `SA_USRID` errors occurred - you were sending authentication to the wrong API type!
