-- Revert migration 0394 (salary_entries "guaranteed" compensation type), which was
-- run on 2026-10-20 and then dropped in favour of an automatic rule: for a
-- technician-tier person with an hourly rate on file, a Fixed Salary entry IS the
-- guaranteed minimum (src/lib/supabase/salary.ts fixedSalaryIsGuarantee). No
-- separate type needed.
--
-- 0394 converted 10 Fixed entries to 'guaranteed'. Neither the deployed app nor the
-- new rule reads 'guaranteed' rows as a guarantee, so until this runs those 10
-- technicians have no salary floor: Nocona Detten, Chris Simpson, Daven Hodge,
-- LaShamus Dowell, Brye'shawn Butler, Erick Guzman, Danny Thornton, Alexxis Henry,
-- Matthew Nichols, Matt Simmons.
--
-- Run in the Supabase SQL Editor. Safe to run more than once.

update salary_entries
set compensation_type = 'fixed'
where compensation_type = 'guaranteed';

alter table salary_entries drop constraint if exists salary_entries_compensation_type_check;
alter table salary_entries
  add constraint salary_entries_compensation_type_check
  check (compensation_type in ('hourly', 'fixed'));

-- Check: expect 0 'guaranteed' rows, and the 10 names above back on Fixed.
select p.display_name, s.compensation_type, s.effective_date, s.annual_salary
from salary_entries s join profiles p on p.id = s.profile_id
where s.compensation_type = 'fixed'
order by p.display_name;
