-- =====================================================
-- SUPABASE MULTI-TENANCY MIGRATION
-- Adds company_id column to all tables for data isolation
-- =====================================================

-- Step 1: Add company_id column to all tables
-- Default to 'COMP001' (AH Solutions) for existing data

ALTER TABLE tickets 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

ALTER TABLE parts 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

ALTER TABLE visits 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

ALTER TABLE time_cards 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

ALTER TABLE payroll 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

ALTER TABLE claims 
ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'COMP001';

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tickets_company_id ON tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_parts_company_id ON parts(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_id ON purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_visits_company_id ON visits(company_id);
CREATE INDEX IF NOT EXISTS idx_time_cards_company_id ON time_cards(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_company_id ON payroll(company_id);
CREATE INDEX IF NOT EXISTS idx_claims_company_id ON claims(company_id);

-- Step 3: Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tickets_company_created ON tickets(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employees_company_active ON employees(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_parts_company_available ON parts(company_id, quantity_available);

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Migration complete! All tables now have company_id column with indexes.';
  RAISE NOTICE '📊 Existing data has been assigned to COMP001 (AH Solutions).';
  RAISE NOTICE '🔐 Next step: Enable Row Level Security (run 002_enable_rls.sql)';
END $$;
