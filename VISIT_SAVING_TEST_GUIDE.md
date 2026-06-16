# 🧪 Visit Saving - Testing Guide

## Quick Test Procedure

### Step 1: Hard Refresh Browser
**You must do this first to load the updated JavaScript code!**

Choose ONE method:
- **Method A**: Press `Ctrl + Shift + R`
- **Method B**: Press `Ctrl + F5`
- **Method C**: Open DevTools (F12) → Right-click the refresh button → "Empty Cache and Hard Reload"

---

### Step 2: Open Browser Console
1. Press `F12` to open DevTools
2. Click on the **Console** tab
3. Keep this open during testing to see logs

---

### Step 3: Navigate to a Ticket
Go to one of these test tickets:
- `http://localhost:8080/ticket/017151274136`
- `http://localhost:8080/ticket/026000671769DF1`
- `http://localhost:8080/ticket/SA-3458831`

---

### Step 4: Add a New Visit

1. Click on the **"Visit History"** tab (or similar section)
2. Fill out the visit form with test data:
   - **Schedule Date**: 06/17/2026
   - **Technician**: Select any technician
   - **Time Slot**: 08:00 - 12:00
   - **Activity**: Service Call
   - **Action Type**: SCHEDULE
   - **Status**: Visited
   - **Note**: "Test visit - checking save functionality"

3. Click **"Add Visit"** or **"Save"** button

---

### Step 5: Check Console Logs

You should see these logs in the console (in order):

```
✅ Updated visits for ticket 017151274136: [array with visits]
✅ Saving X tickets to localStorage (Y total tickets)
✅ Tickets saved successfully to ahs:tickets:data
```

**If you see these logs**: The save is working! Continue to Step 6.

**If you don't see these logs**: Check for red error messages in console.

---

### Step 6: Verify Visit Displays

After saving:
1. The visit should appear in the **Visit History** section
2. You should see:
   - Visit number (e.g., "V1")
   - Schedule date
   - Technician name
   - Status
   - Your note

---

### Step 7: Test Persistence

1. **Reload the page** (press F5 or refresh button)
2. Go to the **Visit History** tab again
3. **Check if your visit is still there**

**Expected Result**: ✅ Visit should persist after reload

**If visit disappeared**: See troubleshooting below

---

### Step 8: Check LocalStorage

1. In DevTools, go to **Application** tab
2. In the left sidebar, expand **Local Storage**
3. Click on `http://localhost:8080`
4. Look for the key: **`ahs:tickets:data`**

You should see:
- A JSON array with tickets
- Your test ticket should be in the array
- The `visits` property should contain your visit data

**Example**:
```json
[
  {
    "ticketNo": "017151274136",
    "visits": [
      {
        "id": "abc123...",
        "visitNo": "V1",
        "timestamp": "2026-06-16T...",
        "by": "your-email@example.com",
        "scheduleDate": "06/17/2026",
        "technician": "Nathan Napora",
        "note": "Test visit - checking save functionality",
        ...
      }
    ],
    ...
  }
]
```

---

## ✅ Success Indicators

Your visit saving is working if:
- [x] Console shows "Updated visits" log
- [x] Console shows "Tickets saved successfully" log
- [x] Visit appears in Visit History immediately after save
- [x] Visit persists after page reload
- [x] localStorage contains the visit data

---

## ❌ Troubleshooting

### Problem: No console logs appear

**Possible Causes**:
1. Browser wasn't hard-refreshed (old JavaScript still cached)
2. JavaScript error preventing code from running
3. Form validation preventing submission

**Solutions**:
1. Do another hard refresh (`Ctrl+Shift+R`)
2. Check console for red error messages
3. Make sure all required fields are filled

---

### Problem: Console shows error messages

**Common Errors & Solutions**:

**Error**: `Cannot read property 'visits' of undefined`
- **Cause**: Ticket not found in centralized storage
- **Solution**: Code should auto-create ticket now. Check if `updateTicketVisits()` was called.

**Error**: `localStorage is not defined`
- **Cause**: SSR issue (server-side rendering)
- **Solution**: This should be guarded. Check browser vs server rendering.

**Error**: `JSON.parse error`
- **Cause**: Corrupted localStorage data
- **Solution**: Clear localStorage and try again:
  ```javascript
  localStorage.removeItem('ahs:tickets:data')
  ```

---

### Problem: Visit appears but disappears after reload

**Possible Causes**:
1. localStorage not being saved correctly
2. `visitsLoaded` flag causing overwrite
3. Merge logic not working correctly

**Solutions**:
1. Check if `saveCustomTickets()` is being called
2. Check console for "Saving X tickets" log
3. Check localStorage for the data
4. Look for any errors during load

**Debug Code** (run in console):
```javascript
// Check what's in localStorage
const stored = localStorage.getItem('ahs:tickets:data');
console.log('Stored tickets:', JSON.parse(stored));

// Check centralized ticket system
import { getTicketByNumber } from '@/lib/ticketData';
const ticket = getTicketByNumber('017151274136');
console.log('Loaded ticket:', ticket);
```

---

### Problem: Console shows "Saving 0 tickets"

**Cause**: Filter logic in `saveCustomTickets()` not detecting modified tickets

**Solution**: 
1. Check if ticket has `statusChangedAt` or `statusChangedBy` fields
2. The upsert logic should add these automatically
3. Check if `updateTicketVisits()` is setting `statusChangedAt`

---

### Problem: Multiple visits duplicated

**Cause**: React state management causing multiple saves

**Solution**:
1. Check if `visitsLoaded` flag is set correctly
2. The useEffect should only save after initial load
3. Check for duplicate event handlers

---

## 🔍 Advanced Debugging

### Check Ticket Load Flow

Open console and paste:

```javascript
// Enable verbose logging
localStorage.setItem('debug:tickets', 'true');

// Then reload page and check console
```

### Manually Test Functions

```javascript
// Test getting ticket
const ticket = getTicketByNumber('017151274136');
console.log('Ticket:', ticket);

// Test getting visits
const visits = getTicketVisits('017151274136');
console.log('Visits:', visits);

// Test manual save
const testVisit = {
  id: 'test-123',
  visitNo: 'V99',
  timestamp: new Date().toISOString(),
  by: 'test@example.com',
  scheduleDate: '06/17/2026',
  technician: 'Test Tech',
  timeSlot: '08:00 - 12:00',
  activity: 'Test',
  actionType: 'SCHEDULE',
  repairStatus: 'Test',
  repairType: '',
  schedNotes: '',
  reclaim: '',
  visited: 'Visited',
  notCompleted: 'No',
  symptomCx: '',
  diagnosis: '',
  symptomTech: '',
  resolution: '',
  nonCompletionReason: '',
  triageNote: '',
  status: 'Visited',
  note: 'Manual test'
};

updateTicketVisits('017151274136', [testVisit]);
console.log('Manual save complete - check localStorage');
```

---

## 📊 Expected Test Results

### Test Case 1: First Visit
- **Action**: Add first visit to ticket `017151274136`
- **Expected**: Visit number V1, saves successfully, persists

### Test Case 2: Second Visit
- **Action**: Add another visit to same ticket
- **Expected**: Visit number V2, both visits display, both persist

### Test Case 3: Different Ticket
- **Action**: Add visit to ticket `026000671769DF1`
- **Expected**: Visit number V1 for this ticket, independent of other ticket

### Test Case 4: Cross-Tab Sync
- **Action**: Open same ticket in two tabs, add visit in one tab
- **Expected**: Both tabs update (due to storage event listener)

### Test Case 5: Reload Persistence
- **Action**: Add 3 visits, reload page 3 times
- **Expected**: All 3 visits persist through all reloads

---

## 🎯 Final Validation

After completing all tests, verify:

1. ✅ **Visit form submits** without errors
2. ✅ **Console logs** show successful save
3. ✅ **Visit displays** in UI immediately
4. ✅ **Visit persists** after reload
5. ✅ **localStorage** contains visit data
6. ✅ **Multiple visits** can be added
7. ✅ **Different tickets** store visits independently

---

## 📝 Report Results

After testing, report:

**✅ WORKING**: "Visit saving works! Added X visits to ticket Y, all persisted after reload."

**❌ NOT WORKING**: "Visit saving not working. Error: [paste error message]. Console logs: [paste relevant logs]."

**⚠️ PARTIAL**: "Visit saves but [specific issue]. Console logs: [paste logs]."

---

## 🆘 Need Help?

If tests fail, provide:
1. **Browser Console Screenshot** (with any errors)
2. **localStorage Contents** (for key `ahs:tickets:data`)
3. **Steps You Followed** (what worked, what didn't)
4. **Browser & Version** (Chrome 120, Firefox 121, etc.)

---

**Good luck with testing!** 🚀

