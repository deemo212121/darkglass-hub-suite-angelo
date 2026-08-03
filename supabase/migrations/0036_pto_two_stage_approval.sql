-- =====================================================================
-- 0036 — Two-stage PTO approval (manager + HR)
--
-- A PTO request now needs BOTH a manager approval and an HR approval
-- before it's considered fully approved. manager_id is resolved at
-- submission time (the requester's manager_name matched against real
-- profiles, or their CSR team leader — see src/lib/notifyRouting.ts); if
-- unresolved, anyone with the generic MANAGER role can act as a stand-in.
--
-- The overall `status` column stays for backward-compat display (My
-- Requests / PTO History) but is now DERIVED from manager_status +
-- hr_status by a trigger — a stage being rejected immediately denies the
-- whole request; both stages approved is what makes it "approved".
-- Existing 'cancelled' rows are left alone.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table pto_requests add column if not exists manager_id uuid references profiles(id);
alter table pto_requests add column if not exists manager_status text not null default 'pending'
  check (manager_status in ('pending','approved','rejected'));
alter table pto_requests add column if not exists manager_reviewed_by uuid references profiles(id);
alter table pto_requests add column if not exists manager_reviewed_at timestamptz;

alter table pto_requests add column if not exists hr_status text not null default 'pending'
  check (hr_status in ('pending','approved','rejected'));
alter table pto_requests add column if not exists hr_reviewed_by uuid references profiles(id);
alter table pto_requests add column if not exists hr_reviewed_at timestamptz;

create or replace function sync_pto_overall_status()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if new.manager_status = 'rejected' or new.hr_status = 'rejected' then
    new.status := 'denied';
  elsif new.manager_status = 'approved' and new.hr_status = 'approved' then
    new.status := 'approved';
  else
    new.status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pto_sync_status on pto_requests;
create trigger trg_pto_sync_status
  before insert or update on pto_requests
  for each row execute function sync_pto_overall_status();
