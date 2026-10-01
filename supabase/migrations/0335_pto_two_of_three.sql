-- =====================================================================
-- 0335 — PTO / Sick / Unpaid Leave: any 2 of Manager / HR / Accounting.
--
-- Previously a leave request needed the MANAGER first, then HR or
-- Accounting (0036/0101). HR can't wait on the manager, so leave now
-- follows the same rule as Time Corrections (0270): any two stages
-- approving, in any order, approves it; any stage rejecting denies it.
-- Cancelled stays cancelled.
--
-- Run once in the Supabase SQL Editor, after 0334.
-- =====================================================================

create or replace function sync_pto_overall_status()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if new.manager_status = 'rejected' or new.hr_status = 'rejected' or new.accounting_status = 'rejected' then
    new.status := 'denied';
  elsif (case when new.manager_status = 'approved' then 1 else 0 end)
      + (case when new.hr_status = 'approved' then 1 else 0 end)
      + (case when new.accounting_status = 'approved' then 1 else 0 end) >= 2 then
    new.status := 'approved';
  else
    new.status := 'pending';
  end if;
  return new;
end;
$$;
