-- =====================================================================
-- 0148 — Payroll exclusion on mileage entries
--
-- Lets Finance flag a specific ticket as "don't pay this technician for
-- this job while flagged" from the Mileage tab's On Hold action — a
-- REVERSIBLE override: while true, even a genuinely completed ticket
-- never counts toward that technician's "Completed Tickets" pay (see
-- getTechCompletedRepairCounts in techPayroll.ts, which skips any
-- ticket_id flagged here the same way it already skips redo tickets);
-- toggling it back off (un-hold) restores normal pay counting from then on.
--
-- Scoped to (ticket, technician) via mileage_entries' own ticket_id/
-- profile_id pairing rather than a new table — a ticket only ever has one
-- assigned technician in practice, so this is unambiguous.
--
-- Run once in the Supabase SQL Editor, after 0147.
-- =====================================================================

alter table mileage_entries add column if not exists payroll_excluded boolean not null default false;
alter table mileage_entries add column if not exists payroll_excluded_at timestamptz;
alter table mileage_entries add column if not exists payroll_excluded_by uuid references profiles(id) on delete set null;
alter table mileage_entries add column if not exists payroll_excluded_by_name text;

create index if not exists idx_mileage_entries_payroll_excluded on mileage_entries(ticket_id) where payroll_excluded;
