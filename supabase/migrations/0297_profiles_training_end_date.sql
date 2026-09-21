-- =====================================================================
-- 0297 — profiles.training_end_date
--
-- Trainee status ("employment_type = 'trainee'") is a single, permanent
-- flag on the profile today — it can't express "was a trainee from hire
-- through 9/9, then graduated," which is exactly what the trainee daily
-- $100 guarantee needs (Bryson Baize: hired 9/1 as a trainee, graduated
-- 9/9 — his 9/10+ days must NOT get the guarantee).
--
-- training_end_date closes that window: a trainee day for payroll
-- purposes is any day from the profile's hireDate (employee_info.hireDate)
-- through this date, inclusive. Null means "not a trainee" (or "trainee
-- with no end date set yet" — treated as not-yet-eligible for the
-- guarantee until Accounting sets it, same as any other unset field).
--
-- Run once in the Supabase SQL Editor, after 0290.
-- =====================================================================

alter table profiles
  add column if not exists training_end_date date;
