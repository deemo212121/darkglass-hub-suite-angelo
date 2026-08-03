# Ticket List - Create Ticket Cleanup

## Current Status
The Ticket List component has redundant "Create Ticket" functionality that duplicates the New Ticket page.

## Tasks Needed

### 1. Remove Create Ticket Button from Ticket List
**File**: `src/components/TicketList.tsx`
**Lines to remove**: ~319-324

```tsx
// REMOVE THIS:
<button 
  onClick={() => setShowCreateModal(true)}
  className="btn bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-300 font-semibold flex items-center gap-2"
>
  <Plus className="h-4 w-4" /> Create Ticket
</button>
```

### 2. Remove Create Ticket State Variables
**File**: `src/components/TicketList.tsx`
**Lines**: ~151-168

Remove:
- `showCreateModal` state
- `createFormData` state
- `availableTechnicians` useMemo

### 3. Remove handleCreateTicket Function
**File**: `src/components/TicketList.tsx`
**Lines**: ~257-293

Remove entire `handleCreateTicket` function

### 4. Remove Create Ticket Modal JSX
**File**: `src/components/TicketList.tsx`
**Lines**: ~547-738 (entire Dialog component for creating tickets)

Remove the entire `<Dialog open={showCreateModal}>` component

### 5. Verify New Ticket Page Integration
**File**: Check if `/m/tickets/new-ticket` properly:
- Saves tickets to `ahs:tickets:data` localStorage
- Tickets appear in Ticket List
- Tickets appear in Work Map
- Tickets appear in Work Planner
- Tickets can be opened in Ticket Details

## Why This Cleanup Matters
- **Single Source of Truth**: New Ticket page should be the only place to create tickets
- **Consistency**: Users should follow one workflow
- **Maintenance**: Less code duplication
- **UX**: Clearer user journey

## Next Steps
1. Complete the cleanup (remove all Create Ticket code from TicketList)
2. Test New Ticket page workflow end-to-end
3. Verify tickets appear everywhere they should
4. Test ticket details page with newly created tickets

## Status
🟡 IN PROGRESS - Button removed, full cleanup pending
