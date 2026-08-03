-- =====================================================================
-- 0033 — Link payroll_line_items to profiles (Accounting Dashboard)
--
-- payroll_line_items.employee_id is a hard NOT NULL foreign key to the
-- `employees` table, which the app never populates — real users live in
-- `profiles`. As written, AccountingDashboard.tsx's generatePayroll() would
-- fail on insert with a foreign-key violation the moment payroll_rows
-- carries a real profile id instead of an employees.id.
--
-- payroll_line_items already has RLS + the company_id auto-stamp trigger
-- from the tenant_tables loop in 0001_init.sql — no policy changes needed.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table payroll_line_items alter column employee_id drop not null;
alter table payroll_line_items add column if not exists profile_id uuid references profiles(id) on delete cascade;
create index if not exists idx_payroll_line_items_profile on payroll_line_items(profile_id);
