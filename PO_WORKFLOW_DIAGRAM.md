# Part Order Workflow - Visual Guide

## Process Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SERVICE TRACKING (TICKETS)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Ticket: TK-001234                                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Parts Section                                            │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ Part No*       │ LG567-890                               │  │
│  │ Distributor*   │ LG                                      │  │
│  │ Description    │ Compressor Motor                        │  │
│  │ PO No          │ PO-260609-001 (Auto-gen) ← Auto-filled  │  │
│  │ PO Date        │ 2026-06-09 (Auto-filled) ← Auto-filled  │  │
│  │ Qty*           │ 1                                        │  │
│  │ Price          │ 345.50                                   │  │
│  │ Status*        │ [Need PO] ← Triggers PO Creation        │  │
│  │ Visit ID*      │ V-001                                    │  │
│  │ ETA            │ 2026-06-15                               │  │
│  │                                                           │  │
│  │ [Add] ← Click to save                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│                    savePartRow() triggered                      │
│                              │                                  │
│                              ▼                                  │
│                    ✓ Part added to ticket                      │
│                    ✓ PO auto-created & saved                  │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               │ (Background Process)
                               ▼
              ┌────────────────────────────────┐
              │   PO DATA STORE (localStorage) │
              ├────────────────────────────────┤
              │ poNo:       PO-260609-001      │
              │ ticketNo:   TK-001234          │
              │ partNo:     LG567-890          │
              │ partDist:   LG                 │
              │ partDesc:   Compressor Motor   │
              │ quantity:   1                  │
              │ partPrice:  345.50             │
              │ poDate:     2026-06-09         │
              │ eta:        2026-06-15         │
              │ status:     Need PO            │
              │ itemStatus: No-Invoice         │
              │ createdAt:  2026-06-09T14:32Z  │
              │ updatedAt:  2026-06-09T14:32Z  │
              └────────────────────────────────┘
                               │
                               │ (Auto-synced)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PO MANAGEMENT DASHBOARD                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Filters: [Distributor ▼] [Start Date] [End Date] [PO No]     │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Ticket  │ PO No        │ P/O Date │ Part No  │ Qty│Status │ │
│  ├─────────┼──────────────┼──────────┼──────────┼────┼────────┤ │
│  │ TK-0012 │ PO-260609-001│ 6/9/26   │LG567-890 │ 1  │ Pending│ │
│  │ TK-0013 │ PO-260609-002│ 6/9/26   │WPW1082  │ 2  │ Pending│ │
│  │ TK-0014 │ PO-260609-003│ 6/9/26   │EVT456-12│ 1  │ Pending│ │
│  │ ...     │ ...          │ ...      │ ...     │..  │ ...    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ✓ All orders auto-populated from Service Tracking             │
│  ✓ Click ticket # to view details                              │
│  ✓ Filter by date range, distributor, or PO#                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## User Journeys

### Journey 1: Create a Part Order
```
USER → Service Tracking Ticket
       ↓
       Open ticket detail
       ↓
       Scroll to Parts section
       ↓
       Fill in part fields:
       - Part No: [required]
       - Distributor: [required]
       - Qty: [required]
       - Status: Set to "Need PO" or "PO Made"
       - Visit ID: [required]
       ↓
       Click "Add" button
       ↓
       ✓ Part added to ticket
       ✓ PO auto-created with auto-gen PO number
       ✓ Data saved to localStorage
```

### Journey 2: View Part Orders in PO Management
```
USER → Go to Parts Module
       ↓
       Click "P/O Management" or "PoStatusPage"
       ↓
       Dashboard loads
       ↓
       Page fetches from data store
       ↓
       Display all POs created from tickets
       ↓
       User can:
       - See full list of POs
       - Filter by date range
       - Filter by distributor
       - Search for specific PO#
       - Click ticket # to see source ticket
```

### Journey 3: Update a Part Order
```
USER → Service Tracking Ticket
       ↓
       Find existing part row
       ↓
       Click "Edit" or select for editing
       ↓
       Update part details (price, ETA, status, etc.)
       ↓
       Click "Update" button
       ↓
       ✓ Part updated in ticket
       ✓ PO updated in data store
       ✓ Changes reflected in PO Management
```

## State Transitions

```
                    ┌─────────────┐
                    │  Need PO    │  ← Initial state when part added
                    └──────┬──────┘
                           │
                    (create order)
                           │
                           ▼
                    ┌─────────────┐
                    │  PO Made    │  ← Order confirmed with vendor
                    └──────┬──────┘
                           │
                  (shipment received)
                           │
                           ▼
                    ┌─────────────┐
                    │ Part Ready  │  ← Ready for tech to pick up
                    └──────┬──────┘
                           │
                    (tech retrieves)
                           │
                           ▼
                    ┌─────────────┐
                    │    Used     │  ← Installed in customer unit
                    └─────────────┘
```

## Data Flow Diagram

```
┌──────────────────────────┐
│   Browser Storage        │
│  (localStorage)          │
│                          │
│  Key: ah-solutions:POs   │
│  ┌────────────────────┐  │
│  │ [                  │  │
│  │  {                 │  │
│  │    poNo: "...",    │  │
│  │    ticketNo: "...",│  │
│  │    partNo: "...",  │  │
│  │    ...             │  │
│  │  },                │  │
│  │  { ... },          │  │
│  │  { ... }           │  │
│  │ ]                  │  │
│  └────────────────────┘  │
└───────────┬──────────────┘
            │
            │ reads/writes
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
┌─────────────┐  ┌──────────────────┐
│   Ticket    │  │ PO Management    │
│   Page      │  │ Component        │
│             │  │                  │
│ Saves PO on │  │ Loads POs on     │
│ part save   │  │ mount & filter   │
└─────────────┘  └──────────────────┘
```

## File Structure

```
src/
├── lib/
│   └── poDataStore.ts                ← New: Data store for POs
│
├── routes/
│   └── ticket.$ticketNo.tsx           ← Modified: Added PO save
│
└── components/
    ├── PartOrder.tsx                 ← Modified: Updated UI/info
    └── PoStatusPage.tsx              ← Modified: Uses data store
```

## Key Functions

### In Service Tracking (ticket.$ticketNo.tsx)
```javascript
const savePartRow = () => {
  // ... existing part save logic ...
  
  // NEW: Auto-create/update PO in PO Management
  if (nextRow.status === "Need PO" || nextRow.status === "PO Made" || nextRow.poNo.trim()) {
    const partOrder = createPartOrderFromTicket(ticketNo, nextRow);
    savePartOrder(partOrder);
  }
}
```

### In PO Management (PoStatusPage.tsx)
```javascript
useEffect(() => {
  // Load all part orders from data store
  const orders = getAllPartOrders();
  setPartOrders(orders);
  
  // Apply filters
  const filtered = getFilteredPartOrders({
    dateRange: {
      start: filters.startDate,
      end: filters.endDate,
    },
    partDist: filters.location || undefined,
  });
  
  setFilteredOrders(finalFiltered);
}, [filters]);
```

## Summary

The new workflow creates a seamless connection between Service Tracking and PO Management:

1. **User creates part** in ticket → System auto-generates PO
2. **PO is stored** in browser localStorage → Persists across sessions
3. **PO Management** reads from storage → Always shows latest data
4. **User can manage** POs with filters → Easy to find and track orders
5. **All data tied** to source ticket → Context is never lost

This eliminates the manual PO creation step and ensures that POs stay synchronized with their source tickets.
