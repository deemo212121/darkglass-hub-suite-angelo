# Supabase Multi-Tenancy Migrations

## Overview

These SQL scripts enable **company-based data isolation** in Supabase by:
1. Adding `company_id` column to all tables
2. Creating indexes for performance
3. Enabling Row Level Security (RLS)
4. Creating RLS policies to enforce company isolation

## Migration Files

- `001_add_company_id.sql` - Adds company_id column and indexes
- `002_enable_rls.sql` - Enables RLS and creates security policies

## How to Run

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project: https://supabase.com/dashboard
2. Navigate to **SQL Editor** in the left sidebar
3. Click **+ New Query**
4. Copy and paste the contents of `001_add_company_id.sql`
5. Click **Run** button
6. Wait for success message
7. Repeat steps 3-6 for `002_enable_rls.sql`

### Option 2: Supabase CLI

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Run migrations
supabase db push --file supabase-migrations/001_add_company_id.sql
supabase db push --file supabase-migrations/002_enable_rls.sql
```

### Option 3: Direct PostgreSQL Connection

```bash
# Connect to your Supabase database
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Run migration files
\i supabase-migrations/001_add_company_id.sql
\i supabase-migrations/002_enable_rls.sql
```

## What These Migrations Do

### Migration 001: Add company_id Column

**Before:**
```sql
tickets
├── id
├── ticket_no
├── customer_name
└── status
```

**After:**
```sql
tickets
├── id
├── ticket_no
├── customer_name
├── status
└── company_id (new!)
```

- Adds `company_id TEXT NOT NULL DEFAULT 'COMP001'` to all tables
- Creates indexes on `company_id` for fast queries
- Existing data gets `COMP001` (AH Solutions) as default

**Tables Updated:**
- ✅ tickets
- ✅ employees
- ✅ parts
- ✅ purchase_orders
- ✅ visits
- ✅ time_cards
- ✅ payroll
- ✅ claims

### Migration 002: Enable Row Level Security

**RLS Policies Created:**

For each table, creates 4 policies:
1. **SELECT** - Users can view their company's data (or all if SUPERADMIN)
2. **INSERT** - Users can create records for their company
3. **UPDATE** - Users can update their company's data (or all if SUPERADMIN)
4. **DELETE** - Users can delete their company's data (or all if SUPERADMIN)

**How RLS Works:**

```sql
-- Example policy for tickets table
CREATE POLICY "tickets_select_policy" ON tickets
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);
```

This means:
- If user role is `SUPERADMIN` → can see ALL tickets
- Otherwise → can only see tickets where `company_id` matches their `company_id`

## Verification

After running migrations, verify they worked:

```sql
-- Check that company_id column exists
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'tickets' AND column_name = 'company_id';

-- Check that indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'tickets' AND indexname LIKE '%company%';

-- Check that RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('tickets', 'employees', 'parts', 'purchase_orders', 'visits', 'time_cards', 'payroll', 'claims');

-- Check RLS policies
SELECT tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'tickets';
```

Expected results:
- ✅ `company_id` column exists on all tables
- ✅ Indexes created: `idx_tickets_company_id`, etc.
- ✅ RLS enabled: `rowsecurity = true` for all tables
- ✅ 4 policies per table (SELECT, INSERT, UPDATE, DELETE)

## Testing

### Test 1: Create Test Data

```sql
-- Insert test tickets for different companies
INSERT INTO tickets (company_id, ticket_no, customer_name, status)
VALUES 
  ('COMP001', 'TKT-001', 'Customer A', 'open'),
  ('TEST001', 'TKT-002', 'Customer B', 'open'),
  ('TEST002', 'TKT-003', 'Customer C', 'open');
```

### Test 2: Test RLS Policies

```sql
-- As user with company_id = 'COMP001'
-- Should only see TKT-001
SELECT * FROM tickets;

-- As SUPERADMIN
-- Should see all tickets (TKT-001, TKT-002, TKT-003)
SELECT * FROM tickets;
```

## Rollback (If Needed)

If you need to undo these migrations:

```sql
-- Drop RLS policies
DROP POLICY IF EXISTS "tickets_select_policy" ON tickets;
DROP POLICY IF EXISTS "tickets_insert_policy" ON tickets;
DROP POLICY IF EXISTS "tickets_update_policy" ON tickets;
DROP POLICY IF EXISTS "tickets_delete_policy" ON tickets;
-- Repeat for other tables...

-- Disable RLS
ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
-- Repeat for other tables...

-- Drop indexes
DROP INDEX IF EXISTS idx_tickets_company_id;
-- Repeat for other tables...

-- Remove company_id column (WARNING: This deletes the column!)
ALTER TABLE tickets DROP COLUMN IF EXISTS company_id;
-- Repeat for other tables...
```

## Next Steps

After running these migrations:

1. ✅ **Update Supabase client** to pass `company_id` and `role` in JWT claims
2. ✅ **Update query functions** to include `company_id` filter
3. ✅ **Test with multiple companies** in development
4. ✅ **Deploy to production** after thorough testing

See `SUPABASE_MULTI_TENANCY.md` for full implementation guide.

## Troubleshooting

### Error: "column company_id already exists"
- This is safe to ignore. The migration uses `IF NOT EXISTS` to prevent duplicates.

### Error: "policy already exists"
- Drop the existing policy first, then re-run the migration.

### Error: "permission denied for table tickets"
- Make sure you're running as a superuser or have appropriate permissions.
- Check that your JWT contains the correct `company_id` and `role` claims.

### Data not filtering correctly
- Verify JWT claims are being passed: `SELECT current_setting('request.jwt.claims', true);`
- Check that `company_id` in JWT matches `company_id` in table
- Test with SUPERADMIN account first (should see all data)

## Support

For questions or issues:
1. Check `SUPABASE_MULTI_TENANCY.md` for detailed implementation guide
2. Review Supabase RLS documentation: https://supabase.com/docs/guides/auth/row-level-security
3. Contact development team
