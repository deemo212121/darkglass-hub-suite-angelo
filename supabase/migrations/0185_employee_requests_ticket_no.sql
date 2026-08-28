-- =====================================================================
-- 0185 — Ticket Number field on payroll_dispute requests (mobile
-- Payroll Dispute form), alongside the existing structured fields from
-- migration 0183. Nullable — attendance_dispute/payroll_inquiry rows
-- never populate it.
--
-- Run once in the Supabase SQL Editor, after 0184.
-- =====================================================================

alter table employee_requests add column if not exists ticket_no text;
