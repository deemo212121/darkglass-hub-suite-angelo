# Work Planner Technician Drag/Drop Persistence

## Overview
Implemented full persistence and audit logging for technician reassignments via drag/drop in Work Planner. Changes update both the ticket's main technician field AND the latest visit's technician field.

## Changes Made

### File: `src/components/WorkPlannerPage.tsx`

#### Updated `handleDrop` Function

**Key Features:**

1. **Centralized Ticket Update**
   - When a ticket is dragged to a different technician, the change is immediately saved to the centralized ticket system using `updateTicket()`
   - The technician field is updated in the ticket data stored in `localStorage` under `ahs:tickets:data`
   - **NEW:** Also updates the technician in the latest visit record (if a visit exists)

2. **Visit Technician Update**
   - Finds the latest visit (first in the visits array)
   - Updates the visit's `technician` field to match the new technician
   - Sets `updatedAt` timestamp on the visit
   - Sets `updatedBy` to the user's email (from auth) or "Work Planner"
   - Sets `updateReason` with a descriptive message: "Technician changed from [old] to [new] via Work Planner drag/drop"
   - This ensures the Service Tracking tab shows the correct technician and edit details

3. **Dual Audit Log Creation**
   - Creates TWO audit log entries for every technician reassignment:
     - **Entry 1 - Main Technician:** Records the change to the ticket's main technician field
     - **Entry 2 - Visit Technician:** Records the change to the visit's technician field (if visit exists)
   - Each audit entry includes:
     - Unique ID and timestamp
     - User email (from `useAuth`) or "Work Planner" as the author
     - Action description
     - Field name
     - Before: Previous technician name
     - After: New technician name
   - Audit logs are stored in `localStorage` under `ahs:ticket-audit:{ticketNo}`
   - Audit logs are visible in the Ticket Details page "General Information" tab

4. **Persistence After Page Reload**
   - After updating the centralized ticket, the function reloads all tickets from `loadTickets()` and rebuilds the planner display
   - This ensures that the change persists even if the user refreshes the page
   - The ticket will stay with the new technician across all views (Work Planner, Ticket List, Ticket Details)
   - The visit will show the new technician in Service Tracking

5. **Time Slot Restrictions**
   - Maintains existing functionality: if a ticket has a visit with a specific time slot (AM/PM), it can only be moved within that slot
   - ANYTIME time slots allow movement to any slot

6. **Changed Tickets Log**
   - Maintains the "Changed Tickets" table showing all drag/drop operations
   - Distinguishes between "Technician Reassignment" and "Time Slot Change" in the log

## Implementation Flow

```
User drags ticket to different technician
          ↓
handleDrop checks time slot restrictions
          ↓
Detects technician change (oldTechnician !== technician)
          ↓
Updates latest visit's technician field (if visit exists)
          ↓
Updates centralized ticket system via updateTicket()
          ↓
Creates audit log entries (main + visit)
          ↓
Reloads tickets from centralized system
          ↓
Rebuilds planner display with updated data
          ↓
Adds entry to Changed Tickets log
          ↓
Ticket AND visit stay with new technician after page refresh
```

## Data Storage

### Centralized Ticket Data
- **Key:** `ahs:tickets:data`
- **Content:** Array of all tickets with their current state
- **Updated Fields:** 
  - `technician` (main ticket field)
  - `visits[0].technician` (latest visit's technician)
  - `visits[0].updatedAt` (timestamp of update)
  - `visits[0].updatedBy` (email of user who made the change)
  - `visits[0].updateReason` (descriptive reason for the change)
  - `statusChangedAt`

### Audit Log
- **Key:** `ahs:ticket-audit:{ticketNo}`
- **Content:** Array of audit entries for the ticket
- **Structure (Main Technician Change):**
  ```json
  {
    "id": "unique-id-1",
    "timestamp": "2026-06-11T12:30:00.000Z",
    "by": "admin@ahsolutions.com",
    "action": "Technician reassignment via Work Planner",
    "field": "Technician",
    "before": "Alex Myles",
    "after": "Joshua Rhinehart"
  }
  ```
- **Structure (Visit Technician Change):**
  ```json
  {
    "id": "unique-id-2",
    "timestamp": "2026-06-11T12:30:00.001Z",
    "by": "admin@ahsolutions.com",
    "action": "Updated visit technician via Work Planner drag/drop",
    "field": "Visit Technician",
    "before": "Alex Myles",
    "after": "Joshua Rhinehart"
  }
  ```

## What Gets Updated

### Schedule Information Section (General Information Tab)
- ✅ Technician field updates to new technician
- ✅ Shows "Joshua Rhinehart" after drag/drop

### Visit History Section (Service Tracking Tab)
- ✅ Latest visit's Technician field updates to new technician
- ✅ Shows "Technician: Joshua Rhinehart" in visit details
- ✅ Visit's `updatedAt` timestamp is set
- ✅ Edit banner shows: "Edited: 6/11/2026, 12:55:58 PM by admin@ahsolutions.com"
- ✅ Edit banner shows reason: "Technician changed from Alex Myles to Joshua Rhinehart via Work Planner drag/drop"

### Edit History Section (General Information Tab)
- ✅ Shows "Technician reassignment via Work Planner" entry
- ✅ Shows "Updated visit technician via Work Planner drag/drop" entry (if visit exists)
- ✅ Both entries show before/after values

## Testing Checklist

- [x] Drag ticket to different technician
- [x] Verify technician field updates in Schedule Information
- [x] Verify technician field updates in Visit History (latest visit)
- [x] Verify TWO audit log entries are created
- [x] Refresh Work Planner page
- [x] Verify ticket stays with new technician
- [x] Open Ticket Details page
- [x] Verify Schedule Information shows new technician
- [x] Verify Service Tracking Visit History shows new technician
- [x] Verify Edit History shows both audit log entries
- [x] Verify time slot restrictions still work (PM tickets can't move to AM)

## Integration with Existing Systems

1. **Centralized Ticket System** (`lib/ticketData.ts`)
   - Uses `updateTicket()` function to persist changes
   - Updates both ticket and visits data
   - Integrates with `loadTickets()` to reload data

2. **Ticket Details Page** (`routes/ticket.$ticketNo.tsx`)
   - Automatically picks up technician changes from centralized system
   - Displays updated technician in Schedule Information
   - Displays updated technician in Visit History
   - Shows both audit logs in Edit History

3. **Ticket List** (`components/TicketList.tsx`)
   - Shows updated technician for tickets
   - Filters by technician work correctly

4. **Work Map** (if implemented)
   - Would show tickets under new technician

## Notes

- Only technician changes trigger centralized updates and audit logs
- Time slot changes (AM/PM/ANYTIME) only update the local planner display
- **NEW:** Updates BOTH the main ticket technician AND the latest visit's technician
- **NEW:** Creates TWO audit log entries (one for ticket, one for visit)
- Audit log format matches the format used in Ticket Details page for consistency
- User email from `useAuth()` hook is recorded as the author of both changes
- If no visit exists, only the main technician is updated (no visit audit entry)
