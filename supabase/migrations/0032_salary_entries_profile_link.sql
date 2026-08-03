-- =====================================================================
-- 0032 — Link salary_entries to profiles (Payroll / Accounting Dashboard)
--
-- salary_entries.employee_id references the `employees` table, but (same
-- situation as timecard_entries/pto_requests/attendance_notes/expenses
-- before it) `employees` is never populated by the app — real users live
-- in `profiles`. Adds profile_id so rate-change history can be read and
-- written against actual users, enabling: (a) an accurate current hourly
-- rate per employee, (b) a full history of raises/promotions, and (c)
-- correct day-by-day payroll math when a rate changes mid-period.
--
-- salary_entries already has RLS + the company_id auto-stamp trigger from
-- the tenant_tables loop in 0001_init.sql — no policy changes needed here.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table salary_entries alter column employee_id drop not null;
alter table salary_entries add column if not exists profile_id uuid references profiles(id) on delete cascade;
create index if not exists idx_salary_entries_profile on salary_entries(profile_id, effective_date desc);
