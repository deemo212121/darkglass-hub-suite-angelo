-- =====================================================================
-- 0184 — Add 'payroll_dispute' as a third employee_requests.request_type,
-- alongside 'attendance_dispute'/'payroll_inquiry' (migration 0034).
--
-- Distinct from 'payroll_inquiry' (a general question, reviewed with a
-- single "Respond & Close") — a payroll dispute is a technician
-- contesting a specific amount/period, reviewed the same way an
-- attendance dispute is (Approve/Reject), not just closed with a note.
-- See AttendanceMonitoringPage.tsx's Disputes & Inquiries tab.
--
-- Run once in the Supabase SQL Editor, after 0183.
-- =====================================================================

alter table employee_requests drop constraint if exists employee_requests_request_type_check;
alter table employee_requests add constraint employee_requests_request_type_check
  check (request_type in ('attendance_dispute', 'payroll_inquiry', 'payroll_dispute'));
