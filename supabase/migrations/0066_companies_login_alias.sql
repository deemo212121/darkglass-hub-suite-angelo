-- =====================================================================
-- AH Solutions — Optional short login alias for companies
--
-- Problem: a company's real ID (companies.legacy_code, e.g. "COMP001")
-- can't be safely renamed — it's also the Firestore document ID for that
-- company, and Firestore doc IDs can't be renamed in place. But SuperAdmin
-- still wants a shorter/friendlier string to hand out for the "Company ID"
-- field at login.
--
-- Fix: login_alias is a second, freely-editable string. Both legacy_code
-- and login_alias work at login — nothing about the canonical ID changes,
-- so no Firestore migration is needed.
--
-- Run this once in the Supabase SQL Editor.
-- =====================================================================

alter table companies add column login_alias text unique;

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
  where (c.legacy_code = p_company_code or c.login_alias = p_company_code)
    and lower(p.username) = lower(p_username)
    and p.is_active = true
  limit 1;
$$;
