# Centralized Ticket Data - Quick Start Guide

## 🚀 Quick Import

```typescript
import { TICKETS, type Ticket } from "@/lib/ticketData";
```

---

## 📦 What's Available

| Export | Type | Description |
|--------|------|-------------|
| `TICKETS` | `Ticket[]` | Array of 15+ sample tickets |
| `Ticket` | `interface` | TypeScript type for tickets |
| `TICKET_SOURCES` | `const` | Array of ticket source options |
| `REPAIR_STATUS_OPTIONS` | `const` | Array of status options |
| `getTicketByNumber(ticketNo)` | `function` | Find ticket by number |
| `getTicketsByLocation(location)` | `function` | Filter by location |
| `getTicketsByStatus(status)` | `function` | Filter by status |
| `getTicketsByTechnician(tech)` | `function` | Filter by technician |
| `filterTickets(filters)` | `function` | Advanced filtering |

---

## ⚡ Common Use Cases

### Display All Tickets
```typescript
import { TICKETS } from "@/lib/ticketData";

{TICKETS.map(ticket => (
  <div key={ticket.ticketNo}>{ticket.customer}</div>
))}
```

### Find Specific Ticket
```typescript
import { getTicketByNumber } from "@/lib/ticketData";

const ticket = getTicketByNumber("SA-3458831");
```

### Filter by Location
```typescript
import { getTicketsByLocation } from "@/lib/ticketData";

const atlantaTickets = getTicketsByLocation("Atlanta");
```

### Search & Filter
```typescript
import { filterTickets } from "@/lib/ticketData";

const results = filterTickets({
  search: "john",
  status: "OP-Waiting for Part",
  location: "Atlanta"
});
```

### Type-Safe Ticket
```typescript
import { type Ticket } from "@/lib/ticketData";

const [ticket, setTicket] = useState<Ticket | null>(null);
```

---

## 🔧 Replace Old Ticket Data

### Before ❌
```typescript
const tickets = [
  { ticketNo: "SA-001", customer: "John", ... },
  // More tickets...
];
```

### After ✅
```typescript
import { TICKETS } from "@/lib/ticketData";

const tickets = TICKETS;
```

---

## 📍 Components Using Centralized Data

✅ **TicketList** (`src/components/TicketList.tsx`)

### Need Migration:
- WorkMap
- WorkPlanner  
- TicketDetails
- ClaimsCalendar

---

## 💡 Pro Tips

1. **Always import from `@/lib/ticketData`** - Never duplicate ticket arrays
2. **Use helper functions** - Built-in filtering is optimized
3. **Use TypeScript types** - Import `type Ticket` for type safety
4. **One source of truth** - Update tickets in one place only

---

## 🎯 Sample Ticket Object

```typescript
{
  ticketNo: "SA-3458831",
  ticketSource: "LG",
  warranty: "IW",
  manufacturer: "IH",
  customer: "Neal Market",
  firstName: "NEAL",
  lastName: "MARKET",
  city: "GREENSBORO",
  location: "Atlanta",
  address: "123 Main St",
  zip: "30642",
  phone: "706.817.2900",
  model: "GNE27JYMFFS",
  technician: "",
  diagnosed: "N",
  status: "CSR-Assigned to ASC",
  schedule: "05/21/26",
  aging: 0,
  calls: 0,
  partOrder: "Not Diagnosed",
  created: "05/18/26",
  // ... more fields
}
```

---

## 📚 Full Documentation

See `CENTRALIZED_TICKET_DATA.md` for complete documentation including:
- Full API reference
- Migration guides
- Best practices
- Testing guidelines
