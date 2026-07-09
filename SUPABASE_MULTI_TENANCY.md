# 🏢 Supabase Multi-Tenancy Implementation

## Architecture Overview

**Firebase (Authentication & Company Management):**
- `users` collection - User accounts with `companyId`
- `companies` collection - Company information

**Supabase (Operational Data):**
- All tables have `company_id` column
- Row Level Security (RLS) enforces company isolation
- Users can only see/modify their company's data

## Current Status

✅ **Firebase:** Already has `companyId` in users
✅ **Supabase:** Need to add `company_id` column to all tables

## Implementation Plan

### Phase 1: Supabase Schema Updates

#### 1.1 Add `company_id` Column to All Tables

```sql
-- Add company_id to tickets table
ALTER TABLE tickets 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Add company_id to employees table
ALTER TABLE employees 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Add company_id to parts table
ALTER TABLE parts 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Add company_id to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Add company_id to visits table
ALTER TABLE visits 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Add company_id to time_cards table
ALTER TABLE time_cards 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Add company_id to payroll table
ALTER TABLE payroll 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Add company_id to claims table
ALTER TABLE claims 
ADD COLUMN company_id TEXT NOT NULL DEFAULT 'COMP001';
```

#### 1.2 Create Indexes for Performance

```sql
-- Create indexes on company_id for fast filtering
CREATE INDEX idx_tickets_company_id ON tickets(company_id);
CREATE INDEX idx_employees_company_id ON employees(company_id);
CREATE INDEX idx_parts_company_id ON parts(company_id);
CREATE INDEX idx_purchase_orders_company_id ON purchase_orders(company_id);
CREATE INDEX idx_visits_company_id ON visits(company_id);
CREATE INDEX idx_time_cards_company_id ON time_cards(company_id);
CREATE INDEX idx_payroll_company_id ON payroll(company_id);
CREATE INDEX idx_claims_company_id ON claims(company_id);
```

### Phase 2: Supabase Row Level Security (RLS)

#### 2.1 Enable RLS on All Tables

```sql
-- Enable RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
```

#### 2.2 Create Helper Function to Get User's Company

```sql
-- Function to get user's company ID from Firebase UID
CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS TEXT AS $$
DECLARE
  user_company_id TEXT;
BEGIN
  -- Get company_id from request header (set by app)
  user_company_id := current_setting('request.jwt.claims', true)::json->>'company_id';
  RETURN user_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is SUPERADMIN
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
BEGIN
  user_role := current_setting('request.jwt.claims', true)::json->>'role';
  RETURN user_role = 'SUPERADMIN';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 2.3 Create RLS Policies

```sql
-- Tickets table policies
CREATE POLICY "Users can view their company's tickets"
  ON tickets FOR SELECT
  USING (
    is_superadmin() OR 
    company_id = get_user_company_id()
  );

CREATE POLICY "Users can create tickets for their company"
  ON tickets FOR INSERT
  WITH CHECK (
    company_id = get_user_company_id()
  );

CREATE POLICY "Users can update their company's tickets"
  ON tickets FOR UPDATE
  USING (
    is_superadmin() OR 
    company_id = get_user_company_id()
  );

CREATE POLICY "Users can delete their company's tickets"
  ON tickets FOR DELETE
  USING (
    is_superadmin() OR 
    company_id = get_user_company_id()
  );

-- Apply same pattern to all other tables
-- (employees, parts, purchase_orders, visits, time_cards, payroll, claims)
```

### Phase 3: Application Layer Updates

#### 3.1 Update Supabase Client Configuration

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { useAuth } from './auth';
import { getUserAccount } from './firebase/users';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Get Supabase client with company context
 * Sets company_id and role in JWT claims for RLS
 */
export async function getSupabaseWithContext() {
  const { uid, role } = useAuth();
  
  // Get user's company from Firebase
  const user = await getUserAccount(uid);
  const companyId = user?.companyId;
  
  // Set custom claims for RLS
  await supabase.rpc('set_claims', {
    claims: {
      company_id: companyId,
      role: role,
      uid: uid
    }
  });
  
  return supabase;
}
```

#### 3.2 Update Query Functions to Include company_id

```typescript
// src/lib/queries/tickets.ts
import { supabase } from '../supabase';
import { useCompanyContext } from '../hooks/useCompanyContext';

/**
 * Get tickets with automatic company filtering
 */
export async function getTickets() {
  const { companyId, isSuperAdmin } = useCompanyContext();
  
  let query = supabase
    .from('tickets')
    .select('*')
    .order('created_at', { ascending: false });
  
  // If not SUPERADMIN, filter by company
  if (!isSuperAdmin && companyId) {
    query = query.eq('company_id', companyId);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data;
}

/**
 * Create ticket with company_id
 */
export async function createTicket(ticketData: any) {
  const { companyId } = useCompanyContext();
  
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      ...ticketData,
      company_id: companyId // Automatically add company
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Update ticket (RLS ensures only same company can update)
 */
export async function updateTicket(ticketId: string, updates: any) {
  const { data, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}
```

#### 3.3 Create Similar Functions for All Tables

Create query files for each table:
- `src/lib/queries/tickets.ts` ✅
- `src/lib/queries/employees.ts`
- `src/lib/queries/parts.ts`
- `src/lib/queries/purchaseOrders.ts`
- `src/lib/queries/visits.ts`
- `src/lib/queries/timeCards.ts`
- `src/lib/queries/payroll.ts`
- `src/lib/queries/claims.ts`

### Phase 4: Component Updates

#### 4.1 Wrap App in CompanyProvider

```typescript
// src/App.tsx or src/routes/__root.tsx
import { CompanyProvider } from '@/lib/hooks/useCompanyContext';

function App() {
  return (
    <AuthProvider>
      <CompanyProvider>
        {/* Rest of app */}
      </CompanyProvider>
    </AuthProvider>
  );
}
```

#### 4.2 Update Components to Use Company Context

```typescript
// Example: TicketList component
import { useCompanyContext } from '@/lib/hooks/useCompanyContext';
import { getTickets } from '@/lib/queries/tickets';

function TicketList() {
  const { companyId, isSuperAdmin, loading } = useCompanyContext();
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    async function loadTickets() {
      // Automatically filtered by company (or all if SUPERADMIN)
      const data = await getTickets();
      setTickets(data);
    }
    
    if (!loading) {
      loadTickets();
    }
  }, [companyId, loading]);

  return (
    <div>
      {isSuperAdmin && (
        <div className="bg-purple-500/20 p-2 mb-4 rounded">
          🔓 SUPERADMIN: Viewing all companies' tickets
        </div>
      )}
      {/* Render tickets */}
    </div>
  );
}
```

### Phase 5: Testing Strategy

#### Test Case 1: Create Test Companies in Firebase

```typescript
// Run from Firebase console or setup script
const testCompanies = [
  {
    companyId: 'COMP001',
    companyName: 'AH Solutions',
    email: 'info@ahsolutions.com'
  },
  {
    companyId: 'TEST001',
    companyName: 'Test Company A',
    email: 'info@testcompanya.com'
  },
  {
    companyId: 'TEST002',
    companyName: 'Test Company B',
    email: 'info@testcompanyb.com'
  }
];
```

#### Test Case 2: Create Test Admin Users

```typescript
// Create admins for each company
const testAdmins = [
  {
    email: 'admin@testcompanya.com',
    password: 'testpass123',
    displayName: 'Admin A',
    companyId: 'TEST001',
    role: 'ADMIN'
  },
  {
    email: 'admin@testcompanyb.com',
    password: 'testpass123',
    displayName: 'Admin B',
    companyId: 'TEST002',
    role: 'ADMIN'
  }
];
```

#### Test Case 3: Create Test Data in Supabase

```sql
-- Insert test tickets for different companies
INSERT INTO tickets (company_id, ticket_no, customer_name, status)
VALUES 
  ('TEST001', 'TKT-A001', 'Customer A1', 'open'),
  ('TEST001', 'TKT-A002', 'Customer A2', 'open'),
  ('TEST002', 'TKT-B001', 'Customer B1', 'open'),
  ('TEST002', 'TKT-B002', 'Customer B2', 'open');
```

#### Test Case 4: Verify Data Isolation

1. **Login as Admin A** (TEST001)
   - ✅ Should see TKT-A001, TKT-A002
   - ❌ Should NOT see TKT-B001, TKT-B002
   - ✅ Can create tickets with company_id = TEST001
   - ❌ Cannot access /ticket/TKT-B001 URL

2. **Login as Admin B** (TEST002)
   - ✅ Should see TKT-B001, TKT-B002
   - ❌ Should NOT see TKT-A001, TKT-A002
   - ✅ Can create tickets with company_id = TEST002
   - ❌ Cannot access /ticket/TKT-A001 URL

3. **Login as SUPERADMIN**
   - ✅ Should see all tickets (A and B)
   - ✅ Can access any ticket URL
   - ✅ Can create tickets for any company

### Phase 6: Migration Checklist

#### ✅ Pre-Migration
- [ ] Backup Supabase database
- [ ] Test in development environment
- [ ] Create rollback plan
- [ ] Document current data state

#### ✅ Migration Steps
1. [ ] Add `company_id` column to all tables (with default 'COMP001')
2. [ ] Create indexes on `company_id`
3. [ ] Enable RLS on all tables
4. [ ] Create RLS policies
5. [ ] Test RLS policies with test users
6. [ ] Update application code
7. [ ] Test end-to-end with multiple companies
8. [ ] Deploy to production

#### ✅ Post-Migration
- [ ] Verify data isolation
- [ ] Monitor for errors
- [ ] Update documentation
- [ ] Train users on new company structure

## Summary

### Data Flow

```
1. User logs in via Firebase Auth
   ↓
2. Firebase returns user profile with companyId
   ↓
3. CompanyProvider sets company context
   ↓
4. Supabase queries automatically filter by company_id
   ↓
5. User only sees their company's data
```

### Benefits

✅ **Simple Architecture** - Firebase for auth, Supabase for data
✅ **Database-Level Security** - RLS enforces isolation
✅ **Easy to Scale** - Add companies without code changes
✅ **Performance** - Indexed queries on company_id
✅ **Clear Separation** - Auth vs operational data

### Next Steps

1. **Run SQL migrations** on Supabase (add company_id columns)
2. **Enable RLS** and create policies
3. **Update query functions** to include company_id
4. **Test with multiple companies**
5. **Deploy to production**

---

**Status**: 📋 Ready to Implement
**Timeline**: 2-3 days
**Complexity**: Medium (database changes + app updates)
