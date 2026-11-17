-- =====================================================================
-- 0456 — Speed indexes (no data is changed).
--
-- parts and pto_requests are filtered by company on every request but had
-- no index on company_id, so the database read the whole table each time.
-- The other two match what Home's counts now ask for: pending PTO, and
-- corrections that are pending or from this month.
--
-- Built "concurrently" — in the background, without locking the tables, so
-- nobody waits while they build.
--
-- HOW TO RUN: "concurrently" can't run together with other statements, so
-- in the Supabase SQL Editor run EACH line below ON ITS OWN (select the line,
-- then Run). Safe to run again (if not exists). To undo one:
--   drop index concurrently if exists <name>;
-- =====================================================================

create index concurrently if not exists idx_parts_company on parts(company_id);

create index concurrently if not exists idx_pto_requests_company_status on pto_requests(company_id, status);

create index concurrently if not exists idx_timecard_corrections_company_status on timecard_corrections(company_id, status);

create index concurrently if not exists idx_timecard_corrections_company_work_date on timecard_corrections(company_id, work_date);
