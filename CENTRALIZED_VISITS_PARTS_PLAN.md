# Centralized Visits & Parts Integration Plan

## Goal
Integrate Visit Logs and Part Transactions into the centralized ticket system so they persist with the ticket data and can be accessed from other views like Work Planner.

---

## Current State (Problem)

### Separate Storage
Currently, visits and parts are stored separately per ticket:
- **Visits**: `ahs:ticket-visit-log:{ticketNo}` (separate localStorage key per ticket)
- **Parts**: `ahs:ticket-part-log:{ticketNo}` (separate localStorage key per ticket)
- **Ticket Data**: `ahs:tickets:data` (centralized)

### Issues
1. **Not Synchronized**: Visits and parts are not part of the centralized ticket object
2. **Not Accessible**: Other views (Work Planner, Ticket List, etc.) can't access visit/part data
3. **Not Exportable**: Can't export complete ticket data with visits and parts
4. **Fragmented**: Data spread across multiple localStorage keys

---

## New State (Solution)

### Unified Storage
All data stored in ONE place - the centralized ticket object:

```typescript
interface Ticket {
  // ... existing ticket fields ...
  
  // NEW: Service tracking data integrated into ticket
  visits?: Array<VisitLogEntry>;  // All visits for this ticket
  parts?: Array<PartTransaction>;  // All parts for this ticket
}
```

### Benefits
1. **Synchronized**: Visits and parts are part of the ticket
2. **Accessible Everywhere**: Any view can access complete ticket data
3. **Exportable**: Single source contains everything
4. **Consistent**: All data flows through centralized system

---

## Implementation Steps

### ✅ Step 1: Update Ticket Interface
**File**: `src/lib/ticketData.ts`

Added `visits` and `parts` arrays to the Ticket interface:
```typescript
export interface Ticket {
  // ... existing fields ...
  claimCompany?: string;
  visits?: Array<{...}>;  // Visit log entries
  parts?: Array<{...}>;   // Part transactions
}
```

### ✅ Step 2: Add Helper Functions
**File**: `src/lib/ticketData.ts`

Added functions to manage visits and parts:
- `updateTicketVisits(ticketNo, visits)` - Save visits to ticket
- `updateTicketParts(ticketNo, parts)` - Save parts to ticket
- `getTicketVisits(ticketNo)` - Get visits from ticket
- `getTicketParts(ticketNo)` - Get parts from ticket

### ⏳ Step 3: Update Ticket Details Page
**File**: `src/routes/ticket.$ticketNo.tsx`

Need to update the ticket details page to use centralized functions:

#### Visit Logs
**Before**:
```typescript
// Load visits from separate localStorage key
const visits = loadVisitLogEntries(ticketNo);

// Save visits to separate localStorage key
saveVisitLogEntries(ticketNo, visits);
```

**After**:
```typescript
// Load visits from centralized ticket
const ticket = getTicketByNumber(ticketNo);
const visits = ticket?.visits || [];

// Save visits to centralized ticket
updateTicketVisits(ticketNo, visits);
```

#### Part Transactions
**Before**:
```typescript
// Load parts from separate localStorage key
const parts = loadPartRows(ticketNo);

// Save parts to separate localStorage key
savePartRows(ticketNo, parts);
```

**After**:
```typescript
// Load parts from centralized ticket
const ticket = getTicketByNumber(ticketNo);
const parts = ticket?.parts || [];

// Save parts to centralized ticket
updateTicketParts(ticketNo, parts);
```

### ⏳ Step 4: Migration Strategy

For tickets that have visits/parts in the old separate keys, we need to migrate them:

```typescript
function migrateTicketData(ticketNo: string) {
  // Load old data from separate keys
  const oldVisits = localStorage.getItem(`ahs:ticket-visit-log:${ticketNo}`);
  const oldParts = localStorage.getItem(`ahs:ticket-part-log:${ticketNo}`);
  
  if (oldVisits || oldParts) {
    // Parse and migrate to centralized ticket
    const visits = oldVisits ? JSON.parse(oldVisits) : [];
    const parts = oldParts ? JSON.parse(oldParts) : [];
    
    // Update centralized ticket with migrated data
    let tickets = loadTickets();
    tickets = tickets.map(t => {
      if (t.ticketNo === ticketNo) {
        return { ...t, visits, parts };
      }
      return t;
    });
    saveCustomTickets(tickets);
    
    // Remove old keys
    localStorage.removeItem(`ahs:ticket-visit-log:${ticketNo}`);
    localStorage.removeItem(`ahs:ticket-part-log:${ticketNo}`);
    
    console.log(`Migrated data for ticket ${ticketNo}`);
  }
}
```

### ⏳ Step 5: Update Work Planner
**File**: `src/components/WorkPlannerPage.tsx`

Work Planner can now access visit data to show repair status:

```typescript
// Load ticket with all data including visits
const ticket = getTicketByNumber(ticketNo);

// Get latest visit to show current repair status
const latestVisit = ticket.visits?.[0]; // Assuming sorted by date
const repairStatus = latestVisit?.repairStatus || ticket.status;

// Display in modal
<div className="detail-label">Repair Status</div>
<div className="detail-value">{repairStatus}</div>
```

---

## Data Flow (New System)

### Creating a Visit
```
User adds visit in Ticket Details
    ↓
Add to visits array
    ↓
updateTicketVisits(ticketNo, visits)
    ↓
Update centralized ticket in localStorage
    ↓
Trigger storage event
    ↓
All views refresh (Ticket Details, Work Planner, etc.)
    ↓
Visit data available everywhere
```

### Creating a Part/PO
```
User adds part in Ticket Details
    ↓
Add to parts array
    ↓
updateTicketParts(ticketNo, parts)
    ↓
Update centralized ticket in localStorage
    ↓
Trigger storage event
    ↓
All views refresh
    ↓
Part data available everywhere
```

---

## Code Changes Needed

### ticket.$ticketNo.tsx

#### 1. Import centralized functions
```typescript
import { 
  loadTickets, 
  updateTicket, 
  getTicketByNumber, 
  updateTicketVisits,    // NEW
  updateTicketParts,     // NEW
  getTicketVisits,       // NEW
  getTicketParts,        // NEW
  type Ticket 
} from "@/lib/ticketData";
```

#### 2. Load visits from centralized ticket
Find:
```typescript
const [visitLogEntries, setVisitLogEntries] = useState<VisitLogEntry[]>([]);

useEffect(() => {
  const loaded = loadVisitLogEntries(ticketNo);
  setVisitLogEntries(loaded);
}, [ticketNo]);
```

Replace with:
```typescript
const [visitLogEntries, setVisitLogEntries] = useState<VisitLogEntry[]>([]);

useEffect(() => {
  const ticket = getTicketByNumber(ticketNo);
  setVisitLogEntries(ticket?.visits || []);
}, [ticketNo]);
```

#### 3. Save visits to centralized ticket
Find all occurrences of:
```typescript
saveVisitLogEntries(ticketNo, [...visitLogEntries]);
```

Replace with:
```typescript
updateTicketVisits(ticketNo, [...visitLogEntries]);
```

#### 4. Load parts from centralized ticket
Find:
```typescript
const [partRows, setPartRows] = useState<PartTransactionRow[]>([]);

useEffect(() => {
  if (!partRowsLoaded) {
    const loaded = loadPartRows(ticketNo);
    setPartRows(loaded);
    setPartRowsLoaded(true);
  }
}, [partRows, partRowsLoaded, ticketNo]);
```

Replace with:
```typescript
const [partRows, setPartRows] = useState<PartTransactionRow[]>([]);

useEffect(() => {
  if (!partRowsLoaded) {
    const ticket = getTicketByNumber(ticketNo);
    setPartRows(ticket?.parts || []);
    setPartRowsLoaded(true);
  }
}, [partRows, partRowsLoaded, ticketNo]);
```

#### 5. Save parts to centralized ticket
Find all occurrences of:
```typescript
savePartRows(ticketNo, [...partRows]);
```

Replace with:
```typescript
updateTicketParts(ticketNo, [...partRows]);
```

#### 6. Remove old localStorage functions
Can remove these functions (no longer needed):
- `getVisitLogKey()`
- `loadVisitLogEntries()`
- `saveVisitLogEntries()`
- `getPartLogKey()`
- `loadPartRows()`
- `savePartRows()`

---

## Testing Checklist

### Visits
- [ ] Add a new visit in Ticket Details
- [ ] Visit appears in Visit History table
- [ ] Refresh page - visit still there
- [ ] Open ticket in new tab - visit appears
- [ ] Check localStorage - visits array in ticket object
- [ ] Work Planner shows latest repair status from visit

### Parts
- [ ] Add a new part/PO in Ticket Details
- [ ] Part appears in Part Transaction table
- [ ] Refresh page - part still there
- [ ] Open ticket in new tab - part appears
- [ ] Edit part - changes saved
- [ ] Delete part - removed from list
- [ ] Check localStorage - parts array in ticket object

### Migration
- [ ] Create ticket with old system (separate keys)
- [ ] Run migration function
- [ ] Data appears in centralized ticket
- [ ] Old keys removed
- [ ] Everything still works

### Cross-View Access
- [ ] Create visit in Ticket Details
- [ ] Work Planner can read visit data
- [ ] Ticket List can show visit count
- [ ] Export ticket data includes visits and parts

---

## Benefits

### For Users
1. **Data Persistence**: Visits and parts never lost
2. **Cross-View Access**: See visit/part data everywhere
3. **Better Work Planner**: Shows actual repair status from visits
4. **Exportable**: Complete ticket data in one place

### For Developers
1. **Single Source of Truth**: One place for all ticket data
2. **Easier to Maintain**: No separate storage keys to manage
3. **Consistent API**: Same pattern for all ticket data
4. **Better Testing**: Load ticket once, get everything

---

## Files to Modify

1. **✅ `src/lib/ticketData.ts`** - Interface and helper functions (DONE)
2. **⏳ `src/routes/ticket.$ticketNo.tsx`** - Update to use centralized functions (TODO)
3. **⏳ `src/components/WorkPlannerPage.tsx`** - Access visit data for repair status (TODO)

---

## Next Steps

1. Update ticket details page to use `updateTicketVisits()` and `updateTicketParts()`
2. Test visit creation and ensure it saves to centralized ticket
3. Test part creation and ensure it saves to centralized ticket
4. Add migration logic for existing tickets with separate storage
5. Update Work Planner to show repair status from visits
6. Remove old localStorage functions

---

**Status**: 🟡 IN PROGRESS
**Completed**: Ticket interface updated, helper functions added
**Remaining**: Update ticket details page to use new functions
**Estimated Work**: 2-3 hours to complete all changes and testing

This is a significant architectural improvement that will make the system more maintainable and feature-rich!
