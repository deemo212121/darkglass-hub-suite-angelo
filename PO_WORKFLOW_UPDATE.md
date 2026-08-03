# Part Order (PO) Workflow Update

## Overview
The Part Order workflow has been restructured to streamline the process of managing purchase orders. Part orders are now created automatically when parts are added to Service Tracking tickets, and automatically populated in the PO Management dashboard.

## Key Changes

### 1. **Part Order Creation (Service Tracking)**
**File:** `src/routes/ticket.$ticketNo.tsx`

**Changes:**
- When you add a part to a ticket in Service Tracking and set the status to "Need PO" or "PO Made", a part order is automatically created
- The part order is saved with:
  - Auto-generated PO number (format: `PO-YYMMDD-XXX`)
  - Ticket number (links it to the ticket)
  - Part details (partNo, partDist, partDesc, quantity, price)
  - Order timeline (poDate, eta, invoiceNo, invoiceDate)
  - Status tracking

**How it works:**
1. Go to a ticket in Service Tracking
2. Add a part row with required fields:
   - Part No
   - Distributor
   - Quantity
   - Status (set to "Need PO" or "PO Made")
   - Visit ID
3. Click "Add" button
4. The system automatically:
   - Creates/updates the part order in the background
   - Saves to the PO data store
   - Makes it available in PO Management

### 2. **PO Management Dashboard**
**File:** `src/components/PoStatusPage.tsx`

**Changes:**
- Replaced static dummy data with live part orders from the data store
- Added dynamic filtering by:
  - Date range (PO Date start/end)
  - Distributor (Part Dist.)
  - PO Number
  - Branch
- Shows total count of part orders in the current filter
- Empty state message guides users to Service Tracking to create orders

**Features:**
- View all part orders created from tickets
- Filter by date, distributor, or PO number
- Click on ticket number to jump to the ticket detail page
- See real-time order status and ETA information

### 3. **Data Store**
**File:** `src/lib/poDataStore.ts`

**New utility functions:**
```typescript
// Get all part orders
getAllPartOrders(): StoredPartOrder[]

// Save or update a part order
savePartOrder(order: StoredPartOrder): void

// Get part orders for a specific ticket
getTicketPartOrders(ticketNo: string): StoredPartOrder[]

// Delete a part order
deletePartOrder(poNo: string): void

// Get filtered part orders
getFilteredPartOrders(filters: {...}): StoredPartOrder[]

// Generate PO numbers automatically
generatePoNumber(index: number): string

// Convert ticket part draft to part order
createPartOrderFromTicket(ticketNo: string, partDraft: any): StoredPartOrder
```

**Storage:**
- Uses browser localStorage with key: `ah-solutions:part-orders`
- Data is persistent across sessions
- Stores all part order information including status, tracking numbers, and dates

## Workflow

### Before (Old Workflow)
1. Add part to Service Tracking
2. Go to Part Order page
3. Manually create PO
4. Go to PO Management
5. View/edit PO manually

### After (New Workflow)
1. Add part to Service Tracking (with status "Need PO" or "PO Made")
   ↓
   **Automatic: PO is created and saved**
2. Go to PO Management
3. View all part orders automatically populated
4. Filter and manage orders

## Part Order Status

When a part is saved with these statuses, a PO is created:
- **Need PO** - Part needs to be ordered
- **PO Made** - PO has been created

Other part statuses will not trigger PO creation:
- Back Order
- Cancelled
- Claimed
- CX Home
- Defective
- Hold for Estimation
- Lost
- Part Ready
- Used
- RA statuses
- etc.

## Data Structure

Each stored part order contains:
```typescript
interface StoredPartOrder {
  poNo: string;              // Auto-generated PO number
  ticketNo: string;          // Linked ticket
  partNo: string;            // Part number
  partDist: string;          // Distributor
  partDesc: string;          // Description
  quantity: number;          // Order quantity
  partPrice: number;         // Unit price
  poDate: string;            // Date PO was created
  eta: string;               // Expected arrival date
  invoiceNo?: string;        // Vendor invoice number
  invoiceDate?: string;      // Invoice date
  orderNo?: string;          // Vendor order number
  inTracking?: string;       // Incoming tracking number
  outTracking?: string;      // Return tracking number
  status: string;            // Status (Need PO, PO Made, etc.)
  itemStatus: string;        // Item status (No-Invoice, Invoiced, etc.)
  note?: string;             // Notes
  createdAt: string;         // Timestamp
  updatedAt: string;         // Last updated timestamp
}
```

## UI Updates

### Service Tracking (Ticket Page)
- PO No field now shows placeholder "PO No (Auto-gen)"
- PO Date field shows tooltip "Auto-populated on PO creation"
- When you save a part, the PO is automatically created

### Part Order Page
- Info banner explains: "Part orders are created automatically when you add parts to a ticket in Service Tracking"
- Changed "Manual P/O" button to "View Order" button
- Button now always available (removed ETA requirement)

### PO Management
- Dynamically loads part orders from data store
- Shows real part data instead of dummy data
- Displays count of orders
- Empty state if no orders exist

## Technical Implementation

### Integration Points
1. **Ticket Page** → When part is saved with "Need PO" or "PO Made" status
2. **PO Store** → Auto-generates PO number and stores data
3. **PO Management** → Reads from PO store and displays with filters

### Storage Flow
```
Service Tracking (Add Part)
  ↓
  savePartRow() function triggered
  ↓
  Checks if status = "Need PO" or "PO Made"
  ↓
  createPartOrderFromTicket() converts part to PO format
  ↓
  savePartOrder() stores to localStorage
  ↓
  PoStatusPage component reads from localStorage
  ↓
  Filters and displays all POs
```

## Benefits

✅ **Automatic**: No manual PO creation step  
✅ **Linked**: Each PO is tied to its source ticket  
✅ **Real-time**: PO Management always shows current data  
✅ **Context-aware**: POs created with full ticket context  
✅ **Filterable**: Easy to find orders by date, distributor, or PO#  
✅ **Persistent**: Data survives page reloads  

## Testing

To test the new workflow:

1. **Create a Part Order**
   - Go to a ticket
   - Add a part with status "Need PO" or "PO Made"
   - Click Add
   - Check PO Management to see the new order

2. **View Orders**
   - Go to PO Management
   - Should see the part order you just created
   - Try filtering by date or distributor

3. **Filter Orders**
   - Try different date ranges
   - Filter by distributor
   - Search for specific PO number

## Future Enhancements

Possible future improvements:
- Add ability to edit PO details after creation
- Add PO status workflow management
- Send PO to vendor integration
- Automatic ETA tracking
- PO analytics and reporting
- Bulk PO operations
- PO history and audit trail

## Notes

- Part orders use browser localStorage, so they won't sync across different devices
- For production, consider migrating to server-side storage (database)
- PO numbers are auto-generated but can be edited after creation
- All PO data is tied to the ticket that created it
