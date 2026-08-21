-- =====================================================================
-- 0185 — Structured fields for payroll_dispute requests (migration
-- 0184), alongside the existing free-text `details` (now used as the
-- dispute's "Explanation" field). All nullable — attendance_dispute and
-- payroll_inquiry rows never populate these.
--
-- `attachments` holds supporting documents uploaded to Firebase Storage
-- (companies/{companyId}/payroll-disputes/{key}/ — see
-- uploadPayrollDisputeAttachment in storage.ts), as a JSON array of
-- {url, name}, not a separate table — a handful of files per dispute at
-- most, same reasoning tech_manual_pay_items' single-row-per-period took.
--
-- Run once in the Supabase SQL Editor, after 0184.
-- =====================================================================

alter table employee_requests add column if not exists pay_period text;
alter table employee_requests add column if not exists total_received numeric;
alter table employee_requests add column if not exists total_expected numeric;
alter table employee_requests add column if not exists missing_amount numeric;
alter table employee_requests add column if not exists dispute_reason text;
alter table employee_requests add column if not exists attachments jsonb not null default '[]'::jsonb;
