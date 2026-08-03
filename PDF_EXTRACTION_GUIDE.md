# 📄 ServicePower PDF Documentation - What We Need

## 🎯 Critical Information Checklist

Copy and paste these specific sections from your ServicePower PDF:

---

## ✅ 1. Authentication Section

**Look for pages titled:**
- "Authentication"
- "Getting Started"  
- "API Credentials"
- "Security"
- "Authorization"

**What to copy:**
```
Copy the entire section that explains:
- What credentials are required
- The format of the User ID (is it email, servicer number, etc?)
- Character limits or restrictions
- Example authentication request
```

**Specific questions:**
- What is the **exact format** for the User ID field?
- Is there a **character limit** on User ID?
- Do you have a **servicer number** or **servicer code** separate from email?

---

## ✅ 2. Work Order / Call List API

**Look for sections like:**
- "Work Orders"
- "Calls"
- "Search Calls"
- "List Work Orders"
- "Query Work Orders"
- "Call Search Service"
- "Order Management"

**What to copy:**
```
1. The endpoint URL (example: /services/call/v1/search)
2. The complete request example
3. The complete response example
4. List of all available query parameters
```

**Specific questions:**
- What's the **base URL and endpoint** for listing work orders?
- Can you query by **date range**? If yes, what's the format?
- Can you filter by **status**?
- Can you filter by **location** or **zip code**?
- Is there **pagination**? How does it work?
- What's the **date format**? (YYYYMMDD? YYYY-MM-DD? ISO?)

---

## ✅ 3. Work Order Object Structure

**Look for:**
- "Work Order Response"
- "Call Object"
- "Work Order Fields"
- "Data Model"

**What to copy:**
```
The complete JSON structure of a work order response, including:
- All field names
- Field descriptions
- Example values
```

**We need to map these fields:**
| ServicePower Field | Our App Field | Example |
|-------------------|---------------|---------|
| ??? | Work Order # | SA-3869517 |
| ??? | Status | Accepted |
| ??? | Customer First Name | Karen |
| ??? | Customer Last Name | Roberts |
| ??? | City | Pigeon Forge |
| ??? | Zip | 37863 |
| ??? | Description | FRIDGE DISP WATER... |
| ??? | Time Duration | 08:00 - 12:00 |
| ??? | Source | SQUARE TRADE |

---

## ✅ 4. Quick Start Example

**Look for:**
- "Quick Start Guide"
- "Getting Started"
- "Sample Request"
- "Example Usage"

**What to copy:**
```
Any complete, working example that shows:
1. A real authentication request
2. A real work order query request
3. A sample response
```

---

## 🔍 Alternative: If PDF is Too Large

If you can't extract text easily, just answer these questions by looking at the documentation:

### Question 1: User ID Format
```
Current: admin@usinhomeservices.com (27 characters - TOO LONG!)
Error: "byte data exceeds size of data type definition (17,10)"

What should we use instead?
[ ] Servicer Number: _____________
[ ] Short Username: _____________
[ ] Customer Code: _____________
[ ] Other: _____________
```

### Question 2: Work Order Endpoint
```
Is it one of these common patterns?
[ ] /services/workorder/v1/search
[ ] /services/call/v1/search
[ ] /services/order/v1/retrieval
[ ] Other: _____________
```

### Question 3: Query Parameters
```
Can you query by:
[ ] Date range? Yes/No - Format: __________
[ ] Status? Yes/No - Values: __________
[ ] Servicer ID? Yes/No
[ ] Location/Zip? Yes/No
```

### Question 4: Example Work Order Response
```
Just paste ONE example work order from the documentation
(even a partial one with just a few fields is helpful)
```

---

## 💡 Tips for Finding Information Quickly

1. **Use PDF search** (Ctrl+F / Cmd+F):
   - Search for: "work order", "call", "search", "list", "query"
   - Search for: "authentication", "userId", "credentials"
   - Search for: "example", "sample", "request"

2. **Check the Table of Contents**:
   - Look for section numbers for Work Orders
   - Look for section numbers for Authentication
   - Tell me: "Section 3.2 covers authentication, Section 5.1 covers work orders"

3. **Look for API Reference sections**:
   - Usually near the end of the document
   - Often has tables with endpoint URLs and parameters

4. **Check for appendices**:
   - Often contain complete field lists
   - May have JSON schema definitions

---

## 📋 What to Send Back

You can either:

**Option A**: Copy the relevant sections
```
=== AUTHENTICATION ===
[paste the authentication section here]

=== WORK ORDER API ===
[paste the work order API section here]

=== EXAMPLE RESPONSE ===
[paste an example JSON response here]
```

**Option B**: Answer the specific questions above

**Option C**: Upload screenshots of the key pages

---

## ⚡ Once We Have This Information

I will:
1. ✅ Fix the User ID format issue
2. ✅ Add proper work order list query endpoint
3. ✅ Map ServicePower fields to your app's ticket structure
4. ✅ Enable real-time sync from ServicePower to your ticket list
5. ✅ Remove dependency on manual claim number entry

---

## 🚀 Current Status

**What's Working:**
- ✅ Server-side API proxy set up
- ✅ Environment configuration ready
- ✅ Claim retrieval by specific claim number works (when User ID is correct)

**What's Blocked:**
- ❌ User ID too long (need correct format)
- ❌ Can't query work order list (need endpoint details)
- ❌ Can't auto-sync tickets (need query capability)
