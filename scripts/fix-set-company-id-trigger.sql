-- Fix set_company_id() so that direct inserts with an explicit company_id
-- (e.g. from service-role backfill scripts) are preserved instead of
-- being overwritten with auth_company_id() which returns NULL for
-- service-role sessions (no Firebase JWT).
--
-- New logic:
--   1. If company_id is already set AND the caller is not a regular user session
--      (auth_company_id() is null — i.e. service role / migration / script), keep it.
--   2. If caller is a SUPERADMIN with company_id set, keep it (existing behavior).
--   3. Otherwise derive from auth_company_id() (existing behavior for normal users).
--
-- Run this once in the Supabase SQL Editor.

create or replace function set_company_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Preserve an explicitly provided company_id when running as service role
  -- (auth_company_id() returns null for service role sessions).
  if new.company_id is not null and auth_company_id() is null then
    return new;
  end if;
  -- Superadmin with explicit company_id: keep it.
  if is_superadmin() and new.company_id is not null then
    return new;
  end if;
  -- Normal user: derive from JWT.
  new.company_id := auth_company_id();
  return new;
end;
$$;
