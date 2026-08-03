-- =====================================================================
-- 0117 — Payroll line items: mark an employee as already paid
--
-- Adds a per-employee "paid" checkbox to the Reports tab's expanded run
-- view (AccountingDashboard.tsx) so Finance can track who's actually been
-- paid within a run, independent of everyone else — payouts are often
-- staggered (e.g. one person paid by check today, another by ACH next
-- week), so this can't just be a single flag on the whole payroll_runs
-- row. paid_at is set/cleared alongside paid so there's a record of when.
--
-- Run once in the Supabase SQL Editor, after 0116.
-- =====================================================================

alter table payroll_line_items add column if not exists paid boolean not null default false;
alter table payroll_line_items add column if not exists paid_at timestamptz;
