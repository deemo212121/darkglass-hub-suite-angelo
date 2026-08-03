# 🏢 Multi-Tenancy Implementation Plan

## Overview

Implement **company-based data isolation** where:
- Each company's data is completely separate
- Admin users can only see their company's data
- SUPERADMIN can see all companies' data
- All resources (tickets, parts, employees, etc.) belong to a specific company

## Architecture

### Data Model Changes

All collections must include a `companyId` field:

```
tickets/{ticketId}
  - companyId: "COMP001"
  - ticketNo: "TKT-12345"
  - customer: {...}
  - ...

employees/{employeeId}
  - companyId: "COMP001"
  - name: "John Doe"
  - ...

parts/{partId}
  - companyId: "COMP001"
  - partNumber: "P12345"
  - ...

purchaseOrders/{poId}
  - companyId: "COMP001"
  - poNumber: "PO-2024-001"
  - ...

visits/{visitId}
  - companyId: "COMP001"
  - ticketNo: "TKT-12345"
  - ...
```

### Access Control Logic

```typescript
// Get current user's company
const currentUser = await getUserAccount(uid);
const userCompanyId = currentUser.companyId;

// SUPERADMIN can access all companies
if (currentUser.role === "SUPERADMIN") {
  // No company filter needed
  const allTickets = await getAllTickets();
} else {
  // Filter by user's company
  const companyTickets = await getTicketsByCompany(userCompanyId);
}
```

## Implementation Steps

### Phase 1: Database Schema Updates

#### 1.1 Add `companyId` to Existing Collections

**Collections to Update:**
- ✅ `users` - Already has `companyId`
- ✅ `companies` - Already has `companyId`
- ⚠️ `tickets` - Needs `companyId` field
- ⚠️ `employees` - Needs `companyId` field
- ⚠️ `parts` - Needs `companyId` field
- ⚠️ `purchaseOrders` - Needs `companyId` field
- ⚠️ `visits` - Needs `companyId` field
- ⚠️ `timeCards` - Needs `companyId` field
- ⚠️ `payroll` - Needs `companyId` field

#### 1.2 Migration Script for Existing Data

```typescript
// scripts/add-company-id-migration.ts
import { db } from './firebase/config';
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';

const DEFAULT_COMPANY_ID = 'COMP001'; // AH Solutions

async function migrateCollection(collectionName: string) {
  const snapshot = await getDocs(collection(db, collectionName));
  
  for (const document of snapshot.docs) {
    if (!document.data().companyId) {
      await updateDoc(doc(db, collectionName, document.id), {
        companyId: DEFAULT_COMPANY_ID
      });
      console.log(`✅ Added companyId to ${collectionName}/${document.id}`);
    }
  }
}

// Run migration
async function runMigration() {
  await migrateCollection('tickets');
  await migrateCollection('employees');
  await migrateCollection('parts');
  await migrateCollection('purchaseOrders');
  await migrateCollection('visits');
  await migrateCollection('timeCards');
  await migrateCollection('payroll');
  console.log('✅ Migration complete!');
}
```

### Phase 2: Create Company Context Provider

#### 2.1 Company Context Hook

```typescript
// src/lib/hooks/useCompanyContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { getUserAccount } from '@/lib/firebase/users';

interface CompanyContext {
  companyId: string | null;
  isSuperAdmin: boolean;
  loading: boolean;
}

const CompanyContext = createContext<CompanyContext>({
  companyId: null,
  isSuperAdmin: false,
  loading: true,
});

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { uid, role } = useAuth();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCompanyContext() {
      if (!uid) {
        setCompanyId(null);
        setLoading(false);
        return;
      }

      // SUPERADMIN can see all companies
      if (role === 'SUPERADMIN') {
        setCompanyId(null); // null = all companies
        setLoading(false);
        return;
      }

      // Get user's company
      const user = await getUserAccount(uid);
      if (user) {
        setCompanyId(user.companyId);
      }
      setLoading(false);
    }

    loadCompanyContext();
  }, [uid, role]);

  return (
    <CompanyContext.Provider 
      value={{ 
        companyId, 
        isSuperAdmin: role === 'SUPERADMIN',
        loading 
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanyContext() {
  return useContext(CompanyContext);
}
```

### Phase 3: Update Firestore Query Functions

#### 3.1 Create Company-Aware Query Functions

```typescript
// src/lib/firebase/tickets.ts
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from './config';

/**
 * Get tickets for a specific company
 */
export async function getTicketsByCompany(companyId: string) {
  const ticketsRef = collection(db, 'tickets');
  const q = query(
    ticketsRef,
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data());
}

/**
 * Get all tickets (SUPERADMIN only)
 */
export async function getAllTickets() {
  const ticketsRef = collection(db, 'tickets');
  const q = query(ticketsRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data());
}

/**
 * Get tickets with company filtering
 */
export async function getTickets(companyId?: string | null) {
  // If no companyId, get all (SUPERADMIN)
  if (!companyId) {
    return getAllTickets();
  }
  
  // Otherwise, filter by company
  return getTicketsByCompany(companyId);
}
```

#### 3.2 Apply Same Pattern to All Collections

Create similar functions for:
- `src/lib/firebase/employees.ts`
- `src/lib/firebase/parts.ts`
- `src/lib/firebase/purchaseOrders.ts`
- `src/lib/firebase/visits.ts`
- `src/lib/firebase/timeCards.ts`
- `src/lib/firebase/payroll.ts`

### Phase 4: Update UI Components

#### 4.1 Update Data Loading in Components

**Before (no company filtering):**
```typescript
useEffect(() => {
  const loadTickets = async () => {
    const tickets = await getAllTickets();
    setTickets(tickets);
  };
  loadTickets();
}, []);
```

**After (with company filtering):**
```typescript
const { companyId, isSuperAdmin } = useCompanyContext();

useEffect(() => {
  const loadTickets = async () => {
    // Automatically filters by company (or all if SUPERADMIN)
    const tickets = await getTickets(companyId);
    setTickets(tickets);
  };
  loadTickets();
}, [companyId]);
```

#### 4.2 Update Data Creation Functions

**Add companyId when creating new records:**

```typescript
// Before
const createTicket = async (ticketData) => {
  await addDoc(collection(db, 'tickets'), {
    ...ticketData,
    createdAt: serverTimestamp()
  });
};

// After
const createTicket = async (ticketData) => {
  const { companyId } = useCompanyContext();
  
  await addDoc(collection(db, 'tickets'), {
    ...ticketData,
    companyId: companyId, // Add company ID
    createdAt: serverTimestamp()
  });
};
```

### Phase 5: Firestore Security Rules

#### 5.1 Update Security Rules for Company Isolation

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is SUPERADMIN
    function isSuperAdmin() {
      return request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "SUPERADMIN";
    }
    
    // Helper function to check if user belongs to the same company
    function isSameCompany(companyId) {
      return request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.companyId == companyId;
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow write: if isSuperAdmin();
    }
    
    // Companies collection
    match /companies/{companyId} {
      allow read: if request.auth != null;
      allow write: if isSuperAdmin();
    }
    
    // Tickets collection
    match /tickets/{ticketId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow create: if request.auth != null && 
        isSameCompany(request.resource.data.companyId);
      allow update, delete: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
    }
    
    // Employees collection
    match /employees/{employeeId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow create: if request.auth != null && 
        isSameCompany(request.resource.data.companyId);
      allow update, delete: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
    }
    
    // Parts collection
    match /parts/{partId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow create: if request.auth != null && 
        isSameCompany(request.resource.data.companyId);
      allow update, delete: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
    }
    
    // Purchase Orders collection
    match /purchaseOrders/{poId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow create: if request.auth != null && 
        isSameCompany(request.resource.data.companyId);
      allow update, delete: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
    }
    
    // Visits collection
    match /visits/{visitId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow create: if request.auth != null && 
        isSameCompany(request.resource.data.companyId);
      allow update, delete: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
    }
    
    // Time Cards collection
    match /timeCards/{timeCardId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow create: if request.auth != null && 
        isSameCompany(request.resource.data.companyId);
      allow update, delete: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
    }
    
    // Payroll collection
    match /payroll/{payrollId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
      allow create: if request.auth != null && 
        isSameCompany(request.resource.data.companyId);
      allow update, delete: if request.auth != null && (
        isSuperAdmin() ||
        isSameCompany(resource.data.companyId)
      );
    }
  }
}
```

### Phase 6: Update LocalStorage/Dummy Data (Temporary)

Until full Firestore migration is complete, update dummy data functions:

```typescript
// src/lib/dummyData.ts
import { useCompanyContext } from './hooks/useCompanyContext';

export function getFilteredTickets() {
  const { companyId, isSuperAdmin } = useCompanyContext();
  
  // If SUPERADMIN, return all
  if (isSuperAdmin) {
    return ALL_TICKETS;
  }
  
  // Filter by company
  return ALL_TICKETS.filter(ticket => 
    ticket.companyId === companyId
  );
}
```

## Testing Plan

### Test Case 1: Company A Admin Login
1. Create Company A (COMPA001)
2. Create Admin A for Company A
3. Log in as Admin A
4. ✅ Should only see Company A data
5. ✅ Should not see Company B data
6. ✅ Created tickets should have companyId = COMPA001

### Test Case 2: Company B Admin Login
1. Create Company B (COMPB002)
2. Create Admin B for Company B
3. Log in as Admin B
4. ✅ Should only see Company B data
5. ✅ Should not see Company A data
6. ✅ Created tickets should have companyId = COMPB002

### Test Case 3: SUPERADMIN Login
1. Log in as SUPERADMIN
2. ✅ Should see all companies' data
3. ✅ Can create data for any company
4. ✅ Can view/edit tickets from all companies

### Test Case 4: Data Isolation
1. Admin A creates ticket T1 (companyId: COMPA001)
2. Admin B logs in
3. ✅ Admin B cannot see ticket T1
4. ✅ Admin B cannot access /ticket/T1 URL
5. ✅ Firestore security rules block access

## Rollout Plan

### Week 1: Preparation
- [ ] Audit all data collections
- [ ] Create migration scripts
- [ ] Create company context provider
- [ ] Update Firestore functions

### Week 2: Backend Implementation
- [ ] Run data migration (add companyId to existing data)
- [ ] Deploy Firestore security rules to TEST environment
- [ ] Test security rules thoroughly
- [ ] Update all query functions

### Week 3: Frontend Implementation
- [ ] Wrap app in CompanyProvider
- [ ] Update all components to use useCompanyContext
- [ ] Add companyId to all create operations
- [ ] Test UI with multiple companies

### Week 4: Testing & Deployment
- [ ] End-to-end testing with 3+ companies
- [ ] Security testing (attempt cross-company access)
- [ ] Performance testing
- [ ] Deploy to PRODUCTION

## Benefits

✅ **Data Security** - Companies can't see each other's data
✅ **Compliance** - Meets data isolation requirements
✅ **Scalability** - Easy to onboard new companies
✅ **Performance** - Queries are filtered by companyId (indexed)
✅ **Multi-tenancy** - One codebase, multiple companies

## Risks & Mitigation

⚠️ **Risk**: Existing data without companyId
✅ **Mitigation**: Migration script assigns default COMP001

⚠️ **Risk**: Breaking existing localStorage data
✅ **Mitigation**: Gradual Firestore migration, keep localStorage as fallback

⚠️ **Risk**: Performance with large company counts
✅ **Mitigation**: Firestore indexes on companyId + createdAt

⚠️ **Risk**: Accidental data leakage
✅ **Mitigation**: Strict Firestore security rules + comprehensive testing

## Next Steps

1. **Review this plan** with the team
2. **Create migration scripts** for existing data
3. **Implement CompanyProvider** in the app
4. **Update one module at a time** (start with tickets)
5. **Test thoroughly** before deploying to production

---

**Status**: 📋 Planning Phase
**Owner**: Development Team
**Timeline**: 4 weeks
**Priority**: 🔴 High (Security & Data Isolation)
