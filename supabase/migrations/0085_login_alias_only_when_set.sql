-- =====================================================================
-- AH Solutions — Company ID login field: prefer login_alias, fall back
-- to legacy_code only when no alias has been set
--
-- Previously (see 0066_companies_login_alias.sql) both a company's real ID
-- (legacy_code) and its login_alias always worked at login. Now: once a
-- company has a login_alias, that's the only accepted value for the
-- Company ID field - legacy_code stops working for that company. A
-- company with no login_alias set is unaffected (legacy_code still works,
-- since there'd otherwise be nothing left to type at login).
--
-- Run this once in the Supabase SQL Editor.
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
    case when c.login_alias is not null then c.login_alias = p_company_code
    else c.legacy_code = p_company_code end
  )
    and lower(p.username) = lower(p_username)
    and p.is_active = true
  limit 1;
$$;

-- Lets the login form tell "wrong company code" apart from "wrong
-- username" instead of always blaming the username - called only after
-- login_email_for_username comes back empty, so it doesn't add a round
-- trip to the successful-login path. Only reveals whether the typed code
-- is currently valid for some company, same disclosure level as the
-- username lookup above already has.
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
      case when c.login_alias is not null then c.login_alias = p_company_code
      else c.legacy_code = p_company_code end
    )
  );
$$;
