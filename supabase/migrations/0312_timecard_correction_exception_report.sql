-- =====================================================================
-- 0304_timecard_correction_exception_report.sql
--
-- Folds the "Employee Attendance & Visit Exception Report" paper form
-- directly into the existing Time Correction Request flow instead of a
-- separate document type — every correction now carries an exception type,
-- the employee's own signature at submission, the reviewing manager's
-- signature (captured the moment they click Approve), and a SEPARATE HR
-- paperwork sign-off track.
--
-- hr_paperwork_status/hr_signature_* are deliberately independent of the
-- existing hr_status column (0098_timecard_correction_two_stage_approval.sql,
-- quorum updated by 0270_timecard_correction_two_of_three_quorum.sql):
-- hr_status is one of three interchangeable quorum votes (Manager/HR/
-- Accounting, any 2 of 3 approves the correction itself), but the paper
-- form's HR sign-off must come from an actual HR person specifically —
-- Accounting casting the quorum's second vote must not silently count as
-- HR having signed the paperwork. So a correction can be fully APPLIED
-- (Manager + Accounting quorum) while its paperwork sits at
-- hr_paperwork_status = 'pending' until a real HR person signs it
-- separately — see ExceptionVisitReportsTab.tsx, which exists specifically
-- to catch that case.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table timecard_corrections add column if not exists exception_type text
  check (exception_type in ('missed_workday','late_early','missed_visit','other'));
alter table timecard_corrections add column if not exists other_description text;

alter table timecard_corrections add column if not exists employee_signature_url text;
alter table timecard_corrections add column if not exists employee_signature_name text;
alter table timecard_corrections add column if not exists employee_signed_at timestamptz;

alter table timecard_corrections add column if not exists manager_comments text;
alter table timecard_corrections add column if not exists manager_signature_url text;
alter table timecard_corrections add column if not exists manager_signature_name text;
alter table timecard_corrections add column if not exists manager_signed_at timestamptz;

alter table timecard_corrections add column if not exists hr_paperwork_status text not null default 'pending'
  check (hr_paperwork_status in ('pending','approved','additional_review_required'));
alter table timecard_corrections add column if not exists hr_signature_url text;
alter table timecard_corrections add column if not exists hr_signature_name text;
alter table timecard_corrections add column if not exists hr_signed_at timestamptz;
alter table timecard_corrections add column if not exists hr_received_date date;
alter table timecard_corrections add column if not exists hr_reviewer_name text;

alter table timecard_corrections add column if not exists pdf_url text;
