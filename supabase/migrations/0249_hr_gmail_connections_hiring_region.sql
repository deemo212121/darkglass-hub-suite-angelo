-- Add a "HR_HIRING" connectable Gmail slot — lets HR connect a Gmail
-- account on the Hiring panel now, ahead of a candidate-email-sending
-- feature that's coming later. Same idiom as 0168/0173/0217: only the
-- table's own CHECK constraint restricts the allowed region values.

alter table hr_gmail_connections drop constraint if exists hr_gmail_connections_region_check;
alter table hr_gmail_connections add constraint hr_gmail_connections_region_check
  check (region in ('US', 'PH', 'PARTS', 'IT_1', 'IT_2', 'IT_3', 'ATTENDANCE', 'HR_HIRING'));
