-- =====================================================================
-- AH Solutions — Prevent duplicate locations per company
--
-- Adds a unique constraint on (company_id, location) for
-- location_mgmt_locations so the same office can't be inserted twice.
--
-- Before adding the constraint we de-duplicate any existing rows, keeping
-- the "best" row per (company_id, location):
--   1. prefer a row that has coordinates set
--   2. otherwise the most recently updated row
-- and deleting the rest.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

-- ---------- 1. Remove existing duplicates ----------
with ranked as (
  select
    id,
    row_number() over (
      partition by company_id, lower(location)
      order by
        case when coalesce(trim(coordinates), '') <> '' then 0 else 1 end,
        updated_at desc
    ) as rn
  from location_mgmt_locations
)
delete from location_mgmt_locations
where id in (select id from ranked where rn > 1);

-- ---------- 2. Enforce uniqueness going forward ----------
-- Case-insensitive uniqueness on the location name within a company.
create unique index if not exists uq_locmgmt_company_location
  on location_mgmt_locations (company_id, lower(location));
