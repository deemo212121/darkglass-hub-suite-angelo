-- =====================================================================
-- 0030 — Link expenses to profiles (Tracking Expenses Dashboard)
--
-- expenses.employee_id references the `employees` table, but (same
-- situation as timecard_entries/pto_requests/attendance_notes before it)
-- `employees` is never populated by the app — real users live in `profiles`.
-- Adds profile_id + light review-tracking columns so the dashboard can read
-- and write real expense records against actual users.
--
-- expenses already has RLS + the company_id auto-stamp trigger from the
-- tenant_tables loop in 0001_init.sql — no policy changes needed here.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table expenses add column if not exists profile_id uuid references profiles(id) on delete cascade;
alter table expenses add column if not exists created_by uuid references profiles(id);
alter table expenses add column if not exists reviewed_by uuid references profiles(id);
alter table expenses add column if not exists reviewed_at timestamptz;
create index if not exists idx_expenses_profile on expenses(profile_id);
create index if not exists idx_expenses_status on expenses(company_id, status);
