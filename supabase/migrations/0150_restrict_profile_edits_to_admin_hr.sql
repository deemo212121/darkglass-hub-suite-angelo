-- =====================================================================
-- 0150_restrict_profile_edits_to_admin_hr.sql
--
-- profiles_update was wide open to any company member editing ANY other
-- profile in the company (company_id = auth_company_id(), no role check
-- beyond the SUPERADMIN-target guard added in 0144) — meaning anyone who
-- could reach a user's edit page/API could rewrite their Role or Direct
-- Manager and silently corrupt the reporting hierarchy. The app's own UI
-- now gates that page to Admin/SuperAdmin/SuperSuperAdmin/HR (see
-- m.$module.$submodule.$userId.tsx), but that's only real if the
-- database enforces it too.
--
-- This ANDs the new "editing SOMEONE ELSE requires admin/superadmin/hr"
-- check together with 0144's existing can_edit_profile_row() guard
-- (which additionally blocks a plain ADMIN from touching a SUPERADMIN's
-- row) rather than replacing it — both protections apply at once.
--
-- Self-edits (a user updating their OWN row — password change, contact
-- info, etc. via /profile) are left exactly as open as before: this only
-- adds a role check to the "editing SOMEONE ELSE" branch.
--
-- Run once in the Supabase SQL Editor, after 0149.
-- =====================================================================

create or replace function is_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role = 'HR' or 'HR' = any(extra_roles))
  );
$$;

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles
  for update using (
    firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or (
      company_id = auth_company_id()
      and (is_admin() or is_company_superadmin() or is_hr())
      and can_edit_profile_row(role, firebase_uid)
    )
    or is_superadmin()
  )
  with check (
    firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or (
      company_id = auth_company_id()
      and (is_admin() or is_company_superadmin() or is_hr())
      and can_edit_profile_row(role, firebase_uid)
    )
    or is_superadmin()
  );
