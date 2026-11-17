-- =====================================================================
-- 0460 — Password Checks: Admins can change them too.
--
-- Before: only Super Admin / IT could turn checks on or off, change how
-- often, add / remove pages, set a password, Show password, and see
-- Recent changes. Now Admin (main role or extra role) can as well.
--
-- Only this one function changes — every Password Checks rule and
-- function (0441, 0442) asks it. No table or data is changed.
-- Every Show password is still recorded in Recent changes.
--
-- Safe to run again. Run once in the Supabase SQL Editor.
-- To undo: run the same function with only
--   select is_company_superadmin() or is_superadmin();
-- =====================================================================

create or replace function password_check_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select is_company_superadmin() or is_superadmin() or exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and is_active
      and (role = 'ADMIN' or 'ADMIN' = any(extra_roles))
  );
$$;

notify pgrst, 'reload schema';
