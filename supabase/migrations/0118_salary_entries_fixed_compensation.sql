-- =====================================================================
-- 0118 — Fixed/annual salary employees
--
-- Some employees are paid a fixed annual salary instead of hourly ×
-- hours worked. Rather than a separate table, this extends the existing
-- effective-dated salary_entries history (same reasoning as hourly rates:
-- a salaried employee's annual salary can also change over time, e.g. a
-- raise, and payroll math needs to know which one was in effect on a
-- given day) with a compensation_type discriminator and an annual_salary
-- amount, alongside the existing hourly_rate column.
--
-- compensation_type defaults to 'hourly' for every existing row, so
-- nothing about current payroll math changes until Finance explicitly
-- adds a 'fixed' entry for someone via the Add Rate Change form.
--
-- Per-cutoff pay for a 'fixed' entry is always annual_salary / 24 (the
-- common semi-monthly "1st–15th / 16th–end" cutoff convention) regardless
-- of the exact date range a payroll run happens to cover, and is not
-- reduced for absences/PTO or increased for overtime — see
-- src/lib/supabase/salary.ts's perCutoffSalary().
--
-- Run once in the Supabase SQL Editor, after 0117.
-- =====================================================================

alter table salary_entries add column if not exists compensation_type text not null default 'hourly' check (compensation_type in ('hourly', 'fixed'));
alter table salary_entries add column if not exists annual_salary numeric;
