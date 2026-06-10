# Centralized Ticket Data - System Architecture

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    src/lib/ticketData.ts                     │
│                  (SINGLE SOURCE OF TRUTH)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   TICKETS    │  │    Ticket    │  │   CONSTANTS  │      │
│  │  (15+ items) │  │  (interface) │  │   SOURCES    │      │
│  │              │  │              │  │   STATUSES   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           HELPER FUNCTIONS                          │   │
│  │  • getTicketByNumber()                              │   │
│  │  • getTicketsByLocation()                           │   │
│  │  • getTicketsByStatus()                             │   │
│  │  • getTicketsByTechnician()                         │   │
│  │  • filterTickets()                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ imports
                            ▼
        ┌───────────────────────────────────────────┐
        │         CONSUMING COMPONENTS              │
        └───────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ TicketList   │    │   WorkMap    │    │ WorkPlanner  │
│      ✅       │    │   (to-do)    │    │   (to-do)    │
└──────────────┘    └──────────────┘    └──────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│TicketDetails │    │ClaimsCalendar│    │  TicketsMap  │
│   (to-do)    │    │   (to-do)    │    │   (to-do)    │
└──────────────┘    └──────────────┘    └──────────────┘
```

---

## 📊 Data Flow

```
User Action
    │
    ▼
Component (e.g., TicketList)
    │
    │ import { TICKETS, filterTickets } from "@/lib/ticketData"
    │
    ▼
ticketData.ts
    │
    ├─► Raw ticket data (15+ tickets)
    ├─► Helper functions
    └─► Type definitions
    │
    ▼
Filtered/Processed Results
    │
    ▼
Display to User
```

---

## 🔄 Component Migration Flow

### Phase 1: ✅ COMPLETED
```
TicketList Component
├─ Before: 700 lines with embedded data
├─ After: 500 lines importing centralized data
└─ Status: ✅ MIGRATED
```

### Phase 2: 🔄 IN PROGRESS (Your Next Steps)
```
Priority Components
├─ WorkMap
│  └─ Replace local ticket generation
│     with: import { TICKETS } from "@/lib/ticketData"
│
├─ WorkPlanner
│  └─ Replace dummy slots with real tickets
│     with: import { filterTickets } from "@/lib/ticketData"
│
├─ TicketDetails
│  └─ Replace embedded ticket lookup
│     with: import { getTicketByNumber } from "@/lib/ticketData"
│
└─ ClaimsCalendar
   └─ Use centralized tickets for calendar
      with: import { TICKETS, filterTickets } from "@/lib/ticketData"
```

---

## 🎯 Import Patterns

### Pattern 1: Basic Import
```typescript
import { TICKETS } from "@/lib/ticketData";

function MyComponent() {
  return (
    <div>
      {TICKETS.map(ticket => (
        <div key={ticket.ticketNo}>{ticket.customer}</div>
      ))}
    </div>
  );
}
```

### Pattern 2: With Type Safety
```typescript
import { TICKETS, type Ticket } from "@/lib/ticketData";

function MyComponent() {
  const [selected, setSelected] = useState<Ticket | null>(null);
  
  return (
    <div>
      {TICKETS.map(ticket => (
        <button onClick={() => setSelected(ticket)}>
          {ticket.customer}
        </button>
      ))}
    </div>
  );
}
```

### Pattern 3: With Helper Functions
```typescript
import { 
  TICKETS, 
  filterTickets, 
  getTicketsByLocation 
} from "@/lib/ticketData";

function MyComponent() {
  const [location, setLocation] = useState("Atlanta");
  
  const locationTickets = getTicketsByLocation(location);
  
  return <div>{locationTickets.length} tickets in {location}</div>;
}
```

### Pattern 4: Advanced Filtering
```typescript
import { filterTickets } from "@/lib/ticketData";

function MyComponent() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  
  const filtered = filterTickets({
    search,
    status,
    location: "Atlanta",
    diagnosed: "Y"
  });
  
  return <div>{filtered.length} results</div>;
}
```

---

## 🗂️ File Structure

```
src/
├── lib/
│   └── ticketData.ts          ← SINGLE SOURCE OF TRUTH
│       ├── TICKETS[]          ← 15+ tickets
│       ├── interface Ticket   ← Type definition
│       ├── TICKET_SOURCES[]   ← Constants
│       ├── REPAIR_STATUS_OPTIONS[]
│       └── Helper functions
│
├── components/
│   ├── TicketList.tsx         ← ✅ Uses centralized data
│   ├── TicketsMapWorkMap.tsx  ← 🔄 To migrate
│   ├── WorkPlannerPage.tsx    ← 🔄 To migrate
│   └── ClaimCalendarWeekly.tsx← 🔄 To migrate
│
└── routes/
    └── ticket.$ticketNo.tsx   ← 🔄 To migrate
```

---

## 🔍 Ticket Object Schema

```typescript
{
  // Identity
  ticketNo: string           // "SA-3458831"
  ticketSource: string       // "LG", "NSA", etc.
  
  // Classification
  warranty: string           // "IW", "OW"
  manufacturer: string       // "IH", "Samsung", etc.
  
  // Customer
  customer: string           // "Neal Market"
  firstName: string          // "NEAL"
  lastName: string           // "MARKET"
  phone: string              // "706.817.2900"
  email?: string
  
  // Location
  city: string               // "GREENSBORO"
  location: string           // "Atlanta"
  address?: string           // "123 Main St"
  zip?: string               // "30642"
  
  // Product
  model: string              // "GNE27JYMFFS"
  
  // Service
  technician: string         // "Nathan Napora"
  status: string             // "OP-Waiting for Part"
  diagnosed: string          // "Y" or "N"
  schedule: string           // "05/21/26"
  partOrder: string          // "Part Ordered"
  
  // Tracking
  aging: number              // Days since creation
  calls: number              // Number of calls made
  created: string            // "05/18/26"
  redo: string               // "Y" or "N"
  
  // Optional
  account?: string
  branch?: string
  contact?: string
  delay?: number
  internalNote?: string
  statusChangedAt?: string
  statusChangedBy?: string
}
```

---

## 📈 Benefits Breakdown

### Before Centralization
```
Component A               Component B               Component C
├─ TICKETS[]              ├─ TICKETS[]              ├─ TICKETS[]
├─ interface Ticket       ├─ interface Ticket       ├─ interface Ticket
└─ 200 lines of data      └─ 150 lines of data      └─ 180 lines of data
    │                         │                         │
    └─────────────────────────┴─────────────────────────┘
                              ❌ Duplicated
                              ❌ Inconsistent
                              ❌ Hard to maintain
```

### After Centralization
```
                    ticketData.ts (SINGLE SOURCE)
                    ├─ TICKETS[]
                    ├─ interface Ticket
                    └─ Helper functions
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
   Component A         Component B         Component C
   ├─ 1 line import    ├─ 1 line import    ├─ 1 line import
   └─ Uses TICKETS     └─ Uses TICKETS     └─ Uses TICKETS
       │                   │                   │
       └───────────────────┴───────────────────┘
                   ✅ Single source
                   ✅ Consistent
                   ✅ Easy to maintain
```

---

## 🚀 Quick Migration Guide

### Step 1: Identify Component
```bash
# Find components with ticket data
grep -r "const.*TICKET" src/components/
grep -r "interface.*Ticket" src/components/
```

### Step 2: Add Import
```typescript
import { TICKETS, type Ticket } from "@/lib/ticketData";
```

### Step 3: Remove Local Data
```typescript
// Delete local definitions
// const TICKETS = [...]
// interface Ticket { ... }
```

### Step 4: Use Centralized Data
```typescript
const tickets = TICKETS;
```

### Step 5: Test
```bash
# Run the app and verify
npm run dev
```

---

## 📚 Documentation Files

1. **TICKET_DATA_QUICK_START.md** - Quick reference (5 min read)
2. **CENTRALIZED_TICKET_DATA.md** - Complete guide (15 min read)
3. **CENTRALIZED_TICKET_SUMMARY.md** - Implementation summary
4. **TICKET_DATA_ARCHITECTURE.md** - This file

---

## 🎓 Next Steps

1. ✅ Review this architecture document
2. ✅ Read `TICKET_DATA_QUICK_START.md`
3. 🔄 Migrate WorkMap component
4. 🔄 Migrate WorkPlanner component
5. 🔄 Migrate TicketDetails component
6. 🔄 Migrate ClaimsCalendar component
7. ✅ Update remaining components

**Goal**: All components using centralized ticket data! 🎯
