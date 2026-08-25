-- =====================================================================
-- 0191 — Let a technician read back their own technician_location_pings
-- row, not just Admin/SuperAdmin.
--
-- Found via live testing: Postgres applies a table's SELECT policy to
-- RETURNING clauses too, not just plain SELECT queries — and
-- supabase-js's .upsert() (technicianLocationPings.ts's
-- upsertMyLocationPing) requests `Prefer: return=representation` by
-- default. With the 0189 SELECT policy restricted to Admin/SuperAdmin
-- only, a technician's own write correctly passed the INSERT/UPDATE
-- WITH CHECK but then failed as a whole (42501) trying to return the
-- written row back to them.
--
-- There's no privacy concern in a technician reading back their own
-- current position — they generated that exact GPS fix themselves.
-- Admin/SuperAdmin visibility into every technician's row is unchanged.
--
-- Run once in the Supabase SQL Editor, after 0190.
-- =====================================================================

drop policy if exists technician_location_pings_select on technician_location_pings;
create policy technician_location_pings_select on technician_location_pings
  for select using (
    profile_id = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_superadmin()))
  );
