-- =====================================================================
-- 0334 — Reason for rejecting a Time Correction.
--
-- Every Reject now asks "why" (shared popup, src/lib/rejectReason.ts). PTO
-- (pto_requests.review_note) and employee requests (employee_requests.
-- review_note) already had a place for it; Time Corrections didn't. The
-- employee sees it in Employee Self-Service → My Requests and in their
-- rejection notification.
--
-- Run once in the Supabase SQL Editor, after 0333.
-- =====================================================================

alter table timecard_corrections add column if not exists review_note text;
