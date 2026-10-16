-- =====================================================================
-- 0383 — Workweek on a tech custom pay line. FLSA sets the regular rate
-- (and so the OT premium) per WORKWEEK, even on a biweekly payroll. The
-- Tech Activity Report's custom lines (commission, ticket pay while ticket
-- data isn't live, etc.) were period-wide, so AccountingDashboard.tsx could
-- only compute one blended rate for the whole period — e.g. Abraham Im
-- 9/13–9/26: $16.44 blended vs. the workbook's $14.49 (wk 1) / $18.34
-- (wk 2), $1.15 short on the OT premium.
--
-- work_week_start = the Sunday of the week the line was earned in. Null =
-- not tied to a week; that pay is spread over the period's weeks by hours
-- (the same result as the old period-wide calc).
-- Run once in the Supabase SQL Editor, after 0382. (Numbered 0373 in
-- janeyyy16's repo — renumbered here past this repo's own 0373;
-- already applied to the shared database 2026-10-14.)
-- =====================================================================

alter table tech_custom_pay_items add column if not exists work_week_start date;

alter table tech_custom_pay_items drop constraint if exists tech_custom_pay_items_work_week_sunday;
alter table tech_custom_pay_items add constraint tech_custom_pay_items_work_week_sunday
  check (work_week_start is null or extract(dow from work_week_start) = 0);
