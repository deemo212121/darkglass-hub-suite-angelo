-- =====================================================================
-- 0098_timecard_correction_two_stage_approval.sql
--
-- Timecard corrections currently resolve in a single step — whoever has
-- access to the Corrections tab approves or rejects directly. This adds a
-- staged approval chain, mirroring pto_requests' manager+HR pattern
-- (0036_pto_two_stage_approval.sql) but with a different shape:
--
--   1. The employee's direct manager reviews first (manager_status).
--   2. Once the manager approves, EITHER HR or Accounting (Finance) may
--      give the final approval — whichever acts first decides it; this is
--      an OR gate, not an AND like PTO's manager+HR.
--
-- The legacy `status` column stays as the derived overall status so
-- existing reads (getCompanyTimecardCorrections callers checking
-- `status === "approved"`) keep working without every call site needing
-- to learn the new stage columns immediately.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table timecard_corrections add column if not exists manager_id uuid references profiles(id);
alter table timecard_corrections add column if not exists manager_status text not null default 'pending'
  check (manager_status in ('pending','approved','rejected'));
alter table timecard_corrections add column if not exists manager_reviewed_by uuid references profiles(id);
alter table timecard_corrections add column if not exists manager_reviewed_at timestamptz;

alter table timecard_corrections add column if not exists hr_status text not null default 'pending'
  check (hr_status in ('pending','approved','rejected'));
alter table timecard_corrections add column if not exists hr_reviewed_by uuid references profiles(id);
alter table timecard_corrections add column if not exists hr_reviewed_at timestamptz;

alter table timecard_corrections add column if not exists accounting_status text not null default 'pending'
  check (accounting_status in ('pending','approved','rejected'));
alter table timecard_corrections add column if not exists accounting_reviewed_by uuid references profiles(id);
alter table timecard_corrections add column if not exists accounting_reviewed_at timestamptz;

-- Existing rows predate the staged flow — treat their old single-stage
-- `status` as already having cleared every stage that applies, so nothing
-- already approved/rejected suddenly reappears as "pending manager review".
update timecard_corrections
  set manager_status = status, hr_status = status
  where status in ('approved', 'rejected');

-- ---------- Derive the overall `status` from the three stages ----------
-- Manager rejecting, or either HR/Accounting rejecting, rejects the whole
-- request. Overall approval needs the manager AND (HR OR Accounting).
-- Otherwise it's still pending. Named with an "_a_" infix so it sorts
-- alphabetically BEFORE trg_timecard_correction_log_update below — both
-- are BEFORE UPDATE triggers on this table, and Postgres fires same-timing
-- triggers in name order, so this one must derive the fresh `status` before
-- the log trigger reads it to decide whether an overall-status transition
-- happened.
create or replace function sync_timecard_correction_overall_status()
returns trigger language plpgsql as $$
begin
  if new.manager_status = 'rejected' or new.hr_status = 'rejected' or new.accounting_status = 'rejected' then
    new.status := 'rejected';
  elsif new.manager_status = 'approved' and (new.hr_status = 'approved' or new.accounting_status = 'approved') then
    new.status := 'approved';
  else
    new.status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_timecard_correction_overall_status on timecard_corrections;
drop trigger if exists trg_timecard_correction_a_overall_status on timecard_corrections;
create trigger trg_timecard_correction_a_overall_status
  before insert or update of manager_status, hr_status, accounting_status
  on timecard_corrections
  for each row execute function sync_timecard_correction_overall_status();

-- ---------- Extend the audit trail to log each stage's decision ----------
-- Previously this only logged when the single `status` column changed.
-- Individual stage columns (manager_status/hr_status/accounting_status) are
-- set directly by the reviewing caller, so comparing them against `old` is
-- unaffected by trigger ordering — only the overall-status comparison below
-- depends on trg_timecard_correction_a_overall_status having already run.
create or replace function log_timecard_correction_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into timecard_correction_history(company_id, correction_id, action, changed_by, previous_status, new_status)
    values (new.company_id, new.id, 'submitted', coalesce(new.requested_by, auth_profile_id()), null, new.status);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.manager_status is distinct from old.manager_status then
    insert into timecard_correction_history(company_id, correction_id, action, changed_by, previous_status, new_status)
    values (new.company_id, new.id, 'manager_' || new.manager_status, coalesce(new.manager_reviewed_by, auth_profile_id()), old.manager_status, new.manager_status);
  end if;
  if tg_op = 'UPDATE' and new.hr_status is distinct from old.hr_status then
    insert into timecard_correction_history(company_id, correction_id, action, changed_by, previous_status, new_status)
    values (new.company_id, new.id, 'hr_' || new.hr_status, coalesce(new.hr_reviewed_by, auth_profile_id()), old.hr_status, new.hr_status);
  end if;
  if tg_op = 'UPDATE' and new.accounting_status is distinct from old.accounting_status then
    insert into timecard_correction_history(company_id, correction_id, action, changed_by, previous_status, new_status)
    values (new.company_id, new.id, 'accounting_' || new.accounting_status, coalesce(new.accounting_reviewed_by, auth_profile_id()), old.accounting_status, new.accounting_status);
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into timecard_correction_history(company_id, correction_id, action, changed_by, previous_status, new_status)
    values (new.company_id, new.id, new.status, auth_profile_id(), old.status, new.status);
    new.reviewed_by := auth_profile_id();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
