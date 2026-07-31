-- =====================================================================
-- 0104 — Receipt attachment on expense records
--
-- The file itself lives in Firebase Storage (companies/{companyId}/expenses/
-- {expenseId}/...), same convention as every other upload in this app (see
-- src/lib/firebase/storage.ts) — these two columns just point at it.
--
-- Run once in the Supabase SQL Editor, after 0103.
-- =====================================================================

alter table expenses add column if not exists receipt_url text;
alter table expenses add column if not exists receipt_path text;
