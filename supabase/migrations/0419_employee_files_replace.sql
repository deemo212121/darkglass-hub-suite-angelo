-- =====================================================================
-- 0419 — Employee files: replacing a paystub with a corrected one.
--
-- Accounting → Paystubs → Uploaded files → Replace: the corrected PDF
-- becomes a new published row for the same person and pay date with
-- replaces_id pointing at the old one; the old row turns 'replaced'
-- (kept for the record, hidden from the employee — the 0418 select
-- policies only show them 'published'). The employee's My Files tags
-- the new one "Corrected".
--
-- Columns and the status check only — no data changes. Safe to run again.
-- Run once in the Supabase SQL Editor (Run without RLS), after 0418.
-- =====================================================================

alter table employee_files add column if not exists replaces_id uuid references employee_files(id) on delete set null;
alter table employee_files add column if not exists replaced_at timestamptz;
alter table employee_files add column if not exists replaced_by_name text;

alter table employee_files drop constraint if exists employee_files_status_check;
alter table employee_files add constraint employee_files_status_check
  check (status in ('unassigned', 'published', 'withdrawn', 'replaced'));

create index if not exists employee_files_replaces_idx on employee_files (replaces_id);
