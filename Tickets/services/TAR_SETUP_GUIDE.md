# Setup Guide: TAR Real Data Configuration

## Current State
The TAR module is currently using **dummy data** from `tar_dummy_data.js` for development and testing.

## How to Enable Real Data

When your backend API is ready and implements the endpoints defined in [TAR_API_CONTRACT.md](TAR_API_CONTRACT.md), follow these steps:

### Step 1: Update API Configuration
Open browser console (F12) and run:
```javascript
// Set your API base URL
tarDataService.setAPIBaseURL('http://localhost:3000/api/tar');
// or production URL
tarDataService.setAPIBaseURL('https://api.yourdomain.com/api/tar');
```

### Step 2: Enable Real API
```javascript
tarDataService.setUseRealAPI(true);
```

### Step 3: Test Connection
```javascript
// Check if API is healthy
const isHealthy = await tarDataService.checkAPIHealth();
console.log('API Health:', isHealthy);

// Get location data
const birminghamData = await tarDataService.getLocationData('Birmingham');
console.log('Birmingham Data:', birminghamData);
```

### Step 4: Verify in UI
- Select different locations from the dropdown
- Confirm data loads from API instead of dummy data
- Check browser Network tab to see API calls

### Step 5: Persistent Configuration (Optional)
To make this automatic on page load, add to a configuration file or backend:

```javascript
// In config.js or initialization script
document.addEventListener('DOMContentLoaded', () => {
  // Get API URL from backend or environment
  const apiURL = fetch('/api/config').then(r => r.json()).then(c => c.tarApiUrl);
  
  tarDataService.setAPIBaseURL(apiURL);
  tarDataService.setUseRealAPI(true);
});
```

---

## Switching Back to Dummy Data
If you need to debug or work offline:
```javascript
tarDataService.setUseRealAPI(false);
```

---

## File Structure

```
Modules/Tickets/
├── report_tar.html ........................ Main TAR interface
├── dummy_data/
│   └── tar_dummy_data.js ..................Dummy data for development
├── services/
│   ├── tar_data_service.js ............... Data service layer (handles real/dummy switching)
│   ├── TAR_API_CONTRACT.md ............... API specifications for backend
│   └── TAR_SETUP_GUIDE.md ................ This file
```

---

## Data Flow Diagram

```
Flow: Dummy Data (Development)
────────────────────────────
report_tar.html
  └─> onchange location select
       └─> generateReport()
            └─> loadLocationData() [ASYNC]
                 └─> tarDataService.getLocationData()
                      └─> USE_REAL_API = false
                           └─> tarDummyData.locations[location]

Flow: Real API Data (Production)
────────────────────────────────
report_tar.html
  └─> onchange location select
       └─> generateReport()
            └─> loadLocationData() [ASYNC]
                 └─> tarDataService.getLocationData()
                      └─> USE_REAL_API = true
                           └─> fetch('/api/tar/locations/{location}')
                                └─> Backend Database
```

---

## Architecture Benefits

✅ **Zero UI Changes:** Same interface works with dummy or real data  
✅ **Automatic Fallback:** If API fails, falls back to dummy data  
✅ **Easy Switching:** Single function call to enable/disable real API  
✅ **No Rebuild:** No code compilation needed to switch data sources  
✅ **Development Ready:** Dummy data included for offline development  
✅ **API Contract:** Backend team knows exactly what to implement  

---

## Backend Implementation Timeline

1. **Phase 1:** Start with dummy data (current state) ✅
2. **Phase 2:** Backend team builds `/api/tar/locations/{location}` endpoint
3. **Phase 3:** Test API endpoint in development
4. **Phase 4:** Enable in UI: `tarDataService.setUseRealAPI(true)`
5. **Phase 5:** Deploy to production with real API

---

## Troubleshooting

### API Not Responding?
```javascript
// Check configuration
console.log('API URL:', tarDataService.API_BASE_URL);
console.log('Real API Enabled:', tarDataService.USE_REAL_API);

// Test health
await tarDataService.checkAPIHealth();

// Check browser Network tab for failed requests
```

### Data Not Updating?
```javascript
// Clear browser cache and reload
// Or manually reload data:
await generateReport();
```

### Mix Real and Dummy Data?
```javascript
// Data service automatically picks one or the other
// Not recommended to mix - choose one approach
```

---

## Performance Tips

1. **API Response Caching** (optional in service)
```javascript
// Add to tar_data_service.js if needed
const cache = {};
if (cache[location]) return cache[location];
const data = await fetch(...);
cache[location] = data;
return data;
```

2. **Batch Location Loading**
```javascript
// Load all locations at startup if needed
const locations = ['Birmingham', 'Asheville', 'Atlanta', 'Dallas', 'Memphis', 'Tallahassee'];
const allData = await Promise.all(locations.map(loc => tarDataService.getLocationData(loc)));
```

3. **Optimize API Queries**
- Use database indexing on location field
- Consider pagination for large datasets
- Add date range filtering to API if performance is an issue

---

## API Testing Checklist

- [ ] Endpoint `/api/tar/locations/{location}` returns correct data structure
- [ ] All required fields present (location, startDate, endDate, etc.)
- [ ] activityByDate contains data for all days in range
- [ ] dailyData array has 10 records minimum
- [ ] techData array has technician data
- [ ] completedTickets array has work order data
- [ ] HTTP 404 returned for non-existent locations
- [ ] HTTP 500 on server errors
- [ ] `/api/tar/health` endpoint responds with status 'healthy'
- [ ] Authentication headers work (if implemented)
- [ ] API responds within 5-second timeout

---

## Version Info

- **Service:** tar_data_service.js v1.0
- **API:** TAR_API v1.0
- **Compatibility:** report_tar.html (current)
- **Updated:** 2026-05-19