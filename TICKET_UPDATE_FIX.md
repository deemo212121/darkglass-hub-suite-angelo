# Critical Fix: Updating Original Tickets

## Problem
When users edited original/centralized tickets (like `26000679102DF`), the updates were not being saved. Only newly created custom tickets could be updated.

### Root Cause
The `saveCustomTickets()` function was filtering out ALL original tickets, even if they had been modified:

```typescript
// OLD - BAD
const customTickets = tickets.filter(t => !originalTicketNos.has(t.ticketNo));
localStorage.setItem(key, JSON.stringify(customTickets));
```

This meant:
- Update ticket `26000679102DF` (original ticket)
- `saveCustomTickets()` filters it out because it's in original TICKETS array
- Update is lost
- User sees no changes

## Solution

### 1. **Save Modified Original Tickets**
Changed `saveCustomTickets()` to save tickets that are either:
- Custom tickets (not in original array), OR
- Original tickets that have been modified (have `statusChangedAt` or `statusChangedBy`)

```typescript
// NEW - GOOD
const ticketsToSave = tickets.filter(t => {
  // If custom ticket, save it
  if (!originalTicketNos.has(t.ticketNo)) {
    return true;
  }
  
  // If original ticket has been modified, save it
  if (t.statusChangedAt || t.statusChangedBy) {
    return true;
  }
  
  return false;
});
```

### 2. **Merge Modified Tickets on Load**
Changed `loadTickets()` to properly merge modified original tickets:

```typescript
// Create map of saved tickets
const savedTicketsMap = new Map(savedTickets.map(t => [t.ticketNo, t]));

// For each original ticket, use saved version if it exists
const mergedTickets = TICKETS.map(originalTicket => {
  const savedVersion = savedTicketsMap.get(originalTicket.ticketNo);
  if (savedVersion) {
    savedTicketsMap.delete(originalTicket.ticketNo);
    return savedVersion; // Use modified version
  }
  return originalTicket; // Use unmodified original
});

// Add any remaining custom tickets
const customTickets = Array.from(savedTicketsMap.values());
return [...customTickets, ...mergedTickets];
```

## What This Fixes

### Before:
- ❌ Edit original ticket → Changes lost
- ❌ Assign technician to `26000679102DF` → Not saved
- ❌ Change schedule on original ticket → Not saved
- ✅ Edit custom ticket → Saved correctly

### After:
- ✅ Edit original ticket → Changes saved
- ✅ Assign technician to `26000679102DF` → Saved and visible everywhere
- ✅ Change schedule on original ticket → Saved and visible everywhere
- ✅ Edit custom ticket → Still works correctly

## Data Flow

### Editing Original Ticket:
```
User edits ticket 26000679102DF (original ticket)
    ↓
updateTicket() called with technician: "Abraham Im"
    ↓
Ticket updated in memory with statusChangedAt set
    ↓
saveCustomTickets() called
    ↓
Checks: Is this ticket modified? (has statusChangedAt)
    ↓
YES - Save to localStorage
    ↓
Storage event fires
    ↓
All components reload
    ↓
loadTickets() merges saved version with originals
    ↓
All views show "Abraham Im" as technician
```

### Loading Tickets:
```
Component calls loadTickets()
    ↓
Load saved tickets from localStorage
    ↓
For each original ticket:
  - If saved version exists → Use it (modified)
  - If no saved version → Use original (unmodified)
    ↓
Add custom tickets to the front
    ↓
Return merged array
```

## Storage Structure

### Before Fix:
```json
{
  "ahs:tickets:data": [
    // Only custom tickets
    {"ticketNo": "TK-...", ...}
  ]
}
```

### After Fix:
```json
{
  "ahs:tickets:data": [
    // Custom tickets
    {"ticketNo": "TK-...", ...},
    
    // Modified original tickets
    {
      "ticketNo": "26000679102DF",
      "technician": "Abraham Im",
      "schedule": "2026-06-11",
      "statusChangedAt": "2026-06-10T12:30:00.000Z",
      ...
    }
  ]
}
```

## Testing

### Test Case 1: Update Original Ticket
1. Open ticket `26000679102DF`
2. Assign technician "Abraham Im"
3. Save visit
4. Check Ticket List → Should show "Abraham Im"
5. Check Work Planner → Should appear in Abraham's column
6. Check Work Map → Should show at location
7. Refresh page → Changes should persist

### Test Case 2: Update Custom Ticket
1. Create new ticket
2. Assign technician
3. Save
4. Should work as before (no regression)

### Test Case 3: Multiple Edits
1. Edit ticket multiple times
2. Each edit should update the saved version
3. Only latest version should be in localStorage
4. No duplicate tickets

## Files Modified

### `src/lib/ticketData.ts`

**saveCustomTickets():**
- Changed filter logic to save modified original tickets
- Uses `statusChangedAt` and `statusChangedBy` as modification indicators

**loadTickets():**
- Changed merge logic to use saved versions over originals
- Creates map for efficient lookup
- Properly deduplicates tickets

## Impact

### Performance:
- Negligible impact (map operations are O(1))
- Slightly more storage used (stores modified originals)
- Faster lookups with Map instead of repeated filters

### Data:
- Modified original tickets now saved to localStorage
- Custom tickets still saved normally
- No data loss
- No breaking changes

### User Experience:
- ✅ Edits to ANY ticket now work
- ✅ All views stay in sync
- ✅ Changes persist across refreshes
- ✅ Cross-tab synchronization works

## Known Edge Cases

### Case 1: Reverting to Original
Currently no UI to "revert" a ticket to its original state. To implement:
```typescript
export function revertTicket(ticketNo: string): Ticket[] {
  const tickets = loadTickets();
  const updatedTickets = tickets.filter(t => t.ticketNo !== ticketNo);
  const original = TICKETS.find(t => t.ticketNo === ticketNo);
  if (original) {
    updatedTickets.push(original);
  }
  saveCustomTickets(updatedTickets);
  return loadTickets();
}
```

### Case 2: Many Modified Tickets
If many original tickets are modified, localStorage usage increases. Not a concern unless editing thousands of tickets.

### Case 3: Conflicting Edits
If two users edit the same ticket in different tabs, last write wins. Future: Add conflict resolution.

## Summary

This fix ensures that **ALL tickets** (both original and custom) can be updated and the changes persist across:
- Ticket List
- Work Planner
- Work Map
- Ticket Search
- Ticket Details

The system now properly tracks modifications to original tickets and saves them to localStorage, providing a seamless editing experience regardless of ticket origin.

---

**Status**: ✅ FIXED  
**Issue**: Original tickets couldn't be updated  
**Solution**: Save modified originals, merge on load  
**Date**: June 10, 2026  
**Impact**: CRITICAL - Enables editing all tickets
