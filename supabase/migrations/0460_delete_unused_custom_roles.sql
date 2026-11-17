-- =====================================================================
-- 0460 — Delete the old custom roles: Technician Tier 1, Technician
--        Tier 2, Technician Tier 3, Trainee.
--
-- Only the custom-role entries (the names in Accessibility Management →
-- Manage Roles → Custom Roles) are deleted. Built-in roles are not touched.
-- Trainee ACCESS is unaffected — that comes from HR's employment type
-- (trainee), not from this role.
--
-- SAFE: a role is deleted only if NOBODY holds it (main role or extra
-- role). If someone still does, it's skipped — reassign them on User
-- Management, then run this again.
--
-- STEP 1 (optional) — see who still holds them. Run this alone first:
--
--   select p.display_name, p.email, p.role, p.extra_roles, p.is_active
--   from profiles p
--   where upper(p.role) in ('TECHNICIAN_TIER_1','TECHNICIAN_TIER_2','TECHNICIAN_TIER_3','TRAINEE')
--      or p.extra_roles && array['TECHNICIAN_TIER_1','TECHNICIAN_TIER_2','TECHNICIAN_TIER_3','TRAINEE'];
--
-- STEP 2 — run the delete below. Safe to run again.
-- =====================================================================

delete from custom_roles c
where (
    upper(c.code) in ('TECHNICIAN_TIER_1', 'TECHNICIAN_TIER_2', 'TECHNICIAN_TIER_3', 'TRAINEE')
    or lower(trim(c.label)) in ('technician tier 1', 'technician tier 2', 'technician tier 3', 'trainee')
  )
  and not exists (
    select 1 from profiles p
    where p.company_id = c.company_id
      and (upper(p.role) = upper(c.code) or c.code = any(p.extra_roles))
  )
returning c.label as deleted_role;

notify pgrst, 'reload schema';
