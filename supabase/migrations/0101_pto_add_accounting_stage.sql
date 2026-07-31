-- =====================================================================
-- 0101_pto_add_accounting_stage.sql
--
-- Extends PTO's second-stage approval from "HR only" to "HR OR Accounting"
-- (whichever acts first decides it) — an OR gate, mirroring what 0098 did
-- for timecard_corrections. The manager stage is unchanged and still
-- required first; the actual "manager must approve before HR/Accounting
-- can act at all" gating lives in canReviewPtoStage() (src/lib/supabase/
-- pto.ts), not in SQL — this migration only adds the column Accounting
-- reviews against and updates the derived-status trigger to OR them.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table pto_requests add column if not exists accounting_status text not null default 'pending'
  check (accounting_status in ('pending','approved','rejected'));
alter table pto_requests add column if not exists accounting_reviewed_by uuid references profiles(id);
alter table pto_requests add column if not exists accounting_reviewed_at timestamptz;

-- Existing rows predate the accounting stage — treat their old hr_status as
-- already having cleared "the second stage" so nothing already
-- approved/denied suddenly looks like it's awaiting a NEW accounting review
-- it never had.
update pto_requests set accounting_status = hr_status where status in ('approved', 'denied');

-- trg_pto_sync_status (from 0036) already calls this function by name on
-- every insert/update — replacing the function body is enough, no need to
-- drop/recreate the trigger itself.
create or replace function sync_pto_overall_status()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if new.manager_status = 'rejected' or new.hr_status = 'rejected' or new.accounting_status = 'rejected' then
    new.status := 'denied';
  elsif new.manager_status = 'approved' and (new.hr_status = 'approved' or new.accounting_status = 'approved') then
    new.status := 'approved';
  else
    new.status := 'pending';
  end if;
  return new;
end;
$$;
