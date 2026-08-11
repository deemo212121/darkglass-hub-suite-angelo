-- =====================================================================
-- 0144 — A plain ADMIN cannot edit a SUPERADMIN's profile
--
-- profiles_update (0001_init.sql) let any company member update any other
-- profile in their own company, with no role hierarchy check at all — a
-- plain ADMIN could edit another employee's role/details even if that
-- employee was a company-scoped SUPERADMIN, including reassigning their
-- role away entirely. This locks that down: editing (or promoting someone
-- into) a SUPERADMIN row now requires the caller to already be at least
-- SUPERADMIN-tier (company SUPERADMIN or the platform SUPERSUPERADMIN).
--
-- Self-edit (the /profile page) is untouched — a SUPERADMIN can always
-- edit their own row regardless of this check, same as before.
--
-- can_edit_profile_row() is checked in BOTH the using clause (against the
-- row's CURRENT role, before the edit) and the with check clause (against
-- the row's NEW role, after the edit) — so this blocks a plain ADMIN from
-- both editing an existing SUPERADMIN's details AND from promoting anyone
-- into SUPERADMIN in the first place.
--
-- Run once in the Supabase SQL Editor, after 0143.
-- =====================================================================

create or replace function can_edit_profile_row(target_role text, target_firebase_uid text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    target_firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or is_superadmin()
    or is_company_superadmin()
    or target_role != 'SUPERADMIN';
$$;

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles
  for update using (
    firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or (company_id = auth_company_id() and can_edit_profile_row(role, firebase_uid))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and can_edit_profile_row(role, firebase_uid))
    or is_superadmin()
  );
