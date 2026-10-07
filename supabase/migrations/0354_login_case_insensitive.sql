-- =====================================================================
-- 0354 — Login: Unique ID (and username) not case-sensitive.
--
-- The username was already compared with lower(); the Unique ID (company
-- login alias / legacy code) had to match exactly, so "usihs" failed where
-- "USIHS" worked. Both are now compared case-insensitively and with
-- surrounding spaces ignored. Same rule otherwise as 0085: once a company
-- has a login alias set, only the alias is accepted.
--
-- Function definitions only — no data is changed.
-- Run once in the Supabase SQL Editor, after 0353.
-- =====================================================================

create or replace function login_email_for_username(
  p_username text,
  p_company_code text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.email
  from profiles p
  join companies c on c.id = p.company_id
  where (
    case when c.login_alias is not null then lower(trim(c.login_alias)) = lower(trim(p_company_code))
    else lower(trim(c.legacy_code)) = lower(trim(p_company_code)) end
  )
    and lower(trim(p.username)) = lower(trim(p_username))
    and p.is_active = true
  limit 1;
$$;

create or replace function login_company_code_is_valid(p_company_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from companies c
    where (
      case when c.login_alias is not null then lower(trim(c.login_alias)) = lower(trim(p_company_code))
      else lower(trim(c.legacy_code)) = lower(trim(p_company_code)) end
    )
  );
$$;
