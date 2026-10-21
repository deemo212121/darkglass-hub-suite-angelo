-- REVERT Brye'shawn Butler's custom pay lines, 2026-09-27 .. 2026-10-10, to what they were
-- before regenerate-butler-custom-lines-2026-09-27_to_2026-10-10.sql ran (snapshot taken
-- from the database 2026-10-20, before the realign).
--
-- Deletes all of his custom lines for the period (including "Deduction Add-Back" /
-- "Salary Add-Back") and re-inserts the original 10 lines: commissions + Mileage, the
-- Other Deduction -$155.97 and Insurance -$57.31.
--
-- Run in the Supabase SQL Editor, then reopen his Tech Activity Report and click Done so
-- Reviewed Periods picks up the numbers again.
--
-- Expected after: Earned Toward Minimum $2,570.45, Guaranteed Minimum Salary Match $198.78,
-- Total Payment $2,725.30.

with src(label, value, rate, includable, work_week_start, sort_order) as (values
  ('Minor',           20.0,   30.0,  true,  date '2026-09-27', 0),
  ('Mileage',         169.35, 1,     false, date '2026-09-27', 1),
  ('Carryover',       5.0,    30.0,  true,  date '2026-09-27', 2),
  ('LTP Bonus',       1.0,    120.0, true,  date '2026-09-27', 3),
  ('Minor',           18.0,   30.0,  true,  date '2026-10-04', 4),
  ('Other Deduction', 155.97, -1,    false, date '2026-10-04', 5),
  ('Redo',            1.0,    -30.0, true,  date '2026-10-04', 6),
  ('Carryover',       1.0,    30.0,  true,  date '2026-10-04', 7),
  ('LTP Bonus',       1.0,    255.0, true,  date '2026-10-04', 8),
  ('Insurance',       57.31,  -1,    false, date '2026-10-04', 9)
), tech as (
  select p.id, p.company_id
  from profiles p
  where regexp_replace(lower(p.display_name), '[^a-z]', '', 'g') = 'bryeshawnbutler'
  order by p.is_active desc
  limit 1
), del as (
  delete from tech_custom_pay_items t
  using tech
  where t.profile_id = tech.id
    and t.period_start = date '2026-09-27' and t.period_end = date '2026-10-10'
  returning t.id
), ins as (
  insert into tech_custom_pay_items (company_id, profile_id, period_start, period_end, label, value, rate, sort_order, is_wage_includable, work_week_start)
  select tech.company_id, tech.id, date '2026-09-27', date '2026-10-10', s.label, s.value, s.rate, s.sort_order, s.includable, s.work_week_start
  from src s cross join tech
  returning value * rate as amount
)
select 'bryeshawnbutler' as technician,
       (select count(*) from tech)::text as profile_found,
       (select count(*) from del)::text as lines_deleted,
       (select count(*) from ins)::text as lines_inserted,
       (select round(sum(amount)::numeric, 2) from ins)::text as lines_total;  -- expect 1,621.07 (+ hourly/OT $905.45 + match $198.78 = $2,725.30)
