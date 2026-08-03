-- =====================================================================
-- 0029 — Fix "no unique or exclusion constraint matching the ON CONFLICT
-- specification" on profile-scoped upserts.
--
-- 0015 and 0027 added *partial* unique indexes (`where profile_id is not
-- null`) on timecard_entries(profile_id, work_date) and
-- attendance_notes(profile_id, note_date) so legacy employee_id-only rows
-- wouldn't collide. But Postgres only accepts a partial index as an
-- ON CONFLICT arbiter when the ON CONFLICT clause repeats that same WHERE
-- predicate — plain `ON CONFLICT (col, col)` (what supabase-js's
-- `.upsert(..., { onConflict: "..." })` emits) does NOT match a partial
-- index, so every such upsert fails with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Fix: swap in plain (non-partial) unique indexes. NULLs are never
-- considered equal to each other in a unique index, so legacy rows with a
-- NULL profile_id still can't collide with each other or with real rows —
-- the WHERE clause was never actually necessary.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

drop index if exists ux_timecard_profile_date;
create unique index if not exists ux_timecard_profile_date
  on timecard_entries (profile_id, work_date);

drop index if exists ux_attendance_notes_profile_date;
create unique index if not exists ux_attendance_notes_profile_date
  on attendance_notes (profile_id, note_date);
