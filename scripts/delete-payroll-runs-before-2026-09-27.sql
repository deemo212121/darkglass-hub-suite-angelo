-- Delete every payroll run EXCEPT 2026-09-27 .. 2026-10-10 (Finance, 2026-10-21:
-- "we don't need them for now"), along with their saved payslips.
--
-- As of 2026-10-21 that is 16 runs and 1,264 payslip lines (6 of them already
-- sent to employees — they disappear from Self-Service / the mobile Payroll
-- screen).
--
-- Carryovers: 21 late-ticket carryovers were paid in two of these runs
-- (9/13–9/27: 20, one other: 1). A carryover only enters a payroll while it
-- isn't linked to any run, so deleting their run would make them get PAID
-- AGAIN next payroll. They're pointed at the kept 9/27–10/10 run instead, so
-- they stay marked as paid.
--
-- Backup: copies of everything removed are kept in three backup_* tables
-- (step 1), so it can be restored. Drop them later when no longer needed:
--   drop table backup_payroll_runs_20261021, backup_payroll_line_items_20261021,
--              backup_late_ticket_completions_20261021;
--
-- Run in the Supabase SQL Editor. All-or-nothing: if any step fails, nothing
-- is changed.

begin;

-- The run to keep — stop if it isn't there as expected.
do $$
begin
  if (select count(*) from payroll_runs where period_start = date '2026-09-27' and period_end = date '2026-10-10') <> 1 then
    raise exception 'Expected exactly one 2026-09-27 .. 2026-10-10 run — stopping.';
  end if;
end $$;

-- 1) Backups.
create table backup_payroll_runs_20261021 as
  select * from payroll_runs
  where not (period_start = date '2026-09-27' and period_end = date '2026-10-10');

create table backup_payroll_line_items_20261021 as
  select li.* from payroll_line_items li
  where li.payroll_run_id in (select id from backup_payroll_runs_20261021);

create table backup_late_ticket_completions_20261021 as
  select * from late_ticket_completions
  where carryover_payroll_run_id in (select id from backup_payroll_runs_20261021);

-- Lock the backups: RLS on with no policies + no grants, so no app user (or
-- the public anon key) can read them — only the SQL Editor / service role.
-- (The first run of this script missed this; Supabase's Advisor flagged all
-- three as "RLS Disabled in Public", 2026-10-22.)
alter table backup_payroll_runs_20261021 enable row level security;
alter table backup_payroll_line_items_20261021 enable row level security;
alter table backup_late_ticket_completions_20261021 enable row level security;
revoke all on backup_payroll_runs_20261021 from anon, authenticated;
revoke all on backup_payroll_line_items_20261021 from anon, authenticated;
revoke all on backup_late_ticket_completions_20261021 from anon, authenticated;

-- 2) Keep those carryovers marked as paid (point them at the kept run).
update late_ticket_completions
set carryover_payroll_run_id = (
  select id from payroll_runs where period_start = date '2026-09-27' and period_end = date '2026-10-10'
)
where carryover_payroll_run_id in (select id from backup_payroll_runs_20261021);

-- 3) Delete the old runs — their payslip lines go with them (on delete cascade).
delete from payroll_runs where id in (select id from backup_payroll_runs_20261021);

commit;

-- Check: expect only the 2026-09-27 .. 2026-10-10 run left.
select r.period_start, r.period_end, r.generated_at,
       (select count(*) from payroll_line_items li where li.payroll_run_id = r.id) as payslips
from payroll_runs r
order by r.period_start desc;
