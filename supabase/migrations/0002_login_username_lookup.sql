-- =====================================================================
-- AH Solutions — Pre-auth username -> email lookup (Step for username login)
--
-- Problem: username login needs to resolve a username + company code into the
-- email to sign in with. This happens BEFORE a Supabase session exists, so RLS
-- on `profiles` / `companies` blocks the read (no `sub` claim yet).
--
-- Fix: a SECURITY DEFINER function that bypasses RLS but exposes ONLY the email
-- for an exact (company legacy_code + username) match on an ACTIVE profile.
-- No company data leaks: it returns a single email string or null.
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
  where c.legacy_code = p_company_code
    and lower(p.username) = lower(p_username)
    and p.is_active = true
  limit 1;
$$;

-- Allow anonymous (pre-login) and authenticated callers to run it.
grant execute on function login_email_for_username(text, text) to anon, authenticated;
