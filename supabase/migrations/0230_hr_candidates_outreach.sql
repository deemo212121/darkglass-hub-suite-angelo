-- Whether HR has texted/called a candidate, split AM/PM so both attempts
-- in the same day are tracked separately (either one, or both, can be
-- true at once) — new "Texted / Called" column on the Hiring table
-- (ReportHRDaily.tsx). Plain booleans on hr_candidates itself, same
-- convention as department/branch_manager_id (0229): no separate table,
-- toggled directly from the table with no popup.
alter table hr_candidates add column if not exists texted_am boolean not null default false;
alter table hr_candidates add column if not exists texted_pm boolean not null default false;
alter table hr_candidates add column if not exists called_am boolean not null default false;
alter table hr_candidates add column if not exists called_pm boolean not null default false;
