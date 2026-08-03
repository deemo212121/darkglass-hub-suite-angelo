# Centralized Ticket Data System

## Overview

All ticket dummy data is now centralized in `src/lib/ticketData.ts` for consistency across the platform.

## Benefits

✅ **Single Source of Truth** - All components use the same ticket data  
✅ **Easy Maintenance** - Update tickets in one place  
✅ **Type Safety** - Consistent `Ticket` interface across the app  
✅ **Helper Functions** - Built-in filtering and search utilities  
✅ **No Duplication** - Eliminates redundant ticket definitions  

---

## Usage

### Import Ticket Data

```typescript
import { TICKETS, type Ticket } from "@/lib/ticketData";
```

### Basic Usage

```typescript
// Get all tickets
const allTickets = TICKETS;

// Display in component
{TICKETS.map(ticket => (
  <div key={ticket.ticketNo}>
    {ticket.customer} - {ticket.status}
  </div>
))}
```

---

## Available Exports

### 1. **TICKETS** (Main Data)
Array of all ticket objects with complete data.

```typescript
const tickets: Ticket[] = TICKETS;
console.log(tickets.length); // 15 tickets
```

### 2. **Ticket Interface**
TypeScript interface for type safety.

```typescript
import { type Ticket } from "@/lib/ticketData";

function MyComponent() {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
}
```

### 3. **Constants**

```typescript
import { TICKET_SOURCES, REPAIR_STATUS_OPTIONS } from "@/lib/ticketData";

// Ticket sources for filtering
TICKET_SOURCES // ["LG", "Midea-104268", "NSA GSLEE", ...]

// Status options for dropdowns
REPAIR_STATUS_OPTIONS // ["CL-Need", "Cancel", "CL-Parts Back Ordered", ...]
```

---

## Helper Functions

### Get Ticket by Number

```typescript
import { getTicketByNumber } from "@/lib/ticketData";

const ticket = getTicketByNumber("SA-3458831");
if (ticket) {
  console.log(ticket.customer); // "Neal Market"
}
```

### Get Tickets by Location

```typescript
import { getTicketsByLocation } from "@/lib/ticketData";

const atlantaTickets = getTicketsByLocation("Atlanta");
console.log(atlantaTickets.length); // All Atlanta tickets
```

### Get Tickets by Status

```typescript
import { getTicketsByStatus } from "@/lib/ticketData";

const waitingTickets = getTicketsByStatus("OP-Waiting for Part");
```

### Get Tickets by Technician

```typescript
import { getTicketsByTechnician } from "@/lib/ticketData";

const nathanTickets = getTicketsByTechnician("Nathan Napora");
```

### Advanced Filtering

```typescript
import { filterTickets } from "@/lib/ticketData";

const filtered = filterTickets({
  search: "atlanta",
  status: "OP-Waiting for Part",
  diagnosed: "Y",
  location: "Atlanta",
  technician: "Nathan Napora"
});
```

---

## Ticket Data Structure

```typescript
interface Ticket {
  // Core ticket info
  ticketNo: string;              // Unique ticket number
  ticketSource?: string;         // Source system (LG, NSA, etc.)
  warranty: string;              // IW, OW, etc.
  manufacturer: string;          // IH, Samsung, LG, etc.
  
  // Customer info
  customer: string;              // Customer name
  firstName?: string;            // First name
  lastName?: string;             // Last name
  city: string;                  // City
  address?: string;              // Street address
  zip?: string;                  // ZIP code
  phone: string;                 // Phone number
  email?: string;                // Email address
  
  // Location & routing
  location: string;              // Service location
  
  // Product info
  model: string;                 // Appliance model
  
  // Service details
  technician: string;            // Assigned technician
  diagnosed: string;             // Y/N
  status: string;                // Current status
  schedule: string;              // Schedule date
  internalNote: string;          // Internal notes
  
  // Tracking
  aging: number;                 // Days since creation
  calls: number;                 // Number of calls
  created: string;               // Creation date
  redo: string;                  // Y/N
  partOrder: string;             // Part order status
  customerPref: string;          // Customer preference Y/N
  
  // Optional fields
  account?: string;              // Account number
  irKit?: string;                // IR Kit info
  type?: string;                 // SMS, Phone, etc.
  branch?: string;               // Branch info
  contact?: string;              // Contact status
  delay?: number;                // Delay days
  statusChangedAt?: string;      // Last status change timestamp
  statusChangedBy?: string;      // Who changed status
}
```

---

## Updating Components to Use Centralized Data

### Before (Old Way)

```typescript
// ❌ Each component had its own ticket data
const TICKETS = [
  { ticketNo: "SA-001", customer: "John Doe", ... },
  { ticketNo: "SA-002", customer: "Jane Smith", ... },
];
```

### After (New Way)

```typescript
// ✅ Import from centralized source
import { TICKETS } from "@/lib/ticketData";
```

---

## Components Already Updated

✅ **TicketList** - `/src/components/TicketList.tsx`

## Components to Update

These components should be updated to use centralized ticket data:

### Priority 1 (High Usage)
- [ ] **WorkMap** - `src/components/TicketsMapWorkMap.tsx`
- [ ] **WorkPlanner** - `src/components/WorkPlannerPage.tsx`
- [ ] **TicketDetails** - `src/routes/ticket.$ticketNo.tsx`
- [ ] **ClaimsCalendar** - `src/components/ClaimCalendarWeekly.tsx`

### Priority 2 (Moderate Usage)
- [ ] **TicketsMap** - `src/components/TicketsMap.tsx`
- [ ] **TicketDetailsModal** - `src/components/TicketDetailsModal.tsx`

### Migration Steps

1. **Import centralized data**
   ```typescript
   import { TICKETS, type Ticket } from "@/lib/ticketData";
   ```

2. **Replace local ticket arrays**
   ```typescript
   // Remove local definitions
   // const tickets = [...]
   
   // Use centralized data
   const tickets = TICKETS;
   ```

3. **Update interfaces**
   ```typescript
   // Replace local interfaces
   // interface MyTicket { ... }
   
   // Use centralized interface
   import { type Ticket } from "@/lib/ticketData";
   ```

4. **Use helper functions**
   ```typescript
   import { filterTickets, getTicketByNumber } from "@/lib/ticketData";
   ```

---

## Adding New Tickets

To add more tickets, edit `src/lib/ticketData.ts`:

```typescript
const RAW_TICKETS: Omit<Ticket, "ticketSource">[] = [
  // Existing tickets...
  {
    ticketNo: "TK-NEW-001",
    warranty: "IW",
    customer: "New Customer",
    city: "NEW CITY",
    location: "Nashville",
    model: "MODEL123",
    // ... other required fields
  },
];
```

The `ticketSource` will be automatically assigned based on the `TICKET_SOURCES` array.

---

## Best Practices

### ✅ DO
- Import from `@/lib/ticketData` for all ticket data
- Use the `Ticket` interface for type safety
- Use helper functions for filtering/searching
- Keep ticket data consistent across components

### ❌ DON'T
- Create new local ticket arrays
- Duplicate ticket definitions
- Use inconsistent field names
- Hardcode ticket sources or status options

---

## Storage & Persistence

The centralized ticket data is read-only. For user modifications:

```typescript
// Save to localStorage
localStorage.setItem("ticket-list", JSON.stringify(TICKETS));

// Load from localStorage
const saved = JSON.parse(localStorage.getItem("ticket-list") || "[]");
```

---

## Example: Complete Component

```typescript
import { TICKETS, filterTickets, type Ticket } from "@/lib/ticketData";
import { useState } from "react";

export function TicketDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filteredTickets = filterTickets({
    search: searchQuery,
    status: statusFilter,
  });

  return (
    <div>
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search tickets..."
      />
      
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
      >
        <option value="">All Statuses</option>
        <option value="OP-Waiting for Part">Waiting for Part</option>
        <option value="CSR-Assigned to ASC">Assigned to ASC</option>
      </select>

      <div>
        {filteredTickets.map((ticket) => (
          <div key={ticket.ticketNo}>
            <h3>{ticket.ticketNo}</h3>
            <p>{ticket.customer}</p>
            <p>{ticket.status}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Testing

After migrating a component:

1. ✅ Verify tickets display correctly
2. ✅ Test filtering/searching functionality
3. ✅ Check ticket detail views
4. ✅ Ensure no console errors
5. ✅ Verify data consistency across components

---

## Support

For questions or issues with the centralized ticket data system:
- Check this documentation
- Review `src/lib/ticketData.ts` for available exports
- Look at `src/components/TicketList.tsx` for implementation examples
