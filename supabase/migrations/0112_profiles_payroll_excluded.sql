-- =====================================================================
-- 0112 — Exclude specific employees from payroll generation
--
-- Some accounts (e.g. the owner/boss) are real company users but never
-- draw a salary through this system — Finance needs to leave them out of
-- Generate Payroll entirely rather than having them show up as $0 rows.
-- Checkbox lives on AccountingDashboard.tsx's Payroll tab employee table
-- (leftmost column); excluded employees stay visible there (so they can be
-- re-included later) but are skipped by generatePayroll(), the missing-
-- clock-out gate, and the nation/department export.
--
-- Run once in the Supabase SQL Editor, after 0111.
-- =====================================================================

alter table profiles add column if not exists payroll_excluded boolean not null default false;
