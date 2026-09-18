-- =====================================================================
-- 0267 — Fix flash_tech_trips_update: silently dropped company SuperAdmin
--
-- 0131 (flash_tech_trips_role_fix) added is_company_superadmin() to the
-- insert/update/delete policies specifically because is_superadmin() only
-- means the platform-level SUPERSUPERADMIN role (see 0099), not a normal
-- company's own SuperAdmin. 0257 (Tracker fields) then re-created just the
-- UPDATE policy to add is_hr() for the new Tracker editing feature, but
-- copied from an older version of the policy and dropped
-- is_company_superadmin() in the process -- its own comment even says
-- "was Admin/Finance/SuperAdmin only", showing the intent was to KEEP
-- SuperAdmin access, not remove it.
--
-- Net effect since 0257 shipped: a company SuperAdmin's Tracker edits
-- (Status, Hotel Rate, Notes, any per-cell field) silently no-op --
-- Supabase doesn't raise an error for an UPDATE a RLS policy excludes, it
-- just affects 0 rows, so the UI shows no error and nothing saves. Insert
-- (Schedule Trip) and Delete were untouched by 0257 and still had the
-- correct check.
--
-- Run once in the Supabase SQL Editor, after 0266.
-- =====================================================================

drop policy if exists flash_tech_trips_update on flash_tech_trips;
create policy flash_tech_trips_update on flash_tech_trips
  for update using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_hr() or is_company_superadmin() or is_superadmin())
  )
  with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_hr() or is_company_superadmin() or is_superadmin())
  );
