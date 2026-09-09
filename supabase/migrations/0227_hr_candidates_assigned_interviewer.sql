-- Which HR person is running a candidate's interview process — new
-- "Assigned Interviewer" column on the Hiring table (ReportHRDaily.tsx),
-- a dropdown of real HR-role profiles. Same manual-override convention as
-- branch_manager_id (0225): a plain nullable FK, set/cleared straight from
-- the table, no separate assignment table needed for one field.
alter table hr_candidates add column if not exists assigned_interviewer_id uuid references profiles(id) on delete set null;
