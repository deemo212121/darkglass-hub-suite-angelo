-- =====================================================================
-- 0271 — Track when a user's Active/Deactivated status last changed
--
-- User Management's Status column had no way to show "deactivated on
-- [date]" — is_active was a plain boolean with no history. Adds
-- status_changed_at, kept current by a trigger (not app code) so it's
-- correct no matter which code path flips is_active (updateCompanyUser,
-- a future admin tool, direct SQL, etc.) rather than relying on every
-- call site to remember to stamp it.
--
-- Existing rows are left null — we genuinely don't know when a currently-
-- active account was last toggled, and a fabricated date (e.g. created_at)
-- would be misleading. The column only starts populating from the next
-- real status change going forward.
--
-- Run once in the Supabase SQL Editor, after 0270.
-- =====================================================================

alter table profiles add column if not exists status_changed_at timestamptz;

create or replace function set_profile_status_changed_at()
returns trigger language plpgsql as $$
begin
  if new.is_active is distinct from old.is_active then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_status_changed_at on profiles;
create trigger trg_profiles_status_changed_at
  before update on profiles
  for each row
  execute function set_profile_status_changed_at();
