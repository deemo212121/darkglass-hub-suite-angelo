-- =====================================================================
-- 0223 — "Frozen" account status: HR can freeze a technician (e.g. from
-- the Technician Form Checklist) so they can still log in but see only
-- Messages — matches the existing Trainee restriction shape
-- (employment_type = 'trainee', 0152) but narrower (Messages only, not
-- Employee Self-Service), and independently of employment_type/role.
--
-- Server-side enforcement (not just UI hiding):
--   - Self-punch on timecard_entries is blocked while frozen — an HR/
--     manager correction on a frozen technician's row is untouched, since
--     the trigger only fires when the ACTING user (auth_profile_id()) is
--     also the row's own profile_id.
--   - Any ticket insert/update by a frozen acting user is blocked outright
--     (no self-vs-other distinction needed here — a frozen technician has
--     no legitimate reason to touch any ticket while frozen).
--
-- Run once in the Supabase SQL Editor, after 0222.
-- =====================================================================

alter table profiles add column if not exists frozen boolean not null default false;
alter table profiles add column if not exists frozen_at timestamptz;
alter table profiles add column if not exists frozen_by uuid references profiles(id) on delete set null;
alter table profiles add column if not exists frozen_by_name text;

-- ---------- Block a frozen technician's own timecard punch ----------
create or replace function block_frozen_self_timecard_punch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id = auth_profile_id() and exists (
    select 1 from profiles where id = new.profile_id and frozen = true
  ) then
    raise exception 'Your account is frozen — clock in/out is disabled. Contact HR.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_frozen_self_timecard_punch on timecard_entries;
create trigger trg_block_frozen_self_timecard_punch
  before insert or update on timecard_entries
  for each row execute function block_frozen_self_timecard_punch();

-- ---------- Block any ticket write by a frozen acting user ----------
create or replace function block_frozen_ticket_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = auth_profile_id() and frozen = true) then
    raise exception 'Your account is frozen — ticket access is disabled. Contact HR.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_frozen_ticket_write on tickets;
create trigger trg_block_frozen_ticket_write
  before insert or update on tickets
  for each row execute function block_frozen_ticket_write();
