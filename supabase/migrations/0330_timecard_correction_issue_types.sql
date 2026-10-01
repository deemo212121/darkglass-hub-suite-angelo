-- =====================================================================
-- 0330 — Time Correction "Issue" choices.
--
-- Time Corrections now ask what went wrong instead of the generic
-- Exception Type: Forgot to clock / System Issue / Account Issue /
-- Internet Issue / Other (specify). Stored in the same
-- timecard_corrections.exception_type column (0312); the four original
-- values stay valid so every correction filed before this keeps its
-- choice and its PDF unchanged. Sick / Unpaid Leave (pto_requests) and
-- Ticket Time Dispute (employee_requests) are not affected.
--
-- Run once in the Supabase SQL Editor, after 0329.
-- =====================================================================

do $$
declare c text;
begin
  -- 0312 added the check inline, so its name is auto-generated — find it.
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'timecard_corrections' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%exception_type%'
  loop
    execute format('alter table timecard_corrections drop constraint %I', c);
  end loop;
end $$;

alter table timecard_corrections add constraint timecard_corrections_exception_type_check
  check (exception_type in (
    'forgot_to_clock', 'system_issue', 'account_issue', 'internet_issue', 'other',
    'missed_workday', 'late_early', 'missed_visit'
  ));
