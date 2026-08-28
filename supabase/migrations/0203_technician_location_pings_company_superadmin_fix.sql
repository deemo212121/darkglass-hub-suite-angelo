-- =====================================================================
-- 0203 — Let the company-scoped Super Admin role read/clear technician
-- location pings, same as Admin already can.
--
-- 0191's SELECT policy (and 0189's original DELETE policy) checked
-- `is_admin() or is_superadmin()` — a pairing that meant "Admin or the
-- company's own Super Admin" before 0099_role_hierarchy_split.sql, but
-- after that migration is_superadmin() means only the platform-level
-- SUPERSUPERADMIN role (see 0099's own header). A company-scoped
-- SUPERADMIN profile (role = 'SUPERADMIN' or 'SUPERADMIN' = any(extra_roles))
-- fails both checks and RLS silently returns zero rows — not an error —
-- which is exactly why Technician Whereabouts showed no live GPS for a
-- Super Admin while an Admin viewing the same page saw it fine.
--
-- Swap in is_company_superadmin() (0099's replacement helper, already
-- extra_roles-aware) alongside the existing checks, matching the same
-- fix already applied to login_events_select in 0099 step 6.
--
-- Run once in the Supabase SQL Editor, after 0202.
-- =====================================================================

drop policy if exists technician_location_pings_select on technician_location_pings;
create policy technician_location_pings_select on technician_location_pings
  for select using (
    profile_id = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists technician_location_pings_delete on technician_location_pings;
create policy technician_location_pings_delete on technician_location_pings
  for delete using (
    profile_id = auth_profile_id()
    or is_admin()
    or is_company_superadmin()
    or is_superadmin()
  );
