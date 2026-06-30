-- =====================================================================
-- 0015_timecard_profile_unique.sql
--
-- The personal timecard page upserts timecard_entries keyed by
-- (profile_id, work_date), but the only unique constraint in 0001_init.sql
-- was on (employee_id, work_date). Without a matching unique index Supabase
-- ignored the onConflict clause and the upsert silently failed for users
-- who only have a profile (no `employees` row yet).
--
-- This migration adds the missing unique index so the upsert works, while
-- keeping the legacy (employee_id, work_date) one in place for any code
-- still writing through the employees pathway.
-- =====================================================================

create unique index if not exists ux_timecard_profile_date
  on timecard_entries (profile_id, work_date)
  where profile_id is not null;
