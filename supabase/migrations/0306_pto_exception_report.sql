-- =====================================================================
-- 0306_pto_exception_report.sql
--
-- Folds the "Employee Attendance & Visit Exception Report" paper form into
-- Sick Leave and Unpaid Leave requests too — same treatment migrations 0304
-- (Time Correction) and 0305 (Ticket Time Dispute) already gave their own
-- request types. Reuses the exact same field/section shape as Time
-- Correction's version (no "Customer / Job Details" block — that's a
-- Ticket Time Dispute-only addition).
--
-- pto_requests is shared by every leave type (vacation/sick/personal/
-- holiday/unpaid/bereavement — see pto.ts's own header comment); these
-- columns are only ever populated on sick/unpaid rows, submitted through
-- EmployeeSelfServicePage.tsx's own Sick Leave Request / Unpaid Leave
-- Request modals specifically. Vacation PTO is NOT part of this — the user
-- only asked for Sick Leave and Unpaid Leave.
--
-- hr_paperwork_status/hr_signature_* are independent of pto_requests'
-- existing hr_status (the manager-then-HR-OR-Accounting quorum vote) for
-- the same reason migrations 0304/0305 kept them independent there:
-- Accounting can cast the quorum's second vote without an actual HR person
-- ever touching it, but the paper form's HR sign-off needs a real HR
-- person specifically.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table pto_requests add column if not exists exception_type text
  check (exception_type in ('missed_workday','late_early','missed_visit','other'));
alter table pto_requests add column if not exists other_description text;

alter table pto_requests add column if not exists employee_signature_url text;
alter table pto_requests add column if not exists employee_signature_name text;
alter table pto_requests add column if not exists employee_signed_at timestamptz;

alter table pto_requests add column if not exists manager_comments text;
alter table pto_requests add column if not exists manager_signature_url text;
alter table pto_requests add column if not exists manager_signature_name text;
alter table pto_requests add column if not exists manager_signed_at timestamptz;

alter table pto_requests add column if not exists hr_paperwork_status text not null default 'pending'
  check (hr_paperwork_status in ('pending','approved','additional_review_required'));
alter table pto_requests add column if not exists hr_signature_url text;
alter table pto_requests add column if not exists hr_signature_name text;
alter table pto_requests add column if not exists hr_signed_at timestamptz;
alter table pto_requests add column if not exists hr_received_date date;
alter table pto_requests add column if not exists hr_reviewer_name text;

alter table pto_requests add column if not exists pdf_url text;
