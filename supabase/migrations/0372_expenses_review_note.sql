-- =====================================================================
-- 0372 — Rejection reason on expenses
--
-- Accounting → Expenses now asks for a reason when rejecting an expense,
-- and the employee sees it on the request in Employee Self-Service → My
-- Requests (same "Reason rejected" box as PTO / time corrections). One new
-- nullable column; existing rows are left as they are (null = no reason
-- was recorded).
--
-- Run once in the Supabase SQL Editor, after 0371.
-- =====================================================================

alter table expenses add column if not exists review_note text;
