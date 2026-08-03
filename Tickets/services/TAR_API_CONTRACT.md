# TAR (Tech Activity Report) API Contract

## Overview
This document defines the API contract for the Tech Activity Report (TAR) module. The frontend `tar_data_service.js` expects real API endpoints to follow these specifications for seamless data delivery.

---

## API Configuration

### Base URL
```
http://localhost:3000/api/tar
// Or production URL
https://api.yourdomain.com/api/tar
```

### Enable in Frontend
To enable real API data in `report_tar.html`:
```javascript
// In browser console or during app initialization:
tarDataService.setAPIBaseURL('http://localhost:3000/api/tar');
tarDataService.setUseRealAPI(true);
```

---

## Endpoints

### 1. Get Location Data
**Endpoint:** `GET /api/tar/locations/{locationName}`

**Parameters:**
- `locationName` (path parameter): String - Location name (e.g., 'Birmingham', 'Dallas')

**Response:** `200 OK`
```json
{
  "location": "Birmingham",
  "startDate": "2026-05-06",
  "endDate": "2026-05-19",
  "activityByDate": {
    "6": {
      "ASG": 15,
      "CMP": 8,
      "CAN": 1,
      "RRR": 2,
      "LDT": 0.5
    },
    "7": {
      "ASG": 18,
      "CMP": 10,
      "CAN": 0,
      "RRR": 1,
      "LDT": 0.3
    }
    // ... days 8-19
  },
  "dailyData": [
    {
      "date": "2026-05-06",
      "assigned": 15,
      "completed": 8,
      "cancelled": 1,
      "exchanged": 0,
      "pending": 2,
      "redo": 0,
      "ldt": 0.5,
      "mileage": 145.2
    },
    // ... 9 more daily records (total 10)
  ],
  "techData": [
    {
      "name": "David Sims",
      "assigned": 72,
      "completed": 32,
      "cancelled": 2,
      "exchanged": 0,
      "pending": 38,
      "redo": 2,
      "ldt": 6,
      "mileage": 687.3
    },
    {
      "name": "Zonate Grant",
      "assigned": 68,
      "completed": 29,
      "cancelled": 1,
      "exchanged": 0,
      "pending": 38,
      "redo": 3,
      "ldt": 5,
      "mileage": 623.8
    }
  ],
  "completedTickets": [
    {
      "workOrderNum": "WO-2026-1001",
      "technician": "David Sims",
      "date": "2026-05-06",
      "status": "Completed",
      "mileage": 45.2
    },
    // ... more completed tickets
  ]
}
```

**Error Responses:**
- `404 Not Found` - Location not found
- `500 Internal Server Error` - Server error

---

### 2. Get All Locations
**Endpoint:** `GET /api/tar/locations`

**Response:** `200 OK`
```json
{
  "locations": [
    "Birmingham",
    "Asheville",
    "Atlanta",
    "Dallas",
    "Memphis",
    "Tallahassee"
  ]
}
```

---

### 3. Health Check
**Endpoint:** `GET /api/tar/health`

**Response:** `200 OK`
```json
{
  "status": "healthy",
  "timestamp": "2026-05-19T10:30:00Z"
}
```

---

## Data Field Definitions

### Location Object

#### `location` (string)
- Location name
- Example: `"Birmingham"`

#### `startDate`, `endDate` (ISO 8601 date string)
- Date range for the report
- Format: `YYYY-MM-DD`
- Example: `"2026-05-06"`

#### `activityByDate` (object)
- Keyed by day number (6-31)
- Each day contains activity metrics:
  - **ASG** (integer): Assignments
  - **CMP** (integer): Completed
  - **CAN** (integer): Cancelled
  - **RRR** (integer): Return/Replace/Rebuild
  - **LDT** (decimal): Long Distance Travel hours

#### `dailyData` (array of objects)
- Array of 10 daily summary records
- Each record contains:
  - `date` (ISO 8601): Day of activity
  - `assigned` (integer): Number of assignments
  - `completed` (integer): Number completed
  - `cancelled` (integer): Number cancelled
  - `exchanged` (integer): Number exchanged
  - `pending` (integer): Number pending
  - `redo` (integer): Number requiring redo
  - `ldt` (decimal): Long Distance Travel hours
  - `mileage` (decimal): Miles driven

#### `techData` (array of objects)
- Array of technician summary records (typically 1-2 per location)
- Same fields as `dailyData` plus:
  - `name` (string): Technician name

#### `completedTickets` (array of objects)
- Array of 5-10 completed work orders
- Each record contains:
  - `workOrderNum` (string): Work order number
  - `technician` (string): Technician name
  - `date` (ISO 8601): Completion date
  - `status` (string): Status (e.g., "Completed")
  - `mileage` (decimal): Miles on this work order

---

## Authentication

### Optional Bearer Token
If your API requires authentication, add to the request header:
```
Authorization: Bearer {token}
```

To implement in `tar_data_service.js`, modify the fetch call:
```javascript
headers: {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('authToken')}`
}
```

---

## Error Handling

The data service includes automatic fallback to dummy data if:
- API is unreachable
- Response status is not OK
- Response parsing fails

Console will log warnings like:
```
API failed for Dallas: Network error, falling back to dummy data
```

---

## Implementation Steps

### Backend Team:
1. Create endpoints following the specifications above
2. Query your database for location metrics
3. Return JSON matching the response format
4. Use appropriate HTTP status codes

### Frontend Team:
1. Update API base URL: `tarDataService.setAPIBaseURL('your-api-url')`
2. Enable real API: `tarDataService.setUseRealAPI(true)`
3. Test in browser console: `tarDataService.getLocationData('Birmingham')`
4. Monitor browser console for any errors

---

## Example Backend Implementation (Node.js/Express)

```javascript
app.get('/api/tar/locations/:location', async (req, res) => {
  try {
    const { location } = req.params;
    
    // Query your database
    const data = await TAR_DATABASE.getLocationData(location);
    
    if (!data) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('TAR API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/tar/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});
```

---

## Testing

### Test in Browser Console:
```javascript
// Check if API is healthy
await tarDataService.checkAPIHealth();

// Get location data
const data = await tarDataService.getLocationData('Birmingham');
console.log(data);

// Switch between real API and dummy data
tarDataService.setUseRealAPI(false); // Use dummy data
tarDataService.setUseRealAPI(true);  // Use real API
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-05-19 | Initial API contract definition |

---

## Contact

For API questions or specifications, contact the development team.
