-- =====================================================
-- SUPABASE ROW LEVEL SECURITY (RLS)
-- Enforces company data isolation at database level
-- =====================================================

-- Step 1: Enable RLS on all tables
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

-- Step 2: Create RLS Policies for TICKETS table

-- Allow users to view their company's tickets (or all if SUPERADMIN)
CREATE POLICY "tickets_select_policy" ON tickets
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Allow users to create tickets for their company
CREATE POLICY "tickets_insert_policy" ON tickets
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

-- Allow users to update their company's tickets
CREATE POLICY "tickets_update_policy" ON tickets
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Allow users to delete their company's tickets
CREATE POLICY "tickets_delete_policy" ON tickets
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Step 3: Create RLS Policies for EMPLOYEES table

CREATE POLICY "employees_select_policy" ON employees
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "employees_insert_policy" ON employees
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "employees_update_policy" ON employees
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "employees_delete_policy" ON employees
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Step 4: Create RLS Policies for PARTS table

CREATE POLICY "parts_select_policy" ON parts
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "parts_insert_policy" ON parts
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "parts_update_policy" ON parts
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "parts_delete_policy" ON parts
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Step 5: Create RLS Policies for PURCHASE_ORDERS table

CREATE POLICY "purchase_orders_select_policy" ON purchase_orders
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "purchase_orders_insert_policy" ON purchase_orders
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "purchase_orders_update_policy" ON purchase_orders
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "purchase_orders_delete_policy" ON purchase_orders
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Step 6: Create RLS Policies for VISITS table

CREATE POLICY "visits_select_policy" ON visits
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "visits_insert_policy" ON visits
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "visits_update_policy" ON visits
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "visits_delete_policy" ON visits
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Step 7: Create RLS Policies for TIME_CARDS table

CREATE POLICY "time_cards_select_policy" ON time_cards
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "time_cards_insert_policy" ON time_cards
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "time_cards_update_policy" ON time_cards
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "time_cards_delete_policy" ON time_cards
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Step 8: Create RLS Policies for PAYROLL table

CREATE POLICY "payroll_select_policy" ON payroll
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "payroll_insert_policy" ON payroll
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "payroll_update_policy" ON payroll
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "payroll_delete_policy" ON payroll
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Step 9: Create RLS Policies for CLAIMS table

CREATE POLICY "claims_select_policy" ON claims
FOR SELECT
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "claims_insert_policy" ON claims
FOR INSERT
WITH CHECK (
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "claims_update_policy" ON claims
FOR UPDATE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

CREATE POLICY "claims_delete_policy" ON claims
FOR DELETE
USING (
  auth.jwt() ->> 'role' = 'SUPERADMIN' OR
  company_id = auth.jwt() ->> 'company_id'
);

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Row Level Security enabled on all tables!';
  RAISE NOTICE '🔐 Users can only access their company data.';
  RAISE NOTICE '👑 SUPERADMIN can access all companies.';
  RAISE NOTICE '📝 Next step: Update application code to pass company_id in JWT.';
END $$;
