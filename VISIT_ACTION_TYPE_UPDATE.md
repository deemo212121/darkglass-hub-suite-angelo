# Visit Action Type Update

## Change Summary
Updated the Action Type dropdown options in the Add Visit / Edit Visit form to match the standardized action types used in the system.

## Previous Options
- Visited
- Cx Conf.
- Not Completed
- Cancelled

## New Options
1. SCHEDULE
2. ACKNOWLEDGE
3. CALL ATTEMPT
4. CANCEL
5. CLAIM REQUESTED
6. COMPLETED
7. OSR
8. UPDATE INFO.
9. UPDATE
10. RESCHEDULE
11. TRIAGE
12. SUPPORT

## Changes Made

### 1. Updated Dropdown Options
**File**: `src/routes/ticket.$ticketNo.tsx`
**Location**: Add Visit modal, Action Type field

Changed from limited 4 options to comprehensive 12 action types that better represent the full ticket workflow lifecycle.

### 2. Updated Default Value
**Before**: `"Visited"`
**After**: `"SCHEDULE"`

The default value when opening the Add Visit form is now "SCHEDULE" which is more appropriate for new visits being planned.

### 3. Updated State Initialization
```typescript
const [newVisitActionType, setNewVisitActionType] = useState("SCHEDULE");
```

### 4. Updated Form Reset
When clearing the form or opening a new visit modal, the action type resets to "SCHEDULE":
```typescript
setNewVisitActionType("SCHEDULE");
```

### 5. Updated Edit Mode Fallback
When editing an existing visit, if no action type exists, it defaults to "SCHEDULE":
```typescript
setNewVisitActionType(entry.actionType || "SCHEDULE");
```

## Action Type Meanings

| Action Type | Description |
|------------|-------------|
| SCHEDULE | Initial scheduling of a visit/appointment |
| ACKNOWLEDGE | Confirmation that ticket was received/acknowledged |
| CALL ATTEMPT | Attempted to contact customer |
| CANCEL | Visit or ticket was cancelled |
| CLAIM REQUESTED | Warranty claim has been requested |
| COMPLETED | Service/repair work completed |
| OSR | Out of Service Range |
| UPDATE INFO. | Customer or ticket information updated |
| UPDATE | General status update |
| RESCHEDULE | Visit date/time changed |
| TRIAGE | Initial assessment/diagnosis |
| SUPPORT | Support action taken |

## Usage

### Adding a Visit
1. Open ticket details page
2. Navigate to "Service Tracking" tab
3. Click "Add Visit" button
4. Select appropriate Action Type from dropdown
5. Fill in other required fields
6. Click "Add Visit"

### Editing a Visit
1. Find the visit in Visit History
2. Click "Edit" button
3. Change Action Type if needed
4. Update other fields
5. Click "Update Visit"

## Display
The Action Type is displayed prominently in:
- Visit History list: `"{Action Type} / {Repair Status}"`
- Visit Details modal header
- Audit log entries

Example: `"SCHEDULE / CSR-Assigned to ASC"`

## Backward Compatibility
Existing visits with old action types (Visited, Cx Conf., Not Completed, Cancelled) will continue to display correctly. The system doesn't require migration of old data - it simply provides new standardized options for future visits.

## Files Modified
- `src/routes/ticket.$ticketNo.tsx` - Updated Action Type dropdown options and default values

## Related Features
- Visit Log tracking
- Audit trail
- Technician assignment
- Ticket status tracking
