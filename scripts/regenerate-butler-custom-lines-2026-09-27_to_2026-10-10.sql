-- Regenerate Brye'shawn Butler's custom pay lines, 2026-09-27 .. 2026-10-10, so the
-- Tech Activity Report total matches the salary box on his tab in
-- "Manual Tech Pay 1010p (2).xlsx": Payable $3,051.75.
--
-- Supersedes Butler's rows in regenerate-custom-lines-6-techs-2026-09-27_to_2026-10-10.sql.
--
-- Where the old $2,725.30 came from: the app's lines already matched the tab's rows
-- (commissions, LTP $120/$255, Mileage $169.35, Other Deduction -$155.97, Insurance -$57.31).
-- The difference is entirely the tab's salary box (rows 160-168):
--   Earnings before reimbursements  $2,570.45   (= wk1 $1,230.76 + wk2 $1,339.70 — same as the app)
--   Add Deduction                   + $311.95   (half of the $623.90 deduction, ADDED)
--   Total earned toward salary      $2,882.40   -> above the $2,769.23 minimum, so Match Needed $0
--   Reimbursement                   + $169.35
--   Payable                         $3,051.75   (the -$155.97 and -$57.31 tab rows are NOT taken)
-- The app instead paid a $198.78 salary match and took both deductions:
--   2,570.45 + 198.78 + 169.35 - 155.97 - 57.31 = $2,725.30.
--
-- What this does: deletes all of his custom lines for the period and re-inserts the tab's
-- commission lines and Mileage, drops the Other Deduction and Insurance lines, and adds
-- "Salary Add-Back" +$311.95 as an Includable line in Wk 9/27. Week 1 has no overtime
-- (39.0 hrs), so that line raises Earned Toward Minimum without changing any OT premium.
-- The label must not contain "deduct", "insur", "mileage", "reimburs" etc. — the Tech
-- Activity Report flips any such line to Reimbursement when it opens, which drops it out of
-- Earned Toward Minimum and gives $3,250.53 instead.
--
-- Confirmed 2026-10-20: Finance really does add the $311.95 back for Butler this period
-- (replaces the 2026-10-19 note in the 6-techs script). Neither the overpaid mileage nor
-- the insurance is taken this paycheck.
--
-- Run in the Supabase SQL Editor, then reopen his Tech Activity Report and click Done so
-- Reviewed Periods picks up the new numbers.
--
-- Expected after: Earned Toward Minimum $2,882.40, Guaranteed Minimum Salary Match $0,
-- Total Payment $3,051.75.

with src(label, value, rate, includable, work_week_start, sort_order) as (values
  ('Minor',              20.0,   30.0,  true,  date '2026-09-27', 0),
  ('Mileage',            169.35, 1,     false, date '2026-09-27', 1),
  ('Carryover',          5.0,    30.0,  true,  date '2026-09-27', 2),
  ('LTP Bonus',          1.0,    120.0, true,  date '2026-09-27', 3),
  ('Salary Add-Back',    311.95, 1,     true,  date '2026-09-27', 4),
  ('Minor',              18.0,   30.0,  true,  date '2026-10-04', 5),
  ('Redo',               1.0,    -30.0, true,  date '2026-10-04', 6),
  ('Carryover',          1.0,    30.0,  true,  date '2026-10-04', 7),
  ('LTP Bonus',          1.0,    255.0, true,  date '2026-10-04', 8)
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
       (select round(sum(amount)::numeric, 2) from ins)::text as lines_total;  -- expect 2,146.30 (+ hourly/OT $905.45 = $3,051.75)
