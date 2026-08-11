-- =====================================================================
-- 0152_add_employment_type.sql
--
-- Adds a Trainee/Regular employment-type classification to the Employee
-- Directory, separate from is_active (account enabled/disabled) and
-- employee_info.employmentStatus (active/inactive/terminated/resigned —
-- the Directory's own "Account Status" column).
--
-- Defaults every existing profile to 'regular' so nothing already in the
-- system is retroactively (and wrongly) marked a trainee.
--
-- Run once in the Supabase SQL Editor, after 0151. The app code reads this
-- column via a separate best-effort query (see getCompanyUsers in
-- users.ts) so nothing breaks if this hasn't been run yet — every employee
-- just shows as "Regular" until it is.
-- =====================================================================

alter table profiles add column if not exists employment_type text not null default 'regular';

alter table profiles drop constraint if exists profiles_employment_type_check;
alter table profiles add constraint profiles_employment_type_check
  check (employment_type in ('trainee', 'regular'));
