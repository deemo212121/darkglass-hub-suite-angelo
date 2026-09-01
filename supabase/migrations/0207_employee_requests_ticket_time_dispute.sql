-- =====================================================================
-- 0207 — Add 'ticket_time_dispute' as a fourth employee_requests.
-- request_type, alongside attendance_dispute/payroll_inquiry/payroll_dispute
-- (migrations 0034/0184).
--
-- Replaces the mobile "Attendance Dispute" screen (a plain free-text
-- complaint, no ticket-specific fields) with a dedicated flow for reporting
-- a failed On-Site Check-In (see 0202_ticket_onsite_checkin_timestamps.sql):
-- a technician picks the ticket, states the time they actually started/
-- finished, and can attach proof — reviewed on Attendance Monitoring's new
-- "Ticket Time Disputes" tab, separate from the existing "Disputes &
-- Inquiries" tab (which keeps working for any already-pending legacy
-- attendance_dispute rows, it just stops receiving new ones).
--
-- Reuses the existing generic `ticket_no` (0187) and `attachments` (0185)
-- columns — both were already nullable/type-agnostic. Only the disputed
-- start/end time are new, since nothing else on this table captures a
-- time-of-day claim (payroll_dispute's pay_period fields are date-only).
--
-- On approval (AttendanceMonitoringPage.tsx), these two values get written
-- straight onto the disputed ticket's own onsite_arrived_at/onsite_done_at
-- columns via the same setTicketOnsiteCheckIn() the mobile Work Start/Done
-- buttons call — actually fixing the missing check-in, not just recording
-- that a dispute happened.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table employee_requests drop constraint if exists employee_requests_request_type_check;
alter table employee_requests add constraint employee_requests_request_type_check
  check (request_type in ('attendance_dispute', 'payroll_inquiry', 'payroll_dispute', 'ticket_time_dispute'));

alter table employee_requests add column if not exists disputed_start_time timestamptz;
alter table employee_requests add column if not exists disputed_end_time timestamptz;
