-- =====================================================================
-- 0206 — Let FINANCE edit other employees' profile details, same as HR.
--
-- The app now grants FINANCE access to User Management and the
-- employee detail/edit page (ACCOUNT_EDIT_ROLES in
-- m.$module.$submodule.$userId.tsx, USER_MANAGEMENT_ROLES in
-- submoduleAccess.ts) -- but 0150 locked the actual profiles_update RLS
-- policy down to is_admin() or is_company_superadmin() or is_hr() for
-- editing SOMEONE ELSE's row. Without this, a FINANCE user's edit would
-- pass the frontend gate, submit the update, and RLS would silently
-- reject it (0 rows affected, no error) -- looks like a broken Save
-- button with no explanation.
--
-- Mirrors is_hr() exactly. Self-edits (a user updating their OWN row)
-- were already unrestricted and stay that way.
--
-- Run once in the Supabase SQL Editor, after 0205.
-- =====================================================================

create or replace function is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role = 'FINANCE' or 'FINANCE' = any(extra_roles))
  );
$$;

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles
  for update using (
    firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or (
      company_id = auth_company_id()
      and (is_admin() or is_company_superadmin() or is_hr() or is_finance())
      and can_edit_profile_row(role, firebase_uid)
    )
    or is_superadmin()
  )
  with check (
    firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or (
      company_id = auth_company_id()
      and (is_admin() or is_company_superadmin() or is_hr() or is_finance())
      and can_edit_profile_row(role, firebase_uid)
    )
    or is_superadmin()
  );
