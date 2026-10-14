-- =====================================================================
-- 0372 — Payroll dispute "Modify" (AccountingDashboard.tsx's Payroll
-- Disputes tab). Besides Approve / Reject, the accountant can approve a
-- dispute with corrected amounts (Received / Expected / Missing) and a
-- comment. The employee's own figures are kept in the original_* columns
-- so both they and Accounting see "requested" vs "approved" side by side;
-- total_received / total_expected / missing_amount hold the approved
-- (modified) values, which is what gets added to their Tech Activity
-- Report. modified_at is null for a dispute approved as submitted.
-- Revert to Pending restores the original figures and clears these.
-- Run once in the Supabase SQL Editor, after 0371.
-- =====================================================================

alter table employee_requests add column if not exists original_total_received numeric;
alter table employee_requests add column if not exists original_total_expected numeric;
alter table employee_requests add column if not exists original_missing_amount numeric;
alter table employee_requests add column if not exists modified_by uuid references profiles(id) on delete set null;
alter table employee_requests add column if not exists modified_at timestamptz;
