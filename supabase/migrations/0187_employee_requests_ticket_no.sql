-- =====================================================================
-- 0187 — Ticket Number field on payroll_dispute requests (mobile
-- Payroll Dispute form), alongside the existing structured fields from
-- migration 0185. Nullable — attendance_dispute/payroll_inquiry rows
-- never populate it.
--
-- Run once in the Supabase SQL Editor, after 0186.
-- =====================================================================

alter table employee_requests add column if not exists ticket_no text;
