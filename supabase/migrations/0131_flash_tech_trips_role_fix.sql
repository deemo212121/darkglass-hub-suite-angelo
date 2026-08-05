-- =====================================================================
-- 0131 — Fix Flash Tech Calendar write policies: company SUPERADMIN
--
-- 0129's insert/update/delete policies checked is_superadmin(), which
-- (since 0099_role_hierarchy_split.sql) means only the platform-level
-- SUPERSUPERADMIN role. The per-company SUPERADMIN role — what "SuperAdmin"
-- actually means for a normal company account (e.g. this company's own
-- SuperAdmin) — is a separate check, is_company_superadmin(). Without it,
-- a company SuperAdmin got "new row violates row-level security policy"
-- trying to schedule a trip even though they're exactly who this feature
-- is meant for.
--
-- Run once in the Supabase SQL Editor, after 0130.
-- =====================================================================

drop policy if exists flash_tech_trips_insert on flash_tech_trips;
create policy flash_tech_trips_insert on flash_tech_trips
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists flash_tech_trips_update on flash_tech_trips;
create policy flash_tech_trips_update on flash_tech_trips
  for update using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_company_superadmin() or is_superadmin())
  )
  with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists flash_tech_trips_delete on flash_tech_trips;
create policy flash_tech_trips_delete on flash_tech_trips
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_company_superadmin() or is_superadmin())
  );
