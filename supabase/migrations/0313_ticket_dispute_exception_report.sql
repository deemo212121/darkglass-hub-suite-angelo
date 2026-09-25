-- =====================================================================
-- 0305_ticket_dispute_exception_report.sql
--
-- Folds the "Employee Attendance & Visit Exception Report" paper form into
-- Ticket Time Dispute submissions too — same treatment migration 0304 gave
-- Time Correction Request, plus two dispute-specific additions: a
-- "Customer / Job Details" block (customer_name/scheduled_time/action_taken)
-- and the report itself using "Missed Customer Appointment / Home Visit" as
-- the natural default exception type.
--
-- employee_requests is a shared table (attendance_dispute/payroll_inquiry/
-- payroll_dispute/ticket_time_dispute all live here — see
-- employeeRequests.ts's own header comment) — these columns are only ever
-- populated on ticket_time_dispute rows, same as how ticket_no/
-- disputed_start_time/disputed_end_time already work for this same request
-- type alongside completely unrelated columns for the other three.
--
-- hr_paperwork_status/hr_signature_* are independent of `status` (the
-- existing single-stage approve/reject that writes the claimed time onto
-- the ticket) for the same reason migration 0304 kept them independent of
-- timecard_corrections' hr_status: the paperwork's HR sign-off is a
-- separate, deliberate act, not implied by whoever approved the dispute.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table employee_requests add column if not exists exception_type text
  check (exception_type in ('missed_workday','late_early','missed_visit','other'));
alter table employee_requests add column if not exists other_description text;

-- Ticket-dispute-only "Customer / Job Details (If applicable)" block.
alter table employee_requests add column if not exists exception_customer_name text;
alter table employee_requests add column if not exists exception_scheduled_time text;
alter table employee_requests add column if not exists exception_action_taken text;

alter table employee_requests add column if not exists employee_signature_url text;
alter table employee_requests add column if not exists employee_signature_name text;
alter table employee_requests add column if not exists employee_signed_at timestamptz;

alter table employee_requests add column if not exists manager_comments text;
alter table employee_requests add column if not exists manager_signature_url text;
alter table employee_requests add column if not exists manager_signature_name text;
alter table employee_requests add column if not exists manager_signed_at timestamptz;

alter table employee_requests add column if not exists hr_paperwork_status text not null default 'pending'
  check (hr_paperwork_status in ('pending','approved','additional_review_required'));
alter table employee_requests add column if not exists hr_signature_url text;
alter table employee_requests add column if not exists hr_signature_name text;
alter table employee_requests add column if not exists hr_signed_at timestamptz;
alter table employee_requests add column if not exists hr_received_date date;
alter table employee_requests add column if not exists hr_reviewer_name text;

alter table employee_requests add column if not exists pdf_url text;
